import test from 'node:test';
import assert from 'node:assert/strict';
import * as B from '../app/js/board/model.js';
import { renderSVG, renderContent } from '../app/js/board/render.js';
import { sampleBoard } from './fixtures.mjs';

test('pedine numerate automaticamente per squadra', () => {
  const items = [];
  items.push(B.createItem('player', 0, 0, { team: 'A' }, items));
  items.push(B.createItem('player', 0, 0, { team: 'A' }, items));
  items.push(B.createItem('player', 0, 0, { team: 'B' }, items));
  assert.deepEqual(items.map((i) => i.team + i.label), ['A1', 'A2', 'B1']);
  items.splice(0, 1);
  assert.equal(B.nextPlayerLabel(items, 'A'), '1');
});

test('frecce: il calcio è curvo con punto di controllo, corsa e passaggio rettilinei', () => {
  const k = B.createLine('kick', [0, 0], [10, 0]);
  assert.ok(k.control);
  assert.equal(k.control[0], 5);
  assert.ok(!B.createLine('run', [0, 0], [10, 0]).control);
  assert.ok(!B.createLine('pass', [0, 0], [10, 0]).control);
});

test('annulla / ripeti', () => {
  const b = B.newBoard();
  const h = new B.History(b);
  b.items.push(B.createItem('ball', 1, 1));
  h.push(b);
  b.items.push(B.createItem('cone', 2, 2));
  h.push(b);
  assert.equal(h.push(b), false, 'stato identico non duplicato');
  assert.equal(h.undo().items.length, 1);
  assert.equal(h.undo().items.length, 0);
  assert.equal(h.undo(), null);
  assert.equal(h.redo().items.length, 1);
  b.items = [];
  h.push(b);
  assert.equal(h.canRedo(), false, 'una nuova azione cancella il ramo "ripeti"');
});

test('spostamento, duplicazione, livelli, eliminazione', () => {
  const b = sampleBoard();
  const line = b.items.find((i) => i.type === 'line' && i.control);
  B.translateItem(line, 1, 2);
  assert.deepEqual(line.points[0], [17, 8]);
  const p = b.items[0];
  const d = B.duplicateItem(p, b.items);
  assert.notEqual(d.id, p.id);
  assert.equal(d.x, p.x + 1.5);
  b.items.push(d);
  assert.equal(B.bringToFront(b, p.id), true);
  assert.equal(b.items.at(-1).id, p.id);
  assert.equal(B.sendToBack(b, p.id), true);
  assert.equal(b.items[0].id, p.id);
  assert.equal(B.removeItemById(b, p.id), true);
  assert.equal(B.findItem(b, p.id), null);
});

test('orientamento: trasposizione involutiva campo <-> vista', () => {
  const f = B.newField({ orientation: 'vertical' });
  const [vx, vy] = B.toView(f, 3, 7);
  assert.deepEqual(B.fromView(f, vx, vy), [3, 7]);
  const vbH = B.viewBox(B.newField({ orientation: 'horizontal' }));
  const vbV = B.viewBox(f);
  assert.equal(Math.round(vbH.w), Math.round(vbV.h));
});

test('JSON vettoriale riapribile e normalizzato', () => {
  const b = sampleBoard();
  const json = JSON.stringify(b);
  const back = B.normalizeBoard(JSON.parse(json));
  assert.deepEqual(back.items, b.items);
  const bad = B.normalizeBoard({ field: { type: 'xx', orientation: 'diag' }, items: [{ type: 'virus' }, { type: 'ball', x: 1, y: 1 }] });
  assert.equal(bad.field.type, 'full');
  assert.equal(bad.field.orientation, 'horizontal');
  assert.equal(bad.items.length, 1);
  assert.ok(bad.items[0].id);
});

test('render SVG: campo intero, metà campo, griglia; tutti gli elementi', () => {
  for (const f of [{ type: 'full', length: 100, width: 70, inGoal: 10 }, { type: 'half' }, { type: 'grid', length: 20, width: 15 }]) {
    const b = sampleBoard();
    b.field = B.newField(f);
    b.items.push(B.createItem('pole', 3, 3), B.createItem('shield', 5, 5), B.createItem('text', 6, 6, { text: 'A<b>&' }), B.createFree([[1, 1], [2, 2], [3, 1]]));
    const svg = renderSVG(b, { pxWidth: 400 });
    assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    assert.match(svg, /width="400"/);
    assert.match(svg, /A&lt;b&gt;&amp;/);
    assert.equal((svg.match(/data-id=/g) || []).length, b.items.length);
  }
  const b = sampleBoard();
  const html = renderContent(b, { selectedId: b.items.find((i) => i.type === 'line' && i.control).id, interactive: true });
  assert.equal((html.match(/data-handle=/g) || []).length, 3, 'due estremi + punto di controllo');
});

