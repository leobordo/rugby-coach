// Gruppi di allenatori ("Squadra U12"): cartella Drive condivisa + un INSIEME FISSO di file dati.
//
// Con lo scope drive.file l'app vede solo i file creati da lei per quell'utente o scelti con Google Picker.
// Per questo i dati condivisi stanno in 5 file creati una volta sola alla creazione del gruppo, nella
// sottocartella "File per l'app" della cartella del gruppo: gruppo.json (manifest), libreria.json, piani.json,
// schede.json (sedute e partite), rosa.json. Tutti i membri modificano GLI STESSI file (chi entra li seleziona
// una volta col Picker). Unione per elemento (id, updatedAt, tombstone: vince l'evento più recente) e controllo
// della versione Drive prima di ogni PATCH. Le eliminazioni viaggiano dentro gli stessi file (tombstone + chi e
// quando: il "cestino" del gruppo).
//
// Modulo puro: Drive e archivio locale sono iniettati (test in Node con un Drive finto multi-utente).
import { APP_ID, SCHEMA_VERSION, uid } from './model.js';
import { DriveHttpError } from './drive.js';

export const GROUP_PARTS = { library: ['exercise'], plans: ['plan'], sheets: ['session', 'match'], roster: ['player'] };
export const PART_FILE_NAMES = { manifest: 'gruppo.json', library: 'libreria.json', plans: 'piani.json', sheets: 'schede.json', roster: 'rosa.json' };
export const DATA_FOLDER_NAME = 'File per l\'app';
export const PART_ORDER = ['library', 'plans', 'sheets', 'roster'];
const JSON_MIME = 'application/json';

