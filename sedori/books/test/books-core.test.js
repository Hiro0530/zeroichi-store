/* 帳簿の計算の検算: node --test sedori/books/test/ */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const B = require('../assets/books-core.js');
const F = (n) => path.join(__dirname, 'fixtures', n);
const txt = (n) => B.decode(fs.readFileSync(F(n))).text;

/* ---------- 文字・数字・日付 ---------- */
test('金額の読み取り', () => {
  assert.equal(B.num('¥1,234'), 1234);
  assert.equal(B.num('-¥300'), -300);
  assert.equal(B.num('(500)'), -500);
  assert.equal(B.num('▲200'), -200);
  assert.equal(B.num('１，２３４円'), 1234);
  assert.equal(B.num('+¥2,490'), 2490);
  assert.equal(B.num('−¥680'), -680);
  assert.equal(B.num(''), 0);
});
test('日付の読み取り', () => {
  assert.equal(B.date('2026/10/03 14:22:10 JST'), '2026-10-03');
  assert.equal(B.date('2026年10月12日 21:04'), '2026-10-12');
  assert.equal(B.date('Oct 2, 2026 1:02:03 AM PDT'), '2026-10-02');
  assert.equal(B.date('R8/10/1'), '2026-10-01');
  assert.equal(B.date('令和8年1月5日'), '2026-01-05');
  assert.equal(B.date('20261231'), '2026-12-31');
  assert.equal(B.date('10/05/2026'), '2026-10-05');
  assert.equal(B.date('10月20日', 2026), '2026-10-20');
  assert.equal(B.date('不明'), '');
});
test('CSV: 引用符・改行・BOM・TSV', () => {
  const r = B.parseCSV('﻿a,"b,c","d ""e"""\r\n1,"x\ny",3\n');
  assert.deepEqual(r, [['a', 'b,c', 'd "e"'], ['1', 'x\ny', '3']]);
  assert.deepEqual(B.parseCSV('日付\t金額\n2026/1/1\t100'), [['日付', '金額'], ['2026/1/1', '100']]);
});
test('Shift_JIS のファイルも読める', () => {
  const d = B.decode(fs.readFileSync(F('amazon_jp_daterange_sjis.csv')));
  assert.equal(d.enc, 'Shift_JIS');
  assert.match(d.text, /トランザクションの種類/);
  const u = B.decode(fs.readFileSync(F('amazon_jp_daterange.csv')));
  assert.equal(u.enc, 'UTF-8');
});

