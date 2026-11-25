// Drive + coda di sincronizzazione con un fetch finto (il Drive reale non è testabile senza Client ID).
import test from 'node:test';
import assert from 'node:assert/strict';
import { findOrCreateDataFolder, moveRootJson, createDriveClient, buildMultipart, DriveAuthError, DOCX_MIME, FOLDER_MIME, findOrCreateAppFolder } from '../app/js/drive.js';
import { createSyncEngine, SYNC_STATUS, buildRemoteIndex } from '../app/js/sync.js';

// Finto Drive in memoria che risponde come l'API v3
function fakeDrive({ failWith } = {}) {
  const files = new Map();
  const calls = [];
  let n = 0;
  const state = { online: true, failWith, token: 'tok' };
  async function parseMultipart(body, ct) {
    const text = await new Response(body).text();
    const boundary = /boundary=(.+)$/.exec(ct)[1];
    const parts = text.split('--' + boundary).slice(1, -1);
    const meta = JSON.parse(parts[0].split('\r\n\r\n')[1].trim());
    const content = parts[1].split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, '');
    return { meta, content };
  }
  const json = (status, obj) => new Response(obj === null ? null : JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
  async function fetch(url, opts = {}) {
    if (!state.online) throw new TypeError('Failed to fetch');
    const u = new URL(url);
    calls.push({ method: opts.method, path: u.pathname, query: Object.fromEntries(u.searchParams), auth: opts.headers?.Authorization });
    if (opts.headers?.Authorization !== 'Bearer ' + state.token) return json(401, { error: { message: 'Invalid Credentials' } });
    if (state.failWith) { const s = state.failWith; state.failWith = null; return json(s, { error: { message: 'boom' } }); }
    if (u.hostname === 'www.googleapis.com' && !u.pathname.endsWith('/about')) assert.equal(u.searchParams.get('supportsAllDrives'), 'true', 'supportsAllDrives su ' + u.pathname);
    const m = /^\/(upload\/)?drive\/v3\/files(?:\/([^/]+))?$/.exec(u.pathname);
    if (!m) return json(404, { error: { message: 'not found' } });
    const [, upload, id] = m;
    if (opts.method === 'POST' && !upload) {
      const meta = JSON.parse(opts.body);
      const fid = 'f' + (++n);
      files.set(fid, { id: fid, ...meta, content: null, createdTime: new Date(1700000000000 + n * 1000).toISOString() });
      return json(200, { id: fid, name: meta.name });
    }
    if (opts.method === 'POST' && upload) {
      assert.equal(u.searchParams.get('uploadType'), 'multipart');
      const { meta, content } = await parseMultipart(opts.body, opts.headers['Content-Type']);
      if (meta.parents && !files.has(meta.parents[0])) return json(404, { error: { message: 'File not found: ' + meta.parents[0] } });
      const fid = 'f' + (++n);
      files.set(fid, { id: fid, ...meta, content, version: 1 });
      return json(200, { id: fid, name: meta.name, webViewLink: 'https://drive/' + fid });
    }
    if (opts.method === 'PATCH' && !upload && id) {
      assert.equal(u.searchParams.get('supportsAllDrives'), 'true');
      const f = files.get(id);
      if (!f) return json(404, { error: { message: 'File not found: ' + id } });
      const add = u.searchParams.get('addParents'); const rem = u.searchParams.get('removeParents');
      if (add || rem) {
        if (state.moveBudget != null && state.moveBudget-- <= 0) return json(503, { error: { message: 'Backend Error' } });
        state.moves = (state.moves || 0) + 1;
        f.parents = [...(f.parents || []).filter((x) => x !== rem), ...(add && !(f.parents || []).includes(add) ? [add] : [])];
        return json(200, { id, parents: f.parents, trashed: !!f.trashed });
      }
      Object.assign(f, JSON.parse(opts.body));
      state.trashed = (state.trashed || 0) + 1;
      return json(200, { id, trashed: f.trashed });
    }
    if (opts.method === 'PATCH' && upload) {
      if (!files.has(id)) return json(404, { error: { message: 'File not found: ' + id } });
      const { meta, content } = await parseMultipart(opts.body, opts.headers['Content-Type']);
      assert.ok(!meta.parents, 'PATCH non deve mandare parents');
      const f = files.get(id);
      // come Drive: un aggiornamento senza trashed:false lascia il file nel cestino
      const { trashed: wantTrashed, ...rest } = meta;
      Object.assign(f, rest, { content, version: f.version + 1 });
      if (wantTrashed === false && !state.ignoreUntrash) f.trashed = false;
      return json(200, { id, name: f.name, trashed: !!f.trashed });
    }
    if (opts.method === 'GET' && !id && !upload) {
      assert.equal(u.searchParams.get('supportsAllDrives'), 'true');
      assert.equal(u.searchParams.get('includeItemsFromAllDrives'), 'true');
      const q = u.searchParams.get('q') || '';
      const parent = /'([^']+)' in parents/.exec(q)?.[1];
      const props = [...q.matchAll(/appProperties has \{ key='(\w+)' and value='([^']*)' \}/g)];
      const mime = /mimeType='([^']+)'/.exec(q)?.[1];
      const list = [...files.values()].filter((f) => !f.trashed && f.appProperties && props.every(([, k, v]) => f.appProperties[k] === v)
        && (!parent || (f.parents || []).includes(parent)) && (!mime || f.mimeType === mime));
      state.lists = (state.lists || 0) + 1;
      return json(200, { files: list.map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, createdTime: f.createdTime, parents: f.parents, appProperties: f.appProperties })) });
    }
    if (opts.method === 'GET' && id) {
      const f = files.get(id);
      return f ? json(200, f) : json(404, { error: { message: 'File not found' } });
    }
    return json(400, { error: { message: 'unsupported' } });
  }
  return { fetch, files, calls, state };
}

