// Il Mio Vocabolario — service worker
// Bump CACHE version any time the asset list or HTML changes.
const CACHE = 'italiano-v4';

const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/fonts/HALMagicVariable-Variable.ttf',
  '/fonts/SpaceCrusadersItalic-ZV1Zx.ttf',
  '/fonts/FactDeckWeb-55Regular.ttf'
];

// Pre-cache all static assets at install time.
// `cache.addAll` uses same-origin credentials by default, so Basic Auth
// flows through automatically — no extra config needed.
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

// Drop any old cache versions on activate.
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

// Cache-first for static assets; network for everything else (API calls etc).
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Never cache API/MCP traffic — always go to network so word adds and
  // sheet reads stay fresh.
  if (url.pathname.startsWith('/mcp') ||
      url.pathname.startsWith('/add') ||
      url.pathname.startsWith('/health')) {
    return; // fall through to default network fetch
  }

  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
