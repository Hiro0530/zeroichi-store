/**
 * 帳簿の計算(総合以上・業務。2026-11-18)。端末の books-core.js から移した分。決まりはここだけに置く。
 *
 * 端末から来るのは数字・日付・印(true/false)・並びのための番号(token)・集計の欄だけ。
 *  - 品名・取引相手の名前・住所・メモ・支払先の名前は来ない(来ても読まない)。
 *  - 名前が要る所(摘要の文・一覧の品名)は、サーバーは「{n}」の入った型を返し、端末が自分の記録から名前を入れる。
 *  - 同じ品・同じ仕入れ先を数える「まとめる印」は、端末が 1,2,3… の番号に置き換えて送る(名前の文字は来ない)。
 * 検算: tests/sedori/test_books_calc.js が、移す前の端末の計算(tests/sedori/_books_oracle.js)と同じ答えかを乱数で確かめる。
 * 保存しない・記録に残さない(console に書かない)。
 */
export const MAX_ROWS = 20000;
const ACCTS = ['荷造運賃', '消耗品費', '通信費', '支払手数料', '旅費交通費', '地代家賃', '水道光熱費', '広告宣伝費', '外注工賃', '新聞図書費', '租税公課', '接待交際費', '修繕費', '損害保険料', '雑費'];
const AO_EXP = [['租税公課', '⑧'], ['荷造運賃', '⑨'], ['水道光熱費', '⑩'], ['旅費交通費', '⑪'], ['通信費', '⑫'], ['広告宣伝費', '⑬'], ['接待交際費', '⑭'], ['損害保険料', '⑮'], ['修繕費', '⑯'], ['消耗品費', '⑰'],
  ['外注工賃', '㉑'], ['地代家賃', '㉓'], ['支払手数料', '㉕'], ['新聞図書費', '㉖'], ['雑費', '㉛']];
const SHIRO_EXP = [['外注工賃', '⑫'], ['地代家賃', '⑮'], ['租税公課', ''], ['荷造運賃', ''], ['水道光熱費', ''], ['旅費交通費', ''], ['通信費', ''], ['広告宣伝費', ''], ['接待交際費', ''], ['損害保険料', ''], ['修繕費', ''], ['消耗品費', ''], ['支払手数料', ''], ['新聞図書費', ''], ['雑費', '']];
const TRANSITION = [
  { from: '2023-10-01', to: '2026-09-30', rate: 0.8 },
  { from: '2026-10-01', to: '2028-09-30', rate: 0.7 },
  { from: '2028-10-01', to: '2030-09-30', rate: 0.5 },
  { from: '2030-10-01', to: '2031-09-30', rate: 0.3 }
];
const TRANSITION_SRC = { label: '国税庁 インボイスQ&A 問113(免税事業者等からの仕入れに係る経過措置・令和8年4月改訂)', url: 'https://www.nta.go.jp/taxes/shiraberu/zeimokubetsu/shohi/keigenzeiritsu/pdf/qa/01-15.pdf', checked: '2026-10-27' };
const CH_RATE = { Amazon: 0.11, メルカリ: 0.10, ヤフオク: 0.10, ラクマ: 0.10, その他: 0.10 };

