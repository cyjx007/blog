/* 只做两件事：让站点/写稿台能「装到桌面」，断网时还能打开看过的东西。
   策略：字体和图标缓存优先（基本不变），页面与脚本网络优先（永远拿最新的，免得改了看不见）。 */
const CACHE = 'epistle-v1';
const PRECACHE = [
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/fonts/zhiduan-qingchang.woff2'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (/\.(woff2|png|svg|ico)$/.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }))
    );
    return;
  }

  e.respondWith(fetch(req).catch(() => caches.match(req)));
});
