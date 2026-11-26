// E2E "File per l'app": i .json dell'app stanno nella sottocartella "Rugby Coach/File per l'app",
// nella cartella principale solo i documenti Word. Drive finto condiviso, più telefoni.
// - X e Y usano la versione 1.4.1 (commit 234a979): .json nella cartella principale;
// - aggiornamento alla versione nuova SULLO STESSO indirizzo (stessi dati del telefono), X e Y insieme:
//   un'unica "File per l'app" anche se la creano in due; spostamento interrotto (Drive in errore) e ripreso;
//   eliminazione durante lo spostamento; alla fine nessun .json nella cartella principale, stessi file (stessi id);
// - Z, telefono nuovo: recupera tutto da "File per l'app", senza creare nulla di doppio.
// Uso: node tests/e2e-datafolder.mjs
import { spawn, execSync } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const { chromium } = await import('playwright-core');
const PORT = Number(process.env.PORT || 8097);
const BASE = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p));
const OLD = fs.mkdtempSync(path.join(os.tmpdir(), 'rc141-'));
execSync(`git archive 234a979 app | tar -x -C ${OLD}`, { cwd: ROOT });
let server = null;
async function serve(dir) {
  if (server) { server.kill(); await new Promise((r) => setTimeout(r, 400)); }
  server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: dir, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 700));
}

// ---------- Drive finto ----------
const FOLDER = 'application/vnd.google-apps.folder';
const drive = { files: new Map(), n: 0, moves: 0, moveBudget: null, failedMoves: 0 };
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const partsOf = (buf) => {
  const s = buf.toString('latin1');
  const b = /^--([^\r\n]+)/.exec(s)[1];
  return s.split('--' + b).slice(1, -1).map((p) => p.slice(p.indexOf('\r\n\r\n') + 4, p.length - 2));
};
async function driveRoute(route) {
  const req = route.request();
  const u = new URL(req.url());
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  const json = (obj, status = 200) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(obj) });
  if (!/^Bearer tok/.test(req.headers().authorization || '')) return json({ error: { message: 'Invalid Credentials' } }, 401);
  if (u.pathname === '/drive/v3/about') return json({ user: { emailAddress: 'allenatore@example.com' } });
  if (u.pathname === '/drive/v3/files' && req.method() === 'POST') {
    const meta = JSON.parse(req.postData());
    if (meta.parents && !drive.files.has(meta.parents[0])) return json({ error: { message: 'File not found' } }, 404);
    const id = 'fold' + (++drive.n);
    drive.files.set(id, { ...meta, id, createdTime: new Date(1.7e12 + drive.n * 1000).toISOString() });
    return json({ id, name: meta.name });
  }
  if (u.pathname === '/drive/v3/files' && req.method() === 'GET') {
    const q = u.searchParams.get('q') || '';
    const parent = /'([^']+)' in parents/.exec(q)?.[1];
    const mime = /mimeType='([^']+)'/.exec(q)?.[1];
    const props = [...q.matchAll(/appProperties has \{ key='(\w+)' and value='([^']*)' \}/g)];
    const list = [...drive.files.values()].filter((f) => !f.trashed && !inTrashedFolder(f) && f.appProperties && (!parent || (f.parents || []).includes(parent))
      && props.every(([, k, v]) => f.appProperties[k] === v) && (!mime || f.mimeType === mime));
    return json({ files: list.map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, createdTime: f.createdTime, version: String(f.version || 1), parents: f.parents, appProperties: f.appProperties })) });
  }
  const one = /^\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname);
  if (one && req.method() === 'GET') {
    const f = drive.files.get(one[1]);
    if (!f) return json({ error: { message: 'File not found' } }, 404);
    if (u.searchParams.get('alt') === 'media') return route.fulfill({ status: 200, headers: cors, body: f.content ?? '' });
    return json({ id: f.id, name: f.name, trashed: !!f.trashed || inTrashedFolder(f), parents: f.parents });
  }
  if (one && req.method() === 'PATCH') {
    const f = drive.files.get(one[1]);
    if (!f) return json({ error: { message: 'File not found' } }, 404);
    const add = u.searchParams.get('addParents'); const remove = u.searchParams.get('removeParents');
    if (add || remove) {
      if (drive.moveBudget !== null && drive.moveBudget <= 0) { drive.failedMoves++; return json({ error: { message: 'Backend Error' } }, 503); }
      if (drive.moveBudget !== null) drive.moveBudget--;
      drive.moves++;
      f.parents = [...(f.parents || []).filter((x) => x !== remove), ...(add && !(f.parents || []).includes(add) ? [add] : [])];
    }
    Object.assign(f, JSON.parse(req.postData() || '{}'));
    return json({ id: f.id, trashed: !!f.trashed, parents: f.parents });
  }
  if (u.pathname === '/upload/drive/v3/files' && req.method() === 'POST') {
    const [m, c] = partsOf(req.postDataBuffer());
    const meta = JSON.parse(m);
    if (meta.parents && !drive.files.has(meta.parents[0])) return json({ error: { message: 'File not found' } }, 404);
    const id = 'f' + (++drive.n);
    drive.files.set(id, { ...meta, id, version: 1, content: Buffer.from(c, 'latin1').toString('utf8') });
    return json({ id, name: meta.name, version: '1' });
  }
  const pm = /^\/upload\/drive\/v3\/files\/(.+)$/.exec(u.pathname);
  if (pm && req.method() === 'PATCH') {
    const f = drive.files.get(pm[1]);
    if (!f) return json({ error: { message: 'File not found' } }, 404);
    const [m, c] = partsOf(req.postDataBuffer());
    Object.assign(f, JSON.parse(m), { version: f.version + 1, content: Buffer.from(c, 'latin1').toString('utf8') });
    return json({ id: f.id, name: f.name, trashed: !!f.trashed, version: String(f.version) });
  }
  return json({ error: { message: 'non simulato ' + u.pathname } }, 404);
}
function inTrashedFolder(f) { return (f.parents || []).some((p) => drive.files.get(p)?.trashed); }
const live = () => [...drive.files.values()].filter((f) => !f.trashed && !inTrashedFolder(f));
const mainFolder = () => live().find((f) => f.mimeType === FOLDER && f.appProperties?.rcKind === 'folder');
const dataFolders = () => live().filter((f) => f.mimeType === FOLDER && f.appProperties?.rcKind === 'dataFolder');
const jsons = () => live().filter((f) => f.mimeType === 'application/json');
const jsonInRoot = () => jsons().filter((f) => (f.parents || []).includes(mainFolder().id));
const filesOf = (id) => [...drive.files.values()].filter((f) => f.appProperties?.rcId === id);

