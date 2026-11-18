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

export const MAX_BODY = 1024 * 1024;   // 1回に受ける大きさ(納品リストの2,000行で約0.4MB。帳簿の集計は台帳・売上・経費の集計の欄だけを送る。1MB で約6,000行。2026-11-18 に 512KB から。無料の枠の CPU 10ms に収まるかは本番で測る)
export const MAX_OPS = 6;
export const MAX_PREP_ROWS = 2000;
export const TTL_SEC = 600;           // 答えを端末に置いてよい時間(10分。証明の期限の方が早ければそちら)
const RANK = { free: 0, light: 1, total: 2, business: 3 };

/* ------------------------------------------------------------------ 上限(無料の範囲を含む。ここだけで決める) */
/** まとめてチェックの1回の行数・在庫番の品数・在庫番の自動の確かめの間隔(分。0 = 自動なし)・
 *  ウォッチの自動の取り直しで1回に確かめる件数(0 = 自動なし。2026-11-18 足した。間隔は端末の6時間のまま) */
export const LIMITS = {
  free: { bulk: 20, listed: 5, auto: 0, watch: 0 },
  light: { bulk: 100, listed: 30, auto: 30, watch: 50 },
  total: { bulk: 500, listed: 100, auto: 15, watch: 50 },
  business: { bulk: 500, listed: 300, auto: 10, watch: 50 }
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

/* ------------------------------------------------------------------ まとめてチェックの結果の要約(ライト以上。2026-11-18)
 * 端末から来るのは、行ごとの数字だけ(品名・JAN・ASIN・キーは来ない。行は番号 i で返す)。
 *   { i, p: ポイント抜きの利益(円), need: 目標の利益(円), sold: 月の販売の目安(個。無ければ null), cnt: 出品者の数, amz: Amazon本体が販売中か, est: 売値が見込みか }
 * 見込みの月の利益 = 1個の利益 × 月に取れそうな個数。月に取れそうな個数 = 月の販売 ÷ (出品者 + 1) を 1〜30 個に丸める(数字が無ければ 1個として、そう書く)。
 * Amazon本体が販売中の行は、月に取れそうな個数を半分にする(カートを取りにくい)。 */
export const MAX_SUM_ROWS = 500;
export const SUM_TOP = 10;
function sumRow(r) {
  const p = Math.round(num(r.p)), need = Math.round(num(r.need)), sold = num(r.sold), cnt = Math.max(0, Math.round(num(r.cnt)));
  const state = r.est || r.p == null || r.p === '' ? 'unk' : (p >= need ? 'ok' : 'ng');
  let take = sold > 0 ? Math.max(1, Math.min(30, Math.floor(sold / (cnt + 1)))) : null;
  if (take != null && r.amz) take = Math.max(1, Math.floor(take / 2));
  const why = [];
  if (sold > 0) why.push('月の販売 ' + Math.round(sold) + '個・出品者 ' + cnt + '人 → 月に約' + take + '個');
  else why.push('売れ行きの数字なし(1個で計算)');
  if (r.amz) why.push('Amazon本体が販売中(カートを取りにくいので半分で計算)');
  return { i: Math.round(num(r.i)), state, p, take, month: state === 'ok' ? p * (take || 1) : null, known: take != null, why };
}
export function bulkSummary(rows) {
  const list = (Array.isArray(rows) ? rows : []).slice(0, MAX_SUM_ROWS).filter(r => r && typeof r === 'object').map(sumRow);
  const n = { ok: 0, ng: 0, unk: 0 }; list.forEach(x => { n[x.state]++; });
  const rank = { ok: 0, ng: 1, unk: 2 };
  const sorted = list.slice().sort((a, b) => rank[a.state] - rank[b.state] ||
    (a.state === 'ok' ? (b.known - a.known) || (b.month - a.month) : 0) || (b.p - a.p) || (a.i - b.i));
  const top = sorted.filter(x => x.state === 'ok').slice(0, SUM_TOP).map(x => ({ i: x.i, p: x.p, take: x.take, month: x.month, why: x.why }));
  return { n, order: sorted.map(x => x.i), top, topMonth: top.reduce((t, x) => t + x.month, 0), rule: '見込みの月の利益 = 1個の利益(ポイント抜き)× 月に取れそうな個数(月の販売 ÷ (出品者+1)、1〜30個。Amazon本体が販売中なら半分)' };
}

/* ------------------------------------------------------------------ 帳簿: 月ごとの利益と、ルート・仕入れ先・売り先ごとの集計(総合以上。2026-11-18)
 * 計算は books/assets/books-core.js の events・monthly・groupBy と同じ(試験 tests/sedori/test_core_server.js で同じ答えを確かめる)。
 * 端末から来るのは、集計に要る欄だけ。品名・取引相手の名前・住所は来ない(仕入れ先は端末で「楽天市場」などの先頭の語に丸めた pg、売り先は ch)。 */
export const MAX_BOOK_ROWS = 20000;
const L_FIELDS = ['id', 'qty', 'unit', 'saleDate', 'salePrice', 'sellPrice', 'profit', 'wait', 'route', 'pg', 'ch'];
const S_FIELDS = ['id', 'date', 'kind', 'ledgerId', 'ch', 'gross', 'disc', 'fee', 'ship', 'other', 'withheld', 'qty'];
const E_FIELDS = ['date', 'amount', 'biz'];
function pick(rows, fields) {
  return (Array.isArray(rows) ? rows : []).slice(0, MAX_BOOK_ROWS).filter(r => r && typeof r === 'object').map(r => {
    const o = {}; for (const k of fields) { const v = r[k]; if (v == null) continue; o[k] = typeof v === 'boolean' || typeof v === 'number' ? v : String(v).slice(0, 80); } return o;
  });
}
const rnd = n => Math.round(Number(n) || 0);
function bizAmount(e) { const b = e.biz == null || e.biz === '' ? 100 : Number(e.biz); return rnd((Number(e.amount) || 0) * Math.max(0, Math.min(100, b)) / 100); }
function bookEvents(L, S) {
  const byId = {}, linked = {}, out = [];
  L.forEach(r => { byId[r.id] = r; });
  S.forEach(s => { if (s.ledgerId) linked[s.ledgerId] = 1; });
  S.forEach(s => {
    if (s.kind === 'transfer') return;
    const lr = s.ledgerId ? byId[s.ledgerId] : null;
    const cogs = lr && (s.kind === 'order' || s.kind === 'sale') ? rnd((Number(lr.unit) || 0) * (Number(lr.qty) || 1)) : 0;
    out.push({ date: s.date, ch: s.ch || 'その他', route: lr ? (lr.route || '(ルートなし)') : (s.ch || 'その他') + '(台帳と未照合)', party: lr ? (lr.pg || '(仕入れ先なし)') : '(台帳と未照合)',
      sales: rnd((Number(s.gross) || 0) + (Number(s.disc) || 0)), cogs, fee: rnd(s.fee), ship: rnd(s.ship), other: rnd(s.other) + rnd(s.withheld), est: false, nocost: !lr && (s.kind === 'order' || s.kind === 'sale') });
  });
  L.forEach(r => {
    if (r.wait || !r.saleDate || linked[r.id]) return;
    const q = Number(r.qty) || 1, sale = rnd((Number(r.salePrice) || 0) * q), cost = rnd((Number(r.unit) || 0) * q);
    const pf = r.profit === '' || r.profit == null ? null : Number(r.profit) * q;
    const plan = rnd((Number(r.sellPrice) || Number(r.salePrice) || 0) * q);
    out.push({ date: r.saleDate, ch: r.ch || 'その他', route: r.route || '(ルートなし)', party: r.pg || '(仕入れ先なし)', sales: sale, cogs: cost, fee: pf == null ? 0 : Math.max(0, plan - cost - rnd(pf)), ship: 0, other: 0, est: true, nocost: false });
  });
  return out;
}
const AGG = ['sales', 'cogs', 'fee', 'ship', 'other', 'exp', 'n', 'est', 'nocost'];
function emptyAgg() { return { sales: 0, cogs: 0, fee: 0, ship: 0, other: 0, exp: 0, profit: 0, n: 0, est: 0, nocost: 0 }; }
function addEv(a, e) { a.sales += e.sales; a.cogs += e.cogs; a.fee += e.fee; a.ship += e.ship; a.other += e.other; a.n++; if (e.est) a.est++; if (e.nocost) a.nocost++; }
function finish(a) { a.gross = a.sales + a.other - a.cogs - a.fee - a.ship; a.profit = a.gross - a.exp; a.rate = a.sales ? a.profit / a.sales : 0; a.grate = a.sales ? a.gross / a.sales : 0; return a; }
export function booksYear(o) {
  const y = /^\d{4}$/.test(String(o && o.year)) ? String(o.year) : String(new Date().getUTCFullYear());
  const L = pick(o && o.ledger, L_FIELDS), S = pick(o && o.sales, S_FIELDS), E = pick(o && o.expenses, E_FIELDS);
  const ev = bookEvents(L, S), months = {};
  for (let m = 1; m <= 12; m++) months[y + '-' + String(m).padStart(2, '0')] = emptyAgg();
  ev.forEach(e => { const k = String(e.date).slice(0, 7); if (months[k]) addEv(months[k], e); });
  E.forEach(x => { const k = String(x.date).slice(0, 7); if (months[k]) months[k].exp += bizAmount(x); });
  const total = emptyAgg();
  const list = Object.keys(months).sort().map(k => { const a = finish(months[k]); a.ym = k; AGG.forEach(f => { total[f] += a[f]; }); return a; });
  const groups = {};
  for (const key of ['route', 'party', 'ch']) {
    const g = {};
    ev.forEach(e => { if (String(e.date).slice(0, 4) !== y) return; const k = e[key] || '(なし)'; if (!g[k]) g[k] = emptyAgg(); addEv(g[k], e); });
    groups[key] = Object.keys(g).map(k => { const a = finish(g[k]); a.key = k; return a; }).sort((a, b) => b.sales - a.sales);
  }
  return { year: Number(y), months: list, total: finish(total), groups };
}

/* ------------------------------------------------------------------ 頼みの一覧 */
const OPS = {
  limits: { need: 'free', run: (o, tier) => ({ tier, ...LIMITS[tier] }) },
  prep: { need: 'business', run: o => prepTable(o.rows, o.today) },
  bulkSum: { need: 'light', run: o => bulkSummary(o.rows) },
  books: { need: 'total', run: o => booksYear(o) }
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
