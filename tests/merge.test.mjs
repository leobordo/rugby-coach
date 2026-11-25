// Merge di libreria esercizi e rosa tra dispositivi: per elemento, vince il più recente, tombstone per le cancellazioni.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeCollection, mergeTombstones, migrateRecord, EPOCH } from '../app/js/model.js';

const it = (id, name, t) => ({ id, kind: 'exercise', name, updatedAt: `2026-11-${String(t).padStart(2, '0')}T10:00:00.000Z` });
const day = (t) => `2026-11-${String(t).padStart(2, '0')}T10:00:00.000Z`;
const names = (r) => r.items.map((x) => x.name).sort();

test('aggiunte concorrenti su due dispositivi: si uniscono', () => {
  const base = it('a', 'Comune', 1);
  const r = mergeCollection({ local: [base, it('d1', 'Esercizio D1-bis', 5)], remote: [base, it('d2', 'Esercizio D2', 4)] });
  assert.deepEqual(names(r), ['Comune', 'Esercizio D1-bis', 'Esercizio D2']);
  assert.deepEqual(r.upserts.map((x) => x.id), ['d2'], 'in locale arriva solo quello di D2');
  assert.deepEqual(r.deletes, []);
  assert.equal(r.remoteChanged, true, 'D1-bis va inviato');
});

test('modifica contro modifica: vince la più recente, da entrambe le parti', () => {
  const r1 = mergeCollection({ local: [it('a', 'locale', 3)], remote: [it('a', 'remoto', 2)] });
  assert.deepEqual(names(r1), ['locale']);
  assert.equal(r1.upserts.length, 0);
  assert.equal(r1.remoteChanged, true);
  const r2 = mergeCollection({ local: [it('a', 'locale', 2)], remote: [it('a', 'remoto', 3)] });
  assert.deepEqual(names(r2), ['remoto']);
  assert.equal(r2.upserts[0].name, 'remoto');
  assert.equal(r2.remoteChanged, false);
});

test('cancellazione contro modifica', () => {
  // cancellato su D1 dopo l'ultima modifica nota: resta cancellato e la cancellazione arriva a D2
  const del = mergeCollection({ local: [it('a', 'x', 2)], remote: [], remoteTombs: { a: day(3) } });
  assert.deepEqual(del.items, []);
  assert.deepEqual(del.deletes, ['a']);
  assert.equal(del.tombs.a, day(3));
  assert.equal(del.remoteChanged, false);
  // il merge non "resuscita" un elemento cancellato con una copia vecchia
  const old = mergeCollection({ local: [], localTombs: { a: day(3) }, remote: [it('a', 'vecchio', 2)] });
  assert.deepEqual(old.items, []);
  assert.equal(old.remoteChanged, true, 'la cancellazione va propagata a Drive');
  // modificato DOPO la cancellazione: l'elemento torna e la tombstone cade
  const mod = mergeCollection({ local: [it('a', 'modificato', 5)], remote: [], remoteTombs: { a: day(3) } });
  assert.deepEqual(names(mod), ['modificato']);
  assert.equal(mod.tombs.a, undefined);
  assert.equal(mod.remoteChanged, true);
});

test('stesso contenuto: nessun cambiamento; tombstone unite con la data più recente', () => {
  const a = it('a', 'x', 1);
  const r = mergeCollection({ local: [a], remote: [{ ...a }], localTombs: { z: day(1) }, remoteTombs: { z: day(1) } });
  assert.equal(r.remoteChanged, false);
  assert.equal(r.upserts.length + r.deletes.length, 0);
  assert.deepEqual(mergeTombstones({ q: day(1) }, { q: day(4), w: day(2) }), { q: day(4), w: day(2) });
});

test('updatedAt mancante = 0: non prevale mai su una modifica reale (anche dopo migrateRecord dei dati remoti)', () => {
  const noDate = { id: 'a', kind: 'exercise', name: 'senza data' };
  const m = migrateRecord(noDate);
  assert.equal(m.updatedAt, EPOCH, 'migrateRecord non inventa la data di oggi');
  assert.equal(migrateRecord({ ...noDate, updatedAt: 'boh' }).updatedAt, EPOCH);
  assert.equal(migrateRecord({ ...noDate, updatedAt: day(4) }).updatedAt, day(4));
  // remoto senza data contro locale datato: vince il locale
  const r1 = mergeCollection({ local: [it('a', 'locale', 2)], remote: [m] });
  assert.deepEqual(names(r1), ['locale']);
  assert.equal(r1.upserts.length, 0);
  // locale senza data contro remoto datato: vince il remoto
  const r2 = mergeCollection({ local: [noDate], remote: [it('a', 'remoto', 2)] });
  assert.deepEqual(names(r2), ['remoto']);
  // elemento senza data e tombstone: resta cancellato
  const r3 = mergeCollection({ local: [], remote: [noDate], remoteTombs: { a: day(1) } });
  assert.deepEqual(r3.items, []);
  // entrambi senza data: nessun cambiamento inventato
  const r4 = mergeCollection({ local: [noDate], remote: [{ ...noDate }] });
  assert.equal(r4.upserts.length + r4.deletes.length, 0);
  assert.equal(r4.remoteChanged, false);
});
