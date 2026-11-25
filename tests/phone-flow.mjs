// Percorso da telefono (390×844 e 360×740) come lo vive un allenatore, con Google e Drive finti.
// Derivato dallo script del verifier (giro 4), adattato al repository e alla seduta che parte vuota (v1.4).
// Uso: node tests/phone-flow.mjs   (screenshot in out/screens/phone-flow/)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const { chromium } = await import('playwright-core');
const SHOTS = path.join(ROOT, 'out/screens/phone-flow');
fs.mkdirSync(SHOTS, { recursive: true });
const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const PORT = await freePort();
const BASE = `http://localhost:${PORT}/`;
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: path.join(ROOT, 'app'), stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const results = [];
const check = (id, ok, detail = '') => { results.push([id, !!ok, String(detail)]); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${detail}`); };
const errors = [];


const GIS_STUB = `
window.google = window.google || {};
window.__gis = { inits: [], requests: [] };
google.accounts = { oauth2: {
  initTokenClient(cfg) { __gis.inits.push({ client_id: cfg.client_id, scope: cfg.scope }); return {
    requestAccessToken(o) {
      __gis.requests.push({ prompt: (o || {}).prompt, active: navigator.userActivation ? navigator.userActivation.isActive : null, mode: window.__gisMode || 'ok' });
      const mode = window.__gisMode || 'ok';
      setTimeout(() => {
        if (mode === 'closed') return cfg.error_callback && cfg.error_callback({ type: 'popup_closed' });
        if (mode === 'blocked') return cfg.error_callback && cfg.error_callback({ type: 'popup_failed_to_open' });
        if (mode === 'denied') return cfg.callback({ error: 'access_denied', error_description: 'The user denied access' });
        if (mode === 'noscope') return cfg.callback({ access_token: 'tok-x', expires_in: 3599, scope: 'email' });
        cfg.callback({ access_token: 'tok-' + __gis.requests.length, expires_in: 3599, scope: cfg.scope });
      }, 60); } }; },
  hasGrantedAllScopes(resp, ...s) { return s.every((x) => (resp.scope || '').split(' ').includes(x)); },
  revoke(t, cb) { cb && cb(); },
} };`;
// ---------- Drive finto, condiviso tra "dispositivi" ----------
const drive = { files: new Map(), calls: [], n: 0, lists: [] };
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
function parseMultipart(buf, ct) {
  const b = /boundary=(.+)$/.exec(ct)[1];
  const s = buf.toString('latin1');
  const parts = s.split('--' + b).slice(1, -1);
  return parts.map((p) => { const i = p.indexOf('\r\n\r\n'); return { head: p.slice(0, i), body: p.slice(i + 4, p.length - 2) }; });
}
async function driveRoute(route) {
  const req = route.request();
  const u = new URL(req.url());
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  const auth = req.headers()['authorization'] || '';
  drive.calls.push({ m: req.method(), p: u.pathname, q: Object.fromEntries(u.searchParams), auth });
  const json = (obj, status = 200) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(obj) });
  if (!auth.startsWith('Bearer tok-')) return json({ error: { code: 401, message: 'Invalid Credentials' } }, 401);
  if (u.pathname === '/drive/v3/about') return json({ user: { displayName: 'Allenatore', emailAddress: 'coach@example.com' } });
  if (u.pathname === '/drive/v3/files' && req.method() === 'POST') {
    const meta = JSON.parse(req.postData()); const id = 'fold' + (++drive.n);
    drive.files.set(id, { ...meta, id }); return json({ id, name: meta.name });
  }
  if (u.pathname === '/drive/v3/files' && req.method() === 'GET') {
    const q = u.searchParams.get('q') || '';
    drive.lists.push(Object.fromEntries(u.searchParams));
    const m1 = /appProperties has \{ key='rcApp' and value='([^']+)' \}/.exec(q);
    const mp = /'([^']+)' in parents/.exec(q);
    const mm = /mimeType='([^']+)'/.exec(q);
    let list = [...drive.files.values()].filter((f) => !f.trashed);
    list = m1 ? list.filter((f) => f.appProperties?.rcApp === m1[1]) : [];
    if (mp) list = list.filter((f) => (f.parents || []).includes(mp[1]));
    if (mm) list = list.filter((f) => f.mimeType === mm[1]);
    return json({ files: list.map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, parents: f.parents, appProperties: f.appProperties, version: String(f.version || 1) })) });
  }
  const dl = /^\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname);
  if (dl && u.searchParams.get('alt') === 'media') { const f = drive.files.get(dl[1]); if (!f) return json({ error: { code: 404, message: 'File not found: ' + dl[1] } }, 404); return route.fulfill({ status: 200, headers: cors, body: f.content }); }
  if (u.pathname === '/upload/drive/v3/files' && req.method() === 'POST') {
    const parts = parseMultipart(req.postDataBuffer(), req.headers()['content-type']);
    const meta = JSON.parse(parts[0].body); const id = 'f' + (++drive.n);
    drive.files.set(id, { ...meta, id, version: 1, created: Date.now(), ctype: req.headers()['content-type'], partHeads: parts.map((p) => p.head), content: Buffer.from(parts[1].body, 'latin1').toString('utf8'), bytes: Buffer.from(parts[1].body, 'latin1') });
    return json({ id, name: meta.name, webViewLink: 'https://drive.example/' + id });
  }
  const pm = /^\/upload\/drive\/v3\/files\/(.+)$/.exec(u.pathname);
  if (pm && req.method() === 'PATCH') {
    const f = drive.files.get(decodeURIComponent(pm[1]));
    if (!f) return json({ error: { code: 404, message: 'File not found' } }, 404);
    const parts = parseMultipart(req.postDataBuffer(), req.headers()['content-type']);
    const meta = JSON.parse(parts[0].body);
    const ap = { ...(f.appProperties || {}), ...(meta.appProperties || {}) }; Object.assign(f, meta, { appProperties: ap, version: f.version + 1, content: Buffer.from(parts[1].body, 'latin1').toString('utf8'), patchMeta: meta, bytes: Buffer.from(parts[1].body, 'latin1') });
    return json({ id: f.id, name: f.name });
  }
  return json({ error: { code: 404, message: 'not mocked ' + u.pathname } }, 404);
}


const browser = await chromium.launch({ executablePath: process.env.CHROME || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p)), args: ['--no-sandbox'] });
const googleHits = [];
async function phone(name, vp) {
  const ctx = await browser.newContext({ viewport: vp, hasTouch: true, isMobile: true, deviceScaleFactor: 2, locale: 'it-IT', acceptDownloads: true });
  await ctx.route(/^https:\/\/([a-z0-9-]+\.)*(google|gstatic)\.com\//, (r) => { const u = r.request().url(); if (u.startsWith('https://accounts.google.com/gsi/client')) return r.fulfill({ status: 200, contentType: 'text/javascript', body: GIS_STUB }); googleHits.push(u); return r.fulfill({ status: 404, body: '' }); });
  await ctx.route('https://www.googleapis.com/**', driveRoute);
  // Web Share con file: simulato (registra i file)
  await ctx.addInitScript(() => { window.__shared = []; navigator.canShare = (d) => !!(d && d.files); navigator.share = async (d) => { window.__shared.push({ title: d.title, files: d.files.map((f) => [f.name, f.size, f.type]), active: navigator.userActivation.isActive }); }; });
  await ctx.addInitScript(() => { window.__toasts = []; new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && n.classList.contains('toast')) window.__toasts.push(n.textContent); }).observe(document, { childList: true, subtree: true }); });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(name + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push(name + ' pageerror: ' + e.message));
  return { ctx, page };
}
const ready = (page) => page.waitForFunction(() => window.__rcReady === true, null, { timeout: 20000 });
const JARGON = /\b(token|sync\w*|sincronizz\w*|json|oauth|coda|api|upload\w*|client ?id|scope|indexeddb|service ?worker|cache|backup|download|url|picker|popup|http\w*|localstorage|drive\.file|errore \d+|drive \d{3}|timeout|app id|endpoint|multipart|offline)\b/gi;
const jargonFound = new Map();
const scanText = async (page, where) => {
  const t = await page.evaluate(() => document.body.innerText);
  for (const m of t.matchAll(JARGON)) { const k = m[0].toLowerCase(); const ctxs = jargonFound.get(where) || new Set(); const i = m.index; ctxs.add(t.slice(Math.max(0, i - 40), i + 30).replace(/\s+/g, ' ')); jargonFound.set(where, ctxs); }
};
const small = (page) => page.evaluate(() => { const out = []; for (const el of document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, summary, [role=radio]')) { const r = el.getBoundingClientRect(); if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight) continue; const st = getComputedStyle(el); if (st.visibility === 'hidden') continue; if (el.closest('.skip, .md-doc p, .md-doc li, .privacy p, .privacy li')) continue; if (r.width < 44 || r.height < 44) out.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 25)}" ${Math.round(r.width)}x${Math.round(r.height)}`); } return [...new Set(out)]; });
const clipped = (page) => page.evaluate(() => { const out = []; for (const el of document.querySelectorAll('button, .btn, .tab, .chip, h1, h2, .field-label, .status-pill, .sync-ind, .drive-invite, label')) { const r = el.getBoundingClientRect(); if (!r.width) continue; if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflow !== 'visible') out.push(`"${el.textContent.trim().slice(0, 30)}" ${el.scrollWidth}>${el.clientWidth}`); if (r.right > innerWidth + 1 && !el.closest('.board-tools, .board-ctx, .tabs')) out.push(`FUORI "${el.textContent.trim().slice(0, 30)}" right=${Math.round(r.right)}`); } return [...new Set(out)].slice(0, 15); });
const ux = {};
const audit = async (page, where, vpName) => { await scanText(page, where); ux[vpName + ' ' + where] = { small: await small(page), clipped: await clipped(page), hscroll: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1) }; };

