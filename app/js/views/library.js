// Libreria esercizi/giochi riusabile (R5) con disegno Tactic Board (R10).
import { h, clear, textInput, numberInput, textArea, tagInput, categoryPicker, confirmDialog, toast } from '../ui.js';
import * as repo from '../repo.js';
import { newExercise, duplicateRecord, normName, visibleCategories, inMyCategories } from '../model.js';
import { autosaver, pageHeader, drawingCell, shareButton, confirmDelete, scopeFilter, matchScope, newScopeFrom, groupBadge, scopeBar, drawingSrc, moreMenu, recordMenuItems, viewHref, editHref, backFromEdit, finishButton, myCategories, hiddenByCategoryHint } from './common.js';
import * as sync from '../app-sync.js';

export async function libraryView(root, params, query) {
  const filters = { q: '', cat: query.get('cat') || '' };
  filters.scope = ((await repo.getSetting('prefs', {})) || {}).scopeFilter || 'all';
  if (filters.scope !== 'all' && filters.scope !== 'personal' && !sync.groupById(filters.scope)) filters.scope = 'all';
  const scopeBox = h('div.scope-box');
  const drawScope = () => { clear(scopeBox); const f = scopeFilter(filters.scope, async (v) => { filters.scope = v; const p = (await repo.getSetting('prefs', {})) || {}; await repo.setSetting('prefs', { ...p, scopeFilter: v }); drawScope(); render(); }); if (f) scopeBox.append(f); };
  const search = h('input.input', { type: 'search', placeholder: 'Cerca per nome o parola chiave…', 'aria-label': 'Cerca esercizio' });
  const mine = myCategories();
  const catSel = h('select.input', { 'aria-label': 'Categoria' }, h('option', { value: '' }, 'Tutte le categorie'), visibleCategories(mine, filters.cat).map((c) => h('option', { value: c, selected: c === filters.cat }, c)));
  const grid = h('div.ex-grid');
  const hiddenBox = h('div.hidden-box');
  const shareLib = shareButton(async () => ({ kind: 'library', id: 'all', exercises: (await repo.list('exercise')).sort((a, b) => String(a.name).localeCompare(String(b.name), 'it')) }), null, { label: '↗ Condividi la libreria', cls: '' });
  root.append(pageHeader('Libreria esercizi', { sub: 'Disegna un esercizio una volta e riusalo negli allenamenti.', actions: [shareLib] }),
    h('div.list-toolbar',
      h('button.btn.primary.big', { type: 'button', on: { click: async () => { const e = newExercise(); const gid = newScopeFrom(filters.scope); if (gid) e.groupId = gid; await repo.save(e); location.hash = editHref(e); } } }, '+ Nuovo esercizio'),
      h('div.filters', search, catSel)),
    scopeBox, grid, hiddenBox);
  drawScope();
  search.addEventListener('input', () => { filters.q = normName(search.value); render(); });
  catSel.addEventListener('change', () => { filters.cat = catSel.value; render(); });

  async function render() {
    const all = (await repo.list('exercise')).sort((a, b) => a.name.localeCompare(b.name, 'it'));
    const scoped = all.filter((e) => matchScope(e, filters.scope) &&
      (!filters.q || normName(e.name).includes(filters.q) || (e.keywords || []).some((k) => normName(k).includes(filters.q))));
    // categorie che non alleno (Impostazioni › Le mie categorie): nascoste, salvo se le cerco apposta col filtro
    const items = scoped.filter((e) => (filters.cat ? (e.categories || []).includes(filters.cat) : inMyCategories(e.categories, mine)));
    clear(grid); clear(hiddenBox);
    const hiddenN = filters.cat ? 0 : scoped.length - items.length;
    const hint = hiddenByCategoryHint(hiddenN, ['esercizio', 'esercizi']);
    if (hint) hiddenBox.append(hint);
    if (!items.length) grid.append(h('p.empty', !all.length ? 'La libreria è vuota.' : hiddenN && !filters.q ? 'Nessun esercizio nelle tue categorie.' : 'Nessun esercizio con questi filtri.'));
    for (const e of items) {
      grid.append(h('article.ex-card',
        h('a.ex-main', { href: viewHref(e) },
          drawingSrc(e.drawing) ? h('img.ex-thumb', { src: drawingSrc(e.drawing), alt: 'Disegno ' + e.name }) : h('div.ex-thumb.none', 'Nessun disegno'),
          h('strong', e.name || '(senza nome)'),
          h('small', [(e.categories || []).join(' '), e.durationMin ? e.durationMin + ' min' : ''].filter(Boolean).join(' · ') || ' ')),
        h('div.ex-foot', e.example ? h('span.badge.example', 'esempio') : null, groupBadge(e),
          moreMenu(recordMenuItems(e, { title: e.name || 'Esercizio senza nome', onDuplicated: () => render(), onDeleted: () => render() }), { label: '⋯' }))));
    }
  }
  await render();
  // novità ricevute da un altro dispositivo: la libreria si aggiorna da sola
  const onImported = () => { if (grid.isConnected) render(); };
  repo.bus.addEventListener('imported', onImported);
  return () => repo.bus.removeEventListener('imported', onImported);
}

