// Accesso ai dati: CRUD dei record, impostazioni, export/import, seed. Emette eventi su `bus`.
import { openDB } from './db.js';
import { STORE_OF_KIND, SYNCABLE_KINDS, COLLECTION_OF_KIND, nowISO, buildBackup, parseBackup, mergeDecision, migrateRecord, mergeCollection, SCHEMA_VERSION } from './model.js';
import { buildSeed } from './seed.js';

export const bus = new EventTarget();
export const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));

let db = null;
let dirtyHook = null;
let forgetHook = null;
let deleteHook = null;

// copia in memoria delle impostazioni (lettura sincrona per le pagine che devono comparire subito)
const settingsCache = new Map();

export async function initRepo(idb) {
  db = await openDB(idb);
  try { for (const r of await db.getAll('settings')) settingsCache.set(r.key, r.value); } catch { /* facoltativo */ }
  return db;
}
export function peekSetting(key, def = null) { return settingsCache.has(key) ? settingsCache.get(key) : def; }
export function getDB() { return db; }
export function setSyncHooks({ onDirty, onForget, onDelete }) { dirtyHook = onDirty; forgetHook = onForget; deleteHook = onDelete; }

export async function list(kind) {
  const all = await db.getAll(STORE_OF_KIND[kind]);
  return all;
}

export async function get(kind, id) {
  const r = await db.get(STORE_OF_KIND[kind], id);
  if (r && r.schemaVersion !== SCHEMA_VERSION) return migrateRecord(r);
  return r;
}

export async function save(rec, { touch = true, sync = true } = {}) {
  if (touch) rec.updatedAt = nowISO();
  await db.put(STORE_OF_KIND[rec.kind], rec);
  emit('saved', { kind: rec.kind, id: rec.id, rec });
  if (sync && dirtyHook) {
    if (SYNCABLE_KINDS.includes(rec.kind)) await dirtyHook(rec.kind, rec.id);
    else if (COLLECTION_OF_KIND[rec.kind]) await dirtyHook(COLLECTION_OF_KIND[rec.kind], 'all');
  }
  return rec;
}

// Tombstone delle raccolte: { exercise: { id: deletedAt }, player: { ... } } — servono a propagare le cancellazioni
export async function getTombstones(kind) {
  const all = (await getSetting('tombstones', {})) || {};
  return { ...(all[kind] || {}) };
}
export async function setTombstones(kind, tombs) {
  const all = (await getSetting('tombstones', {})) || {};
  await setSetting('tombstones', { ...all, [kind]: tombs });
}

// Elimina dal telefono e (se collegato) da Google Drive: le schede vanno nella coda di eliminazione (i loro file
// finiranno nel cestino di Drive) e ricevono una tombstone, così non "resuscitano" dal recupero su altri telefoni.
// Esercizi e giocatori: tombstone + la raccolta (libreria / rosa) viene rigenerata senza l'elemento.
export async function remove(kind, id) {
  await db.delete(STORE_OF_KIND[kind], id);
  if (COLLECTION_OF_KIND[kind] || SYNCABLE_KINDS.includes(kind)) await setTombstones(kind, { ...(await getTombstones(kind)), [id]: nowISO() });
  if (SYNCABLE_KINDS.includes(kind)) {
    if (deleteHook) await deleteHook(kind, id);
    else if (forgetHook) await forgetHook(kind, id);
  }
  if (dirtyHook && COLLECTION_OF_KIND[kind]) await dirtyHook(COLLECTION_OF_KIND[kind], 'all');
  emit('removed', { kind, id });
}

// Eliminazione arrivata da un altro telefono (tombstone remota): solo in locale, senza rimettere nulla in coda
export async function removeLocalOnly(kind, id) {
  await db.delete(STORE_OF_KIND[kind], id);
  if (forgetHook && SYNCABLE_KINDS.includes(kind)) await forgetHook(kind, id);
  emit('removed', { kind, id, remote: true });
}

// Schede aperte sullo schermo in questo momento: la ricezione da Drive non le tocca, avvisa la pagina
const openRecs = new Map();
export function setOpen(kind, id, on) {
  const k = kind + ':' + id;
  const n = (openRecs.get(k) || 0) + (on ? 1 : -1);
  if (n > 0) openRecs.set(k, n); else openRecs.delete(k);
}
export function isOpen(kind, id) { return openRecs.has(kind + ':' + id); }

