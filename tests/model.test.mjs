import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../app/js/model.js';
import { buildSeed, SEED_GAMES } from '../app/js/seed.js';
import { sampleSession } from './fixtures.mjs';

test('valori predefiniti delle liste = righe degli originali (R4)', () => {
  const s = M.newSession();
  assert.equal(s.planItems.length, 5);
  assert.equal(s.observations.length, 4);
  assert.equal(s.review.perExercise.length, 5, 'bilancio generato dagli esercizi');
  assert.equal(s.review.errorsCauses.length, 7);
  assert.deepEqual(Object.keys(s.attendance), ['U6', 'U8', 'U10', 'U12', 'U14', 'U16']);
  const m = M.newMatch();
  assert.equal(m.rows.length, 6);
  assert.equal(m.rows[0].values.length, 8);
  assert.equal(M.MATCH_COLUMNS.length, 7);
});

test('campi calcolati: totale presenti, durata, totali partita (R8)', () => {
  const s = M.newSession();
  s.attendance.U6 = 3; s.attendance.U8 = '5'; s.attendance.U10 = ''; s.attendance.U12 = -2;
  assert.equal(M.totalAttendance(s), 8);
  s.planItems[0].durationMin = 10; s.planItems[1].durationMin = '15'; s.planItems[2].durationMin = null;
  assert.equal(M.totalDuration(s), 25);
  const m = M.newMatch();
  m.rows[0].values[0] = 2; m.rows[1].values[0] = 3; m.rows[1].values[7] = 1;
  assert.deepEqual(M.matchColumnTotals(m), [5, 0, 0, 0, 0, 0, 0, 1]);
});

test('righe del bilancio seguono gli esercizi (aggiunta, rimozione, riordino) e conservano le righe libere', () => {
  const s = M.newSession();
  s.review.perExercise[1].overall = 'secondo';
  s.review.perExercise.push(M.newReviewRow({ label: 'libera', overall: 'x' }));
  const second = s.planItems[1].id;
  M.moveItem(s.planItems, 1, -1);
  M.syncReviewRows(s);
  assert.equal(s.review.perExercise[0].ref, second);
  assert.equal(s.review.perExercise[0].overall, 'secondo');
  assert.equal(M.reviewRowLabel(s, s.review.perExercise[0]).num, '1');
  s.planItems.push(M.newPlanItem({ name: 'nuovo' }));
  M.removeItem(s.planItems, 0);
  M.syncReviewRows(s);
  assert.equal(s.review.perExercise.length, 6);
  assert.ok(!s.review.perExercise.some((r) => r.ref === second));
  assert.equal(s.review.perExercise.at(-1).label, 'libera');
  assert.equal(s.review.perExercise.at(-2).ref, s.planItems.at(-1).id);
});

test('moveItem / removeItem ai limiti', () => {
  const a = [1, 2, 3];
  assert.equal(M.moveItem(a, 0, -1), false);
  assert.equal(M.moveItem(a, 2, 1), false);
  assert.equal(M.moveItem(a, 0, 1), true);
  assert.deepEqual(a, [2, 1, 3]);
  assert.equal(M.removeItem(a, 5), null);
});

test('seed: piano I° trimestre con 8 sedute e 16 giochi di esempio (R25)', () => {
  const { exercises, plans } = buildSeed();
  assert.equal(exercises.length, SEED_GAMES.length);
  assert.equal(exercises.length, 16);
  assert.ok(exercises.every((e) => e.example));
  const p = plans[0];
  assert.equal(p.example, true);
  assert.equal(p.sessions.length, 8);
  const first = p.sessions[0].blocks.map((b) => b.type === 'GIOCO' ? b.title : b.type);
  assert.deepEqual(first, ['RISCALDAMENTO', 'PAUSA', 'Fulmine', 'PAUSA', 'Palla quadrata', 'PAUSA', 'SPIEGAZIONE', 'PARTITA']);
  const second = p.sessions[1].blocks.map((b) => b.type === 'GIOCO' ? b.title : b.type);
  assert.deepEqual(second, ['CHIACCHIERATA_INIZIALE', 'RISCALDAMENTO', 'PAUSA', 'Mastino', 'PAUSA', 'Lupo ci sei', 'PAUSA', 'PARTITA', 'CHIACCHIERATA_FINALE']);
  assert.ok(p.sessions.every((s) => s.blocks.filter((b) => b.type === 'GIOCO').every((b) => b.exerciseId)), 'giochi collegati alla libreria');
  assert.match(p.didacticGoals, /placcare/);
});

