/**
 * 利用の鍵(2026-11-17 オーナー指示「こちらでお客の管理はしない。月額の利用料だけ取る仕組み」)
 *
 * 考え方
 *  - こちらは客の名簿もデータも持たない。契約の正本は Stripe。Worker は Stripe に聞いて答えるだけ(覚えない)。
 *  - 客が持つのは「利用の鍵」(16文字。例 ABCD-EFGH-JKLM-NPQR)。申し込み直後に自動で端末に入り、Stripe の請求書・領収書にも載る。
 *    鍵は Stripe の契約のメタデータ(zw_key)に置くので、こちらの名簿は要らない。
 *  - 端末が持つのは「利用の証明」(署名つき。中身=段・プラン・期限・契約番号・客番号のハッシュ・端末番号)。
 *    期限は1日(KEY_PASS_HOURS。2026-11-17 21:50 オーナー決定「抜け道はなくす」で7日→1日)。有料の機能の芯は Worker の /core が
 *    証明を確かめてから答える(src/core.js)ので、通信できない間は有料の機能は使えない。
 *  - 無料のお試し(trial)は無い(同じ決定)。有料は初日から課金。
 *  - 端末の数(既定3台)は契約のメタデータ(zw_dev)に数える。35日使っていない端末は自動で外れる。客が自分で外せる。
 *  - 解約・未払いで契約が止まれば証明は延びず、期限の日に有料の機能が止まる(書き出しはいつでもできる)。
 *
 * 秘密の値(wrangler secret。README)
 *  - KEY_SIGNING_JWK … 証明の署名の鍵(ECDSA P-256 の秘密鍵 JWK)。無い間は「試験用(署名なし)」の証明を出す(ページは設定 KEY_ALLOW_TEST が true の写しだけ受ける)
 *  - KEY_CODE_SECRET … 利用の鍵の文字を作る合言葉。無い間は STRIPE_WEBHOOK_SECRET を使う(どちらも無い時だけ試験用の固定の文字)
 *  - PAID_JS_KEY    … 有料の画面のプログラムの包みを開く鍵(RSA-OAEP の秘密の JWK。tools/sedori/make_key_pair.mjs --paid で作る)。無い間は /key/app は 503
 * 変数(wrangler.toml): KEY_DEVICES(端末の数。既定3)・KEY_PASS_HOURS(証明の期限の時間。既定24)
 */

const DAY = 864e5;
const enc = new TextEncoder();
export const GRACE_DAYS = 3;          // 次の請求日から何日まで証明を延ばすか(請求の行き違い・端末の時計のずれの分)
/* 証明の期限(時間)。2026-11-17 21:50 の決定で 7日 → 1日。外した端末・作り直した鍵・解約・未払いが、翌日までに必ず効く。
   通信できない時の上乗せの猶予は付けない(有料の機能の芯は /core が答えるので、通信できない間はどのみち使えない。猶予を足すと止まるのが遅れるだけ) */
export const PASS_HOURS = 24;
export function passMs(env) { const h = Number((env || {}).KEY_PASS_HOURS || PASS_HOURS); return (h >= 1 && h <= 168 ? h : PASS_HOURS) * 36e5; }
export const STALE_DEVICE_DAYS = 35;  // これだけ使っていない端末は数えない(自動で外れる)
export const TOUCH_DAYS = 7;          // 最後に使った日の書き直しは、7日に1回まで(Stripe への書き込みを減らす)
export const CLAIM_DAYS = 2;          // 申し込み直後の自動の受け取りができる期間
const ALPHA = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // 0・1・I・O は使わない(読み違え防止)
const LIVE = ['trialing', 'active', 'past_due'];
const RANK = { free: 0, light: 1, total: 2, business: 3 };

