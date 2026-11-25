// Coda di sincronizzazione persistente (outbox) app -> Drive (monodirezionale, R19/D3).
// Indipendente da IndexedDB e da Google: store, drive e builder sono iniettati (test con fetch finto).
//
// Niente duplicati: ogni file creato porta appProperties { rcApp, rcKind, rcId, rcVariant } e il .json di una
// scheda elenca anche gli id dei suoi .docx (rcF_<variante>). Prima di CREARE un file l'app cerca nella cartella
// i file già esistenti della stessa scheda (files.list) e li aggiorna (PATCH): così ricollegare la stessa cartella,
// cambiare account o usare un nuovo dispositivo non duplica nulla.
//
// Esempi precaricati (record.example === true, id stabili): non sovrascrivono mai un file remoto;
// vengono creati solo se nella cartella non esistono ancora.
import { DriveAuthError, DriveHttpError, DriveOfflineError } from './drive.js';
import { APP_ID } from './model.js';

export const SYNC_STATUS = { PENDING: 'pending', SYNCING: 'syncing', SYNCED: 'synced', ERROR: 'error' };

// Raccolte salvate come un unico file (libreria esercizi, rosa): tipo di dato contenuto su Drive
// 'deleted' = indice delle schede eliminate ("Rugby Coach - Eliminati.json"): le eliminazioni non tornano dal recupero
export const COLLECTION_REMOTE_KIND = { library: 'exercise', roster: 'player', deleted: 'tombstones' };
export const COLLECTION_ID = 'all';
const REMOTE_TO_COLLECTION = Object.fromEntries(Object.entries(COLLECTION_REMOTE_KIND).map(([k, v]) => [v, k]));

export function syncKey(kind, id) { return `${kind}:${id}`; }

export function remoteIdentity(kind, id) {
  return { rcKind: COLLECTION_REMOTE_KIND[kind] || kind, rcId: String(id) };
}

// Da appProperties di un file remoto alla chiave locale della coda
export function localKeyOfRemote(ap) {
  if (!ap || ap.rcApp !== APP_ID || !ap.rcKind || !ap.rcId) return null;
  if (ap.rcId === COLLECTION_ID && REMOTE_TO_COLLECTION[ap.rcKind]) return syncKey(REMOTE_TO_COLLECTION[ap.rcKind], COLLECTION_ID);
  return syncKey(ap.rcKind, ap.rcId);
}

// Indice dei file remoti: chiave locale -> { variante: fileId }
export function buildRemoteIndex(files) {
  const idx = new Map();
  const put = (key, variant, id) => {
    if (!key || !variant || !id) return;
    const m = idx.get(key) || {};
    if (!m[variant]) m[variant] = id;
    idx.set(key, m);
  };
  for (const f of files || []) {
    const ap = f.appProperties || {};
    const key = localKeyOfRemote(ap);
    if (!key) continue;
    if (ap.rcVariant) put(key, ap.rcVariant, f.id);
  }
  // gli id dei .docx elencati nel .json valgono come riserva (es. se files.list non restituisce i .docx)
  for (const f of files || []) {
    const ap = f.appProperties || {};
    const key = localKeyOfRemote(ap);
    if (!key) continue;
    for (const [k, v] of Object.entries(ap)) if (k.startsWith('rcF_')) put(key, k.slice(4), v);
  }
  return idx;
}

export function defaultBackoff(attempts) {
  return Math.min(30 * 60e3, 15e3 * 2 ** Math.max(0, attempts - 1)); // 15 s, 30 s, 1 min ... max 30 min
}

