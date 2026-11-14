// 在庫番(assets/listed.js の前半 = 計算だけ)の検算。止める判断5つ・取り込み・書き出し・見張れる品数。
// 実行: node tests/sedori/test_listed.js <公開フォルダ>。にせの値だけ。楽天へは接続しない。
const path = require('path'), fs = require('fs'), assert = require('assert');
const root = process.argv[2] || path.join(__dirname, '../../../kt-zs-sedori-ghp');
const SD = require('./_dir')(root);
const L = require(path.join(root, SD, 'assets/listed.js'));
let n = 0;
function eq(a, b, msg) { assert.deepStrictEqual(a, b, `${msg}: 実際 ${JSON.stringify(a)} / 期待 ${JSON.stringify(b)}`); n++; }
const T = 1794550000000, M = 60000;
// にせの計算: 利益 = 出品価格 - 仕入れ値 - 2000(手数料・送料のつもり)。目標の利益 = 300円
const env = { C: { amazonProfit: (f, x) => ({ profitNoPoints: x.sell - x.cost - 2000 }), needProfit: (sell, target) => target }, fees: {}, target: 300 };
const mk = (o) => L.norm(Object.assign({ id: 'a', sku: 'S-1', name: 'ワイヤレスイヤホン 黒', price: 6980, qty: 1, jan: '4901234500012', calc: { category: 'x', sell: 6980 },
  src: [{ code: 'main:1', shop: '主の店', shopCode: 'main', base: 4000, name: 'ワイヤレスイヤホン 黒', freeShip: true }] }, o || {}), T);
const sh = (code, price) => ({ code, shopCode: code.split(':')[0], shop: code, price });
const ob = (o) => Object.assign({ ok: true, stock: true, missing: false, price: 4000, freeShip: true, name: 'ワイヤレスイヤホン 黒', shopCode: 'main', shops: [sh('main:1', 4000), sh('b:1', 4100), sh('c:1', 4200)] }, o || {});

