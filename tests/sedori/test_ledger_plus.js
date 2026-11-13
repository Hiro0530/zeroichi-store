// 台帳の追加の働き(また仕入れる候補・納品リスト・仕入れの証拠)の検算。実行: node tests/sedori/test_ledger_plus.js [公開フォルダ]
const path = require('path'), assert = require('assert'), fs = require('fs');
const root = process.argv[2] || path.join(__dirname, '../../../kt-zs-sedori-ghp');
const SD = require('./_dir')(root);  // 準備中の間はテスト用の写しを読む
const A = f => path.join(root, SD, f);
const C = require(A('assets/calc.js')), Sync = require(A('assets/sync.js'));
const LP = require(A('assets/ledger-plus.js')), K = LP.core;
const fees = JSON.parse(fs.readFileSync(A('data/fees.json'), 'utf8'));
let n = 0;
function eq(a, b, msg) { assert.deepStrictEqual(a, b, `${msg}: 実際 ${JSON.stringify(a)} / 期待 ${JSON.stringify(b)}`); n++; }
function ok(v, msg) { assert.ok(v, msg); n++; }

const cat = fees.amazon.categories[0].id, tier = fees.amazon.fba_tiers ? fees.amazon.fba_tiers[0].id : (fees.amazon.fba || [])[0].id;
const calc = { category: cat, fbaTier: tier, inbound: 100, other: 50, selfShip: false, selfShipCost: 0, pointRate: 0.05, cost: 1980, inShip: 0, sell: 3980, code: 'shop:abc' };
const rows = [
  { id: 'r5', date: '2026-11-02', name: 'ハンドクリーム 50g', feature: 'JAN 4901234567894', cond: '新品', sellTo: 'Amazon', unit: 2100, qty: 2, profit: 380, sellPrice: 3980, repeat: true, calc, ref: 'https://example.com/a', ship: 'fba', status: '仕入れ済' },
  { id: 'r4', date: '2026-10-10', name: 'ハンドクリーム50g(別の書き方)', feature: 'JAN 4901234567894 ASIN B0ABCDEFGH', cond: '新品', sellTo: 'Amazon', unit: 1980, qty: 1, profit: 420, saleDate: '2026-10-20', ship: 'fba', status: '売約' },
  { id: 'r3', date: '2026-09-01', name: 'ハンドクリーム 50g', feature: 'ＪＡＮ ４９０１２３４５６７８９４', cond: '新品', sellTo: 'Amazon', unit: 1900, qty: 1, saleDate: '2026-09-15', status: '発送済' },
  { id: 'r2', date: '2026-10-05', name: 'ケーブル', feature: 'ASIN B0ZZZZZZZZ', cond: '新品', sellTo: 'Amazon', unit: 500, qty: 3, repeat: true, status: '仕入れ済', ship: '3pl', orderNo: '=1+1' },
  { id: 'r1', date: '2026-08-01', name: '古い カメラ', cond: '中古', sellTo: 'メルカリ', unit: 8000, repeat: true, ship: 'self', status: '仕入れ済' },
  { id: 'r0', date: '2026-08-02', name: '古い　カメラ', cond: '中古', sellTo: 'メルカリ', unit: 7000, ship: 'self', pName: '山田 太郎', pAddr: '東京都千代田区1-1', pTel: '090-0000-0000' },
  { id: 'w1', date: '2026-11-01', name: '無在庫の品', feature: 'ASIN B0WAITWAIT', cond: '中古', sellTo: 'Amazon(中古)', wait: true, status: '出品中', ship: '3pl' },
  { id: 'x1', date: '2026-11-03', name: '印なしの品', feature: 'JAN 4900000000001', cond: '新品', sellTo: 'Amazon', unit: 900, status: '仕入れ済', ship: 'fba' }
];

