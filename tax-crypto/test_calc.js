/* 仮想通貨の年間損益計算のテスト
 * 実行: node tax-crypto/test_calc.js
 * どの例も手で計算できる大きさにしてある。期待値の根拠は各テストのコメントに書いた。 */
'use strict';
var path = require('path');
var calc = require(path.join(__dirname, 'assets', 'calc.js'));
var csv = require(path.join(__dirname, 'assets', 'csv.js'));

var pass = 0, fail = 0;
function near(a, b, tol) { return Math.abs(a - b) <= (tol == null ? 1e-6 : tol); }
function check(name, actual, expected, tol) {
  var ok = typeof expected === 'number' ? near(actual, expected, tol) : JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; } else { fail++; console.log('× ' + name + '\n   期待: ' + JSON.stringify(expected) + '\n   結果: ' + JSON.stringify(actual)); }
}
function T(t, side, qty, jpy, feeJpy, feeQty, asset) {
  return { t: t, asset: asset || 'BTC', side: side, qty: qty, jpy: jpy, feeJpy: feeJpy || 0, feeQty: feeQty || 0 };
}

/* ---- 例1: 国税庁FAQ 2-4 の計算例そのまま(年初の保有なし) ----
 * 3/1 買 4BTC 1,845,000円 / 6/20 買 2BTC 1,650,000円 / 7/10 売 2BTC 2,400,000円
 * 9/15 買 0.5BTC 542,800円 / 11/30 売 3BTC 2,895,000円
 * 総平均法: 4,037,800 ÷ 6.5 = 621,200円/BTC、譲渡原価 621,200 × 5 = 3,106,000円
 * 移動平均法: 461,250 → 582,500 → 638,400円/BTC、譲渡原価 3,080,200円
 * 売却額 2,400,000 + 2,895,000 = 5,295,000円 */
(function () {
  var r = calc.calculate([
    T('2024-03-01 10:00:00', 'buy', 4, 1845000),
    T('2024-06-20 10:00:00', 'buy', 2, 1650000),
    T('2024-07-10 10:00:00', 'sell', 2, 2400000),
    T('2024-09-15 10:00:00', 'buy', 0.5, 542800),
    T('2024-11-30 10:00:00', 'sell', 3, 2895000)
  ]);
  var b = r.byYear[2024].assets.BTC;
  check('例1 総平均法 売却額', b.average.proceeds, 5295000);
  check('例1 総平均法 譲渡原価', b.average.cost, 3106000);
  check('例1 総平均法 所得', b.average.income, 2189000);
  check('例1 総平均法 年末単価', b.average.endUnit, 621200);
  check('例1 総平均法 年末評価額', b.average.endValue, 931800);
  check('例1 移動平均法 譲渡原価', b.moving.cost, 3080200);
  check('例1 移動平均法 所得', b.moving.income, 2214800);
  check('例1 移動平均法 年末単価', b.moving.endUnit, 638400);
  check('例1 移動平均法 年末評価額', b.moving.endValue, 957600);
  check('例1 年末数量', b.average.endQty, 1.5);
  check('例1 警告なし', r.warnings.length, 0);
})();

/* ---- 例2: 円で払った手数料(国税庁FAQ 1-5 の数字を使う) ----
 * 買 2BTC 2,000,000円 手数料550円 → 取得価額 2,000,550円(1BTC 1,000,275円)
 * 売 1BTC 1,200,000円 手数料500円
 * 所得 = 1,200,000 − 1,000,275 − 500 = 199,225円(総平均法・移動平均法とも同じ) */
(function () {
  var r = calc.calculate([
    T('2025-02-01 09:00:00', 'buy', 2, 2000000, 550),
    T('2025-05-01 09:00:00', 'sell', 1, 1200000, 500)
  ]);
  var b = r.byYear[2025].assets.BTC;
  check('例2 総平均法 譲渡原価', b.average.cost, 1000275);
  check('例2 総平均法 手数料', b.average.fee, 500);
  check('例2 総平均法 所得', b.average.income, 199225);
  check('例2 移動平均法 所得', b.moving.income, 199225);
  check('例2 年末評価額', b.average.endValue, 1000275);
})();

