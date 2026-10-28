// Worker の検算(Stripe・PayPal・Firestore・Google をすべて偽物に置き換える)。実行: node test/test_worker.js
import assert from 'node:assert';
import { createHmac } from 'node:crypto';
import W, { normalize, normalizeStripe, refundDeadline, YEAR_TEXT, YEAR_REFUND_DAYS, verifyIdToken, verifyStripeSignature, formEncode, stripePrices, toFields, fromFields, trialReminderMail, daily, _resetCaches } from '../src/index.js';

let n = 0;
function eq(a, b, msg) { assert.deepStrictEqual(a, b, `${msg}: 実際 ${JSON.stringify(a)} / 期待 ${JSON.stringify(b)}`); n++; }
const DAY = 864e5;

/* ---------- 偽物の鍵(サービスアカウント・ID トークン) ---------- */
const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', kp.privateKey)).toString('base64');
const pem = `-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
const jwk = { ...(await crypto.subtle.exportKey('jwk', kp.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
const b64u = b => Buffer.from(b).toString('base64url');
async function idToken(claims, kid = 'k1') {
  const h = b64u(JSON.stringify({ alg: 'RS256', kid })), p = b64u(JSON.stringify(claims));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, new TextEncoder().encode(h + '.' + p));
  return h + '.' + p + '.' + b64u(sig);
}

const env = {
  FIREBASE_PROJECT_ID: 'demo-zw', FIREBASE_SA_EMAIL: 'sa@demo-zw.iam.gserviceaccount.com', FIREBASE_SA_KEY: pem,
  PAYPAL_ENV: 'sandbox', PAYPAL_CLIENT_ID: 'cid', PAYPAL_SECRET: 'sec', PAYPAL_WEBHOOK_ID: 'WH-1',
  ALLOWED_ORIGIN: 'https://hiro0530.github.io', APP_URL: 'https://zeroichiworks.net/sedori/', TRIAL_DAYS: '14', FOUNDER_LIMIT: '2',
  MAIL_HOOK_URL: 'https://script.example/exec', MAIL_HOOK_SECRET: 'm',
  STRIPE_SECRET_KEY: 'sk_test_fake', STRIPE_WEBHOOK_SECRET: 'whsec_fake',
  STRIPE_PRICE_TOTAL_MONTH: 'price_tm', STRIPE_PRICE_TOTAL_YEAR: 'price_ty', STRIPE_PRICE_FOUNDER_MONTH: 'price_fm', STRIPE_PRICE_FOUNDER_YEAR: 'price_fy',
  STRIPE_PRICE_LIGHT_MONTH: 'price_lm', STRIPE_PRICE_BUSINESS_MONTH: 'price_bm', STRIPE_PRICE_LIGHT_YEAR: '',
  PLANS: JSON.stringify({ 'P-SM': { key: 'total_month', name: '総合(月払い)', amount: '月4,980円' }, 'P-SY': { key: 'total_year', name: '総合(年払い)', amount: '年49,800円' }, 'P-FM': { key: 'founder_month', name: '総合 先着100名の価格(月払い)', amount: '月3,980円', founder: true }, 'P-LM': { key: 'light_month', name: 'ライト(月払い)', amount: '月2,980円' } }),
};

/* ---------- 偽物の外部(Firestore・PayPal・Google) ---------- */
const db = {};         // 'users/u1' → fields
const paypal = {};     // subId → subscription
const stripeSubs = {}; // Stripe の subId → subscription
const stripeSessions = {}; // Checkout Session
const stripeSent = []; // Stripe に送った { method, path, form }
let stripeDown = false;
const stripeInvoices = {}; // subId → 請求書の一覧
const stripeInvPays = {};  // 請求書ID → invoice_payments(新しい API)
const stripeRefunds = [];
let refundFail = false;
const calls = [];
let verifyResult = 'SUCCESS';
const mails = [];
let lag = false;       // true の間は通信ごとに順番を譲る(同時に届いた通知の再現)
globalThis.fetch = async (url, init = {}) => {
  if (lag) await new Promise(r => setTimeout(r, 1));
  url = String(url); const method = init.method || 'GET'; const body = init.body ? (typeof init.body === 'string' ? init.body : '') : '';
  calls.push(method + ' ' + url.replace(/\?.*$/, ''));
  const res = (obj, status = 200) => new Response(obj == null ? null : JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
  if (url.startsWith('https://oauth2.googleapis.com/token')) { assert.match(body, /assertion=/); return res({ access_token: 'g', expires_in: 3600 }); }
  if (url.includes('/jwk/securetoken')) return res({ keys: [jwk] });
  if (url.endsWith('/v1/oauth2/token')) return res({ access_token: 'p', expires_in: 3600 });
  if (url.endsWith('/v1/notifications/verify-webhook-signature')) { const j = JSON.parse(body); assert.equal(j.webhook_id, 'WH-1'); return res({ verification_status: verifyResult }); }
  let m = url.match(/\/v1\/billing\/subscriptions\/([^/?]+)(?:\/(\w+))?$/);
  if (m) {
    const s = paypal[decodeURIComponent(m[1])]; if (!s) return res({ name: 'RESOURCE_NOT_FOUND' }, 404);
    if (!m[2]) return res(s);
    if (m[2] === 'suspend') { s.status = 'SUSPENDED'; return res(null, 204); }
    if (m[2] === 'activate') { s.status = 'ACTIVE'; return res(null, 204); }
    if (m[2] === 'cancel') { s.status = 'CANCELLED'; s.cancelReason = JSON.parse(body).reason; return res(null, 204); }
    if (m[2] === 'revise') return res({ links: [{ rel: 'approve', href: 'https://www.sandbox.paypal.com/approve?ba=1' }] });
  }
  if (/\/v1\/billing\/plans\/[^/]+\/deactivate$/.test(url)) return res(null, 204);
  if (url.startsWith('https://api.stripe.com/v1/')) {
    assert.equal(init.headers.Authorization, 'Bearer sk_test_fake');
    if (stripeDown) return res({ error: { message: 'down' } }, 500);
    const path = url.slice('https://api.stripe.com/v1'.length).replace(/\?.*$/, '');
    const form = Object.fromEntries(new URLSearchParams(body));
    stripeSent.push({ method, path, form, idem: (init.headers || {})['Idempotency-Key'] || '' });
    let m2 = path.match(/^\/subscriptions\/([^/]+)$/);
    if (m2) {
      const sub = stripeSubs[decodeURIComponent(m2[1])]; if (!sub) return res({ error: { message: 'No such subscription' } }, 404);
      if (method === 'DELETE') { sub.status = 'canceled'; sub.ended_at = sec(Date.now()); sub.canceled_at = sec(Date.now()); return res(sub); }
      if (method === 'POST') {
        if (form['metadata[refunded]']) { sub.metadata.refunded = form['metadata[refunded]']; sub.metadata.refund_id = form['metadata[refund_id]']; }
        if (form.cancel_at_period_end === 'true') sub.cancel_at_period_end = true;
        if (form['metadata[cancel_reason]']) sub.metadata.cancel_reason = form['metadata[cancel_reason]'];
        if (form['metadata[planKey]']) sub.metadata.planKey = form['metadata[planKey]'];
        if ('pause_collection' in form && form.pause_collection === '') sub.pause_collection = null;
        if (form['pause_collection[behavior]']) sub.pause_collection = { behavior: form['pause_collection[behavior]'], resumes_at: Number(form['pause_collection[resumes_at]']) };
        if (form['items[0][price]']) { assert.equal(form['items[0][id]'], sub.items.data[0].id); sub.items.data[0].price = { id: form['items[0][price]'] }; }
      }
      return res(sub);
    }
    if (path === '/checkout/sessions' && method === 'POST') { const id = 'cs_' + (Object.keys(stripeSessions).length + 1); stripeSessions[id] = { id, form }; return res({ id, url: 'https://checkout.stripe.com/c/pay/' + id }); }
    m2 = path.match(/^\/checkout\/sessions\/([^/]+)$/);
    if (m2) return stripeSessions[m2[1]] ? res(stripeSessions[m2[1]]) : res({ error: { message: 'no' } }, 404);
    if (path === '/billing_portal/sessions') return res({ url: 'https://billing.stripe.com/p/session/x' });
    if (path === '/invoices' && method === 'GET') { const q = Object.fromEntries(new URL(url).searchParams); return res({ data: stripeInvoices[q.subscription] || [] }); }
    if (path === '/invoice_payments' && method === 'GET') { const q = Object.fromEntries(new URL(url).searchParams); return res({ data: stripeInvPays[q.invoice] || [] }); }
    if (path === '/refunds' && method === 'POST') {
      if (refundFail) return res({ error: { message: 'charge_already_refunded' } }, 400);
      const r = { id: 're_' + (stripeRefunds.length + 1), amount: 49800, ...form }; stripeRefunds.push(r); return res(r);
    }
  }
  if (url.startsWith(env.MAIL_HOOK_URL)) { mails.push(JSON.parse(body)); return new Response('{"ok":true}'); }
  const base = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
  if (url.startsWith(base)) {
    const rest = url.slice(base.length);
    if (rest.startsWith(':runQuery')) {
      const q = JSON.parse(body).structuredQuery.where.fieldFilter; const path = q.field.fieldPath.split('.');
      const out = Object.entries(db).filter(([k]) => /^users\/[^/]+$/.test(k)).filter(([, f]) => {
        const v = fromFields(f); const x = path.reduce((o, k) => (o || {})[k], v);
        if (q.op === 'EQUAL') return x === q.value.stringValue;
        if (q.op === 'LESS_THAN') return x instanceof Date && x < new Date(q.value.timestampValue);
        return false;
      }).map(([k, f]) => ({ document: { name: base.replace('https://firestore.googleapis.com/v1/', '') + '/' + k, fields: f } }));
      return res(out);
    }
    if (rest.startsWith(':commit')) {
      const writes = JSON.parse(body).writes, key = n => n.split('/documents/')[1];
      // 前提(無い時だけ作る)が崩れたら、全体を書かない(本物の Firestore と同じ)
      for (const w of writes) if (w.update && w.currentDocument && w.currentDocument.exists === false && db[key(w.update.name)]) return res({ error: { status: 'FAILED_PRECONDITION' } }, 400);
      for (const w of writes) {
        if (w.delete) delete db[key(w.delete)];
        if (w.update) db[key(w.update.name)] = Object.assign({}, w.update.fields);
        if (w.transform) {
          const k = key(w.transform.document); db[k] = Object.assign({}, db[k] || {});
          for (const t of w.transform.fieldTransforms) db[k][t.fieldPath] = { integerValue: String(Number((db[k][t.fieldPath] || {}).integerValue || 0) + Number(t.increment.integerValue)) };
        }
      }
      return res({});
    }
    const path = decodeURIComponent(rest.replace(/^\//, '').replace(/\?.*$/, ''));
    if (method === 'GET' && /ledger$/.test(path)) { const docs = Object.keys(db).filter(k => k.startsWith(path + '/')).map(k => ({ name: 'x/documents/' + k })); return res(docs.length ? { documents: docs } : {}); }
    if (method === 'GET') return db[path] ? res({ fields: db[path] }) : res({ error: 'nf' }, 404);
    if (method === 'PATCH') { const f = JSON.parse(body).fields; db[path] = Object.assign({}, db[path] || {}, f); return res({ fields: db[path] }); }
  }
  throw new Error('想定外の通信 ' + method + ' ' + url);
};
const get = p => db[p] ? fromFields(db[p]) : null;

/* ---------- 1. Firestore の値の変換 ---------- */
{
  const d = new Date('2026-11-10T00:00:00Z');
  const o = { a: 1, b: 1.5, c: 'x', d, e: null, f: true, g: { h: [1, 'y'] } };
  eq(fromFields(toFields(o)), o, '変換して戻すと同じ');
  eq(toFields({ a: undefined, b: 1 }), { b: { integerValue: '1' } }, 'undefined は書かない');
}

/* ---------- 2. PayPal の状態 → アプリの状態 ---------- */
{
  const now = Date.parse('2026-10-27T00:00:00Z');
  const base = { id: 'I-1', plan_id: 'P-SM', start_time: '2026-10-27T00:00:00Z', custom_id: 'u1', billing_info: { next_billing_time: '2026-11-10T00:00:00Z', failed_payments_count: 0 } };
  let s = normalize({ ...base, status: 'ACTIVE' }, {}, env, now + DAY);
  eq([s.status, s.planKey, s.amount, s.trialEnd.toISOString()], ['trialing', 'total_month', '月4,980円', '2026-11-10T00:00:00.000Z'], '無料期間中');
  s = normalize({ ...base, status: 'ACTIVE', billing_info: { ...base.billing_info, last_payment: { amount: { value: '4980' } } } }, {}, env, now + 15 * DAY);
  eq(s.status, 'active', '1回目を払ったら active');
  s = normalize({ ...base, status: 'ACTIVE', billing_info: { ...base.billing_info, failed_payments_count: 1 } }, {}, env, now + 15 * DAY);
  eq(s.status, 'past_due', '支払いの失敗');
  eq(normalize({ ...base, status: 'SUSPENDED' }, { pausedByUser: true, resumeAt: new Date(now + 30 * DAY) }, env, now).status, 'paused', '利用者が止めた');
  eq(normalize({ ...base, status: 'SUSPENDED' }, {}, env, now).status, 'suspended', 'PayPalが止めた');
  s = normalize({ ...base, status: 'CANCELLED' }, { nextBillingAt: new Date('2026-11-10T00:00:00Z') }, env, now + 3 * DAY);
  eq([s.status, s.paidThrough.toISOString(), s.retainUntil.toISOString().slice(0, 10), s.nextBillingAt], ['canceled', '2026-11-10T00:00:00.000Z', '2029-11-10', null], '無料期間中の解約: 期間の終わりまで使え、3年保管');
  eq(normalize({ ...base, status: 'APPROVAL_PENDING' }, {}, env, now).status, 'incomplete', '承認待ち');
}

/* ---------- 3. ID トークン ---------- */
{
  _resetCaches();
  const t = Math.floor(Date.now() / 1000);
  const good = { aud: 'demo-zw', iss: 'https://securetoken.google.com/demo-zw', sub: 'u1', email: 'a@example.com', iat: t - 10, exp: t + 3600 };
  eq(await verifyIdToken(await idToken(good), env), { uid: 'u1', email: 'a@example.com' }, '正しいトークン');
  for (const [bad, msg] of [[{ ...good, aud: 'other' }, '別のプロジェクト'], [{ ...good, exp: t - 1 }, '期限切れ']]) {
    await assert.rejects(verifyIdToken(await idToken(bad), env), undefined, msg); n++;
  }
  await assert.rejects(verifyIdToken(await idToken(good, 'k9'), env)); n++;
  const tok = await idToken(good); const parts = tok.split('.'); parts[1] = b64u(JSON.stringify({ ...good, sub: 'u2' }));
  await assert.rejects(verifyIdToken(parts.join('.'), env)); n++; // 中身の書き換え
}

/* ---------- 4. Webhook ---------- */
const hook = (ev, headers = {}) => W.fetch(new Request('https://w.example/paypal/webhook', { method: 'POST', body: JSON.stringify(ev), headers: { 'paypal-transmission-id': 't', 'paypal-transmission-sig': 's', 'paypal-transmission-time': 'x', 'paypal-cert-url': 'c', 'paypal-auth-algo': 'a', ...headers } }), env);
{
  paypal['I-1'] = { id: 'I-1', status: 'ACTIVE', plan_id: 'P-FM', custom_id: 'u1', start_time: new Date().toISOString(), subscriber: { email_address: 'payer@example.com' }, billing_info: { next_billing_time: new Date(Date.now() + 14 * DAY).toISOString(), failed_payments_count: 0 } };
  let r = await hook({ event_type: 'BILLING.SUBSCRIPTION.ACTIVATED', resource: { id: 'I-1', custom_id: 'u1' } });
  eq([r.status, (await r.json()).status], [200, 'trialing'], '申し込み → 無料期間');
  eq([get('users/u1').subscription.status, get('users/u1').subscription.founder, get('paypalSubs/I-1').uid], ['trialing', true, 'u1'], 'Firestore に書く');
  eq(get('public/founders'), null, '無料期間中は先着の人数に数えない(1回目のお支払いが済んだ順)');
  paypal['I-2'] = { ...paypal['I-1'], id: 'I-2', custom_id: 'u2', billing_info: { ...paypal['I-1'].billing_info, last_payment: { amount: { value: '3980' } } } };
  await hook({ event_type: 'BILLING.SUBSCRIPTION.ACTIVATED', resource: { id: 'I-2' } });
  eq([get('users/u2').subscription.status, get('public/founders').taken, get('public/founders').open], ['active', 1, true], '1回目を払ったら数える');
  r = await hook({ event_type: 'BILLING.SUBSCRIPTION.UPDATED', resource: { id: 'I-2' } });
  eq(get('public/founders').taken, 1, '同じ契約は2回数えない');
  paypal['I-8'] = { ...paypal['I-2'], id: 'I-8', custom_id: 'u8' };
  await hook({ event_type: 'PAYMENT.SALE.COMPLETED', resource: { billing_agreement_id: 'I-8' } });
  eq([get('public/founders').taken, get('public/founders').open, calls.filter(c => /deactivate/.test(c)).length], [2, false, 1], '上限で受付を止め、先着のプランを止める');
  verifyResult = 'FAILURE';
  r = await hook({ event_type: 'BILLING.SUBSCRIPTION.CANCELLED', resource: { id: 'I-1' } });
  eq(r.status, 400, '署名が違えば受けない');
  verifyResult = 'SUCCESS';
  r = await W.fetch(new Request('https://w.example/paypal/webhook', { method: 'POST', body: '{}' }), env);
  eq(r.status, 400, '署名の見出しが無ければ受けない');
  paypal['I-1'].billing_info.failed_payments_count = 1;
  await hook({ event_type: 'BILLING.SUBSCRIPTION.PAYMENT.FAILED', resource: { id: 'I-1' } });
  eq(get('users/u1').subscription.status, 'past_due', '支払いの失敗');
  paypal['I-1'].billing_info.failed_payments_count = 0;
  await hook({ event_type: 'PAYMENT.SALE.COMPLETED', resource: { billing_agreement_id: 'I-1' } });
  eq(get('users/u1').subscription.status, 'trialing', '入金の通知でも読み直す');
  r = await hook({ event_type: 'CHECKOUT.ORDER.APPROVED', resource: {} });
  eq((await r.json()).ignored, 'CHECKOUT.ORDER.APPROVED', '関係ない出来事は無視');
}

/* ---------- 5. 利用者からの頼み ---------- */
{
  const t = Math.floor(Date.now() / 1000);
  const tok = await idToken({ aud: 'demo-zw', iss: 'https://securetoken.google.com/demo-zw', sub: 'u1', iat: t, exp: t + 3600 });
  const call = (path, body, token = tok, origin = 'https://hiro0530.github.io') => W.fetch(new Request('https://w.example' + path, { method: 'POST', body: JSON.stringify(body || {}), headers: { Authorization: 'Bearer ' + token, Origin: origin, 'Content-Type': 'application/json' } }), env);
  let r = await call('/paypal/link', { subscriptionID: 'I-2' });
  eq(r.status, 403, '他人の契約は結びつけない');
  eq(r.headers.get('Access-Control-Allow-Origin'), 'https://hiro0530.github.io', 'CORS');
  r = await call('/paypal/cancel', {}, 'bad.token.x');
  eq(r.status, 401, 'ログインしていなければ断る');
  // 一時停止は有料(active)の時だけ
  r = await call('/paypal/pause');
  eq(r.status, 409, '無料期間中は一時停止しない');
  paypal['I-1'].billing_info.last_payment = { amount: { value: '3980' } };
  await hook({ event_type: 'BILLING.SUBSCRIPTION.UPDATED', resource: { id: 'I-1' } });
  r = await call('/paypal/pause');
  eq([r.status, get('users/u1').subscription.status, paypal['I-1'].status], [200, 'paused', 'SUSPENDED'], '1か月止める');
  await hook({ event_type: 'BILLING.SUBSCRIPTION.SUSPENDED', resource: { id: 'I-1' } });
  eq(get('users/u1').subscription.status, 'paused', 'Webhook が来ても一時停止のまま');
  r = await call('/paypal/resume');
  eq([(await r.json()).status, paypal['I-1'].status], ['active', 'ACTIVE'], '再開');
  r = await call('/paypal/revise', { planKey: 'total_year' });
  eq((await r.json()).approve, 'https://www.sandbox.paypal.com/approve?ba=1', 'プランの変更は PayPal の承認へ');
  r = await call('/paypal/cancel', { reason: '料金が合わない' });
  const j = await r.json();
  eq([r.status, j.status, paypal['I-1'].cancelReason, get('users/u1').subscription.cancelReason], [200, 'canceled', '料金が合わない', '料金が合わない'], '解約');
  eq(get('users/u1').subscription.paidThrough instanceof Date, true, '支払い済みの期間の終わりを残す');
}

/* ---------- 6. 毎日の仕事 ---------- */
{
  const now = Date.now();
  db['users/u3'] = toFields({ email: 'u3@example.com', subscription: { id: 'I-3', status: 'trialing', planName: '総合(月払い)', amount: '月4,980円', trialEnd: new Date(now + 3 * DAY - 3600e3), reminderSent: false } });
  db['users/u4'] = toFields({ email: 'u4@example.com', subscription: { id: 'I-4', status: 'trialing', trialEnd: new Date(now + 10 * DAY) } });
  paypal['I-5'] = { id: 'I-5', status: 'SUSPENDED', plan_id: 'P-SM', custom_id: 'u5', start_time: new Date(now - 60 * DAY).toISOString(), billing_info: { next_billing_time: new Date(now + DAY).toISOString(), last_payment: { amount: { value: '4980' } } } };
  db['users/u5'] = toFields({ email: 'u5@example.com', subscription: { id: 'I-5', status: 'paused', pausedByUser: true, resumeAt: new Date(now - 1000) } });
  db['users/u6'] = toFields({ email: 'u6@example.com', subscription: { id: 'I-6', status: 'canceled', retainUntil: new Date(now - DAY) } });
  db['users/u6/ledger/r1'] = toFields({ updatedAt: 1 }); db['users/u6/ledger/r2'] = toFields({ updatedAt: 2 });
  db['users/u7'] = toFields({ subscription: { id: 'I-7', status: 'canceled', retainUntil: new Date(now + 300 * DAY) } });
  db['users/u7/ledger/r1'] = toFields({ updatedAt: 1 });
  const done = await daily(env, now);
  eq(done, { reminders: 1, resumed: 1, purged: 1 }, '毎日の仕事の件数');
  eq([mails.length, mails[0].to, /無料期間は/.test(mails[0].subject), get('users/u3').subscription.reminderSent], [1, 'u3@example.com', true, true], '3日前のメールは1回だけ');
  eq((await daily(env, now)).reminders, 0, '2回目は送らない');
  eq([get('users/u5').subscription.status, paypal['I-5'].status], ['active', 'ACTIVE'], '一時停止の自動再開');
  eq([Object.keys(db).filter(k => k.startsWith('users/u6/ledger/')).length, !!get('users/u6').subscription.purgedAt, Object.keys(db).filter(k => k.startsWith('users/u7/ledger/')).length], [0, true, 1], '3年たった台帳だけ消す');
}

/* ---------- 7. お知らせメールの文面 ---------- */
{
  const m = trialReminderMail({ planName: '総合(月払い)', amount: '月4,980円', trialEnd: new Date('2026-11-10T00:00:00+09:00') }, 'a@example.com', env);
  eq(m.subject, '【せどり 利益チェック】無料期間は2026年11月10日(火)までです', '件名');
  eq([/2026年11月9日\(月\)までに解約/.test(m.body), /4,980円\(税込\)/.test(m.body), /毎月同じ日/.test(m.body), /mypage\/#cancel/.test(m.body), /自動支払いを管理/.test(m.body)], [true, true, true, true, true], '本文(期限・金額・解約の方法)');
}

/* ================================================================== Stripe */
const sec = ms => Math.floor(ms / 1000);
const sign = (payload, t = sec(Date.now()), secret = 'whsec_fake') => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')}`;
const stripeHook = (ev, sig) => { const text = JSON.stringify(ev); return W.fetch(new Request('https://w.example/stripe/webhook', { method: 'POST', body: text, headers: sig === null ? {} : { 'Stripe-Signature': sig || sign(text) } }), env); };
let evN = 0;
const ev = (type, object, id) => ({ id: id || 'evt_' + (++evN), type, data: { object } });
function mkSub(id, uid, price, status, extra = {}) {
  const now = Date.now();
  stripeSubs[id] = Object.assign({
    id, object: 'subscription', status, customer: 'cus_' + uid, metadata: { uid, planKey: '' }, cancel_at_period_end: false, cancel_at: null, canceled_at: null, ended_at: null, pause_collection: null,
    trial_end: status === 'trialing' ? sec(now + 14 * DAY) : null,
    items: { data: [{ id: 'si_' + id, price: { id: price }, current_period_end: sec(now + (status === 'trialing' ? 14 : 20) * DAY) }] }
  }, extra);
  return stripeSubs[id];
}
const tokFor = async uid => { const t = Math.floor(Date.now() / 1000); return idToken({ aud: 'demo-zw', iss: 'https://securetoken.google.com/demo-zw', sub: uid, email: uid + '@example.com', iat: t, exp: t + 3600 }); };
const scall = async (uid, path, body) => W.fetch(new Request('https://w.example' + path, { method: 'POST', body: JSON.stringify(body || {}), headers: { Authorization: 'Bearer ' + (uid ? await tokFor(uid) : 'x.y.z'), Origin: 'https://hiro0530.github.io', 'Content-Type': 'application/json' } }), env);

