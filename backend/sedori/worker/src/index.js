/**
 * せどり 利益チェック — 契約の受け口(Cloudflare Worker・無料枠)
 *
 * お支払いは Stripe(カード・Apple Pay・Google Pay)が本命、PayPal は2つ目の選択肢(2026-10-28 決定)。
 * どちらも契約の状態を Firestore の users/{uid}.subscription に同じ形で書く(provider: "stripe" | "paypal")。
 *
 * 役目
 *  1. Stripe の Webhook(POST /stripe/webhook)。署名(Stripe-Signature の t と v1・HMAC-SHA256・許容5分)を確かめ、
 *     受ける出来事: checkout.session.completed / customer.subscription.updated / customer.subscription.deleted / invoice.paid / invoice.payment_failed
 *     どの出来事でも Stripe から契約を読み直して書くので、届く順が前後しても、同じ通知が2回来ても結果は同じ。処理済みの出来事は stripeEvents に残す。
 *  2. PayPal の Webhook。署名を PayPal に確かめてから同じように書く。
 *     受ける出来事: BILLING.SUBSCRIPTION.ACTIVATED / UPDATED / RE-ACTIVATED / CANCELLED / SUSPENDED / EXPIRED / PAYMENT.FAILED、PAYMENT.SALE.COMPLETED
 *  3. ログイン中の利用者からの頼み(Firebase の ID トークンで本人を確かめる)
 *     POST /stripe/checkout { planKey }  Stripe の申し込み画面(Checkout)の URL を返す
 *     POST /stripe/link     { sessionId } 申し込み直後の反映
 *     POST /stripe/pause    1か月の一時停止 / POST /stripe/resume 再開
 *     POST /stripe/revise   { planKey }  プランの変更(その場で変わり、差額は日割り)
 *     POST /stripe/cancel   { reason }   解約(期間の終わりで終了。日割りの返金なし)。
 *                                         ただし年払いの1回目のお支払いから30日以内なら、全額を返金してその場で終える(2026-10-30 決定)
 *     POST /stripe/portal   { flow }     カードの変更・請求の履歴(Stripe のカスタマーポータル)
 *     POST /paypal/link | pause | resume | revise | cancel  PayPal の契約の同じ操作
 *     GET  /stripe/plans    カードで申し込めるプラン(料金ページが「準備中」かどうかを決める。ログイン不要)
 *  4. 毎日1回(cron): 無料期間の終了3日前のメール、一時停止の自動再開、解約から3年たった台帳の削除
 *
 * 先着100名(総合 3,980円)は「1回目のお支払いが済んだ順」に数える(public/founders.taken)。解約しない限りずっと(サービス提供中)その価格。
 * 年払いは無料期間なしでその場で決済し、1回目のお支払いから30日以内の解約は全額返金(YEAR_TEXT。料金ページ・規約・特商法と同じ文)。
 * 秘密の値は wrangler secret で入れる(README)。ここには書かない。Stripe の SDK は使わず、REST を fetch で呼ぶ。
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
const DEFAULT_APP_URL = 'https://zeroichiworks.net/sedori/';
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
  // 先着100名は1回目のお支払いが済んだ順に数える(PayPal は無料期間の後に ACTIVE のまま請求が通ると active になる)
  if (sub.founder && sub.status === 'active' && !(link && link.counted)) await countFounder(env, 'paypal', subId);
  return { uid, sub };
}

/**
 * 先着100名: 1回目のお支払いが済んだ契約を1回だけ数える。上限に達したら受付を閉じる(public/founders.open=false)。
 * 同じ契約の通知が同時に2つ来ても2回数えないよう、founderSeats/{provider}_{契約番号} の作成(無い時だけ)と
 * taken の加算を1つの書き込み(:commit)でまとめる。受付中に申し込んだ方(無料期間中の方を含む)は、その価格のまま続く。
 */
