// Codificatore GIF della Tactic Board: si rilegge ogni GIF con un decodificatore indipendente (qui sotto).
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeGif, lzwEncode, buildPalette, bytesToDataUrl } from '../app/js/board/gif.js';

// ---------- decodificatore GIF minimo (solo per i test) ----------
function lzwDecode(data, min) {
  const clear = 1 << min, eoi = clear + 1;
  let size = min + 1, next = eoi + 1;
  let table = [];
  const reset = () => { table = []; for (let i = 0; i < clear; i++) table[i] = [i]; size = min + 1; next = eoi + 1; };
  reset();
  let pos = 0;
  const read = () => {
    let code = 0;
    for (let i = 0; i < size; i++, pos++) {
      if ((pos >> 3) >= data.length) return eoi;
      code |= ((data[pos >> 3] >> (pos & 7)) & 1) << i;
    }
    return code;
  };
  const out = [];
  let prev = null;
  for (;;) {
    const code = read();
    if (code === clear) { reset(); prev = null; continue; }
    if (code === eoi) break;
    if (prev === null) { out.push(...table[code]); prev = code; continue; }
    let entry;
    if (code < next) entry = table[code];
    else if (code === next) entry = [...table[prev], table[prev][0]];
    else throw new Error('codice LZW non valido ' + code);
    out.push(...entry);
    if (next < 4096) table[next++] = [...table[prev], entry[0]];
    if (next === (1 << size) && size < 12) size++;
    prev = code;
  }
  return out;
}

function decodeGif(bytes) {
  let p = 0;
  const u8 = () => bytes[p++];
  const u16 = () => { const v = bytes[p] | (bytes[p + 1] << 8); p += 2; return v; };
  const sig = String.fromCharCode(...bytes.slice(0, 6)); p = 6;
  const width = u16(), height = u16();
  const packed = u8(); u8(); u8();
  const palette = [];
  if (packed & 0x80) for (let i = 0; i < (2 << (packed & 7)); i++) palette.push([u8(), u8(), u8()]);
  const screen = new Uint8Array(width * height);
  const frames = [];
  let delay = 0, loop = null;
  while (p < bytes.length) {
    const b = u8();
    if (b === 0x3b) break;
    if (b === 0x21) {
      const label = u8();
      if (label === 0xf9) { u8(); u8(); delay = u16(); u8(); u8(); continue; }
      const blocks = [];
      for (let s = u8(); s; s = u8()) { blocks.push(bytes.slice(p, p + s)); p += s; }
      if (label === 0xff && String.fromCharCode(...blocks[0]) === 'NETSCAPE2.0') loop = blocks[1][1] | (blocks[1][2] << 8);
      continue;
    }
    if (b === 0x2c) {
      const x = u16(), y = u16(), w = u16(), h = u16();
      u8();
      const min = u8();
      const chunks = [];
      for (let s = u8(); s; s = u8()) { chunks.push(...bytes.slice(p, p + s)); p += s; }
      const idx = lzwDecode(Uint8Array.from(chunks), min);
      assert.equal(idx.length, w * h, 'pixel del fotogramma');
      for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) screen[(y + r) * width + x + c] = idx[r * w + c];
      frames.push({ x, y, w, h, delay, rgb: Array.from(screen, (i) => palette[i]) });
      continue;
    }
    throw new Error('blocco GIF sconosciuto ' + b);
  }
  return { sig, width, height, palette, frames, loop };
}

// ---------- fotogrammi di prova ----------
const GREEN = [27, 94, 32], RED = [198, 40, 40], WHITE = [255, 255, 255];
function frame(w, h, paint) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = paint(x, y);
    data.set([c[0], c[1], c[2], 255], (y * w + x) * 4);
  }
  return data;
}
const rgbOf = (data) => { const out = []; for (let i = 0; i < data.length; i += 4) out.push([data[i], data[i + 1], data[i + 2]]); return out; };

test('GIF: fotogrammi riletti identici, solo la parte che cambia, pause unite, ripetizione infinita', () => {
  const W = 24, H = 16;
  const at = (sx, sy) => (x, y) => (x >= sx && x < sx + 4 && y >= sy && y < sy + 4 ? RED : y === 8 ? WHITE : GREEN);
  const f1 = frame(W, H, at(2, 2)), f2 = frame(W, H, at(10, 6)), f3 = frame(W, H, at(10, 6));
  const gif = encodeGif(W, H, [{ data: f1, delay: 100 }, { data: f2, delay: 11 }, { data: f3, delay: 70 }]);
  const d = decodeGif(gif);
  assert.equal(d.sig, 'GIF89a');
  assert.deepEqual([d.width, d.height], [W, H]);
  assert.equal(d.loop, 0, 'ripete all\'infinito');
  assert.equal(d.frames.length, 2, 'il fotogramma uguale al precedente allunga solo la pausa');
  assert.deepEqual(d.frames.map((f) => f.delay), [100, 81]);
  assert.deepEqual(d.frames[0].rgb, rgbOf(f1));
  assert.deepEqual(d.frames[1].rgb, rgbOf(f2));
  const r = d.frames[1];
  assert.deepEqual([r.x, r.y, r.w, r.h], [2, 2, 12, 8], 'scritto solo il rettangolo cambiato');
});

test('GIF: compressione LZW su immagini grandi (tabella piena e ripartenza) e su tinta unita', () => {
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) >>> 24;
  for (const indices of [
    Uint8Array.from({ length: 160 * 120 }, () => rnd() % 200),
    new Uint8Array(300 * 200).fill(7),
    Uint8Array.from({ length: 5000 }, (_, i) => (i * 7) % 256),
    Uint8Array.from([5]),
  ]) {
    assert.deepEqual(lzwDecode(lzwEncode(indices), 8), Array.from(indices));
  }
});

test('GIF: più di 256 colori → tavolozza di 256 e colori vicini agli originali', () => {
  const W = 64, H = 64;
  const data = frame(W, H, (x, y) => [x * 4, y * 4, (x + y) * 2]);
  const pal = buildPalette([{ data }]);
  assert.ok(pal.length <= 256);
  const d = decodeGif(encodeGif(W, H, [{ data, delay: 10 }]));
  const orig = rgbOf(data);
  const worst = Math.max(...d.frames[0].rgb.map((c, i) => Math.max(...c.map((v, k) => Math.abs(v - orig[i][k])))));
  assert.ok(worst <= 40, 'scarto massimo per canale ' + worst);
  assert.throws(() => encodeGif(W, H, []));
});

test('GIF: data URL', () => {
  const bytes = Uint8Array.from({ length: 70000 }, (_, i) => i % 251);
  const url = bytesToDataUrl(bytes);
  assert.ok(url.startsWith('data:image/gif;base64,'));
  assert.deepEqual(Uint8Array.from(Buffer.from(url.split(',')[1], 'base64')), bytes);
});
