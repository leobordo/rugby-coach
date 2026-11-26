// Collega: repository locale + coda di sync + client Drive + login Google. Espone lo stato alla UI.
import * as repo from './repo.js';
import { createSyncEngine, SYNC_STATUS, COLLECTION_ID, buildRemoteIndex, localKeyOfRemote } from './sync.js';
import { createDriveClient, DriveAuthError, DriveOfflineError, DriveHttpError, findOrCreateAppFolder, findOrCreateDataFolder, moveRootJson, moveFileQuietly } from './drive.js';
import { createGoogleAuth, GoogleSignInError, MSG } from './google.js';
import { buildArtifacts, loadDocx } from './artifacts.js';
import { SYNCABLE_KINDS, APP_ID, SCHEMA_VERSION, EPOCH, resolveDeletions, parseBackup, buildRecordBackup, decideSheet, conflictCopy, sameRecordContent, isGroupId, scopeOf } from './model.js';
import { createGroupsCore, partOfKind, inviteLink as buildInviteLink, pickIds, GroupError, isAccessError, normEmail, GROUP_PARTS } from './groups.js';
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
    beforeUpload,
    targetFor,
    onChange: (e) => { if (e.status) statusMap.set(e.key, e.status); else statusMap.delete(e.key); repo.emit('sync-entry', e); },
  });
  for (const e of await syncStore.all()) statusMap.set(e.key, e.status);
  repo.setSyncHooks({
    onDirty: async (kind, id) => { await engine.markDirty(kind, id); schedule(); },
    onForget: (kind, id) => engine.forget(kind, id),
    // scheda eliminata: i suoi file su Drive vanno nel cestino (anche più tardi, se ora non c'è rete)
    onDelete: async (kind, id, gid) => { await engine.markDeleted(kind, id); if (!gid) await engine.markDirty('deleted', COLLECTION_ID); schedule(); },
    // elemento di un gruppo modificato: il suo file del gruppo va inviato
    onGroupDirty: (gid, kind) => markGroupDirty(gid, kind),
  });
  repo.setIdentity(await repo.getSetting('me', null));
  groupsCache = (await repo.getSetting('groups', [])) || [];
  await refreshState();
  await requeueMigrated();
  window.addEventListener('online', () => { runNow(); if (state.configured && state.folder) auth.preload(); });
  // ricezione automatica: ogni pochi minuti (controllo leggero), al ritorno in primo piano, quando torna la rete
  setInterval(() => { if (navigator.onLine) runNow({ timer: true }); }, Math.max(1000, Math.min(30e3, pullEveryMs() / 2)));
  const onForeground = debounce(() => { if (navigator.onLine && document.visibilityState === 'visible') { dataCheckedAt = 0; runNow(); } }, 400);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') onForeground(); });
  window.addEventListener('focus', onForeground);
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

async function collectionRecord(kind, id = COLLECTION_ID) {
  if (kind === 'deleted') {
    const tombstones = await sheetTombstones();
    const alive = await getRevived();
    const none = SHEET_KINDS.every((k) => !Object.keys(tombstones[k]).length && !Object.keys(alive[k] || {}).length);
    // mai "esempio": va sempre unito con l'indice remoto (così si scoprono le eliminazioni fatte altrove)
    return { kind, id: COLLECTION_ID, tombstones, alive, example: false, placeholder: none };
  }
  const dataKind = kind === 'library' ? 'exercise' : 'player';
  const gid = isGroupId(id) ? id : null; // libreria/rosa personali ('all') o di un gruppo
  const items = (await repo.listScope(dataKind, gid)).sort((a, b) => String(a.name).localeCompare(String(b.name), 'it'));
  const tombstones = await repo.getTombstones(dataKind, gid);
  const noTombs = Object.keys(tombstones).length === 0;
  const rec = { kind, id: gid || COLLECTION_ID, groupId: gid || undefined, tombstones,
    example: items.every((e) => e.example) && noTombs, // solo esempi non toccati: non sovrascrive mai Drive
    placeholder: items.length === 0 && noTombs };
  rec[kind === 'library' ? 'exercises' : 'players'] = items;
  return rec;
}