function b64url(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
  const bin = atob(s), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const err = (msg, status, code, extra) => { const e = new Error(msg); e.status = status; if (code) e.code = code; if (extra) e.extra = extra; return e; };

/* ------------------------------------------------------------------ 利用の鍵(文字) */
/** 入力をそろえる(小文字・空白・ハイフンなし・O→0 の打ち間違いは受けない)。形が合わなければ '' */
export function normCode(s) {
  const t = String(s || '').toUpperCase().replace(/[\s\-ー－‐]/g, '');
  if (!/^[2-9A-HJ-NP-Z]{16}$/.test(t)) return '';
  return t.match(/.{4}/g).join('-');
}
function codeSecret(env) { return String(env.KEY_CODE_SECRET || env.STRIPE_WEBHOOK_SECRET || 'zw-test-code-only'); }
async function hmac(secret, text) {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(text)));
}
/** 契約番号と作り直しの回数から、利用の鍵の文字を決める(同じ契約なら何度作っても同じ=同時に2か所で作っても食い違わない) */
export async function codeFor(env, subId, gen = 0) {
  const b = await hmac(codeSecret(env), 'zw-key:' + subId + ':' + gen);
  let bits = 0, val = 0, out = '';
  for (const x of b) { val = (val << 8) | x; bits += 8; while (bits >= 5 && out.length < 16) { out += ALPHA[(val >> (bits - 5)) & 31]; bits -= 5; } if (out.length >= 16) break; }
  return out.match(/.{4}/g).join('-');
}
/** 合言葉つきの短いハッシュ(メールアドレスなどを、そのまま Stripe のメタデータに置かないため) */
export async function secretHash(env, label, text) {
  const b = await hmac(codeSecret(env), label + ':' + text);
  return Array.from(b.slice(0, 12), x => x.toString(16).padStart(2, '0')).join('');
}
export async function hashId(id) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode('zw-cus:' + id)));
  return Array.from(d.slice(0, 8), x => x.toString(16).padStart(2, '0')).join('');
}

/* ------------------------------------------------------------------ 利用の証明(署名つき) */
function signingJwk(env) {
  const raw = String(env.KEY_SIGNING_JWK || '').trim();
  if (!raw) return null;
  try { const j = JSON.parse(raw); return j && j.d ? j : null; } catch { return null; }
}
export function publicJwk(env) {
  const j = signingJwk(env); if (!j) return null;
  return { kty: j.kty, crv: j.crv, x: j.x, y: j.y };
}
/** 証明を作る。署名の鍵が無い間は「試験用(署名なし)」: 本文.test */
export async function signPass(env, payload) {
  const jwk = signingJwk(env);
  const body = b64url(enc.encode(JSON.stringify({ ...payload, m: jwk ? 'live' : 'test' })));
  if (!jwk) return body + '.test';
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(body));
  return body + '.' + b64url(sig);
}
/** 証明を確かめて中身を返す(だめなら null)。ページの license.js と同じ決まり */
export async function verifyPass(env, pass, now = Date.now()) {
  const parts = String(pass || '').split('.');
  if (parts.length !== 2) return null;
  let p; try { p = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0]))); } catch { return null; }
  const pub = publicJwk(env);
  if (pub) {
    if (parts[1] === 'test') return null;
    try {
      const key = await crypto.subtle.importKey('jwk', pub, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64urlDecode(parts[1]), enc.encode(parts[0]));
      if (!ok) return null;
    } catch { return null; }
  } else if (parts[1] !== 'test') return null;
  if (!p || p.v !== 1 || !(Number(p.exp) > now)) return null;
  return p;
}

/* ------------------------------------------------------------------ 契約 → 証明の中身 */
/** できることの段(プランだけで決まる。無料のお試しは 11/17 21:50 の決定で無くした) */
export function tierOfKey(planKey) {
  const k = String(planKey || '');
  if (/^business/.test(k)) return 'business';
  if (/^light/.test(k)) return 'light';
  return 'total';
}
const secMs = v => (v ? Number(v) * 1000 : null);
/**
 * Stripe の契約から、証明の期限を決める。
 *  live: 証明を出すか / exp: 証明の期限 / end: 解約が決まっていれば、使える最後の時刻 / status: 画面に出す状態
 */