/* ------------------------------------------------------------------ 受け取り(必要な欄だけ読む) */
const L_FIELDS = ['id', 'date', 'saleDate', 'wait', 'qty', 'unit', 'salePrice', 'sellPrice', 'profit', 'route', 'pg', 'ch', 'cond', 'hinmoku', 'ik', 'biz', 'pn', 'pk', 'xk', 'idReq', 'hasName', 'hasPName', 'hasPAddr'];
const S_FIELDS = ['id', 'date', 'kind', 'ledgerId', 'ch', 'gross', 'disc', 'fee', 'ship', 'other', 'withheld', 'qty', 'net'];
const E_FIELDS = ['id', 'date', 'amount', 'biz', 'acct', 'pk', 'pn'];
function pick(rows, fields) {
  return (Array.isArray(rows) ? rows : []).slice(0, MAX_ROWS).filter(r => r && typeof r === 'object').map(r => {
    const o = {}; for (const k of fields) { const v = r[k]; if (v == null) continue; o[k] = typeof v === 'boolean' || typeof v === 'number' ? v : String(v).slice(0, 80); } return o;
  });
}
const rnd = n => Math.round(Number(n) || 0);
const inYear = (d, y) => String(d || '').slice(0, 4) === String(y);
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
const byDate = (a, b) => String(a.date).localeCompare(String(b.date));
export function bizAmount(e) { const b = e.biz == null || e.biz === '' ? 100 : Number(e.biz); return rnd((Number(e.amount) || 0) * Math.max(0, Math.min(100, b)) / 100); }
function inputs(o) {
  const y = /^\d{4}$/.test(String(o && o.year)) ? String(o.year) : String(new Date().getUTCFullYear());
  return { y, L: pick(o && o.ledger, L_FIELDS), S: pick(o && o.sales, S_FIELDS), E: pick(o && o.expenses, E_FIELDS) };
}
/** 設定(数字・印だけ)。noReg は {番号: true} */
function cleanSet(s) {
  s = s && typeof s === 'object' ? s : {};
  const nr = {}; if (s.noReg && typeof s.noReg === 'object') for (const k of Object.keys(s.noReg).slice(0, 5000)) if (s.noReg[k]) nr[k] = true;
  const counts = {}; if (s.counts && typeof s.counts === 'object') for (const k of Object.keys(s.counts).slice(0, MAX_ROWS)) counts[k] = s.counts[k];
  return { tax: s.tax === 'taxable' ? 'taxable' : 'exempt', incl: s.incl !== false, points: s.points === 'misc' ? 'misc' : 'discount', pointYen: Number(s.pointYen) || 0,
    opening: s.opening == null || s.opening === '' ? null : s.opening, closing: s.closing == null || s.closing === '' ? null : s.closing, method: s.method === 'each' ? 'each' : 'last',
    pay: typeof s.pay === 'string' && s.pay ? s.pay.slice(0, 20) : '事業主借', noReg: nr, counts };
}

/* ------------------------------------------------------------------ 集計の元(売れた記録) */
export function events(L, S) {
  const byId = {}, linked = {}, out = [];
  L.forEach(r => { byId[r.id] = r; });
  S.forEach(s => { if (s.ledgerId) linked[s.ledgerId] = 1; });
  S.forEach(s => {
    if (s.kind === 'transfer') return;
    const lr = s.ledgerId ? byId[s.ledgerId] : null;
    const cogs = lr && (s.kind === 'order' || s.kind === 'sale') ? rnd((Number(lr.unit) || 0) * (Number(lr.qty) || 1)) : 0;
    out.push({ id: 's:' + s.id, date: s.date, src: 'import', saleId: s.id, ledgerId: lr ? lr.id : '', kind: s.kind, ch: s.ch || 'その他',
      route: lr ? (lr.route || '(ルートなし)') : (s.ch || 'その他') + '(台帳と未照合)', party: lr ? (lr.pg || '(仕入れ先なし)') : '(台帳と未照合)',
      qty: s.qty || 0, sales: rnd((Number(s.gross) || 0) + (Number(s.disc) || 0)), cogs, fee: rnd(s.fee), ship: rnd(s.ship), other: rnd(s.other) + rnd(s.withheld), est: false, nocost: !lr && (s.kind === 'order' || s.kind === 'sale') });
  });
  L.forEach(r => {
    if (r.wait || !r.saleDate || linked[r.id]) return;
    const q = Number(r.qty) || 1, sale = rnd((Number(r.salePrice) || 0) * q), cost = rnd((Number(r.unit) || 0) * q);
    const pf = r.profit === '' || r.profit == null ? null : Number(r.profit) * q;
    const plan = rnd((Number(r.sellPrice) || Number(r.salePrice) || 0) * q);
    out.push({ id: 'l:' + r.id, date: r.saleDate, src: 'ledger', saleId: '', ledgerId: r.id, kind: 'sale', ch: r.ch || 'その他', route: r.route || '(ルートなし)', party: r.pg || '(仕入れ先なし)',
      qty: q, sales: sale, cogs: cost, fee: pf == null ? 0 : Math.max(0, plan - cost - rnd(pf)), ship: 0, other: 0, est: true, nocost: false });
  });
  return out.sort(byDate);
}
const AGG = ['sales', 'cogs', 'fee', 'ship', 'other', 'exp', 'n', 'est', 'nocost'];
const emptyAgg = () => ({ sales: 0, cogs: 0, fee: 0, ship: 0, other: 0, exp: 0, profit: 0, n: 0, est: 0, nocost: 0 });
function addEv(a, e) { a.sales += e.sales; a.cogs += e.cogs; a.fee += e.fee; a.ship += e.ship; a.other += e.other; a.n++; if (e.est) a.est++; if (e.nocost) a.nocost++; }
function finish(a) { a.gross = a.sales + a.other - a.cogs - a.fee - a.ship; a.profit = a.gross - a.exp; a.rate = a.sales ? a.profit / a.sales : 0; a.grate = a.sales ? a.gross / a.sales : 0; return a; }

