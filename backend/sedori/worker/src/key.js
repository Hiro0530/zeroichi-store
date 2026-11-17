/**
 * 利用の鍵(2026-11-17 オーナー指示「こちらでお客の管理はしない。月額の利用料だけ取る仕組み」)
 *
 * 考え方
 *  - こちらは客の名簿もデータも持たない。契約の正本は Stripe。Worker は Stripe に聞いて答えるだけ(覚えない)。
 *  - 客が持つのは「利用の鍵」(16文字。例 ABCD-EFGH-JKLM-NPQR)。申し込み直後に自動で端末に入り、Stripe の請求書・領収書にも載る。
 *    鍵は Stripe の契約のメタデータ(zw_key)に置くので、こちらの名簿は要らない。
 *  - 端末が持つのは「利用の証明」(署名つき。中身=段・プラン・期限・契約番号・客番号のハッシュ・端末番号)。
 *    ページは署名を確かめ、期限までは通信なしで有料の機能を開く。1日1回 Worker に出して、契約が生きていれば期限の延びた証明に替える。
 *  - 端末の数(既定3台)は契約のメタデータ(zw_dev)に数える。35日使っていない端末は自動で外れる。客が自分で外せる。
 *  - 解約・未払いで契約が止まれば証明は延びず、期限の日に有料の機能が止まる(書き出しはいつでもできる)。
 *
 * 秘密の値(wrangler secret。README)
 *  - KEY_SIGNING_JWK … 証明の署名の鍵(ECDSA P-256 の秘密鍵 JWK)。無い間は「試験用(署名なし)」の証明を出す(ページは設定 KEY_ALLOW_TEST が true の写しだけ受ける)
 *  - KEY_CODE_SECRET … 利用の鍵の文字を作る合言葉。無い間は STRIPE_WEBHOOK_SECRET を使う(どちらも無い時だけ試験用の固定の文字)
 * 変数(wrangler.toml): KEY_DEVICES(端末の数。既定3)
 */

