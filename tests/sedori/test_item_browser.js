// 商品ページ(shohin/)を、本物のブラウザ(Playwright の chromium)で確かめる。ボタンは実際に押す。
// 実行: node tests/sedori/test_item_browser.js [公開フォルダ]。Keepa・楽天は、にせの返事に差し替える(外へは出ない)。
const path = require('path'), fs = require('fs'), http = require('http'), assert = require('assert');
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
const root = path.resolve(process.argv[2] || path.join(__dirname, '../../../kt-zs-sedori-ghp'));
const SD = require('./_dir')(root);
const KEY_MODE = /^\s*KEY_MODE:\s*true/m.test(fs.readFileSync(path.join(root, SD, 'assets/config.js'), 'utf8'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
let n = 0;
function eq(a, b, msg) { assert.deepStrictEqual(a, b, `${msg}: 実際 ${JSON.stringify(a)} / 期待 ${JSON.stringify(b)}`); n++; }
const server = http.createServer((req, res) => {
  let f = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(root)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
const KEYS = { rkApp: 'a', rkKey: 'b', keepa: 'k'.repeat(20) };
// 例: おもちゃ・標準2c・納品100。売値3,980円・仕入れ2,400円 → 利益605円(目標15%=597円に届く)
const ITEM = { src: 'rakuten', name: 'テスト商品 ABC', price: 2400, shop: 'テスト店', url: 'https://item.rakuten.co.jp/x/abc/', jan: '4902370500014', code: 'x:abc', freeShip: true, shopPt: 1, sell: 3980, inShip: 0 };
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const B = `http://127.0.0.1:${server.address().port}/${SD}/`;
  const browser = await chromium.launch();
  const errs = []; let kpCalls = 0, rkCalls = 0;
  async function open(url, ls = {}, width = 375) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(url + ' ' + e.message));
    await p.route('**/api.keepa.com/**', async route => {
      kpCalls++;
      route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ tokensLeft: 77, products: [{ asin: 'B0TESTASIN', title: 'テスト商品 ABC', monthlySold: 60, stats: { current: [-1, 3980, 0, 1200, 0, 0, 0, 0, 0, 0, 0, 4], salesRankDrops30: 40, salesRankDrops90: 120, avg90: [-1, 4100] },
          csv: { 1: [Math.floor((Date.now() - 80 * 86400000) / 60000) - 21564000, 4500, Math.floor((Date.now() - 40 * 86400000) / 60000) - 21564000, 4100, Math.floor((Date.now() - 5 * 86400000) / 60000) - 21564000, 3980] } }] }) });
    });
    await p.route('**/openapi.rakuten.co.jp/**', async route => {
      rkCalls++;
      route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ Items: [1, 2, 3, 4].map(i => ({ itemName: 'テスト商品 ABC ' + i, itemPrice: 2400 + i * 10, itemUrl: 'https://item.rakuten.co.jp/s' + i + '/', shopName: '店' + i, itemCode: 's' + i + ':abc', postageFlag: 0, pointRate: 1 })) }) });
    });
    await p.goto(B + 'terms/');
    await p.evaluate(o => { for (const k in o) localStorage.setItem('zw-sedori:' + k, JSON.stringify(o[k])); }, Object.assign({ keys: KEYS }, ls));
    await p.goto(B + url); await p.waitForTimeout(700);
    return p;
  }
  const txt = (p, sel) => p.$eval(sel, el => el.innerText);
  const count = (p, sel) => p.$$eval(sel, a => a.length);
  const over = p => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const small = p => p.evaluate(() => Array.from(document.querySelectorAll('#it .it-btn, #it summary, #it input')).filter(e => e.offsetParent && e.getBoundingClientRect().height < 43.5).map(e => e.textContent.trim().slice(0, 12) + ':' + Math.round(e.getBoundingClientRect().height)));
  try {
    // ---- 一覧(検索結果)の行から1タップで開く ----
    let p = await open('rakuten-amazon/', { 'ra-last': { q: 'テスト', items: [ITEM] } });
    eq(await count(p, '#rows a.it-go'), 1, '検索結果の行に「商品ページ」がある');
    await p.click('#rows a.it-go'); await p.waitForURL(/shohin\//); await p.waitForTimeout(700);
    eq(/テスト商品 ABC/.test(await txt(p, '#it h1')), true, '商品名が出る');
    eq(/605/.test(await txt(p, '#it-sum .it-pf')), true, '見込み利益(ポイント抜き)は手計算と同じ605円');
    eq(/目標に届く/.test(await txt(p, '#it-sum .it-v')), true, '判定は「目標に届く」');
    eq([/3,980/.test(await txt(p, '.it-pr')), /2,400/.test(await txt(p, '.it-pr'))], [true, true], 'Amazonの売値と仕入れ値が並ぶ');
    eq(await count(p, '#it .it-btn.fill'), 1, '塗りのボタンは1つ');
    eq(await over(p), 0, '375pxで横にはみ出さない');
    eq(await small(p), [], '押す所は44px以上');
    eq(await p.$eval('#it-sum .it-v', el => parseFloat(getComputedStyle(el).fontSize)) >= 16, true, '判定の文は16px以上');
    eq(/取り寄せ販売/.test(await txt(p, '#it-adv h2')), true, '在庫の目安の見出しは「取り寄せ販売」');
    eq(/売れ行きは取れていません/.test(await txt(p, '#it-sales')), true, 'Keepaが無い時は売れ行きを出さない');
    // ---- Keepaで取ると、売れ行き・推移の図が出る(Keepaの画像は貼らない) ----
    await p.click('[data-act="kp"]'); await p.waitForTimeout(900);
    eq(kpCalls, 1, 'Keepaを1回だけ呼ぶ');
    eq(await count(p, '#it-chart svg.it-ch'), 1, '価格の推移の図(自前のSVG)が出る');
    eq(await count(p, '#it img[src*="keepa"]'), 0, 'Keepaの画像は貼らない');
    const sales = await txt(p, '#it-sales');
    eq([/60個以上/.test(sales), /120個/.test(sales), /0\.5日に1個|1日に約/.test(sales), /目安です。実際の販売数ではありません/.test(sales)], [true, true, true, true], '30日60個以上・90日120個・ペース・目安の注記');
    eq(/速い/.test(sales), true, '段階は「速い」');
    eq(/在庫で持つ向き/.test(await txt(p, '#it-adv')), true, '売れる速い品は「在庫で持つ向き」');
    eq(/最後は売れた価格を見て決めてください/.test(await txt(p, '#it-adv')), true, '目安であり、最後は自分で決める旨がある');
    // ---- 数字を直す: 売値を下げると届かなくなり、判定が変わる ----
    await p.click('#it-edit summary'); await p.fill('#e-sell', '3800'); await p.dispatchEvent('#e-sell', 'change'); await p.waitForTimeout(200);
    eq(/届かない/.test(await txt(p, '#it-sum .it-v')), true, '売値3,800円に直すと「目標に届かない」');
    await p.fill('#e-sell', '3980'); await p.dispatchEvent('#e-sell', 'change'); await p.waitForTimeout(200);
    eq(/目標に届く/.test(await txt(p, '#it-sum .it-v')), true, '3,980円に戻すと届く');
    // ---- 操作: 仕入れた(台帳へ) ----
    await p.click('[data-act="buy"]'); await p.waitForTimeout(300);
    let led = await p.evaluate(() => JSON.parse(localStorage.getItem('zw-sedori:ledger') || '[]'));
    eq([led.length, led[0] && led[0].profit, led[0] && led[0].pnp, led[0] && led[0].calc && led[0].calc.rkCode], [1, 605, true, 'x:abc'], '台帳に1行(利益605・ポイント抜き・楽天の商品コード)');
    eq(await count(p, '[data-act="buy"]'), 0, '記録後は「仕入れた」を出さない');
    // ---- ウォッチに入れる ----
    await p.click('[data-act="watch"]'); await p.waitForTimeout(200);
    eq(await p.evaluate(() => JSON.parse(localStorage.getItem('zw-sedori:watch2') || '[]').length), 1, 'ウォッチに1件');
    // ---- 在庫番に登録(listed.js の口。読み込まれていなくても、置き手紙で入る) ----
    await p.click('[data-act="listed"]'); await p.waitForTimeout(300);
    const inbox = await p.evaluate(() => JSON.parse(localStorage.getItem('zw-sedori:mz-inbox') || '[]'));
    const ls = await p.evaluate(() => { try { return JSON.parse(localStorage.getItem('zw-sedori:mz-items') || 'null'); } catch (e) { return null; } });
    eq(inbox.length > 0 || (ls && JSON.stringify(ls).includes('4902370500014')), true, '在庫番に送られる(置き手紙か、在庫番の保存)');
    eq(/在庫番/.test(await txt(p, '#it-acts')), true, '登録後の知らせは「在庫番」');
    // ---- 台帳の行から開く(?l=) ----
    const lid = led[0].id;
    await p.goto(B + 'shohin/?l=' + encodeURIComponent(lid)); await p.waitForTimeout(700);
    eq(/台帳へ戻る/.test(await txt(p, '#it-back')), true, '台帳の行から開くと、戻り先は台帳');
    eq(/605/.test(await txt(p, '#it-sum .it-pf')), true, '台帳の行でも利益が出る');
    await p.close();
    // ---- 送料別の店しか無い行: 判定は「未入力」。送料を入れると計算 ----
    p = await open('rakuten-amazon/', { 'ra-last': { q: 'テスト', items: [Object.assign({}, ITEM, { freeShip: false, needShip: true })] } });
    await p.click('#rows a.it-go'); await p.waitForURL(/shohin\//); await p.waitForTimeout(700);
    eq(/未入力/.test(await txt(p, '#it-sum')) && /送料を入れると/.test(await txt(p, '#it-sum')), true, '送料別の店だけの行は「未入力(送料を入れてください)」');
    eq(await p.$eval('#it-acts .it-btn.fill', el => el.textContent.trim()), '送料を入れる', '塗りのボタンは「送料を入れる」(送料の欄へ誘導)');
    await p.click('#it-acts .it-btn.fill'); await p.waitForTimeout(300);
    eq(await p.evaluate(() => document.activeElement && document.activeElement.id), 'e-ship', '送料の欄にカーソルが移る');
    await p.fill('#e-ship', '0'); await p.dispatchEvent('#e-ship', 'change'); await p.waitForTimeout(200);
    eq(/605/.test(await txt(p, '#it-sum .it-pf')), true, '送料0円と入れると計算する');
    await p.close();
    // ---- 商品が選ばれていない時 ----
    p = await open('shohin/');
    eq(/商品が選ばれていません/.test(await txt(p, '#it')), true, '何も選ばずに開くと案内を出す');
    await p.close();
    // ---- PC幅 ----
    p = await open('rakuten-amazon/', { 'ra-last': { q: 'テスト', items: [ITEM] } }, 1280);
    await p.click('#rows a.it-go'); await p.waitForURL(/shohin\//); await p.waitForTimeout(700);
    eq([await over(p), await count(p, '#it .it-btn.fill')], [0, 1], '1280pxで横にはみ出さない・塗りのボタンは1つ');
    await p.close();
    // ---- 呼び名 ----
    p = await open('muzaiko-amazon/');
    eq([/取り寄せ販売 Amazon中古×ヤフオク/.test(await p.title()), /無在庫/.test(await p.content())], [true, false], '取り寄せ販売のページ名。「無在庫」は画面に出ない');
    eq(await p.$$eval('.gnav a', a => a.map(x => x.textContent.trim()).filter(t => /取り寄せ|在庫番/.test(t))), ['取り寄せ販売 Amazon中古', '在庫番'], '上の帯に「取り寄せ販売 Amazon中古」と「在庫番」');
    await p.close();
    p = await open('zaiko-ban/');
    eq([/在庫番/.test(await p.title()), await count(p, '#listed')], [true, 1], '在庫番のページがある(zaiko-ban/)');
    await p.close();
    // ---- 月の固定費: クラウドの設定を待つ間は値を出さない ----
    p = await open('rakuten-amazon/', { 'acct-hint': 1, fixed: [{ id: 'amz', name: 'Amazon 大口出品', on: true, v: 99999 }] });
    const early = await p.$eval('#hd-fix-v', el => [el.hidden, el.textContent]);
    if (KEY_MODE) {
      // 利用の鍵の形(2026-11-17): クラウドの設定は無いので、前にログインした印が残っていても待たずに端末の値を出す
      eq(early, [false, '99,999円'], '利用の鍵の形: クラウドの設定を待たず、すぐ端末の値を出す');
    } else {
      eq(early, [false, '読み込み中'], 'ログイン済みの端末では、設定が届くまで月の固定費は「読み込み中」');
      await p.waitForTimeout(6500);
      eq(await p.$eval('#hd-fix-v', el => el.textContent), '99,999円', '打ち切り後(通信が届かない時)は端末の値を出す');
    }
    await p.close();
    p = await open('rakuten-amazon/', { fixed: [{ id: 'amz', name: 'Amazon 大口出品', on: true, v: 5000 }] });
    eq(await p.$eval('#hd-fix-v', el => el.textContent), '5,000円', 'ログインしていない端末は、すぐ値を出す');
    await p.close();
    eq(errs, [], '画面の誤り(pageerror)なし');
    console.log(`OK 商品ページの画面 ${n}件`);
  } catch (e) { console.error(e); process.exitCode = 1; }
  await browser.close(); server.close();
})();