/** 年の売上・利益、月ごとの利益、ルート・仕入れ先・売り先ごとの集計と、その年の売れた記録(番号つき。名前は端末が合わせる) */
export function booksYear(o) {
  const { y, L, S, E } = inputs(o);
  const ev = events(L, S), months = {};
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
  return { year: Number(y), months: list, total: finish(total), groups, events: ev.filter(e => inYear(e.date, y)) };
}

/* ------------------------------------------------------------------ 売れ残りの判定(総合以上) */
export function breakEven(r) {
  const unit = Number(r.unit) || 0, rate = CH_RATE[r.ch] || 0.1;
  const sell = Number(r.sellPrice) || 0, pf = r.profit === '' || r.profit == null ? null : Number(r.profit);
  let fixed = 0;
  if (sell > 0 && pf != null) fixed = Math.max(0, sell - unit - pf - sell * rate);
  return Math.ceil((unit + fixed) / (1 - rate) / 10) * 10;
}
/** cfg: { days, cats:{品目: 日数}, items:{台帳id: 日数} }。返り値は古い順の { id, days, limit, over, be, plan, suggest, room, cost } */
export function stale(o) {
  const L = pick(o && o.ledger, L_FIELDS), c = (o && o.cfg) || {}, g = Number(c.days) || 60, today = /^\d{4}-\d{2}-\d{2}$/.test(String(o && o.today)) ? o.today : new Date(Date.now() + 9 * 36e5).toISOString().slice(0, 10);
  const items = c.items && typeof c.items === 'object' ? c.items : {}, cats = c.cats && typeof c.cats === 'object' ? c.cats : {};
  const rows = L.filter(r => !r.wait && !r.saleDate && r.date).map(r => {
    const limit = Number(items[r.id]) || Number(cats[r.hinmoku]) || g;
    const days = daysBetween(r.date, today), be = breakEven(r), plan = Number(r.sellPrice) || 0;
    const suggest = plan ? Math.max(be, Math.floor(plan * 0.9 / 10) * 10) : be;
    return { id: r.id, days, limit, over: days >= limit, be, plan, suggest, room: plan ? plan - be : 0, cost: rnd((Number(r.unit) || 0) * (Number(r.qty) || 1)) };
  }).sort((a, b) => b.days - a.days);
  return { rows, today };
}

/* ------------------------------------------------------------------ 棚卸(業務) */
const stockAt = (L, cutoff) => L.filter(r => !r.wait && r.date && r.date <= cutoff && (!r.saleDate || r.saleDate > cutoff));
export function stocktake(L, cutoff, method, counts) {
  counts = counts || {};
  const list = stockAt(L, cutoff), last = {};
  if (method === 'last') {
    L.forEach(r => {
      if (r.wait || !r.date || r.date > cutoff) return;
      const k = r.ik; if (!last[k] || r.date >= last[k].date) last[k] = { date: r.date, unit: Number(r.unit) || 0 };
    });
  }
  let book = 0, real = 0, counted = 0;
  const rows = list.map(r => {
    const qty = Number(r.qty) || 1, price = method === 'last' ? last[r.ik].unit : (Number(r.unit) || 0);
    const c = counts[r.id] == null || counts[r.id] === '' ? null : Number(counts[r.id]);
    const b = rnd(price * qty), rl = rnd(price * (c == null ? qty : c));
    book += b; real += rl; if (c != null) counted++;
    return { id: r.id, date: r.date, qty, count: c, price, book: b, real: rl, diff: c == null ? 0 : c - qty };
  }).sort(byDate);
  return { rows, book, real, counted, total: rows.length };
}
export function stockOp(o) {
  const { L } = inputs(o), s = cleanSet(o && o.set);
  const cut = /^\d{4}-\d{2}-\d{2}$/.test(String(o && o.cutoff)) ? o.cutoff : new Date().toISOString().slice(0, 10);
  const T = stocktake(L, cut, s.method, s.counts);
  return { ...T, rows: T.rows.map(({ date, ...x }) => x) };
}