export function passTerms(s, now = Date.now(), life = PASS_HOURS * 36e5) {
  const item = ((s.items || {}).data || [])[0] || {};
  const periodEnd = secMs(item.current_period_end || s.current_period_end) || 0;
  const trialEnd = secMs(s.trial_end) || 0;
  const paused = !!s.pause_collection;
  const ending = LIVE.includes(s.status) && !!(s.cancel_at_period_end || s.cancel_at);
  if (!LIVE.includes(s.status) || paused) {
    const endedAt = secMs(s.ended_at) || secMs(s.canceled_at) || now;
    return { live: false, exp: 0, end: endedAt, status: paused ? 'paused' : (s.status === 'canceled' ? 'ended' : s.status) };
  }
  if (ending) {
    const end = secMs(s.cancel_at) || periodEnd || (s.status === 'trialing' ? trialEnd : 0) || now;
    return { live: end > now, exp: Math.min(end, now + life), end, status: 'ending' };
  }
  if (s.status === 'past_due') return { live: true, exp: now + life, end: null, status: 'past_due' };
  const base = s.status === 'trialing' ? (trialEnd || periodEnd) : periodEnd;
  return { live: true, exp: Math.min(Math.max(base, now) + GRACE_DAYS * DAY, now + life), end: null, status: s.status, next: base || null };
}

/* ------------------------------------------------------------------ 端末の数え(契約のメタデータ zw_dev) */
export function deviceLimit(env) { const n = Number(env.KEY_DEVICES || 3); return n >= 1 && n <= 10 ? Math.floor(n) : 3; }
export function parseDevices(s) {
  try { const a = JSON.parse(((s && s.metadata) || {}).zw_dev || '[]'); return Array.isArray(a) ? a.filter(d => d && typeof d.i === 'string') : []; } catch { return []; }
}
const today = now => Math.floor(now / DAY);
export function cleanDevice(id) { const t = String(id || ''); return /^[a-z0-9]{8,24}$/.test(t) ? t : ''; }
export function cleanLabel(s) { return String(s || '').replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 16) || '端末'; }
/**
 * 端末を数える。known=true は「この鍵で使っていた端末」(外されていたら戻さない)。
 * 返り値 { list, changed, full, removed }
 */
export function touchDevice(list, dev, label, now, limit, known) {
  const d = today(now);
  const fresh = list.filter(x => d - Number(x.t || 0) <= STALE_DEVICE_DAYS);
  let changed = fresh.length !== list.length;
  const me = fresh.find(x => x.i === dev);
  if (me) {
    if (d - Number(me.t || 0) >= TOUCH_DAYS) { me.t = d; changed = true; }
    return { list: fresh, changed, full: false, removed: false };
  }
  if (known) return { list: fresh, changed, full: false, removed: true };
  if (fresh.length >= limit) return { list: fresh, changed, full: true, removed: false };
  fresh.push({ i: dev, n: cleanLabel(label), t: d });
  return { list: fresh, changed: true, full: false, removed: false };
}
function viewDevices(list, dev) { return list.map(x => ({ id: x.i, name: x.n || '端末', lastDay: Number(x.t || 0) * DAY, me: x.i === dev })); }

/* ------------------------------------------------------------------ 決済の受け口(2026-11-18)
   鍵の発行・証明の更新・端末・止める流れ(下の handleKey)は、決済の種類に寄らない。決済ごとの違いは「受け口」に任せる:
     name / ready(env) / canFind(env) / plans(env) → {プランのキー: 決済側のID}
     checkout(env, key, app, now) → { url }      申し込みの画面
     claim(env, body, now, claimDays) → 契約     申し込み直後に、その端末へ鍵を渡す
     find(env, code, sid) → 契約|null           鍵の文字から契約を探す
     meta(契約) / save(env, 契約, meta)         鍵・作り直しの回数・端末の一覧の置き場(Stripe は契約のメタデータ、PayPal は KV)
     receipt(env, 契約, code)                   請求書に鍵を載せる(載せられる所だけ)
     terms(契約, now, life, env) → passTerms の形 / planKey(env, 契約) / customer(契約)
     portal(env, 契約, app) → { url } / cancel(env, 契約, now) → 契約
   Stripe の受け口はここ(stripeAdapter)。PayPal は src/paypal_key.js。index.js の keyDeps.providers で結ぶ。 */