export async function exerciseView(root, { id }) {
  const e = await repo.get('exercise', id);
  if (!e) { root.append(h('p.empty', 'Esercizio non trovato.'), h('a.btn', { href: '#/libreria' }, 'Torna alla libreria')); return; }
  const saver = autosaver(e);
  const changed = () => saver.changed();
  root.append(pageHeader(e.name || 'Nuovo esercizio', { back: backFromEdit(e), actions: [saver.pill,
    h('button.btn', { type: 'button', on: { click: async () => { saver.flush(); const d = duplicateRecord(e); await repo.save(d); location.hash = editHref(d); } } }, 'Duplica'),
    h('button.btn.danger', { type: 'button', on: { click: async () => {
      if (!(await confirmDelete(`Esercizio "${e.name || 'senza nome'}"`))) return;
      saver.dispose(); await repo.remove('exercise', e.id); toast('Esercizio eliminato.', 'ok'); location.hash = '#/libreria';
    } } }, 'Elimina')] }),
  scopeBar(e, saver) || '',
  h('div.sheet.exercise-form',
    e.example ? h('p.hint', 'Esercizio di esempio precaricato: completa descrizione, obiettivi e disegno.') : null,
    h('div.ex-form-grid',
      h('div.ex-form-left',
        h('label.field', h('span.field-label', 'Nome'), textInput(e, 'name', changed, { cls: 'big' })),
        h('label.field', h('span.field-label', 'Descrizione / regole'), textArea(e, 'description', changed, { rows: 4 })),
        h('label.field', h('span.field-label', 'Obiettivi'), textArea(e, 'objectives', changed)),
        h('div.field', h('span.field-label', 'Parole chiave'), tagInput(e, 'keywords', changed)),
        h('div.grid2',
          h('label.field', h('span.field-label', 'Materiale'), textArea(e, 'materials', changed, { placeholder: 'Palloni, coni, casacche, scudi…' })),
          h('label.field', h('span.field-label', 'Spazio'), textInput(e, 'space', changed, { placeholder: 'es. 20×15 m' }))),
        h('div.grid2',
          h('label.field', h('span.field-label', 'Durata tipica (min)'), numberInput(e, 'durationMin', changed)),
          h('div.field', h('span.field-label', 'Categorie adatte'), categoryPicker(e, 'categories', changed, { categories: visibleCategories(myCategories(), e.categories) })))),
      h('div.ex-form-right',
        h('span.field-label', 'Disegno (Tactic Board)'),
        drawingCell(e, changed, { title: e.name || 'Esercizio' })))),
  finishButton(saver, { label: '✓ Fine', back: backFromEdit(e) }));
  return () => saver.dispose();
}
