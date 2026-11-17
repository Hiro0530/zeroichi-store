/**
 * 有料の機能の芯(2026-11-17 21:50 オーナー決定「有料機能の芯をサーバー側に置く。抜け道はなくしたい。情報の管理は徹底する」)
 *
 * POST /core { pass, device, ops: [{ op, ... }, …] } → { tier, ttl, results: [ … ] }
 *  - 使うたびにここへ問い合わせ、利用の証明(src/key.js の署名つき)が有効な時だけ有料の答えを返す。
 *    証明が無い・期限切れ・署名違い・ほかの端末の証明 → 有料の答えは返さない。端末の数がいっぱいの端末には、そもそも証明が出ない(/key/renew が断る)。
 *  - 無料の範囲の上限(まとめてチェックの行数・在庫番の品数)も、ここが決める。端末の設定やプランの判定を書き換えても、上限は増えない。
 *  - 1回の問い合わせに、いくつかの頼み(ops)をまとめられる(呼び出しの回数を減らす)。答えは ttl 秒だけ端末に置いてよい。
 *
 * 情報の扱い(作りで守る)
 *  - 送られた中身(納品リストの行など)は、答えを作るためだけに使い、どこにも保存しない(KV・Stripe・ログに書かない)。
 *  - このファイルは console に何も書かない。失敗の答えにも、送られた中身を入れない。
 *  - Keepa・楽天のキーは受け取らない(どの頼みにも鍵の欄は無い。名前が key/keepa/rk… の欄が来ても読まない)。
 */
import { verifyPass, cleanDevice } from './key.js';

export const MAX_BODY = 512 * 1024;   // 1回に受ける大きさ(納品リストの2,000行で約0.4MB)
export const MAX_OPS = 6;
export const MAX_PREP_ROWS = 2000;
export const TTL_SEC = 600;           // 答えを端末に置いてよい時間(10分。証明の期限の方が早ければそちら)
const RANK = { free: 0, light: 1, total: 2, business: 3 };

/* ------------------------------------------------------------------ 上限(無料の範囲を含む。ここだけで決める) */
/** まとめてチェックの1回の行数・在庫番の品数・在庫番の自動の確かめの間隔(分。0 = 自動なし) */
export const LIMITS = {
  free: { bulk: 20, listed: 5, auto: 0 },
  light: { bulk: 100, listed: 30, auto: 30 },
  total: { bulk: 500, listed: 100, auto: 15 },
  business: { bulk: 500, listed: 300, auto: 10 }
};

