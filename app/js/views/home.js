// Home: elenco di allenamenti, partite e piani (R2) con lo stato di salvataggio di ogni scheda.
// Pensata per il telefono: un pulsante grande per creare, ricerca e filtri chiusi, azioni secondarie nel menu ⋯.
import { h, clear } from '../ui.js';
import * as repo from '../repo.js';
import * as sync from '../app-sync.js';
import { CATEGORIES, sanitizeModules, newSession, newMatch, newPlan, formatDateIT, sessionCategories, normalizeUnder, totalDuration, ordinalRoman } from '../model.js';
import { banners } from './banners.js';
import { moreMenu, openPrepared, scopeFilter, matchScope, newScopeFrom, groupBadge, recordMenuItems, viewHref, editHref } from './common.js';

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

// Toccare una scheda la apre in lettura; la modifica si apre da "✎ Modifica" (o subito, per le schede nuove)
const openHref = (r) => viewHref(r);

export async function homeView(root, params, query) {
  const tab = TABS[query.get('t')] ? query.get('t') : 'sedute';
  const conf = TABS[tab];
  const filters = { cat: query.get('cat') || '', sort: query.get('sort') || 'desc', q: '' };
  // filtro rapido per gruppo (ricordato); "?gruppo=<id>" arriva dall'ingresso in un gruppo
  const prefs0 = (await repo.getSetting('prefs', {})) || {};
  filters.scope = query.get('gruppo') || prefs0.scopeFilter || 'all';
  if (filters.scope !== 'all' && filters.scope !== 'personal' && !sync.groupById(filters.scope)) filters.scope = 'all';

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
  const scopeBox = h('div.scope-box');
  const drawScope = () => { clear(scopeBox); const f = scopeFilter(filters.scope, async (v) => { filters.scope = v; const p = (await repo.getSetting('prefs', {})) || {}; await repo.setSetting('prefs', { ...p, scopeFilter: v }); drawScope(); renderList(); }); if (f) scopeBox.append(f); };
  drawScope();
  root.append(scopeBox);
  root.append(h('div.list-toolbar.home-toolbar',
    h('button.btn.primary.big.new-btn', { type: 'button', on: { click: create } }, conf.newLabel),
    h('details.filters-box', h('summary.btn', { role: 'button' }, '🔍 Cerca'), h('div.filters', search, catSel, dateFilters, sortSel))), listEl);
  for (const el of [catSel, sortSel]) el.addEventListener('change', () => { filters.cat = catSel.value; filters.sort = sortSel.value; renderList(); });
  search.addEventListener('input', () => { filters.q = search.value.trim().toLowerCase(); renderList(); });

  async function create() {
    sync.renewInGesture(); // accesso scaduto: si rinnova nel tocco (subito, prima di ogni attesa)
    const prefs = (await repo.getSetting('prefs', {})) || {};
    const rec = conf.kind === 'session' ? newSession(prefs.defaultModules ? { modules: sanitizeModules(prefs.defaultModules) } : {}) : conf.kind === 'match' ? newMatch() : newPlan();
    if (conf.kind === 'plan') {
      const existing = await repo.list('plan');
      rec.title = `${ordinalRoman((existing.length % 4) + 1)} TRIMESTRE`;
      rec.term = (existing.length % 4) + 1;
    }
    const gid = newScopeFrom(filters.scope); // dall'elenco di un gruppo: la scheda nasce nel gruppo
    if (gid) rec.groupId = gid;
    if (conf.kind === 'session') repo.startDraft(rec); // vuoto: si salva solo quando l'utente scrive qualcosa
    else await repo.save(rec);
    await openPrepared(editHref(rec));
  }

  let renderToken = 0;
  async function renderList() {
    const my = ++renderToken;
    const all = await repo.list(conf.kind);
    const entries = new Map((await sync.allEntries()).map((e) => [e.key, e]));
    if (my !== renderToken) return; // è già partito un aggiornamento più recente dell'elenco
    const gdirty = (await repo.getSetting('gdirty', {})) || {};
    if (my !== renderToken) return;
    let items = all.filter((r) => matchScope(r, filters.scope) && (!filters.cat || recCats(r).includes(filters.cat)));
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
      const gpart = r.kind === 'plan' ? 'plans' : 'sheets';
      const lab = r.groupId && sync.groupById(r.groupId)
        ? (((gdirty[r.groupId] || {})[gpart]) ? { text: 'Da inviare al gruppo', cls: 'pending', title: '' } : { text: 'Nel gruppo ✓', cls: 'synced', title: '' })
        : sync.statusLabel(entries.get(`${r.kind}:${r.id}`));
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
      if (r.conflict && r.kind !== 'plan') title += ' (' + r.conflict + ')';
      listEl.append(h('article.rec-card',
        h('a.rec-main', { href: openHref(r), on: { click: () => { sync.renewInGesture(); } } },
          h('strong.rec-title', title),
          h('span.rec-meta', meta || ' '),
          h('span.rec-badges', r.example ? h('span.badge.example', 'esempio') : null, groupBadge(r), h('span.status-pill.' + lab.cls, { title: lab.title }, lab.text))),
        moreMenu(recordMenuItems(r, { title, onDuplicated: () => renderList(), onDeleted: () => renderList() }), { label: '⋯' })));
    }
  }
  await renderList();
  // aggiornamento dell'elenco (novità ricevute, stato di salvataggio): mai mentre un menu ⋯ o una finestra è
  // aperta, si rimanda alla chiusura
  let deferred = false;
  const busyUI = () => !!(listEl.querySelector('details[open]') || document.querySelector('dialog[open]'));
  const onEntry = () => {
    if (!listEl.isConnected) { off(); return; }
    if (busyUI()) { deferred = true; return; }
    renderList();
  };
  const onClose = () => { if (deferred && listEl.isConnected && !busyUI()) { deferred = false; renderList(); } };
  const onCloseLater = () => setTimeout(onClose, 0);
  repo.bus.addEventListener('sync-state', onEntry);
  repo.bus.addEventListener('imported', onEntry);
  listEl.addEventListener('toggle', onCloseLater, true);
  document.addEventListener('close', onCloseLater, true);
  function off() {
    repo.bus.removeEventListener('sync-state', onEntry); repo.bus.removeEventListener('imported', onEntry);
    listEl.removeEventListener('toggle', onCloseLater, true); document.removeEventListener('close', onCloseLater, true);
  }
  return off;
}
