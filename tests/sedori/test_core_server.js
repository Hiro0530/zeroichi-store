// 有料の機能の芯(Worker の /core)に 2026-11-18 移した計算が、画面の部品と同じ答えを出すかの検算。実行: node tests/sedori/test_core_server.js [公開フォルダ]
// 1) 帳簿の計算: tests/sedori/test_books_calc.js へ(乱数で、移す前の端末の計算と同じ答えか)
// 2) 送る欄: 画面(books.js の slim)が送る欄は、品名・取引相手の名前・住所を含まない(部品の元を読んで確かめる)
// 3) まとめての要約(bulkSum)と、ウォッチの自動の旗(limits.watch)の形
const path = require('path'), fs = require('fs'), assert = require('assert');
const root = path.resolve(process.argv[2] || path.join(__dirname, '../../../kt-zs-sedori-ghp'));
const SD = require('./_dir')(root);
let n = 0;
function eq(a, b, msg) { assert.deepStrictEqual(a, b, `${msg}: 実際 ${JSON.stringify(a)} / 期待 ${JSON.stringify(b)}`); n++; }

(async () => {
  const { bulkSummary, LIMITS } = await import(path.join(__dirname, '../../backend/sedori/worker/src/core.js'));

  /* ---------- 1・2. 帳簿の集計は tests/sedori/test_books_calc.js(乱数で、移す前の端末の計算と同じ答えか)。ここでは、画面が送る欄を元のプログラムで確かめる ---------- */
  const src = fs.readFileSync(path.join(root, SD, 'books/assets/books-srv.js'), 'utf8');
  const build = (src.match(/function build\(D, set, opt\) \{[\s\S]*?\n  \}\n/) || [''])[0];
  eq([!!build, /party: r\.party|name: r\.name|pName: r|pAddr: r|payee: x|memo: x/.test(build), /B\.partyGroupKnown/.test(src), /B\.partyKey/.test(build)], [true, false, true, true],
    '帳簿: Worker へ送る欄に、品名・取引相手の名前・住所・支払先の名前・メモの文字を入れない(まとめる印は番号にして送る)');
  const bsrc = fs.readFileSync(path.join(root, SD, 'assets/bulk.js'), 'utf8');
  const sr = (bsrc.match(/function sumRows\(\) \{[\s\S]*?\n    \}/) || [''])[0];
  eq([!!sr, /name|jan|asin|keepa|rk/i.test(sr.replace(/R\.judge|R\.compute/g, ''))], [true, false], 'まとめての要約: Worker へ送るのは数字だけ(品名・JAN・ASIN・キーを送らない)');

  /* ---------- 3. 要約とウォッチの旗 ---------- */
  eq([LIMITS.free.watch, LIMITS.light.watch, LIMITS.total.watch, LIMITS.business.watch], [0, 50, 50, 50], 'ウォッチの自動: 無料は無し・有料は1回50件(端末の AUTO_MAX と同じ)');
  const wsrc = fs.readFileSync(path.join(root, SD, 'assets/watch-check.js'), 'utf8');
  eq(/AUTO_MAX = 50;/.test(wsrc) && /l && l\.watch/.test(wsrc), true, 'ウォッチの自動: 利用の鍵の形では、件数を Worker の答えから取る');
  const s = bulkSummary([{ i: 0, p: 1000, need: 500, sold: 10, cnt: 1 }, { i: 1, p: 600, need: 500, sold: 300, cnt: 2 }, { i: 2, p: 200, need: 500, sold: 100, cnt: 0 }]);
  eq([s.top.map(x => x.i), s.top.map(x => x.month), s.order], [[1, 0], [18000, 5000], [1, 0, 2]], '要約: 1個の利益が小さくても、月に多く取れる品を上にする');
  console.log(`OK 芯に移した計算 ${n}件`);
})().catch(e => { console.error(e); process.exitCode = 1; });