function memStore() {
  const m = new Map();
  return {
    m,
    async get(k) { const v = m.get(k); return v ? structuredClone(v) : undefined; },
    async put(v) { m.set(v.key, structuredClone(v)); },
    async delete(k) { m.delete(k); },
    async all() { return [...m.values()].map((v) => structuredClone(v)); },
  };
}

function setup(opts = {}) {
  const fd = fakeDrive(opts);
  let token = 'tok';
  const drive = createDriveClient({ fetch: fd.fetch, getToken: async () => token });
  const records = new Map();
  const store = memStore();
  let clock = 1000;
  const engine = createSyncEngine({
    store, drive,
    getRecord: async (kind, id) => records.get(kind + ':' + id),
    buildArtifacts: async (kind, rec) => [
      { key: 'docx-plan', name: `${rec.date} Allenamento.docx`, mimeType: DOCX_MIME, data: 'DOCX:' + rec.text },
      { key: 'json', name: `${rec.date} Allenamento.json`, mimeType: 'application/json', data: JSON.stringify(rec) },
    ],
    getFolderId: async () => opts.folder === null ? null : (opts.folder || 'folder1'),
    isOnline: () => fd.state.online,
    now: () => clock,
  });
  fd.files.set('folder1', { id: 'folder1', mimeType: FOLDER_MIME, name: 'Rugby Coach' });
  return { fd, engine, records, store, setToken: (t) => { token = t; }, tick: (ms) => { clock += ms; } };
}

test('multipart: metadati con accenti in JSON solo-ASCII', async () => {
  const { body } = buildMultipart({ name: 'Piano I° TRIMESTRE è.docx' }, 'text/plain', 'x', 'B');
  const txt = await new Response(body).text();
  assert.ok(txt.includes('Piano I\\u00b0 TRIMESTRE \\u00e8.docx'));
  assert.equal(JSON.parse(txt.split('\r\n\r\n')[1].split('\r\n')[0]).name, 'Piano I° TRIMESTRE è.docx');
});

