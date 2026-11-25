// Componenti condivisi tra le viste.
import { h, clear, debounce, modal, toast, downloadBlob, confirmDialog } from '../ui.js';
import * as repo from '../repo.js';
import * as sync from '../app-sync.js';
import { openBoardEditor } from '../board/editor.js';
import { safeThumb } from '../board/model.js';
import { recordTitle, sortCategories, normName, exerciseFromRow, deepClone } from '../model.js';
import { buildDocxFiles, loadDocx } from '../artifacts.js';
import { shareOrDownload } from '../share.js';

// ---------- eliminazione: messaggio chiaro, dialog dell'app ----------
export const DRIVE_TRASH_MSG = 'Elimina dal telefono e da Google Drive? Su Drive finirà nel cestino (recuperabile per 30 giorni).';
export function deleteMessage(what) {
  return sync.state.configured && sync.state.folder ? `${what}: ${DRIVE_TRASH_MSG}` : `${what}: eliminare definitivamente dal telefono?`;
}
export function confirmDelete(what) {
  return confirmDialog(deleteMessage(what), { okText: 'Elimina', danger: true, title: 'Elimina', focusCancel: true });
}

// ---------- autosave (R7) ----------
const active = new Set();
export function flushAll() { for (const a of active) a.flush(); }

export function autosaver(rec, { delay = 500, onSaved } = {}) {
  let dirty = false;
  const pill = statusPill(rec.kind, rec.id);
  const doSave = debounce(async () => {
    dirty = false;
    try {
      await repo.save(rec);
      onSaved && onSaved(rec);
    } catch (e) {
      toast('Errore nel salvataggio locale: ' + e.message, 'error', 6000);
    }
  }, delay);
  const api = {
    pill,
    // un elemento di esempio modificato dall'utente diventa suo (non verrà eliminato con "Elimina esempi")
    changed() { if (rec.example) rec.example = false; dirty = true; pill.setUnsaved(); doSave(); },
    flush() { if (dirty) doSave.flush(); },
    isDirty() { return dirty; },
    dispose() { api.flush(); active.delete(api); },
  };
  active.add(api);
  return api;
}

export function statusPill(kind, id) {
  const el = h('span.status-pill.local', { role: 'status', 'aria-live': 'polite' }, 'Salvato sul telefono');
  let unsaved = false;
  const show = (lab) => { el.className = 'status-pill ' + lab.cls; el.textContent = lab.text; el.title = lab.title || ''; };
  let wasConnected = false;
  const refresh = async () => {
    if (el.isConnected) wasConnected = true;
    else if (wasConnected) { off(); return; } // la pagina è stata chiusa
    if (unsaved) return;
    show(sync.statusLabel(await sync.getStatus(kind, id)));
  };
  const onSaved = (e) => { if (e.detail.id === id) { unsaved = false; refresh(); } };
  const onEntry = (e) => { if (e.detail && e.detail.id === id) refresh(); };
  const onState = () => refresh();
  repo.bus.addEventListener('saved', onSaved);
  repo.bus.addEventListener('sync-entry', onEntry);
  repo.bus.addEventListener('sync-state', onState);
  const off = () => {
    repo.bus.removeEventListener('saved', onSaved);
    repo.bus.removeEventListener('sync-entry', onEntry);
    repo.bus.removeEventListener('sync-state', onState);
  };
  el.setUnsaved = () => { unsaved = true; el.className = 'status-pill unsaved'; el.textContent = 'Salvo…'; };
  setTimeout(refresh, 0);
  requestAnimationFrame(() => setTimeout(refresh, 50));
  return el;
}

// ---------- intestazione pagina ----------
export function pageHeader(title, { sub, actions = [], back } = {}) {
  return h('header.page-head',
    h('div.page-head-main',
      back ? h('a.btn.back', { href: back, 'aria-label': 'Indietro' }, '← Indietro') : null,
      h('div', h('h1.page-title', title), sub ? h('p.page-sub', sub) : null)),
    actions.length ? h('div.page-actions', actions) : null);
}

// ---------- azioni documento: Condividi (Word) + menu "Altro" ----------
export async function shareDocs(rec, { title } = {}) {
  const docx = await loadDocx();
  const files = await buildDocxFiles(docx, rec);
  if (!files.length) { toast('Niente da condividere.', 'info'); return null; }
  const res = await shareOrDownload(files, { title: title || files[0].name.replace(/\.docx$/, ''), download: (blob, name) => downloadBlob(blob, name) });
  if (res === 'downloaded') toast(files.length > 1 ? 'Documenti Word scaricati.' : 'Documento Word scaricato.', 'ok');
  return res;
}