/* ---------- Amazon ---------- */
test('Amazon 日付範囲レポート(日本語・前置きの説明つき)', () => {
  const t = txt('amazon_jp_daterange.csv');
  assert.equal(B.sniff(t), 'amazon');
  const r = B.parseAmazon(t);
  assert.ok(r.ok);
  assert.equal(r.rows.length, 8);
  assert.equal(r.warn.length, 0, JSON.stringify(r.warn));
  const kinds = r.rows.map((x) => x.kind);
  assert.deepEqual(kinds, ['order', 'order', 'order', 'refund', 'adjust', 'fee', 'fee', 'transfer']);
  const o1 = r.rows[0];
  assert.equal(o1.date, '2026-10-03');
  assert.equal(o1.order, '503-1234567-1234567');
  assert.equal(o1.asin, 'B0ABCDE123');
  assert.equal(o1.gross, 8800); assert.equal(o1.fee, 1490); assert.equal(o1.net, 7310);
  const o2 = r.rows[1];
  assert.equal(o2.jan, '4902370551259'); assert.equal(o2.qty, 2);
  const o3 = r.rows[2];
  assert.equal(o3.disc, -240); assert.equal(o3.gross + o3.disc - o3.fee, o3.net);
  const ref = r.rows[3];
  assert.equal(ref.gross, -8800); assert.equal(ref.fee, -844);
  assert.equal(r.rows[4].other, 1500);
  assert.equal(r.rows[5].fee, 312);
  assert.equal(r.rows[6].other, -5390);
  assert.equal(r.rows[7].net, -6000);
  // 合計が入金の合計と一致
  const sum = r.rows.reduce((s, x) => s + x.net, 0);
  assert.equal(sum, 7310 + 7897 + 2945 - 7956 + 1500 - 312 - 5390 - 6000);
  // 重複の判定キーは行ごとに違う
  assert.equal(new Set(r.rows.map((x) => x.key)).size, 8);
});
test('Amazon 英語の見出し', () => {
  const r = B.parseAmazon(txt('amazon_en_transaction.csv'));
  assert.ok(r.ok);
  assert.equal(r.rows.length, 3);
  assert.deepEqual(r.rows.map((x) => x.kind), ['order', 'refund', 'transfer']);
  assert.equal(r.rows[0].date, '2026-10-02');
  assert.equal(r.rows[0].fee, 4048);
  assert.equal(r.rows[0].jan, '4549660123456');
  assert.equal(r.rows[1].net, -35612);
});
test('Amazon: Shift_JIS 版も同じ結果', () => {
  const a = B.parseAmazon(txt('amazon_jp_daterange.csv')).rows.map((x) => x.key);
  const b = B.parseAmazon(txt('amazon_jp_daterange_sjis.csv')).rows.map((x) => x.key);
  assert.deepEqual(a, b);
});
test('Amazon: 合計がずれた行は警告して調整に入れる', () => {
  const t = txt('amazon_jp_daterange.csv').replace('"7,310"', '"7,300"');
  const r = B.parseAmazon(t);
  assert.equal(r.warn.length, 1);
  assert.equal(r.rows[0].other, -10);
});
test('種類の判定', () => {
  assert.equal(B.amzType('注文'), 'order');
  assert.equal(B.amzType('Order'), 'order');
  assert.equal(B.amzType('返金'), 'refund');
  assert.equal(B.amzType('Amazon マーケットプレイス保証請求'), 'refund');
  assert.equal(B.amzType('振込み'), 'transfer');
  assert.equal(B.amzType('調整'), 'adjust');
  assert.equal(B.amzType('FBA在庫関連の手数料'), 'fee');
  assert.equal(B.amzType('注文外料金'), 'fee');
  assert.equal(B.amzType('数量限定タイムセール手数料'), 'fee');
  assert.equal(B.amzType('Service Fee'), 'fee');
});

/* ---------- メルカリ ---------- */
test('メルカリ 取引画面の文字(2件まとめて)', () => {
  const t = txt('mercari_torihiki.txt');
  assert.equal(B.sniff(t), 'mercari');
  const r = B.parseMercari(t, { year: 2026 });
  assert.equal(r.rows.length, 2, JSON.stringify(r.rows));
  const a = r.rows[0], b = r.rows[1];
  assert.equal(a.name, 'ニンテンドースイッチ プロコントローラー 純正');
  assert.equal(a.gross, 6800); assert.equal(a.fee, 680); assert.equal(a.ship, 750); assert.equal(a.net, 5370);
  assert.equal(a.date, '2026-10-12'); assert.equal(a.order, 'm84719283745');
  assert.equal(b.name, 'ポケモンカード ピカチュウ プロモ PSA10');
  assert.equal(b.gross, 12000); assert.equal(b.fee, 1200); assert.equal(b.ship, 210); assert.equal(b.net, 10590);
  assert.equal(b.date, '2026-10-15'); assert.equal(b.order, 'm10293847561');
  assert.equal(r.warn.length, 0);
});
test('メルカリ 売上履歴の文字(利益だけ)', () => {
  const r = B.parseMercari(txt('mercari_rireki.txt'), { year: 2026 });
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].date, '2026-10-20');
  assert.equal(r.rows[0].net, 2370);
  assert.equal(r.rows[0].name, 'アネッサ パーフェクトUV スキンケアミルク');
  assert.equal(r.rows[1].net, 3210);
  assert.ok(r.rows[0].est.length);
});
test('メルカリ 手数料が無い貼り付けは10%で計算して印を付ける', () => {
  const r = B.parseMercari('Tシャツ\n商品代金 ¥2,000\n販売利益 ¥1,590\n購入日時 2026年9月1日', { year: 2026 });
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].fee, 200); assert.equal(r.rows[0].ship, 210);
  assert.ok(r.rows[0].est.some((x) => /10%/.test(x)));
});
test('メルカリ 1行に「：」区切り', () => {
  const r = B.parseMercari('商品名：ポーチ\n商品代金：¥1,500\n販売手数料：-¥150\n配送料：-¥210\n販売利益：¥1,140\n取引日：2026/10/01', {});
  assert.equal(r.rows[0].name, 'ポーチ');
  assert.equal(r.rows[0].net, 1140);
  assert.equal(r.rows[0].date, '2026-10-01');
});

