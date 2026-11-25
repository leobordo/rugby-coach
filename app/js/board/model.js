// Tactic Board: modello vettoriale (logica pura, testabile con Node).
// Coordinate in METRI nel sistema del campo: x lungo la lunghezza, y lungo la larghezza.
// L'orientamento (orizzontale/verticale) è solo di visualizzazione (trasposizione).

export const BOARD_VERSION = 1;

export const FIELD_TYPES = {
  full: { label: 'Campo intero' },
  half: { label: 'Metà campo' },
  grid: { label: 'Area libera / griglia' },
};

export const FIELD_PRESETS = [
  { id: 'regolamentare', label: 'Regolamentare 100×70', type: 'full', length: 100, width: 70, inGoal: 10 },
  { id: 'mini-grande', label: 'Minirugby grande 60×35', type: 'full', length: 60, width: 35, inGoal: 5 },
  { id: 'mini-medio', label: 'Minirugby medio 45×25', type: 'full', length: 45, width: 25, inGoal: 5 },
  { id: 'mini-piccolo', label: 'Minirugby piccolo 30×20', type: 'full', length: 30, width: 20, inGoal: 3 },
  { id: 'griglia-20x15', label: 'Griglia 20×15', type: 'grid', length: 20, width: 15, inGoal: 0 },
  { id: 'griglia-10x10', label: 'Griglia 10×10', type: 'grid', length: 10, width: 10, inGoal: 0 },
];

export const TEAM_COLORS = { A: '#c62828', B: '#1565c0' };

export const LINE_STYLES = {
  run: { label: 'Corsa', dash: null, curved: false },
  pass: { label: 'Passaggio', dash: 'dash', curved: false },
  kick: { label: 'Calcio', dash: 'dot', curved: true },
  move: { label: 'Movimento senza palla', dash: 'dashdot', curved: false },
};

export const PLACEABLE = ['player', 'ball', 'cone', 'pole', 'shield', 'text'];

let counter = 0;
export function itemId() {
  counter = (counter + 1) % 1e6;
  return 'i' + Date.now().toString(36) + counter.toString(36) + Math.random().toString(36).slice(2, 5);
}

export function newField(extra = {}) {
  return { type: 'full', length: 60, width: 35, inGoal: 5, gridStep: 5, orientation: 'horizontal', ...extra };
}

export function newBoard(extra = {}) {
  return { version: BOARD_VERSION, field: newField(), items: [], thumb: null, updatedAt: null, ...extra };
}

export function cloneBoard(b) { return JSON.parse(JSON.stringify(b)); }

// Dimensioni in metri dell'area mostrata (nel sistema campo)
export function fieldExtent(field) {
  const L = Math.max(1, Number(field.length) || 1);
  const W = Math.max(1, Number(field.width) || 1);
  const g = field.type === 'grid' ? 0 : Math.max(0, Number(field.inGoal) || 0);
  if (field.type === 'half') return { x0: 0, x1: g + L / 2, y0: 0, y1: W };
  return { x0: 0, x1: L + 2 * g, y0: 0, y1: W };
}

// Unità grafica: dimensione delle pedine proporzionata al campo
export function unit(field) {
  const e = fieldExtent(field);
  return Math.max(0.35, Math.max(e.x1 - e.x0, e.y1 - e.y0) / 42);
}

// Trasformazione campo -> visualizzazione (trasposizione se verticale: è involutiva)
export function toView(field, x, y) { return field.orientation === 'vertical' ? [y, x] : [x, y]; }
export function fromView(field, vx, vy) { return field.orientation === 'vertical' ? [vy, vx] : [vx, vy]; }

export function viewBox(field, pad) {
  const e = fieldExtent(field);
  const p = pad ?? unit(field) * 1.5;
  const [w, h] = field.orientation === 'vertical' ? [e.y1 - e.y0, e.x1 - e.x0] : [e.x1 - e.x0, e.y1 - e.y0];
  return { x: -p, y: -p, w: w + 2 * p, h: h + 2 * p };
}

export function nextPlayerLabel(items, team) {
  const used = new Set(items.filter((i) => i.type === 'player' && i.team === team).map((i) => String(i.label)));
  let n = 1;
  while (used.has(String(n))) n++;
  return String(n);
}