export function shareButton(rec, saver, { label = '↗ Condividi', cls = '.primary' } = {}) {
  const btn = h('button.btn.share-btn' + cls, { type: 'button', on: { click: async () => {
    saver && saver.flush();
    btn.disabled = true;
    try { await shareDocs(typeof rec === 'function' ? await rec() : rec); } catch (e) { toast('Non è stato possibile preparare il documento: ' + e.message, 'error', 6000); } finally { btn.disabled = false; }
  } } }, label);
  return btn;
}

// Menu a tendina semplice (details/summary): tiene nascoste le azioni secondarie
export function moreMenu(items, { label = '⋯ Altro', ariaLabel = 'Altre azioni' } = {}) {
  const menu = h('details.more-menu', h('summary.btn', { role: 'button', 'aria-label': ariaLabel, title: ariaLabel }, label), h('div.more-list', items.filter(Boolean)));
  menu.addEventListener('click', (e) => { if (e.target.closest('.more-list button, .more-list a')) menu.open = false; });
  document.addEventListener('click', (e) => { if (menu.open && !menu.contains(e.target)) menu.open = false; });
  return menu;
}

export function docActions(rec, saver) {
  const wordBtn = h('button.btn', { type: 'button', on: { click: async () => {
    saver.flush();
    try {
      const files = await buildDocxFiles(await loadDocx(), rec);
      for (const f of files) downloadBlob(f.data instanceof Blob ? f.data : new Blob([f.data]), f.name);
    } catch (e) { toast('Non è stato possibile creare il documento: ' + e.message, 'error', 6000); }
  } } }, '⬇ Scarica Word');
  const printBtn = h('button.btn', { type: 'button', on: { click: () => { saver.flush(); window.print(); } } }, '🖶 Stampa');
  const driveBtn = sync.state.configured && sync.state.folder ? h('button.btn', { type: 'button', on: { click: async () => {
    saver.flush();
    try {
      const sum = await sync.syncRecordNow(rec.kind, rec.id);
      if (sum && sum.errors) toast('Non salvato su Drive: riprovo da solo tra poco.', 'error', 6000);
      else if (sum && sum.skipped === 'offline') toast('Senza rete: si salva su Drive quando torna la connessione.', 'info');
      else toast('Salvato su Drive ✓', 'ok');
    } catch (e) { toast(sync.friendlyError(e), 'error', 6000); }
  } } }, '☁ Salva su Drive adesso') : null;
  return [shareButton(rec, saver), moreMenu([wordBtn, printBtn, driveBtn])];
}

// Pulsante "Fine" in fondo alla scheda: salva subito e torna all'elenco. È un gesto dell'utente, quindi se
// l'accesso a Drive è scaduto e c'è qualcosa da salvare lo rinnova qui (finestra Google che si chiude da sola).
export function finishButton(saver, { label = '✓ Fine', back = '#/' } = {}) {
  const btn = h('button.btn.primary.big.finish-btn', { type: 'button', on: { click: () => {
    // Tutto sincrono fino alla richiesta di accesso: su iPhone la finestra di Google si apre solo dentro il tocco
    const hadChanges = saver.isDirty();
    saver.flush();
    const st = sync.state;
    const needToken = st.configured && st.folder && navigator.onLine && !sync.hasToken() && (hadChanges || sync.pendingCount() > 0);
    if (needToken && !sync.googleReady()) { sync.preloadGoogle(); toast('Un attimo… tocca di nuovo per salvare anche su Drive.', 'info'); return; }
    const p = needToken ? sync.syncNow() : null;
    btn.disabled = true;
    location.hash = back;
    if (p) p.then(() => toast('Salvato su Drive ✓', 'ok'), (e) => toast('Salvato sul telefono. ' + sync.friendlyError(e), 'info', 5000));
    else { if (st.configured && st.folder) sync.runNow(); toast(st.configured && st.folder && navigator.onLine ? 'Salvato ✓' : 'Salvato sul telefono ✓', 'ok'); }
  } } }, label);
  return h('div.finish-row', btn);
}

// ---------- disegno (Tactic Board) in una cella ----------
export function drawingCell(row, onChange, { title = 'Disegno', compact = false } = {}) {
  const wrap = h('div.drawing-cell' + (compact ? '.compact' : ''));
  const render = () => {
    clear(wrap);
    if (row.drawing && safeThumb(row.drawing.thumb)) {
      wrap.append(h('button.thumb-btn', { type: 'button', 'aria-label': 'Modifica disegno ' + title, on: { click: edit } },
        h('img.thumb', { src: safeThumb(row.drawing.thumb), alt: 'Disegno: ' + title })));
    } else {
      wrap.append(h('button.btn.draw-btn', { type: 'button', on: { click: edit } }, '✎ Disegna'));
    }
  };
  async function edit() {
    const res = await openBoardEditor(row.drawing, { title: title || 'Tactic Board' });
    if (!res) return;
    row.drawing = res.removed ? null : res.board;
    render();
    onChange();
  }
  render();
  return wrap;
}

