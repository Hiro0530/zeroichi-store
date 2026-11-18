/**
 * 利用の鍵の決済の受け口: PayPal(2026-11-18。Stripe の指摘を受けたオーナー決定「B: せどりアプリの決済を PayPal に切り替える」)
 *
 * key.js の handleKey は、決済の種類に寄らない形で「申し込み → 鍵の発行 → 証明の更新 → 端末 → 止める」を進め、
 * 決済ごとの違いだけをこの「受け口(adapter)」に任せる。Stripe の受け口は key.js の stripeAdapter。
 *
 * PayPal と Stripe の違い(この受け口で吸収する所)
 *  - 契約にメタデータを置けない(custom_id 127文字だけ) → 鍵・作り直しの回数・端末の一覧・使える最後の日は
 *    Cloudflare の KV(binding ZW_KEYS)に、契約番号(I-…)をキーにして置く。名前・メール・住所は置かない(名簿は作らない)。
 *      s:<契約番号> = { zw_key, zw_gen, zw_dev, nb(次の請求日), end(使える最後の時刻), refunded }
 *      c:<鍵>       = 契約番号(別の端末で鍵を入れた時に探すため。Stripe の検索の代わり)
 *      r:<支払う人のハッシュ> = 1(年払いの全額返金は同じ PayPal アカウントで1回まで)
 *  - 請求書に「利用の鍵」を載せられない → 鍵はマイページで見せるだけ。なくした時は、PayPal の画面に出る契約番号(I-…)で受け取り直す(下の claim)。
 *  - カードの指紋が無い → 返金の繰り返しは「支払う人の番号(payer_id)」の合言葉つきハッシュで見る(カードを替えても同じ PayPal アカウントなら見分けられる)。
 *  - 客の「契約の管理」の画面が無い → 解約はアプリの「解約する」(/key/cancel)と、PayPal の「自動支払い」の画面の両方で受ける。
 *  - 解約するとその場で CANCELLED になる(期間の終わりまで待たない) → 解約の前に「次の請求日」を end に控え、そこまでは使える。
 *    PayPal の画面で解約された時は、控えた次の請求日か「最後の支払い+1か月(年払いは1年)」の遅い方を end にする。
 * 秘密の値: PAYPAL_SECRET・PAYPAL_WEBHOOK_ID(wrangler secret)。変数: PAYPAL_CLIENT_ID・PAYPAL_ENV・PAYPAL_PLAN_<プランのキーの大文字>。
 * 3つ(Client ID・Secret・KV)とプランIDが揃うまで「準備中」(料金ページは申し込めない表示。Stripe の鍵が無い時と同じ動き)。
 * PAYPAL_ENV が sandbox(既定)の間は PayPal の試験の環境に向く(本物のお金は動かない)。
 */
import { secretHash } from './key.js';

const DAY = 864e5;
export const PP_PLAN_KEYS = ['light_month', 'light_year', 'total_month', 'total_year', 'founder_month', 'founder_year', 'business_month', 'business_year'];
const CUSTOM = 'zwkey:';
const isYear = k => /_year$/.test(String(k || ''));
const err = (msg, status, code) => { const e = new Error(msg); e.status = status; if (code) e.code = code; return e; };
const ms = v => { const n = Date.parse(v || ''); return isNaN(n) ? 0 : n; };
function addMonths(t, n) { const d = new Date(t); d.setUTCMonth(d.getUTCMonth() + n); return d.getTime(); }

/** プランのキー → PayPal のプランID(P-…)。空欄のプランは申し込めない */
export function paypalPlans(env) {
  const m = {};
  for (const k of PP_PLAN_KEYS) { const id = String(env['PAYPAL_PLAN_' + k.toUpperCase()] || '').trim(); if (/^P-[A-Z0-9]{6,}$/.test(id)) m[k] = id; }
  return m;
}
export function paypalReady(env) {
  return !!(env.PAYPAL_CLIENT_ID && env.PAYPAL_SECRET && env.ZW_KEYS && typeof env.ZW_KEYS.get === 'function' && !/ここに/.test(String(env.PAYPAL_CLIENT_ID)));
}
export function paypalPortalUrl(env) { return (env.PAYPAL_ENV === 'live' ? 'https://www.paypal.com' : 'https://www.sandbox.paypal.com') + '/myaccount/autopay/'; }

