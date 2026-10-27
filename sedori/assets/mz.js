/* 無在庫型(Amazon中古 × ヤフオク)の計算ページ。ヤフオクには一切アクセスせず、検索ページを開くリンクを作るだけ */
(function () {
  'use strict';
  var U = window.SedoriUI, C = window.SedoriCalc;
  var $ = U.$, $$ = U.$$, esc = U.esc, yen = U.yen, val = U.val;
  var fees = null, sellTouched = false;

  function keys() { return U.store.get('keys', {}); }
  $('#mz-key').value = keys().keepa || '';
  $('#mz-key-save').addEventListener('click', function () {
    var k = keys(); k.keepa = $('#mz-key').value.trim();
    U.toast(U.store.set('keys', k) ? 'この端末に保存しました' : 'この端末では保存できませんでした');
  });

  function links() {
    var q = $('#mz-q').value.trim() || $('#mz-code').value.trim();
    var e = encodeURIComponent(q);
    $('#mz-yh').href = q ? 'https://auctions.yahoo.co.jp/search/search?p=' + e + '&va=' + e : 'https://auctions.yahoo.co.jp/';
    $('#mz-yh-closed').href = q ? 'https://auctions.yahoo.co.jp/closedsearch/closedsearch?p=' + e + '&va=' + e : 'https://auctions.yahoo.co.jp/';
    var code = $('#mz-code').value.trim();
    $('#mz-amz').href = code ? (/^B0[A-Z0-9]{8}$/i.test(code) ? 'https://www.amazon.co.jp/dp/' + encodeURIComponent(code) : 'https://www.amazon.co.jp/s?k=' + encodeURIComponent(code)) : 'https://www.amazon.co.jp/';
  }
  ['mz-q', 'mz-code'].forEach(function (id) { $('#' + id).addEventListener('input', links); });

  function shortName(t) {
    return String(t || '').replace(/【[^】]*】|\[[^\]]*\]|（[^）]*）|\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
  }

  $('#mz-go').addEventListener('click', function () {
    var k = keys(), code = $('#mz-code').value.trim().replace(/\s/g, ''), out = $('#mz-kp');
    if (!k.keepa) { $('#mz-key').closest('details').open = true; out.innerHTML = '<div class="info">Keepa APIキーが未設定です。下の欄で入れるか、「Amazonで見る」で新品価格を確かめて手で入れてください。</div>'; return; }
    if (!code) { out.innerHTML = '<div class="info">JAN か ASIN を入れてください。</div>'; return; }
    var isAsin = /^B0[A-Z0-9]{8}$/i.test(code) || /^\d{9}[\dX]$/i.test(code);
    var p = new URLSearchParams({ key: k.keepa, domain: '5', stats: '90' });
    p.set(isAsin ? 'asin' : 'code', code.toUpperCase());
    out.innerHTML = '<p class="note-s">Keepaに問い合わせ中…</p>';
    fetch('https://api.keepa.com/product?' + p.toString()).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(r.status === 429 ? 'Keepaのトークンが足りません。' : 'Keepaの取得に失敗しました(' + r.status + ')'); return j; });
    }).then(function (j) {
      var pr = (j.products || [])[0];
      if (!pr || !pr.asin) { out.innerHTML = '<div class="info">Amazonで見つかりませんでした。</div>'; return; }
      var cur = (pr.stats || {}).current || [];
      var nw = cur[1] > 0 ? cur[1] : (cur[0] > 0 ? cur[0] : null), used = cur[2] > 0 ? cur[2] : null;
      if (nw) $('#mz-new').value = nw;
      if (!$('#mz-q').value) $('#mz-q').value = shortName(pr.title);
      $('#mz-name').value = pr.title || '';
      sellTouched = false; links(); calc();
      out.innerHTML = '<div class="kp"><div>新品の最安値<b>' + (nw ? yen(nw) + '円' : '—') + '</b></div><div>中古の最安値<b>' + (used ? yen(used) + '円' : '—') + '</b></div>' +
        '<div>Amazon本体<b>' + (cur[0] > 0 ? '在庫あり' : 'なし・在庫切れ') + '</b></div><div>ASIN<b>' + esc(pr.asin) + '</b></div></div>' +
        '<p class="note-s">' + esc(pr.title || '') + '(Keepa の残りトークン: ' + esc(j.tokensLeft) + ')</p>' +
        (used ? '<p class="note-s">中古の最安値より高い出品価格は、売れにくいことがあります。</p>' : '');
    }).catch(function (err) {
      var t = String(err && err.message || err);
      if (/Failed to fetch|NetworkError|Load failed/i.test(t)) t = 'Keepaに接続できませんでした。';
      out.innerHTML = '<div class="warn">' + esc(t) + '</div>';
    });
  });

  function calc() {
    if (!fees) return;
    var nw = val('mz-new');
    if (!sellTouched && nw > 0) $('#mz-sell').value = Math.floor(nw * (1 - val('mz-off') / 100));
    var x = { sell: val('mz-sell'), category: $('#mz-cat').value, cost: val('mz-yprice'), inShip: val('mz-yship'), other: val('mz-other'),
      selfShip: true, selfShipCost: val('mz-outship'), usePoints: false };
    var g = $('#mz-guard'), media = $('#mz-media').checked;
    g.hidden = !(x.cost >= 10000 || (media && x.cost > 0));
    var out = $('#mz-out');
    if (!(x.sell > 0)) { out.innerHTML = '<p class="empty">Amazonの新品価格(または出品価格)を入れると、ここに結果が出ます。</p>'; return null; }
    var tg = U.target(), maxc = C.amazonMaxCost(fees, x, tg);
    if (!(x.cost > 0)) {
      out.innerHTML = '<table class="brk"><tr class="t"><td>ヤフオクで払ってよい上限(' + esc(U.targetLabel(tg)) + '・送料別)</td><td>' + (maxc == null ? '届きません' : yen(maxc) + '円') + '</td></tr></table>' +
        '<p class="note-s">ヤフオクで見た価格を入れると、利益を計算します。</p>';
      return null;
    }
    var r = C.amazonProfit(fees, x), be = C.amazonBreakEvenSell(fees, x);
    var rows = [['Amazonの出品価格(中古)', r.sell], ['販売手数料(税込)', -r.referral], ['お客様への発送(発送代行・送料)', -r.selfShipCost], ['Amazonからの入金', r.payout, 't'],
      ['ヤフオクの価格', -r.cost], ['ヤフオクの送料', -r.inShip], ['その他', -r.other], ['利益(1個)', r.profit, 't']];
    out.innerHTML =
      '<div class="big"><span class="k">1個あたりの利益</span><span class="v ' + (r.profit >= 0 ? 'plus' : 'minus') + '">' + yen(r.profit) + '<small style="font-size:.45em">円</small></span></div>' +
      '<div class="kpis"><div><b>' + U.pct(r.margin) + '</b><span>利益率</span></div><div><b>' + U.pct(r.roi, 0) + '</b><span>仕入れ額に対する利益</span></div><div><b>' + (nw > 0 ? U.pct(1 - r.sell / nw, 0) : '—') + '</b><span>新品より安い割合</span></div></div>' +
      '<table class="brk">' + rows.filter(function (a) { return a[1] !== 0 || a[2]; }).map(function (a) { return '<tr' + (a[2] ? ' class="t"' : '') + '><td>' + esc(a[0]) + '</td><td>' + yen(a[1]) + '</td></tr>'; }).join('') + '</table>' +
      '<table class="brk" style="margin-top:10px"><tr class="t"><td>損益分岐の出品価格</td><td>' + (be ? yen(be) + '円' : '—') + '</td></tr>' +
      '<tr class="t"><td>' + esc(U.targetLabel(tg)) + 'を残す出品価格</td><td>' + (function () { var p = C.amazonPriceFor(fees, x, tg); return p ? yen(p) + '円' : '—'; })() + '</td></tr>' +
      '<tr class="t"><td>ヤフオクで払ってよい上限(' + esc(U.targetLabel(tg)) + ')</td><td>' + (maxc == null ? '届きません' : yen(maxc) + '円') + '</td></tr></table>' +
      (maxc != null && x.cost > maxc ? '<div class="warn">ヤフオクの価格が上限を ' + yen(x.cost - maxc) + '円 超えています。</div>' : '') +
      '<p class="note-s">在庫保管・返品・キャンセル時の費用は含みません。売れてから仕入れる形のため、仕入れ先が売り切れた時はキャンセルになります。</p>';
    U.store.set('form-mz', { new: $('#mz-new').value, off: $('#mz-off').value, cat: $('#mz-cat').value, outship: $('#mz-outship').value });
    return r;
  }

  $('#mz-sell').addEventListener('input', function () { sellTouched = true; });
  ['mz-new', 'mz-off'].forEach(function (id) { $('#' + id).addEventListener('input', function () { sellTouched = false; }); });

  $('#mz-ledger').addEventListener('click', function () {
    var r = calc(); if (!(val('mz-yprice') > 0)) { U.toast('ヤフオクの価格を入れてください'); return; }
    U.ledger.prefill({ kind: '仕入れ', cond: '中古', name: $('#mz-name').value || $('#mz-q').value, feature: $('#mz-code').value ? 'JAN/ASIN ' + $('#mz-code').value : '',
      qty: 1, unit: val('mz-yprice') + val('mz-yship'), party: 'Yahoo!オークション 出品者: ', sellTo: 'Amazon(中古)',
      memo: r ? '予定売値 ' + r.sell + '円・見込み利益 ' + r.profit + '円' : '' });
  });

  U.loadFees().then(function (f) {
    fees = f;
    $('#mz-cat').innerHTML = f.amazon.categories.map(function (c) { return '<option value="' + c.id + '">' + esc(c.label) + '</option>'; }).join('');
    $('#mz-cat').value = 'toys';
    var s = U.store.get('form-mz', null);
    if (s) { $('#mz-new').value = s.new || ''; $('#mz-off').value = s.off || 15; $('#mz-cat').value = s.cat || 'toys'; $('#mz-outship').value = s.outship || 900; }
    links();
    $$('#mz-calc input, #mz-calc select').forEach(function (el) { el.addEventListener('input', calc); el.addEventListener('change', calc); });
    calc();
  });
})();