/* ---------- 8. Stripe の署名 ---------- */
{
  const body = JSON.stringify({ id: 'evt_x', type: 'invoice.paid' }), now = Date.now();
  eq(await verifyStripeSignature(body, sign(body), 'whsec_fake'), true, '正しい署名');
  eq(await verifyStripeSignature(body, sign(body, sec(now), 'whsec_other'), 'whsec_fake'), false, '別のシークレットの署名');
  eq(await verifyStripeSignature(body + ' ', sign(body), 'whsec_fake'), false, '本文の書き換え');
  eq(await verifyStripeSignature(body, sign(body, sec(now - 301e3)), 'whsec_fake', now), false, '5分より古い');
  eq(await verifyStripeSignature(body, sign(body, sec(now + 301e3)), 'whsec_fake', now), false, '5分より先の時刻');
  eq(await verifyStripeSignature(body, sign(body, sec(now - 240e3)), 'whsec_fake', now), true, '4分前は受ける');
  const t = sec(now), good = sign(body, t).split(',')[1];
  eq(await verifyStripeSignature(body, `t=${t},v1=${'0'.repeat(64)},${good},v0=abc`, 'whsec_fake'), true, 'v1 が複数(鍵の切り替え中)');
  eq(await verifyStripeSignature(body, `t=${t}`, 'whsec_fake'), false, 'v1 が無い');
  eq(await verifyStripeSignature(body, 'garbage', 'whsec_fake'), false, '形が違う');
  eq(await verifyStripeSignature(body, sign(body), ''), false, 'シークレットが未設定なら受けない');
  let r = await stripeHook(ev('invoice.paid', {}), sign('{}'));
  eq(r.status, 400, 'Webhook: 署名が合わなければ 400');
  r = await stripeHook(ev('invoice.paid', {}), null);
  eq(r.status, 400, 'Webhook: 署名の見出しが無ければ 400');
  eq(formEncode({ a: 1, b: { c: 'x y', d: [{ e: 2 }] }, f: '', g: null }), 'a=1&b%5Bc%5D=x%20y&b%5Bd%5D%5B0%5D%5Be%5D=2&f=', 'Stripe に送る形');
  eq(Object.keys(stripePrices(env)).sort(), ['business_month', 'founder_month', 'founder_year', 'light_month', 'total_month', 'total_year'], '空欄の価格IDは使わない');
}

