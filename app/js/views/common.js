// Componenti condivisi tra le viste.
import { h, clear, debounce, modal, toast, downloadBlob, confirmDialog } from '../ui.js';
import * as repo from '../repo.js';
import * as sync from '../app-sync.js';
import { openBoardEditor } from '../board/editor.js';
import { safeThumb, safeAnim } from '../board/model.js';
import { recordTitle, sortCategories, normName, exerciseFromRow, deepClone, merge3, conflictCopy, sameRecordContent, scopeOf, authorName } from '../model.js';
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
  const sheet = ['session', 'match', 'plan'].includes(rec.kind);
  // ricezione da altri dispositivi mentre la scheda è aperta: base = versione caricata sullo schermo,
  // remote = versione arrivata (i campi che si stanno scrivendo non vengono mai toccati)
  let base = deepClone(rec);
  let remote = null;
  let copiedFor = null;
  let removedRemote = false;
  let closed = false;
  let knownFiles = {};
  let banner = null;
  if (sheet) {
    repo.setOpen(rec.kind, rec.id, true);
    sync.getStatus(rec.kind, rec.id).then((e) => { if (e && e.files) knownFiles = { ...e.files }; }).catch(() => {});
  }
  const localChanges = () => dirty || !sameRecordContent(rec, base);

  async function saveNow() {
    if (closed) return;
    if (removedRemote) { // si continua a scrivere su una scheda eliminata altrove: la si tiene
      removedRemote = false; hideBanner();
      await sync.reviveRecord(rec, knownFiles);
      return;
    }
    if (remote) {
      const { value, conflicts } = merge3(base, rec, remote.rec);
      if (conflicts && copiedFor !== remote.key) {
        copiedFor = remote.key;
        await repo.save(conflictCopy(remote.rec), { touch: false }); // la versione dell'altro dispositivo non si perde
        toast('Lo stesso campo era cambiato anche sull\'altro dispositivo: quella versione è tra le schede come copia.', 'info', 6000);
      }
      value.id = rec.id; value.kind = rec.kind;
      await repo.save(value);
      return;
    }
    await repo.save(rec);
  }
  const doSave = debounce(async () => {
    dirty = false;
    try {
      await saveNow();
      onSaved && onSaved(rec);
    } catch (e) {
      toast('Errore nel salvataggio locale: ' + e.message, 'error', 6000);
    }
  }, delay);

  function hideBanner() { if (banner) { banner.remove(); banner = null; } }
  function showBanner(text, actions) {
    hideBanner();
    banner = h('div.remote-banner', { role: 'status', 'aria-live': 'polite' }, h('span', text),
      h('span.remote-actions', actions.map(([label, fn, primary]) => h('button.btn.small' + (primary ? '.primary' : ''), { type: 'button', on: { click: fn } }, label))));
    document.body.append(banner);
  }
  const reload = () => { hideBanner(); window.dispatchEvent(new HashChangeEvent('hashchange')); };

  const onRemote = async (ev) => {
    const d = ev.detail || {};
    if (closed || d.kind !== rec.kind || d.id !== rec.id || !d.rec) return;
    if (sameRecordContent(rec, d.rec)) { if (sheet && d.version) await sync.noteRemoteVersion(rec.kind, rec.id, d.version, d.files); return; }
    remote = { rec: d.rec, key: d.version || d.rec.updatedAt };
    if (localChanges()) {
      // modifiche in corso: si uniscono subito campo per campo (quello che si sta scrivendo resta)
      if (doSave.pending()) doSave.flush(); else { await saveNow(); }
      if (sheet && d.version) await sync.noteRemoteVersion(rec.kind, rec.id, d.version, d.files);
    } else if (sheet && d.version) {
      await sync.acceptRemote(rec.kind, rec.id, d.rec, d.version, d.files, d.folderId);
    }
    const who = scopeOf(d.rec) && d.rec.updatedBy && (!sync.getMe() || d.rec.updatedBy.email !== sync.getMe().email) ? authorName(d.rec.updatedBy) : '';
    showBanner(who ? `${who} ha aggiornato questa scheda` : 'Questa scheda è stata aggiornata su un altro dispositivo', [['Aggiorna', () => { api.flush(); setTimeout(reload, 50); }, true]]);
  };
  const onRemoved = (ev) => {
    const d = ev.detail || {};
    if (closed || !d.remote || d.kind !== rec.kind || d.id !== rec.id) return;
    removedRemote = true;
    showBanner('Eliminata su un altro dispositivo', [
      ['Tienila', async () => { removedRemote = false; hideBanner(); dirty = false; await sync.reviveRecord(rec, knownFiles); toast('Scheda tenuta.', 'ok'); }, true],
      ['Chiudi', () => { hideBanner(); closed = true; location.hash = rec.kind === 'exercise' ? '#/libreria' : '#/'; }],
    ]);
  };
  const onEntry = (ev) => { const e = ev.detail; if (e && e.kind === rec.kind && e.id === rec.id && e.files && Object.keys(e.files).length) knownFiles = { ...e.files }; };
  repo.bus.addEventListener('remote-update', onRemote);
  repo.bus.addEventListener('removed', onRemoved);
  repo.bus.addEventListener('sync-entry', onEntry);

  const api = {
    pill,
    // un elemento di esempio modificato dall'utente diventa suo (non verrà eliminato con "Elimina esempi")
    changed() { if (closed) return; if (rec.example) rec.example = false; dirty = true; pill.setUnsaved(); doSave(); },
    flush() { if (dirty && !closed) doSave.flush(); },
    isDirty() { return dirty; },
    dispose() {
      if (!removedRemote) api.flush();
      closed = true;
      active.delete(api);
      hideBanner();
      repo.bus.removeEventListener('remote-update', onRemote);
      repo.bus.removeEventListener('removed', onRemoved);
      repo.bus.removeEventListener('sync-entry', onEntry);
      if (sheet) repo.setOpen(rec.kind, rec.id, false);
    },
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
    const toSave = hadChanges || sync.pendingCount() > 0;
    // accesso scaduto: il tocco lo rinnova anche solo per ricevere le novità dagli altri dispositivi
    const needToken = st.configured && st.folder && navigator.onLine && !sync.hasToken() && (toSave || sync.googleReady());
    if (needToken && !sync.googleReady()) { sync.preloadGoogle(); toast('Un attimo… tocca di nuovo per salvare anche su Drive.', 'info'); return; }
    const p = needToken ? sync.syncNow() : null;
    btn.disabled = true;
    location.hash = back;
    if (p) p.then(() => toast('Salvato su Drive ✓', 'ok'), (e) => toast('Salvato sul telefono. ' + sync.friendlyError(e), 'info', 5000));
    else { if (st.configured && st.folder) sync.runNow(); toast(st.configured && st.folder && navigator.onLine ? 'Salvato ✓' : 'Salvato sul telefono ✓', 'ok'); }
  } } }, label);
  return h('div.finish-row', btn);
}

