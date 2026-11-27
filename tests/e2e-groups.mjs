// E2E gruppi di allenatori, 4 utenti (Google, Drive e Picker finti; permessi e drive.file simulati):
// A crea il gruppo e invita; B entra dal link al primo avvio; C entra con l'app già in uso; tutti modificano libreria,
// piani, schede e rosa (unione + ricezione automatica, "di <nome>", avviso "<nome> ha aggiornato questa scheda");
// B elimina un elemento del gruppo e sparisce agli altri; A chiude gli inviti e D col link non entra
// ("chiedi a Anna"); invito per email a D; A toglie C (i dati personali di C restano); B esce.
// Uso: node tests/e2e-groups.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createFakeDrive } from './fake-drive.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = await import('playwright-core');
const SHOTS = path.join(ROOT, 'out', 'screens');
fs.mkdirSync(SHOTS, { recursive: true });
const PORT = Number(process.env.PORT || 8095);
const BASE = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p));
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: path.join(ROOT, 'app'), stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));

const fd = createFakeDrive();
const FOLDER = 'application/vnd.google-apps.folder';
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
async function driveRoute(route) {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  const r = fd.handle({ method: req.method(), url: req.url(), auth: req.headers().authorization, body: req.postDataBuffer() || Buffer.alloc(0) });
  if (r.text != null) return route.fulfill({ status: r.status, headers: cors, body: r.text });
  return route.fulfill({ status: r.status, headers: { ...cors, 'content-type': 'application/json' }, body: r.json === null ? '' : JSON.stringify(r.json) });
}
const GIS_STUB = `
window.google = window.google || {};
window.__gis = { requests: [] };
google.accounts = { oauth2: {
  initTokenClient(cfg) { return { requestAccessToken(o) { __gis.requests.push({ prompt: (o && o.prompt) ?? null, active: navigator.userActivation ? navigator.userActivation.isActive : null });
    setTimeout(() => cfg.callback({ access_token: 'tok-' + window.__user + '-' + __gis.requests.length, expires_in: 3599, scope: cfg.scope }), 30); } }; },
  hasGrantedAllScopes(resp, s) { return (resp.scope || '').split(' ').includes(s); },
  revoke(t, cb) { cb && cb(); },
} };`;
// Google Picker finto: mostra solo i file che l'utente può vedere; "Seleziona" li concede all'app (drive.file)
const PICKER_STUB = `
window.gapi = { load(name, o) { setTimeout(() => (o.callback || o)(), 10); } };
window.google = window.google || {};
(function () {
  class DocsView { constructor() { this.ids = []; } setFileIds(s) { this.ids = String(s).split(','); return this; } setIncludeFolders() { return this; } setSelectFolderEnabled() { return this; } setMode() { return this; } setMimeTypes() { return this; } }
  class PickerBuilder {
    constructor() { this.o = {}; }
    setTitle(t) { this.o.title = t; return this; } addView(v) { this.o.view = v; return this; } enableFeature() { return this; }
    setOAuthToken(t) { this.o.token = t; return this; } setDeveloperKey(k) { this.o.key = k; return this; } setAppId(a) { this.o.appId = a; return this; }
    setOrigin() { return this; } setSize(w, h) { this.o.size = [w, h]; return this; } setLocale() { return this; } setCallback(cb) { this.o.cb = cb; return this; }
    build() { const o = this.o; return { setVisible(v) { if (!v) return; (window.__picker = window.__picker || []).push({ active: navigator.userActivation ? navigator.userActivation.isActive : null, size: o.size, ids: o.view.ids, key: o.key, appId: o.appId }); open(o); } }; }
  }
  async function open(o) {
    const r = await fetch('https://www.googleapis.com/__picker/visible?ids=' + o.view.ids.join(','), { headers: { Authorization: 'Bearer ' + o.token } });
    const vis = (await r.json()).files || [];
    const d = document.createElement('div'); d.className = 'fake-picker'; d.setAttribute('role', 'dialog');
    d.style.cssText = 'position:fixed;left:8px;top:8px;width:' + o.size[0] + 'px;height:' + o.size[1] + 'px;background:#fff;z-index:9999;border:2px solid #333;padding:12px;overflow:auto;box-sizing:border-box';
    const t = document.createElement('h2'); t.textContent = o.title; d.append(t);
    if (!vis.length) { const p = document.createElement('p'); p.textContent = 'Nessun file'; d.append(p); }
    for (const f of vis) { const li = document.createElement('div'); li.className = 'fp-file'; li.textContent = f.name; d.append(li); }
    const sel = document.createElement('button'); sel.textContent = 'Seleziona'; sel.disabled = !vis.length;
    sel.onclick = async () => { await fetch('https://www.googleapis.com/__picker/grant', { method: 'POST', headers: { Authorization: 'Bearer ' + o.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: vis.map((f) => f.id) }) }); d.remove(); o.cb({ action: 'picked', docs: vis.map((f) => ({ id: f.id, name: f.name })) }); };
    const an = document.createElement('button'); an.textContent = 'Annulla'; an.onclick = () => { d.remove(); o.cb({ action: 'cancel' }); };
    d.append(sel, an); document.body.append(d);
  }
  google.picker = { DocsView, PickerBuilder, ViewId: { DOCS: 'docs', FOLDERS: 'folders' }, DocsViewMode: { LIST: 'list' }, Feature: { MULTISELECT_ENABLED: 'm', SUPPORT_DRIVES: 's' }, Action: { PICKED: 'picked', CANCEL: 'cancel' } };
})();`;
const CONFIG = `export default { clientId: '999-test.apps.googleusercontent.com', apiKey: 'chiave-di-prova', appId: '613972924268' };`;
const JARGON = /\b(token|sync\w*|sincronizz\w*|json|oauth|coda|api|upload\w*|scope|picker|popup|http\w*|timeout|tombstone|backup|manifest\w*)\b/gi;
const errors = [];
const jargon = [];
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
async function device(label, email, displayName, { phone = false } = {}) {
  fd.names.set(email, displayName);
  const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1366, height: 768 }, hasTouch: phone, locale: 'it-IT', serviceWorkers: 'block' });
  await ctx.addInitScript(([u]) => { window.__user = u; try { if (!localStorage.getItem('rc.pullEveryMs')) localStorage.setItem('rc.pullEveryMs', '3000'); } catch { /* */ } }, [email]);
  await ctx.route(BASE + 'config.js', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: CONFIG }));
  await ctx.route('https://accounts.google.com/gsi/client', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: GIS_STUB }));
  await ctx.route('https://apis.google.com/js/api.js', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: PICKER_STUB }));
  await ctx.route('https://www.googleapis.com/**', driveRoute);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(label + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push(label + ' pageerror: ' + e.message));
  page.label = label; page.email = email;
  return page;
}
const ready = (p) => p.waitForFunction(() => window.__rcReady === true, null, { timeout: 20000 });
const settle = (p, ms = 800) => p.waitForTimeout(ms);
async function waitUntil(fn, what, ms = 35000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await fn()) return; await new Promise((r) => setTimeout(r, 400)); }
  throw new Error('tempo scaduto: ' + what);
}
const shot = (p, n) => p.screenshot({ path: path.join(SHOTS, n + '.png') });
const scan = async (p, where) => { const t = await p.evaluate(() => document.body.innerText); for (const m of t.matchAll(JARGON)) jargon.push(`${where}: …${t.slice(Math.max(0, m.index - 30), m.index + 20).replace(/\s+/g, ' ')}…`); };
const idbAll = (p, store) => p.evaluate((s) => new Promise((res) => { const r = indexedDB.open('rugby-coach'); r.onsuccess = () => { const g = r.result.transaction(s).objectStore(s).getAll(); g.onsuccess = () => res(g.result); }; }), store);
const has = async (p, store, pred) => (await idbAll(p, store)).some(pred);
async function connect(p) {
  await p.goto(BASE); await ready(p);
  await p.getByRole('button', { name: 'Collega Google Drive' }).first().click();
  await p.getByRole('heading', { name: 'Fatto!' }).waitFor({ timeout: 20000 });
  await p.getByRole('button', { name: 'Inizia' }).click();
  await p.waitForURL(/#\/$/);
}
async function confirmModal(p, okLabel) { await p.locator('dialog.modal').getByRole('button', { name: okLabel }).click(); await p.locator('dialog.modal').waitFor({ state: 'detached' }); }
async function joinWithPicker(p) {
  const open = p.getByRole('button', { name: 'Apri i file del gruppo' });
  await open.waitFor({ timeout: 15000 });
  await p.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent === 'Apri i file del gruppo'); return b && !b.disabled; }, null, { timeout: 15000 });
  await open.click();
  await p.locator('.fake-picker').waitFor({ timeout: 10000 });
}
const groupFolder = () => [...fd.files.values()].find((f) => f.appProperties?.rcKind === 'groupFolder' && !f.trashed);
const liveIn = (fid) => [...fd.files.values()].filter((f) => !f.trashed && (f.parents || []).includes(fid));

