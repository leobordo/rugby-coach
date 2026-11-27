// E2E ricezione automatica: le modifiche fatte su un altro dispositivo dello stesso account arrivano da sole.
// Drive finto condiviso, 3 dispositivi (A telefono, B computer, C telefono), controllo ogni 3 s per i test.
// - A modifica → B (aperto, in primo piano) riceve senza azioni dopo il timer, e al ritorno in primo piano;
// - B con la stessa scheda aperta: avviso "aggiornata su un altro dispositivo", non perde quello che scrive (unione);
// - modifica concorrente su A e B → nessuna perdita (copia "conflitto del …");
// - eliminazione su A sparisce da B; "Tienila" su B la fa tornare su A; scheda nuova su C appare su A e B;
// - libreria e rosa; carico: a riposo solo la files.list; accesso scaduto: nessuna chiamata, nessuna finestra Google.
// Uso: node tests/e2e-receive.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = await import('playwright-core');
const SHOTS = path.join(ROOT, 'out', 'screens');
fs.mkdirSync(SHOTS, { recursive: true });
const PORT = Number(process.env.PORT || 8096);
const BASE = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p));
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: path.join(ROOT, 'app'), stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const PULL_MS = 3000;

// ---------- Drive finto (con version, cestino, spostamenti), chiamate contate per dispositivo ----------
const FOLDER = 'application/vnd.google-apps.folder';
const drive = { files: new Map(), n: 0 };
const calls = {};
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const partsOf = (buf) => {
  const s = buf.toString('latin1');
  const b = /^--([^\r\n]+)/.exec(s)[1];
  return s.split('--' + b).slice(1, -1).map((p) => p.slice(p.indexOf('\r\n\r\n') + 4, p.length - 2));
};
const driveRoute = (dev) => async (route) => {
  const req = route.request();
  const u = new URL(req.url());
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  const json = (obj, status = 200) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(obj) });
  const media = u.searchParams.get('alt') === 'media';
  (calls[dev] = calls[dev] || []).push(`${req.method()} ${u.pathname}${media ? ' media' : ''}${u.searchParams.get('q') ? ' list' : ''}`);
  if (!/^Bearer tok/.test(req.headers().authorization || '')) return json({ error: { message: 'Invalid Credentials' } }, 401);
  if (u.pathname === '/drive/v3/about') return json({ user: { emailAddress: 'allenatore@example.com' } });
  if (u.pathname === '/drive/v3/files' && req.method() === 'POST') {
    const meta = JSON.parse(req.postData());
    const id = 'fold' + (++drive.n);
    drive.files.set(id, { ...meta, id, createdTime: new Date(1.7e12 + drive.n * 1000).toISOString() });
    return json({ id, name: meta.name });
  }
  if (u.pathname === '/drive/v3/files' && req.method() === 'GET') {
    const q = u.searchParams.get('q') || '';
    const parent = /'([^']+)' in parents/.exec(q)?.[1];
    const mime = /mimeType='([^']+)'/.exec(q)?.[1];
    const props = [...q.matchAll(/appProperties has \{ key='(\w+)' and value='([^']*)' \}/g)];
    const list = [...drive.files.values()].filter((f) => !f.trashed && f.appProperties && (!parent || (f.parents || []).includes(parent))
      && props.every(([, k, v]) => f.appProperties[k] === v) && (!mime || f.mimeType === mime));
    return json({ files: list.map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, createdTime: f.createdTime, version: String(f.version || 1), parents: f.parents, appProperties: f.appProperties })) });
  }
  const one = /^\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname);
  if (one && req.method() === 'GET') {
    const f = drive.files.get(one[1]);
    if (!f) return json({ error: { message: 'File not found' } }, 404);
    if (media) return route.fulfill({ status: 200, headers: cors, body: f.content ?? '' });
    return json({ id: f.id, name: f.name, trashed: !!f.trashed, version: String(f.version || 1), parents: f.parents });
  }
  if (one && req.method() === 'PATCH') {
    const f = drive.files.get(one[1]);
    if (!f) return json({ error: { message: 'File not found' } }, 404);
    const add = u.searchParams.get('addParents'); const remove = u.searchParams.get('removeParents');
    if (add || remove) f.parents = [...(f.parents || []).filter((x) => x !== remove), ...(add && !(f.parents || []).includes(add) ? [add] : [])];
    Object.assign(f, JSON.parse(req.postData() || '{}'));
    return json({ id: f.id, trashed: !!f.trashed, parents: f.parents });
  }
  if (u.pathname === '/upload/drive/v3/files' && req.method() === 'POST') {
    const [m, c] = partsOf(req.postDataBuffer());
    const id = 'f' + (++drive.n);
    drive.files.set(id, { ...JSON.parse(m), id, version: 1, content: Buffer.from(c, 'latin1').toString('utf8') });
    return json({ id, name: JSON.parse(m).name, version: '1' });
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
};
const live = () => [...drive.files.values()].filter((f) => !f.trashed && f.mimeType !== FOLDER);
const sheetJson = (id) => live().find((f) => f.appProperties?.rcId === id && f.appProperties?.rcVariant === 'json');
const remoteRec = (id) => { const f = sheetJson(id); return f ? JSON.parse(f.content).record : null; };

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
  await ctx.addInitScript((ms) => { try { if (!localStorage.getItem('rc.pullEveryMs')) localStorage.setItem('rc.pullEveryMs', String(ms)); } catch { /* */ } }, PULL_MS);
  await ctx.route(BASE + 'config.js', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: CONFIG }));
  await ctx.route('https://accounts.google.com/gsi/client', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: GIS_STUB }));
  await ctx.route('https://apis.google.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '/* stub */' }));
  await ctx.route('https://www.googleapis.com/**', driveRoute(name));
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(name + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push(name + ' pageerror: ' + e.message));
  return page;
}
const ready = (p) => p.waitForFunction(() => window.__rcReady === true, null, { timeout: 20000 });
const settle = (p, ms = 800) => p.waitForTimeout(ms);
async function waitUntil(fn, what, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await fn()) return; await new Promise((r) => setTimeout(r, 300)); }
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
async function editName(p, id, value) {
  await p.goto(BASE + '#/seduta/' + id + '/foglio'); await ready(p);
  await p.getByLabel('Nome esercizio 1').fill(value);
  await settle(p, 700);
}
async function deleteSession(p, dateLabel) {
  await p.goto(BASE + '#/'); await ready(p);
  const card = p.locator('.rec-card', { hasText: dateLabel });
  await card.getByRole('button', { name: 'Altre azioni' }).click();
  await card.getByRole('button', { name: '🗑 Elimina' }).click();
  await p.locator('dialog.modal').getByRole('button', { name: 'Elimina' }).click();
}
const idbGet = (p, store, id) => p.evaluate(([s, i]) => new Promise((res) => { const r = indexedDB.open('rugby-coach'); r.onsuccess = () => { const g = r.result.transaction(s).objectStore(s).get(i); g.onsuccess = () => res(g.result || null); }; }), [store, id]);
const idbAll = (p, store) => p.evaluate((s) => new Promise((res) => { const r = indexedDB.open('rugby-coach'); r.onsuccess = () => { const g = r.result.transaction(s).objectStore(s).getAll(); g.onsuccess = () => res(g.result); }; }), store);
const firstName = async (p, id) => (await idbGet(p, 'sessions', id))?.planItems?.[0]?.name;
const gisCount = (p) => p.evaluate(() => (window.__gis ? window.__gis.requests.length : 0));
const foreground = (p) => p.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); });

