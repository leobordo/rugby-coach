// Genera un .docx di esempio per ogni scheda in out/ e controlla struttura e apertura (LibreOffice -> PDF -> PNG).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as docx from '../app/vendor/docx.mjs';
import { buildDocxFiles, buildArtifacts } from '../app/js/artifacts.js';
import { pngSize, dataUrlToBytes } from '../app/js/docx-build.js';
import { OUT, hasCmd, sampleSession, sampleMatch, samplePlan, boardWithThumb, M } from './fixtures.mjs';
import { buildSeed } from '../app/js/seed.js';

const DOCX_DIR = path.join(OUT, 'docx');
fs.mkdirSync(DOCX_DIR, { recursive: true });

function unzipText(file, entry) {
  return execFileSync('unzip', ['-p', file, entry], { maxBuffer: 64 << 20 }).toString('utf8');
}
function unzipList(file) {
  return execFileSync('unzip', ['-Z1', file]).toString('utf8').split('\n').filter(Boolean);
}

async function writeDocs(rec, prefix) {
  const files = await buildDocxFiles(docx, rec);
  const paths = [];
  for (const f of files) {
    const p = path.join(DOCX_DIR, `${prefix}-${f.key}.docx`);
    fs.writeFileSync(p, f.data);
    paths.push({ ...f, path: p });
  }
  return paths;
}

const results = {};

test('PNG: lettura dimensioni e data URL', () => {
  const tiny = dataUrlToBytes('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==');
  assert.deepEqual(pngSize(tiny), { width: 1, height: 1 });
  assert.equal(pngSize(new Uint8Array([1, 2, 3])), null);
});

test('Foglio allenamento + Scheda di allenamento (.docx A4 orizzontale, tabelle, disegni)', async () => {
  const s = sampleSession();
  const files = await writeDocs(s, 'seduta');
  assert.deepEqual(files.map((f) => f.key), ['docx-plan', 'docx-observation']);
  assert.equal(files[0].name, '2026-11-24 Allenamento U8.docx');
  assert.equal(files[1].name, '2026-11-24 Scheda di allenamento U8.docx');
  const plan = unzipText(files[0].path, 'word/document.xml');
  assert.match(plan, /w:orient="landscape"/);
  for (const t of ['ESERCIZIO E DURATA', 'MATERIALE', 'OBIETTIVI', 'PAROLE', 'COSA OSSERVO', 'BILANCIO DELLA SEDUTA', 'ERRORI E CAUSE',
    'Consegne iniziali poco chiare?', 'Ho fatto domande?', 'centrato sul pallone e sullo spazio', 'Con preparatore atletico', 'Fulmine', 'Durata totale', '70 min', 'Marco (vice)', 'Paolo', '24/11/2026']) {
    assert.ok(plan.includes(t), 'manca nel foglio: ' + t);
  }
  assert.equal((plan.match(/<w:tbl>/g) || []).length >= 3, true, 'programma + bilancio (con tabella annidata) + sezioni D/E');
  assert.ok(unzipList(files[0].path).some((f) => f.startsWith('word/media/')), 'disegni incorporati come immagini');
  const obs = unzipText(files[1].path, 'word/document.xml');
  for (const t of ['ALLENAMENTO DEL', 'N.U6', 'N.U16', 'TOT. 15', 'OBIETTIVO', 'POSITIVO', 'NEGATIVO', 'MIGLIORAMENTI DA', 'Tutti hanno corso']) {
    assert.ok(obs.includes(t), 'manca nella scheda: ' + t);
  }
  assert.match(obs, /w:orient="landscape"/);
  results.seduta = files.map((f) => f.path);
});

test('Scheda della partita (.docx A4 orizzontale, 8 colonne + etichetta riga, note, NUM. GIOCATORI)', async () => {
  const m = sampleMatch();
  const files = await writeDocs(m, 'partita');
  assert.equal(files.length, 1);
  assert.equal(files[0].name, '2026-11-22 Partita U8 vs Rugby Club Esempio.docx');
  const xml = unzipText(files[0].path, 'word/document.xml');
  assert.match(xml, /w:orient="landscape"/);
  for (const t of ['PARTITA DEL', 'CONTRO', 'UNDER', 'PLACCAGGI', 'ALLE GAMBE', 'SOSTEGNO', 'METE', 'NUM. GIOCATORI', 'TOTALE', 'Da lavorare il sostegno.', 'Concentramento di Natale']) {
    assert.ok(xml.includes(t), 'manca: ' + t);
  }
  results.partita = files.map((f) => f.path);
});

