/* PDF Studio service worker
   Everything the app needs is served from this site, so once the page has
   loaded once, every in-browser tool keeps working offline.
   Server-backed tools (Protect and the Office conversions) still need a connection. */
const CACHE = 'pdfstudio-v9';
const SHELL = [
  './', './index.html', './style.css', './favicon.svg', './manifest.webmanifest',
  './icon-192.png', './icon-512.png',
  './js/theme-init.js', './js/core.js', './js/assemble.js', './js/annotate.js', './js/text.js', './js/watermark.js',
  './js/pagenumbers.js', './js/redact.js', './js/signature.js', './js/server.js', './js/init.js',
  './vendor/pdfjs/pdf.min.js', './vendor/pdfjs/pdf.worker.min.js', './vendor/pdf-lib/pdf-lib.min.js',
  './vendor/sortable/Sortable.min.js',
  './vendor/fontawesome/css/all.min.css',
  './vendor/fontawesome/webfonts/fa-solid-900.woff2', './vendor/fontawesome/webfonts/fa-regular-400.woff2',
  './vendor/fonts/fonts.css',
  './vendor/fonts/instrument-serif-latin-400-normal.woff2', './vendor/fonts/instrument-serif-latin-400-italic.woff2',
  './vendor/fonts/bricolage-grotesque-latin-wght-normal.woff2',
  './vendor/fonts/ibm-plex-mono-latin-400-normal.woff2', './vendor/fonts/ibm-plex-mono-latin-500-normal.woff2',
  './vendor/fonts/ibm-plex-mono-latin-600-normal.woff2',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch the conversion server

  if (url.pathname.includes('/vendor/')) {
    // Pinned third-party files never change: cache first. Bump CACHE when updating them.
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res;
    })));
  } else {
    // Our own files: network first so updates appear straight away, cache as the offline fallback
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res;
      }).catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
  }
});