let ok = false;
try {
  console.log('• A, B e C collegati allo stesso Drive');
  const A = await device('A', { phone: true });
  await connect(A);
  const s1 = await newSession(A, '2026-12-01', 'Uno');
  await waitUntil(() => remoteRec(s1)?.planItems?.[0]?.name === 'Uno', 'A: prima scheda su Drive');
  const B = await device('B');
  await connect(B);
  const C = await device('C', { phone: true });
  await connect(C);
  assert.equal(await firstName(B, s1), 'Uno');
  await B.goto(BASE + '#/'); await ready(B);

  console.log('• A modifica → B (in primo piano, nessuna azione) riceve dopo il controllo periodico; nessuna finestra Google');
  const gisB0 = await gisCount(B);
  await editName(A, s1, 'Uno – modificato da A');
  await waitUntil(() => remoteRec(s1)?.planItems?.[0]?.name === 'Uno – modificato da A', 'A: modifica su Drive');
  await waitUntil(async () => (await firstName(B, s1)) === 'Uno – modificato da A', 'B riceve da solo');
  await B.locator('.rec-card', { hasText: 'Uno – modificato da A' }).waitFor({ timeout: 10000 });
  assert.equal(await gisCount(B), gisB0, 'la ricezione non apre finestre Google');
  await B.waitForFunction(() => /Aggiornato da Drive/.test(document.querySelector('.sync-ind')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});

  console.log('• ritorno in primo piano: B riceve subito (controllo periodico lontano)');
  await B.evaluate(() => localStorage.setItem('rc.pullEveryMs', '600000'));
  await B.reload(); await ready(B); await settle(B, 3500); // giro iniziale
  await editName(A, s1, 'Uno – seconda modifica di A');
  await waitUntil(() => remoteRec(s1)?.planItems?.[0]?.name === 'Uno – seconda modifica di A', 'A: seconda modifica su Drive');
  await settle(B, 1500);
  assert.notEqual(await firstName(B, s1), 'Uno – seconda modifica di A', 'senza ritorno in primo piano non ancora');
  await foreground(B);
  await waitUntil(async () => (await firstName(B, s1)) === 'Uno – seconda modifica di A', 'B riceve al ritorno in primo piano', 10000);
  await B.evaluate((ms) => localStorage.setItem('rc.pullEveryMs', String(ms)), PULL_MS);
  await B.reload(); await ready(B);

  console.log('• B ha la stessa scheda aperta e scrive: avviso, nessuna perdita (unione campo per campo)');
  await B.goto(BASE + '#/seduta/' + s1 + '/foglio'); await ready(B);
  await A.goto(BASE + '#/seduta/' + s1 + '/foglio'); await ready(A);
  await A.getByLabel('Luogo (facoltativo)').fill('Campo di A');
  await settle(A, 700);
  await waitUntil(() => remoteRec(s1)?.location === 'Campo di A', 'A: luogo su Drive');
  await B.getByLabel('Nome esercizio 1').fill('Uno – B sta scrivendo');
  await B.locator('.remote-banner', { hasText: 'Questa scheda è stata aggiornata su un altro dispositivo' }).waitFor({ timeout: 20000 });
  await B.screenshot({ path: path.join(SHOTS, '50-pc-avviso-scheda-aggiornata.png') });
  assert.equal(await B.getByLabel('Nome esercizio 1').inputValue(), 'Uno – B sta scrivendo', 'il campo che B scrive non viene toccato');
  await waitUntil(async () => { const r = await idbGet(B, 'sessions', s1); return r.location === 'Campo di A' && r.planItems[0].name === 'Uno – B sta scrivendo'; }, 'B: unione dei due cambiamenti');
  await waitUntil(() => remoteRec(s1)?.location === 'Campo di A' && remoteRec(s1)?.planItems?.[0]?.name === 'Uno – B sta scrivendo', 'Drive: unione');
  await B.locator('.remote-banner').getByRole('button', { name: 'Aggiorna' }).click();
  await B.locator('.remote-banner').waitFor({ state: 'detached' });
  await waitUntil(async () => (await B.getByLabel('Luogo (facoltativo)').inputValue()) === 'Campo di A', 'B: dopo "Aggiorna" si vede il luogo di A');
  await A.goto(BASE + '#/'); await ready(A);
  await waitUntil(async () => (await firstName(A, s1)) === 'Uno – B sta scrivendo', 'A riceve la scrittura di B');

  console.log('• modifica concorrente (B senza rete) → nessuna perdita: la versione più vecchia resta come copia "conflitto"');
  const s2 = await newSession(A, '2026-12-02', 'Due');
  await A.goto(BASE + '#/'); await ready(A);
  await waitUntil(async () => (await firstName(B, s2)) === 'Due', 'B riceve la scheda nuova di A');
  await B.goto(BASE + '#/'); await ready(B);
  await B.context().setOffline(true);
  await editName(B, s2, 'Due – versione di B');
  await B.goto(BASE + '#/'); await ready(B);
  await settle(B, 500);
  await editName(A, s2, 'Due – versione di A (più recente)');
  await waitUntil(() => remoteRec(s2)?.planItems?.[0]?.name === 'Due – versione di A (più recente)', 'A: versione su Drive');
  await A.goto(BASE + '#/'); await ready(A);
  await B.context().setOffline(false);
  await B.evaluate(() => window.dispatchEvent(new Event('online')));
  await waitUntil(async () => (await firstName(B, s2)) === 'Due – versione di A (più recente)', 'B: vince la più recente');
  await waitUntil(async () => (await idbAll(B, 'sessions')).some((x) => x.conflict && x.planItems[0]?.name === 'Due – versione di B'), 'B: copia di conflitto');
  await waitUntil(() => live().some((f) => f.appProperties?.rcVariant === 'json' && /conflitto del/.test(f.name) && JSON.parse(f.content).record.planItems[0].name === 'Due – versione di B'), 'copia di conflitto su Drive');
  await waitUntil(async () => (await idbAll(A, 'sessions')).some((x) => x.conflict && x.planItems[0]?.name === 'Due – versione di B'), 'A riceve la copia di conflitto');
  assert.equal(remoteRec(s2).planItems[0].name, 'Due – versione di A (più recente)', 'la versione più recente non è stata sovrascritta');
  await B.screenshot({ path: path.join(SHOTS, '51-pc-copia-conflitto.png') });

  console.log('• eliminazione su A → sparisce da B; "Tienila" su B (scheda aperta) → torna su A');
  const s3 = await newSession(A, '2026-12-03', 'Tre');
  const s4 = await newSession(A, '2026-12-04', 'Quattro');
  await A.goto(BASE + '#/'); await ready(A);
  await waitUntil(async () => (await firstName(B, s3)) === 'Tre' && (await firstName(B, s4)) === 'Quattro', 'B riceve Tre e Quattro');
  await deleteSession(A, '03/12/2026');
  await waitUntil(async () => !(await idbGet(B, 'sessions', s3)), 'B: eliminata su A sparisce');
  await B.goto(BASE + '#/seduta/' + s4 + '/foglio'); await ready(B);
  await deleteSession(A, '04/12/2026');
  await B.locator('.remote-banner', { hasText: 'Eliminata su un altro dispositivo' }).waitFor({ timeout: 20000 });
  await B.screenshot({ path: path.join(SHOTS, '52-pc-avviso-eliminata.png') });
  const s4files = [...drive.files.values()].filter((f) => f.appProperties?.rcId === s4);
  await B.locator('.remote-banner').getByRole('button', { name: 'Tienila' }).click();
  await waitUntil(() => s4files.every((f) => !drive.files.get(f.id).trashed), 'B: i file di Quattro escono dal cestino (stessi file)');
  await waitUntil(async () => (await firstName(A, s4)) === 'Quattro', 'A: Quattro torna');
  assert.equal([...drive.files.values()].filter((f) => f.appProperties?.rcId === s4).length, s4files.length, 'nessun file nuovo per Quattro');
  await B.goto(BASE + '#/'); await ready(B);

  console.log('• scheda nuova, esercizio e giocatore su C → arrivano su A e B');
  const s5 = await newSession(C, '2026-12-05', 'Cinque da C');
  await C.goto(BASE + '#/libreria'); await ready(C);
  await C.getByRole('button', { name: '+ Nuovo esercizio' }).click(); await C.waitForURL(/esercizio\//);
  await C.getByLabel('Nome', { exact: true }).fill('Esercizio di C'); await settle(C);
  await C.goto(BASE + '#/rosa?cat=U8'); await ready(C);
  await C.getByLabel('Nome nuovo giocatore').fill('Giocatore di C');
  await C.getByRole('button', { name: '+ Aggiungi' }).click();
  await C.goto(BASE + '#/'); await ready(C);
  for (const [P, n] of [[A, 'A'], [B, 'B']]) {
    await waitUntil(async () => (await firstName(P, s5)) === 'Cinque da C', n + ': scheda di C');
    await waitUntil(async () => (await idbAll(P, 'exercises')).some((e) => e.name === 'Esercizio di C'), n + ': esercizio di C');
    await waitUntil(async () => (await idbAll(P, 'players')).some((e) => e.name === 'Giocatore di C'), n + ': giocatore di C');
  }
  await B.goto(BASE + '#/libreria'); await ready(B);
  await B.getByText('Esercizio di C').waitFor();

  console.log('• carico: a riposo B fa solo la files.list (nessun download, nessun invio)');
  await settle(B, 2 * PULL_MS);
  const n0 = (calls.B || []).length;
  await settle(B, 3 * PULL_MS + 500);
  const idle = (calls.B || []).slice(n0);
  assert.ok(idle.length >= 2, 'controlli periodici: ' + idle.join(' | '));
  assert.ok(idle.every((c) => c === 'GET /drive/v3/files list'), 'solo files.list: ' + idle.join(' | '));
  console.log('  a riposo, in', 3 * PULL_MS + 500, 'ms:', idle.length, 'files.list');

  console.log('• accesso scaduto su B: nessuna chiamata a Drive e nessuna finestra Google, anche al ritorno in primo piano');
  await B.evaluate(() => localStorage.setItem('rc.google.token', JSON.stringify({ access_token: 'tok-scaduto', expiresAt: Date.now() - 1000 })));
  await B.reload(); await ready(B);
  const gis1 = await gisCount(B);
  const n1 = (calls.B || []).length;
  await foreground(B);
  await settle(B, 3 * PULL_MS);
  assert.equal((calls.B || []).length, n1, 'nessuna chiamata con accesso scaduto: ' + (calls.B || []).slice(n1).join(' | '));
  assert.equal(await gisCount(B), gis1, 'nessuna finestra Google aperta da sola');

  console.log('• R9: C con accesso scaduto e niente da salvare: niente "Drive ✓", invito "Tocca per aggiornare da Drive"; il tocco rinnova e riceve');
  await C.evaluate(() => localStorage.setItem('rc.google.token', JSON.stringify({ access_token: 'tok-scaduto', expiresAt: Date.now() - 1000 })));
  await C.reload(); await ready(C);
  const s9 = await newSession(A, '2026-12-09', 'Nove da A');
  await A.goto(BASE + '#/'); await ready(A);
  await waitUntil(() => remoteRec(s9)?.planItems?.[0]?.name === 'Nove da A', 'A: scheda nove su Drive');
  const invC = C.getByRole('button', { name: 'Tocca per aggiornare da Drive' });
  await invC.waitFor({ timeout: 15000 });
  const indC = await C.locator('.sync-ind').innerText();
  assert.ok(!/Drive ✓/.test(indC) && /Da aggiornare/.test(indC), 'indicatore con accesso scaduto: ' + indC);
  assert.ok(!(await idbGet(C, 'sessions', s9)), 'C non riceve senza accesso');
  await C.screenshot({ path: path.join(SHOTS, '53-telefono-invito-aggiornare.png') });
  const gisC = await gisCount(C);
  await invC.click();
  await waitUntil(async () => (await firstName(C, s9)) === 'Nove da A', 'C riceve dopo il tocco');
  assert.equal(await gisCount(C), gisC + 1, 'una sola richiesta di accesso, dal tocco');
  assert.equal(await C.evaluate(() => window.__gis.requests.at(-1)), '', 'rinnovo con prompt vuoto');
  await invC.waitFor({ state: 'hidden' });

  const names = live().map((f) => f.name);
  assert.equal(new Set(names).size, names.length, 'nessun duplicato su Drive: ' + names.join(' | '));
  ok = true;
} finally {
  await browser.close();
  server.kill();
  console.log('Errori in console:', errors.length ? errors : 'nessuno');
}
if (!ok || errors.length) process.exit(1);
console.log('E2E ricezione automatica OK');
