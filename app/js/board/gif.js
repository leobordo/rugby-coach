// Codificatore di GIF animate (GIF89a) per le azioni della Tactic Board.
// Modulo puro: niente DOM, riceve i pixel RGBA dei fotogrammi (dal canvas nel browser, da array nei test in Node).
// - Tavolozza unica (max 256 colori) scelta dai colori più usati nei fotogrammi: la lavagna ha pochi colori pieni,
//   i bordi sfumati vanno sul colore più vicino.
// - Dal secondo fotogramma si scrive solo il rettangolo che cambia; un fotogramma identico allunga la pausa del
//   precedente. Così un'azione di pochi secondi resta di poche decine/centinaia di KB.

// frames: [{ data: RGBA (width * height * 4), delay: centesimi di secondo }]
export function buildPalette(frames, max = 256) {
  const count = new Uint32Array(32768);
  const sum = new Float64Array(32768 * 3);
  for (const fr of frames) {
    const d = fr.data;
    for (let i = 0; i < d.length; i += 4) {
      const key = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3);
      count[key]++;
      sum[key * 3] += d[i]; sum[key * 3 + 1] += d[i + 1]; sum[key * 3 + 2] += d[i + 2];
    }
  }
  const keys = [];
  for (let k = 0; k < 32768; k++) if (count[k]) keys.push(k);
  keys.sort((a, b) => count[b] - count[a] || a - b);
  const avg = (list) => {
    const s = [0, 0, 0]; let n = 0;
    for (const k of list) { n += count[k]; for (let c = 0; c < 3; c++) s[c] += sum[k * 3 + c]; }
    return s.map((v) => Math.round(v / n));
  };
  if (keys.length <= max) return keys.map((k) => avg([k]));
  // troppi colori: i più usati restano esatti (prato, maglie, linee), gli altri si dividono per mediana
  const keep = max >> 1;
  const boxes = [keys.slice(keep)];
  const ch = (k, c) => (c === 0 ? k >> 10 : c === 1 ? (k >> 5) & 31 : k & 31);
  const spread = (box) => {
    let best = 0, chan = 0;
    for (let c = 0; c < 3; c++) {
      let lo = 31, hi = 0;
      for (const k of box) { const v = ch(k, c); if (v < lo) lo = v; if (v > hi) hi = v; }
      if (hi - lo > best) { best = hi - lo; chan = c; }
    }
    return { best, chan };
  };
  while (boxes.length < max - keep) {
    let pick = -1, score = 0, chan = 0;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      const s = spread(box);
      const w = s.best * box.reduce((a, k) => a + count[k], 0);
      if (w > score) { score = w; pick = i; chan = s.chan; }
    });
    if (pick < 0) break;
    const box = boxes[pick].sort((a, b) => ch(a, chan) - ch(b, chan));
    const total = box.reduce((a, k) => a + count[k], 0);
    let acc = 0, cut = 1;
    for (let i = 0; i < box.length - 1; i++) { acc += count[box[i]]; if (acc * 2 >= total) { cut = i + 1; break; } cut = i + 1; }
    boxes.splice(pick, 1, box.slice(0, cut), box.slice(cut));
  }
  return [...keys.slice(0, keep).map((k) => avg([k])), ...boxes.map(avg)];
}

// Da RGBA a indici della tavolozza (colore più vicino, con memoria per i colori già visti)
function indexer(palette) {
  const lut = new Int16Array(32768).fill(-1);
  return (d, out) => {
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      const key = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3);
      let idx = lut[key];
      if (idx < 0) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        let best = 0, bestD = Infinity;
        for (let j = 0; j < palette.length; j++) {
          const c = palette[j];
          const dist = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2;
          if (dist < bestD) { bestD = dist; best = j; if (!dist) break; }
        }
        idx = lut[key] = best;
      }
      out[p] = idx;
    }
    return out;
  };
}