/* ------------------------------------------------------------------ 古物商特例の確認(業務) */
export function kobutsu(L, y) {
  const rows = [];
  L.forEach(r => {
    if (r.wait || !inYear(r.date, y)) return;
    const amt = rnd((Number(r.unit) || 0) * (Number(r.qty) || 1));
    if (r.cond !== '中古') { rows.push({ id: r.id, state: 'new', need: [], amt }); return; }
    if (r.biz) { rows.push({ id: r.id, state: 'biz', need: [], amt }); return; }
    const idReq = !!r.idReq, need = [];
    if (!r.date) need.push('年月日');
    if (!r.hasName) need.push('品名');
    if (!(Number(r.qty) > 0)) need.push('数量');
    if (!(Number(r.unit) > 0)) need.push('対価');
    if (idReq) { if (!r.hasPName) need.push('売り手の氏名'); if (!r.hasPAddr) need.push('売り手の住所'); }
    rows.push({ id: r.id, state: need.length ? 'missing' : 'ok', need, idReq, amt });
  });
  const c = s => rows.filter(x => x.state === s), ok = c('ok'), mi = c('missing');
  return { rows, ok: ok.length, missing: mi.length, biz: c('biz').length, nw: c('new').length,
    amountOk: ok.reduce((s, x) => s + x.amt, 0), amountMissing: mi.reduce((s, x) => s + x.amt, 0), taxOk: rnd(ok.reduce((s, x) => s + x.amt, 0) * 10 / 110) };
}
export function kobutsuOp(o) { const { y, L } = inputs(o); return kobutsu(L, y); }

/* ------------------------------------------------------------------ インボイスの経過措置(業務) */
export function transitionRate(d) {
  d = String(d || '');
  if (!d || d < TRANSITION[0].from) return 1;
  for (const t of TRANSITION) if (d >= t.from && d <= t.to) return t.rate;
  return 0;
}
const transitionCap = y => String(y) + '-01-01' >= '2026-10-01' ? 100000000 : 1000000000;
const periodLabel = t => t.from.slice(0, 4) + '年' + Number(t.from.slice(5, 7)) + '月〜' + t.to.slice(0, 4) + '年' + Number(t.to.slice(5, 7)) + '月';
export function transitionCredit(L, E, y, set) {
  const noReg = set.noReg || {}, kst = {}, rows = [], parties = {};
  kobutsu(L, y).rows.forEach(x => { kst[x.id] = x.state; });
  function party(key, amt, src, first) { const p = parties[key] = parties[key] || { key, n: 0, amt: 0, src, first, noReg: !!noReg[key] }; p.n++; p.amt += amt; }
  L.forEach(r => {
    if (r.wait || !inYear(r.date, y)) return;
    const amt = rnd((Number(r.unit) || 0) * (Number(r.qty) || 1)); if (amt <= 0) return;
    const biz = !!r.biz, key = r.pk;
    let why;
    if (biz && r.pn) party(key, amt, 'ledger', { type: 'ledger', id: r.id });
    if (kst[r.id] === 'ok') return;
    if (!biz) why = kst[r.id] === 'missing' ? 'kobMissing' : 'individual';
    else if (noReg[key]) why = 'noReg';
    else return;
    rows.push({ type: 'ledger', id: r.id, date: r.date, key: biz ? key : r.xk, amt, why });
  });
  E.forEach(x => {
    if (!inYear(x.date, y) || x.acct === '租税公課') return;
    const amt = bizAmount(x); if (amt <= 0 || !x.pn) return;
    const key = x.pk;
    party(key, amt, 'expense', { type: 'expense', id: x.id });
    if (noReg[key]) rows.push({ type: 'expense', id: x.id, date: x.date, key, amt, why: 'noReg' });
  });
  const cap = transitionCap(y), used = {}; let overCap = false;
  rows.sort(byDate).forEach(x => {
    const u = used[x.key] || 0, within = Math.max(0, Math.min(x.amt, cap - u));
    used[x.key] = u + x.amt; x.over = x.amt - within; if (x.over) overCap = true;
    x.tax = rnd(x.amt * 10 / 110); x.rate = transitionRate(x.date);
    x.credit = rnd(rnd(within * 10 / 110) * x.rate); x.lost = x.tax - x.credit;
  });
  const periods = TRANSITION.map(t => ({ label: periodLabel(t), from: t.from, to: t.to, rate: t.rate, n: 0, amt: 0, tax: 0, credit: 0 }));
  const total = { n: 0, amt: 0, tax: 0, credit: 0, lost: 0 };
  rows.forEach(x => {
    const p = periods.filter(q => x.date >= q.from && x.date <= q.to)[0];
    if (p) { p.n++; p.amt += x.amt; p.tax += x.tax; p.credit += x.credit; }
    total.n++; total.amt += x.amt; total.tax += x.tax; total.credit += x.credit; total.lost += x.lost;
  });
  const ys = y + '-01-01', ye = y + '-12-31';
  return { rows, periods: periods.filter(p => p.n || (p.from <= ye && p.to >= ys)), total, parties: Object.keys(parties).map(k => parties[k]).sort((a, b) => b.amt - a.amt), cap, overCap, src: TRANSITION_SRC };
}
export function transitionOp(o) { const { y, L, E } = inputs(o); return transitionCredit(L, E, y, cleanSet(o && o.set)); }