// Immagine da mostrare per un disegno: l'azione animata (GIF) se c'è, l'immagine fissa se non c'è
// o se il telefono chiede di ridurre il movimento
export function drawingSrc(drawing) {
  if (!drawing) return null;
  const still = safeThumb(drawing.thumb);
  const anim = safeAnim(drawing.anim);
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return anim && (!reduce || !still) ? anim : still;
}

// ---------- disegno (Tactic Board) in una cella ----------
export function drawingCell(row, onChange, { title = 'Disegno', compact = false } = {}) {
  const wrap = h('div.drawing-cell' + (compact ? '.compact' : ''));
  const render = () => {
    clear(wrap);
    const src = drawingSrc(row.drawing);
    if (src) {
      wrap.append(h('button.thumb-btn', { type: 'button', 'aria-label': 'Modifica disegno ' + title, on: { click: edit } },
        h('img.thumb', { src, alt: 'Disegno: ' + title })));
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
        drawingSrc(e.drawing) ? h('img.pick-thumb', { src: drawingSrc(e.drawing), alt: '' }) : h('span.pick-thumb.none', '—'),
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

// ---------- gruppi: dove si trova un elemento, chi l'ha scritto, filtro rapido ----------
const KIND_WORDS = { session: 'questo allenamento', match: 'questa partita', plan: 'questo piano', exercise: 'questo esercizio', player: 'questo giocatore' };

// Avviso sui nomi dei minori, la prima volta che si condivide la rosa con un gruppo
export async function confirmRosterShare(gid) {
  const acks = (await repo.getSetting('rosterAck', {})) || {};
  if (acks[gid]) return true;
  const g = sync.groupById(gid);
  const ok = await confirmDialog(`La rosa contiene nomi di bambini e ragazzi. Nel gruppo "${g ? g.name : ''}" la vedranno e potranno modificarla tutti gli allenatori del gruppo. Condividi solo i dati che servono per l'allenamento (nome e numero).`, { okText: 'Ho capito, condividi', title: 'Nomi dei minori' });
  if (ok) await repo.setSetting('rosterAck', { ...acks, [gid]: new Date().toISOString() });
  return ok;
}

// Selettore "Dove si trova: Personale / <gruppo>" per un elemento aperto (solo se si è in almeno un gruppo)
export function scopeBar(rec, saver) {
  const groups = sync.activeGroups();
  const cur = scopeOf(rec);
  if (!groups.length && !cur) return null;
  const sel = h('select.input.scope-select', { 'aria-label': 'Dove si trova' },
    h('option', { value: '' }, 'Personale (solo tu)'),
    groups.map((g) => h('option', { value: g.id, selected: g.id === cur }, 'Gruppo ' + g.name)));
  if (cur && !groups.some((g) => g.id === cur)) sel.append(h('option', { value: cur, selected: true, disabled: true }, 'Gruppo non disponibile'));
  sel.addEventListener('change', async () => {
    const to = sel.value || null;
    const g = to ? sync.groupById(to) : sync.groupById(cur);
    const what = KIND_WORDS[rec.kind] || 'questo elemento';
    const msg = to ? `Spostare ${what} nel gruppo "${g ? g.name : ''}"? Lo vedranno e potranno modificarlo tutti gli allenatori del gruppo.`
      : `Togliere ${what} dal gruppo "${g ? g.name : ''}"? Sparirà agli altri allenatori del gruppo e resterà solo tuo.`;
    const ok = (await confirmDialog(msg, { okText: to ? 'Sposta nel gruppo' : 'Togli dal gruppo', title: 'Dove si trova' })) && (!to || rec.kind !== 'player' || await confirmRosterShare(to));
    if (!ok) { sel.value = cur || ''; return; }
    if (saver) saver.flush();
    await sync.moveRecord(rec.kind, rec.id, to);
    toast(to ? `Spostato nel gruppo "${g ? g.name : ''}".` : 'Ora è solo tuo.', 'ok');
    window.dispatchEvent(new HashChangeEvent('hashchange')); // la pagina si ricarica con la nuova posizione
  });
  const by = cur && rec.createdBy ? h('small.scope-by', 'di ' + authorName(rec.createdBy) + (rec.updatedBy && rec.updatedBy.email !== rec.createdBy.email ? ' · modificato da ' + authorName(rec.updatedBy) : '')) : null;
  return h('div.scope-bar', h('label.scope-label', h('span', 'Dove si trova'), sel), by);
}

// Riga "Gruppo X · di Marco" per le schede negli elenchi
export function groupBadge(rec) {
  const gid = scopeOf(rec);
  if (!gid) return null;
  const g = sync.groupById(gid);
  const by = rec.createdBy ? 'di ' + authorName(rec.createdBy) : '';
  return h('span.badge.group', { title: g ? 'Gruppo ' + g.name : '' }, [g ? g.name : 'Gruppo', by].filter(Boolean).join(' · '));
}

// Filtro rapido negli elenchi: Tutto / Personale / <gruppo> (solo se si è in almeno un gruppo)
export function scopeFilter(current, onChange) {
  const groups = sync.activeGroups();
  if (!groups.length) return null;
  const opts = [['all', 'Tutto'], ['personal', 'Personale'], ...groups.map((g) => [g.id, g.name])];
  return h('div.scope-filter', { role: 'group', 'aria-label': 'Mostra' }, opts.map(([v, label]) => h('button.chip' + (v === current ? '.on' : ''), {
    type: 'button', 'aria-pressed': String(v === current), on: { click: () => onChange(v) } }, label)));
}
export function matchScope(rec, filter) {
  if (!filter || filter === 'all') return true;
  return filter === 'personal' ? !scopeOf(rec) : scopeOf(rec) === filter;
}
// ambito per un elemento nuovo creato da un elenco filtrato
export const newScopeFrom = (filter) => (filter && filter !== 'all' && filter !== 'personal' && sync.groupById(filter) ? filter : null);