async function getSub(deps, env, id) { return deps.stripe(env, 'GET', '/subscriptions/' + encodeURIComponent(id)); }
async function saveMeta(deps, env, s, meta) {
  const r = await deps.stripe(env, 'POST', '/subscriptions/' + encodeURIComponent(s.id), { metadata: meta });
  s.metadata = { ...(s.metadata || {}), ...meta, ...((r && r.metadata) || {}) };
  return s;
}
const cusOf = s => (typeof s.customer === 'string' ? s.customer : (s.customer || {}).id) || '';
export function stripeAdapter(deps) {
  return {
    name: 'stripe',
    ready: env => !!env.STRIPE_SECRET_KEY,
    canFind: env => !!env.STRIPE_SECRET_KEY,
    plans: env => (env.STRIPE_SECRET_KEY ? deps.stripePrices(env) : {}),
    async checkout(env, key, app, now) {
      const price = deps.stripePrices(env)[key];
      if (!price) throw err('このプランは、いまカードで申し込めません', 400, 'no-price');
      const year = deps.isYearKey(key);
      const meta = { mode: 'key', planKey: key };
      const subMeta = year ? { ...meta, refundDays: String(deps.YEAR_REFUND_DAYS) } : meta;
      // 無料のお試しは付けない(11/17 21:50 の決定)。月払いも年払いも、申し込みの日に1回目を請求する
      const s = await deps.stripe(env, 'POST', '/checkout/sessions', {
        mode: 'subscription', locale: 'ja',
        line_items: [{ price, quantity: 1 }],
        success_url: app + 'mypage/?session_id={CHECKOUT_SESSION_ID}#mp-key',
        cancel_url: app + 'plans/?plan=' + key.replace(/^founder_/, 'total_') + '#pl-step2',
        metadata: meta,
        subscription_data: { metadata: subMeta },
        custom_text: { submit: { message: deps.keyNote(key, false, env, now) } }
      });
      return { url: s.url };
    },
    async claim(env, body, now, claimDays) {
      const sid = String(body.sessionId || '');
      if (!/^cs_[\w-]+$/.test(sid)) throw err('お申し込みの番号が違います', 400, 'bad-session');
      const cs = await deps.stripe(env, 'GET', '/checkout/sessions/' + encodeURIComponent(sid));
      if (!cs || cs.mode !== 'subscription' || (cs.metadata || {}).mode !== 'key') throw err('このお申し込みからは鍵を受け取れません', 400, 'bad-session');
      if (cs.status !== 'complete') throw err('お申し込みがまだ済んでいません', 409, 'not-complete');
      if (now - secMs(cs.created) > claimDays * DAY) throw err('自動の受け取りの期限が過ぎました。請求書・領収書に載っている「利用の鍵」を入れてください', 410, 'claim-expired');
      const subId = typeof cs.subscription === 'string' ? cs.subscription : (cs.subscription || {}).id;
      return getSub(deps, env, subId);
    },
    find: (env, code, sid) => findByCode(deps, env, code, sid),
    meta: s => s.metadata || {},
    save: (env, s, meta) => saveMeta(deps, env, s, meta),
    receipt: (env, s, code) => putReceiptCode(deps, env, s, code),
    terms: (s, now, life) => passTerms(s, now, life),
    planKey: (env, s) => deps.keyOfPrice(env, ((((s.items || {}).data || [])[0] || {}).price || {}).id || '') || (s.metadata || {}).planKey || '',
    customer: s => cusOf(s),
    async portal(env, s, app) {
      const cus = cusOf(s); if (!cus) throw err('契約の中身を読めませんでした', 502);
      const p = await deps.stripe(env, 'POST', '/billing_portal/sessions', { customer: cus, locale: 'ja', return_url: app + 'mypage/?back=1#mp-key' });
      return { url: p.url };
    },
    async cancel(env, s) {
      // 期間の終わりで終える(年払いの30日以内の全額返金は、Webhook の customer.subscription.updated で index.js の keyYearRefund が行う)
      if (!LIVE.includes(s.status) || s.cancel_at_period_end || s.cancel_at) return s;
      await deps.stripe(env, 'POST', '/subscriptions/' + encodeURIComponent(s.id), { cancel_at_period_end: 'true', metadata: { cancel_reason: '利用者による解約(アプリから)' } });
      return getSub(deps, env, s.id);
    }
  };
}
/** 受け口の一覧(deps.providers が無い時は Stripe だけ) */
export function providersOf(deps) { return (deps && deps.providers) || { stripe: stripeAdapter(deps) }; }
/** 契約番号の形から決済の種類を見分ける(Stripe は sub_…、PayPal は I-…) */
export function providerOfSid(sid) { const t = String(sid || ''); return /^sub_/.test(t) ? 'stripe' : /^I-[A-Z0-9]+$/.test(t) ? 'paypal' : ''; }
/** 申し込みに使う決済(画面の設定 PAY_PROVIDER が送る値。無ければ Worker の PAY_PROVIDER、それも無ければ stripe) */
export function chosenProvider(body, env, P) {
  const want = String((body && body.provider) || (env && env.PAY_PROVIDER) || 'stripe');
  return P[want] ? want : 'stripe';
}

