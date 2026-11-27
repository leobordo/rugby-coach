// Genera un .docx di esempio per ogni scheda in out/ e controlla struttura e apertura (LibreOffice -> PDF -> PNG).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as docx from '../app/vendor/docx.mjs';
import { buildDocxFiles, buildArtifacts } from '../app/js/artifacts.js';
import { pngSize, gifSize, dataUrlToBytes } from '../app/js/docx-build.js';
import { encodeGif, bytesToDataUrl } from '../app/js/board/gif.js';
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

test('Seduta con tutti i moduli: UN solo .docx A4 orizzontale con tabelle e disegni', async () => {
  const s = sampleSession();
  const files = await writeDocs(s, 'seduta');
  assert.deepEqual(files.map((f) => f.key), ['docx-plan'], 'un solo documento per seduta');
  assert.equal(files[0].name, '2026-11-24 Allenamento U8.docx');
  const xml = unzipText(files[0].path, 'word/document.xml');
  assert.match(xml, /w:orient="landscape"/);
  for (const t of ['ESERCIZIO E DURATA', 'MATERIALE', 'OBIETTIVI', 'PAROLE', 'COSA OSSERVO', 'BILANCIO DELLA SEDUTA', 'ERRORI E CAUSE',
    'Consegne iniziali poco chiare?', 'Ho fatto domande?', 'centrato sul pallone e sullo spazio', 'Con preparatore atletico', 'Fulmine', 'Durata totale', '70 min', 'Marco (vice)', 'Paolo', '24/11/2026',
    'N.U6', 'N.U16', 'TOT. 15', 'OBIETTIVO', 'POSITIVO', 'NEGATIVO', 'MIGLIORAMENTI DA', 'Tutti hanno corso']) {
    assert.ok(xml.includes(t), 'manca: ' + t);
  }
  assert.ok(unzipList(files[0].path).some((f) => f.startsWith('word/media/')), 'disegni incorporati come immagini');
  results.seduta = files.map((f) => f.path);
});

test('Seduta con il solo Programma: nel .docx non ci sono le altre sezioni; l\'ordine dei moduli è rispettato', async () => {
  const s = sampleSession();
  s.modules = ['program'];
  const [f] = await writeDocs(s, 'seduta-solo-programma');
  const xml = unzipText(f.path, 'word/document.xml');
  assert.ok(xml.includes('ESERCIZIO E DURATA') && xml.includes('Fulmine'));
  for (const t of ['BILANCIO DELLA SEDUTA', 'ERRORI E CAUSE', 'POSITIVO', 'Con preparatore atletico', 'N.U6', 'centrato sul pallone']) assert.ok(!xml.includes(t), 'non deve esserci: ' + t);
  s.modules = ['trainer', 'program', 'errors'];
  const [g] = await writeDocs(s, 'seduta-ordine');
  const x2 = unzipText(g.path, 'word/document.xml');
  const iT = x2.indexOf('Con preparatore atletico'), iP = x2.indexOf('ESERCIZIO E DURATA'), iE = x2.indexOf('ERRORI E CAUSE');
  assert.ok(iT > 0 && iT < iP && iP < iE, 'ordine scelto: preparatore, programma, errori');
  assert.ok(!x2.includes('BILANCIO DELLA SEDUTA'));
  // seduta nuova senza esercizi: tabella del programma con una riga vuota da compilare a mano
  const [h] = await writeDocs(M.newSession({ date: '2026-12-01' }), 'seduta-vuota');
  assert.ok(unzipText(h.path, 'word/document.xml').includes('ESERCIZIO E DURATA'));
  results.seduta.push(f.path, g.path);
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
  assert.deepEqual(arts.map((a) => a.key), ['docx-plan', 'json'], 'un .docx + il .json');
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

test('Word: un disegno con l\'azione animata entra come GIF (in stampa resta la fase 1)', async () => {
  const W = 12, H = 8;
  const data = new Uint8ClampedArray(W * H * 4).map((_, i) => (i % 4 === 3 ? 255 : i % 4 === 1 ? 120 : 30));
  const anim = bytesToDataUrl(encodeGif(W, H, [{ data, delay: 50 }]));
  assert.deepEqual(gifSize(dataUrlToBytes(anim)), { width: W, height: H });
  assert.equal(gifSize(new Uint8Array([1, 2, 3])), null);
  const s = M.newSession({ date: '2026-12-01' });
  const b = boardWithThumb(0);
  b.phases = [{ id: 'f1', pos: {} }];
  b.anim = anim;
  s.planItems.push(M.newPlanItem({ name: 'Azione animata', drawing: b }));
  s.planItems.push(M.newPlanItem({ name: 'Disegno fermo', drawing: boardWithThumb(1) }));
  const [f] = await writeDocs(s, 'gif');
  const media = unzipList(f.path).filter((e) => e.startsWith('word/media/'));
  assert.equal(media.filter((e) => e.endsWith('.gif')).length, 1, 'la GIF');
  assert.equal(media.filter((e) => e.endsWith('.png')).length, 1, 'il disegno senza fasi resta PNG');
  assert.ok(unzipText(f.path, '?Content_Types?.xml').includes('image/gif')); // [] sono caratteri jolly per unzip: ? li trova
});
