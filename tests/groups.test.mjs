// Gruppi: nucleo (groups.js) con un Drive finto multi-utente che applica drive.file e i permessi.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDriveClient } from '../app/js/drive.js';
import { createGroupsCore, inviteLink, parseInvite, pickIds, GROUP_PARTS, GroupError, activeMembers, isMember, mergeManifest, PART_ORDER, DATA_FOLDER_NAME, groupArrivals, groupNewsText } from '../app/js/groups.js';
import { mergeCollection, newExercise, newSession, newPlayer } from '../app/js/model.js';
import { createFakeDrive } from './fake-drive.mjs';

// archivio locale in memoria di un allenatore (stessa regola di unione dell'app)
let clock = Date.parse('2026-11-26T10:00:00Z'); // orologio comune: l'ordine delle modifiche è quello reale
function memLocal() {
  const store = new Map(); const tombs = {}; const logs = {}; const dirty = {};
  return {
    store, tombs,
    put(gid, rec) { clock += 1000; const r = { ...rec, groupId: gid, updatedAt: new Date(clock).toISOString() }; store.set(r.id, r); const p = Object.keys(GROUP_PARTS).find((k) => GROUP_PARTS[k].includes(r.kind)); dirty[gid] = { ...(dirty[gid] || {}), [p]: ((dirty[gid] || {})[p] || 0) + 1 }; return r; },
    del(gid, kind, id) { clock += 1000; store.delete(id); tombs[gid] = tombs[gid] || {}; tombs[gid][kind] = { ...(tombs[gid][kind] || {}), [id]: new Date(clock).toISOString() }; const p = Object.keys(GROUP_PARTS).find((k) => GROUP_PARTS[k].includes(kind)); dirty[gid] = { ...(dirty[gid] || {}), [p]: ((dirty[gid] || {})[p] || 0) + 1 }; },
    names(gid, kind) { return [...store.values()].filter((x) => x.groupId === gid && x.kind === kind).map((x) => x.name || x.planItems?.[0]?.name).sort(); },
    async items(gid, kinds) { return [...store.values()].filter((x) => x.groupId === gid && kinds.includes(x.kind)); },
    async tombs(gid) { return tombs[gid] || {}; },
    async log(gid) { return logs[gid] || {}; },
    async setLog(gid, l) { logs[gid] = l; },
    async merge(gid, kinds, remote, remoteTombs) {
      const out = { upserts: [], deletes: [], remoteChanged: false };
      for (const k of kinds) {
        const local = [...store.values()].filter((x) => x.groupId === gid && x.kind === k);
        const r = mergeCollection({ local, localTombs: (tombs[gid] || {})[k] || {}, remote: remote.filter((x) => x.kind === k), remoteTombs: (remoteTombs || {})[k] || {} });
        for (const u of r.upserts) store.set(u.id, { ...u, groupId: gid });
        for (const id of r.deletes) store.delete(id);
        tombs[gid] = { ...(tombs[gid] || {}), [k]: r.tombs };
        out.upserts.push(...r.upserts); out.deletes.push(...r.deletes.map((id) => ({ kind: k, id })));
        out.remoteChanged = out.remoteChanged || r.remoteChanged;
      }
      return out;
    },
    async dirtyRev(gid, part) { return (dirty[gid] || {})[part] || 0; },
    async clearDirty(gid, part, rev) { if ((dirty[gid] || {})[part] === rev) delete dirty[gid][part]; },
  };
}

function coach(fd, email, name) {
  fd.names.set(email, name);
  let k = 0;
  const drive = createDriveClient({ fetch: fd.fetchAs, getToken: async () => `tok-${email}-${++k}` });
  const local = memLocal();
  const core = createGroupsCore({ drive, local, me: async () => ({ email, name }) });
  // Picker finto: seleziona i file che l'utente può vedere
  const pick = async (ids) => {
    const vis = await (await fd.fetchAs('https://www.googleapis.com/__picker/visible?ids=' + ids.join(','), { headers: { Authorization: `tok-${email}-0`.replace(/^/, 'Bearer ') } })).json();
    const r = await fd.fetchAs('https://www.googleapis.com/__picker/grant', { method: 'POST', headers: { Authorization: `Bearer tok-${email}-0` }, body: JSON.stringify({ ids: vis.files.map((f) => f.id) }) });
    return (await r.json()).granted;
  };
  return { email, name, drive, local, core, pick };
}

