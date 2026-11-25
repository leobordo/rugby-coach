// Scheda della partita: contatori +/- a tap grandi (decisione 6), righe con etichetta libera (decisione 5).
import { h, clear, textInput, numberInput, textArea, rowControls, confirmDialog } from '../ui.js';
import * as repo from '../repo.js';
import { CATEGORIES, MATCH_COLUMNS, newMatchRow, matchColumnTotals, moveItem, removeItem, formatDateIT, normalizeUnder, toInt } from '../model.js';
import { autosaver, pageHeader, docActions, drawingCell, rosterNames } from './common.js';

export async function matchView(root, { id }) {
  const m = await repo.get('match', id);
  if (!m) { root.append(h('p.empty', 'Partita non trovata.'), h('a.btn', { href: '#/' }, 'Torna alla home')); return; }
  const saver = autosaver(m);
  const changed = () => saver.changed();
  const body = h('div.sheet');
  root.append(pageHeader('Scheda della partita', {
    sub: [formatDateIT(m.date), m.opponent ? 'contro ' + m.opponent : '', m.under ? normalizeUnder(m.under) : ''].filter(Boolean).join(' — '),
    back: '#/', actions: [saver.pill, ...docActions(m, saver)],
  }), body);

  const rerender = async () => {
    const y = window.scrollY;
    clear(body);
    await render();
    window.scrollTo(0, y);
  };

  async function render() {
    const players = await rosterNames(m.under ? [normalizeUnder(m.under)] : []);
    const dlId = 'dl-players-' + m.id;
    const underSel = h('select.input', { 'aria-label': 'Under' },
      h('option', { value: '' }, '—'),
      ...CATEGORIES.map((c) => h('option', { value: c, selected: normalizeUnder(m.under) === c }, c.replace('U', ''))));
    underSel.addEventListener('change', () => { m.under = underSel.value; changed(); rerender(); });

    body.append(h('section.sheet-head',
      h('div.head-line',
        h('label.inline-field.big', h('span', 'PARTITA DEL'), textInput(m, 'date', changed, { type: 'date', label: 'Data partita' })),
        h('label.inline-field.big.grow', h('span', 'CONTRO'), textInput(m, 'opponent', changed, { placeholder: 'Avversario', label: 'Contro' })),
        h('label.inline-field.big', h('span', 'UNDER'), underSel)),
      h('details.optional', h('summary', 'Dettagli facoltativi (torneo, luogo, risultato)'),
        h('div.grid3',
          h('label.field', h('span.field-label', 'Torneo / concentramento'), textInput(m, 'tournament', changed)),
          h('label.field', h('span.field-label', 'Luogo'), textInput(m, 'location', changed)),
          h('label.field', h('span.field-label', 'Risultato'), textInput(m, 'result', changed, { placeholder: 'es. 5 mete a 3' })))),
    ));

    const totals = matchColumnTotals(m);
    const totalEls = [];
    const updateTotals = () => { const t = matchColumnTotals(m); totalEls.forEach((el, i) => { el.textContent = String(t[i]); }); };
    const customHead = textInput(m, 'customColumnLabel', changed, { placeholder: 'Colonna libera…', label: 'Intestazione colonna 8', cls: 'col-head-input' });
    customHead.addEventListener('change', () => rerender()); // aggiorna le etichette delle celle (vista a card)
    const heads = [...MATCH_COLUMNS.map((c) => h('span', c)), customHead];
    const table = h('div.sheet-table.t-match', { role: 'table', 'aria-label': 'Indicatori della partita' },
      h('div.tr.th', { role: 'row' }, h('div.td', { role: 'columnheader' }, 'Giocatore / periodo'), ...heads.map((x) => h('div.td', { role: 'columnheader' }, x)), h('div.td', '')));
    m.rows.forEach((r, i) => {
      const cells = r.values.map((v, j) => {
        const out = h('span.tally-value', String(toInt(v)));
        const set = (nv) => { r.values[j] = Math.max(0, nv); out.textContent = String(r.values[j]); out.classList.remove('bump'); void out.offsetWidth; out.classList.add('bump'); updateTotals(); changed(); };
        const colName = j < 7 ? MATCH_COLUMNS[j] : (m.customColumnLabel || 'Colonna 8');
        return h('div.td.tally', { 'data-label': colName },
          h('button.tally-plus', { type: 'button', 'aria-label': `più uno ${colName} riga ${i + 1}`, on: { click: () => set(toInt(r.values[j]) + 1) } }, out, h('span.plus-sign', '+')),
          h('button.tally-minus', { type: 'button', 'aria-label': `meno uno ${colName} riga ${i + 1}`, on: { click: () => set(toInt(r.values[j]) - 1) } }, '−'));
      });
      table.append(h('div.tr', { role: 'row' },
        h('div.td.row-label', { 'data-label': 'Riga' }, textInput(r, 'label', changed, { placeholder: `Riga ${i + 1}`, label: 'Etichetta riga ' + (i + 1), list: dlId })),
        ...cells,
        h('div.td.ctl', rowControls({ index: i, length: m.rows.length, label: 'riga',
          onMove: (d) => { moveItem(m.rows, i, d); changed(); rerender(); },
          onRemove: async () => {
            const blank = !r.label && r.values.every((v) => !toInt(v));
            if (!blank && !(await confirmDialog(`Rimuovere la riga ${i + 1}${r.label ? ' "' + r.label + '"' : ''}?`, { okText: 'Rimuovi', danger: true }))) return;
            removeItem(m.rows, i); changed(); rerender();
          } }))));
    });
    table.append(h('div.tr.totals', { role: 'row' }, h('div.td.row-label', h('strong', 'TOTALE')),
      ...totals.map((t, j) => { const el = h('strong', String(t)); totalEls.push(el); return h('div.td.tally-total', { 'data-label': 'Totale ' + (j < 7 ? MATCH_COLUMNS[j] : (m.customColumnLabel || 'colonna 8')) }, el); }),
      h('div.td', '')));

    body.append(h('datalist', { id: dlId }, players.map((p) => h('option', { value: p.name }))));
    body.append(h('section.sheet-section',
      table,
      h('div.table-foot', h('button.btn', { type: 'button', on: { click: () => { m.rows.push(newMatchRow()); changed(); rerender(); } } }, '+ Aggiungi riga')),
      h('label.field', h('span.field-label', 'Note'), textArea(m, 'notes', changed, { rows: 4, label: 'Note', cls: 'notes' })),
      h('div.num-players', h('label.inline-field.big', h('span', 'NUM. GIOCATORI'), numberInput(m, 'numPlayers', changed, { label: 'Numero giocatori schierati', placeholder: '—' }))),
      h('div.field', h('span.field-label', 'Schema / situazione di gioco (facoltativo)'), drawingCell(m, changed, { title: 'Partita ' + (m.opponent || '') })),
    ));
  }

  await render();
  return () => saver.dispose();
}