/* ------------------------------------------------------------------ 納品リスト(業務) */
const PREP_HEAD = ['仕入日', '仕入れ先', '注文番号', '追跡番号', '品名', 'JAN', 'ASIN', '数量', '新品/中古', '受取先・入庫ID', 'メモ'];
const PREP_WIDTH = [11, 22, 18, 18, 38, 15, 13, 6, 9, 16, 24];
const PREP_FIELDS = ['id', 'date', 'party', 'orderNo', 'trackNo', 'name', 'feature', 'jan', 'asin', 'qty', 'cond', 'recvId', 'memo', 'ship', 'status', 'wait'];
function num(v) { const n = Number(String(v == null ? '' : v).replace(/[,，\s円]/g, '')); return isFinite(n) ? n : 0; }
function half(s) { s = String(s == null ? '' : s); return s.normalize ? s.normalize('NFKC') : s; }
function qtyOf(r) { return Math.max(1, num(r.qty) || 1); }
function codes(r) {
  const f = half([r.feature, r.jan ? 'JAN ' + r.jan : '', r.asin ? 'ASIN ' + r.asin : ''].join(' '));
  const j = f.match(/JAN\s*[:：]?\s*(\d{13}|\d{8})(?!\d)/i), a = f.match(/ASIN\s*[:：]?\s*(B0[A-Z0-9]{8})/i);
  return { jan: j ? j[1] : '', asin: a ? a[1].toUpperCase() : '' };
}
function byNew(a, b) {
  let x = String(a.date || ''), y = String(b.date || ''); if (x !== y) return x < y ? 1 : -1;
  x = String(a.id); y = String(b.id); if (x.length !== y.length) return y.length - x.length;
  return x < y ? 1 : (x > y ? -1 : 0);
}
/** 対象: 発送のしかたが発送代行かFBAで、状態が「仕入れ済」。取り寄せ販売の「仕入れ前」は入れない */
export function prepTarget(r) { return !!r && !r.wait && r.ship !== 'self' && (r.status || '仕入れ済') === '仕入れ済'; }
/** 行から要る欄だけを取り出す(ほかの欄は読まない)。文字は長さを切る */
function clip(r) {
  const o = {};
  for (const k of PREP_FIELDS) { const v = r[k]; if (v == null) continue; o[k] = typeof v === 'boolean' ? v : (typeof v === 'number' ? v : String(v).slice(0, k === 'memo' || k === 'name' || k === 'feature' ? 300 : 80)); }
  return o;
}
export function prepTable(rows, today) {
  const list = (Array.isArray(rows) ? rows : []).slice(0, MAX_PREP_ROWS).filter(r => r && typeof r === 'object').map(clip);
  const body = list.filter(prepTarget).sort((a, b) => -byNew(a, b)).map(r => {
    const c = codes(r);
    return [r.date || '', r.party || '', r.orderNo || '', r.trackNo || '', r.name || '', c.jan, c.asin, qtyOf(r), r.cond || '', r.recvId || '', r.memo || ''];
  });
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(today || '')) ? today : new Date(Date.now() + 9 * 36e5).toISOString().slice(0, 10);
  return { name: 'nouhin-list_' + day, title: '納品リスト(' + day + ' 書き出し・' + body.length + '件)', head: PREP_HEAD, body, widths: PREP_WIDTH, nums: { 7: 1 }, sheet: '納品リスト' };
}

/* ------------------------------------------------------------------ 頼みの一覧 */
const OPS = {
  limits: { need: 'free', run: (o, tier) => ({ tier, ...LIMITS[tier] }) },
  prep: { need: 'business', run: o => prepTable(o.rows, o.today) }
};

const err = (msg, status, code) => { const e = new Error(msg); e.status = status; e.code = code; return e; };

/** 問い合わせを受けて答える。body は JSON を読んだもの */
export async function handleCore(body, env, now = Date.now()) {
  body = body && typeof body === 'object' ? body : {};
  const ops = Array.isArray(body.ops) ? body.ops : [];
  if (!ops.length || ops.length > MAX_OPS) throw err('頼みの形が違います', 400, 'bad-ops');
  let tier = 'free', exp = null;
  if (body.pass) {
    const p = await verifyPass(env, body.pass, now);
    if (!p) throw err('利用の証明の期限が切れたか、確かめられませんでした', 401, 'pass-invalid');
    const dev = cleanDevice(body.device);
    if (!p.d || dev !== p.d) throw err('この利用の証明は、この端末のものではありません', 403, 'device-mismatch');
    tier = RANK[p.t] ? p.t : 'free'; exp = Number(p.exp) || null;
  }
  const results = ops.map(o => {
    const def = OPS[o && o.op];
    if (!def) return { op: o && o.op, error: 'unknown' };
    if ((RANK[tier] || 0) < (RANK[def.need] || 0)) return { op: o.op, error: tier === 'free' ? 'need-pass' : 'need-plan', need: def.need };
    try { return { op: o.op, ...def.run(o, tier) }; } catch { return { op: o.op, error: 'failed' }; }
  });
  const ttl = Math.max(0, Math.min(TTL_SEC, exp ? Math.floor((exp - now) / 1000) : TTL_SEC));
  return { tier, until: exp, ttl, results };
}
