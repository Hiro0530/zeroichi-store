// Worker の検算(PayPal・Firestore・Google をすべて偽物に置き換える)。実行: node test/test_worker.js
import assert from 'node:assert';
import W, { normalize, verifyIdToken, toFields, fromFields, trialReminderMail, daily, _resetCaches } from '../src/index.js';

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
  PLANS: JSON.stringify({ 'P-SM': { key: 'total_month', name: '総合(月払い)', amount: '月4,980円' }, 'P-SY': { key: 'total_year', name: '総合(年払い)', amount: '年49,800円' }, 'P-FM': { key: 'founder_month', name: '総合 先着100名の価格(月払い)', amount: '月3,980円', founder: true }, 'P-LM': { key: 'light_month', name: 'ライト(月払い)', amount: '月2,980円' } }),
};

/* ---------- 偽物の外部(Firestore・PayPal・Google) ---------- */
const db = {};         // 'users/u1' → fields
const paypal = {};     // subId → subscription
const calls = [];
let verifyResult = 'SUCCESS';
const mails = [];
globalThis.fetch = async (url, init = {}) => {
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
    if (rest.startsWith(':commit')) { JSON.parse(body).writes.forEach(w => { delete db[w.delete.split('/documents/')[1]]; }); return res({}); }
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
  eq([get('public/founders').taken, get('public/founders').open], [1, true], '先着の人数を数える');
  r = await hook({ event_type: 'BILLING.SUBSCRIPTION.UPDATED', resource: { id: 'I-1' } });
  eq(get('public/founders').taken, 1, '同じ契約は2回数えない');
  paypal['I-2'] = { ...paypal['I-1'], id: 'I-2', custom_id: 'u2' };
  await hook({ event_type: 'BILLING.SUBSCRIPTION.ACTIVATED', resource: { id: 'I-2' } });
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

console.log('OK ' + n + '件');
