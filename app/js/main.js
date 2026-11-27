// Avvio dell'app: database, seed, sync, router (hash) e service worker.
import { h, clear, toast } from './ui.js';
import * as repo from './repo.js';
import * as sync from './app-sync.js';
import { flushAll, setPreparer } from './views/common.js';
import { homeView } from './views/home.js';
import { sessionView } from './views/session.js';
import { matchView } from './views/match.js';
import { planView } from './views/plan.js';
import { libraryView, exerciseView } from './views/library.js';
import { rosterView } from './views/roster.js';
import { settingsView, onboardingView } from './views/settings.js';
import { docView } from './views/docs.js';
import { groupView, joinView } from './views/groups.js';
import { groupNewsText } from './groups.js';

const routes = [
  [/^\/?$/, (r, m, q) => homeView(r, {}, q), 'home'],
  [/^\/seduta\/([^/]+)\/(foglio|osservazione)$/, (r, m, q) => sessionView(r, { id: m[1], tab: m[2] }, q), 'home'],
  [/^\/seduta\/([^/]+)$/, (r, m, q) => sessionView(r, { id: m[1], tab: 'foglio' }, q), 'home'],
  [/^\/partita\/([^/]+)$/, (r, m, q) => matchView(r, { id: m[1] }, q), 'home'],
  [/^\/piano\/([^/]+)$/, (r, m, q) => planView(r, { id: m[1] }, q), 'home'],
  [/^\/libreria$/, (r, m, q) => libraryView(r, {}, q), 'libreria'],
  [/^\/esercizio\/([^/]+)$/, (r, m, q) => exerciseView(r, { id: m[1] }, q), 'libreria'],
  [/^\/rosa$/, (r, m, q) => rosterView(r, {}, q), 'rosa'],
  [/^\/impostazioni$/, (r) => settingsView(r), 'impostazioni'],
  [/^\/benvenuto$/, (r) => onboardingView(r), 'benvenuto'],
  [/^\/guida$/, (r) => docView(r, 'info'), 'impostazioni'],
  [/^\/info$/, (r) => docView(r, 'info'), 'impostazioni'],
  [/^\/gruppo\/([^/]+)$/, (r, m) => groupView(r, { id: decodeURIComponent(m[1]) }), 'impostazioni'],
  [/^\/unisciti$/, (r, m, q) => joinView(r, {}, q), 'impostazioni'],
];

const main = document.getElementById('view');
let cleanup = null;
let navToken = 0;
let prepared = null; // pagina preparata fuori schermo: { raw, container, res, nav }

const setNav = (nav) => {
  document.querySelectorAll('.main-nav a, .bottom-nav a').forEach((a) => a.classList.toggle('on', a.dataset.nav === nav));
  document.body.dataset.route = nav;
};
const discardPrepared = () => { if (prepared && typeof prepared.res === 'function') { try { prepared.res(); } catch { /* */ } } prepared = null; };

async function prepareView(hash) {
  const raw = hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  for (const [re, view, nav] of routes) {
    const m = re.exec(path);
    if (!m) continue;
    const container = h('div.view-inner');
    const res = await view(container, m, new URLSearchParams(qs || ''));
    discardPrepared();
    prepared = { raw, container, res, nav };
    return;
  }
}
setPreparer(prepareView);

async function route() {
  flushAll();
  if (typeof cleanup === 'function') { try { cleanup(); } catch { /* */ } }
  cleanup = null;
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  const query = new URLSearchParams(qs || '');
  const my = ++navToken;
  if (prepared && prepared.raw === raw) { // pagina già pronta: compare subito, senza attese
    const p = prepared; prepared = null;
    setNav(p.nav);
    clear(main);
    main.append(p.container);
    cleanup = p.res;
    if (!location.hash.includes('#sez-')) window.scrollTo(0, 0);
    main.focus({ preventScroll: true });
    return;
  }
  discardPrepared();
  for (const [re, view, nav] of routes) {
    const m = re.exec(path);
    if (!m) continue;
    setNav(nav);
    const container = h('div.view-inner');
    clear(main);
    main.append(container);
    try {
      const res = await view(container, m, query);
      if (my === navToken) cleanup = res; else if (typeof res === 'function') res();
    } catch (e) {
      console.error(e);
      container.append(h('div.banner.error', h('p', 'Errore: ' + e.message)));
    }
    if (!location.hash.includes('#sez-')) window.scrollTo(0, 0);
    main.focus({ preventScroll: true });
    return;
  }
  location.hash = '#/';
}

