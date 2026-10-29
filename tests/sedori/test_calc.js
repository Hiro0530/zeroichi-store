// せどり計算の検算(手計算の値と比べる)。実行: node tests/sedori/test_calc.js [公開フォルダ]
// 公開フォルダの既定は ../kt-zs-sedori-ghp(gh-pages の作業ツリー)。計算式の根拠は各行のコメント。
const path = require('path'), fs = require('fs'), assert = require('assert');
const root = process.argv[2] || path.join(__dirname, '../../../kt-zs-sedori-ghp');
const SD = require('./_dir')(root);  // 準備中の間はテスト用の写しを読む
const C = require(path.join(root, SD, 'assets/calc.js'));
const fees = JSON.parse(fs.readFileSync(path.join(root, SD, 'data/fees.json'), 'utf8'));
let n = 0;
function eq(a, b, msg) { assert.strictEqual(a, b, `${msg}: 実際 ${a} / 期待 ${b}`); n++; }
const cat = id => C.findCategory(fees, id);
const tier = id => C.findFbaTier(fees, id);

// 1. 販売手数料(税込)
eq(C.referralFee(3980, cat('toys')), 455, 'おもちゃ3,980円: 3980×10.4%=413.92→414、×1.1=455.4→455');
eq(C.referralFee(5000, cat('clothes')), 594, '服5,000円: 3000×12.4%+2000×8.4%=540、×1.1=594');
eq(C.referralFee(2800, cat('clothes')), 382, '服2,800円: 2800×12.4%=347.2→347、×1.1=381.7→382');
eq(C.referralFee(700, cat('beauty')), 39, 'ビューティ700円: 700×5%=35、×1.1=38.5→39');
eq(C.referralFee(500, cat('toys')), 33, 'おもちゃ500円: 25円→最低30円、×1.1=33');
eq(C.referralFee(1200, cat('food')), 111, '食品1,200円: 1200×8.4%=100.8→101、×1.1=111.1→111');
eq(C.referralFee(20000, cat('jewelry')), 1848, 'ジュエリー20,000円: 10000×10.4%+10000×6.4%=1680、×1.1=1848');
eq(C.referralFee(750, cat('home')), 42, '750円ちょうどは5%: 37.5→38、×1.1=41.8→42');
eq(C.referralFee(751, cat('home')), 128, '751円は15.4%: 115.654→116、×1.1=127.6→128');

// 2. FBA配送代行手数料(税込・1,000円以下/超)
eq(C.fbaFee(1000, tier('small'), fees), 222, '小型・1,000円ちょうど=以下の料金');
eq(C.fbaFee(1001, tier('small'), fees), 288, '小型・1,001円');
eq(C.fbaFee(3980, tier('std2c'), fees), 420, '標準2c・3,980円');
eq(C.guessFbaTier(fees, [20, 15, 1.5], 200).id, 'small', '20×15×1.5cm 200g → 小型');
eq(C.guessFbaTier(fees, [30, 25, 3], 800).id, 'std1', '30×25×3cm 800g → 標準1');
eq(C.guessFbaTier(fees, [15, 12, 10], 600).id, 'std2c', '3辺合計37cm 600g → 標準2c');
eq(C.guessFbaTier(fees, [40, 30, 20], 4000).id, 'std4', '3辺合計90cm 4kg → 標準4');
eq(C.guessFbaTier(fees, [50, 40, 30], 8000).id, 'large4', '3辺合計120cm 8kg → 大型4');

// 3. ポイント(税抜×還元率、切り捨て)
eq(C.points(2500, 0.10), 227, '2,500円×10%: 2500÷1.1=2272.7×10%=227.27→227');
eq(C.points(2500, 0.10, false), 250, '税込で計算する設定なら250');

// 4. Amazon FBA の利益(例A)
const A = { sell: 3980, category: 'toys', fbaTier: 'std2c', cost: 2500, inShip: 0, inbound: 100, other: 0, pointRate: 0.10 };
const rA = C.amazonProfit(fees, A);
eq(rA.referral, 455, '例A 販売手数料');
eq(rA.fba, 420, '例A FBA');
eq(rA.points, 227, '例A ポイント');
eq(rA.profit, 732, '例A 利益: 3980-455-420-100-2500+227=732');
eq(rA.profitNoPoints, 505, '例A ポイント抜きの利益: 505');
eq(Math.round(rA.margin * 1000), 184, '例A 利益率 18.4%');
eq(C.amazonProfit(fees, Object.assign({}, A, { usePoints: false })).profit, 505, '例A ポイントを含めない設定');
// 損益分岐の販売価格: P-手数料(P) >= 2793 になる最小のP。3154: 328→361、3154-361=2793 / 3153: 327.9→328→361、2792
eq(C.amazonBreakEvenSell(fees, A), 3154, '例A 損益分岐の販売価格');
// 利益率15%を守れる仕入れ上限: 必要利益597。C - floor(C/11) <= 2408 → 2648(240)=2408 / 2649(240)=2409
eq(C.amazonMaxCost(fees, A, 0.15), 2648, '例A 仕入れ上限(利益率15%)');
// 自己発送: FBA手数料なし・納品送料なし・自分の送料
const rS = C.amazonProfit(fees, Object.assign({}, A, { selfShip: true, selfShipCost: 600 }));
eq(rS.profit, 3980 - 455 - 600 - 2500 + 227, '例A 自己発送(送料600円)');

