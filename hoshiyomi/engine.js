// ほしよみ日和 — 計算の芯(ブラウザとNodeの両方で動く)
// 月と太陽の黄経: J. Meeus『Astronomical Algorithms』47章・25章の主要項(誤差はおおむね0.1度以内)
// 数秘術: 生年月日の数字をすべて足して一桁に(11・22・33はそのまま)

const R = Math.PI / 180;
const norm = (x) => ((x % 360) + 360) % 360;

export const SIGNS = [
  { key: "aries", name: "牡羊座", kana: "おひつじ座", el: "火", mode: "活動" },
  { key: "taurus", name: "牡牛座", kana: "おうし座", el: "地", mode: "不動" },
  { key: "gemini", name: "双子座", kana: "ふたご座", el: "風", mode: "柔軟" },
  { key: "cancer", name: "蟹座", kana: "かに座", el: "水", mode: "活動" },
  { key: "leo", name: "獅子座", kana: "しし座", el: "火", mode: "不動" },
  { key: "virgo", name: "乙女座", kana: "おとめ座", el: "地", mode: "柔軟" },
  { key: "libra", name: "天秤座", kana: "てんびん座", el: "風", mode: "活動" },
  { key: "scorpio", name: "蠍座", kana: "さそり座", el: "水", mode: "不動" },
  { key: "sagittarius", name: "射手座", kana: "いて座", el: "火", mode: "柔軟" },
  { key: "capricorn", name: "山羊座", kana: "やぎ座", el: "地", mode: "活動" },
  { key: "aquarius", name: "水瓶座", kana: "みずがめ座", el: "風", mode: "不動" },
  { key: "pisces", name: "魚座", kana: "うお座", el: "水", mode: "柔軟" },
];

// 雑誌などで一般的な区切り(月日 → 星座)。始まりの日
const STARTS = [[3, 21], [4, 20], [5, 21], [6, 22], [7, 23], [8, 23], [9, 23], [10, 24], [11, 23], [12, 22], [1, 20], [2, 19]];
export const SIGN_RANGES = STARTS.map((s, i) => {
  const n = STARTS[(i + 1) % 12];
  const end = new Date(Date.UTC(2001, n[0] - 1, n[1] - 1));
  return `${s[0]}月${s[1]}日〜${end.getUTCMonth() + 1}月${end.getUTCDate()}日`;
});

export function sunSignOf(month, day) {
  const v = month * 100 + day;
  for (let i = 0; i < 12; i++) {
    const [m, d] = STARTS[i];
    const [nm, nd] = STARTS[(i + 1) % 12];
    const a = m * 100 + d, b = nm * 100 + nd;
    if (a < b ? v >= a && v < b : v >= a || v < b) return i;
  }
  return 0;
}

export const julian = (ms) => ms / 86400000 + 2440587.5;

export function sunLon(jd) {
  const T = (jd - 2451545) / 36525;
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M * R)
    + (0.019993 - 0.000101 * T) * Math.sin(2 * M * R) + 0.000289 * Math.sin(3 * M * R);
  const om = 125.04 - 1934.136 * T;
  return norm(L0 + C - 0.00569 - 0.00478 * Math.sin(om * R));
}

const MT = [
  [0, 0, 1, 0, 6288774], [2, 0, -1, 0, 1274027], [2, 0, 0, 0, 658314], [0, 0, 2, 0, 213618],
  [0, 1, 0, 0, -185116], [0, 0, 0, 2, -114332], [2, 0, -2, 0, 58793], [2, -1, -1, 0, 57066],
  [2, 0, 1, 0, 53322], [2, -1, 0, 0, 45758], [0, 1, -1, 0, -40923], [1, 0, 0, 0, -34720],
  [0, 1, 1, 0, -30383], [2, 0, 0, -2, 15327], [0, 0, 1, 2, -12528], [0, 0, 1, -2, 10980],
  [4, 0, -1, 0, 10675], [0, 0, 3, 0, 10034], [4, 0, -2, 0, 8548], [2, 1, -1, 0, -7888],
  [2, 1, 0, 0, -6766], [1, 0, -1, 0, -5163], [1, 1, 0, 0, 4987], [2, -1, 1, 0, 4036],
  [2, 0, 2, 0, 3994], [4, 0, 0, 0, 3861], [2, 0, -3, 0, 3665], [0, 1, -2, 0, -2689],
  [2, 0, -1, 2, -2602], [2, -1, -2, 0, 2390], [1, 0, 1, 0, -2348], [2, -2, 0, 0, 2236],
  [0, 1, 2, 0, -2120], [0, 2, 0, 0, -2069], [2, -2, -1, 0, 2048], [2, 0, 1, -2, -1773],
  [2, 0, 0, 2, -1595], [4, -1, -1, 0, 1215], [0, 0, 2, 2, -1110], [3, 0, -1, 0, -892],
];

