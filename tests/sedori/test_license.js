// 利用の鍵(assets/license.js・マイページ・料金・帳簿)の検算。実行: node tests/sedori/test_license.js [公開フォルダ]
// 1) 計算だけ(Node): 署名・期限・状態・書き出しと取り込み
// 2) 本物のブラウザ(Playwright の chromium): 鍵なし/申し込み直後に鍵が入る/契約の管理/署名が違う/期限切れ/端末数の超過/解約後/書き出し・取り込み/375px
//    Worker は偽物(この試験の中で、試験だけの署名の鍵で証明を作る)。外へは出ない。
const path = require('path'), fs = require('fs'), http = require('http'), assert = require('assert');
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
const root = path.resolve(process.argv[2] || path.join(__dirname, '../../../kt-zs-sedori-ghp'));
const SD = require('./_dir')(root);
const L = require(path.join(root, SD, 'assets/license.js'));
let n = 0;
function eq(a, b, msg) { assert.deepStrictEqual(a, b, `${msg}: 実際 ${JSON.stringify(a)} / 期待 ${JSON.stringify(b)}`); n++; }
const DAY = 864e5;
const b64u = b => Buffer.from(b).toString('base64url');
const subtle = globalThis.crypto.subtle;

(async () => {
  const mk = async () => subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const K1 = await mk(), K2 = await mk();
  const pub1 = await subtle.exportKey('jwk', K1.publicKey);
  async function sign(payload, key = K1.privateKey) {
    const body = b64u(JSON.stringify({ m: 'live', ...payload }));
    const sig = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(body));
    return body + '.' + b64u(sig);
  }
  const priv1 = JSON.stringify(await subtle.exportKey('jwk', K1.privateKey));
  const { handleCore } = await import(path.join(__dirname, '../../backend/sedori/worker/src/core.js'));
  const cfg = { KEY_PUBLIC_JWK: { kty: pub1.kty, crv: pub1.crv, x: pub1.x, y: pub1.y }, KEY_ALLOW_TEST: false };
  const now = Date.now();

  /* ---------- 1. 計算だけ ---------- */
  const good = await sign({ v: 1, t: 'total', exp: now + 3 * DAY, iat: now, d: 'dev1', st: 'active' });
  eq((await L.verify(good, cfg, subtle)).t, 'total', '正しい署名の証明');
  eq(await L.verify(await sign({ v: 1, t: 'business', exp: now + DAY, iat: now }, K2.privateKey), cfg, subtle), null, '別の鍵で署名した証明は通らない');
  const [gb, gs] = good.split('.');
  eq(await L.verify(b64u(JSON.stringify({ v: 1, t: 'business', exp: now + 99 * DAY, m: 'live' })) + '.' + gs, cfg, subtle), null, '中身を書き換えた証明は通らない');
  const tp = b64u(JSON.stringify({ v: 1, t: 'business', exp: now + DAY, m: 'test' })) + '.test';
  eq([await L.verify(tp, cfg, subtle), (await L.verify(tp, { KEY_ALLOW_TEST: true }, subtle)).t], [null, 'business'], '試験用(署名なし)の証明は KEY_ALLOW_TEST の写しだけ');
  eq(await L.verify('abc', cfg, subtle), null, '形の違う証明');
  const p = L.decode(good);
  eq([L.stateOf(p, {}, now).paid, L.stateOf(p, {}, now).tier, L.stateOf(p, {}, now).key], [true, 'total', 'active'], '期限内: 有料の機能が開く');
  eq([L.stateOf(p, {}, now + 4 * DAY).paid, L.stateOf(p, {}, now + 4 * DAY).key], [false, 'ended'], '期限切れ: 止まる');
  eq(L.stateOf({ ...p, iat: now + 3 * DAY }, {}, now).paid, false, '端末の時計を戻した(受け取った時刻より前)時は開かない');
  eq(L.stateOf(null, {}, now).key, 'none', '鍵なし');
  eq(L.stateOf(null, { status: 'ended', end: now - DAY }, now).key, 'ended', '解約後(証明なし): 止まった表示');
  eq(L.stateOf(p, { removed: true }, now).paid, false, '外された端末');
  const pe = L.decode(await sign({ v: 1, t: 'light', exp: now + DAY, iat: now, st: 'ending', end: now + DAY }));
  eq([L.stateOf(pe, {}, now).key, L.stateOf(pe, {}, now).until], ['ending', now + DAY], '解約済み: いつまで使えるか');
  const kv = { ledger: '[{"id":"a"}]', keys: '{"keepa":"x"}', 'lic-pass': '"p"', 'lic-code': '"c"', 'bk-sales': '[]' };
  const ex = L.exportData(kv, false, 1);
  eq([Object.keys(ex.data).sort(), ex.app, ex.v], [['bk-sales', 'ledger'], 'zw-sedori', 1], '書き出し: 鍵と証明・Keepaのキーは入れない');
  eq(Object.keys(L.exportData(kv, true, 1).data).sort(), ['bk-sales', 'keys', 'ledger'], '書き出し: 選んだ時だけキーも入れる');
  eq(Object.keys(L.importData({ ...ex, data: { ...ex.data, 'lic-pass': '"forged"', bad: 'not json' } })).sort(), ['bk-sales', 'ledger'], '取り込み: 証明は取り込まない・壊れた値は飛ばす');
  assert.throws(() => L.importData({ app: 'other', v: 1, data: {} })); n++;
  eq([L.deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)'), L.deviceLabel('Windows NT 10.0')], ['iPhone', 'Windows'], '端末の呼び名');
  // 公開の設定(sedori/)で試験用の証明を受けない
  const pubCfg = path.join(root, 'sedori/assets/config.js');
  if (fs.existsSync(pubCfg)) eq(/KEY_ALLOW_TEST:\s*true/.test(fs.readFileSync(pubCfg, 'utf8')), false, '公開の設定では KEY_ALLOW_TEST を true にしない');

  /* ---------- 2. 本物のブラウザ ---------- */
  const cfgSrc = fs.readFileSync(path.join(root, SD, 'assets/config.js'), 'utf8');
  if (!/^\s*KEY_MODE:\s*true/m.test(cfgSrc)) { console.log(`OK 利用の鍵(計算だけ。この写しは KEY_MODE でない) ${n}件`); return; }
  const WURL = (cfgSrc.match(/WORKER_URL:\s*"([^"]+)"/) || [])[1];
  const cfgTest = cfgSrc.replace(/KEY_PUBLIC_JWK:\s*null/, 'KEY_PUBLIC_JWK: ' + JSON.stringify(cfg.KEY_PUBLIC_JWK)).replace(/KEY_ALLOW_TEST:\s*true/, 'KEY_ALLOW_TEST: false');
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
  const server = http.createServer((req, res) => {
    let f = path.join(root, decodeURIComponent(req.url.split('?')[0]));
    if (!f.startsWith(root)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const B = `http://127.0.0.1:${server.address().port}/${SD}/`;
  const browser = await chromium.launch();
  const errs = [];
  // 偽物の Worker: world.mode で答えを変える
  const CODE = 'ABCD-EFGH-JKLM-NPQR';
  const world = { status: 'active', devices: [], full: false, seen: [] };
  async function answer(dev, extra = {}) {
    const live = world.status !== 'ended';
    const st = world.status, end = st === 'ending' ? now + 10 * DAY : (st === 'ended' ? now - DAY : null);
    return { code: CODE, sid: 'sub_T', status: st, planKey: 'total_month', planName: '総合(月払い)', amount: '月4,980円', tier: live ? 'total' : 'free', next: now + 20 * DAY, end,
      devices: [{ id: dev, name: 'Mac', lastDay: now, me: true }, ...world.devices], limit: 3,
      pass: live ? await sign({ v: 1, t: world.tier || 'total', k: 'total_month', sid: 'sub_T', d: dev, st, iat: Date.now(), exp: Date.now() + DAY, end }) : null, ...extra };
  }
  async function open(url, ls = {}, width = 375) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block', acceptDownloads: true });
    const pg = await ctx.newPage();
    pg.on('pageerror', e => errs.push(url + ' ' + e.message));
    await pg.route('**/assets/config.js*', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: cfgTest }));
    await pg.route(WURL + '/**', async route => {
      const req = route.request(), u = new URL(req.url()), body = req.postDataJSON ? (req.method() === 'POST' ? req.postDataJSON() : {}) : {};
      world.seen.push(u.pathname);
      const ok = o => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
      const ng = (s, o) => route.fulfill({ status: s, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
      if (u.pathname === '/stripe/plans') return ok({ ready: ['total_month', 'founder_month', 'light_month', 'business_month'] });
      if (u.pathname === '/key/checkout') return ok({ url: B + 'terms/?fake-checkout=' + body.planKey });
      if (u.pathname === '/key/claim') return ok(await answer(body.device));
      if (u.pathname === '/key/renew') {
        if (world.full) return ng(409, { error: 'この鍵で使える端末(3台)がいっぱいです。使っていない端末を外してください', code: 'devices-full', devices: [{ id: 'old1', name: 'iPhone', lastDay: now - 9 * DAY, me: false }, { id: 'old2', name: 'iPad', lastDay: now, me: false }, { id: 'old3', name: 'Windows', lastDay: now, me: false }], limit: 3 });
        if (world.removed && body.known) return ng(403, { error: 'この端末は、ほかの端末から外されました', code: 'device-removed' });
        return ok(await answer(body.device));
      }
      if (u.pathname === '/key/devices/remove') { world.full = false; world.removedTarget = body.target; return ok({ devices: [], limit: 3 }); }
      if (u.pathname === '/key/portal') return ok({ url: B + 'privacy/?fake-portal=1' });
      if (u.pathname === '/core') {
        world.core = (world.core || 0) + 1; (world.coreBodies = world.coreBodies || []).push(body);
        if (world.coreOffline) return route.abort('internetdisconnected');
        try { return ok(await handleCore(body, { KEY_SIGNING_JWK: priv1 })); } catch (e) { return ng(e.status || 500, { error: e.message, code: e.code }); }
      }
      return ng(404, { error: 'nf' });
    });
    await pg.goto(B + 'terms/');
    await pg.evaluate(o => { localStorage.clear(); for (const k in o) localStorage.setItem('zw-sedori:' + k, JSON.stringify(o[k])); }, ls);
    await pg.goto(B + url); await pg.waitForTimeout(600);
    return pg;
  }
  const txt = (pg, sel) => pg.$eval(sel, el => el.innerText);
  const over = pg => pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const booksMode = async (pg) => (await txt(pg, '#bk-mode')).trim();
  let pg2;
  try {
    // ---- 鍵なし: 無料の範囲。URL の ?plan=biz でも業務は開かない(P08 の3点目) ----
    let pg = await open('books/?plan=biz');
    eq(await booksMode(pg), '無料プラン', '鍵なし: 帳簿は無料プラン(?plan=biz で業務を開けない)');
    await pg.close();
    pg = await open('books/?demo=1');
    eq(await booksMode(pg), 'お試し(この端末だけ)', '見本(?demo=1・保存しない)だけは全部を試せる');
    await pg.close();
    pg = await open('mypage/');
    eq([await pg.isVisible('#mk-form'), /利用の鍵が入っていません/.test(await txt(pg, '#mk-box'))], [true, true], '鍵なし: マイページに「鍵を入れる」');
    eq(await pg.$$eval('[data-acct]', a => a.every(x => x.hidden)), true, 'ログインの欄は出さない');
    eq(await over(pg), 0, 'マイページ(鍵なし)は375pxで横にはみ出さない');
    await pg.close();

    // ---- 料金: ログインなしで申し込める ----
    pg = await open('plans/?plan=total_month#pl-step2');
    await pg.waitForTimeout(400);
    eq([await pg.isVisible('#pl-login'), await pg.isVisible('#pl-buy'), await pg.$eval('#pl-card', b => b.disabled)], [false, true, false], '料金: 「ログインして申し込む」は出ず、カードのボタンが押せる');
    eq(/ログインは要りません/.test(await txt(pg, '#pl-who')), true, '料金: 「ログインは要りません」');
    eq(await over(pg), 0, '料金は375pxで横にはみ出さない');
    await Promise.all([pg.waitForURL(/fake-checkout=founder_month|fake-checkout=total_month/), pg.click('#pl-card')]);
    eq(world.seen.includes('/key/checkout'), true, 'カードのボタン → 申し込み画面(ログインなし)');
    await pg.close();

    // ---- 申し込み直後: Stripe から戻ると、この端末に鍵が入り、有料の機能が開く ----
    pg = await open('mypage/?session_id=cs_test_1#mp-key');
    await pg.waitForTimeout(800);
    const box = await txt(pg, '#mk-box');
    eq([/総合/.test(box), /次回の請求日/.test(box), /お申し込みが済み/.test(box), await pg.isVisible('#mk-portal')], [true, true, true, true], '申し込み直後: 鍵が入り、プランと「契約の管理」が出る');
    eq((await txt(pg, '#mk-code-v')).includes('••••'), true, '鍵は伏せて表示(押すと出る)');
    eq(/支払い済みの期間の終わり/.test(await txt(pg, '#mk-cancel')) && /いつでも書き出せます/.test(await txt(pg, '#mk-cancel')), true, '解約の前に「いつまで使えるか」「止まった後に書き出せる」');
    eq(await over(pg), 0, 'マイページ(契約中)は375pxで横にはみ出さない');
    await Promise.all([pg.waitForURL(/fake-portal=1/), pg.click('#mk-portal')]);
    eq(world.seen.includes('/key/portal'), true, '「契約の管理」で Stripe の画面へ(解約・カード・領収書は客が自分で)');
    const saved = await pg.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter(k => /lic-/.test(k)).map(k => [k, localStorage.getItem(k)])));
    await pg.goto(B + 'books/'); await pg.waitForTimeout(600);
    eq(await booksMode(pg), '総合', '鍵が入った端末: 帳簿は総合');
    await pg.close();
    const pass = JSON.parse(saved['zw-sedori:lic-pass']), dev = JSON.parse(saved['zw-sedori:lic-dev']);

    // ---- 署名が違う証明(書き換え): 開かない ----
    const forged = await sign({ v: 1, t: 'business', k: 'business_month', d: dev, st: 'active', iat: now, exp: now + 7 * DAY }, K2.privateKey);
    pg = await open('books/', { 'lic-pass': forged, 'lic-dev': dev, 'lic-try': now });
    eq(await booksMode(pg), '無料プラン', '署名が違う証明では有料の機能が開かない');
    await pg.close();
    // ---- 期限切れ(通信もできない時): 止まる ----
    const old = await sign({ v: 1, t: 'total', d: dev, st: 'active', iat: now - 9 * DAY, exp: now - DAY });
    pg = await open('books/', { 'lic-pass': old, 'lic-dev': dev, 'lic-code': CODE, 'lic-info': { status: 'active' }, 'lic-try': now });
    eq(await booksMode(pg), '無料プラン', '期限切れの証明では止まる');
    await pg.goto(B + 'mypage/'); await pg.waitForTimeout(500);
    eq(/有料の機能は止まっています/.test(await txt(pg, '#mk-box')), true, '期限切れ: マイページに「止まっています」と書き出しの案内');
    await pg.close();

    // ---- 解約済み(期限まで)→ 期限の後 ----
    world.status = 'ending';
    pg = await open('mypage/', { 'lic-pass': pass, 'lic-dev': dev, 'lic-code': CODE, 'lic-sid': 'sub_T' });
    await pg.click('#mk-renew'); await pg.waitForTimeout(500);
    eq([/使える期限/.test(await txt(pg, '#mk-box')), /解約済みです/.test(await txt(pg, '#mk-cancel'))], [true, true], '解約済み: 使える期限をはっきり出す');
    world.status = 'ended';
    await pg.click('#mk-renew'); await pg.waitForTimeout(500);
    eq([/有料の機能は止まっています/.test(await txt(pg, '#mk-box')), /契約は終わっています/.test(await txt(pg, '#mk-cancel'))], [true, true], '解約後(契約が終わった): 止まり、書き出しはできる');
    await pg.goto(B + 'books/'); await pg.waitForTimeout(500);
    eq(await booksMode(pg), '無料プラン', '解約後は帳簿も無料プラン');
    await pg.close();
    world.status = 'active';

    // ---- 端末数の超過: 外す端末を選んで、この端末に入れる ----
    world.full = true;
    pg = await open('mypage/');
    await pg.fill('#mk-code', 'abcd efgh jklm npqr'); await pg.click('#mk-form button[type=submit]'); await pg.waitForTimeout(500);
    eq([/いっぱい/.test(await txt(pg, '#mk-err')), await pg.$$eval('#mk-dev [data-rm]', a => a.length)], [true, 3], '端末がいっぱい: 一覧から外せる');
    pg.once('dialog', d => d.accept());
    await pg.click('#mk-dev [data-rm="old1"]'); await pg.waitForTimeout(800);
    eq([world.removedTarget, /総合/.test(await txt(pg, '#mk-box'))], ['old1', true], '1台外すと、この端末に鍵が入る');
    // ---- 外された端末 ----
    world.removed = true;
    await pg.click('#mk-renew'); await pg.waitForTimeout(500);
    eq([/外されたか/.test(await txt(pg, '#mk-box')), await pg.isVisible('#mk-form')], [true, true], 'ほかの端末から外された端末は、鍵を入れ直す案内');
    world.removed = false;

    // ---- 書き出し・取り込み ----
    await pg.evaluate(() => { localStorage.setItem('zw-sedori:ledger', JSON.stringify([{ id: 'r1', name: 'テスト品' }])); localStorage.setItem('zw-sedori:keys', JSON.stringify({ keepa: 'k' })); });
    const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('#mk-export')]);
    const file = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    eq([file.app, !!file.data.ledger, 'keys' in file.data, Object.keys(file.data).some(k => /^lic-/.test(k))], ['zw-sedori', true, false, false], '書き出し: 台帳は入り、Keepaのキーと利用の鍵は入らない');
    await pg.evaluate(() => localStorage.setItem('zw-sedori:ledger', '[]'));
    const tmp = path.join(require('os').tmpdir(), 'zw-import-' + process.pid + '.json'); fs.writeFileSync(tmp, JSON.stringify(file));
    pg.once('dialog', d => d.accept());
    await pg.setInputFiles('#mk-import', tmp); await pg.waitForTimeout(1500);
    eq(await pg.evaluate(() => JSON.parse(localStorage.getItem('zw-sedori:ledger'))[0].name), 'テスト品', '取り込み: 台帳が戻る');
    eq(await pg.evaluate(() => JSON.parse(localStorage.getItem('zw-sedori:keys') || 'null')), { keepa: 'k' }, '取り込み: ファイルに無いキーは消さない');
    fs.unlinkSync(tmp);
    eq(await over(pg), 0, 'マイページ(書き出しの後)は375pxで横にはみ出さない');
    await pg.close();

    // ---- 2026-11-17 21:50: 有料の機能の芯はサーバー側。端末の書き換えで上限が増えない ----
    const codes = n0 => Array.from({ length: n0 }, (_, i) => { const b = '4902370' + String(50000 + i).slice(0, 5), d = b.split('').map(Number); return b + String((10 - d.reduce((t, x, k) => t + x * (k % 2 ? 3 : 1), 0) % 10) % 10); }).join('\n');
    const items = n0 => Array.from({ length: n0 }, (_, i) => ({ name: '品' + i, jan: '49023705' + String(10000 + i).slice(1), price: 3980, cost: 2400, qty: 1 }));
    // (1) 鍵なしで、段の判定・設定・偽の証明を書き換える → まとめては20行・在庫番は5品のまま
    pg = await open('rakuten-amazon/', { 'lic-pass': forged, 'lic-dev': dev });
    await pg.evaluate(() => { SedoriAccount.tier = () => 'business'; SedoriAccount.paid = () => true; SedoriUI.tier = () => 'business'; ZW_CONFIG.LISTED_LIMIT = { free: 300, business: 300 }; });
    await pg.click('[data-tab="b"]'); await pg.fill('#bulk-text', codes(30)); await pg.click('#bulk-run'); await pg.waitForTimeout(1500);
    const bm = await pg.evaluate(() => JSON.parse(localStorage.getItem('zw-sedori:ra-bulk')) || {});
    eq([bm.lim, bm.over, (bm.items || []).length], [20, 10, 20], '書き換え(段・設定・偽の証明): まとめては無料の20行のまま(行数は Worker が決める)');
    eq(world.coreBodies.slice(-1)[0].pass, undefined, '偽の証明は Worker に送らない(端末で署名を確かめて捨てる)');
    await pg.evaluate(its => SedoriListed.add(its, 'bulk'), items(12)); await pg.waitForTimeout(800);
    eq(await pg.evaluate(() => JSON.parse(localStorage.getItem('zw-sedori:mz-items')).length), 5, '書き換え: 在庫番は無料の5品のまま');
    await pg.close();
    // (2) 試験用(署名なし)の証明を端末に置いても、署名の鍵が入った Worker は断る
    const unsigned = Buffer.from(JSON.stringify({ v: 1, t: 'business', d: dev, st: 'active', iat: now, exp: now + DAY, m: 'test' })).toString('base64url') + '.test';
    eq((await handleCore({ pass: unsigned, device: dev, ops: [{ op: 'limits' }] }, { KEY_SIGNING_JWK: priv1 }).catch(e => e.code)), 'pass-invalid', '署名なしの証明は、本番の Worker が断る');
    // (3) 正しい証明(総合): 在庫番100品・まとめて500行。納品リスト(業務)は、画面の段を書き換えてもサーバーが断る
    world.status = 'active'; world.tier = 'total';
    pg = await open('daicho/', { 'lic-code': CODE, 'lic-sid': 'sub_T', 'lic-dev': dev });
    await pg.evaluate(() => SedoriLicense.renew(true)); await pg.waitForTimeout(400);
    const lim = await pg.evaluate(() => SedoriAccount.limits(true));
    eq([lim.tier, lim.listed, lim.bulk, lim.auto], ['total', 100, 500, 15], '正しい証明(総合): 上限は Worker の答え');
    const before = world.coreBodies.length;
    await pg.evaluate(() => { localStorage.setItem('zw-sedori:ledger', JSON.stringify([{ id: 'r1', date: '2026-11-10', name: '納品の品', ship: 'fba', status: '仕入れ済', qty: 1, sellerName: '相手の名前' }])); SedoriAccount.tier = () => 'business'; });
    const res = await pg.evaluate(() => SedoriAccount.core([{ op: 'prep', rows: [{ id: 'r1', date: '2026-11-10', name: '納品の品', ship: 'fba', status: '仕入れ済' }], today: '2026-11-17' }]));
    eq([res.results[0].error, res.results[0].body], ['need-plan', undefined], '納品リスト: 画面の段を業務に書き換えても、総合の証明ではサーバーが作らない');
    eq(world.coreBodies.length > before, true, '納品リストは Worker に問い合わせる');
    world.tier = 'business'; await pg.evaluate(() => SedoriLicense.renew(true)); await pg.waitForTimeout(300);
    const res2 = await pg.evaluate(() => SedoriAccount.core([{ op: 'prep', rows: [{ id: 'r1', date: '2026-11-10', name: '納品の品', ship: 'fba', status: '仕入れ済' }], today: '2026-11-17' }]));
    eq([res2.results[0].title, res2.results[0].body.length], ['納品リスト(2026-11-17 書き出し・1件)', 1], '業務の証明: 納品リストを作る');
    // (4) 有料の部品(/key/app)は、証明が無ければ取りに行かない
    await pg.evaluate(() => { localStorage.removeItem('zw-sedori:lic-pass'); });
    pg2 = await open('daicho/', {});
    eq(await pg2.evaluate(() => SedoriAccount.loadPaid('books.js').then(() => 'loaded', e => e.code)), 'need-pass', '有料の部品: 証明が無ければ受け取らない');
    eq(world.seen.includes('/key/app/books.js'), false, '有料の部品: 鍵なしでは Worker にも頼まない');
    await pg2.close(); await pg.close();
    // (5) 期限切れの証明: 更新できない(契約が終わった)なら、芯は無料の答えだけ
    world.status = 'ended'; world.tier = 'business';
    const expired = await sign({ v: 1, t: 'business', d: dev, st: 'active', iat: now - 2 * DAY, exp: now - 60e3 });
    pg = await open('zaiko-ban/', { 'lic-pass': expired, 'lic-dev': dev, 'lic-code': CODE, 'lic-sid': 'sub_T', 'lic-try': 0 });
    const l2 = await pg.evaluate(() => SedoriAccount.limits(true));
    eq([l2.tier, l2.listed], ['free', 5], '期限切れ(1日を過ぎた・契約が終わった): 在庫番は無料の5品');
    await pg.close();
    // (6) 通信できない: まとめては使えない(1行ずつの計算は使える)。無料の数に戻して数えることもしない
    world.status = 'active'; world.tier = 'business'; world.coreOffline = true;
    pg = await open('rakuten-amazon/', { 'lic-code': CODE, 'lic-sid': 'sub_T', 'lic-dev': dev });
    await pg.click('[data-tab="b"]'); await pg.fill('#bulk-text', codes(3)); await pg.click('#bulk-run'); await pg.waitForTimeout(1200);
    eq(/通信できないため、まとめてチェックを使えません/.test(await txt(pg, '#bulk-st')), true, '通信できない: まとめては使えないと出す');
    eq(await over(pg), 0, '通信できない時の案内も375pxで横にはみ出さない');
    await pg.close(); world.coreOffline = false;
    eq(errs, [], '画面の誤り(pageerror)なし');
    console.log(`OK 利用の鍵 ${n}件`);
  } catch (e) { console.error(e); process.exitCode = 1; }
  await browser.close(); server.close();
})().catch(e => { console.error(e); process.exitCode = 1; });
