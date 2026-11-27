// Tactic Board: rendering SVG come stringa (puro: usato dall'editor, dalle miniature,
// dall'export PNG nel browser e dai test Node).
import { fieldExtent, unit, toView, viewBox, TEAM_COLORS, LINE_STYLES, sanitizeItem, normalizeField, safeColor } from './model.js';

const GRASS_A = '#2e7d32';
const GRASS_B = '#338a37';
const INGOAL = '#276b2b';
const LINE = '#ffffff';
const FONT = 'Arial, Helvetica, sans-serif';

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const n = (v) => (Math.round(v * 1000) / 1000).toString();

function seg(field, x1, y1, x2, y2, attrs) {
  const [a, b] = toView(field, x1, y1);
  const [c, d] = toView(field, x2, y2);
  return `<line x1="${n(a)}" y1="${n(b)}" x2="${n(c)}" y2="${n(d)}" ${attrs}/>`;
}

function rectF(field, x0, y0, x1, y1, attrs) {
  const [a, b] = toView(field, x0, y0);
  const [c, d] = toView(field, x1, y1);
  return `<rect x="${n(Math.min(a, c))}" y="${n(Math.min(b, d))}" width="${n(Math.abs(c - a))}" height="${n(Math.abs(d - b))}" ${attrs}/>`;
}

export function renderField(field) {
  const e = fieldExtent(field);
  const u = unit(field);
  const W = e.y1;
  const L = Number(field.length) || 1;
  const g = field.type === 'grid' ? 0 : Math.max(0, Number(field.inGoal) || 0);
  const lw = Math.max(0.08, u * 0.12);
  const solid = `stroke="${LINE}" stroke-width="${n(lw)}" fill="none"`;
  const dashed = `stroke="${LINE}" stroke-width="${n(lw)}" stroke-dasharray="${n(u * 0.8)} ${n(u * 0.6)}" fill="none"`;
  const out = [];
  const vb = viewBox(field);
  out.push(`<rect x="${n(vb.x)}" y="${n(vb.y)}" width="${n(vb.w)}" height="${n(vb.h)}" fill="#1b5e20"/>`);
  // strisce del prato
  const stripes = 10;
  const sw = (e.x1 - e.x0) / stripes;
  for (let i = 0; i < stripes; i++) out.push(rectF(field, e.x0 + i * sw, 0, e.x0 + (i + 1) * sw, W, `fill="${i % 2 ? GRASS_B : GRASS_A}"`));

  if (field.type === 'grid') {
    const step = Math.max(0.5, Number(field.gridStep) || 5);
    const thin = `stroke="${LINE}" stroke-opacity="0.45" stroke-width="${n(lw * 0.6)}"`;
    for (let x = step; x < L - 1e-6; x += step) out.push(seg(field, x, 0, x, W, thin));
    for (let y = step; y < W - 1e-6; y += step) out.push(seg(field, 0, y, L, y, thin));
    out.push(rectF(field, 0, 0, L, W, solid));
    // coni agli angoli della griglia
    for (const [x, y] of [[0, 0], [L, 0], [0, W], [L, W]]) out.push(coneShape(field, x, y, u * 0.8, '#ff8f00'));
    return out.join('');
  }

  // aree di meta
  if (g > 0) {
    out.push(rectF(field, 0, 0, g, W, `fill="${INGOAL}"`));
    if (field.type === 'full') out.push(rectF(field, e.x1 - g, 0, e.x1, W, `fill="${INGOAL}"`));
  }
  out.push(rectF(field, e.x0, 0, e.x1, W, solid)); // linee di pallone morto e laterali
  const tryA = g, tryB = g + L;
  const half = g + L / 2;
  const big = L >= 80;
  const lines = [tryA];
  if (field.type === 'full') lines.push(tryB, half);
  for (const x of lines) out.push(seg(field, x, 0, x, W, solid));
  if (field.type === 'half') out.push(seg(field, half, 0, half, W, solid));
  if (big) {
    out.push(seg(field, tryA + 22, 0, tryA + 22, W, solid));
    out.push(seg(field, half - 10, 0, half - 10, W, dashed));
    if (field.type === 'full') {
      out.push(seg(field, tryB - 22, 0, tryB - 22, W, solid));
      out.push(seg(field, half + 10, 0, half + 10, W, dashed));
    }
  } else {
    out.push(seg(field, tryA + L / 4, 0, tryA + L / 4, W, dashed));
    if (field.type === 'full') out.push(seg(field, tryB - L / 4, 0, tryB - L / 4, W, dashed));
  }
  // linee dei 5 m (e 15 m) parallele alle laterali
  const ys = W >= 40 ? [5, 15, W - 15, W - 5] : W >= 20 ? [5, W - 5] : [];
  for (const y of ys) out.push(seg(field, tryA, y, field.type === 'full' ? tryB : half, y, dashed));
  // pali
  const postW = Math.min(5.6, W / 6);
  for (const x of field.type === 'full' ? [tryA, tryB] : [tryA]) {
    const [cx, cy] = toView(field, x, W / 2);
    const r = Math.max(0.15, u * 0.18);
    const [dx, dy] = toView(field, 0, postW / 2);
    out.push(`<circle cx="${n(cx - dx)}" cy="${n(cy - dy)}" r="${n(r)}" fill="#ffffff"/><circle cx="${n(cx + dx)}" cy="${n(cy + dy)}" r="${n(r)}" fill="#ffffff"/>`);
  }
  return out.join('');
}

