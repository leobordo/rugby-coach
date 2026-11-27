// Service worker: mette in cache l'app shell per l'uso offline (R23).
// Aggiornare VERSION a ogni rilascio. L'elenco PRECACHE è verificato da tests/sw.test.mjs.
const VERSION = 'rc-v1.9.1';
const PRECACHE = [
  './',
  './index.html',
  './privacy.html',
  './manifest.webmanifest',
  './config.js',
  './css/app.css',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  './js/main.js',
  './js/model.js',
  './js/seed.js',
  './js/db.js',
  './js/repo.js',
  './js/ui.js',
  './js/drive.js',
  './js/sync.js',
  './js/groups.js',
  './js/google.js',
  './js/app-sync.js',
  './js/artifacts.js',
  './js/docx-build.js',
  './js/board/model.js',
  './js/board/render.js',
  './js/board/editor.js',
  './js/board/gif.js',
  './js/views/common.js',
  './js/views/banners.js',
  './js/views/home.js',
  './js/views/read.js',
  './js/views/session.js',
  './js/views/match.js',
  './js/views/plan.js',
  './js/views/library.js',
  './js/views/roster.js',
  './js/views/settings.js',
  './js/views/groups.js',
  './js/markdown.js',
  './js/share.js',
  './js/views/docs.js',
  './vendor/docx.mjs',
  './README.md',
];
// Caricati dalla rete quando possibile (l'utente può modificarli sul proprio hosting)
const NETWORK_FIRST = ['config.js', 'index.html', 'manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Google (GIS, Picker, Drive API): sempre rete, mai cache
  const isNav = req.mode === 'navigate';
  const networkFirst = isNav || NETWORK_FIRST.some((p) => url.pathname.endsWith('/' + p));
  if (networkFirst) {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        // ogni pagina è salvata con il proprio indirizzo (index.html, privacy.html...)
        if (res.ok && res.type === 'basic') (await caches.open(VERSION)).put(req, res.clone());
        return res;
      } catch {
        const cache = await caches.open(VERSION);
        return (await cache.match(req, { ignoreSearch: true })) || (isNav ? (await cache.match('./index.html')) || (await cache.match('./')) : null) || Response.error();
      }
    })());
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch {
      return Response.error();
    }
  })());
});
