// Helper DOM e componenti di input pensati per l'uso a bordo campo (target >= 44px, N1/R6).
import { CATEGORIES } from './model.js';

export function h(tag, attrs, ...children) {
  const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(tag) || [];
  const el = document.createElement(m[1] || 'div');
  for (const part of (m[2] || '').match(/[.#][\w-]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1)); else el.id = part.slice(1);
  }
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { children.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export function debounce(fn, ms) {
  let t = null;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => { t = null; fn(...a); }, ms); };
  d.flush = (...a) => { if (t) { clearTimeout(t); t = null; fn(...a); } };
  d.pending = () => !!t;
  return d;
}

// ---------- feedback ----------

// Un messaggio alla volta (il nuovo sostituisce il precedente), breve
let toastBox = null;
export function toast(msg, type = 'info', ms = 2600) {
  if (!toastBox) { toastBox = h('div.toasts', { role: 'status', 'aria-live': 'polite' }); document.body.appendChild(toastBox); }
  clear(toastBox);
  const t = h('div.toast.toast-' + type, msg);
  toastBox.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, Math.min(ms, 5000));
}

export function modal({ title, content, actions = [{ label: 'Chiudi', value: null }], wide = false, className = '', focus }) {
  return new Promise((resolve) => {
    const dlg = h('dialog.modal' + (wide ? '.wide' : '') + (className ? '.' + className : ''), { 'aria-label': title || 'Finestra' });
    const close = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    const footer = h('div.modal-actions', actions.map((a) => h('button.btn' + (a.primary ? '.primary' : '') + (a.danger ? '.danger' : ''), {
      type: 'button', on: { click: () => close(typeof a.value === 'function' ? a.value() : a.value) },
    }, a.label)));
    dlg.append(
      title ? h('h2.modal-title', title) : null,
      h('div.modal-body', content),
      footer,
    );
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
    document.body.appendChild(dlg);
    dlg._close = close;
    dlg.showModal();
    // focus: primo campo, altrimenti il pulsante sicuro (Annulla) per le conferme pericolose, o il principale
    const first = dlg.querySelector('input:not([type=checkbox]), textarea, select');
    const btns = [...footer.querySelectorAll('button')];
    const target = first || (focus === 'cancel' ? btns[0] : btns.find((b) => b.classList.contains('primary') || b.classList.contains('danger')) || btns[btns.length - 1]);
    if (target) setTimeout(() => target.focus(), 30);
  });
}

export function confirmDialog(msg, { okText = 'Conferma', danger = false, title = 'Conferma', focusCancel = danger } = {}) {
  return modal({ title, content: h('p', msg), focus: focusCancel ? 'cancel' : 'ok',
    actions: [{ label: 'Annulla', value: false, cancel: true }, { label: okText, value: true, primary: !danger, danger }] });
}

export function promptDialog(title, value = '', { multiline = false, placeholder = '', okText = 'OK', label = '' } = {}) {
  const input = multiline ? h('textarea.input', { rows: 3, placeholder }) : h('input.input', { type: 'text', placeholder });
  input.value = value;
  if (!multiline) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.closest('dialog')._close(input.value); } });
  return modal({ title, content: h('label.field', label ? h('span.field-label', label) : null, input), actions: [{ label: 'Annulla', value: null }, { label: okText, primary: true, value: () => input.value }] });
}

// ---------- campi ----------

export function field(label, control, { hint, cls = '' } = {}) {
  return h('label.field' + (cls ? '.' + cls : ''), h('span.field-label', label), control, hint ? h('span.hint', hint) : null);
}

export function autoGrow(ta) {
  const fit = () => { ta.style.height = 'auto'; ta.style.height = Math.max(ta.scrollHeight + 2, 48) + 'px'; };
  ta.addEventListener('input', fit);
  requestAnimationFrame(fit);
  // ricalcola quando l'elemento diventa visibile (es. cambio di tab)
  if ('ResizeObserver' in window) {
    let w = 0;
    new ResizeObserver(() => { if (ta.offsetWidth !== w) { w = ta.offsetWidth; fit(); } }).observe(ta);
  }
  return ta;
}

export function textInput(obj, key, onChange, { type = 'text', placeholder = '', list, inputmode, label, cls = '' } = {}) {
  const el = h('input.input' + (cls ? '.' + cls : ''), { type, placeholder, list, inputmode, 'aria-label': label || undefined });
  el.value = obj[key] ?? '';
  el.addEventListener('input', () => { obj[key] = el.value; onChange && onChange(key, el.value); });
  return el;
}

export function numberInput(obj, key, onChange, { placeholder = '', label, min = 0, max } = {}) {
  const el = h('input.input.num', { type: 'number', inputmode: 'numeric', min, max, step: 1, placeholder, 'aria-label': label || undefined });
  el.value = obj[key] ?? '';
  el.addEventListener('input', () => {
    const v = el.value === '' ? null : Math.max(min, parseInt(el.value, 10));
    obj[key] = Number.isFinite(v) ? v : null;
    onChange && onChange(key, obj[key]);
  });
  return el;
}

export function textArea(obj, key, onChange, { placeholder = '', label, rows = 2, cls = '' } = {}) {
  const el = h('textarea.input.ta' + (cls ? '.' + cls : ''), { rows, placeholder, 'aria-label': label || undefined });
  el.value = obj[key] ?? '';
  el.addEventListener('input', () => { obj[key] = el.value; onChange && onChange(key, el.value); });
  return autoGrow(el);
}

