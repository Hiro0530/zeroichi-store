// 利用の鍵 × PayPal の受け口(src/paypal_key.js)と、決済の種類を差し替える形(key.js の handleKey)の検算。
// PayPal と KV は偽物(メモリの中)。外へは出ない。実行: node test/test_paypal_key.js(test_key.js の最後からも呼ぶ)
import assert from 'node:assert';
import W, { keyDeps } from '../src/index.js';
import { handleKey, verifyPass, codeFor, providerOfSid } from '../src/key.js';
import { ppTerms, paypalPlans, paypalReady } from '../src/paypal_key.js';
import { handleCore } from '../src/core.js';

let n = 0;
function eq(a, b, msg) { assert.deepStrictEqual(a, b, `${msg}: 実際 ${JSON.stringify(a)} / 期待 ${JSON.stringify(b)}`); n++; }
async function rejects(p, code, msg) { try { await p; } catch (e) { eq(e.code, code, msg); return e; } assert.fail(msg + ': 例外が出ない'); }
const DAY = 864e5;
const NOW = Date.parse('2026-11-18T03:00:00Z');
const iso = t => new Date(t).toISOString();

async function pair() {
  const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return JSON.stringify(await crypto.subtle.exportKey('jwk', k.privateKey));
}
/* ---------- 偽物の KV ---------- */
function memKV() {
  const m = new Map();
  return { m, get: async k => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, String(v)); }, delete: async k => { m.delete(k); } };
}
const KV = memKV();
const env = {
  KEY_SIGNING_JWK: await pair(), KEY_CODE_SECRET: 'code-secret', APP_URL: 'https://zeroichiworks.net/sedori/', ALLOWED_ORIGIN: 'https://hiro0530.github.io',
  PAYPAL_ENV: 'sandbox', PAYPAL_CLIENT_ID: 'cid', PAYPAL_SECRET: 'sec', PAYPAL_WEBHOOK_ID: 'WH-1', ZW_KEYS: KV, PAY_PROVIDER: 'paypal',
  PAYPAL_PLAN_TOTAL_MONTH: 'P-TM0000001', PAYPAL_PLAN_TOTAL_YEAR: 'P-TY0000001', PAYPAL_PLAN_LIGHT_MONTH: 'P-LM0000001', PAYPAL_PLAN_BUSINESS_MONTH: 'P-BM0000001'
};

/* ---------- 偽物の PayPal ---------- */
const subs = {}, sent = [], refunds = [];
let txFor = id => [{ id: 'SALE-' + id, status: 'COMPLETED', time: subs[id].start_time, amount_with_breakdown: { gross_amount: { value: '49800', currency_code: 'JPY' } } }];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  url = String(url); const method = init.method || 'GET';
  const res = (o, status = 200) => new Response(status === 204 ? null : JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
  if (!url.startsWith('https://api-m.sandbox.paypal.com/')) throw new Error('想定外の通信 ' + url);
  const u = new URL(url), path = u.pathname, body = init.body ? JSON.parse(init.body === 'grant_type=client_credentials' ? '{}' : init.body) : {};
  sent.push({ method, path, body, headers: init.headers });
  if (path === '/v1/oauth2/token') return res({ access_token: 'tok', expires_in: 3000 });
  if (path === '/v1/notifications/verify-webhook-signature') return res({ verification_status: 'SUCCESS' });
  if (path === '/v1/billing/subscriptions' && method === 'POST') {
    const id = 'I-NEW' + String(Object.keys(subs).length + 1).padStart(6, '0');
    subs[id] = { id, status: 'APPROVAL_PENDING', plan_id: body.plan_id, custom_id: body.custom_id, create_time: iso(NOW), _ctx: body.application_context };
    return res({ id, status: 'APPROVAL_PENDING', links: [{ rel: 'approve', href: 'https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=BA-' + id }] }, 201);
  }
  let m = path.match(/^\/v1\/billing\/subscriptions\/([^/]+)(?:\/(\w+))?$/);
  if (m) {
    const s = subs[decodeURIComponent(m[1])]; if (!s) return res({ name: 'RESOURCE_NOT_FOUND' }, 404);
    if (m[2] === 'cancel') { s.status = 'CANCELLED'; s.status_update_time = iso(NOW); delete s.billing_info.next_billing_time; return res({}, 204); }
    if (m[2] === 'transactions') return res({ transactions: txFor(s.id) });
    return res(s);
  }
  m = path.match(/^\/v1\/payments\/sale\/([^/]+)\/refund$/);
  if (m) { refunds.push({ sale: m[1], key: init.headers['PayPal-Request-Id'] }); return res({ id: 'RF-' + m[1], state: 'completed' }, 201); }
  throw new Error('想定外の PayPal ' + method + ' ' + path);
};
function mkSub(id, o = {}) {
  subs[id] = Object.assign({ id, status: 'ACTIVE', plan_id: 'P-TM0000001', custom_id: 'zwkey:total_month', start_time: iso(NOW - 600e3), create_time: iso(NOW - 700e3),
    subscriber: { payer_id: 'PAYER' + id }, billing_info: { next_billing_time: iso(NOW + 30 * DAY), last_payment: { amount: { value: '4980' }, time: iso(NOW - 600e3) }, failed_payments_count: 0 } }, o);
  return subs[id];
}
const H = (path, body, e = env, now = NOW) => handleKey(path, body, e, keyDeps, now);