test('fasi: posizioni cumulative, interpolazione, aggiunta e rimozione', () => {
  const b = B.newBoard();
  const p1 = B.createItem('player', 10, 10, { team: 'A' }, b.items);
  const p2 = B.createItem('player', 20, 10, { team: 'B' }, [p1]);
  const ball = B.createItem('ball', 10, 11);
  const txt = B.createItem('text', 5, 5, { text: 'Meta' });
  const arrow = B.createLine('run', [10, 10], [30, 10]);
  b.items.push(p1, p2, ball, txt, arrow);
  assert.equal(B.phaseCount(b), 1);
  assert.equal(B.boardAtPhase(b, 0), b, 'fase 1 = il disegno');
  // fase 2: si muove p1; fase 3: si muove la palla, p1 resta dove era in fase 2
  assert.equal(B.addPhase(b, 0), 1);
  assert.ok(B.setPhasePosition(b, 1, p1.id, 30, 10));
  assert.equal(B.addPhase(b, 1), 2);
  B.setPhasePosition(b, 2, ball.id, 30, 12);
  assert.equal(B.phaseCount(b), 3);
  const at = (k, id) => B.boardAtPhase(b, k).items.find((i) => i.id === id);
  assert.deepEqual([at(1, p1.id).x, at(1, p1.id).y], [30, 10]);
  assert.deepEqual([at(2, p1.id).x, at(2, p1.id).y], [30, 10], 'resta dove era');
  assert.deepEqual([at(2, ball.id).x, at(2, ball.id).y], [30, 12]);
  assert.equal(b.items[0].x, 10, 'il disegno della fase 1 non cambia');
  assert.equal(B.positionsAt(b, 1)[txt.id], undefined, 'testi e frecce non si spostano con le fasi');
  assert.deepEqual(B.boardAtPhase(b, 2).items.find((i) => i.id === arrow.id).points, [[10, 10], [30, 10]]);
  // a metà strada (movimento morbido: f=0.5 -> esattamente a metà)
  const mid = B.boardBetween(b, 0, 0.5).items.find((i) => i.id === p1.id);
  assert.deepEqual([mid.x, mid.y], [20, 10]);
  assert.equal(B.boardBetween(b, 0, 0).items.find((i) => i.id === p1.id).x, 10);
  assert.equal(B.boardBetween(b, 0, 1).items.find((i) => i.id === p1.id).x, 30);
  assert.ok(B.boardBetween(b, 0, 0.25).items.find((i) => i.id === p1.id).x < 15, 'parte piano');
  // togliendo la fase 2 la fase 3 resta come la si vedeva (p1 a 30,10)
  assert.ok(B.removePhase(b, 1));
  assert.equal(B.phaseCount(b), 2);
  assert.deepEqual([at(1, p1.id).x, at(1, ball.id).x], [30, 30]);
  assert.equal(B.removePhase(b, 0), false, 'la fase 1 non si toglie');
  assert.ok(B.removePhase(b, 1));
  assert.equal(b.phases, undefined, 'senza fasi il disegno torna come prima');
  // massimo di fasi
  for (let i = 0; i < 20; i++) B.addPhase(b, B.phaseCount(b) - 1);
  assert.equal(B.phaseCount(b), B.MAX_PHASES);
  assert.equal(B.addPhase(b, 0), -1);
});

test('fasi: normalizzazione e pulizia (file importati, elementi eliminati, disegni vecchi)', () => {
  const b = B.newBoard();
  const p = B.createItem('player', 1, 1, {}, b.items);
  const t = B.createItem('text', 2, 2, { text: 'x' });
  b.items.push(p, t);
  const old = B.normalizeBoard(JSON.parse(JSON.stringify(b)));
  assert.equal('phases' in old, false, 'i disegni senza fasi restano identici');
  const raw = { ...b, phases: [
    { id: 'f1', pos: { [p.id]: [5, 6], [t.id]: [9, 9], ghost: [1, 1], [p.id + 'x']: [1, 1] } },
    { id: '<b>', pos: { [p.id]: ['a', 3] } },
    'spazzatura',
    ...Array.from({ length: 20 }, () => ({ pos: {} })),
  ] };
  const nb = B.normalizeBoard(raw);
  assert.equal(nb.phases.length, B.MAX_PHASES - 1);
  assert.deepEqual(nb.phases[0].pos, { [p.id]: [5, 6] }, 'solo pedine esistenti, niente testi');
  assert.deepEqual(nb.phases[1].pos, { [p.id]: [0, 3] }, 'numeri non validi corretti');
  assert.equal(nb.phases[1].id, 'b', 'id ripulito');
  // elemento eliminato: le fasi lo dimenticano
  B.removeItemById(nb, p.id);
  B.prunePhases(nb);
  assert.deepEqual(nb.phases[0].pos, {});
  // il rendering delle ombre non accetta valori strani
  const svg = renderContent(B.boardAtPhase(b, 0), { ghosts: [{ item: { ...p, label: '<x>' }, to: [3, 3] }, { item: null, to: [1, 1] }] });
  assert.ok(svg.includes('class="ghosts"'));
  assert.ok(!svg.includes('<x>'));
});
