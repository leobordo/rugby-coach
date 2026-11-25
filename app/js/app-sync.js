// Collega: repository locale + coda di sync + client Drive + login Google. Espone lo stato alla UI.
import * as repo from './repo.js';
import { createSyncEngine, SYNC_STATUS, COLLECTION_ID, buildRemoteIndex, localKeyOfRemote } from './sync.js';
import { createDriveClient, DriveAuthError, DriveOfflineError, DriveHttpError, findOrCreateAppFolder, findOrCreateDataFolder, moveRootJson, moveFileQuietly } from './drive.js';
import { createGoogleAuth, GoogleSignInError, MSG } from './google.js';
import { buildArtifacts, loadDocx } from './artifacts.js';
import { SYNCABLE_KINDS, APP_ID, SCHEMA_VERSION, EPOCH, resolveDeletions, parseBackup, buildRecordBackup } from './model.js';
import { debounce } from './ui.js';

export const DEFAULT_FOLDER_NAME = 'Rugby Coach';

let fileConfig = {};
const statusMap = new Map(); // stato di ogni scheda verso Drive, tenuto in memoria (lettura sincrona nei tocchi)
let engine = null;
let auth = null;
let drive = null;
export const state = { configured: false, configSource: null, folder: null, needsAuth: false, running: false, lastError: null, account: null, lastRun: null };

const syncStore = {
  get: (k) => repo.getDB().get('sync', k),
  put: (v) => repo.getDB().put('sync', v),
  delete: (k) => repo.getDB().delete('sync', k),
  all: () => repo.getDB().getAll('sync'),
};

export async function loadFileConfig() {
  try {
    const mod = await import(new URL('../config.js', import.meta.url).href);
    fileConfig = mod.default || mod.config || {};
  } catch {
    fileConfig = {};
  }
  return fileConfig;
}

export async function getConfig() {
  const saved = await repo.getSetting('google', {}) || {};
  const pick = (k) => (saved[k] && String(saved[k]).trim()) || (fileConfig[k] && String(fileConfig[k]).trim()) || '';
  return { clientId: pick('clientId'), apiKey: pick('apiKey'), appId: pick('appId') };
}

export function getFileConfig() { return { ...fileConfig }; }

async function refreshState() {
  const cfg = await getConfig();
  const saved = await repo.getSetting('google', {}) || {};
  state.configured = !!cfg.clientId;
  state.pickerAvailable = !!(cfg.clientId && cfg.apiKey && cfg.appId); // scelta cartella col Picker: solo opzione avanzata
  state.configSource = saved.clientId ? 'impostazioni' : fileConfig.clientId ? 'config.js' : null;
  state.folder = await repo.getSetting('drive', null);
  state.account = (state.folder && state.folder.account) || null;
  state.hasToken = auth ? auth.hasToken() : false;
  repo.emit('sync-state', { ...state });
}

export async function initSync() {
  await loadFileConfig();
  auth = createGoogleAuth({ getConfig });
  drive = createDriveClient({ fetch: (...a) => window.fetch(...a), getToken: async () => auth.getValidToken(), onUnauthorized: () => auth.clearToken() });
  engine = createSyncEngine({
    store: syncStore,
    drive,
    getRecord,
    buildArtifacts: buildFor,
    getFolderId: async () => (await repo.getSetting('drive', null))?.folderId || null,
    isOnline: () => navigator.onLine,
    getJsonFolderId: async () => (await repo.getSetting('drive', null))?.dataFolderId || null,
    listRemote: () => listPersonal(),
    onChange: (e) => { if (e.status) statusMap.set(e.key, e.status); else statusMap.delete(e.key); repo.emit('sync-entry', e); },
  });
  for (const e of await syncStore.all()) statusMap.set(e.key, e.status);
  repo.setSyncHooks({
    onDirty: async (kind, id) => { await engine.markDirty(kind, id); schedule(); },
    onForget: (kind, id) => engine.forget(kind, id),
    // scheda eliminata: i suoi file su Drive vanno nel cestino (anche più tardi, se ora non c'è rete)
    onDelete: async (kind, id) => { await engine.markDeleted(kind, id); await engine.markDirty('deleted', COLLECTION_ID); schedule(); },
  });
  await refreshState();
  await requeueMigrated();
  window.addEventListener('online', () => { runNow(); if (state.configured && state.folder) auth.preload(); });
  setInterval(() => { if (navigator.onLine) runNow(); }, 60e3);
  // Drive collegato: lo script di accesso Google viene preparato subito (così il tocco "Salva su Drive" funziona
  // anche su iPhone). Se non è collegato, si prepara solo quando l'app propone di collegarlo (preloadGoogle).
  if (state.configured && state.folder && navigator.onLine) auth.preload();
  setTimeout(runNow, 2500);
}

