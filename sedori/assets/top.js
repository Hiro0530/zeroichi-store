/* トップ: ページの一覧(行で開く)、今日のポイント高還元、台帳の状況 */
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
  }).join('') + '</table>' + (need ? '<p class="row-links"><a href="daicho/?tab=need"><span class="badge">相手確認が未入力 ' + need + '件</span></a></p>' : '') +
    '<p class="row-links"><a href="daicho/">台帳を開く</a></p>' :
    '<p class="hint">まだ記録がありません。計算ページで「仕入れた」を押すと自動で記録されます。</p><p class="row-links"><a href="daicho/">台帳を開く</a></p>';

  // 今日のポイント高還元(楽天)
  fetch('data/today.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (j) {
    $('#today-time').textContent = j.fetched_at_label ? j.fetched_at_label + ' 取得' : '';
    var items = (j.items || []).slice(0, 10);
    $('#today-rows').innerHTML = items.length ? items.map(function (it, i) {
      var jan = it.jan || C.extractJan(it.name);
      return '<tr><td class="c-img">' + (it.img ? '<img class="thumb" loading="lazy" src="' + esc(it.img) + '" alt="">' : '<span class="thumb no"></span>') + '</td>' +
        '<td><div class="nm"><a href="' + esc(it.url) + '" target="_blank" rel="noopener sponsored">' + esc(it.name) + '</a></div><div class="meta">' + esc(it.shop || '') + (jan ? '<span aria-hidden="true">　</span>JAN ' + esc(jan) : '') + (it.freeShip ? '<span aria-hidden="true">　</span><b>送料無料</b>' : '') + '</div></td>' +
        '<td class="r" data-k="価格"><span class="yen">' + yen(it.price) + '<i>円</i></span></td>' +
        '<td class="r c-pt"><span class="pt">P' + esc(it.pointRate || 1) + '倍</span></td>' +
        '<td class="c-fee muted" style="white-space:nowrap">' + (it.until ? esc(it.until.slice(5, 10).replace('-', '/')) + 'まで' : '') + '</td>' +
        '<td class="r" data-k=""><a class="btn sm ghost" href="rakuten-amazon/?t=' + i + '">利益を見る</a></td></tr>';
    }).join('') : '<tr><td colspan="6" class="empty">今日の分はまだありません(毎朝更新)。</td></tr>';
  }).catch(function () { $('#today-rows').innerHTML = '<tr><td colspan="6" class="empty">今日の分はまだありません(毎朝更新)。</td></tr>'; });
})();
