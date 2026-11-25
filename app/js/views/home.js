// Home: elenco di allenamenti, partite e piani (R2) con lo stato di salvataggio di ogni scheda.
// Pensata per il telefono: un pulsante grande per creare, ricerca e filtri chiusi, azioni secondarie nel menu ⋯.
import { h, clear, confirmDialog, toast } from '../ui.js';
import * as repo from '../repo.js';
import * as sync from '../app-sync.js';
import { CATEGORIES, newSession, newMatch, newPlan, duplicateRecord, formatDateIT, sessionCategories, normalizeUnder, totalDuration, ordinalRoman } from '../model.js';
import { banners } from './banners.js';
import { moreMenu } from './common.js';

const TABS = {
  sedute: { kind: 'session', label: 'Allenamenti', newLabel: '+ Nuovo allenamento' },
  partite: { kind: 'match', label: 'Partite', newLabel: '+ Nuova partita' },
  piani: { kind: 'plan', label: 'Piani', newLabel: '+ Nuovo piano' },
};

function recCats(r) {
  if (r.kind === 'session') return sessionCategories(r);
  if (r.kind === 'match') return r.under ? [normalizeUnder(r.under)] : [];
  if (r.kind === 'plan') return r.category ? [r.category] : [];
  return [];
}
function recDate(r) { return r.kind === 'plan' ? (r.season || '') + ' ' + r.term : r.date || ''; }

function openHref(r) {
  if (r.kind === 'session') return `#/seduta/${r.id}/foglio`;
  if (r.kind === 'match') return `#/partita/${r.id}`;
  return `#/piano/${r.id}`;
}

