// 「出している品」向けの取り直しの口(assets/watch-check.js の runStock と SedoriWatchCheck.stock)の検算。
// 実行: node tests/sedori/test_stock.js [公開フォルダ]。にせの返事だけで確かめる。楽天へは接続しない。
const path = require('path'), fs = require('fs'), assert = require('assert');
const root = process.argv[2] || path.join(__dirname, '../../../kt-zs-sedori-ghp');
const SD = require('./_dir')(root);
const file = path.join(root, SD, 'assets/watch-check.js');
const W = require(file);
let n = 0;
function eq(a, b, msg) { assert.deepStrictEqual(a, b, `${msg}: 実際 ${JSON.stringify(a)} / 期待 ${JSON.stringify(b)}`); n++; }
const T0 = 1794550000000;
const it = (code, price, o) => Object.assign({ itemCode: code, itemPrice: price, availability: 1, pointRate: 1, postageFlag: 0, shopName: code.split(':')[0] + '店', shopCode: code.split(':')[0], itemUrl: 'https://item.example/' + code, itemName: '品 ' + code }, o);
/** にせの楽天。jan[JAN] = 在庫ありの返事の品、code[商品コード] = 品 / null(見つからない) / 'other'(別の品だけ返る) / 数字(その番号で失敗) */
function fake(db) {
  const log = [], waits = [];
  let quota = db.quota == null ? Infinity : db.quota, t = T0, stop = false;
  const env = {
    log, waits, origin: 'https://zw.example',
    call(p) {
      log.push(p.keyword ? 'jan:' + p.keyword : 'code:' + p.itemCode);
      if (p.keyword) { const v = (db.jan || {})[p.keyword]; if (typeof v === 'number') return Promise.reject({ status: v }); return Promise.resolve({ Items: v || [] }); }
      const v = (db.code || {})[p.itemCode];
      if (typeof v === 'number') return Promise.reject({ status: v });
      return Promise.resolve({ Items: v === 'other' ? [it('zzz:9', 100)] : (v ? [v] : []) });
    },
    useQuota() { if (quota <= 0) return false; quota--; return true; },
    wait(ms) { waits.push(ms); return Promise.resolve(); },
    now() { return t += 1000; },
    stopped() { return stop; },
    stopAt(k) { const c = env.call; env.call = (p) => { if (log.length + 1 >= k) stop = true; return c(p); }; }
  };
  return env;
}
const pick = (r) => r.shops.map(s => [s.role, s.state, s.price, s.fail]);

