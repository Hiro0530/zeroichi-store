/* せどり 帳簿 — サーバー(Worker の /core)へ送る欄を作る部分と、返ってきた答えに端末の名前を合わせる部分。計算はしない。
   ブラウザでは window.SedoriBooksSrv、Node では require で検算する(tests/sedori/test_books_calc.js)。
   送るのは数字・日付・印(true/false)・まとめる番号・集計の欄だけ。品名・取引相手の名前・住所・メモ・支払先の名前は送らない(2026-11-18)。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./books-core.js'), require('../../assets/seller-check.js'));
  else root.SedoriBooksSrv = factory(root.SedoriBooks, root.SedoriSellerCheck);
})(typeof self !== 'undefined' ? self : this, function (B, SC) {
  'use strict';

  /** まとめる印(文字) → 番号。同じ印は同じ番号。逆引き(番号 → 印)は keyOf */
  function toks() {
    var m = Object.create(null), rev = [], n = 0;
    function t(k) { k = String(k); if (!(k in m)) { m[k] = ++n; rev[n] = k; } return m[k]; }
    t.keyOf = function (i) { return rev[i]; };
    return t;
  }

  /** 台帳・売上・経費・設定 → サーバーへ送る形。opt.only: 'books'(売れた行と、売上に結び付いた行だけ) */
  function build(D, set, opt) {
    opt = opt || {};
    var tk = toks(), txs = SC.txTotals(D.ledger || []), used = {};
    (D.sales || []).forEach(function (x) { if (x.ledgerId) used[x.ledgerId] = 1; });
    // 仕入れ先のまとめ: 決まった店の名前はそのまま、それ以外(個人の名前など)は先頭の語を番号に置き換えて送る('N#番号')
    function pgOf(p) {
      p = String(p || '').trim(); if (!p) return '';
      return B.partyGroupKnown(p) || ('N#' + tk('g|' + B.partyGroup(p)));
    }
    var L = (D.ledger || []).filter(function (r) { return !opt.only || r.saleDate || used[r.id]; }).map(function (r) {
      var name = String(r.party || '').trim(), biz = B.isBizParty(r);
      var o = { id: r.id, date: r.date, saleDate: r.saleDate, wait: !!r.wait, qty: r.qty, unit: r.unit, salePrice: r.salePrice, sellPrice: r.sellPrice, profit: r.profit, route: r.route,
        pg: pgOf(r.party), ch: B.chOf(r.sellTo) };
      if (opt.only) return o;
      o.cond = r.cond; o.hinmoku = r.hinmoku; o.ik = tk('i|' + B.itemKey(r)); o.biz = biz; o.pn = !!name; o.pk = tk(B.partyKey(name));
      o.xk = tk('i:' + (String(r.pName || '').trim() || name || r.id));
      o.hasName = !!(String(r.name || '').trim() && !/^\(名前なし\)$/.test(r.name)); o.hasPName = !!String(r.pName || '').trim(); o.hasPAddr = !!String(r.pAddr || '').trim();
      if (r.cond === '中古' && !biz && !r.wait) o.idReq = !!SC.reason(r, txs[r.id]);
      return o;
    });
    var S = opt.skip ? [] : (D.sales || []).map(function (x) { return { id: x.id, date: x.date, kind: x.kind, ledgerId: x.ledgerId, ch: x.ch, gross: x.gross, disc: x.disc, fee: x.fee, ship: x.ship, other: x.other, withheld: x.withheld, qty: x.qty, net: x.net }; });
    var E = opt.skip ? [] : (D.expenses || []).map(function (x) {
      var name = String(x.payee || '').trim();
      var o = { id: x.id, date: x.date, amount: x.amount, biz: x.biz, acct: x.acct };
      if (!opt.only) { o.pk = tk(B.partyKey(name)); o.pn = !!name; }
      return o;
    });
    var out = { ledger: L, sales: S, expenses: E, tok: tk };
    if (set) {
      var noReg = {}; Object.keys(set.noReg || {}).forEach(function (k) { if (set.noReg[k]) noReg[tk(k)] = true; });
      out.set = { tax: set.tax, incl: set.incl, points: set.points, pointYen: set.pointYen, opening: set.opening, closing: set.closing, method: set.method, pay: set.pay, noReg: noReg, counts: set.counts || {} };
    }
    return out;
  }

  /** 売れ残りの判定に要る欄だけ(段ごとの重い印は付けない) */
  function staleRows(D) {
    return (D.ledger || []).filter(function (r) { return !r.wait && !r.saleDate && r.date; }).map(function (r) {
      return { id: r.id, date: r.date, unit: r.unit, qty: r.qty, sellPrice: r.sellPrice, profit: r.profit, ch: B.chOf(r.sellTo), hinmoku: r.hinmoku };
    });
  }
  /** 棚卸に要る欄だけ。同じ品をまとめる印は番号にして送る */
  function stockRows(D) {
    var tk = toks();
    return (D.ledger || []).map(function (r) { return { id: r.id, date: r.date, saleDate: r.saleDate, wait: !!r.wait, qty: r.qty, unit: r.unit, ik: tk('i|' + B.itemKey(r)) }; });
  }

  /** 答えの中の仕入れ先のまとめ('N#番号')を、端末の記録の先頭の語に戻す */
  function unPg(key, tk) { var m = /^N#(\d+)$/.exec(String(key)); return m ? String(tk.keyOf(+m[1])).slice(2) : key; }

  /* ---------- 名前を合わせる(端末の記録から) ---------- */
  function index(D) {
    var ix = { ledger: {}, sale: {}, expense: {} };
    (D.ledger || []).forEach(function (r) { ix.ledger[r.id] = r; });
    (D.sales || []).forEach(function (r) { ix.sale[r.id] = r; });
    (D.expenses || []).forEach(function (r) { ix.expense[r.id] = r; });
    return ix;
  }
  /** 摘要の {n} に入れる文字(記録の種類ごと) */
  function nameOf(src, ix) {
    if (!src) return '';
    if (src.type === 'ledger') { var r = ix.ledger[src.id]; return r ? (r.name || '') : ''; }
    if (src.type === 'sale') { var s = ix.sale[src.id]; return s ? (s.name || s.typeLabel || '') + (s.order ? ' ' + s.order : '') : ''; }
    if (src.type === 'expense') { var x = ix.expense[src.id]; return x ? (x.payee || '') + (x.memo ? ' ' + x.memo : '') : ''; }
    return '';
  }
  /** 摘要の型({n} 入り)に名前を入れる。trim が true なら前後の空白を除き、空なら fb。cut があればその文字数に切る(既定 60) */
  function fillMemo(tpl, meta, ix, cut) {
    var s = String(tpl).replace('{n}', function () { return nameOf(meta.src, ix); });
    if (meta.trim) s = s.trim();
    if (!s && meta.fb) s = meta.fb;
    return s.slice(0, cut == null ? 60 : cut);
  }
  /** 仕訳帳の答え → 摘要を埋めた仕訳(画面と旧 journal() の形) */
  function journalRows(entries, D) {
    var ix = index(D);
    return entries.map(function (e) { return { no: e.no, date: e.date, dr: e.dr, cr: e.cr, amt: e.amt, memo: fillMemo(e.tpl, e, ix), src: e.src, taxDr: e.taxDr, taxCr: e.taxCr }; });
  }
  /** 書き出しの答え → 摘要を埋めた rows(header とともに toCSV へ) */
  function exportFilled(out, D) {
    var ix = index(D);
    return { header: out.header, rows: out.rows.map(function (row, i) {
      var r = row.slice(), m = out.meta[i];
      var s = fillMemo(r[out.memoCol], m, ix); if (out.memoCut) s = s.slice(0, out.memoCut);
      r[out.memoCol] = s; return r;
    }) };
  }
  /** 売れた記録(books の答え)に品名を合わせる(旧 events() の name) */
  function eventNames(events, D) {
    var ix = index(D);
    return events.map(function (e) {
      var o = {}; for (var k in e) o[k] = e[k];
      if (e.src === 'import') { var s = ix.sale[e.saleId], lr = e.ledgerId ? ix.ledger[e.ledgerId] : null; o.name = (s && s.name) || (lr && lr.name) || ''; }
      else { var r = ix.ledger[e.ledgerId]; o.name = r ? (r.name || '') : ''; }
      return o;
    });
  }
  /** 売れ残りの答え / 棚卸の答え / 古物商の答え に、台帳の行 r を付ける(旧 stale()・stocktake()・kobutsuCheck() の形) */
  function withRows(rows, D, why) {
    var ix = index(D);
    return rows.map(function (x) { var o = {}; for (var k in x) o[k] = x[k]; o.r = ix.ledger[x.id]; if (why) o.why = why(o.r, x); return o; });
  }

  return { staleRows: staleRows, stockRows: stockRows, build: build, toks: toks, unPg: unPg, index: index, nameOf: nameOf, fillMemo: fillMemo, journalRows: journalRows, exportFilled: exportFilled, eventNames: eventNames, withRows: withRows };
});
