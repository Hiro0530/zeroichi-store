/* 仮想通貨(暗号資産)の年間損益計算 ― 計算の中身
 *
 * 出典: 国税庁「暗号資産に関する税務上の取扱いについて(FAQ)」
 *   FAQ 1-3  暗号資産同士の交換(本ツールでは円建ての売買だけを計算する。下記「計算しないもの」参照)
 *   FAQ 1-5  購入時の手数料は取得価額に含める
 *   FAQ 2-4  総平均法・移動平均法による譲渡原価の計算(計算例あり。test_calc.js で同じ数字を確認している)
 *
 * ■ 総平均法(暦年ごと・銘柄ごと)
 *   1単位当たりの取得価額
 *     = (年初に持っていた暗号資産の評価額 + その年に取得した暗号資産の取得価額の合計)
 *       ÷ (年初の保有数量 + その年に取得した数量)
 *   譲渡原価     = 1単位当たりの取得価額 × その年に手放した数量
 *   年末の評価額 = 1単位当たりの取得価額 × 年末の保有数量(これが翌年の「年初の評価額」になる)
 *   ※ FAQ 2-4 の「(年初評価額 + 年中取得額) − 年末評価額」と同じ値になる。
 *
 * ■ 移動平均法(取引の順に、銘柄ごと)
 *   取得のたびに
 *     平均単価 = (取得直前の帳簿価額 + 今回の取得価額) ÷ (取得直前の保有数量 + 今回の取得数量)
 *   手放すときの譲渡原価 = その時点の平均単価 × 手放した数量(帳簿価額から差し引く)
 *   年末の平均単価 = 12月31日に最も近い日の平均単価。年をまたいでそのまま引き継ぐ。
 *
 * ■ 所得(雑所得)= 売却額 − 譲渡原価 − 売却時の手数料
 *
 * ■ 手数料の扱い
 *   円で払った手数料
 *     購入時: 取得価額に加える(FAQ 1-5)
 *     売却時: 必要経費として所得から差し引く
 *   暗号資産で払った手数料(数量で差し引かれる場合)
 *     購入時: 受け取った数量 = 約定数量 − 手数料数量。取得価額は支払った円の額のまま。
 *     売却時: 手数料分の暗号資産も手放したものとする。
 *             手放した数量 = 約定数量 + 手数料数量
 *             手数料分は時価(約定単価 × 手数料数量)で手放し、同じ額を手数料として払ったものとして扱う。
 *             つまり 売却額 = 約定金額 + 手数料の円換算、手数料 = 手数料の円換算。
 *
 * ■ 端数
 *   計算の途中は端数を丸めない。画面では円未満を四捨五入して表示する。
 *
 * ■ 計算しないもの(呼び出し側で除外し、利用者に一覧で見せる)
 *   入出金・送金、受け取り(ステーキング・エアドロップ等)、暗号資産同士の交換、証拠金(レバレッジ)取引。
 */
