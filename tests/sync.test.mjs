// Drive + coda di sincronizzazione con un fetch finto (il Drive reale non è testabile senza Client ID).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDriveClient, buildMultipart, DriveAuthError, DOCX_MIME, FOLDER_MIME } from '../app/js/drive.js';
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
      files.set(fid, { id: fid, ...meta, content: null });
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
    if (opts.method === 'PATCH' && upload) {
      if (!files.has(id)) return json(404, { error: { message: 'File not found: ' + id } });
      const { meta, content } = await parseMultipart(opts.body, opts.headers['Content-Type']);
      assert.ok(!meta.parents, 'PATCH non deve mandare parents');
      const f = files.get(id);
      Object.assign(f, meta, { content, version: f.version + 1 });
      return json(200, { id, name: f.name });
    }
    if (opts.method === 'GET' && !id && !upload) {
      assert.equal(u.searchParams.get('supportsAllDrives'), 'true');
      assert.equal(u.searchParams.get('includeItemsFromAllDrives'), 'true');
      const q = u.searchParams.get('q') || '';
      const parent = /'([^']+)' in parents/.exec(q)?.[1];
      const list = [...files.values()].filter((f) => f.appProperties?.rcApp === 'rugby-coach' && (!parent || (f.parents || []).includes(parent)));
      state.lists = (state.lists || 0) + 1;
      return json(200, { files: list.map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, appProperties: f.appProperties })) });
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