/* ---------- 汎用CSV ---------- */
test('カード明細: 列の自動判定と科目の推測', () => {
  const t = txt('card_rakuten.csv');
  assert.equal(B.sniff(t), 'generic');
  const d = B.detectColumns(t);
  assert.equal(d.headerIdx, 0);
  assert.equal(d.header[d.map.date], '利用日');
  assert.equal(d.header[d.map.name], '利用店名・商品名');
  assert.equal(d.header[d.map.amount], '利用金額');
  assert.equal(d.kind, 'expense'); assert.ok(d.card);
  const a = B.applyMapping(d.rows, d.map, 'expense', { card: true });
  assert.equal(a.rows.length, 6);
  assert.deepEqual(a.rows.map((x) => x.acct), ['荷造運賃', '消耗品費', '通信費', '旅費交通費', '荷造運賃', '消耗品費']);
  assert.equal(a.rows[5].amount, -110);
});
test('カード明細 Shift_JIS', () => {
  const d = B.detectColumns(txt('card_rakuten_sjis.csv'));
  assert.equal(d.header[d.map.amount], '利用金額');
});
test('覚えた科目を優先', () => {
  assert.equal(B.guessAcct('ダイソー 渋谷店'), '消耗品費');
  const rules = {}; rules[B.payeeKey('ダイソー 渋谷店')] = '荷造運賃';
  assert.equal(B.guessAcct('ダイソー 渋谷店', rules), '荷造運賃');
});
test('汎用の売上CSV', () => {
  const d = B.detectColumns(txt('generic_sales.csv'));
  assert.equal(d.kind, 'sale');
  assert.equal(d.header[d.map.amount], '販売価格');
  assert.equal(d.header[d.map.fee], '手数料');
  assert.equal(d.header[d.map.ship], '送料');
  const a = B.applyMapping(d.rows, d.map, 'sale', { ch: 'ラクマ' });
  assert.equal(a.rows.length, 2);
  assert.equal(a.rows[0].gross, 24800); assert.equal(a.rows[0].fee, 1488); assert.equal(a.rows[0].ship, 750); assert.equal(a.rows[0].net, 22562);
  assert.equal(a.rows[0].order, 'R-0001');
});
test('見出しのないCSVは中身から推測', () => {
  const d = B.detectColumns('2026/10/01,ヤマト運輸,1860\n2026/10/02,ダイソー,880\n2026/10/03,ドコモ,7480\n');
  assert.equal(d.headerIdx, -1);
  assert.equal(d.map.date, 0); assert.equal(d.map.amount, 2); assert.equal(d.map.name, 1);
});
test('読めない行は飛ばして理由を返す', () => {
  const a = B.applyMapping([['', 'x', '100'], ['2026/1/1', 'y', '']], { date: 0, name: 1, amount: 2 }, 'expense', {});
  assert.equal(a.rows.length, 0); assert.equal(a.skipped.length, 2);
});

/* ---------- 経費 ---------- */
test('家事按分', () => {
  assert.equal(B.bizAmount({ amount: 7480, biz: 50 }), 3740);
  assert.equal(B.bizAmount({ amount: 1000 }), 1000);
  assert.equal(B.bizAmount({ amount: 1000, biz: 0 }), 0);
});
test('毎月の経費: まだ無い月だけ作る', () => {
  const rec = [{ id: 'r1', day: 27, acct: '通信費', amount: 3000, biz: 50, start: '2026-08' }];
  const have = [{ recurId: 'r1', date: '2026-08-27' }];
  const due = B.dueRecurring(rec, have, '2026-10-27');
  assert.deepEqual(due.map((x) => x.date), ['2026-09-27', '2026-10-27']);
  assert.equal(B.dueRecurring(rec, have, '2026-10-26').length, 1);
  assert.equal(B.dueRecurring([Object.assign({}, rec[0], { end: '2026-09' })], have, '2026-12-31').length, 1);
});

