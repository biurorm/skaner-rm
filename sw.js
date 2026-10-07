// Service Worker, działanie offline
// Trzyma TYLKO pliki aplikacji. Zdjęcia i PDF-y nigdy nie trafiają do pamięci podręcznej.
// Strategia: najpierw sieć (nowa wersja wchodzi od razu), bez zasięgu z pamięci.
const CACHE = 'skaner-rm-v6';
const FILES = ['./', './index.html', './style.css', './app.js', './skan.js', './pdf-rm.js', './manifest.json', './logo.png', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(u => new Request(u, { cache: 'reload' }))).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('skaner-rm-') && k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  event.respondWith(
    fetch(event.request, { cache: 'no-cache' }).then(resp => {
      const clone = resp.clone();
      caches.open(CACHE).then(c => { try { c.put(event.request, clone); } catch (e) {} });
      return resp;
    }).catch(() => caches.match(event.request, { ignoreSearch: true }).then(c => c || caches.match('./index.html')))
  );
});