// Compressione LZW del formato GIF (codici da minSize+1 a 12 bit, Clear quando la tabella è piena)
export function lzwEncode(indices, minSize = 8) {
  const clear = 1 << minSize, eoi = clear + 1;
  let size = minSize + 1, next = eoi + 1;
  const dict = new Map();
  const out = [];
  let cur = 0, bits = 0;
  const write = (code) => {
    cur |= code << bits; bits += size;
    while (bits >= 8) { out.push(cur & 255); cur >>>= 8; bits -= 8; }
  };
  write(clear);
  if (!indices.length) { write(eoi); if (bits) out.push(cur & 255); return Uint8Array.from(out); }
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const c = dict.get(key);
    if (c !== undefined) { prefix = c; continue; }
    write(prefix);
    if (next >= (1 << size) && size < 12) size++;
    if (next < 4096) dict.set(key, next++);
    else { write(clear); dict.clear(); size = minSize + 1; next = eoi + 1; }
    prefix = k;
  }
  write(prefix);
  if (next >= (1 << size) && size < 12) size++;
  write(eoi);
  if (bits) out.push(cur & 255);
  return Uint8Array.from(out);
}

class Bytes {
  constructor() { this.parts = []; this.len = 0; }
  push(...b) { this.add(Uint8Array.from(b)); }
  u16(v) { this.push(v & 255, (v >> 8) & 255); }
  str(s) { this.add(Uint8Array.from([...s].map((c) => c.charCodeAt(0)))); }
  add(arr) { this.parts.push(arr); this.len += arr.length; }
  result() { const out = new Uint8Array(this.len); let o = 0; for (const p of this.parts) { out.set(p, o); o += p.length; } return out; }
}

// Rettangolo dei pixel diversi tra due fotogrammi (null se identici)
function changedRect(prev, cur, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (prev[row + x] !== cur[row + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function encodeGif(width, height, frames, { loop = 0 } = {}) {
  if (!frames.length) throw new Error('Nessun fotogramma');
  const palette = buildPalette(frames);
  const toIdx = indexer(palette);
  // fotogrammi da scrivere: il primo intero, poi solo le parti che cambiano
  const list = [];
  let prev = null;
  for (const fr of frames) {
    const cur = toIdx(fr.data, new Uint8Array(width * height));
    const delay = Math.max(2, Math.round(fr.delay || 10));
    if (!prev) { list.push({ x: 0, y: 0, w: width, h: height, idx: cur, delay }); prev = cur; continue; }
    const r = changedRect(prev, cur, width, height);
    if (!r) { list[list.length - 1].delay += delay; continue; }
    const sub = new Uint8Array(r.w * r.h);
    for (let y = 0; y < r.h; y++) sub.set(cur.subarray((r.y + y) * width + r.x, (r.y + y) * width + r.x + r.w), y * r.w);
    list.push({ ...r, idx: sub, delay });
    prev = cur;
  }
  const out = new Bytes();
  out.str('GIF89a');
  out.u16(width); out.u16(height);
  out.push(0xf7, 0, 0); // tavolozza globale da 256 colori
  for (let i = 0; i < 256; i++) { const c = palette[i] || [0, 0, 0]; out.push(c[0], c[1], c[2]); }
  out.push(0x21, 0xff, 0x0b); out.str('NETSCAPE2.0'); out.push(0x03, 0x01); out.u16(loop); out.push(0x00); // ripeti
  for (const f of list) {
    out.push(0x21, 0xf9, 0x04, 0x04); out.u16(Math.min(65535, f.delay)); out.push(0x00, 0x00); // lascia il fotogramma sotto
    out.push(0x2c); out.u16(f.x); out.u16(f.y); out.u16(f.w); out.u16(f.h); out.push(0x00);
    out.push(8);
    const data = lzwEncode(f.idx, 8);
    for (let i = 0; i < data.length; i += 255) { const n = Math.min(255, data.length - i); out.push(n); out.add(data.subarray(i, i + n)); }
    out.push(0x00);
  }
  out.push(0x3b);
  return out.result();
}

export function bytesToDataUrl(bytes, mime = 'image/gif') {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,` + btoa(s);
}