// Dopo un aggiornamento dello schema (es. v1.3 -> v1.4, seduta a sezioni): UNA volta, tutte le schede migrate
// tornano in coda, così su Drive il .docx principale è rigenerato nel nuovo formato (stesso file, nessun
// duplicato) e il vecchio .docx dell'osservazione finisce nel cestino, anche per le schede mai riaperte.
// Drive non collegato: niente da fare ora, alla prima connessione tutte le schede vengono comunque inviate.
async function requeueMigrated() {
  const meta = (await repo.getSetting('meta', {})) || {};
  if (meta.requeuedSchema === SCHEMA_VERSION) return;
  if (state.folder) {
    for (const kind of SYNCABLE_KINDS) {
      for (const raw of await repo.list(kind)) {
        if (raw.schemaVersion === SCHEMA_VERSION) continue;
        const rec = await repo.get(kind, raw.id); // migrata
        await repo.save(rec, { touch: false, sync: false });
        await engine.markDirty(kind, rec.id);
      }
    }
  }
  await repo.setSetting('meta', { ...meta, requeuedSchema: SCHEMA_VERSION });
}

const SHEET_KINDS = ['session', 'match', 'plan'];
async function sheetTombstones() {
  const out = {};
  for (const k of SHEET_KINDS) out[k] = await repo.getTombstones(k);
  return out;
}

async function collectionRecord(kind) {
  if (kind === 'deleted') {
    const tombstones = await sheetTombstones();
    const alive = await getRevived();
    const none = SHEET_KINDS.every((k) => !Object.keys(tombstones[k]).length && !Object.keys(alive[k] || {}).length);
    // mai "esempio": va sempre unito con l'indice remoto (così si scoprono le eliminazioni fatte altrove)
    return { kind, id: COLLECTION_ID, tombstones, alive, example: false, placeholder: none };
  }
  const dataKind = kind === 'library' ? 'exercise' : 'player';
  const items = (await repo.list(dataKind)).sort((a, b) => String(a.name).localeCompare(String(b.name), 'it'));
  const tombstones = await repo.getTombstones(dataKind);
  const noTombs = Object.keys(tombstones).length === 0;
  const rec = { kind, id: COLLECTION_ID, tombstones,
    example: items.every((e) => e.example) && noTombs, // solo esempi non toccati: non sovrascrive mai Drive
    placeholder: items.length === 0 && noTombs };
  rec[kind === 'library' ? 'exercises' : 'players'] = items;
  return rec;
}

async function getRecord(kind, id) {
  if (kind === 'library' || kind === 'roster' || kind === 'deleted') return collectionRecord(kind);
  return repo.get(kind, id);
}

// Schede eliminate altrove ma poi modificate di nuovo: { kind: { id: updatedAt della modifica che ha vinto } }.
// Viaggiano nell'indice "Eliminati" accanto alle tombstone: una tombstone con data <= di questa è superata
// (vale anche sui telefoni che la scheda non l'hanno, così la tombstone non torna).
async function getRevived() { return (await repo.getSetting('revived', {})) || {}; }

