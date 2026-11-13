/* PDF Studio service worker
   Caches the app shell and CDN libraries so the in-browser tools keep
   working offline after the first visit. Server tools still need a connection. */
const CACHE = 'pdfstudio-v8';
const SHELL = [
  './', './index.html', './style.css', './favicon.svg', './manifest.webmanifest',
  './js/core.js', './js/assemble.js', './js/annotate.js', './js/text.js', './js/watermark.js',
  './js/pagenumbers.js', './js/redact.js', './js/signature.js', './js/server.js', './js/init.js',
];
const CDN_HOSTS = ['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

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
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !CDN_HOSTS.includes(url.hostname)) return; // never touch the conversion server

  if (sameOrigin) {
    // Network first for our own files so updates show up straight away
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
  } else {
    // Versioned CDN files never change: cache first
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      }))
    );
  }
});