export function createSyncEngine({
  store, getRecord, buildArtifacts, drive, getFolderId,
  isOnline = () => true, now = () => Date.now(), onChange = () => {}, backoff = defaultBackoff,
  // cartella dei .json ("File per l'app" dentro "Rugby Coach"); senza: la stessa dei documenti
  getJsonFolderId = null,
  // file dell'app da considerare (cartella principale + "File per l'app"); senza: solo la cartella
  listRemote = null,
}) {
  let running = null;

  async function markDirty(kind, id) {
    const key = syncKey(kind, id);
    const e = (await store.get(key)) || { key, kind, id, files: {} };
    e.status = SYNC_STATUS.PENDING;
    e.dirtyAt = now();
    e.rev = (e.rev || 0) + 1;
    e.attempts = 0;
    e.nextAttemptAt = 0;
    e.error = null;
    await store.put(e);
    onChange(e);
    return e;
  }

  // Ripristino: la scheda corrisponde già ai file su Drive -> "sincronizzato" senza ricaricarla.
  // Con pending: true i file sono noti (niente duplicati) ma la versione locale va comunque inviata.
  async function adopt(kind, id, files, { folderId, pending = false } = {}) {
    const key = syncKey(kind, id);
    const e = (await store.get(key)) || { key, kind, id, files: {} };
    e.files = { ...e.files, ...files };
    e.folderId = folderId || e.folderId;
    e.error = null;
    e.attempts = 0;
    if (pending) {
      e.status = SYNC_STATUS.PENDING; e.dirtyAt = now(); e.rev = (e.rev || 0) + 1; e.nextAttemptAt = 0;
    } else if (e.status !== SYNC_STATUS.PENDING) {
      e.status = SYNC_STATUS.SYNCED; e.syncedAt = now();
    }
    await store.put(e);
    onChange(e);
    return e;
  }

  // Eliminazione di una scheda: entra nella coda (funziona anche offline); al prossimo giro i suoi file su Drive
  // vanno nel cestino. La voce resta finché non è fatto.
  async function markDeleted(kind, id) {
    const key = syncKey(kind, id);
    const e = (await store.get(key)) || { key, kind, id, files: {} };
    e.deleted = true;
    e.status = SYNC_STATUS.PENDING;
    e.dirtyAt = now();
    e.rev = (e.rev || 0) + 1;
    e.attempts = 0;
    e.nextAttemptAt = 0;
    e.error = null;
    await store.put(e);
    onChange(e);
    return e;
  }

  async function forget(kind, id) {
    await store.delete(syncKey(kind, id));
    onChange({ key: syncKey(kind, id), kind, id, status: null });
  }

  async function getStatus(kind, id) { return store.get(syncKey(kind, id)); }

  async function pending() {
    const all = await store.all();
    return all.filter((e) => e.status !== SYNC_STATUS.SYNCED);
  }

  function appPropsFor(entry, art, files) {
    const ap = { rcApp: APP_ID, ...remoteIdentity(entry.kind, entry.id), rcVariant: art.key };
    if (art.key === 'json') for (const [k, v] of Object.entries(files)) if (k !== 'json' && v) ap['rcF_' + k] = v;
    return ap;
  }

  async function uploadArtifact(entry, art, parent, files) {
    const appProperties = appPropsFor(entry, art, files);
    const known = files[art.key];
    const base = { name: art.name, mimeType: art.mimeType, data: art.data, appProperties };
    if (known) {
      try {
        // la versione che si invia è la più recente (le eliminazioni più recenti sono già state applicate prima
        // del giro): se il file era nel cestino ne esce, insieme a tutti gli altri file della scheda
        return await drive.uploadFile({ ...base, fileId: known, untrash: true });
      } catch (e) {
        if (!(e instanceof DriveHttpError && e.status === 404)) throw e;
        // il file è stato eliminato su Drive: lo ricreiamo
      }
    }
    return drive.uploadFile({ ...base, parents: [parent] });
  }

  async function trashOne(entry, ctx) {
    const files = { ...(entry.files || {}) };
    const remote = (await ctx.remoteIndex()).get(entry.key) || {};
    const ids = new Set([...Object.values(files), ...Object.values(remote)].filter(Boolean));
    for (const id of ids) await drive.trashFile(id);
    const latest = (await store.get(entry.key)) || entry;
    if (latest.deleted && latest.rev === entry.rev) { await store.delete(entry.key); onChange({ key: entry.key, kind: entry.kind, id: entry.id, status: null }); return 'deleted'; }
    return SYNC_STATUS.PENDING;
  }

  async function syncOne(entry, folderId, ctx) {
    if (entry.deleted) return trashOne(entry, ctx);
    const record = await getRecord(entry.kind, entry.id);
    if (!record) { await store.delete(entry.key); return 'deleted'; }
    const startedRev = entry.rev;
    entry.status = SYNC_STATUS.SYNCING;
    await store.put(entry); onChange(entry);
    const files = { ...entry.files };
    const links = { ...(entry.links || {}) };
    // primo invio da questo dispositivo (o cartella cambiata): cerca i file già esistenti della scheda
    let remote = {};
    if (!files.json || entry.folderId !== folderId) {
      remote = (await ctx.remoteIndex()).get(entry.key) || {};
    }
    for (const [k, v] of Object.entries(remote)) if (!files[k]) files[k] = v;
    const hasRemote = Object.keys(remote).length > 0;
    const knewFiles = Object.keys(entry.files || {}).length > 0;

    if (record.example && (hasRemote || knewFiles || record.placeholder)) {
      // esempio non modificato: non sovrascrive mai, adotta i file che esistono già
    } else {
      const artifacts = await buildArtifacts(entry.kind, record, { known: { ...entry.files }, remote });
      const keys = new Set(artifacts.map((a) => a.key));
      // i .docx prima del .json (così il .json elenca i loro id)
      const ordered = [...artifacts.filter((a) => a.key !== 'json'), ...artifacts.filter((a) => a.key === 'json')];
      for (const art of ordered) {
        if (art.key === 'json') {
          // documenti non più prodotti (es. il vecchio .docx dell'osservazione, ora unito): nel cestino
          for (const k of Object.keys(files)) if (!keys.has(k) && files[k]) { await drive.trashFile(files[k]); delete files[k]; delete links[k]; }
        }
        const res = await uploadArtifact(entry, art, art.key === 'json' ? ctx.jsonFolderId : folderId, files);
        files[art.key] = res.id;
        if (res.webViewLink) links[art.key] = res.webViewLink;
      }
    }
    // rilegge: se la scheda è stata modificata durante l'upload resta in attesa
    const latest = (await store.get(entry.key)) || entry;
    latest.files = files;
    latest.links = links;
    latest.error = null;
    latest.attempts = 0;
    latest.folderId = folderId;
    if (latest.rev === startedRev) {
      latest.status = SYNC_STATUS.SYNCED;
      latest.syncedAt = now();
    } else {
      latest.status = SYNC_STATUS.PENDING;
    }
    await store.put(latest); onChange(latest);
    return latest.status;
  }

  async function run({ force = false } = {}) {
    const summary = { processed: 0, synced: 0, errors: 0, needsAuth: false, skipped: null };
    if (!isOnline()) { summary.skipped = 'offline'; return summary; }
    const folderId = await getFolderId();
    if (!folderId) { summary.skipped = 'nofolder'; return summary; }
    const jsonFolderId = getJsonFolderId ? await getJsonFolderId() : folderId;
    if (!jsonFolderId) { summary.skipped = 'nofolder'; return summary; }
    const all = await pending();
    const t = now();
    const todo = all.filter((e) => force || e.status !== SYNC_STATUS.ERROR || (e.nextAttemptAt || 0) <= t)
      .sort((a, b) => (a.dirtyAt || 0) - (b.dirtyAt || 0));
    // una sola files.list per giro, e solo se serve
    let idx = null;
    const ctx = {
      jsonFolderId,
      remoteIndex: () => {
        if (!idx) {
          idx = (listRemote ? listRemote(folderId) : drive.listAppFiles ? drive.listAppFiles(folderId) : Promise.resolve([])).then(buildRemoteIndex);
          idx.catch(() => { idx = null; });
        }
        return idx;
      },
    };
    for (const entry of todo) {
      summary.processed++;
      try {
        const st = await syncOne(entry, folderId, ctx);
        if (st === SYNC_STATUS.SYNCED || st === 'deleted') summary.synced++;
      } catch (e) {
        const latest = (await store.get(entry.key)) || entry;
        if (e instanceof DriveAuthError) {
          latest.status = SYNC_STATUS.PENDING;
          latest.error = e.message;
          await store.put(latest); onChange(latest);
          summary.needsAuth = true;
          break;
        }
        if (e instanceof DriveOfflineError) {
          latest.status = SYNC_STATUS.PENDING;
          latest.error = e.message;
          await store.put(latest); onChange(latest);
          summary.skipped = 'offline';
          break;
        }
        latest.status = SYNC_STATUS.ERROR;
        latest.error = e.message || String(e);
        latest.attempts = (latest.attempts || 0) + 1;
        latest.nextAttemptAt = now() + backoff(latest.attempts);
        await store.put(latest); onChange(latest);
        summary.errors++;
        if (e instanceof DriveHttpError && e.status === 404 && /parent|cartella|File not found/i.test(e.message || '')) {
          summary.folderMissing = true;
        }
      }
    }
    return summary;
  }

  // Evita esecuzioni concorrenti: chi chiama mentre gira attende lo stesso giro
  function processQueue(opts) {
    if (running) return running;
    running = run(opts).finally(() => { running = null; });
    return running;
  }

  return { markDirty, markDeleted, adopt, forget, getStatus, pending, processQueue, isRunning: () => !!running };
}
