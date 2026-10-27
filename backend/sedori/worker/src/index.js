/**
 * せどり 利益チェック — 契約の受け口(Cloudflare Worker・無料枠)
 *
 * 役目
 *  1. PayPal の Webhook を受け、署名を PayPal に確かめてから、契約の状態を Firestore の users/{uid}.subscription に書く。
 *     受ける出来事: BILLING.SUBSCRIPTION.ACTIVATED / UPDATED / RE-ACTIVATED / CANCELLED / SUSPENDED / EXPIRED / PAYMENT.FAILED、PAYMENT.SALE.COMPLETED
 *     どの出来事でも PayPal から契約を読み直して書くので、同じ通知が2回来ても結果は同じ。
 *  2. ログイン中の利用者からの頼み(Firebase の ID トークンで本人を確かめる)
 *     POST /paypal/link    申し込み直後の反映 { subscriptionID }
 *     POST /paypal/pause   1か月の一時停止
 *     POST /paypal/resume  再開
 *     POST /paypal/revise  プランの変更(月払い⇔年払い・ライト⇔総合⇔業務)。PayPal の承認画面の URL を返す
 *     POST /paypal/cancel  解約 { reason }
 *  3. 毎日1回(cron): 無料期間の終了3日前のメール、一時停止の自動再開、解約から3年たった台帳の削除
 *
 * 秘密の値は wrangler secret で入れる(README)。ここには書かない。
 */

const DAY = 864e5;
const RETAIN_YEARS = 3;

/* ------------------------------------------------------------------ 小さな道具 */
const enc = new TextEncoder();
function b64url(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
}
function addMonths(ms, n) { const d = new Date(ms); d.setUTCMonth(d.getUTCMonth() + n); return d.getTime(); }
function addYears(ms, n) { const d = new Date(ms); d.setUTCFullYear(d.getUTCFullYear() + n); return d.getTime(); }
function toMs(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  const n = Date.parse(v); return isNaN(n) ? null : n;
}
/* サイトの住所の既定値(本番は wrangler.toml の APP_URL・ALLOWED_ORIGIN で決める。独自ドメインに移す時は docs/sedori_app/domain.md) */
const DEFAULT_APP_URL = 'https://hiro0530.github.io/zeroichi-store/sedori/';
const appUrl = (env) => env.APP_URL || DEFAULT_APP_URL;
function plansOf(env) { try { return JSON.parse(env.PLANS || '{}'); } catch { return {}; } }

/* ------------------------------------------------------------------ Firestore(REST・サービスアカウント) */
export function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  return { mapValue: { fields: toFields(v) } };
}
export function toFields(o) { const f = {}; for (const k of Object.keys(o)) if (o[k] !== undefined) f[k] = toValue(o[k]); return f; }
export function fromValue(v) {
  if (!v) return null;
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return new Date(v.timestampValue);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
  if ('mapValue' in v) return fromFields(v.mapValue.fields || {});
  return null;
}
export function fromFields(f) { const o = {}; for (const k of Object.keys(f || {})) o[k] = fromValue(f[k]); return o; }