export function moonLon(jd) {
  const T = (jd - 2451545) / 36525;
  const Lp = 218.3164477 + 481267.88123421 * T - 0.0015786 * T * T;
  const D = 297.8501921 + 445267.1114034 * T - 0.0018819 * T * T;
  const M = 357.5291092 + 35999.0502909 * T - 0.0001536 * T * T;
  const Mp = 134.9633964 + 477198.8675055 * T + 0.0087414 * T * T;
  const F = 93.272095 + 483202.0175233 * T - 0.0036539 * T * T;
  const E = 1 - 0.002516 * T - 0.0000074 * T * T;
  let s = 0;
  for (const [d, m, mp, f, c] of MT) {
    const e = Math.abs(m) === 1 ? E : Math.abs(m) === 2 ? E * E : 1;
    s += c * e * Math.sin((d * D + m * M + mp * Mp + f * F) * R);
  }
  const A1 = 119.75 + 131.849 * T, A2 = 53.09 + 479264.29 * T;
  s += 3958 * Math.sin(A1 * R) + 1962 * Math.sin((Lp - F) * R) + 318 * Math.sin(A2 * R);
  return norm(Lp + s / 1e6);
}

const JST = 9 * 3600000;
// 日本時間の年月日 → その日の正午(日本時間)のUTCミリ秒
export const jstNoon = (y, m, d) => Date.UTC(y, m - 1, d, 3);
export function jstParts(ms) {
  const t = new Date(ms + JST);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), w: t.getUTCDay(), h: t.getUTCHours(), mi: t.getUTCMinutes() };
}
export const WEEK = ["日", "月", "火", "水", "木", "金", "土"];

export const moonSignAt = (ms) => Math.floor(moonLon(julian(ms)) / 30);
export const elongAt = (ms) => norm(moonLon(julian(ms)) - sunLon(julian(ms)));

// その日(日本時間0:00〜24:00)のうちに月が星座を移るなら、その時刻と移り先
export function moonIngressOn(y, m, d) {
  const a = Date.UTC(y, m - 1, d, -9), b = a + 86400000;
  const sa = moonSignAt(a), sb = moonSignAt(b);
  if (sa === sb) return null;
  let lo = a, hi = b;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (moonSignAt(mid) === sa) lo = mid; else hi = mid;
  }
  return { ms: hi, from: sa, to: sb, ...jstParts(hi) };
}

// 月相: 0=新月 … 180=満月。名前は日本の暦の呼び方
export function phaseName(e) {
  if (e < 12 || e >= 348) return "新月";
  if (e < 50) return "三日月";
  if (e < 100) return "上弦の月";
  if (e < 168) return "満ちていく月";
  if (e < 192) return "満月";
  if (e < 260) return "欠けていく月";
  if (e < 290) return "下弦の月";
  return "明けの細い月";
}
export const illum = (e) => (1 - Math.cos(e * R)) / 2;

// target(0=新月, 180=満月)になる時刻を [from, from+days] で探す
export function findPhase(fromMs, target, days = 32) {
  const f = (ms) => { let x = elongAt(ms) - target; x = ((x + 540) % 360) - 180; return x; };
  let prev = fromMs, pv = f(prev);
  for (let t = fromMs + 6 * 3600000; t <= fromMs + days * 86400000; t += 6 * 3600000) {
    const v = f(t);
    if (pv < 0 && v >= 0 && v - pv < 90) {
      let lo = prev, hi = t;
      for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (f(mid) < 0) lo = mid; else hi = mid; }
      return hi;
    }
    prev = t; pv = v;
  }
  return null;
}
export function lunations(fromMs, toMs) {
  const out = [];
  for (const [kind, tg] of [["new", 0], ["full", 180]]) {
    let t = fromMs;
    while (t < toMs) {
      const hit = findPhase(t, tg, 31);
      if (!hit || hit >= toMs) break;
      out.push({ kind, ms: hit, sign: moonSignAt(hit), ...jstParts(hit) });
      t = hit + 86400000 * 5;
    }
  }
  return out.sort((a, b) => a.ms - b.ms);
}

// ---------- 数秘術 ----------
const digitSum = (n) => String(n).split("").reduce((a, c) => a + +c, 0);
export function reduce(n, keepMaster = false) {
  while (n > 9) {
    if (keepMaster && (n === 11 || n === 22 || n === 33)) return n;
    n = digitSum(n);
  }
  return n;
}
export const lifePath = (y, m, d) => reduce(digitSum(`${y}${String(m).padStart(2, "0")}${String(d).padStart(2, "0")}`), true);
export const personalYear = (m, d, Y) => reduce(digitSum(m) + digitSum(d) + digitSum(Y));
export const personalMonth = (m, d, Y, M) => reduce(personalYear(m, d, Y) + digitSum(M));
export const personalDay = (m, d, Y, M, D) => reduce(personalMonth(m, d, Y, M) + digitSum(D));
export const universalDay = (Y, M, D) => reduce(digitSum(Y) + digitSum(M) + digitSum(D));

// 決まった種から同じ答えを返す小さな乱数(同じ日・同じ誕生日なら同じ文章)
export function seeded(...parts) {
  let h = 2166136261;
  for (const ch of parts.join("|")) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; };
}
export const pick = (arr, rnd) => arr[Math.floor(rnd() * arr.length) % arr.length];

// 太陽星座から見た「部屋」(1〜12)。サインハウス方式
export const houseOf = (signIdx, sunIdx) => ((signIdx - sunIdx + 12) % 12) + 1;