test('multipart: metadati JSON + contenuto', async () => {
  const { body, contentType } = buildMultipart({ name: 'a.json' }, 'application/json', '{"x":1}', 'BND');
  assert.equal(contentType, 'multipart/related; boundary=BND');
  const txt = await new Response(body).text();
  assert.equal(txt, '--BND\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{"name":"a.json"}\r\n--BND\r\nContent-Type: application/json\r\n\r\n{"x":1}\r\n--BND--');
});

test('drive client: crea cartella dedicata e verifica', async () => {
  const fd = fakeDrive();
  const drive = createDriveClient({ fetch: fd.fetch, getToken: async () => 'tok' });
  const f = await drive.createFolder('Rugby Coach');
  assert.equal(fd.files.get(f.id).mimeType, FOLDER_MIME);
  assert.equal(fd.calls[0].auth, 'Bearer tok');
  const g = await drive.getFile(f.id);
  assert.equal(g.name, 'Rugby Coach');
  const noTok = createDriveClient({ fetch: fd.fetch, getToken: async () => null });
  await assert.rejects(noTok.getFile(f.id), DriveAuthError);
});

test('prima sync crea i file nella cartella, la successiva aggiorna gli stessi file (PATCH, nessun duplicato)', async () => {
  const { fd, engine, records } = setup();
  records.set('session:s1', { date: '2026-11-24', text: 'v1' });
  await engine.markDirty('session', 's1');
  let st = await engine.getStatus('session', 's1');
  assert.equal(st.status, SYNC_STATUS.PENDING);
  let sum = await engine.processQueue();
  assert.equal(sum.synced, 1);
  st = await engine.getStatus('session', 's1');
  assert.equal(st.status, SYNC_STATUS.SYNCED);
  const docId = st.files['docx-plan'];
  assert.ok(docId && st.files.json);
  const created = fd.files.get(docId);
  assert.deepEqual(created.parents, ['folder1']);
  assert.equal(created.appProperties.rcApp, 'rugby-coach');
  assert.equal(created.content, 'DOCX:v1');
  const before = fd.files.size;
  records.set('session:s1', { date: '2026-11-24', text: 'v2' });
  await engine.markDirty('session', 's1');
  sum = await engine.processQueue();
  assert.equal(sum.synced, 1);
  assert.equal(fd.files.size, before, 'nessun file nuovo');
  assert.equal(fd.files.get(docId).content, 'DOCX:v2');
  assert.equal(fd.files.get(docId).version, 2);
  assert.ok(fd.calls.some((c) => c.method === 'PATCH' && c.path.endsWith('/files/' + docId) && c.query.uploadType === 'multipart'));
});

test('offline: resta in coda e parte quando torna la rete', async () => {
  const { fd, engine, records } = setup();
  records.set('match:m1', { date: '2026-11-22', text: 'x' });
  await engine.markDirty('match', 'm1');
  fd.state.online = false;
  let sum = await engine.processQueue();
  assert.equal(sum.skipped, 'offline');
  assert.equal((await engine.getStatus('match', 'm1')).status, SYNC_STATUS.PENDING);
  fd.state.online = true;
  sum = await engine.processQueue();
  assert.equal(sum.synced, 1);
});

test('token scaduto (401): la coda si ferma e chiede l\'accesso, poi riprende', async () => {
  const { fd, engine, records } = setup();
  records.set('session:a', { date: 'd', text: 'a' });
  records.set('session:b', { date: 'd', text: 'b' });
  await engine.markDirty('session', 'a');
  await engine.markDirty('session', 'b');
  fd.state.token = 'nuovo';
  let sum = await engine.processQueue();
  assert.equal(sum.needsAuth, true);
  assert.equal(sum.synced, 0);
  assert.equal((await engine.getStatus('session', 'a')).status, SYNC_STATUS.PENDING);
  fd.state.token = 'tok';
  sum = await engine.processQueue();
  assert.equal(sum.synced, 2);
});