// 5. メルカリ(手数料10%・切り捨て)
eq(C.marketFee(3333, 0.10), 333, 'メルカリ手数料 3,333円→333');
const m1 = C.marketProfit({ sell: 3000, rate: 0.10, shipFee: 215, material: 65, cost: 1500 });
eq(m1.profit, 920, 'メルカリ3,000円 ゆうパケットポスト(215+箱65) 仕入れ1,500 → 3000-300-280-1500=920');
eq(C.marketPriceFor({ rate: 0.10, shipFee: 210, material: 0, cost: 1500 }, 1000), 3011,
  '利益1,000円を残す最安価格: 3011(手数料301)→1000 / 3010(手数料301)→999');

// 6. ヤフオク→メルカリ(例)
const y = C.marketProfit({ sell: 4500, rate: 0.10, shipFee: 750, material: 0, cost: 2000 + 800 });
eq(y.profit, 500, 'ヤフオク2,000円+送料800円→メルカリ4,500円 宅急便60: 4500-450-750-2800=500');

// 7. 業者オークション→メルカリ(例): 落札10,000円税別、落札料1,000円税別、送料1,500円、5個口
const u = C.auctionUnitCost({ bid: 10000, bidTaxExcluded: true, fee: 1000, feeTaxExcluded: true, ship: 1500, other: 0, qty: 5 });
eq(u.total, 13600, '業者オークション 合計: 11000+1100+1500=13600');
eq(u.unit, 2720, '業者オークション 1個あたり: 13600÷5=2720');
eq(C.marketProfit({ sell: 4000, rate: 0.10, shipFee: 450, material: 70, cost: u.unit }).profit, 360,
  '1個4,000円 宅急便コンパクト(450+70): 4000-400-520-2720=360');
eq(C.auctionUnitCost({ bid: 1000, fee: 0, ship: 0, qty: 3 }).unit, 334, '1,000円÷3個は切り上げ334円');

// 8. CSV・JAN
eq(C.toCSV(['a', 'b'], [['=1+1', 'x,"y"']]), '﻿a,b\r\n\'=1+1,"x,""y"""\r\n', 'CSVのエスケープ');
eq(C.janValid('4901777018686'), true, 'JANのチェックデジット(正)');
eq(C.janValid('4901777018687'), false, 'JANのチェックデジット(誤)');
eq(C.extractJan('サントリー 天然水 JAN:4901777018686 24本'), '4901777018686', '商品名からJAN');