let ok = false;
try {
  // ---------------- A crea il gruppo ----------------
  console.log('• A (telefono) collega Drive e crea il gruppo "Squadra U12"');
  const A = await device('A', 'anna@example.com', 'Anna', { phone: true });
  await connect(A);
  await A.goto(BASE + '#/impostazioni'); await ready(A);
  await A.getByRole('button', { name: '+ Crea un gruppo' }).click();
  await A.locator('dialog.modal').getByLabel('Nome del gruppo').fill('Squadra U12');
  await A.locator('dialog.modal').getByLabel('Categoria', { exact: true }).selectOption('U12');
  await confirmModal(A, 'Crea');
  await A.waitForURL(/#\/gruppo\//, { timeout: 20000 });
  const link = await A.locator('input.invite-link').inputValue();
  assert.match(link, /#\/unisciti\?g=/);
  const gf = groupFolder();
  assert.equal(gf.name, 'Rugby Coach – Squadra U12'); assert.ok(!gf.parents, 'nella radice del Drive di A');
  assert.ok(gf.perms.some((p) => p.type === 'anyone' && p.role === 'writer'));
  assert.deepEqual(liveIn(gf.id).filter((f) => f.mimeType === FOLDER).map((f) => f.name), ["File per l'app"]);
  await shot(A, '60-telefono-gruppo-creato'); await scan(A, 'gruppo A');
  const invUrl = BASE + link.slice(link.indexOf('#'));

  // ---------------- B entra dal link al primo avvio ----------------
  console.log('• B (computer) apre il link al primo avvio: accesso, finestra di Google con i file del gruppo, "Seleziona"');
  const B = await device('B', 'bruno@example.com', 'Bruno');
  await B.goto(invUrl); await ready(B);
  await B.getByRole('heading', { name: 'Entra nel gruppo "Squadra U12"' }).waitFor();
  await shot(B, '61-pc-entra-nel-gruppo'); await scan(B, 'unisciti B');
  await B.getByRole('button', { name: 'Accedi con Google' }).click();
  await joinWithPicker(B);
  assert.equal(await B.locator('.fake-picker .fp-file').count(), 7, 'il Picker mostra i file del gruppo e le cartelle');
  await shot(B, '62-pc-finestra-file-gruppo');
  await B.locator('.fake-picker').getByRole('button', { name: 'Seleziona' }).click();
  await B.getByText('Sei nel gruppo "Squadra U12"').first().waitFor({ timeout: 20000 });
  const pk = await B.evaluate(() => window.__picker[0]);
  assert.equal(pk.active, true, 'Picker aperto dentro il tocco');
  assert.equal(pk.appId, '613972924268');
  await B.goto(BASE + '#/'); await ready(B);
  assert.ok(!/benvenuto/.test(B.url()), 'dopo l\'ingresso nessuna schermata di benvenuto');

  // ---------------- C entra con l'app già in uso ----------------
  console.log('• C (telefono, app già in uso con schede personali) entra dal link');
  const C = await device('C', 'carla@example.com', 'Carla', { phone: true });
  await connect(C);
  const newSession = async (p, name) => {
    await p.goto(BASE + '#/'); await ready(p);
    await p.getByRole('button', { name: '+ Nuovo allenamento' }).click();
    await p.waitForURL(/seduta\/([^/]+)/);
    const id = /seduta\/([^/]+)/.exec(p.url())[1];
    await p.getByRole('button', { name: '+ Aggiungi esercizio' }).click();
    await p.getByLabel('Nome esercizio 1').fill(name);
    await settle(p);
    return id;
  };
  const cPersonal = await newSession(C, 'Solo mia (Carla)');
  const cMove = await newSession(C, 'Da spostare nel gruppo (Carla)');
  await C.goto(invUrl); await ready(C);
  await joinWithPicker(C);
  const pickerBox = await C.locator('.fake-picker').boundingBox();
  assert.ok(pickerBox.x >= 0 && pickerBox.x + pickerBox.width <= 390 && pickerBox.y + pickerBox.height <= 844, 'il Picker sta nello schermo del telefono: ' + JSON.stringify(pickerBox));
  await C.locator('.fake-picker').getByRole('button', { name: 'Seleziona' }).click();
  await C.getByText('Sei nel gruppo "Squadra U12"').first().waitFor({ timeout: 20000 });

  // ---------------- tutti modificano ----------------
  console.log('• tutti modificano: scheda (A), esercizio (B), giocatore (C, avviso minori), piano (A); spostamento (C)');
  const chip = (p) => p.locator('.scope-filter').getByRole('button', { name: 'Squadra U12' });
  await A.goto(BASE + '#/'); await ready(A);
  await chip(A).click();
  const aSession = await newSessionInScope(A, 'Seduta del gruppo (Anna)');
  async function newSessionInScope(p, name) {
    await p.getByRole('button', { name: '+ Nuovo allenamento' }).click();
    await p.waitForURL(/seduta\/([^/]+)/);
    const id = /seduta\/([^/]+)/.exec(p.url())[1];
    await p.getByRole('button', { name: '+ Aggiungi esercizio' }).click();
    await p.getByLabel('Nome esercizio 1').fill(name);
    await settle(p);
    return id;
  }
  await A.goto(BASE + '#/?t=piani'); await ready(A);
  await A.getByRole('button', { name: '+ Nuovo piano' }).click();
  await A.waitForURL(/piano\/([^/]+)/);
  const aPlan = /piano\/([^/]+)/.exec(A.url())[1];
  await settle(A);
  await B.goto(BASE + '#/libreria'); await ready(B);
  await chip(B).click();
  await B.getByRole('button', { name: '+ Nuovo esercizio' }).click(); await B.waitForURL(/esercizio\//);
  await B.getByLabel('Nome', { exact: true }).fill('Esercizio di Bruno'); await settle(B);
  await C.goto(BASE + '#/rosa?cat=U12'); await ready(C);
  await chip(C).click();
  await C.getByLabel('Nome nuovo giocatore').fill('Giocatore di Carla');
  await C.getByRole('button', { name: '+ Aggiungi' }).click();
  await C.locator('dialog.modal').getByText('nomi di bambini e ragazzi').waitFor();
  await shot(C, '63-telefono-avviso-minori');
  await confirmModal(C, 'Ho capito, condividi');
  await C.waitForFunction(() => [...document.querySelectorAll('.player-row input')].some((i) => i.value === 'Giocatore di Carla'));
  // C sposta una sua scheda personale nel gruppo
  await C.goto(BASE + '#/seduta/' + cMove + '/foglio'); await ready(C);
  await C.getByLabel('Dove si trova').selectOption({ label: 'Gruppo Squadra U12' });
  await C.locator('dialog.modal').getByText('Lo vedranno e potranno modificarlo tutti gli allenatori del gruppo').waitFor();
  await confirmModal(C, 'Sposta nel gruppo');
  await settle(C, 1200);
  for (const [P, n] of [[A, 'A'], [B, 'B'], [C, 'C']]) {
    await waitUntil(() => has(P, 'sessions', (s) => s.id === aSession && s.groupId), n + ': scheda di Anna');
    await waitUntil(() => has(P, 'sessions', (s) => s.id === cMove && s.groupId), n + ': scheda spostata da Carla');
    await waitUntil(() => has(P, 'exercises', (e) => e.name === 'Esercizio di Bruno' && e.groupId), n + ': esercizio di Bruno');
    await waitUntil(() => has(P, 'players', (e) => e.name === 'Giocatore di Carla' && e.groupId), n + ': giocatore di Carla');
    await waitUntil(() => has(P, 'plans', (e) => e.id === aPlan && e.groupId), n + ': piano di Anna');
  }
  await waitUntil(() => [...fd.files.values()].some((f) => !f.trashed && f.appProperties?.rcId === cMove && f.appProperties?.rcVariant === 'json') === false, 'il .json personale della scheda spostata non è più visibile');
  await B.goto(BASE + '#/'); await ready(B);
  await B.locator('.rec-card', { hasText: 'Seduta del gruppo (Anna)' }).locator('.badge.group', { hasText: 'Squadra U12 · di Anna' }).waitFor({ timeout: 15000 });
  await shot(B, '64-pc-home-gruppo'); await scan(B, 'home B');
  await waitUntil(() => liveIn(gf.id).some((f) => /Allenamento/.test(f.name) && f.owner === 'anna@example.com'), 'Word della scheda di Anna nella cartella del gruppo');
  await waitUntil(() => liveIn(gf.id).some((f) => /Allenamento/.test(f.name) && f.owner === 'carla@example.com'), 'Word della scheda di Carla nella cartella del gruppo');
  await waitUntil(() => liveIn(gf.id).some((f) => f.name === 'Rugby Coach - Libreria esercizi.docx'), 'Word della libreria del gruppo');

  // ---------------- scheda aperta: "Anna ha aggiornato questa scheda" ----------------
  console.log('• B ha aperta la scheda di Anna, Anna la modifica: avviso con il nome, nulla si perde');
  await B.goto(BASE + '#/seduta/' + aSession + '/foglio'); await ready(B);
  await A.goto(BASE + '#/seduta/' + aSession + '/foglio'); await ready(A);
  await A.getByLabel('Luogo (facoltativo)').fill('Campo di Anna'); await settle(A, 700);
  await A.goto(BASE + '#/'); await ready(A);
  await B.locator('.remote-banner', { hasText: 'Anna ha aggiornato questa scheda' }).waitFor({ timeout: 30000 });
  await shot(B, '65-pc-anna-ha-aggiornato');
  await B.locator('.remote-banner').getByRole('button', { name: 'Aggiorna' }).click();
  await waitUntil(async () => (await B.getByLabel('Luogo (facoltativo)').inputValue()) === 'Campo di Anna', 'B vede il luogo di Anna');

  // ---------------- B elimina un elemento del gruppo ----------------
  console.log('• B elimina la scheda di Anna: sparisce ad A e C, il Word va nel cestino, "eliminato da Bruno"');
  await B.goto(BASE + '#/'); await ready(B);
  const card = B.locator('.rec-card', { hasText: 'Seduta del gruppo (Anna)' });
  await card.getByRole('button', { name: 'Altre azioni' }).click();
  await card.getByRole('button', { name: '🗑 Elimina' }).click();
  await confirmModal(B, 'Elimina');
  for (const [P, n] of [[A, 'A'], [C, 'C']]) await waitUntil(async () => !(await has(P, 'sessions', (s) => s.id === aSession)), n + ': la scheda eliminata da B sparisce');
  await waitUntil(() => [...fd.files.values()].filter((f) => f.appProperties?.rcId === aSession).every((f) => f.trashed), 'Word della scheda nel cestino (di Anna)');
  const gid = (await idbAll(A, 'settings')).find((x) => x.key === 'groups').value[0].id;
  await A.goto(BASE + '#/gruppo/' + gid); await ready(A);
  await waitUntil(async () => (await A.locator('body').innerText()).includes('eliminato da Bruno'), 'cestino del gruppo: eliminato da Bruno');

  // ---------------- A chiude gli inviti; D non entra ----------------
  console.log('• A chiude gli inviti; D col link non entra ("chiedi a Anna"); A invita D per email e D entra');
  // promemoria per l'amministratore: qualcuno è entrato → "Tutti dentro? Chiudi gli inviti"
  await A.locator('.banner.reminder', { hasText: 'Tutti dentro? Chiudi gli inviti' }).getByRole('button', { name: 'Chiudi gli inviti' }).click();
  await confirmModal(A, 'Chiudi gli inviti');
  await A.getByText('Gli inviti sono chiusi').waitFor({ timeout: 15000 });
  await waitUntil(() => !gf.perms.some((p) => p.type === 'anyone'), 'permesso "chiunque" rimosso');
  assert.deepEqual(gf.perms.filter((p) => p.type === 'user').map((p) => p.emailAddress).sort(), ['bruno@example.com', 'carla@example.com']);
  const D = await device('D', 'dario@example.com', '<img src=x onerror="window.__xss=1">Dario');
  await D.goto(invUrl); await ready(D);
  await D.getByRole('button', { name: 'Accedi con Google' }).click();
  await joinWithPicker(D);
  assert.equal(await D.locator('.fake-picker .fp-file').count(), 0, 'nessun file per chi non è invitato');
  await D.locator('.fake-picker').getByRole('button', { name: 'Annulla' }).click();
  await D.getByText(/chiedi a Anna di invitarti/i).waitFor({ timeout: 10000 });
  await shot(D, '66-pc-inviti-chiusi');
  await A.getByLabel('Email del collega').fill('dario@example.com');
  await A.getByRole('button', { name: 'Invita', exact: true }).click();
  await A.getByText('Invitato: ora mandagli il link.').waitFor({ timeout: 10000 });
  await D.goto(invUrl); await D.reload(); await ready(D);
  await joinWithPicker(D);
  assert.equal(await D.locator('.fake-picker .fp-file').count(), 7);
  await D.locator('.fake-picker').getByRole('button', { name: 'Seleziona' }).click();
  await D.getByText('Sei nel gruppo "Squadra U12"').first().waitFor({ timeout: 20000 });
  await waitUntil(() => has(D, 'exercises', (e) => e.name === 'Esercizio di Bruno'), 'D riceve i dati del gruppo');
  await A.goto(BASE + '#/gruppo/' + gid); await ready(A);
  await waitUntil(async () => (await A.locator('.member-list').first().innerText()).includes('<img src=x onerror="window.__xss=1">Dario'), 'A vede D tra i membri (nome come testo)');
  assert.equal(await A.evaluate(() => window.__xss), undefined, 'nessuno script dal nome di un membro');
  assert.equal(await A.locator('.member-list img').count(), 0);
  await shot(A, '67-telefono-membri'); await scan(A, 'membri A');

  // ---------------- A toglie C ----------------
  console.log('• A toglie C: C non fa più parte del gruppo, le sue schede personali restano');
  await A.getByRole('button', { name: 'Togli Carla dal gruppo' }).click();
  await confirmModal(A, 'Togli');
  await waitUntil(() => !gf.perms.some((p) => p.emailAddress === 'carla@example.com'), 'permesso di C tolto');
  await C.goto(BASE + '#/impostazioni'); await ready(C);
  await waitUntil(async () => { await C.evaluate(() => window.dispatchEvent(new Event('focus'))); return (await C.locator('#gruppi').innerText()).includes('Non fai più parte di questo gruppo'); }, 'C vede che non fa più parte del gruppo');
  await shot(C, '68-telefono-non-fai-piu-parte');
  assert.ok(await has(C, 'sessions', (s) => s.id === cPersonal && !s.groupId), 'la scheda personale di C resta');
  await C.locator('#gruppi a.group-item').click(); await ready(C);
  await C.getByRole('button', { name: 'Togli dal dispositivo' }).click();
  await waitUntil(async () => !(await has(C, 'exercises', (e) => e.groupId)), 'C: elementi del gruppo tolti dal dispositivo');
  assert.ok(await has(C, 'sessions', (s) => s.id === cPersonal), 'personali ancora lì');

  // ---------------- B esce ----------------
  console.log('• B esce dal gruppo');
  await B.goto(BASE + '#/gruppo/' + gid); await ready(B);
  await B.getByRole('button', { name: 'Esci dal gruppo' }).click();
  await confirmModal(B, 'Esci');
  await B.waitForURL(/#\/impostazioni/);
  assert.ok(!(await has(B, 'exercises', (e) => e.groupId)), 'B: elementi del gruppo tolti');
  await A.goto(BASE + '#/gruppo/' + gid); await ready(A);
  await waitUntil(async () => { await A.evaluate(() => window.dispatchEvent(new Event('focus'))); const t = await A.locator('.member-list').first().innerText(); return !t.includes('Bruno') && t.includes('Dario'); }, 'A: Bruno non è più tra i membri');

  // ---------------- già nel gruppo ----------------
  console.log('• D (già membro) riapre il link: "Sei già nel gruppo" con "Apri"');
  await D.goto(invUrl); await D.reload(); await ready(D);
  await D.getByText('Sei già nel gruppo "Squadra U12"').waitFor({ timeout: 10000 });
  await D.getByRole('link', { name: 'Apri' }).waitFor();

  // ---------------- membro tolto con inviti aperti ----------------
  console.log('• inviti riaperti, A toglie D: gli inviti si chiudono da soli; D non rientra col vecchio link (nemmeno a inviti riaperti)');
  await A.goto(BASE + '#/gruppo/' + gid); await ready(A);
  await A.getByRole('button', { name: 'Riapri gli inviti' }).click();
  await confirmModal(A, 'Riapri comunque');
  await waitUntil(() => gf.perms.some((p) => p.type === 'anyone'), 'inviti riaperti');
  await A.getByRole('button', { name: /^Togli .*Dario dal gruppo$/ }).click();
  await confirmModal(A, 'Togli');
  await A.getByText(/Gli inviti sono stati chiusi così .*Dario non può rientrare col vecchio link\. Puoi riaprirli quando vuoi/).waitFor({ timeout: 15000 });
  await waitUntil(() => !gf.perms.some((p) => p.type === 'anyone' || p.emailAddress === 'dario@example.com'), 'nessun permesso per D');
  await D.goto(invUrl); await D.reload(); await ready(D);
  await waitUntil(async () => { await D.evaluate(() => window.dispatchEvent(new Event('focus'))); return !(await idbAll(D, 'settings')).find((x) => x.key === 'groups')?.value?.some((g) => g.status === 'ok'); }, 'D: gruppo non più attivo');
  await D.goto(BASE + '#/'); await D.goto(invUrl); await ready(D);
  await joinWithPicker(D);
  assert.equal(await D.locator('.fake-picker .fp-file').count(), 0, 'D non vede i file');
  await D.locator('.fake-picker').getByRole('button', { name: 'Annulla' }).click();
  await A.goto(BASE + '#/gruppo/' + gid); await ready(A);
  await A.getByRole('button', { name: 'Riapri gli inviti' }).click();
  await A.getByText(/anche chi hai tolto/).waitFor({ timeout: 5000 });
  await confirmModal(A, 'Riapri comunque');
  await waitUntil(() => gf.perms.some((p) => p.type === 'anyone'), 'inviti riaperti di nuovo');
  await D.goto(BASE + '#/'); await D.goto(invUrl); await ready(D);
  await joinWithPicker(D);
  assert.equal(await D.locator('.fake-picker .fp-file').count(), 7, 'a inviti riaperti D vede di nuovo i file…');
  await D.locator('.fake-picker').getByRole('button', { name: 'Seleziona' }).click();
  await D.getByText(/Sei stato tolto da questo gruppo: per rientrare chiedi a Anna/).waitFor({ timeout: 15000 });
  await shot(D, '69-pc-tolto-non-rientra');
  const manNow = JSON.parse([...fd.files.values()].find((f) => f.appProperties?.rcPart === 'manifest').content);
  const dRow = manNow.members.find((m) => m.email === 'dario@example.com');
  const dRem = manNow.removed.find((r) => r.email === 'dario@example.com');
  assert.ok(!dRow || (dRem && Date.parse(dRem.at) >= Date.parse(dRow.joinedAt)), '…ma l\'app non lo rimette tra i membri');

  // ---------------- gruppo eliminato dall'amministratore ----------------
  console.log('• A invita di nuovo D per email, D rientra; poi A elimina la cartella del gruppo: D vede "eliminato da Anna" e tiene una copia');
  await A.getByLabel('Email del collega').fill('dario@example.com');
  await A.getByRole('button', { name: 'Invita', exact: true }).click();
  await A.getByText('Invitato: ora mandagli il link.').waitFor({ timeout: 10000 });
  await D.goto(BASE + '#/'); await D.goto(invUrl); await ready(D);
  await joinWithPicker(D);
  await D.locator('.fake-picker').getByRole('button', { name: 'Seleziona' }).click();
  await D.getByText('Sei nel gruppo "Squadra U12"').first().waitFor({ timeout: 20000 });
  await waitUntil(() => has(D, 'exercises', (e) => e.name === 'Esercizio di Bruno' && e.groupId), 'D ha di nuovo gli elementi del gruppo');
  gf.trashed = true; // l'amministratore mette la cartella del gruppo nel cestino da Drive
  await D.goto(BASE + '#/impostazioni'); await ready(D);
  await waitUntil(async () => { await D.evaluate(() => window.dispatchEvent(new Event('focus'))); return (await D.locator('#gruppi').innerText()).includes('Il gruppo è stato eliminato da Anna'); }, 'D: "Il gruppo è stato eliminato da Anna"');
  await D.locator('#gruppi a.group-item').click(); await ready(D);
  await D.getByRole('button', { name: 'Tieni una copia personale' }).click();
  await D.waitForURL(/#\/impostazioni/);
  await waitUntil(() => has(D, 'exercises', (e) => e.name === 'Esercizio di Bruno' && !e.groupId), 'D: copia personale degli elementi');
  await shot(D, '70-pc-gruppo-eliminato');

  // ---------------- controlli finali ----------------
  const live = [...fd.files.values()].filter((f) => !f.trashed && f.mimeType !== FOLDER);
  const byFolder = {};
  for (const f of live) { const k = (f.parents || ['radice'])[0] + '|' + f.name; byFolder[k] = (byFolder[k] || 0) + 1; }
  const dups = Object.entries(byFolder).filter(([, n]) => n > 1);
  assert.equal(dups.length, 0, 'nessun duplicato: ' + JSON.stringify(dups));
  assert.equal(live.filter((f) => f.appProperties?.rcKind === 'groupData').length, 5, 'sempre e solo i 5 file del gruppo');
  assert.equal(jargon.length, 0, 'gergo: ' + jargon.join(' | '));
  ok = true;
} finally {
  await browser.close();
  server.kill();
  console.log('Errori in console:', errors.length ? errors : 'nessuno');
}
if (!ok || errors.length) process.exit(1);
console.log('E2E gruppi OK');