for (const [vpName, vp] of [['390', { width: 390, height: 844 }], ['360', { width: 360, height: 740 }]]) {
  drive.files.clear(); drive.calls.length = 0; drive.lists = [];
  const { ctx, page } = await phone('P' + vpName, vp);
  let taps = 0; const tap = async (loc) => { await loc.tap(); taps++; };
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, `${vpName}-${n}.png`) });
  try {
    await page.goto(BASE); await ready(page);
    await shot('01-primo-avvio'); await audit(page, 'primo-avvio', vpName);
    check(vpName + ' primo-avvio-un-pulsante', await page.getByRole('button', { name: 'Collega Google Drive' }).count() === 1);
    // popup chiuso e popup bloccato: messaggi
    await page.evaluate(() => { window.__gisMode = 'closed'; });
    await page.getByRole('button', { name: 'Collega Google Drive' }).tap(); await page.waitForTimeout(1200);
    await page.evaluate(() => { window.__gisMode = 'blocked'; });
    await page.getByRole('button', { name: 'Collega Google Drive' }).tap(); await page.waitForTimeout(1200);
    await page.evaluate(() => { window.__gisMode = 'denied'; });
    await page.getByRole('button', { name: 'Collega Google Drive' }).tap(); await page.waitForTimeout(1200);
    await page.evaluate(() => { window.__gisMode = 'noscope'; });
    await page.getByRole('button', { name: 'Collega Google Drive' }).tap(); await page.waitForTimeout(1200);
    const errToasts = await page.evaluate(() => window.__toasts.splice(0));
    check(vpName + ' errori-accesso-mostrati', errToasts.length >= 4, JSON.stringify(errToasts));
    for (const t of errToasts) for (const m of t.matchAll(JARGON)) jargonFound.set('toast-errori', new Set([...(jargonFound.get('toast-errori') || []), t]));
    check(vpName + ' errori-in-italiano', errToasts.every((t) => !/[A-Za-z]+ (denied|user|access)\b|access_denied/i.test(t)), JSON.stringify(errToasts));
    await page.evaluate(() => { window.__gisMode = 'ok'; });
    await page.waitForTimeout(8000);
    // percorso felice
    await tap(page.getByRole('button', { name: 'Collega Google Drive' }));
    await page.getByText('Fatto!').waitFor({ timeout: 10000 });
    await shot('02-collegato'); await audit(page, 'collegato', vpName);
    const fld = [...drive.files.values()].filter((f) => f.mimeType === 'application/vnd.google-apps.folder');
    check(vpName + ' cartella-creata-in-radice', fld.length === 1 && fld[0].name === 'Rugby Coach' && !fld[0].parents, JSON.stringify(fld));
    const g = await page.evaluate(() => window.__gis);
    check(vpName + ' gis-scope+primo-prompt', g.inits.every((i) => i.scope === 'https://www.googleapis.com/auth/drive.file') && g.requests.at(-1).prompt === 'consent' || g.requests.at(-1).prompt === '', JSON.stringify(g.requests));
    check(vpName + ' gis-solo-da-gesto', g.requests.every((r) => r.active === true), JSON.stringify(g.requests.map((r) => r.active)));
    await tap(page.getByRole('button', { name: 'Inizia' }));
    await page.waitForURL(/#\/$/); await page.waitForTimeout(500);
    await shot('03-home'); await audit(page, 'home', vpName);
    await tap(page.getByRole('button', { name: '+ Nuovo allenamento' }).first());
    await page.waitForURL(/seduta\//); await page.waitForTimeout(400);
    await shot('04-foglio'); await audit(page, 'foglio', vpName);
    await tap(page.getByRole('button', { name: '+ Aggiungi esercizio' })); // la seduta parte vuota (v1.4)
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '+ Aggiungi esercizio' }).tap();
    await tap(page.getByLabel('Nome esercizio 1')); await page.keyboard.type('Fulmine – più veloce');
    await tap(page.locator('.t-plan .tr:not(.th)').first().getByRole('button', { name: /Disegna/ }));
    await page.locator('.board-svg').waitFor(); await page.waitForTimeout(300);
    const fb = await page.locator('.board-svg .field').boundingBox();
    await tap(page.locator('.board-tools [aria-label="Giocatore squadra A"]'));
    await page.touchscreen.tap(fb.x + fb.width * 0.4, fb.y + fb.height * 0.4); taps++;
    await tap(page.locator('.board-tools [aria-label="Giocatore squadra B"]'));
    await page.touchscreen.tap(fb.x + fb.width * 0.6, fb.y + fb.height * 0.6); taps++;
    await shot('05-board'); await audit(page, 'board', vpName);
    await tap(page.locator('.board-top').getByRole('button', { name: /Salva/ }));
    await page.locator('.board-overlay').waitFor({ state: 'detached' });
    await page.locator('img.thumb').first().waitFor();
    // Fine allenamento
    const finish = page.getByRole('button', { name: /Fine allenamento/ });
    await finish.scrollIntoViewIfNeeded(); await shot('06-fine'); await audit(page, 'fine-allenamento', vpName);
    await tap(finish);
    await page.waitForURL(/#\/$/); await page.waitForTimeout(6000);
    const sJson = [...drive.files.values()].filter((f) => f.mimeType === 'application/json' && f.appProperties?.rcKind === 'session');
    check(vpName + ' salvato-su-drive-da-solo', sJson.length === 1 && /Fulmine – più veloce/.test(sJson[0].content), 'json sedute=' + sJson.length);
    // condividi
    await page.locator('.rec-card .rec-main').first().tap(); await page.waitForURL(/seduta\//);
    await tap(page.getByRole('button', { name: /Condividi/ }).first());
    await page.waitForTimeout(2500);
    const sh = await page.evaluate(() => window.__shared);
    check(vpName + ' condividi-docx', sh.length === 1 && sh[0].files[0][0].endsWith('.docx') && sh[0].files[0][1] > 5000, JSON.stringify(sh));
    check(vpName + ' condividi-con-gesto-ancora-attivo', sh[0] && sh[0].active === true, 'userActivation al momento di share: ' + (sh[0] && sh[0].active));
    const tapsHappy = taps;
    // token scaduto -> riapertura
    await page.evaluate(() => { const t = JSON.parse(localStorage.getItem('rc.google.token')); t.expiresAt = Date.now() - 1000; localStorage.setItem('rc.google.token', JSON.stringify(t)); });
    await page.reload(); await ready(page);
    await page.getByLabel('Nome esercizio 2').fill('Dopo scadenza');
    await page.waitForTimeout(6000);
    const inv = page.locator('.drive-invite');
    check(vpName + ' invito-visibile-non-bloccante', await inv.isVisible() && await page.locator('dialog[open]').count() === 0);
    await shot('07-invito'); await audit(page, 'invito', vpName);
    // compilazione ancora possibile con l'invito presente
    await page.getByLabel('Nome esercizio 3').fill('Si scrive ancora'); await page.waitForTimeout(800);
    const nBefore = (await page.evaluate(() => window.__gis.requests.length));
    await inv.tap(); taps++;
    await page.waitForTimeout(5000);
    const reqs = await page.evaluate(() => window.__gis.requests);
    check(vpName + ' invito-rinnova-con-prompt-vuoto-da-gesto', reqs.length === nBefore + 1 && reqs.at(-1).prompt === '' && reqs.at(-1).active === true, JSON.stringify(reqs.at(-1)));
    const sJ = [...drive.files.values()].find((f) => f.mimeType === 'application/json' && f.appProperties?.rcKind === 'session');
    check(vpName + ' dopo-invito-salvato', /Dopo scadenza/.test(sJ.content) && /Si scrive ancora/.test(sJ.content) && !(await inv.isVisible()));
    // rinnovo via Fine allenamento
    await page.evaluate(() => { const t = JSON.parse(localStorage.getItem('rc.google.token')); t.expiresAt = Date.now() - 1000; localStorage.setItem('rc.google.token', JSON.stringify(t)); });
    await page.reload(); await ready(page);
    await page.getByLabel('Nome esercizio 4').fill('Rinnovo da Fine'); await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /Fine allenamento/ }).tap(); await page.waitForTimeout(5000);
    const r2 = await page.evaluate(() => window.__gis.requests.at(-1));
    const sJ2 = [...drive.files.values()].find((f) => f.mimeType === 'application/json' && f.appProperties?.rcKind === 'session');
    check(vpName + ' fine-allenamento-rinnova-da-gesto', r2 && r2.active === true && r2.prompt === '' && /Rinnovo da Fine/.test(sJ2.content), JSON.stringify(r2));
    // pagine di testo
    await page.goto(BASE + '#/impostazioni'); await ready(page); await shot('08-impostazioni'); await audit(page, 'impostazioni', vpName);
    await page.goto(BASE + '#/info'); await ready(page); await page.waitForTimeout(600); await shot('09-aiuto'); await audit(page, 'aiuto', vpName);
    await page.goto(BASE + 'privacy.html'); await page.waitForTimeout(600); await shot('10-privacy'); await audit(page, 'privacy', vpName);
    await page.goto(BASE + '#/libreria'); await ready(page); await audit(page, 'libreria', vpName);
    await page.goto(BASE + '#/rosa'); await ready(page); await audit(page, 'rosa', vpName);
    await page.goto(BASE + '#/?t=partite'); await ready(page); await page.getByRole('button', { name: '+ Nuova partita' }).first().tap(); await page.waitForURL(/partita/); await shot('11-partita'); await audit(page, 'partita', vpName);
    await page.goto(BASE + '#/impostazioni'); await ready(page); await page.getByText('Avanzate').tap(); await page.waitForTimeout(400); await scanText(page, 'AVANZATE');
    // offline: messaggio collega
    check(vpName + ' tocchi-percorso', true, `tocchi percorso felice: ${tapsHappy} (collega, inizia, nuovo, campo nome, disegna, 2×(strumento+campo), salva disegno, fine, condividi); +1 invito`);
    check(vpName + ' nessuna-chiamata-google-reale', googleHits.length === 0, googleHits.slice(0, 3).join(','));
  } catch (e) { console.error(e); check(vpName + ' script', false, e.message.split('\n')[0]); try { await shot('FALLITO'); } catch {} }
  await ctx.close();
}
await browser.close(); server.kill();
for (const [w, s] of jargonFound) console.log('GERGO [' + w + ']: ' + [...s].slice(0, 8).join(' || '));
fs.writeFileSync(path.join(ROOT, 'out/phone-flow-ux.json'), JSON.stringify(ux, null, 1));
for (const [k, v] of Object.entries(ux)) if (v.small.length || v.clipped.length || v.hscroll) console.log('UX', k, JSON.stringify(v));
check('console-senza-errori', errors.length === 0, JSON.stringify(errors.slice(0, 5)));
console.log(`\n${results.filter((r) => r[1]).length}/${results.length} PASS`);
process.exit(results.every((r) => r[1]) ? 0 : 1);
