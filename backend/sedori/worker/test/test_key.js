// 利用の鍵(src/key.js)の検算。Stripe は偽物(メモリの中)。実行: node test/test_key.js(test_worker.js の最後からも呼ぶ)
import assert from 'node:assert';
import { createHmac } from 'node:crypto';
import W, { keyDeps } from '../src/index.js';
import { normCode, codeFor, signPass, verifyPass, passTerms, passMs, touchDevice, tierOfKey, handleKey, servePaid, publicJwk, GRACE_DAYS, STALE_DEVICE_DAYS } from '../src/key.js';

let n = 0;
function eq(a, b, msg) { assert.deepStrictEqual(a, b, `${msg}: 実際 ${JSON.stringify(a)} / 期待 ${JSON.stringify(b)}`); n++; }
async function rejects(p, code, msg) { try { await p; } catch (e) { eq(e.code, code, msg); return e; } assert.fail(msg + ': 例外が出ない'); }
const DAY = 864e5, sec = ms => Math.floor(ms / 1000);
const NOW = Date.parse('2026-11-17T03:00:00Z');

/* ---------- 試験のための署名の鍵(この試験の中だけで作る) ---------- */
async function pair() {
  const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return JSON.stringify(await crypto.subtle.exportKey('jwk', k.privateKey));
}
const JWK1 = await pair(), JWK2 = await pair();
const env = {
  STRIPE_SECRET_KEY: 'sk_test_fake', STRIPE_WEBHOOK_SECRET: 'whsec_fake', KEY_SIGNING_JWK: JWK1, KEY_CODE_SECRET: 'code-secret',
  ALLOWED_ORIGIN: 'https://hiro0530.github.io', APP_URL: 'https://zeroichiworks.net/sedori/',
  STRIPE_PRICE_LIGHT_MONTH: 'price_lm', STRIPE_PRICE_TOTAL_MONTH: 'price_tm', STRIPE_PRICE_TOTAL_YEAR: 'price_ty', STRIPE_PRICE_BUSINESS_MONTH: 'price_bm', STRIPE_PRICE_FOUNDER_MONTH: 'price_fm'
};