test('gruppi con 4 allenatori: crea, entra, unione, eliminazione, chiusura inviti, invito per email, rimozione, uscita', async () => {
  const fd = createFakeDrive();
  const A = coach(fd, 'anna@example.com', 'Anna');
  const B = coach(fd, 'bruno@example.com', 'Bruno');
  const C = coach(fd, 'carla@example.com', 'Carla');
  const D = coach(fd, 'dario@example.com', '<img src=x onerror=alert(1)>Dario');

  // ----- A crea il gruppo -----
  const gA = await A.core.createGroup({ name: 'Squadra U12', category: 'U12' });
  const folder = fd.files.get(gA.folderId);
  assert.equal(folder.name, 'Rugby Coach – Squadra U12');
  assert.ok(!folder.parents, 'nella radice del Drive di chi crea');
  assert.equal(fd.files.get(gA.dataFolderId).name, DATA_FOLDER_NAME);
  assert.deepEqual(fd.files.get(gA.dataFolderId).parents, [gA.folderId]);
  assert.ok(folder.perms.some((p) => p.type === 'anyone' && p.role === 'writer'), 'chiunque abbia il link può modificare');
  for (const p of PART_ORDER) assert.deepEqual(fd.files.get(gA.files[p]).parents, [gA.dataFolderId]);
  const link = inviteLink('https://leobordo.github.io/rugby-coach/', gA);
  const inv = parseInvite(new URL(link.replace('#/unisciti?', '?')).searchParams);
  assert.equal(inv.name, 'Squadra U12'); assert.equal(inv.admin, 'Anna');
  assert.equal(pickIds(inv).length, 7, 'manifest, 4 file dati, 2 cartelle');

  // ----- senza aver scelto i file col Picker B non vede nulla (drive.file) -----
  await assert.rejects(B.core.joinGroup(inv), (e) => e instanceof GroupError && e.code === 'noAccess');
  // ----- B e C entrano dal link (Picker) -----
  assert.equal((await B.pick(pickIds(inv))).length, 7);
  const gB = await B.core.joinGroup(inv);
  assert.equal(gB.canWriteFolder, true, 'può scrivere i suoi documenti nella cartella del gruppo');
  await C.pick(pickIds(inv));
  const gC = await C.core.joinGroup(inv);
  await A.core.syncGroup(gA);
  assert.deepEqual(activeMembers(gA.manifest).map((x) => x.name).sort(), ['Anna', 'Bruno', 'Carla']);

  // ----- tutti modificano: libreria, piani, schede, rosa -----
  const exA = A.local.put(gA.id, newExercise({ name: 'Esercizio di Anna' }));
  B.local.put(gB.id, newExercise({ name: 'Esercizio di Bruno' }));
  const sC = C.local.put(gC.id, newSession({ date: '2026-12-01', planItems: [{ id: 'p1', name: 'Seduta di Carla' }] }));
  A.local.put(gA.id, newPlayer({ name: 'Giocatore di Anna', category: 'U12' }));
  for (let i = 0; i < 2; i++) for (const [X, g] of [[A, gA], [B, gB], [C, gC]]) assert.equal((await X.core.syncGroup(g)).status, 'ok');
  for (const X of [A, B, C]) {
    assert.deepEqual(X.local.names(gA.id, 'exercise'), ['Esercizio di Anna', 'Esercizio di Bruno'], X.name + ': libreria unita');
    assert.deepEqual(X.local.names(gA.id, 'session'), ['Seduta di Carla'], X.name);
    assert.deepEqual(X.local.names(gA.id, 'player'), ['Giocatore di Anna'], X.name);
  }
  // stessi file: nessun file dati nuovo, version controllata
  assert.equal([...fd.files.values()].filter((f) => f.appProperties?.rcKind === 'groupData').length, 5);

  // ----- B elimina la seduta di Carla: sparisce agli altri (tombstone condivisa) -----
  B.local.del(gB.id, 'session', sC.id);
  await B.core.syncGroup(gB);
  await A.core.syncGroup(gA); await C.core.syncGroup(gC);
  assert.deepEqual(A.local.names(gA.id, 'session'), []);
  assert.deepEqual(C.local.names(gC.id, 'session'), []);
  // modifica contemporanea dello stesso esercizio: vince la più recente, nessun duplicato
  A.local.put(gA.id, { ...exA, name: 'Esercizio di Anna (A)' });
  B.local.put(gB.id, { ...B.local.store.get(exA.id), name: 'Esercizio di Anna (B, dopo)' });
  await A.core.syncGroup(gA); await B.core.syncGroup(gB); await A.core.syncGroup(gA); await C.core.syncGroup(gC);
  for (const X of [A, B, C]) assert.ok(X.local.names(gA.id, 'exercise').includes('Esercizio di Anna (B, dopo)'), X.name);

  // ----- A chiude gli inviti: permessi espliciti ai membri, via "chiunque" -----
  await A.core.closeInvites(gA);
  assert.ok(!folder.perms.some((p) => p.type === 'anyone'));
  assert.deepEqual(folder.perms.filter((p) => p.type === 'user').map((p) => p.emailAddress).sort(), ['bruno@example.com', 'carla@example.com']);
  assert.equal((await B.core.syncGroup(gB)).status, 'ok', 'chi è entrato continua a lavorare');
  // D col link non entra: il Picker non gli mostra nulla e i file non si aprono
  assert.equal((await D.pick(pickIds(inv))).length, 0);
  await assert.rejects(D.core.joinGroup(inv), (e) => e instanceof GroupError && e.code === 'noAccess');
  // invito per email: ora D entra (nome con caratteri speciali conservato come testo)
  await A.core.addByEmail(gA, 'Dario@Example.com');
  assert.equal((await D.pick(pickIds(inv))).length, 7);
  const gD = await D.core.joinGroup(inv);
  await D.core.syncGroup(gD); // come l'app: subito dopo l'ingresso si ricevono i dati
  await A.core.syncGroup(gA);
  assert.ok(isMember(gA.manifest, 'dario@example.com'));
  assert.equal(activeMembers(gA.manifest).find((x) => x.email === 'dario@example.com').name, '<img src=x onerror=alert(1)>Dario');
  assert.deepEqual(D.local.names(gD.id, 'exercise'), A.local.names(gA.id, 'exercise'), 'D riceve i dati del gruppo');

  // ----- A rimuove C: C non apre più il gruppo -----
  await A.core.removeMember(gA, 'carla@example.com');
  assert.ok(!folder.perms.some((p) => p.emailAddress === 'carla@example.com'));
  const rc = await C.core.syncGroup(gC);
  assert.ok(rc.status === 'removed' || rc.status === 'lost', 'C: ' + rc.status);

  // ----- B esce: il suo nome sparisce dal gruppo -----
  await B.core.leaveGroup(gB);
  await A.core.syncGroup(gA);
  assert.deepEqual(activeMembers(gA.manifest).map((x) => x.email).sort(), ['anna@example.com', 'dario@example.com']);
});

