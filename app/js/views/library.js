// Libreria esercizi/giochi riusabile (R5) con disegno Tactic Board (R10).
import { h, clear, textInput, numberInput, textArea, tagInput, categoryPicker, confirmDialog, toast } from '../ui.js';
import * as repo from '../repo.js';
import { CATEGORIES, newExercise, duplicateRecord, normName } from '../model.js';
import { autosaver, pageHeader, drawingCell, shareButton } from './common.js';
import { safeThumb } from '../board/model.js';

export async function libraryView(root, params, query) {
  const filters = { q: '', cat: query.get('cat') || '' };
  const search = h('input.input', { type: 'search', placeholder: 'Cerca per nome o parola chiave…', 'aria-label': 'Cerca esercizio' });
  const catSel = h('select.input', { 'aria-label': 'Categoria' }, h('option', { value: '' }, 'Tutte le categorie'), CATEGORIES.map((c) => h('option', { value: c, selected: c === filters.cat }, c)));
  const grid = h('div.ex-grid');
  const shareLib = shareButton(async () => ({ kind: 'library', id: 'all', exercises: (await repo.list('exercise')).sort((a, b) => String(a.name).localeCompare(String(b.name), 'it')) }), null, { label: '↗ Condividi la libreria', cls: '' });
  root.append(pageHeader('Libreria esercizi', { sub: 'Disegna un esercizio una volta e riusalo negli allenamenti.', actions: [shareLib] }),
    h('div.list-toolbar',
      h('button.btn.primary.big', { type: 'button', on: { click: async () => { const e = newExercise(); await repo.save(e); location.hash = '#/esercizio/' + e.id; } } }, '+ Nuovo esercizio'),
      h('div.filters', search, catSel)),
    grid);
  search.addEventListener('input', () => { filters.q = normName(search.value); render(); });
  catSel.addEventListener('change', () => { filters.cat = catSel.value; render(); });

  async function render() {
    const all = (await repo.list('exercise')).sort((a, b) => a.name.localeCompare(b.name, 'it'));
    const items = all.filter((e) => (!filters.cat || (e.categories || []).includes(filters.cat)) &&
      (!filters.q || normName(e.name).includes(filters.q) || (e.keywords || []).some((k) => normName(k).includes(filters.q))));
    clear(grid);
    if (!items.length) grid.append(h('p.empty', all.length ? 'Nessun esercizio con questi filtri.' : 'La libreria è vuota.'));
    for (const e of items) {
      grid.append(h('a.ex-card', { href: '#/esercizio/' + e.id },
        e.drawing && safeThumb(e.drawing.thumb) ? h('img.ex-thumb', { src: safeThumb(e.drawing.thumb), alt: 'Disegno ' + e.name }) : h('div.ex-thumb.none', 'Nessun disegno'),
        h('strong', e.name || '(senza nome)'),
        h('small', [(e.categories || []).join(' '), e.durationMin ? e.durationMin + ' min' : ''].filter(Boolean).join(' · ') || ' '),
        e.example ? h('span.badge.example', 'esempio') : null));
    }
  }
  await render();
}

export async function exerciseView(root, { id }) {
  const e = await repo.get('exercise', id);
  if (!e) { root.append(h('p.empty', 'Esercizio non trovato.'), h('a.btn', { href: '#/libreria' }, 'Torna alla libreria')); return; }
  const saver = autosaver(e);
  const changed = () => saver.changed();
  root.append(pageHeader(e.name || 'Nuovo esercizio', { back: '#/libreria', actions: [saver.pill,
    h('button.btn', { type: 'button', on: { click: async () => { saver.flush(); const d = duplicateRecord(e); await repo.save(d); location.hash = '#/esercizio/' + d.id; } } }, 'Duplica'),
    h('button.btn.danger', { type: 'button', on: { click: async () => {
      if (!(await confirmDialog(`Eliminare "${e.name}" dalla libreria? Le sedute che lo usano conservano la loro copia.`, { okText: 'Elimina', danger: true }))) return;
      saver.dispose(); await repo.remove('exercise', e.id); toast('Esercizio eliminato.', 'ok'); location.hash = '#/libreria';
    } } }, 'Elimina')] }),
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
          h('div.field', h('span.field-label', 'Categorie adatte'), categoryPicker(e, 'categories', changed)))),
      h('div.ex-form-right',
        h('span.field-label', 'Disegno (Tactic Board)'),
        drawingCell(e, changed, { title: e.name || 'Esercizio' })))));
  return () => saver.dispose();
}