async function getRecord(kind, id) {
  if (kind === 'library' || kind === 'roster' || kind === 'deleted') return collectionRecord(kind, id);
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
    for (const id of Object.keys(all)) { const rec = await repo.get(k, id); if (rec && !scopeOf(rec)) updated[id] = rec.updatedAt || EPOCH; }
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
  const remoteId = (kind === 'library' || kind === 'roster' || kind === 'deleted') && !isGroupId(rec.id) && ((ctx.known && ctx.known.json) || (ctx.remote && ctx.remote.json));
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

// Un giro alla volta (ricezione + invio): chi chiama durante un giro ne ottiene uno subito dopo
let runCurrent = null;
let runQueued = null;
export function runNow(opts = {}) {
  if (!runCurrent) {
    runCurrent = runOnce(opts).finally(() => { runCurrent = null; });
    return runCurrent;
  }
  if (opts.timer) return runCurrent;
  if (runQueued) { runQueued.force = runQueued.force || !!opts.force; return runQueued.p; }
  const q = { force: !!opts.force };
  q.p = runCurrent.catch(() => {}).then(() => { runQueued = null; return runNow({ force: q.force }); });
  runQueued = q;
  return q.p;
}

async function runOnce({ force = false, timer = false } = {}) {
  if (!engine) return null;
  const prefs = await repo.getSetting('prefs', { autoSync: true }) || { autoSync: true };
  if (!force && prefs.autoSync === false) return null;
  if (!state.configured || !state.folder) return null;
  if (!auth.getValidToken()) {
    // accesso scaduto: niente chiamate, ma l'utente lo vede SEMPRE (invito e indicatore), anche senza nulla da salvare
    const p = await engine.pending();
    state.needsAuth = true;
    state.needsAuthFor = p.length ? 'save' : 'update';
    repo.emit('sync-state', { ...state });
    return null;
  }
  // dal timer: niente chiamate se non c'è nulla da inviare e il controllo è stato fatto da poco
  if (timer && !force && Date.now() - lastPull < pullEveryMs() && !(await engine.pending()).length && !(await anyGroupDirty())) return null;
  state.running = true; repo.emit('sync-state', { ...state });
  try {
    // "File per l'app" (ritrovata o creata) e spostamento dei vecchi .json dalla cartella principale
    try { await prepareDataFolder(); } catch (e) {
      console.warn(e);
      if (e instanceof DriveAuthError) { state.needsAuth = true; return null; }
      return null; // senza la sottocartella non si invia nulla: riprova al prossimo giro
    }
    // ricezione delle modifiche fatte su altri dispositivi (prima di ogni invio: niente sovrascritture all'indietro)
    const waiting = (await engine.pending()).some((e) => SHEET_KINDS.includes(e.kind) && !e.deleted);
    if (Date.now() >= pullBackoffUntil) {
      try {
        await pullFromDrive();
        pullFails = 0;
      } catch (e) {
        console.warn('Ricezione da Drive', e);
        if (e instanceof DriveAuthError) { state.needsAuth = true; state.needsAuthFor = 'update'; return null; }
        if (e instanceof DriveHttpError && (e.status === 403 || e.status === 429)) {
          pullFails++; pullBackoffUntil = Date.now() + Math.min(30 * 60e3, 30e3 * 2 ** (pullFails - 1)); // limiti di Drive: si rallenta
        }
        if (waiting) return null; // senza aver ricevuto non si rischia di sovrascrivere: riprova tra poco
      }
    } else if (waiting) return null;
    // gruppi: si ricevono le modifiche degli altri allenatori e si inviano le proprie (prima dei documenti Word,
    // così quelli scritti da questo allenatore riflettono anche le modifiche ricevute)
    if (activeGroups().length) {
      try { await runGroups(); } catch (e) {
        console.warn('Gruppi', e);
        if (e instanceof DriveAuthError) { state.needsAuth = true; state.needsAuthFor = 'update'; return null; }
      }
    }
    const sum = await engine.processQueue({ force });
    state.needsAuth = !!sum.needsAuth;
    if (sum.needsAuth) state.needsAuthFor = 'save';
    state.lastRun = { at: Date.now(), ...sum };
    if (sum.folderMissing) dataCheckedAt = 0;
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

// Accesso scaduto: un gesto utile (aprire una scheda, "Nuovo allenamento", "Fine allenamento") lo rinnova.
// Va chiamata in modo sincrono nel tocco: la finestra di Google (prompt '') si apre e si chiude da sola.
export function renewInGesture() {
  if (!state.configured || !state.folder || !navigator.onLine || !auth || auth.getValidToken() || !auth.isReady()) return null;
  const p = signIn();
  p.then(() => runNow({ force: true })).catch(() => {});
  return p;
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
    if (a.user && a.user.emailAddress) await setMe(a.user);
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
  for (const g of activeGroups()) if (g.role === 'admin') await engine.markDirty('library', g.id);
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
let dataCheckedAt = 0; // 0 = da cercare: all'avvio, al ritorno in primo piano, o se un invio non trova la cartella
async function prepareDataFolder() {
  const f = await repo.getSetting('drive', null);
  if (!f || !f.folderId) return null;
  // ricerca della sottocartella: all'avvio, ogni 10 minuti e se un invio non la trova (non a ogni giro)
  if (f.dataFolderId && rootJsonChecked && dataCheckedAt) return f.dataFolderId;
  const found = await findOrCreateDataFolder(drive, f.folderId, APP_ID);
  if (f.dataFolderId && f.dataFolderId !== found.id) {
    // un altro telefono l'aveva creata prima: i .json noti vengono portati in quella giusta
    for (const e of await syncStore.all()) if (e.files && e.files.json) await moveFileQuietly(drive, e.files.json, found.id, f.dataFolderId);
    rootJsonChecked = false;
  }
  const dataId = found.id;
  dataCheckedAt = Date.now();
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

// =====================================================================================================
// Ricezione automatica delle modifiche fatte su altri dispositivi dello stesso account
// =====================================================================================================
let lastPull = 0;
let listedVersions = new Map(); // versioni viste nell'ultima files.list (id -> version)
let pullFails = 0;
let pullBackoffUntil = 0;
function pullEveryMs() {
  try { const v = Number(localStorage.getItem('rc.pullEveryMs')); if (v >= 1000) return v; } catch { /* */ }
  return 2 * 60e3;
}
const JSON_MIME = 'application/json';

// file noti di una scheda dalle etichette del suo .json (gli id dei .docx sono elencati lì)
function filesOfRemote(x) {
  const out = { json: x.id };
  for (const [k, v] of Object.entries(x.appProperties || {})) if (k.startsWith('rcF_') && v) out[k.slice(4)] = v;
  return out;
}

// Una sola files.list su "File per l'app" (e sulla cartella principale finché la migrazione non è finita),
// confrontata con la versione nota di ogni file: si scaricano solo i .json cambiati.
async function pullFromDrive() {
  const f = await repo.getSetting('drive', null);
  if (!f || !f.folderId || !f.dataFolderId) return { changes: 0 };
  const lists = await Promise.all([drive.listAppFiles(f.dataFolderId, { mimeType: JSON_MIME }), rootJsonChecked ? [] : drive.listAppFiles(f.folderId, { mimeType: JSON_MIME })]);
  const byKey = new Map();
  listedVersions = new Map();
  for (const x of [...lists[0], ...lists[1]]) {
    if (x.version != null) listedVersions.set(x.id, String(x.version));
    const ap = x.appProperties || {};
    const key = localKeyOfRemote(ap);
    if (key && ap.rcVariant === 'json' && !byKey.has(key)) byKey.set(key, x);
  }
  const entries = new Map((await syncStore.all()).map((e) => [e.key, e]));
  const rank = (k) => (k.startsWith('deleted:') ? 0 : k.startsWith('library:') || k.startsWith('roster:') ? 1 : 2);
  let changes = 0;
  for (const [key, x] of [...byKey].sort((a, b) => rank(a[0]) - rank(b[0]))) {
    const e = entries.get(key);
    const v = x.version != null ? String(x.version) : '';
    if (e && e.deleted) continue; // eliminata qui: i suoi file stanno andando nel cestino
    if (e && e.jsonVersion && e.jsonVersion === v && (!e.files || !e.files.json || e.files.json === x.id)) continue;
    const [kind, id] = key.split(':');
    const files = filesOfRemote(x);
    if (kind === 'deleted') {
      if (await mergeDeletedJson(await drive.download(x.id))) changes++;
      await engine.adopt(kind, id, files, { folderId: f.folderId, jsonVersion: v });
    } else if (kind === 'library' || kind === 'roster') {
      const m = await mergeCollectionJson(kind, await drive.download(x.id));
      await engine.adopt(kind, id, files, { folderId: f.folderId, jsonVersion: v });
      if (m.upserts.length || m.deletes.length) changes++;
      if (m.remoteChanged) await engine.markDirty(kind, id); // qui c'era qualcosa che su Drive manca
    } else if (SHEET_KINDS.includes(kind)) {
      if (await applyRemoteSheet(kind, id, x, e, files, f.folderId)) changes++;
    }
  }
  lastPull = Date.now();
  if (changes) { repo.emit('imported', {}); repo.emit('pulled', { changes }); }
  return { changes };
}

// Una scheda arrivata da Drive (vedi decideSheet): intera, vince la più recente; se modificata da entrambe le parti
// dopo l'ultima versione comune (Drive "version"), la perdente resta come copia "(conflitto del …)".
// Scheda aperta sullo schermo: non si tocca, la pagina riceve la versione nuova e decide (avviso "Aggiorna").
async function applyRemoteSheet(kind, id, x, e, files, folderId) {
  let R;
  try { R = parseBackup(await drive.download(x.id))[0]; } catch (err) {
    if (err instanceof DriveAuthError || err instanceof DriveOfflineError || err instanceof DriveHttpError) throw err;
    console.warn('Scheda su Drive non leggibile', err); return false;
  }
  if (!R || R.kind !== kind || R.id !== id) return false;
  const v = x.version != null ? String(x.version) : '';
  const L = await repo.get(kind, id);
  if (!L && await isTombstoned(kind, R)) {
    // eliminata dopo quella versione, ma i suoi file sono di nuovo visibili (es. un telefono con una versione
    // vecchia dell'app li ha tolti dal cestino): tornano nel cestino
    if (!(e && e.deleted)) { await engine.adopt(kind, id, files, { folderId }); await engine.markDeleted(kind, id); }
    return false;
  }
  if (L && repo.isOpen(kind, id) && !sameRecordContent(L, R)) {
    repo.emit('remote-update', { kind, id, rec: R, version: v, files, folderId });
    return true;
  }
  const knownBase = !!(e && e.jsonVersion);
  const d = decideSheet({ local: L, remote: R, localChanged: !!(e && e.status !== SYNC_STATUS.SYNCED), remoteChanged: !knownBase || e.jsonVersion !== v, knownBase, sameContent: L ? sameRecordContent(L, R) : false });
  switch (d) {
    case 'insert':
    case 'takeRemote':
      await acceptRemote(kind, id, R, v, files, folderId);
      return true;
    case 'keepLocal':
      await engine.adopt(kind, id, files, { folderId, jsonVersion: v });
      await engine.markDirty(kind, id);
      return false;
    case 'conflictRemoteWins':
      await repo.save(conflictCopy(L), { touch: false }); // la versione di questo dispositivo non si perde
      await acceptRemote(kind, id, R, v, files, folderId);
      return true;
    case 'conflictLocalWins':
      await repo.save(conflictCopy(R), { touch: false }); // la versione dell'altro dispositivo non si perde
      await engine.adopt(kind, id, files, { folderId, jsonVersion: v }); // poi questa sostituisce quella su Drive
      return true;
    default:
      if (L && v && (!e || e.jsonVersion !== v)) await engine.adopt(kind, id, files, { folderId, jsonVersion: v });
      return false;
  }
}

// La versione arrivata da Drive diventa quella del dispositivo (senza rimandarla su Drive)
export async function acceptRemote(kind, id, R, version, files, folderId) {
  await repo.save(R, { touch: false, sync: false });
  await engine.adopt(kind, id, files || {}, { folderId, jsonVersion: version, received: true });
  repo.emit('remote-applied', { kind, id });
}
// La pagina aperta ha unito la versione arrivata con le sue modifiche: da qui si riparte da quella versione
export async function noteRemoteVersion(kind, id, version, files) {
  if (engine) await engine.adopt(kind, id, files || {}, { jsonVersion: version });
}
// "Tienila": scheda eliminata su un altro dispositivo, rianimata da qui (stessi file su Drive, escono dal cestino)
export async function reviveRecord(rec, files) {
  if (files && Object.keys(files).length) await engine.adopt(rec.kind, rec.id, files, { pending: true });
  await repo.save(rec);
}

// Prima di caricare una scheda: se su Drive c'è una versione più recente non ancora ricevuta, la si unisce prima.
// Si usa la versione vista nella files.list di questo stesso giro (fatta subito prima degli invii): nessuna
// chiamata in più per scheda.
async function beforeUpload(entry, record, files) {
  if (!SHEET_KINDS.includes(entry.kind) || !entry.jsonVersion || !files.json) return null;
  const v = listedVersions.get(files.json);
  if (!v || v === entry.jsonVersion) return null;
  const folder = await repo.getSetting('drive', null);
  await applyRemoteSheet(entry.kind, entry.id, { id: files.json, version: v, appProperties: {} }, entry, { json: files.json }, folder && folder.folderId);
  const cur = await engine.getStatus(entry.kind, entry.id);
  const rec = await repo.get(entry.kind, entry.id);
  if (!rec || (cur && cur.status === SYNC_STATUS.SYNCED)) return { skip: true };
  return { record: rec, jsonVersion: cur && cur.jsonVersion };
}

// =====================================================================================================
// Gruppi di allenatori (vedi groups.js): stessa ricezione automatica (versione Drive dei file del gruppo,
// unione per elemento, scheda aperta protetta, copie di conflitto)
// =====================================================================================================
let groupsCache = [];            // copia in memoria (lettura sincrona: interfaccia e targetFor)
let groupRunning = null;

export function groupsNow() { return groupsCache.map((g) => ({ ...g })); }
export function activeGroups() { return groupsCache.filter((g) => g.status === 'ok'); }
export function groupById(gid) { return groupsCache.find((g) => g.id === gid) || null; }
export function getMe() { return repo.getIdentity(); }

async function setMe(user) {
  const me = { email: normEmail(user.emailAddress), name: String(user.displayName || '').slice(0, 80) };
  const cur = await repo.getSetting('me', null);
  if (!cur || cur.email !== me.email || cur.name !== me.name) await repo.setSetting('me', me);
  repo.setIdentity(me);
  return me;
}
async function ensureMe() {
  const cur = repo.getIdentity();
  if (cur && cur.email) return cur;
  const a = await drive.about();
  if (!a || !a.user || !a.user.emailAddress) throw new Error('Non riesco a leggere il tuo account Google.');
  return setMe(a.user);
}

async function saveGroups(list) {
  groupsCache = list;
  await repo.setSetting('groups', list);
  repo.emit('groups', groupsNow());
}
async function putGroup(g) {
  const list = groupsCache.filter((x) => x.id !== g.id);
  list.push(g);
  list.sort((a, b) => String(a.name).localeCompare(String(b.name), 'it'));
  await saveGroups(list);
}

async function markGroupDirty(gid, kind) {
  const part = partOfKind(kind);
  if (!part || !groupById(gid)) return;
  const all = (await repo.getSetting('gdirty', {})) || {};
  const g = { ...(all[gid] || {}) };
  g[part] = (g[part] || 0) + 1;
  await repo.setSetting('gdirty', { ...all, [gid]: g });
  repo.emit('group-dirty', { gid, part });
  schedule();
}
async function anyGroupDirty() {
  const all = (await repo.getSetting('gdirty', {})) || {};
  return Object.entries(all).some(([gid, p]) => groupById(gid) && Object.values(p || {}).some(Boolean));
}
// Stato di un elemento del gruppo, in parole semplici
export async function groupStatusLabel(gid, kind) {
  const g = groupById(gid);
  if (!g || g.status !== 'ok') return { text: 'Gruppo non disponibile', cls: 'error', title: '' };
  const all = (await repo.getSetting('gdirty', {})) || {};
  const pending = !!((all[gid] || {})[partOfKind(kind)]);
  return pending ? { text: 'Da inviare al gruppo', cls: 'pending', title: navigator.onLine ? 'Tra pochi secondi' : 'Senza rete: si invia quando torna la connessione' }
    : { text: 'Nel gruppo ✓', cls: 'synced', title: 'Gli altri allenatori del gruppo la vedono' };
}

// versione di ogni elemento vista per l'ultima volta nei file del gruppo (per riconoscere i conflitti)
async function groupBase(gid) { return { ...((((await repo.getSetting('gbase', {})) || {})[gid]) || {}) }; }
async function setGroupBase(gid, upd) {
  const all = (await repo.getSetting('gbase', {})) || {};
  await repo.setSetting('gbase', { ...all, [gid]: { ...(all[gid] || {}), ...upd } });
}

const groupLocal = {
  async items(gid, kinds) { const out = []; for (const k of kinds) out.push(...await repo.listScope(k, gid)); return out; },
  tombs: (gid) => repo.getGroupTombstones(gid),
  log: (gid) => repo.getGroupDeletedLog(gid),
  setLog: (gid, log) => repo.setGroupDeletedLog(gid, log),
  async merge(gid, kinds, items, tombs) {
    const res = { upserts: [], deletes: [], remoteChanged: false };
    const base = await groupBase(gid);
    const baseUpd = {};
    for (const k of kinds) {
      const remote = items.filter((x) => x.kind === k);
      // stessa scheda cambiata qui e da un altro allenatore dopo l'ultima versione comune: la più recente vince,
      // l'altra resta nel gruppo come copia "(conflitto del …)" (schede aperte: unisce la pagina, campo per campo)
      if (SHEET_KINDS.includes(k)) {
        for (const R of remote) {
          const L = await repo.get(k, R.id);
          const b = Date.parse(base[R.id] || 0) || 0;
          if (!L || scopeOf(L) !== gid || repo.isOpen(k, R.id) || !b) continue;
          const tL = Date.parse(L.updatedAt) || 0; const tR = Date.parse(R.updatedAt) || 0;
          if (tL > b && tR > b && !sameRecordContent(L, R)) {
            const loser = tR > tL ? L : { ...R, groupId: gid };
            await repo.save({ ...conflictCopy(loser), groupId: gid }, { touch: false });
          }
        }
      }
      const r = await repo.mergeRemoteCollection(k, remote, (tombs || {})[k] || {}, { scope: gid });
      res.upserts.push(...r.upserts); res.deletes.push(...r.deletes.map((id) => ({ kind: k, id })));
      res.remoteChanged = res.remoteChanged || r.remoteChanged;
      for (const x of r.items) baseUpd[x.id] = x.updatedAt;
    }
    await setGroupBase(gid, baseUpd);
    return res;
  },
  async uploaded(gid, items) { const upd = {}; for (const x of items) upd[x.id] = x.updatedAt; await setGroupBase(gid, upd); },
  async dirtyRev(gid, part) { return ((((await repo.getSetting('gdirty', {})) || {})[gid]) || {})[part] || 0; },
  async clearDirty(gid, part, rev) {
    const all = (await repo.getSetting('gdirty', {})) || {};
    const g = { ...(all[gid] || {}) };
    if (g[part] === rev) { delete g[part]; await repo.setSetting('gdirty', { ...all, [gid]: g }); repo.emit('group-dirty', { gid, part }); }
  },
};
let core = null;
function groupsCore() {
  if (!core) core = createGroupsCore({ drive, local: groupLocal, me: ensureMe });
  return core;
}

// dove vanno i documenti Word di una scheda (vedi createSyncEngine)
async function targetFor(entry, record, folderId) {
  const isColl = entry.kind === 'library' || entry.kind === 'roster' || entry.kind === 'deleted';
  const gid = isColl ? (isGroupId(entry.id) ? entry.id : null) : scopeOf(record);
  if (!gid) return { folderId, docx: true, json: true };
  const g = groupById(gid);
  if (!g || g.status !== 'ok') return { skip: true };
  const me = repo.getIdentity();
  // con drive.file solo chi ha creato un documento lo può aggiornare: il Word di una scheda del gruppo lo scrive
  // chi l'ha creata (anche quando la modifica un collega: lo rigenera quando riceve), la libreria l'amministratore
  const mine = isColl ? g.role === 'admin' : !!(me && record.createdBy && normEmail(record.createdBy.email) === me.email);
  return { folderId: g.folderId, docx: mine && g.canWriteFolder !== false, json: false, keepOthers: !mine };
}

// Un giro su tutti i gruppi. Le modifiche ricevute aggiornano anche i documenti di cui questo allenatore è
// autore e mandano nel cestino quelli degli elementi eliminati.
async function runGroups() {
  if (groupRunning) return groupRunning;
  groupRunning = (async () => {
    const me = await ensureMe();
    let changed = 0;
    for (const g0 of activeGroups()) {
      const g = JSON.parse(JSON.stringify(g0));
      const res = await groupsCore().syncGroup(g);
      g.status = res.status;
      g.lastSync = Date.now();
      if (g.status === 'ok') g.role = normEmail(g.manifest && g.manifest.createdBy && g.manifest.createdBy.email) === me.email ? 'admin' : 'member';
      await putGroup(g);
      const ch = res.changes;
      for (const u of ch.upserts) {
        if (SYNCABLE_KINDS.includes(u.kind) && u.createdBy && normEmail(u.createdBy.email) === me.email) await engine.markDirty(u.kind, u.id);
      }
      for (const d of ch.deletes) if (SYNCABLE_KINDS.includes(d.kind) && (await engine.getStatus(d.kind, d.id))) await engine.markDeleted(d.kind, d.id);
      if (g.role === 'admin' && [...ch.upserts, ...ch.deletes].some((x) => x.kind === 'exercise')) await engine.markDirty('library', g.id);
      changed += ch.upserts.length + ch.deletes.length;
      if (g0.status === 'ok' && g.status !== 'ok') repo.emit('group-lost', { gid: g.id, name: g.name, status: g.status, admin: (g.manifest && g.manifest.createdBy && (g.manifest.createdBy.name || g.manifest.createdBy.email)) || '' });
    }
    if (changed) repo.emit('pulled', { changes: changed });
  })().finally(() => { groupRunning = null; });
  return groupRunning;
}

export function inviteLinkFor(g) { return buildInviteLink(location.origin + location.pathname, g); }

// ----- creare un gruppo (da un gesto: l'accesso a Google parte subito) -----
export async function createGroup({ name, category }) {
  if (!String(name || '').trim()) throw new Error('Scrivi il nome del gruppo.');
  const tok = auth.getValidToken() ? null : signIn();
  if (tok) await tok;
  if (!state.folder) await connectDrive();
  await ensureMe();
  const g = await groupsCore().createGroup({ name, category });
  await putGroup(g);
  return g;
}

// ----- entrare in un gruppo -----
export function preparePicker() { return auth && navigator.onLine ? auth.preloadPicker() : Promise.resolve(false); }
export function pickerReady() { return !!(auth && auth.pickerIsReady()); }
export function groupForInvite(inv) { return groupsCache.find((g) => g.manifestId === inv.manifestId && g.status === 'ok') || null; }

// IMPORTANTE: chiamata in modo sincrono dal tocco (il Picker si apre subito, come l'accesso a Google)
export function joinGroupNow(inv) {
  const picked = auth.pickFilesNow(pickIds(inv));
  return (async () => {
    const ids = await picked;
    if (!ids) return { cancelled: true };
    const need = [inv.manifestId, ...inv.fileIds];
    if (!need.every((id) => ids.includes(id))) throw new GroupError('missingFiles');
    await ensureMe();
    const g = await groupsCore().joinGroup(inv);
    g.status = 'ok';
    await putGroup(g);
    await runGroups();
    runNow({ force: true });
    return { group: g };
  })();
}

async function withGroup(gid, fn) {
  const g0 = groupById(gid);
  if (!g0) throw new Error('Gruppo non trovato.');
  const tok = auth.getValidToken() ? null : signIn();
  if (tok) await tok;
  const g = JSON.parse(JSON.stringify(g0));
  await fn(g);
  await putGroup(g);
  return g;
}
export const closeInvites = (gid) => withGroup(gid, (g) => groupsCore().closeInvites(g));
export const reopenInvites = (gid) => withGroup(gid, (g) => groupsCore().reopenInvites(g));
export async function removeMember(gid, email) {
  let res = null;
  await withGroup(gid, async (g) => { res = await groupsCore().removeMember(g, email); });
  return res;
}
// Gruppo eliminato dall'amministratore (o non più apribile): si tengono gli elementi come personali
export async function keepGroupCopy(gid) {
  let n = 0;
  for (const kinds of Object.values(GROUP_PARTS)) for (const k of kinds) for (const r of await repo.listScope(k, gid)) {
    delete r.groupId; delete r.createdBy; delete r.updatedBy;
    await repo.save(r); n++;
  }
  await forgetGroupLocally(gid);
  return n;
}
export const inviteByEmail = (gid, email) => withGroup(gid, (g) => groupsCore().addByEmail(g, email));
export async function refreshGroupsNow() {
  const tok = auth.getValidToken() ? null : signIn();
  if (tok) await tok;
  await runGroups();
  return runNow({ force: true });
}

// Esce dal gruppo: il proprio nome viene tolto; gli elementi del gruppo spariscono da questo dispositivo
// (restano agli altri allenatori e su Drive). I dati personali non cambiano.
export async function leaveGroup(gid) {
  const g = groupById(gid);
  if (!g) return;
  const tok = g.status === 'ok' && !auth.getValidToken() ? signIn() : null;
  if (tok) await tok;
  if (g.status === 'ok') await groupsCore().leaveGroup(JSON.parse(JSON.stringify(g)));
  await forgetGroupLocally(gid);
}
export async function forgetGroupLocally(gid) {
  for (const kinds of Object.values(GROUP_PARTS)) for (const k of kinds) for (const r of await repo.listScope(k, gid)) await repo.removeLocalOnly(k, r.id);
  await engine.forget('library', gid);
  for (const key of ['gtombs', 'gdirty', 'gbase', 'gdellog']) { const v = (await repo.getSetting(key, {})) || {}; delete v[gid]; await repo.setSetting(key, v); }
  const prefs = (await repo.getSetting('prefs', {})) || {};
  if (prefs.scope === gid) { const { scope, ...rest } = prefs; await repo.setSetting('prefs', rest); }
  await saveGroups(groupsCache.filter((x) => x.id !== gid));
  repo.emit('imported', {});
}

// Sposta un elemento tra Personale e un gruppo
export async function moveRecord(kind, id, gid) {
  if (gid && !(repo.getIdentity() && repo.getIdentity().email) && auth.getValidToken()) await ensureMe();
  return repo.moveTo(kind, id, gid);
}

export function groupErrorMessage(e, adminName) {
  const who = adminName ? adminName : 'chi ha creato il gruppo';
  if (e instanceof GroupError) {
    if (e.code === 'noAccess') return `Non riesco ad aprire il gruppo: gli inviti sono chiusi o il link non è più valido. Chiedi a ${who} di invitarti con la tua email Gmail, poi riapri il link.`;
    if (e.code === 'missingFiles') return `Servono tutti i file del gruppo: riapri la finestra di Google, selezionali tutti e tocca «Seleziona». Se non li vedi, chiedi a ${who} di invitarti con la tua email Gmail.`;
    if (e.code === 'notGroup') return 'Questo link non è un invito valido a un gruppo di Rugby Coach.';
    if (e.code === 'removedMember') return `Sei stato tolto da questo gruppo: per rientrare chiedi a ${who} di invitarti di nuovo con la tua email Gmail.`;
    return e.message;
  }
  if (isAccessError(e)) return groupErrorMessage(new GroupError('noAccess'), adminName);
  return friendlyError(e);
}
