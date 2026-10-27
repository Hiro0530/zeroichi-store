/* あなたに合う せどりの型 診断(6問)。点数の一番高い型を1つすすめ、次点も出す。収入の見込みは出さない */
(function () {
  'use strict';
  var form = document.getElementById('shindan'); if (!form) return;
  var R = {
    ra: { name: '電脳せどり(楽天・Yahoo!→Amazon)', url: 'rakuten-amazon/', why: '新品を公式の通販サイトで買ってAmazon(FBA)で売る型です。古物商許可が要らない新品中心で、スマホで仕入れ判断ができます。ポイント還元を使うため、仕入れ値の上限を決めて買うのが基本です。' },
    mz: { name: '無在庫型(Amazon中古×ヤフオク)', url: 'muzaiko-amazon/', why: '売れてから仕入れるので在庫の資金は少なくて済みますが、古物商許可、1万円以上の買い受けでの本人確認、仕入れ先が売り切れた時のキャンセル対応が必要です。ルールを守る手間を受け入れられる方向けです。' },
    mc: { name: 'メルカリで売る(不用品・小さく)', url: 'mercari-calc/', why: 'まず家にある物や少額の仕入れで、手数料・送料込みの手取りの感覚をつかむ型です。資金も時間も小さく始められます。' },
    ym: { name: 'ヤフオク→メルカリ(中古の価格差)', url: 'yahuoku-mercari/', why: '中古品の売り場の違いによる価格差を使う型です。中古を繰り返し仕入れるなら古物商許可が必要で、写真は自分で撮り直します。' },
    au: { name: 'ブランド中古(業者オークション→メルカリ)', url: 'auction-mercari/', why: '古物市場でブランド品などを仕入れる型です。古物商許可と市場の入会が前提で、1点あたりの金額が大きく、真贋や相場の目利きが要ります。' }
  };
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var q = {}; ['cap', 'time', 'lic', 'risk', 'kind', 'where'].forEach(function (k) { var c = form.querySelector('input[name="' + k + '"]:checked'); q[k] = c ? c.value : ''; });
    if (Object.keys(q).some(function (k) { return !q[k]; })) { show('<p>6つの質問すべてに答えてください。</p>'); return; }
    var s = { ra: 0, mz: 0, mc: 0, ym: 0, au: 0 };
    // 元手
    if (q.cap === 'low') { s.mc += 3; s.mz += 2; s.ym += 1; s.ra += 1; s.au -= 3; }
    if (q.cap === 'mid') { s.ra += 3; s.ym += 2; s.mz += 1; s.au += 1; }
    if (q.cap === 'high') { s.ra += 2; s.au += 3; s.ym += 1; }
    // 時間
    if (q.time === 'short') { s.mc += 2; s.ra += 2; s.mz -= 1; s.au -= 1; }
    if (q.time === 'mid') { s.ra += 2; s.ym += 2; s.mz += 1; s.au += 1; }
    if (q.time === 'long') { s.mz += 2; s.au += 2; s.ym += 1; }
    // 古物商許可
    if (q.lic === 'yes') { s.au += 3; s.mz += 2; s.ym += 2; }
    if (q.lic === 'plan') { s.ra += 2; s.ym += 1; }
    if (q.lic === 'no') { s.ra += 3; s.mc += 2; s.au -= 9; s.mz -= 9; s.ym -= 3; }
    // リスク
    if (q.risk === 'low') { s.mc += 2; s.ra += 1; s.mz -= 2; s.au -= 1; }
    if (q.risk === 'mid') { s.ra += 2; s.ym += 1; }
    if (q.risk === 'high') { s.au += 2; s.mz += 2; }
    // 新品/中古
    if (q.kind === 'new') { s.ra += 4; s.mz -= 2; s.ym -= 2; s.au -= 3; }
    if (q.kind === 'used') { s.ym += 2; s.au += 2; s.mz += 2; s.ra -= 2; }
    if (q.kind === 'both') { s.ra += 1; s.mc += 1; }
    // 店舗/ネット
    if (q.where === 'net') { s.ra += 1; s.mz += 1; s.ym += 1; }
    if (q.where === 'store') { s.mc += 1; s.au += 1; }
    var order = Object.keys(s).sort(function (a, b) { return s[b] - s[a]; });
    var a = R[order[0]], b = R[order[1]];
    var note = q.lic === 'no' && q.kind === 'used' ? '<p class="note-s">中古品を仕入れて売ることを繰り返すには古物商許可が必要です。許可が出るまでは、許可の要らない新品や自分の不用品から始める型をおすすめしています。</p>' : '';
    show('<p class="plan-name">あなたに合いそうな型</p><h3 style="margin:2px 0 6px;font-size:20px">' + a.name + '</h3><p>' + a.why + '</p>' +
      '<a class="btn" href="' + a.url + '">' + a.name.replace(/\(.*\)/, '') + 'の計算ページを開く</a>' +
      '<p class="muted" style="margin-top:10px">次の候補: <a href="' + b.url + '">' + b.name + '</a></p>' + note +
      '<p class="muted">この診断は、答えに合う作業の型を選ぶためのものです。収入や利益の見込みを示すものではありません。</p>');
    try { localStorage.setItem('zw-sedori:shindan', JSON.stringify({ q: q, r: order[0] })); } catch (err) { /* 何もしない */ }
  });
  function show(h) { var o = document.getElementById('shindan-out'); o.innerHTML = h; o.hidden = false; o.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
})();
