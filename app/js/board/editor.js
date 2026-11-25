// Editor Tactic Board a schermo intero: touch + mouse + penna tramite Pointer Events (R10–R15, decisione 8).
import { h, clear, promptDialog, confirmDialog, modal, toast, downloadBlob, pickFile } from '../ui.js';
import * as B from './model.js';
import { renderContent, boardViewBox, renderSVG, exportSize } from './render.js';

const THUMB_PX = 720;

const ICONS = {
  select: '<path d="M6 3l12 9-5.5 1.2L16 20l-2.6 1.2-3-6.6L6 18z" fill="currentColor"/>',
  playerA: '<circle cx="12" cy="12" r="8" fill="#c62828" stroke="#fff" stroke-width="1.5"/><text x="12" y="16" font-size="10" text-anchor="middle" fill="#fff" font-family="Arial" font-weight="700">A</text>',
  playerB: '<circle cx="12" cy="12" r="8" fill="#1565c0" stroke="#fff" stroke-width="1.5"/><text x="12" y="16" font-size="10" text-anchor="middle" fill="#fff" font-family="Arial" font-weight="700">B</text>',
  ball: '<ellipse cx="12" cy="12" rx="8" ry="5" transform="rotate(-30 12 12)" fill="#fafafa" stroke="#3e2723" stroke-width="1.5"/>',
  cone: '<polygon points="12,4 19,19 5,19" fill="#ff8f00" stroke="#4e2600"/>',
  pole: '<line x1="9" y1="21" x2="9" y2="3" stroke="#fdd835" stroke-width="2.5"/><polygon points="9,3 19,6.5 9,10" fill="#e53935"/>',
  shield: '<rect x="4" y="8" width="16" height="8" rx="2.5" fill="#37474f" stroke="#ffd600" stroke-width="1.5"/>',
  text: '<text x="12" y="18" font-size="17" text-anchor="middle" font-family="Arial" font-weight="700" fill="currentColor">T</text>',
  run: '<line x1="3" y1="19" x2="17" y2="7" stroke="currentColor" stroke-width="2.5"/><polygon points="21,4 13,6 18,11" fill="currentColor"/>',
  pass: '<line x1="3" y1="19" x2="17" y2="7" stroke="currentColor" stroke-width="2.5" stroke-dasharray="4 3"/><polygon points="21,4 13,6 18,11" fill="currentColor"/>',
  kick: '<path d="M3 20 Q5 5 18 6" stroke="currentColor" stroke-width="2.5" fill="none" stroke-dasharray="0.1 4" stroke-linecap="round"/><polygon points="22,6 15,2 15,10" fill="currentColor"/>',
  move: '<line x1="3" y1="19" x2="17" y2="7" stroke="currentColor" stroke-width="2" stroke-dasharray="5 2 1 2"/><polygon points="21,4 13,6 18,11" fill="currentColor"/>',
  pen: '<path d="M4 20l1-5L16 4l4 4L9 19z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14 6l4 4" stroke="currentColor" stroke-width="2"/>',
  eraser: '<path d="M3 16l9-9 7 7-6 6H7z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 11l7 7" stroke="currentColor" stroke-width="2"/>',
};
const ic = (name) => h('span.ico', { html: `<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">${ICONS[name]}</svg>` });

const TOOLS = [
  { id: 'select', label: 'Seleziona / sposta', short: 'Sposta' },
  { id: 'playerA', label: 'Giocatore squadra A', short: 'Squadra A', place: 'player', opts: { team: 'A' } },
  { id: 'playerB', label: 'Giocatore squadra B', short: 'Squadra B', place: 'player', opts: { team: 'B' } },
  { id: 'ball', label: 'Palla', short: 'Palla', place: 'ball' },
  { id: 'cone', label: 'Cono', short: 'Cono', place: 'cone' },
  { id: 'pole', label: 'Paletto / bandierina', short: 'Paletto', place: 'pole' },
  { id: 'shield', label: 'Scudo da placcaggio', short: 'Scudo', place: 'shield' },
  { id: 'text', label: 'Testo', short: 'Testo', place: 'text' },
  { id: 'run', label: 'Freccia corsa (continua)', short: 'Corsa', line: 'run' },
  { id: 'pass', label: 'Freccia passaggio (tratteggiata)', short: 'Passaggio', line: 'pass' },
  { id: 'kick', label: 'Freccia calcio (curva, punteggiata)', short: 'Calcio', line: 'kick' },
  { id: 'move', label: 'Movimento senza palla', short: 'Movimento', line: 'move' },
  { id: 'pen', label: 'Mano libera', short: 'Penna' },
  { id: 'eraser', label: 'Gomma (tocca per eliminare)', short: 'Gomma' },
];