export function partOfKind(kind) {
  for (const [p, kinds] of Object.entries(GROUP_PARTS)) if (kinds.includes(kind)) return p;
  return null;
}
export const groupFolderName = (name) => 'Rugby Coach – ' + (String(name || '').trim() || 'Gruppo');
export const normEmail = (e) => String(e || '').trim().toLowerCase();
export const validEmail = (e) => /^[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+\.[^\s@<>"'(),;:]+$/.test(normEmail(e));

export class GroupError extends Error {
  // code: noAccess (file del gruppo non apribili: inviti chiusi, link sbagliato o permesso tolto),
  //       notGroup (link non valido), missingFiles (non tutti i file selezionati), conflict, badEmail,
  //       removedMember (tolto dall'amministratore: rientra solo con un nuovo invito per email)
  constructor(code, msg) { super(msg || code); this.name = 'GroupError'; this.code = code; }
}

const ts = (v) => Date.parse(v || 0) || 0;
const nowISO = () => new Date().toISOString();
const clip = (s, n) => String(s == null ? '' : s).slice(0, n);

// ---------- link di invito ----------
export function inviteLink(base, g) {
  const p = new URLSearchParams({
    g: g.manifestId,
    f: PART_ORDER.map((k) => g.files[k]).join(','),
    d: g.dataFolderId || '', c: g.folderId || '', n: g.name || '',
    a: (g.manifest && g.manifest.createdBy && (g.manifest.createdBy.name || g.manifest.createdBy.email)) || '',
  });
  return String(base).replace(/#.*$/, '') + '#/unisciti?' + p.toString();
}
const ID_RE = /^[A-Za-z0-9_-]{2,200}$/;
export function parseInvite(query) {
  const get = (k) => String((query && (query.get ? query.get(k) : query[k])) || '').trim();
  const manifestId = get('g');
  const fileIds = get('f').split(',').map((x) => x.trim()).filter(Boolean);
  const dataFolderId = get('d') || null;
  const folderId = get('c') || null;
  if (!ID_RE.test(manifestId) || fileIds.length !== 4 || !fileIds.every((x) => ID_RE.test(x))) return null;
  if ((dataFolderId && !ID_RE.test(dataFolderId)) || (folderId && !ID_RE.test(folderId))) return null;
  return { manifestId, fileIds, dataFolderId, folderId, name: clip(get('n'), 60), admin: clip(get('a'), 80) };
}
// tutti gli id da selezionare nel Picker: manifest, file dati e le due cartelle (per poter scrivere i documenti)
export const pickIds = (inv) => [inv.manifestId, ...inv.fileIds, inv.dataFolderId, inv.folderId].filter(Boolean);

// ---------- manifest ----------
export function newManifest({ gid, name, category, me, folderId, dataFolderId, files, at = nowISO() }) {
  return {
    app: APP_ID, type: 'group', schemaVersion: SCHEMA_VERSION,
    groupId: gid, name: clip(String(name || '').trim(), 60), category: clip(String(category || '').trim(), 20),
    folderId, dataFolderId, files: { ...files },
    createdBy: { email: normEmail(me.email), name: clip(me.name, 80) }, createdAt: at, updatedAt: at,
    members: [{ email: normEmail(me.email), name: clip(me.name, 80), joinedAt: at, role: 'admin' }],
    removed: [], invited: [],
    invites: 'open', invitesAt: at,
  };
}

export function parseManifest(txt) {
  const m = typeof txt === 'string' ? JSON.parse(txt) : txt;
  if (!m || m.app !== APP_ID || m.type !== 'group' || !m.groupId || !m.files) throw new GroupError('notGroup', 'Questo non è un gruppo di Rugby Coach.');
  m.members = Array.isArray(m.members) ? m.members : [];
  m.removed = Array.isArray(m.removed) ? m.removed : [];
  m.invited = Array.isArray(m.invited) ? m.invited : [];
  return m;
}

// Membri effettivi: chi è entrato e non è stato rimosso (o non è uscito) DOPO l'ingresso
export function activeMembers(m) {
  const rem = new Map((m.removed || []).map((r) => [normEmail(r.email), r.at]));
  return (m.members || []).filter((x) => !(rem.has(normEmail(x.email)) && ts(rem.get(normEmail(x.email))) >= ts(x.joinedAt)));
}
export const isMember = (m, email) => activeMembers(m).some((x) => normEmail(x.email) === normEmail(email));
// tolto dal gruppo e non più invitato per email DOPO la rimozione (o uscito da solo: può rientrare col link)
export function isBanned(m, email) {
  const e = normEmail(email);
  const r = (m.removed || []).find((x) => normEmail(x.email) === e);
  if (!r || r.left) return false;
  const inv = (m.invited || []).find((x) => normEmail(x.email) === e);
  return !(inv && ts(inv.at) > ts(r.at));
}
export const isAdmin = (m, email) => !!m && normEmail(m.createdBy && m.createdBy.email) === normEmail(email);

// Unione di due versioni del manifest (ingressi contemporanei di più allenatori non si perdono)
export function mergeManifest(a, b) {
  if (!a) return b; if (!b) return a;
  const byEmail = (list, pick) => {
    const map = new Map();
    for (const x of list) {
      const k = normEmail(x && x.email); if (!k) continue;
      const cur = map.get(k);
      map.set(k, cur ? pick(cur, x) : { ...x, email: k });
    }
    return [...map.values()];
  };
  const newer = ts(b.updatedAt) > ts(a.updatedAt) ? b : a;
  const inv = ts(b.invitesAt) > ts(a.invitesAt) ? b : a;
  return {
    ...newer,
    members: byEmail([...(a.members || []), ...(b.members || [])], (x, y) => (ts(y.joinedAt) > ts(x.joinedAt) ? { ...x, ...y, email: x.email } : x)),
    removed: byEmail([...(a.removed || []), ...(b.removed || [])], (x, y) => (ts(y.at) > ts(x.at) ? { ...y, email: x.email } : x)),
    invited: byEmail([...(a.invited || []), ...(b.invited || [])], (x, y) => (ts(y.at) > ts(x.at) ? { ...y, email: x.email } : x)),
    invites: inv.invites, invitesAt: inv.invitesAt,
    updatedAt: ts(b.updatedAt) > ts(a.updatedAt) ? b.updatedAt : a.updatedAt,
  };
}

// ---------- file dati ----------
// deletedLog: { id: { kind, title, by: { email, name }, at } } — chi ha eliminato cosa (cestino del gruppo)
export function buildPartPayload(gid, part, items, tombstones, deletedLog = {}) {
  const kinds = GROUP_PARTS[part];
  const tombs = {};
  for (const k of kinds) tombs[k] = { ...((tombstones && tombstones[k]) || {}) };
  const log = {};
  for (const [id, x] of Object.entries(deletedLog || {})) if (x && kinds.includes(x.kind)) log[id] = x;
  return { app: APP_ID, type: 'group-data', part, groupId: gid, schemaVersion: SCHEMA_VERSION, exportedAt: nowISO(),
    items: items.map((r) => ({ ...r })), tombstones: tombs, deleted: log };
}
export function parsePart(txt, part, gid) {
  if (!txt || !String(txt).trim()) return { items: [], tombstones: {}, deleted: {} };
  const o = JSON.parse(txt);
  if (!o || o.app !== APP_ID || o.type !== 'group-data') throw new GroupError('notGroup', 'File del gruppo non valido.');
  const kinds = GROUP_PARTS[part];
  // ogni elemento appartiene a questo gruppo, qualunque cosa dica il file
  return {
    items: (o.items || []).filter((r) => r && kinds.includes(r.kind) && r.id).map((r) => ({ ...r, groupId: gid })),
    tombstones: o.tombstones || {},
    deleted: o.deleted && typeof o.deleted === 'object' ? o.deleted : {},
  };
}
export function mergeDeletedLog(a = {}, b = {}) {
  const out = { ...a };
  for (const [id, x] of Object.entries(b || {})) if (x && (!out[id] || ts(x.at) > ts(out[id].at))) out[id] = x;
  return out;
}

// Novità da segnalare ai compagni: esercizi e piani arrivati dal gruppo che su questo telefono non c'erano,
// aggiunti da un altro allenatore (non le modifiche, non quelli creati da me anche su un altro dispositivo)
export const NOTIFY_KINDS = ['exercise', 'plan'];
export function groupArrivals({ upserts = [], knownIds, myEmail }) {
  const me = normEmail(myEmail);
  return upserts.filter((r) => {
    if (!r || !NOTIFY_KINDS.includes(r.kind) || (knownIds && knownIds.has(r.id))) return false;
    const by = r.createdBy || r.updatedBy;
    return !!(by && by.email) && normEmail(by.email) !== me;
  });
}

// Testo dell'avviso: { name, items: [{ kind, title, by }] }
export function groupNewsText({ name = '', items = [] } = {}) {
  const where = name ? ` nel gruppo "${name}"` : ' nel gruppo';
  if (items.length === 1) {
    const x = items[0];
    const what = x.kind === 'plan' ? 'il piano' : 'l\'esercizio';
    return `${x.by || 'Un allenatore'} ha aggiunto ${what} "${x.title || ''}"${where}`;
  }
  const n = (k) => items.filter((x) => x.kind === k).length;
  const parts = [];
  if (n('exercise')) parts.push(n('exercise') === 1 ? '1 esercizio' : `${n('exercise')} esercizi`);
  if (n('plan')) parts.push(n('plan') === 1 ? '1 piano' : `${n('plan')} piani`);
  return `Novità${where}: ${parts.join(' e ')}`;
}

export const isAccessError = (e) => (e instanceof DriveHttpError && (e.status === 403 || e.status === 404)) || (e instanceof GroupError && e.code === 'noAccess');

/**
 * local: archivio locale dell'utente (iniettato)
 *   items(gid, kinds) -> record del gruppo
 *   tombs(gid) -> { kind: { id: deletedAt } }
 *   merge(gid, kinds, remoteItems, remoteTombs, { first, name }) -> { upserts:[rec], deletes:[{kind,id}], remoteChanged }
 *     (first = prima ricezione di quel file dopo l'ingresso: le novità non si segnalano)
 *   log(gid) -> deletedLog; setLog(gid, log)
 *   dirtyRev(gid, part) -> numero (0 = niente da inviare); clearDirty(gid, part, rev)
 * me(): { email, name }
 */
export function createGroupsCore({ drive, local, me, now = nowISO }) {
  async function uploadJson({ fileId, name, parent, data, props }) {
    const appProperties = { rcApp: APP_ID, rcKind: 'groupData', ...props };
    return drive.uploadFile({ fileId, name, mimeType: JSON_MIME, parents: parent ? [parent] : undefined, appProperties, data: JSON.stringify(data, null, 2) });
  }

  // Crea cartella (nella radice del Drive), sottocartella "File per l'app", i 5 file e il permesso
  // "chiunque abbia il link può modificare" sulla cartella (ereditato dai file)
  async function createGroup({ name, category }) {
    const who = await me();
    const gid = 'g_' + uid().replace(/[^A-Za-z0-9]/g, '').slice(0, 20);
    const folder = await drive.createFolder(groupFolderName(name), { appProperties: { rcApp: APP_ID, rcKind: 'groupFolder', rcGroup: gid } });
    const dataFolder = await drive.createFolder(DATA_FOLDER_NAME, { parentId: folder.id, appProperties: { rcApp: APP_ID, rcKind: 'groupDataFolder', rcGroup: gid } });
    const files = {};
    const seen = {};
    for (const part of PART_ORDER) {
      const f = await uploadJson({ name: PART_FILE_NAMES[part], parent: dataFolder.id, data: buildPartPayload(gid, part, [], {}), props: { rcGroup: gid, rcPart: part } });
      files[part] = f.id;
      seen[part] = f.version != null ? String(f.version) : null;
    }
    const at = now();
    const manifest = newManifest({ gid, name, category, me: who, folderId: folder.id, dataFolderId: dataFolder.id, files, at });
    const mf = await uploadJson({ name: PART_FILE_NAMES.manifest, parent: dataFolder.id, data: manifest, props: { rcGroup: gid, rcPart: 'manifest' } });
    await drive.createPermission(folder.id, { type: 'anyone', role: 'writer' });
    seen.manifest = mf.version != null ? String(mf.version) : null;
    return toLocal(manifest, { manifestId: mf.id, role: 'admin', joinedAt: at, canWriteFolder: true, seen });
  }

  function toLocal(m, extra = {}) {
    return { id: m.groupId, name: m.name, category: m.category, folderId: m.folderId, dataFolderId: m.dataFolderId,
      files: { ...m.files }, manifest: m, seen: {}, status: 'ok', ...extra };
  }

  async function readManifest(id) {
    try { return parseManifest(await drive.download(id)); } catch (e) {
      if (isAccessError(e)) throw new GroupError('noAccess');
      throw e;
    }
  }

  // Aggiorna il manifest remoto con una modifica (ripete se un altro allenatore l'ha cambiato nel frattempo)
  async function updateManifest(g, change) {
    for (let attempt = 0; attempt < 4; attempt++) {
      let meta;
      try { meta = await drive.getFile(g.manifestId, 'id,version'); } catch (e) { if (isAccessError(e)) throw new GroupError('noAccess'); throw e; }
      const remote = await readManifest(g.manifestId);
      const cur = mergeManifest(g.manifest, remote);
      const next = change(cur);
      if (!next) { g.manifest = cur; return g; }
      next.updatedAt = now();
      const meta2 = await drive.getFile(g.manifestId, 'id,version');
      if (String(meta2.version) !== String(meta.version)) continue;
      const res = await uploadJson({ fileId: g.manifestId, name: PART_FILE_NAMES.manifest, data: next, props: { rcGroup: g.id, rcPart: 'manifest' } });
      g.manifest = next; g.name = next.name; g.category = next.category;
      g.seen = { ...(g.seen || {}), manifest: res && res.version != null ? String(res.version) : null };
      return g;
    }
    throw new GroupError('conflict', 'Il gruppo è stato modificato da altri allenatori: riprova.');
  }

  // Ingresso (dopo la selezione dei file col Picker)
  async function joinGroup(inv) {
    const who = await me();
    const m = await readManifest(inv.manifestId);
    if (isBanned(m, who.email)) throw new GroupError('removedMember');
    if (PART_ORDER.some((k, i) => inv.fileIds[i] && m.files[k] !== inv.fileIds[i])) throw new GroupError('notGroup', 'Il link non corrisponde a questo gruppo.');
    for (const part of PART_ORDER) {
      try { await drive.getFile(m.files[part], 'id,version'); } catch (e) { if (isAccessError(e)) throw new GroupError('missingFiles'); throw e; }
    }
    let canWriteFolder = false;
    try { await drive.getFile(m.folderId, 'id'); canWriteFolder = true; } catch (e) { if (!isAccessError(e)) throw e; }
    const at = now();
    const g = toLocal(m, { manifestId: inv.manifestId, role: isAdmin(m, who.email) ? 'admin' : 'member', joinedAt: at, canWriteFolder });
    await updateManifest(g, (cur) => {
      if (isMember(cur, who.email)) return null;
      return { ...cur, members: [...cur.members.filter((x) => normEmail(x.email) !== normEmail(who.email)), { email: normEmail(who.email), name: clip(who.name, 80), joinedAt: at, role: 'member' }] };
    });
    const mine = activeMembers(g.manifest).find((x) => normEmail(x.email) === normEmail(who.email));
    if (mine) g.joinedAt = mine.joinedAt;
    return g;
  }

  // Un file dati: scarica se la versione è cambiata, unisce, invia se serve (controllo versione prima del PATCH)
  async function syncPart(g, part) {
    const fileId = g.files[part];
    const kinds = GROUP_PARTS[part];
    const out = { upserts: [], deletes: [], uploaded: false, received: false };
    const first = !Object.prototype.hasOwnProperty.call(g.seen || {}, part); // appena entrati: niente avvisi sulle novità
    for (let attempt = 0; attempt < 4; attempt++) {
      const meta = await drive.getFile(fileId, 'id,version,trashed');
      const v = String(meta.version);
      const rev = await local.dirtyRev(g.id, part);
      let remoteChanged = false;
      if (v !== (g.seen || {})[part]) {
        const remote = parsePart(await drive.download(fileId), part, g.id);
        const res = await local.merge(g.id, kinds, remote.items, remote.tombstones, { first, name: g.name });
        const log = mergeDeletedLog(await local.log(g.id), remote.deleted);
        await local.setLog(g.id, log);
        out.upserts.push(...res.upserts); out.deletes.push(...res.deletes);
        out.received = true;
        remoteChanged = res.remoteChanged || Object.keys(log).some((id) => kinds.includes(log[id].kind) && !(remote.deleted || {})[id]);
      }
      if (!rev && !remoteChanged) { g.seen = { ...(g.seen || {}), [part]: v }; return out; }
      // prima del PATCH: il file è ancora quello appena letto?
      const check = await drive.getFile(fileId, 'id,version');
      if (String(check.version) !== v) { g.seen = { ...(g.seen || {}), [part]: null }; continue; }
      const payload = buildPartPayload(g.id, part, await local.items(g.id, kinds), await local.tombs(g.id), await local.log(g.id));
      const res = await uploadJson({ fileId, name: PART_FILE_NAMES[part], data: payload, props: { rcGroup: g.id, rcPart: part } });
      g.seen = { ...(g.seen || {}), [part]: res && res.version != null ? String(res.version) : null };
      if (rev) await local.clearDirty(g.id, part, rev);
      if (local.uploaded) await local.uploaded(g.id, payload.items);
      out.uploaded = true;
      return out;
    }
    return out; // troppi cambi contemporanei: resta "da inviare", si riprova al prossimo giro
  }

  // Giro completo di un gruppo. Restituisce { status: 'ok'|'lost'|'removed', changes }
  async function syncGroup(g) {
    const who = await me();
    const changes = { upserts: [], deletes: [] };
    try {
      const meta = await drive.getFile(g.manifestId, 'id,version,trashed');
      if (meta.trashed) return { status: 'deleted', changes }; // l'amministratore ha eliminato il gruppo (cartella nel cestino)
      if (String(meta.version) !== (g.seen || {}).manifest) {
        const remote = await readManifest(g.manifestId);
        g.manifest = mergeManifest(g.manifest, remote);
        g.name = g.manifest.name; g.category = g.manifest.category;
        g.seen = { ...(g.seen || {}), manifest: String(meta.version) };
      }
      const m = g.manifest;
      const removed = (m.removed || []).find((r) => normEmail(r.email) === normEmail(who.email));
      if (removed && ts(removed.at) >= ts(g.joinedAt)) return { status: 'removed', changes };
      // il proprio nome manca (ingressi contemporanei): si rimette
      if (!isMember(m, who.email) && !isAdmin(m, who.email)) {
        await updateManifest(g, (cur) => (isMember(cur, who.email) ? null : { ...cur, members: [...cur.members, { email: normEmail(who.email), name: clip(who.name, 80), joinedAt: g.joinedAt || now(), role: 'member' }] }));
      }
      for (const part of PART_ORDER) {
        const r = await syncPart(g, part);
        changes.upserts.push(...r.upserts); changes.deletes.push(...r.deletes);
      }
      return { status: 'ok', changes };
    } catch (e) {
      if (isAccessError(e)) return { status: 'lost', changes };
      throw e;
    }
  }

  // ----- amministratore: inviti e membri (permessi Drive sulla cartella del gruppo, ereditati dai file) -----
  async function closeInvites(g) {
    const who = await me();
    await updateManifest(g, (cur) => ({ ...cur, invites: 'closed', invitesAt: now() }));
    const perms = await drive.listPermissions(g.folderId);
    const have = new Set(perms.filter((p) => p.type === 'user').map((p) => normEmail(p.emailAddress)));
    const m = g.manifest;
    const removedAt = (e) => { const r = (m.removed || []).find((x) => normEmail(x.email) === e); return r ? ts(r.at) : 0; };
    const emails = new Set([
      ...activeMembers(m).map((x) => normEmail(x.email)),
      ...(m.invited || []).filter((x) => ts(x.at) > removedAt(normEmail(x.email))).map((x) => normEmail(x.email)),
    ]);
    emails.delete(normEmail(who.email));
    for (const email of emails) if (email && !have.has(email)) await drive.createPermission(g.folderId, { type: 'user', role: 'writer', emailAddress: email }, { sendNotificationEmail: false });
    for (const p of perms) if (p.type === 'anyone') await drive.deletePermission(g.folderId, p.id);
    return g;
  }

  async function reopenInvites(g) {
    await updateManifest(g, (cur) => ({ ...cur, invites: 'open', invitesAt: now() }));
    const perms = await drive.listPermissions(g.folderId);
    if (!perms.some((p) => p.type === 'anyone')) await drive.createPermission(g.folderId, { type: 'anyone', role: 'writer' });
    return g;
  }

  // Toglie un membro. Con gli inviti aperti il vecchio link lo farebbe rientrare (il link sono gli id dei file):
  // gli inviti vengono chiusi subito (permessi espliciti agli altri membri, via "chiunque"). Restituisce
  // { closedInvites } per poterlo dire all'amministratore.
  async function removeMember(g, email) {
    const e = normEmail(email);
    await updateManifest(g, (cur) => ({ ...cur, removed: [...cur.removed.filter((r) => normEmail(r.email) !== e), { email: e, at: now() }],
      invited: cur.invited.filter((x) => normEmail(x.email) !== e) }));
    let closedInvites = false;
    if (g.manifest.invites !== 'closed') { await closeInvites(g); closedInvites = true; }
    const perms = await drive.listPermissions(g.folderId);
    for (const p of perms) if (p.type === 'user' && normEmail(p.emailAddress) === e && p.role !== 'owner') await drive.deletePermission(g.folderId, p.id);
    return { closedInvites };
  }

  // Invito per email (riserva se il link non basta): permesso esplicito sulla cartella del gruppo
  async function addByEmail(g, email) {
    const e = normEmail(email);
    if (!validEmail(e)) throw new GroupError('badEmail', 'Indirizzo email non valido.');
    await drive.createPermission(g.folderId, { type: 'user', role: 'writer', emailAddress: e }, { sendNotificationEmail: true });
    await updateManifest(g, (cur) => ({ ...cur, invited: [...cur.invited.filter((x) => normEmail(x.email) !== e), { email: e, at: now() }] }));
    return g;
  }

  // Uscita: il proprio nome viene tolto dal manifest (i dati restano agli altri)
  async function leaveGroup(g) {
    const who = await me();
    const e = normEmail(who.email);
    try {
      await updateManifest(g, (cur) => ({ ...cur, members: cur.members.filter((x) => normEmail(x.email) !== e), removed: [...cur.removed.filter((r) => normEmail(r.email) !== e), { email: e, at: now(), left: true }] }));
    } catch (err) {
      if (!isAccessError(err)) throw err;
    }
    return true;
  }

  return { createGroup, joinGroup, syncGroup, syncPart, closeInvites, reopenInvites, removeMember, addByEmail, leaveGroup, readManifest, updateManifest };
}
