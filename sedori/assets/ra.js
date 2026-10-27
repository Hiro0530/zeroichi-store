/* 楽天・Yahoo!→Amazon: 検索 → 一覧(全行の利益を目標の利益で計算済み) → 行を選ぶ → この価格で出品 → 仕入れた(台帳へ自動記録) */
(function () {
  'use strict';
  document.addEventListener('sedori:acct', function () { if (document.getElementById('quota')) showQuota(); });
  var U = window.SedoriUI, C = window.SedoriCalc;
  var $ = U.$, $$ = U.$$, esc = U.esc, yen = U.yen, val = U.val;
  var FREE_SEARCHES_PER_DAY = 20;
  var RAKUTEN_EP = 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701';
  var KEEPA_EP = 'https://api.keepa.com/product';
  var CREDIT = '<a href="https://developers.rakuten.com/" target="_blank" rel="noopener">Supported by Rakuten Developers</a>';
  var fees = null, tab = 't', sel = -1, query = '', todayLabel = '';
  var lists = { s: [], t: [], w: [] };
  var manual = U.store.get('ra-manual', null) || { name: '', price: 0, inShip: 0, shopPt: 1, jan: '', sell: null, manual: true };

  /* ---------- キー ---------- */
  var KEY_IDS = { rkApp: 'k-rk-app', rkKey: 'k-rk-key', keepa: 'k-kp' };
  function keys() { return U.store.get('keys', {}); }
  function loadKeys() { var k = keys(); Object.keys(KEY_IDS).forEach(function (n) { $('#' + KEY_IDS[n]).value = k[n] || ''; }); }
  $('#k-save').addEventListener('click', function () {
    var k = keys(); Object.keys(KEY_IDS).forEach(function (n) { k[n] = $('#' + KEY_IDS[n]).value.trim(); });
    U.toast(U.store.set('keys', k) ? 'この端末に保存しました' : 'この端末では保存できませんでした(プライベートブラウズ等)');
    paintBulk();
  });
  $('#k-clear').addEventListener('click', function () {
    var old = keys(); U.store.del('keys'); loadKeys();
    U.toast('この端末から消しました', '元に戻す', function () { U.store.set('keys', old); loadKeys(); });
  });
  function openKeys() { var d = $('#keys'); d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(function () { $('#k-rk-app').focus({ preventScroll: true }); }, 300); }

  /* ---------- 無料版の回数 ---------- */
  function quota() { var q = U.store.get('quota', {}); if (q.d !== U.today()) q = { d: U.today(), n: 0 }; return q; }
  function paidPlan() { return !!(window.SedoriAccount && window.SedoriAccount.paid()); }
  function showQuota() { $('#quota').textContent = paidPlan() ? '楽天の検索 制限なし(有料プラン)' : '楽天の検索 今日あと' + Math.max(0, FREE_SEARCHES_PER_DAY - quota().n) + '回'; }
  function useQuota() { if (paidPlan()) return true; var q = quota(); if (q.n >= FREE_SEARCHES_PER_DAY) return false; q.n++; U.store.set('quota', q); showQuota(); return true; }

  /* ---------- 条件(左)と計算 ---------- */
  var COND_IDS = ['sort', 'c-cat', 'c-tier', 'c-inbound', 'c-other', 'c-pt-mine', 'c-carrier', 'c-selfship'];
  var COND_CHK = ['ptonly', 'freeonly', 'profitonly', 'c-usept', 'c-self'];
  function saveCond() {
    var f = {}; COND_IDS.forEach(function (id) { f[id] = $('#' + id).value; }); COND_CHK.forEach(function (id) { f[id] = $('#' + id).checked; });
    f.pmin = $('#pmin').value; f.pmax = $('#pmax').value;
    U.store.set('ra-cond', f);
  }
  function restoreCond() {
    var f = U.store.get('ra-cond', null); if (!f) return;
    COND_IDS.forEach(function (id) { if (f[id] != null && f[id] !== '') $('#' + id).value = f[id]; });
    COND_CHK.forEach(function (id) { if (f[id] != null) $('#' + id).checked = !!f[id]; });
    $('#pmin').value = f.pmin || ''; $('#pmax').value = f.pmax || '';
  }

  function input(it) {
    return {
      sell: it.sell || 0, category: it.cat || $('#c-cat').value, fbaTier: it.tier || $('#c-tier').value,
      cost: Number(it.price) || 0, inShip: Number(it.inShip) || 0, inbound: val('c-inbound'), other: val('c-other') + U.whTotal(fees), wh: U.whTotal(fees),
      pointRate: ((Number(it.shopPt) || 0) + val('c-pt-mine')) / 100, usePoints: $('#c-usept').checked,
      selfShip: $('#c-self').checked, selfShipCost: $('#c-self').checked ? C.carrierCost(fees, $('#c-carrier').value, val('c-selfship')) : 0
    };
  }
  /** 1行ぶんの計算。Amazon売値が無い時は、目標を満たす売値で計算して est=true */
  function compute(it) {
    if (!fees || !(Number(it.price) > 0)) return null;
    var x = input(it), tg = U.target();
    var sug = C.amazonPriceFor(fees, x, tg);
    var est = !(x.sell > 0);
    if (est) { if (!sug) return { sug: null, est: true }; x.sell = sug; }
    var r = C.amazonProfit(fees, x);
    r.sug = sug; r.est = est; r.x = x; r.fee = r.referral + (x.selfShip ? r.selfShipCost : r.fba);
    r.need = C.needProfit(r.sell, tg);
    return r;
  }

  /* ---------- 一覧 ---------- */
  function cur() { return lists[tab] || []; }
  function visible() {
    var pmin = val('pmin'), pmax = val('pmax'), free = $('#freeonly').checked, pto = $('#ptonly').checked, po = $('#profitonly').checked;
    return cur().map(function (it, i) { return { it: it, i: i, r: compute(it) }; }).filter(function (o) {
      var p = Number(o.it.price) || 0;
      if (pmin && p < pmin) return false;
      if (pmax && p > pmax) return false;
      if (free && !o.it.freeShip) return false;
      if (pto && tab !== 's' && !(o.it.shopPt >= 2)) return false;
      if (po && o.r && !o.r.est && o.r.profit < o.r.need) return false;
      return true;
    });
  }
  function rowHTML(o) {
    var it = o.it, r = o.r;
    var img = it.img ? '<img class="thumb" loading="lazy" src="' + esc(it.img) + '" alt="">' : '<span class="thumb no"></span>';
    var meta = [esc(it.shop || (it.src === 'yahoo' ? 'Yahoo!ショッピング' : '')), it.jan ? 'JAN ' + esc(it.jan) : '<span title="JANが見つからない商品">JANなし</span>', it.freeShip ? '<b>送料無料</b>' : '送料別']
      .filter(Boolean).join('<span aria-hidden="true">　</span>');
    var sellCell, feeCell = '—', pfCell = '—', rtCell = '—';
    if (r && r.sell) {
      sellCell = r.est ? '<span class="yen est" title="Amazon売値が未入力のため、目標の利益を満たす最安の売値を表示"><small class="estk">目標</small>' + yen(r.sell) + '<i>円</i></span>' : '<span class="yen">' + yen(r.sell) + '<i>円</i></span>';
      feeCell = yen(r.fee);
      var cls = r.profit < 0 ? 'bad' : (r.profit >= r.need ? 'good' : '');
      pfCell = '<span class="pf ' + (r.est ? 'est' : cls) + '">' + yen(r.profit) + '</span>';
      rtCell = '<span class="rt ' + (r.est ? 'est' : cls) + '">' + U.pct(r.margin) + '</span>';
    } else sellCell = r && r.est ? '<span class="yen est">届かない</span>' : '—';
    return '<tr data-i="' + o.i + '"' + (o.i === sel ? ' class="on" aria-selected="true"' : '') + '>' +
      '<td class="c-img">' + img + '</td>' +
      '<td><div class="nm" title="' + esc(it.name) + '">' + esc(it.name) + '</div><div class="meta">' + meta + '</div></td>' +
      '<td class="r" data-k="仕入れ値"><span class="yen">' + yen(it.price) + '<i>円</i></span></td>' +
      '<td class="r c-pt">' + (it.shopPt > 1 ? '<span class="pt">' + (it.src === 'yahoo' ? it.shopPt + '%' : 'P' + it.shopPt + '倍') + '</span>' : '<span class="muted">1倍</span>') + '</td>' +
      '<td class="r" data-k="Amazon売値">' + sellCell + '</td><td class="r c-fee fee">' + feeCell + '</td><td class="r" data-k="利益">' + pfCell + '</td><td class="r c-rt">' + rtCell + '</td></tr>';
  }
  function render() {
    $$('.tabs [data-tab]').forEach(function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-tab') === tab)); });
    $('#n-s').textContent = lists.s.length; $('#n-t').textContent = lists.t.length; $('#n-w').textContent = lists.w.length;
    var title = { s: query ? '「' + esc(query) + '」の検索結果<small>楽天市場 ' + lists.s.length + '件</small>' : '検索結果<small>上の検索欄から探せます</small>',
      t: '今日のポイント高還元<small>楽天市場 ' + esc(todayLabel) + ' 取得</small>', w: 'ウォッチ<small>' + lists.w.length + '件</small>' }[tab];
    $('#res-title').innerHTML = title;
    $('#w-csv').hidden = tab !== 'w' || !lists.w.length;
    var v = visible();
    var empty = { s: query ? '見つかりませんでした。言葉を短くするか、JANコードで探してください。' : '検索欄にキーワードかJANコードを入れて、検索してください。<br><kbd>/</kbd> で検索欄に移動します。',
      t: '今日の分はまだありません(毎朝更新)。', w: '気になる商品は、右の「ウォッチに追加」で残せます。' }[tab];
    $('#rows').innerHTML = v.length ? v.map(rowHTML).join('') : '<tr><td colspan="8" class="empty">' + (cur().length ? '絞り込みの条件に合う商品がありません。' : empty) + '</td></tr>';
    $('#credit').innerHTML = tab === 'w' ? '' : CREDIT + '。価格・在庫・ポイントは取得時点のものです。' + (tab === 't' ? 'PR: 商品へのリンクは楽天アフィリエイトのリンクです(価格は変わりません)。Amazonで売れるかは判定していません。' : '') +
      ' 灰色の売値は、Amazonの売値が未取得のため、目標の利益を満たす最安の売値で計算した値です。';
    paintBulk();
  }
  function paintBulk() {
    var k = keys(), n = cur().filter(function (it) { return it.jan && !it.sell; }).length;
    var b = $('#kp-bulk'); b.hidden = !(k.keepa && n);
    b.textContent = 'Keepaで売値をまとめて取得(' + n + '件・' + n + 'トークン)';
  }

  $('#rows').addEventListener('click', function (e) {
    if (e.target.closest('a')) return;
    var tr = e.target.closest('tr[data-i]'); if (!tr) return;
    select(Number(tr.getAttribute('data-i')), true);
  });
  $$('.tabs [data-tab]').forEach(function (b) {
    b.addEventListener('click', function () { tab = b.getAttribute('data-tab'); sel = -1; U.store.set('ra-tab', tab); render(); fillDetail(); });
  });

  /* ---------- 選んだ商品(右) ---------- */
  function selected() { return sel >= 0 && cur()[sel] ? cur()[sel] : manual; }
  function select(i, scroll) {
    sel = i; U.store.set('ra-sel', { tab: tab, i: i });
    $$('#rows tr[data-i]').forEach(function (tr) { var on = Number(tr.getAttribute('data-i')) === i; tr.classList.toggle('on', on); if (on) tr.setAttribute('aria-selected', 'true'); else tr.removeAttribute('aria-selected'); });
    fillDetail();
    var it = selected();
    if (keys().keepa && it.jan && !it.sell && !it.kp) kpFetch(it);
    if (scroll && U.narrow()) $('#calc').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function fillDetail() {
    var it = selected();
    $('#d-name').textContent = it.manual ? '手入力' : it.name;
    $('#d-name').classList.toggle('ph', !!it.manual);
    $('#d-sub').innerHTML = it.manual ? '一覧の行を選ぶと、その商品の値が入ります。' : esc(it.shop || '') + (it.url ? '　<a href="' + esc(it.url) + '" target="_blank" rel="noopener">商品ページ</a>' : '');
    $('#c-cost').value = it.price || '';
    $('#c-inship').value = it.inShip || 0;
    $('#c-pt-shop').value = it.shopPt || 1;
    $('#c-code').value = it.jan || it.asin || '';
    $('#c-sell').value = it.sell || '';
    $('#c-qty').value = it.qty || 1;
    $('#kp-out').innerHTML = it.kp ? kpHTML(it.kp) : '';
    $('#party').innerHTML = '';
    paintBuy(false);
    calcDetail(); links();
  }
  function fromDetail() {
    var it = selected();
    it.price = val('c-cost'); it.inShip = val('c-inship'); it.shopPt = val('c-pt-shop');
    var code = $('#c-code').value.trim(); if (/^B0/i.test(code)) it.asin = code; else it.jan = code;
    it.sell = val('c-sell') || null; it.qty = Math.max(1, val('c-qty') || 1);
    if (it.manual) U.store.set('ra-manual', it);
    persistList();
    var tr = $('#rows tr[data-i="' + sel + '"]');
    if (tr && sel >= 0) { var o = { it: it, i: sel, r: compute(it) }; var tmp = document.createElement('tbody'); tmp.innerHTML = rowHTML(o); tr.replaceWith(tmp.firstChild); }
    calcDetail(); links();
  }
  ['c-cost', 'c-inship', 'c-pt-shop', 'c-code', 'c-sell', 'c-qty'].forEach(function (id) { $('#' + id).addEventListener('input', fromDetail); });

  var lastCalc = null;
  function calcDetail() {
    var it = selected(), out = $('#c-out');
    var r = compute(it); lastCalc = r;
    if (!r || !r.sell) {
      U.result(out, '<p class="note">' + (r && r.est ? '目標の利益(' + esc(U.targetLabel()) + ')に届く売値がありません。' : '仕入れ値を入れると、目標の利益を満たす売値と内訳が出ます。') + '</p>', null, '');
      return;
    }
    var x = r.x, tg = U.target();
    var be = C.amazonBreakEvenSell(fees, x), maxc = C.amazonMaxCost(fees, Object.assign({}, x), tg);
    var rows = [['販売価格' + (r.est ? '(目標の売値)' : ''), r.sell], ['販売手数料', -r.referral], [x.selfShip ? '送料(' + esc(carrierName()) + ')' : 'FBA配送代行手数料', x.selfShip ? -r.selfShipCost : -r.fba],
      ['Amazonからの入金', r.payout, 't'], ['仕入れ値', -r.cost]];
    if (r.inShip) rows.push(['仕入れの送料', -r.inShip]);
    if (r.inbound) rows.push(['納品送料・資材', -r.inbound]);
    if (x.wh) rows.push(['発送代行(入庫・保管・撮影・出荷)', -x.wh]);
    if (r.other - (x.wh || 0)) rows.push(['その他', -(r.other - (x.wh || 0))]);
    if (x.usePoints && r.points) rows.push(['ポイント(' + U.pct(x.pointRate) + '・税抜で計算)', r.points]);
    rows.push(['利益(1個)', r.profit, 't']);
    var keyRows = [['目標(' + esc(U.targetLabel(tg)) + ')を満たす売値', r.sug ? yen(r.sug) + '円' : '届かない', 'key go'], ['損益分岐の売値', be ? yen(be) + '円' : '—', 'key']];
    if (!r.est) keyRows.push(['仕入れ値の上限', maxc == null ? '届かない' : yen(maxc) + '円', 'key']);
    var cls = U.profitClass(r.profit, r.sell, tg);
    var head = r.est ?
      '<div class="pfbox"><div class="hl"><span>この売値以上なら目標に届く</span><b>' + yen(r.sug) + '<i>円</i></b></div>' +
      '<div class="kpi"><div><b>' + yen(r.profit) + '円</b>その時の利益</div><div><b>' + (be ? yen(be) + '円' : '—') + '</b>損益分岐</div><div><b>' + yen(r.points) + '円</b>ポイント</div></div>' :
      U.profitHead('利益(1個)', r.profit, cls) +
      '<div class="kpi"><div><b>' + U.pct(r.margin) + '</b>利益率</div><div><b>' + U.pct(r.roi, 0) + '</b>仕入れに対して</div><div><b>' + yen(r.profitNoPoints) + '円</b>ポイント抜き</div></div>' + U.brkRows(keyRows);
    U.result(out, head + '</div>' +
      (!r.est && maxc != null && x.cost > maxc ? '<p class="warn-line">仕入れ値が上限を' + yen(x.cost - maxc) + '円超えています</p>' : '') +
      (r.est ? '<p class="note">Amazon売値が未入力です。Keepaで取得するか、見た売値を入れると利益が出ます。</p>' : ''),
      rows,
      '<p class="note">' + esc(r.category.label) + (x.selfShip ? '・自己発送' : '・' + esc(r.tier ? r.tier.label.replace(/\(.*\)/, '') : '') + '・' + (r.sell <= fees.amazon.fba_price_threshold ? '1,000円以下' : '1,000円超') + 'の料金') + '。保管手数料・返品は含みません。</p>');
  }

  /* この価格で出品 / 仕入れた */
  function listAtTarget() {
    var it = selected(), r = lastCalc;
    if (!r || !r.sug) { U.toast('目標の利益に届く売値がありません'); return; }
    it.sell = r.sug; $('#c-sell').value = r.sug; fromDetail();
    U.toast('出品価格を' + yen(r.sug) + '円にしました');
  }
  function paintBuy(done) {
    var b = $('[data-act="buy"]'); b.classList.toggle('done', !!done);
    b.innerHTML = done ? '台帳に記録済み' : '仕入れた<kbd>S</kbd>';
  }
  function buy() {
    var it = selected(), r = compute(it);
    if (!r || !r.sell) { U.toast('仕入れ値を入れてください'); $('#c-cost').focus(); return; }
    if (r.est) { it.sell = r.sug; $('#c-sell').value = r.sug; fromDetail(); r = compute(it); }
    var qty = Math.max(1, val('c-qty') || 1);
    var row = U.ledger.add({ ship: r.x.selfShip ? U.shipMode() : 'fba', cond: '新品', hinmoku: U.hinmokuFor(r.x.category), name: it.name || '(名前なし)',
      feature: [it.jan ? 'JAN ' + it.jan : '', it.asin ? 'ASIN ' + it.asin : ''].filter(Boolean).join(' '),
      qty: qty, unit: r.cost + r.inShip, party: it.manual ? '' : (it.src === 'yahoo' ? 'Yahoo!ショッピング ' : '楽天市場 ') + (it.shop || ''),
      ref: it.url || '', sellTo: 'Amazon', sellPrice: r.sell, profit: r.profit, route: '楽天・Yahoo!→Amazon' });
    if (row) { paintBuy(true); it.bought = row.id; persistList(); }
  }
  $('[data-act="list"]').addEventListener('click', listAtTarget);
  $('[data-act="buy"]').addEventListener('click', buy);

  /* ---------- 検索(楽天の公式API・利用者のID) ---------- */
  function msg(html, err) { $('#res-msg').innerHTML = html ? '<div class="msg' + (err ? ' err' : '') + '">' + html + '</div>' : ''; }
  function searchRakuten(q, k) {
    var sort = { price: '+itemPrice', standard: 'standard', review: '-reviewCount' }[$('#sort').value];
    var p = new URLSearchParams({ applicationId: k.rkApp, accessKey: k.rkKey, keyword: q, hits: '30', availability: '1', sort: sort, formatVersion: '2', imageFlag: '1' });
    if ($('#ptonly').checked) p.set('pointRateFlag', '1');
    if (val('pmin')) p.set('minPrice', String(val('pmin')));
    if (val('pmax')) p.set('maxPrice', String(val('pmax')));
    if ($('#freeonly').checked) p.set('postageFlag', '1');
    return fetch(RAKUTEN_EP + '?' + p.toString(), { referrerPolicy: 'strict-origin-when-cross-origin' }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(r.status === 403 ? '楽天が403を返しました。アプリ設定の「許可するWebサイト」に ' + location.origin + ' が入っているか確認してください。' :
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
  function doSearch(q) {
    var k = keys();
    query = q; tab = 's'; sel = -1;
    if (!q) { render(); $('#sb-q').focus(); return; }
    if (!(k.rkApp && k.rkKey)) {
      lists.s = []; render();
      msg('楽天の検索には、ご自身の楽天アプリIDとアクセスキー(無料)が必要です。<button type="button" class="lnk" id="open-keys">APIキーを入れる</button>　Yahoo!ショッピングは、検索欄の「探す場所」で選ぶと公式の検索ページを開きます。');
      $('#open-keys').addEventListener('click', openKeys); return;
    }
    if (!useQuota()) { msg('無料版の今日の検索回数(' + FREE_SEARCHES_PER_DAY + '回)を使い切りました。明日また使えます。計算と台帳は制限なく使えます。'); return; }
    msg(''); $('#rows').innerHTML = '<tr class="loading"><td colspan="8">楽天市場を検索しています</td></tr>';
    searchRakuten(q, k).then(function (list) {
      lists.s = list; U.store.set('ra-last', { q: q, items: list }); render(); fillDetail();
    }).catch(function (err) {
      var t = String(err && err.message || err);
      if (/Failed to fetch|NetworkError|Load failed/i.test(t)) t = '接続できませんでした。通信状態か、IDの設定(許可するWebサイト)を確認してください。';
      lists.s = []; render(); msg(t, true);
    });
  }
  U.api.onSearch = function (src, q) {
    if (src === 'rakuten') { doSearch(q); return true; }
    if (src === 'amazon' && q) {
      var it = selected(); $('#c-code').value = q; fromDetail();
      if (keys().keepa) kpFetch(it); else window.open(U.extUrl('amazon', q), '_blank', 'noopener');
      return true;
    }
    return false;
  };

  /* ---------- Keepa(利用者のキー) ---------- */
  var CAT_MAP = [
    [/おもちゃ|ホビー/, 'toys'], [/パソコン/, 'pc'], [/大型家電/, 'large_appliance'], [/家電|カメラ|エレクトロニクス/, 'electronics'],
    [/ドラッグ|ビューティ|コスメ|ヘルス/, 'beauty'], [/食品|飲料/, 'food'], [/ビール/, 'beer'], [/ペット/, 'pet'], [/ベビー|マタニティ/, 'baby'],
    [/スポーツ|アウトドア/, 'sports'], [/車|バイク/, 'car'], [/DIY|工具/, 'diy'], [/文房具|オフィス/, 'stationery'], [/楽器/, 'instruments'],
    [/ガーデン|園芸/, 'garden'], [/家具/, 'furniture'], [/腕時計/, 'watch'], [/ジュエリー/, 'jewelry'], [/シューズ|靴/, 'shoes'],
    [/バッグ|スーツケース/, 'bags'], [/ファッション|服/, 'clothes'], [/産業|研究/, 'industrial'], [/ホーム|キッチン/, 'home'], [/ゲーム/, 'game_console']
  ];
  function kpPrice(v) { return v > 0 ? v : null; }
  function applyKeepa(it, pr) {
    var st = pr.stats || {}, c = st.current || [], avg = st.avg90 || [];
    var bb = kpPrice(c[18]), nw = kpPrice(c[1]);
    var catName = (pr.categoryTree && pr.categoryTree[0] && pr.categoryTree[0].name) || '';
    var hit = CAT_MAP.filter(function (m) { return m[0].test(catName); })[0];
    it.asin = pr.asin; it.sell = bb || nw || it.sell;
    if (hit) it.cat = hit[1];
    if (pr.packageLength > 0 && pr.packageWeight > 0) {
      var t = C.guessFbaTier(fees, [pr.packageLength / 10, pr.packageWidth / 10, pr.packageHeight / 10], pr.packageWeight); if (t) it.tier = t.id;
    }
    it.kp = { bb: bb, nw: nw, avg: kpPrice(avg[1]), sold: pr.monthlySold > 0 ? pr.monthlySold : null, rank: c[3] > 0 ? c[3] : null, cnt: c[11] > 0 ? c[11] : null, amz: c[0] > 0, cat: catName, asin: pr.asin };
  }
  function kpHTML(k) {
    return '<table class="kpx"><tr><td>カート価格</td><td>' + (k.bb ? yen(k.bb) + '円' : '—') + '</td><td>新品最安</td><td>' + (k.nw ? yen(k.nw) + '円' : '—') + '</td></tr>' +
      '<tr><td>90日平均</td><td>' + (k.avg ? yen(k.avg) + '円' : '—') + '</td><td>月の販売</td><td>' + (k.sold ? k.sold + '個〜' : '—') + '</td></tr>' +
      '<tr><td>ランキング</td><td>' + (k.rank ? yen(k.rank) + '位' : '—') + '</td><td>出品者</td><td>' + (k.cnt ? k.cnt + '人' : '—') + '</td></tr>' +
      '<tr><td>Amazon本体</td><td>' + (k.amz ? '在庫あり' : 'なし') + '</td><td>ASIN</td><td>' + esc(k.asin || '') + '</td></tr></table>' +
      (k.amz ? '<p class="warn-line">Amazon本体が販売中。カートを取りにくいことがあります</p>' : '');
  }
  function kpErr(t) { if (/Failed to fetch|NetworkError|Load failed/i.test(t)) t = 'Keepaに接続できませんでした。'; return '<p class="warn-line">' + esc(t) + '</p>'; }
  function kpCall(params) {
    var p = new URLSearchParams(Object.assign({ key: keys().keepa, domain: '5', stats: '90' }, params));
    return fetch(KEEPA_EP + '?' + p.toString()).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(r.status === 429 ? 'Keepaのトークンが足りません。少し待ってから試してください。' : 'Keepaの取得に失敗しました(' + r.status + ')。キーを確認してください。');
        return j;
      });
    });
  }
  function kpFetch(it) {
    var code = String(it.asin || it.jan || '').replace(/\s/g, ''), out = $('#kp-out');
    if (!keys().keepa) { out.innerHTML = '<p class="note">Keepa APIキーが未設定です。<button type="button" class="lnk" id="kp-key">キーを入れる</button>か、「Amazonで見る」で売値を確かめて入れてください。</p>'; $('#kp-key').addEventListener('click', openKeys); return; }
    if (!code) { out.innerHTML = '<p class="note">JANかASINを入れてください。</p>'; return; }
    var isAsin = /^B0[A-Z0-9]{8}$/i.test(code) || /^\d{9}[\dX]$/i.test(code);
    out.innerHTML = '<p class="note">Keepaに問い合わせています</p>';
    var prm = {}; prm[isAsin ? 'asin' : 'code'] = code.toUpperCase();
    kpCall(prm).then(function (j) {
      var pr = (j.products || [])[0];
      if (!pr || !pr.asin) { if (selected() === it) out.innerHTML = '<p class="note">Amazonで見つかりませんでした。</p>'; return; }
      applyKeepa(it, pr); persistList();
      if (selected() === it) fillDetail(); render();
    }).catch(function (err) { if (selected() === it) out.innerHTML = kpErr(String(err && err.message || err)); });
  }
  $('#kp-go').addEventListener('click', function () { fromDetail(); kpFetch(selected()); });
  $('#kp-bulk').addEventListener('click', function () {
    var items = cur().filter(function (it) { return it.jan && !it.sell; }).slice(0, 100);
    if (!items.length) return;
    var b = $('#kp-bulk'); b.disabled = true; b.textContent = 'Keepaに問い合わせています';
    kpCall({ code: items.map(function (it) { return it.jan; }).join(',') }).then(function (j) {
      var n = 0;
      (j.products || []).forEach(function (pr) {
        var codes = (pr.eanList || []).concat(pr.upcList || []);
        items.forEach(function (it) { if (codes.indexOf(it.jan) >= 0) { applyKeepa(it, pr); n++; } });
      });
      persistList(); render(); fillDetail();
      U.toast(n + '件の売値を取得しました(残りトークン ' + j.tokensLeft + ')');
    }).catch(function (err) { msg(esc(String(err && err.message || err)), true); }).then(function () { b.disabled = false; paintBulk(); });
  });

  function links() {
    var code = $('#c-code').value.trim();
    $('#amz-link').href = code ? U.extUrl('amazon', code) : 'https://www.amazon.co.jp/';
    $('#kp-link').href = code ? 'https://keepa.com/#!search/5-' + encodeURIComponent(code) : 'https://keepa.com/';
  }

  /* 寸法 → 区分の目安(左の条件に入れる) */
  function dims() {
    var t = C.guessFbaTier(fees, [val('d1'), val('d2'), val('d3')], val('dg'));
    $('#d-out').textContent = t ? '目安: ' + t.label + '。この商品に使います。' : '梱包した状態の寸法を入れてください。';
    if (t) { selected().tier = t.id; persistList(); fromDetail(); }
  }
  ['d1', 'd2', 'd3', 'dg'].forEach(function (id) { $('#' + id).addEventListener('input', dims); });

  /* ---------- ウォッチ ---------- */
  function persistList() {
    if (tab === 's') U.store.set('ra-last', { q: query, items: lists.s });
    if (tab === 'w') U.store.set('watch2', lists.w);
  }
  $('#c-watch').addEventListener('click', function () {
    var it = selected(); if (!(Number(it.price) > 0)) { U.toast('仕入れ値を入れてください'); return; }
    var copy = JSON.parse(JSON.stringify(it)); delete copy.manual; copy.saved = U.today(); if (!copy.name) copy.name = '(名前なし)';
    lists.w.unshift(copy); lists.w = lists.w.slice(0, 300);
    U.toast(U.store.set('watch2', lists.w) ? 'ウォッチに追加しました' : 'この端末では保存できませんでした', 'ウォッチを見る', function () { tab = 'w'; sel = 0; render(); fillDetail(); });
    $('#n-w').textContent = lists.w.length;
  });
  $('#w-csv').addEventListener('click', function () {
    var rows = lists.w.map(function (it) { var r = compute(it) || {}; return [it.saved || '', it.name, it.jan || it.asin || '', it.shop || '', it.url || '', it.price, r.sell || '', r.profit == null ? '' : r.profit, r.margin == null ? '' : Math.round(r.margin * 1000) / 10]; });
    U.download('watch_' + U.today() + '.csv', C.toCSV(['保存日', '品名', 'JAN/ASIN', 'ショップ', 'URL', '仕入れ値(円)', 'Amazon売値(円)', '利益(円/個)', '利益率(%)'], rows));
  });
  function loadWatch() {
    var w = U.store.get('watch2', null);
    if (!w) { // 以前の形式から移す
      w = (U.store.get('watch', []) || []).map(function (r) { return { name: r.name, price: r.cost, jan: r.code, sell: r.sell, url: r.url, src: r.src, saved: r.date, shopPt: 1 }; });
    }
    lists.w = w;
  }

  /* ---------- 今日の候補 ---------- */
  function loadToday() {
    return fetch('../data/today.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (j) {
      todayLabel = j.fetched_at_label || '';
      lists.t = (j.items || []).map(function (it) {
        return { src: 'rakuten', name: it.name, price: it.price, url: it.url, shop: it.shop, img: it.img || '', shopPt: it.pointRate || 1,
          freeShip: !!it.freeShip, jan: it.jan || C.extractJan(it.name), until: it.until || '', genre: it.genre || '' };
      });
    }).catch(function () { lists.t = []; });
  }

  /* ---------- キー操作 ---------- */
  U.api.page = {
    move: function (d) {
      var v = visible(); if (!v.length) return;
      var pos = v.findIndex(function (o) { return o.i === sel; });
      pos = pos < 0 ? 0 : Math.max(0, Math.min(v.length - 1, pos + d));
      select(v[pos].i);
      var tr = $('#rows tr[data-i="' + v[pos].i + '"]'); if (tr) tr.scrollIntoView({ block: 'nearest' });
    },
    list: listAtTarget, buy: buy
  };

  /* ---------- 起動 ---------- */
  function carrierName() { var c = C.findCarrier(fees, $('#c-carrier').value); return c ? c.label.replace(/\(.*\)/, '') : ''; }
  function paintCarrier() {
    var custom = $('#c-carrier').value === 'custom';
    $('#c-selfship').disabled = !custom;
    if (!custom) $('#c-selfship').value = C.carrierCost(fees, $('#c-carrier').value, 0);
  }
  function paintShipNote() {
    U.mountWh($('#wh'), fees, $('#c-self').checked ? '' : { self: 'FBA: Amazonが発送します。納品は自分で(納品送料は条件の欄)', pl: '発送代行がFBAへ納品します' });
  }
  $('#c-self').addEventListener('change', function () { $('#c-selfship-w').hidden = !this.checked; paintShipNote(); });
  loadKeys(); showQuota(); loadWatch();
  var last = U.store.get('ra-last', null); if (last) { lists.s = last.items || []; query = last.q || ''; }
  $('[data-act="list"]').innerHTML = 'この価格で出品<kbd>Enter</kbd>';
  document.addEventListener('sedori:target', function () { render(); calcDetail(); });
  document.addEventListener('sedori:wh', function () { render(); calcDetail(); });
  Promise.all([U.loadFees(), loadToday()]).then(function (a) {
    fees = a[0];
    $('#c-cat').innerHTML = fees.amazon.categories.map(function (c) { return '<option value="' + c.id + '">' + esc(c.label) + '</option>'; }).join('');
    $('#c-tier').innerHTML = fees.amazon.fba_tiers.map(function (t) { return '<option value="' + t.id + '">' + esc(t.label) + '</option>'; }).join('');
    $('#c-tier').value = 'std2c'; $('#c-cat').value = 'toys';
    $('#c-carrier').innerHTML = U.carrierOptions(fees, 'yp60');
    restoreCond();
    if (!C.findCarrier(fees, $('#c-carrier').value)) $('#c-carrier').value = 'yp60';
    $('#c-selfship-w').hidden = !$('#c-self').checked;
    paintCarrier(); paintShipNote();
    $('#c-carrier').addEventListener('change', paintCarrier);
    $$('.side input, .side select').forEach(function (el) {
      if (/^k-/.test(el.id)) return;
      el.addEventListener('input', function () { saveCond(); render(); calcDetail(); });
      el.addEventListener('change', function () { saveCond(); render(); calcDetail(); });
    });
    var p = new URLSearchParams(location.search), s = U.store.get('ra-sel', null);
    tab = U.store.get('ra-tab', null) || (lists.s.length ? 's' : 't');
    if (!lists[tab]) tab = 't';
    if (p.get('t') != null) { tab = 't'; sel = Number(p.get('t')); }
    else if (s && s.tab === tab && cur()[s.i]) sel = s.i;
    render(); fillDetail();
    if (p.get('q')) doSearch(p.get('q'));
  });
})();
