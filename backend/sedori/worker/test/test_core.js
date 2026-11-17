// 有料の機能の芯(src/core.js・POST /core)の検算。実行: node test/test_core.js(test_key.js の最後からも呼ぶ)
// 確かめること: 鍵なし・期限切れ・署名違い・ほかの端末の証明・段が足りない時に断る/無料の上限はサーバーが決める/
// 送られた中身を答え以外に出さない・保存しない/控えに残さない(no-store)/納品リストの形
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import W from '../src/index.js';
import { signPass } from '../src/key.js';
import { handleCore, LIMITS, prepTable, TTL_SEC } from '../src/core.js';

let n = 0;
function eq(a, b, msg) { assert.deepStrictEqual(a, b, `${msg}: 実際 ${JSON.stringify(a)} / 期待 ${JSON.stringify(b)}`); n++; }
async function rejects(p, code, msg) { try { await p; } catch (e) { eq(e.code, code, msg); return e; } assert.fail(msg + ': 例外が出ない'); }
const DAY = 864e5, NOW = Date.parse('2026-11-17T03:00:00Z');
async function pair() {
  const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return JSON.stringify(await crypto.subtle.exportKey('jwk', k.privateKey));
}
const env = { KEY_SIGNING_JWK: await pair(), ALLOWED_ORIGIN: 'https://hiro0530.github.io' };
const other = { KEY_SIGNING_JWK: await pair() };
const pass = (t, o = {}) => signPass(env, { v: 1, t, d: 'devaaaa1', iat: NOW, exp: NOW + DAY, ...o });
const C = (body, now = NOW, e = env) => handleCore(body, e, now);

const ROWS = [
  { id: '1', date: '2026-11-10', party: '楽天 A店', orderNo: 'R-1', trackNo: 'T1', name: '品A', jan: '4901234567894', qty: 2, cond: '新品', ship: 'fba', status: '仕入れ済', keepaKey: 'KEEPA-SECRET-123', rkKey: 'RK-SECRET', ownerName: '山田' },
  { id: '2', date: '2026-11-12', party: 'B店', name: '品B', feature: 'ASIN B0ABCDEFGH', ship: 'agent', status: '仕入れ済' },
  { id: '3', date: '2026-11-11', party: 'C店', name: '自分で送る品', ship: 'self', status: '仕入れ済' },
  { id: '4', date: '2026-11-13', party: 'D店', name: '入庫済の品', ship: 'fba', status: '入庫' },
  { id: '5', date: '2026-11-14', party: 'E店', name: '仕入れ前', ship: 'fba', wait: true }
];

/* ---------- 1. 上限(無料の範囲もサーバーが決める) ---------- */
{
  const r = await C({ ops: [{ op: 'limits' }] });
  eq([r.tier, r.results[0].bulk, r.results[0].listed, r.results[0].auto, r.ttl], ['free', 20, 5, 0, TTL_SEC], '鍵なし: 無料の上限(まとめて20行・在庫番5品・自動なし)');
  const b = await C({ pass: await pass('business'), device: 'devaaaa1', ops: [{ op: 'limits' }] });
  eq([b.tier, b.results[0].bulk, b.results[0].listed, b.results[0].auto], ['business', 500, 300, 10], '業務の証明: 業務の上限');
  eq([LIMITS.light.bulk, LIMITS.total.listed], [100, 100], 'ライトは100行・総合は100品');
  const near = await C({ pass: await pass('total', { exp: NOW + 90e3 }), device: 'devaaaa1', ops: [{ op: 'limits' }] });
  eq(near.ttl, 90, '答えを置いてよい時間は、証明の期限より長くしない');
  // 端末側の書き換え: 段の名前だけを送っても、証明が無ければ無料のまま
  const forged = await C({ tier: 'business', t: 'business', plan: 'business_month', ops: [{ op: 'limits', tier: 'business' }] });
  eq([forged.tier, forged.results[0].bulk, forged.results[0].listed], ['free', 20, 5], '「業務です」と書いて送っても、証明が無ければ無料の上限');
}

