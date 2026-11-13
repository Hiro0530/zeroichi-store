/* 楽天・Yahoo!→Amazon: 検索 → 一覧(全行の利益を目標の利益で計算済み) → 行を選ぶ → この価格で出品 → 仕入れた(台帳へ自動記録)
   一覧は3つ: s=検索結果 / b=まとめて(貼った一覧。働きは bulk.js) / w=ウォッチ。ほかの部品が使う口は末尾の window.SedoriRA */
(function () {
  'use strict';
  document.addEventListener('sedori:acct', function () { if (document.getElementById('quota')) showQuota(); });
  var U = window.SedoriUI, C = window.SedoriCalc;
  var $ = U.$, $$ = U.$$, esc = U.esc, yen = U.yen, val = U.val;
  var FREE_SEARCHES_PER_DAY = 20;
  var RAKUTEN_EP = 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701';
  var KEEPA_EP = 'https://api.keepa.com/product';
  var CREDIT = '<a href="https://developers.rakuten.com/" target="_blank" rel="noopener">Supported by Rakuten Developers</a>';
  var fees = null, tab = 's', sel = -1, query = '';
  var lists = { s: [], b: [], w: [] };
  /* ほかの部品(bulk.js・watch-check.js・precheck.js)が使う口。中身は末尾で入れる。
     R.rowBadge = function (it, tab) { return 'HTML'; } を入れると、一覧の各行の2行目に印を足せる */
  var R = window.SedoriRA = { rowBadge: null };
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
  var COND_IDS = ['sort', 'c-cat', 'c-tier', 'c-inbound', 'c-other', 'c-pt-mine', 'c-carrier', 'c-selfship', 'f-sold', 'f-cnt'];
  var COND_CHK = ['ptonly', 'freeonly', 'profitonly', 'c-usept', 'c-self', 'f-noamz'];
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

  /** FBAで売り、発送のしかたが「発送代行」の時は、納品代行の費用(代行料+箱÷個数)を「納品送料」の代わりに引く。
      この時、自社発送の倉庫向けの4項目(入庫・保管・撮影・出荷)は足さない(二重に引かない) */
  function fbaPrep() { return !$('#c-self').checked && U.shipMode() === '3pl'; }
  function input(it) {
    var prep = fbaPrep(), wh = prep ? 0 : U.whTotal(fees);
    return {
      sell: it.sell || 0, category: it.cat || $('#c-cat').value, fbaTier: it.tier || $('#c-tier').value,
      cost: Number(it.price) || 0, inShip: Number(it.inShip) || 0, inbound: prep ? U.prepUnit(fees) : val('c-inbound'), other: val('c-other') + wh, wh: wh, prep: prep,
      pointRate: ((Number(it.shopPt) || 0) + val('c-pt-mine')) / 100, usePoints: $('#c-usept').checked,
      selfShip: $('#c-self').checked, selfShipCost: $('#c-self').checked ? C.carrierCost(fees, $('#c-carrier').value, val('c-selfship')) : 0
    };
  }
  /** 1行ぶんの計算。Amazon売値が無い時は、目標を満たす売値で計算して est=true。
      目標の売値はポイント抜きで逆算する(価格差が先、ポイントは後。ポイントを足して目標に届く売値は出さない) */
  function compute(it) {
    if (!fees || !(Number(it.price) > 0)) return null;
    if (C.tooBig(it.price) || C.tooBig(it.sell) || C.tooBig(it.inShip)) return { over: true, est: true, sug: null };   // 入れ間違いらしい金額は計算しない
    var x = input(it), tg = U.target();
    var sug = C.amazonPriceFor(fees, Object.assign({}, x, { usePoints: false }), tg);
    var est = !(x.sell > 0);
    if (est) { if (!sug) return { sug: null, est: true }; x.sell = sug; }
    var r = C.amazonProfit(fees, x);
    r.sug = sug; r.est = est; r.x = x; r.fee = r.referral + (x.selfShip ? r.selfShipCost : r.fba);
    r.need = C.needProfit(r.sell, tg);
    return r;
  }
  /** 仕入れ値が無い行(まとめてで、仕入れ値も楽天のキーも無い時)の、仕入れ値の上限(ポイント抜きで目標に届く)。売値が無ければ undefined */
  function maxCostOf(it) {
    if (!fees || !(Number(it.sell) > 0) || C.tooBig(it.sell)) return undefined;
    return C.amazonMaxCost(fees, Object.assign({}, input(it), { cost: 0, usePoints: false }), U.target());
  }
  /** 1行の判定: 'ok'(目標に届く)/'ng'(届かない)/'unk'(売値か仕入れ値が無く、確かめられない)。ポイント抜きの利益で見る */
  function judge(it) {
    var has = Number(it.price) > 0;
    return C.bulkJudge(has ? compute(it) : null, has, has ? undefined : maxCostOf(it));
  }

  /* ---------- 一覧 ---------- */
  function cur() { return lists[tab] || []; }
  function visible() {
    var pmin = val('pmin'), pmax = val('pmax'), free = $('#freeonly').checked, pto = $('#ptonly').checked, po = $('#profitonly').checked;
    var noamz = $('#f-noamz').checked, fsold = val('f-sold'), fcnt = val('f-cnt');
    return cur().map(function (it, i) { return { it: it, i: i, r: compute(it) }; }).filter(function (o) {
      var p = Number(o.it.price) || 0;
      if (p > 0) {                                   // 仕入れ値が無い行(まとめて)は、価格・送料・ポイントでは外さない
        if (pmin && p < pmin) return false;
        if (pmax && p > pmax) return false;
        if (free && !o.it.freeShip && tab !== 'b') return false;
        if (pto && tab !== 's' && !(o.it.shopPt >= 2)) return false;
      }
      // 目標に届くかは、ポイント抜きの利益で見る(行の色と同じ)。売値が未入力の行は残す
      if (po && o.r && !o.r.est && o.r.profitNoPoints < o.r.need) return false;
      if (po && !(p > 0) && o.it.sell > 0 && maxCostOf(o.it) == null) return false;
      // Amazonの売れ方(Keepaの値)。値が無い行は外さず「未取得」と出す
      var k = o.it.kp;
      if (k) {
        if (noamz && k.amz) return false;
        if (fsold && k.sold != null && k.sold < fsold) return false;
        if (fcnt && k.cnt != null && k.cnt > fcnt) return false;
      }
      return true;
    });
  }
  function rowHTML(o) {
    var it = o.it, r = o.r;
    var img = it.img ? '<img class="thumb" loading="lazy" src="' + esc(it.img) + '" alt="">' : '<span class="thumb no"></span>';
    var hasCost = Number(it.price) > 0, k = it.kp;
    var kpWanted = tab === 'b' || $('#f-noamz').checked || val('f-sold') || val('f-cnt');
    var meta = [esc(it.shop || (it.src === 'yahoo' ? 'Yahoo!ショッピング' : '')), it.jan ? 'JAN ' + esc(it.jan) : (it.asin ? 'ASIN ' + esc(it.asin) : '<span title="JANが見つからない商品">JANなし</span>'),
      hasCost ? (it.freeShip ? '<b>送料無料</b>' : (it.src === 'bulk' && !it.shop ? '' : '送料別')) : '',
      k ? (k.sold != null ? '月の販売 ' + k.sold + '個〜' : (kpWanted && k.cnt == null ? '売れ方は取れていません' : '')) : (kpWanted ? '<span title="Keepaの値がまだ無い行です。絞り込みでは外しません">売れ方は取れていません</span>' : ''),
      k && k.cnt != null ? '出品者 ' + k.cnt + '人' : '', k && k.amz ? '<b class="amz">Amazon本体が販売中</b>' : '',
      R.rowBadge ? (R.rowBadge(it, tab) || '') : '']
      .filter(Boolean).join('<span aria-hidden="true">　</span>');
    var sellCell, feeCell = '—', pfCell = '—', rtCell = '—', costCell = '<span class="yen">' + yen(it.price) + '<i>円</i></span>';
    if (!hasCost) {
      // 仕入れ値が無い行: 利益の代わりに、仕入れ値の上限(ポイント抜きで目標に届く)を出す
      var mc = maxCostOf(it);
      costCell = mc === undefined ? '<span class="muted">未入力</span>' : (mc == null ? '<span class="yen est">届かない</span>' :
        '<span class="yen est" title="この売値で、ポイント抜きで目標の利益に届く仕入れ値の上限"><small class="estk">上限</small>' + yen(mc) + '<i>円</i></span>');
      sellCell = it.sell > 0 ? '<span class="yen">' + yen(it.sell) + '<i>円</i></span>' : '<span class="muted">未入力</span>';
      pfCell = '<span class="muted" title="仕入れ値を入れると計算します">—</span>';
    } else if (r && r.sell && r.est) {
      // 実際の売値が未入力: 目標の売値は逆算の目安として薄く出し、利益は出さない
      sellCell = '<span class="yen est" title="Amazonの実際の売値が未入力です。目標の利益から逆算した目安の売値を表示しています"><small class="estk">目標から逆算</small>' + yen(r.sell) + '<i>円</i></span>';
      pfCell = '<span class="muted" title="実際の売値を入れると出ます">未入力</span>';
    } else if (r && r.sell) {
      sellCell = '<span class="yen">' + yen(r.sell) + '<i>円</i></span>';
      feeCell = yen(r.fee);
      var np = r.profitNoPoints, cls = np <= 0 ? 'bad' : (np >= r.need ? 'good' : '');  // 目標に届いたかもポイント抜きで見る
      pfCell = '<span class="pf ' + cls + '">' + yen(np) + '</span>' + (r.x.usePoints && r.points ? '<small class="ptadd">ポイント' + yen(r.points) + '円</small>' : '');
      rtCell = '<span class="rt ' + cls + '">' + U.pct(r.sell > 0 ? np / r.sell : 0) + '</span>';
    } else if (r && r.over) { sellCell = '—'; pfCell = '<span class="muted">金額を確かめてください</span>'; }
    else sellCell = r && r.est ? '<span class="yen est">届かない</span>' : '—';
    return '<tr data-i="' + o.i + '"' + (o.i === sel ? ' class="on" aria-selected="true"' : '') + '>' +
      '<td class="c-img">' + img + '</td>' +
      '<td>' + (it.name ? '<div class="nm" title="' + esc(it.name) + '">' + esc(it.name) + '</div>' : '<div class="nm ph">名前を取れていません</div>') + '<div class="meta' + (k || (R.rowBadge && tab === 'w') ? ' kp' : '') + '">' + meta + '</div></td>' +
      '<td class="r" data-k="仕入れ値">' + costCell + '</td>' +
      '<td class="r c-pt">' + (it.shopPt > 1 ? '<span class="pt">' + (it.src === 'yahoo' ? it.shopPt + '%' : it.shopPt + '倍') + '</span>' : '<span class="muted">1倍</span>') + '</td>' +
      '<td class="r" data-k="Amazon売値">' + sellCell + '</td><td class="r c-fee fee">' + feeCell + '</td><td class="r" data-k="利益">' + pfCell + '</td><td class="r c-rt">' + rtCell + '</td></tr>';
  }
  /* 行を作り直すのは中身が変わった時だけ(入力欄から離れた時の change で押した行のクリックが消えないように) */
  var rowsHTML = null;
  function setRows(html) { if (html !== rowsHTML) { rowsHTML = html; $('#rows').innerHTML = html; } }
  function render() {
    $$('.tabs [data-tab]').forEach(function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-tab') === tab)); });
    $('#n-s').textContent = lists.s.length; $('#n-b').textContent = lists.b.length; $('#n-w').textContent = lists.w.length;
    var v = visible();
    var title = { s: query ? '「' + esc(query) + '」の検索結果<small>楽天市場 ' + lists.s.length + '件</small>' : '検索結果<small>上の検索欄から探せます</small>',
      b: 'まとめて<small>' + (lists.b.length ? bulkShown(v) : '貼った一覧を一度に計算します') + '</small>',
      w: 'ウォッチ<small>' + lists.w.length + '件</small>' }[tab];
    $('#res-title').innerHTML = title;
    $('#w-csv').hidden = !(tab !== 's' && cur().length);
    $('#bulk-box').hidden = tab !== 'b'; $('#bulk-bad').hidden = tab !== 'b'; $('#b-watch').hidden = !(tab === 'b' && v.length);
    $('#slot-watch-top').hidden = tab !== 'w';
    $('#grid').classList.toggle('noimg', !v.some(function (o) { return !!o.it.img; }));   // 写真が1枚も無い一覧は、写真の列ごと消す
    paintIdle();
    var empty = { s: query ? '見つかりませんでした。言葉を短くするか、JANコードで探してください。' : '検索欄にキーワードかJANコードを入れて、検索してください。<br><kbd>/</kbd> で検索欄に移動します。',
      b: '上の欄にJAN・ASINの一覧を貼って、「まとめて計算する」を押してください。',
      w: '気になる商品は、右の「ウォッチに追加」で残せます。' }[tab];
    setRows(v.length ? v.map(rowHTML).join('') : '<tr><td colspan="8" class="empty">' + (cur().length ? (tab === 'b' && $('#profitonly').checked ? '目標に届く行はありませんでした。左の「目標を満たす行だけ」を外すと、すべての行が出ます。' : '絞り込みの条件に合う商品がありません。') : empty) + '</td></tr>');
    $('#credit').innerHTML = (tab === 'w' ? '' : CREDIT + '。価格・在庫・ポイントは取得時点のものです。') +
      ' 「目標から逆算」の売値は、Amazonの実際の売値が未入力のため、目標の利益からポイント抜きで逆算した値です(その値段で売れるという意味ではありません)。利益はポイント抜きで、その下の「ポイント○円」は上乗せの分です。';
    paintBulk();
    U.fire('ra-render', { tab: tab, visible: v });
  }
  /** まとめての一覧の題の横: 出している行の内わけ(目標に届く行と、未入力の行) */
  function bulkShown(v) {
    var n = { ok: 0, ng: 0, unk: 0 };
    v.forEach(function (o) { n[judge(o.it)]++; });
    var parts = [];
    if (n.ok) parts.push('目標に届く' + n.ok + '件');
    if (n.unk) parts.push('未入力' + n.unk + '件');
    if (n.ng) parts.push('届かない' + n.ng + '件');
    return (parts.length ? parts.join('と、') + 'を表示' : '0件を表示') + '(全' + lists.b.length + '件)';
  }
  /** まとめてのタブで行を選ぶ前は、主役の操作は「まとめて計算する」。「この価格で出品」は線に落とす */
  function paintIdle() { document.body.toggleAttribute('data-bulk-idle', tab === 'b' && sel < 0); }
  function paintBulk() {
    var k = keys(), n = cur().filter(function (it) { return it.jan && !it.sell; }).length;
    var b = $('#kp-bulk'); b.hidden = !(k.keepa && n) || tab === 'b';
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
    rowsHTML = null; paintIdle();
    fillDetail();
    var it = selected();
    if (keys().keepa && it.jan && !it.sell && !it.kp) kpFetch(it);
    if (scroll && U.narrow()) $('#calc').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function fillDetail() {
    var it = selected();
    $('#d-name').textContent = it.manual ? '手入力' : (it.name || it.jan || it.asin || '');
    $('#d-name').classList.toggle('ph', !!it.manual);
    $('#d-sub').innerHTML = it.manual ? '一覧の行を選ぶと、その商品の値が入ります。' : esc(it.shop || '') + (it.url ? '　<a href="' + esc(it.url) + '" target="_blank" rel="noopener">商品ページ</a>' : '');
    $('#c-cost').value = it.price || '';
    $('#c-inship').value = it.inShip || 0;
    $('#c-pt-shop').value = it.shopPt || 1;
    $('#c-code').value = it.jan || it.asin || '';
    $('#c-sell').value = it.sell || '';
    $('#c-qty').value = it.qty || 1;
    $('#kp-out').innerHTML = it.kp ? kpHTML(it.kp) : '';
    $('#party').innerHTML = ''; $('#slot-evidence').innerHTML = '';
    paintBuy(false);
    U.fire('ra-select', { it: it, tab: tab });
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
    if (tr && sel >= 0) { var o = { it: it, i: sel, r: compute(it) }; var tmp = document.createElement('tbody'); tmp.innerHTML = rowHTML(o); tr.replaceWith(tmp.firstChild); rowsHTML = null; }
    calcDetail(); links();
  }
  ['c-cost', 'c-inship', 'c-pt-shop', 'c-code', 'c-sell', 'c-qty'].forEach(function (id) { $('#' + id).addEventListener('input', fromDetail); });

  var lastCalc = null;
  function ptLabel(x) { return U.pct(x.pointRate) + '・仕入れ値÷1.1×率'; }
  function calcDetail() {
    var it = selected(), out = $('#c-out');
    var r = compute(it); lastCalc = r;
    if (!r) { U.result(out, '<p class="note">仕入れ値を入れると、目標の利益に届く売値の目安と、損益分岐が出ます。Amazonの実際の売値を入れると、利益の内訳が出ます。</p>', null, ''); return; }
    var tg = U.target();
    if (r.over) { U.result(out, '<p class="warn-line">金額を確かめてください。1,000万円以上の値は計算しません(金額の欄にJANを入れていないか見てください)。</p>', null, ''); return; }
    if (r.est) {
      var x1 = input(it), be1 = C.amazonBreakEvenSell(fees, Object.assign({}, x1, { usePoints: false }));
      U.result(out, '<div class="pfbox">' + U.askActualHTML({ where: 'Amazon', target: r.sug, be: be1, tgLabel: U.targetLabel(tg),
        how: '「Amazonで見る」' + (keys().keepa ? 'かKeepa' : '') + 'で今の価格を確かめて、上の「Amazonの実際の売値」に入れてください。' }) + '</div>', null, '');
      return;
    }
    var x = r.x, x0 = Object.assign({}, x, { usePoints: false });
    var be = C.amazonBreakEvenSell(fees, x0), maxc = C.amazonMaxCost(fees, Object.assign({}, x0), tg);
    var rows = [['実際の売値', r.sell], ['販売手数料', -r.referral], [x.selfShip ? '送料(' + esc(carrierName()) + ')' : 'FBA配送代行手数料', x.selfShip ? -r.selfShipCost : -r.fba],
      ['Amazonからの入金', r.payout, 't'], ['仕入れ値', -r.cost]];
    if (r.inShip) rows.push(['仕入れの送料', -r.inShip]);
    if (r.inbound) rows.push([x.prep ? esc(U.prepLabel(fees)) : '納品送料・資材', -r.inbound]);
    if (x.wh) rows.push(['発送代行(入庫・保管・撮影・出荷)', -x.wh]);
    if (r.other - (x.wh || 0)) rows.push(['その他', -(r.other - (x.wh || 0))]);
    rows.push(['ポイント抜きの利益(1個)', r.profitNoPoints, 't']);
    if (x.usePoints && r.points) rows.push(['ポイント(上乗せ・' + ptLabel(x) + ')', r.points], ['ポイント込みの利益(1個)', r.profit, 't']);
    var keyRows = [['損益分岐の売値(ポイント抜き)', be ? yen(be) + '円' : '—', 'key'], ['仕入れ値の上限(ポイント抜きで目標に届く)', maxc == null ? '届かない' : yen(maxc) + '円', 'key']];
    var np = r.profitNoPoints;
    var head = '<div class="pfbox">' + U.compareHTML({ actual: r.sell, target: r.sug, where: 'Amazon', tgLabel: U.targetLabel(tg) }) +
      U.gateHTML({ noPt: np, pt: x.usePoints ? r.points : null, ptLabel: ptLabel(x) }) +
      '<div class="kpi"><div><b>' + U.pct(r.sell > 0 ? np / r.sell : 0) + '</b>利益率(ポイント抜き)</div><div><b>' + U.pct((r.cost + r.inShip) > 0 ? np / (r.cost + r.inShip) : 0, 0) + '</b>仕入れに対して</div><div><b>' + U.pct(r.margin) + '</b>ポイント込みの利益率</div></div>' + U.brkRows(keyRows);
    U.result(out, head + '</div>' +
      (maxc != null && x.cost > maxc ? '<p class="warn-line">仕入れ値が上限を' + yen(x.cost - maxc) + '円超えています</p>' : ''),
      rows,
      '<p class="note">' + esc(r.category.label) + (x.selfShip ? '・自己発送' : '・' + esc(r.tier ? r.tier.label.replace(/\(.*\)/, '') : '') + '・' + (r.sell <= fees.amazon.fba_price_threshold ? '1,000円以下' : '1,000円超') + 'の料金') + '。保管手数料・返品は含みません。</p>',
      np);
  }

  /* この価格で出品 / 仕入れた */
  function listAtTarget() {
    var r = lastCalc;
    if (!r) { U.toast('仕入れ値を入れてください'); $('#c-cost').focus(); return; }
    if (r.est) { U.toast('Amazonの実際の売値を入れてください。目標の売値は目安で、その値段で売れるとは限りません'); $('#c-sell').focus(); return; }
    U.toast('実際の売値 ' + yen(r.sell) + '円で計算しています' + (r.profitNoPoints <= 0 ? '(ポイント抜きでは利益が出ません)' : ''));
  }
  function paintBuy(done) {
    var b = $('[data-act="buy"]'); b.classList.toggle('done', !!done);
    b.innerHTML = done ? '台帳に記録済み' : '仕入れた<kbd>S</kbd>';
  }
  function buy(force) {
    if (force !== true && $('[data-act="buy"]').classList.contains('done')) { U.toast('この内容は台帳に記録済みです', 'もう1件記録する', function () { buy(true); }); return; }
    var it = selected(), r = compute(it);
    if (r && r.over) { U.toast('金額を確かめてください。1,000万円以上の値は計算しません'); $('#c-cost').focus(); return; }
    if (!r || !r.sell) { U.toast('仕入れ値を入れてください'); $('#c-cost').focus(); return; }
    var noActual = r.est; // 実際の売値が未入力なら、台帳の売値は目標の売値(目安)で入れて、そう知らせる
    var qty = Math.max(1, val('c-qty') || 1);
    // calc = 仕入れた時の計算の条件(C.amazonProfit にそのまま渡せる形)。あとで今の価格で出し直す時に使う
    var calc = JSON.parse(JSON.stringify(r.x)); if (it.code) calc.rkCode = it.code;
    var draft = { ship: r.x.selfShip ? U.shipMode() : 'fba', cond: '新品', hinmoku: U.hinmokuFor(r.x.category), name: it.name || '(名前なし)',
      feature: [it.jan ? 'JAN ' + it.jan : '', it.asin ? 'ASIN ' + it.asin : ''].filter(Boolean).join(' '),
      qty: qty, unit: r.cost + r.inShip, party: it.manual || (it.src === 'bulk' && !it.shop) ? '' : (it.src === 'yahoo' ? 'Yahoo!ショッピング ' : '楽天市場 ') + (it.shop || ''),
      ref: it.url || '', sellTo: 'Amazon', sellPrice: r.sell, profit: r.profitNoPoints, pnp: true, route: '楽天・Yahoo!→Amazon', calc: calc };   // 見込み利益はポイント抜き(pnp=true。台帳側が二重に引かないための印)
    U.fire('buy-row', { row: draft, it: it, r: r });   // ほかの部品が行に項目を足す口(仕入れる前の確かめの結果など)
    var row = U.ledger.add(draft);
    if (row) {
      paintBuy(true); it.bought = row.id; persistList();
      U.evidenceMini($('#slot-evidence'), row.id);     // 新品の仕入れ: 注文番号と書類の種類(任意)
      U.fire('bought', { row: row, it: it, box: $('#party') });
      if (noActual) U.toast('実際の売値が未入力のため、台帳の売値は目標の売値(目安)で入れました。売れた時に直してください');
    }
  }
  $('[data-act="list"]').addEventListener('click', listAtTarget);
  $('[data-act="buy"]').addEventListener('click', buy);

  /* ---------- 検索(楽天の公式API・利用者のID) ---------- */
  function msg(html, err) { $('#res-msg').innerHTML = html ? '<div class="msg' + (err ? ' err' : '') + '">' + html + '</div>' : ''; }
  /** 楽天の商品検索(公式API・利用者のキー)を1回呼ぶ。params は API の指定(keyword・sort・hits など)。返り値は一覧の行の形。
      失敗した時の Error には status(403・429 など)が付く。code は楽天の商品コード(あとで同じ商品を確かめ直す時に使う) */
  function rakutenCall(params) {
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
  function searchRakuten(q) {
    var sort = { price: '+itemPrice', standard: 'standard', review: '-reviewCount' }[$('#sort').value];
    var p = { keyword: q, hits: '30', availability: '1', sort: sort };
    if ($('#ptonly').checked) p.pointRateFlag = '1';
    if (val('pmin')) p.minPrice = String(val('pmin'));
    if (val('pmax')) p.maxPrice = String(val('pmax'));
    if ($('#freeonly').checked) p.postageFlag = '1';
    return rakutenCall(p);
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
    msg(''); rowsHTML = null; $('#rows').innerHTML = '<tr class="loading"><td colspan="8">楽天市場を検索しています</td></tr>';
    searchRakuten(q).then(function (list) {
      lists.s = list; U.store.set('ra-last', { q: q, items: list }); render(); fillDetail();
    }).catch(function (err) {
      var t = String(err && err.message || err);
      if (/Failed to fetch|NetworkError|Load failed/i.test(t)) t = '接続できませんでした。通信状態か、IDの設定(許可するWebサイト)を確認してください。';
      lists.s = []; render(); msg(t, true);
    });
  }
  U.api.onSearch = function (src, q) {
    // JAN・ASINが2つ以上並んでいたら、検索ではなく「まとめて」へ送る
    if (q && window.SedoriBulk && C.parseCodes(q.split(/[\s,、]+/).join('\n')).items.length >= 2 && !/[^\sA-Za-z0-9,、\-]/.test(q)) { window.SedoriBulk.open(q.split(/[\s,、]+/).join('\n')); return true; }
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
        if (!r.ok) { var e = new Error(r.status === 429 ? 'Keepaのトークンが足りません。少し待ってから試してください。' : 'Keepaから売値を取れませんでした。キーが正しいかを見て、もう一度お試しください(番号 ' + r.status + ')。'); e.status = r.status; e.refillIn = j.refillIn; throw e; }
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
    if (tab === 'b') saveBulk();
    if (tab === 'w') U.store.set('watch2', lists.w);
  }
  /* まとめての一覧(最後の1回分・500件まで・この端末だけ)。クラウドには送らない */
  function saveBulk() { var st = U.store.get('ra-bulk', null) || {}; st.items = lists.b.slice(0, 500); U.store.set('ra-bulk', st); }
  /** ウォッチに入れる(300件まで)。base = 保存した時の価格(あとで値上がり・値下がりを比べる元) */
  function addWatch(items) {
    items.slice().reverse().forEach(function (it) {
      var copy = JSON.parse(JSON.stringify(it)); delete copy.manual; copy.saved = U.today(); copy.base = Number(copy.price) || 0; if (!copy.name) copy.name = '(名前なし)';
      lists.w.unshift(copy);
    });
    lists.w = lists.w.slice(0, 300);
    $('#n-w').textContent = lists.w.length;
    return U.store.set('watch2', lists.w);
  }
  $('#c-watch').addEventListener('click', function () {
    var it = selected(); if (!(Number(it.price) > 0)) { U.toast('仕入れ値を入れてください'); return; }
    U.toast(addWatch([it]) ? 'ウォッチに追加しました' : 'この端末では保存できませんでした', 'ウォッチを見る', function () { tab = 'w'; sel = 0; render(); fillDetail(); });
  });
  $('#w-csv').addEventListener('click', function () {
    // ウォッチは全部、まとめては今出ている行(絞り込みで残った行)を書き出す。列は同じ
    var src = tab === 'b' ? visible().map(function (o) { return o.it; }) : lists.w;
    // 利益と利益率は、画面と同じポイント抜き。ポイントは別の列
    var rows = src.map(function (it) {
      var r = compute(it) || {}, has = r.profitNoPoints != null && !r.est;
      return [it.saved || '', it.name, it.jan || it.asin || '', it.shop || '', it.url || '', it.price || '', r.est ? (it.sell || '') : (r.sell || it.sell || ''),
        has ? r.profitNoPoints : '', has && r.sell > 0 ? Math.round(r.profitNoPoints / r.sell * 1000) / 10 : '', has && r.x.usePoints ? r.points : ''];
    });
    U.download((tab === 'b' ? 'matomete_' : 'watch_') + U.today() + '.csv', C.toCSV(['保存日', '品名', 'JAN/ASIN', 'ショップ', 'URL', '仕入れ値(円)', 'Amazon売値(円)', '利益・ポイント抜き(円/個)', '利益率・ポイント抜き(%)', 'ポイント(円/個)'], rows));
  });
  function loadWatch() {
    var w = U.store.get('watch2', null);
    if (!w) { // 以前の形式から移す
      w = (U.store.get('watch', []) || []).map(function (r) { return { name: r.name, price: r.cost, jan: r.code, sell: r.sell, url: r.url, src: r.src, saved: r.date, shopPt: 1 }; });
    }
    lists.w = w;
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

  /* ---------- ほかの部品が使う口 ---------- */
  Object.assign(R, {
    lists: lists, keys: keys, openKeys: openKeys, fees: function () { return fees; },
    tab: function () { return tab; },
    setTab: function (t, i) { if (!lists[t]) return; tab = t; sel = i == null ? -1 : i; U.store.set('ra-tab', tab); render(); fillDetail(); },
    render: function () { rowsHTML = null; render(); }, fillDetail: fillDetail, selected: selected, visible: visible,
    compute: compute, input: input, judge: judge, maxCostOf: maxCostOf,
    persist: function (t) { if (t === 'w') U.store.set('watch2', lists.w); else if (t === 'b') saveBulk(); else U.store.set('ra-last', { q: query, items: lists.s }); },
    addWatch: addWatch, msg: msg,
    rakuten: rakutenCall, useQuota: useQuota, paid: paidPlan, quotaLeft: function () { return paidPlan() ? Infinity : Math.max(0, FREE_SEARCHES_PER_DAY - quota().n); },
    kpCall: kpCall, applyKeepa: applyKeepa
  });

  /* ---------- 起動 ---------- */
  function carrierName() { var c = C.findCarrier(fees, $('#c-carrier').value); return c ? c.label.replace(/\(.*\)/, '') : ''; }
  function paintCarrier() {
    var custom = $('#c-carrier').value === 'custom';
    $('#c-selfship').disabled = !custom;
    if (!custom) $('#c-selfship').value = C.carrierCost(fees, $('#c-carrier').value, 0);
  }
  function paintShipNote() {
    U.mountWh($('#wh'), fees, $('#c-self').checked ? '' : { self: 'FBA: Amazonが発送します。納品は自分で(納品送料は条件の欄)', pl: '発送代行がFBAへ納品します。左の「納品送料」は使わず、この費用で計算します。' }, { prep: fbaPrep });
  }
  $('#c-self').addEventListener('change', function () { $('#c-selfship-w').hidden = !this.checked; paintShipNote(); paintUnused(); });
  loadKeys(); showQuota(); loadWatch();
  lists.b = ((U.store.get('ra-bulk', null) || {}).items || []).slice(0, 500);
  var last = U.store.get('ra-last', null); if (last) { lists.s = last.items || []; query = last.q || ''; }
  $('[data-act="list"]').innerHTML = 'この価格で出品<kbd>Enter</kbd>';
  function paintUnused() { var fr = $('#c-inbound').closest('.fr'); if (fr) fr.classList.toggle('unused', fbaPrep()); }   // 納品代行の時は、左の「納品送料」を使わない
  document.addEventListener('sedori:target', function () { paintUnused(); render(); calcDetail(); });
  document.addEventListener('sedori:wh', function () { render(); calcDetail(); });
  U.loadFees().then(function (f) {
    fees = f;
    $('#c-cat').innerHTML = fees.amazon.categories.map(function (c) { return '<option value="' + c.id + '">' + esc(c.label) + '</option>'; }).join('');
    $('#c-tier').innerHTML = fees.amazon.fba_tiers.map(function (t) { return '<option value="' + t.id + '">' + esc(t.label) + '</option>'; }).join('');
    $('#c-tier').value = 'std2c'; $('#c-cat').value = 'toys';
    $('#c-carrier').innerHTML = U.carrierOptions(fees, 'yp60');
    restoreCond();
    if (!C.findCarrier(fees, $('#c-carrier').value)) $('#c-carrier').value = 'yp60';
    $('#c-selfship-w').hidden = !$('#c-self').checked;
    paintCarrier(); paintShipNote(); paintUnused();
    $('#c-carrier').addEventListener('change', paintCarrier);
    $$('.side input, .side select').forEach(function (el) {
      if (/^k-/.test(el.id)) return;
      el.addEventListener('input', function () { saveCond(); render(); calcDetail(); });
      el.addEventListener('change', function () { saveCond(); render(); calcDetail(); });
    });
    var p = new URLSearchParams(location.search), s = U.store.get('ra-sel', null);
    tab = p.get('tab') || U.store.get('ra-tab', null) || 's';
    if (!lists[tab]) tab = 's';
    if (s && s.tab === tab && cur()[s.i]) sel = s.i;
    render(); fillDetail();
    U.fire('ra-ready', { fees: fees });
    if (p.get('q')) doSearch(p.get('q'));
  });
})();
