// Seduta: due pagine della stessa entità (decisione): Foglio allenamento (programma + bilancio) e Scheda di allenamento (osservazione).
import { h, clear, textInput, numberInput, textArea, choice, yesNo, tagInput, categoryPicker, rowControls, confirmDialog, toast } from '../ui.js';
import * as repo from '../repo.js';
import {
  CATEGORIES, OBSERVATION_LEVELS, ERRORS_CORRECTED_LABEL, WORK_TIME_OPTIONS, SOLICITATION_OPTIONS,
  newPlanItem, newObservation, newReviewRow, syncReviewRows, totalAttendance, totalDuration, moveItem, removeItem,
  isBlankValue, planItemFromExercise, observationFromExercise, observationFromPlanItem, reviewRowLabel, formatDateIT,
  sessionCategories, ordinalRoman, toInt,
} from '../model.js';
import { autosaver, pageHeader, docActions, drawingCell, pickExercise, saveRowToLibrary, rosterNames, nameChips, insertName } from './common.js';

export async function sessionView(root, { id, tab = 'foglio' }) {
  const s = await repo.get('session', id);
  if (!s) { root.append(h('p.empty', 'Seduta non trovata.'), h('a.btn', { href: '#/' }, 'Torna alla home')); return; }
  const saver = autosaver(s);
  const changed = () => saver.changed();
  let plan = null;
  if (s.termPlanRef) plan = await repo.get('plan', s.termPlanRef.termPlanId);
  const players = await rosterNames(sessionCategories(s));

  const subtitle = () => [formatDateIT(s.date), sessionCategories(s).join(' · ')].filter(Boolean).join(' — ');
  let isObs = tab === 'osservazione';
  const head = pageHeader(isObs ? 'Scheda di allenamento' : 'Foglio allenamento', {
    sub: subtitle(), back: '#/',
    actions: [saver.pill, ...docActions(s, saver)],
  });
  // Le due pagine della stessa seduta: il passaggio avviene subito, senza ricaricare la vista
  const switchTab = (obs) => (e) => {
    e.preventDefault();
    if (obs === isObs) return;
    saver.flush();
    isObs = obs;
    history.pushState(null, '', `#/seduta/${s.id}/${obs ? 'osservazione' : 'foglio'}`);
    head.querySelector('.page-title').textContent = obs ? 'Scheda di allenamento' : 'Foglio allenamento';
    tabFoglio.classList.toggle('on', !obs); tabObs.classList.toggle('on', obs);
    if (obs) { tabObs.setAttribute('aria-current', 'page'); tabFoglio.removeAttribute('aria-current'); } else { tabFoglio.setAttribute('aria-current', 'page'); tabObs.removeAttribute('aria-current'); }
    body.classList.toggle('landscape-obs', obs);
    clear(body);
    if (obs) renderObservation(); else renderPlan();
    window.scrollTo(0, 0);
  };
  const tabFoglio = h('a.tab' + (!isObs ? '.on' : ''), { href: `#/seduta/${s.id}/foglio`, 'aria-current': !isObs ? 'page' : null, on: { click: switchTab(false) } }, 'Foglio allenamento');
  const tabObs = h('a.tab' + (isObs ? '.on' : ''), { href: `#/seduta/${s.id}/osservazione`, 'aria-current': isObs ? 'page' : null, on: { click: switchTab(true) } }, 'Scheda di allenamento (osservazione)');
  const tabs = h('nav.tabs', { 'aria-label': 'Pagine della seduta' }, tabFoglio, tabObs);
  const body = h('div.sheet' + (isObs ? '.landscape-obs' : ''));
  root.append(head, tabs, body);

  const rerender = () => {
    const y = window.scrollY;
    clear(body);
    if (isObs) renderObservation(); else renderPlan();
    window.scrollTo(0, y);
  };

  // ======================= FOGLIO ALLENAMENTO =======================
  function renderPlan() {
    body.append(h('nav.section-nav', { 'aria-label': 'Sezioni' },
      ...[['sez-programma', 'Programma'], ['sez-bilancio', 'Bilancio'], ['sez-errori', 'Errori e cause'], ['sez-auto', 'Autovalutazione'], ['sez-preparatore', 'Preparatore']]
        .map(([a, l]) => h('a.chip', { href: '#' + a, on: { click: (e) => { e.preventDefault(); document.getElementById(a).scrollIntoView({ behavior: 'smooth' }); } } }, l))));

    // A — intestazione
    body.append(h('section.sheet-head',
      h('label.inline-field.big', h('span', 'ALLENAMENTO DEL'), textInput(s, 'date', () => { changed(); }, { type: 'date', label: 'Data allenamento' })),
      h('div.head-extra',
        h('div.field', h('span.field-label', 'Categorie (facoltativo)'), categoryPicker(s, 'categories', changed)),
        h('label.field', h('span.field-label', 'Luogo (facoltativo)'), textInput(s, 'location', changed, { placeholder: 'Campo…' }))),
      plan ? h('p.hint', 'Creato dal piano ', h('a', { href: `#/piano/${plan.id}` }, `${plan.title} — allenamento ${ordinalRoman((s.termPlanRef.sessionIndex || 0) + 1)}`)) : null,
    ));

    // B — programma
    const durEl = h('strong', String(totalDuration(s)) + ' min');
    const updateDur = () => { durEl.textContent = totalDuration(s) + ' min'; };
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
    body.append(h('section#sez-programma.sheet-section',
      h('h2.sec-title', 'Programma della seduta'),
      table,
      h('div.table-foot',
        h('button.btn', { type: 'button', on: { click: () => { s.planItems.push(newPlanItem()); syncReviewRows(s); changed(); rerender(); } } }, '+ Aggiungi esercizio'),
        h('button.btn', { type: 'button', on: { click: async () => {
          const ex = await pickExercise();
          if (!ex) return;
          s.planItems.push(newPlanItem(planItemFromExercise(ex))); syncReviewRows(s); changed(); rerender();
        } } }, '📚 Aggiungi dalla libreria'),
        h('span.total', 'Durata totale: ', durEl)),
    ));

    // C1 — bilancio
    syncReviewRows(s);
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
    body.append(h('section#sez-bilancio.sheet-section',
      h('h2.sec-title', 'Bilancio della seduta ', h('small', '(da solo prima del briefing finale)')),
      h('p.hint', 'Una riga per ogni esercizio del programma (si aggiornano da sole); puoi aggiungere righe libere.'),
      bil,
      h('div.table-foot', h('button.btn', { type: 'button', on: { click: () => { s.review.perExercise.push(newReviewRow()); changed(); rerender(); } } }, '+ Aggiungi riga libera'))));

    // C2 — errori e cause
    body.append(h('section#sez-errori.sheet-section',
      h('h2.sec-title', 'Errori e cause ', h('small', '(insieme agli atleti)')),
      h('ol.qa-list', s.review.errorsCauses.map((q) => h('li.qa',
        h('span.qa-q', q.question),
        yesNo(q, 'answer', changed, { label: q.question }),
        textInput(q, 'note', changed, { placeholder: 'Nota (facoltativa)', label: 'Nota: ' + q.question, cls: 'qa-note' })))),
    ));

    // D — autovalutazione
    const rv = s.review;
    body.append(h('section#sez-auto.sheet-section',
      h('h2.sec-title', 'La seduta di allenamento x me ', h('small', '(meglio se altro mi vede) — L\'osservazione')),
      h('div.field', h('span.field-label', 'Livello di osservazione'),
        choice(rv, 'observationLevel', OBSERVATION_LEVELS.map((l) => ({ value: l.value, label: `${l.value} — ${l.label}` })), changed, { cls: 'vertical', label: 'Livello di osservazione' })),
      h('div.qa', h('span.qa-q', '4. ' + ERRORS_CORRECTED_LABEL), yesNo(rv, 'errorsCorrectedWell', changed, { label: ERRORS_CORRECTED_LABEL })),
      h('label.field', h('span.field-label', 'Osservatore'), textInput(rv, 'observer', changed, { placeholder: 'io / nome di un altro allenatore' })),
    ));

    // E — preparatore
    body.append(h('section#sez-preparatore.sheet-section',
      h('h2.sec-title', 'Con preparatore atletico'),
      h('div.grid2',
        h('div.field', h('span.field-label', 'Rapporto tempo di lavoro'), choice(rv, 'workTimeRatio', WORK_TIME_OPTIONS, changed, { label: 'Rapporto tempo di lavoro' })),
        h('div.field', h('span.field-label', 'N° di sollecitazioni'),
          h('div.inline', numberInput(rv, 'solicitationsCount', changed, { placeholder: 'n°', label: 'Numero di sollecitazioni' }),
            choice(rv, 'solicitations', SOLICITATION_OPTIONS, changed, { label: 'Sollecitazioni' })))),
      h('label.field', h('span.field-label', 'Preparatore atletico (facoltativo)'), textInput(rv, 'trainer', changed, { placeholder: 'Nome' })),
    ));
  }

  // Cella "Esercizio": nome, durata, descrizione, disegno, libreria
  function exerciseEditor(row, i, { withDuration, onDur, kind }) {
    const cats = sessionCategories(s);
    return h('div.ex-editor',
      h('div.ex-top',
        h('span.row-num', String(i + 1)),
        textInput(row, 'name', changed, { placeholder: 'Nome esercizio', label: 'Nome esercizio ' + (i + 1), cls: 'ex-name' }),
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

  // ======================= SCHEDA DI ALLENAMENTO (OSSERVAZIONE) =======================
  function renderObservation() {
    const totEl = h('strong.big-num', String(totalAttendance(s)));
    const att = h('div.attendance', { role: 'group', 'aria-label': 'Presenti per categoria' },
      ...CATEGORIES.map((c) => {
        const holder = { v: s.attendance[c] };
        const inp = numberInput(holder, 'v', () => { s.attendance[c] = holder.v; totEl.textContent = String(totalAttendance(s)); changed(); }, { label: 'Presenti ' + c, placeholder: '—' });
        const step = (d) => { const v = Math.max(0, toInt(s.attendance[c]) + d); s.attendance[c] = v; inp.value = v; totEl.textContent = String(totalAttendance(s)); changed(); };
        return h('div.att-item',
          h('span.att-label', 'N. ' + c),
          h('div.att-ctl', h('button.counter-btn.minus', { type: 'button', 'aria-label': 'meno uno ' + c, on: { click: () => step(-1) } }, '−'), inp,
            h('button.counter-btn.plus', { type: 'button', 'aria-label': 'più uno ' + c, on: { click: () => step(1) } }, '+')));
      }),
      h('div.att-item.total', h('span.att-label', 'Totale presenti'), totEl));
    body.append(h('section.sheet-head',
      h('label.inline-field.big', h('span', 'ALLENAMENTO DEL'), textInput(s, 'date', changed, { type: 'date', label: 'Data allenamento' })),
      att));

    const table = h('div.sheet-table.t-obs', { role: 'table', 'aria-label': 'Osservazione degli esercizi' },
      h('div.tr.th', { role: 'row' }, ...['ESERCIZIO', 'OBIETTIVO', 'COSA OSSERVO – POSITIVO', 'COSA OSSERVO – NEGATIVO', 'MIGLIORAMENTI DA APPORTARE', ''].map((l) => h('div.td', { role: 'columnheader' }, l))));
    s.observations.forEach((o, i) => {
      table.append(h('div.tr', { role: 'row' },
        h('div.td.ex-cell', { 'data-label': 'Esercizio' }, exerciseEditor(o, i, { withDuration: false, kind: 'obs' })),
        h('div.td', { 'data-label': 'Obiettivo' }, textArea(o, 'objective', changed, { label: 'Obiettivo' })),
        h('div.td.pos', { 'data-label': 'Cosa osservo – positivo' }, textArea(o, 'positive', changed, { label: 'Positivo' })),
        h('div.td.neg', { 'data-label': 'Cosa osservo – negativo' }, textArea(o, 'negative', changed, { label: 'Negativo' })),
        h('div.td', { 'data-label': 'Miglioramenti da apportare' }, textArea(o, 'improvements', changed, { label: 'Miglioramenti' })),
        h('div.td.ctl', rowControls({ index: i, length: s.observations.length, label: 'esercizio',
          onMove: (d) => { moveItem(s.observations, i, d); changed(); rerender(); },
          onRemove: async () => {
            const blank = ['name', 'description', 'objective', 'positive', 'negative', 'improvements'].every((k) => isBlankValue(o[k])) && !o.drawing;
            if (!blank && !(await confirmDialog(`Rimuovere la riga ${i + 1}?`, { okText: 'Rimuovi', danger: true }))) return;
            removeItem(s.observations, i); changed(); rerender();
          } })),
      ));
    });
    const planned = s.planItems.filter((p) => p.name && p.name.trim());
    body.append(h('section.sheet-section',
      table,
      h('div.table-foot',
        h('button.btn', { type: 'button', on: { click: () => { s.observations.push(newObservation()); changed(); rerender(); } } }, '+ Aggiungi esercizio'),
        planned.length ? h('button.btn', { type: 'button', on: { click: () => {
          const used = new Set(s.observations.map((o) => o.planItemRef).filter(Boolean));
          let added = 0;
          for (const p of planned) {
            if (used.has(p.id)) continue;
            const blankRow = s.observations.find((o) => ['name', 'description', 'objective', 'positive', 'negative', 'improvements'].every((k) => isBlankValue(o[k])) && !o.drawing);
            if (blankRow) Object.assign(blankRow, observationFromPlanItem(p)); else s.observations.push(newObservation(observationFromPlanItem(p)));
            added++;
          }
          if (!added) { toast('Gli esercizi del foglio sono già presenti.', 'info'); return; }
          changed(); rerender(); toast(`${added} esercizi copiati dal foglio allenamento.`, 'ok');
        } } }, '⇩ Copia esercizi dal foglio allenamento') : null),
    ));
  }

  rerender();
  return () => saver.dispose();
}
