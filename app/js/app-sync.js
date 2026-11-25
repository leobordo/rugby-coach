// Collega: repository locale + coda di sync + client Drive + login Google. Espone lo stato alla UI.
import * as repo from './repo.js';
import { createSyncEngine, SYNC_STATUS, COLLECTION_ID, buildRemoteIndex, localKeyOfRemote } from './sync.js';
import { createDriveClient, DriveAuthError, DriveOfflineError, DriveHttpError, findOrCreateAppFolder } from './drive.js';
import { createGoogleAuth, GoogleSignInError, MSG } from './google.js';
import { buildArtifacts, loadDocx } from './artifacts.js';
import { SYNCABLE_KINDS, APP_ID } from './model.js';
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
    onChange: (e) => { if (e.status) statusMap.set(e.key, e.status); else statusMap.delete(e.key); repo.emit('sync-entry', e); },
  });
  for (const e of await syncStore.all()) statusMap.set(e.key, e.status);
  repo.setSyncHooks({
    onDirty: async (kind, id) => { await engine.markDirty(kind, id); schedule(); },
    onForget: (kind, id) => engine.forget(kind, id),
  });
  await refreshState();
  window.addEventListener('online', () => { runNow(); if (state.configured && state.folder) auth.preload(); });
  setInterval(() => { if (navigator.onLine) runNow(); }, 60e3);
  // Drive collegato: lo script di accesso Google viene preparato subito (così il tocco "Salva su Drive" funziona
  // anche su iPhone). Se non è collegato, si prepara solo quando l'app propone di collegarlo (preloadGoogle).
  if (state.configured && state.folder && navigator.onLine) auth.preload();
  setTimeout(runNow, 2500);
}

async function collectionRecord(kind) {
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
  if (kind === 'library' || kind === 'roster') return collectionRecord(kind);
  return repo.get(kind, id);
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
    const files = await drive.listAppFiles(folder && folder.folderId, { mimeType: 'application/json', props: { rcId: COLLECTION_ID, rcKind: kind === 'library' ? 'exercise' : 'player' } });
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
  const remoteId = (kind === 'library' || kind === 'roster') && ((ctx.known && ctx.known.json) || (ctx.remote && ctx.remote.json));
  if (remoteId) {
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
  await repo.setSetting('drive', { folderId: folder.id, folderName: folder.name, account: state.account, chosenAt: new Date().toISOString() });
  if (!prev || prev.folderId !== folder.id) {
    await resetRemoteFiles();
    await markAllDirty();
  }
  await refreshState();
  if (run) {
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
  const files = await drive.listAppFiles(folderId, { mimeType: 'application/json' });
  let missing = 0;
  for (const f of files) {
    const key = localKeyOfRemote(f.appProperties);
    if (!key) continue;
    const [kind, id] = key.split(':');
    if (kind === 'library' || kind === 'roster') continue;
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
  const all = await drive.listAppFiles(folder.folderId);
  const index = buildRemoteIndex(all);
  const jsons = all.filter((f) => f.mimeType === 'application/json' && (f.appProperties || {}).rcVariant === 'json');
  const sum = { files: 0, inserted: 0, updated: 0, skipped: 0, errors: 0 };
  for (const f of jsons) {
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
        const r = await repo.importBackup(txt, { sync: false });
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