export function createItem(type, x, y, opts = {}, items = []) {
  const id = itemId();
  switch (type) {
    case 'player': {
      const team = opts.team || 'A';
      return { id, type, team, x, y, label: opts.label ?? nextPlayerLabel(items, team) };
    }
    case 'ball': case 'cone': case 'pole': return opts.color ? { id, type, x, y, color: opts.color } : { id, type, x, y };
    case 'shield': return { id, type, x, y, rot: opts.rot || 0 };
    case 'text': return { id, type, x, y, text: opts.text || 'Testo', color: opts.color || '#111111', size: opts.size || 1 };
    default: throw new Error('Tipo elemento sconosciuto: ' + type);
  }
}

export function createLine(style, p0, p1, opts = {}) {
  const pts = [p0, p1];
  const line = { id: itemId(), type: 'line', style, points: pts, color: opts.color || '#111111' };
  if (LINE_STYLES[style]?.curved) line.control = defaultControl(p0, p1);
  return line;
}

export function defaultControl(p0, p1) {
  const mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2;
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
  const len = Math.hypot(dx, dy) || 1;
  const k = 0.25 * len;
  return [mx - (dy / len) * k, my + (dx / len) * k];
}

export function createFree(points, opts = {}) {
  return { id: itemId(), type: 'free', points: simplify(points, opts.tolerance ?? 0.05), color: opts.color || '#111111', width: opts.width || 1 };
}

// Riduzione punti (distanza minima) per tenere leggeri i tratti a mano libera
export function simplify(points, tol) {
  if (points.length <= 2) return points.map((p) => [round(p[0]), round(p[1])]);
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const last = out[out.length - 1];
    if (Math.hypot(points[i][0] - last[0], points[i][1] - last[1]) >= tol) out.push(points[i]);
  }
  out.push(points[points.length - 1]);
  return out.map((p) => [round(p[0]), round(p[1])]);
}

export function round(v) { return Math.round(v * 100) / 100; }

export function translateItem(item, dx, dy) {
  if ('x' in item) { item.x = round(item.x + dx); item.y = round(item.y + dy); }
  if (item.points) item.points = item.points.map(([x, y]) => [round(x + dx), round(y + dy)]);
  if (item.control) item.control = [round(item.control[0] + dx), round(item.control[1] + dy)];
  return item;
}

export function duplicateItem(item, items, offset = 1.5) {
  const c = JSON.parse(JSON.stringify(item));
  c.id = itemId();
  if (c.type === 'player') c.label = nextPlayerLabel(items, c.team);
  return translateItem(c, offset, offset);
}

export function findItem(board, id) { return board.items.find((i) => i.id === id) || null; }

export function removeItemById(board, id) {
  const i = board.items.findIndex((x) => x.id === id);
  if (i >= 0) board.items.splice(i, 1);
  return i >= 0;
}

export function bringToFront(board, id) {
  const i = board.items.findIndex((x) => x.id === id);
  if (i < 0) return false;
  board.items.push(board.items.splice(i, 1)[0]);
  return true;
}

export function sendToBack(board, id) {
  const i = board.items.findIndex((x) => x.id === id);
  if (i < 0) return false;
  board.items.unshift(board.items.splice(i, 1)[0]);
  return true;
}

export function isEmptyBoard(b) { return !b || !b.items || b.items.length === 0; }

// ---------- Sanificazione (i disegni arrivano anche da file JSON/backup importati) ----------

const HEX = /^#[0-9a-fA-F]{3,8}$/;
export function safeColor(c, def = '#111111') { return typeof c === 'string' && HEX.test(c) ? c : def; }
export function safeNum(v, def = 0, min = -1e4, max = 1e4) {
  const x = Number(v);
  return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : def;
}
const safeId = (v) => (String(v ?? '').replace(/[^\w-]/g, '').slice(0, 48) || itemId());
const safePt = (p) => (Array.isArray(p) && p.length >= 2 ? [safeNum(p[0]), safeNum(p[1])] : null);
export const SCALE_MIN = 0.5;
export const SCALE_MAX = 3;

