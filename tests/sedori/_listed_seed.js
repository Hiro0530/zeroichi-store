// 撮影と試験で使う見本(本物らしい名前・長い名前・空の値を混ぜる)
const now = Date.now(), M = 60000;
const calc = { category: 'electronics', fbaTier: 'small', selfShip: true, selfShipCost: 520, inbound: 0, other: 0, inShip: 0, pointRate: 0, usePoints: false };
const src = (shop, code, base, extra) => Object.assign({ mall: 'rakuten', code, shop, shopCode: code.split(':')[0], url: 'https://item.rakuten.co.jp/' + code.replace(':', '/') + '/', base, name: '', freeShip: true, pt: 1 }, extra || {});
const items = [
  { id: 'z1', sku: 'AB-0012', asin: 'B0C8XK2M4T', name: 'ワイヤレスイヤホン ノイズキャンセリング ブラック', price: 6980, qty: 1, jan: '4901234500012', src: [src('でんき屋ミナト 楽天市場店', 'minato:10001234', 4280), src('オーディオ専科', 'audio-senka:500231', 4380)], calc,
    st: 'stop', why: ['out', 'few'], stAt: now - 4 * M, chk: { t: now - 4 * M, fails: 0, stock: false, shops: 1, price: null }, from: 'report' },
  { id: 'z2', sku: 'AB-0031', asin: 'B09QW7LMN2', name: '電気ケトル 1.0L 温度調節つき ステンレス', price: 4480, qty: 1, jan: '4901234500029', src: [src('キッチンのタナカ', 'k-tanaka:880021', 2580), src('くらしの雑貨 ハレ', 'hare-zakka:3301', 2640), src('家電ランド', 'kaden-land:77102', 2700)], calc,
    st: 'stop', why: ['profit'], stAt: now - 4 * M, chk: { t: now - 4 * M, fails: 0, stock: true, shops: 3, price: 3380, profit: -120, floor: 672 }, from: 'report' },
  { id: 'z3', sku: 'AB-0044', asin: 'B0BXYZ1234', name: 'モバイルバッテリー 10000mAh 薄型 PD対応 20W ホワイト(USB-Cケーブル付属・PSE適合・機内持ち込み可)長い名前の見本でも2行で切れることを確かめる', price: 3980, qty: 2, jan: '4901234500036', src: [src('スマホアクセのコトブキ', 'kotobuki-acc:20450', 1980), src('でんき屋ミナト 楽天市場店', 'minato:10004455', 2080), src('モバイル工房', 'mobile-kobo:9120', 2100)], calc,
    st: 'watch', chk: { t: now - 3 * M, fails: 0, stock: true, shops: 3, price: 1980, profit: 1240, floor: 597 }, from: 'report' },
  { id: 'z4', sku: 'AB-0052', asin: 'B0D1ABCD99', name: 'シリコン調理スプーン 5本セット', price: 2480, qty: 1, jan: '4901234500043', src: [src('キッチンのタナカ', 'k-tanaka:880455', 1180), src('くらしの雑貨 ハレ', 'hare-zakka:5102', 1210)], calc,
    st: 'watch', chk: { t: now - 3 * M, fails: 0, stock: true, shops: 2, price: 1180, profit: 386, floor: 372 }, from: 'report' },
  { id: 'z5', sku: 'AB-0060', asin: 'B0CC55ZZ01', name: '卓上加湿器 超音波式 300ml', price: 3280, qty: 1, jan: '4901234500050', src: [src('家電ランド', 'kaden-land:77300', 1680), src('でんき屋ミナト 楽天市場店', 'minato:10007001', 1700)], calc,
    st: 'back', why: [], stAt: now - 20 * M, clear: 2, chk: { t: now - 3 * M, fails: 0, stock: true, shops: 2, price: 1680, profit: 742, floor: 492 }, from: 'report' },
  { id: 'z6', sku: 'AB-0071', asin: 'B0AA11BB22', name: 'LEDデスクライト 充電式 3段階調光', price: 3680, qty: 0, jan: '4901234500067', src: [src('ライトのあかり堂', 'akarido:4400', 2100)], calc,
    st: 'stopped', why: ['out'], stAt: now - 180 * M, upAt: now - 170 * M, chk: { t: now - 3 * M, fails: 0, stock: false, shops: 0, price: null }, from: 'report' },
  { id: 'z7', sku: 'AB-0085', asin: 'B0EE99FF00', name: '', price: 5480, qty: 1, jan: '', src: [], from: 'report' },
  { id: 'z8', sku: '', asin: 'B0GG22HH33', name: 'ヨガマット 6mm 収納ケースつき', price: 2980, qty: 1, jan: '4901234500081', src: [src('スポーツのヤマネ', 'yamane-sp:3100', 1480)], calc, st: 'watch', chk: {}, from: 'manual' }
];
const keys = { rkApp: 'app', rkKey: 'key' };
const market = {   // にせの楽天の品ぞろえ(JANごと)
  '4901234500012': [{ code: 'minato:10001234', shop: 'でんき屋ミナト 楽天市場店', price: 4280, stock: false, name: 'ワイヤレスイヤホン ノイズキャンセリング ブラック' }, { code: 'audio-senka:500231', shop: 'オーディオ専科', price: 4380, name: 'ワイヤレスイヤホン NC 黒' }],
  '4901234500029': [{ code: 'k-tanaka:880021', shop: 'キッチンのタナカ', price: 3380, name: '電気ケトル 1.0L 温度調節' }, { code: 'hare-zakka:3301', shop: 'くらしの雑貨 ハレ', price: 3400, name: '電気ケトル 1.0L' }, { code: 'kaden-land:77102', shop: '家電ランド', price: 3450, name: '電気ケトル' }],
  '4901234500036': [{ code: 'kotobuki-acc:20450', shop: 'スマホアクセのコトブキ', price: 1980, name: 'モバイルバッテリー 10000mAh 薄型' }, { code: 'minato:10004455', shop: 'でんき屋ミナト 楽天市場店', price: 2080, name: 'モバイルバッテリー 10000mAh' }, { code: 'mobile-kobo:9120', shop: 'モバイル工房', price: 2100, name: 'モバイルバッテリー' }],
  '4901234500043': [{ code: 'k-tanaka:880455', shop: 'キッチンのタナカ', price: 1180, name: 'シリコン調理スプーン 5本セット' }, { code: 'hare-zakka:5102', shop: 'くらしの雑貨 ハレ', price: 1210, name: 'シリコン スプーン 5本' }],
  '4901234500050': [{ code: 'kaden-land:77300', shop: '家電ランド', price: 1680, name: '卓上加湿器 超音波式' }, { code: 'minato:10007001', shop: 'でんき屋ミナト 楽天市場店', price: 1700, name: '卓上加湿器' }],
  '4901234500067': [{ code: 'akarido:4400', shop: 'ライトのあかり堂', price: 2100, stock: false, name: 'LEDデスクライト' }],
  '4901234500081': [{ code: 'yamane-sp:3100', shop: 'スポーツのヤマネ', price: 1480, name: 'ヨガマット 6mm 収納ケースつき' }, { code: 'fit-life:220', shop: 'フィットライフ', price: 1520, name: 'ヨガマット 6mm' }, { code: 'outdoor-nagi:801', shop: 'アウトドアなぎ', price: 1600, free: false, name: 'ヨガマット' }],
  '4901234500098': [{ code: 'bunbougu-sato:120', shop: '文具のさとう', price: 880, name: 'ノートパソコンスタンド 折りたたみ アルミ' }, { code: 'pc-parts-ao:5500', shop: 'PCパーツ あお', price: 920, name: 'ノートPCスタンド アルミ' }, { code: 'minato:10009900', shop: 'でんき屋ミナト 楽天市場店', price: 980, name: 'ノートパソコン スタンド' }]
};
const report = ['seller-sku\tasin1\titem-name\tprice\tquantity\titem-condition\tfulfillment-channel\tstatus',
  'AB-0012\tB0C8XK2M4T\tワイヤレスイヤホン ノイズキャンセリング ブラック\t6980\t1\t11\tDEFAULT\tActive',
  'AB-0031\tB09QW7LMN2\t電気ケトル 1.0L 温度調節つき ステンレス\t4480\t1\t11\tDEFAULT\tActive',
  'AB-0090\tB0HH44JJ55\tノートパソコンスタンド 折りたたみ アルミ\t2280\t1\t11\tDEFAULT\tActive',
  'FBA-0001\tB0KK66LL77\tAmazonの倉庫にある品\t1980\t12\t11\tAMAZON_JP\tActive'].join('\n');
module.exports = { items, keys, market, report, calc, now };
