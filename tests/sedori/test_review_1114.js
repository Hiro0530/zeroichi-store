// 2026-11-14 の批評(review_2026-11-14.md)で見つかった所の試験。再現の手順そのままで、直す前は落ち、直した後に通る。
// 実行: SEDORI_OUT=<写しの名前> node tests/sedori/test_review_1114.js <公開フォルダ>。にせの値・にせの楽天・にせのKeepaだけ。外へは出ない。
const path = require('path'), fs = require('fs'), assert = require('assert');
const { chromium, serve, open, root } = require('./_listed_lib'), seed = require('./_listed_seed');
const SD = require('./_dir')(root);
const L = require(path.join(root, SD, 'assets/listed.js')), C = require(path.join(root, SD, 'assets/calc.js'));
let n = 0;
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, `${msg}: 実際 ${JSON.stringify(a)} / 期待 ${JSON.stringify(b)}`); n++; };
const ok = (v, msg) => { assert.ok(v, msg); n++; };
const T = Date.now(), M = 60000, H = 60 * M;
const src = [{ code: 'main:1', shop: '主の店', shopCode: 'main', base: 4000, name: 'ワイヤレスイヤホン 黒', freeShip: true }];
const mk = o => L.norm(Object.assign({ id: 'a', sku: 'S-1', name: 'ワイヤレスイヤホン 黒', price: 6980, qty: 1, jan: '4901234500012', calc: { category: 'x', selfShip: true, selfShipCost: 500, sell: 6980 }, src }, o || {}), T);
const env = { C: { amazonProfit: (f, x) => ({ profitNoPoints: x.sell - x.cost - 2000 }), needProfit: (sell, target) => target }, fees: {}, target: 300 };

