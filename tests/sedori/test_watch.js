// ウォッチ品の値上がり・売り切れのお知らせ(assets/watch-check.js の計算だけの部品)の検算。実行: node tests/sedori/test_watch.js [公開フォルダ]
// にせの返事だけで確かめる。楽天へは接続しない。
const path = require('path'), assert = require('assert');
const root = process.argv[2] || path.join(__dirname, '../../../kt-zs-sedori-ghp');
const SD = require('./_dir')(root);
const W = require(path.join(root, SD, 'assets/watch-check.js'));
let n = 0;
function eq(a, b, msg) { assert.deepStrictEqual(a, b, `${msg}: 実際 ${JSON.stringify(a)} / 期待 ${JSON.stringify(b)}`); n++; }
const T0 = 1794550000000, H = 3600000;
const item = (o) => ({ Items: [Object.assign({ itemCode: 'shop:1001', itemPrice: 3000, availability: 1, pointRate: 1, postageFlag: 0 }, o)] });
const row = (o) => Object.assign({ name: 'フィギュアA', code: 'shop:1001', price: 3000, base: 3000, sell: 5000, shopPt: 1, saved: '2026-11-10' }, o);

// 1. 比べる計算の5通り(上限 3,200円 = この値段までなら目標に届く)
eq(W.label(W.compare(row(), W.parseItem(item({ availability: 0 }), 'shop:1001'), 3200)), '売り切れ', '販売不可は売り切れ');
eq(W.label(W.compare(row(), W.parseItem({ Items: [] }, 'shop:1001'), 3200)), '楽天で見つからない(売り切れか、取り扱いの終了)', '返事が空は見つからない');
eq(W.compare(row(), W.parseItem({ Items: [] }, 'shop:1001'), 3200).changed, true, '見つからないは変化に数える');
let c = W.compare(row(), W.parseItem(item({ itemPrice: 3300 }), 'shop:1001'), 3200);
eq([c.kind, c.diff, c.cross, c.changed, W.label(c)], ['up', 300, 'lost', true, '値上がり +300円・目標に届かなくなった'], '値上がりで目標に届かなくなった');
c = W.compare(row({ price: 3500, base: 3500 }), W.parseItem(item({ itemPrice: 3000 }), 'shop:1001'), 3200);
eq([c.kind, c.diff, c.cross, c.changed, W.label(c)], ['down', -500, 'gained', true, '値下がり −500円・目標に届いた'], '値下がりで目標に届いた');
c = W.compare(row(), W.parseItem(item({}), 'shop:1001'), 3200);
eq([c.kind, c.changed, W.label(c)], ['same', false, '変わらず'], '変わらず');
c = W.compare(row({ code: '' }), W.parseItem(item({}), 'shop:1001'), 3200);
eq([c.kind, c.changed, W.label(c)], ['unknown', false, '今の価格を取れていません'], '商品コードの無い行は「取れていません」');
// 別の商品だけが返ってきた(商品コードの指定が効いていない)時は、売り切れと決めつけない
eq(W.parseItem(item({ itemCode: 'other:9' }), 'shop:1001'), { ok: false }, '別の商品だけの返事は確かめられない');
eq(W.compare(row(), { ok: false }, 3200).kind, 'unknown', '確かめられない返事');