/** 契約の中身 + KV の控え → 証明の期限(key.js の passTerms と同じ形) */
export function ppTerms(s, st, now, life, planKey, grace = 3) {
  st = st || {};
  const bi = s.billing_info || {};
  const next = ms(bi.next_billing_time);
  const last = ms(((bi.last_payment || {}).time));
  const failed = Number(bi.failed_payments_count || 0), owing = Number(((bi.outstanding_balance || {}).value) || 0);
  if (s.status === 'ACTIVE') {
    if (failed > 0 || owing > 0) return { live: true, exp: now + life, end: null, status: 'past_due' };
    const base = next || Number(st.nb || 0);
    return { live: true, exp: Math.min(Math.max(base, now) + grace * DAY, now + life), end: null, status: 'active', next: base || null };
  }
  if (s.status === 'CANCELLED') {
    const end = Number(st.end || 0) || Math.max(Number(st.nb || 0), last ? addMonths(last, isYear(planKey) ? 12 : 1) : 0) || ms(s.status_update_time) || now;
    if (end > now) return { live: true, exp: Math.min(end, now + life), end, status: 'ending' };
    return { live: false, exp: 0, end, status: 'ended' };
  }
  if (s.status === 'SUSPENDED') return { live: false, exp: 0, end: ms(s.status_update_time) || now, status: 'suspended' };
  if (s.status === 'EXPIRED') return { live: false, exp: 0, end: ms(s.status_update_time) || now, status: 'ended' };
  return { live: false, exp: 0, end: null, status: 'incomplete' };   // APPROVAL_PENDING・APPROVED(支払いの確定待ち)
}

/**
 * PayPal の受け口。deps: { paypal(env, method, path, body, headers) , planByKey(env, key) }
 */