// ================= 計算だけ =================
// ---- 出せない1: 全部の通信の失敗が、止める品を「見張り中」に戻す(再現: 10時間前に確かめた品 → 今すぐ確かめる → 1品目で通信が失敗) ----
{
  const it = mk({ id: 'a', st: 'watch', chk: { t: T - 10 * H, fails: 0 } });
  eq(L.view(it, { now: T, limit: 5, index: 0, set: {} }), { st: 'stop', why: ['stale'], }, '10時間前に確かめた品は止める品(画面の「止める・確かめられない」)');
  const r = L.applyRound([it], { stopped: 'error', results: [{ id: 'a', shops: [{ code: 'main:1', state: 'unknown' }] }] }, (i, o) => L.judge(i, o, env, {}), T, {});
  eq(r.allFail, true, '1品目の通信の失敗は、全部の失敗として扱われる(再現の手順)');
  eq(L.view(it, { now: T, limit: 5, index: 0, set: {}, allFailSince: T - 5 * MIN() }).st, 'stop', '10時間前の品+全部失敗5分前 → 止めるのまま(見張り中に戻らない)');
  const it3 = mk({ chk: { t: T - 1 * M, fails: 3 } });
  eq(L.view(it3, { now: T, limit: 5, index: 0, set: {}, allFailSince: T - 5 * M }), { st: 'stop', why: ['unknown'] }, '3回続けて失敗した品+全部失敗5分前 → 止めるのまま');
  eq(L.view(mk({ chk: { t: T - 1 * M, fails: 0 } }), { now: T, limit: 5, index: 0, set: {}, allFailSince: T - 5 * M }).st, 'watch', '1分前に確かめた品は、全部失敗の間も見張り中(帯で知らせる)');
  eq(L.view(mk({ chk: {} }), { now: T, limit: 5, index: 0, set: {}, allFailSince: T - 181 * M }), { st: 'stop', why: ['halt'] }, '3時間続けば、確かめていない品も止める品');
}
function MIN() { return M; }
// ---- 出せない2: プランの上限の外の「止める品」が隠れる(再現: 8品のうち6〜8品目が止める品・上限5) ----
{
  const items = []; for (let i = 0; i < 8; i++) items.push(mk({ id: 'i' + i, sku: 'S' + i, st: i >= 5 ? 'stop' : 'watch', why: i >= 5 ? ['out'] : [], chk: { t: T - 1 * M } }));
  const s = L.summarize(items, { now: T, set: {}, limit: 5 });
  eq([s.stop.length, s.over.length, s.watch.length], [3, 0, 5], '上限5・6〜8品目が止める品 → 止める品は3件のまま(隠れない)');
  eq(s.stop.every(x => x.v.beyond === true), true, '上限の外の止める品には beyond の印(画面で「これ以上は確かめません」と添える)');
  const t = items.slice(); t[6] = mk({ id: 'w', st: 'watch', chk: { t: T - 1 * M } });
  eq(L.summarize(t, { now: T, set: {}, limit: 5 }).over.length, 1, '上限の外の見張り中の品は「見張っていません」のまま');
  const u = items.slice(); u[7] = mk({ id: 'x', st: 'stopped', why: ['out'], chk: { t: T - 1 * M } });
  eq(L.summarize(u, { now: T, set: {}, limit: 5 }).stopped.length, 1, '上限の外でも、止めた品は止めた品');
}
// ---- 必ず直す: JANの無い品・仕入れ先が1店だけの品は止める候補 ----
{
  const it = mk({ jan: '' });
  const res = { shops: [{ code: 'main:1', shop: '主', role: 'main', state: 'in', price: 4000, name: 'ワイヤレスイヤホン 黒', freeShip: true }], market: null };
  eq(L.judge(it, L.fromStock(it, res), env, {}).why, ['few'], 'JANなし・1店だけ → 在庫のある店が足りず止める');
  eq(L.judge(mk({ jan: '', minShops: 1 }), L.fromStock(it, res), env, {}).why, [], '品ごとに「1店でも続ける」なら止めない');
  const res2 = { shops: [res.shops[0], { code: 'sub:1', shop: '控', role: 'sub', state: 'in', price: 4100, name: 'x', freeShip: true }], market: null };
  eq(L.judge(it, L.fromStock(it, res2), env, {}).why, [], 'JANなし・2店とも在庫あり → 止めない');
}
// ---- 必ず直す: 計算の条件が無い品・送料が未入力の品は、利益を見ていないと分かる/送料0円と決めない ----
{
  const a = mk({ calc: null });
  eq(L.noProfit(a), 'カテゴリー未選択', '計算の条件が無い品は「カテゴリー未選択」');
  const b = mk({ calc: { category: 'x', selfShip: true, selfShipCost: null, sell: 6980 } });
  eq([L.noProfit(b), L.profitAt(env, b, 4500)], ['送料が未入力', null], '購入者への送料が未入力なら、利益は見ない(0円で甘く出さない)');
  const c = mk({ calc: { category: 'x', selfShip: true, selfShipCost: 0, sell: 6980 } });
  eq([L.noProfit(c), L.profitAt(env, c, 4500)], ['', 480], '0円と入れた時だけ0円で計算する');
}
// ---- 必ず直す: 売れ行きのペース ----
{
  const pace = k => C.paceText(C.sellThrough(k));
  eq([200, 250, 400, 601, 1000, 5000].map(v => pace({ sold: v })), ['1日に約7個', '1日に約8個', '1日に約13個', '1日に約20個', '1日に約33個', '1日に約167個'], '月間販売数200〜5000: 1日の個数は n÷30 から直接(Infinityが出ない)');
  eq([pace({ sold: 3 }), pace({ sold: 10 }), pace({ sold: 30 }), pace({ sold: 100 })], ['約10日に1個', '約3日に1個', '1日に約1個', '1日に約3個'], '1日に1個未満は「約N日に1個」(整数)');
  ['sold:200', 'sold:5000', 'd30:4,d90:9'].forEach(s => { const o = {}; const [k, v] = s.split(',')[0].split(':'); o[k] = +v; if (s.indexOf('d90') >= 0) o.d90 = 9; const p = pace(o); ok(!/Infinity|NaN|\./.test(p), 'ペースに ' + p + ' が出ない(小数・Infinity・NaN)'); });
  const st = C.sellThrough({ d30: 0, d90: 30 });
  eq([st.label !== 'ほとんど動かない', C.paceText(st)], [true, '約3日に1個'], '30日0回・90日30回: 「ほとんど動かない」と「約3日に1個」が並ばない');
  eq(C.sellThrough({ d30: 0, d90: 0 }).label, 'ほとんど動かない', '回数0・0は「ほとんど動かない」のまま');
  eq(C.paceText(C.sellThrough({ d30: 0, d90: 0 })), '—', '回数0・0ではペースを出さない');
  const a = C.stockAdvice({ level: 3, sell: null, shops: 2, big: false });
  eq([a.kind, /売値が入っていない/.test(a.why.join('')), /金額が小さく/.test(a.why.join(''))], ['stock', true, false], '売値が未入力なら「金額が小さい」と言い切らない');
}