/* ---------- 偽物の Stripe ---------- */
const subs = {}, sessions = {}, customers = {}, sent = [], charges = {}, cards = {};
let searchLag = false;
globalThis.fetch = async (url, init = {}) => {
  url = String(url); const method = init.method || 'GET';
  const res = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
  if (url.startsWith('https://firestore.googleapis.com') || url.startsWith('https://oauth2.googleapis.com')) throw new Error('Firestore を呼ばない約束: ' + url);
  if (!url.startsWith('https://api.stripe.com/v1/')) throw new Error('想定外の通信 ' + url);
  assert.equal(init.headers.Authorization, 'Bearer sk_test_fake');
  const u = new URL(url), path = u.pathname.replace(/^\/v1/, '');
  const form = Object.fromEntries(new URLSearchParams(init.body || ''));
  sent.push({ method, path, form, q: Object.fromEntries(u.searchParams) });
  if (path === '/subscriptions/search') {
    const m = (u.searchParams.get('query') || '').match(/^metadata\['zw_key'\]:'([^']+)'$/);
    return res({ data: searchLag ? [] : Object.values(subs).filter(s => m && s.metadata.zw_key === m[1]) });
  }
  if (path === '/invoices') return res({ data: [{ id: 'in_' + u.searchParams.get('subscription'), amount_paid: 49800, payment_intent: 'pi_' + u.searchParams.get('subscription'), created: 1 }] });
  let mp = path.match(/^\/payment_intents\/pi_(.+)$/);
  if (mp) { const c = cards[mp[1]] || { fp: 'fpA', email: 'a@example.com' }; charges['ch_' + mp[1]] = charges['ch_' + mp[1]] || { id: 'ch_' + mp[1], metadata: {} };
    return res({ id: 'pi_' + mp[1], latest_charge: { id: 'ch_' + mp[1], payment_method_details: { card: { fingerprint: c.fp } }, billing_details: { email: c.email } } }); }
  if (path === '/charges/search') {
    const q = u.searchParams.get('query') || '', want = [...q.matchAll(/metadata\['(\w+)'\]:'([^']+)'/g)].map(m => [m[1], m[2]]);
    return res({ data: searchLag ? [] : Object.values(charges).filter(c => want.some(([k, v]) => c.metadata[k] === v)) });
  }
  mp = path.match(/^\/charges\/([^/]+)$/);
  if (mp && method === 'POST') { const c = charges[mp[1]] = charges[mp[1]] || { id: mp[1], metadata: {} }; for (const [k, v] of Object.entries(form)) { const mm = k.match(/^metadata\[(\w+)\]$/); if (mm) c.metadata[mm[1]] = v; } return res(c); }
  if (path === '/refunds' && method === 'POST') return res({ id: 're_1', amount: 49800 });
  let m = path.match(/^\/subscriptions\/([^/]+)$/);
  if (m) {
    const s = subs[decodeURIComponent(m[1])]; if (!s) return res({ error: { message: 'No such subscription' } }, 404);
    if (method === 'DELETE') { s.status = 'canceled'; s.ended_at = sec(Date.now()); return res(s); }
    if (method === 'POST') for (const [k, v] of Object.entries(form)) { const mm = k.match(/^metadata\[(\w+)\]$/); if (mm) s.metadata[mm[1]] = v; }
    return res(s);
  }
  m = path.match(/^\/customers\/([^/]+)$/);
  if (m && method === 'POST') { customers[m[1]] = form; return res({ id: m[1] }); }
  if (path === '/checkout/sessions' && method === 'POST') { const id = 'cs_new' + (Object.keys(sessions).length + 1); sessions[id] = { id, form }; return res({ id, url: 'https://checkout.stripe.com/c/pay/' + id }); }
  m = path.match(/^\/checkout\/sessions\/([^/]+)$/);
  if (m) return sessions[m[1]] ? res(sessions[m[1]]) : res({ error: { message: 'no' } }, 404);
  if (path === '/billing_portal/sessions') return res({ url: 'https://billing.stripe.com/p/session/k1', customer: form.customer });
  throw new Error('想定外の Stripe ' + method + ' ' + path);
};
function mkSub(id, o = {}) {
  subs[id] = Object.assign({ id, status: 'active', customer: 'cus_' + id, metadata: { mode: 'key', planKey: 'total_month' }, cancel_at_period_end: false, cancel_at: null, pause_collection: null,
    items: { data: [{ id: 'si_' + id, price: { id: 'price_tm' }, current_period_end: sec(NOW + 20 * DAY) }] } }, o);
  return subs[id];
}
function mkSession(id, subId, o = {}) { sessions[id] = Object.assign({ id, mode: 'subscription', status: 'complete', subscription: subId, metadata: { mode: 'key', planKey: 'total_month' }, created: sec(NOW - 600) }, o); }
const H = (path, body, e = env, now = NOW) => handleKey(path, body, e, keyDeps, now);

/* ---------- 1. 鍵の文字 ---------- */
{
  const c0 = await codeFor(env, 'sub_A', 0);
  eq(/^[2-9A-HJ-NP-Z]{4}(-[2-9A-HJ-NP-Z]{4}){3}$/.test(c0), true, '鍵は16文字(4つずつ区切る。0・1・I・O を使わない)');
  eq(await codeFor(env, 'sub_A', 0), c0, '同じ契約なら同じ鍵(同時に2か所で作っても食い違わない)');
  eq((await codeFor(env, 'sub_A', 1)) !== c0, true, '作り直すと別の鍵');
  eq((await codeFor({ KEY_CODE_SECRET: 'other' }, 'sub_A', 0)) !== c0, true, '合言葉が違えば別の鍵(契約番号だけでは作れない)');
  eq([normCode(c0.toLowerCase().replace(/-/g, ' ')), normCode('ABCD-EFGH-JKLM-NPQ0'), normCode('abc')], [c0, '', ''], '入力のそろえ方(小文字・空白は受ける/0 や短いものは受けない)');
}