/* ---------- 9. Stripe の申し込み(Checkout) ---------- */
{
  let r = await W.fetch(new Request('https://w.example/stripe/plans', { headers: { Origin: 'https://hiro0530.github.io' } }), env);
  let j = await r.json();
  eq([r.status, j.ready.includes('total_month'), j.ready.includes('light_year'), r.headers.get('Access-Control-Allow-Origin')], [200, true, false, 'https://hiro0530.github.io'], 'カードで申し込めるプランの一覧');
  r = await W.fetch(new Request('https://w.example/stripe/plans'), { ...env, STRIPE_SECRET_KEY: '' });
  eq((await r.json()).ready, [], '秘密の鍵が無ければ全部「準備中」');

  r = await scall('u10', '/stripe/checkout', { planKey: 'total_month' });
  j = await r.json();
  const f = stripeSessions.cs_1.form;
  eq([r.status, j.url, j.trial], [200, 'https://checkout.stripe.com/c/pay/cs_1', true], '申し込み画面の URL を返す');
  eq([f.mode, f['line_items[0][price]'], f['line_items[0][quantity]'], f.client_reference_id, f.locale, f['payment_method_types[0]'], f['subscription_data[trial_period_days]'], f['subscription_data[metadata][uid]'], f.customer_email],
    ['subscription', 'price_tm', '1', 'u10', 'ja', 'card', '14', 'u10', 'u10@example.com'], 'Checkout に渡す中身(月額・本人・日本語・カード・14日無料)');
  eq([f.success_url, f.cancel_url], ['https://zeroichiworks.net/sedori/mypage/?subscribed=1&session_id={CHECKOUT_SESSION_ID}', 'https://zeroichiworks.net/sedori/plans/?plan=total_month#pl-step2'], '戻り先はサイトの中');
  eq([/14日間は無料/.test(f['custom_text[submit][message]']), /4,980円\(税込\)/.test(f['custom_text[submit][message]']), /解約はマイページ/.test(f['custom_text[submit][message]'])], [true, true, true], 'Stripe の画面にも無料期間・金額・解約を書く');
  r = await scall('u10', '/stripe/checkout', { planKey: 'light_year' });
  eq(r.status, 400, '価格IDの無いプランは断る');
  r = await scall('u10', '/stripe/checkout', { planKey: 'founder_month' });
  eq([r.status, (await r.json()).code], [409, 'founder-closed'], '先着100名が埋まっていれば断る(料金ページが総合に切り替える)');
  r = await scall('u1', '/stripe/checkout', { planKey: 'total_month' });
  eq([r.status, (await r.json()).code], [409, 'has-sub'], '解約済みでも期間の終わりまでは二重に申し込ませない');
  r = await scall(null, '/stripe/checkout', { planKey: 'total_month' });
  eq(r.status, 401, 'ログインしていなければ断る');
  // 2回目のお申し込みは無料期間なし・同じ Stripe の顧客を使う
  db['users/u19'] = toFields({ email: 'u19@example.com', subscription: { id: 'sub_old', provider: 'stripe', customerId: 'cus_u19', status: 'canceled', paidThrough: new Date(Date.now() - DAY) } });
  r = await scall('u19', '/stripe/checkout', { planKey: 'total_month' });
  const f2 = stripeSessions.cs_2.form;
  eq([r.status, (await r.json()).trial, f2['subscription_data[trial_period_days]'], f2.customer, f2.customer_email, /今日、1回目/.test(f2['custom_text[submit][message]'])], [200, false, undefined, 'cus_u19', undefined, true], '2回目は無料期間なし・同じ顧客');
}