/* ---- 例3: 年をまたぐ繰越し(総平均法と移動平均法で結果が分かれる例) ----
 * 2024: 買 1 を100円、買 1 を300円 → 単価200円。売 1 を250円 → 所得50円(両方)。年末 1単位・評価額200円
 * 2025: 先に 売 1 を450円、そのあと 買 2 を1,000円
 *   総平均法: 単価 = (200 + 1,000) ÷ (1 + 2) = 400円 → 譲渡原価400円、所得50円、年末 2単位 × 400 = 800円
 *   移動平均法: 売った時点の単価200円 → 所得250円、年末 2単位・帳簿価額1,000円(単価500円) */
(function () {
  var r = calc.calculate([
    T('2024-01-10 00:00:00', 'buy', 1, 100, 0, 0, 'ETH'),
    T('2024-02-10 00:00:00', 'buy', 1, 300, 0, 0, 'ETH'),
    T('2024-03-10 00:00:00', 'sell', 1, 250, 0, 0, 'ETH'),
    T('2025-01-10 00:00:00', 'sell', 1, 450, 0, 0, 'ETH'),
    T('2025-06-10 00:00:00', 'buy', 2, 1000, 0, 0, 'ETH')
  ]);
  check('例3 年の一覧', r.years, [2024, 2025]);
  check('例3 2024 総平均法 所得', r.byYear[2024].assets.ETH.average.income, 50);
  check('例3 2024 移動平均法 所得', r.byYear[2024].assets.ETH.moving.income, 50);
  check('例3 2024 年末評価額', r.byYear[2024].assets.ETH.average.endValue, 200);
  var e = r.byYear[2025].assets.ETH;
  check('例3 2025 総平均法 単価', e.average.endUnit, 400);
  check('例3 2025 総平均法 所得', e.average.income, 50);
  check('例3 2025 総平均法 年末評価額', e.average.endValue, 800);
  check('例3 2025 移動平均法 所得', e.moving.income, 250);
  check('例3 2025 移動平均法 年末評価額', e.moving.endValue, 1000);
  check('例3 2025 移動平均法 年末単価', e.moving.endUnit, 500);
})();

/* ---- 例4: 暗号資産で払った手数料(数量で差し引かれる場合) ----
 * 買 1BTC 1,000,000円 手数料0.001BTC → 受け取り0.999BTC、帳簿価額1,000,000円
 * 売 0.5BTC 600,000円(単価1,200,000円) 手数料0.0005BTC
 *   手放した数量 0.5005BTC、譲渡原価 = 1,000,000 ÷ 0.999 × 0.5005 = 501,001.001…円
 *   売却額 = 600,000 + 0.0005 × 1,200,000 = 600,600円、手数料 600円
 *   所得 = 600,600 − 501,001.001… − 600 = 98,998.998…円 */
(function () {
  var r = calc.calculate([
    T('2025-03-01 00:00:00', 'buy', 1, 1000000, 0, 0.001),
    T('2025-04-01 00:00:00', 'sell', 0.5, 600000, 0, 0.0005)
  ]);
  var b = r.byYear[2025].assets.BTC;
  var cost = 1000000 / 0.999 * 0.5005;
  check('例4 売却額', b.average.proceeds, 600600);
  check('例4 手数料', b.average.fee, 600);
  check('例4 総平均法 譲渡原価', b.average.cost, cost, 1e-4);
  check('例4 移動平均法 所得', b.moving.income, 600600 - cost - 600, 1e-4);
  check('例4 年末数量', b.moving.endQty, 0.4985, 1e-12);
})();

/* ---- 例5: 銘柄は別々に計算し、合計は足し算 / 持っている以上に売ると警告 ---- */
(function () {
  var r = calc.calculate([
    T('2025-01-01 00:00:00', 'buy', 10, 1000, 0, 0, 'XRP'),
    T('2025-01-02 00:00:00', 'sell', 5, 800, 0, 0, 'XRP'),     // 所得 800 − 500 = 300
    T('2025-01-03 00:00:00', 'sell', 1, 5000, 0, 0, 'BTC')     // 取得の記録なし → 原価0円・警告
  ]);
  var y = r.byYear[2025];
  check('例5 XRP 所得', y.assets.XRP.average.income, 300);
  check('例5 BTC 所得(原価0円)', y.assets.BTC.moving.income, 5000);
  check('例5 合計 所得', y.total.average.income, 5300);
  check('例5 警告', r.warnings.map(function (w) { return w.asset + ':' + w.code; }), ['BTC:oversold']);
})();