/* ------------------------------------------------------------------ 申告用の数字(業務) */
const exTax = (n, set, taxable) => set && set.tax === 'taxable' && set.incl === false && taxable !== false ? rnd(n * 100 / 110) : rnd(n);
export function taxReport(L, S, E, y, set) {
  const warn = [], src = {}; const Sx = (k, type, id) => { (src[k] = src[k] || []).push({ type, id }); };
  const ev = events(L, S).filter(e => inYear(e.date, y));
  let sales = 0, misc = 0, fee = 0, ship = 0, nocost = 0, est = 0;
  ev.forEach(e => {
    sales += e.sales; if (e.sales) Sx('sales', e.src, e.src === 'import' ? e.saleId : e.ledgerId);
    if (e.other > 0) { misc += e.other; Sx('misc', e.src, e.saleId); }
    else if (e.other < 0) { fee += -e.other; Sx('支払手数料', e.src, e.saleId); }
    if (e.fee) { fee += e.fee; Sx('支払手数料', e.src, e.src === 'import' ? e.saleId : e.ledgerId); }
    if (e.ship) { ship += e.ship; Sx('荷造運賃', e.src, e.saleId); }
    if (e.nocost) nocost++; if (e.est) est++;
  });
  const pt = rnd(set.pointYen || 0);
  if (pt && set.points === 'misc') misc += pt;
  let buy = 0;
  L.forEach(r => { if (!r.wait && inYear(r.date, y)) { buy += rnd((Number(r.unit) || 0) * (Number(r.qty) || 1)); Sx('buy', 'ledger', r.id); } });
  if (pt && set.points !== 'misc') buy -= pt;
  const method = set.method || 'last';
  const openAuto = stocktake(L, (Number(y) - 1) + '-12-31', method, {}).book;
  const closeT = stocktake(L, y + '-12-31', method, set.counts || {});
  const opening = set.opening == null || set.opening === '' ? openAuto : rnd(set.opening);
  const closing = set.closing == null || set.closing === '' ? closeT.real : rnd(set.closing);
  stockAt(L, (Number(y) - 1) + '-12-31').forEach(r => { Sx('opening', 'ledger', r.id); });
  closeT.rows.forEach(x => { Sx('closing', 'ledger', x.id); });
  const exp = {}; ACCTS.forEach(a => { exp[a] = 0; });
  E.forEach(x => { if (!inYear(x.date, y)) return; const a = ACCTS.indexOf(x.acct) >= 0 ? x.acct : '雑費'; exp[a] += bizAmount(x); Sx(a, 'expense', x.id); });
  exp['支払手数料'] += fee; exp['荷造運賃'] += ship;
  const tx = (n, taxable) => exTax(n, set, taxable);
  const A = { sales: tx(sales), misc: tx(misc, false), opening, buy: tx(buy), closing };
  Object.keys(exp).forEach(k => { A[k] = tx(exp[k], k !== '租税公課'); });
  A.cogs = A.opening + A.buy - A.closing;
  A.expTotal = ACCTS.reduce((s, k) => s + A[k], 0);
  A.income = A.sales + A.misc - A.cogs - A.expTotal;
  if (nocost) warn.push({ k: 'nocost', msg: '台帳と結び付いていない売上が ' + nocost + ' 件あります。申告の売上原価は「期首+仕入−期末」なので影響しませんが、仕入れが台帳に無い場合は仕入金額が少なくなります。' });
  if (est) warn.push({ k: 'est', msg: '台帳の「売れた」から数えた売上が ' + est + ' 件あります(手数料は見込み利益からの推定)。Amazonのレポートやメルカリの取引画面を取り込むと、実際の金額に置き換わります。' });
  if (set.opening == null || set.opening === '') warn.push({ k: 'opening', msg: '期首商品棚卸高は、台帳から ' + (Number(y) - 1) + '年12月31日 時点の在庫を計算した値です。前の年の決算書の期末商品棚卸高と同じ額にしてください(違う時は申告用の数字の設定で直せます)。' });
  const ao = [
    ['①', '売上(収入)金額(雑収入を含む)', A.sales + A.misc, ['sales', 'misc']],
    ['②', '期首商品棚卸高', A.opening, ['opening']], ['③', '仕入金額', A.buy, ['buy']], ['④', '小計(②+③)', A.opening + A.buy, null],
    ['⑤', '期末商品棚卸高', A.closing, ['closing']], ['⑥', '差引原価(④−⑤)', A.cogs, null], ['⑦', '差引金額(①−⑥)', A.sales + A.misc - A.cogs, null]
  ].concat(AO_EXP.map(p => [p[1], p[0], A[p[0]], [p[0]]]).filter(l => l[2] || ['荷造運賃', '消耗品費', '通信費', '支払手数料'].indexOf(l[1]) >= 0))
    .concat([['㉜', '経費の計', A.expTotal, null], ['㉝', '差引金額(⑦−㉜)', A.income, null]]);
  const shiroOther = SHIRO_EXP.filter(p => !p[1]);
  const shiro = [
    ['①', '売上(収入)金額', A.sales, ['sales']], ['②', '家事消費', 0, null], ['③', 'その他の収入', A.misc, ['misc']], ['④', '計(①+②+③)', A.sales + A.misc, null],
    ['⑤', '期首商品棚卸高', A.opening, ['opening']], ['⑥', '仕入金額', A.buy, ['buy']], ['⑦', '小計(⑤+⑥)', A.opening + A.buy, null],
    ['⑧', '期末商品棚卸高', A.closing, ['closing']], ['⑨', '差引原価(⑦−⑧)', A.cogs, null], ['⑩', '差引金額(④−⑨)', A.sales + A.misc - A.cogs, null]
  ].concat(SHIRO_EXP.filter(p => p[1]).map(p => [p[1], p[0], A[p[0]], [p[0]]]))
    .concat([['⑰', 'その他の経費(下の内訳の計)', shiroOther.reduce((s, p) => s + A[p[0]], 0), null]])
    .concat(shiroOther.map(p => ['', '　' + p[0], A[p[0]], [p[0]], 'sub']).filter(l => l[2] || ['荷造運賃', '消耗品費', '通信費', '支払手数料'].indexOf(l[1].trim()) >= 0))
    .concat([['⑱', '経費の計', A.expTotal, null], ['⑲', '専従者控除前の所得金額(⑩−⑱)', A.income, null]]);
  const lines = list => list.map(l => { let s = []; (l[3] || []).forEach(k => { s = s.concat(src[k] || []); }); return { no: l[0], label: l[1], amount: l[2], keys: l[3], src: s, sub: l[4] === 'sub' }; });
  return { year: Number(y), A, ao: lines(ao), shiro: lines(shiro), warn, closeT: { book: closeT.book, real: closeT.real, counted: closeT.counted, total: closeT.total }, openAuto };
}
export function taxOp(o) {
  const { y, L, S, E } = inputs(o), set = cleanSet(o && o.set);
  const T = taxReport(L, S, E, y, set);
  if (o && o.withTransition && set.tax === 'taxable') T.transition = transitionCredit(L, E, y, set);
  // 台帳の「売れた」から数えた売上の、推定の手数料(内訳の表に出す。台帳の行の id ごと)
  T.ledgerFee = {}; events(L, S).forEach(e => { if (e.src === 'ledger' && inYear(e.date, y)) T.ledgerFee[e.ledgerId] = e.fee; });
  return T;
}