/* ---------- 10. Stripe の Webhook ---------- */
{
  delete db['public/founders'];  // 先着の数え直し(ここからは Stripe の分)
  mkSub('sub_10', 'u10', 'price_fm', 'trialing');
  let r = await stripeHook(ev('checkout.session.completed', { object: 'checkout.session', mode: 'subscription', subscription: 'sub_10', client_reference_id: 'u10', customer_details: { email: 'card10@example.com' } }, 'evt_cs10'));
  let s = get('users/u10').subscription;
  eq([r.status, (await r.json()).status], [200, 'trialing'], '申し込みの完了 → 無料期間');
  eq([s.provider, s.status, s.planKey, s.planName, s.amount, s.founder, s.customerId, s.payerEmail, s.trialEnd instanceof Date, get('stripeSubs/sub_10').uid], ['stripe', 'trialing', 'founder_month', '総合 先着100名の価格(月払い)', '月3,980円', true, 'cus_u10', 'card10@example.com', true, 'u10'], 'Firestore に書く中身');
  eq(get('public/founders'), null, '無料期間中は先着に数えない');
  const before = stripeSent.length;
  r = await stripeHook(ev('checkout.session.completed', { mode: 'subscription', subscription: 'sub_10', client_reference_id: 'u10' }, 'evt_cs10'));
  eq([(await r.json()).duplicate, stripeSent.length], [true, before], '同じ出来事の2回目は何もしない');
  // 無料期間が終わり、1回目の請求が通った(新しい API の形: invoice.parent.subscription_details)
  stripeSubs.sub_10.status = 'active'; stripeSubs.sub_10.trial_end = sec(Date.now() - 1000);
  r = await stripeHook(ev('invoice.paid', { object: 'invoice', amount_paid: 3980, parent: { subscription_details: { subscription: 'sub_10', metadata: { uid: 'u10' } } } }));
  eq([get('users/u10').subscription.status, get('public/founders').taken, get('public/founders').open, get('stripeSubs/sub_10').counted], ['active', 1, true, true], '1回目のお支払いで先着に数える');
  await stripeHook(ev('invoice.paid', { object: 'invoice', amount_paid: 3980, subscription: 'sub_10' }));
  await stripeHook(ev('customer.subscription.updated', stripeSubs.sub_10));
  eq(get('public/founders').taken, 1, '2回目の請求・更新では数えない');
  // 同じ契約の通知が同時に2つ来ても1回だけ数える
  mkSub('sub_11', 'u11', 'price_fm', 'active');
  lag = true;
  await Promise.all([stripeHook(ev('invoice.paid', { amount_paid: 3980, subscription: 'sub_11' })), stripeHook(ev('customer.subscription.updated', stripeSubs.sub_11))]);
  lag = false;
  eq([get('public/founders').taken, get('public/founders').open], [2, false], '同時の通知でも1回だけ。上限で受付を閉じる');
  // 0円の請求(無料期間の始まり)では数えない
  mkSub('sub_15', 'u15', 'price_tm', 'trialing');
  await stripeHook(ev('invoice.paid', { amount_paid: 0, subscription: 'sub_15' }));
  eq([get('users/u15').subscription.status, get('users/u15').subscription.founder], ['trialing', false], '0円の請求は無料期間のまま');
  // 支払いの失敗 → 届いた順が前後しても、Stripe の今の状態で書く
  stripeSubs.sub_15.status = 'past_due'; stripeSubs.sub_15.trial_end = sec(Date.now() - DAY);
  await stripeHook(ev('invoice.payment_failed', { subscription: 'sub_15', amount_due: 4980 }));
  eq(get('users/u15').subscription.status, 'past_due', '支払いの失敗');
  await stripeHook(ev('customer.subscription.updated', { id: 'sub_15', status: 'trialing', metadata: { uid: 'u15' } }));
  eq(get('users/u15').subscription.status, 'past_due', '古い中身の通知が後から届いても、いまの状態のまま');
  stripeSubs.sub_15.status = 'unpaid';
  await stripeHook(ev('customer.subscription.updated', { id: 'sub_15' }));
  eq(get('users/u15').subscription.status, 'suspended', '請求をあきらめた(unpaid)は止める');
  stripeSubs.sub_15.status = 'canceled'; stripeSubs.sub_15.ended_at = sec(Date.now()); stripeSubs.sub_15.canceled_at = sec(Date.now());
  await stripeHook(ev('customer.subscription.deleted', { id: 'sub_15' }));
  s = get('users/u15').subscription;
  eq([s.status, s.paidThrough instanceof Date, s.retainUntil.getUTCFullYear() - new Date().getUTCFullYear(), s.nextBillingAt], ['canceled', true, 3, null], '契約の終わり: 3年保管');
  // 関係ない出来事・単発の支払い・Stripe が落ちている時
  r = await stripeHook(ev('charge.refunded', {}));
  eq((await r.json()).ignored, 'charge.refunded', '関係ない出来事は無視');
  r = await stripeHook(ev('checkout.session.completed', { mode: 'payment', client_reference_id: 'u10' }));
  eq((await r.json()).ignored, 'not-subscription', '単発の支払いは無視');
  stripeDown = true;
  r = await stripeHook(ev('invoice.paid', { amount_paid: 3980, subscription: 'sub_10' }, 'evt_down'));
  stripeDown = false;
  eq([r.status, get('stripeEvents/evt_down')], [500, null], 'Stripe が答えなければ 500(Stripe が送り直す)・処理済みにしない');
  r = await stripeHook(ev('invoice.paid', { amount_paid: 3980, subscription: 'sub_10' }, 'evt_down'));
  eq([r.status, get('stripeEvents/evt_down').done], [200, true], '送り直しで処理する');
}

