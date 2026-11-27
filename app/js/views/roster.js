// Rosa per categoria (decisione 4): nomi inseriti una volta e scelti da elenco nelle schede.
import { h, clear, textInput, confirmDialog, toast, debounce } from '../ui.js';
import * as repo from '../repo.js';
import { CATEGORIES, newPlayer, visibleCategories } from '../model.js';
import { pageHeader, confirmDelete, scopeFilter, matchScope, newScopeFrom, scopeBar, confirmRosterShare, myCategories, moreMenu } from './common.js';
import * as sync from '../app-sync.js';
import { scopeOf } from '../model.js';

export async function rosterView(root, params, query) {
  // categoria: quella chiesta, altrimenti l'ultima vista se è tra le mie (Impostazioni › Le mie categorie), altrimenti la prima delle mie
  const mine = myCategories();
  const last = ((await repo.getSetting('prefs', {})) || {}).rosterCat;
  const cat = CATEGORIES.includes(query.get('cat')) ? query.get('cat') : mine.includes(last) ? last : mine.includes('U8') && mine.length === CATEGORIES.length ? 'U8' : mine[0];
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
  root.append(h('nav.tabs', { 'aria-label': 'Categorie' }, visibleCategories(mine, cat).map((c) => h('a.tab' + (c === cat ? '.on' : ''), { href: '#/rosa?cat=' + c }, c))));
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
    for (const p of players) listEl.append(editing === p.id ? editRow(p) : playerRow(p));
  }

  // Riga semplice: solo numero (se c'è) e nome. Tocco sul nome o "⋯ › Modifica" apre i campi sotto.
  let editing = null;
  const openEdit = (id) => { editing = id; render().then(() => { const el = listEl.querySelector('.player-edit input[aria-label="Nome"]'); if (el) el.focus(); }); };
  const removePlayer = async (p) => {
    if (!(await confirmDelete(`${p.name || 'Giocatore'} (rosa)`))) return;
    if (editing === p.id) editing = null;
    await repo.remove('player', p.id); render();
  };
  function playerRow(p) {
    return h('div.player-row',
      h('button.player-main', { type: 'button', 'aria-label': 'Modifica ' + (p.name || 'giocatore'), on: { click: () => openEdit(p.id) } },
        h('span.player-num', p.number ? String(p.number) : ''),
        h('span.player-name', p.name || '(senza nome)')),
      moreMenu([
        h('button.btn', { type: 'button', on: { click: () => openEdit(p.id) } }, '✎ Modifica'),
        h('button.btn.danger', { type: 'button', on: { click: () => removePlayer(p) } }, '🗑 Elimina'),
      ], { label: '⋯', ariaLabel: 'Altre azioni per ' + (p.name || 'giocatore') }));
  }
  function editRow(p) {
    const save = debounce(() => repo.save(p), 400);
    const catSel = h('select.input', { 'aria-label': 'Categoria' }, visibleCategories(mine, p.category).map((c) => h('option', { value: c, selected: c === p.category }, c)));
    catSel.addEventListener('change', async () => { save.flush(); p.category = catSel.value; await repo.save(p); toast(`${p.name} spostato in ${p.category}.`, 'ok'); editing = null; render(); });
    const done = async () => { save.flush(); editing = null; render(); };
    const box = h('div.player-edit', { role: 'group', 'aria-label': 'Modifica ' + (p.name || 'giocatore') },
      h('div.player-edit-fields',
        h('label.field.num-field', h('span.field-label', 'Numero'), textInput(p, 'number', save, { label: 'Numero', cls: 'num' })),
        h('label.field', h('span.field-label', 'Nome'), textInput(p, 'name', save, { label: 'Nome' })),
        h('label.field', h('span.field-label', 'Categoria'), catSel)),
      scopeOf(p) || sync.activeGroups().length ? scopeBar(p) : null,
      h('div.player-edit-actions',
        h('button.btn.danger', { type: 'button', on: { click: () => removePlayer(p) } }, '🗑 Elimina'),
        h('button.btn.primary', { type: 'button', on: { click: done } }, '✓ Fine')));
    box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); done(); } });
    return box;
  }
  await render();
  // novità ricevute da un altro dispositivo (senza disturbare chi sta scrivendo un nome)
  const onImported = () => { if (listEl.isConnected && !listEl.contains(document.activeElement)) render(); };
  repo.bus.addEventListener('imported', onImported);
  return () => repo.bus.removeEventListener('imported', onImported);
}
