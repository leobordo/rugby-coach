// Accesso ai dati: CRUD dei record, impostazioni, export/import, seed. Emette eventi su `bus`.
import { openDB } from './db.js';
import { STORE_OF_KIND, SYNCABLE_KINDS, COLLECTION_OF_KIND, nowISO, buildBackup, parseBackup, mergeDecision, migrateRecord, mergeCollection, SCHEMA_VERSION, scopeOf, isGroupId, recordTitle, isEmptySession } from './model.js';
import { buildSeed } from './seed.js';

export const bus = new EventTarget();
export const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));

let db = null;
let dirtyHook = null;
let forgetHook = null;
let deleteHook = null;
let groupHook = null;
let identity = null; // { email, name } dell'allenatore: "di <nome>" negli elementi dei gruppi

// copia in memoria delle impostazioni (lettura sincrona per le pagine che devono comparire subito)
const settingsCache = new Map();

export async function initRepo(idb) {
  db = await openDB(idb);
  try { for (const r of await db.getAll('settings')) settingsCache.set(r.key, r.value); } catch { /* facoltativo */ }
  return db;
}
export function peekSetting(key, def = null) { return settingsCache.has(key) ? settingsCache.get(key) : def; }
export function getDB() { return db; }
export function setSyncHooks({ onDirty, onForget, onDelete, onGroupDirty }) { dirtyHook = onDirty; forgetHook = onForget; deleteHook = onDelete; groupHook = onGroupDirty || null; }
export function setIdentity(me) { identity = me && me.email ? { email: String(me.email).toLowerCase(), name: String(me.name || '').slice(0, 80) } : null; }
export function getIdentity() { return identity; }

export async function list(kind) {
  const all = await db.getAll(STORE_OF_KIND[kind]);
  return all;
}

// Allenamento appena creato e ancora vuoto: resta solo in memoria (niente elenco, niente Drive) finché
// l'utente non inserisce qualcosa; se si esce dalla pagina prima, sparisce senza lasciare traccia.
const drafts = new Map(); // id -> record aperto sullo schermo
const draftIds = new Set(); // id nati vuoti e mai salvati (resta anche dopo lo scarto: un salvataggio vuoto in ritardo si ignora)
export function startDraft(rec) { drafts.set(rec.id, rec); draftIds.add(rec.id); return rec; }
export function isDraft(kind, id) { return kind === 'session' && draftIds.has(id); }

export async function get(kind, id) {
  if (kind === 'session' && drafts.has(id)) return drafts.get(id);
  const r = await db.get(STORE_OF_KIND[kind], id);
  if (r && r.schemaVersion !== SCHEMA_VERSION) return migrateRecord(r);
  return r;
}

export async function save(rec, { touch = true, sync = true } = {}) {
  if (isDraft(rec.kind, rec.id)) {
    if (isEmptySession(rec)) return rec;
    drafts.delete(rec.id); draftIds.delete(rec.id); // primo contenuto: da qui in poi è una scheda come le altre
  }
  const gid = scopeOf(rec);
  if (!gid && 'groupId' in rec) delete rec.groupId;
  if (touch) {
    rec.updatedAt = nowISO();
    // negli elementi di un gruppo si ricorda chi li ha creati e chi li ha modificati per ultimo
    if (gid && identity) { rec.updatedBy = { ...identity }; if (!rec.createdBy) rec.createdBy = { ...identity }; }
  }
  await db.put(STORE_OF_KIND[rec.kind], rec);
  emit('saved', { kind: rec.kind, id: rec.id, rec });
  if (sync) await afterChange(rec.kind, rec.id, gid);
  return rec;
}

async function afterChange(kind, id, gid) {
  if (gid && groupHook) await groupHook(gid, kind);
  if (!dirtyHook) return;
  if (SYNCABLE_KINDS.includes(kind)) await dirtyHook(kind, id);
  else if (COLLECTION_OF_KIND[kind]) await dirtyHook(COLLECTION_OF_KIND[kind], gid || 'all');
}

// Elementi di un ambito: null = personali, altrimenti quelli del gruppo
export async function listScope(kind, gid = null) {
  return (await list(kind)).filter((r) => scopeOf(r) === (gid || null));
}

// Sposta un elemento tra "Personale" e un gruppo (o tra gruppi). Nel vecchio ambito resta una tombstone,
// così sugli altri dispositivi / per gli altri allenatori sparisce da lì; nel nuovo arriva come modifica recente.
export async function moveTo(kind, id, gid) {
  const rec = await get(kind, id);
  if (!rec) return null;
  const from = scopeOf(rec);
  const to = isGroupId(gid) ? gid : null;
  if (from === to) return rec;
  if (isDraft(kind, id)) { if (to) rec.groupId = to; else delete rec.groupId; return save(rec); } // mai salvata: niente da togliere altrove
  await setTombstones(kind, { ...(await getTombstones(kind, from)), [id]: nowISO() }, from);
  if (from) await logGroupDeletion(from, rec, 'moved');
  if (to) { rec.groupId = to; if (identity) rec.createdBy = { ...identity }; } else { delete rec.groupId; delete rec.createdBy; delete rec.updatedBy; }
  if (to) { const t = await getTombstones(kind, to); if (t[id]) { delete t[id]; await setTombstones(kind, t, to); } }
  await new Promise((r) => setTimeout(r, 3)); // la modifica è sempre più recente della tombstone appena scritta
  await save(rec);
  if (from && groupHook) await groupHook(from, kind);
  if (dirtyHook) {
    if (COLLECTION_OF_KIND[kind]) await dirtyHook(COLLECTION_OF_KIND[kind], from || 'all');
    if (SYNCABLE_KINDS.includes(kind) && !from) await dirtyHook('deleted', 'all');
  }
  emit('moved', { kind, id, from, to });
  return rec;
}