// Restituisce una copia pulita dell'elemento (solo campi noti, tipi corretti) oppure null
export function sanitizeItem(i) {
  if (!i || typeof i !== 'object') return null;
  const id = safeId(i.id);
  if (i.type === 'line') {
    const pts = (Array.isArray(i.points) ? i.points : []).map(safePt).filter(Boolean).slice(0, 2);
    if (pts.length < 2) return null;
    const out = { id, type: 'line', style: LINE_STYLES[i.style] ? i.style : 'run', points: pts, color: safeColor(i.color) };
    const c = safePt(i.control);
    if (c) out.control = c;
    return out;
  }
  if (i.type === 'free') {
    const pts = (Array.isArray(i.points) ? i.points : []).map(safePt).filter(Boolean).slice(0, 5000);
    if (!pts.length) return null;
    return { id, type: 'free', points: pts, color: safeColor(i.color), width: safeNum(i.width, 1, 0.25, 6) };
  }
  if (!PLACEABLE.includes(i.type)) return null;
  const out = { id, type: i.type, x: safeNum(i.x), y: safeNum(i.y) };
  if (i.scale !== undefined) out.scale = safeNum(i.scale, 1, SCALE_MIN, SCALE_MAX);
  if (i.rot !== undefined) out.rot = safeNum(i.rot, 0, -360, 360);
  switch (i.type) {
    case 'player': out.team = i.team === 'B' ? 'B' : 'A'; out.label = String(i.label ?? '').slice(0, 4); break;
    case 'text': out.text = String(i.text ?? '').slice(0, 200); out.color = safeColor(i.color); out.size = safeNum(i.size, 1, 0.25, 4); break;
    case 'cone': case 'ball': case 'pole': if (i.color !== undefined) out.color = safeColor(i.color, '#ff8f00'); break;
    default: break;
  }
  return out;
}

export function normalizeField(f) {
  const out = newField({});
  const src = f && typeof f === 'object' ? f : {};
  out.type = FIELD_TYPES[src.type] ? src.type : 'full';
  out.orientation = src.orientation === 'vertical' ? 'vertical' : 'horizontal';
  out.length = safeNum(src.length, out.length, 1, 200);
  out.width = safeNum(src.width, out.width, 1, 150);
  out.inGoal = safeNum(src.inGoal, out.inGoal, 0, 30);
  out.gridStep = safeNum(src.gridStep, out.gridStep, 0.5, 50);
  return out;
}

const THUMB_RE = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;
export function safeThumb(t) { return typeof t === 'string' && THUMB_RE.test(t) ? t : null; }

// Validazione/normalizzazione di un JSON di disegno (per riapertura e import)
export function normalizeBoard(b) {
  if (!b || typeof b !== 'object') return newBoard();
  const out = newBoard();
  out.field = normalizeField(b.field);
  out.items = (Array.isArray(b.items) ? b.items : []).map(sanitizeItem).filter(Boolean);
  out.thumb = safeThumb(b.thumb);
  out.updatedAt = typeof b.updatedAt === 'string' ? b.updatedAt.slice(0, 40) : null;
  return out;
}

// Ridimensiona / ruota l'elemento selezionato (R14)
export function scaleItem(item, factor) {
  if (item.type === 'text') { item.size = round(Math.min(4, Math.max(0.25, (item.size || 1) * factor))); return item; }
  if (item.type === 'free') { item.width = round(Math.min(6, Math.max(0.25, (item.width || 1) * factor))); return item; }
  if (item.type === 'line') return item;
  item.scale = round(Math.min(SCALE_MAX, Math.max(SCALE_MIN, (item.scale || 1) * factor)));
  return item;
}
export const ROTATABLE = ['ball', 'shield', 'text'];
export function rotateItem(item, deg) {
  if (!ROTATABLE.includes(item.type)) return item;
  item.rot = (((item.rot || 0) + deg) % 360 + 360) % 360;
  return item;
}

// ---------- Annulla / ripeti ----------

export class History {
  constructor(state, limit = 100) {
    this.stack = [JSON.stringify(state)];
    this.index = 0;
    this.limit = limit;
  }
  push(state) {
    const s = JSON.stringify(state);
    if (s === this.stack[this.index]) return false;
    this.stack = this.stack.slice(0, this.index + 1);
    this.stack.push(s);
    if (this.stack.length > this.limit) this.stack.shift();
    this.index = this.stack.length - 1;
    return true;
  }
  canUndo() { return this.index > 0; }
  canRedo() { return this.index < this.stack.length - 1; }
  undo() { if (!this.canUndo()) return null; this.index--; return JSON.parse(this.stack[this.index]); }
  redo() { if (!this.canRedo()) return null; this.index++; return JSON.parse(this.stack[this.index]); }
  current() { return JSON.parse(this.stack[this.index]); }
}
