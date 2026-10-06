// Service Worker：ホーム画面から起動でき、電波が無くても画面を出せるようにする。
// キャッシュ名のバージョンは js/version.js の APP_VERSION（app.js が「sw.js?v=…」で登録する）。
// APP_VERSION を上げると新しい Service Worker が入り、古い画面のキャッシュは消える。

const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const SHELL_CACHE = 'shell-' + VERSION;
const NETWORK_TIMEOUT = 3000; // 電波が弱いときは3秒で諦めて控えを使う（起動が遅くならないように）

const SHELL_FILES = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
  './lib/chart.umd.min.js',
  './js/app.js',
  './js/store.js',
  './js/sync.js',
  './js/calc.js',
  './js/charts.js',
  './js/plan.js',
  './js/menuio.js',
  './js/export.js',
  './js/seed.js',
  './js/util.js',
  './js/version.js',
  './icons/icon-192.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  // HTTP のキャッシュを通さずに取る（GitHub Pages は10分間キャッシュさせるため）
  event.waitUntil(caches.open(SHELL_CACHE)
    .then(c => c.addAll(SHELL_FILES.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('shell-') && k !== SHELL_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // 自分のサイトのファイルだけを扱う。GAS（script.google.com）への通信はキャッシュしない
  if (url.origin !== self.location.origin) return;
  event.respondWith(networkFirst(req));
});

// まず通信し、つながらない・遅いときは控えを使う（更新がすぐ反映されるように）
async function networkFirst(req) {
  const cache = await caches.open(SHELL_CACHE);
  const key = stripQuery(req);
  const fromCache = async () => (await cache.match(key)) || (req.mode === 'navigate' ? await cache.match('./') : null);
  if (self.navigator && self.navigator.onLine === false) {
    const hit = await fromCache();
    if (hit) return hit;
  }
  try {
    const res = await withTimeout(fetch(req.url, { cache: 'no-cache' }), NETWORK_TIMEOUT);
    if (res.ok) cache.put(key, res.clone());
    return res;
  } catch (e) {
    const hit = await fromCache();
    if (hit) return hit;
    return fetch(req);
  }
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(r => { clearTimeout(t); resolve(r); }, e => { clearTimeout(t); reject(e); });
  });
}

function stripQuery(req) {
  const url = new URL(req.url);
  url.search = '';
  return url.toString();
}