function coneShape(field, x, y, s, color) {
  const [cx, cy] = toView(field, x, y);
  return `<polygon points="${n(cx)},${n(cy - s * 0.6)} ${n(cx + s * 0.55)},${n(cy + s * 0.45)} ${n(cx - s * 0.55)},${n(cy + s * 0.45)}" fill="${color}" stroke="#4e2600" stroke-width="${n(s * 0.08)}"/>`;
}

function dashFor(style, u, width) {
  const d = LINE_STYLES[style]?.dash;
  if (d === 'dash') return `stroke-dasharray="${n(u * 0.9)} ${n(u * 0.55)}"`;
  if (d === 'dot') return `stroke-dasharray="${n(0.01)} ${n(width * 2.4)}" stroke-linecap="round"`;
  if (d === 'dashdot') return `stroke-dasharray="${n(u * 0.9)} ${n(u * 0.4)} ${n(0.01)} ${n(u * 0.4)}" stroke-linecap="round"`;
  return 'stroke-linecap="round"';
}

function arrowHead(tip, from, size, color) {
  const dx = tip[0] - from[0], dy = tip[1] - from[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const bx = tip[0] - ux * size, by = tip[1] - uy * size;
  const px = -uy * size * 0.55, py = ux * size * 0.55;
  return `<polygon points="${n(tip[0])},${n(tip[1])} ${n(bx + px)},${n(by + py)} ${n(bx - px)},${n(by - py)}" fill="${color}"/>`;
}

// Accorcia un estremo se cade dentro una pedina: la freccia parte/arriva al bordo e non copre il numero
function trimEnd(p, toward, obstacles, gap) {
  for (const o of obstacles || []) {
    const d = Math.hypot(p[0] - o[0], p[1] - o[1]);
    if (d < o[2]) {
      const dx = toward[0] - p[0], dy = toward[1] - p[1];
      const len = Math.hypot(dx, dy) || 1;
      const k = Math.min(o[2] + gap - d, len * 0.45);
      return [p[0] + (dx / len) * k, p[1] + (dy / len) * k];
    }
  }
  return p;
}

export function linePath(field, item, obstacles) {
  let pts = item.points.map(([x, y]) => toView(field, x, y));
  const gap = unit(field) * 0.15;
  if (item.control && pts.length === 2) {
    const c = toView(field, item.control[0], item.control[1]);
    const a = trimEnd(pts[0], c, obstacles, gap);
    const b = trimEnd(pts[1], c, obstacles, gap);
    return { d: `M${n(a[0])},${n(a[1])} Q${n(c[0])},${n(c[1])} ${n(b[0])},${n(b[1])}`, end: b, before: c };
  }
  if (pts.length >= 2) {
    pts = [trimEnd(pts[0], pts[1], obstacles, gap), ...pts.slice(1, -1), trimEnd(pts[pts.length - 1], pts[pts.length - 2], obstacles, gap)];
  }
  const d = pts.map((p, i) => (i ? 'L' : 'M') + n(p[0]) + ',' + n(p[1])).join(' ');
  return { d, end: pts[pts.length - 1], before: pts[pts.length - 2] || pts[0] };
}

function freePath(field, item) {
  const pts = item.points.map(([x, y]) => toView(field, x, y));
  if (pts.length === 1) return `M${n(pts[0][0])},${n(pts[0][1])} l0.001,0`;
  let d = `M${n(pts[0][0])},${n(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += ` Q${n(pts[i][0])},${n(pts[i][1])} ${n(mx)},${n(my)}`;
  }
  const last = pts[pts.length - 1];
  d += ` L${n(last[0])},${n(last[1])}`;
  return d;
}

// Rotazione in vista: con il campo verticale gli oggetti ruotano con il campo
const viewRot = (field, deg) => (field.orientation === 'vertical' ? 90 - deg : deg);

export function playerRadius(field, item, uScale = 1) { return unit(field) * uScale * (item.scale || 1); }

// Tutti i valori del modello passano da sanitizeItem (colori #hex, numeri, testi con escape): niente iniezioni
export function renderItem(field, raw, opts = {}) {
  const item = sanitizeItem(raw);
  if (!item) return '';
  const u = unit(field) * (opts.uScale || 1); // uScale: pedine più grandi solo a schermo (telefono)
  const k = item.scale || 1;
  const hit = opts.interactive;
  const g = (inner) => `<g data-id="${esc(item.id)}" class="bi bi-${item.type}">${inner}</g>`;
  if (item.type === 'line') {
    const w = u * 0.26;
    const color = safeColor(item.color);
    const { d, end, before } = linePath(field, item, opts.obstacles);
    const head = arrowHead(end, before, u * 1.0, color);
    const hitPath = hit ? `<path d="${d}" stroke="rgba(0,0,0,0)" stroke-width="${n(u * 1.6)}" fill="none"/>` : '';
    return g(`${hitPath}<path d="${d}" stroke="${color}" stroke-width="${n(w)}" fill="none" ${dashFor(item.style, u, w)}/>${head}`);
  }
  if (item.type === 'free') {
    const d = freePath(field, item);
    const w = u * 0.2 * (item.width || 1);
    const hitPath = hit ? `<path d="${d}" stroke="rgba(0,0,0,0)" stroke-width="${n(Math.max(u * 1.4, w))}" fill="none" stroke-linecap="round"/>` : '';
    return g(`${hitPath}<path d="${d}" stroke="${safeColor(item.color)}" stroke-width="${n(w)}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  const [x, y] = toView(field, item.x, item.y);
  const hitCircle = (r) => (hit ? `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="rgba(0,0,0,0)"/>` : '');
  switch (item.type) {
    case 'player': {
      const r = u * 1.0 * k;
      const fill = TEAM_COLORS[item.team] || TEAM_COLORS.A;
      const label = esc(item.label ?? '');
      const fs = (label.length > 2 ? u * 0.8 : u * 1.1) * k;
      return g(`<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="${fill}" stroke="#ffffff" stroke-width="${n(u * 0.16 * Math.sqrt(k))}"/>` +
        `<text x="${n(x)}" y="${n(y)}" dy="${n(fs * 0.36)}" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="${n(fs)}" fill="#ffffff">${label}</text>`);
    }
    case 'ball': {
      const rx = u * 0.62 * k, ry = u * 0.4 * k;
      return g(`<g transform="rotate(${n(viewRot(field, -30 + (item.rot || 0)))} ${n(x)} ${n(y)})"><ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(rx)}" ry="${n(ry)}" fill="#fafafa" stroke="#3e2723" stroke-width="${n(u * 0.1 * k)}"/>` +
        `<line x1="${n(x - rx * 0.45)}" y1="${n(y)}" x2="${n(x + rx * 0.45)}" y2="${n(y)}" stroke="#c62828" stroke-width="${n(u * 0.08 * k)}"/></g>` + hitCircle(u * k));
    }
    case 'cone':
      return g(coneShape(field, item.x, item.y, u * 1.0 * k, safeColor(item.color, '#ff8f00')) + hitCircle(u * k));
    case 'pole': {
      const h = u * 1.6 * k;
      return g(`<line x1="${n(x)}" y1="${n(y)}" x2="${n(x)}" y2="${n(y - h)}" stroke="#fdd835" stroke-width="${n(u * 0.22 * k)}" stroke-linecap="round"/>` +
        `<polygon points="${n(x)},${n(y - h)} ${n(x + u * 0.9 * k)},${n(y - h + u * 0.35 * k)} ${n(x)},${n(y - h + u * 0.7 * k)}" fill="#e53935"/>` +
        `<circle cx="${n(x)}" cy="${n(y)}" r="${n(u * 0.22 * k)}" fill="#212121"/>` +
        (hit ? `<rect x="${n(x - u * k)}" y="${n(y - h - u * 0.2)}" width="${n(2 * u * k)}" height="${n(h + u * 0.6)}" fill="rgba(0,0,0,0)"/>` : ''));
    }
    case 'shield': {
      const w = u * 1.5 * k, h = u * 0.75 * k;
      return g(`<g transform="rotate(${n(viewRot(field, item.rot || 0))} ${n(x)} ${n(y)})"><rect x="${n(x - w / 2)}" y="${n(y - h / 2)}" width="${n(w)}" height="${n(h)}" rx="${n(h * 0.3)}" fill="#37474f" stroke="#ffd600" stroke-width="${n(u * 0.12 * k)}"/></g>` + hitCircle(u * k));
    }
    case 'text': {
      const fs = u * 1.3 * (item.size || 1);
      const rot = item.rot ? ` transform="rotate(${n(item.rot)} ${n(x)} ${n(y)})"` : '';
      return g(`<text x="${n(x)}" y="${n(y)}" dy="${n(fs * 0.35)}"${rot} text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="${n(fs)}" fill="${safeColor(item.color)}" stroke="#ffffff" stroke-width="${n(fs * 0.18)}" paint-order="stroke" stroke-linejoin="round">${esc(item.text)}</text>`);
    }
    default: return '';
  }
}

export function renderSelection(field, raw, uScale = 1) {
  const item = sanitizeItem(raw);
  if (!item) return '';
  const u = unit(field) * uScale;
  const style = `fill="none" stroke="#ffd600" stroke-width="${n(u * 0.18)}" stroke-dasharray="${n(u * 0.5)} ${n(u * 0.3)}"`;
  if (item.type === 'line' || item.type === 'free') {
    const pts = item.points.map(([x, y]) => toView(field, x, y));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    if (item.control) { const c = toView(field, item.control[0], item.control[1]); xs.push(c[0]); ys.push(c[1]); }
    const pad = u * 0.8;
    let out = `<rect x="${n(Math.min(...xs) - pad)}" y="${n(Math.min(...ys) - pad)}" width="${n(Math.max(...xs) - Math.min(...xs) + 2 * pad)}" height="${n(Math.max(...ys) - Math.min(...ys) + 2 * pad)}" ${style} pointer-events="none"/>`;
    if (item.type === 'line') {
      item.points.forEach(([x, y], i) => {
        const [a, b] = toView(field, x, y);
        out += `<circle data-handle="${i}" cx="${n(a)}" cy="${n(b)}" r="${n(u * 0.75)}" fill="#ffd600" fill-opacity="0.85" stroke="#000" stroke-width="${n(u * 0.1)}"/>`;
      });
      if (item.control) {
        const [a, b] = toView(field, item.control[0], item.control[1]);
        out += `<circle data-handle="c" cx="${n(a)}" cy="${n(b)}" r="${n(u * 0.75)}" fill="#ffffff" fill-opacity="0.9" stroke="#000" stroke-width="${n(u * 0.1)}"/>`;
      }
    }
    return out;
  }
  const [x, y] = toView(field, item.x, item.y);
  const r = item.type === 'text' ? u * 1.6 * (item.size || 1) : u * 1.6 * (item.scale || 1);
  return `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" ${style} pointer-events="none"/>`;
}

// Ordine di disegno: prima linee e tratti, poi gli oggetti -> le pedine restano sempre sopra le frecce
export function drawOrder(items) {
  const isLine = (i) => i && (i.type === 'line' || i.type === 'free');
  return [...items.filter(isLine), ...items.filter((i) => !isLine(i))];
}

// Contenuto interno (senza tag <svg>) — usato dall'editor che mantiene un <svg> persistente
export function renderContent(board, opts = {}) {
  const field = normalizeField(board.field);
  const items = drawOrder([...(board.items || []), ...(opts.extraItems || [])]);
  const obstacles = items.filter((i) => i && i.type === 'player').map((p) => {
    const s = sanitizeItem(p);
    if (!s) return null;
    const [x, y] = toView(field, s.x, s.y);
    return [x, y, playerRadius(field, s, opts.uScale || 1)];
  }).filter(Boolean);
  const sel = opts.selectedId ? items.find((i) => i.id === opts.selectedId) : null;
  // fasi (solo nell'editor): pedina semitrasparente dove era nella fase prima + traccia fino a dove arriva
  const u = unit(field) * (opts.uScale || 1);
  const ghosts = (opts.ghosts || []).map(({ item, to }) => {
    const s = sanitizeItem(item);
    if (!s || !Array.isArray(to)) return '';
    const [x1, y1] = toView(field, s.x, s.y);
    const [x2, y2] = toView(field, Number(to[0]) || 0, Number(to[1]) || 0);
    return `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="#ffffff" stroke-width="${n(u * 0.14)}" stroke-dasharray="${n(u * 0.35)} ${n(u * 0.3)}"/>` + renderItem(field, s, { uScale: opts.uScale });
  }).join('');
  return `<g class="field">${renderField(field)}</g>${ghosts ? `<g class="ghosts" opacity="0.45" pointer-events="none">${ghosts}</g>` : ''}<g class="items">${items.map((i) => renderItem(field, i, { ...opts, obstacles })).join('')}</g><g class="sel">${renderSelection(field, sel, opts.uScale || 1)}</g>`;
}

export function boardViewBox(board) {
  const vb = viewBox(normalizeField(board.field));
  return `${n(vb.x)} ${n(vb.y)} ${n(vb.w)} ${n(vb.h)}`;
}

// SVG completo. Se pxWidth è dato imposta width/height in pixel (per export PNG)
export function renderSVG(board, opts = {}) {
  const vb = viewBox(normalizeField(board.field));
  let size = '';
  if (opts.pxWidth) {
    const h = Math.round(opts.pxWidth * vb.h / vb.w);
    size = ` width="${opts.pxWidth}" height="${h}"`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${boardViewBox(board)}"${size} preserveAspectRatio="xMidYMid meet">${renderContent(board, opts)}</svg>`;
}

export function exportSize(board, pxWidth) {
  const vb = viewBox(normalizeField(board.field));
  return { width: pxWidth, height: Math.round(pxWidth * vb.h / vb.w) };
}