// 2. 目標の境目をまたいだ時だけ変化に数える(1円の上下では数えない)。目標を変えたら数え直す
c = W.compare(row(), W.parseItem(item({ itemPrice: 3001 }), 'shop:1001'), 3200);
eq([c.kind, c.cross, c.changed, W.label(c)], ['up', null, false, '値上がり +1円'], '1円上がっても境目の内なら変化なし');
c = W.compare(row({ price: 3200, base: 3200 }), W.parseItem(item({ itemPrice: 3201 }), 'shop:1001'), 3200);
eq([c.cross, c.changed], ['lost', true], '上限ちょうど → 1円超えで届かなくなった');
c = W.compare(row({ sell: '' }), W.parseItem(item({ itemPrice: 3900 }), 'shop:1001'), null);
eq([c.kind, c.cross, c.changed], ['up', null, false], '上限が分からない行(売値なし)は、値動きだけ出して変化に数えない');
const list = [row(), row({ name: 'B', code: 'shop:2', price: 1000, base: 1000 })];
W.apply(list[0], W.parseItem(item({ itemPrice: 3100 }), 'shop:1001'), 3200, T0);
W.apply(list[1], { ok: true, stock: true, price: 1000, pt: 1 }, 3200, T0);
eq(W.unseen(list, 0), 0, '境目をまたいでいないので変化0');
eq([list[0].price, list[0].base, list[0].chk.prev, list[0].chk.price], [3100, 3000, 3000, 3100], '行の価格は今の値に、保存時の価格は残る');
W.recount(list, () => 3050, T0 + 1000);   // 目標を上げた(上限が 3,050円に下がった)
eq([list[0].chg.cross, list[0].chg.changed, W.unseen(list, T0)], ['lost', true, 1], '目標を変えたら数え直す');
W.recount(list, () => 3200, T0 + 2000);
eq([list[0].chg.cross, list[0].chg.changed, W.unseen(list, T0)], [null, false, 0], '目標を戻すと変化は消える');
// 見たあとは数えない。売り切れ → 在庫が戻った
const r2 = row();
W.apply(r2, { ok: true, stock: false }, 3200, T0);
eq([r2.chg.kind, r2.chg.changed, r2.chk.stock, r2.price], ['soldout', true, false, 3000], '売り切れの時は価格を変えない');
eq([W.unseen([r2], 0), W.unseen([r2], T0 + 1)], [1, 0], 'ウォッチを見たら数えない');
eq(W.compare(r2, { ok: true, stock: false }, 3200).changed, false, '売り切れのままなら、2回目は変化に数えない');
W.apply(r2, { ok: true, stock: true, price: 3000, pt: 2 }, 3200, T0 + H);
eq([r2.chg.back, r2.chg.changed, W.label(r2.chg), r2.shopPt], [true, true, '在庫が戻った・変わらず', 2], '在庫が戻った');
// まだ見ていない変化は、次に「変わらず」が来ても残す
const r3 = row();
W.apply(r3, { ok: true, stock: true, price: 3300, pt: 1 }, 3200, T0);
W.apply(r3, { ok: true, stock: true, price: 3300, pt: 1 }, 3200, T0 + H);
eq([r3.chg.cross, r3.chg.t, r3.chk.t], ['lost', T0, T0 + H], '見ていない変化の印は残る(確かめた時刻だけ進む)');

// 3. 自動: 6時間たっていなければ走らない。50件で止まる。無料では走らない。キーが無ければ走らない
const base = { paid: true, hasKeys: true, last: T0, now: T0 + 6 * H, lock: null, me: 'a' };
eq(W.canAuto(base), true, '6時間ちょうどで走る');
eq(W.canAuto(Object.assign({}, base, { now: T0 + 6 * H - 1 })), false, '6時間たっていなければ走らない');
eq(W.canAuto(Object.assign({}, base, { paid: false })), false, '無料では自動で走らない');
eq(W.canAuto(Object.assign({}, base, { hasKeys: false })), false, '楽天のキーが無ければ走らない');
eq(W.canAuto(Object.assign({}, base, { last: 0 })), true, '初めては走る');
const many = []; for (let i = 0; i < 70; i++) many.push(row({ code: i % 7 === 0 ? '' : 'shop:' + i, name: 'N' + i, chk: i < 30 ? { t: T0 + i } : undefined }));
const pick = W.pickAuto(many);
eq([pick.length, pick.every(r => !!r.code), pick[0].chk === undefined, W.AUTO_MAX], [50, true, true, 50], '商品コードのある行を、確かめていない行から50件');
eq(W.pickAuto(many.filter(r => r.chk)).map(r => r.chk.t).slice(0, 3), [T0 + 1, T0 + 2, T0 + 3], '確かめた時刻の古い順');

