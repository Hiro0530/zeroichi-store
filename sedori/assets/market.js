/* メルカリ・ヤフオク→メルカリ・業者オークション: 仕入れ(左) → 配送方法ごとの売値と利益の一覧 → 行を選ぶ → この価格で出品 → 仕入れた(台帳へ自動記録)
   body の data-route(mercari / yahuoku / auction)で仕入れ側を切り替える */
(function () {
  'use strict';
  var U = window.SedoriUI, C = window.SedoriCalc;
  var $ = U.$, $$ = U.$$, esc = U.esc, yen = U.yen, val = U.val;
  var route = document.body.getAttribute('data-route');
  var fees = null, feeTouched = false, market = 'mercari', shipId = 'tq60', ships = [], lastRes = null;
  var MK_LABEL = { mercari: 'メルカリ', yahuoku: 'Yahoo!オークション', other: 'その他' };

  function has(id) { return !!document.getElementById(id); }
  function checked(id) { var el = document.getElementById(id); return !!(el && el.checked); }
  function preset() {
    if (!has('b-venue')) return null;
    var id = $('#b-venue').value;
    return fees.auctions.presets.filter(function (p) { return p.id === id; })[0];
  }
  function onVenue() {
    var p = preset(); if (!p) return;
    feeTouched = false;
    $('#b-rate-w').hidden = p.type !== 'rate';
    if (p.type === 'rate') $('#b-rate').value = Math.round(p.rate * 1000) / 10;
    $('#b-session').value = p.session_fee || 0;
    $('#b-bidex').checked = !!p.tax_excluded; $('#b-feeex').checked = !!p.tax_excluded;
    $('#b-venue-note').innerHTML = p.id === 'custom' ? '手数料・参加費を自分で入れてください。' :
      (p.type === 'band' ? p.bands.map(function (b) { return (b.upto ? yen(b.upto) + '円まで' : 'それ以上') + ' ' + yen(b.fee) + '円'; }).join('、') + '(税別)' : esc(p.rate_note || '') + '(税別)') +
      '。' + esc(p.membership) + '。<a href="' + esc(p.source) + '" target="_blank" rel="noopener">出典</a>(掲載時点・公式未確認)';
    update();
  }

  /** 1個あたりの仕入れ原価 */
  function buy() {
    if (route === 'mercari') { var c = val('b-cost') + val('b-other'); return { unit: c, qty: 1, bid: val('b-cost') }; }
    if (route === 'yahuoku') {
      var qty = Math.max(1, Math.round(val('b-qty')) || 1);
      var pts = Math.floor(val('b-bid') * val('b-pt') / 100);
      var total = val('b-bid') + val('b-ship') + val('b-other') - pts;
      return { unit: Math.ceil(total / qty), total: total, qty: qty, bid: val('b-bid') };
    }
    var p = preset(), bid = val('b-bid');
    if (!feeTouched) $('#b-fee').value = C.auctionFee(p, bid, val('b-rate') / 100) || 0;
    var share = Math.ceil(val('b-session') / Math.max(1, Math.round(val('b-sessionn')) || 1));
    var u = C.auctionUnitCost({ bid: bid, bidTaxExcluded: checked('b-bidex'), fee: val('b-fee'), feeTaxExcluded: checked('b-feeex'),
      ship: val('b-ship'), other: val('b-other') + share, qty: val('b-qty') });
    return { unit: u.unit, total: u.total, qty: u.qty, bid: u.bidTotal };
  }
  function rate() { return market === 'other' ? val('s-rate') / 100 : (market === 'yahuoku' ? fees.yahuoku.rate : fees.mercari.rate); }
  function input(sh, unit, sell) {
    var shipFee = sh.id === 'custom' ? val('s-shipfee') : sh.fee;
    var wh = U.whTotal(fees);
    return { sell: sell || 0, rate: rate(), shipFee: shipFee, material: sh.material + val('s-mat'), cost: unit, other: val('s-other') + wh, wh: wh };
  }
  function rowCalc(sh, b) {
    var tg = U.target(), x = input(sh, b.unit, val('s-price'));
    var be = C.marketPriceFor(x, 0), tp = C.marketPriceFor(x, tg);
    var est = !(x.sell > 0);
    if (est) x.sell = tp || 0;
    var r = x.sell ? C.marketProfit(x) : null;
    return { x: x, be: be, tp: tp, r: r, est: est, need: x.sell ? C.needProfit(x.sell, tg) : 0 };
  }

  function render(b) {
    var price = val('s-price'), grp = '';
    $$('#mk-tabs [data-mk]').forEach(function (t) { t.setAttribute('aria-selected', String(t.getAttribute('data-mk') === market)); });
    $('#s-rate-w').hidden = market !== 'other';
    if (!(b.unit > 0) && route !== 'mercari') {
      $('#rows').innerHTML = '<tr><td colspan="7" class="empty">「仕入れ」に落札価格を入れると、配送方法ごとの売値と利益が並びます。</td></tr>'; return;
    }
    $('#rows').innerHTML = ships.map(function (sh) {
      var c = rowCalc(sh, b), out = '';
      if (sh.group !== grp) { grp = sh.group; out += '<tr class="grp"><td colspan="7">' + esc(grp) + '</td></tr>'; }
      var cls = c.r ? (c.r.profit < 0 ? 'bad' : (c.r.profit >= c.need ? 'good' : '')) : '';
      var cost = sh.id === 'custom' ? val('s-shipfee') + sh.material : sh.fee + sh.material;
      return out + '<tr data-i="' + esc(sh.id) + '"' + (sh.id === shipId ? ' class="on"' : '') + '><td><div class="nm">' + esc(sh.label) + '</div></td>' +
        '<td class="r fee" data-k="送料・資材">' + yen(cost) + '</td><td class="r c-fee fee">' + (c.be ? yen(c.be) : '—') + '</td>' +
        '<td class="r" data-k="目標の売値"><span class="yen">' + (c.tp ? yen(c.tp) + '<i>円</i>' : '届かない') + '</span></td>' +
        '<td class="r c-fee fee">' + (c.r ? yen(c.r.fee) : '—') + '</td>' +
        '<td class="r" data-k="利益">' + (c.r ? '<span class="pf ' + (c.est ? 'est' : cls) + '">' + yen(c.r.profit) + '</span>' : '—') + '</td>' +
        '<td class="r c-rt">' + (c.r ? '<span class="rt ' + (c.est ? 'est' : cls) + '">' + U.pct(c.r.margin) + '</span>' : '—') + '</td></tr>';
    }).join('');
    $('.tbar-t').innerHTML = '配送方法ごとの売値と利益<small>' + MK_LABEL[market] + ' 手数料' + U.pct(rate(), 0) + '　1個の原価 ' + yen(b.unit) + '円　' + (price ? '販売価格 ' + yen(price) + '円で計算' : '目標の売値で計算') + '</small>';
  }

  function detail(b) {
    var sh = ships.filter(function (s) { return s.id === shipId; })[0] || ships[0], out = $('#m-out');
    $('#s-shipfee-w').hidden = sh.id !== 'custom';
    $('#d-name').textContent = sh.label; $('#d-sub').textContent = sh.group + '　' + MK_LABEL[market];
    var c = rowCalc(sh, b), tg = U.target();
    lastRes = null;
    if (!c.r) { $('#brk').innerHTML = ''; out.innerHTML = '<p class="note">' + (b.unit > 0 || route === 'mercari' ? '目標の利益(' + esc(U.targetLabel(tg)) + ')に届く売値がありません。' : '仕入れの金額を入れてください。') + '</p>'; return; }
    var r = c.r; lastRes = { r: r, b: b, c: c, sh: sh };
    var rows = [['販売価格' + (c.est ? '(目標の売値)' : ''), r.sell], [MK_LABEL[market] + 'の手数料(' + U.pct(c.x.rate, 0) + ')', -r.fee], ['送料', -r.ship]];
    if (r.material) rows.push(['梱包資材', -r.material]);
    if (c.x.wh) rows.push(['発送代行(入庫・保管・撮影・出荷)', -c.x.wh]);
    if (r.other - (c.x.wh || 0)) rows.push(['その他', -(r.other - (c.x.wh || 0))]);
    rows.push(['仕入れ原価(1個)', -r.cost], ['利益(1個)', r.profit, 't']);
    var keyRows = [['目標(' + esc(U.targetLabel(tg)) + ')を満たす売値', c.tp ? yen(c.tp) + '円' : '届かない', 'key go'], ['損益分岐の売値', c.be ? yen(c.be) + '円' : '—', 'key']];
    if (b.qty > 1) keyRows.push([b.qty + '個すべて売れた時の利益', yen(r.profit * b.qty) + '円', 'key']);
    var head = c.est ?
      '<div class="pfbox"><div class="hl"><span>この売値以上なら目標に届く</span><b>' + yen(c.tp) + '<i>円</i></b></div>' +
      '<div class="kpi"><div><b>' + yen(r.profit) + '円</b>その時の利益</div><div><b>' + (c.be ? yen(c.be) + '円' : '—') + '</b>損益分岐</div><div><b>' + yen(r.ship + r.material) + '円</b>送料・資材</div></div>' +
      (b.qty > 1 ? U.brkRows([[b.qty + '個すべて売れた時の利益', yen(r.profit * b.qty) + '円', 'key']]) : '') :
      U.profitHead('利益(1個)', r.profit, U.profitClass(r.profit, r.sell, tg)) +
      '<div class="kpi"><div><b>' + U.pct(r.margin) + '</b>利益率</div><div><b>' + U.pct(r.roi, 0) + '</b>仕入れに対して</div><div><b>' + yen(r.payout) + '円</b>手数料を引いた売上</div></div>' + U.brkRows(keyRows);
    U.result(out, head + '</div>' + (c.est ? '<p class="note">販売価格が未入力のため、目標の売値で計算しています。</p>' : ''), rows,
      '<p class="note">手数料は1円未満切り捨て。' + (market === 'mercari' ? '振込申請手数料(1回' + fees.mercari.transfer_fee + '円)は含みません。' : '') + '</p>');
  }

  function guard(b) {
    var g = $('#guard'); if (!g) return;
    g.hidden = !(b.bid >= 10000 || (checked('b-media') && b.bid > 0));
  }

  function update() {
    if (!fees) return;
    var b = buy();
    $('#b-unit').textContent = b.unit > 0 ? yen(b.unit) + '円' : '—';
    guard(b); render(b); detail(b); saveForm();
  }

  $('#rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-i]'); if (!tr) return;
    shipId = tr.getAttribute('data-i'); U.store.set('ship-' + route, shipId);
    $$('#rows tr[data-i]').forEach(function (t) { t.classList.toggle('on', t === tr); });
    paintBuy(false); $('#party').innerHTML = '';
    detail(buy());
    if (U.narrow()) $('#sell').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $$('#mk-tabs [data-mk]').forEach(function (t) {
    t.addEventListener('click', function () { market = t.getAttribute('data-mk'); U.store.set('mk-' + route, market); update(); });
  });

  /* この価格で出品 / 仕入れた */
  function listAt() {
    var L = lastRes; if (!L || !L.c.tp) { U.toast('目標の利益に届く売値がありません'); return; }
    $('#s-price').value = L.c.tp; update();
    U.toast('販売価格を' + yen(L.c.tp) + '円にしました(' + L.sh.label + ')');
  }
  function paintBuy(done) { var b = $('[data-act="buy"]'); b.classList.toggle('done', !!done); b.innerHTML = done ? '台帳に記録済み' : '仕入れた<kbd>S</kbd>'; }
  function doBuy() {
    var L = lastRes, b = buy();
    if (!(b.unit > 0) && route !== 'mercari') { U.toast('仕入れの金額を入れてください'); return; }
    if (!L) { U.toast('売値を決めてください'); return; }
    if (L.c.est && L.c.tp) { $('#s-price').value = L.c.tp; update(); L = lastRes; }
    var p = preset();
    var row = U.ledger.add({
      ship: U.shipMode(), cond: route === 'mercari' ? '新品' : '中古', media: checked('b-media'), hinmoku: '',
      name: $('#m-name').value || '(名前なし)', qty: b.qty, unit: b.unit,
      party: route === 'auction' ? (p ? p.label : '') : (route === 'yahuoku' ? 'Yahoo!オークション 出品者' : ''),
      verify: route === 'auction' ? '古物商・法人から購入' : '',
      sellTo: MK_LABEL[market], sellPrice: L.r.sell, profit: L.r.profit, memo: L.sh.label,
      route: document.body.getAttribute('data-route-label') || '' });
    if (!row) return;
    paintBuy(true);
    if (route !== 'mercari') U.partyPanel($('#party'), row.id, { focus: route === 'yahuoku', title: route === 'auction' ? '取引相手(市場)の情報' : '取引相手の情報' });
  }
  $('[data-act="list"]').addEventListener('click', listAt);
  $('[data-act="buy"]').addEventListener('click', doBuy);
  $('[data-act="list"]').innerHTML = 'この価格で出品<kbd>Enter</kbd>';

  var FORM_IDS = ['b-cost', 'b-other', 'b-bid', 'b-ship', 'b-pt', 'b-qty', 'b-venue', 'b-rate', 'b-session', 'b-sessionn', 's-rate', 's-price', 's-shipfee', 's-mat', 's-other', 'm-name'];
  function saveForm() { var f = {}; FORM_IDS.forEach(function (id) { if (has(id)) f[id] = $('#' + id).value; }); U.store.set('form-' + route, f); }
  function restoreForm() { var f = U.store.get('form-' + route, null); if (!f) return; Object.keys(f).forEach(function (id) { if (has(id) && f[id] !== '' && f[id] != null) $('#' + id).value = f[id]; }); }

  U.api.page = {
    move: function (d) {
      var i = ships.findIndex(function (s) { return s.id === shipId; });
      i = Math.max(0, Math.min(ships.length - 1, i + d)); shipId = ships[i].id; U.store.set('ship-' + route, shipId);
      update(); var tr = $('#rows tr.on'); if (tr) tr.scrollIntoView({ block: 'nearest' });
    },
    list: listAt, buy: doBuy
  };
  U.api.onSearch = function (src, q) { if (q && !$('#m-name').value) { $('#m-name').value = q; saveForm(); } return false; };
  document.addEventListener('sedori:target', update);
  document.addEventListener('sedori:wh', update);

  U.loadFees().then(function (f) {
    fees = f; ships = f.mercari.shipping;
    if (has('b-venue')) $('#b-venue').innerHTML = f.auctions.presets.map(function (p) { return '<option value="' + p.id + '">' + esc(p.label) + '</option>'; }).join('');
    market = U.store.get('mk-' + route, 'mercari'); shipId = U.store.get('ship-' + route, 'tq60');
    if (!ships.some(function (s) { return s.id === shipId; })) shipId = 'tq60';
    restoreForm();
    U.mountWh($('#wh'), fees, '送料は表で選んだ配送方法で計算します');
    if (has('b-venue')) { var keep = $('#b-venue').value; onVenue(); $('#b-venue').value = keep; }
    if (has('b-fee')) $('#b-fee').addEventListener('input', function () { feeTouched = true; });
    if (has('b-venue')) $('#b-venue').addEventListener('change', onVenue);
    if (has('b-bid')) $('#b-bid').addEventListener('input', function () { if (route === 'auction') feeTouched = false; });
    $$('main input, main select').forEach(function (el) {
      if (el.closest('#party')) return;
      if (el.id === 'm-name') { el.addEventListener('input', saveForm); return; }
      el.addEventListener('input', function () { paintBuy(false); $('#party').innerHTML = ''; update(); });
      el.addEventListener('change', update);
    });
    update();
  });
})();