// Unisce l'indice remoto delle schede eliminate. Regola: vince l'evento più recente.
// - eliminazione più recente della versione locale -> la scheda si toglie anche qui (e non viene rimandata);
// - scheda modificata qui DOPO l'eliminazione -> la modifica vince: la tombstone è superata ("alive"),
//   la scheda torna in coda e al prossimo invio i suoi file escono dal cestino di Drive.
async function mergeDeletedJson(txt, { fromUpload = false } = {}) {
  const obj = JSON.parse(txt);
  if (!obj || obj.app !== APP_ID) throw new Error('Indice eliminati non valido');
  const remote = obj.tombstones || {};
  const remoteAlive = obj.alive || {};
  const revived = await getRevived();
  let changed = false;
  let indexChanged = false;
  for (const k of SHEET_KINDS) {
    const local = await repo.getTombstones(k);
    const all = { ...local, ...(remote[k] || {}) };
    const updated = {};
    for (const id of Object.keys(all)) { const rec = await repo.get(k, id); if (rec) updated[id] = rec.updatedAt || EPOCH; }
    const res = resolveDeletions({ localTombs: local, remoteTombs: remote[k] || {}, localAlive: revived[k] || {}, remoteAlive: remoteAlive[k] || {},
      updatedOf: (id) => (id in updated ? updated[id] : null) });
    for (const id of res.remove) { await repo.removeLocalOnly(k, id); changed = true; }
    // modificate qui dopo l'eliminazione: la modifica vince, tornano in coda (i file escono dal cestino)
    for (const id of res.revive) { indexChanged = true; if (engine) await engine.markDirty(k, id); }
    if (JSON.stringify(res.tombs) !== JSON.stringify(local)) await repo.setTombstones(k, res.tombs);
    revived[k] = res.alive;
  }
  await repo.setSetting('revived', revived);
  if (indexChanged && engine && !fromUpload) { await engine.markDirty('deleted', COLLECTION_ID); schedule(); }
  if (changed) repo.emit('imported', {});
  return changed;
}

async function isTombstoned(kind, rec) {
  const at = (await repo.getTombstones(kind))[rec.id];
  return !!at && (Date.parse(at) || 0) >= (Date.parse(rec.updatedAt) || 0);
}

// Unisce in locale il .json remoto di una raccolta (elemento per elemento, con tombstone)
async function mergeCollectionJson(kind, txt) {
  const dataKind = kind === 'library' ? 'exercise' : 'player';
  const obj = JSON.parse(txt);
  if (!obj || obj.app !== APP_ID) throw new Error('Backup raccolta non valido');
  const items = (obj.data && obj.data[kind === 'library' ? 'exercises' : 'players']) || [];
  const tombs = (obj.tombstones && obj.tombstones[dataKind]) || {};
  return repo.mergeRemoteCollection(dataKind, items, tombs);
}

// Versione del file remoto (Drive "version"), per accorgersi se un altro dispositivo l'ha cambiato nel frattempo
async function remoteVersion(kind, fileId) {
  try {
    const folder = await repo.getSetting('drive', null);
    const files = await listPersonal({ mimeType: 'application/json', props: { rcId: COLLECTION_ID, rcKind: kind === 'library' ? 'exercise' : 'player' } });
    const f = files.find((x) => x.id === fileId);
    return f && f.version != null ? String(f.version) : null;
  } catch (e) {
    if (e instanceof DriveAuthError) throw e;
    return null;
  }
}

async function buildFor(kind, rec, ctx = {}) {
  // Libreria e rosa: prima di OGNI invio si scarica il .json remoto e si uniscono gli elementi
  // (vince l'updatedAt più recente; le cancellazioni viaggiano come tombstone). Il risultato va anche in locale
  // e il .docx della libreria è rigenerato dall'unione. Se durante l'unione la versione del file su Drive cambia
  // (altro dispositivo), si ripete. Resta una piccola finestra tra il controllo e il PATCH: Drive v3 non offre
  // aggiornamenti condizionati (If-Match) sugli upload; l'elemento perso riappare comunque al giro successivo
  // del dispositivo che lo possiede, perché il suo merge lo rimanda.
  const remoteId = (kind === 'library' || kind === 'roster' || kind === 'deleted') && ((ctx.known && ctx.known.json) || (ctx.remote && ctx.remote.json));
  if (kind === 'deleted') {
    if (remoteId) {
      try { await mergeDeletedJson(await drive.download(remoteId), { fromUpload: true }); } catch (e) { if (e instanceof DriveAuthError || e instanceof DriveOfflineError) throw e; console.warn(e); }
      rec = await collectionRecord(kind);
    }
    if (rec.placeholder) return []; // nessuna eliminazione: nessun file
  } else if (remoteId) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const v0 = await remoteVersion(kind, remoteId);
      try {
        await mergeCollectionJson(kind, await drive.download(remoteId));
      } catch (e) {
        if (e instanceof DriveAuthError || e instanceof DriveOfflineError) throw e;
        console.warn('Unione con il backup remoto non riuscita', e);
        break;
      }
      const v1 = v0 == null ? null : await remoteVersion(kind, remoteId);
      if (v0 === v1) break;
    }
    rec = await collectionRecord(kind);
  }
  return buildArtifacts(await loadDocx(), rec);
}

