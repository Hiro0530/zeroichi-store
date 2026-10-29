/* トップ: ページの一覧(行で開く)、台帳の状況。見本表「今日のポイント高還元」はお客さん向けに出さない(2026-10-29 本部決定) */
(function () {
  'use strict';
  var U = window.SedoriUI, C = window.SedoriCalc;
  var $ = U.$, $$ = U.$$, esc = U.esc, yen = U.yen;

  $$('#route-grid tbody tr').forEach(function (tr) {
    tr.addEventListener('click', function (e) { if (!e.target.closest('a')) location.href = tr.getAttribute('data-href'); });
  });

  // 台帳の状況
  var rows = U.ledger.all(), box = $('#top-ledger');
  var need = rows.filter(function (r) { return U.checkState(r) === 'need'; }).length;
  box.innerHTML = rows.length ? '<table class="lsum">' + U.STATUS.map(function (s) {
    return '<tr><td>' + s + '</td><td>' + rows.filter(function (r) { return (r.status || '仕入れ済') === s; }).length + '件</td></tr>';
  }).join('') + '</table>' + (need ? '<p class="row-links"><a href="daicho/?tab=need"><span class="badge">売り手の確認が未入力 ' + need + '件</span></a></p>' : '') +
    '<p class="row-links"><a href="daicho/">台帳を開く</a></p>' :
    '<p class="hint">まだ記録がありません。計算ページで「仕入れた」を押すと自動で記録されます。</p><p class="row-links"><a href="daicho/">台帳を開く</a></p>';

})();