export async function countFounder(env, provider, subId) {
  const limit = Number(env.FOUNDER_LIMIT || 100);
  const root = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
  try {
    await fs(env, 'POST', ':commit', { writes: [
      { update: { name: `${root}/founderSeats/${provider}_${subId}`, fields: toFields({ provider, subId, at: new Date() }) }, currentDocument: { exists: false } },
      { transform: { document: `${root}/public/founders`, fieldTransforms: [{ fieldPath: 'taken', increment: { integerValue: '1' } }] } }
    ] });
  } catch (e) {
    if (/ (400|409)$/.test(e.message)) return false; // もう数えてある
    throw e;
  }
  const f = (await getDoc(env, 'public/founders')) || {};
  const taken = Number(f.taken || 0), open = taken < limit && f.open !== false;
  await patchDoc(env, 'public/founders', { limit, open, updatedAt: new Date() });
  await patchDoc(env, (provider === 'stripe' ? 'stripeSubs/' : 'paypalSubs/') + subId, { counted: true });
  if (!open && env.PAYPAL_CLIENT_ID && env.PAYPAL_SECRET) {
    for (const [id, p] of Object.entries(plansOf(env))) if (p.founder) await pp(env, 'POST', `/v1/billing/plans/${id}/deactivate`).catch(() => {});
  }
  return true;
}

/* ------------------------------------------------------------------ Stripe(SDK を使わず REST を fetch で) */
const STRIPE_API = 'https://api.stripe.com/v1';
/** 年払いの決まり(料金ページの確認の欄・利用規約・特商法・Stripe の画面と同じ文。変える時は全部そろえる) */
export const YEAR_REFUND_DAYS = 30;
export const YEAR_TEXT = '年払いは無料期間なしで、お申し込みの日に1年分をお支払いいただきます。1回目のお支払いから30日以内に解約すれば、全額を返金します。';
const isYearKey = k => /_year$/.test(String(k || ''));
/** 料金ページ・Firestore で使うプランのキー。Stripe の価格ID は wrangler.toml の STRIPE_PRICE_<キーの大文字> に入れる */
export const PLAN_KEYS = ['light_month', 'light_year', 'total_month', 'total_year', 'founder_month', 'founder_year', 'business_month', 'business_year'];
const LIVE = ['trialing', 'active', 'past_due', 'paused'];
/** プランのキー → Stripe の価格ID(空欄のものは入れない) */
export function stripePrices(env) {
  const m = {};
  for (const k of PLAN_KEYS) { const id = String(env['STRIPE_PRICE_' + k.toUpperCase()] || '').trim(); if (id) m[k] = id; }
  return m;
}
function keyOfPrice(env, priceId) { const m = stripePrices(env); return Object.keys(m).find(k => m[k] === priceId) || ''; }
/** プランのキー → 名前・金額。wrangler.toml の PLANS にあればそれ、無ければ下の既定(sedori/assets/config.js の PLAN_CATALOG と同じ金額) */
const PLAN_INFO = {
  light_month: { name: 'ライト(月払い)', amount: '月2,980円' }, light_year: { name: 'ライト(年払い)', amount: '年29,800円' },
  total_month: { name: '総合(月払い)', amount: '月4,980円' }, total_year: { name: '総合(年払い)', amount: '年49,800円' },
  founder_month: { name: '総合 先着100名の価格(月払い)', amount: '月3,980円', founder: true }, founder_year: { name: '総合 先着100名の価格(年払い)', amount: '年39,800円', founder: true },
  business_month: { name: '業務(月払い)', amount: '月7,980円' }, business_year: { name: '業務(年払い)', amount: '年79,800円' }
};
function planByKey(env, key) {
  for (const p of Object.values(plansOf(env))) if (p.key === key) return p;
  return PLAN_INFO[key] ? { key, ...PLAN_INFO[key] } : null;
}
const secMs = v => (v ? Number(v) * 1000 : null);
const err = (msg, status, code) => { const e = new Error(msg); e.status = status; if (code) e.code = code; return e; };