test('errore del server: stato "error" con nuovo tentativo dopo il backoff', async () => {
  const { fd, engine, records, tick } = setup();
  records.set('plan:p', { date: 'd', text: 'p' });
  await engine.markDirty('plan', 'p');
  fd.state.failWith = 500;
  let sum = await engine.processQueue();
  assert.equal(sum.errors, 1);
  let st = await engine.getStatus('plan', 'p');
  assert.equal(st.status, SYNC_STATUS.ERROR);
  assert.match(st.error, /500/);
  sum = await engine.processQueue();
  assert.equal(sum.processed, 0, 'non ritenta prima del backoff');
  tick(20000);
  sum = await engine.processQueue();
  assert.equal(sum.synced, 1);
});

test('file eliminato su Drive: viene ricreato', async () => {
  const { fd, engine, records } = setup();
  records.set('session:s', { date: 'd', text: '1' });
  await engine.markDirty('session', 's');
  await engine.processQueue();
  const old = (await engine.getStatus('session', 's')).files['docx-plan'];
  fd.files.delete(old);
  await engine.markDirty('session', 's');
  await engine.processQueue();
  const st = await engine.getStatus('session', 's');
  assert.equal(st.status, SYNC_STATUS.SYNCED);
  assert.notEqual(st.files['docx-plan'], old);
});

test('modifica durante l\'upload: la scheda resta "in attesa" e la sync successiva la allinea', async () => {
  const { engine, records, store } = setup();
  records.set('session:s', { date: 'd', text: '1' });
  await engine.markDirty('session', 's');
  const origPut = store.put;
  let done = false;
  store.put = async (v) => {
    await origPut(v);
    if (v.status === 'syncing' && !done) { done = true; records.set('session:s', { date: 'd', text: '2' }); await engine.markDirty('session', 's'); }
  };
  await engine.processQueue();
  assert.equal((await engine.getStatus('session', 's')).status, SYNC_STATUS.PENDING);
  store.put = origPut;
  await engine.processQueue();
  assert.equal((await engine.getStatus('session', 's')).status, SYNC_STATUS.SYNCED);
});

test('senza cartella scelta non sincronizza; record eliminato -> voce rimossa dalla coda', async () => {
  const a = setup({ folder: null });
  a.records.set('session:s', { date: 'd', text: '1' });
  await a.engine.markDirty('session', 's');
  assert.equal((await a.engine.processQueue()).skipped, 'nofolder');
  const b = setup();
  await b.engine.markDirty('session', 'ghost');
  await b.engine.processQueue();
  assert.equal(await b.engine.getStatus('session', 'ghost'), undefined);
});

test('cartella non più accessibile: errore segnalato', async () => {
  const { engine, records } = setup({ folder: 'cancellata' });
  records.set('session:s', { date: 'd', text: '1' });
  await engine.markDirty('session', 's');
  const sum = await engine.processQueue();
  assert.equal(sum.errors, 1);
  assert.equal(sum.folderMissing, true);
});

test('ricollegando la stessa cartella (id dei file dimenticati) non crea duplicati: cerca e aggiorna', async () => {
  const { fd, engine, records, store } = setup();
  records.set('session:s1', { date: '2026-11-24', text: 'v1' });
  await engine.markDirty('session', 's1');
  await engine.processQueue();
  const before = fd.files.size;
  const ids = (await engine.getStatus('session', 's1')).files;
  // "Disconnetti e dimentica cartella" / nuovo dispositivo: la coda non conosce più gli id
  const e = await store.get('session:s1'); e.files = {}; await store.put(e);
  records.set('session:s1', { date: '2026-11-24', text: 'v2' });
  await engine.markDirty('session', 's1');
  await engine.processQueue();
  assert.equal(fd.files.size, before, 'nessun file nuovo');
  assert.deepEqual((await engine.getStatus('session', 's1')).files, ids, 'stessi file riusati');
  assert.equal(fd.files.get(ids['docx-plan']).content, 'DOCX:v2');
  const js = fd.files.get(ids.json);
  assert.equal(js.appProperties['rcF_docx-plan'], ids['docx-plan'], 'il .json elenca gli id dei .docx');
});