/** 鍵がまだ無い契約に鍵を付ける(何度呼んでも同じ鍵)。請求書・領収書に載せられる決済なら載せる(再発行の窓口を持たないため) */
async function ensureCodeA(ad, env, s) {
  const md = ad.meta(s);
  if (normCode(md.zw_key)) return md.zw_key;
  const code = await codeFor(env, s.id, Number(md.zw_gen || 0));
  await ad.save(env, s, { zw_key: code, zw_gen: String(Number(md.zw_gen || 0)) });
  await ad.receipt(env, s, code);
  return code;
}
export async function ensureCode(deps, env, s) { return ensureCodeA(stripeAdapter(deps), env, s); }
async function putReceiptCode(deps, env, s, code) {
  const cus = cusOf(s); if (!cus) return;
  try { await deps.stripe(env, 'POST', '/customers/' + encodeURIComponent(cus), { invoice_settings: { custom_fields: [{ name: '利用の鍵', value: code }] } }); }
  catch { /* 載らなくても鍵は使える(アプリのマイページに出る) */ }
}
/** 鍵の文字から契約を探す(Stripe)。sid(端末が覚えている契約番号)があれば直接読む(検索の反映待ちが無い) */
export async function findByCode(deps, env, code, sid) {
  if (sid && /^sub_[\w]+$/.test(sid)) {
    try { const s = await getSub(deps, env, sid); if (s && (s.metadata || {}).zw_key === code) return s; } catch { /* 下の検索へ */ }
  }
  const r = await deps.stripe(env, 'GET', '/subscriptions/search', { query: `metadata['zw_key']:'${code}'`, limit: 3 });
  return ((r && r.data) || []).find(s => (s.metadata || {}).zw_key === code) || null;
}
/** 鍵から契約を探す(決済の種類をまたいで)。端末が覚えている契約番号の決済を先に、無ければ PayPal の索引(KV。軽い)→ Stripe の検索 */
async function locate(P, env, code, sid) {
  const first = providerOfSid(sid);
  if (first && P[first]) { const s = await P[first].find(env, code, sid); if (s) return [P[first], s]; }
  const order = Object.keys(P).filter(n => n !== first).sort((a, b) => (a === 'stripe') - (b === 'stripe'));
  for (const n of order) {
    if (!P[n].canFind(env)) continue;
    const s = await P[n].find(env, code, '');
    if (s) return [P[n], s];
  }
  return [null, null];
}

/** 証明と画面に出す中身 */
async function answer(ad, deps, env, s, code, dev, now) {
  const t = ad.terms(s, now, passMs(env), env);
  const planKey = ad.planKey(env, s);
  const plan = deps.planByKey(env, planKey) || {};
  const tier = tierOfKey(planKey);
  const list = parseDevices({ metadata: ad.meta(s) });
  const out = {
    code, sid: s.id, provider: ad.name, status: t.status, planKey, planName: plan.name || '', amount: plan.amount || '', tier: t.live ? tier : 'free',
    next: t.next || null, end: t.end, exp: t.exp || null, devices: viewDevices(list, dev), limit: deviceLimit(env), pass: null
  };
  if (t.live) {
    out.pass = await signPass(env, { v: 1, t: tier, k: planKey, sid: s.id, c: await hashId(ad.customer(s)), d: dev, st: t.status, iat: now, exp: t.exp, end: t.end || null });
  }
  return out;
}

