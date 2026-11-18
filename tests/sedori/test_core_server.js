// 有料の機能の芯(Worker の /core)に 2026-11-18 移した計算が、画面の部品と同じ答えを出すかの検算。実行: node tests/sedori/test_core_server.js [公開フォルダ]
// 1) 帳簿の集計(books): books-core.js の monthly・groupBy と、Worker の booksYear が同じ答え(乱数の台帳・売上・経費で300回)
// 2) 送る欄: 画面(books.js の slim)が送る欄は、品名・取引相手の名前・住所を含まない(部品の元を読んで確かめる)
// 3) まとめての要約(bulkSum)と、ウォッチの自動の旗(limits.watch)の形
const path = require('path'), fs = require('fs'), assert = require('assert');
const root = path.resolve(process.argv[2] || path.join(__dirname, '../../../kt-zs-sedori-ghp'));
const SD = require('./_dir')(root);
const B = require(path.join(root, SD, 'books/assets/books-core.js'));
let n = 0;
function eq(a, b, msg) { assert.deepStrictEqual(a, b, `${msg}: 実際 ${JSON.stringify(a)} / 期待 ${JSON.stringify(b)}`); n++; }

(async () => {
  const { booksYear, bulkSummary, LIMITS } = await import(path.join(__dirname, '../../backend/sedori/worker/src/core.js'));

  /* ---------- 1. 帳簿の集計: 画面の部品と同じ答え ---------- */
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pickOne = a => a[Math.floor(rnd() * a.length)];
  const day = y => y + '-' + String(1 + Math.floor(rnd() * 12)).padStart(2, '0') + '-' + String(1 + Math.floor(rnd() * 28)).padStart(2, '0');
  const PARTIES = ['楽天市場 Aショップ', 'Yahoo!ショッピング B店', 'ブックオフ 新宿店', '山田 太郎', 'メルカリ', '', 'セカンドストリート 渋谷'];
  const SELL = ['Amazon', 'メルカリ', 'ヤフオク', 'ラクマ', '', 'その他の店'];
  const ROUTES = ['rakuten', 'mercari', 'yahuoku', '', 'store'];
  const KINDS = ['order', 'sale', 'refund', 'adjust', 'fee', 'transfer', 'other'];
  // 画面(books.js の slim)と同じ丸め: 仕入れ先は先頭の語、売り先は売り先の名前
  const slimL = r => ({ id: r.id, qty: r.qty, unit: r.unit, saleDate: r.saleDate, salePrice: r.salePrice, sellPrice: r.sellPrice, profit: r.profit, wait: !!r.wait, route: r.route, pg: r.party ? B.partyGroup(r.party) : '', ch: B.chOf(r.sellTo) });
  const strip = a => JSON.parse(JSON.stringify(a));
  for (let t = 0; t < 300; t++) {
    const y = pickOne([2025, 2026]);
    const ledger = Array.from({ length: Math.floor(rnd() * 40) }, (_, i) => {
      const sold = rnd() < 0.7;
      return { id: 'L' + i, date: day(y), qty: rnd() < 0.2 ? '' : 1 + Math.floor(rnd() * 3), unit: Math.floor(rnd() * 5000), party: pickOne(PARTIES), route: pickOne(ROUTES), name: '品' + i,
        saleDate: sold ? day(pickOne([y, y, y - 1])) : '', salePrice: sold ? Math.floor(rnd() * 9000) : '', sellPrice: rnd() < 0.5 ? Math.floor(rnd() * 9000) : '', profit: rnd() < 0.3 ? '' : Math.floor(rnd() * 3000) - 500,
        sellTo: pickOne(SELL), wait: rnd() < 0.1 };
    });
    const sales = Array.from({ length: Math.floor(rnd() * 30) }, (_, i) => ({ id: 'S' + i, date: day(y), kind: pickOne(KINDS), ledgerId: rnd() < 0.5 && ledger.length ? pickOne(ledger).id : '', ch: pickOne(['Amazon', 'メルカリ', '']),
      gross: Math.floor(rnd() * 9000), disc: rnd() < 0.2 ? -100 : 0, fee: Math.floor(rnd() * 900), ship: Math.floor(rnd() * 700), other: rnd() < 0.2 ? -50 : 0, withheld: rnd() < 0.1 ? -30 : 0, qty: 1, name: '売上' + i }));
    const expenses = Array.from({ length: Math.floor(rnd() * 15) }, () => ({ date: day(pickOne([y, y - 1])), amount: Math.floor(rnd() * 20000), biz: pickOne([undefined, '', 50, 100, 0]), payee: '支払先' }));
    const D = { ledger, sales, expenses };
    const srv = booksYear({ year: y, ledger: ledger.filter(r => r.saleDate || sales.some(x => x.ledgerId === r.id)).map(slimL), sales, expenses: expenses.map(x => ({ date: x.date, amount: x.amount, biz: x.biz })) });
    const M = strip(B.monthly(D, y));
    assert.deepStrictEqual(strip({ months: srv.months, total: srv.total }), M, '月ごとの利益が画面の部品と違う(' + t + '回目)');
    for (const k of ['route', 'party', 'ch']) assert.deepStrictEqual(strip(srv.groups[k]), strip(B.groupBy(D, y, k)), k + 'ごとの集計が画面の部品と違う(' + t + '回目)');
  }
  eq(true, true, '帳簿の集計: 乱数の300通りで、Worker の答えが画面の部品(books-core.js)の monthly・groupBy と同じ');

  /* ---------- 2. 画面が送る欄 ---------- */
  const src = fs.readFileSync(path.join(root, SD, 'books/assets/books.js'), 'utf8');
  const slim = (src.match(/function slim\(D\) \{[\s\S]*?\n  \}/) || [''])[0];
  eq([!!slim, /\bname\b/.test(slim), /party: r\.party/.test(slim), /sellerName|address|addr|seller\b/.test(slim), /partyGroup/.test(slim)], [true, false, false, false, true], '帳簿: Worker へ送る欄に品名・取引相手の名前・住所を入れない(仕入れ先は先頭の語に丸める)');
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