let gTok = null;
async function importPkcs8(pem) {
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\\n/g, '').replace(/\s+/g, '');
  return crypto.subtle.importKey('pkcs8', b64urlDecode(body.replace(/\+/g, '-').replace(/\//g, '_')), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}
async function googleToken(env) {
  if (gTok && gTok.exp > Date.now() + 60000) return gTok.token;
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claim = b64url(enc.encode(JSON.stringify({ iss: env.FIREBASE_SA_EMAIL, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })));
  const key = await importPkcs8(env.FIREBASE_SA_KEY);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(head + '.' + claim));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + head + '.' + claim + '.' + b64url(sig)
  });
  if (!r.ok) throw new Error('google token ' + r.status);
  const j = await r.json();
  gTok = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return gTok.token;
}
function fsBase(env) { return `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`; }
async function fs(env, method, path, body) {
  const tok = await googleToken(env);
  const r = await fetch(fsBase(env) + path, { method, headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 404 && method === 'GET') return null;
  if (!r.ok) throw new Error(`firestore ${method} ${path} ${r.status}`);
  return r.status === 204 ? {} : r.json();
}
export async function getDoc(env, path) {
  const d = await fs(env, 'GET', '/' + path);
  return d && d.fields ? fromFields(d.fields) : (d ? {} : null);
}
/** 指定した項目だけ書き換える(無ければ作る) */
export async function patchDoc(env, path, data) {
  const mask = Object.keys(data).map(k => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&');
  return fs(env, 'PATCH', '/' + path + '?' + mask, { fields: toFields(data) });
}
async function runQuery(env, where) {
  const r = await fs(env, 'POST', ':runQuery', { structuredQuery: { from: [{ collectionId: 'users' }], where } });
  return (r || []).filter(x => x.document).map(x => ({ uid: x.document.name.split('/').pop(), data: fromFields(x.document.fields) }));
}

/* ------------------------------------------------------------------ Firebase の ID トークン(本人の確認) */
let jwks = null;
async function googleJwks() {
  if (jwks && jwks.exp > Date.now()) return jwks.keys;
  const r = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  if (!r.ok) throw new Error('jwks ' + r.status);
  const j = await r.json();
  jwks = { keys: j.keys || [], exp: Date.now() + 3600 * 1000 };
  return jwks.keys;
}
export function _resetCaches() { jwks = null; gTok = null; ppTok = null; }
/** Firebase の ID トークンを確かめて uid を返す(だめなら例外) */
export async function verifyIdToken(token, env, now = Date.now()) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('token');
  const head = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0])));
  const p = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
  if (head.alg !== 'RS256') throw new Error('alg');
  const jwk = (await googleJwks()).find(k => k.kid === head.kid);
  if (!jwk) throw new Error('kid');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlDecode(parts[2]), enc.encode(parts[0] + '.' + parts[1]));
  if (!ok) throw new Error('sig');
  const t = Math.floor(now / 1000);
  if (p.aud !== env.FIREBASE_PROJECT_ID || p.iss !== 'https://securetoken.google.com/' + env.FIREBASE_PROJECT_ID) throw new Error('aud');
  if (!(p.exp > t) || !(p.iat <= t + 300) || !p.sub) throw new Error('exp');
  return { uid: p.sub, email: p.email || '' };
}