test('manifest: ingressi contemporanei non si perdono; uscita/rimozione dopo l\'ingresso contano', () => {
  const base = { members: [{ email: 'a@x.it', joinedAt: '2026-01-01T00:00:00Z' }], removed: [], invited: [], updatedAt: '2026-01-01T00:00:00Z', invitesAt: '2026-01-01T00:00:00Z', invites: 'open' };
  const b = { ...base, members: [...base.members, { email: 'b@x.it', joinedAt: '2026-01-02T00:00:00Z' }], updatedAt: '2026-01-02T00:00:00Z' };
  const c = { ...base, members: [...base.members, { email: 'c@x.it', joinedAt: '2026-01-02T00:00:01Z' }], updatedAt: '2026-01-02T00:00:01Z' };
  const m = mergeManifest(b, c);
  assert.deepEqual(activeMembers(m).map((x) => x.email).sort(), ['a@x.it', 'b@x.it', 'c@x.it']);
  const r = mergeManifest(m, { ...m, removed: [{ email: 'b@x.it', at: '2026-01-03T00:00:00Z' }], updatedAt: '2026-01-03T00:00:00Z' });
  assert.ok(!isMember(r, 'b@x.it'));
  const back = mergeManifest(r, { ...r, members: [...r.members.filter((x) => x.email !== 'b@x.it'), { email: 'b@x.it', joinedAt: '2026-01-04T00:00:00Z' }], updatedAt: '2026-01-04T00:00:00Z' });
  assert.ok(isMember(back, 'b@x.it'), 'rientrato dopo la rimozione (inviti aperti)');
});

