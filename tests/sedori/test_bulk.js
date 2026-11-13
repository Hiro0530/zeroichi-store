// まとめてチェックの検算。実行: node tests/sedori/test_bulk.js [公開フォルダ]
// 貼った一覧の読み取り(calc.js の parseCodes)、プランごとの行数、Keepaを100件ずつ呼ぶ・途中で止めて続きから(bulk.js の runJob)、判定。
// Keepa・楽天は、にせの返事で確かめる(外へは出ない)。
const path = require('path'), fs = require('fs'), assert = require('assert');
const root = process.argv[2] || path.join(__dirname, '../../../kt-zs-sedori-ghp');
const SD = require('./_dir')(root);
const C = require(path.join(root, SD, 'assets/calc.js'));
const B = require(path.join(root, SD, 'assets/bulk.js'));
const fees = JSON.parse(fs.readFileSync(path.join(root, SD, 'data/fees.json'), 'utf8'));
let n = 0;
function eq(a, b, msg) { assert.deepStrictEqual(a, b, `${msg}: 実際 ${JSON.stringify(a)} / 期待 ${JSON.stringify(b)}`); n++; }
// 検査の数字つきのJANを作る
function jan(i) {
  const b = '4902370' + String(50000 + i).slice(0, 5), d = b.split('').map(Number);
  const s = d.reduce((t, x, k) => t + x * (k % 2 ? 3 : 1), 0);
  return b + String((10 - s % 10) % 10);
}