/* ---------- 11. Stripe の解約・一時停止・プラン変更・カードの変更 ---------- */
{
  mkSub('sub_12', 'u12', 'price_tm', 'active');
  await stripeHook(ev('customer.subscription.updated', stripeSubs.sub_12));
  const end = stripeSubs.sub_12.items.data[0].current_period_end * 1000;
  let r = await scall('u12', '/stripe/cancel', { reason: '料金が合わない' });
  let j = await r.json(), s = get('users/u12').subscription;
  eq([r.status, j.status, stripeSubs.sub_12.cancel_at_period_end, stripeSubs.sub_12.metadata.cancel_reason, stripeSubs.sub_12.status], [200, 'canceled', true, '料金が合わない', 'active'], '解約: 期間の終わりで止める(すぐには消さない)');
  eq([s.status, s.paidThrough.getTime(), s.cancelReason, s.nextBillingAt], ['canceled', end, '料金が合わない', null], '支払い済みの期間の終わりまで使える・次の請求なし');
  eq(stripeSent.filter(x => x.path === '/subscriptions/sub_12' && x.method === 'DELETE').length, 0, '日割りの返金をする即時解約はしない');
  r = await scall('u12', '/stripe/cancel', {});
  eq(r.status, 409, '解約の2回目は断る');
  mkSub('sub_13', 'u13', 'price_bm', 'trialing');
  await stripeHook(ev('customer.subscription.updated', stripeSubs.sub_13));
  r = await scall('u13', '/stripe/cancel', {});
  s = get('users/u13').subscription;
  eq([r.status, s.status, s.paidThrough.getTime(), s.cancelReason], [200, 'canceled', stripeSubs.sub_13.trial_end * 1000, '利用者による解約'], '無料期間中の解約: 無料期間の終わりまで使え、請求しない');
  r = await scall('u13', '/paypal/cancel', {});
  eq(r.status, 400, 'カードの契約に PayPal の解約は使わない');
  r = await scall('u2', '/stripe/cancel', {});
  eq(r.status, 404, 'PayPal の契約に Stripe の解約は使わない');

  mkSub('sub_14', 'u14', 'price_tm', 'active');
  await stripeHook(ev('customer.subscription.updated', stripeSubs.sub_14));
  r = await scall('u14', '/stripe/pause');
  s = get('users/u14').subscription;
  eq([r.status, stripeSubs.sub_14.pause_collection.behavior, s.status, s.resumeAt instanceof Date], [200, 'void', 'paused', true], '1か月止める(その間の請求は無効)');
  r = await scall('u14', '/stripe/resume');
  eq([(await r.json()).status, stripeSubs.sub_14.pause_collection], ['active', null], '再開');
  r = await scall('u14', '/stripe/revise', { planKey: 'total_year' });
  s = get('users/u14').subscription;
  eq([r.status, stripeSubs.sub_14.items.data[0].price.id, s.planKey, s.amount], [200, 'price_ty', 'total_year', '年49,800円'], 'プランの変更(年払い)');
  eq(stripeSent.filter(x => x.form['proration_behavior']).map(x => x.form['proration_behavior']), ['create_prorations'], '差額は日割り');
  r = await scall('u14', '/stripe/revise', { planKey: 'founder_month' });
  eq(r.status, 400, '先着の価格には後から変えられない');
  r = await scall('u14', '/stripe/portal', { flow: 'card' });
  j = await r.json();
  const pf = stripeSent[stripeSent.length - 1].form;
  eq([j.url, pf.customer, pf['flow_data[type]'], pf.locale], ['https://billing.stripe.com/p/session/x', 'cus_u14', 'payment_method_update', 'ja'], 'カードの変更は Stripe の画面へ');
  stripeSessions.cs_9 = { id: 'cs_9', client_reference_id: 'u14', subscription: 'sub_14', customer_details: { email: 'x@example.com' } };
  r = await scall('u14', '/stripe/link', { sessionId: 'cs_9' });
  eq([r.status, (await r.json()).status], [200, 'active'], '申し込み直後の反映');
  r = await scall('u10', '/stripe/link', { sessionId: 'cs_9' });
  eq(r.status, 403, '他人のお申し込みは結びつけない');
}