const GIS_STUB = `
window.google = window.google || {};
window.__gis = { requests: [] };
google.accounts = { oauth2: {
  initTokenClient(cfg) { return { requestAccessToken(o) { __gis.requests.push((o && o.prompt) ?? null);
    setTimeout(() => cfg.callback({ access_token: 'tok-' + __gis.requests.length, expires_in: 3599, scope: cfg.scope }), 30); } }; },
  hasGrantedAllScopes(resp, s) { return (resp.scope || '').split(' ').includes(s); },
  revoke(t, cb) { cb && cb(); },
} };`;
const CONFIG = `export default { clientId: '999-test.apps.googleusercontent.com' };`;
const errors = [];
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
async function device(name, { phone = false } = {}) {
  const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1366, height: 768 }, hasTouch: phone, locale: 'it-IT', serviceWorkers: 'block' });
  await ctx.route(BASE + 'config.js', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: CONFIG }));
  await ctx.route('https://accounts.google.com/gsi/client', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: GIS_STUB }));
  await ctx.route('https://apis.google.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '/* stub */' }));
  await ctx.route('https://www.googleapis.com/**', driveRoute);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(name + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push(name + ' pageerror: ' + e.message));
  return page;
}
const ready = (p) => p.waitForFunction(() => window.__rcReady === true, null, { timeout: 20000 });
const settle = (p, ms = 800) => p.waitForTimeout(ms);
async function waitUntil(fn, what, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await fn()) return; await new Promise((r) => setTimeout(r, 400)); }
  throw new Error('tempo scaduto: ' + what);
}
async function connect(p) {
  await p.goto(BASE); await ready(p);
  await p.getByRole('button', { name: 'Collega Google Drive' }).first().click();
  await p.getByRole('heading', { name: 'Fatto!' }).waitFor({ timeout: 20000 });
  await p.getByRole('button', { name: 'Inizia' }).click();
  await p.waitForURL(/#\/$/);
}
async function newSession(p, date, name) {
  await p.goto(BASE + '#/'); await ready(p);
  await p.getByRole('button', { name: '+ Nuovo allenamento' }).click();
  await p.waitForURL(/seduta\/([^/]+)/);
  const id = /seduta\/([^/]+)/.exec(p.url())[1];
  await p.getByLabel('Data allenamento').fill(date);
  await p.getByRole('button', { name: '+ Aggiungi esercizio' }).click();
  await p.getByLabel('Nome esercizio 1').fill(name);
  await settle(p);
  return id;
}
async function saveAll(p) {
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    await p.goto(BASE + '#/impostazioni'); await ready(p); await settle(p, 400);
    if (await p.getByText('Tutto salvato su Drive ✓').count()) return;
    const b = p.getByRole('button', { name: '☁ Salva su Drive adesso' });
    if (await b.count()) await b.click();
    await settle(p, 1500);
  }
  throw new Error('non salvato su Drive');
}
async function deleteSession(p, dateLabel) {
  await p.goto(BASE + '#/'); await ready(p);
  const card = p.locator('.rec-card', { hasText: dateLabel });
  await card.getByRole('button', { name: 'Altre azioni' }).click();
  await card.getByRole('button', { name: '🗑 Elimina' }).click();
  await p.locator('dialog.modal').getByRole('button', { name: 'Elimina' }).click();
}
const localIds = (p, st) => p.evaluate((s) => new Promise((res) => { const r = indexedDB.open('rugby-coach'); r.onsuccess = () => { const g = r.result.transaction(s).objectStore(s).getAll(); g.onsuccess = () => res(g.result.map((x) => x.id)); }; }), st);
const localNames = (p, st) => p.evaluate((s) => new Promise((res) => { const r = indexedDB.open('rugby-coach'); r.onsuccess = () => { const g = r.result.transaction(s).objectStore(s).getAll(); g.onsuccess = () => res(g.result.map((x) => x.name)); }; }), st);

