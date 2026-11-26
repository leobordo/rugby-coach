// Rosa per categoria (decisione 4): nomi inseriti una volta e scelti da elenco nelle schede.
import { h, clear, textInput, confirmDialog, toast, debounce } from '../ui.js';
import * as repo from '../repo.js';
import { CATEGORIES, newPlayer } from '../model.js';
import { pageHeader, confirmDelete, scopeFilter, matchScope, newScopeFrom, scopeBar, confirmRosterShare } from './common.js';
import * as sync from '../app-sync.js';
import { scopeOf } from '../model.js';

export async function rosterView(root, params, query) {
  const cat = CATEGORIES.includes(query.get('cat')) ? query.get('cat') : ((await repo.getSetting('prefs', {})) || {}).rosterCat || 'U8';
  const prefs0 = (await repo.getSetting('prefs', {})) || {};
  let scope = prefs0.scopeFilter || 'all';
  if (scope !== 'all' && scope !== 'personal' && !sync.groupById(scope)) scope = 'all';
  root.append(pageHeader('Rosa', { sub: sync.activeGroups().length
    ? 'I nomi personali restano sul dispositivo e nel tuo Google Drive; quelli di un gruppo li vedono gli allenatori del gruppo.'
    : 'I nomi restano sul dispositivo e, se lo colleghi, sul tuo Google Drive. Nessun altro servizio li riceve.' }));
  const scopeBox = h('div.scope-box');
  const drawScope = () => { clear(scopeBox); const f = scopeFilter(scope, async (v) => { scope = v; const p = (await repo.getSetting('prefs', {})) || {}; await repo.setSetting('prefs', { ...p, scopeFilter: v }); drawScope(); render(); }); if (f) scopeBox.append(f); };
  drawScope();
  root.append(scopeBox);
  root.append(h('nav.tabs', { 'aria-label': 'Categorie' }, CATEGORIES.map((c) => h('a.tab' + (c === cat ? '.on' : ''), { href: '#/rosa?cat=' + c }, c))));
  const listEl = h('div.roster');
  const nameIn = h('input.input', { type: 'text', placeholder: 'Nome e cognome (o solo nome)', 'aria-label': 'Nome nuovo giocatore', enterkeyhint: 'done' });
  const numIn = h('input.input.num', { type: 'text', inputmode: 'numeric', placeholder: 'N°', 'aria-label': 'Numero (facoltativo)', maxlength: 3 });
  const add = async () => {
    const names = nameIn.value.split(/\n|;/).map((x) => x.trim()).filter(Boolean);
    if (!names.length) { nameIn.focus(); return; }
    const num = names.length === 1 ? numIn.value.trim() : '';
    const gid = newScopeFrom(scope); // dall'elenco di un gruppo: il giocatore entra nella rosa del gruppo
    if (gid && !(await confirmRosterShare(gid))) return;
    nameIn.value = ''; numIn.value = ''; nameIn.focus();
    for (const n of names) await repo.save(newPlayer({ category: cat, name: n, number: num, ...(gid ? { groupId: gid } : {}) }));
    render();
  };
  nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  root.append(h('div.sheet',
    h('div.add-player', nameIn, numIn, h('button.btn.primary', { type: 'button', on: { click: add } }, '+ Aggiungi')),
    listEl));
  const prefs = (await repo.getSetting('prefs', {})) || {};
  if (prefs.rosterCat !== cat) await repo.setSetting('prefs', { ...prefs, rosterCat: cat });

  let renderToken = 0;
  async function render() {
    const my = ++renderToken;
    const players = (await repo.list('player')).filter((p) => p.category === cat && matchScope(p, scope)).sort((a, b) => a.name.localeCompare(b.name, 'it'));
    if (my !== renderToken) return; // un render più recente è già partito
    clear(listEl);
    listEl.append(h('p.hint', `${players.length} ${players.length === 1 ? 'giocatore' : 'giocatori'} in ${cat}`));
    for (const p of players) {
      const save = debounce(() => repo.save(p), 400);
      const catSel = h('select.input.small', { 'aria-label': 'Sposta in categoria' }, CATEGORIES.map((c) => h('option', { value: c, selected: c === p.category }, c)));
      catSel.addEventListener('change', async () => { p.category = catSel.value; await repo.save(p); toast(`${p.name} spostato in ${p.category}.`, 'ok'); render(); });
      listEl.append(h('div.player-row',
        textInput(p, 'number', save, { label: 'Numero', cls: 'num' }),
        textInput(p, 'name', save, { label: 'Nome' }),
        catSel,
        scopeOf(p) || sync.activeGroups().length ? scopeBar(p) : null,
        h('button.icon-btn.danger', { type: 'button', 'aria-label': 'Rimuovi ' + p.name, on: { click: async () => {
          if (!(await confirmDelete(`${p.name || 'Giocatore'} (rosa)`))) return;
          await repo.remove('player', p.id); render();
        } } }, '✕')));
    }
  }
  await render();
  // novità ricevute da un altro dispositivo (senza disturbare chi sta scrivendo un nome)
  const onImported = () => { if (listEl.isConnected && !listEl.contains(document.activeElement)) render(); };
  repo.bus.addEventListener('imported', onImported);
  return () => repo.bus.removeEventListener('imported', onImported);
}
