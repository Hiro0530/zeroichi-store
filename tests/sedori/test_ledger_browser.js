// 台帳の行のボタンを、本物のブラウザ(Playwright の chromium)で実際に全部押す(検品 A-1: 「編集」が開かない不具合の再発を止める)。
// 実行: node tests/sedori/test_ledger_browser.js <公開フォルダ>   (スマホ幅375pxとPC幅1280pxの両方で押す)
const path = require('path'), fs = require('fs'), http = require('http'), assert = require('assert');
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
const root = path.resolve(process.argv[2] || path.join(__dirname, '../../../kt-zs-sedori-ghp'));
const SD = require('./_dir')(root);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
let n = 0;
function ok(v, msg) { assert.ok(v, msg); n++; }
const server = http.createServer((req, res) => {
  let f = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(root)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
const soon = new Date(Date.now() + 50 * 6e4), pad = v => String(v).padStart(2, '0');
const yEnd = soon.getFullYear() + '-' + pad(soon.getMonth() + 1) + '-' + pad(soon.getDate()) + 'T' + pad(soon.getHours()) + ':' + pad(soon.getMinutes());
const calc = { category: 'toys', fbaTier: 'small', inbound: 100, other: 0, selfShip: false, selfShipCost: 0, pointRate: 0.01, usePoints: true, cost: 2400, inShip: 0, sell: 3980 };
const rows = [
  { id: 'a5', date: '2026-11-02', name: '積み木セット 40ピース', feature: 'JAN 4901234567894', cond: '新品', hinmoku: '道具類', sellTo: 'Amazon', unit: 2400, qty: 3, profit: 626, sellPrice: 3980, party: '楽天市場 おもちゃA', ship: 'fba', status: '仕入れ済', kind: '仕入れ', orderNo: 'N-1', docType: '領収書', calc },
  { id: 'a4', date: '2026-10-20', name: 'ミニカー 3台セット', feature: 'JAN 4900000000022', cond: '新品', hinmoku: '道具類', sellTo: 'Amazon', unit: 900, qty: 1, profit: 200, sellPrice: 1980, ship: 'self', status: '仕入れ済', kind: '仕入れ', orderNo: 'N-2' },
  { id: 'a3', date: '2026-10-11', name: '腕時計 自動巻き(中古)', cond: '中古', hinmoku: '時計・宝飾品類', sellTo: 'メルカリ', unit: 12000, qty: 1, profit: 3000, sellPrice: 19800, party: 'Yahoo!オークション 出品者', pName: '西尾 和彦', pAddr: '愛知県岡崎市明大寺町2-14', verify: '本人限定受取郵便で確認', ship: 'self', status: '出品中', kind: '仕入れ' },
  { id: 'a2', date: '2026-10-05', name: '無在庫の出品(ヤフオク終了が近い)', feature: 'ASIN B0ABCDEFGH', cond: '中古', hinmoku: '機械工具類', sellTo: 'Amazon(中古)', unit: 5000, qty: 1, profit: 900, sellPrice: 8800, ship: '3pl', status: '出品中', wait: true, yEnd, kind: '仕入れ' },
  { id: 'a1', date: '2026-09-01', name: '古い形の行' }
];
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const B = `http://127.0.0.1:${server.address().port}/${SD}/`;
  const browser = await chromium.launch(); const errs = [];
  for (const w of [375, 1280]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(w + ' ' + e.message));
    await p.addInitScript(([d]) => { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); localStorage.setItem('zw-sedori:ledger', JSON.stringify(d)); sessionStorage.setItem('seeded', '1'); } }, [rows]);
    await p.goto(B + 'daicho/'); await p.waitForTimeout(500);
    const led = () => p.evaluate(() => JSON.parse(localStorage.getItem('zw-sedori:ledger')));
    const row = async id => (await led()).find(r => r.id === id);
    const toast = () => p.evaluate(() => { const t = document.querySelector('#toast'); return t && t.classList.contains('on') ? t.textContent : ''; });
    const T = m => m + '(' + w + 'px)';
    // 全部の行に「編集」「消す」があり、行のidが正しく入っている
    ok(await p.evaluate(ids => ids.every(id => document.querySelector('#lg-rows tr[data-id="' + id + '"] .ops [data-edit="' + id + '"]') && document.querySelector('#lg-rows tr[data-id="' + id + '"] .ops [data-del="' + id + '"]')), rows.map(r => r.id)), T('全部の行の「編集」「消す」に行のidが入っている'));
    // 見込み利益はポイント抜き(626 − 21 = 605円。×3個 = 1,815円)
    ok((await row('a5')).profit === 605 && (await row('a5')).pnp === true && (await row('a4')).profit === 200, T('見込み利益をポイント抜きにそろえる(条件の無い行はそのまま)'));
    ok(/1,815/.test(await p.locator('#lg-rows tr[data-id="a5"] [data-k="見込み利益"]').innerText()), T('一覧の見込み利益もポイント抜き'));
    ok(/ポイントは含めていません/.test(await p.locator('#slot-lg-foot').innerText()), T('画面に「ポイントは含めていません」'));
    // 編集を押す → 欄が開く → 保存できる → 閉じる
    for (const id of ['a5', 'a3', 'a1']) {
      await p.locator('#lg-rows tr[data-id="' + id + '"] .ops [data-edit]').click();
      ok(await p.locator('#lg-rows tr.ed [data-e="name"]').isVisible(), T('「編集」を押すと編集欄が開く: ' + id));
      await p.locator('#lg-rows tr.ed [data-e="memo"]').fill('検品メモ ' + id);
      await p.locator('#lg-rows tr.ed [data-e="salePrice"]').fill('4100');
      const r = await row(id);
      ok(r.memo === '検品メモ ' + id && r.salePrice === 4100, T('入力がその行に保存される: ' + id));
      ok((await p.locator('#lg-rows tr[data-id="' + id + '"] .ops [data-edit]').innerText()) === '閉じる', T('開いている間は「閉じる」: ' + id));
      await p.locator('#lg-rows tr[data-id="' + id + '"] .ops [data-edit]').click();
      ok(await p.locator('#lg-rows tr.ed').count() === 0, T('もう一度押すと閉じる: ' + id));
    }
    await p.locator('#lg-rows tr[data-id="a4"] .ops [data-edit]').click(); await p.locator('#lg-rows tr.ed [data-close]').click();
    ok(await p.locator('#lg-rows tr.ed').count() === 0, T('編集欄の中の「閉じる」'));
    await p.reload(); await p.waitForTimeout(400);
    ok((await row('a3')).memo === '検品メモ a3' && /4,100/.test(await p.locator('#lg-rows tr[data-id="a3"]').innerText()), T('開き直しても残っている'));
    // 入庫へ(発送代行・FBAの行) → 元に戻す
    await p.locator('[data-adv="a5"]').click();
    ok((await row('a5')).status === '入庫' && /入庫/.test(await toast()), T('「入庫へ」で状態が進む'));
    await p.locator('#toast button', { hasText: '元に戻す' }).click();
    ok((await row('a5')).status === '仕入れ済', T('元に戻す'));
    // 自分で発送の行: 出品中へ → 売れた(売却欄を自動記入)
    await p.locator('[data-adv="a4"]').click();
    ok((await row('a4')).status === '出品中', T('自分で発送は入庫を飛ばして「出品中」'));
    ok((await p.locator('[data-adv="a4"]').innerText()) === '売れた', T('次のボタンは「売れた」'));
    await p.locator('[data-adv="a4"]').click();
    const s4 = await row('a4');
    ok(s4.status === '売約' && !!s4.saleDate && s4.salePrice === 1980 && /購入者/.test(s4.saleParty), T('「売れた」で売却日・売値・相手が入る'));
    await p.locator('[data-adv="a4"]').click();
    ok((await row('a4')).status === '発送済' && await p.locator('[data-adv="a4"]').count() === 0, T('「発送済へ」。最後はボタンが無い'));
    // 無在庫: 出品停止 / 売れた(仕入れる)
    ok(await p.locator('[data-stop="a2"]').count() === 1, T('終了が近い行に「出品停止」'));
    await p.locator('[data-stop="a2"]').click();
    ok((await row('a2')).status === '出品停止', T('「出品停止」を押すと止まる'));
    // 印を付ける → 札を押して外す
    await p.locator('#lg-rows [data-rp="a5"]').click();
    ok((await row('a5')).repeat === true && await p.locator('.rp-tag[data-rp="a5"]').count() === 1, T('「また仕入れる印を付ける」'));
    await p.locator('.rp-tag[data-rp="a5"]').click();
    ok((await row('a5')).repeat === false, T('札を押すと外れる'));
    // 売り手の確認の札 → 編集欄
    await p.evaluate(() => { const U = window.SedoriUI; U.ledger.update('a3', { verify: '' }); window.SedoriLedgerPage.render(); });
    await p.locator('#lg-rows tr[data-id="a3"] .badge[data-edit]').click();
    ok(await p.locator('#lg-rows tr.ed').count() === 1, T('「売り手の確認が未入力」の札でも編集欄が開く'));
    await p.locator('#lg-rows tr[data-id="a3"] .ops [data-edit]').click();
    // 消す → 元に戻す → 消す
    await p.locator('#lg-rows tr[data-id="a1"] .ops [data-del]').click();
    ok(!(await row('a1')) && (await led()).length === 4, T('「消す」でその行だけ消える'));
    await p.locator('#toast button', { hasText: '元に戻す' }).click();
    ok(!!(await row('a1')) && (await led()).length === 5, T('消した行を元に戻せる'));
    // 手で追加 → 開いた欄に入力
    await p.locator('#lg-add').click();
    await p.locator('#lg-rows tr.ed [data-e="name"]').fill('手で足した品');
    ok((await led())[0].name === '手で足した品' && (await led()).length === 6, T('「手で追加」'));
    await ctx.close();
  }
  ok(errs.length === 0, '画面のエラーなし: ' + errs.join(' / '));
  console.log(`OK 台帳のボタン ${n}件`);
  await browser.close(); server.close();
})().catch(e => { console.error(e); process.exit(1); });
