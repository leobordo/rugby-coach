import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../app/js/model.js';
import { buildSeed, SEED_GAMES } from '../app/js/seed.js';
import { sampleSession } from './fixtures.mjs';
const { resolveDeletions } = M;

test('liste che partono vuote (si aggiunge con +) e seduta con il solo modulo Programma', () => {
  const s = M.newSession();
  assert.equal(s.planItems.length, 0);
  assert.equal(s.observations.length, 0);
  assert.equal(s.review.perExercise.length, 0);
  assert.deepEqual(s.modules, ['program']);
  assert.equal(s.review.errorsCauses.length, 7);
  assert.deepEqual(Object.keys(s.attendance), ['U6', 'U8', 'U10', 'U12', 'U14', 'U16']);
  const m = M.newMatch();
  assert.equal(m.rows.length, 1, 'partita: una riga minima');
  assert.equal(m.rows[0].values.length, 8);
  assert.equal(M.MATCH_COLUMNS.length, 7);
  assert.deepEqual(M.templatePlanSession().blocks.find((b) => b.type === 'RISCALDAMENTO').subItems, []);
  s.planItems.push(M.newPlanItem({ name: 'Fulmine' }));
  M.syncReviewRows(s);
  assert.equal(s.review.perExercise.length, 1, 'bilancio: una riga per esercizio');
});

test('moduli: dati presenti, svuotamento, sanificazione', () => {
  const s = M.newSession();
  assert.equal(M.moduleHasData(s, 'attendance'), false);
  s.attendance.U8 = 7;
  assert.equal(M.moduleHasData(s, 'attendance'), true);
  M.clearModule(s, 'attendance');
  assert.equal(M.totalAttendance(s), 0);
  s.review.errorsCauses[2].answer = 'yes';
  assert.equal(M.moduleHasData(s, 'errors'), true);
  M.clearModule(s, 'errors');
  assert.equal(M.moduleHasData(s, 'errors'), false);
  s.review.trainer = 'Paolo';
  assert.equal(M.moduleHasData(s, 'trainer'), true);
  assert.deepEqual(M.sanitizeModules(['trainer', 'virus', 'trainer', 'program']), ['trainer', 'program']);
  assert.deepEqual(M.sanitizeModules([]), ['program']);
});

test('migrazione v2 -> v3: moduli = Programma + quelli con dati; righe vuote tolte; nessun dato perso', () => {
  const p1 = { id: 'p1', name: 'Fulmine', durationMin: 10 };
  const p2 = { id: 'p2', name: '' }; // riga vuota dei vecchi 5 fissi
  const v2 = { kind: 'session', schemaVersion: 2, id: 's', date: '2026-10-01', updatedAt: '2026-10-01T10:00:00Z',
    attendance: { U6: null, U8: 9, U10: null, U12: null, U14: null, U16: null },
    planItems: [p1, p2, { id: 'p3' }],
    observations: [{ id: 'o1', name: 'Fulmine', positive: 'bene' }, { id: 'o2' }, { id: 'o3' }, { id: 'o4' }],
    review: { perExercise: [{ id: 'r1', ref: 'p1', overall: 'ok' }, { id: 'r2', ref: 'p2' }, { id: 'r3', ref: 'p3' }],
      errorsCauses: [], observationLevel: null, errorsCorrectedWell: null, observer: '', workTimeRatio: 'suff' } };
  const s = M.migrateRecord(v2);
  assert.equal(s.schemaVersion, 3);
  assert.deepEqual(s.modules, ['program', 'attendance', 'observation', 'review', 'trainer']);
  assert.deepEqual(s.planItems.map((p) => p.name), ['Fulmine']);
  assert.equal(s.observations.length, 1);
  assert.equal(s.observations[0].positive, 'bene');
  assert.equal(s.review.perExercise.length, 1);
  assert.equal(s.review.perExercise[0].overall, 'ok');
  assert.equal(s.attendance.U8, 9);
  assert.equal(s.review.workTimeRatio, 'suff');
  assert.equal(s.updatedAt, '2026-10-01T10:00:00Z');
  const empty = M.migrateRecord({ kind: 'session', schemaVersion: 2, id: 'e', planItems: [{ id: 'a' }, { id: 'b' }] });
  assert.deepEqual(empty.modules, ['program']);
  assert.equal(empty.planItems.length, 0);
  const m = M.migrateRecord({ kind: 'match', schemaVersion: 2, id: 'm', rows: [{ label: 'Luca', values: [1, 0, 0, 0, 0, 0, 0, 0] }, { label: '', values: [0, 0, 0, 0, 0, 0, 0, 0] }] });
  assert.deepEqual(m.rows.map((r) => r.label), ['Luca']);
});