/* ---------- 2. 断る: 鍵なし・期限切れ・署名違い・ほかの端末・段が足りない・試験用の証明 ---------- */
{
  const none = await C({ ops: [{ op: 'prep', rows: ROWS }] });
  eq(none.results[0], { op: 'prep', error: 'need-pass', need: 'business' }, '鍵なし(端末がいっぱいで証明を受け取れない端末も同じ): 納品リストを作らない');
  await rejects(C({ pass: await pass('business', { exp: NOW - 1 }), device: 'devaaaa1', ops: [{ op: 'prep', rows: ROWS }] }), 'pass-invalid', '期限切れ(1日を過ぎた)の証明は断る');
  await rejects(C({ pass: await pass('business'), device: 'devaaaa1', ops: [{ op: 'prep', rows: ROWS }] }, NOW + DAY + 1), 'pass-invalid', '受け取ってから1日たった証明は断る');
  const bad = await signPass(other, { v: 1, t: 'business', d: 'devaaaa1', iat: NOW, exp: NOW + DAY });
  await rejects(C({ pass: bad, device: 'devaaaa1', ops: [{ op: 'prep', rows: ROWS }] }), 'pass-invalid', '署名の違う証明(偽物)は断る');
  const good = await pass('business');
  const [body, sig] = good.split('.');
  const tampered = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url')), exp: NOW + 30 * DAY })).toString('base64url') + '.' + sig;
  await rejects(C({ pass: tampered, device: 'devaaaa1', ops: [{ op: 'limits' }] }), 'pass-invalid', '期限を書き換えた証明は断る');
  await rejects(C({ pass: good, device: 'devbbbb2', ops: [{ op: 'prep', rows: ROWS }] }), 'device-mismatch', 'ほかの端末の証明(写し取った証明)は断る');
  await rejects(C({ pass: good, ops: [{ op: 'prep', rows: ROWS }] }), 'device-mismatch', '端末の番号が無い問い合わせは断る');
  const light = await C({ pass: await pass('total'), device: 'devaaaa1', ops: [{ op: 'prep', rows: ROWS }] });
  eq(light.results[0], { op: 'prep', error: 'need-plan', need: 'business' }, '総合の証明で業務の納品リスト: 断る');
  const test = await signPass({}, { v: 1, t: 'business', d: 'devaaaa1', exp: NOW + DAY });
  await rejects(C({ pass: test, device: 'devaaaa1', ops: [{ op: 'limits' }] }), 'pass-invalid', '署名の鍵が入った Worker は、試験用(署名なし)の証明を断る');
  await rejects(C({ ops: [] }), 'bad-ops', '頼みが空');
  await rejects(C({ ops: new Array(7).fill({ op: 'limits' }) }), 'bad-ops', '頼みが多すぎる(6つまで)');
  eq((await C({ ops: [{ op: 'nope' }] })).results[0].error, 'unknown', '知らない頼み');
}

/* ---------- 3. 納品リスト(業務) ---------- */
{
  const r = await C({ pass: await pass('business'), device: 'devaaaa1', ops: [{ op: 'prep', rows: ROWS, today: '2026-11-17' }, { op: 'limits' }] });
  const t = r.results[0];
  eq([t.name, t.title, t.head.length, t.widths.length, t.sheet, t.nums], ['nouhin-list_2026-11-17', '納品リスト(2026-11-17 書き出し・2件)', 11, 11, '納品リスト', { 7: 1 }], '納品リストの形(名前・題・列)');
  eq(t.body.map(x => x[4]), ['品A', '品B'], '対象は発送代行かFBAで「仕入れ済」だけ(自分で送る・入庫済・仕入れ前は入れない)、仕入日の古い順(今までの画面と同じ)');
  eq([t.body[0][5], t.body[0][7], t.body[1][6]], ['4901234567894', 2, 'B0ABCDEFGH'], 'JAN・数量・ASIN(特徴の欄から拾う)');
  eq(r.results[1].bulk, 500, '1回の問い合わせに頼みをまとめられる(呼び出しを減らす)');
  const all = JSON.stringify(r);
  eq([all.includes('KEEPA-SECRET'), all.includes('RK-SECRET'), all.includes('山田')], [false, false, false], '答えに、要らない欄(キー・相手の名前)を入れない');
  eq(prepTable(new Array(2500).fill(ROWS[0]), '2026-11-17').body.length, 2000, '1回は2,000行まで');
  eq(prepTable([{ ...ROWS[0], name: 'x'.repeat(5000) }], '2026-11-17').body[0][4].length, 300, '長すぎる文字は切る');
}

/* ---------- 4. 受け口(/core): no-store・大きすぎる・失敗に中身を入れない・記録しない ---------- */
{
  const H = { 'Content-Type': 'application/json', Origin: 'https://hiro0530.github.io' };
  const call = (body, headers = H) => W.fetch(new Request('https://w.example/core', { method: 'POST', body, headers }), env);
  const logs = []; const keep = console.log; console.log = (...a) => logs.push(a.join(' ')); const keepE = console.error; console.error = (...a) => logs.push(a.join(' '));
  try {
    let r = await call(JSON.stringify({ ops: [{ op: 'limits' }] }));
    eq([r.status, r.headers.get('Cache-Control'), r.headers.get('Access-Control-Allow-Origin')], [200, 'no-store', 'https://hiro0530.github.io'], '答えは控えに残さない(no-store)・許した住所だけ');
    r = await call(JSON.stringify({ pass: 'x.y', device: 'devaaaa1', ops: [{ op: 'prep', rows: ROWS }] }));
    const t = await r.text();
    eq([r.status, /pass-invalid/.test(t), t.includes('品A'), t.includes('KEEPA')], [401, true, false, false], '断る時の答えに、送られた中身を入れない');
    r = await call('{' + '"a":"' + 'x'.repeat(600 * 1024) + '"}');
    eq([r.status, (await r.json()).code], [413, 'too-big'], '大きすぎる問い合わせは読まない');
    r = await call('not json');
    eq(r.status, 400, '形の違う問い合わせ');
    r = await W.fetch(new Request('https://w.example/core', { method: 'GET' }), env);
    eq(r.status, 405, 'GET では受けない(中身を URL に載せない)');
  } finally { console.log = keep; console.error = keepE; }
  eq(logs, [], '問い合わせの中身を記録しない(console に何も書かない)');
  const src = readFileSync(new URL('../src/core.js', import.meta.url), 'utf8');
  eq([/console\./.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), /\b(PAID_JS|KV|put\(|fetch\()/.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''))], [false, false], '芯の部品は記録も保存も外への通信もしない(作りで守る)');
}

console.log(`OK 有料の機能の芯 ${n}件`);