test('da una seduta del piano nasce un foglio allenamento precompilato (R3)', () => {
  const { exercises, plans } = buildSeed();
  const plan = plans[0];
  plan.category = 'U8';
  exercises.find((e) => e.name === 'Fulmine').objectives = 'Correre verso la meta';
  const s = M.sessionFromPlanSession(plan, 0, exercises);
  assert.deepEqual(s.planItems.map((p) => p.name), ['Riscaldamento', 'Fulmine', 'Palla quadrata', 'Partita']);
  assert.match(s.planItems[0].description, /Staffetta con meta/);
  assert.equal(s.planItems[1].objectives, 'Correre verso la meta');
  assert.ok(s.planItems[1].exerciseId);
  assert.deepEqual(s.categories, ['U8']);
  assert.deepEqual(s.termPlanRef, { termPlanId: plan.id, sessionIndex: 0 });
  assert.equal(s.review.perExercise.length, 4);
  assert.equal(s.observations.length, 4);
  assert.equal(s.observations[1].planItemRef, s.planItems[1].id);
});

test('migrazione v1 -> v2: chiavi presenze dell\'originale, righe partita a 7 colonne, keywords stringa', () => {
  const v1s = { kind: 'session', schemaVersion: 1, id: 's1', date: '2025-10-01', attendance: { 'N.U6': 2, 'N.U8': 5, N12: 7, N16: 1 },
    planItems: [{ id: 'p1', name: 'Fulmine', keywords: 'avanti, sostegno; meta' }], review: { errorsCauses: [{ answer: 'yes' }] } };
  const s = M.migrateRecord(v1s);
  assert.equal(s.schemaVersion, M.SCHEMA_VERSION);
  assert.deepEqual(s.attendance, { U6: 2, U8: 5, U10: null, U12: 7, U14: null, U16: 1 });
  assert.deepEqual(s.planItems[0].keywords, ['avanti', 'sostegno', 'meta']);
  assert.equal(s.planItems[0].durationMin, null, 'campi mancanti completati');
  assert.equal(s.review.errorsCauses.length, 7);
  assert.equal(s.review.errorsCauses[0].answer, 'yes');
  assert.equal(s.review.perExercise.length, 1);
  assert.equal(s.review.perExercise[0].ref, 'p1');
  assert.ok(Array.isArray(s.observations));
  const v1m = { kind: 'match', schemaVersion: 1, id: 'm1', rows: [{ label: 'A', values: [1, 2, 3, 4, 5, 6, 7] }] };
  const m = M.migrateRecord(v1m);
  assert.deepEqual(m.rows[0].values, [1, 2, 3, 4, 5, 6, 7, 0]);
  assert.equal(m.customColumnLabel, '');
  assert.throws(() => M.migrateRecord({ kind: 'session', schemaVersion: 99 }), /più recente/);
  assert.throws(() => M.migrateRecord({ kind: 'boh' }), /sconosciuto/);
});

test('backup completo: export -> import con unione "vince l\'ultima modifica" (R24)', () => {
  const s = sampleSession();
  const { exercises, plans } = buildSeed();
  const backup = M.buildBackup({ sessions: [s], exercises, plans, players: [M.newPlayer({ name: 'Luca' })] });
  const recs = M.parseBackup(JSON.stringify(backup));
  assert.equal(recs.length, 1 + 16 + 1 + 1);
  const back = recs.find((r) => r.id === s.id);
  assert.equal(back.kind, 'session');
  assert.deepEqual(back.planItems.map((p) => p.name), s.planItems.map((p) => p.name));
  assert.equal(back.planItems[1].drawing.items.length, s.planItems[1].drawing.items.length);
  assert.throws(() => M.parseBackup('{"app":"altro"}'), /non è un backup/);
  const older = { updatedAt: '2026-01-01T00:00:00Z' }, newer = { updatedAt: '2026-02-01T00:00:00Z' };
  assert.equal(M.mergeDecision(null, newer), 'insert');
  assert.equal(M.mergeDecision(older, newer), 'update');
  assert.equal(M.mergeDecision(newer, older), 'skip');
  const single = M.parseBackup(M.buildRecordBackup(s));
  assert.equal(single.length, 1);
});

