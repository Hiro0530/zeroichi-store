/* メルカリ・ヤフオク・業者オークションの計算ページ(画面)。body の data-route で切り替える */
(function () {
  'use strict';
  var U = window.SedoriUI, C = window.SedoriCalc;
  var $ = U.$, $$ = U.$$, esc = U.esc, yen = U.yen, val = U.val;
  var route = document.body.getAttribute('data-route');
  var fees = null, feeTouched = false;

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
      esc(p.label) + ': ' + (p.type === 'band' ? p.bands.map(function (b) { return (b.upto ? yen(b.upto) + '円まで' : 'それ以上') + ' ' + yen(b.fee) + '円'; }).join('・') + '(税別)' :
      (p.rate_note || '') + '(税別)') + '。' + esc(p.membership) + '。<a href="' + esc(p.source) + '" target="_blank" rel="noopener">出典(掲載時点)</a>。入会前に公式で確認してください。';
    calc();
  }

  /** 1個あたりの仕入れ原価と内訳 */
  function buy() {
    if (route === 'mercari') {
      var c = val('b-cost') + val('b-other');
      return { unit: c, lines: [['仕入れ値(1個)', val('b-cost')], ['その他(1個)', val('b-other')]], total: c, qty: 1 };
    }
    if (route === 'yahuoku') {
      var qty = Math.max(1, Math.round(val('b-qty')) || 1);
      var pts = Math.floor(val('b-bid') * val('b-pt') / 100);
      var total = val('b-bid') + val('b-ship') + val('b-other') - pts;
      return { unit: Math.ceil(total / qty), total: total, qty: qty, bid: val('b-bid'),
        lines: [['落札価格', val('b-bid')], ['送料(出品者→自分)', val('b-ship')], ['その他', val('b-other')], ['ポイント', -pts], ['個数', qty + '個']] };
    }
    // auction
    var p = preset();
    var bid = val('b-bid');
    if (!feeTouched) $('#b-fee').value = C.auctionFee(p, bid, val('b-rate') / 100) || 0;
    var share = Math.ceil(val('b-session') / Math.max(1, Math.round(val('b-sessionn')) || 1));
    var u = C.auctionUnitCost({ bid: bid, bidTaxExcluded: checked('b-bidex'), fee: val('b-fee'), feeTaxExcluded: checked('b-feeex'),
      ship: val('b-ship'), other: val('b-other') + share, qty: val('b-qty') });
    return { unit: u.unit, total: u.total, qty: u.qty, bid: u.bidTotal,
      lines: [['落札価格' + (checked('b-bidex') ? '(税込に換算)' : ''), u.bidTotal], ['落札手数料' + (checked('b-feeex') ? '(税込に換算)' : ''), u.feeTotal],
        ['参加費の按分', share], ['送料', val('b-ship')], ['その他', val('b-other')], ['個数', u.qty + '個']] };
  }

  function sellInput(unitCost) {
    var m = $('#s-market').value;
    var rate = m === 'other' ? val('s-rate') / 100 : (m === 'yahuoku' ? fees.yahuoku.rate : fees.mercari.rate);
    var sh = C.findShipping(fees, $('#s-ship').value) || { fee: 0, material: 0, id: 'custom' };
    var shipFee = sh.id === 'custom' ? val('s-shipfee') : sh.fee;
    return { sell: val('s-price'), rate: rate, shipFee: shipFee, material: sh.material + val('s-mat'), cost: unitCost, other: val('s-other') };
  }

  function calc() {
    if (!fees) return;
    $('#s-rate-w').hidden = $('#s-market').value !== 'other';
    $('#s-shipfee-w').hidden = $('#s-ship').value !== 'custom';
    var b = buy();
    $('#b-unit').textContent = b.unit > 0 ? yen(b.unit) + '円' : '—';
    guard(b);
    var x = sellInput(b.unit), out = $('#m-out');
    var tg = U.target(), be = C.marketPriceFor(x, 0), tp = C.marketPriceFor(x, tg);
    if (!(x.sell > 0) || !(b.unit > 0)) {
      out.innerHTML = '<p class="empty">仕入れの金額と販売価格を入れると、ここに結果が出ます。</p>' +
        (b.unit > 0 && be ? '<table class="brk"><tr class="t"><td>損益分岐の販売価格</td><td>' + yen(be) + '円</td></tr><tr class="t"><td>' + esc(U.targetLabel(tg)) + 'を残す販売価格</td><td>' + (tp ? yen(tp) + '円' : '—') + '</td></tr></table>' : '');
      return null;
    }
    var r = C.marketProfit(x);
    var mk = { mercari: 'メルカリ', yahuoku: 'Yahoo!オークション', other: 'その他' }[$('#s-market').value];
    var rows = [['販売価格', r.sell], [mk + 'の手数料(' + U.pct(x.rate) + ')', -r.fee], ['送料', -r.ship], ['梱包資材', -r.material], ['その他', -r.other], ['仕入れ原価(1個)', -r.cost], ['利益(1個)', r.profit, 't']];
    out.innerHTML =
      '<div class="big"><span class="k">1個あたりの利益</span><span class="v ' + (r.profit >= 0 ? 'plus' : 'minus') + '">' + yen(r.profit) + '<small style="font-size:.45em">円</small></span></div>' +
      '<div class="kpis"><div><b>' + U.pct(r.margin) + '</b><span>利益率</span></div><div><b>' + U.pct(r.roi, 0) + '</b><span>仕入れ額に対する利益</span></div><div><b>' + yen(r.payout) + '</b><span>手数料を引いた売上</span></div></div>' +
      '<table class="brk">' + rows.filter(function (a) { return a[1] !== 0 || a[2]; }).map(function (a) { return '<tr' + (a[2] ? ' class="t"' : '') + '><td>' + esc(a[0]) + '</td><td>' + yen(a[1]) + '</td></tr>'; }).join('') + '</table>' +
      '<table class="brk" style="margin-top:10px"><tr class="t"><td>損益分岐の販売価格</td><td>' + (be ? yen(be) + '円' : '—') + '</td></tr>' +
      '<tr class="t"><td>' + esc(U.targetLabel(tg)) + 'を残す販売価格</td><td>' + (tp ? yen(tp) + '円 <button type="button" class="b g s" id="m-usesug">この価格にする</button>' : '—') + '</td></tr>' +
      (b.qty > 1 ? '<tr class="t"><td>' + b.qty + '個すべて売れた時の利益</td><td>' + yen(r.profit * b.qty) + '円</td></tr>' : '') + '</table>' +
      '<p class="note-s">手数料は1円未満切り捨てで計算。売上金の振込申請手数料(メルカリは1回' + fees.mercari.transfer_fee + '円)は含みません。</p>';
    saveForm();
    var us = $('#m-usesug'); if (us) us.addEventListener('click', function () { $('#s-price').value = tp; calc(); });
    return { r: r, b: b };
  }

  function guard(b) {
    var g = $('#guard'); if (!g) return;
    var media = checked('b-media');
    var need = (route === 'yahuoku' || route === 'auction') && (b.bid >= 10000 || (media && b.bid > 0));
    g.hidden = !need || route === 'auction';
    if (route === 'auction') g.hidden = true;
  }

  var FORM_IDS = ['b-cost', 'b-other', 'b-bid', 'b-ship', 'b-pt', 'b-qty', 'b-venue', 'b-rate', 'b-session', 'b-sessionn', 's-market', 's-rate', 's-price', 's-ship', 's-shipfee', 's-mat', 's-other'];
  function saveForm() {
    var f = {}; FORM_IDS.forEach(function (id) { if (has(id)) f[id] = $('#' + id).value; });
    U.store.set('form-' + route, f);
  }
  function restoreForm() {
    var f = U.store.get('form-' + route, null); if (!f) return;
    Object.keys(f).forEach(function (id) { if (has(id) && f[id] !== '') $('#' + id).value = f[id]; });
  }

  $('#m-ledger').addEventListener('click', function () {
    var res = calc(); var b = buy();
    if (!(b.unit > 0)) { U.toast('仕入れの金額を入れてください'); return; }
    var party = route === 'auction' ? (preset() ? preset().label : '') : (route === 'yahuoku' ? 'Yahoo!オークション 出品者: ' : '');
    U.ledger.prefill({ kind: '仕入れ', cond: route === 'mercari' ? '新品' : '中古', name: $('#m-name') ? $('#m-name').value : '', qty: b.qty, unit: b.unit, party: party,
      sellTo: { mercari: 'メルカリ', yahuoku: 'Yahoo!オークション', other: '' }[$('#s-market').value],
      memo: res ? '予定売値 ' + res.r.sell + '円・見込み利益 ' + res.r.profit + '円/個' : '' });
  });

  U.loadFees().then(function (f) {
    fees = f;
    var groups = {};
    f.mercari.shipping.forEach(function (s) { (groups[s.group] = groups[s.group] || []).push(s); });
    $('#s-ship').innerHTML = Object.keys(groups).map(function (g) {
      return '<optgroup label="' + esc(g) + '">' + groups[g].map(function (s) {
        return '<option value="' + s.id + '">' + esc(s.label) + (s.id === 'custom' ? '' : ' ' + yen(s.fee + s.material) + '円') + '</option>';
      }).join('') + '</optgroup>';
    }).join('');
    $('#s-ship').value = 'tq60';
    if (has('b-venue')) {
      $('#b-venue').innerHTML = f.auctions.presets.map(function (p) { return '<option value="' + p.id + '">' + esc(p.label) + '</option>'; }).join('');
    }
    restoreForm();
    if (has('b-venue')) { var keep = $('#b-venue').value; onVenue(); $('#b-venue').value = keep; }
    if (has('b-fee')) $('#b-fee').addEventListener('input', function () { feeTouched = true; });
    if (has('b-venue')) $('#b-venue').addEventListener('change', onVenue);
    if (has('b-bid')) $('#b-bid').addEventListener('input', function () { if (route === 'auction') feeTouched = false; });
    $$('main input, main select').forEach(function (el) {
      if (el.closest('#ledger-form')) return;
      el.addEventListener('input', calc); el.addEventListener('change', calc);
    });
    calc();
  });
})();
