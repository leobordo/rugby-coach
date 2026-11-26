// E2E con Google Drive finto condiviso tra più "telefoni" (Playwright + Chrome).
// - D1: primo avvio, "Collega Google Drive" in un tocco (login Google finto) → cartella "Rugby Coach" creata nella radice;
//       scheda salvata su Drive e aggiornata senza duplicati; accesso scaduto → invito "Tocca per salvare su Drive"
//       e rinnovo anche toccando "Fine allenamento" (prompt '').
// - D2: nuovo telefono, un tocco → la cartella viene RITROVATA e le schede recuperate da sole; libreria/rosa
//       modificate da D1 e D2 (aggiunte concorrenti + una cancellazione) restano unite.
// - D3: terzo telefono recupera tutto. Nessun file o cartella duplicati.
// Uso: node tests/e2e-multidevice.mjs
import { spawn, execFileSync } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const { chromium } = await import('playwright-core');
const SHOTS = path.join(ROOT, 'out', 'screens');
fs.mkdirSync(SHOTS, { recursive: true });
const PORT = Number(process.env.PORT || 8098);
const BASE = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p));
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: path.join(ROOT, 'app'), stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));

// ---------- Drive finto condiviso ----------
const FOLDER = 'application/vnd.google-apps.folder';
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
  drive.calls.push(req.method() + ' ' + u.pathname + (u.searchParams.get('q') ? ' ' + u.searchParams.get('q') : ''));
  if (!/^Bearer tok/.test(req.headers().authorization || '')) return json({ error: { message: 'Invalid Credentials' } }, 401);
  if (u.pathname !== '/drive/v3/about') assert.equal(u.searchParams.get('supportsAllDrives'), 'true');
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
  const media = /^\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname);
  if (media && u.searchParams.get('alt') === 'media') return route.fulfill({ status: 200, headers: cors, body: drive.files.get(media[1])?.content ?? '' });
  if (media && req.method() === 'GET') {
    const f = drive.files.get(media[1]);
    return f ? json({ id: f.id, name: f.name, trashed: !!f.trashed, parents: f.parents }) : json({ error: { message: 'File not found' } }, 404);
  }
  if (u.pathname === '/upload/drive/v3/files' && req.method() === 'POST') {
    const [m, c] = partsOf(req.postDataBuffer());
    const id = 'f' + (++drive.n);
    drive.files.set(id, { ...JSON.parse(m), id, version: 1, content: Buffer.from(c, 'latin1').toString('utf8'), bytes: Buffer.from(c, 'latin1') });
    return json({ id, name: JSON.parse(m).name, version: '1' });
  }
  const tm = /^\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname);
  if (tm && req.method() === 'PATCH') { // files.update { trashed: true }
    const f = drive.files.get(tm[1]);
    if (!f) return json({ error: { message: 'File not found' } }, 404);
    const add = u.searchParams.get('addParents'); const remove = u.searchParams.get('removeParents');
    if (add || remove) { // spostamento: stesso file, cambia cartella
      drive.moves = (drive.moves || 0) + 1;
      f.parents = [...(f.parents || []).filter((x) => x !== remove), ...(add && !(f.parents || []).includes(add) ? [add] : [])];
    }
    Object.assign(f, JSON.parse(req.postData() || '{}'));
    return json({ id: f.id, trashed: f.trashed, parents: f.parents });
  }
  const pm = /^\/upload\/drive\/v3\/files\/(.+)$/.exec(u.pathname);
  if (pm && req.method() === 'PATCH') {
    const f = drive.files.get(pm[1]);
    if (!f) return json({ error: { message: 'File not found' } }, 404);
    const [m, c] = partsOf(req.postDataBuffer());
    // come Drive: aggiornare un file nel cestino lo lascia nel cestino, salvo trashed:false nei metadati
    Object.assign(f, JSON.parse(m), { version: f.version + 1, content: Buffer.from(c, 'latin1').toString('utf8'), bytes: Buffer.from(c, 'latin1') });
    return json({ id: f.id, name: f.name, trashed: !!f.trashed, version: String(f.version) });
  }
  return json({ error: { message: 'non simulato ' + u.pathname } }, 404);
}
const folders = () => [...drive.files.values()].filter((f) => f.mimeType === FOLDER && !f.trashed && f.appProperties?.rcKind === 'folder');
const dataFolders = () => [...drive.files.values()].filter((f) => f.mimeType === FOLDER && !f.trashed && f.appProperties?.rcKind === 'dataFolder');
// nella cartella principale solo documenti Word; i .json in "File per l'app"
const assertLayout = (what) => {
  const root = folders()[0]; const data = dataFolders();
  assert.equal(data.length, 1, what + ': una sola "File per l\'app"');
  assert.equal(data[0].name, "File per l'app"); assert.deepEqual(data[0].parents, [root.id]);
  const live = [...drive.files.values()].filter((f) => !f.trashed && f.mimeType !== FOLDER);
  const jsonInRoot = live.filter((f) => f.mimeType === 'application/json' && (f.parents || []).includes(root.id));
  assert.equal(jsonInRoot.length, 0, what + ': .json nella cartella principale: ' + jsonInRoot.map((f) => f.name).join(', '));
  assert.ok(live.filter((f) => f.mimeType === 'application/json').every((f) => (f.parents || []).includes(data[0].id)), what + ': .json fuori da "File per l\'app"');
  assert.ok(live.filter((f) => f.mimeType !== 'application/json').every((f) => (f.parents || []).includes(root.id)), what + ': Word nella cartella principale');
};
const appFiles = () => [...drive.files.values()].filter((f) => f.mimeType !== FOLDER && !f.trashed);
const trashedFiles = () => [...drive.files.values()].filter((f) => f.trashed);
// testo di un .docx (per controllare il contenuto davvero scritto su Drive)
const docxText = (f) => { const p = path.join(os.tmpdir(), 'rc-' + f.id + '.docx'); fs.writeFileSync(p, f.bytes); return execFileSync('unzip', ['-p', p, 'word/document.xml']).toString('utf8'); };
const collection = (rcKind) => {
  const f = appFiles().filter((x) => x.appProperties?.rcKind === rcKind && x.appProperties?.rcId === 'all' && x.mimeType === 'application/json');
  assert.equal(f.length, 1, 'un solo file ' + rcKind);
  const obj = JSON.parse(f[0].content);
  return { names: obj.data[rcKind === 'exercise' ? 'exercises' : 'players'].map((x) => x.name), tombs: obj.tombstones };
};
const sessionJson = (id) => appFiles().find((f) => f.appProperties?.rcId === id && f.appProperties?.rcVariant === 'json');

