// 取引相手の情報の取り出し(貼り付け)と、売り手の確認の判定の検算。実行: node tests/sedori/test_party.js [公開フォルダ]
const path = require('path'), assert = require('assert');
const root = process.argv[2] || path.join(__dirname, '../../../kt-zs-sedori-ghp');
const SD = require('./_dir')(root);  // 準備中の間はテスト用の写しを読む
// ブラウザの最小の代わり(ui.js は画面の部品なので、読み込めるだけの形を用意する)
global.window = { matchMedia: () => ({ matches: false }) };
global.location = { hash: '', search: '', protocol: 'http:' };
global.navigator = {};
global.document = { readyState: 'complete', body: { getAttribute: () => null }, addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } };
const mem = {};
global.localStorage = { getItem(k) { return k in mem ? mem[k] : null; }, setItem(k, v) { mem[k] = String(v); }, removeItem(k) { delete mem[k]; } };
global.fetch = () => new Promise(() => {});
window.SedoriCalc = require(path.join(root, SD, 'assets/calc.js'));
window.SedoriSellerCheck = require(path.join(root, SD, 'assets/seller-check.js'));
require(path.join(root, SD, 'assets/ui.js'));
const U = window.SedoriUI;
let n = 0;
function eq(a, b, msg) { assert.deepStrictEqual(a, b, `${msg}: 実際 ${JSON.stringify(a)} / 期待 ${JSON.stringify(b)}`); n++; }

// 1. ヤフオク取引ナビ風(全角数字・全角ハイフン・〒・様・建物名の改行・URL)
const a = U.parseParty('【取引ナビ】\n出品者：佐藤　花子\n〒１５０－０００２\n東京都渋谷区渋谷２丁目２１－１\n渋谷ハイツ３０２号室\nＴＥＬ（０３）１２３４－５６７８\nhanako@example.com\nhttps://page.auctions.yahoo.co.jp/jp/auction/n1234567890');
eq(a.pName, '佐藤 花子', '氏名(見出し付き・全角空白)');
eq(a.pZip, '150-0002', '郵便番号(全角)');
eq(a.pAddr, '東京都渋谷区渋谷2丁目21-1 渋谷ハイツ302号室', '住所(建物名の行をつなぐ)');
eq(a.pTel, '03-1234-5678', '電話(括弧つき)');
eq(a.pMail, 'hanako@example.com', 'メール');
eq(a.ref, 'https://page.auctions.yahoo.co.jp/jp/auction/n1234567890', 'URL');
// 2. 「様」で終わる行、長音記号のハイフン
const b = U.parseParty('山本 健一 様\n〒５３０ー０００１\n大阪府大阪市北区梅田１ー２ー３\n電話番号：０９０ー１２３４ー５６７８');
eq([b.pName, b.pZip, b.pAddr, b.pTel], ['山本 健一', '530-0001', '大阪府大阪市北区梅田1-2-3', '090-1234-5678'], '様・長音のハイフン');
// 3. 見出しなし(郵便番号の前の短い行を氏名に)、ハイフンなしの携帯
const c = U.parseParty('出品者情報\n高橋 誠\n123-4567\n神奈川県横浜市西区みなとみらい1-1-1\n09011112222');
eq([c.pName, c.pTel], ['高橋 誠', '090-1111-2222'], '見出しなし');
eq(U.partyFromUrl('https://jp.mercari.com/transaction/m123'), 'メルカリ', 'URLから仕入れ先');

// 3b. 職業・年齢(見出し付きの行だけ)
const d = U.parseParty('氏名: 山田 太郎\n〒100-0001\n東京都千代田区千代田1-1\n職業：会社員\n年齢：４０');
eq(d.pJob, '会社員', '職業を取り出す');
eq(d.pAge, '40', '年齢を取り出す(全角数字も)');
eq(U.parseParty('山本 健一 様\n大阪府大阪市北区梅田1-2-3').pJob, undefined, '見出しが無ければ職業は取らない');