test('nomi dei file: "2026-11-24 Allenamento U8.docx" e varianti', () => {
  const s = M.newSession({ date: '2026-11-24', categories: ['U8'] });
  assert.equal(M.fileBaseName(s), '2026-11-24 Allenamento U8');
  assert.equal(M.fileBaseName(s, 'observation'), '2026-11-24 Scheda di allenamento U8');
  const s2 = M.newSession({ date: '2026-11-24' });
  s2.attendance.U10 = 3; s2.attendance.U6 = 2;
  assert.equal(M.fileBaseName(s2), '2026-11-24 Allenamento U6-U10');
  const m = M.newMatch({ date: '2026-11-22', under: '8', opponent: 'Rugby / Club' });
  assert.equal(M.fileBaseName(m), '2026-11-22 Partita U8 vs Rugby - Club');
  const p = M.newPlan({ title: 'I° TRIMESTRE', category: 'U8', season: '2026/27' });
  assert.equal(M.fileBaseName(p), 'Piano I° TRIMESTRE U8 2026-27');
});

test('duplicazione: nuovi id e riferimenti interni rimappati (R2)', () => {
  const s = sampleSession();
  const d = M.duplicateRecord(s);
  assert.notEqual(d.id, s.id);
  assert.equal(d.example, false);
  const ids = new Set(d.planItems.map((p) => p.id));
  assert.ok(d.planItems.every((p) => !s.planItems.some((q) => q.id === p.id)));
  assert.ok(d.review.perExercise.filter((r) => r.ref).every((r) => ids.has(r.ref)));
  assert.ok(d.observations.filter((o) => o.planItemRef).every((o) => ids.has(o.planItemRef)));
});

test('utilità: date, numeri romani, stagione, under', () => {
  assert.equal(M.formatDateIT('2026-11-24'), '24/11/2026');
  assert.equal(M.formatDateIT(''), '');
  assert.equal(M.ordinalRoman(8), 'VIII°');
  assert.equal(M.ordinalRoman(4), 'IV°');
  assert.equal(M.defaultSeason(new Date(2026, 10, 24)), '2026/27');
  assert.equal(M.defaultSeason(new Date(2027, 2, 1)), '2026/27');
  assert.equal(M.normalizeUnder('8'), 'U8');
  assert.equal(M.normalizeUnder('under 10'), 'U10');
  assert.equal(M.isBlankValue({ id: 'x', name: ' ', keywords: [] }), true);
  assert.equal(M.isBlankValue({ id: 'x', name: 'a' }), false);
});

test('seed: id e date stabili (stesso esempio = stesso id su ogni dispositivo, più vecchio di ogni modifica)', () => {
  const a = buildSeed(), b = buildSeed();
  assert.deepEqual(a.exercises.map((e) => e.id), b.exercises.map((e) => e.id));
  assert.equal(a.plans[0].id, b.plans[0].id);
  assert.equal(new Set(a.exercises.map((e) => e.id)).size, 16);
  assert.ok(a.exercises.every((e) => e.updatedAt === M.SEED_TIME));
  assert.equal(M.mergeDecision(a.plans[0], { ...a.plans[0], updatedAt: '2026-01-01T00:00:00Z' }), 'update');
  assert.equal(JSON.stringify(a.plans[0]), JSON.stringify(b.plans[0]), 'piano identico');
});

test('nomi dei file delle raccolte', () => {
  assert.equal(M.fileBaseName({ kind: 'library' }), 'Rugby Coach - Libreria esercizi');
  assert.equal(M.fileBaseName({ kind: 'roster' }), 'Rugby Coach - Rosa giocatori');
});