test('esempi (id stabili): creati solo se mancano, mai sovrascritti', async () => {
  const { fd, engine, records, store } = setup();
  records.set('plan:seed-plan', { date: 'd', text: 'esempio', example: true });
  await engine.markDirty('plan', 'seed-plan');
  await engine.processQueue();
  const created = (await engine.getStatus('plan', 'seed-plan')).files;
  assert.ok(created.json, 'creato perché mancava');
  // un altro dispositivo con lo stesso esempio non modificato
  const e = await store.get('plan:seed-plan'); e.files = {}; await store.put(e);
  records.set('plan:seed-plan', { date: 'd', text: 'esempio-altro-dispositivo', example: true });
  const n = fd.files.size;
  await engine.markDirty('plan', 'seed-plan');
  await engine.processQueue();
  assert.equal(fd.files.size, n);
  assert.equal(JSON.parse(fd.files.get(created.json).content).text, 'esempio', 'il file remoto non è stato sovrascritto');
  assert.equal((await engine.getStatus('plan', 'seed-plan')).status, SYNC_STATUS.SYNCED);
  // raccolta vuota (placeholder): nessun file
  records.set('roster:all', { example: true, placeholder: true });
  await engine.markDirty('roster', 'all');
  await engine.processQueue();
  assert.equal(fd.files.size, n);
});

test('raccolte: appProperties con il tipo di dato contenuto (exercise/player) e id "all"', async () => {
  const { fd, engine, records } = setup();
  records.set('library:all', { date: 'x', text: 'lib' });
  await engine.markDirty('library', 'all');
  await engine.processQueue();
  const st = await engine.getStatus('library', 'all');
  assert.equal(fd.files.get(st.files.json).appProperties.rcKind, 'exercise');
  assert.equal(fd.files.get(st.files.json).appProperties.rcId, 'all');
  const idx = buildRemoteIndex([...fd.files.values()]);
  assert.ok(idx.get('library:all').json);
});

test('ripristino: adopt segna "sincronizzato" senza caricare nulla; pending rimette in coda sugli stessi file', async () => {
  const { fd, engine, records } = setup();
  records.set('session:r', { date: 'd', text: 'x' });
  const calls = fd.calls.length;
  await engine.adopt('session', 'r', { json: 'fx', 'docx-plan': 'fy' }, { folderId: 'folder1' });
  assert.equal((await engine.getStatus('session', 'r')).status, SYNC_STATUS.SYNCED);
  assert.equal((await engine.pending()).length, 0);
  assert.equal(fd.calls.length, calls, 'nessuna chiamata a Drive');
  await engine.adopt('session', 'r', {}, { pending: true });
  assert.equal((await engine.getStatus('session', 'r')).status, SYNC_STATUS.PENDING);
});

test('collegamento in un tocco: crea "Rugby Coach" nella radice la prima volta, poi la ritrova (nessun duplicato)', async () => {
  const fd = fakeDrive();
  const drive = createDriveClient({ fetch: fd.fetch, getToken: async () => 'tok' });
  const a = await findOrCreateAppFolder(drive);
  assert.equal(a.created, true);
  const f = fd.files.get(a.folder.id);
  assert.equal(f.name, 'Rugby Coach');
  assert.equal(f.mimeType, FOLDER_MIME);
  assert.ok(!f.parents, 'nella radice del Drive');
  assert.deepEqual(f.appProperties, { rcApp: 'rugby-coach', rcKind: 'folder' });
  // un file .json dell'app nella stessa cartella non deve essere scambiato per la cartella
  fd.files.set('j1', { id: 'j1', name: 'x.json', mimeType: 'application/json', parents: [a.folder.id], appProperties: { rcApp: 'rugby-coach', rcKind: 'session', rcId: 's' } });
  const b = await findOrCreateAppFolder(drive); // secondo telefono / ricollegamento
  assert.equal(b.created, false);
  assert.equal(b.folder.id, a.folder.id);
  assert.equal([...fd.files.values()].filter((x) => x.mimeType === FOLDER_MIME).length, 1);
  // se per qualche motivo ce ne sono due, si usa la più vecchia
  fd.files.set('zz', { id: 'zz', name: 'Rugby Coach', mimeType: FOLDER_MIME, createdTime: '2030-01-01T00:00:00Z', appProperties: { rcApp: 'rugby-coach', rcKind: 'folder' } });
  assert.equal((await findOrCreateAppFolder(drive)).folder.id, a.folder.id);
});

