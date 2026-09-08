/* Yuki 自习室 · Service Worker
 * 静态资源：网络优先、失败回退缓存（保证更新及时，断网可用）
 * 词库与图片：缓存优先（体积大、极少变化）
 * /api/*：一律直连，不缓存
 */
const VERSION = 'yuki-v2.1.0';
const STATIC = `${VERSION}-static`;
const HEAVY = `${VERSION}-heavy`;

const PRECACHE = [
  './', './index.html', './manifest.webmanifest',
  './css/tokens.css', './css/base.css', './css/components.css', './css/views.css', './css/focus.css', './css/stats-extra.css',
  './js/lucide.min.js', './js/main.js',
  './js/core/api.js', './js/core/audio.js', './js/core/crypto.js', './js/core/lexicon.js', './js/core/srs.js', './js/core/storage.js', './js/core/sync.js',
  './js/ui/dom.js', './js/ui/overlay.js', './js/ui/router.js', './js/ui/theme.js',
  './js/ui/ambient-fx.js',
  './js/features/chat.js', './js/features/home.js', './js/features/learn.js', './js/features/reading.js', './js/features/settings.js', './js/features/stats.js', './js/features/study-engine.js', './js/features/pomodoro.js',
  './assets/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  const heavy = /\/js\/data\/|\/assets\//.test(url.pathname);
  if (heavy) {
    event.respondWith(caches.open(HEAVY).then(async cache => {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    }));
    return;
  }

  event.respondWith(caches.open(STATIC).then(async cache => {
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      const hit = await cache.match(req) || (req.mode === 'navigate' ? await cache.match('./index.html') : null);
      return hit || new Response('离线且无缓存', { status: 503 });
    }
  }));
});