const schedule = debounce(() => runNow(), 4000);

// Con accesso valido: si legge l'indice delle schede eliminate da altri telefoni e si tolgono anche qui
// (se l'eliminazione è più recente), così non vengono rimandate su Drive. Una sola lettura, fuori dalla coda.
let pulledDeletions = false;
async function pullRemoteDeletions() {
  const folder = await repo.getSetting('drive', null);
  if (!folder || !folder.folderId) return;
  const files = await listPersonal({ mimeType: 'application/json', props: { rcKind: 'tombstones', rcId: COLLECTION_ID } });
  const f = files.find((x) => x.appProperties && x.appProperties.rcKind === 'tombstones');
  if (f) await mergeDeletedJson(await drive.download(f.id));
}

export async function runNow({ force = false } = {}) {
  if (!engine) return null;
  const prefs = await repo.getSetting('prefs', { autoSync: true }) || { autoSync: true };
  if (!force && prefs.autoSync === false) return null;
  if (!state.configured || !state.folder) return null;
  if (!auth.getValidToken()) {
    const p = await engine.pending();
    state.needsAuth = p.length > 0;
    repo.emit('sync-state', { ...state });
    return null;
  }
  state.running = true; repo.emit('sync-state', { ...state });
  try {
    // "File per l'app" (ritrovata o creata) e spostamento dei vecchi .json dalla cartella principale
    try { await prepareDataFolder(); } catch (e) {
      console.warn(e);
      if (e instanceof DriveAuthError) { state.needsAuth = true; return null; }
      return null; // senza la sottocartella non si invia nulla: riprova al prossimo giro
    }
    // indice delle eliminazioni: una volta per avvio e prima di ogni giro con schede da inviare
    // (così una scheda eliminata altrove più di recente non viene rimandata su Drive)
    const waiting = (await engine.pending()).some((e) => SHEET_KINDS.includes(e.kind) && !e.deleted);
    if (!pulledDeletions || waiting) {
      try {
        await pullRemoteDeletions();
        pulledDeletions = true;
      } catch (e) {
        pulledDeletions = false;
        console.warn(e);
        if (e instanceof DriveAuthError) { state.needsAuth = true; return null; }
        if (waiting) return null; // senza l'indice non si rischia di rimandare una scheda eliminata: riprova tra poco
      }
    }
    const sum = await engine.processQueue({ force });
    state.needsAuth = !!sum.needsAuth;
    state.lastRun = { at: Date.now(), ...sum };
    state.lastError = sum.folderMissing ? 'La cartella "Rugby Coach" su Drive non si trova più: in Impostazioni tocca "Collega Google Drive" per ricrearla.' : null;
    return sum;
  } finally {
    state.running = false;
    state.hasToken = auth.hasToken();
    repo.emit('sync-state', { ...state });
  }
}

// Da un gesto dell'utente: accede se serve e sincronizza tutto subito
export async function syncNow() {
  if (!state.configured) throw new Error('Il salvataggio su Google Drive non è disponibile in questa versione.');
  if (!state.folder) throw new Error('Collega prima Google Drive (Impostazioni).');
  if (!auth.getValidToken()) await signIn();
  return runNow({ force: true });
}

// Numero di schede da salvare su Drive, letto dalla memoria (sincrono: utilizzabile dentro un tocco)
export function pendingCount() { let n = 0; for (const st of statusMap.values()) if (st !== SYNC_STATUS.SYNCED) n++; return n; }
export function preloadGoogle() { if (state.configured && navigator.onLine && auth) auth.preload(); }
export function googleReady() { return !!(auth && auth.isReady()); }

