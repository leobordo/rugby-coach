// E2E a più dispositivi con un Google Drive finto condiviso (Playwright + Chrome).
// D1 e D2 modificano libreria esercizi e rosa (aggiunte concorrenti + una cancellazione); D3 ripristina.
// Uso: node tests/e2e-multidevice.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const { chromium } = await import('playwright-core');
const SHOTS = path.join(ROOT, 'out', 'screens');
fs.mkdirSync(SHOTS, { recursive: true });
const PORT = Number(process.env.PORT || 8098);
const BASE = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME || ['/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => fs.existsSync(p));
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: path.join(ROOT, 'app'), stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));

// ---------- Drive finto condiviso ----------
const drive = { files: new Map(), n: 0, calls: [] };
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
  drive.calls.push(req.method() + ' ' + u.pathname);
  if (u.pathname === '/drive/v3/about') return json({ user: { emailAddress: 'coach@example.com' } });
  if (u.pathname === '/drive/v3/files' && req.method() === 'POST') { drive.files.set('folder1', { id: 'folder1', ...JSON.parse(req.postData()) }); return json({ id: 'folder1', name: 'Rugby Coach' }); }
  if (u.pathname === '/drive/v3/files' && req.method() === 'GET') {
    const q = u.searchParams.get('q') || '';
    const parent = /'([^']+)' in parents/.exec(q)?.[1];
    const props = [...q.matchAll(/appProperties has \{ key='(\w+)' and value='([^']*)' \}/g)];
    const list = [...drive.files.values()].filter((f) => f.appProperties && (!parent || (f.parents || []).includes(parent))
      && props.every(([, k, v]) => f.appProperties[k] === v) && (!/mimeType='application\/json'/.test(q) || f.mimeType === 'application/json'));
    return json({ files: list.map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, version: String(f.version), parents: f.parents, appProperties: f.appProperties })) });
  }
  const media = /^\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname);
  if (media && u.searchParams.get('alt') === 'media') return route.fulfill({ status: 200, headers: cors, body: drive.files.get(media[1])?.content ?? '' });
  if (u.pathname === '/upload/drive/v3/files' && req.method() === 'POST') {
    const [m, c] = partsOf(req.postDataBuffer());
    const id = 'f' + (++drive.n);
    drive.files.set(id, { ...JSON.parse(m), id, version: 1, content: Buffer.from(c, 'latin1').toString('utf8') });
    return json({ id, name: JSON.parse(m).name });
  }
  const pm = /^\/upload\/drive\/v3\/files\/(.+)$/.exec(u.pathname);
  if (pm && req.method() === 'PATCH') {
    const f = drive.files.get(pm[1]);
    if (!f) return json({ error: { message: 'File not found' } }, 404);
    const [m, c] = partsOf(req.postDataBuffer());
    Object.assign(f, JSON.parse(m), { version: f.version + 1, content: Buffer.from(c, 'latin1').toString('utf8') });
    return json({ id: f.id, name: f.name });
  }
  return json({ error: { message: 'non simulato ' + u.pathname } }, 404);
}
const collection = (rcKind) => {
  const f = [...drive.files.values()].filter((x) => x.appProperties?.rcKind === rcKind && x.appProperties?.rcId === 'all' && x.mimeType === 'application/json');
  assert.equal(f.length, 1, 'un solo file ' + rcKind);
  const obj = JSON.parse(f[0].content);
  return { names: obj.data[rcKind === 'exercise' ? 'exercises' : 'players'].map((x) => x.name), tombs: obj.tombstones };
};