try {
  /* ---------- 1. 準備の判定と申し込み ---------- */
  eq(paypalReady({ ...env, ZW_KEYS: undefined }), false, 'KV が無い間は PayPal は準備中');
  eq(paypalReady({ ...env, PAYPAL_CLIENT_ID: 'ここに PayPal の Client ID' }), false, 'Client ID が仮の文字の間は準備中');
  eq(Object.keys(paypalPlans({ PAYPAL_PLAN_TOTAL_MONTH: 'P-TOTAL-MONTH' })), [], '仮のプランID(P-TOTAL-MONTH)は数えない');
  eq([providerOfSid('sub_1'), providerOfSid('I-ABC123'), providerOfSid('x')], ['stripe', 'paypal', ''], '契約番号の形で決済を見分ける');
  await rejects(H('/key/checkout', { planKey: 'total_month', provider: 'paypal' }, { ...env, ZW_KEYS: undefined }), 'not-ready', 'PayPal の鍵・KV が無い間の申し込みは「準備中」(試験用の動き)');
  let r = await W.fetch(new Request('https://w.example/key/plans?provider=paypal'), { ...env, ZW_KEYS: undefined });
  eq((await r.json()).ready, [], '準備中の間、料金ページは PayPal で申し込めない表示');
  r = await W.fetch(new Request('https://w.example/key/plans?provider=paypal'), env);
  eq((await r.json()).ready.sort(), ['business_month', 'light_month', 'total_month', 'total_year'], 'プランIDの入ったプランだけ申し込める');
  r = await W.fetch(new Request('https://w.example/key/plans?provider=stripe'), { ...env, STRIPE_SECRET_KEY: '' });
  eq((await r.json()).provider, 'stripe', 'Stripe の受け口はそのまま残る');
  const co = await H('/key/checkout', { planKey: 'total_month' });   // provider を送らない時は Worker の PAY_PROVIDER
  eq(/sandbox\.paypal\.com/.test(co.url), true, 'PAY_PROVIDER=paypal: 申し込みは PayPal の画面へ');
  const made = sent.filter(x => x.path === '/v1/billing/subscriptions' && x.method === 'POST').pop();
  eq([made.body.plan_id, made.body.custom_id, made.body.application_context.user_action, /mypage\/\?pp=1#mp-key$/.test(made.body.application_context.return_url)], ['P-TM0000001', 'zwkey:total_month', 'SUBSCRIBE_NOW', true], '申し込み: プラン・印(名前やメールは送らない)・戻り先');
  eq('subscriber' in made.body, false, '申し込みに客の名前・メールを入れない');
  eq(!!made.headers['PayPal-Request-Id'], true, '申し込みの2回押しを PayPal 側で1つにまとめる印');
  await rejects(H('/key/checkout', { planKey: 'founder_year', provider: 'paypal' }), 'no-price', 'プランIDの無いプランは申し込めない');
  // 画面が stripe を選べば Stripe へ(差し替えは設定1つ)
  await rejects(H('/key/checkout', { planKey: 'total_month', provider: 'stripe' }, { ...env, STRIPE_SECRET_KEY: '', STRIPE_PRICE_TOTAL_MONTH: 'price_tm' }).catch(e => { throw Object.assign(e, { code: e.code || String(e.status) }); }), '503', 'provider=stripe は Stripe の受け口へ(鍵が無ければ 503 の準備中)');

  /* ---------- 2. 申し込み直後に鍵を受け取る ---------- */
  const id1 = made && Object.keys(subs).pop();
  await rejects(H('/key/claim', { subscriptionId: id1, device: 'deva0001' }), 'not-complete', '支払いの確定前(APPROVAL_PENDING)は鍵を渡さない');
  Object.assign(subs[id1], { status: 'ACTIVE', start_time: iso(NOW - 60e3), subscriber: { payer_id: 'PAYER1' }, billing_info: { next_billing_time: iso(NOW + 30 * DAY), last_payment: { amount: { value: '4980' }, time: iso(NOW - 60e3) }, failed_payments_count: 0 } });
  const a1 = await H('/key/claim', { subscriptionId: id1, device: 'deva0001', label: 'iPhone' });
  eq([a1.provider, a1.status, a1.tier, a1.planKey, a1.sid, !!a1.pass], ['paypal', 'active', 'total', 'total_month', id1, true], '確定後: 鍵と証明が出る');
  eq(a1.code, await codeFor(env, id1, 0), '鍵の文字は Stripe と同じ決まり(契約番号と合言葉から)');
  const p1 = await verifyPass(env, a1.pass, NOW);
  eq([p1.t, p1.sid, p1.d, p1.exp <= NOW + DAY], ['total', id1, 'deva0001', true], '証明の中身(期限は1日まで)');
  const st1 = JSON.parse(KV.m.get('s:' + id1));
  eq([st1.zw_key, KV.m.get('c:' + a1.code)], [a1.code, id1], 'KV に置くのは鍵・端末・索引だけ');
  eq(/@|PAYER|payer/.test(JSON.stringify([...KV.m.entries()])), false, 'KV に支払う人の番号・メールを置かない(名簿を作らない)');
  await rejects(H('/key/claim', { subscriptionId: 'I-NOPE000001', device: 'deva0001' }), 'bad-session', '無い契約番号');
  mkSub('I-OLDLOGIN01', { custom_id: 'firebase-uid-1' });
  await rejects(H('/key/claim', { subscriptionId: 'I-OLDLOGIN01', device: 'deva0001' }), 'bad-session', '利用の鍵の申し込みでない契約(古いログインの形)からは受け取れない');
  // 3日後: 端末が入っている契約は、契約番号ではもう受け取れない(鍵で入れる)
  await rejects(H('/key/claim', { subscriptionId: id1, device: 'devz0001' }, env, NOW + 3 * DAY), 'claim-expired', '2日を過ぎ、端末がある契約は契約番号で受け取れない');

  /* ---------- 3. 更新・別の端末・端末の数・作り直し(Stripe と同じ流れ) ---------- */
  const r1 = await H('/key/renew', { code: a1.code, device: 'deva0001', sid: id1, known: true });
  eq([r1.status, !!r1.pass], ['active', true], '更新');
  const b1 = await H('/key/renew', { code: a1.code, device: 'devb0001', label: 'Windows', known: false });   // sid なし → KV の索引で探す
  eq([b1.sid, b1.devices.length], [id1, 2], '別の端末で鍵を入れる(契約番号なしでも索引で見つかる)');
  await H('/key/renew', { code: a1.code, device: 'devc0001', known: false });
  await rejects(H('/key/renew', { code: a1.code, device: 'devd0001', known: false }), 'devices-full', '4台目は「いっぱい」');
  await H('/key/devices/remove', { code: a1.code, device: 'deva0001', target: 'devc0001' });
  await rejects(H('/key/renew', { code: a1.code, device: 'devc0001', known: true }), 'device-removed', '外した端末は鍵を入れ直すまで止まる');
  const rot = await H('/key/rotate', { code: a1.code, device: 'deva0001', sid: id1 });
  eq([rot.code !== a1.code, rot.devices.length, KV.m.has('c:' + a1.code), KV.m.get('c:' + rot.code)], [true, 1, false, id1], '作り直し: 古い鍵の索引を消し、端末はこの1台');
  await rejects(H('/key/renew', { code: a1.code, device: 'devb0001', known: true }), 'no-key', '作り直す前の鍵は使えない');
  const code = rot.code;
  const po = await H('/key/portal', { code, device: 'deva0001', sid: id1 });
  eq(/sandbox\.paypal\.com\/myaccount\/autopay\/$/.test(po.url), true, '「契約の管理」は PayPal の自動支払いの画面');

  /* ---------- 4. 有料の機能の芯は決済の種類に寄らない ---------- */
  const core1 = await handleCore({ pass: rot.pass, device: 'deva0001', ops: [{ op: 'limits' }] }, env, NOW);
  eq(core1.tier, 'total', 'PayPal の契約の証明でも /core は同じ答え');

  /* ---------- 5. 止める: 未払い・PayPal の画面で解約・アプリで解約 ---------- */
  subs[id1].billing_info.failed_payments_count = 1;
  eq((await H('/key/renew', { code, device: 'deva0001', sid: id1, known: true })).status, 'past_due', '支払いの失敗中: 使えるが期限は1日ずつ');
  subs[id1].billing_info.failed_payments_count = 0;
  subs[id1].status = 'SUSPENDED';
  const sus = await H('/key/renew', { code, device: 'deva0001', sid: id1, known: true });
  eq([sus.status, sus.tier, sus.pass], ['suspended', 'free', null], '止まった契約(未払いで PayPal が停止)には証明を出さない');
  subs[id1].status = 'ACTIVE';
  // Webhook(ACTIVATED)で次の請求日を控える → PayPal の画面で解約 → 控えた日まで使える
  const hook = (ev) => W.fetch(new Request('https://w.example/paypal/webhook', { method: 'POST', body: JSON.stringify(ev), headers: { 'paypal-transmission-id': 't', 'paypal-transmission-sig': 's', 'paypal-transmission-time': 'x', 'paypal-cert-url': 'c', 'paypal-auth-algo': 'a' } }), env);
  let h = await (await hook({ event_type: 'BILLING.SUBSCRIPTION.ACTIVATED', resource: { id: id1, custom_id: 'zwkey:total_month' } })).json();
  eq([h.ok, h.key, h.status], [true, true, 'active'], 'Webhook: 利用の鍵の契約は KV に控えるだけ(Firestore を呼ばない)');
  eq(JSON.parse(KV.m.get('s:' + id1)).nb, NOW + 30 * DAY, '次の請求日を控える');
  subs[id1].status = 'CANCELLED'; delete subs[id1].billing_info.next_billing_time;
  h = await (await hook({ event_type: 'BILLING.SUBSCRIPTION.CANCELLED', resource: { id: id1, custom_id: 'zwkey:total_month' } })).json();
  eq(JSON.parse(KV.m.get('s:' + id1)).end, NOW + 30 * DAY, 'PayPal の画面で解約: 控えた次の請求日を「使える最後の日」に');
  let e1 = await H('/key/renew', { code, device: 'deva0001', sid: id1, known: true }, env, NOW + 10 * DAY);
  eq([e1.status, e1.tier, e1.end, !!e1.pass], ['ending', 'total', NOW + 30 * DAY, true], '解約後も払った期間の終わりまで使える');
  e1 = await H('/key/renew', { code, device: 'deva0001', sid: id1, known: true }, env, NOW + 31 * DAY);
  eq([e1.status, e1.tier, e1.pass], ['ended', 'free', null], '終わりの日を過ぎたら証明は出ない(無料の範囲に戻る)');
  const p10 = (await H('/key/renew', { code, device: 'deva0001', sid: id1, known: true }, env, NOW + 29.5 * DAY)).pass;
  eq(await verifyPass(env, p10, NOW + 30.5 * DAY), null, '解約前に受け取った証明も、終わりの日を過ぎれば通らない');

  // 控えが無い時(Webhook が来る前に解約された): 最後の支払い+1か月
  mkSub('I-NOMEMO0001', { status: 'CANCELLED', billing_info: { last_payment: { amount: { value: '4980' }, time: iso(NOW - 5 * DAY) } } });
  eq(ppTerms(subs['I-NOMEMO0001'], {}, NOW, DAY, 'total_month').status, 'ending', '控えが無くても、最後の支払いから1か月は使える');
  eq(ppTerms(subs['I-NOMEMO0001'], {}, NOW + 30 * DAY, DAY, 'total_month').status, 'ended', '最後の支払いから1か月を過ぎたら止まる');

  // アプリの「解約する」(月払い): 次の請求日まで使える。返金はしない
  mkSub('I-APPCANCEL1');
  const ac = await H('/key/claim', { subscriptionId: 'I-APPCANCEL1', device: 'deve0001' });
  const ca = await H('/key/cancel', { code: ac.code, device: 'deve0001', sid: 'I-APPCANCEL1' });
  eq([ca.status, ca.end, !!ca.pass, ca.refund, subs['I-APPCANCEL1'].status], ['ending', NOW + 30 * DAY, true, undefined, 'CANCELLED'], 'アプリで解約(月払い): 次の請求日まで使える・返金なし');
  await rejects(H('/key/cancel', { code: ac.code, device: 'devx0001', sid: 'I-APPCANCEL1' }), 'device-removed', 'この鍵の端末でない所からは解約できない');

  /* ---------- 6. 年払いの30日以内の全額返金(同じ PayPal アカウントでは1回まで) ---------- */
  mkSub('I-YEAR000001', { plan_id: 'P-TY0000001', custom_id: 'zwkey:total_year', subscriber: { payer_id: 'PAYERY' }, billing_info: { next_billing_time: iso(NOW + 365 * DAY), last_payment: { amount: { value: '49800' }, time: iso(NOW - 600e3) }, failed_payments_count: 0 } });
  const y1 = await H('/key/claim', { subscriptionId: 'I-YEAR000001', device: 'devy0001' });
  const yc = await H('/key/cancel', { code: y1.code, device: 'devy0001', sid: 'I-YEAR000001' }, env, NOW + 5 * DAY);
  eq([yc.refund, yc.status, refunds.length, refunds[0].sale], [{ amount: 49800 }, 'ended', 1, 'SALE-I-YEAR000001'], '年払い30日以内: 全額返金してその日で終える');
  eq(refunds[0].key, 'zw-year-refund-I-YEAR000001', '返金の2回押しを PayPal 側で1つにまとめる印');
  mkSub('I-YEAR000002', { plan_id: 'P-TY0000001', custom_id: 'zwkey:total_year', subscriber: { payer_id: 'PAYERY' }, billing_info: { next_billing_time: iso(NOW + 365 * DAY), last_payment: { amount: { value: '49800' }, time: iso(NOW) }, failed_payments_count: 0 } });
  const y2 = await H('/key/claim', { subscriptionId: 'I-YEAR000002', device: 'devy0002' });
  const yc2 = await H('/key/cancel', { code: y2.code, device: 'devy0002', sid: 'I-YEAR000002' }, env, NOW + 5 * DAY);
  eq([refunds.length, yc2.status, yc2.end], [1, 'ending', NOW + 365 * DAY], '同じ PayPal アカウントの2回目: 返金せず、払った1年の終わりまで使える');
  mkSub('I-YEAR000003', { plan_id: 'P-TY0000001', custom_id: 'zwkey:total_year', subscriber: { payer_id: 'PAYERZ' }, start_time: iso(NOW - 40 * DAY) });
  const y3 = await H('/key/claim', { subscriptionId: 'I-YEAR000003', device: 'devy0003' }, env, NOW - 40 * DAY + 60e3);
  await H('/key/cancel', { code: y3.code, device: 'devy0003', sid: 'I-YEAR000003' });
  eq(refunds.length, 1, '30日を過ぎた年払いは返金しない');

  /* ---------- 7. 決済をまたいだ探し方(Stripe の受け口は残る) ---------- */
  const envBoth = { ...env, STRIPE_SECRET_KEY: 'sk_test_both' };   // Stripe も動く設定(偽物の通信は PayPal しか答えないので、Stripe を呼べば落ちる)
  eq((await H('/key/renew', { code, device: 'deva0001', known: true }, envBoth, NOW + 10 * DAY)).provider, 'paypal', 'Stripe と PayPal の両方がある時も、PayPal の鍵は索引で見つかる(Stripe の検索を呼ばない)');
  eq(sent.some(x => /stripe/.test(x.path)), false, 'PayPal の鍵で Stripe を呼ばない');
  console.log(`OK 利用の鍵 × PayPal ${n}件`);
} finally { globalThis.fetch = realFetch; }
