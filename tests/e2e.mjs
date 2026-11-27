// Test end-to-end nel browser headless (Playwright + Chrome).
// Uso: node tests/e2e.mjs   (richiede npm install e un Chrome/Chromium; percorso personalizzabile con CHROME=...)
// Avvia un server statico su app/, prova tutte le pagine, la persistenza, la Tactic Board, l'offline e salva screenshot in out/screens/.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
await context.route('https://www.googleapis.com/**', (route) => route.fulfill({ status: 503, body: '' }));
// Questo E2E prova la modalità SENZA Client ID: config.js reale sostituito da uno vuoto (il Drive è provato,
// sempre con un Drive finto, in tests/e2e-multidevice.mjs). Nessuna chiamata reale a Google.
await context.route(BASE + 'config.js', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: 'export default { clientId: "" };' }));
// Web Share API finta: registra i file condivisi (verifica del pulsante "Condividi")
await context.addInitScript(() => {
  window.__shared = [];
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: (d) => !!(d && d.files && d.files.length && d.files.every((f) => f instanceof File)) });
  Object.defineProperty(navigator, 'share', { configurable: true, value: async (d) => { window.__shared.push(d.files.map((f) => ({ name: f.name, type: f.type, size: f.size }))); } });
});
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
  await step('primo avvio senza Client ID: schermata semplice e app solo sul telefono', async () => {
    await page.goto(BASE);
    await ready();
    assert.match(page.url(), /#\/benvenuto$/);
    await page.getByRole('heading', { name: 'Benvenuto in Rugby Coach' }).waitFor();
    assert.equal(await page.getByText(/Client ID|API key|configura/i).count(), 0, 'nessun campo di configurazione per l\'utente');
    await shot('01-onboarding');
    await page.getByRole('button', { name: 'Inizia' }).click();
    await page.waitForURL(/#\/$/);
    await page.getByRole('button', { name: 'Sul telefono' }).waitFor();
    await shot('02-home');
  });

  await step('dati di esempio: piano I° trimestre e libreria', async () => {
    await page.getByRole('link', { name: 'Piani', exact: true }).click();
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
  // aggiunge sezioni dal foglio "+ Aggiungi sezione"
  const addSections = async (labels, remember = false) => {
    await page.getByRole('button', { name: '+ Aggiungi sezione' }).click();
    const dlg = page.locator('dialog.modal');
    await dlg.waitFor();
    for (const l of labels) await dlg.locator('.module-option', { hasText: l }).locator('input').check();
    if (remember) await dlg.getByText('Ricorda queste sezioni').click();
    await dlg.getByRole('button', { name: 'Aggiungi', exact: true }).click();
    await dlg.waitFor({ state: 'detached' });
  };
  const moduleOrder = () => page.locator('section.module').evaluateAll((els) => els.map((e) => e.dataset.module));

  await step('nuova seduta: parte VUOTA con il solo Programma; esercizi con "+"; sezioni aggiunte, spostate e tolte', async () => {
    await page.getByRole('link', { name: 'Schede' }).click();
    await page.getByRole('button', { name: '+ Nuovo allenamento' }).first().click();
    await page.waitForURL(/#\/seduta\/.+\/foglio$/);
    sessionUrl = page.url();
    await page.getByText('Ancora nessun esercizio').waitFor();
    assert.equal(await page.locator('.t-plan .tr:not(.th)').count(), 0, 'nessuna riga prefissata');
    assert.deepEqual(await moduleOrder(), ['program'], 'solo il Programma');
    await shot('05b-seduta-nuova-vuota');
    await page.getByLabel('Data allenamento').fill('2026-11-24');
    await page.locator('.cats').getByRole('button', { name: 'U8', exact: true }).click();
    for (let i = 0; i < 5; i++) await page.getByRole('button', { name: '+ Aggiungi esercizio' }).click();
    assert.equal(await page.locator('.t-plan .tr:not(.th)').count(), 5);
    await page.getByLabel('Nome esercizio 1').fill('Fulmine');
    await page.getByLabel('Durata in minuti').nth(0).fill('15');
    await page.getByLabel('Durata in minuti').nth(1).fill('10');
    await page.getByLabel('Nome esercizio 2').fill('Palla quadrata');
    await page.getByLabel('Obiettivi').first().fill('Vincere la paura del contatto');
    const tag = page.getByLabel('Parole chiave').locator('input').first();
    await tag.fill('avanti');
    await tag.press('Enter');
    await page.locator('.table-foot .total').getByText('25 min').waitFor();
    // sezioni: foglio di scelta con descrizioni
    await addSections(['Bilancio della seduta', 'Errori e cause', 'Autovalutazione', 'Preparatore atletico']);
    assert.deepEqual(await moduleOrder(), ['program', 'review', 'errors', 'selfeval', 'trainer']);
    // bilancio generato dagli esercizi
    assert.equal(await page.locator('.t-review .tr:not(.th)').count(), 5);
    await page.getByLabel('Complessivamente').first().fill('Buona partecipazione');
    await page.locator('.t-review .name-chips').first().getByRole('button', { name: 'Giulia' }).click();
    await page.keyboard.type('timida all\'inizio');
    const q1 = page.locator('#mod-errors .qa').first();
    await q1.getByRole('radio', { name: 'No', exact: true }).click();
    await q1.getByRole('textbox').fill('consegne chiare');
    await page.locator('#mod-errors .qa').nth(1).getByRole('radio', { name: 'Sì', exact: true }).click();
    await page.getByRole('radio', { name: /2 — centrato sul pallone \+ sostegno vicino/ }).click();
    await page.locator('#mod-selfeval .qa').getByRole('radio', { name: 'Sì', exact: true }).click();
    await page.getByPlaceholder('io / nome di un altro allenatore').fill('Marco (vice)');
    await page.getByRole('radio', { name: 'Sufficiente', exact: true }).click();
    await page.getByLabel('Numero di sollecitazioni').fill('24');
    await page.getByRole('radio', { name: 'Adeguato', exact: true }).click();
    // riordino delle sezioni
    await page.getByRole('button', { name: 'Sposta su la sezione Preparatore atletico' }).click();
    assert.deepEqual(await moduleOrder(), ['program', 'review', 'errors', 'trainer', 'selfeval']);
    await page.getByRole('button', { name: 'Sposta giù la sezione Preparatore atletico' }).click();
    // una sezione vuota tolta sparisce senza domande; una con dati chiede conferma
    await addSections(['Presenze']);
    await page.getByRole('button', { name: 'Togli la sezione Presenze' }).click();
    assert.ok(!(await moduleOrder()).includes('attendance'));
    // riordino esercizi
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
    await page.locator('#mod-review').scrollIntoViewIfNeeded();
    await shot('07-foglio-bilancio');
    await page.locator('#mod-trainer').scrollIntoViewIfNeeded();
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
    // fasi dell'azione: + Fase, sposto una pedina (resta l'ombra della fase prima), Guarda, torno alla fase 1
    const phases = page.locator('.board-phases');
    await phases.getByText('Fase 1 di 1').waitFor();
    await phases.getByRole('button', { name: 'Aggiungi una fase dopo questa' }).click();
    await phases.getByText('Fase 2 di 2').waitFor();
    await drag(at(0.62, 0.62), at(0.78, 0.5));
    assert.equal(await page.locator('.board-svg .ghosts [data-id]').count(), 1, 'ombra della pedina nella fase prima');
    assert.equal(await page.locator('.board-svg .items [data-id]').count(), 15, 'stessi elementi in tutte le fasi');
    await shot('10b-tactic-board-fase2');
    await phases.getByRole('button', { name: 'Guarda l\'azione animata' }).click();
    await phases.getByRole('button', { name: 'Ferma l\'animazione' }).waitFor();
    await phases.getByRole('button', { name: 'Guarda l\'azione animata' }).waitFor({ timeout: 6000 }); // finisce da sola
    await phases.getByRole('button', { name: 'Fase precedente' }).click();
    await phases.getByText('Fase 1 di 2').waitFor();
    assert.equal(await page.locator('.board-svg .ghosts').count(), 0);
    await page.getByRole('button', { name: '✓ Salva' }).click();
    await page.locator('.board-overlay').waitFor({ state: 'detached' });
    await page.locator('.t-plan img.thumb').first().waitFor();
    await settle();
    // riaperto: la fase c'è ancora
    await page.locator('.t-plan .thumb-btn').first().click();
    await page.locator('.board-phases').getByText('Fase 1 di 2').waitFor();
    await page.getByRole('button', { name: '✕ Chiudi' }).click();
    await page.locator('.board-overlay').waitFor({ state: 'detached' });
  });

  await step('persistenza dopo ricarica (IndexedDB)', async () => {
    await reload();
    assert.equal(await page.getByLabel('Nome esercizio 1').inputValue(), 'Fulmine');
    assert.equal(await page.getByLabel('Data allenamento').inputValue(), '2026-11-24');
    await page.locator('.table-foot .total').getByText('25 min').waitFor();
    assert.equal(await page.locator('.t-plan img.thumb').count(), 1);
    assert.match(await page.getByLabel('Individualmente').first().inputValue(), /Giulia: timida/);
    assert.equal(await page.locator('#mod-errors .qa').first().getByRole('radio', { name: 'No', exact: true }).getAttribute('aria-checked'), 'true');
    assert.deepEqual(await moduleOrder(), ['program', 'review', 'errors', 'selfeval', 'trainer'], 'sezioni e ordine salvati');
    assert.equal(await page.getByRole('radio', { name: 'Sufficiente', exact: true }).getAttribute('aria-checked'), 'true');
    assert.equal(await page.getByLabel('Numero di sollecitazioni').inputValue(), '24');
    // riapertura del disegno vettoriale
    await page.locator('.t-plan .thumb-btn').first().click();
    await page.locator('.board-svg').waitFor();
    assert.equal(await page.locator('.board-svg .items [data-id]').count(), 15);
    await page.getByRole('button', { name: '✕ Chiudi' }).click();
    await page.locator('.board-overlay').waitFor({ state: 'detached' });
  });

  await step('sezioni Presenze e Osservazione esercizi (partono dagli esercizi del programma); "Ricorda queste sezioni"', async () => {
    await addSections(['Presenze', 'Osservazione esercizi'], true);
    await page.locator('#mod-observation .t-obs .tr:not(.th)').first().waitFor();
    assert.equal(await page.locator('.t-obs .tr:not(.th)').count(), 2, 'una riga per esercizio con nome');
    assert.equal(await page.getByLabel('Esercizio osservato 1').inputValue(), 'Fulmine');
    await page.getByLabel('Presenti U6').fill('4');
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'più uno U8' }).click();
    await page.locator('.att-item.total').getByText('7').waitFor();
    await page.getByLabel('Positivo').first().fill('Tutti hanno corso verso la meta');
    await page.getByLabel('Negativo').first().fill('Passaggi in avanti');
    await settle();
    await shot('11-scheda-osservazione', { full: true });
    await reload();
    assert.equal(await page.getByLabel('Positivo').first().inputValue(), 'Tutti hanno corso verso la meta');
    await page.locator('.att-item.total').getByText('7').waitFor();
    // togliere una sezione con dati chiede conferma (dialog dell'app, Esc = annulla)
    await page.getByRole('button', { name: 'Togli la sezione Presenze' }).click();
    await page.locator('dialog.modal').getByText('Togliere la sezione').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('dialog.modal').waitFor({ state: 'detached' });
    assert.ok((await moduleOrder()).includes('attendance'), 'Esc annulla');
    // le sezioni ricordate valgono per il prossimo allenamento; si torna al solo Programma da Impostazioni
    await page.goto(BASE + '#/'); await ready();
    await page.getByRole('button', { name: '+ Nuovo allenamento' }).first().click();
    await page.waitForURL(/#\/seduta\//);
    await page.locator('section.module').first().waitFor();
    assert.equal((await moduleOrder()).length, 7, 'sezioni ricordate');
    // voce semplice in Impostazioni (fuori da Avanzate): mostra le sezioni ricordate e si toglie in un tocco
    await page.goto(BASE + '#/impostazioni'); await ready();
    const secCard = page.locator('section#sezioni');
    await secCard.getByRole('heading', { name: 'Sezioni della seduta' }).waitFor();
    assert.ok(await secCard.locator('input[value="attendance"]').isChecked(), 'Presenze ricordata');
    await secCard.locator('label.module-option', { hasText: 'Presenze' }).click();
    await page.locator('section#sezioni input[value="attendance"]:not(:checked)').waitFor();
    assert.equal((await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('rugby-coach'); r.onsuccess = () => { const g = r.result.transaction('settings').objectStore('settings').get('prefs'); g.onsuccess = () => res(g.result.value.defaultModules); }; }))).includes('attendance'), false);
    await page.locator('section#sezioni').getByRole('button', { name: 'Torna al solo Programma' }).click();
    await page.waitForFunction(() => document.querySelectorAll('section#sezioni input:checked').length === 1, null, { timeout: 5000 }); // solo Programma
    assert.equal(await page.locator('section#sezioni').getByRole('button', { name: 'Torna al solo Programma' }).count(), 0);
    // l'allenamento di prova è rimasto vuoto: uscendo viene scartato, in home c'è solo quello di prima
    await page.goto(BASE + '#/'); await ready();
    await page.locator('.rec-card').first().waitFor();
    await settle(300);
    assert.equal(await page.locator('.rec-card').count(), 1, 'allenamento nuovo vuoto non salvato');
    assert.equal(await page.locator('.rec-card').filter({ hasNotText: '24/11/2026' }).count(), 0);
    await page.goto(sessionUrl); await ready();
  });

  await step('Condividi (Web Share con file) e Scarica Word dal menu Altro', async () => {
    await page.getByRole('button', { name: '↗ Condividi' }).click();
    await page.waitForFunction(() => window.__shared.length === 1, null, { timeout: 10000 });
    const shared = await page.evaluate(() => window.__shared[0]);
    assert.deepEqual(shared.map((f) => f.name), ['2026-11-24 Allenamento U8.docx'], 'un solo documento con tutte le sezioni');
    assert.ok(shared.every((f) => f.type.includes('wordprocessingml') && f.size > 3000));
    const downloads = [];
    page.on('download', (d) => downloads.push(d));
    await page.getByRole('button', { name: 'Altre azioni' }).click();
    await page.getByRole('button', { name: '⬇ Scarica Word' }).click();
    await page.waitForTimeout(2500);
    assert.equal(downloads.length, 1);
    assert.deepEqual(downloads.map((d) => d.suggestedFilename()), ['2026-11-24 Allenamento U8.docx']);
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
    assert.equal(await page.locator('.t-match .tr:not(.th):not(.totals)').count(), 1, 'una riga minima');
    await page.getByRole('button', { name: '+ Aggiungi riga' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.t-match .tr:not(.th):not(.totals)').length === 2);
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
    await page.goto(BASE + '#/?t=piani'); await ready();
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

  await step('libreria: Condividi la libreria esercizi (un .docx con i disegni)', async () => {
    await page.goto(BASE + '#/libreria'); await ready();
    await page.getByRole('button', { name: '↗ Condividi la libreria' }).click();
    await page.waitForFunction(() => window.__shared.length >= 1, null, { timeout: 10000 }); // (l'elenco riparte a ogni caricamento di pagina)
    const f = await page.evaluate(() => window.__shared.at(-1));
    assert.equal(f.length, 1);
    assert.equal(f[0].name, 'Rugby Coach - Libreria esercizi.docx');
  });

  await step('impostazioni: niente configurazione in vista; avanzate chiuse; esporta dati da Avanzate', async () => {
    await page.goto(BASE + '#/impostazioni'); await ready();
    await page.getByText('il salvataggio su Google Drive non è attivo').waitFor();
    assert.equal(await page.getByLabel('Client ID OAuth').isVisible(), false, 'campi sviluppatore nascosti');
    await shot('14-impostazioni');
    await page.getByText('Avanzate', { exact: true }).click();
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: '⬇ Esporta tutti i dati (file .json)' }).click();
    const d = await dl;
    const file = path.join(ROOT, 'out', 'e2e-backup.json');
    await d.saveAs(file);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(data.app, 'rugby-coach');
    assert.ok(data.data.sessions.length >= 2 && data.data.matches.length >= 1 && data.data.players.length === 3);
    await page.getByText('Configurazione Google (sviluppatori)').click();
    await page.getByLabel('Client ID OAuth').fill('123-test.apps.googleusercontent.com');
    await page.getByRole('button', { name: 'Salva configurazione' }).click();
    await page.getByRole('button', { name: 'Collega Google Drive' }).waitFor();
    await shot('15-impostazioni-configurato', { full: true });
    await page.goto(BASE + '#/'); await ready();
    await page.getByText('Salva le schede su Google Drive').waitFor();
    await page.locator('.status-pill', { hasText: 'Salvato sul telefono' }).first().waitFor();
    await page.goto(BASE + '#/impostazioni'); await ready();
    await page.getByText('Avanzate', { exact: true }).click();
    await page.getByText('Configurazione Google (sviluppatori)').click();
    await page.getByRole('button', { name: 'Rimuovi', exact: true }).click();
    await page.getByText('il salvataggio su Google Drive non è attivo').waitFor();
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
    // documento Word anche offline (libreria vendorizzata in cache)
    await page.getByRole('button', { name: '↗ Condividi' }).click();
    await page.waitForFunction(() => window.__shared.length >= 1, null, { timeout: 10000 });
    // aiuto per l'allenatore come pagina dell'app, disponibile offline
    await page.goto(BASE + '#/info'); await ready();
    await page.getByRole('heading', { name: 'Mettere l\'app sul telefono' }).waitFor();
    await page.getByRole('heading', { name: 'Se cambio telefono' }).waitFor();
    await shot('17b-aiuto-offline');
    await context.setOffline(false);
  });

  await step('telefono (390×844 e 360×740): pagine principali, nessun gergo tecnico, nessuno scorrimento orizzontale', async () => {
    const JARGON = /\b(token|sync|json|oauth|coda|client id|api key|indexeddb|service worker|backup|cache|sincronizz\w*|in locale)\b/i;
    const userPages = {
      home: '#/', partite: '#/?t=partite', piani: '#/?t=piani', foglio: sessionUrl.replace(BASE, ''), osservazione: sessionUrl.replace(BASE, '').replace(/foglio$/, 'osservazione'),
      libreria: '#/libreria', rosa: '#/rosa', impostazioni: '#/impostazioni', aiuto: '#/info',
    };
    for (const [w, hgt] of [[390, 844], [360, 740]]) {
      await page.setViewportSize({ width: w, height: hgt });
      for (const [name, url] of Object.entries(userPages)) {
        await page.goto(BASE + url); await ready(); await settle(400);
        const text = await page.evaluate(() => document.body.innerText);
        const m = JARGON.exec(text);
        assert.ok(!m, `gergo tecnico "${m && m[0]}" in ${name} (${w}px)`);
        const hs = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        assert.ok(hs <= 1, `scorrimento orizzontale in ${name} (${w}px): ${hs}px`);
        if (w === 390) await shot(`18-telefono-${name}`);
      }
      await page.goto(BASE + '#/partita/' + (await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('rugby-coach'); r.onsuccess = () => { const g = r.result.transaction('matches').objectStore('matches').getAll(); g.onsuccess = () => res(g.result[0].id); }; })))); await ready();
      assert.ok(!JARGON.test(await page.evaluate(() => document.body.innerText)), 'gergo nella partita');
      if (w === 390) await shot('18-telefono-partita');
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(sessionUrl); await ready();
    await page.locator('.t-plan .thumb-btn').first().click();
    await page.locator('.board-svg').waitFor();
    await shot('21-telefono-tactic-board');
    await page.getByRole('button', { name: '✕ Chiudi' }).click();
    // menu ⋯ di una scheda nell'elenco
    await page.goto(BASE + '#/'); await ready();
    await page.locator('.rec-card').first().getByRole('button', { name: 'Altre azioni' }).click();
    await shot('22-telefono-menu-scheda');
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  await step('PC (1366×768, 1440×900, 1920×1080): barra in alto, spazio usato, dialog con tastiera, Tactic Board col mouse', async () => {
    const pages = { home: '#/', allenamento: sessionUrl.replace(BASE, ''), partite: '#/?t=partite', libreria: '#/libreria', impostazioni: '#/impostazioni', aiuto: '#/info' };
    for (const [w, hgt] of [[1366, 768], [1440, 900], [1920, 1080]]) {
      await page.setViewportSize({ width: w, height: hgt });
      for (const [name, url] of Object.entries(pages)) {
        await page.goto(BASE + url); await ready(); await settle(300);
        const hs = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        assert.ok(hs <= 1, `scorrimento orizzontale in ${name} (${w}px): ${hs}px`);
        assert.ok(await page.locator('.app-bar .main-nav').isVisible(), 'navigazione in alto su PC');
        assert.equal(await page.locator('.bottom-nav').isVisible(), false, 'niente barra in basso su PC');
        if (w !== 1366 || ['home', 'allenamento'].includes(name)) await shot(`40-pc-${w}-${name}`);
      }
      // elenco: più colonne di schede, non una colonna stirata
      await page.goto(BASE + '#/?t=partite'); await ready();
      const main = await page.locator('main').boundingBox();
      assert.ok(main.width <= 1700, 'larghezza contenuta su schermi grandi');
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    // dialog con la tastiera: Tab porta alle scelte, Spazio seleziona, Esc chiude
    await page.goto(sessionUrl); await ready();
    await page.getByRole('button', { name: 'Togli la sezione Presenze' }).click();
    await page.locator('dialog.modal').waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Annulla', 'fuoco sul pulsante sicuro');
    await page.keyboard.press('Enter');
    await page.locator('dialog.modal').waitFor({ state: 'detached' });
    assert.ok((await moduleOrder()).includes('attendance'), 'Invio su Annulla non toglie la sezione');
    await page.getByRole('button', { name: 'Togli la sezione Presenze' }).click();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Togli sezione');
    await page.keyboard.press('Enter');
    await page.locator('dialog.modal').waitFor({ state: 'detached' });
    assert.ok(!(await moduleOrder()).includes('attendance'), 'Tab + Invio conferma');
    await page.getByRole('button', { name: '+ Aggiungi sezione' }).click();
    await page.locator('dialog.modal').waitFor();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.type), 'checkbox');
    await page.keyboard.press('Space');
    await shot('41-pc-aggiungi-sezione');
    await page.keyboard.press('Escape');
    await page.locator('dialog.modal').waitFor({ state: 'detached' });
    assert.ok(!(await moduleOrder()).includes('attendance'), 'Esc non aggiunge nulla');
    // menu ⋯ col mouse
    await page.getByRole('button', { name: 'Altre azioni' }).click();
    await page.getByRole('button', { name: '🖶 Stampa' }).waitFor();
    await page.mouse.click(5, 300);
    // Tactic Board col mouse: trascinamento di una pedina
    await page.locator('.t-plan .thumb-btn').first().click();
    const svg = page.locator('.board-svg');
    await svg.waitFor();
    const pl = page.locator('.board-svg .bi-player').first();
    const b0 = await pl.boundingBox();
    await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2);
    await page.mouse.down();
    await page.mouse.move(b0.x + b0.width / 2 + 120, b0.y + b0.height / 2 + 40, { steps: 10 });
    await page.mouse.up();
    const b1 = await page.locator('.board-svg .bi-player').first().boundingBox();
    assert.ok(Math.abs(b1.x - b0.x) > 60, 'pedina trascinata col mouse');
    await shot('42-pc-tactic-board');
    await page.keyboard.press('Control+z');
    await page.getByRole('button', { name: '✕ Chiudi' }).click();
    if (await page.locator('dialog.modal').count()) await page.locator('dialog.modal').getByRole('button', { name: 'Chiudi senza salvare' }).click();
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  await step('elimina i dati di esempio (Impostazioni › Avanzate)', async () => {
    await page.goto(BASE + '#/impostazioni'); await ready();
    await page.getByText('Avanzate', { exact: true }).click();
    await page.getByRole('button', { name: /Elimina dati di esempio/ }).click();
    await page.locator('dialog.modal').getByRole('button', { name: 'Elimina esempi' }).click();
    await page.waitForTimeout(1500);
    await ready();
    await page.goto(BASE + '#/libreria'); await ready();
    const n = await page.locator('.ex-card').count();
    assert.equal(n, 1, 'resta solo l\'esercizio modificato? ' + n);
  });
  await step('config.js reale: la prima schermata propone subito "Collega Google Drive" (Google simulato, nessuna chiamata reale)', async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'it-IT' });
    const googleHits = [];
    await ctx.route(/^https:\/\/([a-z0-9-]+\.)*(google|googleapis|gstatic)\.com\//, (route) => { googleHits.push(route.request().url()); route.fulfill({ status: 200, contentType: 'text/javascript', body: '/* stub */' }); });
    const p2 = await ctx.newPage();
    p2.on('console', (m) => { if (m.type() === 'error') errors.push('config reale: ' + m.text()); });
    await p2.goto(BASE); await p2.waitForFunction(() => window.__rcReady === true, null, { timeout: 20000 });
    await p2.getByRole('heading', { name: 'Salva le tue schede su Google Drive' }).waitFor();
    await p2.getByRole('button', { name: 'Collega Google Drive' }).waitFor();
    assert.equal(await p2.locator('.bottom-nav').isVisible(), false, 'prima schermata essenziale');
    const cfg = fs.readFileSync(path.join(ROOT, 'app', 'config.js'), 'utf8');
    assert.match(cfg, /clientId: '\d+-[a-z0-9]+\.apps\.googleusercontent\.com'/, 'Client ID reale in app/config.js');
    await p2.screenshot({ path: path.join(SHOTS, '29-telefono-onboarding-config-reale.png') });
    await p2.getByRole('link', { name: 'Informativa sulla privacy' }).click();
    await p2.getByRole('heading', { name: 'Informativa sulla privacy' }).waitFor();
    await p2.getByText('drive.file').first().waitFor();
    await p2.getByRole('link', { name: 'bordonileonardo@gmail.com' }).waitFor();
    await p2.screenshot({ path: path.join(SHOTS, '29b-telefono-privacy.png'), fullPage: true });
    assert.ok(googleHits.every((u) => /accounts\.google\.com\/gsi\/client/.test(u)), 'solo lo script di accesso (simulato): ' + googleHits.join(', '));
    await ctx.close();
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