/* ------------------------------------------------------------------ 受け口 */
/**
 * /key/… の頼み。ログインは使わない(利用の鍵が本人の印)。決済の種類に寄らない。
 * deps: { stripe, stripePrices, keyOfPrice, planByKey, founderOpen(env)→Promise<bool>, isYearKey, YEAR_REFUND_DAYS, appFor, keyNote, providers? }
 */
export async function handleKey(path, body, env, deps, now = Date.now()) {
  body = body || {};
  const P = providersOf(deps);
  if (path === '/key/checkout') {
    const ad = P[chosenProvider(body, env, P)];
    const key = String(body.planKey || '');
    if (/^founder_/.test(key) && ad.plans(env)[key] && !(await deps.founderOpen(env))) throw err('先着の価格の受付は終わりました', 409, 'founder-closed');
    return ad.checkout(env, key, deps.appFor(env, body), now);
  }
  const dev = cleanDevice(body.device);
  if (path === '/key/claim') {
    if (!dev) throw err('端末の番号がありません', 400, 'no-device');
    const ad = body.subscriptionId ? P.paypal : P.stripe;
    if (!ad) throw err('このお申し込みからは鍵を受け取れません', 400, 'bad-session');
    const s = await ad.claim(env, body, now, CLAIM_DAYS);
    const code = await ensureCodeA(ad, env, s);
    return useDevice(ad, deps, env, s, code, dev, body.label, now, false);
  }
  const code = normCode(body.code);
  if (path.startsWith('/key/') && !code) throw err('利用の鍵の形が違います(16文字。例 ABCD-EFGH-JKLM-NPQR)', 400, 'bad-code');
  if (!dev) throw err('端末の番号がありません', 400, 'no-device');
  const [ad, s] = await locate(P, env, code, String(body.sid || ''));
  if (!s) throw err('この利用の鍵は見つかりません。作り直した後の古い鍵か、打ち間違いかもしれません(申し込み直後なら1分ほど待ってからもう一度)', 404, 'no-key');
  if (path === '/key/renew') return useDevice(ad, deps, env, s, code, dev, body.label, now, !!body.known);
  const list = parseDevices({ metadata: ad.meta(s) });
  const mine = list.some(x => x.i === dev);
  if (path === '/key/devices/remove') {
    // 鍵を持っている人だけが外せる。端末がいっぱいで新しい端末から外す時もここ
    const target = cleanDevice(body.target);
    const next = list.filter(x => x.i !== target);
    if (next.length !== list.length) await ad.save(env, s, { zw_dev: JSON.stringify(next) });
    return { devices: viewDevices(next, dev), limit: deviceLimit(env) };
  }
  if (!mine) throw err('この端末は、この鍵の端末に入っていません。もう一度、利用の鍵を入れてください', 403, 'device-removed');
  if (path === '/key/portal') return ad.portal(env, s, deps.appFor(env, body));
  if (path === '/key/cancel') {
    // アプリの「解約する」(決済の種類に寄らない)。払った期間の終わりまで使える(年払いの30日以内は全額返金でその日まで)
    const s2 = await ad.cancel(env, s, now);
    const out = await answer(ad, deps, env, s2, code, dev, now);
    if (s2._refund) out.refund = s2._refund;
    return out;
  }
  if (path === '/key/rotate') {
    // 鍵を作り直す: 古い鍵は使えなくなり、端末はこの端末だけになる(ほかの端末には新しい鍵を入れ直す)
    const gen = Number(ad.meta(s).zw_gen || 0) + 1;
    const fresh = await codeFor(env, s.id, gen);
    const me = list.find(x => x.i === dev);
    await ad.save(env, s, { zw_key: fresh, zw_gen: String(gen), zw_dev: JSON.stringify([me]) });
    await ad.receipt(env, s, fresh);
    return answer(ad, deps, env, s, fresh, dev, now);
  }
  throw err('not found', 404);
}
async function useDevice(ad, deps, env, s, code, dev, label, now, known) {
  const r = touchDevice(parseDevices({ metadata: ad.meta(s) }), dev, label, now, deviceLimit(env), known);
  if (r.removed) throw err('この端末は、ほかの端末から外されました。続けて使う時は、利用の鍵をもう一度入れてください', 403, 'device-removed');
  if (r.full) throw err('この鍵で使える端末(' + deviceLimit(env) + '台)がいっぱいです。使っていない端末を外してください', 409, 'devices-full', { devices: viewDevices(r.list, dev), limit: deviceLimit(env), code });
  if (r.changed) await ad.save(env, s, { zw_dev: JSON.stringify(r.list) });
  return answer(ad, deps, env, s, code, dev, now);
}