/* ---------- 11b. 年払い: 無料期間なし・その場で決済、1回目のお支払いから30日以内の解約は全額返金(2026-10-30) ---------- */
{
  eq([YEAR_REFUND_DAYS, /無料期間なし/.test(YEAR_TEXT), /30日以内に解約すれば、全額を返金します/.test(YEAR_TEXT)], [30, true, true], '年払いの決まりの文');
  // 初めてのお申し込みでも、年払いには無料期間を付けない
  const cs = Object.keys(stripeSessions).length;
  let r = await scall('u30', '/stripe/checkout', { planKey: 'total_year' });
  let j = await r.json();
  const f = stripeSessions['cs_' + (cs + 1)].form;
  eq([r.status, j.trial, f['subscription_data[trial_period_days]'], f['subscription_data[metadata][refundDays]'], f['subscription_data[metadata][planKey]'], f['line_items[0][price]']],
    [200, false, undefined, '30', 'total_year', 'price_ty'], '年払い: 初めてでも無料期間なし・返金の印つき');
  const note = f['custom_text[submit][message]'];
  eq([note.startsWith(YEAR_TEXT), /今日49,800円\(税込\)を請求/.test(note), /毎年同じ日/.test(note), /14日間は無料/.test(note)], [true, true, true, false], 'Stripe の画面: 年払いの決まりの文と今日の請求');
  r = await scall('u31', '/stripe/checkout', { planKey: 'total_month' });
  j = await r.json();
  const fm = stripeSessions['cs_' + (cs + 2)].form;
  eq([j.trial, fm['subscription_data[trial_period_days]'], fm['subscription_data[metadata][refundDays]']], [true, '14', undefined], '月払いは今までどおり14日無料・返金の印なし');
  r = await scall('u32', '/stripe/checkout', { planKey: 'founder_year' });
  eq((await r.json()).code, 'founder-closed', '先着の年払いも、受付が終わっていれば断る(前のテストで上限)');

  // 返金の期限の計算
  const now = Date.now();
  eq(refundDeadline({ start_date: sec(now), metadata: { refundDays: '30' } }, 'total_year'), sec(now) * 1000 + 30 * DAY, '期限は開始から30日');
  eq(refundDeadline({ start_date: sec(now), metadata: {} }, 'total_year'), null, '月払いから変えた年払い(印なし)は対象外');
  eq(refundDeadline({ start_date: sec(now), metadata: { refundDays: '30' } }, 'total_month'), null, '月払いは対象外');

  // 10日目の解約 → 全額返金・その場で終わる(古い API: invoice.payment_intent)
  mkSub('sub_30', 'u30', 'price_ty', 'active', { start_date: sec(now - 10 * DAY), metadata: { uid: 'u30', planKey: 'total_year', refundDays: '30' } });
  stripeInvoices.sub_30 = [{ id: 'in_30', amount_paid: 49800, created: sec(now - 10 * DAY), payment_intent: 'pi_30' }];
  await stripeHook(ev('customer.subscription.updated', stripeSubs.sub_30));
  let s = get('users/u30').subscription;
  eq([s.status, s.planKey, s.refundUntil instanceof Date, Math.round((s.refundUntil.getTime() - now) / DAY)], ['active', 'total_year', true, 20], 'マイページ用: 返金の期限(あと20日)');
  r = await scall('u30', '/stripe/cancel', { reason: '使う機会が減った' });
  j = await r.json(); s = get('users/u30').subscription;
  const rf = stripeRefunds[stripeRefunds.length - 1], sent = stripeSent.filter(x => x.path === '/subscriptions/sub_30');
  eq([r.status, j.refunded, j.amount, j.status], [200, true, 49800, 'canceled'], '30日以内: 全額返金して解約');
  eq([rf.payment_intent, rf.reason, rf['metadata[rule]'], stripeSent.find(x => x.path === '/refunds').idem], ['pi_30', 'requested_by_customer', 'year-30days', 'zw-year-refund-sub_30'], '返金は1回目の支払いを全額・二重に返さない鍵つき');
  eq([sent.some(x => x.method === 'DELETE'), stripeSubs.sub_30.cancel_at_period_end, stripeSubs.sub_30.metadata.refunded], [true, false, '1'], 'その場で契約を終える(期間の終わりまで待たない)');
  eq([s.status, s.refunded, s.refundUntil, s.nextBillingAt, Math.abs(s.paidThrough.getTime() - now) < 60e3, s.cancelReason], ['canceled', true, null, null, true, '使う機会が減った'], 'アプリの状態: 返金済み・今日で終わり・台帳は保管');
  const refundsBefore = stripeRefunds.length;
  r = await scall('u30', '/stripe/cancel', {});
  eq([r.status, stripeRefunds.length], [409, refundsBefore], '2回目の解約は断る・二重に返金しない');

  // 新しい API(invoice_payments)でも支払いを見つける
  mkSub('sub_33', 'u33', 'price_ty', 'active', { start_date: sec(now - 29 * DAY), metadata: { uid: 'u33', planKey: 'total_year', refundDays: '30' } });
  stripeInvoices.sub_33 = [{ id: 'in_33', amount_paid: 49800, created: sec(now - 29 * DAY) }];
  stripeInvPays.in_33 = [{ payment: { type: 'payment_intent', payment_intent: 'pi_33' } }];
  await stripeHook(ev('customer.subscription.updated', stripeSubs.sub_33));
  r = await scall('u33', '/stripe/cancel', {});
  eq([(await r.json()).refunded, stripeRefunds[stripeRefunds.length - 1].payment_intent, stripeSubs.sub_33.status], [true, 'pi_33', 'canceled'], '29日目・新しい API の形でも返金');

  // 31日目 → 返金なし。期間の終わりで終える(今までの解約と同じ)
  mkSub('sub_34', 'u34', 'price_ty', 'active', { start_date: sec(now - 31 * DAY), metadata: { uid: 'u34', planKey: 'total_year', refundDays: '30' } });
  stripeInvoices.sub_34 = [{ id: 'in_34', amount_paid: 49800, created: sec(now - 31 * DAY), payment_intent: 'pi_34' }];
  await stripeHook(ev('customer.subscription.updated', stripeSubs.sub_34));
  eq(get('users/u34').subscription.refundUntil, null, '31日目: 返金の期限なし');
  const nr = stripeRefunds.length;
  r = await scall('u34', '/stripe/cancel', {});
  j = await r.json();
  eq([r.status, j.refunded, stripeRefunds.length, stripeSubs.sub_34.cancel_at_period_end, stripeSubs.sub_34.status], [200, undefined, nr, true, 'active'], '31日目: 返金なし・期間の終わりで止める');

  // 月払いから変えた年払い(印なし)は、30日以内でも返金しない
  mkSub('sub_35', 'u35', 'price_ty', 'active', { start_date: sec(now - 3 * DAY), metadata: { uid: 'u35', planKey: 'total_year' } });
  await stripeHook(ev('customer.subscription.updated', stripeSubs.sub_35));
  r = await scall('u35', '/stripe/cancel', {});
  eq([r.status, stripeRefunds.length, stripeSubs.sub_35.cancel_at_period_end], [200, nr, true], '月払いから変えた年払いは返金の対象外');

  // 返金が通らなければ、解約もしない(お金だけ取って止めない)
  mkSub('sub_36', 'u36', 'price_ty', 'active', { start_date: sec(now - 2 * DAY), metadata: { uid: 'u36', planKey: 'total_year', refundDays: '30' } });
  stripeInvoices.sub_36 = [{ id: 'in_36', amount_paid: 49800, created: sec(now - 2 * DAY), charge: 'ch_36' }];
  await stripeHook(ev('customer.subscription.updated', stripeSubs.sub_36));
  refundFail = true;
  r = await scall('u36', '/stripe/cancel', {});
  refundFail = false;
  eq([r.status, stripeSubs.sub_36.status, stripeSubs.sub_36.cancel_at_period_end, get('users/u36').subscription.status], [502, 'active', false, 'active'], '返金が失敗したら契約はそのまま');
  stripeInvoices.sub_36 = [];
  r = await scall('u36', '/stripe/cancel', {});
  eq([r.status, (await r.json()).code, stripeSubs.sub_36.status], [502, 'refund-not-found', 'active'], '支払いが見つからなければ解約せず、メールでの返金を案内');
  stripeInvoices.sub_36 = [{ id: 'in_36', amount_paid: 49800, created: sec(now - 2 * DAY), charge: 'ch_36' }];
  r = await scall('u36', '/stripe/cancel', {});
  eq([(await r.json()).refunded, stripeRefunds[stripeRefunds.length - 1].charge], [true, 'ch_36'], '古い API の charge でも返金');
}