/* ---------- 台帳との照合・集計 ---------- */
const LEDGER = [
  { id: 'a', date: '2026-09-20', name: 'ポケモンカードゲーム スカーレット&バイオレット 拡張パック 超電ブレイカー BOX', feature: 'ASIN B0ABCDE123', cond: '新品', qty: 1, unit: 5500, party: '楽天市場 ホビーショップA', route: '楽天・Yahoo!→Amazon', sellTo: 'Amazon', sellPrice: 8800, profit: 1810 },
  { id: 'b', date: '2026-09-25', name: 'Nintendo Switch Proコントローラー', feature: 'JAN 4902370551259', cond: '新品', qty: 2, unit: 2900, party: 'Yahoo!ショッピング B店', route: '楽天・Yahoo!→Amazon', sellTo: 'Amazon', sellPrice: 4980, profit: 1000 },
  { id: 'c', date: '2026-08-01', name: '中古 ゲーム機 本体', cond: '中古', media: true, qty: 1, unit: 12000, party: 'メルカリ 出品者', route: 'メルカリ', sellTo: 'メルカリ', sellPrice: 20000, profit: 4000, saleDate: '2026-09-10', salePrice: 20000 },
  { id: 'd', date: '2025-12-10', name: '古い在庫 フィギュア', cond: '中古', qty: 1, unit: 3000, party: 'ヤフオク 出品者', route: 'ヤフオク→メルカリ', sellTo: 'メルカリ', sellPrice: 6000, profit: 2000 },
  { id: 'e', date: '2026-10-01', name: '無在庫の出品', wait: true, qty: 1, unit: 9999 },
  { id: 'f', date: '2026-03-05', name: 'ブランド 財布 中古', cond: '中古', qty: 1, unit: 15000, party: 'ジモティー 個人', pName: '山田太郎', pAddr: '東京都新宿区1-2-3', verify: '対面で身分証を確認', sellTo: 'メルカリ', sellPrice: 24000, profit: 5000 },
  { id: 'g', date: '2026-03-06', name: 'ゲームソフト 中古', cond: '中古', media: true, qty: 3, unit: 800, party: 'メルカリ 出品者', sellTo: 'Amazon', sellPrice: 2000, profit: 600 },
  { id: 'h', date: '2026-04-01', name: '中古 カメラレンズ', cond: '中古', qty: 1, unit: 4000, party: 'ハードオフ 渋谷店', sellTo: 'ヤフオク', sellPrice: 7000, profit: 2000 }
];
test('照合: ASIN・JAN・注文番号', () => {
  const r = B.parseAmazon(txt('amazon_jp_daterange.csv')).rows;
  const m1 = B.matchLedger(r[0], LEDGER);
  assert.deepEqual(m1, { id: 'a', by: 'asin', sure: true });
  const m2 = B.matchLedger(r[1], LEDGER);
  assert.equal(m2.id, 'b'); assert.equal(m2.by, 'jan');
  assert.equal(B.matchLedger(r[2], LEDGER), null); // アネッサは台帳に無い
  assert.equal(B.matchLedger(r[3], LEDGER), null); // 返金は照合しない
  assert.equal(B.matchLedger(r[0], LEDGER, { a: 1 }), null); // 使用済み
  const withOrder = LEDGER.concat([{ id: 'z', date: '2026-01-01', name: 'x', saleOrder: '503-1234567-1234567', saleDate: '2026-10-03' }]);
  assert.equal(B.matchLedger(r[0], withOrder).by, 'order');
  assert.equal(B.candidates({ name: 'ゲームソフト' }, LEDGER)[0].id, 'g');
});
function demoData() {
  const sales = B.parseAmazon(txt('amazon_jp_daterange.csv')).rows.map((s, i) => Object.assign({ id: 'S' + i }, s));
  sales[0].ledgerId = 'a'; sales[1].ledgerId = 'b';
  const ledger = LEDGER.map((r) => Object.assign({}, r));
  ledger[0].saleDate = '2026-10-03'; ledger[0].salePrice = 8800; ledger[0].saleRef = 'S0';
  ledger[1].saleDate = '2026-10-05'; ledger[1].salePrice = 4980; ledger[1].saleRef = 'S1';
  const expenses = [
    { id: 'x1', date: '2026-10-01', acct: '荷造運賃', amount: 1860, biz: 100 },
    { id: 'x2', date: '2026-10-05', acct: '通信費', amount: 7480, biz: 50 },
    { id: 'x3', date: '2026-03-10', acct: '消耗品費', amount: 880, biz: 100 }
  ];
  return { ledger, sales, expenses };
}
test('月ごとの利益', () => {
  const D = demoData(), m = B.monthly(D, 2026);
  assert.equal(m.months.length, 12);
  const oct = m.months[9];
  assert.equal(oct.ym, '2026-10');
  // 売上: 8800+9960+(3980-240)-8800 = 13700
  assert.equal(oct.sales, 13700);
  assert.equal(oct.cogs, 5500 + 5800);
  assert.equal(oct.fee, 1490 + 2063 + 795 - 844 + 312);
  assert.equal(oct.other, 1500 - 5390);
  assert.equal(oct.exp, 1860 + 3740);
  assert.equal(oct.profit, oct.sales + oct.other - oct.cogs - oct.fee - oct.ship - oct.exp);
  assert.equal(oct.nocost, 1); // アネッサ
  const sep = m.months[8];
  assert.equal(sep.sales, 20000); assert.equal(sep.cogs, 12000); assert.equal(sep.fee, 4000); assert.equal(sep.est, 1);
  assert.equal(m.total.sales, 33700);
});
test('ルート別・仕入れ先別', () => {
  const D = demoData();
  const r = B.groupBy(D, 2026, 'route');
  assert.ok(r.find((x) => x.key === '楽天・Yahoo!→Amazon'));
  const p = B.groupBy(D, 2026, 'party');
  assert.ok(p.find((x) => x.key === '楽天市場'));
  assert.ok(p.find((x) => x.key === 'メルカリ'));
});

