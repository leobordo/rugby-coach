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