test('eliminazione di una scheda: offline resta in coda; poi tutti i suoi file vanno nel CESTINO di Drive (404 = fatto)', async () => {
  const { fd, engine, records } = setup();
  records.set('session:s', { date: 'd', text: '1' });
  await engine.markDirty('session', 's');
  await engine.processQueue();
  const ids = (await engine.getStatus('session', 's')).files;
  assert.ok(ids['docx-plan'] && ids.json);
  records.delete('session:s');
  fd.state.online = false;
  await engine.markDeleted('session', 's');
  let sum = await engine.processQueue();
  assert.equal(sum.skipped, 'offline');
  assert.equal((await engine.getStatus('session', 's')).deleted, true, 'in coda');
  assert.ok(Object.values(ids).every((id) => !fd.files.get(id).trashed));
  fd.state.online = true;
  fd.files.delete(ids.json); // un file già sparito: non è un errore
  sum = await engine.processQueue();
  assert.equal(sum.errors, 0);
  assert.equal(fd.files.get(ids['docx-plan']).trashed, true, 'docx nel cestino (non cancellato)');
  assert.equal(await engine.getStatus('session', 's'), undefined, 'voce tolta dalla coda');
});

test('eliminazione su un telefono che non conosce gli id: i file vengono ritrovati dalle etichette e cestinati', async () => {
  const { fd, engine, records, store } = setup();
  records.set('plan:p', { date: 'd', text: 'piano' });
  await engine.markDirty('plan', 'p');
  await engine.processQueue();
  const ids = Object.values((await engine.getStatus('plan', 'p')).files);
  await store.delete('plan:p'); // altro telefono: nessun id noto
  records.delete('plan:p');
  await engine.markDeleted('plan', 'p');
  await engine.processQueue();
  assert.ok(ids.every((id) => fd.files.get(id).trashed));
});

test('documento non più prodotto (vecchio .docx dell\'osservazione) va nel cestino, il .json non lo elenca più', async () => {
  const { fd, records } = setup();
  let two = true;
  records.set('session:x', { date: 'd', text: 'a' });
  // il primo giro produce due docx (come la versione 1.3), il secondo uno solo
  const drive = createDriveClient({ fetch: fd.fetch, getToken: async () => 'tok' });
  const store = memStore();
  const eng = createSyncEngine({
    store, drive, getRecord: async (k, id) => records.get(k + ':' + id), getFolderId: async () => 'folder1',
    buildArtifacts: async (kind, rec) => [
      { key: 'docx-plan', name: 'A.docx', mimeType: DOCX_MIME, data: 'P' },
      ...(two ? [{ key: 'docx-observation', name: 'B.docx', mimeType: DOCX_MIME, data: 'O' }] : []),
      { key: 'json', name: 'A.json', mimeType: 'application/json', data: '{}' },
    ],
  });
  await eng.markDirty('session', 'x');
  await eng.processQueue();
  const first = (await eng.getStatus('session', 'x')).files;
  assert.ok(first['docx-observation']);
  two = false;
  await eng.markDirty('session', 'x');
  await eng.processQueue();
  const st = await eng.getStatus('session', 'x');
  assert.equal(st.files['docx-observation'], undefined);
  assert.equal(fd.files.get(first['docx-observation']).trashed, true);
  assert.equal(fd.files.get(st.files.json).appProperties['rcF_docx-observation'], undefined);
});