/* ---------- 12. Stripe の状態の読み替えと毎日の仕事 ---------- */
{
  const now = Date.now();
  const base = { id: 'sub_n', status: 'active', customer: 'cus_n', metadata: {}, items: { data: [{ id: 'si', price: { id: 'price_lm' }, current_period_end: sec(now + 5 * DAY) }] } };
  let s = normalizeStripe(base, {}, env, now);
  eq([s.status, s.planKey, s.amount, s.nextBillingAt.getTime()], ['active', 'light_month', '月2,980円', sec(now + 5 * DAY) * 1000], '新しい API の形(期間の終わりが items の中)');
  s = normalizeStripe({ ...base, items: { data: [{ id: 'si', price: { id: 'price_lm' } }] }, current_period_end: sec(now + 6 * DAY) }, {}, env, now);
  eq(s.nextBillingAt.getTime(), sec(now + 6 * DAY) * 1000, '古い API の形');
  eq(normalizeStripe({ ...base, status: 'incomplete' }, {}, env, now).status, 'incomplete', '最初の支払いの途中');
  eq(normalizeStripe({ ...base, status: 'incomplete_expired' }, {}, env, now).status, 'expired', '最初の支払いが通らずに終わった');
  s = normalizeStripe({ ...base, status: 'trialing', trial_end: sec(now + 3 * DAY), cancel_at_period_end: true }, {}, env, now);
  eq([s.status, s.paidThrough.getTime()], ['canceled', sec(now + 5 * DAY) * 1000], '期間末の解約が決まった契約');
  eq(normalizeStripe({ ...base, items: { data: [{ id: 'si', price: { id: 'price_unknown' } }] } }, { planKey: 'business_month', planName: '業務(月払い)' }, env, now).planKey, 'business_month', '知らない価格IDなら前の値を残す');

  db['users/u16'] = toFields({ email: 'u16@example.com', subscription: { id: 'sub_16', provider: 'stripe', status: 'trialing', planName: '総合(月払い)', amount: '月4,980円', trialEnd: new Date(now + 3 * DAY - 3600e3), reminderSent: false } });
  mkSub('sub_17', 'u17', 'price_tm', 'active', { pause_collection: { behavior: 'void', resumes_at: sec(now - 1000) } });
  await stripeHook(ev('customer.subscription.updated', stripeSubs.sub_17));
  eq(get('users/u17').subscription.status, 'paused', '一時停止中');
  const sent = mails.length;
  await daily(env, now);
  const m = mails.slice(sent).find(x => x.to === 'u16@example.com');
  eq([!!m, /ご登録のカード/.test(m.body), /自動支払いを管理/.test(m.body), /mypage\/#cancel/.test(m.body)], [true, true, false, true], 'カードの方への3日前のメール(PayPal の手順は書かない)');
  eq([stripeSubs.sub_17.pause_collection, get('users/u17').subscription.status], [null, 'active'], '一時停止の期間が過ぎたら再開');
}

console.log('OK ' + n + '件');