// Scelta singola a pulsanti grandi; un secondo tap toglie la scelta (= non valutato)
export function choice(obj, key, options, onChange, { allowClear = true, cls = '', label = '' } = {}) {
  const wrap = h('div.choice' + (cls ? '.' + cls : ''), { role: 'radiogroup', 'aria-label': label || undefined });
  const render = () => {
    for (const b of wrap.children) {
      const on = String(obj[key]) === b.dataset.value;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    }
  };
  for (const o of options) {
    wrap.appendChild(h('button.choice-btn' + (o.cls ? '.' + o.cls : ''), {
      type: 'button', role: 'radio', dataset: { value: String(o.value) },
      on: { click: () => { obj[key] = allowClear && obj[key] === o.value ? null : o.value; render(); onChange && onChange(key, obj[key]); } },
    }, o.label));
  }
  render();
  return wrap;
}

export function yesNo(obj, key, onChange, { label = '' } = {}) {
  return choice(obj, key, [{ value: 'yes', label: 'Sì', cls: 'yes' }, { value: 'no', label: 'No', cls: 'no' }], onChange, { cls: 'yesno', label });
}

// Contatore +/- con tap grandi (scheda partita, decisione 6)
export function counter(getValue, setValue, onChange, { label = '' } = {}) {
  const out = h('span.counter-value', String(getValue()));
  const set = (v) => { setValue(Math.max(0, v)); out.textContent = String(getValue()); out.classList.remove('bump'); void out.offsetWidth; out.classList.add('bump'); onChange && onChange(); };
  return h('div.counter', { role: 'group', 'aria-label': label },
    h('button.counter-btn.minus', { type: 'button', 'aria-label': 'meno uno ' + label, on: { click: () => set(getValue() - 1) } }, '−'),
    out,
    h('button.counter-btn.plus', { type: 'button', 'aria-label': 'più uno ' + label, on: { click: () => set(getValue() + 1) } }, '+'),
  );
}

// Tag (parole chiave)
export function tagInput(obj, key, onChange, { placeholder = 'Aggiungi e premi Invio', label = 'Parole chiave' } = {}) {
  if (!Array.isArray(obj[key])) obj[key] = [];
  const wrap = h('div.tags', { 'aria-label': label });
  const input = h('input.tag-input', { type: 'text', placeholder, enterkeyhint: 'done', 'aria-label': label });
  const commit = () => {
    const parts = input.value.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
    if (!parts.length) return;
    for (const p of parts) if (!obj[key].includes(p)) obj[key].push(p);
    input.value = '';
    render(); onChange && onChange(key, obj[key]);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
    if (e.key === 'Backspace' && !input.value && obj[key].length) { obj[key].pop(); render(); onChange && onChange(key, obj[key]); }
  });
  input.addEventListener('blur', commit);
  const render = () => {
    clear(wrap);
    obj[key].forEach((t, i) => wrap.appendChild(h('span.tag', t, h('button.tag-x', { type: 'button', 'aria-label': 'Rimuovi ' + t,
      on: { click: () => { obj[key].splice(i, 1); render(); onChange && onChange(key, obj[key]); } } }, '×'))));
    wrap.appendChild(input);
  };
  render();
  return wrap;
}

// Categorie (scelta multipla o singola)
export function categoryPicker(obj, key, onChange, { multiple = true, categories = CATEGORIES, label = 'Categoria' } = {}) {
  const wrap = h('div.choice.cats', { role: multiple ? 'group' : 'radiogroup', 'aria-label': label });
  const isOn = (c) => multiple ? (obj[key] || []).includes(c) : obj[key] === c;
  const render = () => { for (const b of wrap.children) { const on = isOn(b.dataset.value); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); } };
  for (const c of categories) {
    wrap.appendChild(h('button.choice-btn', { type: 'button', dataset: { value: c }, on: { click: () => {
      if (multiple) {
        const arr = obj[key] || (obj[key] = []);
        const i = arr.indexOf(c);
        if (i >= 0) arr.splice(i, 1); else arr.push(c);
      } else obj[key] = obj[key] === c ? '' : c;
      render(); onChange && onChange(key, obj[key]);
    } } }, c));
  }
  render();
  return wrap;
}

export function rowControls({ index, length, onMove, onRemove, label = 'riga' }) {
  return h('div.row-controls',
    h('button.icon-btn', { type: 'button', title: 'Sposta su', 'aria-label': `Sposta su ${label} ${index + 1}`, disabled: index === 0, on: { click: () => onMove(-1) } }, '↑'),
    h('button.icon-btn', { type: 'button', title: 'Sposta giù', 'aria-label': `Sposta giù ${label} ${index + 1}`, disabled: index === length - 1, on: { click: () => onMove(1) } }, '↓'),
    h('button.icon-btn.danger', { type: 'button', title: 'Rimuovi', 'aria-label': `Rimuovi ${label} ${index + 1}`, on: { click: onRemove } }, '✕'),
  );
}

export function badge(text, cls = '') { return h('span.badge' + (cls ? '.' + cls : ''), text); }

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

export function pickFile(accept = '.json,application/json') {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept, style: { display: 'none' } });
    inp.addEventListener('change', () => { resolve(inp.files[0] || null); inp.remove(); });
    document.body.appendChild(inp);
    inp.click();
  });
}