// ---- 仕様2: また仕入れる候補 ----
// 1. 同じ商品を1つにまとめる(JAN → ASIN → 品名)
eq(K.keyOf(rows[0]), 'j:4901234567894', 'JANが鍵');
eq(K.keyOf(rows[2]), 'j:4901234567894', '全角のJANも同じ鍵');
eq(K.keyOf(rows[3]), 'a:B0ZZZZZZZZ', 'JANが無ければASIN');
eq(K.keyOf(rows[4]), K.keyOf(rows[5]), 'どちらも無ければ品名(全角の空白をそろえる)');
eq(K.keyOf({ id: 'z', name: '' }), 'i:z', '品名も無い行はまとめない');
const gs = K.groups(rows, '2026-11');
eq(gs.length, 3, '印の付いた商品だけが候補になる(印なし・無在庫の行は出ない)');
const g = gs.find(x => x.key === 'j:4901234567894');
eq(g.ids.slice().sort(), ['r3', 'r4', 'r5'], '同じJANの3行が1つにまとまる');
// 2. 回数・前回・売れるまでの日数(手計算: 10/10→10/20=10日、9/1→9/15=14日、平均12日。売れていない行は入れない)
eq([g.count, g.lastDate, g.lastUnit, g.lastProfit, g.avgDays], [3, '2026-11-02', 2100, 380, 12], '回数・前回の仕入日・仕入れ値・利益・売れるまで');
const gc = gs.find(x => x.key === 'a:B0ZZZZZZZZ');
eq([gc.count, gc.avgDays, gc.lastProfit], [1, null, null], '売却の記録が無い時は日数なし');
// 3. 今の値での利益が、計算の部品に同じ条件を入れた時と1円も違わない
const tg = { mode: 'pct', value: 15 };
const now = { cost: 2200, sell: 4280 };
const want = C.amazonProfit(fees, Object.assign({}, calc, { cost: 2200, sell: 4280, usePoints: false }));
const got = K.nowProfit(C, fees, g, now, tg);
eq(got.profit, want.profitNoPoints, '今の利益(ポイント抜き)が計算ページと同じ');
eq(got.state, want.profitNoPoints >= C.needProfit(4280, tg) ? 'ok' : 'ng', '判定は「ポイント抜きの利益が目標以上」');
eq(K.nowProfit(C, fees, g, { cost: 2200 }, tg).profit, C.amazonProfit(fees, Object.assign({}, calc, { cost: 2200, usePoints: false })).profitNoPoints, '仕入れ値だけ替えた時、売値は前回の値');
eq(K.nowProfit(C, fees, g, { sell: 100 }, tg).state, 'ng', '売値が下がれば届かない');
eq(K.nowProfit(C, fees, g, { sell: 9000 }, { mode: 'yen', value: 300 }).state, 'ok', '目標を円にしても判定する');
eq(K.nowProfit(C, fees, g, {}, tg).state, 'unknown', '今の値が無い時は「確かめられない」');
eq(K.nowProfit(C, null, g, now, tg).state, 'unknown', '手数料が読めない時も落ちない');
eq(K.nowProfit(C, fees, Object.assign({}, g, { calc: Object.assign({}, calc, { selfShip: true, selfShipCost: 750, wh: 50, prep: 0, usePoints: true, rkCode: 'shop:1' }) }), now, tg).profit,
  C.amazonProfit(fees, Object.assign({}, calc, { selfShip: true, selfShipCost: 750, cost: 2200, sell: 4280, usePoints: false })).profitNoPoints, '自己発送の条件もそのまま使う(ra.js が入れる形)');