// "Cestino" del gruppo: chi ha eliminato cosa e quando (viaggia nei file del gruppo)
async function logGroupDeletion(gid, rec, how = 'deleted') {
  const all = (await getSetting('gdellog', {})) || {};
  const log = { ...(all[gid] || {}) };
  log[rec.id] = { kind: rec.kind, title: String(recordTitle(rec) || '').slice(0, 120), date: rec.date || '', by: identity ? { ...identity } : null, at: nowISO(), how };
  await setSetting('gdellog', { ...all, [gid]: log });
}
export async function getGroupDeletedLog(gid) { return { ...((((await getSetting('gdellog', {})) || {})[gid]) || {}) }; }
export async function setGroupDeletedLog(gid, log) { const all = (await getSetting('gdellog', {})) || {}; await setSetting('gdellog', { ...all, [gid]: log }); }

// Tombstone: { id: deletedAt } per tipo. Personali in 'tombstones'; dei gruppi in 'gtombs' { gid: { kind: {...} } }
export async function getTombstones(kind, gid = null) {
  if (gid) { const all = (await getSetting('gtombs', {})) || {}; return { ...((all[gid] || {})[kind] || {}) }; }
  const all = (await getSetting('tombstones', {})) || {};
  return { ...(all[kind] || {}) };
}
export async function setTombstones(kind, tombs, gid = null) {
  if (gid) {
    const all = (await getSetting('gtombs', {})) || {};
    await setSetting('gtombs', { ...all, [gid]: { ...(all[gid] || {}), [kind]: tombs } });
    return;
  }
  const all = (await getSetting('tombstones', {})) || {};
  await setSetting('tombstones', { ...all, [kind]: tombs });
}
export async function getGroupTombstones(gid) { return { ...(((await getSetting('gtombs', {})) || {})[gid] || {}) }; }

// Elimina dal telefono e (se collegato) da Google Drive: le schede vanno nella coda di eliminazione (i loro file
// finiranno nel cestino di Drive) e ricevono una tombstone, così non "resuscitano" dal recupero su altri telefoni.
// Esercizi e giocatori: tombstone + la raccolta (libreria / rosa) viene rigenerata senza l'elemento.
// Elementi di un gruppo: la tombstone va nei file del gruppo (gli altri allenatori lo vedono sparire).
export async function remove(kind, id) {
  const rec = await db.get(STORE_OF_KIND[kind], id);
  const gid = scopeOf(rec);
  await db.delete(STORE_OF_KIND[kind], id);
  if (COLLECTION_OF_KIND[kind] || SYNCABLE_KINDS.includes(kind)) await setTombstones(kind, { ...(await getTombstones(kind, gid)), [id]: nowISO() }, gid);
  if (gid && rec) await logGroupDeletion(gid, rec);
  if (SYNCABLE_KINDS.includes(kind)) {
    if (deleteHook) await deleteHook(kind, id, gid);
    else if (forgetHook) await forgetHook(kind, id);
  }
  if (dirtyHook && COLLECTION_OF_KIND[kind]) await dirtyHook(COLLECTION_OF_KIND[kind], gid || 'all');
  if (gid && groupHook) await groupHook(gid, kind);
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
  if (n > 0) openRecs.set(k, n); else { openRecs.delete(k); if (kind === 'session') drafts.delete(id); }
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

// Unisce elementi remoti di un ambito (personale: libreria o rosa; gruppo: uno dei suoi file dati) con quelli
// locali e applica il risultato in locale (senza rimettere in coda). Gli elementi locali di ALTRI ambiti non
// vengono mai cancellati da qui; se hanno lo stesso id di un elemento remoto vince la modifica più recente.
export async function mergeRemoteCollection(kind, remoteItems, remoteTombs, { scope = null } = {}) {
  const store = STORE_OF_KIND[kind];
  const all = await db.getAll(store);
  const remote = remoteItems.map((r) => migrateRecord({ ...r, kind }));
  const remoteIds = new Set(remote.map((r) => r.id));
  const inScope = (r) => scopeOf(r) === (scope || null);
  const local = all.filter((r) => inScope(r) || remoteIds.has(r.id));
  const res = mergeCollection({ local, localTombs: await getTombstones(kind, scope), remote, remoteTombs: remoteTombs || {} });
  const outScope = new Set(all.filter((r) => !inScope(r)).map((r) => r.id));
  res.deletes = res.deletes.filter((id) => !outScope.has(id));
  for (const u of res.upserts) { if (scope) u.groupId = scope; else if (scopeOf(u)) delete u.groupId; }
  if (res.upserts.length) await db.putMany(store, res.upserts);
  if (res.deletes.length) await db.deleteMany(store, res.deletes);
  await setTombstones(kind, res.tombs, scope);
  // un elemento aperto sullo schermo viene avvisato (la pagina non perde quello che si sta scrivendo)
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
  await setSetting('gtombs', {});
  const meta = await getSetting('meta', {});
  await setSetting('meta', { ...meta, seeded: true });
}