test('link di invito: parametri validati (niente id strani)', () => {
  assert.equal(parseInvite(new URLSearchParams('g=abc&f=11,22,33')), null);
  assert.equal(parseInvite(new URLSearchParams('g=../x&f=aaaa,bbbb,cccc,dddd')), null);
  const ok = parseInvite(new URLSearchParams('g=mmmm&f=aaaa,bbbb,cccc,dddd&n=' + encodeURIComponent('<b>U12</b>')));
  assert.equal(ok.name, '<b>U12</b>', 'il nome resta testo (mostrato con textContent)');
});

test('membro tolto con inviti aperti: gli inviti si chiudono, il vecchio link non lo fa rientrare (nemmeno a inviti riaperti); rientra solo con un nuovo invito per email', async () => {
  const fd = createFakeDrive();
  const A = coach(fd, 'anna@example.com', 'Anna');
  const B = coach(fd, 'bruno@example.com', 'Bruno');
  const gA = await A.core.createGroup({ name: 'U10', category: 'U10' });
  const inv = parseInvite(new URL(inviteLink('https://x.it/', gA).replace('#/unisciti?', '?')).searchParams);
  await B.pick(pickIds(inv));
  const gB = await B.core.joinGroup(inv);
  const res = await A.core.removeMember(gA, 'bruno@example.com');
  assert.equal(res.closedInvites, true, 'inviti chiusi in automatico');
  const folder = fd.files.get(gA.folderId);
  assert.ok(!folder.perms.some((p) => p.type === 'anyone' || p.emailAddress === 'bruno@example.com'), 'nessun permesso per B');
  assert.equal(gA.manifest.invites, 'closed');
  // B non scrive più: il gruppo non si apre (o risulta tolto)
  B.local.put(gB.id, newExercise({ name: 'scritto da rimosso' }));
  const st = await B.core.syncGroup(gB);
  assert.ok(st.status === 'lost' || st.status === 'removed', st.status);
  assert.ok(!JSON.parse(fd.files.get(gA.files.library).content).items.some((x) => x.name === 'scritto da rimosso'));
  // A riapre gli inviti: B vede di nuovo i file, ma l'app lo rifiuta
  await A.core.reopenInvites(gA);
  assert.equal((await B.pick(pickIds(inv))).length, 7);
  await assert.rejects(B.core.joinGroup(inv), (e) => e instanceof GroupError && e.code === 'removedMember');
  // nuovo invito per email dall'amministratore: B può rientrare
  await A.core.addByEmail(gA, 'bruno@example.com');
  const again = await B.core.joinGroup(inv);
  await A.core.syncGroup(gA);
  assert.ok(isMember(gA.manifest, 'bruno@example.com'));
  assert.equal(again.status, 'ok');
});

