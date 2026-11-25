// Test end-to-end nel browser headless (Playwright + Chrome).
// Uso: node tests/e2e.mjs   (richiede npm install e un Chrome/Chromium; percorso personalizzabile con CHROME=...)
// Avvia un server statico su app/, prova tutte le pagine, la persistenza, la Tactic Board, l'offline e salva screenshot in out/screens/.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const { chromium } = await import('playwright-core');
const SHOTS = path.join(ROOT, 'out', 'screens');
fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
const PORT = Number(process.env.PORT || 8099);
const BASE = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p));

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: path.join(ROOT, 'app'), stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));

const errors = [];
const steps = [];
const step = async (name, fn) => {
  process.stdout.write(`• ${name} … `);
  try { await fn(); steps.push([name, 'ok']); console.log('ok'); } catch (e) {
    steps.push([name, 'FALLITO']); console.log('FALLITO\n', e);
    try { await page.screenshot({ path: path.join(SHOTS, 'FALLITO.png'), fullPage: true }); } catch { /* */ }
    throw e;
  }
};

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true, acceptDownloads: true, locale: 'it-IT' });
// La sandbox non raggiunge Google: gli script GIS/Picker vengono sostituiti da uno stub vuoto
// (le chiamate reali a Drive sono testate con fetch finto in tests/sync.test.mjs).
await context.route(/https:\/\/(accounts|apis)\.google\.com\//, (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: '/* stub Google */' }));
const page = await context.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('response', (r) => { if (r.status() >= 400) console.log('  [HTTP ' + r.status() + '] ' + r.request().method() + ' ' + r.url()); });
page.on('dialog', (d) => d.accept());

const shot = (name, opts = {}) => page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: opts.full ?? false });
const ready = () => page.waitForFunction(() => window.__rcReady === true, null, { timeout: 20000 });
const settle = (ms = 900) => page.waitForTimeout(ms); // attende l'autosave (debounce 500 ms)
const reload = async () => { await page.reload(); await ready(); await settle(300); };

