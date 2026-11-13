/* せどり 利益チェック — 仕入れる前の確かめ(8項目)
   利用者が自分で見て印を付ける点検表。このアプリはAmazonの管理画面も商品ページも読まない。
   - 置く場所: 楽天・Yahoo!→Amazon と バーコード読み取り の「仕入れた」の上(入れ物 #precheck)
   - 自動で付く印は2つだけ: ⑤ Keepaの値がある時の「Amazon本体が販売していない」、⑥ 寸法からFBAの区分が出ている時
   - 印は端末の 'precheck'(JAN・ASINごと。300件まで)。「仕入れた」の時に、台帳の行の precheck に { n, of, miss, at } だけ残す
   - 印が足りなくても「仕入れた」は押せる。押したあとで、残っている項目を知らせる
   - Amazonが求める書類の条件・出品制限の中身は書かない(Amazonの出品者向けの案内で確かめる、とだけ書く)
   計算だけの部品(ITEMS・autoMarks・merge・result・prune)は node の試験から読める */
(function (root) {
  'use strict';

  var ITEMS = [
    { id: 'list', label: '自分のアカウントで、この商品を新品で出品できる', how: 'Amazonの出品者向けの管理画面で、この商品の出品の可否を見る' },
    { id: 'brand', label: 'ブランド・カテゴリーの申請が要らない(要るなら済んでいる)', how: '同じ画面に、申請を求める表示が出ないかを見る' },
    { id: 'hazmat', label: '危険物・期限つきの品ではない(当たるなら条件を確かめた)', how: '電池・スプレー・液体・食品・化粧品などは、Amazonの出品者向けの案内で扱いの条件を確かめる' },
    { id: 'maker', label: 'メーカーや正規代理店が販売を制限している品ではない', how: '商品ページとメーカーのサイトに、売り先を限る記載がないかを見る' },
    { id: 'amz', label: 'Amazon本体が販売していない', how: 'Amazonの商品ページで販売元を見る。Keepaの値があれば自動で付く', auto: true },
    { id: 'size', label: 'サイズと重さがFBAで扱える', how: '梱包した寸法と重さを「寸法と重さからFBAのサイズを出す」に入れる。区分が出れば自動で付く', auto: true },
    { id: 'doc', label: '書類(請求書・領収書)がもらえる仕入れ先である', how: 'どの書類が要るかは、Amazonの出品者向けの案内で確かめる。仕入れ先の注文の画面で、出してもらえる書類を見る' },
    { id: 'limit', label: '仕入れる数が、仕入れ先の決まりに触れない', how: '商品ページと店の規約にある、1人あたりの個数と、転売を目的にした購入についての記載を見る' }
  ];
  var MAX_SAVED = 300;

  /** 自動で分かる印。ctx: { kp: Keepaの値(無ければ null)。kp.amz=Amazon本体が販売中, tierAuto: 寸法から区分が出ているか }
      返す値は { amz: true(販売していない)/false(販売中)/なし, size: true/なし }。値が無い項目は自分で付ける */
  function autoMarks(ctx) {
    var a = {};
    if (ctx && ctx.kp && typeof ctx.kp.amz === 'boolean') a.amz = !ctx.kp.amz;
    if (ctx && ctx.tierAuto) a.size = true;
    return a;
  }
  /** 自分で付けた印(saved = { id: 1 })と自動の印を合わせる。自動で「付かない」と分かった項目(Amazon本体が販売中)は、自分の印より優先する */
  function merge(saved, auto) {
    saved = saved || {}; auto = auto || {};
    return ITEMS.map(function (it) {
      var has = Object.prototype.hasOwnProperty.call(auto, it.id);
      return { id: it.id, on: has ? auto[it.id] === true : !!saved[it.id], auto: has };
    });
  }
  /** 台帳の行に残す結果 */
  function result(saved, auto, date) {
    var m = merge(saved, auto), miss = m.filter(function (x) { return !x.on; }).map(function (x) { return x.id; });
    return { n: m.length - miss.length, of: m.length, miss: miss, at: date || '' };
  }
  function labelOf(id) { for (var i = 0; i < ITEMS.length; i++) if (ITEMS[i].id === id) return ITEMS[i].label; return id; }
  /** 残っている項目を知らせる文(全部付いていれば空) */
  function missText(res) {
    if (!res || !res.miss || !res.miss.length) return '';
    return '確かめが' + res.miss.length + 'つ残っています: ' + res.miss.map(function (id) { return labelOf(id).replace(/\(.*\)$/, ''); }).join('/');
  }
  /** 保存する数を max までに(古いものから消す)。map = { コード: { m: {id:1}, at: 時刻 } } */
  function prune(map, max) {
    var keys = Object.keys(map || {}); max = max || MAX_SAVED;
    if (keys.length <= max) return map || {};
    keys.sort(function (a, b) { return (map[b].at || 0) - (map[a].at || 0); });
    var out = {}; keys.slice(0, max).forEach(function (k) { out[k] = map[k]; });
    return out;
  }
  function normCode(c) { return String(c || '').replace(/\s/g, '').toUpperCase(); }

  var api = { ITEMS: ITEMS, autoMarks: autoMarks, merge: merge, result: result, missText: missText, prune: prune, normCode: normCode };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SedoriPrecheck = api;
  if (typeof document === 'undefined' || !root.SedoriUI) return;

  /* ---------- 画面 ---------- */
  var U = root.SedoriUI, $ = U.$, esc = U.esc;
  var box = null, getCtx = null, lastNote = '';
  function all() { var m = U.store.get('precheck', {}); return m && typeof m === 'object' ? m : {}; }
  function savedFor(code) { var e = all()[normCode(code)]; return e && e.m ? e.m : {}; }
  function setMark(code, id, on) {
    code = normCode(code); if (!code) return false;
    var m = all(), e = m[code] || { m: {} };
    if (on) e.m[id] = 1; else delete e.m[id];
    e.at = Date.now(); m[code] = e;
    return U.store.set('precheck', prune(m));
  }
  function ctx() { var c = getCtx ? getCtx() : null; return c || { code: '' }; }
  /** 台帳の行に入れる結果(コードが無い時も、印なしの結果を返す) */
  function resultFor(code, c) { c = c || ctx(); return result(savedFor(code != null ? code : c.code), autoMarks(c), U.today()); }

  function paint() {
    if (!box) return;
    var c = ctx();
    box.hidden = c.hide === true;
    if (box.hidden) return;
    var code = normCode(c.code), auto = autoMarks(c), m = merge(savedFor(code), auto);
    var n = m.filter(function (x) { return x.on; }).length;
    var open = box.querySelector('details') ? box.querySelector('details').open : false;
    box.innerHTML = '<details class="pk"' + (open ? ' open' : '') + '><summary>仕入れる前の確かめ<b class="pk-n">' + n + '/' + m.length + '</b></summary>' +
      (code ? '' : '<p class="pk-msg">JANかASINを入れると、商品ごとに印が残ります。</p>') +
      '<ul class="pk-l">' + m.map(function (x, i) {
        var it = ITEMS[i], state = '';
        if (x.auto) state = x.on ? '<span class="pk-a">自動</span>' : '<span class="pk-a ng">Keepaの値では、Amazon本体が販売中</span>';
        return '<li><label><input type="checkbox" data-pc="' + it.id + '"' + (x.on ? ' checked' : '') + (x.auto ? ' disabled' : '') + '><span>' + esc(it.label) + state + '</span></label><small>' + esc(it.how) + '</small></li>';
      }).join('') + '</ul>' +
      (lastNote ? '<p class="pk-msg" role="status">' + esc(lastNote) + '</p>' : '') +
      '<p class="hint">自分で見て付ける印です。このアプリはAmazonの管理画面を読みません。印が足りなくても「仕入れた」は押せ、付いた数が台帳の行に残ります。</p></details>';
  }
  function onChange(e) {
    var id = e.target && e.target.getAttribute && e.target.getAttribute('data-pc'); if (!id) return;
    var code = normCode(ctx().code);
    if (!code) { e.target.checked = false; U.toast('先にJANかASINを入れてください'); return; }
    if (!setMark(code, id, e.target.checked)) U.toast('この端末では印を保存できませんでした');
    lastNote = ''; paint();
  }
  /** 入れ物に出す。fn は今の商品を返す: { code, kp, tierAuto, hide } */
  function mount(el, fn) {
    box = el; getCtx = fn; box.classList.add('pk-box');
    box.addEventListener('change', onChange);
    paint();
  }
  /** 「仕入れた」のあと: 結果を知らせる(印が残っていれば開いて見せる) */
  function afterBuy(res) {
    lastNote = res ? '台帳に ' + res.n + '/' + res.of + ' で残しました。' : '';   // 残りの項目は、上の一覧の印で分かる(批評C5)
    paint();
    var d = box && box.querySelector('details'); if (d && res && res.miss.length) d.open = true;
  }
  /* ---------- 楽天・Yahoo!→Amazon のページ ---------- */
  function mountRA() {
    var el = $('#precheck'); if (!el || !$('#c-code') || !U.hook) return;
    function raCtx() {
      var RA = root.SedoriRA, it = RA && RA.selected ? RA.selected() : null;
      var kpEl = $('#kp-out'), dOut = $('#d-out');
      var kp = it ? (it.kp || null) : (kpEl && kpEl.querySelector('.kpx') ? { amz: /Amazon本体<\/td><td>在庫あり/.test(kpEl.innerHTML) } : null);
      return { code: $('#c-code').value, kp: kp, tierAuto: it ? !!it.tier : !!(dOut && /^目安/.test(dOut.textContent)) };
    }
    mount(el, raCtx);
    $('#c-code').addEventListener('input', function () { lastNote = ''; paint(); });
    // Keepaの欄・寸法の欄・選んだ商品が変わったら描き直す(自分の入れ物は見ていないので、繰り返しにならない)
    if (root.MutationObserver) ['#kp-out', '#d-out', '#d-name'].forEach(function (s) {
      var t = $(s); if (t) new MutationObserver(function () { lastNote = ''; paint(); }).observe(t, { childList: true, characterData: true, subtree: true });
    });
    // 「仕入れた」: 台帳に入れる直前に結果を行へ足し、入った直後に残りを知らせる(ui.js の口)
    U.hook('buy-row', function (p) { if (p && p.row) p.row.precheck = resultFor(); });
    U.hook('bought', function (p) { if (p && p.row && p.row.precheck) afterBuy(p.row.precheck); });
    U.hook('ra-select', function () { lastNote = ''; paint(); });
  }

  api.mount = mount; api.paint = paint; api.resultFor = resultFor; api.afterBuy = afterBuy; api.savedFor = savedFor;
  function start() { if (document.body.getAttribute('data-page') !== 'scan') mountRA(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(typeof window !== 'undefined' ? window : this);
