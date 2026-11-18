// 帳簿の画面(books/)を、本物のブラウザ(Playwright の chromium)で押して確かめる(2026-11-18)。実行: node tests/sedori/test_books_browser.js <公開フォルダ>
// 計算は Worker の /core だけ(にせの /core は本物の handleCore)。確かめること:
//  1) 業務: 8つの画面(取り込み・経費は端末のまま。月ごと・売れ残り・棚卸・申告・仕訳帳・古物商)の数字が、移す前の端末の計算(_books_oracle.js)と同じ
//  2) 品名・相手の名前・住所・メモ・支払先の名前を送らない/画面には端末の記録から名前が出る/書き出したファイルが移す前と同じ中身
//  3) 総合: 売れ残りは出る・棚卸以降は鍵の案内(数字を見せない・頼まない)/ライト・鍵なし: 何も頼まない
//  4) 通信できない時は「通信が要る」と案内/呼び出しは、まとめて1回・同じ頼みは聞き直さない
//  5) 見本(?demo=1): 鍵なしでも全部の画面が出る(見本の印つきで頼む)
//  6) 375px で横にはみ出さない
const fs = require('fs'), path = require('path'), assert = require('assert');
const { chromium, serve, open: open0, root } = require('./_listed_lib');
const open = async (...a) => { const pg = await open0(...a); pg.setDefaultTimeout(8000); return pg; };
const SD = require('./_dir')(root);
process.env.SEDORI_SC = path.join(root, SD, 'assets/seller-check.js');
const O = require('./_books_oracle.js');
let n = 0;
const ok = (v, msg) => { assert.ok(v, msg); n++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, `${msg}: 実際 ${JSON.stringify(a)} / 期待 ${JSON.stringify(b)}`); n++; };
const Y = new Date().getMonth() < 3 ? new Date().getFullYear() - 1 : new Date().getFullYear();
const MARK = 'ZQX';
const yen = v => Math.round(v).toLocaleString('ja-JP');

const ledger = [
  { id: 'b1', date: Y + '-02-01', name: MARK + 'ゲーム機', party: '楽天市場 Aショップ', qty: 1, unit: 2000, cond: '新品', route: 'rakuten', saleDate: Y + '-05-20', salePrice: 7000, sellPrice: 7000, profit: 3000, sellTo: 'Amazon', feature: 'JAN 4901234567894' },
  { id: 'b2', date: Y + '-01-05', name: MARK + 'まだ売れない品', party: 'ブックオフ 新宿店', qty: 2, unit: 1500, cond: '新品', route: 'store', sellPrice: 4000, profit: 900, sellTo: 'メルカリ', feature: 'JAN 4901234500043', hinmoku: '' },
  { id: 'b3', date: Y + '-03-10', name: MARK + 'ヘッドホン 中古', party: 'メルカリ 山田', qty: 1, unit: 12000, cond: '中古', route: 'mercari', pName: MARK + '売り手', pAddr: '', verify: '本人限定受取郵便で確認', saleDate: Y + '-04-02', salePrice: 20000, sellPrice: 20000, profit: 5000, sellTo: 'メルカリ', hinmoku: '道具類' },
  { id: 'b4', date: (Y - 1) + '-12-01', name: MARK + '去年の在庫', party: '楽天市場 Bストア', qty: 3, unit: 800, cond: '新品', route: 'rakuten', sellPrice: 2000, profit: 500, sellTo: 'Amazon', feature: 'JAN 4901234500050' }
];
const sales = [{ id: 'x1', src: 'amazon', date: Y + '-06-03', kind: 'order', ch: 'Amazon', gross: 5000, disc: 0, fee: 700, ship: 0, other: 0, withheld: 0, qty: 1, name: MARK + '売上の品', ledgerId: 'b2', typeLabel: '注文', order: '503-1' }];
const expenses = [{ id: 'e1', date: Y + '-06-30', amount: 1000, acct: '通信費', payee: MARK + '電話会社', memo: MARK + 'メモ', biz: 100 }, { id: 'e2', date: Y + '-07-31', amount: 3000, acct: '荷造運賃', payee: '株式会社テスト運送', biz: 50 }];
const SET = { tax: 'taxable', incl: true, form: 'ao', points: 'discount', pointYen: {}, opening: {}, closing: {}, method: 'last', pay: '事業主借', bizDef: {}, noReg: {} };
const SEED = { ledger, 'bk-sales': sales, 'bk-exp': expenses, 'bk-set': SET };