/* ---------- 売れ残り ---------- */
test('売れ残りと損益ゼロの売値', () => {
  const s = B.stale(LEDGER, { days: 60, cats: {}, items: { h: 400 } }, '2026-10-27');
  const ids = s.map((x) => x.r.id);
  assert.ok(!ids.includes('c') && !ids.includes('e'));
  assert.equal(s[0].r.id, 'd'); assert.equal(s[0].days, 321); assert.ok(s[0].over);
  const h = s.find((x) => x.r.id === 'h'); assert.equal(h.limit, 400); assert.ok(!h.over);
  // d: 売値6000・利益2000・原価3000 → 売値に比例しない費用 = 6000-3000-2000-600 = 400 → (3000+400)/0.9 = 3778 → 3780
  assert.equal(s[0].be, 3780);
  assert.equal(s[0].suggest, 5400);
  // 予定売値が無い時は原価/(1-率)
  assert.equal(B.breakEven({ unit: 900, sellTo: 'メルカリ' }), 1000);
});

/* ---------- 棚卸 ---------- */
test('期末の在庫と評価(個別法・最終仕入原価法)', () => {
  const L = LEDGER.concat([{ id: 'b2', date: '2026-11-01', name: 'Nintendo Switch Proコントローラー', feature: 'JAN 4902370551259', qty: 1, unit: 3100 }]);
  const each = B.stocktake(L, '2026-12-31', 'each', {});
  assert.deepEqual(each.rows.map((x) => x.r.id).sort(), ['a', 'b', 'b2', 'd', 'f', 'g', 'h']);
  assert.equal(each.book, 5500 + 5800 + 3100 + 3000 + 15000 + 2400 + 4000);
  const last = B.stocktake(L, '2026-12-31', 'last', {});
  // 同じJANは最後の仕入れ値(3100)で評価
  assert.equal(last.book, 5500 + 6200 + 3100 + 3000 + 15000 + 2400 + 4000);
  // 実地で数えた
  const cnt = { b: 1, g: 3 };
  const t = B.stocktake(L, '2026-12-31', 'each', cnt);
  assert.equal(t.counted, 2);
  assert.equal(t.real, each.book - 2900);
  assert.equal(t.rows.find((x) => x.r.id === 'b').diff, -1);
  // 前の年の終わり
  assert.deepEqual(B.stockAt(L, '2025-12-31').map((r) => r.id), ['d']);
});
test('読み取りで実地の数を足す', () => {
  const t = B.stocktake(LEDGER, '2026-12-31', 'each', {}), counts = {};
  const a = B.countScan(t.rows, counts, '4902370551259');
  assert.equal(a.id, 'b'); assert.equal(a.count, 1); assert.equal(a.of, 2);
  B.countScan(t.rows, counts, '4902370551259');
  const c = B.countScan(t.rows, counts, '4902370551259');
  assert.ok(c.over); assert.equal(counts.b, 3);
  assert.equal(B.countScan(t.rows, counts, '0000000000000'), null);
});

