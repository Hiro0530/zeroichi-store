/* 古物台帳の追加の働き(台帳ページだけで読む):
   1) また仕入れる候補: 同じ商品を1行にまとめる、今の値での出し直し(手入力)、月ごとの見直し、もう一度仕入れた
   2) 代行へ渡す納品リストの書き出し(業務)   3) 仕入れの証拠の控えの書き出し(書類の画像は預からない)
   前半は計算だけの部品(node の試験 tests/sedori/test_ledger_plus.js が読む)。後半が画面。
   台帳の行に足す項目: repeat / calc / rpSeen / rpSkip / rpFrom / orderNo / trackNo / prepSent / docType / docName / docRef
   今の値(手入力・ほかの部品から受け取った値)は端末の rp-now にだけ置き、クラウドへ送らない */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SedoriLedgerPlus = api;
  if (root.SedoriLedgerPage) api.mount(root.SedoriLedgerPage);
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';
  var DAY = 864e5;
  function num(v) { var n = Number(String(v == null ? '' : v).replace(/[,，\s円]/g, '')); return isFinite(n) ? n : 0; }
  function half(s) { s = String(s == null ? '' : s); return s.normalize ? s.normalize('NFKC') : s; }
  function qtyOf(r) { return Math.max(1, num(r.qty) || 1); }

  /* ---------- 同じ商品の見分け(JAN → ASIN → 品名) ---------- */
  function codes(r) {
    var f = half([r.feature, r.jan ? 'JAN ' + r.jan : '', r.asin ? 'ASIN ' + r.asin : ''].join(' '));
    var j = f.match(/JAN\s*[:：]?\s*(\d{13}|\d{8})(?!\d)/i), a = f.match(/ASIN\s*[:：]?\s*(B0[A-Z0-9]{8})/i);
    return { jan: j ? j[1] : '', asin: a ? a[1].toUpperCase() : '' };
  }
  function keyOf(r) {
    var c = codes(r); if (c.jan) return 'j:' + c.jan; if (c.asin) return 'a:' + c.asin;
    var n = half(r.name).toLowerCase().replace(/\s+/g, ' ').trim();
    return n && n !== '(名前なし)' ? 'n:' + n : 'i:' + r.id;
  }
  function byNew(a, b) {
    var x = String(a.date || ''), y = String(b.date || ''); if (x !== y) return x < y ? 1 : -1;
    x = String(a.id); y = String(b.id); if (x.length !== y.length) return y.length - x.length;
    return x < y ? 1 : (x > y ? -1 : 0);
  }
  function monthOf(d) { d = d || new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }

  /** また仕入れる候補。印(repeat)の付いた行がある商品だけを、商品ごとに1つにまとめる。ym は今の月 "2026-11" */
  function groups(rows, ym) {
    var map = {}, order = [];
    (rows || []).forEach(function (r) { if (!r || !r.id) return; var k = keyOf(r); if (!map[k]) { map[k] = []; order.push(k); } map[k].push(r); });
    return order.filter(function (k) { return map[k].some(function (r) { return !!r.repeat; }); }).map(function (k) {
      var rs = map[k].slice().sort(byNew), real = rs.filter(function (r) { return !r.wait; }), last = real[0] || rs[0];
      var days = real.filter(function (r) { return r.date && r.saleDate; })
        .map(function (r) { return Math.round((Date.parse(r.saleDate) - Date.parse(r.date)) / DAY); }).filter(function (d) { return isFinite(d) && d >= 0; });
      var wc = rs.filter(function (r) { return r.calc && typeof r.calc === 'object'; })[0], c = codes(last);
      var seen = rs.some(function (r) { return r.rpSeen === ym; }), skip = rs.some(function (r) { return r.rpSkip === ym; });
      return { key: k, name: last.name || '(名前なし)', jan: c.jan, asin: c.asin, count: real.length, lastId: last.id, lastDate: last.date || '',
        lastUnit: num(last.unit), lastProfit: last.profit === '' || last.profit == null ? null : num(last.profit),
        avgDays: days.length ? Math.round(days.reduce(function (s, d) { return s + d; }, 0) / days.length * 10) / 10 : null,
        calc: wc ? wc.calc : null, sellTo: last.sellTo || '', sellPrice: num(last.sellPrice), ref: last.ref || '',
        seen: seen, skip: skip, done: seen || skip, ids: rs.map(function (r) { return r.id; }) };
    }).sort(function (a, b) { return a.done !== b.done ? (a.done ? 1 : -1) : (a.lastDate < b.lastDate ? 1 : (a.lastDate > b.lastDate ? -1 : 0)); });
  }
  function review(gs) { return { done: gs.filter(function (g) { return g.done; }).length, total: gs.length }; }

  /** 仕入れた時の条件(calc。ra.js が「仕入れた」の時に入れる、計算の部品 amazonProfit の入力そのまま)の写し */
  function calcInput(c) { var x = Object.assign({}, c || {}); x.cost = num(x.cost); x.sell = num(x.sell); return x; }
  /**
   * 今の値での利益(ポイント抜き)。仕入れた時の条件のうち、仕入れ値と売値だけ今の値に替える。
   * 返り値 state: 'nocalc'(条件が残っていない)/ 'unknown'(今の値が無い・確かめられない)/ 'ok'(目標に届く)/ 'ng'(届かない)
   */
  function nowProfit(C, fees, g, now, target) {
    if (!g.calc) return { state: 'nocalc' };
    now = now || {};
    var x = calcInput(g.calc), cost = num(now.cost), sell = num(now.sell);
    if (!(cost > 0) && !(sell > 0)) return { state: 'unknown' };
    x.cost = cost > 0 ? cost : x.cost; x.sell = sell > 0 ? sell : (x.sell || g.sellPrice); x.usePoints = false;
    if (!fees || !(x.cost > 0) || !(x.sell > 0)) return { state: 'unknown' };
    var r = C.amazonProfit(fees, x), need = C.needProfit(x.sell, target);
    return { state: r.profitNoPoints >= need ? 'ok' : 'ng', profit: r.profitNoPoints, need: need, cost: x.cost, sell: x.sell };
  }
  var JUDGE = { ok: '目標に届く', ng: '目標に届かない', unknown: '未入力', nocalc: '未入力' };

  /** 「もう一度仕入れた」で足す行(前の行を写す。仕入れ値・売値・利益は今の値があればそれ) */
  function rebuyRow(prev, today, res) {
    var o = {}, has = res && (res.state === 'ok' || res.state === 'ng');
    ['ship', 'cond', 'hinmoku', 'media', 'name', 'feature', 'party', 'ref', 'sellTo', 'route', 'recvId'].forEach(function (k) { if (prev[k] != null) o[k] = prev[k]; });
    o.date = today; o.qty = qtyOf(prev); o.status = '仕入れ済'; o.repeat = true; o.rpFrom = prev.id;
    if (prev.pnp || has) o.pnp = true;   // 見込み利益はポイント抜き
    o.unit = has ? res.cost + num((prev.calc || {}).inShip) : num(prev.unit);
    o.sellPrice = has ? res.sell : (prev.sellPrice == null ? '' : prev.sellPrice);
    o.profit = has ? res.profit : (prev.profit == null ? '' : prev.profit);
    if (prev.calc) { o.calc = JSON.parse(JSON.stringify(prev.calc)); if (has) { o.calc.cost = res.cost; o.calc.sell = res.sell; } }
    return o;
  }
  /**
   * 台帳の「見込み利益(1個)」はポイント抜きにそろえる。計算ページの「仕入れた」はポイント込みの利益を入れるので、
   * 仕入れた時の条件(calc)が残っていて、まだ直していない行(pnp が無い行)から、その時のポイントを引く。
   * 返り値: 直した行の数(rows を書き換える)。pnp=true の行は二度と引かない
   */
  function stripPoints(C, rows) {
    var n = 0;
    (rows || []).forEach(function (r) {
      if (!r || r.pnp || !r.calc || typeof r.calc !== 'object') return;
      var pt = r.calc.usePoints === false ? 0 : C.points(r.calc.cost, r.calc.pointRate);
      if (r.profit !== '' && r.profit != null && pt > 0) r.profit = num(r.profit) - pt;
      r.pnp = true; n++;
    });
    return n;
  }
  /** 今日すでに「もう一度仕入れた」で足した行(2回押しの守り) */
  function boughtToday(rows, g, today) { return (rows || []).filter(function (r) { return r.rpFrom && r.date === today && g.ids.indexOf(r.id) >= 0; })[0] || null; }

  /* ---------- 納品リスト(代行へ渡す) ---------- */
  var PREP_HEAD = ['仕入日', '仕入れ先', '注文番号', '追跡番号', '品名', 'JAN', 'ASIN', '数量', '新品/中古', '受取先・入庫ID', 'メモ'];
  var PREP_WIDTH = [11, 22, 18, 18, 38, 15, 13, 6, 9, 16, 24];
  /** 対象: 発送のしかたが発送代行かFBAで、状態が「仕入れ済」。無在庫の「仕入れ前」は入れない */
  function prepTarget(r) { return !!r && !r.wait && r.ship !== 'self' && (r.status || '仕入れ済') === '仕入れ済'; }
  function prepBody(rows) {
    return rows.filter(prepTarget).slice().sort(function (a, b) { return -byNew(a, b); }).map(function (r) {
      var c = codes(r);
      return [r.date || '', r.party || '', r.orderNo || '', r.trackNo || '', r.name || '', c.jan, c.asin, qtyOf(r), r.cond || '', r.recvId || '', r.memo || ''];
    });
  }

  /* ---------- 仕入れの証拠 ---------- */
  var DOC_TYPES = ['領収書', '請求書', '納品書', '購入履歴の画面', 'なし'];
  var PROOF_NOTE = 'Amazonが求める書類の条件は、届いた通知で確かめてください。小売店の領収書では認められないことがあります。この一覧は、手元の書類をそろえるための控えです。';
  var PROOF_HEAD = ['仕入日', '仕入れ先', '仕入れ先のURL', '注文番号', '品名', 'JAN', 'ASIN', '数量', '単価', '合計', '書類の種類', '宛名の一致', '保管場所', '売却日', '売った数'];
  var PROOF_WIDTH = [11, 22, 30, 18, 38, 15, 13, 6, 9, 10, 14, 10, 28, 11, 8];
  /** 「証拠が未入力」に数える行: 新品でAmazonに売る行のうち、注文番号・書類の種類・保管場所がどれも空 */
  function proofNeeded(r) { return !!r && !r.wait && r.cond === '新品' && r.sellTo === 'Amazon' && !r.orderNo && !r.docType && !r.docRef; }
  function proofRows(rows) { return (rows || []).filter(function (r) { return r && !r.wait; }).slice().sort(function (a, b) { return -byNew(a, b); }); }
  function proofBody(rows) {
    return proofRows(rows).map(function (r) {
      var c = codes(r), q = qtyOf(r), u = Math.round(num(r.unit));
      return [r.date || '', r.party || '', r.ref || '', r.orderNo || '', r.name || '', c.jan, c.asin, q, u, u * q, r.docType || '', r.docName || '', r.docRef || '', r.saleDate || '', r.saleDate ? q : 0];
    });
  }
  /** 今月の売却日の行の(見込み利益×数量)の合計 */
  function monthSum(rows, ym) {
    var s = 0; (rows || []).forEach(function (r) { if (r && String(r.saleDate || '').slice(0, 7) === ym && r.profit !== '' && r.profit != null) s += num(r.profit) * qtyOf(r); });
    return s;
  }
  /** 数の照らし合わせ(仕入れた数・売った数) */
  function proofTotals(rows) {
    var b = 0, s = 0; proofRows(rows).forEach(function (r) { var q = qtyOf(r); b += q; if (r.saleDate) s += q; });
    return { bought: b, sold: s, text: '仕入れた数 ' + b + '個/売った数 ' + s + '個' };
  }

  var core = { codes: codes, keyOf: keyOf, monthOf: monthOf, groups: groups, review: review, calcInput: calcInput, nowProfit: nowProfit, JUDGE: JUDGE,
    rebuyRow: rebuyRow, boughtToday: boughtToday, PREP_HEAD: PREP_HEAD, prepTarget: prepTarget, prepBody: prepBody,
    DOC_TYPES: DOC_TYPES, PROOF_NOTE: PROOF_NOTE, PROOF_HEAD: PROOF_HEAD, proofNeeded: proofNeeded, proofBody: proofBody, proofTotals: proofTotals, monthSum: monthSum, stripPoints: stripPoints };

  /* ====================== ここから画面 ====================== */
  var P = null, U, C, L, $, $$, esc, yen, fees = null, openKey = null, box = null, shown = 30, wide = null;
  function nowAll() { var v = U.store.get('rp-now', {}); return v && typeof v === 'object' ? v : {}; }
  function nowOf(key) { var n = nowAll()[key]; return n && n.ym === monthOf() ? n : {}; }
  /** 今の値を置く(手入力のほか、楽天・Keepaから取り直す部品が出来たらここへ渡す) */
  function setNow(key, v) { var a = nowAll(); a[key] = Object.assign({}, a[key] && a[key].ym === monthOf() ? a[key] : {}, v, { ym: monthOf() }); U.store.set('rp-now', a); }
  function gs() { return groups(L.all(), monthOf()); }
  function gOf(key) { return gs().filter(function (x) { return x.key === key; })[0] || null; }
  function md(s) { s = String(s || ''); return s.length >= 10 ? Number(s.slice(5, 7)) + '/' + Number(s.slice(8, 10)) : s; }
  function yenH(n) { return '<span class="yen">' + yen(n) + '<i>円</i></span>'; }
  function calcUrl(g) { return U.base() + 'rakuten-amazon/?q=' + encodeURIComponent(g.jan || g.asin || g.name); }
  function res(g) { return nowProfit(C, fees, g, nowOf(g.key), U.target()); }
  function has(r) { return r.state === 'ok' || r.state === 'ng'; }
  function codeTail(g) { var c = g.jan || g.asin; return c ? (g.jan ? 'JAN' : 'ASIN') + ' …' + c.slice(-6) : ''; }

  /** タブの題の横に出す「11月の見直し 3/12件」 */
  function reviewLabel() { var v = review(gs()); return (new Date().getMonth() + 1) + '月の見直し ' + v.done + '/' + v.total + '件'; }

  /* また仕入れる候補: 無い値は出さない。スマホ幅は1商品を3行(名前・前回・ボタン)、今の値を入れた商品だけ4行目 */
  function seenHTML(g) { return g.done ? '<span class="rp-s done">' + (g.skip && !g.seen ? '今月は見送り' : '今月は見直し済') + '</span>' : ''; }
  function nowHTML(g) {
    var r = res(g); if (!has(r)) return '';
    return '今は1個 <b class="pf ' + (r.state === 'ok' ? 'good' : (r.profit < 0 ? 'bad' : '')) + '">' + yen(r.profit) + '円</b><span class="rp-j ' + r.state + '">' + JUDGE[r.state] + '</span>';
  }
  function actsHTML(g) {
    var open = openKey === g.key;
    return '<button type="button" class="btn sm ghost" data-rp-open="' + esc(g.key) + '" aria-expanded="' + open + '">' + (open ? '閉じる' : '今の価格で出し直す') + '</button>' +
      '<button type="button" class="btn sm ghost" data-rp-buy="' + esc(g.key) + '">もう一度仕入れた</button>';
  }
  /** スマホ幅の1商品の上の段 */
  function cardHead(g) {
    var now = nowHTML(g), tail = codeTail(g);
    return '<div class="rp-h"><p class="nm">' + esc(g.name) + '</p>' +
      '<p class="rp-p">前回 ' + esc(md(g.lastDate) || '—') + ' に ' + yen(g.lastUnit) + '円で仕入れ' + (g.lastProfit == null ? '' : '・見込み利益 1個 ' + yen(g.lastProfit) + '円') +
      (g.avgDays == null ? '' : '・売れるまで平均' + g.avgDays + '日') + '・仕入れ' + g.count + '回' + (tail ? '<small>' + esc(tail) + '</small>' : '') + seenHTML(g) + '</p>' +
      (now ? '<p class="rp-now">' + now + '</p>' : '') + '<div class="rp-a">' + actsHTML(g) + '</div></div>';
  }
  /** PC幅の1行 */
  function rowHead(g) {
    var r = res(g), tail = codeTail(g);
    return '<tr data-key="' + esc(g.key) + '"' + (openKey === g.key ? ' class="open"' : '') + '>' +
      '<td class="rp-n"><div class="nm">' + esc(g.name) + '</div>' + (tail ? '<div class="meta">' + esc(tail) + '</div>' : '') + '</td>' +
      '<td class="r">' + g.count + '回</td><td class="nw">' + esc(md(g.lastDate) || '—') + '</td><td class="r">' + yenH(g.lastUnit) + '</td>' +
      '<td class="r">' + (g.lastProfit == null ? '—' : yenH(g.lastProfit)) + '</td><td class="r">' + (g.avgDays == null ? '—' : g.avgDays + '日') + '</td>' +
      '<td class="rp-m">' + (has(r) ? nowHTML(g) + '<div class="meta">仕入れ値 ' + yen(r.cost) + '円・売値 ' + yen(r.sell) + '円</div>' : '') + '</td>' +
      '<td>' + (seenHTML(g) || '<span class="rp-s">まだ</span>') + '</td><td class="rp-a">' + actsHTML(g) + '</td></tr>';
  }
  function panelHTML(g) {
    var n = nowOf(g.key), x = calcInput(g.calc);
    var main = g.calc ? '<div class="rp-f"><label>今の仕入れ値(1個)<input type="number" inputmode="numeric" min="0" data-rp-in="cost" value="' + esc(n.cost || '') + '" placeholder="前回 ' + yen(x.cost) + '"></label>' +
      '<label>今のAmazon売値<input type="number" inputmode="numeric" min="0" data-rp-in="sell" value="' + esc(n.sell || '') + '" placeholder="前回 ' + yen(x.sell || g.sellPrice) + '"></label>' +
      '<p class="rp-o" id="rp-out" aria-live="polite">' + outHTML(g) + '</p></div>' +
      '<p class="hint">仕入れた時の条件(カテゴリー・サイズ・納品の費用・送料)はそのままで、仕入れ値と売値だけ今の値に替えて計算します。片方だけ入れた時は、もう片方は前回の値を使います。今の利益はポイント抜きで、その値段で売れることを示すものではありません。</p>'
      : '<p class="rp-o">この品には、仕入れた時の計算の条件が残っていません。計算ページで同じ品を開いて確かめてください。</p>';
    var links = ['<a href="' + esc(calcUrl(g)) + '" data-rp-calc="' + esc(g.key) + '">計算ページで開く</a>', g.ref ? '<a href="' + esc(g.ref) + '" target="_blank" rel="noopener">仕入れ先を開く</a>' : '',
      g.done ? '' : '<button type="button" class="lnk" data-rp-skip="' + esc(g.key) + '">今月は見送る</button>',
      '<button type="button" class="lnk" data-rp-off="' + esc(g.key) + '">候補から外す</button>'].filter(Boolean).join('');
    return '<div class="rp-pn">' + main + '<div class="rp-l">' + links + '</div></div>';
  }
  function outHTML(g) {
    var r = res(g);
    if (!has(r)) return '今の仕入れ値か売値を入れると、今の利益が出ます。';
    return '今の利益 <b>' + yen(r.profit) + '円</b>(ポイント抜き)。目標の' + esc(U.targetLabel()) + '(' + yen(r.need) + '円)に' + (r.state === 'ok' ? '届きます。' : '届きません。');
  }
  function listHTML() {
    var all = gs(), list = all.slice(0, shown), rest = all.length - list.length;
    if (!all.length) return '<div class="rp-empty"><p>また仕入れる印を付けた品はまだありません。<br>台帳の行の「また仕入れる印を付ける」を押すと、ここに商品ごとにまとまって並びます。</p><button type="button" class="btn ghost" data-rp-back>台帳へ戻る</button></div>';
    var body = wide
      ? '<div class="gridwrap"><table class="grid rp"><thead><tr><th>品名</th><th class="r">回数</th><th>前回の仕入日</th><th class="r">前回の仕入れ値</th><th class="r">見込み利益(1個)</th><th class="r">売れるまで</th><th>今の見立て</th><th>今月の見直し</th><th></th></tr></thead><tbody>' +
        list.map(function (g) { return rowHead(g) + (openKey === g.key ? '<tr class="rp-ed"><td colspan="9">' + panelHTML(g) + '</td></tr>' : ''); }).join('') + '</tbody></table></div>'
      : '<ul class="rp-cards">' + list.map(function (g) { return '<li data-key="' + esc(g.key) + '"' + (openKey === g.key ? ' class="open"' : '') + '>' + cardHead(g) + (openKey === g.key ? panelHTML(g) : '') + '</li>'; }).join('') + '</ul>';
    return body + (rest > 0 ? '<button type="button" class="btn ghost lp-more" data-rp-more>次の' + Math.min(30, rest) + '件を見る(残り' + rest + '件)</button>' : '') +
      '<p class="hint">同じJAN(無ければASIN、品名)の行を1つにまとめています。売れるまでの日数は、この台帳の仕入日と売却日から出した平均です。見直しは月が替わると「まだ」に戻ります。</p>';
  }
  /** 題の下の1行: 月の固定費まであといくらか(今月の売却日の行の 見込み利益×数量 の合計と比べる)。固定費が未入力の時は入口だけ */
  function fixedLine() {
    var el = $('#slot-lg-top'); if (!el || !U.fixedIsSet) return;
    if (!U.fixedIsSet()) { el.innerHTML = '<p class="lp-fix"><small><button type="button" class="lnk" data-fix-open>月の固定費を入れる</button>と、固定費まであといくらかが出ます。</small></p>'; return; }
    if (!fees) { el.innerHTML = ''; return; }
    var m = monthSum(L.all(), monthOf()), F = U.fixedTotal(fees), d = m - F;
    el.innerHTML = '<p class="lp-fix">' + (d >= 0 ? '固定費を <b>' + yen(d) + '円</b> 上回っています' : '固定費まで あと <b>' + yen(-d) + '円</b>') +
      '<small>今月の見込み利益 ' + yen(m) + '円(ポイントは含めていません)/月の固定費 ' + yen(F) + '円　<button type="button" class="lnk" data-fix-open>固定費を直す</button></small></p>';
  }
  /** 台帳の描き直しのたびに呼ばれる。「また仕入れる」タブでは候補の一覧を出す */
  function paint(tab) {
    if (!box) return;
    if (tab !== 'repeat') { openKey = null; shown = 30; }
    wide = !U.narrow();
    box.innerHTML = tab === 'repeat' ? listHTML() : (document.getElementById('lp-out') ? '' : '<div class="lp-bar"><button type="button" class="btn sm ghost" data-lp-out>書き出す</button></div>');
    fixedLine();
  }
  function redraw() { P.render(); }
  function markSeen(g) { if (!g.seen) L.update(g.lastId, { rpSeen: monthOf() }); }

  function onClick(e) {
    var t = e.target.closest ? e.target.closest('[data-rp-open],[data-rp-skip],[data-rp-off],[data-rp-buy],[data-rp-back],[data-rp-calc],[data-rp-more],[data-lp-out]') : null;
    if (!t) return;
    var key = t.getAttribute('data-rp-open') || t.getAttribute('data-rp-skip') || t.getAttribute('data-rp-off') || t.getAttribute('data-rp-buy') || t.getAttribute('data-rp-calc');
    var g = key ? gOf(key) : null;
    if (t.hasAttribute('data-lp-out')) { outMenu(); return; }
    if (t.hasAttribute('data-rp-more')) { shown += 30; redraw(); return; }
    if (t.hasAttribute('data-rp-back')) { P.setTab('all'); return; }
    if (!g) return;
    if (t.hasAttribute('data-rp-calc')) { markSeen(g); return; }   // 計算ページで確かめる = 今月の見直し
    if (t.hasAttribute('data-rp-open')) {
      openKey = openKey === key ? null : key; redraw();
      var inp = openKey && box.querySelector('[data-rp-in="cost"]'); if (inp) inp.focus({ preventScroll: true });
    } else if (t.hasAttribute('data-rp-skip')) {
      L.update(g.lastId, { rpSkip: monthOf() }); openKey = null; redraw();
      U.toast('今月は見送りにしました', '元に戻す', function () { L.update(g.lastId, { rpSkip: '' }); redraw(); });
    } else if (t.hasAttribute('data-rp-off')) {
      var before = L.all(); setRepeat(g.ids, false); openKey = null; redraw();
      U.toast('また仕入れる候補から外しました', '元に戻す', function () { L.save(before); redraw(); });
    } else if (t.hasAttribute('data-rp-buy')) buy(g, false);
  }
  function onInput(e) {
    var el = e.target; if (!el.getAttribute || !el.getAttribute('data-rp-in') || !openKey) return;
    var v = {}; v[el.getAttribute('data-rp-in')] = num(el.value) || '';
    setNow(openKey, v);
    var g = gOf(openKey); if (!g) return;
    if (has(res(g))) markSeen(g);
    // 入力欄はそのままにして、上の段と結果だけ書き直す
    var g2 = gOf(openKey), old = box.querySelector(wide ? 'tr.open' : 'li.open .rp-h'), tmp = document.createElement(wide ? 'tbody' : 'div');
    tmp.innerHTML = wide ? rowHead(g2) : cardHead(g2);
    if (old) old.replaceWith(tmp.firstChild);
    var out = box.querySelector('#rp-out'); if (out) out.innerHTML = outHTML(g2);
    if (P.title) P.title();
  }
  function setRepeat(ids, on) {
    var rows = L.all(); rows.forEach(function (r) { if (ids.indexOf(r.id) >= 0 && (on || r.repeat)) r.repeat = on; }); L.save(rows);
  }
  /** 台帳の行の「また仕入れる印」を付け外しする。外す時は同じ商品の行の印をすべて外す */
  function toggle(id) {
    var r = L.get(id); if (!r) return false;
    var k = keyOf(r), same = L.all().filter(function (x) { return keyOf(x) === k; });
    var on = !same.some(function (x) { return x.repeat; });
    if (on) L.update(id, { repeat: true }); else setRepeat(same.map(function (x) { return x.id; }), false);
    return on;
  }
  function marked(r) { var k = keyOf(r); return !!r.repeat || L.all().some(function (x) { return x.repeat && keyOf(x) === k; }); }
  function buy(g, force) {
    var today = U.today();
    if (!force && boughtToday(L.all(), g, today)) { U.toast('今日の分は台帳に記録済みです', 'もう1件記録する', function () { buy(g, true); }); return; }
    var prev = L.get(g.lastId); if (!prev) return;
    var row = L.add(rebuyRow(prev, today, res(g)), true); if (!row) return;
    markSeen(gOf(g.key) || g); redraw();
    U.toast('台帳に1行足しました(' + md(today) + '・' + row.qty + '個・' + yen(row.unit) + '円)', '元に戻す', function () { L.remove(row.id); redraw(); });
  }

  /* ---------- 書き出し(入口は「書き出す」1つ。確かめの画面の塗りのボタンは1つ) ---------- */
  var GO = '<button type="button" class="btn" data-out="xlsx">Excelで書き出す</button><button type="button" class="btn ghost" data-out="csv">CSVで書き出す</button>';
  function dialog(title, body, foot, onOut) {
    var d = document.getElementById('lp-dlg'); if (d) d.remove();
    d = document.createElement('dialog'); d.id = 'lp-dlg'; d.className = 'dlg lp-dlg';
    d.innerHTML = '<div class="dlg-in"><div class="dlg-h"><h2>' + esc(title) + '</h2><button type="button" class="dlg-x" data-x aria-label="閉じる">×</button></div>' + body +
      '<div class="lp-go">' + foot + '<button type="button" class="lnk lp-no" data-x>やめる</button></div></div>';
    document.body.appendChild(d);
    d.addEventListener('click', function (e) {
      if (e.target === d || e.target.closest('[data-x]')) { close(); return; }
      var o = e.target.closest('[data-out]'); if (o && onOut(o.getAttribute('data-out'), d) !== false) close();
    });
    d.addEventListener('close', function () { d.remove(); });
    function close() { if (d.close && d.open) d.close(); d.remove(); }
    if (d.showModal) d.showModal(); else d.setAttribute('open', '');
    return d;
  }
  function outMenu() {
    var item = function (k, t, s) { return '<button type="button" class="btn ghost" data-out="' + k + '"><b>' + t + '</b><small>' + s + '</small></button>'; };
    dialog('書き出す', '<p class="dlg-lead">いま台帳に出ている行(' + esc(P.scope()) + ')を書き出します。</p>',
      item('xlsx', '古物台帳をExcelで', '古物台帳の項目の順') + item('csv', '古物台帳をCSVで', '古物台帳の項目の順') +
      item('prep', '納品リスト', '発送代行へ渡す一覧(業務プラン)') + item('proof', '仕入れの証拠の控え', '注文番号・書類の種類・保管場所'),
      function (k) {
        var l = P.rows();
        if (k === 'prep') setTimeout(prepDialog, 0); else if (k === 'proof') setTimeout(proofDialog, 0);
        else if (!l.length) U.toast('書き出す行がありません'); else if (k === 'csv') U.exportCSV(l); else U.exportXLSX(l);
      }).classList.add('lp-menu');
  }
  function out(kind, name, title, head, body, widths, nums) {
    var rows = [[title], head].concat(body);
    if (kind === 'csv') U.download(name + '.csv', C.toCSV(rows[0], rows.slice(1)));
    else U.download(name + '.xlsx', U.xlsx(rows, { widths: widths, nums: nums, headerRow: 1, titleRow: 0 }));
  }
  function prepDialog() {
    var SA = root.SedoriAccount, tier = U.tier ? U.tier() : (SA && SA.tier ? SA.tier() : 'free');
    if (tier !== 'business') { U.toast('納品リストの書き出しは業務プランで使えます(14日間の無料期間中も使えます)', '業務プランを見る', function () { location.href = U.base() + 'plans/?plan=business_month&from=prep'; }); return; }
    var list = P.rows().filter(prepTarget).slice().sort(function (a, b) { return -byNew(a, b); });
    if (!list.length) { U.toast('納品リストに入る行がありません(発送代行かFBAで、状態が「仕入れ済」の行が対象です)'); return; }
    var li = function (r) {
      return '<li><label><input type="checkbox" data-id="' + esc(r.id) + '"' + (r.prepSent ? '' : ' checked') + '><span><b>' + esc(r.name || '(名前なし)') + '</b><span>' + qtyOf(r) + '個・' + esc(md(r.date)) + '仕入れ' +
        (r.prepSent ? '・' + esc(md(r.prepSent)) + 'に連絡済' : '') + '</span><small>注文番号 ' + esc(r.orderNo || '未入力') + '</small></span></label></li>';
    };
    var fresh = list.filter(function (r) { return !r.prepSent; }), sent = list.filter(function (r) { return r.prepSent; });
    var body = '<p class="dlg-lead">発送代行かFBAで、状態が「仕入れ済」の行です。渡さない行は印を外してください。状態は進めません。</p><ul class="lp-list">' + fresh.map(li).join('') +
      (sent.length ? '<li class="lp-sep">前に渡した行(もう一度渡す時だけ印を付ける)</li>' + sent.map(li).join('') : '') + '</ul>';
    dialog('納品リスト', body, GO, function (kind, d) {
      var ids = $$('input[data-id]', d).filter(function (c) { return c.checked; }).map(function (c) { return c.getAttribute('data-id'); });
      if (!ids.length) { U.toast('書き出す行に印を付けてください'); return false; }
      var pick = list.filter(function (r) { return ids.indexOf(r.id) >= 0; }), before = L.all(), today = U.today();
      out(kind, 'nouhin-list_' + today, '納品リスト(' + today + ' 書き出し・' + pick.length + '件)', PREP_HEAD, prepBody(pick), PREP_WIDTH, { 7: 1 });
      var rows = L.all(); rows.forEach(function (r) { if (ids.indexOf(r.id) >= 0) r.prepSent = today; }); L.save(rows); redraw();
      U.toast(pick.length + '件を書き出し、「発送代行へ連絡済 ' + md(today) + '」と記録しました', '記録を戻す', function () { L.save(before); redraw(); });
    });
  }
  function proofDialog() {
    var list = P.rows().filter(function (r) { return !r.wait; });
    if (!list.length) { U.toast('書き出す行がありません'); return; }
    var t = proofTotals(list), sc = P.scope();
    var body = '<p class="dlg-lead">いま台帳に出ている ' + list.length + '件(' + esc(sc) + ')を書き出します。品を絞る時は、上の検索欄にJANかASINを入れてください。</p>' +
      '<p class="lp-tot">この範囲で' + esc(t.text) + '</p><p class="hint">' + esc(PROOF_NOTE) + '書類の画像は預かりません。保管場所の欄の文字を出します。古物用の取引相手の住所・電話は入りません。</p>';
    dialog('仕入れの証拠の控え', body, GO, function (kind) {
      // 注意書きは題の行に入れる(末尾に置くと、Excelの絞り込みの範囲に入ってしまう)
      var today = U.today();
      out(kind, 'shiire-shouko_' + today, '仕入れの証拠の控え(' + today + ' 書き出し・' + list.length + '件・' + sc + ')　' + t.text + '　※' + PROOF_NOTE, PROOF_HEAD, proofBody(list), PROOF_WIDTH, { 7: 1, 8: 1, 9: 1, 14: 1 });
    });
  }

  /** 台帳ページ(ledger.js)から呼ばれる。page: { render, rows, setTab, scope, title, tab } */
  function mount(page) {
    if (P || !root.SedoriUI || typeof document === 'undefined') return;
    P = page; U = root.SedoriUI; C = root.SedoriCalc; L = U.ledger; $ = U.$; $$ = U.$$; esc = U.esc; yen = U.yen;
    box = $('#lg-plus') || $('#lg-form-box'); if (!box) return;
    box.addEventListener('click', onClick); box.addEventListener('input', onInput);
    // 書き出しの入口を1つにまとめる(題の右。今ある CSV・Excel のボタンはしまう)
    var act = $('#slot-lg-act'), foot = $('#slot-lg-foot');
    if (act) {
      act.innerHTML = '<button type="button" class="btn sm ghost" id="lp-out">書き出す</button>';
      $('#lp-out').addEventListener('click', outMenu);
      ['#lg-csv', '#lg-xlsx'].forEach(function (s) { var b = $(s); if (b) b.hidden = true; });
    }
    var all0 = L.all(); if (stripPoints(C, all0)) L.save(all0);   // 見込み利益をポイント抜きにそろえる(1行につき1回だけ)
    if (foot) foot.innerHTML = '<p class="hint">見込み利益(1個)と「固定費まで」に、ポイントは含めていません。</p><p class="hint">仕入れの証拠: ' + esc(PROOF_NOTE) + '書類の画像は預かりません。</p>';
    document.addEventListener('sedori:fixed', fixedLine);
    document.addEventListener('sedori:target', function () { if (P.tab() === 'repeat') redraw(); });
    if (root.matchMedia) { var mq = root.matchMedia('(max-width:860px)'), ch = function () { if (P.tab() === 'repeat' && wide === U.narrow()) redraw(); }; if (mq.addEventListener) mq.addEventListener('change', ch); else if (mq.addListener) mq.addListener(ch); }
    U.loadFees().then(function (f) { fees = f; if (P.tab() === 'repeat') redraw(); else fixedLine(); }).catch(function () { /* 手数料が読めない時は、今の見立てを出さないまま */ });
    redraw();
  }

  return { core: core, mount: mount, paint: paint, toggle: toggle, marked: marked, reviewLabel: reviewLabel, setNow: setNow,
    on: function () { return !!box; }, count: function () { return gs().length; }, repeatIds: function () { var o = {}; gs().forEach(function (g) { g.ids.forEach(function (id) { o[id] = 1; }); }); return o; } };
});