// Google Identity Services finto: la "finestra" di Google risponde subito e registra il prompt usato
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
  const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1180, height: 820 }, hasTouch: phone, locale: 'it-IT' });
  await ctx.route(BASE + 'config.js', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: CONFIG }));
  await ctx.route('https://accounts.google.com/gsi/client', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: GIS_STUB }));
  await ctx.route('https://apis.google.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '/* stub */' }));
  await ctx.route('https://www.googleapis.com/**', driveRoute);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(name + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push(name + ' pageerror: ' + e.message));
  page.on('dialog', (d) => d.accept());
  return page;
}
const ready = (p) => p.waitForFunction(() => window.__rcReady === true, null, { timeout: 20000 });
const settle = (p, ms = 900) => p.waitForTimeout(ms);
const shot = (p, name) => p.screenshot({ path: path.join(SHOTS, name + '.png') });
const gisPrompts = (p) => p.evaluate(() => (window.__gis ? window.__gis.requests : []));

// Un tocco: "Collega Google Drive" nella prima schermata
async function connectOneTap(p, label) {
  await p.goto(BASE); await ready(p);
  await p.getByRole('heading', { name: 'Salva le tue schede su Google Drive' }).waitFor();
  if (label) await shot(p, label + '-1-benvenuto');
  await p.getByRole('button', { name: 'Collega Google Drive' }).click();
  await p.getByRole('heading', { name: 'Fatto!' }).waitFor({ timeout: 20000 });
  await p.getByText('Le schede si salvano in Drive › Rugby Coach').waitFor();
  if (label) await shot(p, label + '-2-fatto');
  const text = await p.locator('.onb-hero').innerText();
  await p.getByRole('button', { name: 'Inizia' }).click();
  await p.waitForURL(/#\/$/);
  return text;
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
// Impostazioni: "Salva su Drive adesso" se c'è qualcosa da salvare, finché compare "Tutto salvato su Drive ✓"
async function saveAll(p) {
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    await p.goto(BASE + '#/impostazioni'); await ready(p); await settle(p, 400);
    if (await p.getByText('Tutto salvato su Drive ✓').count()) return;
    const b = p.getByRole('button', { name: '☁ Salva su Drive adesso' });
    if (await b.count()) await b.click();
    await settle(p, 1500);
  }
  throw new Error('le schede non risultano salvate su Drive');
}
const localNames = (p, store) => p.evaluate((st) => new Promise((res) => { const r = indexedDB.open('rugby-coach'); r.onsuccess = () => { const g = r.result.transaction(st).objectStore(st).getAll(); g.onsuccess = () => res(g.result.map((x) => x.name)); }; }), store);
const localIds = (p, store) => p.evaluate((st) => new Promise((res) => { const r = indexedDB.open('rugby-coach'); r.onsuccess = () => { const g = r.result.transaction(st).objectStore(st).getAll(); g.onsuccess = () => res(g.result.map((x) => x.id)); }; }), store);
async function waitUntil(fn, what, ms = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await fn()) return; await new Promise((r) => setTimeout(r, 400)); }
  throw new Error('tempo scaduto: ' + what);
}
const expireToken = (p) => p.evaluate(() => localStorage.setItem('rc.google.token', JSON.stringify({ access_token: 'tok-scaduto', expiresAt: Date.now() - 1000 })));

