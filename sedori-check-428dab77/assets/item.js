/* 商品ページ(shohin/): 1商品を1画面に。売値と仕入れ値、価格の推移、売れ行きの目安、在庫で持つかの目安、利益の内訳、操作
   - 開き方: 一覧(検索結果・まとめて・ウォッチ)の行の「商品ページ」→ ra.js が端末の item-cur に商品と計算の条件を置く。台帳の行は ?l=行のid
   - 利益はポイント抜き。ポイントは「おまけ」として別に見せる(利益に入れない)
   - 価格の推移は、利用者自身のKeepaのキーで取った数値(端末の kp-hist)からこの画面で描く。Keepaの画像は貼らない。ほかの利用者へ出さない
   - 売れ行き・在庫で持つかは目安(SedoriCalc.sellThrough / stockAdvice)。基準の値は config.js の ITEM_RULES */
(function () {
  'use strict';
  var U = window.SedoriUI, C = window.SedoriCalc, A = window.SedoriAPI;
  var $ = U.$, $$ = U.$$, esc = U.esc, yen = U.yen;
  var RULES = Object.assign({}, C.ITEM_RULES, (window.ZW_CONFIG || {}).ITEM_RULES || {});
  var LISTS = { s: '検索結果', b: 'まとめて', w: 'ウォッチ' };
  var fees = null, snap = null, it = null, x = null, row = null, editOpen = false, busy = '', note = '';
  var body = $('#it-body');

  /* ---------- 読み込み ---------- */
  function load() {
    var q = new URLSearchParams(location.search), lid = q.get('l');
    if (lid) {
      row = U.ledger.get(lid); if (!row) return false;
      var f = String(row.feature || ''), jan = (f.match(/JAN\s*(\d{8,13})/) || [])[1], asin = (f.match(/ASIN\s*([A-Z0-9]{10})/i) || [])[1];
      x = row.calc ? JSON.parse(JSON.stringify(row.calc)) : null;
      it = { name: row.name, jan: jan || '', asin: asin || '', price: x ? x.cost : Math.round(Number(row.unit) || 0), inShip: x ? x.inShip : 0, sell: Number(row.sellPrice) || null,
        url: /^https?:/.test(row.ref || '') ? row.ref : '', shop: row.party || '', bought: row.id, freeShip: null, kp: null };
      $('#it-back').href = U.base() + 'daicho/'; $('#it-back').textContent = '台帳へ戻る';
      return true;
    }
    snap = U.store.get('item-cur', null);
    if (!snap || !snap.it) return false;
    if (q.get('f') && (q.get('f') !== snap.from || String(q.get('i')) !== String(snap.i))) return false;
    it = snap.it; x = snap.x;
    $('#it-back').href = U.base() + 'rakuten-amazon/?tab=' + snap.from; $('#it-back').textContent = (LISTS[snap.from] || '一覧') + 'へ戻る';
    return true;
  }
  /** 直した値を、元の一覧(端末の保存)にも入れる。並びが変わっていたら入れない */
  function save() {
    if (row) return;
    U.store.set('item-cur', snap);
    var key = { s: 'ra-last', b: 'ra-bulk', w: 'watch2' }[snap.from], st = U.store.get(key, null); if (!st || snap.i < 0) return;
    var list = snap.from === 'w' ? st : st.items, cur = list && list[snap.i];
    if (!cur || (cur.jan || '') !== (snap.jan0 || '') || (cur.name || '') !== (snap.name0 || '')) return;
    list[snap.i] = it; U.store.set(key, st);
  }
  function hist() { return A.hist(it.asin || (it.kp && it.kp.asin)); }

  /* ---------- 計算(計算ページと同じ式。利益はポイント抜き) ---------- */
  function calc() {
    if (!fees || !x || !(Number(it.price) > 0)) return null;
    if (C.tooBig(it.price) || C.tooBig(it.sell) || C.tooBig(it.inShip)) return { over: true };
    var xx = Object.assign({}, x, { sell: Number(it.sell) || 0, cost: Number(it.price), inShip: Number(it.inShip) || 0, usePoints: true }), x0 = Object.assign({}, xx, { usePoints: false });
    var tg = U.target(), sug = C.amazonPriceFor(fees, x0, tg), be = C.amazonBreakEvenSell(fees, x0);
    if (!(xx.sell > 0)) return { est: true, sug: sug, be: be };
    var r = C.amazonProfit(fees, xx);
    r.x = xx; r.sug = sug; r.be = be; r.need = C.needProfit(r.sell, tg); r.maxc = C.amazonMaxCost(fees, x0, tg);
    return r;
  }
  /** 今の状態: ship(送料が未入力)/cost(仕入れ値が未入力)/sell(売値が未入力)/ok(目標に届く)/ng(届かない)/rec(台帳の記録だけ) */
  function stateOf(r) {
    if (row && !x) return 'rec';
    if (!(Number(it.price) > 0)) return 'cost';
    if (C.needShip(it)) return 'ship';
    if (!r || r.est || r.over) return 'sell';
    return r.profitNoPoints >= r.need ? 'ok' : 'ng';
  }
  function sales() { return it.kp ? C.sellThrough(it.kp, RULES) : null; }
  function advice(s) {
    var t = x && C.findFbaTier(fees, x.fbaTier);
    return C.stockAdvice({ level: s ? s.level : null, sell: it.sell, shops: it.rkShops, big: !!(x && t && /^(large|xl)/.test(t.id)) }, RULES);
  }

  /* ---------- 描く ---------- */
  function md(t) { var d = new Date(t); return (d.getMonth() + 1) + '/' + d.getDate(); }
  function kv(k, v, sub) { return '<div class="it-kv"><dt>' + k + '</dt><dd>' + v + (sub ? '<small>' + sub + '</small>' : '') + '</dd></div>'; }
  function money(v) { return v > 0 ? yen(v) + '<i>円</i>' : '<span class="it-none">未入力</span>'; }

  function sumHTML(r, st) {
    var h = '<section class="it-sum" id="it-sum">';
    if (st === 'ok' || st === 'ng') {
      var np = r.profitNoPoints, gap = r.need - np;
      h += '<p class="it-k">見込み利益(1個・ポイント抜き)</p><p class="it-pf ' + (np <= 0 ? 'bad' : (st === 'ok' ? 'good' : '')) + '"><b>' + yen(np) + '</b><i>円</i><span>利益率 ' + U.pct(r.sell > 0 ? np / r.sell : 0) + '</span></p>' +
        '<p class="it-v ' + st + '">' + (np <= 0 ? '<b>赤字</b>この売値と仕入れ値では、手数料と送料を引くと赤字です。' :
          (st === 'ok' ? '<b>目標に届く</b>目標は' + esc(U.targetLabel()) + '(' + yen(r.need) + '円)。' : '<b>目標に届かない</b>目標の' + esc(U.targetLabel()) + '(' + yen(r.need) + '円)まで、あと' + yen(gap) + '円。')) + '</p>';
      if (r.points > 0) h += '<p class="it-pt">おまけ<b>ポイント ' + yen(r.points) + '円</b><span>利益には入れていません(' + U.pct(r.x.pointRate) + '・仕入れ値÷1.1×率)</span></p>';
    } else if (st === 'rec') {
      h += '<p class="it-k">台帳に記録した見込み利益(1個)</p><p class="it-pf"><b>' + (row.profit != null ? yen(row.profit) : '—') + '</b>' + (row.profit != null ? '<i>円</i>' : '') + '</p>' +
        '<p class="it-v">この行には計算の条件が残っていないため、内訳は出せません。</p>';
    } else {
      var t = { ship: ['仕入れの送料が未入力です', '送料込みの店が無かったため、送料別の一番安い店の値段を入れています。送料を入れると、利益を計算します。'],
        cost: ['仕入れ値が未入力です', '仕入れ値を入れると、利益を計算します。'],
        sell: r && r.over ? ['金額を確かめてください', '1,000万円以上の値は計算しません。'] : ['Amazonの売値が未入力です', 'Amazonで確かめた今の価格を入れると、利益を計算します。' + (r && r.sug ? '目標の' + esc(U.targetLabel()) + 'に届く売値の目安は' + yen(r.sug) + '円(その値段で売れるという意味ではありません)。' : '')] }[st];
      h += '<p class="it-k">見込み利益(1個・ポイント抜き)</p><p class="it-pf none"><b>未入力</b></p><p class="it-v wait"><b>' + t[0] + '</b>' + t[1] + '</p>';
    }
    var shipSub = it.freeShip ? '送料込み' : (C.needShip(it) ? '送料は未入力' : (Number(it.inShip) > 0 ? '送料 ' + yen(it.inShip) + '円' : (it.freeShip === false ? '送料別(0円で計算)' : '')));
    h += '<dl class="it-pr">' + kv('Amazonの売値', money(it.sell), it.kp && it.kp.t ? 'Keepa・' + md(it.kp.t) : '') +
      kv('仕入れ値', money(it.price), (it.shop ? esc(it.shop) + (shipSub ? '・' : '') : '') + shipSub) + '</dl>';
    return h + '</section>';
  }

  /** 価格の推移の図(数値からSVGを描く)。w = 図の幅(px) */
  function chartSVG(list, w, costLine) {
    var H = 200, L = 56, R = 12, T = 12, B = 28, st = C.seriesStats(list), n = list.length;
    var lo = Math.min(st.min, costLine || st.min), hi = Math.max(st.max, costLine || st.max), pad = Math.max(1, (hi - lo) * 0.12);
    lo = Math.max(0, lo - pad); hi += pad;
    var X = function (i) { return L + (w - L - R) * i / (n - 1); }, Y = function (v) { return T + (H - T - B) * (1 - (v - lo) / (hi - lo)); };
    var d = '', pen = false;
    list.forEach(function (v, i) { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); pen = true; });
    var g = '';
    var span = hi - lo, step = span > 6000 ? 1000 : (span > 2000 ? 500 : (span > 600 ? 200 : (span > 120 ? 50 : 10))), seen = {};   // 目盛りは切りのよい値に(半端な値は下の「今・最安・最高」で出す)
    [hi - pad, (lo + hi) / 2, lo + pad].map(function (v) { return Math.round(v / step) * step; }).filter(function (v) { if (seen[v] || v < lo || v > hi) return false; seen[v] = 1; return true; }).forEach(function (v) {
      g += '<line class="g" x1="' + L + '" x2="' + (w - R) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '"/><text class="ty" x="' + (L - 8) + '" y="' + (Y(v) + 4).toFixed(1) + '">' + yen(v) + '</text>';
    });
    var now = Date.now(), ticks = [[0, n - 1], [Math.round(n / 3), Math.round(n * 2 / 3)], [Math.round(n * 2 / 3), Math.round(n / 3)], [n - 1, 0]];
    ticks.forEach(function (t, k) {
      g += '<text class="tx" x="' + X(t[0]).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="' + (k === 0 ? 'start' : (k === 3 ? 'end' : 'middle')) + '">' + (t[1] ? md(now - t[1] * 86400000) : '今日') + '</text>';
    });
    if (costLine) g += '<line class="c" x1="' + L + '" x2="' + (w - R) + '" y1="' + Y(costLine).toFixed(1) + '" y2="' + Y(costLine).toFixed(1) + '"/>';
    var li = n - 1; while (li > 0 && list[li] == null) li--;
    return '<svg class="it-ch" width="' + w + '" height="' + H + '" viewBox="0 0 ' + w + ' ' + H + '" role="img" aria-label="新品の最安値の' + n + '日間の推移。今は' + yen(st.last) + '円、最安' + yen(st.min) + '円、最高' + yen(st.max) + '円">' +
      g + '<path class="p" d="' + d + '"/><circle class="dot" cx="' + X(li).toFixed(1) + '" cy="' + Y(list[li]).toFixed(1) + '" r="4"/></svg>';
  }
  function chartHTML() {
    var h = hist(), k = A.keys().keepa, out = '<section class="it-sec" id="it-chart"><h2>価格の推移<small>90日</small></h2>';
    if (h && h.nw) {
      var st = C.seriesStats(h.nw), cost = Number(it.price) > 0 ? Number(it.price) + (Number(it.inShip) || 0) : 0;
      out += '<div class="it-chw" data-chart></div>' +
        '<p class="it-lg"><span class="l1">新品の最安値</span>' + (cost ? '<span class="l2">仕入れ値' + (Number(it.inShip) > 0 ? '+送料' : '') + ' ' + yen(cost) + '円</span>' : '') + '</p>' +
        '<dl class="it-st">' + kv('今', yen(st.last) + '<i>円</i>') + kv('最安', yen(st.min) + '<i>円</i>') + kv('最高', yen(st.max) + '<i>円</i>') + '</dl>' +
        '<p class="it-note">ご自身のKeepaのキーで取った値(' + md(h.t) + '取得)を、この端末の中で図にしています。値の無い日は線が切れます。</p>';
    } else {
      out += '<p class="it-emp">価格の推移は、まだ取れていません。' + (k ? '' : 'Keepaのキー(ご自身のもの)を入れると、ここに90日の推移を描きます。') + '</p>';
    }
    out += '<p class="it-row">' + (k ? '<button type="button" class="it-btn" data-act="kp"' + (busy === 'kp' ? ' disabled' : '') + '>' + (busy === 'kp' ? 'Keepaに問い合わせています' : (h ? 'Keepaで取り直す' : 'Keepaで取る') + '(1トークン)') + '</button>' :
      '<a class="it-btn" href="' + U.base() + 'rakuten-amazon/#keys">キーを入れる</a>') + '</p>';
    return out + '</section>';
  }

  function salesHTML(s) {
    var out = '<section class="it-sec" id="it-sales"><h2>売れ行き</h2>';
    if (!s) return out + '<p class="it-emp">売れ行きは取れていません。Keepaで値を取ると、30日・90日の目安を出します。</p></section>';
    var bars = ''; for (var i = 1; i <= 5; i++) bars += '<i' + (i <= s.level ? ' class="on"' : '') + '></i>';
    var pace = C.paceText(s);
    out += '<p class="it-sp"><span class="it-bar" role="img" aria-label="売れる速さ 5段階の' + s.level + '">' + bars + '</span><b>' + s.label + '</b></p><dl class="it-st">' +
      kv('直近30日', s.has30 ? s.n30 + '<i>個' + (s.src === 'sold' ? '以上' : 'ほど') + '</i>' : '<span class="it-none">—</span>') +
      kv('直近90日', s.has90 ? s.n90 + '<i>個' + (s.n90 === s.n30 && s.src === 'sold' ? '以上' : 'ほど') + '</i>' : '<span class="it-none">—</span>') +
      kv('ペース', pace) + '</dl>' +
      '<p class="it-note">目安です。実際の販売数ではありません。Keepaの' + (s.src === 'sold' ? '月間販売数(Amazonの「過去1か月で○点以上購入」)と、' : '') + 'Amazonの売れ筋の順位が上がった回数(売れた回数の目安)から推定しています。日ごとの販売数は取れないため、出していません。' +
      (it.kp && it.kp.amz ? 'Amazon本体が販売中のため、この数のうち自分が売れる分は少なくなります。' : '') + (it.kp && it.kp.cnt ? '出品者は' + it.kp.cnt + '人です。' : '') + '</p>';
    return out + '</section>';
  }

  function advHTML(s) {
    var a = advice(s), k = A.keys(), canCount = a.check && it.jan && k.rkApp && k.rkKey;
    var name = { stock: '在庫で持つ向き', order: '取り寄せ販売の向き', none: 'どちらも向かない', unk: '目安を出せません' }[a.kind];
    var out = '<section class="it-sec" id="it-adv"><h2>在庫で持つか、取り寄せ販売か</h2><p class="it-ad ' + a.kind + '"><b>' + name + '</b></p><ul class="it-why">' +
      a.why.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>';
    if (a.kind === 'order') out += '<p class="it-note">取り寄せ販売(注文を受けてから仕入れる売り方)では、自分か発送代行で受け取ってから、自分の名義で発送します(仕入れ先からお客様へ直接送る形はとれません)。仕入れ先が売り切れたら、Amazonの在庫をすぐ0にしてください。</p>';
    if (canCount) out += '<p class="it-row"><button type="button" class="it-btn" data-act="shops"' + (busy === 'shops' ? ' disabled' : '') + '>' + (busy === 'shops' ? '楽天に問い合わせています' : '楽天で在庫のある店を数える(検索1回)') + '</button></p>';
    return out + '<p class="it-note">最後は売れた価格を見て決めてください。</p></section>';
  }

  function brkHTML(r, st) {
    if (st !== 'ok' && st !== 'ng') return '';
    var xx = r.x, rows = [['Amazonの売値', r.sell], ['販売手数料', -r.referral], [xx.selfShip ? '送料(自分か代行が発送)' : 'FBA配送代行手数料', xx.selfShip ? -r.selfShipCost : -r.fba],
      ['Amazonからの入金', r.payout, 't'], ['仕入れ値', -r.cost]];
    if (r.inShip) rows.push(['仕入れの送料', -r.inShip]);
    if (r.inbound) rows.push([xx.prep ? '発送代行の費用' : '納品送料・資材', -r.inbound]);
    if (xx.wh) rows.push(['発送代行(入庫・保管・撮影・出荷)', -xx.wh]);
    if (r.other - (xx.wh || 0)) rows.push(['その他', -(r.other - (xx.wh || 0))]);
    rows.push(['見込み利益(ポイント抜き)', r.profitNoPoints, 't']);
    return '<section class="it-sec" id="it-brk"><h2>利益の内訳<small>1個</small></h2>' + U.brkRows(rows) +
      '<dl class="it-st two">' + kv('損益分岐の売値', r.be ? yen(r.be) + '<i>円</i>' : '—') + kv('仕入れ値の上限', r.maxc == null ? '届かない' : yen(r.maxc) + '<i>円</i>', '目標に届く上限') + '</dl>' +
      '<p class="it-note">' + esc(r.category.label) + (xx.selfShip ? '・自己発送' : '・' + esc(r.tier ? r.tier.label.replace(/\(.*\)/, '') : '')) + 'で計算。保管手数料・返品は含みません。条件は計算ページで開いた時のものです。</p></section>';
  }

  function editHTML() {
    if (row) return '';
    var f = function (id, label, v, hint) { return '<label class="it-f"><span>' + label + (hint ? '<small>' + hint + '</small>' : '') + '</span><span class="it-in"><input id="' + id + '" type="text" inputmode="numeric" autocomplete="off" value="' + (v > 0 ? v : '') + '"><i>円</i></span></label>'; };
    return '<details class="it-sec it-edit" id="it-edit"' + (editOpen ? ' open' : '') + '><summary>数字を直す</summary><div class="it-fg">' +
      f('e-sell', 'Amazonの売値', it.sell, 'Amazonで確かめた今の価格') + f('e-cost', '仕入れ値', it.price, '税込・1個') +
      '<label class="it-f"><span>仕入れの送料<small>1個。送料込みなら0</small></span><span class="it-in"><input id="e-ship" type="text" inputmode="numeric" autocomplete="off" value="' + (it.shipSet || it.inShip > 0 ? (it.inShip || 0) : '') + '"><i>円</i></span></label></div></details>';
  }

  /** 操作。塗りのボタンは1つ(今の状態で一番大事な操作) */
  function actsHTML(st, a) {
    var acts = [], inWatch = snap && snap.from === 'w';
    var src = it.url ? { k: 'open', t: '仕入れ先を開く', href: it.url } : (it.jan || it.name ? { k: 'open', t: '楽天で探す', href: 'https://search.rakuten.co.jp/search/mall/' + encodeURIComponent(it.jan || it.name) + '/' } : null);
    var main;
    if (row) main = { k: 'ledger', t: '台帳で開く', href: U.base() + 'daicho/?focus=' + encodeURIComponent(row.id) };
    else if (st === 'ship' || st === 'cost' || st === 'sell') main = { k: 'edit', t: st === 'ship' ? '送料を入れる' : (st === 'cost' ? '仕入れ値を入れる' : '売値を入れる') };
    else if (it.bought) main = { k: 'ledger', t: '台帳で開く(記録済み)', href: U.base() + 'daicho/?focus=' + encodeURIComponent(it.bought) };
    else if (st === 'ok') {
      if (a.kind === 'order') main = { k: 'listed', t: it.listed ? '在庫番に登録しました ✓' : '在庫番に登録' };
      else if (a.kind === 'none') main = inWatch || it.watched ? { k: 'edit', t: '数字を直す' } : { k: 'watch', t: 'ウォッチに入れる' };   // 向かない品は、買う方へ押させない
      else main = src || { k: 'buy', t: '仕入れた(台帳へ)' };
    }
    else main = inWatch || it.watched ? { k: 'edit', t: '数字を直す' } : { k: 'watch', t: 'ウォッチに入れる' };   // 目標に届かない品は、買う方へ押させない
    var line = null, lnks = [];   // line = 線のボタン(お金が動いた記録)、lnks = 文字のボタン
    if (src) lnks.push(src);
    if (!row) {
      if (!it.bought) line = { k: 'buy', t: '仕入れた(台帳へ)' };
      if (!inWatch) lnks.push({ k: 'watch', t: it.watched ? 'ウォッチに入れました ✓' : 'ウォッチに入れる' });
      lnks.push({ k: 'listed', t: it.listed ? '在庫番に登録しました ✓' : '在庫番に登録' });
    }
    if (line && main.k === 'buy') line = null;
    acts = lnks.filter(function (o) { return o.k !== main.k; });
    var btn = function (o, cls) {
      return o.href ? '<a class="' + cls + '" data-act="' + o.k + '" href="' + esc(o.href) + '"' + (o.k === 'open' ? ' target="_blank" rel="noopener"' : '') + '>' + o.t + '</a>' : '<button type="button" class="' + cls + '" data-act="' + o.k + '">' + o.t + '</button>';
    };
    var code = it.asin || it.jan || '';
    return '<section class="it-acts" id="it-acts"><div class="it-main">' + btn(main, 'it-btn fill') + '</div><div class="it-sub">' +
      (line ? btn(line, 'it-btn') : '') + (acts.length ? '<div class="it-lk">' + acts.map(function (o) { return btn(o, 'it-ln'); }).join('') + '</div>' : '') + '</div>' +
      (note ? '<p class="it-msg" role="status">' + note + '</p>' : '') +
      (code ? '<p class="it-links"><a href="' + esc(U.extUrl('amazon', code)) + '" target="_blank" rel="noopener">Amazonで見る</a><a href="https://keepa.com/#!search/5-' + encodeURIComponent(code) + '" target="_blank" rel="noopener">Keepaで見る</a></p>' : '') + '</section>';
  }

  function paint() {
    var r = calc(), st = stateOf(r), s = sales(), a = advice(s);
    var meta = [esc(it.shop || ''), it.jan ? 'JAN ' + esc(it.jan) : '', it.asin ? 'ASIN ' + esc(it.asin) : '', row ? '台帳 ' + esc(row.status || '') : ''].filter(Boolean).join('<span aria-hidden="true">・</span>');
    var pre = x && fees ? '計算の前提:' + (x.selfShip ? 'FBAを使わない' : 'FBA') + (x.prep || x.wh ? '・発送代行' : '') + '・目標 ' + esc(U.targetLabel()) : '';
    body.innerHTML = '<header class="it-h">' + (it.img ? '<img class="it-img" src="' + esc(it.img) + '" alt="">' : '') + '<div><h1>' + esc(it.name || it.jan || it.asin || '(名前なし)') + '</h1><p class="it-meta">' + meta + '</p>' + (pre ? '<p class="it-pre">' + pre + '</p>' : '') + '</div></header>' +
      '<div class="it-g"><div class="it-c1">' + sumHTML(r, st) + chartHTML() + salesHTML(s) + advHTML(s) + '</div><div class="it-c2">' + brkHTML(r, st) + editHTML() + actsHTML(st, a) + '</div></div>';
    document.title = (it.name || '商品ページ') + '｜商品ページ';
    drawChart();
  }
  function drawChart() {
    var box = $('[data-chart]'), h = hist(); if (!box || !h) return;
    var cost = Number(it.price) > 0 ? Number(it.price) + (Number(it.inShip) || 0) : 0;
    box.innerHTML = chartSVG(h.nw, Math.max(280, Math.floor(box.clientWidth)), cost);
  }

  /* ---------- 操作 ---------- */
  function say(t) { note = t; paint(); }
  function openEdit(st) {
    editOpen = true; note = ''; paint();
    var el = $(st === 'ship' ? '#e-ship' : (st === 'cost' ? '#e-cost' : '#e-sell')); if (el) { el.scrollIntoView({ block: 'center' }); el.focus(); el.select(); }
  }
  function num(id) { var n = Number(String($('#' + id).value).replace(/[,，\s円]/g, '')); return isFinite(n) && n > 0 ? Math.round(n) : 0; }
  function applyEdit(e) {
    if (!e.target.closest('#it-edit input')) return;
    it.sell = num('e-sell') || null; it.price = num('e-cost');
    if ($('#e-ship').value.trim() !== '') { it.inShip = num('e-ship'); it.shipSet = true; }
    editOpen = true; note = ''; save(); paint();   // 直している間は欄を閉じない
  }
  function kpFetch() {
    var code = String(it.asin || it.jan || '').replace(/\s/g, ''); if (!code) { say('JANかASINが無いため、Keepaで取れません。'); return; }
    var prm = {}; prm[/^B0[A-Z0-9]{8}$/i.test(code) ? 'asin' : 'code'] = code.toUpperCase();
    busy = 'kp'; note = ''; paint();
    A.keepa(prm).then(function (j) {
      var pr = (j.products || [])[0]; busy = '';
      if (!pr || !pr.asin) { say('Amazonで見つかりませんでした。'); return; }
      var st = pr.stats || {}, c = st.current || [], pos = function (v) { return v > 0 ? v : null; };
      it.asin = pr.asin; it.sell = pos(c[18]) || pos(c[1]) || it.sell;
      it.kp = Object.assign({ bb: pos(c[18]), nw: pos(c[1]), avg: pos((st.avg90 || [])[1]), sold: pr.monthlySold > 0 ? pr.monthlySold : null, rank: pos(c[3]), cnt: pos(c[11]), amz: c[0] > 0, asin: pr.asin }, A.kpExtra(pr));
      A.saveHist(pr); save(); say('Keepaの値を取りました(残りトークン ' + esc(j.tokensLeft) + ')。');
    }).catch(function (err) { busy = ''; var t = String(err && err.message || err); say(/Failed to fetch|NetworkError|Load failed/i.test(t) ? 'Keepaに接続できませんでした。' : esc(t)); });
  }
  /** 検索の返事(商品の並び)から、店の数を数える。同じ店が色違い・セット違いで何件出しても1店 */
  function shopCount(list) {
    var by = {};
    (list || []).forEach(function (r) {
      var o = r && (r.Item || r); if (!o) return;
      var code = o.shopCode || o.shopId || (o.code ? String(o.code).split(':')[0] : '') || (o.itemCode ? String(o.itemCode).split(':')[0] : '') || o.shop || o.shopName || '';
      by[code || ('#' + Object.keys(by).length)] = 1;
    });
    return Object.keys(by).length;
  }
  function countShops() {
    if (!A.useQuota()) { say('無料プランの楽天の検索(1日' + A.FREE + '回)を使い切りました。明日また使えます。'); return; }
    busy = 'shops'; note = ''; paint();
    A.rakuten({ keyword: it.jan, sort: '+itemPrice', hits: '30', availability: '1' }).then(function (list) {
      busy = ''; var n = shopCount(list); it.rkShops = n; save();
      say((list.length >= 30 ? '検索の上位' + list.length + '件の中で、在庫のある店は' + n + '店' : '在庫のある店は' + n + '店') + 'でした(楽天市場・JANで検索。同じ店の複数の商品は1店と数えます)。');
    }).catch(function (err) { busy = ''; var t = String(err && err.message || err); say(/Failed to fetch|NetworkError|Load failed/i.test(t) ? '楽天に接続できませんでした。' : t); });
  }
  function buy() {
    var r = calc(), st = stateOf(r);
    if (st !== 'ok' && st !== 'ng') { openEdit(st); return; }
    var calcIn = JSON.parse(JSON.stringify(Object.assign({}, r.x, { usePoints: x.usePoints }))); if (it.code) calcIn.rkCode = it.code;
    var made = U.ledger.add({ ship: r.x.selfShip ? U.shipMode() : 'fba', cond: '新品', hinmoku: U.hinmokuFor(r.x.category), name: it.name || '(名前なし)',
      feature: [it.jan ? 'JAN ' + it.jan : '', it.asin ? 'ASIN ' + it.asin : ''].filter(Boolean).join(' '), qty: Math.max(1, Number(it.qty) || 1), unit: r.cost + r.inShip,
      party: it.shop ? (it.src === 'yahoo' ? 'Yahoo!ショッピング ' : '楽天市場 ') + it.shop : '', ref: it.url || '', sellTo: 'Amazon', sellPrice: r.sell, profit: r.profitNoPoints, pnp: true, route: '楽天・Yahoo!→Amazon', calc: calcIn });
    if (made) { it.bought = made.id; save(); say('台帳に記録しました。'); }
  }
  function watch() {
    var w = U.store.get('watch2', []); if (!Array.isArray(w)) w = [];
    var copy = JSON.parse(JSON.stringify(it)); delete copy.manual; delete copy.watched; copy.saved = U.today(); copy.base = Number(copy.price) || 0; if (!copy.name) copy.name = '(名前なし)';
    w.unshift(copy);
    if (!U.store.set('watch2', w.slice(0, 300))) { say('この端末では保存できませんでした(プライベートブラウズ等)。'); return; }
    it.watched = true; save(); say('ウォッチに入れました。<a href="' + U.base() + 'rakuten-amazon/?tab=w">ウォッチを見る</a>');
  }
  /** 「在庫番」(取り寄せ販売の品の在庫の見張り。assets/listed.js = window.SedoriListed)へ送る。
      部品を読めていない時は、端末の mz-inbox に置く(次に「在庫番」を開いた時に取り込まれる)。行の形は listed.js の決まり */
  function listed() {
    var r = calc(), L = window.SedoriListed;
    var o = { name: it.name || '', jan: it.jan || '', asin: it.asin || '', price: Number(it.sell) || 0, qty: 1, code: it.code || '', shop: it.shop || '', url: it.url || '',
      cost: Number(it.price) || 0, freeShip: it.freeShip, pt: it.shopPt || 1, calc: r && r.x ? JSON.parse(JSON.stringify(Object.assign({}, r.x, { usePoints: x.usePoints }))) : null };
    if (!o.jan && !o.asin) { say('JANかASINが無いため、登録できません。'); return; }
    var res = null;
    if (L && typeof L.send === 'function') { try { res = L.send([o], 'item'); } catch (e) { res = null; } }
    if (!res) { var box = U.store.get('mz-inbox', []); if (!Array.isArray(box)) box = []; box.push(o); if (!U.store.set('mz-inbox', box.slice(-300))) { say('この端末では保存できませんでした(プライベートブラウズ等)。'); return; } }
    if (res && res.over && !res.added && !res.updated) { say('プランの上限のため、「在庫番」に登録できませんでした。'); return; }
    it.listed = true; save();
    say('在庫番に登録しました。<a href="' + U.base() + 'zaiko-ban/">在庫番を見る</a>');
  }
  body.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return;
    var k = b.getAttribute('data-act');
    if (b.tagName === 'A') return;                       // リンクはそのまま開く
    if (k === 'edit') openEdit(stateOf(calc()));
    else if (k === 'kp') kpFetch();
    else if (k === 'shops') countShops();
    else if (k === 'buy') buy();
    else if (k === 'watch') { if (!it.watched) watch(); }
    else if (k === 'listed') { if (!it.listed) listed(); }
  });
  body.addEventListener('change', applyEdit);
  body.addEventListener('toggle', function (e) { if (e.target.id === 'it-edit') editOpen = e.target.open; }, true);
  document.addEventListener('sedori:target', function () { if (it) paint(); });
  var rz = null; window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(drawChart, 120); });

  /* ---------- 起動 ---------- */
  if (!load()) {
    body.innerHTML = '<div class="it-none-box"><h1>商品が選ばれていません</h1><p>一覧の行にある「商品ページ」を押すと、その商品がここに出ます。</p><p class="it-row"><a class="it-btn fill" href="' + U.base() + 'rakuten-amazon/">一覧を開く</a></p></div>';
  } else {
    if (snap && snap.name0 == null) { snap.name0 = it.name || ''; snap.jan0 = it.jan || ''; }
    U.loadFees().then(function (f) { fees = f; paint(); }, function () { paint(); });
  }
  window.SedoriItem = { paint: paint, state: function () { return stateOf(calc()); } };
})();