test('A elimina, B (che conosce i file) modifica DOPO: il PATCH toglie dal cestino TUTTI i file della scheda', async () => {
  const { fd, engine, records } = setup();
  records.set('session:c', { date: 'd', text: 'v1' });
  await engine.markDirty('session', 'c');
  await engine.processQueue();
  const ids = (await engine.getStatus('session', 'c')).files;
  for (const id of Object.values(ids)) fd.files.get(id).trashed = true; // A li ha messi nel cestino
  records.set('session:c', { date: 'd', text: 'v2 di B' });
  await engine.markDirty('session', 'c');
  const sum = await engine.processQueue();
  assert.equal(sum.synced, 1);
  for (const id of Object.values(ids)) assert.equal(fd.files.get(id).trashed, false, 'fuori dal cestino: ' + id);
  assert.equal(fd.files.get(ids['docx-plan']).content, 'DOCX:v2 di B');
  assert.equal([...fd.files.values()].filter((f) => f.appProperties && !f.trashed).length, 2, 'nessun duplicato');
});

test('drive client: se Drive lascia il file nel cestino dopo il PATCH, lo toglie con un secondo aggiornamento', async () => {
  const fd = fakeDrive();
  fd.state.ignoreUntrash = true;
  const drive = createDriveClient({ fetch: fd.fetch, getToken: async () => 'tok' });
  fd.files.set('folder1', { id: 'folder1', mimeType: FOLDER_MIME, name: 'Rugby Coach' });
  const f = await drive.uploadFile({ name: 'a.docx', mimeType: DOCX_MIME, parents: ['folder1'], data: 'x' });
  fd.files.get(f.id).trashed = true;
  const res = await drive.uploadFile({ fileId: f.id, name: 'a.docx', mimeType: DOCX_MIME, data: 'y', untrash: true });
  assert.equal(res.trashed, false);
  assert.equal(fd.files.get(f.id).trashed, false);
  assert.ok(fd.calls.some((c) => c.method === 'PATCH' && !c.path.startsWith('/upload/') && c.path.endsWith('/files/' + f.id)));
});

test('"File per l\'app": ritrovata o creata una volta; due cartelle create insieme -> resta la più vecchia, i file passano lì', async () => {
  const fd = fakeDrive();
  const drive = createDriveClient({ fetch: fd.fetch, getToken: async () => 'tok' });
  fd.files.set('root', { id: 'root', mimeType: FOLDER_MIME, name: 'Rugby Coach', appProperties: { rcApp: 'rugby-coach', rcKind: 'folder' } });
  const a = await findOrCreateDataFolder(drive, 'root');
  assert.equal(a.created, true);
  assert.equal(fd.files.get(a.id).name, "File per l'app");
  assert.deepEqual(fd.files.get(a.id).parents, ['root']);
  const again = await findOrCreateDataFolder(drive, 'root');
  assert.equal(again.id, a.id); assert.equal(again.created, false);
  // un secondo telefono ne ha creata un'altra nello stesso momento, con un .json dentro
  const b = await drive.createFolder("File per l'app", { parentId: 'root', appProperties: { rcApp: 'rugby-coach', rcKind: 'dataFolder' } });
  const j = await drive.uploadFile({ name: 'x.json', mimeType: 'application/json', parents: [b.id], appProperties: { rcApp: 'rugby-coach', rcKind: 'session', rcId: 'x', rcVariant: 'json' }, data: '{}' });
  const win = await findOrCreateDataFolder(drive, 'root');
  assert.equal(win.id, a.id, 'vince la più vecchia');
  assert.equal(fd.files.get(b.id).trashed, true, 'la doppia nel cestino');
  assert.deepEqual(fd.files.get(j.id).parents, [a.id], 'il suo .json spostato (stesso id)');
});

