"""毎日の成績(公開後の実績だけ)を kyotei/metrics/daily.json に書く。Xの投稿とページが同じ数字を使えるように。

python kyotei/metrics.py      … predictions/ と results/ から作り直す(取得はしない)

- 数えるのは「公開時刻より後に締切のあったレース」(results/ に入っているもの)だけ。学習外の検証の数字は混ぜない。
- rolling30 = 答え合わせ済みの最後の日から30日分。since_start = 公開してからの全部。daily = 日ごと(直近60日)。
- 2連単は 2026-10-28 の予想から公開時に上位3点を記録している。それより前の日は、非公開の履歴(hist/paper の3連単の確率と
  hist の確定払戻)が手元にあるときだけ数える(Actions の中)。無い日は数えず、件数(races)を別に出す。
- [ ] は95%区間(的中率はウィルソン、差と回収率はレース単位のブートストラップ)。
"""
from __future__ import annotations

import gzip
import json
import math
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
JST = timezone(timedelta(hours=9))
OUT = ROOT / "metrics" / "daily.json"
EXL = [(a, b) for a in range(6) for b in range(6) if a != b]


def wilson(k, n, z=1.96):
    if n == 0:
        return [None, None]
    p = k / n
    den = 1 + z * z / n
    c = (p + z * z / (2 * n)) / den
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return [round(c - h, 4), round(c + h, 4)]


def boot(x, B=2000, seed=0, ratio_den=None):
    x = np.asarray(x, float)
    n = len(x)
    if n == 0:
        return [None, None]
    rng = np.random.default_rng(seed)
    ix = rng.integers(0, n, (B, n))
    if ratio_den is None:
        bs = x[ix].mean(1)
    else:
        den = np.asarray(ratio_den, float)
        bs = x[ix].sum(1) / den[ix].sum(1)
    return [round(float(np.percentile(bs, 2.5)), 4), round(float(np.percentile(bs, 97.5)), 4)]


def _hist_day(d: date):
    f = ROOT / "hist" / f"{d:%Y%m%d}.json.gz"
    if not f.exists():
        return {}
    try:
        return json.loads(gzip.decompress(f.read_bytes()))["results"]
    except Exception:  # noqa
        return {}


def _paper_T(d: date):
    f = ROOT / "hist" / "paper" / f"T_{d:%Y-%m-%d}.json.gz"
    if not f.exists():
        return {}
    try:
        return json.loads(gzip.decompress(f.read_bytes()))
    except Exception:  # noqa
        return {}


def _exacta_top3_from_T(t):
    from itertools import permutations
    perms = list(permutations(range(6), 3))
    ex = {}
    for p, (a, b, _) in zip(t, perms):
        ex[(a, b)] = ex.get((a, b), 0.0) + p
    top = sorted(ex.items(), key=lambda kv: -kv[1])[:3]
    return [f"{a+1}-{b+1}" for (a, b), _ in top]


def rows_for_day(d: date) -> list[dict]:
    """1日分のレースごとの行(答え合わせ済みのレースだけ)。"""
    rf = ROOT / "results" / f"{d:%Y-%m-%d}.json"
    pf = ROOT / "predictions" / f"{d:%Y-%m-%d}.json"
    if not rf.exists() or not pf.exists():
        return []
    res = json.loads(rf.read_text(encoding="utf-8"))
    pred = {x["key"]: x for x in json.loads(pf.read_text(encoding="utf-8"))["races"]}
    hist, T = None, None
    out = []
    for r in res["races"]:
        p = pred.get(r["key"])
        if not p:
            continue
        act = [int(c) for c in r["actual"].split("-")]
        probs = p["probs"]
        ex_top = [c for c, _ in p.get("exacta", [])]
        ex_pay = r.get("exacta_payout")
        if not ex_top or ex_pay is None:
            if hist is None:
                hist, T = _hist_day(d), _paper_T(d)
            if not ex_top and r["key"] in T:
                ex_top = _exacta_top3_from_T(T[r["key"]])
            if ex_pay is None and r["key"] in hist:
                h = hist[r["key"]]
                ex_pay = ((h.get("pay") or {}).get("exacta") or h.get("exacta") or {}).get(f"{act[0]}-{act[1]}")
        ex_act = f"{act[0]}-{act[1]}"
        out.append({
            "date": d.isoformat(), "tier": r.get("tier"), "star": bool(r.get("star")),
            "win_hit": bool(r["win_hit"]), "lane1": bool(r["lane1_won"]),
            "ll": -math.log(max(float(probs[act[0] - 1]), 1e-9)),
            "ret_win": float(r.get("pay_win", 0)), "ret_lane1": float(r.get("base_pay", 0)),
            "tri3_hit": bool(r["tri_hit"]), "ret_tri3": float(r.get("pay_tri", 0)),
            "ex_ok": bool(ex_top) and ex_pay is not None,
            "ex3_hit": bool(ex_top) and ex_act in ex_top[:3],
            "ex1_hit": bool(ex_top) and ex_act == ex_top[0],
            "ret_ex1": float(ex_pay or 0) if (ex_top and ex_act == ex_top[0]) else 0.0,
        })
    return out