const DAY = 864e5;
const enc = new TextEncoder();
export const GRACE_DAYS = 3;          // 次の請求日から何日まで証明を延ばすか(請求の行き違い・端末の時計のずれの分)
export const PAST_DUE_DAYS = 2;
export const PASS_DAYS = 7;           // 証明は長くても7日(外した端末・作り直した鍵・解約が、7日以内に必ず効く。通信なしで使えるのも7日まで)       // 支払いの失敗中(Stripe が再請求中)は、確かめた日から何日ずつ延ばすか
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
/** できることの段。無料期間中は業務のすべて(今までと同じ決まり) */
export function tierOfKey(planKey, status) {
  if (status === 'trialing') return 'business';
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
export function passTerms(s, now = Date.now()) {
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
    return { live: end > now, exp: Math.min(end, now + PASS_DAYS * DAY), end, status: 'ending' };
  }
  if (s.status === 'past_due') return { live: true, exp: now + PAST_DUE_DAYS * DAY, end: null, status: 'past_due' };
  const base = s.status === 'trialing' ? (trialEnd || periodEnd) : periodEnd;
  return { live: true, exp: Math.min(Math.max(base, now) + GRACE_DAYS * DAY, now + PASS_DAYS * DAY), end: null, status: s.status, next: base || null };
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

/* ------------------------------------------------------------------ Stripe とのやり取り */
async function getSub(deps, env, id) { return deps.stripe(env, 'GET', '/subscriptions/' + encodeURIComponent(id)); }
async function saveMeta(deps, env, s, meta) {
  const r = await deps.stripe(env, 'POST', '/subscriptions/' + encodeURIComponent(s.id), { metadata: meta });
  s.metadata = { ...(s.metadata || {}), ...meta, ...((r && r.metadata) || {}) };
  return s;
}
const cusOf = s => (typeof s.customer === 'string' ? s.customer : (s.customer || {}).id) || '';
/** 鍵がまだ無い契約に鍵を付ける(何度呼んでも同じ鍵)。請求書・領収書にも「利用の鍵」を載せる(再発行の窓口を持たないため) */
export async function ensureCode(deps, env, s) {
  const md = s.metadata || {};
  if (normCode(md.zw_key)) return md.zw_key;
  const code = await codeFor(env, s.id, Number(md.zw_gen || 0));
  await saveMeta(deps, env, s, { zw_key: code, zw_gen: String(Number(md.zw_gen || 0)) });
  await putReceiptCode(deps, env, s, code);
  return code;
}
async function putReceiptCode(deps, env, s, code) {
  const cus = cusOf(s); if (!cus) return;
  try { await deps.stripe(env, 'POST', '/customers/' + encodeURIComponent(cus), { invoice_settings: { custom_fields: [{ name: '利用の鍵', value: code }] } }); }
  catch { /* 載らなくても鍵は使える(アプリのマイページに出る) */ }
}
/** 鍵の文字から契約を探す。sid(端末が覚えている契約番号)があれば直接読む(検索の反映待ちが無い) */
export async function findByCode(deps, env, code, sid) {
  if (sid && /^sub_[\w]+$/.test(sid)) {
    try { const s = await getSub(deps, env, sid); if (s && (s.metadata || {}).zw_key === code) return s; } catch { /* 下の検索へ */ }
  }
  const r = await deps.stripe(env, 'GET', '/subscriptions/search', { query: `metadata['zw_key']:'${code}'`, limit: 3 });
  return ((r && r.data) || []).find(s => (s.metadata || {}).zw_key === code) || null;
}

/** 証明と画面に出す中身 */
async function answer(deps, env, s, code, dev, now) {
  const t = passTerms(s, now);
  const item = ((s.items || {}).data || [])[0] || {};
  const planKey = deps.keyOfPrice(env, (item.price || {}).id || '') || (s.metadata || {}).planKey || '';
  const plan = deps.planByKey(env, planKey) || {};
  const tier = tierOfKey(planKey, s.status);
  const list = parseDevices(s);
  const out = {
    code, sid: s.id, status: t.status, planKey, planName: plan.name || '', amount: plan.amount || '', tier: t.live ? tier : 'free',
    next: t.next || null, end: t.end, exp: t.exp || null, devices: viewDevices(list, dev), limit: deviceLimit(env), pass: null
  };
  if (t.live) {
    out.pass = await signPass(env, { v: 1, t: tier, k: planKey, sid: s.id, c: await hashId(cusOf(s)), d: dev, st: t.status, iat: now, exp: t.exp, end: t.end || null });
  }
  return out;
}

/* ------------------------------------------------------------------ 受け口 */
/**
 * /key/… の頼み。ログインは使わない(利用の鍵が本人の印)。
 * deps: { stripe, stripePrices, keyOfPrice, planByKey, founderOpen(env)→Promise<bool>, isYearKey, YEAR_REFUND_DAYS, appFor, trialDays }
 */
export async function handleKey(path, body, env, deps, now = Date.now()) {
  body = body || {};
  if (path === '/key/checkout') {
    const key = String(body.planKey || ''), price = deps.stripePrices(env)[key];
    if (!price) throw err('このプランは、いまカードで申し込めません', 400, 'no-price');
    if (/^founder_/.test(key) && !(await deps.founderOpen(env))) throw err('先着の価格の受付は終わりました', 409, 'founder-closed');
    const app = deps.appFor(env, body), year = deps.isYearKey(key), trial = !year;
    const meta = { mode: 'key', planKey: key };
    const subMeta = year ? { ...meta, refundDays: String(deps.YEAR_REFUND_DAYS) } : meta;
    const days = deps.trialDays(env);
    const s = await deps.stripe(env, 'POST', '/checkout/sessions', {
      mode: 'subscription', locale: 'ja',
      line_items: [{ price, quantity: 1 }],
      success_url: app + 'mypage/?session_id={CHECKOUT_SESSION_ID}#mp-key',
      cancel_url: app + 'plans/?plan=' + key.replace(/^founder_/, 'total_') + '#pl-step2',
      metadata: meta,
      subscription_data: trial ? { metadata: subMeta, trial_period_days: days } : { metadata: subMeta },
      custom_text: { submit: { message: deps.keyNote(key, trial, env, now) } }
    });
    return { url: s.url, trial };
  }
  const dev = cleanDevice(body.device);
  if (path === '/key/claim') {
    if (!dev) throw err('端末の番号がありません', 400, 'no-device');
    const sid = String(body.sessionId || '');
    if (!/^cs_[\w-]+$/.test(sid)) throw err('お申し込みの番号が違います', 400, 'bad-session');
    const cs = await deps.stripe(env, 'GET', '/checkout/sessions/' + encodeURIComponent(sid));
    if (!cs || cs.mode !== 'subscription' || (cs.metadata || {}).mode !== 'key') throw err('このお申し込みからは鍵を受け取れません', 400, 'bad-session');
    if (cs.status !== 'complete') throw err('お申し込みがまだ済んでいません', 409, 'not-complete');
    if (now - secMs(cs.created) > CLAIM_DAYS * DAY) throw err('自動の受け取りの期限が過ぎました。請求書・領収書に載っている「利用の鍵」を入れてください', 410, 'claim-expired');
    const subId = typeof cs.subscription === 'string' ? cs.subscription : (cs.subscription || {}).id;
    const s = await getSub(deps, env, subId);
    const code = await ensureCode(deps, env, s);
    return useDevice(deps, env, s, code, dev, body.label, now, false);
  }
  const code = normCode(body.code);
  if (path.startsWith('/key/') && !code) throw err('利用の鍵の形が違います(16文字。例 ABCD-EFGH-JKLM-NPQR)', 400, 'bad-code');
  if (!dev) throw err('端末の番号がありません', 400, 'no-device');
  const s = await findByCode(deps, env, code, String(body.sid || ''));
  if (!s) throw err('この利用の鍵は見つかりません。作り直した後の古い鍵か、打ち間違いかもしれません(申し込み直後なら1分ほど待ってからもう一度)', 404, 'no-key');
  if (path === '/key/renew') return useDevice(deps, env, s, code, dev, body.label, now, !!body.known);
  const list = parseDevices(s);
  const mine = list.some(x => x.i === dev);
  if (path === '/key/devices/remove') {
    // 鍵を持っている人だけが外せる。端末がいっぱいで新しい端末から外す時もここ
    const target = cleanDevice(body.target);
    const next = list.filter(x => x.i !== target);
    if (next.length !== list.length) await saveMeta(deps, env, s, { zw_dev: JSON.stringify(next) });
    return { devices: viewDevices(next, dev), limit: deviceLimit(env) };
  }
  if (!mine) throw err('この端末は、この鍵の端末に入っていません。もう一度、利用の鍵を入れてください', 403, 'device-removed');
  if (path === '/key/portal') {
    const cus = cusOf(s); if (!cus) throw err('契約の中身を読めませんでした', 502);
    const p = await deps.stripe(env, 'POST', '/billing_portal/sessions', { customer: cus, locale: 'ja', return_url: deps.appFor(env, body) + 'mypage/?back=1#mp-key' });
    return { url: p.url };
  }
  if (path === '/key/rotate') {
    // 鍵を作り直す: 古い鍵は使えなくなり、端末はこの端末だけになる(ほかの端末には新しい鍵を入れ直す)
    const gen = Number((s.metadata || {}).zw_gen || 0) + 1;
    const fresh = await codeFor(env, s.id, gen);
    const me = list.find(x => x.i === dev);
    await saveMeta(deps, env, s, { zw_key: fresh, zw_gen: String(gen), zw_dev: JSON.stringify([me]) });
    await putReceiptCode(deps, env, s, fresh);
    return answer(deps, env, s, fresh, dev, now);
  }
  throw err('not found', 404);
}
async function useDevice(deps, env, s, code, dev, label, now, known) {
  const r = touchDevice(parseDevices(s), dev, label, now, deviceLimit(env), known);
  if (r.removed) throw err('この端末は、ほかの端末から外されました。続けて使う時は、利用の鍵をもう一度入れてください', 403, 'device-removed');
  if (r.full) throw err('この鍵で使える端末(' + deviceLimit(env) + '台)がいっぱいです。使っていない端末を外してください', 409, 'devices-full', { devices: viewDevices(r.list, dev), limit: deviceLimit(env), code });
  if (r.changed) await saveMeta(deps, env, s, { zw_dev: JSON.stringify(r.list) });
  return answer(deps, env, s, code, dev, now);
}

/** Webhook: 利用の鍵の契約なら、鍵を付けておく(請求書に載せるため)。名簿には何も書かない */
export async function onKeySubscription(deps, env, s) {
  if (((s && s.metadata) || {}).mode !== 'key') return null;
  if (LIVE.includes(s.status)) await ensureCode(deps, env, s);
  return { key: true, status: s.status };
}

/* ------------------------------------------------------------------ 有料の画面のプログラムを、証明を確かめてから渡す(置き場を Cloudflare に移した後に使う) */
/** PAID_JS(KV)に置いた部品を、証明の段が足りる時だけ返す。PAID_TIERS(JSON {名前: 段})で部品ごとの段を決める(既定 light) */
export async function servePaid(name, pass, env, now = Date.now()) {
  if (!/^[a-z0-9-]{1,40}\.js$/.test(name)) return { status: 404, body: 'not found' };
  if (!env.PAID_JS || typeof env.PAID_JS.get !== 'function') return { status: 503, body: '準備中' };
  const p = await verifyPass(env, pass, now);
  if (!p) return { status: 401, body: '利用の鍵の期限が切れたか、確かめられませんでした' };
  let need = 'light'; try { need = (JSON.parse(env.PAID_TIERS || '{}')[name]) || 'light'; } catch { /* 既定 */ }
  if ((RANK[p.t] || 0) < (RANK[need] || 1)) return { status: 403, body: 'このプランでは使えません' };
  const js = await env.PAID_JS.get(name);
  if (js == null) return { status: 404, body: 'not found' };
  return { status: 200, body: js };
}