test('migrazione dei .json dalla cartella principale: spostati (stessi id), idempotente, ripresa dopo un\'interruzione; i Word restano', async () => {
  const fd = fakeDrive();
  const drive = createDriveClient({ fetch: fd.fetch, getToken: async () => 'tok' });
  fd.files.set('root', { id: 'root', mimeType: FOLDER_MIME, name: 'Rugby Coach' });
  fd.files.set('data', { id: 'data', mimeType: FOLDER_MIME, name: "File per l'app", parents: ['root'] });
  const ids = [];
  for (const k of ['a', 'b', 'c', 'd']) ids.push((await drive.uploadFile({ name: k + '.json', mimeType: 'application/json', parents: ['root'], appProperties: { rcApp: 'rugby-coach', rcKind: 'session', rcId: k, rcVariant: 'json' }, data: '{}' })).id);
  const doc = (await drive.uploadFile({ name: 'a.docx', mimeType: DOCX_MIME, parents: ['root'], appProperties: { rcApp: 'rugby-coach', rcKind: 'session', rcId: 'a', rcVariant: 'docx-plan' }, data: 'x' })).id;
  const n0 = fd.files.size;
  fd.state.moveBudget = 2; // Drive in errore dopo 2 spostamenti
  await assert.rejects(moveRootJson(drive, 'root', 'data'));
  assert.equal(ids.filter((id) => fd.files.get(id).parents[0] === 'data').length, 2, 'interrotta a metà');
  fd.state.moveBudget = null;
  const r = await moveRootJson(drive, 'root', 'data');
  assert.equal(r.moved, 2, 'riprende solo quelli rimasti');
  for (const id of ids) assert.deepEqual(fd.files.get(id).parents, ['data']);
  assert.deepEqual(fd.files.get(doc).parents, ['root'], 'il Word resta nella cartella principale');
  assert.equal(fd.files.size, n0, 'nessuna copia');
  assert.deepEqual(await moveRootJson(drive, 'root', 'data'), { moved: 0, found: 0 }, 'idempotente');
});

test('coda: i .json nuovi in "File per l\'app", i Word nella cartella; un .json ancora nella cartella principale viene ritrovato (niente doppio)', async () => {
  const fd = fakeDrive();
  const drive = createDriveClient({ fetch: fd.fetch, getToken: async () => 'tok' });
  fd.files.set('folder1', { id: 'folder1', mimeType: FOLDER_MIME, name: 'Rugby Coach' });
  fd.files.set('data', { id: 'data', mimeType: FOLDER_MIME, name: "File per l'app", parents: ['folder1'] });
  const records = new Map([['session:n', { date: 'd', text: 'nuova' }], ['session:old', { date: 'e', text: 'vecchia' }]]);
  // .json di una versione precedente, ancora nella cartella principale
  const oldJson = await drive.uploadFile({ name: 'e.json', mimeType: 'application/json', parents: ['folder1'], appProperties: { rcApp: 'rugby-coach', rcKind: 'session', rcId: 'old', rcVariant: 'json' }, data: '{}' });
  const listBoth = async () => [...await drive.listAppFiles('data'), ...await drive.listAppFiles('folder1')];
  const eng = createSyncEngine({
    store: memStore(), drive, getRecord: async (k, id) => records.get(k + ':' + id), getFolderId: async () => 'folder1', getJsonFolderId: async () => 'data', listRemote: listBoth,
    buildArtifacts: async (kind, rec) => [
      { key: 'docx-plan', name: rec.date + '.docx', mimeType: DOCX_MIME, data: rec.text },
      { key: 'json', name: rec.date + '.json', mimeType: 'application/json', data: JSON.stringify(rec) },
    ],
  });
  await eng.markDirty('session', 'n'); await eng.markDirty('session', 'old');
  await eng.processQueue();
  const n = (await eng.getStatus('session', 'n')).files;
  assert.deepEqual(fd.files.get(n.json).parents, ['data']);
  assert.deepEqual(fd.files.get(n['docx-plan']).parents, ['folder1']);
  assert.equal((await eng.getStatus('session', 'old')).files.json, oldJson.id, 'stesso .json, non un doppio');
  assert.equal([...fd.files.values()].filter((f) => f.mimeType === 'application/json').length, 2);
});