const PEN_COLORS = ['#111111', '#ffeb3b', '#ffffff', '#e53935', '#1e88e5'];

export function svgToPngDataUrl(svgString, width, height) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svgString], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = width; c.height = height;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#1b5e20';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/png'));
      } catch (e) { reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Impossibile creare la miniatura')); };
    img.src = url;
  });
}

export async function boardThumbnail(board) {
  const { width, height } = exportSize(board, THUMB_PX);
  return svgToPngDataUrl(renderSVG(board, { pxWidth: THUMB_PX }), width, height);
}

// Apre l'editor. Restituisce: { board } se salvato, { removed: true } se il disegno è stato eliminato, null se annullato.
export function openBoardEditor(drawing, { title = 'Tactic Board' } = {}) {
  return new Promise((resolve) => {
    let board = B.normalizeBoard(drawing ? JSON.parse(JSON.stringify(drawing)) : B.newBoard());
    delete board.thumb;
    const history = new B.History(board);
    let tool = 'select';
    let selectedId = null;
    let penColor = '#111111';
    let penWidth = 1;
    let gesture = null; // gesto del puntatore in corso
    // Orientamento di VISUALIZZAZIONE: su schermo verticale (telefono) il campo viene mostrato in verticale
    // per usare tutto lo spazio; non cambia l'orientamento salvato (miniatura e documento Word).
    let viewMode = 'auto'; // 'auto' | 'horizontal' | 'vertical'
    let temp = null;    // elemento provvisorio (freccia o tratto in disegno)

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'board-svg');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Area di disegno');

    const undoBtn = h('button.btn', { type: 'button', title: 'Annulla (Ctrl+Z)', 'aria-label': 'Annulla ultima azione', on: { click: () => undo() } }, '↶ Annulla');
    const redoBtn = h('button.btn', { type: 'button', title: 'Ripeti (Ctrl+Y)', 'aria-label': 'Ripeti', on: { click: () => redo() } }, '↷ Ripeti');
    const toolbar = h('div.board-tools', { role: 'toolbar', 'aria-label': 'Strumenti' });
    const ctxBar = h('div.board-ctx');
    const overlay = h('div.board-overlay', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div.board-top',
        h('button.btn', { type: 'button', on: { click: () => cancel() } }, '✕ Chiudi'),
        h('strong.board-title', title),
        h('div.board-top-actions', undoBtn, redoBtn,
          h('button.btn', { type: 'button', title: 'Ruota la vista (non cambia il disegno salvato)', 'aria-label': 'Ruota vista', on: { click: () => {
            const cur = viewField().orientation;
            viewMode = cur === 'vertical' ? 'horizontal' : 'vertical';
            draw();
          } } }, '⟲ Vista'),
          h('button.btn', { type: 'button', on: { click: () => fieldPanel() } }, '⚙ Campo'),
          h('button.btn.primary', { type: 'button', on: { click: () => save() } }, '✓ Salva'))),
      h('div.board-main', toolbar, h('div.board-stage', svg)),
      ctxBar,
    );

    for (const t of TOOLS) {
      toolbar.appendChild(h('button.tool', { type: 'button', title: t.label, 'aria-label': t.label, dataset: { tool: t.id },
        on: { click: () => setTool(t.id) } }, ic(t.id), h('span.tool-label', t.short)));
    }

    function setTool(id) {
      tool = id;
      if (id !== 'select') selectedId = null;
      for (const b of toolbar.children) b.classList.toggle('on', b.dataset.tool === id);
      draw();
    }

    function commit() {
      history.push(board);
      updateButtons();
    }
    function updateButtons() {
      undoBtn.disabled = !history.canUndo();
      redoBtn.disabled = !history.canRedo();
    }
    function undo() { const s = history.undo(); if (s) { board = s; selectedId = null; draw(); } updateButtons(); }
    function redo() { const s = history.redo(); if (s) { board = s; selectedId = null; draw(); } updateButtons(); }

    function viewField() {
      const f = board.field;
      if (viewMode !== 'auto') return { ...f, orientation: viewMode };
      const st = svg.parentElement;
      const r = st ? st.getBoundingClientRect() : { width: 1, height: 0 };
      if (!r.width || !r.height) return f;
      const e = B.fieldExtent(f);
      const long = e.x1 - e.x0 >= e.y1 - e.y0;
      const stagePortrait = r.height > r.width * 1.15;
      const stageLandscape = r.width > r.height * 1.15;
      if (stagePortrait) return { ...f, orientation: long ? 'vertical' : 'horizontal' };
      if (stageLandscape) return { ...f, orientation: long ? 'horizontal' : 'vertical' };
      return f;
    }
    const viewBoard = () => ({ ...board, field: viewField() });
    function draw() {
      const vb = viewBoard();
      svg.setAttribute('viewBox', boardViewBox(vb));
      // su schermi piccoli le pedine vengono disegnate più grandi (solo a video: il disegno salvato non cambia)
      const st = svg.parentElement ? svg.parentElement.getBoundingClientRect() : { width: 1000, height: 1000 };
      const short = Math.min(st.width || 1000, st.height || 1000);
      const uScale = short < 420 ? 1.35 : short < 560 ? 1.15 : 1;
      svg.innerHTML = renderContent(vb, { selectedId, interactive: true, uScale, extraItems: temp ? [temp] : [] });
      renderCtx();
    }

    function renderCtx() {
      clear(ctxBar);
      const sel = selectedId ? B.findItem(board, selectedId) : null;
      if (tool === 'pen') {
        ctxBar.append(h('span.ctx-label', 'Colore'), ...PEN_COLORS.map((c) => h('button.swatch' + (c === penColor ? '.on' : ''), {
          type: 'button', style: { background: c }, 'aria-label': 'Colore ' + c, on: { click: () => { penColor = c; renderCtx(); } } })),
        h('span.ctx-label', 'Spessore'), ...[1, 2, 3].map((w) => h('button.btn.small' + (w === penWidth ? '.on' : ''), {
          type: 'button', on: { click: () => { penWidth = w; renderCtx(); } } }, ['Sottile', 'Medio', 'Spesso'][w - 1])));
        return;
      }
      if (!sel) {
        ctxBar.append(h('span.ctx-hint', tool === 'select' ? 'Tocca un elemento per selezionarlo e trascinarlo.' : TOOLS.find((t) => t.id === tool).label + ': tocca o trascina sul campo.'),
          h('button.btn.small', { type: 'button', on: { click: exportPng } }, 'Scarica immagine'),
          h('button.btn.small', { type: 'button', on: { click: exportJson } }, 'Salva disegno su file'),
          h('button.btn.small', { type: 'button', on: { click: importJson } }, 'Apri disegno da file'),
          h('button.btn.small.danger', { type: 'button', on: { click: clearAll } }, 'Cancella tutto'));
        return;
      }
      const act = (label, fn, cls = '') => h('button.btn.small' + cls, { type: 'button', on: { click: fn } }, label);
      if (sel.type === 'player') ctxBar.append(act('Numero/etichetta', () => editLabel(sel)), act('Cambia squadra', () => { sel.team = sel.team === 'A' ? 'B' : 'A'; commit(); draw(); }));
      if (sel.type === 'text') ctxBar.append(act('Modifica testo', () => editLabel(sel)));
      if (sel.type !== 'line') {
        ctxBar.append(
          act('＋ Ingrandisci', () => { B.scaleItem(sel, 1.25); commit(); draw(); }),
          act('－ Riduci', () => { B.scaleItem(sel, 0.8); commit(); draw(); }));
      }
      if (B.ROTATABLE.includes(sel.type)) ctxBar.append(act('↻ Ruota', () => { B.rotateItem(sel, sel.type === 'text' ? 15 : 45); commit(); draw(); }));
      if (sel.type === 'line') {
        ctxBar.append(...Object.entries(B.LINE_STYLES).map(([k, v]) => act(v.label, () => {
          sel.style = k;
          if (B.LINE_STYLES[k].curved && !sel.control) sel.control = B.defaultControl(sel.points[0], sel.points[1]);
          commit(); draw();
        }, sel.style === k ? '.on' : '')));
        ctxBar.append(act(sel.control ? 'Rendi dritta' : 'Rendi curva', () => {
          if (sel.control) delete sel.control; else sel.control = B.defaultControl(sel.points[0], sel.points[1]);
          commit(); draw();
        }));
      }
      ctxBar.append(
        act('Duplica', () => { const d = B.duplicateItem(sel, board.items); board.items.push(d); selectedId = d.id; commit(); draw(); }),
        act('In primo piano', () => { B.bringToFront(board, sel.id); commit(); draw(); }),
        act('In fondo', () => { B.sendToBack(board, sel.id); commit(); draw(); }),
        act('Elimina', () => { B.removeItemById(board, sel.id); selectedId = null; commit(); draw(); }, '.danger'),
      );
    }

    async function editLabel(item) {
      const v = await promptDialog(item.type === 'text' ? 'Testo' : 'Numero o etichetta del giocatore', item.type === 'text' ? item.text : item.label);
      if (v === null) return;
      if (item.type === 'text') { if (!v.trim()) B.removeItemById(board, item.id); else item.text = v; } else item.label = v.slice(0, 4);
      commit(); draw();
    }

    async function exportPng() {
      const url = await boardThumbnail(board);
      const blob = await (await fetch(url)).blob();
      downloadBlob(blob, (title || 'disegno').replace(/[\\/:*?"<>|]+/g, '-') + '.png');
    }
    function exportJson() {
      downloadBlob(new Blob([JSON.stringify(board, null, 2)], { type: 'application/json' }), (title || 'disegno').replace(/[\\/:*?"<>|]+/g, '-') + '.json');
    }
    async function importJson() {
      const f = await pickFile();
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        board = B.normalizeBoard(data.items ? data : data.drawing || data);
        delete board.thumb;
        selectedId = null; commit(); draw();
      } catch (e) { toast('File di disegno non valido', 'error'); }
    }

    async function clearAll() {
      if (!board.items.length) return;
      if (await confirmDialog('Cancellare tutti gli elementi del disegno?', { okText: 'Cancella tutto', danger: true })) {
        board.items = []; selectedId = null; commit(); draw();
      }
    }

    function fieldPanel() {
      const f = board.field;
      const apply = () => { draw(); };
      const num = (key, label, min, max) => {
        const el = h('input.input.num', { type: 'number', inputmode: 'decimal', min, max, step: key === 'gridStep' ? 0.5 : 1, value: f[key], 'aria-label': label });
        el.addEventListener('input', () => { const v = parseFloat(el.value); if (Number.isFinite(v) && v >= min && v <= max) { f[key] = v; apply(); } });
        return h('label.field', h('span.field-label', label), el);
      };
      const typeSel = h('div.choice', Object.entries(B.FIELD_TYPES).map(([k, v]) => h('button.choice-btn' + (f.type === k ? '.on' : ''), {
        type: 'button', on: { click: (e) => { f.type = k; for (const b of typeSel.children) b.classList.toggle('on', b === e.currentTarget); apply(); } } }, v.label)));
      const orSel = h('div.choice', [['horizontal', 'Orizzontale'], ['vertical', 'Verticale']].map(([k, l]) => h('button.choice-btn' + (f.orientation === k ? '.on' : ''), {
        type: 'button', on: { click: (e) => { f.orientation = k; viewMode = k; for (const b of orSel.children) b.classList.toggle('on', b === e.currentTarget); apply(); } } }, l)));
      const presets = h('div.choice.wrap', B.FIELD_PRESETS.map((p) => h('button.choice-btn', { type: 'button', on: { click: async () => {
        Object.assign(f, { type: p.type, length: p.length, width: p.width, inGoal: p.inGoal });
        dlgClose(); apply(); commit(); fieldPanel();
      } } }, p.label)));
      let dlgClose = () => {};
      const content = h('div.field-panel',
        h('h3', 'Tipo di sfondo'), typeSel,
        h('h3', 'Orientamento'), orSel,
        h('h3', 'Dimensioni (metri)'),
        h('div.grid2', num('length', 'Lunghezza (area di gioco)', 5, 120), num('width', 'Larghezza', 5, 80), num('inGoal', 'Area di meta', 0, 22), num('gridStep', 'Passo griglia', 0.5, 20)),
        h('p.hint', 'Le dimensioni del minirugby variano per categoria: usa un modello e correggi i valori.'),
        h('h3', 'Modelli'), presets,
      );
      const p = modal({ title: 'Campo', content, actions: [{ label: 'Fatto', value: true, primary: true }] });
      dlgClose = () => { const d = document.querySelector('dialog.modal'); if (d && d._close) d._close(true); };
      p.then(() => { commit(); draw(); });
    }

    // ----- Pointer Events -----
    function toField(e) {
      const ctm = svg.getScreenCTM();
      if (!ctm) return [0, 0];
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
      const [x, y] = B.fromView(viewField(), p.x, p.y);
      return [B.round(x), B.round(y)];
    }
    const hitId = (el) => el && el.closest && el.closest('[data-id]') ? el.closest('[data-id]').dataset.id : null;

    svg.addEventListener('pointerdown', (e) => {
      if (gesture) return; // un solo puntatore alla volta (evita tocchi del palmo)
      if (e.button && e.button !== 0) return;
      e.preventDefault();
      const p = toField(e);
      const t = TOOLS.find((x) => x.id === tool);
      const handle = e.target.closest && e.target.closest('[data-handle]');
      const id = hitId(e.target);
      svg.setPointerCapture(e.pointerId);
      if (tool === 'select' || (t.place && id)) {
        if (handle && selectedId) { gesture = { kind: 'handle', id: selectedId, handle: handle.dataset.handle, pid: e.pointerId, moved: false }; return; }
        if (id) {
          selectedId = id;
          gesture = { kind: 'move', id, last: p, pid: e.pointerId, moved: false };
          if (tool !== 'select') setTool('select');
          draw();
          return;
        }
        selectedId = null; draw();
        return;
      }
      if (t.place) {
        if (t.place === 'text') {
          gesture = null;
          promptDialog('Testo da inserire', '').then((txt) => {
            if (txt && txt.trim()) { const it = B.createItem('text', p[0], p[1], { text: txt.trim() }); board.items.push(it); selectedId = it.id; commit(); setTool('select'); }
          });
          return;
        }
        const it = B.createItem(t.place, p[0], p[1], t.opts || {}, board.items);
        board.items.push(it);
        gesture = { kind: 'move', id: it.id, last: p, pid: e.pointerId, moved: true };
        draw();
        return;
      }
      if (t.line) {
        temp = B.createLine(t.line, p, p, {});
        gesture = { kind: 'line', pid: e.pointerId };
        draw();
        return;
      }
      if (tool === 'pen') {
        temp = { id: 'tmp', type: 'free', points: [p], color: penColor, width: penWidth };
        gesture = { kind: 'pen', pid: e.pointerId };
        draw();
        return;
      }
      if (tool === 'eraser') {
        gesture = { kind: 'erase', pid: e.pointerId, erased: false };
        if (id) { B.removeItemById(board, id); gesture.erased = true; draw(); }
      }
    });

    svg.addEventListener('pointermove', (e) => {
      if (!gesture || e.pointerId !== gesture.pid) return;
      e.preventDefault();
      const p = toField(e);
      if (gesture.kind === 'move') {
        const it = B.findItem(board, gesture.id);
        if (!it) return;
        const dx = p[0] - gesture.last[0], dy = p[1] - gesture.last[1];
        if (!gesture.moved && Math.hypot(dx, dy) < B.unit(board.field) * 0.15) return;
        B.translateItem(it, dx, dy);
        gesture.last = p; gesture.moved = true;
        draw();
      } else if (gesture.kind === 'handle') {
        const it = B.findItem(board, gesture.id);
        if (!it) return;
        if (gesture.handle === 'c') it.control = p; else it.points[Number(gesture.handle)] = p;
        gesture.moved = true;
        draw();
      } else if (gesture.kind === 'line') {
        temp.points[1] = p;
        if (temp.control) temp.control = B.defaultControl(temp.points[0], p);
        draw();
      } else if (gesture.kind === 'pen') {
        const last = temp.points[temp.points.length - 1];
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) > B.unit(board.field) * 0.08) { temp.points.push(p); draw(); }
      } else if (gesture.kind === 'erase') {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const id = hitId(el);
        if (id) { B.removeItemById(board, id); gesture.erased = true; draw(); }
      }
    });

    const endGesture = (e) => {
      if (!gesture || e.pointerId !== gesture.pid) return;
      const g = gesture;
      gesture = null;
      try { svg.releasePointerCapture(e.pointerId); } catch { /* già rilasciato */ }
      if (g.kind === 'line') {
        const [a, b] = temp.points;
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) >= B.unit(board.field) * 0.8) {
          const line = B.createLine(temp.style, a, b, {});
          board.items.push(line);
          commit();
        }
        temp = null; draw();
      } else if (g.kind === 'pen') {
        if (temp.points.length > 1) { board.items.push(B.createFree(temp.points, { color: temp.color, width: temp.width })); commit(); }
        temp = null; draw();
      } else if ((g.kind === 'move' || g.kind === 'handle') && g.moved) {
        commit(); draw();
      } else if (g.kind === 'erase' && g.erased) {
        commit();
      }
    };
    svg.addEventListener('pointerup', endGesture);
    svg.addEventListener('pointercancel', (e) => { if (gesture && gesture.pid === e.pointerId) { temp = null; gesture = null; board = history.current(); draw(); } });
    svg.addEventListener('dblclick', (e) => {
      const id = hitId(e.target);
      const it = id && B.findItem(board, id);
      if (it && (it.type === 'player' || it.type === 'text')) editLabel(it);
    });

    const onKey = (e) => {
      if (document.querySelector('dialog[open]')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && !/input|textarea/i.test(e.target.tagName)) {
        e.preventDefault(); B.removeItemById(board, selectedId); selectedId = null; commit(); draw();
      } else if (e.key === 'Escape') { selectedId = null; draw(); }
    };
    document.addEventListener('keydown', onKey);

    const onResize = () => { if (viewMode === 'auto') draw(); };
    window.addEventListener('resize', onResize);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.classList.add('board-open'); // i messaggi vanno in alto, non sopra gli strumenti
    document.body.appendChild(overlay);
    setTool('select');
    updateButtons();

    function close(result) {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      document.body.classList.remove('board-open');
      overlay.remove();
      document.body.style.overflow = prevOverflow;
      resolve(result);
    }
    async function cancel() {
      if (history.canUndo() && !(await confirmDialog('Chiudere senza salvare le modifiche al disegno?', { okText: 'Chiudi senza salvare', danger: true }))) return;
      close(null);
    }
    async function save() {
      selectedId = null;
      if (!board.items.length && drawing) {
        if (await confirmDialog('Il disegno è vuoto. Vuoi eliminarlo dalla scheda?', { okText: 'Elimina disegno', danger: true })) { close({ removed: true }); }
        return;
      }
      try {
        const out = JSON.parse(JSON.stringify(board));
        out.updatedAt = new Date().toISOString();
        out.thumb = await boardThumbnail(out);
        close({ board: out });
      } catch (e) {
        toast('Errore nel salvataggio del disegno: ' + e.message, 'error');
      }
    }
  });
}