// ---------- dispositivi ----------
const CONFIG = `export default { clientId: '999-test.apps.googleusercontent.com', apiKey: 'AIzaTEST', appId: '123456789012' };`;
const errors = [];
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
async function device(name) {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, locale: 'it-IT' });
  await ctx.route(BASE + 'config.js', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: CONFIG }));
  await ctx.route(/https:\/\/(accounts|apis)\.google\.com\//, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '/* stub */' }));
  await ctx.route('https://www.googleapis.com/**', driveRoute);
  // token OAuth finto (il popup di Google non è simulabile qui); l'app lo sposta in sessionStorage
  await ctx.addInitScript(() => {
    if (!sessionStorage.getItem('e2e-init')) {
      sessionStorage.setItem('e2e-init', '1');
      localStorage.setItem('rc.google.token', JSON.stringify({ access_token: 'tok', expiresAt: Date.now() + 3600e3 }));
    }
  });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(name + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push(name + ' pageerror: ' + e.message));
  page.on('dialog', (d) => d.accept());
  return page;
}
const ready = (p) => p.waitForFunction(() => window.__rcReady === true, null, { timeout: 20000 });
const settle = (p, ms = 900) => p.waitForTimeout(ms);
async function connect(p) {
  await p.goto(BASE); await ready(p);
  await p.getByRole('button', { name: '＋ Crea cartella dedicata' }).click(); // il finto Drive restituisce sempre folder1
  await p.waitForURL(/#\/$/);
}
async function addExercise(p, name) {
  await p.goto(BASE + '#/libreria'); await ready(p);
  await p.getByRole('button', { name: '+ Nuovo esercizio' }).click();
  await p.waitForURL(/esercizio\//);
  await p.getByLabel('Nome', { exact: true }).fill(name);
  await settle(p);
}
async function addPlayer(p, name) {
  await p.goto(BASE + '#/rosa?cat=U8'); await ready(p);
  await p.getByLabel('Nome nuovo giocatore').fill(name);
  await p.getByRole('button', { name: '+ Aggiungi' }).click();
  await p.waitForFunction((n) => [...document.querySelectorAll('.player-row input')].some((i) => i.value === n), name);
}
async function syncNow(p) {
  await p.goto(BASE + '#/impostazioni'); await ready(p);
  await p.getByRole('button', { name: '☁ Sincronizza ora' }).click();
  await p.waitForFunction(() => document.querySelector('.queue li') && !document.querySelector('.queue .status-pill.pending, .queue .status-pill.syncing, .queue .status-pill.error'), null, { timeout: 25000 });
  await settle(p, 500);
}
async function restore(p) {
  await p.goto(BASE + '#/impostazioni'); await ready(p);
  await p.getByRole('button', { name: '⇩ Ripristina dai backup .json su Drive' }).click();
  await p.getByText(/Ripristino:/).waitFor({ timeout: 20000 });
  await settle(p, 1500);
}
const localNames = (p, store) => p.evaluate((st) => new Promise((res) => { const r = indexedDB.open('rugby-coach'); r.onsuccess = () => { const g = r.result.transaction(st).objectStore(st).getAll(); g.onsuccess = () => res(g.result.map((x) => x.name)); }; }), store);

let ok = false;
try {
  console.log('• D1: collega Drive, aggiunge esercizio e giocatore');
  const d1 = await device('D1');
  await connect(d1);
  await addExercise(d1, 'Esercizio D1');
  await addPlayer(d1, 'Giocatore D1');
  await syncNow(d1);
  assert.ok(collection('exercise').names.includes('Esercizio D1'));
  assert.deepEqual(collection('player').names, ['Giocatore D1']);

  console.log('• D2: nuovo dispositivo, ripristina, aggiunge e CANCELLA un esempio');
  const d2 = await device('D2');
  await connect(d2);
  await restore(d2);
  assert.ok((await localNames(d2, 'exercises')).includes('Esercizio D1'), 'D2 ha la libreria di D1');
  await addExercise(d2, 'Esercizio D2');
  await addPlayer(d2, 'Giocatore D2');
  await d2.goto(BASE + '#/libreria'); await ready(d2);
  await d2.locator('.ex-card', { has: d2.locator('strong', { hasText: /^Fulmine$/ }) }).click();
  await d2.getByRole('button', { name: 'Elimina', exact: true }).click();
  await d2.locator('dialog.modal').getByRole('button', { name: 'Elimina' }).click();
  await d2.waitForURL(/#\/libreria$/);
  await syncNow(d2);
  let lib = collection('exercise');
  assert.ok(lib.names.includes('Esercizio D1') && lib.names.includes('Esercizio D2') && !lib.names.includes('Fulmine'), lib.names.join(', '));
  assert.ok(lib.tombs.exercise['seed-ex-fulmine'], 'tombstone della cancellazione nel .json');

  console.log('• D1 (non sa nulla di D2) aggiunge ancora e sincronizza: niente si perde');
  await addExercise(d1, 'Esercizio D1-bis');
  await addPlayer(d1, 'Giocatore D1-bis');
  await syncNow(d1);
  lib = collection('exercise');
  for (const n of ['Esercizio D1', 'Esercizio D2', 'Esercizio D1-bis']) assert.ok(lib.names.includes(n), 'su Drive manca ' + n + ': ' + lib.names.join(', '));
  assert.ok(!lib.names.includes('Fulmine'), 'la cancellazione di D2 non è stata annullata da D1');
  assert.deepEqual(collection('player').names.sort(), ['Giocatore D1', 'Giocatore D1-bis', 'Giocatore D2']);
  const d1ex = await localNames(d1, 'exercises');
  assert.ok(d1ex.includes('Esercizio D2') && !d1ex.includes('Fulmine'), 'il merge è applicato anche in locale su D1');
  const libDocx = [...drive.files.values()].filter((f) => f.appProperties?.rcVariant === 'docx-library');
  assert.equal(libDocx.length, 1, 'un solo .docx della libreria');
  assert.ok(libDocx[0].version >= 3, 'il .docx della libreria è rigenerato a ogni unione');

  console.log('• D3: terzo dispositivo, ripristina tutto');
  const d3 = await device('D3');
  await connect(d3);
  await restore(d3);
  const ex3 = await localNames(d3, 'exercises');
  for (const n of ['Esercizio D1', 'Esercizio D2', 'Esercizio D1-bis']) assert.ok(ex3.includes(n), 'D3 non ha ' + n);
  assert.ok(!ex3.includes('Fulmine'), 'D3 riceve anche la cancellazione');
  assert.deepEqual((await localNames(d3, 'players')).sort(), ['Giocatore D1', 'Giocatore D1-bis', 'Giocatore D2']);
  await d3.goto(BASE + '#/libreria'); await ready(d3);
  await d3.screenshot({ path: path.join(SHOTS, '22-terzo-dispositivo-libreria.png') });
  const names = [...drive.files.values()].filter((f) => f.id !== 'folder1').map((f) => f.name);
  assert.equal(new Set(names).size, names.length, 'nessun duplicato su Drive: ' + names.join(' | '));
  ok = true;
} finally {
  await browser.close();
  server.kill();
  console.log('Errori in console:', errors.length ? errors : 'nessuno');
}
if (!ok || errors.length) process.exit(1);
console.log('E2E multi-dispositivo OK');