/* ---------- 申告用の数字 ---------- */
test('確定申告用: 売上原価 = 期首 + 仕入 − 期末', () => {
  const D = demoData();
  const T = B.taxReport(D, 2026, { tax: 'exempt', incl: true, method: 'each' });
  const A = T.A;
  assert.equal(A.opening, 3000); // 2025年末の在庫 d
  assert.equal(A.buy, 5500 + 5800 + 12000 + 15000 + 2400 + 4000);
  assert.equal(A.closing, 3000 + 15000 + 2400 + 4000);
  assert.equal(A.cogs, A.opening + A.buy - A.closing);
  assert.equal(A.sales, 33700);
  assert.equal(A.misc, 1500);
  assert.equal(A['荷造運賃'], 1860);
  assert.equal(A['通信費'], 3740);
  assert.equal(A['支払手数料'], 1490 + 2063 + 795 - 844 + 312 + 5390 + 4000);
  assert.equal(A.income, A.sales + A.misc - A.cogs - A.expTotal);
  const one = T.ao.find((l) => l.no === '①');
  assert.equal(one.amount, A.sales + A.misc);
  assert.ok(one.src.length > 0);
  assert.equal(T.ao.find((l) => l.no === '⑥').amount, A.cogs);
  assert.equal(T.ao.find((l) => l.no === '㉝').amount, A.income);
  assert.equal(T.shiro.find((l) => l.no === '⑲').amount, A.income);
  assert.equal(T.shiro.find((l) => l.no === '⑨').amount, A.cogs);
  // 期首を手で入れた時・期末を実地で直した時
  const T2 = B.taxReport(D, 2026, { opening: 5000, closing: 20000 });
  assert.equal(T2.A.cogs, 5000 + A.buy - 20000);
  assert.ok(!T2.warn.some((w) => w.k === 'opening'));
});
test('ポイントの扱い: 値引き / 雑収入', () => {
  const D = demoData();
  const base = B.taxReport(D, 2026, {}).A;
  const a = B.taxReport(D, 2026, { pointYen: 1200, points: 'discount' }).A;
  assert.equal(a.buy, base.buy - 1200); assert.equal(a.misc, base.misc);
  const b = B.taxReport(D, 2026, { pointYen: 1200, points: 'misc' }).A;
  assert.equal(b.misc, base.misc + 1200); assert.equal(b.buy, base.buy);
  assert.equal(a.income, b.income);
});
test('課税事業者・税抜経理の参考値', () => {
  const D = demoData();
  const A = B.taxReport(D, 2026, { tax: 'taxable', incl: false }).A;
  assert.equal(A.sales, Math.round(33700 * 100 / 110));
});