/* ---------- 2. 証明の署名 ---------- */
{
  const p = await signPass(env, { v: 1, t: 'total', exp: NOW + DAY });
  eq((await verifyPass(env, p, NOW)).t, 'total', '正しい証明');
  eq((await verifyPass(env, p, NOW)).m, 'live', '本物の鍵で署名した証明');
  const [b, s] = p.split('.');
  const forged = Buffer.from(JSON.stringify({ v: 1, t: 'business', exp: NOW + 99 * DAY, m: 'live' })).toString('base64url') + '.' + s;
  eq(await verifyPass(env, forged, NOW), null, '中身を書き換えた証明(業務に変えた)は通らない');
  eq(await verifyPass(env, await signPass({ ...env, KEY_SIGNING_JWK: JWK2 }, { v: 1, t: 'total', exp: NOW + DAY }), NOW), null, '別の鍵で署名した証明は通らない');
  eq(await verifyPass(env, p, NOW + 2 * DAY), null, '期限切れの証明は通らない');
  eq(await verifyPass(env, b + '.test', NOW), null, '署名の鍵がある時は、試験用(署名なし)の証明を受けない');
  const noKey = { ...env, KEY_SIGNING_JWK: '' };
  const tp = await signPass(noKey, { v: 1, t: 'light', exp: NOW + DAY });
  eq([tp.endsWith('.test'), (await verifyPass(noKey, tp, NOW)).m], [true, 'test'], '署名の鍵が無い間は試験用の証明(m=test)');
  eq(Object.keys(publicJwk(env)).sort(), ['crv', 'kty', 'x', 'y'], '公開してよい鍵には秘密の部分(d)を入れない');
}

/* ---------- 3. 契約 → 期限 ---------- */
{
  const end = NOW + 20 * DAY;
  const s = mkSub('sub_T');
  eq(passTerms(s, NOW), { live: true, exp: NOW + DAY, end: null, status: 'active', next: end }, 'お支払い中: 証明は1日ずつ(11/17 21:50 の決定。次の請求日が先でも)');
  eq(passTerms(s, NOW, 7 * DAY).exp, NOW + 7 * DAY, '期限は設定で変えられる(KEY_PASS_HOURS)');
  eq([passMs({}), passMs({ KEY_PASS_HOURS: '12' }), passMs({ KEY_PASS_HOURS: '0' }), passMs({ KEY_PASS_HOURS: '999' })], [DAY, DAY / 2, DAY, DAY], '設定の期限(1〜168時間。外れた値は既定の24時間)');
  eq(passTerms(s, end - DAY / 4, 7 * DAY).exp, end + GRACE_DAYS * DAY, '請求日の近くは、請求日+3日まで(期限が長い設定の時)');
  eq(passTerms({ ...s, status: 'past_due' }, NOW), { live: true, exp: NOW + DAY, end: null, status: 'past_due' }, '支払いの失敗中: 1日ずつ(Stripe が再請求している間)');
  eq(passTerms({ ...s, cancel_at_period_end: true }, NOW), { live: true, exp: NOW + DAY, end, status: 'ending' }, '解約済み: 使える最後の日を返す');
  eq(passTerms({ ...s, cancel_at_period_end: true }, end - DAY).exp, end, '解約済み: 証明は期間の終わりちょうどまで(上乗せなし)');
  eq(passTerms({ ...s, status: 'canceled', ended_at: sec(NOW - DAY) }, NOW), { live: false, exp: 0, end: NOW - DAY, status: 'ended' }, '終わった契約: 証明を出さない');
  eq(passTerms({ ...s, pause_collection: { behavior: 'void' } }, NOW).live, false, '止めている契約: 証明を出さない');
  eq([tierOfKey('light_month'), tierOfKey('founder_year'), tierOfKey('business_month'), tierOfKey('light_month', 'trialing')], ['light', 'total', 'business', 'light'], '段: 先着は総合。無料のお試しは無いので、状態で段は上がらない');
}