// 1. 在庫切れは1回で止める(控えに在庫があっても)
let j = L.judge(mk(), ob({ stock: false, price: null, shops: [sh('b:1', 4100), sh('c:1', 4200)] }), env, {});
eq(j.why, ['out'], '在庫切れは1回で止める(控えの店に在庫があっても)');
eq(L.judge(mk(), ob(), env, {}).why, [], '在庫もあり店も足りて利益も出る品は止めない');
// 2. 在庫のある店が2店未満
eq(L.judge(mk(), ob({ shops: [sh('main:1', 4000)] }), env, {}).why, ['few'], '在庫のある店が1店だけなら止める');
eq(L.judge(mk(), ob({ shops: [sh('main:1', 4000), sh('b:1', 4100)] }), env, {}).why, [], '2店あれば止めない(下限は2店未満)');
eq(L.judge(mk({ minShops: 1 }), ob({ shops: [sh('main:1', 4000)] }), env, {}).why, [], '品ごとに「1店でも続ける」なら止めない');
eq(L.judge(mk(), ob({ shops: [sh('main:1', 4000), sh('b:1', 5500)] }), env, {}).why, ['few'], '目標の利益に届かない値段の店は、在庫のある店に数えない');
eq(L.judge(mk(), ob({ shops: null }), env, {}).why, [], 'JANが無く店を数えられない品は、店の数では止めない(数えられないことを止める理由にしない)');
// 3. 利益が目標(ポイント抜き)を割る
j = L.judge(mk(), ob({ price: 4800, shops: [sh('main:1', 4800), sh('b:1', 4900), sh('c:1', 4950)] }), env, {});
eq([j.why.indexOf('profit') >= 0, j.profit], [true, 180], '今の仕入れ値で利益が目標を割ったら止める(6980-4800-2000=180 < 300)');
eq(L.judge(mk(), ob({ price: 4680 }), env, {}).why.indexOf('profit'), -1, '利益がちょうど目標なら止めない');
eq(L.judge(mk({ floor: 100 }), ob({ price: 4800 }), env, {}).why.indexOf('profit'), -1, '品ごとの線で変えられる');
eq(L.judge(mk({ calc: null }), ob({ price: 9000 }), env, {}).why.indexOf('profit'), -1, '計算の条件が無い品は利益で止めない');
// 4. 店が変わった
eq(L.judge(mk(), ob({ stock: false, missing: true, price: null, shops: [sh('z:9', 4100), sh('y:9', 4200)] }), env, {}).why.indexOf('shop') >= 0, true, '主の商品が消えて別の店だけが出たら「店が変わった」');
eq(L.judge(mk(), ob({ shopCode: 'other' }), env, {}).why.indexOf('shop') >= 0, true, '店の番号が変わったら止める');
eq(L.judge(mk(), ob({ name: '全然ちがう 掃除機 サイクロン式' }), env, {}).why.indexOf('shop') >= 0, true, '商品名が大きく変わったら止める');
eq(L.judge(mk(), ob({ freeShip: false }), env, {}).why.indexOf('ship') >= 0, true, '送料無料でなくなったら理由に出す');
// 5. 確かめられない: 続けて2回、または60分
let it = mk(); const bad = { unknown: true, why: [] };
L.applyCheck(it, bad, T, {}); eq(L.view(it, { now: T + M, limit: 5, index: 0 }).st, 'new', '1回の失敗では止めない(まだ確かめていない品)');
it = mk(); L.applyCheck(it, L.judge(it, ob(), env, {}), T, {});
L.applyCheck(it, bad, T + 15 * M, {}); eq(L.view(it, { now: T + 16 * M, limit: 5, index: 0 }).st, 'watch', '確かめた後の失敗1回は見張り中のまま');
L.applyCheck(it, bad, T + 30 * M, {}); eq(L.view(it, { now: T + 31 * M, limit: 5, index: 0 }), { st: 'stop', why: ['unknown'] }, '続けて2回確かめられなければ止める品と同じ扱い');
it = mk(); L.applyCheck(it, L.judge(it, ob(), env, {}), T, {});
eq(L.view(it, { now: T + 59 * M, limit: 5, index: 0 }).st, 'watch', '59分は見張り中');
eq(L.view(it, { now: T + 60 * M, limit: 5, index: 0 }), { st: 'stop', why: ['stale'] }, '60分たったら止める品と同じ扱い');
eq(L.fromStock(it, { shops: [{ state: 'unknown', role: 'main' }] }).ok, false, '主の店を確かめられなかった結果は、売り切れとは別に扱う');
eq(L.view(it, { now: T + 10 * M, limit: 5, index: 0, allFailSince: T + 5 * M }).st, 'watch', '全品の失敗が3時間未満なら品ごとには止めない');
eq(L.view(mk(), { now: T + 5 * M + 3 * 60 * M, limit: 5, index: 0, allFailSince: T + 5 * M }), { st: 'stop', why: ['halt'] }, '全品の失敗が3時間続いたら、まだ確かめていない品も止める品に');
// 状態の動き: 止めたら勝手に戻さない。外れた回が続けて2回で「戻せる」。戻すのは利用者が押した時だけ
it = mk(); L.applyCheck(it, L.judge(it, ob({ stock: false, price: null }), env, {}), T, {});
eq([it.st, it.why], ['stop', ['out']], '止める品に入る');
L.applyCheck(it, L.judge(it, ob(), env, {}), T + 15 * M, {}); eq(it.st, 'stop', '条件が外れた1回目では戻さない');
L.applyCheck(it, L.judge(it, ob(), env, {}), T + 30 * M, {}); eq(it.st, 'back', '続けて2回外れたら「戻せる」');
L.applyCheck(it, L.judge(it, ob(), env, {}), T + 45 * M, {}); eq(it.st, 'back', '「戻せる」は利用者が押すまで見張り中に戻らない');
L.resume(it, T + 50 * M); eq([it.st, it.upAt], ['watch', 0], '見張りに戻すのは、押した時だけ');
L.markStopped(it, T); eq(it.st, 'stopped', '「数量を0にした」で止めた品へ');
// 注文が入った
it = mk({ qty: 2 }); L.onOrder(it, T); eq([it.qty, it.st], [1, 'watch'], '数量2以上の品は注文で数量を1つ減らす');
L.onOrder(it, T); eq([it.st, it.why], ['stop', ['order']], '数量1の品は注文で止める品に(次の注文を受けない)');
// 2. 一覧の取り込み
const table = L.parseTable('seller-sku\tasin1\titem-name\tprice\tquantity\tfulfillment-channel\r\nA-1\tb0aaaaaaa1\t"名前,カンマ入り"\t1,980\t3\tDEFAULT\r\nA-2\tB0AAAAAAA2\t名前2\t2980\t\tAMAZON_JP\r\nA-3\tB0AAAAAAA3\t名前3\t3980\t1\tDEFAULT\r\n');
const map = L.detectCols(table[0]);
eq([map.sku, map.asin, map.price, map.qty, map.cond], [0, 1, 3, 4, -1], '列の名前から当てる(当たらない列は-1)');
const rows = L.readReport(table, map);
eq(rows.map(r => [r.sku, r.asin, r.price, r.qty, r.ch]), [['A-1', 'B0AAAAAAA1', 1980, 3, 'self'], ['A-2', 'B0AAAAAAA2', 2980, 1, 'fba'], ['A-3', 'B0AAAAAAA3', 3980, 1, 'self']], '取り込み: カンマ入りの名前・金額のカンマ・FBAの行');
eq(L.readReport(table, Object.assign({}, map, { price: 4 }))[0].price, 3, '列を選び直せる(別の列を価格にできる)');
let r = L.mergeReport([], rows, 5, T); eq([r.added, r.fba, r.items.length], [2, 1, 2], 'FBAの行は入れない');
r.items[0].src = [{ code: 'x:1', shop: 's' }]; r.items[0].jan = '4901234500012';
let r2 = L.mergeReport(r.items, [{ sku: 'A-1', price: 1500, qty: 1, ch: 'self', name: '名前,カンマ入り' }], 5, T);
eq([r2.updated, r2.items[0].price, r2.items[0].src.length, r2.items[0].jan, r2.gone], [1, 1500, 1, '4901234500012', 1], '同じSKUは価格と数量だけ上書き。仕入れ先は残る。レポートに無い品は印だけ(消さない)');
eq(r2.items.length, 2, 'レポートに無い品を消さない');
eq(L.mergeReport([], rows, 1, T).over, 1, 'プランの上限を超えた品は入れない');
// 古いデータ・壊れたデータ
eq(L.normAll([null, 'x', { sku: 'Q' }, { id: 'k', src: [{ code: '' }, { code: 'a:1' }, { code: 'b:1' }, { code: 'c:1' }, { code: 'd:1' }] }], T).map(x => x.src.length), [0, 3], '壊れた値を除き、仕入れ先は主1+控え2まで');
eq(L.norm({ st: 'なぞ' }, T).st, 'watch', '知らない状態は見張り中');
// 送り込みの口
const a = L.addIncoming([], [{ jan: '4901234500012', name: 'A', code: 'm:1', shop: '店', cost: 1000, price: 3000 }, { name: 'JANもSKUもASINも無い' }, { asin: 'b0aaaaaaa9' }], 'bulk', 5, T);
eq([a.added, a.items.length, a.items.map(x => x.from)], [2, 2, ['bulk', 'bulk']], '送り込み: 識別できない行は入れない');
eq([a.items[1].src[0].code, a.items[1].src[0].base], ['m:1', 1000], '送り込み: 楽天の商品コードと価格が仕入れ先に入る');
eq(L.addIncoming(a.items, [{ jan: '4901234500012', sku: 'NEW-1' }], 'bulk', 5, T).items.filter(x => x.sku === 'NEW-1').length, 1, '送り込み: 同じJANの品に足りないSKUを埋める');
eq(L.addIncoming(a.items, [{ jan: '4901234500099' }], 'bulk', 2, T).over, 1, '送り込み: 上限超えは入れない');
// 見張れる品数
eq([L.LIMIT.free, L.LIMIT.light, L.LIMIT.total, L.LIMIT.business], [5, 30, 100, 300], '見張れる品数 無料5・ライト30・総合100・業務300');
const many = Array.from({ length: 7 }, (_, i) => mk({ id: 'm' + i, sku: 'S' + i }));
eq(L.summarize(many, { now: T, set: {}, limit: 5 }).over.length, 2, '上限の外の品は見張らない');
eq(L.pickRound(many, 5).length, 5, '確かめる品は上限まで');
eq([L.fits(450, 15), L.fits(451, 15)], [true, false], '1品2秒で、間隔(分)に回りきれるか');
// 書き出し(数量0のファイルは準備中)
eq(L.STOCK_FILE.ready, false, '数量0のファイルは、書式を確かめるまで準備中');
const stops = [mk({ sku: 'X-1' }), mk({ id: 'b', sku: 'X-2' }), mk({ id: 'c', sku: '' }), mk({ id: 'd', sku: 'F-1', ch: 'fba' })];
eq(L.fileItems(stops).map(x => x.sku), ['X-1', 'X-2'], 'FBAの品とSKUの無い品は在庫ファイルに書かない');
eq(L.stockFile(stops, 0), 'sku\tquantity\r\nX-1\t0\r\nX-2\t0\r\n', '数量0の中身(列の案は1か所)');
eq(L.stockFile(stops, 1, { sep: ',', cols: [{ head: 'sku', value: 'sku' }, { head: 'price', value: '' }, { head: 'quantity', value: 'qty' }] }), 'sku,price,quantity\r\nX-1,,1\r\nX-2,,1\r\n', '列の案を変えても書ける(空の列も)');
eq(L.skuList(stops.map(x => ({ it: x }))), ['X-1', 'X-2', 'F-1'], 'SKUのコピー用の並び(SKUの無い品は入れない)');
// 注文の行(台帳へ)
const o = L.orderRow(mk({ chk: { price: 4000, profit: 900 } }), { amzOrder: ' 503-111 ', shipBy: '2026-11-20', today: '2026-11-14' });
eq([o.status, o.wait, o.route, o.mz.amzOrder, o.mz.shipBy, o.mz.itemId, o.unit], ['売約', true, '取り寄せ販売', '503-111', '2026-11-20', 'a', 4000], '注文が入った: 台帳の「仕入れ前」の行に項目を足す');
// 使わない言葉
const src = fs.readFileSync(path.join(root, SD, 'assets/listed.js'), 'utf8');
eq((src.match(/無在庫|ドロップシッピング|利益が高い|稼げ/g) || []).length, 0, '画面の文に使わない言葉が0件');
console.log(`OK 在庫番の判断と取り込み ${n}件`);