export async function homeView(root, params, query) {
  const tab = TABS[query.get('t')] ? query.get('t') : 'sedute';
  const conf = TABS[tab];
  const filters = { cat: query.get('cat') || '', sort: query.get('sort') || 'desc', q: '' };

  root.append(await banners());
  root.append(h('nav.tabs.home-tabs', { 'aria-label': 'Archivio' },
    ...Object.entries(TABS).map(([k, t]) => h('a.tab' + (k === tab ? '.on' : ''), { href: '#/?t=' + k, 'aria-current': k === tab ? 'page' : null }, t.label))));

  const catSel = h('select.input', { 'aria-label': 'Filtra per categoria' }, h('option', { value: '' }, 'Tutte le categorie'), CATEGORIES.map((c) => h('option', { value: c, selected: filters.cat === c }, c)));
  const sortSel = h('select.input', { 'aria-label': 'Ordina' }, h('option', { value: 'desc', selected: filters.sort === 'desc' }, 'Più recenti prima'), h('option', { value: 'asc', selected: filters.sort === 'asc' }, 'Meno recenti prima'));
  const search = h('input.input', { type: 'search', placeholder: 'Cerca…', 'aria-label': 'Cerca' });
  const from = h('input.input.date-filter', { type: 'date', 'aria-label': 'Dalla data', title: 'Dalla data' });
  const to = h('input.input.date-filter', { type: 'date', 'aria-label': 'Alla data', title: 'Alla data' });
  const dateFilters = conf.kind === 'plan' ? null : h('span.date-range', h('span', 'dal'), from, h('span', 'al'), to);
  for (const el of [from, to]) el.addEventListener('change', () => { filters.from = from.value; filters.to = to.value; renderList(); });
  const listEl = h('div.rec-list');
  root.append(h('div.list-toolbar.home-toolbar',
    h('button.btn.primary.big.new-btn', { type: 'button', on: { click: create } }, conf.newLabel),
    h('details.filters-box', h('summary.btn', { role: 'button' }, '🔍 Cerca'), h('div.filters', search, catSel, dateFilters, sortSel))), listEl);
  for (const el of [catSel, sortSel]) el.addEventListener('change', () => { filters.cat = catSel.value; filters.sort = sortSel.value; renderList(); });
  search.addEventListener('input', () => { filters.q = search.value.trim().toLowerCase(); renderList(); });

  async function create() {
    const rec = conf.kind === 'session' ? newSession() : conf.kind === 'match' ? newMatch() : newPlan();
    if (conf.kind === 'plan') {
      const existing = await repo.list('plan');
      rec.title = `${ordinalRoman((existing.length % 4) + 1)} TRIMESTRE`;
      rec.term = (existing.length % 4) + 1;
    }
    await repo.save(rec);
    location.hash = openHref(rec);
  }

  async function renderList() {
    const all = await repo.list(conf.kind);
    const entries = new Map((await sync.allEntries()).map((e) => [e.key, e]));
    let items = all.filter((r) => !filters.cat || recCats(r).includes(filters.cat));
    if (filters.from) items = items.filter((r) => (r.date || '') >= filters.from);
    if (filters.to) items = items.filter((r) => (r.date || '') <= filters.to);
    if (filters.q) items = items.filter((r) => JSON.stringify([r.title, r.opponent, r.location, r.date, (r.planItems || []).map((p) => p.name)]).toLowerCase().includes(filters.q));
    items.sort((a, b) => {
      const c = recDate(a).localeCompare(recDate(b)) || (a.updatedAt || '').localeCompare(b.updatedAt || '');
      return filters.sort === 'asc' ? c : -c;
    });
    clear(listEl);
    if (!items.length) {
      listEl.append(h('div.empty-state', h('p', all.length ? 'Nessun risultato con questi filtri.' : `Ancora nessun${conf.kind === 'match' ? 'a partita' : conf.kind === 'plan' ? ' piano' : ' allenamento'}.`),
        all.length ? null : h('p.hint', `Tocca "${conf.newLabel}" per iniziare.`)));
      return;
    }
    for (const r of items) {
      const lab = sync.statusLabel(entries.get(`${r.kind}:${r.id}`));
      let title, meta;
      if (r.kind === 'session') {
        title = formatDateIT(r.date) || 'Senza data';
        const names = r.planItems.map((p) => p.name).filter(Boolean);
        meta = [recCats(r).join(' '), totalDuration(r) ? totalDuration(r) + ' min' : '', names.slice(0, 4).join(', ') + (names.length > 4 ? '…' : '')].filter(Boolean).join(' · ');
      } else if (r.kind === 'match') {
        title = `${formatDateIT(r.date) || 'Senza data'}${r.opponent ? ' — contro ' + r.opponent : ''}`;
        meta = [recCats(r).join(' '), r.tournament, r.result].filter(Boolean).join(' · ');
      } else {
        title = r.title || 'Piano';
        meta = [r.category, r.season, `${r.sessions.length} allenamenti`].filter(Boolean).join(' · ');
      }
      listEl.append(h('article.rec-card',
        h('a.rec-main', { href: openHref(r) },
          h('strong.rec-title', title),
          h('span.rec-meta', meta || ' '),
          h('span.rec-badges', r.example ? h('span.badge.example', 'esempio') : null, h('span.status-pill.' + lab.cls, { title: lab.title }, lab.text))),
        moreMenu([
          r.kind === 'session' ? h('a.btn', { href: `#/seduta/${r.id}/osservazione` }, '👁 Scheda di osservazione') : null,
          h('button.btn', { type: 'button', on: { click: async () => { const d = duplicateRecord(r); if (d.kind === 'session' || d.kind === 'match') d.date = r.date; await repo.save(d); toast('Copia creata.', 'ok'); renderList(); } } }, '⧉ Duplica'),
          h('button.btn.danger', { type: 'button', on: { click: async () => {
            const msg = sync.state.folder ? 'Eliminare questa scheda dal telefono? Il documento già salvato su Drive resta.' : 'Eliminare definitivamente questa scheda?';
            if (!(await confirmDialog(msg, { okText: 'Elimina', danger: true }))) return;
            await repo.remove(r.kind, r.id); toast('Eliminata.', 'ok'); renderList();
          } } }, '🗑 Elimina'),
        ], { label: '⋯' })));
    }
  }
  await renderList();
  const onEntry = () => { if (listEl.isConnected) renderList(); else repo.bus.removeEventListener('sync-state', onEntry); };
  repo.bus.addEventListener('sync-state', onEntry);
  return () => repo.bus.removeEventListener('sync-state', onEntry);
}