// ================= HTMLの中身(書き出したページ) =================
{
  const pages = [];
  (function walk(d) { fs.readdirSync(d, { withFileTypes: true }).forEach(e => { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (e.name === 'index.html') pages.push(f); }); })(path.join(root, SD));
  const band = pages.filter(f => /<header class="hd">/.test(fs.readFileSync(f, 'utf8')));
  ok(band.length >= 15, '上の帯のあるページが15以上ある(' + band.length + ')');
  const miss = band.filter(f => { const h = fs.readFileSync(f, 'utf8'); return !/id="hd-mz"/.test(h) || !/assets\/listed\.js/.test(h); }).map(f => path.relative(path.join(root, SD), f));
  eq(miss, [], '上の帯のある全ページに、帯の印 #hd-mz と、それを描く listed.js がある(scan・books の手書きページも)');
  const rd = p => fs.readFileSync(path.join(root, SD, p, 'index.html'), 'utf8');
  const plans = rd('plans'), terms = rd('terms');
  ok(/在庫番/.test(plans) && /5品・手で確かめる/.test(plans) && /300品・30分おきに自動/.test(plans) && /300品・15分おきに自動/.test(plans) && /300品・10分おきに自動/.test(plans), '料金表に在庫番の品数(無料5・有料はどの段も300)がある');
  ok(/手持ちの在庫/.test(plans), '料金表の「在庫」の行は「手持ちの在庫」');
  ok(/在庫番/.test(terms) && /無料5・ライト300・総合300・業務300/.test(terms) && /ページを開いている間だけ/.test(terms) && /損害について、当方は責任を負いません/.test(terms), '規約に、在庫番の品数・開いている間だけ・責任の範囲がある');
  const bad = /無在庫|ドロップシッピング|利益が高い|稼げる|必ず/;
  ok(!bad.test(plans.replace(/<script[\s\S]*?<\/script>/g, '')) && !bad.test(terms), '料金表・規約に使わない言葉が無い');
  eq(/ledger-plus\.css/.test(fs.readFileSync(path.join(root, SD, 'sw.js'), 'utf8')), false, 'sw.js の一覧に実在しない ledger-plus.css が無い');
  const js = ['listed.js', 'item.js', 'bulk.js'].map(f => fs.readFileSync(path.join(root, SD, 'assets', f), 'utf8')).join('\n');
  ok(!/在庫番に入れる/.test(js.replace(/\/\*[\s\S]*?\*\//g, '')) && /在庫番に登録/.test(js), 'ボタン名は「在庫番に登録」にそろっている(「在庫番に入れる」の案内が無い)');
}

// ================= 画面 =================
(async () => {
  const { server, base } = await serve(), browser = await chromium.launch();
  const items0 = () => JSON.parse(JSON.stringify(seed.items));
  const two = () => items0().filter(x => x.id === 'z1' || x.id === 'z2');
  const KEYS = { rkApp: 'a', rkKey: 'b', keepa: 'k'.repeat(20) };
  // ---- 出せない3: 帯の印「止める N」。全ページ・375pxと1280px。帯の段は増えない。0件の時は出ない ----
  for (const w of [375, 1280]) {
    for (const pg of ['', 'rakuten-amazon/', 'muzaiko-amazon/', 'mercari-calc/', 'daicho/', 'plans/', 'terms/', 'mypage/', 'scan/', 'books/', 'zaiko-ban/']) {
      const T2 = m => m + '(' + pg + ' ' + w + 'px)';
      let p = await open(browser, base + pg, w, {}, {});
      const h0 = await p.evaluate(() => document.querySelector('header.hd').getBoundingClientRect().height);
      ok(await p.evaluate(() => { const a = document.getElementById('hd-mz'); return !!a && (a.hidden || a.offsetParent === null); }), T2('止める品が0件の時は印を出さない'));
      await p.context().close();
      p = await open(browser, base + pg, w, { 'mz-items': two() }, {});
      const r = await p.evaluate(() => { const a = document.getElementById('hd-mz'); if (!a) return null; const b = a.getBoundingClientRect(); return { t: a.textContent.trim(), vis: a.offsetParent !== null, r: b.right, h: document.querySelector('header.hd').getBoundingClientRect().height, w: window.innerWidth, sw: document.documentElement.scrollWidth, href: a.getAttribute('href') }; });
      ok(r && r.t === '止める 2' && r.vis, T2('止める品が2件なら帯に「止める 2」が見える ' + JSON.stringify(r)));
      ok(/zaiko-ban\/$/.test(r.href), T2('押すと在庫番へ'));
      ok(r.r <= r.w && r.sw <= r.w, T2('帯の印が画面からはみ出さない'));
      ok(r.h <= h0 + 1, T2('帯の高さが増えない(段が増えない) ' + h0 + '→' + r.h));
      await p.context().close();
    }
  }
  // ---- 出せない1(画面): 10時間前の品 → 「今すぐ確かめる」→ 通信が失敗 → 止める品に残る ----
  for (const w of [375, 1280]) {
    const T2 = m => m + '(' + w + 'px)';
    const it = items0().find(x => x.id === 'z3'); it.chk = { t: Date.now() - 10 * H, fails: 0, stock: true, shops: 3, price: 1980 };
    const market = { market: JSON.parse(JSON.stringify(seed.market)), fail: 500 };
    const p = await open(browser, base + 'zaiko-ban/', w, { 'mz-items': [it], keys: seed.keys }, { tier: 'light', market });
    ok(/止める品 *1件/.test((await p.locator('#listed').innerText()).replace(/\s+/g, ' ')), T2('確かめる前: 止める品 1件(10時間前)'));
    await p.click('[data-ls="check"]'); await p.waitForFunction(() => !document.querySelector('[data-ls="halt"]'), null, { timeout: 30000 }); await p.waitForTimeout(400);
    const run = await p.evaluate(() => JSON.parse(localStorage.getItem('zw-sedori:mz-run') || '{}'));
    ok(run.allFailSince > 0, T2('通信が失敗し、全部の失敗として記録された(再現の手順)'));
    ok(/止める品 *1件/.test((await p.locator('#listed').innerText()).replace(/\s+/g, ' ')), T2('失敗の後も「止める品 1件」のまま'));
    eq(await p.locator('.ls-sec.stop .ls-list > li').count(), 1, T2('止める品の一覧に残っている'));
    eq(await p.evaluate(() => document.getElementById('hd-mz').textContent.trim()), '止める 1', T2('帯の印も「止める 1」のまま'));
    ok(/見張りが止まっています/.test(await p.locator('#listed').innerText()), T2('「見張りが止まっています」の知らせも出る'));
    await p.context().close();
  }
  // ---- 出せない2(画面): 14日無料(300品)で入れた8品の6〜8品目が止める品 → 無料(5品)に戻る ----
  for (const w of [375, 1280]) {
    const T2 = m => m + '(' + w + 'px)';
    const base8 = items0().filter(x => x.id !== 'z7'); const list = [];
    for (let i = 0; i < 8; i++) { const o = JSON.parse(JSON.stringify(base8[i % base8.length])); o.id = 'q' + i; o.sku = 'Q-' + i; o.jan = '49012345' + String(10000 + i); o.st = i >= 5 ? 'stop' : 'watch'; o.why = i >= 5 ? ['out'] : []; o.chk = { t: Date.now() - 2 * M, fails: 0, stock: i < 5, shops: 3, price: 1000 }; list.push(o); }
    const p = await open(browser, base + 'zaiko-ban/', w, { 'mz-items': list, keys: seed.keys }, { tier: 'free' });
    const t = (await p.locator('#listed').innerText()).replace(/\s+/g, ' ');
    ok(/止める品 *3件/.test(t), T2('無料(上限5)でも、6〜8品目の止める品が「止める品 3件」に出る'));
    eq(await p.locator('.ls-sec.stop .ls-list > li').count(), 3, T2('止める品の一覧に3件'));
    ok(/上限の外のため、これ以上は確かめません/.test(t), T2('上限の外の止める品に、確かめない旨と数量を0にしたままにする案内を添える'));
    eq(await p.evaluate(() => document.getElementById('hd-mz').textContent.trim()), '止める 3', T2('帯の印も「止める 3」'));
    await p.context().close();
  }
  // ---- 必ず直す: 在庫番の画面(利益を見ていない品・案内の名前・短い注意書き) ----
  for (const w of [375, 1280]) {
    const T2 = m => m + '(' + w + 'px)';
    const noCalc = items0().find(x => x.id === 'z4'); delete noCalc.calc; noCalc.chk = { t: Date.now() - 2 * M, fails: 0, stock: true, shops: 2, price: 1180 };
    const p = await open(browser, base + 'zaiko-ban/', w, { 'mz-items': [noCalc, ...two()], keys: seed.keys }, { tier: 'total' });
    let t = (await p.locator('#listed').innerText()).replace(/\s+/g, ' ');
    ok(/利益は見ていません\(カテゴリー未選択\)/.test(t), T2('計算の条件が無い品の行に「利益は見ていません(カテゴリー未選択)」'));
    ok(/うち利益を見ていない 1/.test(t), T2('見張り中の数とは別に、利益を見ていない品を数える'));
    await p.click('li[data-id="z4"] .ls-row'); await p.waitForTimeout(150);
    await p.selectOption('[data-ls-e="cat"]', { index: 1 }); await p.waitForTimeout(200);
    const calc = ((await p.evaluate(() => JSON.parse(localStorage.getItem('zw-sedori:mz-items')))).find(x => x.id === 'z4')).calc;
    eq(calc && calc.selfShipCost, null, T2('カテゴリーを選んでも、購入者への送料は未入力(null)で作る'));
    t = (await p.locator('#listed').innerText()).replace(/\s+/g, ' ');
    ok(/送料が未入力のため、利益は見ていません/.test(t) && /利益は見ていません\(送料が未入力\)/.test(t), T2('送料が未入力と出る'));
    await p.fill('[data-ls-e="shipCost"]', '0'); await p.waitForTimeout(150);
    eq(((await p.evaluate(() => JSON.parse(localStorage.getItem('zw-sedori:mz-items')))).find(x => x.id === 'z4')).calc.selfShipCost, 0, T2('0と入れた時だけ0円'));
    await p.click('[data-ls="add"]'); await p.waitForTimeout(200);
    const menu = await p.locator('#ls-dlg').innerText();
    ok(/「在庫番に登録」から入ります/.test(menu) && !/在庫番に入れる/.test(menu), T2('「品を足す」の案内は、実在するボタン名「在庫番に登録」'));
    await p.context().close();
  }
  // 375px: 止める品が最初の画面(高さ800)に見える
  {
    const p = await open(browser, base + 'zaiko-ban/', 375, { 'mz-items': items0(), keys: seed.keys, 'mz-run': { last: Date.now() - 3 * M } }, { tier: 'total', h: 800 });
    const y = await p.evaluate(() => { const li = document.querySelector('.ls-sec.stop .ls-list > li'); return li ? li.getBoundingClientRect().bottom : 99999; });
    ok(y <= 800, '在庫番(375px): 止める品の最初の1件が最初の画面(800px)に入る(下端 ' + Math.round(y) + 'px)');
    const t = await p.locator('#listed').innerText();
    ok(/ページを開いている間だけ/.test(t) && /直送には使えません/.test(t), '在庫番(375px): 2つの注意の意味は常に見える');
    await p.context().close();
  }
  // ---- 商品ページ: 主役・下のボタン・ペース ----
  let kpMonthly = 60, kpDrops30 = 40, kpDrops90 = 120;
  async function item(w, state, h) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h || 800 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
    const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
    await p.route('**/api.keepa.com/**', route => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ tokensLeft: 77, products: [{ asin: 'B0TESTASIN', title: 'テスト商品 ABC', monthlySold: kpMonthly, stats: { current: [-1, 3980, 0, 1200, 0, 0, 0, 0, 0, 0, 0, 4], salesRankDrops30: kpDrops30, salesRankDrops90: kpDrops90, avg90: [-1, 4100] },
        csv: { 1: [Math.floor((Date.now() - 80 * 86400000) / 60000) - 21564000, 4500, Math.floor((Date.now() - 40 * 86400000) / 60000) - 21564000, 4100, Math.floor((Date.now() - 5 * 86400000) / 60000) - 21564000, 3980] } }] }) }));
    await p.route('**/openapi.rakuten.co.jp/**', route => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ Items: (state.rk || []).map(o => ({ itemName: 'テスト商品 ABC', itemPrice: 2400, itemUrl: 'https://item.rakuten.co.jp/' + o[0] + '/' + o[1] + '/', shopName: o[0], shopCode: o[0], itemCode: o[0] + ':' + o[1], postageFlag: 0, pointRate: 1 })) }) }));
    await p.goto(base + 'terms/');
    const ITEM = { src: 'rakuten', name: 'テスト商品 ABC', price: 2400, shop: 'テスト店', url: 'https://item.rakuten.co.jp/x/abc/', jan: '4902370500014', code: 'x:abc', freeShip: true, shopPt: 1, sell: 3980, inShip: 0 };
    await p.evaluate(o => { for (const k in o) localStorage.setItem('zw-sedori:' + k, JSON.stringify(o[k])); }, Object.assign({ keys: KEYS }, state.from === 'w' ? { watch2: [Object.assign({ saved: '2026-11-10', base: 2400 }, ITEM)] } : { 'ra-last': { q: 'テスト', items: [ITEM] } }));
    await p.goto(base + 'rakuten-amazon/' + (state.from === 'w' ? '?tab=w' : '')); await p.waitForTimeout(600);
    await p.click('#rows a.it-go'); await p.waitForURL(/shohin\//); await p.waitForTimeout(700);
    return p;
  }
  const mainText = p => p.$eval('#it-acts .it-btn.fill', el => el.textContent.trim());
  for (const w of [375, 1280]) {
    const T2 = m => m + '(' + w + 'px)';
    // Keepaなし: 仕入れ先を開くが主役。下は、仕入れた=線のボタン、ウォッチと在庫番=文字のボタン
    let p = await item(w, {});
    eq(await mainText(p), '仕入れ先を開く', T2('Keepaなし・目標に届く: 主役は「仕入れ先を開く」'));
    eq(await p.$$eval('#it-acts .it-sub > .it-btn', a => a.map(x => x.textContent.trim())), ['仕入れた(台帳へ)'], T2('線のボタンは「仕入れた(台帳へ)」だけ'));
    eq(await p.$$eval('#it-acts .it-lk .it-ln', a => a.map(x => x.textContent.trim())), ['ウォッチに入れる', '在庫番に登録'], T2('ウォッチと在庫番は、1行の文字のボタン'));
    const row = await p.$$eval('#it-acts .it-lk .it-ln', a => a.map(x => Math.round(x.getBoundingClientRect().top)));
    ok(row.length === 2 && Math.abs(row[0] - row[1]) < 4, T2('文字のボタンは1行に並ぶ ' + row));
    ok(await p.$$eval('#it-acts .it-ln', a => a.every(x => x.getBoundingClientRect().height >= 43.5)), T2('文字のボタンの高さが44px以上'));
    if (w === 1280) { const b = await p.$eval('#it-acts .it-btn.fill', el => el.getBoundingClientRect()); ok(b.bottom <= 800, T2('塗りのボタンが最初の画面(800px)に入る 下端' + Math.round(b.bottom))); }
    eq(await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 0, T2('横にはみ出さない'));
    // Keepaあり(速い): 「在庫で持つ向き」
    await p.click('[data-act="kp"]'); await p.waitForTimeout(900);
    ok(/1日に約\d+個/.test(await p.$eval('#it-sales', e => e.innerText)) && !/Infinity|NaN/.test(await p.$eval('#it-sales', e => e.innerText)), T2('ペースは整数(1日に約N個)'));
    if (w === 1280) { const b = await p.$eval('#it-acts .it-btn.fill', el => el.getBoundingClientRect()); ok(b.bottom <= 800, T2('Keepaありでも塗りのボタンが最初の画面に入る 下端' + Math.round(b.bottom))); }
    // 売値を下げて届かない・一覧から: 主役はウォッチに入れる
    await p.click('#it-edit summary'); await p.fill('#e-sell', '3800'); await p.dispatchEvent('#e-sell', 'change'); await p.waitForTimeout(250);
    eq(await mainText(p), 'ウォッチに入れる', T2('目標に届かない・一覧から: 主役は「ウォッチに入れる」'));
    if (w === 1280) { const b = await p.$eval('#it-acts .it-btn.fill', el => el.getBoundingClientRect()); ok(b.bottom <= 800, T2('届かない時も塗りのボタンが最初の画面に入る')); }
    await p.context().close();
    // 目標に届かない・ウォッチから: 主役は「数字を直す」。仕入れ先は文字のボタン
    p = await item(w, { from: 'w' });
    await p.click('#it-edit summary'); await p.fill('#e-sell', '3800'); await p.dispatchEvent('#e-sell', 'change'); await p.waitForTimeout(250);
    ok(/届かない/.test(await p.$eval('#it-sum .it-v', e => e.innerText)), T2('ウォッチから開いて売値を下げると、目標に届かない'));
    eq(await mainText(p), '数字を直す', T2('目標に届かない・ウォッチから: 主役は「数字を直す」(買う方へ押させない)'));
    ok((await p.$$eval('#it-acts .it-ln', a => a.map(x => x.textContent.trim()))).indexOf('仕入れ先を開く') >= 0, T2('仕入れ先は下の文字のボタンに'));
    await p.context().close();
    // 取り寄せ販売の向き: 主役は「在庫番に登録」
    kpMonthly = 5; kpDrops30 = 4; kpDrops90 = 9;
    p = await item(w, {}); await p.click('[data-act="kp"]'); await p.waitForTimeout(900);
    eq(await mainText(p), '在庫番に登録', T2('取り寄せ販売の向き: 主役は「在庫番に登録」'));
    await p.context().close();
    // どちらも向かない: 主役は「ウォッチに入れる」
    kpMonthly = 0; kpDrops30 = 0; kpDrops90 = 0;
    p = await item(w, {}); await p.click('[data-act="kp"]'); await p.waitForTimeout(900);
    ok(/どちらも向かない/.test(await p.$eval('#it-adv', e => e.innerText)), T2('ほとんど動かない・店の数不明は「どちらも向かない」'));
    eq(await mainText(p), 'ウォッチに入れる', T2('どちらも向かない: 主役は「ウォッチに入れる」(買う方へ押させない)'));
    await p.context().close();
    kpMonthly = 60; kpDrops30 = 40; kpDrops90 = 120;
  }
  // ---- 店の数: 同じ店が同じJANを2件出しても1店 ----
  {
    kpMonthly = 5; kpDrops30 = 4; kpDrops90 = 9;
    const p = await item(375, { rk: [['shopA', 'red'], ['shopA', 'blue'], ['shopB', 'x']] });
    await p.click('[data-act="kp"]'); await p.waitForTimeout(900);
    await p.click('[data-act="shops"]'); await p.waitForTimeout(700);
    ok(/在庫のある店は2店/.test(await p.$eval('#it-acts', e => e.innerText)), '同じ店(shopA)の2商品+別の店1つ → 在庫のある店は2店(商品の3件ではない)');
    ok(/2店/.test(await p.$eval('#it-adv', e => e.innerText)), '目安の文も2店で数える');
    await p.context().close();
  }
  // ---- まとめての結果にも「在庫番に登録」。押すと在庫番へ入る ----
  {
    const p = await open(browser, base + 'rakuten-amazon/?tab=b', 1280, { keys: KEYS, 'ra-bulk': { items: [{ src: 'rakuten', name: 'まとめて品', price: 2400, shop: 'テスト店', url: 'https://item.rakuten.co.jp/x/abc/', jan: '4902370500014', code: 'x:abc', freeShip: true, shopPt: 1, sell: 3980, inShip: 0 }], meta: { state: 'done' } } }, { tier: 'total' });
    await p.waitForTimeout(500);
    const vis = await p.evaluate(() => { const b = document.getElementById('b-zaiko'); return !!b && !b.hidden && b.textContent.trim(); });
    eq(vis, '在庫番に登録', 'まとめての結果に「在庫番に登録」のボタンが出る');
    await p.click('#b-zaiko'); await p.waitForTimeout(300);
    const got = await p.evaluate(() => JSON.parse(localStorage.getItem('zw-sedori:mz-items') || '[]'));
    eq([got.length, got[0] && got[0].jan, got[0] && got[0].from], [1, '4902370500014', 'bulk'], '押すと在庫番に1品入る(JAN・出どころ bulk)');
    await p.context().close();
  }
  await browser.close(); server.close();
  console.log(`OK 2026-11-14 の批評の試験 ${n}件`);
})().catch(e => { console.error(e.stack || e); process.exit(1); });
