// Seduta modulare (v1.4): un'unica pagina con le sole sezioni che servono al coach. Si parte con il Programma;
// "+ Aggiungi sezione" propone Presenze, Osservazione esercizi, Bilancio, Errori e cause, Autovalutazione, Preparatore.
// Ogni sezione si può spostare o togliere. Il documento Word contiene solo le sezioni presenti, in quell'ordine.
import { h, clear, textInput, numberInput, textArea, choice, yesNo, tagInput, categoryPicker, rowControls, confirmDialog, toast, modal } from '../ui.js';
import * as repo from '../repo.js';
import {
  CATEGORIES, visibleCategories, OBSERVATION_LEVELS, ERRORS_CORRECTED_LABEL, WORK_TIME_OPTIONS, SOLICITATION_OPTIONS,
  newPlanItem, newObservation, newReviewRow, syncReviewRows, totalAttendance, totalDuration, moveItem, removeItem,
  isBlankValue, planItemFromExercise, observationFromExercise, observationFromPlanItem, reviewRowLabel, formatDateIT,
  sessionCategories, ordinalRoman, toInt, SESSION_MODULES, MODULE_ORDER, moduleHasData, clearModule, isBlankObservation,
} from '../model.js';
import { autosaver, pageHeader, docActions, drawingCell, pickExercise, saveRowToLibrary, rosterNames, nameChips, insertName, finishButton, scopeBar, backFromEdit, myCategories } from './common.js';

const MODULE_TITLES = {
  program: ['Programma della seduta', ''],
  attendance: ['Presenze', ''],
  observation: ['Osservazione esercizi', ''],
  review: ['Bilancio della seduta', '(da solo prima del briefing finale)'],
  errors: ['Errori e cause', '(insieme agli atleti)'],
  selfeval: ['La seduta di allenamento x me', '(meglio se altro mi vede) — L\'osservazione'],
  trainer: ['Con preparatore atletico', ''],
};