/** Stripe の REST に渡す形(a[b][0][c]=…)にする。空文字は「消す」の意味でそのまま送る */
export function formEncode(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => (x && typeof x === 'object') ? formEncode(x, `${key}[${i}]`, out) : out.push(encodeURIComponent(`${key}[${i}]`) + '=' + encodeURIComponent(String(x))));
    else if (typeof v === 'object') formEncode(v, key, out);
    else out.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(v)));
  }
  return out.join('&');
}
async function stripe(env, method, path, params, extraHeaders) {
  if (!env.STRIPE_SECRET_KEY) throw err('カードのお支払いは準備中です', 503);
  const headers = { Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY, ...(extraHeaders || {}) };
  let url = STRIPE_API + path, body;
  if (params && method === 'GET') url += '?' + formEncode(params);
  else if (params) { body = formEncode(params); headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
  const r = await fetch(url, { method, headers, body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw err(`stripe ${method} ${path} ${r.status} ${String((j.error && j.error.message) || '').slice(0, 200)}`, 502);
  return j;
}

/**
 * Stripe-Signature(t=時刻,v1=署名[,v1=…])を確かめる。署名は HMAC-SHA256(Webhook の署名シークレット, `${t}.${本文}`) の16進。
 * 時刻のずれが tolerance 秒(既定5分)を超えたら受けない(送り直しの悪用を防ぐ)。
 */
export async function verifyStripeSignature(payload, header, secret, now = Date.now(), tolerance = 300) {
  if (!header || !secret) return false;
  let t = null; const v1 = [];
  for (const part of String(header).split(',')) {
    const i = part.indexOf('='); if (i < 0) continue;
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    if (k === 't') t = v; else if (k === 'v1') v1.push(v);
  }
  if (!t || !/^\d+$/.test(t) || !v1.length) return false;
  if (Math.abs(Math.floor(now / 1000) - Number(t)) > tolerance) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(t + '.' + payload)));
  const hex = Array.from(mac, b => b.toString(16).padStart(2, '0')).join('');
  return v1.some(s => sameText(s, hex));
}
function sameText(a, b) { // 時間で中身を推し量られないように、最後まで比べる
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/**
 * Stripe の契約 → アプリの契約の状態(PayPal と同じ形)。prev は今までの値。
 * 期間の終わりでの解約(cancel_at_period_end)が決まった契約は canceled + paidThrough(その日まで使える)にする。
 * 新しい API(2025-03 以降)は期間の終わりを items.data[0].current_period_end に持つので、両方を見る。
 */
export function normalizeStripe(s, prev, env, now = Date.now()) {
  prev = prev || {};
  const item = ((s.items || {}).data || [])[0] || {};
  const priceId = (item.price || {}).id || (s.plan || {}).id || '';
  const key = keyOfPrice(env, priceId) || (s.metadata || {}).planKey || prev.planKey || '';
  const plan = planByKey(env, key) || {};
  const periodEnd = secMs(item.current_period_end || s.current_period_end);
  const trialEnd = secMs(s.trial_end);
  const pause = s.pause_collection || null;
  let status;
  switch (s.status) {
    case 'trialing': status = 'trialing'; break;
    case 'active': status = pause ? 'paused' : 'active'; break;
    case 'past_due': status = 'past_due'; break;
    case 'unpaid': case 'paused': status = 'suspended'; break;
    case 'canceled': status = 'canceled'; break;
    case 'incomplete_expired': status = 'expired'; break;
    default: status = 'incomplete';
  }
  const ending = LIVE.includes(status) && !!(s.cancel_at_period_end || s.cancel_at);
  const out = {
    id: s.id, provider: 'stripe', customerId: (typeof s.customer === 'string' ? s.customer : (s.customer || {}).id) || prev.customerId || '', itemId: item.id || prev.itemId || '',
    status: ending ? 'canceled' : status, planId: priceId, planKey: key, planName: plan.name || prev.planName || '総合', amount: plan.amount || prev.amount || '',
    founder: key ? !!plan.founder : !!prev.founder,
    trialEnd: trialEnd ? new Date(trialEnd) : (toMs(prev.trialEnd) ? new Date(toMs(prev.trialEnd)) : null),
    nextBillingAt: status === 'trialing' ? (trialEnd ? new Date(trialEnd) : null) : (periodEnd ? new Date(periodEnd) : null),
    payerEmail: prev.payerEmail || '',
    pausedByUser: status === 'paused', resumeAt: status === 'paused' && pause && pause.resumes_at ? new Date(secMs(pause.resumes_at)) : null,
    reminderSent: !!prev.reminderSent, cancelReason: (s.metadata || {}).cancel_reason || prev.cancelReason || '', updatedAt: new Date(now),
    refundUntil: null, refunded: (s.metadata || {}).refunded === '1' || !!prev.refunded
  };
  // 年払いの全額返金の期限(1回目のお支払いから30日)。マイページの解約の案内がこれを見る
  const ru = refundDeadline(s, key);
  if (ru && status === 'active' && !ending && now <= ru) out.refundUntil = new Date(ru);
  if (ending || status === 'canceled' || status === 'expired') {
    // 期間の終わり(無料期間中ならその終わり)まで使える。そこから3年間、台帳を保管する
    const through = ending
      ? (secMs(s.cancel_at) || periodEnd || now)
      : Math.max(toMs(prev.paidThrough) || 0, secMs(s.ended_at) || 0, status === 'canceled' ? 0 : now) || now;
    out.paidThrough = new Date(through);
    out.canceledAt = new Date(secMs(s.canceled_at) || toMs(prev.canceledAt) || now);
    out.retainUntil = new Date(addYears(Math.max(through, now), RETAIN_YEARS));
    out.nextBillingAt = null; out.pausedByUser = false; out.resumeAt = null;
  } else { out.paidThrough = null; out.canceledAt = null; out.retainUntil = null; }
  return out;
}

/**
 * 年払いの全額返金の期限(ミリ秒)。対象でなければ null。
 * 対象は、申し込み画面(Checkout)で年払いを申し込んだ契約(metadata.refundDays が付く)。1回目のお支払いはお申し込みの日なので、契約の開始から数える。
 * 更新の分(2年目以降)は期限を過ぎているので対象外。月払いから年払いへ変えた契約は metadata.refundDays が無いので対象外。
 */
export function refundDeadline(s, key) {
  const days = Number((s.metadata || {}).refundDays || 0);
  const start = secMs(s.start_date || s.created);
  if (!days || !start || !isYearKey(key || (s.metadata || {}).planKey)) return null;
  return start + days * DAY;
}

/** 返金する支払いを探す(古い API: invoice.payment_intent / charge、新しい API: invoice_payments) */
async function yearPayment(env, subId) {
  const list = await stripe(env, 'GET', '/invoices', { subscription: subId, status: 'paid', limit: 10 });
  const inv = ((list && list.data) || []).filter(i => Number(i.amount_paid || 0) > 0).sort((a, b) => (a.created || 0) - (b.created || 0))[0];
  if (!inv) return null;
  const id = v => (typeof v === 'string' ? v : (v && v.id) || '');
  if (id(inv.payment_intent)) return { invoice: inv, ref: { payment_intent: id(inv.payment_intent) } };
  if (id(inv.charge)) return { invoice: inv, ref: { charge: id(inv.charge) } };
  const ps = await stripe(env, 'GET', '/invoice_payments', { invoice: inv.id, limit: 3 });
  for (const p of (ps && ps.data) || []) {
    const pay = p.payment || {};
    if (id(pay.payment_intent)) return { invoice: inv, ref: { payment_intent: id(pay.payment_intent) } };
    if (id(pay.charge)) return { invoice: inv, ref: { charge: id(pay.charge) } };
  }
  return null;
}

/** 契約を Stripe から読み直して Firestore に書く。hint: { uid, email, paid(1回目の入金の通知) } */
export async function syncStripe(env, subId, hint = {}) {
  const s = await stripe(env, 'GET', '/subscriptions/' + encodeURIComponent(subId));
  const link = await getDoc(env, 'stripeSubs/' + subId);
  const uid = (s.metadata || {}).uid || hint.uid || (link && link.uid) || '';
  if (!uid) return { skipped: 'no-uid' };
  const user = (await getDoc(env, 'users/' + uid)) || {};
  const cur = user.subscription || {};
  const prev = cur.id === subId ? cur : {};
  const sub = normalizeStripe(s, prev, env);
  if (!sub.payerEmail) sub.payerEmail = hint.email || user.email || '';
  // 同じ人の別の契約(古い契約の遅れて届いた通知など)で、いま有効な契約を上書きしない
  if (cur.id && cur.id !== subId && LIVE.includes(cur.status) && !LIVE.includes(sub.status)) {
    await patchDoc(env, 'stripeSubs/' + subId, { uid, status: sub.status, updatedAt: new Date() });
    return { uid, sub, kept: cur.id };
  }
  await patchDoc(env, 'users/' + uid, { subscription: sub });
  await patchDoc(env, 'stripeSubs/' + subId, { uid, status: sub.status, updatedAt: new Date() });
  if (sub.founder && (hint.paid || sub.status === 'active') && !(link && link.counted)) await countFounder(env, 'stripe', subId);
  return { uid, sub };
}

const STRIPE_EVENTS = ['checkout.session.completed', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_failed'];
/** Webhook の出来事を1つ処理する(署名は確認済み)。同じ出来事が2回来たら2回目は何もしない */
export async function handleStripeEvent(env, ev) {
  if (!ev || !STRIPE_EVENTS.includes(ev.type)) return { ignored: ev && ev.type };
  const evId = String(ev.id || '');
  if (!/^[\w-]{1,200}$/.test(evId)) return { ignored: 'no-id' };
  const seen = await getDoc(env, 'stripeEvents/' + evId);
  if (seen && seen.done) return { duplicate: true };
  const o = (ev.data || {}).object || {};
  let subId = null; const hint = {};
  if (ev.type === 'checkout.session.completed') {
    if (o.mode !== 'subscription') return { ignored: 'not-subscription' };
    subId = typeof o.subscription === 'string' ? o.subscription : (o.subscription || {}).id;
    hint.uid = o.client_reference_id || (o.metadata || {}).uid || '';
    hint.email = (o.customer_details || {}).email || o.customer_email || '';
  } else if (/^customer\.subscription\./.test(ev.type)) {
    subId = o.id; hint.uid = (o.metadata || {}).uid || '';
  } else { // invoice.*(古い API は invoice.subscription、新しい API は invoice.parent.subscription_details)
    const det = ((o.parent || {}).subscription_details) || o.subscription_details || {};
    subId = (typeof o.subscription === 'string' ? o.subscription : (o.subscription || {}).id) || det.subscription;
    hint.uid = (det.metadata || {}).uid || '';
    hint.paid = ev.type === 'invoice.paid' && Number(o.amount_paid || 0) > 0;
  }
  if (!subId) return { ignored: 'no-subscription' };
  const r = await syncStripe(env, subId, hint);
  await patchDoc(env, 'stripeEvents/' + evId, { type: ev.type, subId, done: true, at: new Date() });
  return { ok: true, status: r.sub ? r.sub.status : r.skipped };
}

/** 料金ページの「お申し込み内容の確認」と同じことを、Stripe の画面のボタンの下にも書く */
function checkoutNote(plan, key, trial, env, now = Date.now()) {
  const price = String(plan.amount || '').replace(/^(月|年)/, '');
  const cyc = /_year$/.test(key) ? '毎年' : '毎月';
  const head = trial
    ? `${Number(env.TRIAL_DAYS || 14)}日間は無料です。${jd(now + Number(env.TRIAL_DAYS || 14) * DAY)}に1回目の${price}(税込)を請求し、以後は${cyc}同じ日に自動で請求します。`
    : isYearKey(key)
      ? `${YEAR_TEXT}今日${price}(税込)を請求し、以後は毎年同じ日に自動で請求します。`
      : `今日、1回目の${price}(税込)を請求し、以後は${cyc}同じ日に自動で請求します。`;
  return head + '解約はマイページの「契約内容」からいつでもできます' + (trial ? '(無料期間中の解約は0円)。' : '。');
}

/** ログイン中の利用者からの Stripe の頼み */
export async function handleStripeUser(path, body, who, env) {
  const uid = who.uid, app = appUrl(env);
  if (path === '/stripe/checkout') {
    const key = String(body.planKey || '');
    const prices = stripePrices(env);
    if (!prices[key]) throw err('このプランは、いまカードで申し込めません', 400, 'no-price');
    const user = (await getDoc(env, 'users/' + uid)) || {};
    const cur = user.subscription || null;
    const curPaid = cur && (LIVE.includes(cur.status) || cur.status === 'suspended' || (cur.status === 'canceled' && toMs(cur.paidThrough) > Date.now()));
    if (curPaid) throw err('このアカウントには、いまの契約があります。マイページの契約内容をご確認ください', 409, 'has-sub');
    if (/^founder_/.test(key)) {
      const f = (await getDoc(env, 'public/founders')) || {};
      if (f.open === false || Number(f.taken || 0) >= Number(env.FOUNDER_LIMIT || 100)) throw err('先着100名の価格の受付は終わりました', 409, 'founder-closed');
    }
    const year = isYearKey(key);
    const trial = !cur && !year; // 無料期間は、初めてのお申し込みの月払いだけ。年払いは無料期間なしでその場で決済(30日以内は全額返金)
    const plan = planByKey(env, key) || {};
    const meta = { uid, planKey: key };
    const subMeta = year ? { ...meta, refundDays: String(YEAR_REFUND_DAYS) } : meta;
    const params = {
      mode: 'subscription', locale: 'ja', client_reference_id: uid,
      line_items: [{ price: prices[key], quantity: 1 }],
      payment_method_types: ['card'], // Apple Pay・Google Pay はカードの中に出る(Stripe の管理画面で有効にしておく)
      success_url: app + 'mypage/?subscribed=1&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: app + 'plans/?plan=' + key.replace(/^founder_/, 'total_') + '#pl-step2',
      metadata: meta,
      subscription_data: trial ? { metadata: subMeta, trial_period_days: Number(env.TRIAL_DAYS || 14) } : { metadata: subMeta },
      custom_text: { submit: { message: checkoutNote(plan, key, trial, env) } }
    };
    if (cur && cur.provider === 'stripe' && cur.customerId) params.customer = cur.customerId;
    else if (who.email) params.customer_email = who.email;
    const s = await stripe(env, 'POST', '/checkout/sessions', params);
    return { url: s.url, trial };
  }
  if (path === '/stripe/link') {
    const s = await stripe(env, 'GET', '/checkout/sessions/' + encodeURIComponent(String(body.sessionId || '')));
    if (s.client_reference_id !== uid) throw err('別のアカウントのお申し込みです', 403);
    const subId = typeof s.subscription === 'string' ? s.subscription : (s.subscription || {}).id;
    if (!subId) return { status: 'incomplete' };
    const r = await syncStripe(env, subId, { uid, email: (s.customer_details || {}).email || '' });
    return { status: r.sub ? r.sub.status : 'incomplete' };
  }
  const u = (await getDoc(env, 'users/' + uid)) || {};
  const sub = u.subscription || null;
  if (!sub || !sub.id || sub.provider !== 'stripe') throw err('カードの契約がありません', 404);
  const id = encodeURIComponent(sub.id);
  const after = async () => { const r = await syncStripe(env, sub.id, { uid }); return r.sub; };
  if (path === '/stripe/cancel') {
    if (!LIVE.includes(sub.status) && sub.status !== 'suspended') throw err('解約の手続きは済んでいます', 409);
    const reason = String(body.reason || '').slice(0, 120) || '利用者による解約';
    // 年払いの1回目のお支払いから30日以内: 全額を返金して、その場で終える。返金が通らなければ解約もしない(お金だけ取って止めることはしない)
    if (isYearKey(sub.planKey) && sub.status === 'active') {
      const live = await stripe(env, 'GET', '/subscriptions/' + id);
      const until = refundDeadline(live, sub.planKey);
      if (until && Date.now() <= until && !live.cancel_at_period_end && live.status === 'active') {
        const pay = await yearPayment(env, sub.id);
        if (!pay) throw err('返金するお支払いが見つかりませんでした。お手数ですがメールでご連絡ください(全額を返金します)', 502, 'refund-not-found');
        const rf = await stripe(env, 'POST', '/refunds', { ...pay.ref, reason: 'requested_by_customer', metadata: { uid, subscription: sub.id, rule: 'year-30days' } },
          { 'Idempotency-Key': 'zw-year-refund-' + sub.id });
        await stripe(env, 'POST', '/subscriptions/' + id, { metadata: { cancel_reason: reason, refunded: '1', refund_id: rf.id || '' } });
        await stripe(env, 'DELETE', '/subscriptions/' + id);
        const s3 = await after();
        return { status: s3.status, refunded: true, amount: Number(rf.amount || pay.invoice.amount_paid || 0), paidThrough: s3.paidThrough };
      }
    }
    // 期間の終わりで終える(日割りの返金はなし)。無料期間中なら無料期間の終わりで終わり、請求はしない
    await stripe(env, 'POST', '/subscriptions/' + id, { cancel_at_period_end: 'true', metadata: { cancel_reason: reason } });
    const s2 = await after();
    return { status: s2.status, paidThrough: s2.paidThrough };
  }
  if (path === '/stripe/pause') {
    if (sub.status !== 'active') throw err('いまは一時停止できません', 409);
    const resumeAt = addMonths(Date.now(), 1);
    await stripe(env, 'POST', '/subscriptions/' + id, { pause_collection: { behavior: 'void', resumes_at: Math.floor(resumeAt / 1000) } });
    const s2 = await after();
    return { status: s2.status, resumeAt: new Date(resumeAt).toISOString() };
  }
  if (path === '/stripe/resume') {
    await stripe(env, 'POST', '/subscriptions/' + id, { pause_collection: '' });
    return { status: (await after()).status };
  }
  if (path === '/stripe/revise') {
    const key = String(body.planKey || ''), price = stripePrices(env)[key];
    if (!price) throw err('プランがありません', 400);
    if (/^founder_/.test(key) && !sub.founder) throw err('先着100名の価格には変えられません', 400);
    if (!['trialing', 'active'].includes(sub.status)) throw err('いまはプランを変えられません', 409);
    const s = await stripe(env, 'GET', '/subscriptions/' + id);
    const itemId = ((((s.items || {}).data) || [])[0] || {}).id;
    if (!itemId) throw err('契約の中身を読めませんでした', 502);
    await stripe(env, 'POST', '/subscriptions/' + id, { items: [{ id: itemId, price }], proration_behavior: 'create_prorations', metadata: { planKey: key } });
    const s2 = await after();
    return { status: s2.status, planKey: s2.planKey };
  }
  if (path === '/stripe/portal') {
    if (!sub.customerId) throw err('契約の中身を読めませんでした', 404);
    const params = { customer: sub.customerId, locale: 'ja', return_url: app + 'mypage/' };
    if (body.flow === 'card') params.flow_data = { type: 'payment_method_update', after_completion: { type: 'redirect', redirect: { return_url: app + 'mypage/?card=1' } } };
    const p = await stripe(env, 'POST', '/billing_portal/sessions', params);
    return { url: p.url };
  }
  throw err('not found', 404);
}

/* ------------------------------------------------------------------ メール(Apps Script 経由で事業用の Gmail から送る) */
const WD = '日月火水木金土';
function jd(ms) { const d = new Date(ms + 9 * 36e5); return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日(${WD[d.getUTCDay()]})`; }
export function trialReminderMail(sub, email, env) {
  const end = toMs(sub.trialEnd), app = appUrl(env);
  const price = (sub.amount || '月4,980円').replace(/^(月|年)/, '');
  const cyc = /^年/.test(sub.amount || '') ? '毎年' : '毎月';
  const card = sub.provider === 'stripe';
  const how = card
    ? `1. マイページ → 契約内容 → 「解約について」 → 「解約する」
   ${app}mypage/#cancel
2. このメールに「解約」とご返信`
    : `1. マイページ → 契約内容 → 「解約について」 → 「解約する」
   ${app}mypage/#cancel
2. PayPal → 右上の歯車(設定) → 支払い → 自動支払いを管理 → ZEROICHI WORKS → キャンセル
3. このメールに「解約」とご返信`;
  return {
    to: email,
    subject: `【せどり 利益チェック】無料期間は${jd(end)}までです`,
    body: `${email} 様

せどり 利益チェックをお使いいただき、ありがとうございます。
無料期間は、${jd(end)}で終わります(無料期間中は、業務のすべての機能を使えます)。

・${jd(end)}から「${sub.planName || '総合'}」で続き、1回目の料金 ${price}(税込)を${card ? 'ご登録のカード' : 'PayPal'}でお支払いいただきます。以後は${cyc}同じ日に自動で請求します。
・続ける場合、お手続きは要りません。ライト・総合・業務の切り替えは、マイページの「契約内容」からできます。
・続けない場合は、${jd(end - DAY)}までに解約してください。無料期間中の解約は0円です。

解約の方法(どれでもできます)
${how}

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
  if (sub.provider === 'stripe') { const e = new Error('カードの契約です'); e.status = 400; throw e; }
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
    if (sub.provider === 'stripe') {
      // Stripe は resumes_at で自分で再開する。届いていなければ、ここで止めを外して読み直す
      const s = await stripe(env, 'GET', '/subscriptions/' + encodeURIComponent(sub.id));
      if (s.pause_collection) await stripe(env, 'POST', '/subscriptions/' + encodeURIComponent(sub.id), { pause_collection: '' });
      await syncStripe(env, sub.id, { uid });
      done.resumed++;
      continue;
    }
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
  return allow.includes(origin) ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Vary': 'Origin' } : {};
}
export default {
  async fetch(req, env) {
    const url = new URL(req.url), c = cors(env, req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: c });
    if (url.pathname === '/health') return json({ ok: true });
    // カードで申し込めるプラン(価格IDが入っているもの)。料金ページはこれが空なら「準備中」と出す
    if (url.pathname === '/stripe/plans' && req.method === 'GET') {
      const ready = env.STRIPE_SECRET_KEY ? Object.keys(stripePrices(env)) : [];
      return json({ ready, trialDays: Number(env.TRIAL_DAYS || 14) }, 200, { ...c, 'Cache-Control': 'public, max-age=300' });
    }
    if (req.method !== 'POST') return json({ error: 'method' }, 405, c);
    if (url.pathname === '/stripe/webhook') {
      const text = await req.text();
      const ok = await verifyStripeSignature(text, req.headers.get('Stripe-Signature'), env.STRIPE_WEBHOOK_SECRET).catch(() => false);
      if (!ok) return json({ error: 'bad-signature' }, 400);
      let ev; try { ev = JSON.parse(text); } catch { return json({ error: 'bad-json' }, 400); }
      try { return json(await handleStripeEvent(env, ev)); }
      catch (e) { return json({ error: String(e.message || e) }, 500); } // 500 なら Stripe が送り直す
    }
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
    if (url.pathname.startsWith('/paypal/') || url.pathname.startsWith('/stripe/')) {
      try {
        const m = (req.headers.get('Authorization') || '').match(/^Bearer (.+)$/);
        const who = await verifyIdToken(m && m[1], env).catch(() => { const e = new Error('ログインし直してください'); e.status = 401; throw e; });
        const body = await req.json().catch(() => ({}));
        const out = url.pathname.startsWith('/stripe/') ? await handleStripeUser(url.pathname, body, who, env) : await handleUser(url.pathname, body, who, env);
        return json(out, 200, c);
      } catch (e) { return json({ error: String(e.message || e), code: e.code || undefined }, e.status || 500, c); }
    }
    return json({ error: 'not found' }, 404, c);
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(daily(env)); }
};