(async () => {
  // 1. 読み取り: JAN13桁・8桁・ASIN・全角・空行・重複・検査の数字の誤り
  let p = C.parseCodes('4901234567894');
  eq(p.items.length, 1, 'JAN13桁を1件');
  eq(p.items[0].type, 'jan', '種類はJAN');
  eq(p.items[0].cost, null, '仕入れ値なしは null');
  p = C.parseCodes('49123456');
  eq(p.items[0].code, '49123456', 'JAN8桁');
  p = C.parseCodes('b0chx3qbch');
  eq([p.items[0].type, p.items[0].code], ['asin', 'B0CHX3QBCH'], 'ASINは大文字にそろえる');
  p = C.parseCodes('４９０１２３４５６７８９４　１９８０');
  eq([p.items[0].code, p.items[0].cost], ['4901234567894', 1980], '全角の数字と全角の空白');
  p = C.parseCodes('4901234567894\n\n\n49123456\n');
  eq([p.items.length, p.total], [2, 2], '空行は数えない');
  p = C.parseCodes('4901234567894\n4901234567894\n4901234567894');
  eq([p.items.length, p.dup], [1, 2], '同じコードは1つにまとめる');
  p = C.parseCodes('4901234567894\n4901234567894\t1500\t2980');
  eq([p.items[0].cost, p.items[0].sell], [1500, 2980], '後の行にだけ金額があれば足す');
  p = C.parseCodes('4901234567890');
  eq([p.items.length, p.bad.length, p.bad[0].line], [0, 1, 1], '検査の数字が合わないJANは読めなかった行');
  p = C.parseCodes('490123456789');
  eq(p.bad.length, 1, '12桁は読めなかった行');
  p = C.parseCodes('トミカ No.42');
  eq(p.items.length + p.bad.length, 0, '1行目の見出しらしい行は数えない');
  p = C.parseCodes('4901234567894\nトミカ');
  eq([p.bad.length, p.bad[0].line], [1, 2], '2行目以降の文字だけの行は読めなかった行');
  p = C.parseCodes('JAN\t仕入れ値\t売値\n4901234567894\t1980\t3980');
  eq([p.items.length, p.bad.length, p.total], [1, 0, 1], '見出しの行を飛ばす');
  p = C.parseCodes('4901-2345-67894');
  eq(p.items[0].code, '4901234567894', 'ハイフン入りのJAN');
  p = C.parseCodes('B0CHX3QBC');
  eq(p.bad.length, 1, '9桁のASINは読めなかった行');
  p = C.parseCodes('\r\n4901234567894\r\n49123456\r\n');
  eq(p.items.length, 2, '改行がCRLFでも読める');
  p = C.parseCodes('');
  eq([p.items.length, p.bad.length, p.total], [0, 0, 0], '空の文字');
  p = C.parseCodes(null);
  eq(p.items.length, 0, '値が無くても落ちない');
  p = C.parseCodes('  4901234567894  ');
  eq(p.items[0].code, '4901234567894', '前後の空白');
  p = C.parseCodes('4901234567894\nB0CHX3QBCH\n49123456\n4901234567890\nabc\n4901234567894');
  eq([p.items.length, p.bad.length, p.dup, p.total], [3, 2, 1, 6], '混ざった一覧: 読めた3・読めない2・重複1・全6行');
  eq(p.items.map(x => x.line), [1, 2, 3], '元の行番号を持つ');

  // 2. 区切りと金額
  p = C.parseCodes('4901234567894\t1,980円\t3,980円');
  eq([p.items[0].cost, p.items[0].sell], [1980, 3980], 'タブ区切り・「円」「,」つき');
  p = C.parseCodes('4901234567894,1980,3980');
  eq([p.items[0].cost, p.items[0].sell], [1980, 3980], 'カンマ区切り');
  p = C.parseCodes('4901234567894,"1,980","3,980"');
  eq([p.items[0].cost, p.items[0].sell], [1980, 3980], 'カンマ区切りで、金額を""で囲んだ形');
  p = C.parseCodes('4901234567894 1,980円 3,980円');
  eq([p.items[0].cost, p.items[0].sell], [1980, 3980], '空白区切り・桁区切りつき');
  p = C.parseCodes('4901234567894\t\t3980');
  eq([p.items[0].cost, p.items[0].sell], [null, 3980], '仕入れ値が空で売値だけ');
  p = C.parseCodes('4901234567894\t¥1980');
  eq(p.items[0].cost, 1980, '¥つき');
  p = C.parseCodes('4901234567894\t未定\t0');
  eq([p.items[0].cost, p.items[0].sell], [null, null], '数字でない・0円は未入力として扱う');

  // 3. 仕入れ値あり・売値あり: 手計算と同じ利益。目標未満は「届かない」
  //    例A: 3,980円・おもちゃ・標準2c・仕入れ2,500・納品100 → 3980-455-420-100-2500 = 505円。目標15%は 597円 → 届かない
  const X = { sell: 3980, category: 'toys', fbaTier: 'std2c', cost: 2500, inShip: 0, inbound: 100, other: 0, usePoints: false };
  const r = C.amazonProfit(fees, X); r.need = C.needProfit(3980, { mode: 'pct', value: 15 }); r.est = false;
  eq([r.profitNoPoints, r.need], [505, 597], '例A: 利益505円・目標597円');
  eq(C.bulkJudge(r, true), 'ng', '目標未満は届かない');
  const r2 = C.amazonProfit(fees, Object.assign({}, X, { cost: 2400 })); r2.need = 597; r2.est = false;
  eq([r2.profitNoPoints, C.bulkJudge(r2, true)], [605, 'ok'], '仕入れ2,400円なら605円で届く');
  const r3 = C.amazonProfit(fees, Object.assign({}, X, { cost: 2408 })); r3.need = 597;
  eq([r3.profitNoPoints, C.bulkJudge(r3, true)], [597, 'ok'], '目標ちょうどは届く');
  // ポイントを足して届く行は「届かない」のまま(ポイント抜きで見る)
  const r4 = C.amazonProfit(fees, Object.assign({}, X, { usePoints: true, pointRate: 0.10 })); r4.need = 597;
  eq([r4.profit >= 597, C.bulkJudge(r4, true)], [true, 'ng'], 'ポイント込みでは届くが、判定はポイント抜き');
  eq(C.bulkJudge({ est: true, sell: 4106 }, true), 'unk', '売値が未入力(目安)は確かめられない');
  eq(C.bulkJudge(null, true), 'unk', '計算できない行は確かめられない');

  // 4. 仕入れ値なし: 仕入れ値の上限(右の欄と同じ amazonMaxCost)
  const maxc = C.amazonMaxCost(fees, Object.assign({}, X, { cost: 0 }), { mode: 'pct', value: 15 });
  eq(maxc, 2408, '例Aの仕入れ値の上限は2,408円(3980-455-420-100-597)');
  eq(C.bulkJudge(null, false, maxc), 'unk', '仕入れ値なし・上限あり → 確かめられない(上限を見せる)');
  eq(C.bulkJudge(null, false, null), 'ng', '仕入れ値なし・0円でも届かない売値 → 届かない');
  eq(C.bulkJudge(null, false, undefined), 'unk', '売値も仕入れ値も無い行(上限が出せない)は「未入力」に数える');
  p = C.parseCodes('4901234567894\t4902370500028\t3980');
  eq([p.items.length, p.bad.length, /金額を確かめてください/.test(p.bad[0].why)], [0, 1, true], '仕入れ値の列にJANを貼った行は、読めなかった行に回す');
  p = C.parseCodes('4901234567894\t100000000');
  eq(p.bad.length, 1, '仕入れ値1億円は「金額を確かめてください」');
  p = C.parseCodes('4901234567894\t9999999\t9999999');
  eq(p.items.length, 1, '999万9,999円までは計算する');
  p = C.parseCodes('コード\n★★★\n4901234567894');
  eq([p.items.length, p.bad.length, p.total], [1, 1, 2], '見出しとして飛ばすのは最初の1行だけ。2行目の記号だけの行は読めなかった行');

  // 5. プランごとの行数
  eq([C.bulkLimit('free'), C.bulkLimit('light'), C.bulkLimit('total'), C.bulkLimit('business'), C.bulkLimit('x')], [20, 100, 500, 500, 20], '無料20・ライト100・総合と業務500');
  const many = C.parseCodes(Array.from({ length: 25 }, (_, i) => jan(i)).join('\n')).items;
  eq(many.length, 25, '25行を読む');
  let pl = B.plan(many, C.bulkLimit('free'));
  eq([pl.rows.length, pl.over], [20, 5], '無料は20行まで計算し、21行目から先の5行は計算しない');
  eq(pl.rows[19].jan, jan(19), '20行目までが入る');
  pl = B.plan(many, C.bulkLimit('light'));
  eq([pl.rows.length, pl.over], [25, 0], 'ライトは25行すべて');
  eq(B.toRow({ code: 'B0CHX3QBCH', type: 'asin', cost: 2480, sell: 3980, line: 3 }).asin, 'B0CHX3QBCH', 'ASINの行');
  eq(B.toRow({ code: jan(1), type: 'jan', cost: null, sell: null, line: 1 }).price, 0, '仕入れ値なしは0');

  // 6. Keepaは100件ずつ。JANとASINを分ける
  function fakeKeepa(log, failAt) {
    return prm => {
      log.push(prm);
      if (failAt && log.length === failAt.n) { const e = new Error('Keepaのトークンが足りません。'); e.status = failAt.status; return Promise.reject(e); }
      const codes = (prm.code || prm.asin).split(',');
      return Promise.resolve({ tokensLeft: 1000 - log.length, products: codes.map((c, i) => i % 10 === 9 ? null : { asin: prm.asin ? c : 'B0X' + c.slice(-7), eanList: prm.code ? [c] : [], title: '商品 ' + c }) });
    };
  }
  const apply = (it, pr) => { it.asin = pr.asin; it.sell = 3980; it.kp = { amz: false }; };
  const mk = k => B.plan(C.parseCodes(Array.from({ length: k }, (_, i) => jan(i) + '\t2000').join('\n') + '\nB0CHX3QBCH\t2000').items, 500).rows;
  let rows = mk(250), log = [], prog = [];
  let res = await B.runJob(rows, { keepa: true, rakuten: false, kpCall: fakeKeepa(log), applyKeepa: apply, progress: (d, t) => prog.push([d, t]) });
  eq(res.state, 'done', '250+1件が終わる');
  eq(log.length, 4, 'JAN 100+100+50 と ASIN 1 の4回に分けて呼ぶ');
  eq(log.slice(0, 3).map(x => x.code.split(',').length), [100, 100, 50], '1回100件まで');
  eq(log[3].asin, 'B0CHX3QBCH', 'ASINは asin で呼ぶ');
  eq(rows.every(it => it.kpTry), true, '全部の行に済みの印');
  eq(rows[0].name, '商品 ' + jan(0), '商品名が入る');
  eq(rows[9].sell, null, 'Keepaで見つからない行は売値が空のまま');
  eq(res.tokens, 996, '残りトークンを返す');
  eq(prog[prog.length - 1], [251, 251], '進み具合は 251/251 で終わる');

  // 7. 回数切れ(429)で止まり、続きから
  rows = mk(250); log = [];
  res = await B.runJob(rows, { keepa: true, rakuten: false, kpCall: fakeKeepa(log, { n: 2, status: 429 }), applyKeepa: apply });
  eq([res.state, res.status], ['paused', 429], '2回目で429 → 止まる');
  eq(/トークン/.test(res.why) && /続きから/.test(res.why), true, '回数切れの文に「続きから」がある');
  eq(rows.filter(it => it.kpTry).length, 100, '1回目の100件だけ済み');
  const log2 = [];
  res = await B.runJob(rows, { keepa: true, rakuten: false, kpCall: fakeKeepa(log2), applyKeepa: apply });
  eq([res.state, log2.length], ['done', 3], '続きから: 残りの150件とASINだけ呼ぶ(済んだ100件は呼ばない)');
  eq(log2[0].code.split(',')[0], jan(100), '101行目から');

  // 8. 「止める」
  rows = mk(250); log = []; let stop = false;
  res = await B.runJob(rows, { keepa: true, rakuten: false, kpCall: prm => { stop = true; return fakeKeepa(log)(prm); }, applyKeepa: apply, stopped: () => stop });
  eq([res.state, log.length], ['stopped', 1], '1回呼んだ後に止めると、次は呼ばない');

  // 9. 楽天: 仕入れ値が無い行だけ・送料込みで一番安い1件・無料の回数
  eq(B.pickCheapest([{ price: 1000, freeShip: false }, { price: 1200, freeShip: true }, { price: 1500, freeShip: true }]).price, 1200, '送料込みの中で一番安い');
  eq(B.pickCheapest([{ price: 1000, freeShip: false }, { price: 900, freeShip: false }]).price, 900, '送料込みが無ければ送料別で一番安い');
  eq(B.pickCheapest([]), null, '見つからなければ null');
  rows = B.plan(C.parseCodes([jan(1) + '\t1500', jan(2), jan(3), 'B0CHX3QBCH'].join('\n')).items, 500).rows;
  let rk = [], quota = 5;
  res = await B.runJob(rows, { keepa: false, rakuten: true, rakutenCall: prm => { rk.push(prm.keyword); return Promise.resolve([{ price: 1800, freeShip: true, shop: '店A', name: '品', code: 'a:1', shopPt: 1 }]); }, useQuota: () => quota-- > 0, wait: () => null });
  eq([res.state, rk], ['done', [jan(2), jan(3)]], '仕入れ値が無いJANの行だけ楽天を呼ぶ(仕入れ値ありとASINだけの行は呼ばない)');
  eq([rows[1].price, rows[1].shop, rows[1].code, rows[0].price], [1800, '店A', 'a:1', 1500], '一番安い1件が入り、貼った仕入れ値は変えない');
  rows = B.plan(C.parseCodes([jan(1), jan(2), jan(3)].join('\n')).items, 500).rows; rk = []; quota = 2;
  res = await B.runJob(rows, { keepa: false, rakuten: true, rakutenCall: prm => { rk.push(prm.keyword); return Promise.resolve([]); }, useQuota: () => quota-- > 0, wait: () => null });
  eq([res.state, res.quota, rk.length], ['paused', true, 2], '無料の回数を使い切ったら止まる');
  rows = B.plan(C.parseCodes(jan(1)).items, 500).rows;
  res = await B.runJob(rows, { keepa: false, rakuten: true, rakutenCall: () => { const e = new Error('楽天が403を返しました。'); e.status = 403; return Promise.reject(e); }, useQuota: () => true, wait: () => null });
  eq([res.state, res.status, rows[0].price], ['paused', 403, 0], '楽天の403で止まり、行は壊れない');
  res = await B.runJob(rows, { keepa: false, rakuten: true, rakutenCall: () => Promise.reject(new TypeError('Failed to fetch')), useQuota: () => true, wait: () => null });
  eq(/接続できませんでした/.test(res.why), true, '通信の失敗の文');

  // 10. キーが無い時は何も呼ばず、貼った数字だけで終わる
  rows = B.plan(C.parseCodes(jan(1) + '\t1500\t3980').items, 500).rows;
  res = await B.runJob(rows, { keepa: false, rakuten: false });
  eq([res.state, rows[0].price, rows[0].sell], ['done', 1500, 3980], 'キーなし: 貼った仕入れ値と売値のまま');
  eq(B.matches({ jan: '0012345678905' }, { eanList: [], upcList: ['012345678905'] }), true, 'UPC(12桁)は頭の0を外して照らす');

  // 11. 文言: 収入を約束する言葉が部品に入っていない
  const src = fs.readFileSync(path.join(root, SD, 'assets/bulk.js'), 'utf8');
  eq(/稼げ|儲か|必ず|誰でも|利益が出る商品/.test(src), false, 'まとめての部品に、もうけを約束する言葉が無い');

  console.log(`OK ${n}件`);
})().catch(e => { console.error(e); process.exit(1); });
