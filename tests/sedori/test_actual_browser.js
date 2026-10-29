// 実際の売値・ポイント抜きの利益・初期表示を、本物のブラウザ(Playwright の chromium)で確かめる。
// 実行: node tests/sedori/test_actual_browser.js [公開フォルダ]   (公開フォルダを小さなサーバーで配って開く)
const path = require('path'), fs = require('fs'), http = require('http'), assert = require('assert');
const { chromium } = require('playwright');
const root = path.resolve(process.argv[2] || path.join(__dirname, '../../../kt-zs-sedori-ghp'));
const SD = require('./_dir')(root);  // 準備中の間はテスト用の写しを開く
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json' };
let n = 0;
function eq(a, b, msg) { assert.deepStrictEqual(a, b, `${msg}: 実際 ${JSON.stringify(a)} / 期待 ${JSON.stringify(b)}`); n++; }

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  let f = path.join(root, p);
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
  async function open(url, js = true) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, javaScriptEnabled: js, serviceWorkers: 'block' });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(url + ' ' + e.message));
    await p.goto(B + url); await p.waitForTimeout(500);
    return p;
  }
  async function fill(p, vals) { for (const [id, v] of vals) await p.fill('#' + id, String(v)); await p.waitForTimeout(150); }
  const txt = (p, sel) => p.$eval(sel, el => el.innerText);
  try {
    // 楽天→Amazon: 実際の売値が未入力 → 入れてくださいの案内と、目標の売値は「目安」
    let p = await open('rakuten-amazon/');
    eq(await p.$$eval('[data-tab]', bs => bs.map(b => b.getAttribute('data-tab'))), ['s', 'w'], '見本表のタブが無い');
    await fill(p, [['c-cost', 1650]]);
    let out = await txt(p, '#c-out');
    eq([/Amazonの実際の売値を入れてください/.test(out), /逆算した目安/.test(out)], [true, true], '楽天→Amazon: 実際の売値が未入力の時');
    // 実際の売値 = 仕入れ値 → ポイント抜きで赤字。目標との差が出る
    await fill(p, [['c-sell', 1650]]);
    out = await txt(p, '#c-out');
    eq([/実際の売値/.test(out), /目標に[\d,]+円足りない/.test(out), /赤字/.test(out), await p.$('#c-out .gate.ng') !== null], [true, true, true, true], '楽天→Amazon: ポイント抜きで赤字');
    eq(out.indexOf('ポイント抜きの利益') < out.indexOf('ポイント(上乗せ'), true, '楽天→Amazon: ポイント抜きが先、ポイントは後');
    await fill(p, [['c-sell', 3480]]);
    out = await txt(p, '#c-out');
    eq([/目標より[\d,]+円高い/.test(out), /黒字/.test(out)], [true, true], '楽天→Amazon: 黒字と目標との差');
    // 目標の売値もポイント抜きで逆算する(2026-10-29 表示確認の指摘。価格差が先、ポイントは後)
    // 目標の売値ちょうどで売ると、ポイント抜きの利益が目標に届き、1円下では届かない
    const num = s => Number(String(s).replace(/[^\d-]/g, ''));
    const gateNoPt = async () => num(await p.$eval('#c-out .gate .hl b', el => el.textContent));
    await fill(p, [['c-sell', '']]);
    out = await txt(p, '#c-out');
    const tgt = num((out.match(/目標の売値\(([^)]*)\)\s*([\d,]+)円/) || [, , ''])[2]), pct = Number((out.match(/利益率(\d+(?:\.\d+)?)%/) || [])[1]);
    eq([tgt > 1650, pct > 0, /ポイント抜きで逆算した目安/.test(out)], [true, true, true], '楽天→Amazon: 目標の売値は「ポイント抜きで逆算」と書く');
    await fill(p, [['c-sell', tgt]]);
    const atT = await gateNoPt(), ptAdd = /ポイント\(上乗せ[^)]*\)\s*\+\d+円/.test(await txt(p, '#c-out'));
    await fill(p, [['c-sell', tgt - 1]]);
    const below = await gateNoPt();
    eq([ptAdd, atT >= Math.ceil(tgt * pct / 100), below < Math.ceil((tgt - 1) * pct / 100)], [true, true, true], '楽天→Amazon: 目標の売値はポイントを足さずに目標に届く最安の売値');
    eq(/目標より0円高い/.test(await (async () => { await fill(p, [['c-sell', tgt]]); return txt(p, '#c-out'); })()), true, '楽天→Amazon: 目標の売値ちょうどなら差は0円');
    await p.context().close();

    // ヤフオク→メルカリ: ポイントは原価から引かず、上乗せとして後から
    p = await open('yahuoku-mercari/');
    await fill(p, [['b-bid', 3000], ['b-ship', 750], ['b-pt', 1], ['s-price', 6500]]);
    out = await txt(p, '#m-out');
    eq([/ポイント抜きの利益/.test(out), /ポイント\(上乗せ・落札価格の1%\)\s*\+30円/.test(out), /黒字/.test(out)], [true, true, true], 'ヤフオク→メルカリ: ポイントは上乗せ');
    // 目標の売値もポイント抜き: 目標の売値ちょうどで、ポイント抜きの利益が目標に届く
    await fill(p, [['s-price', '']]);
    out = await txt(p, '#m-out');
    {
      const num = s => Number(String(s).replace(/[^\d-]/g, ''));
      const tgt = num((out.match(/目標の売値\(([^)]*)\)\s*([\d,]+)円/) || [, , ''])[2]), pct = Number((out.match(/利益率(\d+(?:\.\d+)?)%/) || [])[1]);
      eq([tgt > 0, pct > 0, /ポイント抜きで逆算した目安/.test(out)], [true, true, true], 'ヤフオク→メルカリ: 目標の売値は「ポイント抜きで逆算」と書く');
      await fill(p, [['s-price', tgt]]);
      const atT = num(await p.$eval('#m-out .gate .hl b', el => el.textContent));
      await fill(p, [['s-price', tgt - 1]]);
      const below = num(await p.$eval('#m-out .gate .hl b', el => el.textContent));
      eq([atT >= Math.ceil(tgt * pct / 100), below < Math.ceil((tgt - 1) * pct / 100)], [true, true], 'ヤフオク→メルカリ: 目標の売値はポイントを足さずに目標に届く最安の売値');
    }
    await p.context().close();

    // 無在庫: 中古の実際の売値の行
    p = await open('muzaiko-amazon/');
    await fill(p, [['mz-new', 5000], ['mz-actual', 3200], ['mz-yprice', 1500]]);
    eq(/実際の売値\(中古の今の価格\)/.test(await txt(p, '#rows')), true, '無在庫: 実際の売値の行');
    eq(/実際の売値で売れた時の利益/.test(await txt(p, '#mz-out')), true, '無在庫: 実際の売値での利益を先に');
    await p.context().close();

    // JavaScript が動かなくても、表と選択肢と案内が読める
    p = await open('mercari-calc/', false);
    eq((await p.$$('#rows tr[data-i]')).length > 10, true, 'JavaScriptなし: メルカリの表');
    eq(/JavaScript で動きます/.test(await txt(p, 'main')), true, 'JavaScriptなし: 案内');
    await p.context().close();
    p = await open('rakuten-amazon/', false);
    eq((await p.$$('#c-cat option')).length > 5, true, 'JavaScriptなし: カテゴリーの選択肢');
    await p.context().close();

    eq(errs, [], 'ページのエラーなし');
    console.log('OK ' + n + '件');
  } finally {
    await browser.close(); server.close();
  }
})().catch(e => { console.error(e); server.close(); process.exit(1); });