// Messaggio semplice per l'allenatore, per qualunque errore legato a Google/Drive
export function friendlyError(e) {
  if (e instanceof GoogleSignInError) return e.message;
  if (e instanceof DriveOfflineError) return MSG.unreachable;
  if (e instanceof DriveAuthError) return 'Serve di nuovo l\'accesso a Google: tocca di nuovo.';
  if (e instanceof DriveHttpError) return 'Google Drive non risponde. Riprova tra poco.';
  return (e && e.message) || MSG.failed;
}

// IMPORTANTE (iPhone/Safari): va chiamata in modo sincrono dal gestore del tocco, senza await prima;
// auth.signIn chiama requestAccessToken subito. Dispositivo già collegato: prompt '' (si chiude da solo).
export async function signIn(opts = {}) {
  const t = await auth.signIn({ knownUser: !!state.folder, ...opts });
  state.needsAuth = false;
  try {
    const a = await drive.about();
    state.account = a.user ? (a.user.emailAddress || a.user.displayName) : null;
    const f = await repo.getSetting('drive', null);
    if (f) await repo.setSetting('drive', { ...f, account: state.account });
  } catch { /* facoltativo */ }
  await refreshState();
  return t;
}

export async function signOut({ forgetFolder = false } = {}) {
  await auth.signOut();
  if (forgetFolder) { await repo.setSetting('drive', null); await resetRemoteFiles(); }
  state.account = null;
  await refreshState();
}

export async function switchAccount() {
  // prima la richiesta di accesso (dentro il tocco), poi il resto
  const p = auth.signIn({ selectAccount: true });
  await p;
  await repo.setSetting('drive', null);
  await resetRemoteFiles();
  await refreshState();
}

async function setFolder(folder, { run = true } = {}) {
  const prev = await repo.getSetting('drive', null);
  const same = prev && prev.folderId === folder.id;
  await repo.setSetting('drive', { folderId: folder.id, folderName: folder.name, account: state.account, chosenAt: new Date().toISOString(),
    dataFolderId: same ? prev.dataFolderId || null : null });
  if (!same) {
    rootJsonChecked = false;
    await resetRemoteFiles();
    await markAllDirty();
  }
  await refreshState();
  if (run) {
    await prepareDataFolder().catch((e) => console.warn(e));
    await checkRestoreHint(folder.id).catch(() => {});
    runNow({ force: true });
  }
}

// Collegamento in UN tocco (da un gesto dell'utente): accesso Google, poi la cartella "Rugby Coach" viene
// ritrovata (se l'app l'aveva già creata, anche da un altro telefono) o creata nella radice del Drive.
// Se esisteva già, le schede salvate lì vengono recuperate subito (unione: vince la modifica più recente).
export async function connectDrive() {
  if (!state.configured) throw new Error('Il salvataggio su Google Drive non è disponibile in questa versione.');
  if (!auth.getValidToken()) await signIn();
  const { folder, created } = await findOrCreateAppFolder(drive, DEFAULT_FOLDER_NAME, APP_ID);
  await setFolder(folder, { run: false });
  await prepareDataFolder();
  let restored = null;
  if (!created) {
    try { restored = await restoreFromDrive(); } catch (e) { if (e instanceof DriveAuthError) throw e; console.warn('Recupero schede non riuscito', e); }
  }
  await repo.setSetting('restoreHint', null);
  runNow({ force: true });
  return { folder, created, restored };
}

// Nuovo dispositivo: se la cartella contiene backup di schede che qui non ci sono, la home propone il ripristino
async function checkRestoreHint(folderId) {
  const files = await listPersonal({ mimeType: 'application/json' });
  let missing = 0;
  for (const f of files) {
    const key = localKeyOfRemote(f.appProperties);
    if (!key) continue;
    const [kind, id] = key.split(':');
    if (kind === 'library' || kind === 'roster' || kind === 'deleted') continue;
    if ((await repo.getTombstones(kind))[id]) continue;
    if (!(await repo.get(kind, id))) missing++;
  }
  await repo.setSetting('restoreHint', missing ? { folderId, count: missing } : null);
}

export async function pickExistingFolder() {
  if (!auth.getValidToken()) await signIn();
  const f = await auth.pickFolder();
  if (!f) return null;
  await setFolder(f);
  return f;
}

