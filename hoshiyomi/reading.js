// 計算と文章を組み合わせて「読みもの」にする
import * as E from "./engine.js";
import * as D from "./texts-daily.js";
import * as P from "./texts-profile.js";
import * as T from "./texts-report.js";

const clamp = (v) => Math.max(1, Math.min(5, v));
const PD_MOD = [null, [0, 0, 1, 0, 0], [0, 1, -1, 0, 0], [1, 1, 0, 0, 0], [0, -1, 1, 0, 1], [1, 0, 0, -1, 0], [0, 1, 0, 0, 0], [-1, 0, 0, 0, 1], [0, 0, 1, 1, -1], [0, 0, 0, 0, 0]];

export function today() { const p = E.jstParts(Date.now()); return { y: p.y, m: p.m, d: p.d, w: p.w }; }

export function sky(day) {
  const noon = E.jstNoon(day.y, day.m, day.d);
  const e = E.elongAt(noon);
  return {
    moonSign: E.moonSignAt(noon), phase: E.phaseName(e), illum: E.illum(e), elong: e,
    ingress: E.moonIngressOn(day.y, day.m, day.d),
  };
}

export function profile(b) {
  const sun = E.sunSignOf(b.m, b.d);
  const lp = E.lifePath(b.y, b.m, b.d);
  return { sun, sign: E.SIGNS[sun], sp: P.SIGN_PROFILE[sun], lp, lpt: P.LP[lp] };
}

export function daily(b, day) {
  const s = sky(day);
  const sun = E.sunSignOf(b.m, b.d);
  const house = E.houseOf(s.moonSign, sun);
  const pd = E.personalDay(b.m, b.d, day.y, day.m, day.d);
  const rnd = E.seeded(b.y, b.m, b.d, day.y, day.m, day.d);
  const base = D.HOUSE[house].score;
  const sc = base.map((v, i) => clamp(v + PD_MOD[pd][i]));
  const keys = ["love", "work", "money", "body"];
  return {
    day, sky: s, sun, sign: E.SIGNS[sun], house, houseName: D.HOUSE[house].name, pd, pdTitle: D.PDAY[pd].title,
    overall: sc[0],
    main: E.pick(D.HOUSE_TEXT[house], rnd),
    numText: E.pick(D.PDAY[pd].text, rnd),
    phaseLine: D.PHASE_LINE[s.phase],
    cats: keys.map((k, i) => ({ key: k, label: D.CAT[k].label, score: sc[i + 1], text: E.pick(D.CAT[k].lines[sc[i + 1]], rnd) })),
    action: E.pick(D.ACTION[house], rnd),
    item: E.pick(D.LUCKY_ITEM[house], rnd),
    color: D.LUCKY_COLOR[pd],
    closing: E.pick(D.CLOSING[pd], rnd),
  };
}

// 星座だけで見る今日のランキング(誕生年を使わない)
export function ranking(day) {
  const s = sky(day);
  const ud = E.universalDay(day.y, day.m, day.d);
  return E.SIGNS.map((sg, i) => {
    const house = E.houseOf(s.moonSign, i);
    const sc = D.HOUSE[house].score;
    const elBonus = E.SIGNS[s.moonSign].el === sg.el ? 0.6 : 0;
    const tie = E.seeded(day.y, day.m, day.d, i, ud)() * 0.5;
    const rnd = E.seeded("r", day.y, day.m, day.d, i);
    return { idx: i, sign: sg, house, pts: sc[0] * 2 + sc[1] + sc[2] + sc[3] + elBonus + tie, line: E.pick(D.RANK_LINE[house], rnd) };
  }).sort((a, b) => b.pts - a.pts).map((r, k) => ({ ...r, rank: k + 1 }));
}

// ---------- 年間運勢 ----------
const jupiterSign = (y, m, d) => (y < 2027 || (y === 2027 && (m < 7 || (m === 7 && d < 26)))) ? 4 : 5; // 獅子座→乙女座(2027/7/26ごろ)
const SATURN_SIGN = 0; // 牡羊座(2026/2〜2028/4)