export async function sessionView(root, { id, tab = 'foglio' }) {
  const s = await repo.get('session', id);
  if (!s) { root.append(h('p.empty', 'Allenamento non trovato.'), h('a.btn', { href: '#/' }, 'Torna alla home')); return; }
  const saver = autosaver(s);
  const changed = () => saver.changed();
  let plan = null;
  if (s.termPlanRef) plan = await repo.get('plan', s.termPlanRef.termPlanId);
  const players = await rosterNames(sessionCategories(s));

  const subtitle = () => [formatDateIT(s.date), sessionCategories(s).join(' · ')].filter(Boolean).join(' — ');
  const head = pageHeader('Allenamento', { sub: subtitle(), back: backFromEdit(s), actions: [saver.pill, ...docActions(s, saver)] });
  const body = h('div.sheet.session-sheet');
  root.append(head, scopeBar(s, saver) || '', body, finishButton(saver, { label: '✓ Fine allenamento', back: backFromEdit(s) }));

  const rerender = () => {
    const y = window.scrollY;
    clear(body);
    render();
    window.scrollTo(0, y);
  };

  function render() {
    syncReviewRows(s);
    // intestazione comune (data, categorie, luogo)
    body.append(h('section.sheet-head',
      h('label.inline-field.big', h('span', 'ALLENAMENTO DEL'), textInput(s, 'date', () => { changed(); }, { type: 'date', label: 'Data allenamento' })),
      h('div.head-extra',
        h('div.field', h('span.field-label', 'Categorie (facoltativo)'), categoryPicker(s, 'categories', changed, { categories: visibleCategories(myCategories(), s.categories) })),
        h('label.field', h('span.field-label', 'Luogo (facoltativo)'), textInput(s, 'location', changed, { placeholder: 'Campo…' }))),
      plan ? h('p.hint', 'Creato dal piano ', h('a', { href: `#/piano/${plan.id}` }, `${plan.title} — allenamento ${ordinalRoman((s.termPlanRef.sessionIndex || 0) + 1)}`)) : null,
    ));
    if (s.modules.length > 1) {
      body.append(h('nav.section-nav', { 'aria-label': 'Sezioni' }, s.modules.map((m) => h('a.chip', { href: '#mod-' + m,
        on: { click: (e) => { e.preventDefault(); document.getElementById('mod-' + m).scrollIntoView({ behavior: 'smooth' }); } } }, SESSION_MODULES[m].label))));
    }
    s.modules.forEach((m, i) => body.append(moduleSection(m, i)));
    const missing = MODULE_ORDER.filter((m) => !s.modules.includes(m));
    if (missing.length) {
      body.append(h('div.add-section', h('button.btn.big.add-section-btn', { type: 'button', on: { click: () => addSections(missing) } }, '+ Aggiungi sezione'),
        h('span.hint', 'Presenze, osservazione, bilancio… solo se ti servono.')));
    }
  }

  function moduleSection(m, i) {
    const [title, small] = MODULE_TITLES[m];
    const ctl = h('div.module-ctl',
      h('button.icon-btn', { type: 'button', title: 'Sposta su', 'aria-label': `Sposta su la sezione ${SESSION_MODULES[m].label}`, disabled: i === 0, on: { click: () => { moveItem(s.modules, i, -1); changed(); rerender(); } } }, '↑'),
      h('button.icon-btn', { type: 'button', title: 'Sposta giù', 'aria-label': `Sposta giù la sezione ${SESSION_MODULES[m].label}`, disabled: i === s.modules.length - 1, on: { click: () => { moveItem(s.modules, i, 1); changed(); rerender(); } } }, '↓'),
      m === 'program' ? null : h('button.icon-btn.danger', { type: 'button', title: 'Togli la sezione', 'aria-label': `Togli la sezione ${SESSION_MODULES[m].label}`, on: { click: async () => {
        if (moduleHasData(s, m) && !(await confirmDialog(`Togliere la sezione "${SESSION_MODULES[m].label}" e quello che hai scritto?`, { okText: 'Togli sezione', danger: true, title: 'Togli sezione' }))) return;
        clearModule(s, m);
        s.modules.splice(s.modules.indexOf(m), 1);
        changed(); rerender();
      } } }, '✕'));
    const sec = h('section.sheet-section.module', { id: 'mod-' + m, dataset: { module: m } },
      h('div.module-head', h('h2.sec-title', title, small ? h('small', ' ' + small) : null), ctl));
    const builders = { program: programModule, attendance: attendanceModule, observation: observationModule, review: reviewModule, errors: errorsModule, selfeval: selfevalModule, trainer: trainerModule };
    builders[m](sec);
    return sec;
  }

  async function addSections(missing) {
    const prefs = (await repo.getSetting('prefs', {})) || {};
    const checks = missing.map((m) => ({ m, input: h('input', { type: 'checkbox', value: m }) }));
    const remember = h('input', { type: 'checkbox' });
    const list = h('div.module-pick', checks.map(({ m, input }) => h('label.module-option', input,
      h('span', h('strong', SESSION_MODULES[m].label), h('small', SESSION_MODULES[m].desc)))));
    const ok = await modal({ title: 'Aggiungi sezioni', content: h('div', list, h('label.check.remember', remember, ' Ricorda queste sezioni per i prossimi allenamenti')),
      actions: [{ label: 'Annulla', value: false }, { label: 'Aggiungi', value: true, primary: true }] });
    if (!ok) return;
    const chosen = checks.filter((c) => c.input.checked).map((c) => c.m);
    if (!chosen.length) return;
    for (const m of MODULE_ORDER) if (chosen.includes(m) && !s.modules.includes(m)) s.modules.push(m);
    // osservazione aggiunta: parte già con gli esercizi del programma
    if (chosen.includes('observation') && !s.observations.length) {
      s.observations = s.planItems.filter((p) => p.name && p.name.trim()).map((p) => newObservation(observationFromPlanItem(p)));
    }
    if (remember.checked) {
      await repo.setSetting('prefs', { ...prefs, defaultModules: [...s.modules] });
      toast('Ricordate per i prossimi allenamenti. Puoi cambiarlo in Impostazioni › Sezioni della seduta.', 'ok', 6000);
    }
    changed(); rerender();
    setTimeout(() => { const el = document.getElementById('mod-' + chosen[0]); if (el) el.scrollIntoView({ behavior: 'smooth' }); }, 50);
  }

  // ----- Programma -----
  function programModule(sec) {
    const durEl = h('strong', String(totalDuration(s)) + ' min');
    const updateDur = () => { durEl.textContent = totalDuration(s) + ' min'; };
    if (s.planItems.length) {
      const table = h('div.sheet-table.t-plan', { role: 'table', 'aria-label': 'Programma esercizi' },
        h('div.tr.th', { role: 'row' }, ...['ESERCIZIO E DURATA', 'MATERIALE E SPAZIO', 'OBIETTIVI', 'PAROLE CHIAVE', 'COSA OSSERVO', ''].map((l) => h('div.td', { role: 'columnheader' }, l))));
      s.planItems.forEach((it, i) => {
        table.append(h('div.tr', { role: 'row' },
          h('div.td.ex-cell', { 'data-label': 'Esercizio e durata' }, exerciseEditor(it, i, { withDuration: true, onDur: updateDur, kind: 'plan' })),
          h('div.td', { 'data-label': 'Materiale e spazio' }, textArea(it, 'materialsSpace', changed, { label: 'Materiale e spazio', placeholder: 'Palloni, coni… spazio 20×15 m' })),
          h('div.td', { 'data-label': 'Obiettivi' }, textArea(it, 'objectives', changed, { label: 'Obiettivi' })),
          h('div.td', { 'data-label': 'Parole chiave' }, tagInput(it, 'keywords', changed)),
          h('div.td', { 'data-label': 'Cosa osservo' }, textArea(it, 'toObserve', changed, { label: 'Cosa osservo' })),
          h('div.td.ctl', rowControls({ index: i, length: s.planItems.length, label: 'esercizio',
            onMove: (d) => { moveItem(s.planItems, i, d); syncReviewRows(s); changed(); rerender(); },
            onRemove: async () => {
              if (!isBlankValue(it) && !(await confirmDialog(`Rimuovere l'esercizio ${i + 1}${it.name ? ' "' + it.name + '"' : ''}?`, { okText: 'Rimuovi', danger: true }))) return;
              removeItem(s.planItems, i); syncReviewRows(s); changed(); rerender();
            } })),
        ));
      });
      sec.append(table);
    } else {
      sec.append(h('p.empty-list', 'Ancora nessun esercizio. Tocca "+ Aggiungi esercizio" o prendilo dalla libreria.'));
    }
    sec.append(h('div.table-foot',
      h('button.btn.primary', { type: 'button', on: { click: () => {
        s.planItems.push(newPlanItem()); syncReviewRows(s); changed(); rerender();
        const el = document.querySelector(`[aria-label="Nome esercizio ${s.planItems.length}"]`); // subito, senza ritardi
        if (el) el.focus({ preventScroll: false });
      } } }, '+ Aggiungi esercizio'),
      h('button.btn', { type: 'button', on: { click: async () => {
        const ex = await pickExercise();
        if (!ex) return;
        s.planItems.push(newPlanItem(planItemFromExercise(ex))); syncReviewRows(s); changed(); rerender();
      } } }, '+ Dalla libreria'),
      s.planItems.length ? h('span.total', 'Durata totale: ', durEl) : null));
  }

  // ----- Presenze -----
  function attendanceModule(sec) {
    const totEl = h('strong.big-num', String(totalAttendance(s)));
    sec.append(h('div.attendance', { role: 'group', 'aria-label': 'Presenti per categoria' },
      // solo le mie categorie (Impostazioni), più quelle dove ho già segnato dei presenti
      ...visibleCategories(myCategories(), CATEGORIES.filter((c) => s.attendance[c] !== null && s.attendance[c] !== undefined && s.attendance[c] !== '')).map((c) => {
        const holder = { v: s.attendance[c] };
        const inp = numberInput(holder, 'v', () => { s.attendance[c] = holder.v; totEl.textContent = String(totalAttendance(s)); changed(); }, { label: 'Presenti ' + c, placeholder: '—' });
        const step = (d) => { const v = Math.max(0, toInt(s.attendance[c]) + d); s.attendance[c] = v; inp.value = v; totEl.textContent = String(totalAttendance(s)); changed(); };
        return h('div.att-item',
          h('span.att-label', 'N. ' + c),
          h('div.att-ctl', h('button.counter-btn.minus', { type: 'button', 'aria-label': 'meno uno ' + c, on: { click: () => step(-1) } }, '−'), inp,
            h('button.counter-btn.plus', { type: 'button', 'aria-label': 'più uno ' + c, on: { click: () => step(1) } }, '+')));
      }),
      h('div.att-item.total', h('span.att-label', 'Totale presenti'), totEl)));
  }

  // ----- Osservazione esercizi -----
  function observationModule(sec) {
    if (s.observations.length) {
      const table = h('div.sheet-table.t-obs', { role: 'table', 'aria-label': 'Osservazione degli esercizi' },
        h('div.tr.th', { role: 'row' }, ...['ESERCIZIO', 'OBIETTIVO', 'COSA OSSERVO – POSITIVO', 'COSA OSSERVO – NEGATIVO', 'MIGLIORAMENTI DA APPORTARE', ''].map((l) => h('div.td', { role: 'columnheader' }, l))));
      s.observations.forEach((o, i) => {
        table.append(h('div.tr', { role: 'row' },
          h('div.td.ex-cell', { 'data-label': 'Esercizio' }, exerciseEditor(o, i, { withDuration: false, kind: 'obs' })),
          h('div.td', { 'data-label': 'Obiettivo' }, textArea(o, 'objective', changed, { label: 'Obiettivo' })),
          h('div.td.pos', { 'data-label': 'Cosa osservo – positivo' }, textArea(o, 'positive', changed, { label: 'Positivo' })),
          h('div.td.neg', { 'data-label': 'Cosa osservo – negativo' }, textArea(o, 'negative', changed, { label: 'Negativo' })),
          h('div.td', { 'data-label': 'Miglioramenti da apportare' }, textArea(o, 'improvements', changed, { label: 'Miglioramenti' })),
          h('div.td.ctl', rowControls({ index: i, length: s.observations.length, label: 'riga di osservazione',
            onMove: (d) => { moveItem(s.observations, i, d); changed(); rerender(); },
            onRemove: async () => {
              if (!isBlankObservation(o) && !(await confirmDialog(`Rimuovere la riga ${i + 1}?`, { okText: 'Rimuovi', danger: true }))) return;
              removeItem(s.observations, i); changed(); rerender();
            } })),
        ));
      });
      sec.append(table);
    } else {
      sec.append(h('p.empty-list', 'Nessuna riga. Copia gli esercizi dal programma o aggiungi una riga.'));
    }
    const planned = s.planItems.filter((p) => p.name && p.name.trim());
    sec.append(h('div.table-foot',
      h('button.btn', { type: 'button', on: { click: () => { s.observations.push(newObservation()); changed(); rerender(); } } }, '+ Aggiungi riga'),
      planned.length ? h('button.btn', { type: 'button', on: { click: () => {
        const used = new Set(s.observations.map((o) => o.planItemRef).filter(Boolean));
        let added = 0;
        for (const p of planned) {
          if (used.has(p.id)) continue;
          const blankRow = s.observations.find((o) => isBlankObservation(o));
          if (blankRow) Object.assign(blankRow, observationFromPlanItem(p)); else s.observations.push(newObservation(observationFromPlanItem(p)));
          added++;
        }
        if (!added) { toast('Gli esercizi del programma ci sono già.', 'info'); return; }
        changed(); rerender(); toast(`${added} esercizi copiati dal programma.`, 'ok');
      } } }, '⇩ Copia esercizi dal programma') : null));
  }

  // ----- Bilancio -----
  function reviewModule(sec) {
    if (s.review.perExercise.length) {
      const bil = h('div.sheet-table.t-review', { role: 'table', 'aria-label': 'Bilancio della seduta' },
        h('div.tr.th', { role: 'row' }, ...['Eser.', 'Complessivamente', 'Individualmente (nomi)', ''].map((l) => h('div.td', { role: 'columnheader' }, l))));
      s.review.perExercise.forEach((r, i) => {
        const lab = reviewRowLabel(s, r);
        const indiv = textArea(r, 'individual', changed, { label: 'Individualmente', placeholder: 'Nome: osservazione…' });
        bil.append(h('div.tr', { role: 'row' },
          h('div.td.num-cell', { 'data-label': 'Esercizio' }, r.ref ? h('span', h('strong.big-num', lab.num), h('small', lab.name || '(senza nome)'))
            : textInput(r, 'label', changed, { placeholder: 'Riga libera', label: 'Etichetta riga' })),
          h('div.td', { 'data-label': 'Complessivamente' }, textArea(r, 'overall', changed, { label: 'Complessivamente' })),
          h('div.td', { 'data-label': 'Individualmente (nomi)' }, indiv, nameChips(players, (p) => insertName(indiv, r, 'individual', p.name, changed))),
          h('div.td.ctl', r.ref ? h('span.hint', 'dal programma') : h('button.icon-btn.danger', { type: 'button', 'aria-label': 'Rimuovi riga libera', on: { click: () => {
            s.review.perExercise.splice(i, 1); changed(); rerender();
          } } }, '✕')),
        ));
      });
      sec.append(h('p.hint', 'Una riga per ogni esercizio del programma (si aggiornano da sole); puoi aggiungere righe libere.'), bil);
    } else {
      sec.append(h('p.empty-list', 'Le righe compaiono da sole quando aggiungi esercizi al programma. Puoi anche aggiungere una riga libera.'));
    }
    sec.append(h('div.table-foot', h('button.btn', { type: 'button', on: { click: () => { s.review.perExercise.push(newReviewRow()); changed(); rerender(); } } }, '+ Aggiungi riga libera')));
  }

  // ----- Errori e cause -----
  function errorsModule(sec) {
    sec.append(h('ol.qa-list', s.review.errorsCauses.map((q) => h('li.qa',
      h('span.qa-q', q.question),
      yesNo(q, 'answer', changed, { label: q.question }),
      textInput(q, 'note', changed, { placeholder: 'Nota (facoltativa)', label: 'Nota: ' + q.question, cls: 'qa-note' })))));
  }

  // ----- Autovalutazione -----
  function selfevalModule(sec) {
    const rv = s.review;
    sec.append(
      h('div.field', h('span.field-label', 'Livello di osservazione'),
        choice(rv, 'observationLevel', OBSERVATION_LEVELS.map((l) => ({ value: l.value, label: `${l.value} — ${l.label}` })), changed, { cls: 'vertical', label: 'Livello di osservazione' })),
      h('div.qa', h('span.qa-q', '4. ' + ERRORS_CORRECTED_LABEL), yesNo(rv, 'errorsCorrectedWell', changed, { label: ERRORS_CORRECTED_LABEL })),
      h('label.field', h('span.field-label', 'Osservatore'), textInput(rv, 'observer', changed, { placeholder: 'io / nome di un altro allenatore' })));
  }

  // ----- Preparatore -----
  function trainerModule(sec) {
    const rv = s.review;
    sec.append(
      h('div.grid2',
        h('div.field', h('span.field-label', 'Rapporto tempo di lavoro'), choice(rv, 'workTimeRatio', WORK_TIME_OPTIONS, changed, { label: 'Rapporto tempo di lavoro' })),
        h('div.field', h('span.field-label', 'N° di sollecitazioni'),
          h('div.inline', numberInput(rv, 'solicitationsCount', changed, { placeholder: 'n°', label: 'Numero di sollecitazioni' }),
            choice(rv, 'solicitations', SOLICITATION_OPTIONS, changed, { label: 'Sollecitazioni' })))),
      h('label.field', h('span.field-label', 'Preparatore atletico (facoltativo)'), textInput(rv, 'trainer', changed, { placeholder: 'Nome' })));
  }

  // Cella "Esercizio": nome, durata, descrizione, disegno, libreria
  function exerciseEditor(row, i, { withDuration, onDur, kind }) {
    const cats = sessionCategories(s);
    return h('div.ex-editor',
      h('div.ex-top',
        h('span.row-num', String(i + 1)),
        textInput(row, 'name', changed, { placeholder: 'Nome esercizio', label: (kind === 'plan' ? 'Nome esercizio ' : 'Esercizio osservato ') + (i + 1), cls: 'ex-name' }),
        withDuration ? h('label.dur', numberInput(row, 'durationMin', () => { onDur && onDur(); changed(); }, { placeholder: 'min', label: 'Durata in minuti' }), h('span', 'min')) : null),
      textArea(row, 'description', changed, { placeholder: 'Descrizione / regole', label: 'Descrizione' }),
      h('div.ex-bottom',
        drawingCell(row, changed, { title: row.name || 'Esercizio ' + (i + 1) }),
        h('div.ex-actions',
          h('button.btn.small', { type: 'button', on: { click: async () => {
            const ex = await pickExercise({ category: cats[0] });
            if (!ex) return;
            if (!isBlankValue({ ...row, id: null, exerciseId: null, planItemRef: null, drawing: row.drawing ? 1 : null }) &&
              !(await confirmDialog(`Sostituire il contenuto della riga con "${ex.name}"?`, { okText: 'Sostituisci' }))) return;
            Object.assign(row, kind === 'plan' ? planItemFromExercise(ex) : observationFromExercise(ex));
            changed(); rerender();
          } } }, '📚 Dalla libreria'),
          h('button.btn.small', { type: 'button', on: { click: async () => { if (await saveRowToLibrary(row, { categories: cats })) changed(); } } }, '＋ Salva in libreria'))),
    );
  }

  render();
  if (tab === 'osservazione' && s.modules.includes('observation')) setTimeout(() => document.getElementById('mod-observation')?.scrollIntoView(), 50);
  return () => saver.dispose();
}