(async () => {
  // 1. 上限と店の並び
  eq(['free', 'light', 'total', 'business', 'なぞ'].map(W.stockLimit), [5, 300, 300, 300, 5], '件数の上限はプランごと');
  eq(W.stockShops({ sources: [{ code: 'a:1' }, { code: '' }, { code: 'b:1' }, { code: 'a:1' }, { code: 'c:1' }, { code: 'd:1' }, { code: 'e:1' }] }).map(s => s.role + s.code),
    ['maina:1', 'subb:1', 'subc:1'], '主を含めて3店まで(主1+控え2)。商品コードの無いもの・重なりは外す');

  // 2. JANで1回。主も控えも返事に載っていれば、1回で済む
  let env = fake({ jan: { '4900000000011': [it('b:1', 2800), it('a:1', 3000), it('x:7', 3100), it('y:8', 3200)] } });
  let out = await W.runStock([{ id: 'p1', jan: '4900000000011', sources: [{ code: 'a:1' }, { code: 'b:1' }] }], env);
  let r = out.results[0];
  eq([out.done, out.stopped, env.log, r.calls], [1, '', ['jan:4900000000011'], 1], 'JANの1回で主と控えが分かる');
  eq([pick(r), r.inStock, r.unknown, r.min, r.minCode, r.failed, r.id], [[['main', 'in', 3000, 0], ['sub', 'in', 2800, 0]], 2, 0, 2800, 'b:1', 0, 'p1'], '店ごとの状態・在庫のある店の数・一番安い値段');
  eq([r.at > T0, r.okAt === r.at, r.shops[0].shop, r.shops[0].url, r.shops[0].freeShip, r.shops[0].pt], [true, true, 'a店', 'https://item.example/a:1', true, 1], '確かめた時刻と、店の名前・住所・送料・ポイント');
  eq([r.market.n, r.market.min, r.market.top.map(x => x.code)], [4, 2800, ['x:7', 'y:8']], '返事の中の在庫ありの店の数(目安)と、登録していない店');

  // 3. JANの返事に無い店だけ、商品コードで確かめる。売り切れ・見つからない・確かめられないを分ける
  env = fake({ jan: { J: [it('a:1', 3000)] }, code: { 'b:1': it('b:1', 2900, { availability: 0 }), 'c:1': null, 'd:1': 'other' } });
  const out4 = await W.runStock([{ id: 'p2', jan: 'J', sources: [{ code: 'a:1' }, { code: 'b:1' }, { code: 'c:1' }, { code: 'd:1' }] }], fake({ jan: { J: [it('a:1', 3000)] } }));
  eq(out4.results[0].shops.map(s => s.code), ['a:1', 'b:1', 'c:1'], '4店目は見ない');
  const out5 = await W.runStock([{ id: 'p5', jan: 'J', sources: [{ code: 'a:1' }, { code: 'c:1' }] }], fake({ jan: { J: [it('a:1', 3000)] }, code: { 'c:1': null } }));
  eq([out5.results[0].shops[1].state, out5.results[0].shops[1].missing], ['out', true], '楽天で見つからない店は、売り切れ(見つからない印つき)');
  out = await W.runStock([{ id: 'p2', jan: 'J', sources: [{ code: 'a:1' }, { code: 'b:1' }, { code: 'd:1', shop: 'D店' }] }], env);
  r = out.results[0];
  eq(env.log, ['jan:J', 'code:b:1', 'code:d:1'], '載っていない店だけ1回ずつ');
  eq(env.waits, [2000, 2000], 'どの呼び出しの間も2秒あける');
  eq([pick(r), r.shops.map(s => s.missing), r.inStock, r.unknown, r.min], [[['main', 'in', 3000, 0], ['sub', 'out', null, 0], ['sub', 'unknown', null, 1]], [false, false, false], 1, 1, 3000], '売り切れ・見つからない・確かめられない');
  eq(r.shops[2].shop, 'D店', '確かめられない店は、渡された名前のまま');

  // 4. 主の店が売り切れ・控えに在庫。JANの無い品は商品コードだけで確かめる
  env = fake({ code: { 'a:1': it('a:1', 3000, { availability: 0 }), 'b:1': it('b:1', 3300, { postageFlag: 1 }) } });
  out = await W.runStock([{ id: 'p3', sources: [{ code: 'a:1' }, { code: 'b:1' }] }], env);
  r = out.results[0];
  eq([env.log, pick(r), r.inStock, r.min, r.minCode, r.shops[1].freeShip, r.market, r.failed], [['code:a:1', 'code:b:1'], [['main', 'out', null, 0], ['sub', 'in', 3300, 0]], 1, 3300, 'b:1', false, null, 0], '主が売り切れ・控えに在庫');

  // 5. 確かめられない時は売り切れにしない。確かめられなかった回数は、前の結果から続けて数え、確かめられたら0に戻る
  env = fake({ jan: { J: [] }, code: { 'a:1': 'other' } });
  out = await W.runStock([{ id: 'p4', jan: 'J', sources: [{ code: 'a:1' }] }], env);
  r = out.results[0];
  eq([pick(r), r.inStock, r.failed, r.okAt, out.stopped], [[['main', 'unknown', null, 1]], 0, 1, null, ''], '別の品だけが返った時は「確かめられない」(売り切れにしない)');
  out = await W.runStock([{ id: 'p4', jan: 'J', sources: [{ code: 'a:1' }], prev: Object.assign({}, r, { okAt: T0 - 5000, shops: [Object.assign({}, r.shops[0], { okAt: T0 - 5000 })] }) }], fake({ jan: { J: [] }, code: { 'a:1': 'other' } }));
  eq([out.results[0].failed, out.results[0].okAt, out.results[0].shops[0].okAt], [2, T0 - 5000, T0 - 5000], '続けて2回目。最後に確かめられた時刻は前のまま');
  out = await W.runStock([{ id: 'p4', jan: 'J', sources: [{ code: 'a:1' }], prev: out.results[0] }], fake({ jan: { J: [it('a:1', 3000)] } }));
  eq([out.results[0].failed, out.results[0].shops[0].state], [0, 'in'], '確かめられたら0に戻る');

  // 6. 403・429・通信の失敗は、その場で全部を止める。止まった品は unknown で返し、後ろの品は触らない
  for (const [st, re] of [[403, /許可するWebサイト/], [429, /回数の制限/], [0, /接続できませんでした/]]) {
    env = fake({ jan: { J1: [it('a:1', 3000)], J2: st } });
    out = await W.runStock([{ id: 'q1', jan: 'J1', sources: [{ code: 'a:1' }] }, { id: 'q2', jan: 'J2', sources: [{ code: 'b:1' }, { code: 'c:1' }] }, { id: 'q3', jan: 'J3', sources: [{ code: 'd:1' }] }], env);
    eq([out.done, out.stopped, re.test(out.error), out.results.map(x => x.id), pick(out.results[1]), out.results[1].failed, env.log.length],
      [1, 'error', true, ['q1', 'q2'], [['main', 'unknown', null, 1], ['sub', 'unknown', null, 1]], 1, 2], `失敗(${st})でその場で止まる`);
  }

  // 7. 件数の上限・枠・途中で止める
  const many = Array.from({ length: 8 }, (_, i) => ({ id: 'm' + i, sources: [{ code: 's:' + i }] }));
  const db = { code: {} }; many.forEach((m, i) => { db.code['s:' + i] = it('s:' + i, 1000 + i); });
  env = fake(db); env.limit = W.stockLimit('free');
  const seen = [];
  env.onProgress = (a, b, res) => seen.push(a + '/' + b + ' ' + res.id);
  out = await W.runStock(many, env);
  eq([out.done, out.over, out.results.length, seen[0], seen[4], env.waits.length], [5, 3, 5, '1/5 m0', '5/5 m4', 4], '無料は5品まで。超えた分は数だけ返す');
  env = fake(Object.assign({ quota: 2 }, db));
  out = await W.runStock(many, env);
  eq([out.done, out.stopped, out.results.length, env.log.length], [2, 'quota', 2, 2], '枠が切れたら止まる(途中の品は入れない)');
  env = fake(db); env.stopAt(3);
  out = await W.runStock(many, env);
  eq([out.done, out.stopped, out.results.length], [3, 'user', 3], '途中で止められる');
  out = await W.runStock([{ id: 'e1', jan: 'J', sources: [] }], fake({}));
  eq([out.results[0].shops, out.results[0].calls, out.results[0].failed, out.done], [[], 0, 1, 1], '店の無い品は呼ばずに「確かめられない」');
  eq((await W.runStock([], fake({}))).results, [], '空の一覧');

  // 8. 画面の口(SedoriWatchCheck.stock): キーなし・ほかの確かめの最中・上限・にせの返事での1周
  const mem = {};
  global.window = { matchMedia: () => ({ matches: false }) };
  global.location = { hash: '', search: '', protocol: 'http:', origin: 'http://localhost' };
  global.navigator = {};
  global.document = { readyState: 'complete', body: { getAttribute: () => null }, addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }, dispatchEvent() {} };
  global.CustomEvent = function (name, o) { this.type = name; this.detail = o && o.detail; };
  global.localStorage = { getItem(k) { return k in mem ? mem[k] : null; }, setItem(k, v) { mem[k] = String(v); }, removeItem(k) { delete mem[k]; } };
  const urls = [];
  let answer = (q) => ({ Items: q.get('keyword') ? [it('a:1', 3000), it('b:1', 2900)] : [] });
  global.fetch = (u) => { if (!/^https:/.test(u)) return new Promise(() => {});   // ui.js が読む手数料の表などは返さない
    const q = new URL(u).searchParams; urls.push(u); const a = answer(q); return Promise.resolve(typeof a === 'number' ? { ok: false, status: a } : { ok: true, json: () => Promise.resolve(a) }); };
  const realSetTimeout = global.setTimeout; let slept = 0;
  const fastTimeout = (fn, ms) => { if (ms === 2000) slept++; return realSetTimeout(fn, 0); };
  window.SedoriCalc = require(path.join(root, SD, 'assets/calc.js'));
  window.SedoriSellerCheck = require(path.join(root, SD, 'assets/seller-check.js'));
  global.setTimeout = fastTimeout;
  require(path.join(root, SD, 'assets/ui.js'));
  const U = window.SedoriUI; U.toast = () => {};
  const src = fs.readFileSync(file, 'utf8');
  new Function('window', 'document', 'localStorage', 'location', 'navigator', 'fetch', 'setTimeout', 'module', src.replace(/\}\)\(typeof window[^;]*;\s*$/, '}).call(window, window);'))(window, document, localStorage, location, navigator, (u, o) => global.fetch(u, o), fastTimeout, undefined);
  const WC = window.SedoriWatchCheck;
  const items = [{ id: 'p1', jan: '4900000000011', sources: [{ code: 'a:1' }, { code: 'b:1' }] }, { id: 'p2', jan: '4900000000028', sources: [{ code: 'a:1' }] }];
  out = await WC.stock(items);
  eq([out.stopped, out.results, /アクセスキー/.test(out.error), urls.length], ['nokeys', [], true, 0], 'キーが無い時は呼ばない');
  mem['zw-sedori:keys'] = JSON.stringify({ rkApp: 'app', rkKey: 'key' });
  mem['zw-sedori:watch-chk-lock'] = JSON.stringify({ t: Date.now(), id: 'ほかのタブ' });
  out = await WC.stock(items);
  eq([out.stopped, urls.length], ['busy', 0], 'ほかのタブが確かめている間は走らない');
  delete mem['zw-sedori:watch-chk-lock'];
  const prog = [];
  const run = WC.stock(items, { onProgress: (a, b, res) => prog.push([a, b, res.id]) });
  eq([WC.stockBusy(), (await WC.stock(items)).stopped], [true, 'busy'], '同じタブで二重に走らない');
  out = await run;
  eq([out.done, out.stopped, out.results.map(x => [x.id, x.inStock, x.min]), prog, slept, WC.stockBusy(), 'zw-sedori:watch-chk-lock' in mem],
    [2, '', [['p1', 2, 2900], ['p2', 1, 3000]], [[1, 2, 'p1'], [2, 2, 'p2']], 1, false, false], 'にせの返事で1周(2秒あけは品の間に1回)。終わったら印を消す');
  const q0 = new URL(urls[0]).searchParams;
  eq([urls.every(u => /^https:\/\/openapi\.rakuten\.co\.jp\//.test(u)), q0.get('applicationId'), q0.get('availability'), q0.get('sort')], [true, 'app', '1', '+itemPrice'], '呼ぶ先は楽天の公式APIだけ・利用者のキー');
  eq(WC.stockLimit(), W.stockLimit(U.tier ? U.tier() : 'free'), '上限は今のプランの数');
  // 無料の1日の枠(検索と同じ20回)を使い切ったら止まる
  mem['zw-sedori:quota'] = JSON.stringify({ d: U.today(), n: 19 });
  out = await WC.stock(items);
  if (!(window.SedoriAccount && window.SedoriAccount.paid())) eq([out.done, out.stopped, out.error], [1, 'quota', 'きょうの無料の回数(20回)を使い切りました。あすまた確かめられます(ライト以上は制限なし)。'], '無料の枠を使い切ったら止まり、理由を返す');
  delete mem['zw-sedori:quota'];
  answer = () => 429;
  out = await WC.stock(items);
  eq([out.stopped, /回数の制限/.test(out.error), out.results[0].shops[0].state, WC.stockBusy()], ['error', true, 'unknown', false], '429はその場で止まり、売り切れにしない');
  // 呼んだ側の onProgress が落ちても止まらない
  answer = (q) => ({ Items: q.get('keyword') ? [it('a:1', 3000)] : [] });
  out = await WC.stock(items.slice(1), { onProgress: () => { throw new Error('x'); } });
  eq([out.done, out.stopped], [1, ''], '呼んだ側の誤りで止まらない');
  // 9. B2の依頼: 楽天を1回呼ぶだけの口(source)、「出している品」の印(mzw-lock)の間は始めない、通知の口
  urls.length = 0; answer = (q) => ({ Items: q.get('keyword') ? [it('a:1', 3000)] : [it('a:1', 3100, { availability: 0 })] });
  const j9 = await WC.source.searchJan('4900000000011'), i9 = await WC.source.item('a:1');
  const q9 = urls.map(u => new URL(u).searchParams);
  eq([j9.Items[0].itemCode, i9.ok, i9.stock, q9[0].get('keyword'), q9[0].get('availability'), q9[0].get('hits'), q9[1].get('itemCode'), q9[1].get('availability')],
    ['a:1', true, false, '4900000000011', '1', '30', 'a:1', '0'], 'source: JANで探す・商品コードで1件');
  answer = () => 403;
  eq([await WC.source.item('a:1').then(() => 'ok', e => e.status), /許可するWebサイト/.test(WC.source.errText(403)), WC.source.hasKeys(), typeof WC.source.useQuota()], [403, true, true, 'boolean'], 'source: 失敗は番号つきで投げる');
  answer = (q) => ({ Items: q.get('keyword') ? [it('a:1', 3000)] : [] });
  mem['zw-sedori:mzw-lock'] = JSON.stringify({ t: Date.now(), id: 'listed' });
  mem['zw-sedori:watch2'] = JSON.stringify([{ name: 'A', code: 'a:1', price: 3000, base: 3000 }]);
  const before9 = urls.length; const toasts9 = []; U.toast = (t) => toasts9.push(t);
  eq([(await WC.stock(items)).stopped, await WC.checkAll(), /在庫番/.test(toasts9.pop() || ''), urls.length - before9], ['busy', null, true, 0], '「出している品」が確かめている間は、こちらは始めない');
  mem['zw-sedori:mzw-lock'] = JSON.stringify({ t: Date.now() - W.LOCK_MS - 1000, id: 'listed' });
  eq((await WC.stock(items.slice(1))).stopped, '', '印が古くなったら(3分)始められる');
  delete mem['zw-sedori:mzw-lock']; delete mem['zw-sedori:watch2'];
  const shown = [];
  window.Notification = function (title, o) { shown.push([title, o.body, o.tag]); }; window.Notification.permission = 'denied';
  WC.notify('止める品が2件あります', '出している品で確かめてください', '../zaiko/', 'zw-listed');
  eq(shown.length, 0, '通知: 許可が無い端末では出さない');
  window.Notification.permission = 'granted';
  WC.notify('止める品が2件あります', '出している品で確かめてください', '../zaiko/', 'zw-listed');
  eq(shown, [['止める品が2件あります', '出している品で確かめてください', 'zw-listed']], '通知: 題・本文・印を変えて出せる');
  delete window.Notification;
  global.setTimeout = realSetTimeout;
  eq((src.match(/無在庫|利益が高い|稼げ|必ず/g) || []).length, 0, '使わない言葉が0件');
  console.log(`test_stock: ${n}件 すべて一致`);
})().catch(e => { console.error(e.stack || e); process.exit(1); });
