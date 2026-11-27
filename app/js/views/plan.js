// Obiettivi / programmazione trimestrale: obiettivi + sequenza di allenamenti fatti di blocchi.
import { h, clear, textInput, textArea, rowControls, confirmDialog, toast } from '../ui.js';
import * as repo from '../repo.js';
import {
  visibleCategories, BLOCK_TYPES, newBlock, templatePlanSession, newPlanSession, moveItem, removeItem, ordinalRoman,
  sessionFromPlanSession, findExerciseByName, deepClone, uid, sanitizeModules,
} from '../model.js';
import { autosaver, pageHeader, docActions, finishButton, openPrepared, scopeBar, backFromEdit, myCategories } from './common.js';

export async function planView(root, { id }) {
  const p = await repo.get('plan', id);
  if (!p) { root.append(h('p.empty', 'Piano non trovato.'), h('a.btn', { href: '#/' }, 'Torna alla home')); return; }
  const saver = autosaver(p);
  const changed = () => saver.changed();
  const exercises = (await repo.list('exercise')).sort((a, b) => a.name.localeCompare(b.name, 'it'));
  const dlId = 'dl-ex-' + p.id;
  const body = h('div.sheet.portrait');
  root.append(pageHeader('Obiettivi / piano trimestrale', { sub: [p.title, p.category, p.season].filter(Boolean).join(' — '), back: backFromEdit(p),
    actions: [saver.pill, ...docActions(p, saver)] }), scopeBar(p, saver) || '', body, finishButton(saver, { label: '✓ Fine', back: backFromEdit(p) }));

  const rerender = () => { const y = window.scrollY; clear(body); render(); window.scrollTo(0, y); };

  function render() {
    const termSel = h('select.input', { 'aria-label': 'Trimestre' }, [1, 2, 3, 4].map((t) => h('option', { value: t, selected: Number(p.term) === t }, ordinalRoman(t) + ' trimestre')));
    termSel.addEventListener('change', () => {
      const old = `${ordinalRoman(p.term)} TRIMESTRE`;
      p.term = Number(termSel.value);
      if (!p.title || p.title === old) { p.title = `${ordinalRoman(p.term)} TRIMESTRE`; titleIn.value = p.title; }
      changed();
    });
    const catSel = h('select.input', { 'aria-label': 'Categoria' }, h('option', { value: '' }, '— (facoltativa)'), visibleCategories(myCategories(), p.category).map((c) => h('option', { value: c, selected: p.category === c }, c)));
    catSel.addEventListener('change', () => { p.category = catSel.value; changed(); });
    const titleIn = textInput(p, 'title', changed, { label: 'Titolo', cls: 'title-input' });

    body.append(h('section.sheet-head.center',
      titleIn,
      h('div.grid3', h('label.field', h('span.field-label', 'Trimestre'), termSel), h('label.field', h('span.field-label', 'Categoria'), catSel),
        h('label.field', h('span.field-label', 'Stagione'), textInput(p, 'season', changed, { placeholder: '2026/27' }))),
      p.example ? h('p.hint', 'Questo piano è un esempio precaricato: puoi modificarlo o eliminarlo.') : null));

    body.append(h('section.sheet-section',
      h('label.field', h('span.field-label.u-i', 'OBIETTIVI EDUCATIVI:'), textArea(p, 'educationalGoals', changed, { cls: 'bold', label: 'Obiettivi educativi' })),
      h('label.field', h('span.field-label.u-i', 'OBIETTIVI DIDATTICI:'), textArea(p, 'didacticGoals', changed, { cls: 'bold', label: 'Obiettivi didattici' }))));

    const list = h('div.plan-sessions');
    p.sessions.forEach((ps, si) => list.append(sessionCard(ps, si)));
    body.append(h('section.sheet-section',
      h('h2.sec-title.center', 'ALLENAMENTI'),
      list,
      h('div.table-foot',
        h('button.btn', { type: 'button', on: { click: () => { p.sessions.push(templatePlanSession()); changed(); rerender(); } } }, '+ Aggiungi allenamento (modello)'),
        h('button.btn', { type: 'button', on: { click: () => { p.sessions.push(newPlanSession()); changed(); rerender(); } } }, '+ Allenamento vuoto')),
      h('datalist', { id: dlId }, exercises.map((e) => h('option', { value: e.name })))));
  }

  function sessionCard(ps, si) {
    const blocks = h('ol.blocks');
    ps.blocks.forEach((b, bi) => blocks.append(blockRow(ps, b, bi)));
    const addBtns = h('div.add-blocks', h('span.hint', 'Aggiungi:'),
      ...Object.entries(BLOCK_TYPES).map(([t, def]) => h('button.btn.small', { type: 'button', on: { click: () => {
        ps.blocks.push(newBlock(t)); changed(); rerender();
      } } }, def.label)));
    return h('article.plan-session',
      h('header.ps-head',
        h('h3.ps-title', ordinalRoman(si + 1)),
        h('div.ps-actions',
          h('button.btn.small.primary', { type: 'button', on: { click: () => createSheet(si) } }, '→ Crea foglio allenamento'),
          h('button.btn.small', { type: 'button', on: { click: () => {
            const c = deepClone(ps); c.id = uid(); c.blocks.forEach((b) => { b.id = uid(); });
            p.sessions.splice(si + 1, 0, c); changed(); rerender();
          } } }, 'Duplica'),
          rowControls({ index: si, length: p.sessions.length, label: 'allenamento',
            onMove: (d) => { moveItem(p.sessions, si, d); changed(); rerender(); },
            onRemove: async () => {
              if (ps.blocks.length && !(await confirmDialog(`Eliminare l'allenamento ${ordinalRoman(si + 1)}?`, { okText: 'Elimina', danger: true }))) return;
              removeItem(p.sessions, si); changed(); rerender();
            } }))),
      blocks, addBtns,
      h('label.field', h('span.field-label', 'Note'), textArea(ps, 'notes', changed, { label: 'Note allenamento ' + ordinalRoman(si + 1) })));
  }

  function blockRow(ps, b, bi) {
    const typeSel = h('select.input.block-type', { 'aria-label': 'Tipo di blocco' }, Object.entries(BLOCK_TYPES).map(([t, d]) => h('option', { value: t, selected: b.type === t }, d.label)));
    typeSel.addEventListener('change', () => {
      const old = BLOCK_TYPES[b.type];
      b.type = typeSel.value;
      if (!b.title || b.title === old.defaultTitle) b.title = BLOCK_TYPES[b.type].defaultTitle;
      changed(); rerender();
    });
    const titleIn = textInput(b, 'title', () => {
      if (b.type === 'GIOCO') { const ex = findExerciseByName(exercises, b.title); b.exerciseId = ex ? ex.id : null; linkEl.hidden = !b.exerciseId; }
      changed();
    }, { label: 'Titolo blocco', list: b.type === 'GIOCO' ? dlId : undefined, placeholder: b.type === 'GIOCO' ? 'Nome del gioco (dalla libreria o libero)' : '' });
    const linkEl = h('a.chip.small', { href: b.exerciseId ? '#/esercizio/' + b.exerciseId : '#/libreria', hidden: !(b.type === 'GIOCO' && b.exerciseId), title: 'Apri nella libreria' }, '📚');
    const durIn = h('input.input.num.dur-in', { type: 'number', inputmode: 'numeric', min: 0, placeholder: 'min', 'aria-label': 'Durata in minuti', value: b.durationMin ?? '' });
    durIn.addEventListener('input', () => { b.durationMin = durIn.value === '' ? null : Math.max(0, parseInt(durIn.value, 10)); changed(); });
    const li = h('li.block.block-' + b.type.toLowerCase(),
      h('div.block-main', typeSel, b.type === 'PAUSA' ? h('strong.pausa', 'PAUSA') : titleIn, linkEl, b.type !== 'PAUSA' ? durIn : null,
        rowControls({ index: bi, length: ps.blocks.length, label: 'blocco',
          onMove: (d) => { moveItem(ps.blocks, bi, d); changed(); rerender(); },
          onRemove: () => { removeItem(ps.blocks, bi); changed(); rerender(); } })));
    if (b.type === 'RISCALDAMENTO') {
      const subs = h('ul.subitems');
      b.subItems.forEach((sub, k) => {
        const holder = { v: sub };
        subs.append(h('li', textInput(holder, 'v', () => { b.subItems[k] = holder.v; changed(); }, { placeholder: 'Attività di riscaldamento', label: 'Attività ' + (k + 1), list: dlId }),
          h('button.icon-btn.danger', { type: 'button', 'aria-label': 'Rimuovi attività', on: { click: () => { b.subItems.splice(k, 1); changed(); rerender(); } } }, '✕')));
      });
      subs.append(h('li', h('button.btn.small', { type: 'button', on: { click: () => { b.subItems.push(''); changed(); rerender(); } } }, '+ attività')));
      li.append(subs);
    }
    return li;
  }

  async function createSheet(si) {
    saver.flush();
    await createSheetFromPlan(p, si);
  }

  render();
  return () => saver.dispose();
}

// "→ Crea foglio allenamento" (pagina di modifica e di lettura del piano): il foglio nuovo si apre in modifica
export async function createSheetFromPlan(p, si) {
  const exs = await repo.list('exercise');
  const prefs = (await repo.getSetting('prefs', {})) || {};
  const s = sessionFromPlanSession(p, si, exs, prefs.defaultModules ? { modules: sanitizeModules(prefs.defaultModules) } : {});
  await repo.save(s);
  toast(`Foglio allenamento creato dall'allenamento ${ordinalRoman(si + 1)}.`, 'ok');
  await openPrepared(`#/seduta/${s.id}/foglio`);
}
