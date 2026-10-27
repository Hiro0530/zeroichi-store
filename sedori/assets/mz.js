/* 無在庫 Amazon中古×ヤフオク: 新品価格 → 値下げ幅ごとの出品価格と利益・ヤフオク上限の一覧 → 行を選ぶ → この価格で出品 → 仕入れた(台帳+取引相手の情報)
   ヤフオクには一切アクセスせず、検索ページを開くリンクを作るだけ */
(function () {
  'use strict';
  var U = window.SedoriUI, C = window.SedoriCalc;
  var $ = U.$, $$ = U.$$, esc = U.esc, yen = U.yen, val = U.val;
  var manual = false, fees = null, sel = -1, cands = [], kpUsed = null, lastR = null;
  var OFFS = [0, 5, 10, 15, 20, 25, 30, 40];

  function keys() { return U.store.get('keys', {}); }
  $('#mz-key').value = keys().keepa || '';
  $('#mz-key-save').addEventListener('click', function () {
    var k = keys(); k.keepa = $('#mz-key').value.trim();
    U.toast(U.store.set('keys', k) ? 'この端末に保存しました' : 'この端末では保存できませんでした');
  });

  function links() {
    var q = $('#mz-q').value.trim() || $('#mz-code').value.trim();
    $('#mz-yh').href = q ? U.extUrl('yahuoku', q) : 'https://auctions.yahoo.co.jp/';
    $('#mz-yh-closed').href = q ? U.extUrl('yahuoku-closed', q) : 'https://auctions.yahoo.co.jp/';
    var code = $('#mz-code').value.trim();
    $('#mz-amz').href = code ? U.extUrl('amazon', code) : 'https://www.amazon.co.jp/';
  }
  function shortName(t) { return String(t || '').replace(/【[^】]*】|\[[^\]]*\]|（[^）]*）|\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40); }

  function kpFetch() {
    var k = keys(), code = $('#mz-code').value.trim().replace(/\s/g, ''), out = $('#mz-kp');
    if (!k.keepa) { out.innerHTML = '<p class="hint">Keepa APIキーが未設定です。下の「APIキー」で入れるか、「Amazonで見る」で新品価格を確かめて入れてください。</p>'; var d = $('#mz-key').closest('details'); d.open = true; return; }
    if (!code) { out.innerHTML = '<p class="hint">JANかASINを入れてください。</p>'; $('#mz-code').focus(); return; }
    var isAsin = /^B0[A-Z0-9]{8}$/i.test(code) || /^\d{9}[\dX]$/i.test(code);
    var p = new URLSearchParams({ key: k.keepa, domain: '5', stats: '90' }); p.set(isAsin ? 'asin' : 'code', code.toUpperCase());
    out.innerHTML = '<p class="hint">Keepaに問い合わせています</p>';
    fetch('https://api.keepa.com/product?' + p.toString()).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(r.status === 429 ? 'Keepaのトークンが足りません。' : 'Keepaの取得に失敗しました(' + r.status + ')'); return j; });
    }).then(function (j) {
      var pr = (j.products || [])[0];
      if (!pr || !pr.asin) { out.innerHTML = '<p class="hint">Amazonで見つかりませんでした。</p>'; return; }
      var c = (pr.stats || {}).current || [];
      var nw = c[1] > 0 ? c[1] : (c[0] > 0 ? c[0] : null), used = c[2] > 0 ? c[2] : null;
      if (nw) $('#mz-new').value = nw;
      if (!$('#mz-q').value) $('#mz-q').value = shortName(pr.title);
      $('#mz-name').value = pr.title || '';
      kpUsed = used; sel = -1;
      out.innerHTML = '<table class="kpx"><tr><td>新品最安</td><td>' + (nw ? yen(nw) + '円' : '—') + '</td></tr><tr><td>中古最安</td><td>' + (used ? yen(used) + '円' : '—') + '</td></tr>' +
        '<tr><td>Amazon本体</td><td>' + (c[0] > 0 ? '在庫あり' : 'なし') + '</td></tr><tr><td>ASIN</td><td>' + esc(pr.asin) + '</td></tr></table>';
      links(); update();
    }).catch(function (err) {
      var t = String(err && err.message || err);
      if (/Failed to fetch|NetworkError|Load failed/i.test(t)) t = 'Keepaに接続できませんでした。';
      out.innerHTML = '<p class="warn-line">' + esc(t) + '</p>';
    });
  }
  $('#mz-go').addEventListener('click', kpFetch);
  U.api.onSearch = function (src, q) {
    if (src === 'amazon') { if (q) $('#mz-code').value = q; links(); kpFetch(); return true; }
    if ((src === 'yahuoku' || src === 'yahuoku-closed') && q && !$('#mz-q').value) { $('#mz-q').value = q; links(); }
    return false;
  };

  function base() {
    var wh = U.whTotal(fees);
    return { category: $('#mz-cat').value, cost: val('mz-yprice'), inShip: val('mz-yship'), other: val('mz-other') + wh, wh: wh, selfShip: true,
      selfShipCost: C.carrierCost(fees, $('#mz-carrier').value, val('mz-outship')), usePoints: false };
  }
  function build() {
    var nw = val('mz-new'), tg = U.target(), b = base();
    cands = [];
    if (nw > 0) OFFS.forEach(function (o) { cands.push({ label: o ? '新品より' + o + '%安く' : '新品と同じ', price: Math.floor(nw * (1 - o / 100)), off: o }); });
    if (kpUsed) cands.push({ label: '中古の最安値に合わせる', price: kpUsed, tag: 'used' });
    if (b.cost > 0) { var p = C.amazonPriceFor(fees, b, tg); if (p) cands.push({ label: '目標(' + U.targetLabel(tg) + ')を満たす最安', price: p, tag: 'target' }); }
    cands.sort(function (a, c) { return c.price - a.price; });
    cands.forEach(function (c) {
      var x = Object.assign({}, b, { sell: c.price });
      c.r = C.amazonProfit(fees, x);
      c.max = C.amazonMaxCost(fees, x, tg);
      c.need = C.needProfit(c.price, tg);
    });
  }
  function render() {
    var nw = val('mz-new'), has = val('mz-yprice') > 0;
    $('#mz-title').innerHTML = nw > 0 ? '新品 ' + yen(nw) + '円からの出品価格<small>' + (has ? 'ヤフオク ' + yen(val('mz-yprice') + val('mz-yship')) + '円(送料込み)で仕入れた場合' : 'ヤフオクの価格を入れると利益が出ます') + '</small>' : '新品の価格を入れると、値下げ幅ごとの利益が並びます<small>「JAN・ASIN」で Keepa を押すか、検索欄で「Amazon」を選んで検索</small>';
    $('#rows').innerHTML = cands.length ? cands.map(function (c, i) {
      var r = c.r, cls = r.profit < 0 ? 'bad' : (r.profit >= c.need ? 'good' : '');
      return '<tr data-i="' + i + '"' + (i === sel ? ' class="on"' : '') + '><td><div class="nm">' + esc(c.label) + '</div>' + (c.tag === 'target' ? '<div class="meta">目標の利益ちょうど</div>' : (nw > 0 && c.off == null ? '<div class="meta">新品より' + U.pct(1 - c.price / nw, 0) + '安い</div>' : '')) + '</td>' +
        '<td class="r" data-k="出品価格"><span class="yen">' + yen(c.price) + '<i>円</i></span></td><td class="r c-fee fee">' + yen(r.referral) + '</td><td class="r c-fee fee">' + yen(r.selfShipCost) + '</td>' +
        '<td class="r" data-k="利益">' + (has ? '<span class="pf ' + cls + '">' + yen(r.profit) + '</span>' : '<span class="muted">—</span>') + '</td>' +
        '<td class="r c-rt">' + (has ? '<span class="rt ' + cls + '">' + U.pct(r.margin) + '</span>' : '<span class="muted">—</span>') + '</td>' +
        '<td class="r" data-k="ヤフオク上限">' + (c.max == null ? '<span class="muted">届かない</span>' : '<span class="yen">' + yen(c.max) + '<i>円</i></span>') + '</td></tr>';
    }).join('') : '<tr><td colspan="7" class="empty">新品の価格がまだありません。<br>「JAN・ASIN」で Keepa を押すか、「新品の価格」に入れてください。</td></tr>';
  }
  $('#rows').addEventListener('click', function (e) { var tr = e.target.closest('tr[data-i]'); if (tr) select(Number(tr.getAttribute('data-i')), true); });
  function select(i, scroll) {
    sel = i; manual = false; var c = cands[i]; if (!c) return;
    $('#mz-sell').value = c.price;
    $$('#rows tr[data-i]').forEach(function (tr) { tr.classList.toggle('on', Number(tr.getAttribute('data-i')) === i); });
    U.store.set('mz-pick', c.tag || c.off);
    detail(); paintBuy(false); $('#party').innerHTML = '';
    if (scroll && U.narrow()) $('#mz-calc').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function detail() {
    var x = Object.assign(base(), { sell: val('mz-sell') }), tg = U.target(), out = $('#mz-out');
    var c = cands[sel];
    $('#d-name').textContent = $('#mz-name').value || $('#mz-q').value || '商品名なし';
    $('#d-sub').textContent = c ? c.label : (x.sell ? '出品価格を手で入力' : '');
    lastR = null;
    if (!(x.sell > 0)) { U.result(out, '<p class="note">一覧の行を選ぶか、出品価格を入れてください。</p>', null, ''); return; }
    var maxc = C.amazonMaxCost(fees, x, tg), be = C.amazonBreakEvenSell(fees, x), sug = x.cost > 0 ? C.amazonPriceFor(fees, x, tg) : null;
    var keyRows = [['ヤフオクで払ってよい上限', maxc == null ? '届かない' : yen(maxc) + '円', 'key go']];
    if (sug) keyRows.push(['目標(' + esc(U.targetLabel(tg)) + ')を満たす出品価格', yen(sug) + '円', 'key']);
    if (x.cost > 0) keyRows.push(['損益分岐の出品価格', be ? yen(be) + '円' : '—', 'key']);
    if (!(x.cost > 0)) { U.result(out, '<div class="pfbox">' + U.brkRows(keyRows) + '</div><p class="note">ヤフオクの価格を入れると、利益と内訳が出ます。上限は送料別です。</p>', null, ''); return; }
    var r = C.amazonProfit(fees, x); lastR = r;
    var rows = [['出品価格(中古)', r.sell], ['販売手数料', -r.referral], ['送料(' + esc(carrierName()) + ')', -r.selfShipCost], ['Amazonからの入金', r.payout, 't'], ['ヤフオクの価格', -r.cost]];
    if (r.inShip) rows.push(['ヤフオクの送料', -r.inShip]);
    if (x.wh) rows.push(['発送代行(入庫・保管・撮影・出荷)', -x.wh]);
    if (r.other - (x.wh || 0)) rows.push(['その他', -(r.other - (x.wh || 0))]);
    rows.push(['利益(1個)', r.profit, 't']);
    var nw = val('mz-new');
    U.result(out, U.profitHead('利益(1個)', r.profit, U.profitClass(r.profit, r.sell, tg)) +
      '<div class="kpi"><div><b>' + U.pct(r.margin) + '</b>利益率</div><div><b>' + U.pct(r.roi, 0) + '</b>仕入れに対して</div><div><b>' + (nw > 0 ? U.pct(1 - r.sell / nw, 0) : '—') + '</b>新品より安く</div></div>' +
      U.brkRows(keyRows) + '</div>' +
      (maxc != null && x.cost > maxc ? '<p class="warn-line">ヤフオクの価格が上限を' + yen(x.cost - maxc) + '円超えています</p>' : '') +
      (r.cost >= 10000 || $('#mz-media').checked ? '<p class="note"><span class="badge">相手確認が必要</span> 仕入れた後、出てくる欄に取引ナビの本文を貼り付けてください。</p>' : ''),
      rows, '<p class="note">保管・返品・キャンセル時の費用は含みません。売れてから仕入れるため、仕入れ先が売り切れたらキャンセルになります。</p>');
  }

  function listAt() {
    var x = Object.assign(base(), { sell: val('mz-sell') });
    var p = x.cost > 0 ? C.amazonPriceFor(fees, x, U.target()) : null;
    if (p == null) {
      if (!(x.cost > 0) && sel >= 0) { U.toast('出品価格を' + yen(val('mz-sell')) + '円にしました'); return; }
      U.toast(x.cost > 0 ? '目標の利益に届く出品価格がありません' : 'ヤフオクの価格を入れてください'); return;
    }
    var i = cands.findIndex(function (c) { return c.tag === 'target'; });
    if (i >= 0) select(i); else { $('#mz-sell').value = p; detail(); }
    U.toast('出品価格を' + yen(p) + '円にしました');
  }
  /** ヤフオクの終了日時が入っていれば「出品した(見張る)」、無ければ「仕入れた」 */
  function watching() { var e = C.endMs($('#mz-yend').value); return e != null && e > Date.now(); }
  function paintBuy(done) {
    var b = $('[data-act="buy"]'); b.classList.toggle('done', !!done);
    b.innerHTML = done ? '台帳に記録済み' : (watching() ? '出品した(見張る)' : '仕入れた') + '<kbd>S</kbd>';
  }
  function buy() {
    var r = lastR;
    if (!r) { U.toast('ヤフオクの価格を入れてください'); $('#mz-yprice').focus(); return; }
    var media = $('#mz-media').checked, code = $('#mz-code').value.trim();
    var row = U.ledger.add({ ship: U.shipMode(), cond: '中古', media: media, hinmoku: U.hinmokuFor($('#mz-cat').value), name: $('#mz-name').value || $('#mz-q').value || '(名前なし)',
      feature: code ? (/^B0/i.test(code) ? 'ASIN ' : 'JAN ') + code : '', qty: 1, unit: r.cost + r.inShip, party: 'Yahoo!オークション 出品者',
      sellTo: 'Amazon(中古)', sellPrice: r.sell, profit: r.profit, route: '無在庫 Amazon中古',
      yEnd: $('#mz-yend').value || '', status: watching() ? '出品中' : '仕入れ済', wait: watching() });
    if (!row) return;
    paintBuy(true);
    if (row.wait) { $('#party').innerHTML = '<p class="note">台帳に「出品中(仕入れ前)」で入れました。終了の2時間前から台帳で色が付き、通知をオンにすると60分前にお知らせします。売れたら台帳で「売れた(仕入れる)」を押してください。</p>'; return; }
    U.partyPanel($('#party'), row.id, { focus: true, title: '取引相手の情報' });
  }
  $('[data-act="list"]').addEventListener('click', listAt);
  $('[data-act="buy"]').addEventListener('click', buy);
  $('[data-act="list"]').innerHTML = 'この価格で出品<kbd>Enter</kbd>';

  function update() {
    if (!fees) return;
    var pick = U.store.get('mz-pick', 15);
    build();
    if (!manual) sel = cands.findIndex(function (c) { return (c.tag || c.off) === pick; });
    render();
    if (sel >= 0) $('#mz-sell').value = cands[sel].price;
    detail(); paintBuy(false); $('#party').innerHTML = '';
    U.store.set('form-mz', { new: $('#mz-new').value, cat: $('#mz-cat').value, carrier: $('#mz-carrier').value, outship: $('#mz-outship').value, code: $('#mz-code').value, name: $('#mz-name').value, q: $('#mz-q').value });
  }
  U.api.page = {
    move: function (d) { if (!cands.length) return; select(Math.max(0, Math.min(cands.length - 1, (sel < 0 ? 0 : sel + d)))); },
    list: listAt, buy: buy
  };
  document.addEventListener('sedori:target', update);
  document.addEventListener('sedori:wh', update);
  function carrierName() { var c = C.findCarrier(fees, $('#mz-carrier').value); return c ? c.label.replace(/\(.*\)/, '') : ''; }
  function paintCarrier() {
    var custom = $('#mz-carrier').value === 'custom';
    $('#mz-outship').disabled = !custom;
    if (!custom) $('#mz-outship').value = C.carrierCost(fees, $('#mz-carrier').value, 0);
  }

  U.loadFees().then(function (f) {
    fees = f;
    $('#mz-cat').innerHTML = f.amazon.categories.map(function (c) { return '<option value="' + c.id + '">' + esc(c.label) + '</option>'; }).join('');
    $('#mz-cat').value = 'toys';
    $('#mz-carrier').innerHTML = U.carrierOptions(fees, 'yp60');
    var s = U.store.get('form-mz', null);
    if (s) { $('#mz-new').value = s.new || ''; $('#mz-cat').value = s.cat || 'toys'; $('#mz-carrier').value = s.carrier || 'yp60'; if (!C.findCarrier(fees, $('#mz-carrier').value)) $('#mz-carrier').value = 'yp60'; $('#mz-outship').value = s.outship || 0; $('#mz-code').value = s.code || ''; $('#mz-name').value = s.name || ''; $('#mz-q').value = s.q || ''; }
    links(); paintCarrier();
    var ye = $('#mz-yend'), yp = $('#mz-yend-paste');
    ye.addEventListener('input', function () { paintBuy(false); });
    function runEnd() {
      if (!yp.value.trim()) return;
      var v = C.parseEndTime(yp.value);
      if (!v) { U.toast('終了日時が読み取れませんでした。日時の欄に直接入れてください'); return; }
      ye.value = v; yp.value = ''; ye.classList.add('got'); paintBuy(false); U.toast('終了日時を ' + v.replace('T', ' ') + ' にしました');
    }
    yp.addEventListener('paste', function () { setTimeout(runEnd, 0); });
    yp.addEventListener('change', runEnd);
    $('#mz-carrier').addEventListener('change', paintCarrier);
    U.mountWh($('#wh'), fees, '');
    ['mz-q', 'mz-code'].forEach(function (id) { $('#' + id).addEventListener('input', links); });
    $$('.side input, .side select').forEach(function (el) {
      if (el.id === 'mz-key' || el.id === 'mz-q' || el.id === 'mz-code' || el.id === 'mz-yend' || el.id === 'mz-yend-paste') return;
      el.addEventListener('input', function () { if (el.id === 'mz-new') manual = false; update(); });
      el.addEventListener('change', update);
    });
    $('#mz-sell').addEventListener('input', function () { sel = -1; manual = true; $$('#rows tr.on').forEach(function (tr) { tr.classList.remove('on'); }); detail(); });
    update();
  });
})();