try {
  await step('primo avvio: onboarding e modalità solo locale', async () => {
    await page.goto(BASE);
    await ready();
    assert.match(page.url(), /#\/benvenuto$/);
    await shot('01-onboarding');
    await page.getByRole('button', { name: 'Usa solo in locale per ora' }).click();
    await page.waitForURL(/#\/$/);
    await page.getByText('Modalità solo locale.').waitFor();
    await page.getByText('dati di esempio').first().waitFor();
    await page.getByRole('button', { name: 'Solo locale' }).waitFor();
    await shot('02-home');
  });

  await step('dati di esempio: piano I° trimestre e libreria', async () => {
    await page.getByRole('link', { name: 'Piani trimestrali' }).click();
    await page.locator('.rec-card .rec-main', { hasText: 'I° TRIMESTRE' }).first().click();
    await page.waitForURL(/#\/piano\//);
    await page.getByRole('heading', { name: 'VIII°' }).waitFor();
    assert.equal(await page.locator('.plan-session').count(), 8);
    await shot('03-piano', { full: true });
    await page.getByRole('link', { name: 'Libreria' }).click();
    await page.locator('.ex-card').first().waitFor();
    assert.equal(await page.locator('.ex-card').count(), 16);
    await shot('04-libreria');
  });

  await step('rosa per categoria', async () => {
    await page.getByRole('link', { name: 'Rosa' }).click();
    await page.getByRole('link', { name: 'U8', exact: true }).click();
    await page.waitForURL(/cat=U8/);
    await page.getByText('0 giocatori in U8').waitFor();
    for (const n of ['Luca', 'Giulia', 'Marco']) {
      await page.getByLabel('Nome nuovo giocatore').fill(n);
      await page.getByRole('button', { name: '+ Aggiungi' }).click();
    }
    await page.locator('.player-row').nth(2).waitFor();
    await shot('05-rosa');
  });

  let sessionUrl;
  await step('nuova seduta: foglio allenamento (programma, totali, bilancio, errori, autovalutazione, preparatore)', async () => {
    await page.getByRole('link', { name: 'Schede' }).click();
    await page.getByRole('button', { name: '+ Nuova seduta' }).first().click();
    await page.waitForURL(/#\/seduta\/.+\/foglio$/);
    sessionUrl = page.url();
    await page.locator('.t-plan .tr:not(.th)').first().waitFor();
    assert.equal(await page.locator('.t-plan .tr:not(.th)').count(), 5, '5 righe come l\'originale');
    await page.getByLabel('Data allenamento').fill('2026-11-24');
    await page.locator('.cats').getByRole('button', { name: 'U8', exact: true }).click();
    await page.getByLabel('Nome esercizio 1').fill('Fulmine');
    await page.getByLabel('Durata in minuti').nth(0).fill('15');
    await page.getByLabel('Durata in minuti').nth(1).fill('10');
    await page.getByLabel('Nome esercizio 2').fill('Palla quadrata');
    await page.getByLabel('Obiettivi').first().fill('Vincere la paura del contatto');
    const tag = page.getByLabel('Parole chiave').locator('input').first();
    await tag.fill('avanti');
    await tag.press('Enter');
    await page.locator('.table-foot .total').getByText('25 min').waitFor();
    // bilancio generato dagli esercizi
    assert.equal(await page.locator('.t-review .tr:not(.th)').count(), 5);
    await page.getByLabel('Complessivamente').first().fill('Buona partecipazione');
    await page.locator('.t-review .name-chips').first().getByRole('button', { name: 'Giulia' }).click();
    await page.keyboard.type('timida all\'inizio');
    // errori e cause: Sì/No grandi + nota
    const q1 = page.locator('#sez-errori .qa').first();
    await q1.getByRole('radio', { name: 'No', exact: true }).click();
    await q1.getByRole('textbox').fill('consegne chiare');
    await page.locator('#sez-errori .qa').nth(1).getByRole('radio', { name: 'Sì', exact: true }).click();
    await page.getByRole('radio', { name: /2 — centrato sul pallone \+ sostegno vicino/ }).click();
    await page.locator('#sez-auto .qa').getByRole('radio', { name: 'Sì', exact: true }).click();
    await page.getByPlaceholder('io / nome di un altro allenatore').fill('Marco (vice)');
    await page.getByRole('radio', { name: 'Sufficiente', exact: true }).click();
    await page.getByLabel('Numero di sollecitazioni').fill('24');
    await page.getByRole('radio', { name: 'Adeguato', exact: true }).click();
    // riordino: sposta giù il primo esercizio e torna su
    await page.getByRole('button', { name: 'Sposta giù esercizio 1' }).click();
    assert.equal(await page.getByLabel('Nome esercizio 2').inputValue(), 'Fulmine');
    await page.getByRole('button', { name: 'Sposta su esercizio 2' }).click();
    assert.equal(await page.getByLabel('Nome esercizio 1').inputValue(), 'Fulmine');
    await page.getByRole('button', { name: '+ Aggiungi esercizio' }).click();
    assert.equal(await page.locator('.t-plan .tr:not(.th)').count(), 6);
    await page.getByRole('button', { name: 'Rimuovi esercizio 6' }).click();
    assert.equal(await page.locator('.t-plan .tr:not(.th)').count(), 5);
    await settle();
    await shot('06-foglio-programma');
    await page.locator('#sez-bilancio').scrollIntoViewIfNeeded();
    await shot('07-foglio-bilancio');
    await page.locator('#sez-preparatore').scrollIntoViewIfNeeded();
    await shot('08-foglio-autovalutazione-preparatore');
  });

  await step('Tactic Board: pedine, palla, coni, frecce, mano libera, testo, annulla/ripeti, salvataggio', async () => {
    await page.locator('.t-plan .tr:not(.th)').first().getByRole('button', { name: '✎ Disegna' }).click();
    const svg = page.locator('.board-svg');
    await svg.waitFor();
    const box = await svg.boundingBox();
    const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
    const tool = (label) => page.locator(`.board-tools [aria-label="${label}"]`).click();
    await tool('Giocatore squadra A');
    for (const [fx, fy] of [[0.3, 0.4], [0.35, 0.6], [0.25, 0.7]]) await page.mouse.click(...at(fx, fy));
    await tool('Giocatore squadra B');
    await page.touchscreen.tap(...at(0.6, 0.45)); // tocco
    await page.mouse.click(...at(0.62, 0.62));
    await tool('Palla');
    await page.mouse.click(...at(0.32, 0.43));
    await tool('Cono');
    await page.mouse.click(...at(0.2, 0.2));
    await page.mouse.click(...at(0.8, 0.2));
    await tool('Paletto / bandierina');
    await page.mouse.click(...at(0.8, 0.8));
    await tool('Scudo da placcaggio');
    await page.mouse.click(...at(0.5, 0.3));
    const drag = async (a, b) => { await page.mouse.move(...a); await page.mouse.down(); await page.mouse.move(...b, { steps: 8 }); await page.mouse.up(); };
    await tool('Freccia corsa (continua)');
    await drag(at(0.3, 0.4), at(0.45, 0.35));
    await tool('Freccia passaggio (tratteggiata)');
    await drag(at(0.3, 0.4), at(0.35, 0.58));
    await tool('Freccia calcio (curva, punteggiata)');
    await drag(at(0.35, 0.6), at(0.7, 0.75));
    await tool('Mano libera');
    await drag(at(0.1, 0.85), at(0.25, 0.9));
    await tool('Testo');
    await page.mouse.click(...at(0.5, 0.15));
    await page.locator('dialog.modal input').fill('Meta!');
    await page.locator('dialog.modal').getByRole('button', { name: 'OK' }).click();
    let n = await page.locator('.board-svg .items [data-id]').count();
    assert.equal(n, 15, 'elementi disegnati: ' + n);
    // selezione + trascinamento + elimina
    await tool('Seleziona / sposta');
    await drag(at(0.8, 0.2), at(0.85, 0.3));
    await page.locator('.board-ctx').getByRole('button', { name: 'Elimina' }).click();
    assert.equal(await page.locator('.board-svg .items [data-id]').count(), 14);
    await page.getByRole('button', { name: 'Annulla ultima azione' }).click();
    assert.equal(await page.locator('.board-svg .items [data-id]').count(), 15);
    await page.getByRole('button', { name: 'Ripeti' }).click();
    assert.equal(await page.locator('.board-svg .items [data-id]').count(), 14);
    await page.getByRole('button', { name: 'Annulla ultima azione' }).click();
    // sfondo: metà campo e verticale
    await page.getByRole('button', { name: '⚙ Campo' }).click();
    await page.locator('dialog.modal').getByRole('button', { name: 'Griglia 20×15' }).click();
    await page.locator('dialog.modal').getByRole('button', { name: 'Fatto' }).click();
    await shot('09-tactic-board-griglia');
    await page.getByRole('button', { name: '⚙ Campo' }).click();
    await page.locator('dialog.modal').getByRole('button', { name: 'Minirugby grande 60×35' }).click();
    await page.locator('dialog.modal').getByRole('button', { name: 'Fatto' }).click();
    await shot('10-tactic-board');
    await page.getByRole('button', { name: '✓ Salva' }).click();
    await page.locator('.board-overlay').waitFor({ state: 'detached' });
    await page.locator('.t-plan img.thumb').first().waitFor();
    await settle();
  });

  await step('persistenza dopo ricarica (IndexedDB)', async () => {
    await reload();
    assert.equal(await page.getByLabel('Nome esercizio 1').inputValue(), 'Fulmine');
    assert.equal(await page.getByLabel('Data allenamento').inputValue(), '2026-11-24');
    await page.locator('.table-foot .total').getByText('25 min').waitFor();
    assert.equal(await page.locator('.t-plan img.thumb').count(), 1);
    assert.match(await page.getByLabel('Individualmente').first().inputValue(), /Giulia: timida/);
    assert.equal(await page.locator('#sez-errori .qa').first().getByRole('radio', { name: 'No', exact: true }).getAttribute('aria-checked'), 'true');
    assert.equal(await page.getByRole('radio', { name: 'Sufficiente', exact: true }).getAttribute('aria-checked'), 'true');
    assert.equal(await page.getByLabel('Numero di sollecitazioni').inputValue(), '24');
    // riapertura del disegno vettoriale
    await page.locator('.t-plan .thumb-btn').first().click();
    await page.locator('.board-svg').waitFor();
    assert.equal(await page.locator('.board-svg .items [data-id]').count(), 15);
    await page.getByRole('button', { name: '✕ Chiudi' }).click();
    await page.locator('.board-overlay').waitFor({ state: 'detached' });
  });

  await step('scheda di allenamento (osservazione): presenze, totale, copia dal foglio', async () => {
    await page.getByRole('link', { name: 'Scheda di allenamento (osservazione)' }).click();
    await page.waitForURL(/osservazione$/);
    await page.locator('.t-obs .tr:not(.th)').first().waitFor();
    assert.equal(await page.locator('.t-obs .tr:not(.th)').count(), 4, '4 righe come l\'originale');
    await page.getByLabel('Presenti U6').fill('4');
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'più uno U8' }).click();
    await page.locator('.att-item.total').getByText('7').waitFor();
    await page.getByRole('button', { name: '⇩ Copia esercizi dal foglio allenamento' }).click();
    assert.equal(await page.getByLabel('Nome esercizio 1').inputValue(), 'Fulmine');
    await page.getByLabel('Positivo').first().fill('Tutti hanno corso verso la meta');
    await page.getByLabel('Negativo').first().fill('Passaggi in avanti');
    await settle();
    await shot('11-scheda-osservazione', { full: true });
    await reload();
    assert.equal(await page.getByLabel('Positivo').first().inputValue(), 'Tutti hanno corso verso la meta');
    await page.locator('.att-item.total').getByText('7').waitFor();
  });

  await step('scarica Word della seduta (docx generato nel browser)', async () => {
    await page.getByRole('link', { name: 'Foglio allenamento', exact: true }).click();
    const downloads = [];
    page.on('download', (d) => downloads.push(d));
    await page.getByRole('button', { name: '⬇ Scarica Word' }).click();
    await page.waitForTimeout(2500);
    assert.ok(downloads.length >= 2, 'foglio + osservazione: ' + downloads.length);
    const names = downloads.map((d) => d.suggestedFilename()).sort();
    assert.deepEqual(names, ['2026-11-24 Allenamento U8.docx', '2026-11-24 Scheda di allenamento U8.docx']);
    const dir = path.join(ROOT, 'out', 'e2e-docx');
    fs.mkdirSync(dir, { recursive: true });
    for (const d of downloads) await d.saveAs(path.join(dir, d.suggestedFilename()));
  });

  await step('scheda della partita: contatori +/−, colonna libera, note, totali, persistenza', async () => {
    await page.getByRole('link', { name: 'Schede' }).click();
    await page.getByRole('link', { name: 'Partite' }).click();
    await page.getByRole('button', { name: '+ Nuova partita' }).first().click();
    await page.waitForURL(/#\/partita\//);
    await page.locator('.t-match .tr.totals').waitFor();
    assert.equal(await page.locator('.t-match .tr:not(.th):not(.totals)').count(), 6);
    await page.getByLabel('Data partita').fill('2026-11-22');
    await page.getByLabel('Contro').fill('Rugby Club Esempio');
    await page.getByLabel('Under').selectOption('U8');
    await page.getByLabel('Intestazione colonna 8').fill('METE');
    await page.getByLabel('Intestazione colonna 8').press('Tab');
    await page.getByRole('button', { name: 'più uno METE riga 1' }).waitFor();
    await page.getByLabel('Etichetta riga 1').fill('Luca');
    await page.evaluate(() => window.scrollTo(0, 0)); // l'intestazione della tabella è "sticky"
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'più uno PLACCAGGI ALLE GAMBE riga 1' }).click();
    await page.getByRole('button', { name: 'meno uno PLACCAGGI ALLE GAMBE riga 1' }).click();
    await page.getByRole('button', { name: 'più uno PLACCAGGI ALLE GAMBE riga 2' }).click();
    await page.getByRole('button', { name: 'più uno METE riga 1' }).click();
    await page.getByLabel('Note').fill('Bel concentramento');
    await page.getByLabel('Numero giocatori schierati').fill('9');
    await settle();
    assert.equal(await page.locator('.tr.totals .td').nth(1).innerText(), '3');
    await shot('12-partita', { full: true });
    await reload();
    assert.equal(await page.locator('.tr.totals .td').nth(1).innerText(), '3');
    assert.equal(await page.getByLabel('Intestazione colonna 8').inputValue(), 'METE');
    assert.equal(await page.getByLabel('Numero giocatori schierati').inputValue(), '9');
  });

  await step('piano: crea foglio allenamento precompilato dalla seduta I°', async () => {
    await page.getByRole('link', { name: 'Schede' }).click();
    await page.getByRole('link', { name: 'Piani trimestrali' }).click();
    await page.locator('.rec-card .rec-main', { hasText: 'I° TRIMESTRE' }).first().click();
    await page.locator('.plan-session').first().getByRole('button', { name: '→ Crea foglio allenamento' }).click();
    await page.waitForURL(/#\/seduta\/.+\/foglio$/);
    await page.getByLabel('Nome esercizio 4').waitFor();
    const names = [];
    for (let i = 1; i <= 4; i++) names.push(await page.getByLabel('Nome esercizio ' + i).inputValue());
    assert.deepEqual(names, ['Riscaldamento', 'Fulmine', 'Palla quadrata', 'Partita']);
    await page.getByText('Creato dal piano').waitFor();
  });

  await step('libreria: esercizio con disegno e uso da una riga', async () => {
    await page.getByRole('link', { name: 'Libreria' }).click();
    await page.locator('.ex-card', { hasText: 'Mastino' }).first().click();
    await page.getByRole('button', { name: '✎ Disegna' }).click();
    const box = await page.locator('.board-svg').boundingBox();
    await page.locator('.board-tools [aria-label="Giocatore squadra A"]').click();
    await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.5);
    await page.locator('.board-tools [aria-label="Giocatore squadra B"]').click();
    await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.5);
    await page.getByRole('button', { name: '✓ Salva' }).click();
    await page.locator('img.thumb').waitFor();
    await page.getByLabel('Obiettivi').fill('Placcare in sicurezza');
    await settle();
    await shot('13-esercizio');
    await page.goto(sessionUrl); await ready();
    await page.locator('.t-plan .tr:not(.th)').nth(2).getByRole('button', { name: '📚 Dalla libreria' }).click();
    await page.locator('dialog.modal input[type=search]').fill('masti');
    await page.locator('dialog.modal .pick-item', { hasText: /^Mastino/ }).first().click();
    assert.equal(await page.getByLabel('Nome esercizio 3').inputValue(), 'Mastino');
    assert.equal(await page.locator('.t-plan .tr:not(.th)').nth(2).locator('img.thumb').count(), 1);
  });

  await step('impostazioni: configurazione Google da Impostazioni, export JSON', async () => {
    await page.getByRole('link', { name: 'Impostazioni' }).click();
    await page.getByText('Sincronizzazione monodirezionale').waitFor();
    await shot('14-impostazioni');
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: '⬇ Esporta tutto (JSON)' }).click();
    const d = await dl;
    const file = path.join(ROOT, 'out', 'e2e-backup.json');
    await d.saveAs(file);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(data.app, 'rugby-coach');
    assert.ok(data.data.sessions.length >= 2 && data.data.matches.length >= 1 && data.data.players.length === 3);
    await page.getByLabel('Client ID OAuth').fill('123-test.apps.googleusercontent.com');
    await page.getByRole('button', { name: 'Salva configurazione' }).click();
    await page.getByText('presente (da impostazioni)').waitFor();
    await page.getByRole('button', { name: 'Drive non collegato' }).waitFor();
    await shot('15-impostazioni-configurato', { full: true });
    await page.getByRole('link', { name: 'Schede' }).click();
    await page.getByText('Google Drive non collegato.').waitFor();
    await page.locator('.status-pill', { hasText: 'Salvato in locale' }).first().waitFor();
    await page.getByRole('link', { name: 'Impostazioni' }).click();
    await page.getByText('Configurazione Google Cloud (Client ID, API key, App ID)').click();
    await page.getByRole('button', { name: 'Rimuovi', exact: true }).click();
    await page.getByText('assente — l\'app funziona in solo-locale').waitFor();
  });

  await step('Google Drive simulato: cartella dedicata, upload .docx + .json, aggiornamento dello stesso file (PATCH)', async () => {
    const drive = { files: new Map(), calls: [], n: 0 };
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    await context.route('https://www.googleapis.com/**', async (route) => {
      const req = route.request();
      const u = new URL(req.url());
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      drive.calls.push(`${req.method()} ${u.pathname}${u.search.includes('uploadType=multipart') ? ' multipart' : ''}`);
      assert.equal(req.headers()['authorization'], 'Bearer finto-token');
      const json = (obj) => route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(obj) });
      if (u.pathname === '/drive/v3/files' && req.method() === 'POST') {
        const meta = JSON.parse(req.postData());
        drive.files.set('folder1', { ...meta, id: 'folder1' });
        return json({ id: 'folder1', name: meta.name });
      }
      if (u.pathname === '/upload/drive/v3/files' && req.method() === 'POST') {
        const body = req.postDataBuffer().toString('latin1');
        const meta = JSON.parse(/\r\n\r\n(\{.*?\})\r\n/s.exec(body)[1]);
        const id = 'f' + (++drive.n);
        assert.equal(u.searchParams.get('supportsAllDrives'), 'true');
        const content = body.split('\r\n\r\n').slice(2).join('\r\n\r\n').replace(/\r\n--[^\r\n]+--$/, '');
        drive.files.set(id, { ...meta, id, size: body.length, version: 1, content: Buffer.from(content, 'latin1').toString('utf8') });
        return json({ id, name: meta.name, webViewLink: 'https://drive.example/' + id });
      }
      const media = /^\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname);
      if (media && u.searchParams.get('alt') === 'media') {
        const f = drive.files.get(media[1]);
        return f ? route.fulfill({ status: 200, headers: cors, body: f.content || '' }) : json({}, 404);
      }
      if (u.pathname === '/drive/v3/files' && req.method() === 'GET') {
        assert.equal(u.searchParams.get('supportsAllDrives'), 'true');
        const q = u.searchParams.get('q') || '';
        const parent = /'([^']+)' in parents/.exec(q)?.[1];
        const list = [...drive.files.values()].filter((f) => f.appProperties?.rcApp === 'rugby-coach' && (!parent || (f.parents || []).includes(parent)) && (!/mimeType='application\/json'/.test(q) || f.mimeType === 'application/json'));
        return json({ files: list.map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, parents: f.parents, appProperties: f.appProperties })) });
      }
      const m = /^\/upload\/drive\/v3\/files\/(.+)$/.exec(u.pathname);
      if (m && req.method() === 'PATCH') {
        const f = drive.files.get(m[1]);
        const meta = JSON.parse(/\r\n\r\n(\{.*?\})\r\n/s.exec(req.postDataBuffer().toString('latin1'))[1]);
        assert.ok(!meta.parents);
        const pb = req.postDataBuffer().toString('latin1');
        const content = pb.split('\r\n\r\n').slice(2).join('\r\n\r\n').replace(/\r\n--[^\r\n]+--$/, '');
        Object.assign(f, meta, { version: f.version + 1, content: Buffer.from(content, 'latin1').toString('utf8') });
        return json({ id: f.id, name: f.name });
      }
      return route.fulfill({ status: 404, headers: cors, body: '{}' });
    });
    await page.goto(BASE + '#/impostazioni'); await ready();
    await page.getByLabel('Client ID OAuth').fill('123-test.apps.googleusercontent.com');
    await page.getByLabel('API key').fill('AIzaFinta');
    await page.getByLabel('App ID (numero progetto)').fill('123456789012');
    await page.getByRole('button', { name: 'Salva configurazione' }).click();
    await page.getByText('presente (da impostazioni)').waitFor();
    // token OAuth finto (il popup Google non è testabile qui)
    await page.evaluate(() => localStorage.setItem('rc.google.token', JSON.stringify({ access_token: 'finto-token', expiresAt: Date.now() + 3600e3 })));
    await reload();
    await page.getByLabel('Nome della nuova cartella').fill('Rugby Coach');
    await page.getByRole('button', { name: '＋ Crea cartella dedicata' }).click();
    await page.getByRole('link', { name: 'Rugby Coach' }).waitFor();
    await page.getByRole('button', { name: 'Drive ✓' }).waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.queue .status-pill.synced').length >= 3, null, { timeout: 20000 }).catch(async () => {
      // eslint-disable-line
      await page.goto(BASE + '#/impostazioni'); await ready();
      await page.waitForFunction(() => document.querySelectorAll('.queue .status-pill.synced').length >= 3, null, { timeout: 20000 });
    });
    const names = [...drive.files.values()].map((f) => f.name).sort();
    for (const n of ['2026-11-24 Allenamento U8.docx', '2026-11-24 Allenamento U8.json', '2026-11-24 Scheda di allenamento U8.docx', '2026-11-22 Partita U8 vs Rugby Club Esempio.docx']) {
      assert.ok(names.includes(n), 'manca su Drive: ' + n + ' in ' + names.join(', '));
    }
    assert.ok([...drive.files.values()].filter((f) => f.id !== 'folder1').every((f) => f.parents && f.parents[0] === 'folder1' && f.appProperties.rcApp === 'rugby-coach'));
    await shot('16-drive-simulato', { full: true });
    const before = drive.files.size;
    await page.goto(sessionUrl); await ready();
    await page.getByLabel('Nome esercizio 1').fill('Fulmine (variante)');
    await page.locator('.page-actions .status-pill', { hasText: 'In attesa di sincronizzazione' }).waitFor({ timeout: 5000 });
    await page.locator('.page-actions .status-pill', { hasText: 'Sincronizzato su Drive' }).waitFor({ timeout: 20000 });
    assert.equal(drive.files.size, before, 'nessun file duplicato');
    assert.ok(drive.calls.some((c) => c.startsWith('PATCH /upload/drive/v3/files/') && c.endsWith('multipart')), 'aggiornamento PATCH multipart');
    await page.getByLabel('Nome esercizio 1').fill('Fulmine');
    await settle(5500);
    // libreria esercizi e rosa salvate su Drive (backup .json + .docx della libreria)
    const kinds = new Set([...drive.files.values()].map((f) => f.appProperties?.rcKind));
    assert.ok(kinds.has('exercise') && kinds.has('player'), 'raccolte su Drive: ' + [...kinds].join(','));
    // "Disconnetti e dimentica cartella" e poi la stessa cartella di nuovo: nessun duplicato
    const n0 = drive.files.size;
    await page.goto(BASE + '#/impostazioni'); await ready();
    await page.getByRole('button', { name: 'Disconnetti' }).click();
    await page.locator('dialog.modal').getByRole('button', { name: 'Disconnetti e dimentica cartella' }).click();
    await page.getByText('non scelta').waitFor();
    await page.evaluate(() => sessionStorage.setItem('rc.google.token', JSON.stringify({ access_token: 'finto-token', expiresAt: Date.now() + 3600e3 })));
    await reload();
    // ricrea "Rugby Coach": il finto Drive restituisce lo stesso id cartella (folder1)
    await page.getByRole('button', { name: '＋ Crea cartella dedicata' }).click();
    await page.getByRole('link', { name: 'Rugby Coach' }).waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.queue .status-pill.synced').length >= 4 && !document.querySelector('.queue .status-pill.pending, .queue .status-pill.syncing'), null, { timeout: 25000 });
    assert.equal(drive.files.size, n0, `ricollegando la stessa cartella: ${n0} -> ${drive.files.size} file`);
  });

  await step('offline: l\'app si riapre dalla cache del service worker', async () => {
    await page.goto(BASE + '#/');
    await ready();
    await page.waitForFunction(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; }, null, { timeout: 15000 });
    await reload(); // ora la pagina è controllata dal SW
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 });
    await context.setOffline(true);
    await page.goto(sessionUrl);
    await ready();
    assert.equal(await page.getByLabel('Nome esercizio 1').inputValue(), 'Fulmine');
    await page.getByText('Offline').first().waitFor();
    await page.getByLabel('Nome esercizio 5').fill('Partita finale');
    await settle();
    await shot('17-offline');
    // docx anche offline (libreria vendorizzata in cache)
    const dl = page.waitForEvent('download', { timeout: 10000 });
    await page.getByRole('button', { name: '⬇ Scarica Word' }).click();
    await dl;
    // guida Google Cloud come pagina dell'app, disponibile offline
    await page.goto(BASE + '#/guida'); await ready();
    await page.getByRole('heading', { name: '4. Crea il Client ID (tipo "Applicazione web")' }).waitFor();
    await page.locator('.md-doc table').first().waitFor();
    await shot('17b-guida-offline');
    await context.setOffline(false);
  });

  await step('telefono: layout a card', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(sessionUrl); await ready();
    await shot('18-telefono-foglio');
    await page.locator('#sez-errori').scrollIntoViewIfNeeded();
    await shot('19-telefono-errori');
    await page.goto(BASE + '#/?t=partite'); await ready();
    await page.locator('.rec-main').first().click();
    await page.waitForURL(/#\/partita\//);
    await shot('20-telefono-partita');
    await page.locator('.t-match .tr:not(.th)').first().getByRole('button', { name: '✎ Disegna' }).count();
    await page.goto(sessionUrl); await ready();
    await page.locator('.t-plan .thumb-btn').first().click();
    await page.locator('.board-svg').waitFor();
    await shot('21-telefono-tactic-board');
    await page.getByRole('button', { name: '✕ Chiudi' }).click();
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  await step('elimina i dati di esempio', async () => {
    await page.goto(BASE + '#/'); await ready();
    await page.getByRole('button', { name: 'Elimina esempi' }).click();
    await page.waitForTimeout(1500);
    await ready();
    await page.goto(BASE + '#/libreria'); await ready();
    const n = await page.locator('.ex-card').count();
    assert.equal(n, 1, 'resta solo l\'esercizio modificato? ' + n);
  });
} finally {
  await browser.close();
  server.kill();
  console.log('\nPassi:', steps.map(([n, s]) => `${s === 'ok' ? '✓' : '✗'} ${n}`).join('\n       '));
  console.log('Errori in console:', errors.length ? errors : 'nessuno');
}
if (errors.length) { console.error('ERRORI IN CONSOLE'); process.exit(1); }
if (steps.some(([, s]) => s !== 'ok')) process.exit(1);
console.log('E2E OK. Screenshot in', SHOTS);