function header() {
  const status = h('span.net-status', { role: 'status', 'aria-live': 'polite' });
  const updNet = () => {
    status.textContent = navigator.onLine ? '' : 'Offline';
    status.classList.toggle('off', !navigator.onLine);
  };
  window.addEventListener('online', updNet);
  window.addEventListener('offline', updNet);
  updNet();
  const syncInd = h('button.sync-ind', { type: 'button', title: 'Google Drive', on: { click: () => { location.hash = '#/impostazioni'; } } });
  // UN solo invito, non bloccante, quando l'accesso a Drive è scaduto e c'è qualcosa da salvare.
  // Il tocco è un gesto dell'utente: la finestra di Google si apre e si chiude da sola (prompt '').
  const inviteText = h('span', 'Tocca per salvare su Drive');
  const invite = h('button.drive-invite', { type: 'button', hidden: true, on: { click: () => {
    const p = sync.syncNow(); // subito, dentro il tocco
    invite.disabled = true;
    const forSave = sync.state.needsAuthFor === 'save';
    p.then(() => toast(forSave ? 'Salvato su Drive ✓' : 'Aggiornato da Drive ✓', 'ok'), (e) => toast(sync.friendlyError(e), 'error', 5000)).finally(() => { invite.disabled = false; });
  } } }, h('span.di-ico', { 'aria-hidden': 'true' }, '☁'), inviteText);
  document.body.append(invite);
  const updSync = (st = sync.state) => {
    invite.hidden = !(st.configured && st.folder && st.needsAuth && !st.running && navigator.onLine);
    document.body.classList.toggle('has-invite', !invite.hidden);
    if (!st.configured || !st.folder) { syncInd.textContent = 'Sul telefono'; syncInd.className = 'sync-ind local'; return; }
    if (st.running) { syncInd.textContent = 'Drive ✓ · salvo…'; syncInd.className = 'sync-ind syncing'; return; }
    // accesso scaduto: testo adatto alla situazione (c'è qualcosa da salvare o solo da ricevere)
    inviteText.textContent = st.needsAuthFor === 'update' ? 'Tocca per aggiornare da Drive' : 'Tocca per salvare su Drive';
    if (st.needsAuth) { syncInd.textContent = st.needsAuthFor === 'update' ? 'Da aggiornare' : 'Da salvare su Drive'; syncInd.className = 'sync-ind warn'; return; }
    syncInd.textContent = 'Drive ✓'; syncInd.className = 'sync-ind synced';
  };
  repo.bus.addEventListener('sync-state', (e) => { if (!pulledShown) updSync(e.detail); });
  // novità arrivate da un altro dispositivo: indicazione discreta per un paio di secondi
  let pulledShown = null;
  repo.bus.addEventListener('group-lost', (e) => {
    const d = e.detail || {};
    toast(d.status === 'removed' ? `Non fai più parte del gruppo "${d.name}". Le tue schede personali restano.`
      : d.status === 'deleted' ? `Il gruppo "${d.name}" è stato eliminato${d.admin ? ' da ' + d.admin : ''}. Puoi tenerne una copia personale (Impostazioni › Gruppi).`
        : `Il gruppo "${d.name}" non si apre più.`, 'info', 8000);
  });
  // un compagno del gruppo ha aggiunto esercizi o piani
  repo.bus.addEventListener('group-news', (e) => toast(groupNewsText(e.detail), 'info', 5000));
  repo.bus.addEventListener('pulled', () => {
    clearTimeout(pulledShown);
    syncInd.textContent = 'Aggiornato da Drive ✓'; syncInd.className = 'sync-ind synced pulled';
    pulledShown = setTimeout(() => { pulledShown = null; updSync(); }, 2500);
  });
  window.addEventListener('online', () => updSync());
  window.addEventListener('offline', () => updSync());
  updSync();
  const nav = (href, key, label) => h('a', { href, dataset: { nav: key } }, label);
  const bnav = (href, key, ico, label) => h('a', { href, dataset: { nav: key } }, h('span.bn-ico', { 'aria-hidden': 'true' }, ico), h('span', label));
  document.body.append(h('nav.bottom-nav.main-nav-mobile', { 'aria-label': 'Navigazione principale (telefono)' },
    bnav('#/', 'home', '📋', 'Schede'), bnav('#/libreria', 'libreria', '📚', 'Libreria'), bnav('#/rosa', 'rosa', '👥', 'Rosa'), bnav('#/impostazioni', 'impostazioni', '⚙', 'Impostazioni')));
  return h('header.app-bar',
    h('a.brand', { href: '#/' }, h('img', { src: './icons/icon.svg', alt: '', width: 32, height: 32 }), h('span', 'Rugby Coach')),
    h('nav.main-nav', { 'aria-label': 'Navigazione principale' },
      nav('#/', 'home', 'Schede'), nav('#/libreria', 'libreria', 'Libreria'), nav('#/rosa', 'rosa', 'Rosa'), nav('#/impostazioni', 'impostazioni', 'Impostazioni')),
    h('div.app-bar-status', status, syncInd));
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw && nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          const bar = h('div.update-bar', h('span', 'È disponibile una nuova versione dell\'app.'),
            h('button.btn.primary.small', { type: 'button', on: { click: () => { nw.postMessage('skipWaiting'); } } }, 'Aggiorna'));
          document.body.append(bar);
        }
      });
    });
  }).catch((e) => console.warn('SW non registrato', e));
  // ricarica solo quando una NUOVA versione prende il controllo (non al primo avvio)
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloading) { reloading = true; flushAll(); location.reload(); } });
}

async function start() {
  document.body.prepend(header());
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); window.__installPrompt = e; });
  try {
    await repo.initRepo();
  } catch (e) {
    clear(main).append(h('div.banner.error', h('p', 'Impossibile aprire l\'archivio locale (IndexedDB): ' + e.message + '. In navigazione privata alcuni browser lo bloccano.')));
    return;
  }
  await repo.seedIfNeeded();
  await sync.initSync();
  // Chiede al browser di non cancellare i dati (R22)
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persisted().then((p) => { if (!p) navigator.storage.persist().catch(() => {}); }).catch(() => {});
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAll(); });
  window.addEventListener('pagehide', flushAll);
  window.addEventListener('hashchange', route);
  const meta = (await repo.getSetting('meta', {})) || {};
  if (!meta.onboarded && (!location.hash || location.hash === '#/' || location.hash === '#')) location.hash = '#/benvenuto';
  await route();
  registerSW();
  window.__rcReady = true;
}

window.addEventListener('error', (e) => { if (e.message && !/ResizeObserver/.test(e.message)) toast('Errore: ' + e.message, 'error', 6000); });
window.addEventListener('unhandledrejection', (e) => { const m = e.reason && e.reason.message; if (m) toast('Errore: ' + m, 'error', 6000); });
start();
