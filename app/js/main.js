// Avvio dell'app: database, seed, sync, router (hash) e service worker.
import { h, clear, toast } from './ui.js';
import * as repo from './repo.js';
import * as sync from './app-sync.js';
import { flushAll } from './views/common.js';
import { homeView } from './views/home.js';
import { sessionView } from './views/session.js';
import { matchView } from './views/match.js';
import { planView } from './views/plan.js';
import { libraryView, exerciseView } from './views/library.js';
import { rosterView } from './views/roster.js';
import { settingsView, onboardingView } from './views/settings.js';
import { docView } from './views/docs.js';

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
  [/^\/benvenuto$/, (r) => onboardingView(r), 'impostazioni'],
  [/^\/guida$/, (r) => docView(r, 'guida'), 'impostazioni'],
  [/^\/info$/, (r) => docView(r, 'info'), 'impostazioni'],
];

const main = document.getElementById('view');
let cleanup = null;
let navToken = 0;

async function route() {
  flushAll();
  if (typeof cleanup === 'function') { try { cleanup(); } catch { /* */ } }
  cleanup = null;
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  const query = new URLSearchParams(qs || '');
  const my = ++navToken;
  for (const [re, view, nav] of routes) {
    const m = re.exec(path);
    if (!m) continue;
    document.querySelectorAll('.main-nav a, .bottom-nav a').forEach((a) => a.classList.toggle('on', a.dataset.nav === nav));
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
  const syncInd = h('button.sync-ind', { type: 'button', title: 'Stato Google Drive', on: { click: () => { location.hash = '#/impostazioni'; } } });
  const updSync = (st = sync.state) => {
    if (!st.configured) { syncInd.textContent = 'Solo locale'; syncInd.className = 'sync-ind local'; return; }
    if (!st.folder) { syncInd.textContent = 'Drive non collegato'; syncInd.className = 'sync-ind warn'; return; }
    if (st.running) { syncInd.textContent = 'Drive ✓ · invio…'; syncInd.className = 'sync-ind syncing'; return; }
    if (st.needsAuth) { syncInd.textContent = 'Accedi per sincronizzare'; syncInd.className = 'sync-ind warn'; return; }
    syncInd.textContent = 'Drive ✓'; syncInd.className = 'sync-ind synced';
  };
  repo.bus.addEventListener('sync-state', (e) => updSync(e.detail));
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