/* ---------- 4. 端末の数え ---------- */
{
  const d = Math.floor(NOW / DAY);
  let r = touchDevice([], 'dev00001', 'iPhone', NOW, 3, false);
  eq([r.list.length, r.changed, r.full], [1, true, false], '1台目を足す');
  r = touchDevice([{ i: 'a', t: d }, { i: 'b', t: d }, { i: 'c', t: d }], 'dev00004', 'Mac', NOW, 3, false);
  eq([r.full, r.list.length], [true, 3], '4台目はいっぱい');
  r = touchDevice([{ i: 'a', t: d - STALE_DEVICE_DAYS - 1 }, { i: 'b', t: d }, { i: 'c', t: d }], 'dev00004', 'Mac', NOW, 3, false);
  eq([r.full, r.list.map(x => x.i)], [false, ['b', 'c', 'dev00004']], '35日使っていない端末は自動で外れ、新しい端末が入る');
  r = touchDevice([{ i: 'b', t: d }], 'dev00009', 'x', NOW, 3, true);
  eq(r.removed, true, '外された端末(前に使っていた)は、自分では戻らない');
  r = touchDevice([{ i: 'dev00001', t: d - 2 }], 'dev00001', 'x', NOW, 3, true);
  eq(r.changed, false, '最後に使った日の書き直しは7日に1回まで');
}