/* ------------------------------------------------------------------ PayPal */
let ppTok = null;
function ppBase(env) { return env.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'; }
async function ppToken(env) {
  if (ppTok && ppTok.exp > Date.now() + 60000) return ppTok.token;
  const r = await fetch(ppBase(env) + '/v1/oauth2/token', {
    method: 'POST', headers: { Authorization: 'Basic ' + btoa(env.PAYPAL_CLIENT_ID + ':' + env.PAYPAL_SECRET), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  if (!r.ok) throw new Error('paypal token ' + r.status);
  const j = await r.json();
  ppTok = { token: j.access_token, exp: Date.now() + (j.expires_in || 3000) * 1000 };
  return ppTok.token;
}
async function pp(env, method, path, body) {
  const r = await fetch(ppBase(env) + path, { method, headers: { Authorization: 'Bearer ' + (await ppToken(env)), 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error(`paypal ${method} ${path} ${r.status} ${t.slice(0, 200)}`); }
  return r.status === 204 ? {} : r.json();
}
/** Webhook の署名を PayPal に確かめてもらう */
export async function verifyWebhook(req, bodyText, env) {
  const h = n => req.headers.get(n);
  if (!h('paypal-transmission-id') || !h('paypal-transmission-sig')) return false;
  const r = await pp(env, 'POST', '/v1/notifications/verify-webhook-signature', {
    auth_algo: h('paypal-auth-algo'), cert_url: h('paypal-cert-url'), transmission_id: h('paypal-transmission-id'),
    transmission_sig: h('paypal-transmission-sig'), transmission_time: h('paypal-transmission-time'),
    webhook_id: env.PAYPAL_WEBHOOK_ID, webhook_event: JSON.parse(bodyText)
  });
  return r.verification_status === 'SUCCESS';
}

/**
 * PayPal の契約 → アプリの契約の状態(users/{uid}.subscription)。prev は今までの値。
 * status: trialing / active / past_due / paused / suspended / incomplete / canceled / expired
 */
export function normalize(s, prev, env, now = Date.now()) {
  prev = prev || {};
  const plan = plansOf(env)[s.plan_id] || {};
  const trialDays = Number(env.TRIAL_DAYS || 14);
  const start = toMs(s.start_time) || toMs(s.create_time) || now;
  const trialEnd = start + trialDays * DAY;
  const bi = s.billing_info || {};
  const next = toMs(bi.next_billing_time);
  const failed = Number(bi.failed_payments_count || 0);
  const owing = Number((bi.outstanding_balance || {}).value || 0);
  const paidOnce = !!(bi.last_payment && Number((bi.last_payment.amount || {}).value || 0) > 0);
  let status;
  switch (s.status) {
    case 'ACTIVE': status = failed > 0 || owing > 0 ? 'past_due' : (!paidOnce && now < trialEnd ? 'trialing' : 'active'); break;
    case 'SUSPENDED': status = prev.pausedByUser ? 'paused' : 'suspended'; break;
    case 'CANCELLED': status = 'canceled'; break;
    case 'EXPIRED': status = 'expired'; break;
    default: status = 'incomplete';
  }
  const out = {
    id: s.id, provider: 'paypal', status, planId: s.plan_id || prev.planId || '', planKey: plan.key || prev.planKey || '', planName: plan.name || prev.planName || '総合',
    amount: plan.amount || prev.amount || '', founder: !!(plan.founder || prev.founder),
    trialEnd: new Date(trialEnd), nextBillingAt: next ? new Date(next) : (toMs(prev.nextBillingAt) ? new Date(toMs(prev.nextBillingAt)) : null),
    payerEmail: ((s.subscriber || {}).email_address) || prev.payerEmail || '',
    pausedByUser: status === 'paused', resumeAt: status === 'paused' ? (prev.resumeAt || null) : null,
    reminderSent: !!prev.reminderSent, cancelReason: prev.cancelReason || '', updatedAt: new Date(now)
  };
  if (status === 'canceled' || status === 'expired') {
    // 支払い済みの期間(無料期間中ならその終わり)までは使える。そこから3年間、台帳を保管する
    const through = Math.max(toMs(prev.nextBillingAt) || 0, status === 'canceled' && !paidOnce ? trialEnd : 0, toMs(prev.paidThrough) || 0) || now;
    out.paidThrough = new Date(through);
    out.canceledAt = prev.canceledAt ? new Date(toMs(prev.canceledAt)) : new Date(toMs(s.status_update_time) || now);
    out.retainUntil = new Date(addYears(Math.max(through, now), RETAIN_YEARS));
    out.nextBillingAt = null;
  } else { out.paidThrough = null; out.canceledAt = null; out.retainUntil = null; }
  return out;
}

/** 契約を PayPal から読み直して Firestore に書く。uid が分からなければ書かない */
export async function syncSubscription(env, subId, uidHint) {
  const s = await pp(env, 'GET', '/v1/billing/subscriptions/' + encodeURIComponent(subId));
  let uid = s.custom_id || uidHint || '';
  const link = await getDoc(env, 'paypalSubs/' + subId);
  if (!uid && link) uid = link.uid;
  if (!uid) return { skipped: 'no-uid' };
  const user = (await getDoc(env, 'users/' + uid)) || {};
  const prev = user.subscription && user.subscription.id === subId ? user.subscription : (user.subscription && ['canceled', 'expired'].includes(user.subscription.status) ? {} : (user.subscription || {}));
  const sub = normalize(s, prev, env);
  await patchDoc(env, 'users/' + uid, { subscription: sub });
  await patchDoc(env, 'paypalSubs/' + subId, { uid, status: sub.status, updatedAt: new Date() });
  if (sub.founder && ['trialing', 'active', 'past_due'].includes(sub.status) && !(link && link.counted)) await countFounder(env, subId);
  return { uid, sub };
}

/** 先着100名: お申し込みの順に数え、上限に達したら先着のプランを止める */
async function countFounder(env, subId) {
  const limit = Number(env.FOUNDER_LIMIT || 100);
  const f = (await getDoc(env, 'public/founders')) || {};
  const taken = Number(f.taken || 0) + 1;
  const open = taken < limit;
  await patchDoc(env, 'public/founders', { taken, limit, open, updatedAt: new Date() });
  await patchDoc(env, 'paypalSubs/' + subId, { counted: true });
  if (!open) {
    for (const [id, p] of Object.entries(plansOf(env))) if (p.founder) await pp(env, 'POST', `/v1/billing/plans/${id}/deactivate`).catch(() => {});
  }
}

/* ------------------------------------------------------------------ メール(Apps Script 経由で事業用の Gmail から送る) */
const WD = '日月火水木金土';
function jd(ms) { const d = new Date(ms + 9 * 36e5); return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日(${WD[d.getUTCDay()]})`; }
export function trialReminderMail(sub, email, env) {
  const end = toMs(sub.trialEnd), app = appUrl(env);
  const price = (sub.amount || '月4,980円').replace(/^(月|年)/, '');
  const cyc = /^年/.test(sub.amount || '') ? '毎年' : '毎月';
  return {
    to: email,
    subject: `【せどり 利益チェック】無料期間は${jd(end)}までです`,
    body: `${email} 様

せどり 利益チェックをお使いいただき、ありがとうございます。
無料期間は、${jd(end)}で終わります(無料期間中は、業務のすべての機能を使えます)。

・${jd(end)}から「${sub.planName || '総合'}」で続き、1回目の料金 ${price}(税込)をPayPalでお支払いいただきます。以後は${cyc}同じ日に自動で請求します。
・続ける場合、お手続きは要りません。ライト・総合・業務の切り替えは、マイページの「契約内容」からできます。
・続けない場合は、${jd(end - DAY)}までに解約してください。無料期間中の解約は0円です。

解約の方法(どれでもできます)
1. マイページ → 契約内容 → 「解約について」 → 「解約する」
   ${app}mypage/#cancel
2. PayPal → 右上の歯車(設定) → 支払い → 自動支払いを管理 → ZEROICHI WORKS → キャンセル
3. このメールに「解約」とご返信

解約しても、クラウドの台帳は3年間保管し、マイページから書き出せます。

ZEROICHI WORKS
zeroichi.works.jp@gmail.com
特定商取引法に基づく表記: ${new URL('../tokushoho.html', app).href}
(このメールは、無料期間の終了をお知らせするため、お申し込みのアカウントにお送りしています)
`
  };
}
async function sendMail(env, mail) {
  if (!env.MAIL_HOOK_URL) throw new Error('no-mail-hook');
  const r = await fetch(env.MAIL_HOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: env.MAIL_HOOK_SECRET, ...mail }), redirect: 'follow' });
  const t = await r.text();
  if (!r.ok || !/"ok"\s*:\s*true/.test(t)) throw new Error('mail ' + r.status);
}

/* ------------------------------------------------------------------ 利用者からの頼み */
async function userSub(env, uid) {
  const u = (await getDoc(env, 'users/' + uid)) || {};
  const sub = u.subscription || null;
  if (!sub || !sub.id) { const e = new Error('契約がありません'); e.status = 404; throw e; }
  return { user: u, sub };
}
export async function handleUser(path, body, who, env) {
  const uid = who.uid;
  if (path === '/paypal/link') {
    const s = await pp(env, 'GET', '/v1/billing/subscriptions/' + encodeURIComponent(body.subscriptionID || ''));
    if (s.custom_id !== uid) { const e = new Error('別のアカウントの契約です'); e.status = 403; throw e; }
    const r = await syncSubscription(env, s.id, uid);
    return { status: r.sub.status };
  }
  const { user, sub } = await userSub(env, uid);
  const id = encodeURIComponent(sub.id);
  if (path === '/paypal/pause') {
    if (sub.status !== 'active') { const e = new Error('いまは一時停止できません'); e.status = 409; throw e; }
    await pp(env, 'POST', `/v1/billing/subscriptions/${id}/suspend`, { reason: '利用者による一時停止(1か月)' });
    const resumeAt = new Date(addMonths(Date.now(), 1));
    await patchDoc(env, 'users/' + uid, { subscription: { ...sub, status: 'paused', pausedByUser: true, resumeAt, updatedAt: new Date() } });
    return { status: 'paused', resumeAt: resumeAt.toISOString() };
  }
  if (path === '/paypal/resume') {
    await pp(env, 'POST', `/v1/billing/subscriptions/${id}/activate`, { reason: '利用者による再開' });
    await patchDoc(env, 'users/' + uid, { subscription: { ...sub, pausedByUser: false, resumeAt: null } });
    const r = await syncSubscription(env, sub.id, uid);
    return { status: r.sub.status };
  }
  if (path === '/paypal/revise') {
    const entry = Object.entries(plansOf(env)).find(([, p]) => p.key === body.planKey);
    if (!entry) { const e = new Error('プランがありません'); e.status = 400; throw e; }
    const app = appUrl(env);
    const r = await pp(env, 'POST', `/v1/billing/subscriptions/${id}/revise`, {
      plan_id: entry[0],
      application_context: { brand_name: 'ZEROICHI WORKS', locale: 'ja-JP', shipping_preference: 'NO_SHIPPING', return_url: body.return_url || app + 'mypage/?revised=1', cancel_url: app + 'mypage/' }
    });
    const approve = (r.links || []).find(l => l.rel === 'approve');
    return { approve: approve ? approve.href : null };
  }
  if (path === '/paypal/cancel') {
    const reason = String(body.reason || '').slice(0, 120) || '利用者による解約';
    await pp(env, 'POST', `/v1/billing/subscriptions/${id}/cancel`, { reason });
    const prev = { ...sub, cancelReason: reason };
    await patchDoc(env, 'users/' + uid, { subscription: prev });
    const r = await syncSubscription(env, sub.id, uid);
    return { status: r.sub.status, paidThrough: r.sub.paidThrough };
  }
  void user;
  const e = new Error('not found'); e.status = 404; throw e;
}

/* ------------------------------------------------------------------ 毎日の仕事 */
export async function daily(env, now = Date.now()) {
  const done = { reminders: 0, resumed: 0, purged: 0 };
  // 1. 無料期間の終了3日前のお知らせ(毎日1回動くので、残り3.5日を切った最初の日に送る)
  for (const { uid, data } of await runQuery(env, { fieldFilter: { field: { fieldPath: 'subscription.status' }, op: 'EQUAL', value: { stringValue: 'trialing' } } })) {
    const sub = data.subscription || {}, end = toMs(sub.trialEnd);
    if (!end || sub.reminderSent || end - now > 3.5 * DAY || end <= now) continue;
    const to = data.email || sub.payerEmail; if (!to) continue;
    await sendMail(env, trialReminderMail(sub, to, env));
    await patchDoc(env, 'users/' + uid, { subscription: { ...sub, reminderSent: true } });
    done.reminders++;
  }
  // 2. 一時停止(1か月)の自動再開
  for (const { uid, data } of await runQuery(env, { fieldFilter: { field: { fieldPath: 'subscription.status' }, op: 'EQUAL', value: { stringValue: 'paused' } } })) {
    const sub = data.subscription || {};
    if (!sub.resumeAt || toMs(sub.resumeAt) > now) continue;
    await pp(env, 'POST', `/v1/billing/subscriptions/${encodeURIComponent(sub.id)}/activate`, { reason: '一時停止の期間の終わり' });
    await patchDoc(env, 'users/' + uid, { subscription: { ...sub, pausedByUser: false, resumeAt: null } });
    await syncSubscription(env, sub.id, uid);
    done.resumed++;
  }
  // 3. 解約から3年たった台帳を消す
  for (const { uid, data } of await runQuery(env, { fieldFilter: { field: { fieldPath: 'subscription.retainUntil' }, op: 'LESS_THAN', value: { timestampValue: new Date(now).toISOString() } } })) {
    const sub = data.subscription || {};
    if (!['canceled', 'expired'].includes(sub.status) || sub.purgedAt) continue;
    await purgeLedger(env, uid);
    await patchDoc(env, 'users/' + uid, { subscription: { ...sub, purgedAt: new Date(now) } });
    done.purged++;
  }
  return done;
}
async function purgeLedger(env, uid) {
  for (;;) {
    const r = await fs(env, 'GET', `/users/${uid}/ledger?pageSize=300&mask.fieldPaths=updatedAt`);
    const docs = (r && r.documents) || [];
    if (!docs.length) return;
    await fs(env, 'POST', ':commit', { writes: docs.map(d => ({ delete: d.name })) });
    if (docs.length < 300) return;
  }
}

/* ------------------------------------------------------------------ 入口 */
function cors(env, req) {
  const origin = req.headers.get('Origin') || '';
  const allow = (env.ALLOWED_ORIGIN || 'https://hiro0530.github.io').split(',').map(s => s.trim());
  return allow.includes(origin) ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin' } : {};
}
export default {
  async fetch(req, env) {
    const url = new URL(req.url), c = cors(env, req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: c });
    if (url.pathname === '/health') return json({ ok: true });
    if (req.method !== 'POST') return json({ error: 'method' }, 405, c);
    if (url.pathname === '/paypal/webhook') {
      const text = await req.text();
      let ok = false;
      try { ok = await verifyWebhook(req, text, env); } catch (e) { return json({ error: 'verify-failed' }, 500); }
      if (!ok) return json({ error: 'bad-signature' }, 400);
      const ev = JSON.parse(text), r = ev.resource || {};
      const subId = /^BILLING\.SUBSCRIPTION\./.test(ev.event_type) ? r.id : (ev.event_type === 'PAYMENT.SALE.COMPLETED' ? r.billing_agreement_id : null);
      if (!subId) return json({ ignored: ev.event_type });
      try { const out = await syncSubscription(env, subId, r.custom_id); return json({ ok: true, status: out.sub ? out.sub.status : out.skipped }); }
      catch (e) { return json({ error: String(e.message || e) }, 500); } // 500 なら PayPal が送り直す
    }
    if (url.pathname.startsWith('/paypal/')) {
      try {
        const m = (req.headers.get('Authorization') || '').match(/^Bearer (.+)$/);
        const who = await verifyIdToken(m && m[1], env).catch(() => { const e = new Error('ログインし直してください'); e.status = 401; throw e; });
        const body = await req.json().catch(() => ({}));
        return json(await handleUser(url.pathname, body, who, env), 200, c);
      } catch (e) { return json({ error: String(e.message || e) }, e.status || 500, c); }
    }
    return json({ error: 'not found' }, 404, c);
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(daily(env)); }
};
