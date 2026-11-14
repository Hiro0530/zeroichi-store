/* 楽天・Keepa の公式APIを、利用者自身のキーで呼ぶ部品(計算ページと商品ページが使う)。window.SedoriAPI
   - キーはこの端末だけに保存(store の keys)。当方のサーバーは通らない
   - Keepaで取った価格の履歴は、この端末の中(kp-hist)にだけ置く。クラウドへ送らず、ほかの利用者へも出さない
   - 販売サイトのページは読みに行かない(公式APIだけ) */
(function () {
  'use strict';
  var U = window.SedoriUI, C = window.SedoriCalc, esc = U.esc;
  var FREE_SEARCHES_PER_DAY = 20, HIST_MAX = 40, HIST_DAYS = 90;
  var RAKUTEN_EP = 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701';
  var KEEPA_EP = 'https://api.keepa.com/product';
  function keys() { return U.store.get('keys', {}); }
  function paid() { return !!(window.SedoriAccount && window.SedoriAccount.paid()); }
  function quota() { var q = U.store.get('quota', {}); if (q.d !== U.today()) q = { d: U.today(), n: 0 }; return q; }
  function quotaLeft() { return paid() ? Infinity : Math.max(0, FREE_SEARCHES_PER_DAY - quota().n); }
  /** 無料の1日20回の枠を1つ使う。使い切っていたら false */
  function useQuota() { if (paid()) return true; var q = quota(); if (q.n >= FREE_SEARCHES_PER_DAY) return false; q.n++; U.store.set('quota', q); return true; }

  /** 楽天の商品検索を1回呼ぶ。返り値は一覧の行の形。失敗の Error には status(403・429 など) */
  function rakuten(params) {
    var k = keys();
    var p = new URLSearchParams(Object.assign({ applicationId: k.rkApp, accessKey: k.rkKey, formatVersion: '2', imageFlag: '1' }, params));
    return fetch(RAKUTEN_EP + '?' + p.toString(), { referrerPolicy: 'strict-origin-when-cross-origin' }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) {
          var e = new Error(r.status === 403 ? '楽天が403を返しました。アプリ設定の「許可するWebサイト」に ' + location.origin + ' が入っているか確認してください。' :
            (r.status === 429 ? '楽天の回数制限です。少し待ってから試してください。' : '楽天の検索に失敗しました(' + r.status + (j.error_description ? ': ' + esc(j.error_description) : '') + ')'));
          e.status = r.status; throw e;
        }
        return (j.Items || []).map(function (it) {
          it = it.Item || it;
          var img = (it.mediumImageUrls || [])[0]; img = typeof img === 'string' ? img : (img && img.imageUrl) || '';
          return { src: 'rakuten', name: it.itemName, price: Number(it.itemPrice) || 0, url: it.itemUrl, shop: it.shopName, img: img, code: it.itemCode || '',
            shopPt: Number(it.pointRate) || 1, freeShip: Number(it.postageFlag) === 0,
            jan: C.extractJan((it.itemName || '') + ' ' + (it.itemCaption || '')), until: it.pointRateEndTime || '' };
        });
      });
    });
  }
  /** Keepaの商品の照会。params は { code: 'JAN,JAN' } か { asin: '…' }。失敗の Error には status(429 など) */
  function keepa(params) {
    var p = new URLSearchParams(Object.assign({ key: keys().keepa, domain: '5', stats: '90' }, params));
    return fetch(KEEPA_EP + '?' + p.toString()).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(r.status === 429 ? 'Keepaのトークンが足りません。少し待ってから試してください。' : 'Keepaから売値を取れませんでした。キーが正しいかを見て、もう一度お試しください(番号 ' + r.status + ')。'); e.status = r.status; e.refillIn = j.refillIn; throw e; }
        return j;
      });
    });
  }
  /** Keepaの返事1件から、売れ行きの目安に使う値(ランキングが上がった回数)と取った時刻 */
  function kpExtra(pr) {
    var st = pr.stats || {}, n = function (v) { return v != null && Number(v) >= 0 ? Number(v) : null; };
    return { d30: n(st.salesRankDrops30), d90: n(st.salesRankDrops90), t: Date.now() };
  }
  /** 価格の履歴(新品の最安値・90日・1日1つ)をこの端末に置く。古い順に HIST_MAX 件まで */
  function saveHist(pr) {
    if (!pr || !pr.asin || !pr.csv) return;
    var nw = C.keepaDaily(pr.csv[1], Date.now(), HIST_DAYS); if (!nw) return;
    var h = U.store.get('kp-hist', {}); h[pr.asin] = { t: Date.now(), nw: nw };
    var ks = Object.keys(h); if (ks.length > HIST_MAX) ks.sort(function (a, b) { return h[a].t - h[b].t; }).slice(0, ks.length - HIST_MAX).forEach(function (a) { delete h[a]; });
    U.store.set('kp-hist', h);
  }
  function hist(asin) { return asin ? (U.store.get('kp-hist', {})[asin] || null) : null; }
  window.SedoriAPI = { keys: keys, paid: paid, quotaLeft: quotaLeft, useQuota: useQuota, rakuten: rakuten, keepa: keepa, kpExtra: kpExtra, saveHist: saveHist, hist: hist, FREE: FREE_SEARCHES_PER_DAY };
})();