// ---------- scelta dalla libreria esercizi (R5) ----------
export async function pickExercise({ category } = {}) {
  const all = (await repo.list('exercise')).sort((a, b) => a.name.localeCompare(b.name, 'it'));
  const search = h('input.input', { type: 'search', placeholder: 'Cerca esercizio…', 'aria-label': 'Cerca esercizio' });
  const listEl = h('div.pick-list');
  const render = () => {
    clear(listEl);
    const q = normName(search.value);
    const items = all.filter((e) => !q || normName(e.name).includes(q) || (e.keywords || []).some((k) => normName(k).includes(q)));
    if (!items.length) listEl.append(h('p.empty', 'Nessun esercizio trovato. Crealo dalla Libreria o salva una riga con "Salva in libreria".'));
    for (const e of items) {
      listEl.append(h('button.pick-item', { type: 'button', on: { click: () => listEl.closest('dialog')._close(e) } },
        e.drawing && safeThumb(e.drawing.thumb) ? h('img.pick-thumb', { src: safeThumb(e.drawing.thumb), alt: '' }) : h('span.pick-thumb.none', '—'),
        h('span.pick-text', h('strong', e.name), h('small', [(e.categories || []).join(' '), e.durationMin ? e.durationMin + ' min' : '', e.example ? 'esempio' : ''].filter(Boolean).join(' · ')))));
    }
  };
  search.addEventListener('input', render);
  render();
  return modal({ title: 'Scegli dalla libreria esercizi', content: h('div', search, listEl), actions: [{ label: 'Annulla', value: null }], wide: true });
}

// Salva una riga esercizio nella libreria (crea o aggiorna l'esercizio collegato)
export async function saveRowToLibrary(row, { categories = [] } = {}) {
  if (!row.name || !row.name.trim()) { toast('Scrivi prima il nome dell\'esercizio.', 'info'); return null; }
  let ex = row.exerciseId ? await repo.get('exercise', row.exerciseId) : null;
  if (ex) {
    const ok = await confirmDialog(`Aggiornare l'esercizio "${ex.name}" nella libreria con i dati di questa riga?`, { okText: 'Aggiorna' });
    if (!ok) return null;
    const fresh = exerciseFromRow(row);
    Object.assign(ex, { name: fresh.name, description: fresh.description, objectives: fresh.objectives || ex.objectives,
      keywords: fresh.keywords.length ? fresh.keywords : ex.keywords, materials: fresh.materials || ex.materials,
      durationMin: fresh.durationMin ?? ex.durationMin, drawing: fresh.drawing || ex.drawing, example: false });
  } else {
    ex = exerciseFromRow(row, { categories: [...categories] });
  }
  await repo.save(ex);
  row.exerciseId = ex.id;
  toast(`"${ex.name}" salvato nella libreria.`, 'ok');
  return ex;
}

// ---------- rosa: nomi da inserire nei campi "individualmente (nomi)" (decisione 4) ----------
export async function rosterNames(categories) {
  const players = await repo.list('player');
  const cats = sortCategories(categories || []);
  const sel = cats.length ? players.filter((p) => cats.includes(p.category)) : players;
  return sel.sort((a, b) => a.name.localeCompare(b.name, 'it'));
}

export function nameChips(players, onPick) {
  if (!players.length) return h('p.hint', 'Suggerimento: inserisci i nomi nella Rosa per sceglierli con un tocco.');
  return h('div.name-chips', { 'aria-label': 'Nomi dalla rosa' }, players.map((p) => h('button.chip', { type: 'button', on: { click: () => onPick(p) } }, p.number ? `${p.number} ${p.name}` : p.name)));
}

export function insertName(textarea, obj, key, name, onChange) {
  const cur = obj[key] || '';
  const add = name + ': ';
  obj[key] = cur && !cur.endsWith('\n') ? cur + '\n' + add : cur + add;
  textarea.value = obj[key];
  textarea.dispatchEvent(new Event('input'));
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  onChange && onChange();
}

export function titleOf(rec) { return recordTitle(rec); }
export { deepClone };

// Apertura di una pagina appena creata: la pagina si prepara fuori schermo e poi cambia l'indirizzo,
// così compare già completa (niente schermata vuota mentre si leggono i dati). Il router registra il preparatore.
let preparer = null;
export function setPreparer(fn) { preparer = fn; }
export async function openPrepared(hash) {
  if (preparer) { try { await preparer(hash); } catch (e) { console.warn(e); } }
  location.hash = hash;
}
