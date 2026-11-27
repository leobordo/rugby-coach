// Pagine di sola lettura (allenamento, partita, piano, esercizio): si aprono toccando una scheda.
// Niente campi da compilare: solo quello che è scritto, con titoli chiari. Si modifica con "✎ Modifica".
// I testi dell'utente passano sempre da h() (textContent): mai innerHTML.
import { h, clear } from '../ui.js';
import * as repo from '../repo.js';
import * as sync from '../app-sync.js';
import {
  CATEGORIES, MATCH_COLUMNS, OBSERVATION_LEVELS, ERRORS_CORRECTED_LABEL, WORK_TIME_OPTIONS, SOLICITATION_OPTIONS, BLOCK_TYPES,
  formatDateIT, sessionCategories, totalDuration, totalAttendance, matchColumnTotals, reviewRowLabel, normalizeUnder, ordinalRoman,
  toInt, isBlankValue, isBlankPlanItem, isBlankObservation, isBlankReviewRow, moduleHasData, syncReviewRows,
} from '../model.js';
import { pageHeader, docActions, moreMenu, recordMenuItems, statusPill, drawingSrc, groupBadge, editHref, listHref, viewHref } from './common.js';
import { createSheetFromPlan } from './plan.js';

const LABELS = { session: 'Allenamento', match: 'Partita', plan: 'Piano', exercise: 'Esercizio' };
const NOT_FOUND = { session: 'Allenamento non trovato.', match: 'Partita non trovata.', plan: 'Piano non trovato.', exercise: 'Esercizio non trovato.' };

// ---------- mattoni ----------
const has = (v) => !isBlankValue(v);
// testo libero: gli a capo restano (CSS white-space: pre-wrap)
const text = (v) => h('p.read-text', String(v));
function field(label, value, cls = '') {
  if (!has(value)) return null;
  return h('div.read-field' + cls, h('h4.read-label', label), Array.isArray(value) ? chips(value) : text(value));
}
const chips = (list) => h('div.read-chips', list.filter(has).map((k) => h('span.read-chip', String(k))));
function facts(pairs) {
  const items = pairs.filter(([, v]) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length));
  return items.length ? h('dl.read-facts', items.map(([k, v]) => h('div', h('dt', k), h('dd', v instanceof Node ? v : String(v))))) : null;
}
function drawing(d, title) {
  const src = drawingSrc(d);
  return src ? h('figure.read-drawing', h('img', { src, alt: 'Disegno: ' + (title || '') })) : null;
}
const section = (title, ...children) => h('section.read-section', h('h2.read-title', title), ...children);
const yesNoText = (v) => (v === 'yes' ? 'Sì' : v === 'no' ? 'No' : '—');
const optLabel = (opts, v) => (opts.find((o) => String(o.value) === String(v)) || {}).label || '';

// ---------- pagina comune: intestazione con Modifica e menu ⋯, aggiornamento automatico ----------
function readPage(root, kind, id, build) {
  let rec = null;
  const body = h('div.read-body');
  const draw = async () => {
    rec = await repo.get(kind, id);
    clear(root);
    if (!rec) { root.append(h('p.empty', NOT_FOUND[kind]), h('a.btn', { href: listHref(kind) }, '← Torna all\'elenco')); return; }
    const { title, sub } = build.head(rec);
    const editBtn = h('a.btn.primary.big.edit-btn', { href: editHref(rec), on: { click: () => { sync.renewInGesture(); } } }, '✎ Modifica');
    const items = recordMenuItems(rec, { title });
    const actions = kind === 'exercise'
      ? [statusPill(kind, id), editBtn, moreMenu(items, { label: '⋯ Altro' })]
      : [statusPill(kind, id), editBtn, ...docActions(rec, null, { extra: [items[0], items[2]] })];
    clear(body);
    await build.body(body, rec);
    root.append(pageHeader(title, { sub, back: listHref(kind), actions }), body);
  };
  // novità da un altro dispositivo o dal gruppo: la pagina si ridisegna da sola
  let timer = null;
  const later = () => { clearTimeout(timer); timer = setTimeout(() => { if (root.isConnected) draw(); }, 150); };
  const onChange = (ev) => { const d = ev.detail || {}; if ((d.kind === kind && d.id === id) || (ev.type === 'imported' && d.kind === kind)) later(); };
  const events = ['saved', 'remote-update', 'remote-applied', 'removed', 'imported'];
  for (const e of events) repo.bus.addEventListener(e, onChange);
  return draw().then(() => () => { clearTimeout(timer); for (const e of events) repo.bus.removeEventListener(e, onChange); });
}

