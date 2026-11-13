// 2026-11-13 に足した画面(まとめて・納品代行の費用・月の固定費)を、本物のブラウザ(Playwright の chromium)で確かめる。
// 実行: node tests/sedori/test_add_browser.js [公開フォルダ]。Keepa・楽天は、にせの返事に差し替える(外へは出ない)。
const path = require('path'), fs = require('fs'), http = require('http'), assert = require('assert');
const { chromium } = require('playwright');
const root = path.resolve(process.argv[2] || path.join(__dirname, '../../../kt-zs-sedori-ghp'));
const SD = require('./_dir')(root);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
let n = 0;
function eq(a, b, msg) { assert.deepStrictEqual(a, b, `${msg}: 実際 ${JSON.stringify(a)} / 期待 ${JSON.stringify(b)}`); n++; }
function jan(i) {
  const b = '4902370' + String(50000 + i).slice(0, 5), d = b.split('').map(Number);
  return b + String((10 - d.reduce((t, x, k) => t + x * (k % 2 ? 3 : 1), 0) % 10) % 10);
}
const server = http.createServer((req, res) => {
  let f = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(root)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const B = `http://127.0.0.1:${server.address().port}/${SD}/`;
  const browser = await chromium.launch();
  const errs = [];
  let kpCalls = 0;
  async function open(url, ls = {}, width = 1280) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(url + ' ' + e.message));
    await p.route('**/api.keepa.com/**', async route => {
      kpCalls++; await new Promise(r => setTimeout(r, 400));
      const q = new URL(route.request().url()).searchParams, codes = (q.get('code') || q.get('asin')).split(',');
      route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ tokensLeft: 99, products: codes.map(c => ({ asin: 'B0X' + c.slice(-7), eanList: [c], title: '商品 ' + c, stats: { current: [-1, 3980, 0, 100, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 3980], avg90: [0, 4000] }, monthlySold: 50 })) }) });
    });
    await p.goto(B + 'terms/');
    await p.evaluate(o => { for (const k in o) localStorage.setItem('zw-sedori:' + k, JSON.stringify(o[k])); }, ls);
    await p.goto(B + url); await p.waitForTimeout(600);
    return p;
  }
  const txt = (p, sel) => p.$eval(sel, el => el.innerText);
  const count = (p, sel) => p.$$eval(sel, a => a.length);
  const over = p => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const setChk = (p, id, v) => p.evaluate(([id, v]) => { const c = document.getElementById(id); c.checked = v; c.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]);
  try {
    // ---- まとめて: キーなし・無料。貼った数字だけで計算し、目標に届く行だけ残る ----
    // 例A(おもちゃ・標準2c・納品100): 売値3,980円。仕入れ2,400円=605円(届く)、2,500円=505円(届かない)。目標は15%=597円
    let p = await open('rakuten-amazon/');
    await p.click('[data-tab="b"]');
    eq(await p.isVisible('#bulk-box'), true, 'まとめてのタブで貼る欄が出る');
    eq(/一覧を貼って/.test(await txt(p, '#rows')), true, '空の時の案内');
    eq(/無料プランは1回20行まで/.test(await txt(p, '#bulk-lim')), true, '行数の上限の案内');
    await p.click('#bulk-run');
    eq(/貼ってから押してください/.test(await txt(p, '#bulk-st')), true, '空で押すと、何が足りないかを出す');
    const lines = Array.from({ length: 25 }, (_, i) => jan(i) + '\t' + (i % 2 ? 2500 : 2400) + '\t3980');
    await p.fill('#bulk-text', lines.concat(['4902370500007', jan(0)]).join('\n'));
    await p.click('#bulk-run'); await p.waitForTimeout(500);
    eq(await p.isChecked('#profitonly'), true, '終わると「目標を満たす行だけ」が入る');
    eq(await count(p, '#rows tr[data-i]'), 10, '無料の20行のうち、目標に届く10行だけ残る');
    const sum = await txt(p, '#bulk-st');
    eq([/目標に届く\s*10\s*件/.test(sum), /27行のうち\s*届かない10・読めなかった1/.test(sum), /未入力/.test(sum)], [true, true, false], '上の件数は1行の文: 目標に届く10件/27行のうち 届かない10・読めなかった1(0件の項目は出さない)');
    eq(await p.$eval('.bulk-sum b', el => [getComputedStyle(el).fontSize, getComputedStyle(el).fontWeight]), ['20px', '700'], '届く件数だけ20px・太字');
    eq(await count(p, '#bulk-st .bulk-act'), 1, '一覧の上の注記は、次にすること1つだけ');
    eq(await p.$eval('#bulk-st .bulk-act .btn', el => el.getBoundingClientRect().height >= 44), true, '「料金を見る」は44px以上のボタン');
    eq(/21行目から先の5行は計算していません/.test(sum), true, '無料は21行目から先を計算せず、理由を1行で出す');
    eq(/料金を見る/.test(sum) && await count(p, '#bulk-st a[href$="plans/"]') === 1, true, '料金への案内がある');
    eq(/同じコードの1行/.test(await txt(p, '#bulk-bad')), true, '重複をまとめた案内は一覧の下');
    eq(await p.$eval('#grid', el => el.classList.contains('noimg')), true, '写真が1枚も無い一覧は写真の列を消す');
    eq([/名前を取れていません/.test(await txt(p, '#rows tr[data-i] .nm')), (await txt(p, '#rows tr[data-i]')).split(jan(0)).length - 1], [true, 1], '名前が無い行: 1行目は「名前を取れていません」、番号は1回だけ');
    eq(await p.$eval('#bulk-run', el => getComputedStyle(el).backgroundColor !== 'rgb(255, 255, 255)') && await p.$eval('[data-act="list"]', el => getComputedStyle(el).backgroundColor === 'rgb(255, 255, 255)'), true, '行を選ぶ前は「まとめて計算する」だけが塗り');
    eq(/605/.test(await txt(p, '#rows tr[data-i] td[data-k="利益"]')), true, '1行目の利益は手計算と同じ605円');
    await setChk(p, 'profitonly', false); await p.waitForTimeout(200);
    eq(await count(p, '#rows tr[data-i]'), 20, '「目標を満たす行だけ」を外すと20行すべて出る');
    eq(/読めなかった行 1件/.test(await txt(p, '#bulk-bad')), true, '読めなかった行を下に出す');
    // 行を押すと右に内訳。キー操作(下・S)は今までどおり
    await p.click('#rows tr[data-i="0"]'); await p.waitForTimeout(200);
    eq(await p.inputValue('#c-cost'), '2400', '行を押すと右の欄に値が入る');
    await p.keyboard.press('ArrowDown'); await p.waitForTimeout(150);
    eq(await p.inputValue('#c-cost'), '2500', '下キーで次の行');
    await p.keyboard.press('s'); await p.waitForTimeout(300);
    const led = await p.evaluate(() => JSON.parse(localStorage.getItem('zw-sedori:ledger'))[0]);
    eq([led.unit, led.sellPrice, led.calc.fbaTier, led.calc.inbound], [2500, 3980, 'std2c', 100], 'Sで台帳に入り、計算の条件(calc)が残る');
    eq([led.profit, led.pnp, led.calc.pointRate > 0], [505, true, true], '台帳の見込み利益は最初からポイント抜き(505円)で、pnp=true の印が付く');
    const xl = await p.evaluate(async () => { const U = window.SedoriUI, o = { widths: [10], nums: {}, headerRow: 1, titleRow: 0 };
      const a = await U.xlsx([['題'], ['見出し'], ['値']], Object.assign({ sheet: '納品リスト' }, o)).text(), b = await U.xlsx([['題'], ['見出し'], ['値']], o).text();
      return [/sheet name="納品リスト"/.test(a), /&#39;納品リスト&#39;!\$2:\$2|'納品リスト'!\$2:\$2/.test(a), /sheet name="古物台帳"/.test(b)]; });
    eq(xl, [true, true, true], 'Excelのシート名を渡せる(渡さなければ「古物台帳」)');
    eq(await count(p, '#slot-evidence [data-ev]'), 2, '仕入れた直後に、注文番号と書類の種類の2欄');
    await p.fill('[data-ev="orderNo"]', 'A-123'); await p.selectOption('[data-ev="docType"]', '領収書');
    const led2 = await p.evaluate(() => JSON.parse(localStorage.getItem('zw-sedori:ledger'))[0]);
    eq([led2.orderNo, led2.docType], ['A-123', '領収書'], '証拠の2項目が台帳の行に入る');
    // 残った行をウォッチへ
    await setChk(p, 'profitonly', true); await p.waitForTimeout(200);
    await p.click('#b-watch'); await p.waitForTimeout(200);
    eq(await txt(p, '#n-w'), '10', '残った10行がウォッチに入る');
    eq(await p.evaluate(() => JSON.parse(localStorage.getItem('zw-sedori:watch2'))[0].base), 2400, 'ウォッチの行に保存時の価格(base)');
    // 読み込み直しても結果が残る
    await p.reload(); await p.waitForTimeout(600);
    eq(await txt(p, '#n-b'), '20', '読み込み直しても、最後の1回分が残る');
    await p.context().close();

    // ---- 売値も仕入れ値も無い行は「未入力」。CSVの利益はポイント抜き。大きすぎる金額で固まらない ----
    p = await open('rakuten-amazon/?tab=b');
    await p.fill('#bulk-text', [jan(1), jan(2), jan(3)].join('\n')); await p.click('#bulk-run'); await p.waitForTimeout(400);
    eq(/3行のうち\s*未入力3/.test(await txt(p, '#bulk-st')), true, 'JANだけ3行 → 未入力3(届かないに数えない)');
    await p.click('#bulk-in > summary');   // 計算の後は貼る欄が閉じるので、開いてから貼り直す
    await p.fill('#bulk-text', jan(1) + '\t2400\t3980\n' + jan(2) + '\t4902370500028\t3980\n' + jan(3) + '\t100000000');
    const tb = Date.now(); await p.click('#bulk-run'); await p.waitForTimeout(400);
    eq([Date.now() - tb < 3000, await count(p, '#rows tr[data-i]'), /金額を確かめてください/.test(await p.$eval('#bulk-bad', el => el.textContent))], [true, 1, true], '仕入れ値にJAN・1億円を貼っても固まらず、「金額を確かめてください」と出る');
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#w-csv')]);
    const csv = fs.readFileSync(await dl.path(), 'utf8');
    eq([/利益・ポイント抜き\(円\/個\)/.test(csv), /,2400,3980,605,15\.2,21\r?\n/.test(csv)], [true, true], 'CSV: 利益605円・利益率15.2%はポイント抜き、ポイント21円は別の列');
    await p.click('#rows tr[data-i="0"]'); await p.fill('#c-cost', '4902370500028'); await p.waitForTimeout(300);
    eq(/金額を確かめてください/.test(await txt(p, '#c-out')), true, '計算ページの仕入れ値に13桁を入れても固まらず、「金額を確かめてください」');
    await p.context().close();

    // ---- 仕入れ値なし: 利益の代わりに仕入れ値の上限(右の欄と同じ値) ----
    p = await open('rakuten-amazon/?tab=b');
    await p.fill('#bulk-text', jan(1) + '\t\t3980'); await p.click('#bulk-run'); await p.waitForTimeout(400);
    eq(/上限\s*2,408/.test(await txt(p, '#rows tr[data-i] td[data-k="仕入れ値"]')), true, '仕入れ値なしの行は上限2,408円');
    await p.click('#rows tr[data-i="0"]'); await p.fill('#c-cost', '2000'); await p.waitForTimeout(200);
    eq(/2,408円/.test(await txt(p, '#c-out')), true, '右の欄の「仕入れ値の上限」と同じ');
    await p.context().close();

    // ---- Keepaあり: 計算中にタブを替えても止まらず、二重に走らない ----
    kpCalls = 0;
    p = await open('rakuten-amazon/?tab=b', { keys: { keepa: 'k' } });
    await p.fill('#bulk-text', Array.from({ length: 5 }, (_, i) => jan(i) + '\t2400').join('\n'));
    await p.click('#bulk-run'); await p.click('#bulk-run');
    eq(await count(p, '#bulk-stop'), 1, '進み具合と「止める」が出る');
    await p.click('[data-tab="s"]'); await p.waitForTimeout(900);
    eq(kpCalls, 1, '2回押しても Keepa は1回だけ');
    await p.click('[data-tab="b"]'); await p.waitForTimeout(200);
    eq(await count(p, '#rows tr[data-i]'), 5, 'タブを替えている間に終わり、5行とも売値が入って目標に届く');
    eq(/月の販売 50個/.test(await txt(p, '#rows')), true, '月の販売と出品者数が行に出る');
    // 絞り込み3つ
    await p.fill('#f-sold', '100'); await p.waitForTimeout(200);
    eq(await count(p, '#rows tr[data-i]'), 0, '月の販売100個以上で絞ると0行');
    await p.fill('#f-sold', ''); await p.fill('#f-cnt', '3'); await p.waitForTimeout(200);
    eq(await count(p, '#rows tr[data-i]'), 0, '出品者3人以下で絞ると0行(5人)');
    await p.fill('#f-cnt', '5'); await p.waitForTimeout(200);
    eq(await count(p, '#rows tr[data-i]'), 5, '出品者5人以下なら5行');
    await p.context().close();
    // Keepaの値が無い行は、絞り込みで外さず「未取得」と出す
    p = await open('rakuten-amazon/?tab=b');
    await p.fill('#bulk-text', jan(1) + '\t2400\t3980'); await p.click('#bulk-run'); await p.waitForTimeout(300);
    await p.fill('#f-sold', '100'); await setChk(p, 'f-noamz', true); await p.waitForTimeout(200);
    eq([await count(p, '#rows tr[data-i]'), /売れ方は取れていません/.test(await txt(p, '#rows'))], [1, true], 'Keepaの値が無い行は残り、「取れていません」と出る');
    await p.context().close();

    // ---- Keepaが失敗した時: 赤の印と文、「続きから計算する」のボタン ----
    p = await open('rakuten-amazon/?tab=b', { keys: { keepa: 'k' } }, 375);
    await p.unroute('**/api.keepa.com/**');
    let failing = true;
    await p.route('**/api.keepa.com/**', route => failing ? route.fulfill({ status: 500, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' })
      : route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ tokensLeft: 9, products: [] }) }));
    await p.fill('#bulk-text', jan(1) + '\t2400\n' + jan(2) + '\t2400'); await p.click('#bulk-run'); await p.waitForTimeout(500);
    const ft = await txt(p, '#bulk-st .bulk-act.err');
    eq([/Keepaから売値を取れませんでした。キーが正しいかを見て、もう一度お試しください/.test(ft), /番号 500/.test(ft), /\(500\)/.test(ft)], [true, true, false], '失敗の文(番号は末尾に小さく)');
    eq(await p.$eval('#bulk-st .bulk-act.err p', el => [getComputedStyle(el).fontSize, getComputedStyle(el).color]), ['14px', 'rgb(196, 35, 28)'], '失敗は赤の文字14px');
    eq(await count(p, '#bulk-st .bulk-act.err .bulk-ic'), 1, '赤の印が付く(色だけに頼らない)');
    eq([await txt(p, '#bulk-resume'), await p.$eval('#bulk-resume', el => el.getBoundingClientRect().height >= 44)], ['続きから計算する', true], '「続きから計算する」は44px以上のボタン');
    failing = false; await p.click('#bulk-resume'); await p.waitForTimeout(500);
    eq(await count(p, '#bulk-st .bulk-act.err'), 0, '続きから計算すると、失敗の表示が消える');
    eq(await p.$eval('#rows tr[data-i] td[data-k]', el => getComputedStyle(el, '::before').fontSize), '12px', 'スマホ幅: 項目名は12px');
    eq(await p.$eval('#rows tr[data-i] .yen', el => [getComputedStyle(el).fontSize, getComputedStyle(el).fontWeight]), ['16px', '700'], 'スマホ幅: 値は16px・太字');
    await p.context().close();

    // ---- 納品代行の費用: 二重に引かない。自分で納品に戻すと元の利益 ----
    p = await open('rakuten-amazon/');
    await setChk(p, 'c-usept', false);
    await p.fill('#c-cost', '2500'); await p.fill('#c-sell', '3980'); await p.waitForTimeout(200);
    eq(/505/.test(await txt(p, '#c-out .gate .hl b')), true, '自分で納品: 505円');
    await p.click('#shipm [data-s="3pl"]'); await p.waitForTimeout(300);
    eq(await count(p, '#wh [data-prep]'), 3, '発送代行+FBAで、納品代行の3項目が出る');
    eq(/ご自身の契約の料金に直してください/.test(await txt(p, '#wh')), true, '仮の値の注記');
    eq(/461/.test(await txt(p, '#c-out .gate .hl b')), true, '納品代行: 461円(144円を引き、納品送料100円は引かない)');
    eq(/発送代行\(代行料100円\+箱870円÷20個\)\s*-144円/.test(await txt(p, '#brk')), true, '内訳の行');
    eq([/発送代行の費用\(1個\)/.test(await txt(p, '#wh')), /納品代行/.test(await txt(p, '#calc'))], [true, false], '呼び方は「発送代行」にそろえる');
    eq(/納品送料・資材/.test(await txt(p, '#brk')), false, '内訳に納品送料の行は出ない');
    await p.fill('#wh [data-prep="per"]', '10'); await p.waitForTimeout(200);
    eq(/418/.test(await txt(p, '#c-out .gate .hl b')), true, '1箱10個に直すと 100+87=187円 → 418円');
    await setChk(p, 'c-self', true); await p.waitForTimeout(300);
    eq(await count(p, '#wh [data-wh]'), 4, 'FBAを使わない+発送代行は、今までどおり4項目');
    await setChk(p, 'c-self', false);
    await p.click('#shipm [data-s="self"]'); await p.waitForTimeout(300);
    eq(/505/.test(await txt(p, '#c-out .gate .hl b')), true, '自分で発送に戻すと505円');
    await p.context().close();

    // ---- 月の固定費 ----
    p = await open('rakuten-amazon/');
    await setChk(p, 'c-usept', false);
    eq(await count(p, '.fixl'), 0, '売値が未入力の間は出ない');
    await p.fill('#c-cost', '2500'); await p.fill('#c-sell', '3980'); await p.waitForTimeout(200);
    eq(/月の固定費を入れる/.test(await txt(p, '.fixl')), true, '初めは入口の1行');
    await p.click('.fixl [data-fix-open]'); await p.waitForTimeout(200);
    eq(await p.inputValue('[data-fx="amz"] [data-fx-v]'), '5390', '大口出品は手数料データの4,900円×1.1');
    await p.fill('[data-fx="keepa"] [data-fx-v]', '8500'); await p.waitForTimeout(100);
    eq(await p.isChecked('[data-fx="keepa"] [data-fx-on]'), true, '金額を入れた行は入になる');
    eq(await txt(p, '#fix-total'), '13,890円', '合計');
    await p.click('.fixend [data-x]'); await p.waitForTimeout(200);
    eq(/月の固定費\s*13,890円。この利益\(1個 505円\)なら、月に\s*28個\s*で固定費に届きます/.test((await txt(p, '.fixl')).replace(/\n/g, '')), true, '13,890÷505→28個');
    eq(await txt(p, '#hd-fix-v'), '13,890円', '帯に合計');
    await p.fill('#c-sell', '2900'); await p.waitForTimeout(200);
    eq(/この利益では固定費に届きません/.test(await txt(p, '.fixl')), true, '赤字の時');
    await p.fill('#c-sell', '3980');
    await p.click('#hd-fix'); await p.uncheck('[data-fx="amz"] [data-fx-on]'); await p.uncheck('[data-fx="keepa"] [data-fx-on]'); await p.click('.fixend [data-x]'); await p.waitForTimeout(200);
    eq(await count(p, '.fixl'), 0, '全部切なら1行を出さない');
    await p.context().close();
    // 5つの計算ページすべてで出る。スマホ幅で帯が崩れない
    const FIX = { fixed: [{ id: 'amz', name: 'Amazon 大口出品', on: true, v: null }, { id: 'o1', name: '梱包材', on: true, v: 2400 }] };
    for (const [url, set] of [['mercari-calc/?b-cost=1200&s-price=3980', null], ['yahuoku-mercari/?b-bid=3000&b-ship=750&s-price=6500', null], ['auction-mercari/', [['s-price', 9800]]], ['muzaiko-amazon/', [['mz-yprice', 4000], ['mz-actual', 9800], ['mz-sell', 9800]]], ['rakuten-amazon/', [['c-cost', 2500], ['c-sell', 3980]]]]) {
      p = await open(url, FIX, 375);
      if (set) { for (const [id, v] of set) await p.fill('#' + id, String(v)); await p.waitForTimeout(300); }
      if (/auction/.test(url)) { await p.fill('#b-bid', '5000').catch(() => {}); await p.waitForTimeout(300); }
      const line = await count(p, '.fixl') ? await txt(p, '.fixl') : '';
      eq(/月の固定費\s*7,790円/.test(line), true, url.split('/')[0] + ': 内訳の下に月の固定費の1行');
      eq(await over(p), 0, url.split('/')[0] + ': スマホ幅375pxで横にはみ出さない');
      eq([await p.isVisible('#hd-fix'), await p.$eval('.hd-in', el => el.getBoundingClientRect().height <= 216)], [false, true], url.split('/')[0] + ': スマホ幅の帯に「月の固定費」は出さず、帯は3段');
      eq(await count(p, '.ft a[data-fix-open]'), 1, url.split('/')[0] + ': 足に「月の固定費」の入口');
      await p.context().close();
    }
    for (const w of [375, 390]) {
      p = await open('rakuten-amazon/?tab=b', FIX, w);
      await p.fill('#bulk-text', Array.from({ length: 6 }, (_, i) => jan(i) + '\t' + (i % 2 ? 2500 : 2400) + '\t3980').join('\n')); await p.click('#bulk-run'); await p.waitForTimeout(400);
      eq(await over(p), 0, 'まとめての結果: 幅' + w + 'pxで横にはみ出さない');
      eq(await p.$eval('#bulk-run', el => el.getBoundingClientRect().height >= 44), true, '幅' + w + 'px: 「まとめて計算する」は44px以上');
      await p.context().close();
    }
    // 検索欄にJANを2つ以上 → まとめてへ(ほかのページからも)
    p = await open('mercari-calc/');
    await p.fill('#sb-q', jan(1) + ' ' + jan(2)); await p.selectOption('#sb-src', 'rakuten'); await p.click('#sbar button[type=submit]'); await p.waitForTimeout(900);
    eq([/rakuten-amazon\/\?bulk=/.test(p.url()), await txt(p, '#n-b')], [true, '2'], '検索欄にJANを2つ入れると「まとめて」で計算する');
    await p.context().close();

    eq(errs, [], '画面の誤りが無い');
    console.log(`OK ${n}件`);
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exit(1); });