export async function createDedicatedFolder(name = DEFAULT_FOLDER_NAME) {
  if (!auth.getValidToken()) await signIn();
  const f = await drive.createFolder(name.trim() || DEFAULT_FOLDER_NAME, { appProperties: { rcApp: APP_ID, rcKind: 'folder' } });
  await setFolder(f);
  return f;
}

async function resetRemoteFiles() {
  const all = await syncStore.all();
  for (const e of all) { e.files = {}; e.links = {}; await syncStore.put(e); }
}

export async function markAllDirty() {
  for (const kind of SYNCABLE_KINDS) for (const r of await repo.list(kind)) await engine.markDirty(kind, r.id);
  await engine.markDirty('library', COLLECTION_ID);
  await engine.markDirty('roster', COLLECTION_ID);
  await engine.markDirty('deleted', COLLECTION_ID);
  schedule();
}

export async function syncRecordNow(kind, id) {
  const tok = state.configured && state.folder && !auth.getValidToken() ? signIn() : null; // subito, dentro il tocco
  await engine.markDirty(kind, id);
  if (tok) await tok;
  return syncNow();
}

export async function getStatus(kind, id) { return engine ? engine.getStatus(kind, id) : null; }
export async function pendingEntries() { return engine ? engine.pending() : []; }
export async function allEntries() { return syncStore.all(); }

// Ripristino dai file .json di backup creati dall'app nella cartella scelta (stesso Client ID, scope drive.file).
// Le schede importate "adottano" i file già presenti su Drive (stato sincronizzato, nessun nuovo upload);
// solo se la versione locale è più recente vengono rimesse in coda (aggiornando gli stessi file).
export async function restoreFromDrive() {
  if (!auth.getValidToken()) await signIn();
  const folder = await repo.getSetting('drive', null);
  if (!folder || !folder.folderId) throw new Error('Scegli prima la cartella Drive.');
  const all = await listPersonal();
  const index = buildRemoteIndex(all);
  const jsons = all.filter((f) => f.mimeType === 'application/json' && (f.appProperties || {}).rcVariant === 'json');
  const sum = { files: 0, inserted: 0, updated: 0, skipped: 0, errors: 0, deleted: 0 };
  // prima l'indice delle schede eliminate: quelle schede non devono tornare
  const delFile = jsons.find((f) => localKeyOfRemote(f.appProperties) === 'deleted:' + COLLECTION_ID);
  if (delFile) {
    try { await mergeDeletedJson(await drive.download(delFile.id)); await engine.adopt('deleted', COLLECTION_ID, index.get('deleted:' + COLLECTION_ID) || { json: delFile.id }, { folderId: folder.folderId }); } catch (e) { if (e instanceof DriveAuthError) throw e; sum.errors++; }
  }
  for (const f of jsons) {
    if (f === delFile) continue;
    try {
      const key = localKeyOfRemote(f.appProperties);
      const [kind, id] = key.split(':');
      const txt = await drive.download(f.id);
      let pending;
      if (kind === 'library' || kind === 'roster') {
        // raccolta: merge per elemento; va riinviata solo se in locale c'era qualcosa che il remoto non ha
        const m = await mergeCollectionJson(kind, txt);
        sum.files++; sum.inserted += m.upserts.length;
        pending = m.remoteChanged;
      } else {
        const recs = parseBackup(txt);
        const keep = [];
        for (const r of recs) if (!(await isTombstoned(r.kind, r))) keep.push(r);
        if (!keep.length) {
          // eliminata su un altro telefono: non si recupera; i suoi file vanno nel cestino
          await engine.adopt(kind, id, index.get(key) || { json: f.id }, { folderId: folder.folderId });
          await engine.markDeleted(kind, id);
          sum.deleted++;
          continue;
        }
        const r = await repo.importBackup(buildRecordBackup(keep[0]), { sync: false });
        sum.files++; sum.inserted += r.inserted; sum.updated += r.updated; sum.skipped += r.skipped;
        pending = r.items.some((x) => x.localNewer);
      }
      await engine.adopt(kind, id, index.get(key) || { json: f.id }, { folderId: folder.folderId, pending });
    } catch (e) {
      if (e instanceof DriveAuthError) throw e;
      console.warn('Ripristino non riuscito per', f.name, e);
      sum.errors++;
    }
  }
  await repo.setSetting('restoreHint', null);
  if (sum.files) schedule();
  return sum;
}