(async () => {
  const { server, base } = await serve(), browser = await chromium.launch();
  const url = base + 'books/';
  const calls = p => (p.core.bodies || []);
  const opsOf = p => calls(p).flatMap(b => b.ops.map(o => o.op));
  const over = p => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const text = (p, sel) => p.locator(sel).innerText();
  const D = { ledger, sales, expenses };
  const SETO = { tax: 'taxable', incl: true, points: 'discount', pointYen: 0, opening: null, closing: null, method: 'last', pay: '事業主借', counts: {}, noReg: {} };

  /* ---------- 1. 業務: 数字が移す前の計算と同じ ---------- */
  let p = await open(browser, url + '#monthly', 1280, SEED, { tier: 'business' });
  await p.waitForTimeout(1200);
  const M = O.monthly(D, Y);
  ok((await text(p, '#bk-sum')).replace(/,/g, '').includes(String(M.total.sales)) && (await text(p, '#bk-sum')).replace(/,/g, '').includes(String(M.total.profit)), '業務: 見出しの売上と利益が、移す前の計算と同じ');
  eq(await p.$$eval('#bk-pane tr.mrow', a => a.length), 12, '月ごとの利益: 12か月の行');
  eq(opsOf(p).slice().sort(), ['books', 'stale', 'stock'], '最初に開いた時の問い合わせは、見出しの3件(集計・売れ残り・在庫)を1回にまとめた');
  eq(calls(p).length, 1, '問い合わせは1回だけ(まとめて)');
  // 月の行を開くと、品名はこの端末の記録から出る
  const mrow = await p.$$eval('#bk-pane tr.mrow', (rs, y) => rs.findIndex(r => r.getAttribute('data-ym') === y + '-05'), Y);
  await p.locator('#bk-pane tr.mrow').nth(mrow).click(); await p.waitForTimeout(300);
  ok((await text(p, '#bk-pane')).includes(MARK + 'ゲーム機'), '月の内訳: 品名は端末の記録から出る(サーバーは名前を知らない)');
  // 仕入れ先別: 個人の名前('山田')は、サーバーへは番号で送り、画面には端末の記録の語で出る
  await p.click('[data-seg="mo"] button[data-v="party"]'); await p.waitForTimeout(200);
  const partyTxt = await text(p, '#bk-pane');
  ok(/楽天市場/.test(partyTxt) && /ブックオフ/.test(partyTxt), '仕入れ先別: 決まった店の名前');
  ok(/メルカリ/.test(partyTxt), '仕入れ先別: 個人の仕入れ先も端末の記録の語で出る');
  eq(calls(p).length, 1, '仕入れ先別へ切り替えても、聞き直さない');
  // 売れ残り
  await p.goto(url + '#stale'); await p.waitForTimeout(1000);
  const tdy = new Date().toISOString().slice(0, 10), st = O.stale(D.ledger, { days: 60, cats: {}, items: {} }, tdy);
  eq(await p.$$eval('#bk-pane tbody tr', a => a.length), st.filter(x => x.over).length, '売れ残り: 目安を過ぎた品の行数が、移す前の計算と同じ');
  ok((await text(p, '#bk-pane')).includes(MARK + 'まだ売れない品'), '売れ残り: 品名は端末の記録から');
  // 棚卸
  await p.goto(url + '#stock'); await p.waitForTimeout(1000);
  const sk = O.stocktake(D.ledger, Y + '-12-31', 'last', {});
  ok((await text(p, '#bk-pane')).replace(/,/g, '').includes(String(sk.book)), '棚卸: 帳簿の棚卸高が、移す前の計算と同じ');
  eq(await p.$$eval('#bk-pane tbody tr', a => a.length), sk.rows.length, '棚卸: 在庫の行数');
  // 数えた数を入れる → サーバーへ数だけ送って再計算
  const firstId = sk.rows[0].r.id;
  await p.fill('[data-cnt="' + firstId + '"]', '1'); await p.press('[data-cnt="' + firstId + '"]', 'Tab'); await p.waitForTimeout(800);
  const sk2 = O.stocktake(D.ledger, Y + '-12-31', 'last', { [firstId]: 1 });
  ok((await text(p, '#bk-pane')).replace(/,/g, '').includes(String(sk2.real)), '棚卸: 実地の数を入れると、実地の棚卸高が移す前の計算と同じに替わる');
  // 申告の数字
  await p.goto(url + '#tax'); await p.waitForTimeout(1200);
  const SETC = Object.assign({}, SETO, { counts: { [firstId]: 1 } });   // 棚卸で入れた実地の数は、申告の期末棚卸高にも使われる
  const tx = O.taxReport(D, Y, SETC), taxTxt = (await text(p, '#bk-pane')).replace(/,/g, '');
  ok(taxTxt.includes(String(tx.A.sales + tx.A.misc)) && taxTxt.includes(String(Math.abs(tx.A.income))), '申告の数字: ①売上と㉝所得が、移す前の計算と同じ: 期待 ' + (tx.A.sales + tx.A.misc) + ' / ' + tx.A.income + ' / ' + taxTxt.slice(-700));
  ok(/インボイスの無い仕入れ/.test(taxTxt), '課税事業者: 経過措置の表が出る(同じ頼みの答えから)');
  eq(opsOf(p).filter(o => o === 'tax').length >= 1 && opsOf(p).filter(o => o === 'transition').length, 0, '申告の数字と経過措置は1件の頼みで受ける(別々に聞かない)');
  // 内訳を開く(名前は端末から)
  await p.locator('button[data-tx]').first().click(); await p.waitForTimeout(200);
  // 仕訳帳
  await p.goto(url + '#journal'); await p.waitForTimeout(1200);
  const oj = O.journal(D, Y, SETC);
  eq(await p.$$eval('#bk-pane tbody tr', a => a.length), Math.min(oj.length, 300), '仕訳帳: 行数が移す前の計算と同じ');
  ok((await text(p, '#bk-pane')).includes(MARK + 'ゲーム機') && (await text(p, '#bk-pane')).includes(MARK + '電話会社'), '仕訳帳: 摘要の品名・支払先は、端末の記録から入る');
  // 書き出し: 移す前と同じファイル
  await p.selectOption('#jn-enc', 'utf8');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-ex="freee"]')]);
  const got = fs.readFileSync(await dl.path(), 'utf8');
  const B0 = O, ex = B0.exportRows(oj, 'freee', SETC), want = '﻿' + B0.toCSV(ex.rows, ex.header);
  eq(got, want, 'freee の書き出し: 移す前の端末の計算と1文字も違わない');
  await p.selectOption('#jn-enc', 'sjis');
  const [dl2] = await Promise.all([p.waitForEvent('download'), p.click('[data-ex="yayoi"]')]);
  const ex2 = B0.exportRows(oj, 'yayoi', SETC);
  eq(Buffer.from(fs.readFileSync(await dl2.path())).equals(Buffer.from(B0.encodeSJIS(B0.toCSV(ex2.rows, ex2.header)))), true, 'やよいの書き出し(Shift_JIS): 移す前の端末の計算と同じバイト列');
  // 古物商特例
  await p.goto(url + '#kobutsu'); await p.waitForTimeout(1200);
  const kb = O.kobutsuCheck(D.ledger, Y);
  ok((await text(p, '#bk-pane')).includes('足りない ' + kb.missing) && (await text(p, '#bk-pane')).includes('そろい ' + kb.ok), '古物商特例: 件数が移す前の計算と同じ');
  await p.click('[data-seg="kb"] button[data-v="all"]'); await p.waitForTimeout(200);
  ok((await text(p, '#bk-pane')).includes(MARK + 'ヘッドホン 中古'), '古物商特例: 品名は端末の記録から。売り手の確認が要る理由の文も端末で付く');
  // 送った欄に名前の文字が無い
  const allSent = JSON.stringify(calls(p));
  ok(!allSent.includes(MARK) && !allSent.includes('山田') && !allSent.includes('Aショップ') && !allSent.includes('テスト運送'), '送った欄に、品名・取引相手の名前・住所・メモ・支払先の名前が1文字も入っていない(全部の画面の分)');
  ok(p.errs.length === 0, '画面の誤りが無い ' + p.errs.join());
  // 同じ頼みは聞き直さない(すぐ戻る)
  const before = calls(p).length;
  await p.goto(url + '#journal'); await p.waitForTimeout(800);
  eq(calls(p).length, before, '同じ記録の画面に戻っても、聞き直さない(答えを短い時間だけ持つ。メモリだけ)');
  ok((await p.evaluate(() => SedoriAccount.askStats().cached)) > 0, '答えのメモリの数が見える');
  await p.context().close();

  /* ---------- 3. 総合・ライト・鍵なし ---------- */
  p = await open(browser, url + '#stale', 1280, SEED, { tier: 'total' }); await p.waitForTimeout(1000);
  eq(await p.$$eval('#bk-pane tbody tr', a => a.length) > 0, true, '総合: 売れ残りは出る');
  await p.click('#bk-tabs [data-tab="tax"]'); await p.waitForTimeout(500);
  const lockTxt = await text(p, '#bk-pane');
  ok(/業務プラン/.test(lockTxt) && !/円/.test(lockTxt.replace(/業務で使えます/g, '')), '総合: 申告の数字は鍵の案内。数字を見せない');
  eq(opsOf(p).filter(o => ['tax', 'journal', 'stock', 'kobutsu', 'export', 'transition'].includes(o) && o !== 'stock').length, 0, '総合: 業務の計算(申告・仕訳帳・古物商)は頼まない');
  await p.context().close();
  for (const t of ['light', 'free']) {
    p = await open(browser, url + '#monthly', 1280, SEED, { tier: t }); await p.waitForTimeout(800);
    eq([opsOf(p).length, /総合で/.test(await text(p, '#bk-sum'))], [0, true], t + ': 帳簿の数字は出さず、Worker にも頼まない');
    await p.context().close();
  }

  /* ---------- 4. 通信できない ---------- */
  p = await open(browser, url + '#tax', 1280, SEED, { tier: 'business', core: { tier: 'business', offline: true } }); await p.waitForTimeout(1000);
  ok(/通信できないため、集計を出せません/.test(await text(p, '#bk-pane')), '通信できない: 申告の数字を出さず「通信が要る」と案内する(端末で数え直さない)');
  ok(!/売上\(収入\)金額/.test(await text(p, '#bk-pane')), '通信できない: 表を出さない');
  p.core.offline = false;
  await p.evaluate(() => window.dispatchEvent(new Event('online'))); await p.waitForTimeout(1000);
  ok(/売上\(収入\)金額/.test(await text(p, '#bk-pane')), '通信が戻ると(online)、自動で数字が出る');
  await p.context().close();

  /* ---------- 5. 見本(?demo=1) ---------- */
  p = await open(browser, url + '?demo=1#monthly', 1280, {}, { tier: 'free' }); await p.waitForTimeout(1500);
  ok(/お試し/.test(await text(p, '#bk-mode')) && (await p.$$eval('#bk-pane tr.mrow', a => a.length)) === 12, '見本: 鍵なしで月ごとの利益が出る');
  for (const t of ['stale', 'stock', 'tax', 'journal', 'kobutsu']) {
    await p.click('#bk-tabs [data-tab="' + t + '"]'); await p.waitForTimeout(900);
    if (t === 'kobutsu' && await p.locator('#kb-on').count()) { await p.click('#kb-on'); await p.waitForTimeout(900); }   // 見本は免税事業者。課税事業者に切り替えると出る
    ok(!(await text(p, '#bk-pane')).includes('集計しています') && (await text(p, '#bk-pane')).length > 200, '見本: ' + t + ' の画面が出る');
  }
  ok(calls(p).every(b => b.ops.every(o => o.demo === true)) && !calls(p).some(b => b.pass), '見本: 頼みは見本の印つき・利用の証明なし');
  await p.context().close();

  /* ---------- 6. 375px ---------- */
  p = await open(browser, url + '#monthly', 375, SEED, { tier: 'business' }); await p.waitForTimeout(1000);
  for (const t of ['monthly', 'stale', 'stock', 'tax', 'journal', 'kobutsu']) {
    await p.click('#bk-tabs [data-tab="' + t + '"]'); await p.waitForTimeout(800);
    eq(await over(p), 0, '375px: ' + t + ' は横にはみ出さない');
  }
  ok(p.errs.length === 0, '画面の誤りが無い(375px) ' + p.errs.join());
  await p.context().close();

  console.log(`OK 帳簿の画面 ${n}件`);
  await browser.close(); server.close();
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => setTimeout(() => process.exit(process.exitCode || 0), 300));
