/* 楽天・Yahoo!→Amazon 利益チェック(画面) */
(function () {
  'use strict';
  var U = window.SedoriUI, C = window.SedoriCalc;
  var $ = U.$, $$ = U.$$, esc = U.esc, yen = U.yen, val = U.val;
  var FREE_SEARCHES_PER_DAY = 20;
  var RAKUTEN_EP = 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701';
  var YAHOO_EP = 'https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch';
  var KEEPA_EP = 'https://api.keepa.com/product';
  var CREDIT = {
    rakuten: '<a href="https://developers.rakuten.com/" target="_blank" rel="noopener">Supported by Rakuten Developers</a>',
    yahoo: '<a href="https://developer.yahoo.co.jp/sitemap/" target="_blank" rel="noopener">Webサービス by Yahoo! JAPAN</a>'
  };
  var fees = null, src = 'rakuten', last = null;

  /* ---------- キー ---------- */
  var KEY_IDS = { rkApp: 'k-rk-app', rkKey: 'k-rk-key', yhApp: 'k-yh-app', keepa: 'k-kp' };
  function keys() { return U.store.get('keys', {}); }
  function loadKeys() { var k = keys(); Object.keys(KEY_IDS).forEach(function (n) { $('#' + KEY_IDS[n]).value = k[n] || ''; }); }
  $('#k-save').addEventListener('click', function () {
    var k = {}; Object.keys(KEY_IDS).forEach(function (n) { k[n] = $('#' + KEY_IDS[n]).value.trim(); });
    U.toast(U.store.set('keys', k) ? 'この端末に保存しました' : 'この端末では保存できませんでした(プライベートブラウズ等)');
  });
  $('#k-clear').addEventListener('click', function () {
    if (!confirm('この端末に保存したIDとキーを消しますか?')) return;
    U.store.del('keys'); loadKeys(); U.toast('消しました');
  });

  /* ---------- 無料版の回数 ---------- */
  function quota() { var q = U.store.get('quota', {}); if (q.d !== U.today()) q = { d: U.today(), n: 0 }; return q; }
  function showQuota() { var q = quota(); $('#quota').textContent = '無料版: 今日あと ' + Math.max(0, FREE_SEARCHES_PER_DAY - q.n) + ' 回'; }
  function useQuota() { var q = quota(); if (q.n >= FREE_SEARCHES_PER_DAY) return false; q.n++; U.store.set('quota', q); showQuota(); return true; }

  /* ---------- 検索 ---------- */
  $$('.tabs2 button').forEach(function (b) {
    b.addEventListener('click', function () {
      src = b.getAttribute('data-src');
      $$('.tabs2 button').forEach(function (x) { x.setAttribute('aria-selected', String(x === b)); });
      $('#ptonly').closest('label').style.visibility = src === 'rakuten' ? 'visible' : 'hidden';
    });
  });

  function msg(html, cls) { $('#search-msg').innerHTML = html ? '<div class="' + (cls || 'info') + '">' + html + '</div>' : ''; }

  function searchRakuten(q, k) {
    var sort = { price: '+itemPrice', standard: 'standard', review: '-reviewCount' }[$('#sort').value];
    var p = new URLSearchParams({ applicationId: k.rkApp, accessKey: k.rkKey, keyword: q, hits: '30', availability: '1',
      sort: sort, formatVersion: '2', imageFlag: '1' });
    if ($('#ptonly').checked) p.set('pointRateFlag', '1');
    return fetch(RAKUTEN_EP + '?' + p.toString(), { referrerPolicy: 'strict-origin-when-cross-origin' }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(r.status === 403 ? '楽天が403を返しました。アプリ設定の「許可するWebサイト」に https://hiro0530.github.io が入っているか確認してください。' :
          (r.status === 429 ? '楽天の回数制限です。少し待ってから試してください。' : '楽天の検索に失敗しました(' + r.status + (j.error_description ? ': ' + esc(j.error_description) : '') + ')'));
        return (j.Items || []).map(function (it) {
          it = it.Item || it;
          var img = (it.mediumImageUrls || [])[0]; img = typeof img === 'string' ? img : (img && img.imageUrl) || '';
          return { src: 'rakuten', name: it.itemName, price: Number(it.itemPrice) || 0, url: it.itemUrl, shop: it.shopName, img: img,
            shopPt: Number(it.pointRate) || 1, freeShip: Number(it.postageFlag) === 0,
            jan: C.extractJan((it.itemName || '') + ' ' + (it.itemCaption || '')), until: it.pointRateEndTime || '' };
        });
      });
    });
  }

  function searchYahoo(q, k) {
    var sort = { price: '+price', standard: '-score', review: '-review_count' }[$('#sort').value];
    var p = new URLSearchParams({ appid: k.yhApp, results: '30', in_stock: 'true', sort: sort });
    if (/^\d{13}$|^\d{8}$/.test(q)) p.set('jan_code', q); else p.set('query', q);
    return fetch(YAHOO_EP + '?' + p.toString()).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error('Yahoo!の検索に失敗しました(' + r.status + ')。Client ID を確認してください。');
        return (j.hits || []).map(function (h) {
          var pt = h.point || {}, price = Number(h.price) || 0;
          var bonus = Number(pt.lyLimitedBonusAmount || pt.bonusAmount || 0);
          return { src: 'yahoo', name: h.name, price: price, url: h.url, shop: (h.seller || {}).name || '', img: (h.image || {}).medium || '',
            shopPt: 1 + (price > 0 ? Math.round(bonus / price * 1000) / 10 : 0), freeShip: String((h.shipping || {}).code) === '2',
            jan: h.janCode && C.janValid(h.janCode) ? h.janCode : C.extractJan(h.name), until: '' };
        });
      });
    });
  }

  function hitHTML(h, i, list) {
    return '<li class="hit">' + (h.img ? '<img loading="lazy" src="' + esc(h.img) + '" alt="">' : '<span></span>') +
      '<div><div class="nm"><a href="' + esc(h.url) + '" target="_blank" rel="noopener">' + esc(h.name) + '</a></div>' +
      '<div><span class="pr">' + yen(h.price) + '円</span> ' + (h.shopPt > 1 ? '<span class="tag2 pt">ポイント' + h.shopPt + (h.src === 'rakuten' ? '倍' : '%') + '</span>' : '') +
      (h.freeShip ? '<span class="tag2">送料無料</span>' : '<span class="tag2">送料別</span>') + '</div>' +
      '<div class="meta">' + esc(h.shop) + (h.jan ? ' / JAN ' + esc(h.jan) : '') + '</div>' +
      '<button type="button" class="b g s" data-use="' + list + ':' + i + '">この商品で計算</button></div></li>';
  }

  var lists = { s: [], t: [] };
  function bindUse(root) {
    $$('[data-use]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        var a = b.getAttribute('data-use').split(':');
        useHit(lists[a[0]][Number(a[1])]);
      });
    });
  }

  $('#search-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var q = $('#q').value.trim(), k = keys();
    if (!q) { msg('キーワードかJANコードを入れてください。'); return; }
    if (src === 'rakuten' && !(k.rkApp && k.rkKey)) { msg('楽天のアプリIDとアクセスキーを、下の「APIの設定」で入れてください(無料で取れます)。<a href="#keys">設定へ</a>'); return; }
    if (src === 'yahoo') {
      // Yahoo!ショッピングのAPIはブラウザからの直接呼び出し(CORS)に対応していないため、公式の検索ページを開く
      var yu = 'https://shopping.yahoo.co.jp/search?p=' + encodeURIComponent(q);
      window.open(yu, '_blank', 'noopener');
      msg('Yahoo!ショッピングの検索ページを新しいタブで開きました(<a href="' + esc(yu) + '" target="_blank" rel="noopener">開かない時はこちら</a>)。気になる商品の価格・送料・ポイントを、右の「利益を計算」に入れてください。');
      return;
    }
    if (!useQuota()) { msg('無料版の今日の検索回数(' + FREE_SEARCHES_PER_DAY + '回)を使い切りました。明日また使えます。計算は回数の制限なく使えます。'); return; }
    msg('検索中…'); $('#go').disabled = true;
    (src === 'rakuten' ? searchRakuten(q, k) : searchYahoo(q, k)).then(function (list) {
      lists.s = list;
      $('#hits').innerHTML = list.length ? list.map(function (h, i) { return hitHTML(h, i, 's'); }).join('') : '<li class="empty">見つかりませんでした。</li>';
      $('#credit').innerHTML = CREDIT[src] + '。価格・在庫・ポイントは検索した時点のものです。';
      bindUse($('#hits')); msg('');
    }).catch(function (err) {
      var t = String(err && err.message || err);
      if (/Failed to fetch|NetworkError|Load failed/i.test(t)) t = '接続できませんでした。通信状態か、IDの設定(許可するWebサイト)を確認してください。';
      msg(t, 'warn');
    }).then(function () { $('#go').disabled = false; });
  });

  /* ---------- 今日の候補(毎朝の静的JSON) ---------- */
  function loadToday() {
    fetch('../data/today.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (j) {
      lists.t = (j.items || []).map(function (it) {
        return { src: 'rakuten', name: it.name, price: it.price, url: it.url, shop: it.shop, img: it.img || '', shopPt: it.pointRate || 1,
          freeShip: !!it.freeShip, jan: it.jan || C.extractJan(it.name), until: it.until || '', genre: it.genre || '' };
      });
      $('#today-time').textContent = j.fetched_at_label ? j.fetched_at_label + ' 取得' : '';
      var SHOW = 5;
      $('#today-list').innerHTML = lists.t.length ? lists.t.map(function (h, i) { return hitHTML(h, i, 't').replace('<li class="hit">', '<li class="hit"' + (i >= SHOW ? ' hidden' : '') + '>'); }).join('') +
        (lists.t.length > SHOW ? '<li class="more-row"><button type="button" class="b g s" id="today-more">残り' + (lists.t.length - SHOW) + '件を見る</button></li>' : '') +
        '<li class="credit">' + CREDIT.rakuten + '</li>' : '<li class="empty">今日の分はまだありません。</li>';
      var mb = $('#today-more'); if (mb) mb.addEventListener('click', function () { $$('#today-list .hit[hidden]').forEach(function (li) { li.hidden = false; }); mb.parentNode.remove(); });
      bindUse($('#today-list'));
    }).catch(function () { $('#today-list').innerHTML = '<li class="empty">今日の分はまだありません(毎朝更新)。</li>'; });
  }

  /* ---------- 計算 ---------- */
  function useHit(h) {
    if (!h) return;
    $('#c-name').value = h.name || '';
    $('#c-cost').value = h.price || '';
    $('#c-inship').value = h.freeShip ? 0 : ($('#c-inship').value || 0);
    $('#c-pt-shop').value = h.shopPt || 1;
    if (h.jan) $('#c-code').value = h.jan;
    last = h; updateLinks(); calc();
    if (keys().keepa && $('#c-code').value) $('#kp-go').click();   // Keepaのキーがあれば自動で取得(1トークン)
    if (!h.freeShip) U.toast('送料別の商品です。仕入れの送料を入れてください');
    $('#calc').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function updateLinks() {
    var code = $('#c-code').value.trim();
    $('#amz-link').href = code ? (/^B0[A-Z0-9]{8}$/i.test(code) ? 'https://www.amazon.co.jp/dp/' + encodeURIComponent(code) : 'https://www.amazon.co.jp/s?k=' + encodeURIComponent(code)) : 'https://www.amazon.co.jp/';
    $('#kp-link').href = code ? 'https://keepa.com/#!search/5-' + encodeURIComponent(code) : 'https://keepa.com/';
  }
  $('#c-code').addEventListener('input', updateLinks);

  function input() {
    return {
      sell: val('c-sell'), category: $('#c-cat').value, fbaTier: $('#c-tier').value,
      cost: val('c-cost'), inShip: val('c-inship'), inbound: val('c-inbound'), other: val('c-other'),
      pointRate: (val('c-pt-shop') + val('c-pt-mine')) / 100, usePoints: $('#c-usept').checked,
      selfShip: $('#c-self').checked, selfShipCost: val('c-selfship')
    };
  }

  function calc() {
    if (!fees) return;
    var x = input(), out = $('#c-out');
    saveForm();
    if (!(x.sell > 0) || !(x.cost > 0)) { out.innerHTML = '<p class="empty">仕入れ値と販売価格を入れると、ここに結果が出ます。</p>'; return null; }
    var r = C.amazonProfit(fees, x);
    var tg = U.target();
    var be = C.amazonBreakEvenSell(fees, x);
    var sug = C.amazonPriceFor(fees, x, tg);
    var maxc = C.amazonMaxCost(fees, x, tg);
    var cls = r.profit < 0 ? 'minus' : (r.profit >= C.needProfit(r.sell, tg) ? 'plus' : '');
    var rows = [
      ['販売価格', r.sell],
      ['販売手数料(税込)', -r.referral],
      [x.selfShip ? 'お客様への送料' : 'FBA配送代行手数料', x.selfShip ? -r.selfShipCost : -r.fba],
      ['Amazonからの入金', r.payout, 't'],
      ['仕入れ値', -r.cost], ['仕入れの送料', -r.inShip]
    ];
    if (!x.selfShip) rows.push(['納品送料・資材', -r.inbound]);
    if (r.other) rows.push(['その他', -r.other]);
    if (x.usePoints) rows.push(['ポイント(' + U.pct(x.pointRate) + '・税抜で計算)', r.points]);
    rows.push(['利益(1個)', r.profit, 't']);
    out.innerHTML =
      '<div class="big"><span class="k">1個あたりの利益</span><span class="v ' + cls + '">' + yen(r.profit) + '<small style="font-size:.45em">円</small></span></div>' +
      '<div class="kpis"><div><b>' + U.pct(r.margin) + '</b><span>利益率</span></div><div><b>' + U.pct(r.roi, 0) + '</b><span>仕入れ額に対する利益</span></div><div><b>' + yen(r.profitNoPoints) + '</b><span>ポイント抜きの利益</span></div></div>' +
      '<table class="brk">' + rows.map(function (a) { return '<tr' + (a[2] ? ' class="t"' : '') + '><td>' + esc(a[0]) + '</td><td>' + (a[1] > 0 && a[0] !== '販売価格' && a[0] !== 'Amazonからの入金' && a[0] !== '利益(1個)' ? '+' : '') + yen(a[1]) + '</td></tr>'; }).join('') + '</table>' +
      '<table class="brk" style="margin-top:10px"><tr class="t"><td>損益分岐の販売価格</td><td>' + (be ? yen(be) + '円' : '—') + '</td></tr>' +
      '<tr class="t"><td>' + esc(U.targetLabel(tg)) + 'を残す販売価格</td><td>' + (sug ? yen(sug) + '円 <button type="button" class="b g s" id="c-usesug">この価格にする</button>' : '—') + '</td></tr>' +
      '<tr class="t"><td>仕入れ値の上限(' + esc(U.targetLabel(tg)) + ')</td><td>' + (maxc == null ? '届きません' : yen(maxc) + '円') + '</td></tr></table>' +
      (maxc != null && x.cost > maxc ? '<div class="warn">今の仕入れ値は上限を ' + yen(x.cost - maxc) + '円 超えています。</div>' : '') +
      (r.category.note ? '<p class="note-s">' + esc(r.category.label) + ': ' + esc(r.category.note) + '</p>' : '') +
      '<p class="note-s">販売手数料 ' + yen(r.referralEx) + '円(税抜)+消費税。' + (x.selfShip ? '' : 'FBAは ' + esc(r.tier ? r.tier.label : '') + '・' + (r.sell <= fees.amazon.fba_price_threshold ? '1,000円以下' : '1,000円超') + 'の料金。') + '</p>';
    var us = $('#c-usesug'); if (us) us.addEventListener('click', function () { $('#c-sell').value = sug; calc(); });
    return r;
  }

  function saveForm() {
    var f = {}; ['c-name', 'c-cost', 'c-inship', 'c-pt-shop', 'c-pt-mine', 'c-code', 'c-sell', 'c-cat', 'c-tier', 'c-inbound', 'c-other', 'c-selfship', 'c-qty'].forEach(function (id) { f[id] = $('#' + id).value; });
    f['c-usept'] = $('#c-usept').checked; f['c-self'] = $('#c-self').checked;
    U.store.set('ra-form', f);
  }
  function restoreForm() {
    var f = U.store.get('ra-form', null); if (!f) return;
    Object.keys(f).forEach(function (id) { var el = $('#' + id); if (!el) return; if (el.type === 'checkbox') el.checked = !!f[id]; else el.value = f[id]; });
    $('#c-selfship-w').hidden = !$('#c-self').checked;
  }

  $('#c-reset').addEventListener('click', function () {
    ['c-name', 'c-cost', 'c-code', 'c-sell'].forEach(function (id) { $('#' + id).value = ''; });
    $('#c-inship').value = 0; $('#c-pt-shop').value = 1; $('#kp-out').innerHTML = ''; updateLinks(); calc();
  });
  $('#c-self').addEventListener('change', function () { $('#c-selfship-w').hidden = !this.checked; });

  /* 寸法 → 区分の目安 */
  function dims() {
    var t = C.guessFbaTier(fees, [val('d1'), val('d2'), val('d3')], val('dg'));
    $('#d-out').textContent = t ? '目安: ' + t.label + '(長い物・重い物は大型になることがあります)' : '梱包した状態の寸法を入れてください。';
    if (t) { $('#c-tier').value = t.id; calc(); }
  }
  ['d1', 'd2', 'd3', 'dg'].forEach(function (id) { $('#' + id).addEventListener('input', dims); });

  /* ---------- Keepa(利用者のキー) ---------- */
  var CAT_MAP = [
    [/おもちゃ|ホビー/, 'toys'], [/パソコン/, 'pc'], [/大型家電/, 'large_appliance'], [/家電|カメラ|エレクトロニクス/, 'electronics'],
    [/ドラッグ|ビューティ|コスメ|ヘルス/, 'beauty'], [/食品|飲料/, 'food'], [/ビール/, 'beer'], [/ペット/, 'pet'], [/ベビー|マタニティ/, 'baby'],
    [/スポーツ|アウトドア/, 'sports'], [/車|バイク/, 'car'], [/DIY|工具/, 'diy'], [/文房具|オフィス/, 'stationery'], [/楽器/, 'instruments'],
    [/ガーデン|園芸/, 'garden'], [/家具/, 'furniture'], [/腕時計/, 'watch'], [/ジュエリー/, 'jewelry'], [/シューズ|靴/, 'shoes'],
    [/バッグ|スーツケース/, 'bags'], [/ファッション|服/, 'clothes'], [/産業|研究/, 'industrial'], [/ホーム|キッチン/, 'home'], [/ゲーム/, 'game_console']
  ];
  function kpPrice(v) { return v > 0 ? v : null; }
  $('#kp-go').addEventListener('click', function () {
    var k = keys(), code = $('#c-code').value.trim().replace(/\s/g, '');
    var out = $('#kp-out');
    if (!k.keepa) { out.innerHTML = '<div class="info">Keepa APIキーが未設定です。<a href="#keys">APIの設定</a>で入れるか、「Amazonで見る」で価格を確かめて、販売価格を手で入れてください。</div>'; return; }
    if (!code) { out.innerHTML = '<div class="info">JAN か ASIN を入れてください。</div>'; return; }
    var isAsin = /^B0[A-Z0-9]{8}$/i.test(code) || /^\d{9}[\dX]$/i.test(code);
    var p = new URLSearchParams({ key: k.keepa, domain: '5', stats: '90' });
    p.set(isAsin ? 'asin' : 'code', code.toUpperCase());
    if ($('#kp-bb').checked) p.set('buybox', '1');
    out.innerHTML = '<p class="note-s">Keepaに問い合わせ中…</p>';
    fetch(KEEPA_EP + '?' + p.toString()).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(r.status === 429 ? 'Keepaのトークンが足りません。少し待ってから試してください。' : 'Keepaの取得に失敗しました(' + r.status + ')。キーを確認してください。');
        return j;
      });
    }).then(function (j) {
      var pr = (j.products || [])[0];
      if (!pr || !pr.asin) { out.innerHTML = '<div class="info">Amazonで見つかりませんでした。</div>'; return; }
      var st = pr.stats || {}, cur = st.current || [], avg = st.avg90 || [];
      var bb = kpPrice(cur[18]), nw = kpPrice(cur[1]), amz = cur[0] > 0, cnt = cur[11] > 0 ? cur[11] : null, rank = cur[3] > 0 ? cur[3] : null;
      var sell = bb || nw;
      if (sell) $('#c-sell').value = sell;
      var catName = (pr.categoryTree && pr.categoryTree[0] && pr.categoryTree[0].name) || '';
      var hit = CAT_MAP.filter(function (m) { return m[0].test(catName); })[0];
      if (hit) $('#c-cat').value = hit[1];
      if (pr.packageLength > 0 && pr.packageWeight > 0) {
        $('#d1').value = pr.packageLength / 10; $('#d2').value = pr.packageWidth / 10; $('#d3').value = pr.packageHeight / 10; $('#dg').value = pr.packageWeight;
        dims();
      }
      $('#c-code').value = code; if (!$('#c-name').value) $('#c-name').value = pr.title || '';
      calc();
      out.innerHTML = '<div class="kp">' +
        '<div>カート価格<b>' + (bb ? yen(bb) + '円' : '—') + '</b></div>' +
        '<div>新品の最安値<b>' + (nw ? yen(nw) + '円' : '—') + '</b></div>' +
        '<div>新品の90日平均<b>' + (kpPrice(avg[1]) ? yen(avg[1]) + '円' : '—') + '</b></div>' +
        '<div>月の販売数(目安)<b>' + (pr.monthlySold > 0 ? pr.monthlySold + '個〜' : '—') + '</b></div>' +
        '<div>売れ筋ランキング<b>' + (rank ? yen(rank) + '位' : '—') + '</b></div>' +
        '<div>新品の出品者数<b>' + (cnt ? cnt + '人' : '—') + '</b></div>' +
        '<div>Amazon本体<b>' + (amz ? '在庫あり' : 'なし・在庫切れ') + '</b></div>' +
        '<div>カテゴリー<b>' + esc(catName || '—') + '</b></div></div>' +
        (amz ? '<div class="warn">Amazon本体が売っています。カートを取りにくいことがあります。</div>' : '') +
        (!hit ? '<p class="note-s">カテゴリーを自動で合わせられませんでした。手で選んでください。</p>' : '') +
        '<p class="note-s">' + esc(pr.asin) + ' / Keepa の残りトークン: ' + esc(j.tokensLeft) + '。販売価格は' + (bb ? 'カート価格' : '新品の最安値') + 'を入れました。</p>';
    }).catch(function (err) {
      var t = String(err && err.message || err);
      if (/Failed to fetch|NetworkError|Load failed/i.test(t)) t = 'Keepaに接続できませんでした。通信状態を確認してください。';
      out.innerHTML = '<div class="warn">' + esc(t) + '</div>';
    });
  });

  /* ---------- ウォッチ ---------- */
  function watchAll() { return U.store.get('watch', []); }
  function renderWatch() {
    var w = watchAll();
    $('#watch-count').textContent = w.length + '件';
    $('#watch-list').innerHTML = w.length ? '<div class="ledger-wrap"><table class="ledger"><thead><tr><th>保存日</th><th>品名</th><th>JAN/ASIN</th><th>仕入れ</th><th>売値</th><th>利益</th><th>利益率</th><th></th></tr></thead><tbody>' +
      w.map(function (r) {
        return '<tr><td>' + esc(r.date) + '</td><td class="nm">' + (r.url ? '<a href="' + esc(r.url) + '" target="_blank" rel="noopener">' + esc(r.name || '(名前なし)') + '</a>' : esc(r.name || '(名前なし)')) +
          '</td><td>' + esc(r.code) + '</td><td class="n">' + yen(r.cost) + '</td><td class="n">' + yen(r.sell) + '</td><td class="n">' + yen(r.profit) + '</td><td class="n">' + U.pct(r.margin) +
          '</td><td><button type="button" data-wdel="' + esc(r.id) + '">消す</button></td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="empty">まだありません。計算した商品を「ウォッチに保存」で残せます。</p>';
    $$('[data-wdel]').forEach(function (b) {
      b.addEventListener('click', function () { U.store.set('watch', watchAll().filter(function (r) { return r.id !== b.getAttribute('data-wdel'); })); renderWatch(); });
    });
  }
  $('#c-watch').addEventListener('click', function () {
    var r = calc(); if (!r) { U.toast('仕入れ値と販売価格を入れてください'); return; }
    var w = watchAll();
    w.unshift({ id: Date.now().toString(36), date: U.today(), name: $('#c-name').value, code: $('#c-code').value, cost: r.cost, sell: r.sell,
      profit: r.profit, margin: r.margin, url: last && last.url || '', src: last && last.src || '' });
    U.toast(U.store.set('watch', w.slice(0, 300)) ? 'ウォッチに保存しました' : 'この端末では保存できませんでした');
    renderWatch();
  });
  $('#watch-csv').addEventListener('click', function () {
    var rows = watchAll().map(function (r) { return [r.date, r.name, r.code, r.src === 'yahoo' ? 'Yahoo!ショッピング' : (r.src ? '楽天市場' : ''), r.url, r.cost, r.sell, r.profit, Math.round(r.margin * 1000) / 10]; });
    U.download('watch_' + U.today() + '.csv', C.toCSV(['保存日', '品名', 'JAN/ASIN', '仕入れ先', 'URL', '仕入れ値(円)', '売値(円)', '利益(円/個)', '利益率(%)'], rows));
  });
  $('#c-ledger').addEventListener('click', function () {
    var r = calc(); if (!r) { U.toast('仕入れ値と販売価格を入れてください'); return; }
    var qty = Math.max(1, Math.round(val('c-qty')) || 1);
    U.ledger.add({ kind: '仕入れ', cond: '新品', name: $('#c-name').value || '(名前なし)', feature: $('#c-code').value ? 'JAN/ASIN ' + $('#c-code').value : '',
      qty: qty, unit: r.cost + r.inShip, party: last ? (last.src === 'yahoo' ? 'Yahoo!ショッピング ' : '楽天市場 ') + (last.shop || '') : '',
      ref: last && last.url || '', sellTo: 'Amazon', sellPrice: r.sell, profit: r.profit, route: '楽天・Yahoo!→Amazon' });
  });

  /* ---------- 起動 ---------- */
  loadKeys(); showQuota(); loadToday(); renderWatch();
  U.loadFees().then(function (f) {
    fees = f;
    $('#c-cat').innerHTML = f.amazon.categories.map(function (c) { return '<option value="' + c.id + '">' + esc(c.label) + '</option>'; }).join('');
    $('#c-tier').innerHTML = f.amazon.fba_tiers.map(function (t) { return '<option value="' + t.id + '">' + esc(t.label) + '(' + yen(t.under) + '円/' + yen(t.over) + '円)</option>'; }).join('');
    $('#c-tier').value = 'std2c'; $('#c-cat').value = 'toys';
    restoreForm(); updateLinks();
    $$('#calc input, #calc select').forEach(function (el) { el.addEventListener('input', calc); el.addEventListener('change', calc); });
    calc();
  });
})();
