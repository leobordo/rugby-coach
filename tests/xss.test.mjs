// I disegni possono arrivare da file JSON/backup importati: nessun valore deve finire nel markup senza controllo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderItem, renderSVG, renderContent } from '../app/js/board/render.js';
import { newField, normalizeBoard, sanitizeItem, safeThumb } from '../app/js/board/model.js';
import { renderMarkdown } from '../app/js/markdown.js';

const ATTR = '"/><image href="x" onerror="alert(1)"/><x a="';
const TAG = '<img src=x onerror=alert(1)><script>alert(1)</script>';

const evil = [
  { id: 'a" onmouseover="alert(1)', type: 'cone', x: 5, y: 5, color: ATTR },
  { id: 'b', type: 'text', x: '5" onload="x', y: 5, text: TAG, color: ATTR, size: '1" onclick="x' },
  { id: 'c', type: 'player', team: '"><script>', x: 1, y: 1, label: '<b>x</b>', scale: ATTR },
  { id: 'd', type: 'line', style: ATTR, points: [[0, 0], ['1"/><script>', 2]], color: 'red;background:url(javascript:alert(1))' },
  { id: 'e', type: 'free', points: [[0, 0], [1, 1]], color: 'url(#x)', width: ATTR },
  { id: 'f', type: 'shield', x: 2, y: 2, rot: ATTR },
  { id: 'g', type: 'ball', x: 3, y: 3, rot: '45"/><script>' },
  { id: 'h', type: 'pole', x: 3, y: 3, scale: 99 },
  { type: 'virus', x: 1, y: 1 },
];

function assertClean(markup) {
  assert.doesNotMatch(markup, /<script|<image|<img|<foreignObject/i, 'tag iniettato');
  assert.doesNotMatch(markup, /\son[a-z]+\s*=\s*"/i, 'attributo evento iniettato');
  assert.doesNotMatch(markup, /javascript:/i);
  assert.doesNotMatch(markup, /url\(/i);
}

test('renderItem: colori, numeri, testi e id ostili non producono markup', () => {
  for (const it of evil) assertClean(renderItem(newField(), it, { interactive: true }));
});

test('renderSVG / renderContent su un disegno ostile (anche campo ostile)', () => {
  const board = { field: { type: '"><script>', length: '1"/><x', width: 30, orientation: ATTR }, items: evil };
  assertClean(renderSVG(board, { pxWidth: 400 }));
  assertClean(renderContent(board, { interactive: true, selectedId: 'b' }));
});

test('normalizeBoard: tiene solo campi noti con tipi corretti', () => {
  const b = normalizeBoard({ field: { type: 'x' }, items: evil, thumb: 'javascript:alert(1)' });
  assert.equal(b.thumb, null);
  assert.equal(b.items.length, evil.length - 1, 'solo il tipo sconosciuto viene scartato');
  for (const it of b.items) {
    if (it.color !== undefined) assert.match(it.color, /^#[0-9a-f]{3,8}$/i);
    for (const k of ['x', 'y', 'scale', 'rot', 'size', 'width']) if (it[k] !== undefined) assert.equal(typeof it[k], 'number', k);
    assert.match(it.id, /^[\w-]+$/);
  }
  assert.equal(sanitizeItem({ type: 'pole', x: 1, y: 1, scale: 99 }).scale, 3, 'scala limitata');
  assert.equal(safeThumb('data:image/png;base64,iVBORw0KGgo='), 'data:image/png;base64,iVBORw0KGgo=');
  assert.equal(safeThumb('data:image/svg+xml,<svg onload=alert(1)>'), null);
});

test('markdown della guida: HTML grezzo escapato, link solo http(s)/relativi/#', () => {
  const html = renderMarkdown('# T\n\n' + TAG + '\n\n[x](javascript:alert(1)) [ok](https://a.b/c) **b** `c`\n\n| a | b |\n|---|---|\n| <i>1</i> | 2 |');
  assertClean(html);
  assert.match(html, /<h1[^>]*>T<\/h1>/);
  assert.match(html, /href="https:\/\/a\.b\/c"/);
  assert.match(html, /<table/);
  assert.match(html, /&lt;i&gt;1&lt;\/i&gt;/);
});
