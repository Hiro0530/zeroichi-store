// 在庫番の画面を、本物のブラウザ(Playwright の chromium)で実際に押して確かめる。スマホ幅375pxとPC幅1280pxの両方。
// 実行: node tests/sedori/test_listed_browser.js <公開フォルダ>。楽天はにせの返事(公式の形)。住所は PAGES の先頭から、あるものを開く。
const fs = require('fs'), path = require('path'), assert = require('assert');
const { chromium, serve, open, root, S } = require('./_listed_lib'), seed = require('./_listed_seed');
const PAGES = ['zaiko-ban/', 'zaiko-mihari/'];
let n = 0;
const getItems = p => p.evaluate(() => JSON.parse(localStorage.getItem('zw-sedori:mz-items') || '[]'));
const ok = (v, msg) => { assert.ok(v, msg); n++; };
(async () => {
  const { server, base } = await serve(), browser = await chromium.launch();
  const SD = require('./_dir')(root), page = PAGES.find(p => fs.existsSync(path.join(root, SD, p, 'index.html')));
  ok(page, '在庫番のページがある');
  const url = base + page;
  for (const w of [375, 1280]) {
    const T = m => m + '(' + w + 'px)';
    const items0 = () => JSON.parse(JSON.stringify(seed.items));
    // ---- 空の画面: 注意2つ、取り込み(列を選び直せる)
    let p = await open(browser, url, w, {}, { tier: 'free' });
    const txt = () => p.locator('#listed').innerText();
    let t = await txt();
    ok(/在庫番/.test(t) && /ページを開いている間だけ確かめます/.test(t), T('ページの上に「開いている間だけ」の注意'));
    ok(/小売店から購入者への直送には使えません/.test(t), T('ページの上に直送の注意'));
    ok(/取り寄せ販売/.test(t) && !/無在庫|ドロップシッピング|稼げ|利益が高い/.test(t), T('呼び名は「取り寄せ販売」。使わない言葉が無い'));
    await p.click('[data-ls="add-report"]'); await p.waitForSelector('#ls-text');
    await p.fill('#ls-text', seed.report); await p.click('[data-d="read"]'); await p.waitForSelector('[data-map="sku"]');
    ok(await p.locator('[data-map="sku"]').inputValue() === '0', T('列の名前から出品者SKUを当てる'));
    await p.selectOption('[data-map="price"]', '-1'); ok(/出品価格 <?b?>?—|—/.test(await p.locator('#ls-prev').innerText()), T('列を選び直すと、読み方の見本が変わる'));
    await p.selectOption('[data-map="price"]', '3');
    await p.click('[data-d="import"]'); await p.waitForTimeout(200);
    let items = await getItems(p);
    ok(items.length === 3 && !items.some(x => x.sku === 'FBA-0001') && items[0].price > 0, T('取り込み: 自分で送る3品だけ入り、FBAの行は入らない'));
    ok(/FBA|Amazonが発送/.test(await p.locator('#toast').textContent()), T('FBAの行を入れなかったと知らせる'));
    ok(/止める品 0件/.test((await txt()).replace(/\s+/g, ' ')) || /止める品\s*0/.test(await txt()), T('止める品の数が出る'));
    // 手入力
    await p.click('[data-ls="add"]'); await p.click('[data-d="manual"]'); await p.fill('#ls-dlg [data-ls-e="sku"]', 'MAN-1'); await p.fill('#ls-dlg [data-ls-e="jan"]', '4901234500043');
    await p.click('[data-d="manual-ok"]'); await p.waitForTimeout(200);
    ok((await getItems(p)).length === 4, T('手入力で1品足せる(無料は5品まで)'));
    // 送り込みの口(add)
    const r = await p.evaluate(() => SedoriListed.add({ jan: '4901234500098', name: '送り込みの品', asin: 'B0QQ11WW22' }, 'bulk'));
    ok(r.added === 1, T('送り込みの口 SedoriListed.add で入る'));
    const r6 = await p.evaluate(() => SedoriListed.add({ sku: 'Z-10' }));
    ok(r6.over === 1 && r6.added === 0, T('無料は5品まで。6品目は入らない'));
    ok(p.errs.length === 0, T('画面の誤りが無い ' + p.errs.join()));
    await p.context().close();

    // ---- 無料でも「止める品」の一覧とコピーが出る。ファイルは準備中。コピーは押せる
    p = await open(browser, url, w, { 'mz-items': items0(), keys: seed.keys, 'mz-run': { last: Date.now() - 3 * 60000 } }, { tier: 'free', market: { market: seed.market } });
    const btn = p.locator('[data-ls="copy"]');
    ok(await btn.isVisible() && /まとめてコピー\(2件\)/.test(await btn.innerText()), T('無料でも「止める品のSKUをまとめてコピー」が出る'));
    ok(/準備中\(書式を確認中\)/.test(await p.locator('[data-ls="file"]').innerText()), T('数量0のファイルは「準備中(書式を確認中)」'));
    ok(/セラーセントラルで数量を0にする手順/.test(await txt()) && !(await p.locator('.ls-how a').count()), T('手順は画面の名前だけ(リンクなし)'));
    await btn.click(); await p.waitForTimeout(200);
    ok(await p.evaluate(() => navigator.clipboard.readText()) === 'AB-0012\nAB-0031', T('押すと止める品のSKUが改行でコピーされる'));
    await p.click('[data-ls="file"]'); await p.waitForTimeout(150);
    ok(/書式を確認中/.test(await p.locator('#toast').textContent()), T('ファイルを押すと準備中の案内が出て、何も書き出さない'));
    // 1件ずつ: 数量を0にした → 止めた品へ → 元に戻す
    await p.locator('li[data-id="z1"] [data-ls="zero1"]').click(); await p.waitForTimeout(150);
    ok((await getItems(p)).find(x => x.id === 'z1').st === 'stopped', T('「数量を0にした」で止めた品へ'));
    ok(await p.locator('.ls-sec.stop .ls-list > li').count() === 1, T('止める品の一覧から外れる'));
    await p.click('#toast [data-act], #toast button'); await p.waitForTimeout(150);
    ok((await getItems(p)).find(x => x.id === 'z1').st === 'stop', T('「元に戻す」で戻る'));
    // 戻せる品: 自動では戻らない。押した時だけ
    ok((await getItems(p)).find(x => x.id === 'z5').st === 'back', T('戻せる品は、押すまで見張り中にならない'));
    await p.locator('li[data-id="z5"] [data-ls="resume"]').first().click(); await p.waitForTimeout(150);
    ok((await getItems(p)).find(x => x.id === 'z5').st === 'watch', T('「見張りに戻す」を押すと見張り中'));
    // 30件ずつ
    ok(await p.locator('.ls-sec.watch .ls-list > li').count() <= 30, T('1つの一覧は30件まで'));
    await p.context().close();

    // ---- ライト: 今すぐ確かめる(にせの楽天)。売り切れ・店が足りない品が止める品に入る
    const market = { market: JSON.parse(JSON.stringify(seed.market)) };
    market.market['4901234500043'][1].stock = false;      // z4: 2店のうち1店が売り切れ → 在庫のある店が1店 → 止める
    p = await open(browser, url, w, { 'mz-items': items0().filter(x => x.id === 'z3' || x.id === 'z4' || x.id === 'z7'), keys: seed.keys }, { tier: 'light', market });
    await p.click('[data-ls="check"]'); await p.waitForFunction(() => !document.querySelector('[data-ls="halt"]'), null, { timeout: 30000 }); await p.waitForTimeout(300);
    let it = await getItems(p);
    ok(it.find(x => x.id === 'z4').st === 'stop' && it.find(x => x.id === 'z4').why.indexOf('few') >= 0, T('確かめると、在庫のある店が足りない品が止める品に入る'));
    ok(it.find(x => x.id === 'z3').st === 'watch' && it.find(x => x.id === 'z3').chk.t > 0, T('異状のない品は見張り中のまま・確かめた時刻が入る'));
    ok(market.calls >= 2, T('楽天の公式APIだけを呼ぶ(呼んだ回数 ' + market.calls + ')'));
    ok(/止める品 *1件/.test((await txt()).replace(/\s+/g, ' ')), T('止める品の数が画面に出る'));
    // 楽天が失敗(403)した時は売り切れにしない
    market.fail = 403; await p.click('[data-ls="check"]'); await p.waitForTimeout(1500);
    it = await getItems(p);
    ok(it.find(x => x.id === 'z3').st === 'watch' && it.find(x => x.id === 'z3').chk.stock === true, T('確かめられなかった時は、売り切れ扱いにしない'));
    ok(await p.locator('.ls-alert').count() >= 1, T('見張りが止まったと赤い印で知らせる'));
    await p.context().close();

    // ---- 仕入れ先を探す → 選ぶ → 注文が入った → 台帳に行ができる
    p = await open(browser, url, w, { 'mz-items': items0().filter(x => x.id === 'z8'), keys: seed.keys }, { tier: 'total', market: { market: seed.market } });
    await p.click('li[data-id="z8"] .ls-row'); await p.click('[data-ls="find"]'); await p.waitForSelector('input[name="ls-shop"]', { timeout: 8000 });
    await p.click('[data-ls="pick-ok"]'); await p.waitForTimeout(200);
    it = (await getItems(p))[0];
    ok(it.src.length === 3 && it.src[0].code === 'yamane-sp:3100', T('主1店+控え2店(3店まで)が入る'));
    await p.click('[data-ls="order"]'); await p.waitForSelector('#ls-dlg [data-ls-e="amzOrder"]');
    ok(/小売店から購入者へ直接送らせる形には使えません/.test(await p.locator('#ls-dlg').innerText()), T('「注文が入った」の画面にも直送の注意'));
    await p.fill('#ls-dlg [data-ls-e="amzOrder"]', '503-1234567-8901234'); await p.fill('#ls-dlg [data-ls-e="shipBy"]', '2026-11-20'); await p.click('[data-d="order-ok"]'); await p.waitForTimeout(250);
    const led = await p.evaluate(() => JSON.parse(localStorage.getItem('zw-sedori:ledger') || '[]'));
    ok(led.length === 1 && led[0].wait === true && led[0].status === '売約' && led[0].mz.shipBy === '2026-11-20' && led[0].mz.amzOrder === '503-1234567-8901234', T('台帳に「仕入れ前」の行ができ、注文番号と期限が入る'));
    ok((await getItems(p)).find(x => x.id === 'z8').st === 'stop', T('数量1の品は、注文で止める品に入る'));
    ok(p.errs.length === 0, T('画面の誤りが無い ' + p.errs.join()));
    await p.context().close();

    // ---- 見た目: 横にはみ出さない・スマホで押す所44px以上・項目名12px以上
    p = await open(browser, url, w, { 'mz-items': items0(), keys: seed.keys, 'mz-run': { last: Date.now() - 3 * 60000 } }, { tier: 'total', market: { market: seed.market } });
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), T('横にはみ出さない'));
    await p.click('li[data-id="z3"] .ls-row'); await p.waitForTimeout(150);
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), T('品を開いても横にはみ出さない'));
    const small = await p.evaluate(() => [...document.querySelectorAll('#listed button, #listed input:not([type=checkbox]), #listed select, #listed summary')].filter(e => e.offsetParent && e.getBoundingClientRect().height < 43).map(e => (e.getAttribute('data-ls') || e.tagName) + ':' + Math.round(e.getBoundingClientRect().height)));
    if (w === 375) ok(small.length === 0, T('押す所が44px以上 ' + small.join()));
    const tiny = await p.evaluate(() => [...document.querySelectorAll('#listed *')].filter(e => e.children.length === 0 && e.textContent.trim() && e.offsetParent && parseFloat(getComputedStyle(e).fontSize) < 12).map(e => e.textContent.trim().slice(0, 10)));
    ok(tiny.length === 0, T('12px未満の字が無い ' + tiny.join()));
    await p.context().close();
  }
  await browser.close(); server.close();
  console.log(`OK 在庫番の画面 ${n}件(開いたページ ${PAGES.find(p => fs.existsSync(path.join(root, require('./_dir')(root), p, 'index.html')))})`);
})().catch(e => { console.error(e.stack || e); process.exit(1); });