def summarize(rows: list[dict]) -> dict:
    n = len(rows)
    if n == 0:
        return {"races": 0}
    a = lambda k: np.array([float(r[k]) for r in rows])  # noqa: E731
    win, lane1 = a("win_hit"), a("lane1")
    ex = [r for r in rows if r["ex_ok"]]
    e = lambda k: np.array([float(r[k]) for r in ex])  # noqa: E731
    out = {
        "races": n, "days": len({r["date"] for r in rows}),
        "honmei_win_rate": round(win.mean(), 4), "honmei_win_ci": wilson(int(win.sum()), n),
        "naive_lane1_rate": round(lane1.mean(), 4),
        "vs_naive_pt": round((win - lane1).mean() * 100, 2), "vs_naive_ci_pt": [None if v is None else round(v * 100, 2) for v in boot(win - lane1)],
        "logloss_win": round(a("ll").mean(), 4), "logloss_win_ci": boot(a("ll")),
        "trifecta_top3_hit": round(a("tri3_hit").mean(), 4), "trifecta_top3_ci": wilson(int(a("tri3_hit").sum()), n),
        "roi_tansho": round(a("ret_win").sum() / (100 * n), 4), "roi_tansho_ci": boot(a("ret_win"), ratio_den=np.full(n, 100.0)),
        "roi_lane1_tansho": round(a("ret_lane1").sum() / (100 * n), 4),
        "roi_trifecta_top3": round(a("ret_tri3").sum() / (300 * n), 4), "roi_trifecta_top3_ci": boot(a("ret_tri3"), ratio_den=np.full(n, 300.0)),
        "exacta_races": len(ex),
    }
    if ex:
        m = len(ex)
        out.update({"exacta_top3_hit": round(e("ex3_hit").mean(), 4), "exacta_top3_ci": wilson(int(e("ex3_hit").sum()), m),
                    "exacta_top1_hit": round(e("ex1_hit").mean(), 4),
                    "roi_exacta_top1": round(e("ret_ex1").sum() / (100 * m), 4),
                    "roi_exacta_top1_ci": boot(e("ret_ex1"), ratio_den=np.full(m, 100.0))})
    return out


def build(today: date | None = None) -> dict:
    days = sorted(date.fromisoformat(f.stem) for f in (ROOT / "results").glob("*.json"))
    rows_by_day = {d: rows_for_day(d) for d in days}
    days = [d for d in days if rows_by_day[d]]
    if not days:
        return {}
    last = days[-1]
    first30 = last - timedelta(days=29)
    r30 = [r for d in days if d >= first30 for r in rows_by_day[d]]
    allr = [r for d in days for r in rows_by_day[d]]
    out = {
        "schema": 1,
        "generated_at": datetime.now(JST).isoformat(timespec="minutes"),
        "note": "公開後の実績だけ(公開時刻より後に締切のレース)。毎回100円の仮の回収率で、利益を約束しない。[ ]は95%区間。",
        "definitions": {
            "honmei_win_rate": "◎(1着の確率が最も高い艇)の1着率", "naive_lane1_rate": "1号艇を毎回選んだ場合の1着率",
            "vs_naive_pt": "◎の1着率 − 1号艇の1着率(ポイント)", "logloss_win": "1着の確率の対数損失(小さいほど良い)",
            "exacta_top3_hit": "2連単 確率上位3点のどれかが当たった割合", "trifecta_top3_hit": "3連単 確率上位3点のどれかが当たった割合",
            "roi_tansho": "単勝◎ 100円ずつ", "roi_exacta_top1": "2連単 確率1位 100円ずつ", "roi_trifecta_top3": "3連単 上位3点 300円ずつ",
            "roi_lane1_tansho": "比較: 1号艇の単勝 100円ずつ"},
        "rolling30": {"from": max(first30, days[0]).isoformat(), "to": last.isoformat(), **summarize(r30)},
        "rolling30_tier_S": summarize([r for r in r30 if r["tier"] == "S"]),
        "since_start": {"from": days[0].isoformat(), "to": last.isoformat(), **summarize(allr)},
        "daily": [{"date": d.isoformat(), **{k: v for k, v in summarize(rows_by_day[d]).items() if "_ci" not in k}}
                  for d in days[-60:]],
    }
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    return out


if __name__ == "__main__":
    o = build()
    print(json.dumps(o.get("rolling30"), ensure_ascii=False, indent=1))
