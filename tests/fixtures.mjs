// Dati di prova condivisi dai test.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as M from '../app/js/model.js';
import * as B from '../app/js/board/model.js';
import { renderSVG } from '../app/js/board/render.js';
import { buildSeed } from '../app/js/seed.js';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
export const OUT = path.join(ROOT, 'out');

export function hasCmd(cmd) {
  try { execFileSync('which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; }
}

// PNG minimo 1x1 (fallback se rsvg-convert non c'è)
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

export function sampleBoard(variant = 0) {
  const b = B.newBoard();
  if (variant === 1) b.field = B.newField({ type: 'grid', length: 20, width: 15, gridStep: 5 });
  if (variant === 2) b.field = B.newField({ type: 'half', length: 60, width: 35, inGoal: 5 });
  const it = b.items;
  it.push(B.createItem('player', 10, 8, { team: 'A' }, it));
  it.push(B.createItem('player', 12, 12, { team: 'A' }, it));
  it.push(B.createItem('player', 16, 6, { team: 'B' }, it));
  it.push(B.createItem('ball', 10.8, 8.6));
  it.push(B.createItem('cone', 4, 3)); it.push(B.createItem('cone', 4, 12));
  it.push(B.createLine('pass', [10, 8], [12, 12]));
  it.push(B.createLine('run', [12, 12], [18, 13]));
  it.push(B.createLine('kick', [16, 6], [19, 2]));
  return b;
}

export function boardWithThumb(variant = 0) {
  const b = sampleBoard(variant);
  if (hasCmd('rsvg-convert')) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-'));
    const svg = path.join(dir, 'b.svg');
    fs.writeFileSync(svg, renderSVG(b, { pxWidth: 720 }));
    const png = execFileSync('rsvg-convert', [svg]);
    b.thumb = 'data:image/png;base64,' + Buffer.from(png).toString('base64');
  } else {
    b.thumb = TINY_PNG;
  }
  return b;
}

export function sampleSession() {
  const s = M.newSession({ date: '2026-11-24', categories: ['U8'], location: 'Campo comunale',
    modules: ['program', 'attendance', 'observation', 'review', 'errors', 'selfeval', 'trainer'] });
  s.planItems = Array.from({ length: 5 }, () => M.newPlanItem());
  s.attendance = { U6: 4, U8: 11, U10: null, U12: null, U14: null, U16: null };
  const names = ['Riscaldamento', 'Fulmine', 'Palla quadrata', 'Mastino', 'Partita'];
  s.planItems.forEach((p, i) => {
    p.name = names[i];
    p.durationMin = [10, 15, 15, 10, 20][i];
    p.description = i === 0 ? '- Staffetta con meta\n- Gioco dei nomi' : 'Descrizione del gioco ' + p.name;
    p.materialsSpace = '10 coni, 2 palloni\nSpazio: 20×15 m';
    p.objectives = 'Vincere la paura del contatto';
    p.keywords = ['avanti', 'sostegno'];
    p.toObserve = 'Chi va avanti con la palla';
  });
  s.planItems[1].drawing = boardWithThumb(0);
  s.planItems[2].drawing = boardWithThumb(1);
  M.syncReviewRows(s);
  s.review.perExercise[0].overall = 'Buona partecipazione';
  s.review.perExercise[1].individual = 'Luca: ottimo\nGiulia: timida';
  s.review.perExercise.push(M.newReviewRow({ label: 'Note libere', overall: 'Pioggia' }));
  s.review.errorsCauses[0].answer = 'no';
  s.review.errorsCauses[1].answer = 'yes';
  s.review.errorsCauses[1].note = 'Attenti fino alla pausa';
  s.review.observationLevel = 2;
  s.review.errorsCorrectedWell = 'yes';
  s.review.observer = 'Marco (vice)';
  s.review.workTimeRatio = 'suff';
  s.review.solicitations = 'adeguato';
  s.review.solicitationsCount = 24;
  s.review.trainer = 'Paolo';
  s.observations = s.planItems.slice(1, 5).map((p) => M.newObservation(M.observationFromPlanItem(p)));
  s.observations[0].positive = 'Tutti hanno corso';
  s.observations[0].negative = 'Passaggi in avanti';
  s.observations[0].improvements = 'Ridurre lo spazio';
  return s;
}

export function sampleMatch() {
  const m = M.newMatch({ date: '2026-11-22', opponent: 'Rugby Club Esempio', under: 'U8', customColumnLabel: 'METE', notes: 'Bel concentramento.\nDa lavorare il sostegno.', numPlayers: 9, result: '5 mete a 3', tournament: 'Concentramento di Natale' });
  m.rows.forEach((r, i) => { r.label = ['Luca', 'Giulia', 'Marco', '1° tempo', '2° tempo', 'Squadra'][i]; r.values = r.values.map((_, j) => (i + j) % 5); });
  m.drawing = boardWithThumb(2);
  return m;
}

export function samplePlan() {
  return buildSeed().plans[0];
}

export { M, B };