// ---------- allenamento ----------
export function sessionRead(root, { id }) {
  return readPage(root, 'session', id, {
    head: (s) => ({ title: 'Allenamento', sub: [formatDateIT(s.date), sessionCategories(s).join(' · ')].filter(Boolean).join(' — ') }),
    async body(body, s) {
      syncReviewRows(s);
      const plan = s.termPlanRef ? await repo.get('plan', s.termPlanRef.termPlanId) : null;
      body.append(h('div.read-head',
        facts([['Data', formatDateIT(s.date)], ['Categorie', sessionCategories(s).join(' · ')], ['Luogo', s.location],
          ['Durata', totalDuration(s) ? totalDuration(s) + ' min' : ''], ['Dove si trova', groupBadge(s)]]),
        plan ? h('p.hint', 'Dal piano ', h('a', { href: viewHref(plan) }, `${plan.title} — allenamento ${ordinalRoman((s.termPlanRef.sessionIndex || 0) + 1)}`)) : null));
      for (const m of s.modules) {
        if (m !== 'program' && !moduleHasData(s, m)) continue; // sezioni vuote: non si mostrano
        body.append(SESSION_BLOCKS[m](s));
      }
    },
  });
}

const SESSION_BLOCKS = {
  program(s) {
    const items = s.planItems.filter((p) => !isBlankPlanItem(p));
    if (!items.length) return section('Programma della seduta', h('p.read-empty', 'Nessun esercizio.'));
    return section('Programma della seduta', h('ol.read-list', items.map((p, i) => h('li.read-card',
      h('div.read-card-head', h('span.row-num', String(i + 1)), h('h3', p.name || 'Esercizio ' + (i + 1)), toInt(p.durationMin) ? h('span.read-badge', toInt(p.durationMin) + ' min') : null),
      h('div.read-card-body',
        h('div.read-card-text',
          field('Descrizione / regole', p.description), field('Materiale e spazio', p.materialsSpace), field('Obiettivi', p.objectives),
          field('Parole chiave', p.keywords), field('Cosa osservo', p.toObserve)),
        drawing(p.drawing, p.name))))));
  },
  attendance(s) {
    const cats = CATEGORIES.filter((c) => s.attendance[c] !== null && s.attendance[c] !== undefined && s.attendance[c] !== '');
    return section('Presenze', h('div.read-attendance',
      cats.map((c) => h('div.read-att', h('span', c), h('strong', String(toInt(s.attendance[c]))))),
      h('div.read-att.total', h('span', 'Totale'), h('strong', String(totalAttendance(s))))));
  },
  observation(s) {
    const rows = s.observations.filter((o) => !isBlankObservation(o));
    return section('Osservazione esercizi', h('ol.read-list', rows.map((o, i) => h('li.read-card',
      h('div.read-card-head', h('span.row-num', String(i + 1)), h('h3', o.name || 'Esercizio ' + (i + 1))),
      h('div.read-card-body',
        h('div.read-card-text',
          field('Descrizione', o.description), field('Obiettivo', o.objective),
          field('Cosa va bene', o.positive, '.pos'), field('Cosa non va', o.negative, '.neg'), field('Miglioramenti da apportare', o.improvements)),
        drawing(o.drawing, o.name))))));
  },
  review(s) {
    const rows = s.review.perExercise.filter((r) => !['overall', 'individual'].every((f) => isBlankValue(r[f])) || (!r.ref && !isBlankReviewRow(r)));
    return section('Bilancio della seduta', h('div.read-rows', rows.map((r) => {
      const lab = reviewRowLabel(s, r);
      return h('div.read-row', h('h3', r.ref ? `${lab.num}. ${lab.name || '(senza nome)'}` : (r.label || 'Nota')),
        field('Complessivamente', r.overall), field('Individualmente', r.individual));
    })));
  },
  errors(s) {
    const qs = s.review.errorsCauses.filter((q) => q.answer || has(q.note));
    return section('Errori e cause', h('ol.read-qa', qs.map((q) => h('li',
      h('span.read-q', q.question), h('strong.read-a.' + (q.answer || 'none'), yesNoText(q.answer)), has(q.note) ? h('span.read-note', String(q.note)) : null))));
  },
  selfeval(s) {
    const rv = s.review;
    const lvl = OBSERVATION_LEVELS.find((l) => String(l.value) === String(rv.observationLevel));
    return section('La seduta di allenamento x me', facts([['Livello di osservazione', lvl ? `${lvl.value} — ${lvl.label}` : ''],
      [ERRORS_CORRECTED_LABEL, rv.errorsCorrectedWell ? yesNoText(rv.errorsCorrectedWell) : ''], ['Osservatore', rv.observer]]));
  },
  trainer(s) {
    const rv = s.review;
    return section('Con preparatore atletico', facts([['Rapporto tempo di lavoro', optLabel(WORK_TIME_OPTIONS, rv.workTimeRatio)],
      ['N° di sollecitazioni', [toInt(rv.solicitationsCount) || '', optLabel(SOLICITATION_OPTIONS, rv.solicitations)].filter(Boolean).join(' · ')],
      ['Preparatore atletico', rv.trainer]]));
  },
};