// 4. 売り手の確認の判定
eq(U.checkState({ cond: '新品', unit: 30000 }), 'na', '新品は不要');
eq(U.checkState({ cond: '中古', unit: 9999 }), 'na', '中古1万円未満は不要');
eq(U.checkState({ cond: '中古', unit: 10000 }), 'need', '中古1万円以上は未入力');
eq(U.checkState({ cond: '中古', unit: 500, media: true }), 'need', 'ゲーム等は金額を問わず');
eq(U.checkState({ cond: '中古', unit: 500, hinmoku: '書籍' }), 'need', '書籍は金額を問わず');
eq(U.checkState({ cond: '中古', unit: 3000, name: 'ダイキン エアコン 室外機 RZRP' }), 'need', '室外機は金額を問わず(2025年10月1日から)');
eq(U.checkState({ cond: '中古', unit: 800, name: 'VVFケーブル 電線 2.0mm 100m' }), 'need', '電線は金額を問わず');
eq(U.checkState({ cond: '中古', unit: 1500, name: '金属製グレーチング 300幅' }), 'need', '金属製グレーチングは金額を問わず');
eq(U.checkState({ cond: '新品', unit: 1500, name: 'グレーチング 新品' }), 'na', '新品は対象外');
eq(U.checkState({ cond: '中古', unit: 2000, name: 'エコキュート ヒートポンプユニット' }), 'need', '電気温水機器のヒートポンプは金額を問わず(2025年10月1日から)');
eq(U.checkState({ cond: '中古', unit: 6000, qty: 2 }), 'need', '1万円は対価の総額: 6,000円×2個=12,000円は必要');
eq(U.checkState({ cond: '中古', unit: 4000, qty: 2 }), 'na', '4,000円×2個=8,000円は不要');
eq(U.checkState({ cond: '中古', unit: 12000, pName: 'a', pAddr: 'b' }), 'need', '確認方法が無いと未入力');
eq(U.checkState({ cond: '中古', unit: 12000, pName: 'a', pAddr: 'b', verify: '本人限定受取郵便で確認' }), 'ok', '氏名・住所・確認方法で済');
eq(U.checkState({ cond: '中古', unit: 40000, verify: '古物商・法人から購入' }), 'ok', '古物商・法人から');
eq(U.checkState({ cond: '中古', unit: 12000, pName: 'a', pAddr: 'b', verify: '1万円未満のため不要' }), 'need', '1万円以上なのに「1万円未満のため不要」は済にしない');
eq(U.checkState({ cond: '中古', unit: 800, name: 'USB 充電ケーブル 電線' }), 'na', '充電ケーブルは電線の対象外');
eq(U.checkState({ cond: '中古', unit: 800, name: 'コンクリート製グレーチング' }), 'na', 'コンクリート製のグレーチングは対象外');
eq(U.checkReason({ cond: '中古', unit: 800, media: true }), 'ゲーム・CD・DVD・書籍・バイク等', '理由: ゲーム等の印');
eq(U.checkReason({ cond: '中古', unit: 800, hinmoku: '自動二輪車及び原動機付自転車' }), 'バイク・原付(部品を含む)', '理由: バイク');
// 同じ日に同じ売り手から買った行は1回の取引として合計する(台帳に入れて判定)
{
  const SC = window.SedoriSellerCheck;
  const rows = [
    { id: 'x1', date: '2026-10-01', cond: '中古', unit: 6000, pName: '山田 太郎', party: 'ジモティー 個人' },
    { id: 'x2', date: '2026-10-01', cond: '中古', unit: 5000, pName: '山田太郎', party: 'ジモティー 個人' },
    { id: 'x3', date: '2026-10-01', cond: '中古', unit: 5000, party: 'メルカリ 出品者' },
    { id: 'x4', date: '2026-10-01', cond: '中古', unit: 6000, party: 'メルカリ 出品者' },
    { id: 'x5', date: '2026-10-02', cond: '中古', unit: 6000, pName: '山田 太郎' }
  ];
  const t = SC.txTotals(rows);
  eq([t.x1, t.x2], [11000, 11000], '同じ日・同じ氏名は合計(空白の違いは同じ人)');
  eq([t.x3, t.x4], [5000, 6000], '「メルカリ 出品者」だけでは同じ取引とみなさない');
  eq(t.x5, 6000, '別の日は別の取引');
  eq(SC.reason(rows[0], t.x1), '同じ取引の合計が1万円以上', '理由: 同じ取引の合計');
  localStorage.setItem('zw-sedori:ledger', JSON.stringify(rows));
  eq(U.checkState(rows[1]), 'need', '台帳の中で合計して判定');
  eq(U.checkState(rows[2]), 'na', '合計しない行は1行で判定');
  localStorage.removeItem('zw-sedori:ledger');
}

// 5. 古物台帳の書き出しの形
const rows = U.kobutsuRows([{ date: '2026-10-27', hinmoku: '道具類', name: 'x', qty: 2, unit: 1500, saleDate: '2026-10-30', salePrice: 2500, saleParty: 'メルカリ 購入者' }]);
eq(rows[0].slice(0, 8), [1, '2026-10-27', '買受け', '道具類', 'x', '', 2, 3000], '受入れの列');
eq(rows[0].slice(18, 22), ['2026-10-30', '売却', 5000, 'メルカリ 購入者'], '払出しの列');
eq(U.K_HEAD.length, rows[0].length, '見出しと列の数');
// 6. 台帳の状態の流れ(発送のしかたごと)
global.setTimeout = global.setTimeout || (f => f());
const L = U.ledger;
localStorage.setItem('zw-sedori:ship', '"self"');
const s1 = L.add({ name: '自分で発送の品', unit: 1000, sellPrice: 2000, sellTo: 'メルカリ' }, true);
eq([s1.ship, s1.recvId], ['self', '自宅'], '自分で発送: 受取先は自宅');
eq(L.advance(s1.id).status, '出品中', '自分で発送: 仕入れ済の次は出品中(入庫なし)');
const sold = L.advance(s1.id);
eq([sold.status, sold.salePrice, sold.saleParty], ['売約', 2000, 'メルカリ 購入者'], '売れたで売却欄を自動記入');
eq(L.advance(s1.id).status, '発送済', '発送済');
localStorage.setItem('zw-sedori:ship', '"3pl"');
const s2 = L.add({ name: '発送代行の品', unit: 1000 }, true);
eq([s2.ship, s2.recvId], ['3pl', ''], '発送代行: 受取先は代行の受付番号を入れる');
eq(L.advance(s2.id).status, '入庫', '発送代行: 仕入れ済の次は入庫');
const s3 = L.add({ name: 'FBAの品', unit: 1000, ship: 'fba' }, true);
eq([s3.recvId, L.advance(s3.id).status], ['Amazon FBA', '入庫'], 'FBA: Amazonの倉庫に入庫');
eq(U.nextLabel({ ship: 'self', status: '出品中' }), '売れた', '出品中の次のボタンは売れた');
eq(U.whTotal({ warehouse: { defaults: { in: 50, store: 100, photo: 300, out: 300 } } }), 750, '発送代行の費用の合計');
localStorage.setItem('zw-sedori:ship', '"self"');
eq(U.whTotal({ warehouse: { defaults: { in: 50, store: 100, photo: 300, out: 300 } } }), 0, '自分で発送は0円');

console.log(`OK ${n}件`);