/* ------------------------------------------------------------------ 仕訳帳と会計ソフト向けの書き出し(業務) */
/** 摘要の型。{n} の所に、端末が自分の記録から名前(品名・売上の名前・支払先とメモ)を入れる。入れた後 trim(trim が true の時)→ 空なら fb → 60文字に切る */
export function journal(L, S, E, y, set) {
  const pay = set.pay || '事業主借', out = []; let no = 0;
  const kob = set.tax === 'taxable' ? kobutsu(L, y) : null, kobOk = {}, keika = {};
  if (kob) kob.rows.forEach(x => { if (x.state === 'ok') kobOk[x.id] = 1; });
  if (set.tax === 'taxable') transitionCredit(L, E, y, set).rows.forEach(x => { if (x.rate > 0 && x.rate < 1) keika[x.type + ':' + x.id] = ' 経過措置' + Math.round(x.rate * 100) + '%控除対象'; });
  function J(date, lines, src, opt) { no++; lines.forEach(l => { if (!l[2]) return; out.push({ no, date, dr: l[0], cr: l[1], amt: rnd(l[2]), tpl: String(l[3] || '').slice(0, 400), trim: !!(opt && opt.trim), fb: (opt && opt.fb) || '', src, taxDr: l[4] || 'out', taxCr: l[5] || 'out' }); }); }
  const T = taxReport(L, S, E, y, set);
  if (T.A.opening) J(y + '-01-01', [['期首商品棚卸高', '商品', T.A.opening, '期首商品棚卸高の振替', 'out', 'out']], { type: 'stock', id: 'opening' });
  L.filter(r => !r.wait && inYear(r.date, y)).sort(byDate).forEach(r => {
    const amt = rnd((Number(r.unit) || 0) * (Number(r.qty) || 1));
    const m = '仕入 {n}' + (kobOk[r.id] ? ' 古物商特例' : (keika['ledger:' + r.id] || ''));
    J(r.date, [['仕入高', pay, amt, m, kobOk[r.id] ? 'kobutsu' : 'buy', 'out']], { type: 'ledger', id: r.id }, { trim: true });
  });
  S.filter(s => inYear(s.date, y)).sort(byDate).forEach(s => {
    const ar = '売掛金', nm = (s.ch || '') + ' {n}';
    const src = { type: 'sale', id: s.id };
    if (s.kind === 'transfer') { if (s.net) J(s.date, s.net < 0 ? [['普通預金', ar, -s.net, (s.ch || '') + ' 入金', 'out', 'out']] : [[ar, '普通預金', s.net, (s.ch || '') + ' 振込の戻り', 'out', 'out']], src); return; }
    const sales = rnd((Number(s.gross) || 0) + (Number(s.disc) || 0)), lines = [];
    if (sales > 0) lines.push([ar, '売上高', sales, '売上 ' + nm, 'out', 'sale']);
    if (sales < 0) lines.push(['売上高', ar, -sales, '返金 ' + nm, 'sale', 'out']);
    if (s.fee > 0) lines.push(['支払手数料', ar, s.fee, '手数料 ' + nm, 'buy', 'out']);
    if (s.fee < 0) lines.push([ar, '支払手数料', -s.fee, '手数料の戻り ' + nm, 'out', 'buy']);
    if (s.ship > 0) lines.push(['荷造運賃', ar, s.ship, '送料 ' + nm, 'buy', 'out']);
    const oth = rnd((Number(s.other) || 0) + (Number(s.withheld) || 0));
    if (oth > 0) lines.push([ar, '雑収入', oth, '調整 ' + nm, 'out', 'out']);
    if (oth < 0) lines.push(['支払手数料', ar, -oth, '調整 ' + nm, 'buy', 'out']);
    J(s.date, lines, src);
  });
  events(L, S).filter(e => e.src === 'ledger' && inYear(e.date, y)).forEach(e => {
    const nm = e.ch + ' {n}';
    J(e.date, [['売掛金', '売上高', e.sales, '売上 ' + nm, 'out', 'sale'], ['支払手数料', '売掛金', e.fee, '手数料(見込み) ' + nm, 'buy', 'out']], { type: 'ledger', id: e.ledgerId });
  });
  E.filter(x => inYear(x.date, y)).sort(byDate).forEach(x => {
    const a = bizAmount(x); if (!a) return;
    const acct = x.acct || '雑費';
    const m = '{n}' + (Number(x.biz) < 100 ? ' (事業' + x.biz + '%)' : '') + (keika['expense:' + x.id] || '');
    J(x.date, [[acct, pay, a, m, acct === '租税公課' ? 'out' : 'buy', 'out']], { type: 'expense', id: x.id }, { trim: true, fb: x.acct || '' });
  });
  const pt = rnd(set.pointYen || 0);
  if (pt) J(y + '-12-31', [[pay, set.points === 'misc' ? '雑収入' : '仕入高', pt, set.points === 'misc' ? '仕入れで付いたポイント(雑収入)' : '仕入れで付いたポイント(仕入値引き)', 'out', set.points === 'misc' ? 'out' : 'buy']], { type: 'points', id: 'points' });
  if (T.A.closing) J(y + '-12-31', [['商品', '期末商品棚卸高', T.A.closing, '期末商品棚卸高の振替', 'out', 'out']], { type: 'stock', id: 'closing' });
  out.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.no - b.no);
  const re = {}; let seq = 0;
  out.forEach(e => { if (re[e.no] == null) re[e.no] = ++seq; e.no = re[e.no]; });
  return out;
}
export function journalOp(o) { const { y, L, S, E } = inputs(o); return { entries: journal(L, S, E, y, cleanSet(o && o.set)) }; }