let ok = false;
try {
  console.log('• D1 (telefono): primo avvio, collegamento a Drive in un tocco → cartella creata nella radice');
  const d1 = await device('D1', { phone: true });
  await connectOneTap(d1, '30-telefono-onboarding');
  assert.deepEqual(await gisPrompts(d1), ['consent'], 'consenso solo al primo accesso');
  assert.equal(folders().length, 1);
  const folder = folders()[0];
  assert.equal(folder.name, 'Rugby Coach');
  assert.ok(!folder.parents, 'creata nella radice del Drive');
  assert.deepEqual(folder.appProperties, { rcApp: 'rugby-coach', rcKind: 'folder' });
  await d1.getByRole('button', { name: 'Drive ✓' }).waitFor({ timeout: 20000 });
  await shot(d1, '31-telefono-home-collegato');

  console.log('• D1: nuova scheda salvata da sola su Drive, poi aggiornata senza duplicati');
  await d1.getByRole('button', { name: '+ Nuovo allenamento' }).click();
  await d1.waitForURL(/seduta\/([^/]+)\/foglio/);
  const sid = /seduta\/([^/]+)\//.exec(d1.url())[1];
  const sessionUrl = d1.url();
  await d1.getByLabel('Data allenamento').fill('2026-11-24');
  await d1.locator('.cats .choice-btn', { hasText: /^U8$/ }).click();
  for (let i = 0; i < 4; i++) await d1.getByRole('button', { name: '+ Aggiungi esercizio' }).click(); // la seduta parte vuota
  await d1.getByLabel('Nome esercizio 1').fill('Fulmine');
  await d1.locator('.page-actions .status-pill', { hasText: 'Salvato su Drive ✓' }).waitFor({ timeout: 25000 });
  const sj = sessionJson(sid);
  assert.ok(sj && sj.parents[0] === dataFolders()[0].id, '.json in "File per l\'app"');
  assertLayout('D1');
  const nFiles = appFiles().length;
  await d1.getByLabel('Nome esercizio 2').fill('Palla quadrata');
  await d1.locator('.page-actions .status-pill', { hasText: 'Da salvare su Drive' }).waitFor({ timeout: 5000 });
  await d1.locator('.page-actions .status-pill', { hasText: 'Salvato su Drive ✓' }).waitFor({ timeout: 25000 });
  assert.equal(appFiles().length, nFiles, 'aggiornati gli stessi file');
  assert.equal(JSON.parse(sessionJson(sid).content).record.planItems[1].name, 'Palla quadrata');
  await shot(d1, '32-telefono-scheda-salvata');

  console.log('• D1: accesso scaduto → UN invito "Tocca per salvare su Drive" (prompt vuoto, nessuna schermata di consenso)');
  await expireToken(d1);
  await d1.reload(); await ready(d1);
  await d1.getByLabel('Nome esercizio 3').fill('Mastino');
  const invite = d1.getByRole('button', { name: 'Tocca per salvare su Drive' });
  await invite.waitFor({ timeout: 20000 });
  assert.equal(await d1.locator('.drive-invite:not([hidden])').count(), 1, 'un solo invito');
  assert.equal(await d1.locator('dialog[open]').count(), 0, 'non bloccante');
  await shot(d1, '33-telefono-invito-salva-su-drive');
  await invite.click();
  await d1.locator('.page-actions .status-pill', { hasText: 'Salvato su Drive ✓' }).waitFor({ timeout: 25000 });
  assert.equal((await gisPrompts(d1)).at(-1), '', 'rinnovo con prompt vuoto');
  assert.equal(JSON.parse(sessionJson(sid).content).record.planItems[2].name, 'Mastino');
  await invite.waitFor({ state: 'hidden' });

  console.log('• D1: accesso scaduto di nuovo → rinnovo toccando "Fine allenamento"');
  await expireToken(d1);
  await d1.goto(sessionUrl); await d1.reload(); await ready(d1);
  await d1.getByLabel('Nome esercizio 4').fill('Partita');
  await settle(d1, 700);
  await d1.getByRole('button', { name: '✓ Fine allenamento' }).click();
  await d1.waitForURL(/#\/$/);
  await d1.waitForFunction(() => window.__gis && window.__gis.requests.length >= 1, null, { timeout: 10000 });
  assert.equal((await gisPrompts(d1)).at(-1), '');
  const t0 = Date.now();
  while (JSON.parse(sessionJson(sid).content).record.planItems[3].name !== 'Partita' && Date.now() - t0 < 20000) await settle(d1, 500);
  assert.equal(JSON.parse(sessionJson(sid).content).record.planItems[3].name, 'Partita', 'salvato dopo "Fine allenamento"');

  console.log('• D1: libreria e rosa');
  await addExercise(d1, 'Esercizio D1');
  await addPlayer(d1, 'Giocatore D1');
  await saveAll(d1);
  assert.ok(collection('exercise').names.includes('Esercizio D1'));
  assert.deepEqual(collection('player').names, ['Giocatore D1']);

  console.log('• D2: nuovo telefono, un tocco → cartella RITROVATA e schede recuperate da sole');
  const d2 = await device('D2');
  const doneText = await connectOneTap(d2);
  assert.equal(folders().length, 1, 'nessuna seconda cartella');
  assert.match(doneText, /Abbiamo recuperato \d+ sched/);
  await d2.goto(BASE + '#/'); await ready(d2);
  await d2.locator('.rec-card', { hasText: '24/11/2026' }).waitFor();
  assert.ok((await localNames(d2, 'exercises')).includes('Esercizio D1'), 'libreria recuperata');
  assert.ok((await localNames(d2, 'players')).includes('Giocatore D1'), 'rosa recuperata');
  const nAfterD2 = appFiles().length;
  await settle(d2, 5000);
  assert.equal(appFiles().length, nAfterD2, 'il collegamento del nuovo telefono non duplica nulla');

  console.log('• D2: aggiunge e CANCELLA un esempio; D1 aggiunge ancora: niente si perde');
  await addExercise(d2, 'Esercizio D2');
  await addPlayer(d2, 'Giocatore D2');
  await d2.goto(BASE + '#/libreria'); await ready(d2);
  await d2.locator('.ex-card', { has: d2.locator('strong', { hasText: /^Fulmine$/ }) }).click();
  await d2.getByRole('button', { name: 'Elimina', exact: true }).click();
  await d2.locator('dialog.modal').getByRole('button', { name: 'Elimina' }).click();
  await d2.waitForURL(/#\/libreria$/);
  await saveAll(d2);
  let lib = collection('exercise');
  assert.ok(lib.names.includes('Esercizio D1') && lib.names.includes('Esercizio D2') && !lib.names.includes('Fulmine'), lib.names.join(', '));
  assert.ok(lib.tombs.exercise['seed-ex-fulmine']);
  await addExercise(d1, 'Esercizio D1-bis');
  await addPlayer(d1, 'Giocatore D1-bis');
  await saveAll(d1);
  lib = collection('exercise');
  for (const n of ['Esercizio D1', 'Esercizio D2', 'Esercizio D1-bis']) assert.ok(lib.names.includes(n), 'su Drive manca ' + n);
  assert.ok(!lib.names.includes('Fulmine'), 'la cancellazione di D2 resta');
  assert.deepEqual(collection('player').names.sort(), ['Giocatore D1', 'Giocatore D1-bis', 'Giocatore D2']);
  const d1ex = await localNames(d1, 'exercises');
  assert.ok(d1ex.includes('Esercizio D2') && !d1ex.includes('Fulmine'), 'unione applicata anche su D1');

  const libDocx = appFiles().find((f) => f.appProperties?.rcVariant === 'docx-library');
  assert.ok(!docxText(libDocx).includes('Fulmine') && docxText(libDocx).includes('Esercizio D2'), 'il .docx della libreria è riscritto senza l\'esercizio eliminato');

  console.log('• D1: tolgo una RIGA esercizio e chiudo subito la scheda → il .docx su Drive viene riscritto senza (stesso file)');
  await d1.goto(sessionUrl); await ready(d1);
  const docxF = () => appFiles().find((f) => f.appProperties?.rcId === sid && f.appProperties?.rcVariant === 'docx-plan');
  const docxId = docxF().id;
  assert.ok(docxText(docxF()).includes('Mastino'));
  const nBefore = appFiles().length;
  await d1.getByRole('button', { name: 'Rimuovi esercizio 3' }).click();
  await d1.locator('dialog.modal').getByRole('button', { name: 'Rimuovi' }).click();
  await d1.getByRole('link', { name: 'Indietro' }).click(); // ultima modifica, poi via dalla scheda
  await waitUntil(() => !docxText(drive.files.get(docxId)).includes('Mastino'), 'riga tolta anche nel .docx su Drive');
  assert.equal(docxF().id, docxId, 'stesso file');
  assert.equal(appFiles().length, nBefore, 'nessun file nuovo');
  assert.ok(!JSON.parse(sessionJson(sid).content).record.planItems.some((p) => p.name === 'Mastino'));

  console.log('• D1: elimino il piano (con rete) → i suoi file vanno nel CESTINO di Drive e nell\'indice "Eliminati"');
  const planFiles = appFiles().filter((f) => f.appProperties?.rcKind === 'plan');
  assert.ok(planFiles.length >= 2, 'piano su Drive');
  await d1.goto(BASE + '#/?t=piani'); await ready(d1);
  const planCard = d1.locator('.rec-card', { hasText: 'I° TRIMESTRE' });
  await planCard.getByRole('button', { name: 'Altre azioni' }).click();
  await planCard.getByRole('button', { name: '🗑 Elimina' }).click();
  await d1.locator('dialog.modal').getByText('Su Drive finirà nel cestino (recuperabile per 30 giorni)').waitFor();
  await shot(d1, '35-telefono-conferma-elimina');
  await d1.locator('dialog.modal').getByRole('button', { name: 'Elimina' }).click();
  await waitUntil(() => planFiles.every((f) => drive.files.get(f.id).trashed), 'file del piano nel cestino');
  await waitUntil(() => appFiles().some((f) => f.appProperties?.rcKind === 'tombstones'), 'indice eliminati su Drive');
  const idx = () => JSON.parse(appFiles().find((f) => f.appProperties?.rcKind === 'tombstones').content).tombstones;
  assert.ok(idx().plan['seed-plan-trimestre-1']);
  assert.equal(appFiles().filter((f) => f.name.includes('Eliminati')).length, 1);

  console.log('• D2 SENZA RETE: elimino l\'allenamento → resta in attesa; torna la rete → cestino');
  const sessFiles = appFiles().filter((f) => f.appProperties?.rcId === sid);
  await d2.goto(BASE + '#/'); await ready(d2);
  await d2.context().setOffline(true);
  const sCard = d2.locator('.rec-card', { hasText: '24/11/2026' });
  await sCard.getByRole('button', { name: 'Altre azioni' }).click();
  await sCard.getByRole('button', { name: '🗑 Elimina' }).click();
  await d2.locator('dialog.modal').getByRole('button', { name: 'Elimina' }).click();
  await settle(d2, 2500);
  assert.ok(sessFiles.every((f) => !drive.files.get(f.id).trashed), 'offline: niente ancora');
  await d2.context().setOffline(false);
  await d2.evaluate(() => window.dispatchEvent(new Event('online')));
  await waitUntil(() => sessFiles.every((f) => drive.files.get(f.id).trashed), 'file dell\'allenamento nel cestino al ritorno della rete');
  await waitUntil(() => !!idx().session[sid], 'tombstone dell\'allenamento nell\'indice');

  console.log('• D1 riaperto: l\'allenamento eliminato su D2 sparisce anche qui e non torna su Drive');
  await d1.goto(BASE + '#/'); await d1.reload(); await ready(d1);
  await waitUntil(async () => !(await localIds(d1, 'sessions')).includes(sid), 'tolto anche su D1');
  await settle(d1, 5000);
  assert.ok(!appFiles().some((f) => f.appProperties?.rcId === sid), 'nessun file resuscitato');

  console.log('• D3: terzo telefono recupera tutto');
  const d3 = await device('D3', { phone: true });
  await connectOneTap(d3);
  const ex3 = await localNames(d3, 'exercises');
  for (const n of ['Esercizio D1', 'Esercizio D2', 'Esercizio D1-bis']) assert.ok(ex3.includes(n), 'D3 non ha ' + n);
  assert.ok(!ex3.includes('Fulmine'));
  assert.deepEqual((await localNames(d3, 'players')).sort(), ['Giocatore D1', 'Giocatore D1-bis', 'Giocatore D2']);
  assert.ok(!(await localIds(d3, 'sessions')).includes(sid), 'allenamento eliminato: non recuperato');
  assert.ok(!(await localIds(d3, 'plans')).includes('seed-plan-trimestre-1'), 'piano di esempio eliminato: tolto anche dal nuovo telefono');
  await d3.goto(BASE + '#/impostazioni'); await ready(d3);
  await shot(d3, '34-telefono-impostazioni-collegato');
  await settle(d3, 4000);
  assert.equal(folders().length, 1, 'una sola cartella');
  assertLayout('D3');
  const names = appFiles().map((f) => f.name);
  assert.equal(new Set(names).size, names.length, 'nessun duplicato su Drive: ' + names.join(' | '));
  assert.ok(!appFiles().some((f) => f.appProperties?.rcKind === 'plan'), 'il piano eliminato non è stato ricreato');

  // ---------- eliminazione contro modifica su 3 telefoni: vince l'evento più recente ----------
  console.log('• A elimina, B (già allineato) modifica DOPO → i file escono dal cestino, la tombstone è superata, C la recupera');
  async function newSessionOn(p, date, name) {
    await p.goto(BASE + '#/'); await ready(p);
    await p.getByRole('button', { name: '+ Nuovo allenamento' }).click();
    await p.waitForURL(/seduta\/([^/]+)\/foglio/);
    const id = /seduta\/([^/]+)\//.exec(p.url())[1];
    await p.getByLabel('Data allenamento').fill(date);
    await p.getByRole('button', { name: '+ Aggiungi esercizio' }).click();
    await p.getByLabel('Nome esercizio 1').fill(name);
    await settle(p, 800);
    return id;
  }
  async function deleteOn(p, dateLabel) {
    await p.goto(BASE + '#/'); await ready(p);
    const card = p.locator('.rec-card', { hasText: dateLabel });
    await card.getByRole('button', { name: 'Altre azioni' }).click();
    await card.getByRole('button', { name: '🗑 Elimina' }).click();
    await p.locator('dialog.modal').getByRole('button', { name: 'Elimina' }).click();
  }
  const filesOf = (id) => [...drive.files.values()].filter((f) => f.appProperties?.rcId === id);
  const allTrashed = (id) => filesOf(id).length >= 2 && filesOf(id).every((f) => f.trashed);
  const index = () => JSON.parse(appFiles().find((f) => f.appProperties?.rcKind === 'tombstones').content);
  const A = d1;
  const sx = await newSessionOn(A, '2026-11-26', 'Conteso');
  const sy = await newSessionOn(A, '2026-11-27', 'Modificato offline');
  await saveAll(A);
  const B = await device('B');
  await connectOneTap(B);
  assert.ok((await localIds(B, 'sessions')).includes(sx) && (await localIds(B, 'sessions')).includes(sy), 'B allineato');
  // B tiene aperta la scheda (letta prima dell'eliminazione)
  await B.goto(BASE + '#/seduta/' + sx + '/foglio'); await ready(B);
  await B.getByLabel('Nome esercizio 1').waitFor();
  await deleteOn(A, '26/11/2026');
  await waitUntil(() => allTrashed(sx), 'A: scheda nel cestino');
  await waitUntil(() => !!(index().tombstones.session || {})[sx], 'A: tombstone nell\'indice');
  await B.getByLabel('Nome esercizio 1').fill('Conteso – modificato da B DOPO');
  await waitUntil(() => filesOf(sx).every((f) => !f.trashed), 'B: tutti i file della scheda fuori dal cestino');
  await waitUntil(() => JSON.parse(sessionJson(sx).content).record.planItems[0].name === 'Conteso – modificato da B DOPO', 'B: modifica su Drive');
  await waitUntil(() => !(index().tombstones.session || {})[sx] && !!(index().alive?.session || {})[sx], 'B: tombstone superata nell\'indice');
  assert.ok(docxText(filesOf(sx).find((f) => f.appProperties.rcVariant === 'docx-plan')).includes('modificato da B DOPO'));
  assert.equal(filesOf(sx).length, 2, 'stessi file, nessun duplicato');
  await B.locator('.page-actions .status-pill', { hasText: 'Salvato su Drive ✓' }).waitFor({ timeout: 15000 });

  console.log('• B SENZA RETE modifica PRIMA che A elimini, poi torna la rete: decide la data → B la toglie e non la rimanda');
  await B.goto(BASE + '#/seduta/' + sy + '/foglio'); await ready(B);
  await B.context().setOffline(true);
  await B.getByLabel('Nome esercizio 1').fill('Modifica offline di B (prima)');
  await settle(B, 1500);
  await deleteOn(A, '27/11/2026');
  await waitUntil(() => allTrashed(sy), 'A: seconda scheda nel cestino');
  await waitUntil(() => !!(index().tombstones.session || {})[sy], 'tombstone della seconda scheda');
  await B.context().setOffline(false);
  await B.evaluate(() => window.dispatchEvent(new Event('online')));
  await waitUntil(async () => !(await localIds(B, 'sessions')).includes(sy), 'B: scheda tolta (eliminazione più recente)');
  await settle(B, 5000);
  assert.ok(allTrashed(sy), 'i file restano nel cestino');
  assert.ok(!JSON.parse(sessionJson(sy)?.content || '{"record":{"planItems":[{}]}}').record.planItems[0].name?.includes('offline'), 'la modifica offline non è stata inviata');
  assert.ok((index().tombstones.session || {})[sy], 'la tombstone resta');

  console.log('• C (nuovo telefono): recupera la scheda modificata da B, non quella eliminata per ultima');
  const C = await device('C', { phone: true });
  await connectOneTap(C);
  const cs = await C.evaluate((id) => new Promise((res) => { const r = indexedDB.open('rugby-coach'); r.onsuccess = () => { const g = r.result.transaction('sessions').objectStore('sessions').get(id); g.onsuccess = () => res(g.result || null); }; }), sx);
  assert.ok(cs && cs.planItems[0].name === 'Conteso – modificato da B DOPO', 'C recupera la versione di B');
  assert.ok(!(await localIds(C, 'sessions')).includes(sy), 'C non recupera la scheda eliminata dopo la modifica di B');
  console.log('• A riaperto: la sua tombstone superata non torna nell\'indice');
  await A.reload(); await ready(A); await settle(A, 4000);
  const aTombs = await A.evaluate(() => new Promise((res) => { const r = indexedDB.open('rugby-coach'); r.onsuccess = () => { const g = r.result.transaction('settings').objectStore('settings').get('tombstones'); g.onsuccess = () => res((g.result && g.result.value) || {}); }; }));
  assert.ok(!(aTombs.session || {})[sx], 'tombstone locale di A superata');
  assert.ok(!(index().tombstones.session || {})[sx]);
  assertLayout('fine');
  const names2 = appFiles().map((f) => f.name);
  assert.equal(new Set(names2).size, names2.length, 'nessun duplicato su Drive: ' + names2.join(' | '));
  ok = true;
} finally {
  await browser.close();
  server.kill();
  console.log('Errori in console:', errors.length ? errors : 'nessuno');
}
if (!ok || errors.length) process.exit(1);
console.log('E2E multi-dispositivo OK');
