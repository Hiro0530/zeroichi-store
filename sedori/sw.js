/* せどり 利益チェック: オフラインでも計算できるように画面と手数料データを保存する。
   HTML・JSONは通信を優先(新しい手数料を使う)、それ以外は保存済みを優先。外部API(楽天・Yahoo!・Keepa)は扱わない。 */
var CACHE = 'zw-sedori-v1';
var CORE = ['./', 'rakuten-amazon/', 'muzaiko-amazon/', 'mercari-calc/', 'yahuoku-mercari/', 'auction-mercari/',
  'assets/sedori.css', 'assets/calc.js', 'assets/ui.js', 'assets/ra.js', 'assets/market.js', 'assets/mz.js', 'assets/shindan.js',
  'data/fees.json', '../zw.css', 'icon-192.png'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(CORE); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k.indexOf('zw-sedori-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  var fresh = e.request.mode === 'navigate' || /\.json$/.test(u.pathname);
  if (fresh) {
    e.respondWith(fetch(e.request).then(function (r) {
      var copy = r.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, copy); }); return r;
    }).catch(function () { return caches.match(e.request); }));
  } else {
    e.respondWith(caches.match(e.request).then(function (hit) {
      return hit || fetch(e.request).then(function (r) { var copy = r.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, copy); }); return r; });
    }));
  }
});