/* ---------- 仕訳・書き出し ---------- */
test('仕訳帳: 借方と貸方が一致し、売掛金は入金で減る', () => {
  const D = demoData(), J = B.journal(D, 2026, { method: 'each' });
  assert.ok(J.length > 10);
  const bal = {};
  J.forEach((e) => { bal[e.dr] = (bal[e.dr] || 0) + e.amt; bal[e.cr] = (bal[e.cr] || 0) - e.amt; });
  assert.equal(Object.values(bal).reduce((s, v) => s + v, 0), 0);
  // 売上高(貸方残) = 売上
  assert.equal(-bal['売上高'], 33700);
  // 期首・期末の振替
  assert.equal(bal['期首商品棚卸高'], 3000);
  assert.equal(-bal['期末商品棚卸高'], 24400);
  // 損益 = 申告の所得
  const T = B.taxReport(D, 2026, { method: 'each' });
  const pl = ['売上高', '雑収入'].reduce((s, k) => s - (bal[k] || 0), 0) + (bal['期末商品棚卸高'] ? -bal['期末商品棚卸高'] : 0)
    - (bal['期首商品棚卸高'] || 0) - (bal['仕入高'] || 0) - B.ACCTS.reduce((s, k) => s + (bal[k] || 0), 0);
  assert.equal(pl, T.A.income);
  assert.ok(J.every((e) => e.amt > 0 && e.date.startsWith('2026')));
});
test('書き出し: 弥生25項目・MF・freee', () => {
  const D = demoData(), J = B.journal(D, 2026, {});
  const y = B.exportRows(J, 'yayoi', { tax: 'exempt' });
  assert.equal(y.header, null);
  assert.ok(y.rows.every((r) => r.length === 25 && r[0] === '2000' && /^2026\/\d\d\/\d\d$/.test(r[3])));
  assert.equal(y.rows[0][7], '対象外');
  const m = B.exportRows(J, 'mf', { tax: 'taxable', incl: true });
  assert.equal(m.header.length, 23); assert.equal(m.header[0], '取引No'); assert.equal(m.header[8], '借方金額(円)');
  assert.ok(m.rows.every((r) => r.length === 23));
  assert.ok(m.rows.some((r) => r[14] === '課税売上 10%'));
  const f = B.exportRows(J, 'freee', { tax: 'taxable', incl: false });
  assert.equal(f.header[1], '発生日');
  const sale = f.rows.find((r) => r[6] === '売上高');
  assert.equal(sale[9], Math.round(sale[8] * 10 / 110));
  const csv = B.toCSV(m.rows, m.header);
  assert.match(csv, /^取引No,取引日/);
});
test('Shift_JIS への書き出し', () => {
  const b = B.encodeSJIS('仕入高,ﾃｽﾄ,①,−100');
  const back = new TextDecoder('shift_jis').decode(b);
  assert.equal(back, '仕入高,ﾃｽﾄ,①,－100');
});

/* ---------- 古物商特例 ---------- */
test('古物商特例: 個人からの中古の仕入れの記載の確認', () => {
  const k = B.kobutsuCheck(LEDGER, 2026);
  const st = Object.fromEntries(k.rows.map((x) => [x.r.id, x]));
  assert.equal(st.a.state, 'new');
  assert.equal(st.c.state, 'missing'); assert.deepEqual(st.c.need, ['相手の氏名', '相手の住所']); // ゲーム機(1万円以上・本人確認が要る)
  assert.equal(st.f.state, 'ok'); // 氏名・住所あり
  assert.equal(st.g.state, 'missing'); // ゲームソフトは金額を問わず
  assert.equal(st.h.state, 'biz'); // ハードオフ(事業者)
  assert.ok(!st.e); // 無在庫
  assert.equal(k.ok, 1); assert.equal(k.amountOk, 15000); assert.equal(k.taxOk, 1364);
  // 1万円未満・本人確認の要らない品は氏名・住所なしでよい
  const k2 = B.kobutsuCheck([{ id: 'q', date: '2026-01-01', name: '中古 Tシャツ', cond: '中古', qty: 1, unit: 1500, party: 'メルカリ 出品者' }], 2026);
  assert.equal(k2.rows[0].state, 'ok');
  // 仕訳の摘要に「古物商特例」
  const J = B.journal({ ledger: LEDGER, sales: [], expenses: [] }, 2026, { tax: 'taxable' });
  assert.ok(J.some((e) => /古物商特例/.test(e.memo) && e.taxDr === 'kobutsu'));
});

/* ---------- プラン ---------- */
test('プランと機能', () => {
  assert.equal(B.tierOf('business_month', '業務'), 'biz');
  assert.equal(B.tierOf('total_month', '総合'), 'total');
  assert.equal(B.tierOf('standard_month', 'スタンダード'), 'total');
  assert.equal(B.tierOf('light_month', 'ライト'), 'light');
  assert.equal(B.tierOf('', ''), 'free');
  assert.ok(B.allowed('import', 'total'));
  assert.ok(!B.allowed('tax', 'total'));
  assert.ok(B.allowed('kobutsu', 'biz'));
  assert.ok(!B.allowed('monthly', 'light'));
});