// 9. fees.json の形
eq(fees.checked, '2026-10-27', '確認日');
eq(fees.mercari.rate, 0.10, 'メルカリ10%');
eq(fees.yahuoku.rate, 0.10, 'ヤフオク10%');
assert.ok(fees.sources.length >= 8 && fees.sources.every(s => /^https:\/\//.test(s.url)), '出典URL'); n++;


// 10. 業者オークションの手数料プリセット
const eco = fees.auctions.presets.find(p => p.id === 'ecoring'), dai = fees.auctions.presets.find(p => p.id === 'daikichi');
eq(C.auctionFee(eco, 10000), 500, 'エコオク 1万円まで500円');
eq(C.auctionFee(eco, 10001), 1000, 'エコオク 1万1円は1,000円');
eq(C.auctionFee(eco, 50000), 2000, 'エコオク 5万円は2,000円');
eq(C.auctionFee(dai, 30000), 1500, '大吉 3万円×5%=1,500円');
eq(C.auctionFee(dai, 30000, 0.03), 900, '大吉 3万円×3%=900円');
// 大吉で3万円(税別)を落札、手数料5%(税別)、参加費3,000円をその回の3点で割る(1,000円)、送料1,000円、1点
const d1 = C.auctionUnitCost({ bid: 30000, bidTaxExcluded: true, fee: 1500, feeTaxExcluded: true, ship: 1000, other: 1000, qty: 1 });
eq(d1.unit, 33000 + 1650 + 1000 + 1000, '大吉の例 1点の原価 36,650円');
// 無在庫型(Amazon中古・自己発送): 新品12,800円の15%引き→10,880円、おもちゃ、ヤフオク6,000円+送料800円、発送代行900円
const mz = C.amazonProfit(fees, { sell: 10880, category: 'toys', cost: 6000, inShip: 800, selfShip: true, selfShipCost: 900, usePoints: false });
// 10880×10.4%=1131.52→1132、×1.1=1245.2→1245。10880-1245-900-6000-800=1935
eq(mz.profit, 1935, '無在庫型の例 利益');

// 11. 目標利益(円/%)を満たす販売価格
// 例A・目標1,000円: P-手数料 >= 3793。4283: 445.43→445→490、4283-490=3793 / 4282: 445→490、3792
eq(C.amazonPriceFor(fees, A, { mode: 'yen', value: 1000 }), 4283, '例A 利益1,000円を残す販売価格');
const pA = C.amazonPriceFor(fees, A, { mode: 'pct', value: 15 });
eq(C.amazonProfit(fees, Object.assign({}, A, { sell: pA })).profit >= Math.ceil(pA * 0.15), true, '例A 利益率15%の価格は条件を満たす');
eq(C.amazonProfit(fees, Object.assign({}, A, { sell: pA - 1 })).profit >= Math.ceil((pA - 1) * 0.15), false, '1円下では満たさない');
eq(C.amazonMaxCost(fees, A, { mode: 'yen', value: 597 }), 2648, '仕入れ上限 目標597円(=15%と同額)');
// メルカリ・目標20%: P - floor(0.1P) - 1710 >= ceil(0.2P)。2443: 244→489、ceil(488.6)=489 / 2442: 244→488 < 489
eq(C.marketPriceFor({ rate: 0.10, shipFee: 210, material: 0, cost: 1500 }, { mode: 'pct', value: 20 }), 2443, 'メルカリ 利益率20%の価格');
eq(C.marketPriceFor({ rate: 0.10, shipFee: 210, material: 0, cost: 1500 }, { mode: 'yen', value: 1000 }), 3011, 'メルカリ 目標1,000円({mode:yen})');
eq(C.marketPriceFor({ rate: 0.10, shipFee: 0, material: 0, cost: 100 }, { mode: 'pct', value: 95 }), null, '手数料+目標が100%以上なら届かない');

// 12. 発送のしかた(自分で発送 / 発送代行)
eq(fees.self_ship.carriers.every(c => c.id === 'custom' || c.fee > 0), true, '運送会社の料金が入っている');
eq(C.carrierCost(fees, 'clickpost'), 240, 'クリックポスト240円(2026年10月1日改定)');
eq(C.carrierCost(fees, 'yupacket'), 360, 'ゆうパケット一律360円');
eq(C.carrierCost(fees, 'ycompact'), 720, '宅急便コンパクト650円+専用BOX70円');
eq(C.carrierCost(fees, 'custom', 555), 555, '自分で入力');
const W = fees.warehouse.defaults;
eq(C.warehouseCost('self', W), 0, '自分で発送は倉庫の費用なし');
eq(C.warehouseCost('3pl', { in: 50, store: 100, photo: 300, out: 300 }), 750, '発送代行 50+100+300+300');
eq(C.statusFlow('self').join('→'), '仕入れ済→出品中→売約→発送済', '自分で発送は入庫なし');
eq(C.statusFlow('3pl').join('→'), '仕入れ済→入庫→出品中→売約→発送済', '発送代行は入庫あり');
// 無在庫の例を両方の発送のしかたで: 10,880円・おもちゃ・ヤフオク6,000+800
const mzBase = { sell: 10880, category: 'toys', cost: 6000, inShip: 800, selfShip: true, usePoints: false };
// 自分で発送・ゆうパック60(970): 10880-1245-970-6800 = 1865
eq(C.amazonProfit(fees, Object.assign({}, mzBase, { selfShipCost: C.carrierCost(fees, 'yp60'), other: C.warehouseCost('self', W) })).profit, 1865, '無在庫 自分で発送(ゆうパック60)');
// 発送代行: さらに倉庫750円 → 1115
eq(C.amazonProfit(fees, Object.assign({}, mzBase, { selfShipCost: C.carrierCost(fees, 'yp60'), other: C.warehouseCost('3pl', { in: 50, store: 100, photo: 300, out: 300 }) })).profit, 1115, '無在庫 発送代行(倉庫750円)');
// メルカリ: 3,000円 宅急便60(750)・仕入れ1,500 → 自分で発送 3000-300-750-1500=450 / 発送代行 450-750=-300
eq(C.marketProfit({ sell: 3000, rate: 0.10, shipFee: 750, material: 0, cost: 1500, other: C.warehouseCost('self', W) }).profit, 450, 'メルカリ 自分で発送');
eq(C.marketProfit({ sell: 3000, rate: 0.10, shipFee: 750, material: 0, cost: 1500, other: 750 }).profit, -300, 'メルカリ 発送代行');
// 目標の売値も倉庫の費用で上がる
eq(C.marketPriceFor({ rate: 0.10, shipFee: 750, material: 0, cost: 1500, other: 750 }, 0) > C.marketPriceFor({ rate: 0.10, shipFee: 750, material: 0, cost: 1500, other: 0 }, 0), true, '発送代行は損益分岐が上がる');

console.log(`OK ${n}件`);