test('campi calcolati: totale presenti, durata, totali partita (R8)', () => {
  const s = M.newSession({ planItems: [M.newPlanItem(), M.newPlanItem(), M.newPlanItem()] });
  s.attendance.U6 = 3; s.attendance.U8 = '5'; s.attendance.U10 = ''; s.attendance.U12 = -2;
  assert.equal(M.totalAttendance(s), 8);
  s.planItems[0].durationMin = 10; s.planItems[1].durationMin = '15'; s.planItems[2].durationMin = null;
  assert.equal(M.totalDuration(s), 25);
  const m = M.newMatch();
  m.rows.push(M.newMatchRow());
  m.rows[0].values[0] = 2; m.rows[1].values[0] = 3; m.rows[1].values[7] = 1;
  assert.deepEqual(M.matchColumnTotals(m), [5, 0, 0, 0, 0, 0, 0, 1]);
});

test('righe del bilancio seguono gli esercizi (aggiunta, rimozione, riordino) e conservano le righe libere', () => {
  const s = M.newSession({ planItems: Array.from({ length: 5 }, () => M.newPlanItem()) });
  M.syncReviewRows(s);
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
  assert.equal(s.observations.length, 0, 'osservazione: modulo non presente di default');
  const s2 = M.sessionFromPlanSession(plan, 0, exercises, { modules: ['program', 'observation'] });
  assert.equal(s2.observations[1].planItemRef, s2.planItems[1].id);
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

test('eliminazioni tra telefoni: vince l\'evento più recente (modifica dopo eliminazione / eliminazione dopo modifica / offline)', () => {
  const del = '2026-11-25T10:00:00.000Z';
  // B ha modificato DOPO l'eliminazione di A: la modifica vince, la tombstone è superata
  let r = resolveDeletions({ remoteTombs: { s: del }, updatedOf: () => '2026-11-25T10:05:00.000Z' });
  assert.deepEqual(r.revive, ['s']); assert.deepEqual(r.remove, []);
  assert.equal(r.tombs.s, undefined); assert.equal(r.alive.s, '2026-11-25T10:05:00.000Z');
  // A (che la scheda non l'ha più) riceve l'indice di B: la sua tombstone locale non torna
  const a = resolveDeletions({ localTombs: { s: del }, remoteAlive: r.alive, updatedOf: () => null });
  assert.equal(a.tombs.s, undefined);
  // B offline aveva modificato PRIMA dell'eliminazione e sincronizza dopo: decide updatedAt -> si toglie in locale
  r = resolveDeletions({ remoteTombs: { s: del }, updatedOf: () => '2026-11-25T09:59:00.000Z' });
  assert.deepEqual(r.remove, ['s']); assert.deepEqual(r.revive, []); assert.equal(r.tombs.s, del);
  // stessa ora: vince l'eliminazione
  assert.deepEqual(resolveDeletions({ remoteTombs: { s: del }, updatedOf: () => del }).remove, ['s']);
  // eliminata di nuovo dopo la modifica che l'aveva salvata: l'eliminazione più recente vince
  r = resolveDeletions({ localTombs: { s: '2026-11-25T11:00:00.000Z' }, remoteAlive: { s: '2026-11-25T10:05:00.000Z' }, updatedOf: () => '2026-11-25T10:05:00.000Z' });
  assert.deepEqual(r.remove, ['s']); assert.equal(r.tombs.s, '2026-11-25T11:00:00.000Z');
});

test('ricezione: decisione per una scheda arrivata da Drive (vince la più recente; conflitto → copia)', () => {
  const t = (m) => `2026-11-25T10:${String(m).padStart(2, '0')}:00.000Z`;
  const d = (o) => M.decideSheet(o);
  assert.equal(d({ local: null, remote: { updatedAt: t(1) } }), 'insert', 'scheda nuova creata altrove');
  assert.equal(d({ local: { updatedAt: t(1) }, remote: { updatedAt: t(5) }, localChanged: false, remoteChanged: false }), 'skip', 'versione già nota');
  assert.equal(d({ local: { updatedAt: t(1) }, remote: { updatedAt: t(5) }, localChanged: false, remoteChanged: true }), 'takeRemote');
  assert.equal(d({ local: { updatedAt: t(9) }, remote: { updatedAt: t(5) }, localChanged: false, remoteChanged: true }), 'keepLocal');
  assert.equal(d({ local: { updatedAt: t(3) }, remote: { updatedAt: t(5) }, localChanged: true, remoteChanged: true }), 'conflictRemoteWins');
  assert.equal(d({ local: { updatedAt: t(7) }, remote: { updatedAt: t(5) }, localChanged: true, remoteChanged: true }), 'conflictLocalWins');
  assert.equal(d({ local: { updatedAt: t(3) }, remote: { updatedAt: t(5) }, localChanged: true, remoteChanged: true, knownBase: false }), 'takeRemote', 'senza versione comune decide la data');
  assert.equal(d({ local: { updatedAt: t(3) }, remote: { updatedAt: t(5) }, localChanged: true, remoteChanged: true, sameContent: true }), 'skip');
});

test('ricezione: copia di conflitto con nome distinto (titolo e file) e nuovo id', () => {
  const s = M.newSession({ date: '2026-12-02' });
  const c = M.conflictCopy(s, new Date(2026, 10, 25, 9, 5));
  assert.notEqual(c.id, s.id);
  assert.equal(c.conflict, 'conflitto del 25/11/2026 09.05');
  assert.match(M.fileBaseName(c), /^2026-12-02 Allenamento \(conflitto del 25-11-2026 09\.05\)$/);
  assert.match(M.recordTitle(c), /conflitto del/);
  const p = M.conflictCopy(M.newPlan({ title: 'II° TRIMESTRE' }), new Date(2026, 10, 25, 9, 5));
  assert.match(p.title, /^II° TRIMESTRE \(conflitto del/);
});

test('scheda aperta: unione campo per campo (quello che si scrive resta, il resto arriva, liste per elemento)', () => {
  const base = { location: '', date: '2026-12-01', planItems: [{ id: 'a', name: 'Uno' }, { id: 'b', name: 'Due' }] };
  const local = { location: '', date: '2026-12-01', planItems: [{ id: 'a', name: 'Uno – scrivo' }, { id: 'b', name: 'Due' }, { id: 'c', name: 'Nuovo qui' }] };
  const remote = { location: 'Campo di A', date: '2026-12-01', planItems: [{ id: 'a', name: 'Uno' }, { id: 'd', name: 'Nuovo là' }] };
  const { value, conflicts } = M.merge3(base, local, remote);
  assert.equal(conflicts, 0);
  assert.equal(value.location, 'Campo di A');
  assert.deepEqual(value.planItems.map((x) => x.name), ['Uno – scrivo', 'Nuovo là', 'Nuovo qui'], 'b tolto altrove e non toccato qui');
  const r2 = M.merge3({ x: 'a' }, { x: 'b' }, { x: 'c' });
  assert.equal(r2.value.x, 'b'); assert.equal(r2.conflicts, 1, 'stesso campo cambiato da entrambi');
});

test('isEmptySession: allenamento nuovo vuoto finché l\'utente non inserisce qualcosa', () => {
  const s = M.newSession();
  assert.equal(M.isEmptySession(s), true, 'nuovo: vuoto');
  assert.ok(s.date, 'ha la data proposta in automatico');
  assert.equal(M.isEmptySession(M.newSession({ date: '2026-12-01' })), true, 'la data non conta');
  // sezione aggiunta ma senza dati (anche con una riga vuota)
  const sec = M.newSession({ modules: ['program', 'attendance', 'observation', 'selfeval'] });
  sec.observations.push(M.newObservation());
  sec.planItems.push(M.newPlanItem());
  assert.equal(M.isEmptySession(sec), true, 'sezioni aggiunte vuote: ancora vuoto');
  // un esercizio nel programma
  const ex = M.newSession(); ex.planItems.push(M.newPlanItem({ name: 'Passaggi in cerchio' }));
  assert.equal(M.isEmptySession(ex), false, 'con un esercizio');
  // un campo compilato in una sezione
  const att = M.newSession({ modules: ['program', 'attendance'] }); att.attendance.U8 = 5;
  assert.equal(M.isEmptySession(att), false, 'presenze compilate');
  const self = M.newSession({ modules: ['program', 'selfeval'] }); self.review.observer = 'Luca';
  assert.equal(M.isEmptySession(self), false, 'autovalutazione compilata');
  const draw = M.newSession(); draw.planItems.push(M.newPlanItem({ drawing: { v: 1 } }));
  assert.equal(M.isEmptySession(draw), false, 'con un disegno');
  // intestazione
  assert.equal(M.isEmptySession(M.newSession({ categories: ['U10'] })), false, 'categoria scelta');
  assert.equal(M.isEmptySession(M.newSession({ location: 'Campo 2' })), false, 'luogo scritto');
  assert.equal(M.isEmptySession(M.newSession({ location: '   ' })), true, 'solo spazi: vuoto');
});