let ok = false;
try {
  console.log('• versione 1.4.1: X crea schede, esercizio, giocatore, ne elimina una → i .json stanno nella cartella principale');
  await serve(path.join(OLD, 'app'));
  const X = await device('X', { phone: true });
  await connect(X);
  const s1 = await newSession(X, '2026-11-01', 'Primo');
  const s2 = await newSession(X, '2026-11-02', 'Secondo');
  const s3 = await newSession(X, '2026-11-03', 'Terzo');
  await X.goto(BASE + '#/libreria'); await ready(X);
  await X.getByRole('button', { name: '+ Nuovo esercizio' }).click(); await X.waitForURL(/esercizio\//);
  await X.getByLabel('Nome', { exact: true }).fill('Esercizio di X'); await settle(X);
  await X.goto(BASE + '#/rosa?cat=U8'); await ready(X);
  await X.getByLabel('Nome nuovo giocatore').fill('Giocatore di X');
  await X.getByRole('button', { name: '+ Aggiungi' }).click(); await settle(X);
  await deleteSession(X, '03/11/2026');
  await saveAll(X);
  await waitUntil(() => filesOf(s3).every((f) => f.trashed), 'v1.4.1: scheda eliminata nel cestino');
  assert.equal(dataFolders().length, 0, 'la 1.4.1 non ha "File per l\'app"');
  const before = jsons().filter((f) => (f.parents || []).includes(mainFolder().id));
  assert.ok(before.length >= 5, 'json nella radice: ' + before.map((f) => f.name).join(', '));
  const beforeIds = new Set(before.map((f) => f.id));
  console.log('  .json nella cartella principale:', before.length);
  const Y = await device('Y');
  await connect(Y);
  assert.ok((await localIds(Y, 'sessions')).includes(s1), 'Y (1.4.1) recupera');

  console.log('• aggiornamento: X e Y aprono INSIEME la versione nuova, Drive in errore dopo 1 spostamento (interrotto)');
  await serve(path.join(ROOT, 'app'));
  drive.moveBudget = 1;
  await Promise.all([X.reload(), Y.reload()]);
  await Promise.all([ready(X), ready(Y)]);
  await waitUntil(() => drive.failedMoves > 0, 'spostamento interrotto');
  await settle(X, 3000);
  assert.equal(dataFolders().length, 1, 'una sola "File per l\'app" anche se creata da due telefoni insieme');
  assert.deepEqual(dataFolders()[0].parents, [mainFolder().id]);
  assert.ok(jsonInRoot().length > 0, `interrotta: ${jsonInRoot().length} ancora nella radice`);
  assert.equal(jsons().length, before.length, 'nessuna copia');

  console.log('• eliminazione DURANTE lo spostamento: i file della scheda vanno nel cestino da dove sono');
  await deleteSession(X, '02/11/2026');
  await waitUntil(() => filesOf(s2).length >= 2 && filesOf(s2).every((f) => f.trashed), 'scheda eliminata durante lo spostamento nel cestino');

  console.log('• Drive di nuovo a posto: lo spostamento riprende (X e Y insieme) e finisce');
  drive.moveBudget = null;
  await Promise.all([X.reload(), Y.reload()]);
  await Promise.all([ready(X), ready(Y)]);
  await waitUntil(() => jsonInRoot().length === 0, 'nessun .json nella cartella principale');
  await settle(X, 4000);
  const data = dataFolders();
  assert.equal(data.length, 1);
  const after = jsons();
  for (const f of after) assert.ok((f.parents || []).includes(data[0].id), f.name + ' fuori da "File per l\'app"');
  assert.ok(live().filter((f) => f.mimeType !== 'application/json' && f.mimeType !== FOLDER).every((f) => (f.parents || []).includes(mainFolder().id)), 'i Word restano nella cartella principale');
  // stessi file (stessi id), nessuna copia: i .json di prima sono stati spostati, non ricreati
  const stillLive = [...beforeIds].filter((id) => !drive.files.get(id).trashed);
  for (const id of stillLive) assert.ok(after.some((f) => f.id === id), 'spostato (stesso id): ' + drive.files.get(id).name);
  const names = after.map((f) => f.name);
  assert.equal(new Set(names).size, names.length, 'nessun .json doppio: ' + names.join(' | '));
  assert.ok(after.some((f) => f.name.includes('Eliminati')), 'indice delle eliminazioni in "File per l\'app"');
  // una modifica dopo lo spostamento aggiorna lo stesso file
  const j1 = after.find((f) => f.appProperties?.rcId === s1);
  await X.goto(BASE + '#/seduta/' + s1 + '/foglio'); await ready(X);
  await X.getByLabel('Nome esercizio 1').fill('Primo (modificato)');
  await waitUntil(() => JSON.parse(drive.files.get(j1.id).content).record.planItems[0].name === 'Primo (modificato)', 'stesso .json aggiornato');
  assert.ok((drive.files.get(j1.id).parents || []).includes(data[0].id));

  console.log('• Z, telefono nuovo: recupera tutto da "File per l\'app", niente di doppio');
  const nBefore = live().length;
  const Z = await device('Z', { phone: true });
  await connect(Z);
  await settle(Z, 4000);
  const zs = await localIds(Z, 'sessions');
  assert.ok(zs.includes(s1) && !zs.includes(s2) && !zs.includes(s3), 'Z: schede giuste ' + zs.join(','));
  assert.ok((await localNames(Z, 'exercises')).includes('Esercizio di X'), 'Z: libreria');
  assert.ok((await localNames(Z, 'players')).includes('Giocatore di X'), 'Z: rosa');
  assert.equal(dataFolders().length, 1);
  assert.equal(jsonInRoot().length, 0);
  assert.equal(live().length, nBefore, 'il nuovo telefono non crea file');
  ok = true;
} finally {
  await browser.close();
  if (server) server.kill();
  fs.rmSync(OLD, { recursive: true, force: true });
  console.log('Errori in console:', errors.length ? errors : 'nessuno');
}
if (!ok || errors.length) process.exit(1);
console.log('E2E "File per l\'app" OK');