test('Obiettivi / piano trimestrale (.docx A4 verticale, 8 sedute)', async () => {
  const p = samplePlan();
  const files = await writeDocs(p, 'piano');
  const xml = unzipText(files[0].path, 'word/document.xml');
  assert.doesNotMatch(xml, /w:orient="landscape"/);
  for (const t of ['I° TRIMESTRE', 'OBIETTIVI EDUCATIVI:', 'OBIETTIVI DIDATTICI:', 'ALLENAMENTI', 'VIII°', 'Staffetta con meta', 'PAUSA', 'Chiacchierata su cosa hanno imparato', 'Tana dell']) {
    assert.ok(xml.includes(t), 'manca: ' + t);
  }
  results.piano = files.map((f) => f.path);
});

test('artefatti per Drive: .docx + .json di backup ri-importabile', async () => {
  const s = M.newSession({ date: '2026-11-24', categories: ['U8'] });
  const arts = await buildArtifacts(docx, s);
  assert.deepEqual(arts.map((a) => a.key), ['docx-plan', 'json'], 'scheda di osservazione vuota -> nessun docx in più');
  const back = M.parseBackup(arts[1].data);
  assert.equal(back[0].id, s.id);
  assert.equal(arts[1].name, '2026-11-24 Allenamento U8.json');
});

test('Libreria esercizi (.docx A4 verticale con i disegni) + .json ri-importabile; rosa solo .json', async () => {
  const ex = buildSeed().exercises.slice(0, 3);
  ex[0].drawing = boardWithThumb(0); ex[0].description = 'Due squadre, una palla'; ex[0].keywords = ['avanti'];
  const lib = { kind: 'library', id: 'all', exercises: ex };
  const arts = await buildArtifacts(docx, lib);
  assert.deepEqual(arts.map((a) => a.key), ['docx-library', 'json']);
  assert.equal(arts[0].name, 'Rugby Coach - Libreria esercizi.docx');
  const p = path.join(DOCX_DIR, 'libreria-docx-library.docx');
  fs.writeFileSync(p, arts[0].data);
  const xml = unzipText(p, 'word/document.xml');
  assert.match(xml, /LIBRERIA ESERCIZI/);
  assert.ok(xml.includes('Due squadre, una palla'));
  assert.ok(unzipList(p).some((f) => f.startsWith('word/media/')), 'disegno incorporato');
  results.libreria = [p];
  const back = M.parseBackup(arts[1].data);
  assert.equal(back.length, 3);
  assert.ok(back[0].kind === 'exercise' && back.find((r) => r.drawing).drawing.items.length > 0, 'disegni vettoriali nel backup');
  const roster = await buildArtifacts(docx, { kind: 'roster', id: 'all', players: [M.newPlayer({ name: 'Luca' })] });
  assert.deepEqual(roster.map((a) => a.key), ['json']);
  assert.equal(M.parseBackup(roster[0].data)[0].name, 'Luca');
});

test('i .docx si aprono con LibreOffice (conversione in PDF e PNG)', { skip: !hasCmd('soffice') && 'LibreOffice non installato' }, () => {
  const all = [...(results.seduta || []), ...(results.partita || []), ...(results.piano || []), ...(results.libreria || [])];
  assert.ok(all.length >= 4);
  const pdfDir = path.join(OUT, 'docx-pdf');
  fs.mkdirSync(pdfDir, { recursive: true });
  execFileSync('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', pdfDir, ...all], { stdio: 'ignore', timeout: 180000 });
  for (const f of all) {
    const pdf = path.join(pdfDir, path.basename(f).replace(/\.docx$/, '.pdf'));
    assert.ok(fs.existsSync(pdf) && fs.statSync(pdf).size > 1000, 'PDF non generato per ' + f);
    if (hasCmd('pdftoppm')) execFileSync('pdftoppm', ['-png', '-r', '60', pdf, pdf.replace(/\.pdf$/, '')]);
  }
});