test('cartella del gruppo cestinata dall\'amministratore: per gli altri il gruppo risulta "eliminato"', async () => {
  const fd = createFakeDrive();
  const A = coach(fd, 'anna@example.com', 'Anna');
  const B = coach(fd, 'bruno@example.com', 'Bruno');
  const gA = await A.core.createGroup({ name: 'U8' });
  const inv = parseInvite(new URL(inviteLink('https://x.it/', gA).replace('#/unisciti?', '?')).searchParams);
  await B.pick(pickIds(inv));
  const gB = await B.core.joinGroup(inv);
  // solo il proprietario può cestinare
  await assert.rejects(B.drive.trashFile(gA.folderId));
  await A.drive.trashFile(gA.folderId);
  assert.equal(fd.isTrashed(fd.files.get(gA.files.library)), true, 'anche i file contenuti risultano nel cestino');
  assert.equal((await B.core.syncGroup(gB)).status, 'deleted');
});

test('avviso ai compagni: esercizi e piani aggiunti da un altro allenatore (non al primo ingresso, non i miei, non le modifiche)', async () => {
  const ex = (id, email, name = 'X') => ({ id, kind: 'exercise', name, createdBy: { email, name } });
  const ups = [ex('e1', 'anna@example.com'), ex('e2', 'Bruno@Example.com'), ex('e3', 'anna@example.com'),
    { id: 'p1', kind: 'plan', createdBy: { email: 'anna@example.com' } }, { id: 's1', kind: 'session', createdBy: { email: 'anna@example.com' } },
    { id: 'e4', kind: 'exercise' }];
  const got = groupArrivals({ upserts: ups, knownIds: new Set(['e3']), myEmail: 'bruno@example.com' }).map((x) => x.id);
  assert.deepEqual(got, ['e1', 'p1'], 'solo i nuovi esercizi/piani di altri');
  assert.equal(groupNewsText({ name: 'U10', items: [{ kind: 'exercise', title: 'Placcaggio', by: 'Anna' }] }), 'Anna ha aggiunto l\'esercizio "Placcaggio" nel gruppo "U10"');
  assert.equal(groupNewsText({ name: 'U10', items: [{ kind: 'plan', title: 'I TRIMESTRE', by: 'Anna' }] }), 'Anna ha aggiunto il piano "I TRIMESTRE" nel gruppo "U10"');
  assert.equal(groupNewsText({ name: 'U10', items: [{ kind: 'exercise' }, { kind: 'exercise' }, { kind: 'plan' }] }), 'Novità nel gruppo "U10": 2 esercizi e 1 piano');

  // il nucleo dice a merge se è la prima ricezione (appena entrati): lì niente avvisi
  const fd = createFakeDrive();
  const A = coach(fd, 'anna@example.com', 'Anna');
  const B = coach(fd, 'bruno@example.com', 'Bruno');
  const gA = await A.core.createGroup({ name: 'Squadra U10', category: 'U10' });
  A.local.put(gA.id, newExercise({ name: 'Già presente', createdBy: { email: 'anna@example.com', name: 'Anna' } }));
  await A.core.syncGroup(gA);
  const inv = parseInvite(new URL(inviteLink('https://x/', gA).replace('#/unisciti?', '?')).searchParams);
  await B.pick(pickIds(inv));
  const gB = await B.core.joinGroup(inv);
  const calls = [];
  const merge = B.local.merge;
  B.local.merge = async (gid, kinds, items, tombs, opts) => { const known = new Set(B.local.store.keys()); const r = await merge(gid, kinds, items, tombs); calls.push({ kinds, opts, news: groupArrivals({ upserts: r.upserts, knownIds: known, myEmail: B.email }) }); return r; };
  await B.core.syncGroup(gB);
  const lib1 = calls.find((c) => c.kinds.includes('exercise'));
  assert.equal(lib1.opts.first, true, 'primo arrivo dopo l\'ingresso');
  assert.equal(lib1.opts.name, 'Squadra U10');
  calls.length = 0;
  A.local.put(gA.id, newExercise({ name: 'Nuovo di Anna', createdBy: { email: 'anna@example.com', name: 'Anna' } }));
  await A.core.syncGroup(gA);
  await B.core.syncGroup(gB);
  const lib2 = calls.find((c) => c.kinds.includes('exercise'));
  assert.equal(lib2.opts.first, false);
  assert.deepEqual(lib2.news.map((x) => x.name), ['Nuovo di Anna']);
});