// 4. 条件の無い古い行で落ちない
eq(K.nowProfit(C, fees, gc, now, tg).state, 'nocalc', '条件の無い行は nocalc(計算ページで開く)');
eq([K.JUDGE.nocalc, K.JUDGE.unknown], ['未入力', '未入力'], '値が無い時の言葉は「未入力」にそろえる(画面では出さない)');
ok(K.groups([{ id: 'a', repeat: true }, null, {}], '2026-11').length === 1, '中身の欠けた古い行で落ちない');
eq(K.groups([], '2026-11'), [], '0件');
// 5. 月ごとの見直し
eq(K.review(gs), { done: 0, total: 3 }, '最初は全部まだ');
rows[0].rpSeen = '2026-11'; rows[3].rpSkip = '2026-11';
let g2 = K.groups(rows, '2026-11');
eq(K.review(g2), { done: 2, total: 3 }, '出し直した行と「今月は見送る」の行が済み');
eq(g2[0].done, false, 'まだの行が先に並ぶ');
eq(g2.find(x => x.key === 'a:B0ZZZZZZZZ').skip, true, '見送りの印');
eq(K.review(K.groups(rows, '2026-12')), { done: 0, total: 3 }, '月が替わると全部「まだ」に戻る');
eq(K.monthOf(new Date(2026, 0, 5)), '2026-01', '月の書き方');
// 6. もう一度仕入れた(前の行を写す。今の値があればそれ。2回押しの守り)
const nr = K.rebuyRow(rows[0], '2026-11-13', got);
eq([nr.date, nr.qty, nr.unit, nr.sellPrice, nr.profit, nr.status, nr.repeat, nr.rpFrom], ['2026-11-13', 2, 2200, 4280, got.profit, '仕入れ済', true, 'r5'], '今日の日付・前の個数・今の仕入れ値と売値');
eq([nr.name, nr.feature, nr.ref, nr.calc.cost, calc.cost], [rows[0].name, rows[0].feature, rows[0].ref, 2200, 1980], '品名・特徴・URLを写す(元の条件は書き換えない)');
ok(!('saleDate' in nr) && !('id' in nr) && !('orderNo' in nr), '売却・注文番号は写さない');
const nr0 = K.rebuyRow(rows[4], '2026-11-13', { state: 'nocalc' });
eq([nr0.unit, nr0.profit, nr0.calc], [8000, '', undefined], '条件の無い行は前回の値のまま写す');
const after = [Object.assign({ id: 'r6' }, nr)].concat(rows), g3 = K.groups(after, '2026-11').find(x => x.key === g.key);
ok(K.boughtToday(after, g3, '2026-11-13'), '今日もう足した行がある(2回押しを止める)');
eq(K.boughtToday(after, g3, '2026-11-14'), null, '日が替われば止めない');
eq(K.boughtToday(rows, g, '2026-11-13'), null, '足していなければ止めない');
// 7. 2台で印を付け外し: あとに書いた方が残る(今の同期の形)
const base = [{ id: 'a1', name: 'x', updatedAt: 100 }];
const pc = Sync.stamp(base, [{ id: 'a1', name: 'x', repeat: true, updatedAt: 100 }], {}, 200);
const sp = Sync.stamp(base, [{ id: 'a1', name: 'x', repeat: false, orderNo: 'N-1', updatedAt: 100 }], {}, 300);
const doc = Sync.toDoc('a1', sp.rows, sp.del);
const m = Sync.merge(pc.rows, pc.del, [doc], false);
eq([m.rows[0].repeat, m.rows[0].orderNo], [false, 'N-1'], 'あとに書いた端末の印と注文番号が残る');
const m2 = Sync.merge(sp.rows, sp.del, [Sync.toDoc('a1', pc.rows, pc.del)], false);
eq([m2.rows[0].repeat, m2.push], [false, ['a1']], '古い方を受け取っても新しい方が残り、送り直す');