const SOFT = {
  freee: { label: 'freee会計', acct: { '期首商品棚卸高': '期首商品棚卸', '期末商品棚卸高': '期末商品棚卸', '仕入高': '仕入高' } },
  mf: { label: 'マネーフォワード クラウド確定申告', acct: {} },
  yayoi: { label: 'やよいの青色申告', acct: { '仕入高': '仕入高' } }
};
function taxName(soft, k, set) {
  if (!set || set.tax !== 'taxable') return '対象外';
  const T = {
    freee: { sale: '課税売上10%', buy: '課対仕入10%', kobutsu: '課対仕入10%', out: '対象外' },
    mf: { sale: '課税売上 10%', buy: '課税仕入 10%', kobutsu: '課税仕入 10%', out: '対象外' },
    yayoi: { sale: '課税売上込10%', buy: '課対仕入込10%', kobutsu: '課対仕入込10%', out: '対象外' }
  };
  return (T[soft] || T.mf)[k] || '対象外';
}
const slash = d => String(d).replace(/-/g, '/');
/** 返り値 { header, rows, memoCol(摘要の列。-1 = 無し), memoCut(端末が名前を入れた後に切る文字数。0 = 切らない), meta:[{src,trim,fb,cut60}] }。rows の摘要の列は型({n} 入り) */
export function exportRows(entries, soft, set) {
  const map = (SOFT[soft] || {}).acct || {}, A = a => map[a] || a;
  const taxOf = (k, amt) => set && set.tax === 'taxable' && set.incl === false && (k === 'sale' || k === 'buy' || k === 'kobutsu') ? rnd(amt * 10 / 110) : '';
  const meta = entries.map(e => ({ src: e.src, trim: e.trim, fb: e.fb }));
  if (soft === 'yayoi') {
    return { header: null, memoCol: 16, memoCut: 32, meta, rows: entries.map(e =>
      ['2000', '', '', slash(e.date), A(e.dr), '', '', taxName('yayoi', e.taxDr, set), e.amt, taxOf(e.taxDr, e.amt), A(e.cr), '', '', taxName('yayoi', e.taxCr, set), e.amt, taxOf(e.taxCr, e.amt), e.tpl, '', '', '0', '', '', '0', '0', 'no']) };
  }
  if (soft === 'mf') {
    return { header: ['取引No', '取引日', '借方勘定科目', '借方補助科目', '借方部門', '借方取引先', '借方税区分', '借方インボイス', '借方金額(円)', '借方税額', '貸方勘定科目', '貸方補助科目', '貸方部門', '貸方取引先', '貸方税区分', '貸方インボイス', '貸方金額(円)', '貸方税額', '摘要', '仕訳メモ', 'タグ', 'MF仕訳タイプ', '決算整理仕訳'],
      memoCol: 18, memoCut: 0, meta, rows: entries.map((e, i) => [i + 1, slash(e.date), A(e.dr), '', '', '', taxName('mf', e.taxDr, set), '', e.amt, taxOf(e.taxDr, e.amt), A(e.cr), '', '', '', taxName('mf', e.taxCr, set), '', e.amt, taxOf(e.taxCr, e.amt), e.tpl, '', '', '', /棚卸高の振替/.test(e.tpl) ? '1' : '']) };
  }
  if (soft === 'freee') {
    return { header: ['伝票番号', '発生日', '借方勘定科目', '借方税区分', '借方金額', '借方税額', '貸方勘定科目', '貸方税区分', '貸方金額', '貸方税額', '摘要'], memoCol: 10, memoCut: 0, meta,
      rows: entries.map((e, i) => [i + 1, slash(e.date), A(e.dr), taxName('freee', e.taxDr, set), e.amt, taxOf(e.taxDr, e.amt) || 0, A(e.cr), taxName('freee', e.taxCr, set), e.amt, taxOf(e.taxCr, e.amt) || 0, e.tpl]) };
  }
  return { header: ['番号', '日付', '借方', '借方金額', '貸方', '貸方金額', '摘要'], memoCol: 6, memoCut: 0, meta, rows: entries.map(e => [e.no, e.date, e.dr, e.amt, e.cr, e.amt, e.tpl]) };
}
export function exportOp(o) {
  const { y, L, S, E } = inputs(o), set = cleanSet(o && o.set), soft = ['freee', 'mf', 'yayoi', 'plain'].includes(o && o.soft) ? o.soft : 'plain';
  return exportRows(journal(L, S, E, y, set), soft, set);
}

/* ------------------------------------------------------------------ デモ(見本)の受け付け: 見本の大きさだけを確かめる
 * 見本(?demo=1)は利用の鍵なしで全部を試せる決まり。サーバーは「見本の大きさ(行数)以内」の時だけ、無料の段でも答える。
 * 弱い所: 書き換えの分かる人は、小さい記録を ?demo の形で無料で集計できる(行数の上限まで。年の記録は上限を超えるので実用にならない)。 */
export const DEMO_MAX = { ledger: 300, sales: 300, expenses: 150 };
export function isDemoShape(o) {
  const ok = (a, max) => !a || (Array.isArray(a) && a.length <= max);
  return !!o && o.demo === true && ok(o.ledger, DEMO_MAX.ledger) && ok(o.sales, DEMO_MAX.sales) && ok(o.expenses, DEMO_MAX.expenses);
}