// ---------- partita ----------
export function matchRead(root, { id }) {
  return readPage(root, 'match', id, {
    head: (m) => ({ title: 'Partita', sub: [formatDateIT(m.date), m.opponent ? 'contro ' + m.opponent : '', m.under ? normalizeUnder(m.under) : ''].filter(Boolean).join(' — ') }),
    body(body, m) {
      body.append(h('div.read-head', facts([['Data', formatDateIT(m.date)], ['Contro', m.opponent], ['Under', m.under ? normalizeUnder(m.under) : ''],
        ['Torneo / concentramento', m.tournament], ['Luogo', m.location], ['Risultato', m.result],
        ['Giocatori schierati', toInt(m.numPlayers) ? String(toInt(m.numPlayers)) : ''], ['Dove si trova', groupBadge(m)]])));
      const cols = [...MATCH_COLUMNS, m.customColumnLabel || 'Colonna 8'];
      const used = cols.map((_, j) => m.rows.some((r) => toInt(r.values[j])) || (j === 7 && has(m.customColumnLabel)));
      const show = cols.map((c, j) => ({ c, j })).filter((x) => x.j < 7 || used[x.j]);
      const totals = matchColumnTotals(m);
      const rows = m.rows.filter((r) => has(r.label) || r.values.some((v) => toInt(v)));
      body.append(section('Indicatori della partita', rows.length
        ? h('div.read-table-wrap', h('table.read-table',
          h('thead', h('tr', h('th', 'Giocatore / periodo'), show.map(({ c }) => h('th', c)))),
          h('tbody', rows.map((r, i) => h('tr', h('th', { scope: 'row' }, r.label || 'Riga ' + (i + 1)),
            show.map(({ c, j }) => h('td', { 'data-label': c }, String(toInt(r.values[j]))))))),
          h('tfoot', h('tr', h('th', { scope: 'row' }, 'TOTALE'), show.map(({ c, j }) => h('td', { 'data-label': c }, String(totals[j])))))))
        : h('p.read-empty', 'Nessun numero segnato.')));
      if (has(m.notes)) body.append(section('Note', text(m.notes)));
      const d = drawing(m.drawing, 'Partita');
      if (d) body.append(section('Schema / situazione di gioco', d));
    },
  });
}

// ---------- piano ----------
export function planRead(root, { id }) {
  return readPage(root, 'plan', id, {
    head: (p) => ({ title: p.title || 'Piano', sub: [p.category, p.season].filter(Boolean).join(' — ') }),
    body(body, p) {
      body.append(h('div.read-head', facts([['Trimestre', p.term ? ordinalRoman(p.term) + ' trimestre' : ''], ['Categoria', p.category],
        ['Stagione', p.season], ['Dove si trova', groupBadge(p)]])));
      const goals = [field('Obiettivi educativi', p.educationalGoals), field('Obiettivi didattici', p.didacticGoals)].filter(Boolean);
      if (goals.length) body.append(section('Obiettivi', ...goals));
      body.append(section('Allenamenti', p.sessions.length ? h('div.read-plan', p.sessions.map((ps, si) => {
        const mins = ps.blocks.reduce((a, b) => a + toInt(b.durationMin), 0);
        return h('article.read-card',
          h('div.read-card-head', h('h3', 'Allenamento ' + ordinalRoman(si + 1)), mins ? h('span.read-badge', mins + ' min') : null,
            h('button.btn.small.primary', { type: 'button', on: { click: () => createSheetFromPlan(p, si) } }, '→ Crea foglio allenamento')),
          ps.blocks.length ? h('ol.read-blocks', ps.blocks.map((b) => h('li.read-block.block-' + b.type.toLowerCase(),
            h('span.read-block-type', (BLOCK_TYPES[b.type] || {}).label || ''),
            b.type === 'PAUSA' ? h('strong', 'PAUSA') : h('strong', b.title || ''),
            toInt(b.durationMin) ? h('span.read-badge', toInt(b.durationMin) + ' min') : null,
            b.type === 'RISCALDAMENTO' && (b.subItems || []).some(has) ? h('ul.read-sub', b.subItems.filter(has).map((x) => h('li', String(x)))) : null)))
            : h('p.read-empty', 'Nessun blocco.'),
          field('Note', ps.notes));
      })) : h('p.read-empty', 'Nessun allenamento.')));
    },
  });
}

// ---------- esercizio della libreria ----------
export function exerciseRead(root, { id }) {
  return readPage(root, 'exercise', id, {
    head: (e) => ({ title: e.name || 'Esercizio senza nome', sub: [(e.categories || []).join(' '), toInt(e.durationMin) ? toInt(e.durationMin) + ' min' : ''].filter(Boolean).join(' — ') }),
    body(body, e) {
      body.append(h('div.read-exercise',
        h('div.read-card-text',
          facts([['Categorie adatte', (e.categories || []).join(' · ')], ['Durata tipica', toInt(e.durationMin) ? toInt(e.durationMin) + ' min' : ''],
            ['Spazio', e.space], ['Dove si trova', groupBadge(e)]]),
          field('Descrizione / regole', e.description), field('Obiettivi', e.objectives), field('Parole chiave', e.keywords), field('Materiale', e.materials),
          [e.description, e.objectives, e.keywords, e.materials].some(has) ? null : h('p.read-empty', 'Ancora nessuna descrizione: tocca "✎ Modifica" per completarlo.')),
        drawing(e.drawing, e.name) || h('div.ex-thumb.none.read-nodrawing', 'Nessun disegno')));
    },
  });
}