/* ---------- 5. 申し込み → 鍵が入る → 端末 → 契約の管理 → 作り直し → 解約 ---------- */
{
  const co = await H('/key/checkout', { planKey: 'total_month', app: 'https://hiro0530.github.io/test-copy/' });
  const f = sessions[Object.keys(sessions).pop()].form;
  eq([/^https:\/\/checkout\.stripe\.com\//.test(co.url), 'trial' in co, f['metadata[mode]'], f['subscription_data[metadata][mode]'], f['subscription_data[trial_period_days]'], 'client_reference_id' in f, 'customer_email' in f],
    [true, false, 'key', 'key', undefined, false, false], 'ログインなしで申し込み画面を作る(名簿の番号を付けない・無料のお試しを付けない)');
  eq([/無料/.test(f['custom_text[submit][message]']), /今日、1回目の4,980円/.test(f['custom_text[submit][message]']), /払った期間の終わりまで使えます/.test(f['custom_text[submit][message]'])], [false, true, true], '申し込み画面の文: お試しなし・今日1回目を請求・解約しても期間の終わりまで');
  const coM = await H('/key/checkout', { planKey: 'business_month' }, { ...env, TRIAL_DAYS: '14' });
  eq([sessions[Object.keys(sessions).pop()].form['subscription_data[trial_period_days]'], 'trial' in coM], [undefined, false], 'TRIAL_DAYS が残っていても、利用の鍵の申し込みにはお試しを付けない');
  eq([f.success_url, f.cancel_url], ['https://hiro0530.github.io/test-copy/mypage/?session_id={CHECKOUT_SESSION_ID}#mp-key', 'https://hiro0530.github.io/test-copy/plans/?plan=total_month#pl-step2'], '戻り先は試験版の写しのマイページ');
  eq(/利用の鍵/.test(f['custom_text[submit][message]']) && /契約の管理/.test(f['custom_text[submit][message]']), true, '申し込み画面に「鍵が入る」「契約の管理から自分で解約」と書く');
  await rejects(H('/key/checkout', { planKey: 'light_year' }), 'no-price', '価格の無いプランは断る');

  mkSub('sub_K1'); mkSession('cs_ok1', 'sub_K1');
  const a = await H('/key/claim', { sessionId: 'cs_ok1', device: 'devaaaa1', label: 'iPhone' });
  eq([!!normCode(a.code), a.tier, a.status, a.devices.length, a.devices[0].me], [true, 'total', 'active', 1, true], '支払いが済むと、この端末に鍵と証明が入る');
  eq(subs.sub_K1.metadata.zw_key, a.code, '鍵は Stripe の契約に置く(こちらの名簿は無い)');
  eq(customers.cus_sub_K1['invoice_settings[custom_fields][0][value]'], a.code, '請求書・領収書にも利用の鍵を載せる');
  const p = await verifyPass(env, a.pass, NOW);
  eq([p.t, p.sid, p.d, p.exp, /^[0-9a-f]{16}$/.test(p.c), JSON.stringify(p).includes('cus_')], ['total', 'sub_K1', 'devaaaa1', NOW + DAY, true, false], '証明の中身(客番号はハッシュだけ・期限は1日)');
  const again = await H('/key/claim', { sessionId: 'cs_ok1', device: 'devaaaa1' });
  eq(again.code, a.code, 'もう一度受け取っても同じ鍵');
  mkSession('cs_wait', 'sub_K1', { status: 'open' });
  await rejects(H('/key/claim', { sessionId: 'cs_wait', device: 'devaaaa1' }), 'not-complete', '支払いが済んでいないお申し込み');
  mkSession('cs_old', 'sub_K1', { created: sec(NOW - 3 * DAY) });
  await rejects(H('/key/claim', { sessionId: 'cs_old', device: 'devzzzz1' }), 'claim-expired', '3日前のお申し込みは自動では受け取れない(鍵を入れてもらう)');
  mkSession('cs_login', 'sub_K1', { metadata: { uid: 'u1' } });
  await rejects(H('/key/claim', { sessionId: 'cs_login', device: 'devaaaa1' }), 'bad-session', 'ログイン型のお申し込みからは受け取れない');

  // 1日1回の更新
  const r1 = await H('/key/renew', { code: a.code, sid: 'sub_K1', device: 'devaaaa1', known: true }, env, NOW + DAY);
  eq([!!r1.pass, r1.tier, r1.devices.length], [true, 'total', 1], '同じ端末の更新');
  // 2台目・3台目は鍵を入れるだけ(検索で探す)
  for (const d of ['devbbbb2', 'devcccc3']) await H('/key/renew', { code: a.code.toLowerCase(), device: d, label: 'Mac' });
  eq(JSON.parse(subs.sub_K1.metadata.zw_dev).length, 3, '3台まで入る');
  const full = await rejects(H('/key/renew', { code: a.code, device: 'devdddd4' }), 'devices-full', '4台目はいっぱい');
  eq([full.extra.devices.length, full.extra.limit], [3, 3], 'いっぱいの時は、外す端末を選べるように一覧を返す');
  await H('/key/devices/remove', { code: a.code, device: 'devdddd4', target: 'devbbbb2' });
  eq((await H('/key/renew', { code: a.code, device: 'devdddd4' })).devices.length, 3, '1台外すと、新しい端末が入る');
  await rejects(H('/key/renew', { code: a.code, sid: 'sub_K1', device: 'devbbbb2', known: true }), 'device-removed', '外された端末は更新できない(無料の範囲に戻る)');
  searchLag = true;
  await rejects(H('/key/renew', { code: a.code, device: 'deveeee5' }), 'no-key', '検索の反映待ちの間は「見つからない」(1分ほど待つ案内)');
  eq(!!(await H('/key/renew', { code: a.code, sid: 'sub_K1', device: 'devaaaa1', known: true })).pass, true, '契約番号を覚えている端末は、検索を待たずに更新できる');
  searchLag = false;
  await rejects(H('/key/renew', { code: 'ABCD', device: 'devaaaa1' }), 'bad-code', '形の違う鍵');
  await rejects(H('/key/renew', { code: 'ABCD-EFGH-JKLM-NPQR', device: 'devaaaa1' }), 'no-key', '無い鍵');

  // 外された端末・作り直した鍵・解約は、翌日までに必ず効く(証明は1日。芯の問い合わせ /core は期限の切れた証明に答えない)
  {
    const { handleCore } = await import('../src/core.js');
    const oldB = (await H('/key/renew', { code: a.code, sid: 'sub_K1', device: 'devdddd4', known: true })).pass;   // 外す前に devdddd4 が持っていた証明
    const ask = (ps, dev, now) => handleCore({ pass: ps, device: dev, ops: [{ op: 'limits' }] }, env, now);
    await H('/key/devices/remove', { code: a.code, device: 'devaaaa1', target: 'devdddd4' });
    eq((await ask(oldB, 'devdddd4', NOW + DAY / 2)).tier, 'total', '外した端末: 手元の証明は期限(1日)までは通る');
    await rejects(ask(oldB, 'devdddd4', NOW + DAY + 1), 'pass-invalid', '外した端末: 翌日には芯が答えない');
    await rejects(H('/key/renew', { code: a.code, sid: 'sub_K1', device: 'devdddd4', known: true }, env, NOW + DAY), 'device-removed', '外した端末: 新しい証明は出ない');
    await H('/key/renew', { code: a.code, device: 'devdddd4', label: 'Mac' });   // 元に戻す(下の試験のため)
  }

  // 契約の管理(Stripe のカスタマーポータル)
  const po = await H('/key/portal', { code: a.code, sid: 'sub_K1', device: 'devaaaa1', app: 'https://hiro0530.github.io/test-copy/' });
  const pf = sent.filter(x => x.path === '/billing_portal/sessions').pop().form;
  eq([po.url, pf.customer, pf.return_url], ['https://billing.stripe.com/p/session/k1', 'cus_sub_K1', 'https://hiro0530.github.io/test-copy/mypage/?back=1#mp-key'], '「契約の管理」で Stripe の画面へ(解約・カード・領収書・プラン変更は客が自分で)');
  await rejects(H('/key/portal', { code: a.code, device: 'devbbbb2' }), 'device-removed', '鍵の端末に入っていない端末からは開けない');

  // 鍵の作り直し(漏れた時)
  const rot = await H('/key/rotate', { code: a.code, sid: 'sub_K1', device: 'devaaaa1' });
  eq([rot.code !== a.code, rot.devices.length, customers.cus_sub_K1['invoice_settings[custom_fields][0][value]']], [true, 1, rot.code], '作り直すと新しい鍵・端末はこの端末だけ・領収書の鍵も替わる');
  await rejects(H('/key/renew', { code: a.code, device: 'devdddd4' }), 'no-key', '古い鍵は使えない');

  // 解約(期間の終わりで終わる)→ 期限の日まで → 終わったら証明が出ない
  subs.sub_K1.cancel_at_period_end = true;
  const en = await H('/key/renew', { code: rot.code, sid: 'sub_K1', device: 'devaaaa1', known: true });
  eq([en.status, en.end, (await verifyPass(env, en.pass, NOW)).exp], ['ending', NOW + 20 * DAY, NOW + DAY], '解約後: 使える最後の日を返す(証明は1日ずつ)');
  {
    const { handleCore } = await import('../src/core.js');
    const stale = (await verifyPass(env, en.pass, NOW)) && en.pass;
    await rejects(handleCore({ pass: stale, device: 'devaaaa1', ops: [{ op: 'limits' }] }, env, NOW + DAY + 1), 'pass-invalid', '作り直す前の端末の証明も、解約前の証明も、1日を過ぎれば芯が答えない');
  }
  subs.sub_K1.status = 'canceled'; subs.sub_K1.ended_at = sec(NOW + 20 * DAY);
  const ed = await H('/key/renew', { code: rot.code, sid: 'sub_K1', device: 'devaaaa1', known: true }, env, NOW + 21 * DAY);
  eq([ed.pass, ed.tier, ed.status], [null, 'free', 'ended'], '契約が終わると証明は出ない(期限で有料の機能が止まる)');
  subs.sub_K1.status = 'unpaid';
  eq((await H('/key/renew', { code: rot.code, sid: 'sub_K1', device: 'devaaaa1', known: true })).pass, null, '未払いで Stripe が止めた契約も証明は出ない');
}

/* ---------- 6. Webhook: 名簿に書かず、鍵だけ付ける ---------- */
{
  const e2 = { ...env }; delete e2.FIREBASE_SA_KEY;
  mkSub('sub_W1');
  const ev = { id: 'evt_k1', type: 'checkout.session.completed', data: { object: { mode: 'subscription', subscription: 'sub_W1', metadata: { mode: 'key' } } } };
  const body = JSON.stringify(ev), t = sec(Date.now());
  const sig = createHmac('sha256', 'whsec_fake').update(t + '.' + body).digest('hex');
  const r = await W.fetch(new Request('https://w.example/stripe/webhook', { method: 'POST', body, headers: { 'Stripe-Signature': `t=${t},v1=${sig}` } }), e2);
  const j = await r.json();
  eq([r.status, j.key, !!normCode(subs.sub_W1.metadata.zw_key)], [200, true, true], 'Webhook で鍵を付ける(Firestore は呼ばない)');
}

/* ---------- 6b. 年払いを30日以内に「契約の管理」で解約 → 自動で全額返金 ---------- */
{
  const { keyYearRefund } = await import('../src/index.js');
  const start = sec(Date.now() - 5 * DAY);
  const y = mkSub('sub_Y1', { start_date: start, cancel_at_period_end: true, metadata: { mode: 'key', planKey: 'total_year', refundDays: '30' }, items: { data: [{ id: 'si_y', price: { id: 'price_ty' }, current_period_end: sec(Date.now() + 360 * DAY) }] } });
  const r = await keyYearRefund(env, y);
  eq([r && r.amount, y.status, y.metadata.refunded, sent.filter(x => x.path === '/refunds').length], [49800, 'canceled', '1', 1], '30日以内の解約: 全額返金して、その日で終える');
  eq(await keyYearRefund(env, y), null, '2回目は何もしない');
  const y2 = mkSub('sub_Y2', { start_date: sec(Date.now() - 40 * DAY), cancel_at_period_end: true, metadata: { mode: 'key', planKey: 'total_year', refundDays: '30' }, items: { data: [{ id: 'si_y2', price: { id: 'price_ty' }, current_period_end: sec(Date.now() + 320 * DAY) }] } });
  eq(await keyYearRefund(env, y2), null, '31日目からは返金しない(期間の終わりで終わる)');
  eq(await keyYearRefund(env, mkSub('sub_M1', { cancel_at_period_end: true })), null, '月払いは返金しない');
  // 同じカード・同じメールでは1回まで(11/17 21:50)
  eq([charges.ch_sub_Y1.metadata.zw_rf_fp, /^[0-9a-f]{24}$/.test(charges.ch_sub_Y1.metadata.zw_rf_em), JSON.stringify(charges.ch_sub_Y1.metadata).includes('@')], ['fpA', true, false], '返金した支払いに、カードの指紋とメールのハッシュを残す(メールそのものは置かない)');
  const yr = () => ({ start_date: sec(Date.now() - 3 * DAY), cancel_at_period_end: true, metadata: { mode: 'key', planKey: 'total_year', refundDays: '30' }, items: { data: [{ id: 'si_yy', price: { id: 'price_ty' }, current_period_end: sec(Date.now() + 360 * DAY) }] } });
  const nRef = () => sent.filter(x => x.path === '/refunds').length;
  cards.sub_Y3 = { fp: 'fpA', email: 'other@example.com' };
  let b = nRef(); const y3 = mkSub('sub_Y3', yr());
  eq([await keyYearRefund(env, y3), nRef() - b, y3.status, y3.cancel_at_period_end, y3.metadata.refund_denied], [{ refused: 'repeat' }, 0, 'active', true, 'repeat'], '同じカード(別のメール)の2回目: 返金しない・払った1年の終わりまで使える');
  eq(await keyYearRefund(env, y3), null, '断った契約は、次の通知でも見直さない');
  cards.sub_Y4 = { fp: 'fpB', email: 'A@Example.com ' };
  b = nRef(); eq([await keyYearRefund(env, mkSub('sub_Y4', yr())), nRef() - b], [{ refused: 'repeat' }, 0], '同じメール(大文字・空白の違い)で別のカード: 返金しない');
  cards.sub_Y5 = { fp: 'fpC', email: 'c@example.com' };
  b = nRef(); const r5 = await keyYearRefund(env, mkSub('sub_Y5', yr()));
  eq([r5 && r5.amount, nRef() - b], [49800, 1], '別のカード「かつ」別のメール: 見分けられないので返金する(文書に書いたすり抜け)');
  cards.sub_Y6 = { fp: 'fpC', email: 'd@example.com' }; searchLag = true;
  b = nRef(); await keyYearRefund(env, mkSub('sub_Y6', yr())); searchLag = false;
  eq(nRef() - b, 1, 'Stripe の検索の反映待ち(約1分)の間は、2回目も通りうる(文書に書いたすり抜け)');
}

/* ---------- 7. 有料の画面のプログラムを、証明を確かめてから渡す ---------- */
{
  const kv = { get: async k => (k === 'books.js' ? '/*books*/' : null) };
  const e3 = { ...env, PAID_JS: kv, PAID_TIERS: '{"books.js":"total"}' };
  const good = await signPass(env, { v: 1, t: 'total', exp: NOW + DAY });
  const light = await signPass(env, { v: 1, t: 'light', exp: NOW + DAY });
  eq((await servePaid('books.js', good, env, NOW)).status, 503, '置き場(包み・PAID_JS)が無い間は準備中');
  eq((await servePaid('books.js', '', e3, NOW)).status, 401, '証明なしは渡さない');
  eq((await servePaid('books.js', good, e3, NOW + 2 * DAY)).status, 401, '期限切れは渡さない');
  eq((await servePaid('books.js', light, e3, NOW)).status, 403, '段が足りない(ライトに総合の部品)は渡さない');
  eq(await servePaid('books.js', good, e3, NOW), { status: 200, body: '/*books*/' }, '証明があれば渡す');
  eq((await servePaid('../x.js', good, e3, NOW)).status, 404, '変な名前は断る');
  const rr = await W.fetch(new Request('https://w.example/key/app/books.js', { headers: { Authorization: 'Bearer ' + good, Origin: 'https://hiro0530.github.io' } }), e3);
  eq([rr.status === 200 || rr.status === 401, rr.headers.get('Cache-Control')], [true, 'no-store'], '受け口は控えに残さない(no-store)');
  // 包み(公開のリポジトリには暗号の文字だけ。開く鍵は Worker の秘密の値だけ)
  const { packItem, bundleSource } = await import('../../../../tools/sedori/pack_paid.mjs');
  const rk = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt']);
  const rpub = await crypto.subtle.exportKey('jwk', rk.publicKey), rpriv = JSON.stringify(await crypto.subtle.exportKey('jwk', rk.privateKey));
  const secretJs = 'window.PaidBooks = function () { return "帳簿の芯"; };';
  const bundle = { v: 1, items: { 'books.js': await packItem(rpub, secretJs, 'total') } };
  const src = bundleSource(bundle);
  eq([src.includes('帳簿の芯'), src.includes('PaidBooks'), /export default/.test(src)], [false, false, true], '包みの文字に、元のプログラムは出ない');
  const e4 = { ...env, PAID_JS_KEY: rpriv };
  eq(await servePaid('books.js', good, e4, NOW, bundle), { status: 200, body: secretJs }, '包み: 証明があれば開いて渡す');
  eq((await servePaid('books.js', '', e4, NOW, bundle)).status, 401, '包み: 証明なしは渡さない');
  eq((await servePaid('books.js', good, e4, NOW + 2 * DAY, bundle)).status, 401, '包み: 期限切れ(1日を過ぎた)は渡さない');
  eq((await servePaid('books.js', light, e4, NOW, bundle)).status, 403, '包み: 段が足りない(ライトに総合の部品)は渡さない');
  eq((await servePaid('books.js', good, env, NOW, bundle)).status, 503, '包み: 開く鍵が無い Worker は準備中(元は出さない)');
  const other = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt']);
  eq((await servePaid('books.js', good, { ...env, PAID_JS_KEY: JSON.stringify(await crypto.subtle.exportKey('jwk', other.privateKey)) }, NOW, bundle)).status, 503, '包み: 違う鍵では開けない');
  const fake = await signPass({ ...env, KEY_SIGNING_JWK: JWK2 }, { v: 1, t: 'business', exp: NOW + DAY });
  eq((await servePaid('books.js', fake, e4, NOW, bundle)).status, 401, '包み: 署名の違う証明(偽物)は渡さない');
  const pub = await (await W.fetch(new Request('https://w.example/key/pub'), env)).json();
  eq([pub.mode, !!pub.jwk && !('d' in pub.jwk)], ['live', true], '/key/pub は公開の鍵だけ');
}

console.log(`OK 利用の鍵 ${n}件`);
await import('./test_core.js');

// 2026-11-18: 決済の種類を差し替える受け口(PayPal)の検算
await import('./test_paypal_key.js');