// ---- 仕様4: 納品リスト ----
eq(K.PREP_HEAD, ['仕入日', '仕入れ先', '注文番号', '追跡番号', '品名', 'JAN', 'ASIN', '数量', '新品/中古', '受取先・入庫ID', 'メモ'], '納品リストの列');
const pb = K.prepBody(rows);
eq(pb.map(r => r[4]), ['ケーブル', 'ハンドクリーム 50g', '印なしの品'], '対象は発送代行かFBAで「仕入れ済」の行だけ(古い順)。自分で発送・売約・無在庫の仕入れ前は出ない');
eq([pb[1][5], pb[1][6], pb[1][7]], ['4901234567894', '', 2], 'JAN・数量');
eq(K.prepTarget({ status: '仕入れ済' }), true, '発送のしかたが空の古い行は発送代行として扱う(今の台帳と同じ)');
eq(K.prepTarget({ ship: 'fba', status: '入庫' }), false, '入庫に進んだ行は出ない');
ok(C.toCSV(K.PREP_HEAD, pb).indexOf("'=1+1") > 0, '式で始まる文字はCSVで無害になる');
eq(pb.every(r => r.length === K.PREP_HEAD.length), true, '列の数がそろう');

// ---- 仕様6: 仕入れの証拠 ----
// 1. 4項目は行の項目として保存され、同期の文書にそのまま入る
const pr = Sync.stamp([], [{ id: 'p1', orderNo: 'R-123', docType: '請求書', docName: 'はい', docRef: 'メール「ご注文の確認」', trackNo: '1234', prepSent: '2026-11-13' }], {}, 500);
eq(Sync.toDoc('p1', pr.rows, pr.del).row, { orderNo: 'R-123', docType: '請求書', docName: 'はい', docRef: 'メール「ご注文の確認」', trackNo: '1234', prepSent: '2026-11-13' }, '証拠の4項目・追跡番号・連絡済がクラウドの行に入る');
// 2. 「証拠が未入力」は新品でAmazonに売る行だけ
eq(rows.filter(K.proofNeeded).map(r => r.id), ['r5', 'r4', 'r3', 'x1'], '新品でAmazonに売る行(注文番号のある行・中古・メルカリ・無在庫は入らない)');
eq(K.proofNeeded({ cond: '新品', sellTo: 'Amazon', docType: 'なし' }), false, '書類の種類を「なし」と入れた行は未入力に数えない');
eq(K.proofNeeded({ cond: '新品', sellTo: 'Amazon', docRef: '棚A' }), false, '保管場所だけでも未入力に数えない');
eq(K.proofNeeded({ cond: '中古', sellTo: 'Amazon(中古)' }), false, '中古は入らない');
eq(K.proofNeeded({}), false, '古い行で落ちない');
// 3. 書き出し: 絞った行だけ・数の照らし合わせ・個人の情報は出ない
const one = rows.filter(r => K.keyOf(r) === 'j:4901234567894'), body = K.proofBody(one);
eq(body.length, 3, 'その品の行だけ');
eq(K.proofTotals(one), { bought: 4, sold: 2, text: '仕入れた数 4個/売った数 2個' }, '数の照らし合わせ(手計算: 2+1+1=4個、売った 1+1=2個)');
eq(body[2].slice(7, 10).concat(body[2].slice(13)), [2, 2100, 4200, '', 0], '数量・単価・合計・売却日・売った数');
eq(body.every(r => r.length === K.PROOF_HEAD.length), true, '列の数がそろう');
const all = JSON.stringify([K.PROOF_HEAD, K.proofBody(rows)]);
ok(!/山田|千代田|090-0000/.test(all) && !/住所|電話|氏名/.test(K.PROOF_HEAD.join()), '古物用の取引相手の住所・電話・氏名は出ない');
ok(!K.proofBody(rows).some(r => r[4] === '無在庫の品'), '無在庫の仕入れ前の行は出ない');
eq(K.proofTotals([]).text, '仕入れた数 0個/売った数 0個', '0件で落ちない');
// 仕様5の台帳の1行: 今月の売却日の行の(見込み利益×数量)の合計
eq(K.monthSum([{ saleDate: '2026-11-03', profit: 400, qty: 3 }, { saleDate: '2026-11-30', profit: -100 }, { saleDate: '2026-10-31', profit: 999 }, { saleDate: '2026-11-05', profit: '' }, { profit: 50 }, null], '2026-11'), 1100, '今月の見込み利益の合計(手計算: 400×3 − 100 = 1,100円)');
// 見込み利益の基準: ポイント抜きにそろえる(検品 B-5)。手計算: 2,400円÷1.1×1% = 21円 → 626 − 21 = 605円
const pr1 = [{ id: 'q1', profit: 626, calc: { cost: 2400, pointRate: 0.01, usePoints: true } }, { id: 'q2', profit: 626, calc: { cost: 2400, pointRate: 0.01, usePoints: false } },
  { id: 'q3', profit: 500 }, { id: 'q4', profit: '', calc: { cost: 2400, pointRate: 0.01 } }, { id: 'q5', profit: 605, pnp: true, calc: { cost: 2400, pointRate: 0.01, usePoints: true } }, null];