// 4. 楽天の403・429・通信の失敗で、行が壊れず、文が出る(にせの取り直し)
function env(replies, o) {
  let i = 0, q = 0;
  return Object.assign({ fetchItem: () => { const r = replies[i++]; return r && r.status !== undefined && !r.ok ? Promise.reject(r) : Promise.resolve(r); },
    useQuota: () => true, wait: () => Promise.resolve(), now: () => T0, limOf: () => 3200, origin: 'https://zeroichiworks.net', get calls() { return i; } }, o || {});
}
const ok = { ok: true, stock: true, price: 3000, pt: 1 };
(async () => {
  for (const [st, word] of [[403, '許可するWebサイト'], [429, '回数の制限'], [0, '接続できませんでした'], [500, '(500)']]) {
    const rows = [row(), row({ name: 'B', code: 'shop:2' }), row({ name: 'C', code: 'shop:3' })];
    const before = JSON.stringify(rows[1]);
    const out = await W.runCheck(rows, env([ok, { status: st }, ok]));
    eq([out.done, out.stopped, out.error.includes(word), JSON.stringify(rows[1]) === before, rows[2].chk === undefined], [1, 'error', true, true, true], `${st}: その場で止まり、行は変わらず、文が出る`);
  }
  // 無料の枠を使い切ったら止まる。「止める」で止まる。進み具合が出る
  let left = 2; const rowsQ = [row(), row({ code: 'shop:2' }), row({ code: 'shop:3' })];
  let out = await W.runCheck(rowsQ, env([ok, ok, ok], { useQuota: () => left-- > 0 }));
  eq([out.done, out.stopped, rowsQ[2].chk === undefined], [2, 'quota', true], '無料の枠を使い切ったら止まる');
  let stop = false; const prog = [];
  out = await W.runCheck([row(), row({ code: 'shop:2' }), row({ code: 'shop:3' })], env([ok, ok, ok], { stopped: () => stop, onProgress: (a, b) => { prog.push(a + '/' + b); stop = a >= 2; } }));
  eq([out.done, out.stopped, prog], [2, 'user', ['1/3', '2/3']], '「止める」で止まる');
  // 1件ごとに間をあける(最後の1件のあとは待たない)
  const waits = [];
  out = await W.runCheck([row(), row({ code: 'shop:2' }), row({ code: 'shop:3' })], env([ok, { ok: true, stock: false }, ok], { wait: (ms) => { waits.push(ms); return Promise.resolve(); } }));
  eq([out.done, out.changed, waits, W.CALL_GAP >= 1000], [3, 1, [W.CALL_GAP, W.CALL_GAP], true], '1件ごとに間をあける・変化の数');

  // 6. 商品コードの無い古いウォッチで落ちない(以前の形・読み取りから入れた行・空)
  const old = [{ name: '古い行', price: 1200, jan: '4901234567894', sell: 2500, saved: '2026-10-20', shopPt: 1 }, { name: 'JAN 4900000000000', price: 0, jan: '4900000000000', src: 'scan', manual: true }, {}];
  eq(W.pickAuto(old).length, 0, '商品コードの無い行は自動で確かめない');
  eq(old.map(r => W.compare(r, ok, null).kind), ['unknown', 'unknown', 'unknown'], '古い行は確かめられない');
  eq([W.unseen(old, 0), W.unseen(null, 0), W.unseen(undefined, 0)], [0, 0, 0], '数えても落ちない');
  eq(W.recount(old, () => null).length, 3, '数え直しても落ちない');
  eq(W.cheapest({ Items: [{ itemCode: 'a:1', itemPrice: 2000, availability: 1, shopName: '店A', itemUrl: 'u1' }, { Item: { itemCode: 'b:2', itemPrice: 1800, availability: 1, shopName: '店B', itemUrl: 'u2', pointRate: 5 } }, { itemCode: 'c:3', itemPrice: 1500, availability: 0 }] }),
    { code: 'b:2', price: 1800, shop: '店B', url: 'u2', pt: 5, freeShip: false, name: '' }, '探し直しは、在庫のある一番安い店');
  eq(W.cheapest({ Items: [] }), null, '探し直しで見つからない');

  // 7. 2つのタブで同時に開いても二重に確かめない(時刻の印)
  eq(W.lockFree({ t: T0, id: 'b' }, T0 + 1000, 'a'), false, '別のタブが確かめている間は走らない');
  eq(W.lockFree({ t: T0, id: 'a' }, T0 + 1000, 'a'), true, '自分の印なら走れる');
  eq(W.lockFree({ t: T0, id: 'b' }, T0 + W.LOCK_MS + 1, 'a'), true, '印が古くなったら(閉じたタブ)走れる');
  eq(W.canAuto(Object.assign({}, base, { lock: { t: base.now - 1000, id: 'b' } })), false, '自動も、別のタブが確かめている間は走らない');

  // 保存し直す時: 途中で足された行・消された行をそのままに、確かめた行だけ戻す
  const done = [row()]; done[0]._k = W.rowKey(done[0]); W.apply(done[0], { ok: true, stock: true, price: 3300, pt: 3 }, 3200, T0);
  const fresh = [{ name: '途中で足した行', price: 500, saved: '2026-11-13' }, row({ sell: 5200 })];
  const merged = W.mergeBack(fresh, done);
  eq([merged.length, merged[0].name, merged[1].price, merged[1].sell, merged[1].chg.cross, merged[1].shopPt, '_k' in merged[1]], [2, '途中で足した行', 3300, 5200, 'lost', 3, false], '保存し直しで、ほかの行と途中の入力を消さない');
  eq(W.mergeBack([], done), [], '消された行は戻さない');

  // 5. 通知を許可しない時・対応しないブラウザで落ちない(画面の部品を、通知の無いにせの画面で読み込む)
  const mem = {};
  global.window = { matchMedia: () => ({ matches: false }) };
  global.location = { hash: '', search: '', protocol: 'http:', origin: 'http://localhost' };
  global.navigator = {};
  global.document = { readyState: 'complete', body: { getAttribute: () => null }, addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }, dispatchEvent() {} };
  global.CustomEvent = function (name, o) { this.type = name; this.detail = o && o.detail; };
  global.localStorage = { getItem(k) { return k in mem ? mem[k] : null; }, setItem(k, v) { mem[k] = String(v); }, removeItem(k) { delete mem[k]; } };
  global.fetch = () => new Promise(() => {});
  const timers = []; const realSetTimeout = global.setTimeout; global.setTimeout = (fn) => { timers.push(fn); return 0; };
  window.SedoriCalc = require(path.join(root, SD, 'assets/calc.js'));
  window.SedoriSellerCheck = require(path.join(root, SD, 'assets/seller-check.js'));
  require(path.join(root, SD, 'assets/ui.js'));
  const U = window.SedoriUI; const toasts = []; U.toast = (t) => toasts.push(t);
  delete require.cache[require.resolve(path.join(root, SD, 'assets/watch-check.js'))];
  const src = require('fs').readFileSync(path.join(root, SD, 'assets/watch-check.js'), 'utf8');
  new Function('window', 'document', 'localStorage', 'location', 'navigator', 'fetch', 'setTimeout', 'module', src.replace(/\}\)\(typeof window[^;]*;\s*$/, '}).call(window, window);'))(window, document, localStorage, location, navigator, fetch, global.setTimeout, undefined);
  const WC = window.SedoriWatchCheck;
  eq(typeof WC.checkAll, 'function', '画面の部品が、通知の無い画面でも読み込める');
  eq(WC.notifyOn(), false, '通知に対応しないブラウザでは切');
  eq(await WC.enableNotify(true), false, '対応しないブラウザで入にしても落ちない');
  eq(toasts.pop(), 'このブラウザは通知に対応していません', '理由を知らせる');
  window.Notification = { permission: 'denied', requestPermission: () => Promise.resolve('denied') };
  eq([await WC.enableNotify(true), WC.notifyOn(), /許可されませんでした/.test(toasts.pop())], [false, false, true], '通知を許可しない時は切のまま');
  window.Notification = { permission: 'default', requestPermission: () => { throw new Error('x'); } };
  eq(await WC.enableNotify(true), false, '許可の問い合わせが落ちても止まらない');
  window.Notification = { permission: 'granted' };
  eq([await WC.enableNotify(true), WC.notifyOn(), await WC.enableNotify(false), WC.notifyOn()], [true, true, false, false], '許可済みなら入・切できる');
  // 無料・キーなし: 自動は走らず、手で押すとキーの案内。古いウォッチだけの時も落ちない
  mem['zw-sedori:watch2'] = JSON.stringify(old);
  WC.tryAuto(); eq(WC.unseen(), 0, '無料・古いウォッチで自動を呼んでも落ちない');
  eq(await WC.checkAll(), null, 'キーが無い時は確かめない'); eq(/アクセスキー/.test(toasts.pop()), true, 'キーの案内');
  mem['zw-sedori:keys'] = JSON.stringify({ rkApp: 'x', rkKey: 'y' });
  eq(await WC.checkAll(), null, '商品コードのある行が無い時は確かめない'); eq(/楽天で探し直す/.test(toasts.pop()), true, '探し直しの案内');
  global.setTimeout = realSetTimeout;

  // 文言: 断定・あおりの言葉が無い。販売サイトのページを読みに行かない(公式APIの住所だけ)
  eq((src.match(/稼げ|儲か|もうか|必ず|絶対|誰でも/g) || []).length, 0, '断定・あおりの言葉が0件');
  eq((src.match(/https?:\/\/[^'"\s)]+/g) || []).every(u => /^https:\/\/openapi\.rakuten\.co\.jp\//.test(u)), true, '呼ぶ先は楽天の公式APIだけ');
  // 批評の直し: 上の帯には変化の札を出さない(タブの側だけ)。通知は入・切の切り替え。言葉は「無料プラン」「取れていません」
  eq([/hd-watch'\)/.test(src), /n-w-chg'\)/.test(src)], [false, true], '変化の数は帯に出さず、ウォッチのタブの横だけ');
  eq([/role="switch"/.test(src), /押すとオン|押すとオフ/.test(src)], [true, false], '通知は入・切の切り替え');
  eq([/無料版/.test(src), />確かめられない</.test(src)], [false, false], '言葉のゆれが無い');
  console.log(`test_watch: ${n}件 すべて一致`);
})().catch(e => { console.error(e.message || e); process.exit(1); });