(function (root) {
  'use strict';

  var EPS = 1e-10;

  function blankStats() {
    return { proceeds: 0, cost: 0, fee: 0, income: 0, boughtQty: 0, soldQty: 0, endQty: 0, endUnit: 0, endValue: 0 };
  }

  function cmpTx(a, b) {
    if (a.t < b.t) return -1;
    if (a.t > b.t) return 1;
    return (a.seq || 0) - (b.seq || 0);
  }

  /* 1件の取引を「数量・円の額」にならす
   *   tx = { t:'YYYY-MM-DD HH:MM:SS', asset:'BTC', side:'buy'|'sell', qty, jpy, feeJpy, feeQty }
   *   jpy は手数料を含まない約定金額(円)。 */
  function legs(tx) {
    var qty = Math.abs(tx.qty);
    var jpy = Math.abs(tx.jpy);
    var feeJpy = Math.abs(tx.feeJpy || 0);
    var feeQty = Math.abs(tx.feeQty || 0);
    var unitPrice = qty > 0 ? jpy / qty : 0;
    if (tx.side === 'buy') {
      return { inQty: qty - feeQty, inCost: jpy + feeJpy };
    }
    var feeQtyJpy = feeQty * unitPrice;
    return { outQty: qty + feeQty, proceeds: jpy + feeQtyJpy, fee: feeJpy + feeQtyJpy };
  }

  function round2(x) { return Math.abs(x) < EPS ? 0 : x; }

  /* 計算の本体
   *   opening: 最初の年の年初に持っていた分(任意)
   *     { BTC: { qty: 1.2, value: 3000000 } } のように渡す(価額は総平均法・移動平均法で共通)
   *   返り値: { years: [2024, 2025], byYear: { 2024: { assets: { BTC: { average:{...}, moving:{...} } },
   *            total: { average:{...}, moving:{...} } } }, warnings: [...] } */
  function calculate(txs, opening) {
    opening = opening || {};
    var list = txs.filter(function (tx) {
      return tx && (tx.side === 'buy' || tx.side === 'sell') && tx.asset && tx.t && Math.abs(tx.qty) > 0;
    }).map(function (tx, i) {
      var c = Object.assign({}, tx);
      if (c.seq == null) c.seq = i;
      c.year = parseInt(c.t.slice(0, 4), 10);
      return c;
    }).sort(cmpTx);

    var warnings = [];
    var yearsSet = {};
    list.forEach(function (tx) { yearsSet[tx.year] = true; });
    var yrs = Object.keys(yearsSet).map(Number).sort(function (a, b) { return a - b; });
    if (!yrs.length) return { years: [], byYear: {}, warnings: warnings };
    var years = [];
    for (var y = yrs[0]; y <= yrs[yrs.length - 1]; y++) years.push(y);

    var assets = {};
    list.forEach(function (tx) { assets[tx.asset] = true; });
    Object.keys(opening).forEach(function (a) { assets[a] = true; });
    var assetNames = Object.keys(assets).sort();

    // 移動平均法の状態(年をまたいで続く)
    var mv = {};
    // 総平均法の年初の状態
    var av = {};
    assetNames.forEach(function (a) {
      var o = opening[a] || { qty: 0, value: 0 };
      mv[a] = { qty: +o.qty || 0, book: +o.value || 0 };
      av[a] = { qty: +o.qty || 0, value: +o.value || 0 };
    });

    var byYear = {};
    years.forEach(function (year) {
      var yearTx = list.filter(function (tx) { return tx.year === year; });
      var res = { assets: {}, total: { average: blankStats(), moving: blankStats() } };

      assetNames.forEach(function (a) {
        var txA = yearTx.filter(function (tx) { return tx.asset === a; });
        var A = blankStats();
        var M = blankStats();

        // ---- 移動平均法: 取引の順に処理 ----
        var s = mv[a];
        var oversold = false;
        txA.forEach(function (tx) {
          var l = legs(tx);
          if (tx.side === 'buy') {
            s.qty += l.inQty;
            s.book += l.inCost;
            M.boughtQty += l.inQty;
          } else {
            var unit = s.qty > EPS ? s.book / s.qty : 0;
            var out = l.outQty;
            var covered = Math.min(out, Math.max(s.qty, 0));
            if (out > s.qty + EPS) oversold = true;
            var cost = unit * covered;
            s.book -= cost;
            s.qty -= out;
            if (s.qty < EPS) { s.qty = Math.max(s.qty, 0); if (s.qty === 0) s.book = 0; }
            M.proceeds += l.proceeds;
            M.cost += cost;
            M.fee += l.fee;
            M.soldQty += out;
          }
        });
        M.income = M.proceeds - M.cost - M.fee;
        M.endQty = round2(s.qty);
        M.endUnit = s.qty > EPS ? s.book / s.qty : 0;
        M.endValue = round2(s.book);

        // ---- 総平均法: 1年分をまとめて処理 ----
        var o = av[a];
        var inQty = 0, inCost = 0, outQty = 0, proceeds = 0, fee = 0;
        var run = o.qty;
        txA.forEach(function (tx) {
          var l = legs(tx);
          if (tx.side === 'buy') { inQty += l.inQty; inCost += l.inCost; run += l.inQty; }
          else {
            outQty += l.outQty; proceeds += l.proceeds; fee += l.fee; run -= l.outQty;
            if (run < -EPS) oversold = true;
          }
        });
        var denom = o.qty + inQty;
        var unitA = denom > EPS ? (o.value + inCost) / denom : 0;
        var soldCovered = Math.min(outQty, Math.max(denom, 0));
        A.proceeds = proceeds;
        A.cost = unitA * soldCovered;
        A.fee = fee;
        A.income = A.proceeds - A.cost - A.fee;
        A.boughtQty = inQty;
        A.soldQty = outQty;
        A.endQty = round2(Math.max(denom - outQty, 0));
        A.endUnit = A.endQty > EPS ? unitA : 0;
        A.endValue = round2(A.endUnit * A.endQty);
        av[a] = { qty: A.endQty, value: A.endValue };

        if (oversold) {
          warnings.push({ year: year, asset: a, code: 'oversold',
            text: year + '年の' + a + 'で、持っている数量より多く売った記録があります。前の年の取引履歴や、ほかの取引所の履歴が足りない可能性があります。足りない分の取得原価は0円で計算しています。' });
        }

        var hasAny = txA.length > 0 || A.endQty > EPS || M.endQty > EPS;
        if (!hasAny) return;
        res.assets[a] = { average: A, moving: M, trades: txA.length };
        ['proceeds', 'cost', 'fee', 'income'].forEach(function (k) {
          res.total.average[k] += A[k];
          res.total.moving[k] += M[k];
        });
      });
      byYear[year] = res;
    });

    return { years: years, byYear: byYear, warnings: warnings };
  }

  var api = { calculate: calculate, legs: legs };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TaxCalc = api;
})(typeof self !== 'undefined' ? self : this);