export async function getSetting(key, def = null) {
  const r = await db.get('settings', key);
  if (r) settingsCache.set(key, r.value);
  return r ? r.value : def;
}

export async function setSetting(key, value) {
  await db.put('settings', { key, value });
  settingsCache.set(key, value);
  emit('settings', { key, value });
}

export async function exportAll() {
  const data = {};
  for (const [kind, store] of Object.entries(STORE_OF_KIND)) data[store] = await list(kind);
  return buildBackup(data);
}

// Unisce un backup: per ogni scheda vince la modifica più recente.
// sync: false -> non rimette in coda (usato dal ripristino da Drive, che "adotta" i file esistenti).
export async function importBackup(json, { sync = true } = {}) {
  const recs = parseBackup(json);
  const res = { inserted: 0, updated: 0, skipped: 0, items: [] };
  for (const r of recs) {
    const existing = await db.get(STORE_OF_KIND[r.kind], r.id);
    const d = mergeDecision(existing, r);
    const localNewer = d === 'skip' && existing && (Date.parse(existing.updatedAt || 0) || 0) > (Date.parse(r.updatedAt || 0) || 0);
    res.items.push({ kind: r.kind, id: r.id, decision: d, localNewer });
    if (d === 'skip') { res.skipped++; continue; }
    await save(r, { touch: false, sync });
    res[d === 'insert' ? 'inserted' : 'updated']++;
  }
  emit('imported', res);
  return res;
}

// Unisce una raccolta remota (libreria o rosa) con quella locale e applica il risultato in locale
// (senza rimettere in coda). Restituisce l'esito di mergeCollection.
export async function mergeRemoteCollection(kind, remoteItems, remoteTombs) {
  const store = STORE_OF_KIND[kind];
  const local = await db.getAll(store);
  const res = mergeCollection({ local, localTombs: await getTombstones(kind), remote: remoteItems.map((r) => migrateRecord({ kind, ...r })), remoteTombs });
  if (res.upserts.length) await db.putMany(store, res.upserts);
  if (res.deletes.length) await db.deleteMany(store, res.deletes);
  await setTombstones(kind, res.tombs);
  // un elemento aperto sullo schermo (es. un esercizio) viene avvisato
  for (const u of res.upserts) emit('remote-update', { kind, id: u.id, rec: u, collection: true });
  for (const id of res.deletes) emit('removed', { kind, id, remote: true });
  if (res.upserts.length || res.deletes.length) emit('imported', { kind, upserts: res.upserts.length, deletes: res.deletes.length });
  return res;
}

export async function seedIfNeeded() {
  const meta = await getSetting('meta', {});
  if (meta.seeded) return false;
  const { exercises, plans } = buildSeed();
  await db.putMany('exercises', exercises);
  await db.putMany('plans', plans);
  await setSetting('meta', { ...meta, seeded: true, seededAt: nowISO() });
  return true;
}

// Reinserisce solo gli esempi mancanti (stessi id stabili): non tocca quelli modificati dall'utente
export async function reloadExamples() {
  const { exercises, plans } = buildSeed();
  const missing = async (store, list) => { const out = []; for (const r of list) if (!(await db.get(store, r.id))) out.push(r); return out; };
  await db.putMany('exercises', await missing('exercises', exercises));
  await db.putMany('plans', await missing('plans', plans));
  emit('imported', {});
}

export async function deleteExamples() {
  let n = 0;
  for (const kind of Object.keys(STORE_OF_KIND)) {
    const items = (await list(kind)).filter((r) => r.example);
    for (const r of items) { await remove(kind, r.id); n++; }
  }
  return n;
}

export async function countExamples() {
  let n = 0;
  for (const kind of Object.keys(STORE_OF_KIND)) n += (await list(kind)).filter((r) => r.example).length;
  return n;
}

export async function wipeAll() {
  for (const s of [...Object.values(STORE_OF_KIND), 'sync']) await db.clear(s);
  await setSetting('tombstones', {});
  const meta = await getSetting('meta', {});
  await setSetting('meta', { ...meta, seeded: true });
}