eq(K.stripPoints(C, pr1), 3, '条件の残る3行だけ直す');
eq(pr1.slice(0, 5).map(r => r.profit), [605, 626, 500, '', 605], '込みの行だけポイントを引く(ポイントを使わない行・条件の無い古い行・空・直した行はそのまま)');
eq(K.stripPoints(C, pr1), 0, '2回目は何も引かない');
eq(pr1[0].profit, 605, '二重に引かない');
const cq = Object.assign({}, calc, { cost: 2400, sell: 3980, pointRate: 0.01, usePoints: true }), withPt = C.amazonProfit(fees, cq);   // 計算ページの「仕入れた」が入れる形(利益はポイント込み)
const fromBuy = { id: 'q6', date: '2026-11-01', name: 'x', feature: 'JAN 4901234567894', unit: 2400, qty: 1, profit: withPt.profit, sellPrice: 3980, repeat: true, calc: cq };
eq(withPt.profit - withPt.profitNoPoints, 21, '込みと抜きの差はポイント21円');
K.stripPoints(C, [fromBuy]);
eq(fromBuy.profit, withPt.profitNoPoints, '直した後は計算ページの「ポイント抜きの利益」と同じ');
const gq = K.groups([fromBuy], '2026-11')[0], rq = K.nowProfit(C, fees, gq, { cost: 2400 }, tg);
eq(fromBuy.profit, rq.profit, '同じ条件なら、台帳の見込み利益と「今は1個」が同じ数字');
eq([K.rebuyRow(fromBuy, '2026-11-13', rq).profit, K.rebuyRow(fromBuy, '2026-11-13', rq).pnp], [rq.profit, true], '「もう一度仕入れた」の行も同じ基準(直し済みの印つき)');
// 6. 注意書き(画面と書き出しで同じ文を使う)
ok(/届いた通知で確かめてください/.test(K.PROOF_NOTE) && /控え/.test(K.PROOF_NOTE), '注意書きがある');
const src = fs.readFileSync(A('assets/ledger-plus.js'), 'utf8');
ok((src.match(/PROOF_NOTE/g) || []).length >= 4, '注意書きを画面と書き出しの両方で使っている');
ok(/ポイントは含めていません/.test(src), '画面に「ポイントは含めていません」');
ok(!/稼げ|儲か|必ず売れ/.test(src + fs.readFileSync(A('assets/ledger.js'), 'utf8')), '「稼げる」と受け取れる文言が無い');
ok(!/<style/.test(src), '見た目は sedori.css に置く(ここから style を足さない)');
const both = src + fs.readFileSync(A('assets/ledger.js'), 'utf8');
ok(!/確かめられない|未取得|記録なし|[^発]送代行へ連絡済|'代行へ/.test(both.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '')), '言葉のゆれが無い(値が無い言葉・「発送代行」)');
ok(/業務プランを見る/.test(src) && !/'業務を見る'/.test(src), '案内のボタンは「業務プランを見る」');

console.log(`OK 台帳の追加の働き ${n}件`);