export function paypalAdapter(deps) {
  const kv = env => env.ZW_KEYS;
  const keyOfPlan = (env, id) => Object.entries(paypalPlans(env)).find(([, v]) => v === id)?.[0] || '';
  async function loadState(env, id) { const t = await kv(env).get('s:' + id); try { return t ? JSON.parse(t) : {}; } catch { return {}; } }
  async function get(env, id) {
    if (!/^I-[A-Z0-9]{6,30}$/.test(String(id || ''))) return null;
    let s; try { s = await deps.paypal(env, 'GET', '/v1/billing/subscriptions/' + encodeURIComponent(id)); } catch { return null; }
    if (!s || !String(s.custom_id || '').startsWith(CUSTOM)) return null;   // 利用の鍵の申し込みでない契約(古いログインの形など)は扱わない
    s._st = await loadState(env, id);
    return s;
  }
  const planKey = (env, s) => keyOfPlan(env, s.plan_id) || String(s.custom_id || '').slice(CUSTOM.length) || '';
  async function save(env, s, meta) {
    const prev = s._st || {};
    const next = { ...prev, ...meta };
    await kv(env).put('s:' + s.id, JSON.stringify(next));
    if (meta.zw_key && meta.zw_key !== prev.zw_key) {
      await kv(env).put('c:' + meta.zw_key, s.id);
      if (prev.zw_key) await kv(env).delete('c:' + prev.zw_key);
    }
    s._st = next;
    return s;
  }
  /** 年払いの1回目のお支払いから30日以内の解約: 全額を返金して、その日で終える。同じ PayPal アカウントでは1回まで */
  async function yearRefund(env, s, now) {
    const pk = planKey(env, s), st = s._st || {};
    if (!isYear(pk) || st.refunded) return null;
    const start = ms(s.start_time) || ms(s.create_time);
    if (!start || now > start + 30 * DAY) return null;
    const payer = String((s.subscriber || {}).payer_id || '');
    const h = payer ? await secretHash(env, 'zw-pp', payer) : '';
    if (h && await kv(env).get('r:' + h)) { await save(env, s, { refund_denied: 'repeat' }); return { refused: 'repeat' }; }
    const q = `start_time=${encodeURIComponent(new Date(start - DAY).toISOString())}&end_time=${encodeURIComponent(new Date(now + DAY).toISOString())}`;
    const tx = await deps.paypal(env, 'GET', `/v1/billing/subscriptions/${encodeURIComponent(s.id)}/transactions?${q}`);
    const t = ((tx && tx.transactions) || []).filter(x => x && x.status === 'COMPLETED' && Number(((x.amount_with_breakdown || {}).gross_amount || {}).value || 0) > 0)
      .sort((a, b) => ms(a.time) - ms(b.time))[0];
    if (!t) return null;   // 見つからない時は返金も早めの終了もしない(メールの窓口で受ける)
    const rf = await deps.paypal(env, 'POST', `/v1/payments/sale/${encodeURIComponent(t.id)}/refund`, {}, { 'PayPal-Request-Id': 'zw-year-refund-' + s.id });
    if (h) await kv(env).put('r:' + h, '1');
    await save(env, s, { refunded: '1', refund_id: String((rf && rf.id) || ''), end: now });
    return { amount: Number(((t.amount_with_breakdown || {}).gross_amount || {}).value || 0) };
  }
  return {
    name: 'paypal',
    ready: env => paypalReady(env),
    canFind: env => paypalReady(env),
    plans: env => (paypalReady(env) ? paypalPlans(env) : {}),
    async checkout(env, key, app) {
      if (!paypalReady(env)) throw err('PayPal のお支払いは準備中です', 503, 'not-ready');
      const plan = paypalPlans(env)[key];
      if (!plan) throw err('このプランは、いま PayPal で申し込めません', 400, 'no-price');
      const r = await deps.paypal(env, 'POST', '/v1/billing/subscriptions', {
        plan_id: plan, custom_id: CUSTOM + key,
        application_context: {
          brand_name: 'ZEROICHI WORKS', locale: 'ja-JP', shipping_preference: 'NO_SHIPPING', user_action: 'SUBSCRIBE_NOW',
          return_url: app + 'mypage/?pp=1#mp-key', cancel_url: app + 'plans/?plan=' + key.replace(/^founder_/, 'total_') + '#pl-step2'
        }
      }, { 'PayPal-Request-Id': 'zw-co-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) });
      const a = ((r && r.links) || []).find(l => l.rel === 'approve');
      if (!a) throw err('PayPal の画面を作れませんでした', 502);
      return { url: a.href };
    },
    /** 申し込み直後(PayPal の画面から戻った時)と、鍵をなくした時: 契約番号(I-…)で、その端末に鍵を渡す。
     *  契約番号は、払った本人の PayPal の画面と、戻りの住所にしか出ない(Stripe の申し込みの番号と同じ扱い)。
     *  受け取れるのは、申し込みから2日以内か、まだどの端末にも鍵が入っていない契約だけ(それ以外は鍵で入れる) */
    async claim(env, body, now, claimDays) {
      if (!paypalReady(env)) throw err('PayPal のお支払いは準備中です', 503, 'not-ready');
      const id = String(body.subscriptionId || '').trim().toUpperCase();
      if (!/^I-[A-Z0-9]{6,30}$/.test(id)) throw err('PayPal の契約番号の形が違います(I- で始まる番号)', 400, 'bad-session');
      const s = await get(env, id);
      if (!s) throw err('このお申し込みからは鍵を受け取れません', 400, 'bad-session');
      if (s.status === 'APPROVAL_PENDING' || s.status === 'APPROVED') throw err('PayPal でのお支払いの確定を待っています。数秒後にもう一度お試しください', 409, 'not-complete');
      const started = ms(s.start_time) || ms(s.create_time) || now;
      const devs = (() => { try { return JSON.parse((s._st || {}).zw_dev || '[]'); } catch { return []; } })();
      if (now - started > claimDays * DAY && devs.length) throw err('自動の受け取りの期限が過ぎました。マイページに出ていた「利用の鍵」を入れてください', 410, 'claim-expired');
      return s;
    },
    async find(env, code, sid) {
      if (!paypalReady(env)) return null;
      if (/^I-/.test(sid || '')) { const s = await get(env, sid); if (s && (s._st || {}).zw_key === code) return s; }
      const id = await kv(env).get('c:' + code);
      if (!id) return null;
      const s = await get(env, id);
      return s && (s._st || {}).zw_key === code ? s : null;
    },
    meta: s => s._st || {},
    save,
    receipt: async () => { /* PayPal には請求書に載せる欄が無い。鍵はマイページで見せる */ },
    terms: (s, now, life, env) => ppTerms(s, s._st, now, life, planKey(env, s)),
    planKey,
    customer: s => String((s.subscriber || {}).payer_id || s.id || ''),
    async portal(env) { return { url: paypalPortalUrl(env), provider: 'paypal' }; },
    /** アプリの「解約する」: 次の請求日を控えてから PayPal で止める。年払いの30日以内なら全額返金してその日で終える */
    async cancel(env, s, now) {
      if (s.status === 'CANCELLED' || s.status === 'EXPIRED') return s;
      const nb = ms((s.billing_info || {}).next_billing_time);
      if (nb) await save(env, s, { nb, end: Math.max(nb, now) });
      const r = s.status === 'ACTIVE' ? await yearRefund(env, s, now) : null;
      await deps.paypal(env, 'POST', `/v1/billing/subscriptions/${encodeURIComponent(s.id)}/cancel`, { reason: r && r.amount ? '年払いの30日以内の解約(全額返金)' : '利用者による解約(アプリから)' });
      const fresh = await get(env, s.id);
      if (r) (fresh || s)._refund = r;
      return fresh || s;
    },
    /** Webhook: 次の請求日を控える・鍵を付ける・PayPal の画面で解約された時の終わりの日と返金 */
    async onEvent(env, s, type, now, ensure) {
      const st = s._st || {};
      const nb = ms((s.billing_info || {}).next_billing_time);
      if (s.status === 'ACTIVE') {
        if (nb && nb !== Number(st.nb || 0)) await save(env, s, { nb });
        await ensure(s);
        return { key: true, status: 'active' };
      }
      if (s.status === 'CANCELLED') {
        let refund = null;
        if (!st.end) {
          const t = ppTerms(s, st, now, DAY, planKey(env, s));
          await save(env, s, { end: t.end || now });
          refund = await yearRefund(env, s, now).catch(() => null);
        }
        return { key: true, status: 'canceled', refund, type };
      }
      return { key: true, status: String(s.status || '').toLowerCase(), type };
    },
    get,
    _yearRefund: yearRefund
  };
}