export function annual(b, Y = 2027) {
  const pr = profile(b);
  const py = E.personalYear(b.m, b.d, Y);
  const jA = E.houseOf(jupiterSign(Y, 1, 1), pr.sun), jB = E.houseOf(jupiterSign(Y, 12, 1), pr.sun);
  const sat = E.houseOf(SATURN_SIGN, pr.sun);
  const luns = E.lunations(Date.UTC(Y, 0, 1, -9), Date.UTC(Y + 1, 0, 1, -9));
  const months = [];
  for (let M = 1; M <= 12; M++) {
    const pm = E.personalMonth(b.m, b.d, Y, M);
    const days = new Date(Date.UTC(Y, M, 0)).getUTCDate();
    const list = [];
    for (let d = 1; d <= days; d++) {
      const r = daily(b, { y: Y, m: M, d });
      const total = r.overall * 2 + r.cats.reduce((a, c) => a + c.score, 0);
      list.push({ d, w: new Date(Date.UTC(Y, M - 1, d)).getUTCDay(), total, love: r.cats[0].score, work: r.cats[1].score, house: r.house });
    }
    const best = [...list].sort((a, b2) => b2.total - a.total || a.d - b2.d).slice(0, 3).sort((a, b2) => a.d - b2.d);
    const love = [...list].filter((x) => x.house === 5 || x.house === 7).sort((a, b2) => b2.love - a.love || a.d - b2.d).slice(0, 2).sort((a, b2) => a.d - b2.d);
    const work = [...list].sort((a, b2) => b2.work - a.work || a.d - b2.d).slice(0, 2).sort((a, b2) => a.d - b2.d);
    const rest = [...list].filter((x) => x.house === 12).slice(0, 3);
    const moons = luns.filter((l) => l.m === M && l.y === Y).map((l) => ({ ...l, house: E.houseOf(l.sign, pr.sun) }));
    months.push({ M, pm, pmText: T.PM[pm], best, love, work, rest, moons });
  }
  return { Y, pr, py, pyt: T.PY[py], jupiter: [{ when: "1月〜7月下旬", house: jA, text: T.JUPITER[jA] }, { when: "7月下旬〜12月", house: jB, text: T.JUPITER[jB] }], saturn: { house: sat, text: T.SATURN[sat] }, months, moonHouse: T.MOON_HOUSE };
}

// ---------- ふたりの相性 ----------
const noonMoon = (b) => E.moonSignAt(E.jstNoon(b.y, b.m, b.d));
const base9 = (n) => (n > 9 ? E.reduce(n) : n);

export function compat(a, b, Y = 2027) {
  const pa = profile(a), pb = profile(b);
  let dist = Math.abs(pa.sun - pb.sun); if (dist > 6) dist = 12 - dist;
  const ma = noonMoon(a), mb = noonMoon(b);
  let md = Math.abs(ma - mb); if (md > 6) md = 12 - md;
  const x = base9(pa.lp), y = base9(pb.lp);
  const key = `${Math.min(x, y)}-${Math.max(x, y)}`;
  const h = T.LP_HARMONY[key];
  const moonBonus = [6, 0, 4, -3, 6, -2, 2][md];
  const score = Math.max(55, Math.min(98, T.ASPECT[dist].score + [-4, 2, 6][h] + moonBonus));
  const pyA = E.personalYear(a.m, a.d, Y), pyB = E.personalYear(b.m, b.d, Y);
  const order = "火地風水";
  const ek = [pa.sign.el, pb.sign.el].sort((p, q) => order.indexOf(p) - order.indexOf(q)).join("");
  // これから60日のうち、ふたりとも恋愛の流れがいい日
  const start = today(), dates = [];
  for (let k = 1; k <= 60; k++) {
    const t = new Date(Date.UTC(start.y, start.m - 1, start.d + k));
    const day = { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), w: t.getUTCDay() };
    const ra = daily(a, day), rb = daily(b, day);
    const love = ra.cats[0].score + rb.cats[0].score + (ra.house === 5 || ra.house === 7 ? 1 : 0) + (rb.house === 5 || rb.house === 7 ? 1 : 0);
    dates.push({ ...day, love, why: ra.cats[0].score >= rb.cats[0].score ? "a" : "b", ha: ra.house, hb: rb.house });
  }
  const dateDays = dates.sort((p, q) => q.love - p.love || (p.y * 400 + p.m * 31 + p.d) - (q.y * 400 + q.m * 31 + q.d)).slice(0, 4).sort((p, q) => (p.y * 400 + p.m * 31 + p.d) - (q.y * 400 + q.m * 31 + q.d));
  return {
    element: { a: pa.sign.el, b: pb.sign.el, text: T.ELEMENT_PAIR[ek] }, dateDays, charmA: T.SIGN_CHARM[pa.sun], charmB: T.SIGN_CHARM[pb.sun], keep: T.ASPECT_KEEP[dist],
    pa, pb, dist, aspect: T.ASPECT[dist], score,
    moon: { a: E.SIGNS[ma], b: E.SIGNS[mb], dist: md, text: T.MOON_ASPECT[md] },
    lp: { a: pa.lp, b: pb.lp, harmony: h, text: T.LP_HARMONY_TEXT[h], A: P.LP[pa.lp], B: P.LP[pb.lp] },
    year: { Y, a: pyA, b: pyB, at: T.PY[pyA], bt: T.PY[pyB] },
  };
}

export { E, D, P, T };
