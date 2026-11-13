/* せどり 利益チェック: オフラインでも計算できるように画面と手数料データを保存する。
   HTML・JSON・config.js は通信を優先(新しい手数料・設定を使う)、それ以外は保存済みを優先。外部(楽天・Yahoo!・Keepa・Firebase・Stripe・PayPal)は扱わない。
   ヤフオクの終了の通知で「出品停止にした」を押すと、開いているページに知らせる(無ければ台帳を開く)。 */
var CACHE = 'zw-sedori-v16';
var CORE = ['./', 'rakuten-amazon/', 'muzaiko-amazon/', 'mercari-calc/', 'yahuoku-mercari/', 'auction-mercari/', 'daicho/', 'scan/', 'books/', 'plans/', 'mypage/', 'terms/', 'privacy/', 'shikumi/', 'chigai/',
  'assets/sedori.css', 'assets/calc.js', 'assets/ui.js', 'assets/sync.js', 'assets/books-sync.js', 'assets/seller-check.js', 'assets/account.js', 'assets/ra.js', 'assets/market.js', 'assets/mz.js', 'assets/ledger.js', 'assets/top.js', 'assets/shindan.js',
  'assets/plans.js', 'assets/mypage.js', 'assets/ai.js', 'assets/scan.css', 'assets/scan.js', 'assets/scan-decoder.js', 'assets/scan-sync.js', 'books/books.css', 'books/assets/books-core.js', 'books/assets/books.js', 'assets/vendor/qrcode-generator.js', 'assets/vendor/zxing-library-0.21.3.min.js',
  'data/fees.json', 'icon-192.png'];
/* あとから足す部品(まとめて・台帳の追加・ウォッチの取り直し・仕入れる前の確かめ・手引き)。まだ無いファイルがあっても、保存の準備を止めない */
var OPT = ['assets/config.js', 'assets/bulk.js', 'assets/ledger-plus.js', 'assets/ledger-plus.css', 'assets/watch-check.js', 'assets/precheck.js', 'assets/tools.css',
  'guide/', 'guide/guide.css', 'guide/hajimeru/', 'guide/hajimeru/hajimeru.js', 'guide/kobutsu-shinsei/'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return c.addAll(CORE).then(function () { return Promise.all(OPT.map(function (u) { return c.add(u).catch(function () { /* 無ければ飛ばす */ }); })); });
  }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k.indexOf('zw-sedori-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  var fresh = e.request.mode === 'navigate' || /\.json$/.test(u.pathname) || /config\.js$/.test(u.pathname);
  if (fresh) {
    e.respondWith(fetch(e.request).then(function (r) {
      var copy = r.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, copy); }); return r;
    }).catch(function () { return caches.match(e.request, { ignoreSearch: e.request.mode === 'navigate' }); }));
  } else {
    e.respondWith(caches.match(e.request).then(function (hit) {
      return hit || fetch(e.request).then(function (r) { var copy = r.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, copy); }); return r; });
    }));
  }
});
self.addEventListener('notificationclick', function (e) {
  var d = e.notification.data || {};
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    var win = list[0];
    if (e.action === 'stop' && d.id) {
      if (win) { win.postMessage({ type: 'zw-stop', id: d.id }); return win.focus(); }
      return self.clients.openWindow(d.stopUrl || d.url);
    }
    if (win && 'navigate' in win) return win.navigate(d.url).then(function (w) { return (w || win).focus(); });
    return self.clients.openWindow(d.url || './daicho/');
  }));
});