/** Webhook(Stripe): 利用の鍵の契約なら、鍵を付けておく(請求書に載せるため)。名簿には何も書かない */
export async function onKeySubscription(deps, env, s) {
  if (((s && s.metadata) || {}).mode !== 'key') return null;
  if (LIVE.includes(s.status)) await ensureCode(deps, env, s);
  return { key: true, status: s.status };
}
/** Webhook(PayPal): 利用の鍵の契約なら、次の請求日を控え・鍵を付ける。解約なら終わりの日を控える(年払いの30日以内は返金) */
export async function onKeyPayPal(deps, env, subId, type, now = Date.now()) {
  const ad = providersOf(deps).paypal;
  if (!ad || !ad.ready(env)) return null;
  const s = await ad.get(env, subId);
  if (!s) return null;
  return ad.onEvent(env, s, type, now, x => ensureCodeA(ad, env, x));
}

/* ------------------------------------------------------------------ 有料の画面のプログラムを、証明を確かめてから渡す
   置き場は2つのどちらか:
   (1) 包み(src/paid_bundle.js)… 有料の部品の元は非公開の arbitrage-scout に置き、tools/sedori/pack_paid.mjs で「公開の鍵」で暗号にして
       ここへ入れる。公開のリポジトリには暗号の文字しか残らない。開く鍵(PAID_JS_KEY。RSA-OAEP の秘密の JWK)は Cloudflare の秘密の値だけ。
       Worker は eval しない(文字として開いて返すだけ)。main に push すれば今の自動の反映でそのまま載る。
   (2) KV の PAID_JS(結んだ時だけ。今は使っていない)
   部品ごとの段は包みの中の t か PAID_TIERS(JSON {名前: 段})。既定 light */
function b64bytes(s) { return b64urlDecode(String(s || '')); }
async function openItem(env, it) {
  const raw = String(env.PAID_JS_KEY || '').trim(); if (!raw) return null;
  let jwk; try { jwk = JSON.parse(raw); } catch { return null; }
  const priv = await crypto.subtle.importKey('jwk', jwk, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
  const aesRaw = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, priv, b64bytes(it.k));
  const aes = await crypto.subtle.importKey('raw', aesRaw, { name: 'AES-GCM' }, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64bytes(it.iv) }, aes, b64bytes(it.d));
  return new TextDecoder().decode(plain);
}
/** 包み・KV から部品を読む。返り値 { js, tier } / null(無い)/ 'off'(置き場が無い・開く鍵が無い) */
export async function paidSource(name, env, bundle) {
  const items = (bundle && bundle.items) || {};
  if (items[name]) {
    if (!env.PAID_JS_KEY) return 'off';
    try { const js = await openItem(env, items[name]); return js == null ? 'off' : { js, tier: items[name].t || '' }; } catch { return 'off'; }
  }
  if (env.PAID_JS && typeof env.PAID_JS.get === 'function') { const js = await env.PAID_JS.get(name); return js == null ? null : { js, tier: '' }; }
  return Object.keys(items).length ? null : 'off';
}
export async function servePaid(name, pass, env, now = Date.now(), bundle = null) {
  if (!/^[a-z0-9-]{1,40}\.js$/.test(name)) return { status: 404, body: 'not found' };
  const p = await verifyPass(env, pass, now);
  if (!p) return { status: 401, body: '利用の鍵の期限が切れたか、確かめられませんでした' };
  const src = await paidSource(name, env, bundle);
  if (src === 'off') return { status: 503, body: '準備中' };
  if (!src) return { status: 404, body: 'not found' };
  let need = src.tier || 'light'; try { need = (JSON.parse(env.PAID_TIERS || '{}')[name]) || need; } catch { /* 既定 */ }
  if ((RANK[p.t] || 0) < (RANK[need] || 1)) return { status: 403, body: 'このプランでは使えません' };
  return { status: 200, body: src.js };
}