/* ---- 例6: 年初の保有を手で入れる場合 ----
 * 年初 2単位・評価額1,000円。年中に 買 2 を3,000円、売 2 を5,000円
 * 総平均法: (1,000 + 3,000) ÷ 4 = 1,000円 → 所得 5,000 − 2,000 = 3,000円
 * 移動平均法: 同じ順(買→売)なので同じ3,000円 */
(function () {
  var r = calc.calculate([
    T('2025-02-01 00:00:00', 'buy', 2, 3000, 0, 0, 'ETH'),
    T('2025-03-01 00:00:00', 'sell', 2, 5000, 0, 0, 'ETH')
  ], { ETH: { qty: 2, value: 1000 } });
  check('例6 総平均法 所得', r.byYear[2025].assets.ETH.average.income, 3000);
  check('例6 移動平均法 所得', r.byYear[2025].assets.ETH.moving.income, 3000);
})();

/* ---- CSVの読み込み ---- */
(function () {
  var text = '取引履歴\n"約定日時","銘柄","売買区分","約定数量","約定レート","約定代金","手数料(円)"\n' +
    '"2025/01/05 10:00:00","BTC/JPY","買","0.1","10,000,000","1,000,000","100"\n' +
    '"2025/02/05 10:00:00","BTC/JPY","売","0.05","12,000,000","600,000","50"\n' +
    '"2025/02/06 10:00:00","JPY","入金","","","100,000",""\n' +
    '"2025/02/07 10:00:00","ETH/BTC","買","1","0.05","",""\n';
  var rows = csv.parseCSV(text);
  var h = csv.findHeaderRow(rows);
  check('CSV 見出し行', h, 1);
  var map = csv.guessMapping(rows[h]);
  check('CSV 列の候補', [map.time, map.asset, map.side, map.qty, map.price, map.amount, map.fee, map.feeUnit], [0, 1, 2, 3, 4, 5, 6, 'jpy']);
  check('CSV 対応がそろった', csv.mappingComplete(map), true);
  var out = csv.toTransactions(rows.slice(h + 1), map, null, 'test.csv', h + 2);
  check('CSV 取引の件数', out.txs.length, 2);
  check('CSV 外した件数', out.skipped.length, 2);
  var r = calc.calculate(out.txs);
  // 取得 1,000,100円で0.1BTC → 0.05BTCの原価 500,050円。所得 600,000 − 500,050 − 50 = 99,900円
  check('CSV 所得', r.byYear[2025].total.average.income, 99900);

  check('引用符と改行入りの値', csv.parseCSV('a,"b,""c""\nd"\n1,2'), [['a', 'b,"c"\nd'], ['1', '2']]);
  check('見出しで決められない列は空欄', csv.guessMapping(['列A', '列B', '列C']).time, -1);
  check('手数料の単位が書かれていなければ未定', csv.guessMapping(['日時', '通貨', '種別', '数量', '価格', '手数料']).feeUnit, '');
  check('日時 UTCを日本時間に', csv.parseTime('2024-12-31T16:30:00Z'), '2025-01-01 01:30:00');
  check('日時 年月日', csv.parseTime('2025年3月4日 5:06'), '2025-03-04 05:06:00');
  check('数値 カンマ・円', csv.num('¥1,234.5円'), 1234.5);
  check('数値 通貨記号つき', csv.num('-0.25 BTC'), -0.25);
  check('区分 買い', csv.classifySide('買い'), 'buy');
  check('区分 sell', csv.classifySide('SELL'), 'sell');
  check('区分 入金は対象外', csv.classifySide('入金'), '');
  try {
    var sj = Buffer.from([0x93, 0xfa, 0x8e, 0x9e]); // Shift_JIS の「日時」
    check('Shift_JIS の読み込み', csv.decode(sj), '日時');
  } catch (e) { console.log('(この Node には Shift_JIS の変換がないため、文字コードのテストを飛ばしました)'); }
})();

console.log((fail ? '失敗あり: ' : 'すべて成功: ') + pass + '件成功 / ' + fail + '件失敗');
process.exit(fail ? 1 : 0);