export async function saveConfig(cfg) {
  await repo.setSetting('google', { clientId: (cfg.clientId || '').trim(), apiKey: (cfg.apiKey || '').trim(), appId: (cfg.appId || '').trim() });
  auth.clearToken();
  auth.reset();
  await refreshState();
  if (state.configured && navigator.onLine) auth.preload();
}

export function hasToken() { return auth ? auth.hasToken() : false; }

// Stato di salvataggio di una scheda, in parole semplici (R7)
export function statusLabel(entry) {
  const local = { text: 'Salvato sul telefono', cls: 'local', title: 'Le schede restano su questo telefono' };
  if (!state.configured || !state.folder) return local;
  if (!entry || !entry.status) return { ...local, title: 'Verrà salvato anche su Drive' };
  switch (entry.status) {
    case SYNC_STATUS.SYNCED: return { text: 'Salvato su Drive ✓', cls: 'synced', title: entry.syncedAt ? 'Ultimo salvataggio: ' + new Date(entry.syncedAt).toLocaleString('it-IT') : '' };
    case SYNC_STATUS.SYNCING: return { text: 'Salvataggio su Drive…', cls: 'syncing', title: '' };
    case SYNC_STATUS.ERROR: return { text: 'Non salvato su Drive', cls: 'error', title: 'Riprovo da solo tra poco' };
    default: return { text: 'Da salvare su Drive', cls: 'pending', title: state.needsAuth ? 'Tocca "Salva su Drive" per completare' : navigator.onLine ? 'Tra pochi secondi' : 'Senza rete: si salva quando torna la connessione' };
  }
}

// ----- "File per l'app": i .json stanno lì, nella cartella principale solo i documenti Word -----
// Tutti i file dell'app di questo utente: cartella principale + "File per l'app" (durante la migrazione i .json
// possono stare in entrambe: ricerca, ripristino, eliminazioni e controllo dei duplicati guardano in tutte e due).
async function listPersonal(opts = {}) {
  const f = await repo.getSetting('drive', null);
  if (!f || !f.folderId) return [];
  const lists = await Promise.all([drive.listAppFiles(f.folderId, opts), f.dataFolderId ? drive.listAppFiles(f.dataFolderId, opts) : []]);
  const seen = new Set();
  // prima quelli in "File per l'app": se per una scheda esistesse un .json in entrambe, vale quello
  return [...lists[1], ...lists[0]].filter((x) => (seen.has(x.id) ? false : seen.add(x.id)));
}

let rootJsonChecked = false; // spostamento dei .json dalla cartella principale: una volta per avvio, finché serve
// A ogni giro una sola files.list delle sottocartelle: la ritrova (anche se un altro telefono l'ha appena creata),
// la crea se manca e unisce eventuali doppie.
async function prepareDataFolder() {
  const f = await repo.getSetting('drive', null);
  if (!f || !f.folderId) return null;
  const found = await findOrCreateDataFolder(drive, f.folderId, APP_ID);
  if (f.dataFolderId && f.dataFolderId !== found.id) {
    // un altro telefono l'aveva creata prima: i .json noti vengono portati in quella giusta
    for (const e of await syncStore.all()) if (e.files && e.files.json) await moveFileQuietly(drive, e.files.json, found.id, f.dataFolderId);
    rootJsonChecked = false;
  }
  const dataId = found.id;
  if (dataId !== f.dataFolderId) await repo.setSetting('drive', { ...(await repo.getSetting('drive', null)), dataFolderId: dataId });
  if (!rootJsonChecked) {
    // interrotta (rete, errore di Drive)? non blocca il resto: si riprende al prossimo giro
    try { await moveRootJson(drive, f.folderId, dataId, APP_ID); rootJsonChecked = true; } catch (e) {
      if (e instanceof DriveAuthError) throw e;
      console.warn('Spostamento in "File per l\'app" da riprendere', e);
    }
  }
  return dataId;
}
