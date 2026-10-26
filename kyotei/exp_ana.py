"""「今日の穴(万舟ねらい)」の決め方を学習外で検証する。賭け方の助言ではなく検証の記録。

python kyotei/exp_ana.py [hist_dir]

決め方(オッズは使わない):
- 3連単の組番ごとの「過去の平均払戻」(その期間より前のレースだけ)を、オッズの代わりの目安にする。
- 万舟らしさ = 平均払戻が1万円以上の組番の確率の合計(モデルの3連単の確率から)。1日の採点対象のうち、これが大きい上位 n_races レースを選ぶ。
- 組番 = ◎が1着の組番を除き、平均払戻が min_avg 円以上の組番のうち、モデルの確率が高い順に k 点(各100円)。
- n_races・k・min_avg は前半8週(見つける期間)で選び、後半8週(確かめる期間)だけで評価する。
出力: experiments/ana_v3.json(集計の数字だけ)
"""
from __future__ import annotations

import json
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import model2 as M  # noqa: E402
from features import ALLF, build  # noqa: E402
from jma import Tides  # noqa: E402
from train import fit_components, load_config, load_days, load_fan  # noqa: E402

ROOT = Path(__file__).resolve().parent
JST = timezone(timedelta(hours=9))
PERMS = M.PERMS
CODE = PERMS[:, 0] * 36 + PERMS[:, 1] * 6 + PERMS[:, 2]


def tri_pattern_avg(y, y2, y3, pay_tri, m: float = 5.0):
    """3連単の組番(120通り)ごとの、当たったときの平均払戻。数が少ない組番は全体の平均へ寄せる。"""
    code = y * 36 + y2 * 6 + y3
    s = np.zeros(216)
    c = np.zeros(216)
    ok = pay_tri > 0
    np.add.at(s, code[ok], pay_tri[ok])
    np.add.at(c, code[ok], 1)
    g = s.sum() / max(c.sum(), 1)
    avg = (s + m * g) / (c + m)
    return avg[CODE], c[CODE]


def ana_picks(P, T, avg, k: int, min_avg: float):
    """各レース: 万舟らしさ と、穴の組番 k 点(PERMS の添字)。"""
    p_man = (T * (avg[None, :] >= 10000)).sum(1)
    fav = P.argmax(1)
    ok = (avg[None, :] >= min_avg) & (PERMS[None, :, 0] != fav[:, None])
    score = np.where(ok, T, -1)
    picks = np.argsort(-score, axis=1)[:, :k]
    return p_man, picks


def evaluate(D, p_man, picks, actual, pay_tri, n_races: int):
    days = np.unique(D)
    sel = []
    for d in days:
        idx = np.where(D == d)[0]
        sel += list(idx[np.argsort(-p_man[idx])[:n_races]])
    sel = np.array(sel, int)
    k = picks.shape[1]
    hit = (CODE[picks[sel]] == actual[sel, None]).any(1)
    ret = np.where(hit, pay_tri[sel], 0.0)
    return sel, hit, ret, k


def stats(ret, k, hit, pay, B=2000, seed=0):
    n = len(ret)
    if n == 0:
        return {"races": 0}
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, n, (B, n))
    bs = ret[idx].sum(1) / (100 * k * n)
    return {"races": int(n), "points": int(k), "hit": round(float(hit.mean()), 4), "hits": int(hit.sum()),
            "avg_pay_when_hit": round(float(pay[hit].mean()), 0) if hit.any() else 0,
            "manshu_hits": int((pay[hit] >= 10000).sum()),
            "roi": round(float(ret.sum() / (100 * k * n)), 4), "lo": round(float(np.percentile(bs, 2.5)), 4),
            "hi": round(float(np.percentile(bs, 97.5)), 4)}


def main(hist: Path, weeks: int = 8):
    t0 = time.time()
    cfg = load_config()
    days = load_days(hist, max_days=1095)
    data, _ = build(days, load_fan(hist), tides=Tides(hist / "jma"))
    D, y, y2, y3, pt = data["D"], data["y"], data["y2"], data["y3"], data["pay_tri"]
    actual = y * 36 + y2 * 6 + y3
    last = int(np.unique(D)[-1])
    starts = [last - 7 * k + 1 for k in range(2 * weeks, 0, -1)]
    keep, w0 = [], None
    for s in starts:
        tr = D < s
        te = (D >= s) & (D < s + 7)
        comps = fit_components(data, tr, cfg, s, w0)
        w0 = [c["w"] for c in comps]
        keep.append((np.where(te)[0], M.predict_model({"components": comps}, data["X"][te], data["V"][te], ALLF)))
    A = (np.concatenate([i for i, _ in keep[:weeks]]), np.concatenate([p for _, p in keep[:weeks]]))
    Bv = (np.concatenate([i for i, _ in keep[weeks:]]), np.concatenate([p for _, p in keep[weeks:]]))
    lam = M.fit_lambdas(A[1], y[A[0]], y2[A[0]], y3[A[0]])
    rep = {"generated_at": datetime.now(JST).isoformat(timespec="minutes"), "lambda": lam,
           "discover": [date.fromordinal(starts[0]).isoformat(), date.fromordinal(starts[weeks] - 1).isoformat()],
           "validate": [date.fromordinal(starts[weeks]).isoformat(), date.fromordinal(last).isoformat()]}
    grid = [(n, k, a) for n in (2, 3) for k in (3, 5, 10) for a in (3000, 5000, 10000)]
    res = {}
    for ph, (idx, P), start in (("discover", A, starts[0]), ("validate", Bv, starts[weeks])):
        before = D < start
        avg, _ = tri_pattern_avg(y[before], y2[before], y3[before], pt[before])
        T = M.trifecta_probs(P, *lam)
        res[ph] = {}
        for n, k, a in grid:
            p_man, picks = ana_picks(P, T, avg, k, a)
            sel, hit, ret, kk = evaluate(D[idx], p_man, picks, actual[idx], pt[idx], n)
            res[ph][(n, k, a)] = stats(ret, kk, hit, pt[idx][sel])
        # 比べるもの: 同じ日の「全レースの3連単の万舟率」と、選んだレースの実際の万舟率
        allman = float((pt[idx] >= 10000).mean())
        p_man, _ = ana_picks(P, T, avg, 5, 5000)
        sel, _, _, _ = evaluate(D[idx], p_man, np.zeros((len(idx), 1), int), actual[idx], pt[idx], 3)
        res[ph]["_base"] = {"manshu_rate_all": round(allman, 4), "manshu_rate_selected": round(float((pt[idx][sel] >= 10000).mean()), 4),
                            "mean_pred_p_manshu_selected": round(float(p_man[sel].mean()), 4)}
    cand = [(v["roi"], key) for key, v in res["discover"].items() if key != "_base" and v.get("races", 0) >= 100]
    best = max(cand)[1]
    rep["grid_tested"] = len(grid)
    rep["chosen_on_discover"] = {"n_races_per_day": best[0], "points": best[1], "min_avg_payout": best[2], "discover": res["discover"][best]}
    rep["validate_chosen"] = res["validate"][best]
    days_v = len(np.unique(D[Bv[0]]))
    rep["validate_chosen"]["manshu_hits_per_30days"] = round(res["validate"][best]["manshu_hits"] / days_v * 30, 1)
    rep["base"] = {ph: res[ph]["_base"] for ph in res}
    rep["all_validate"] = {f"n{n}_k{k}_a{a}": res["validate"][(n, k, a)] for n, k, a in grid}
    rep["all_discover"] = {f"n{n}_k{k}_a{a}": res["discover"][(n, k, a)] for n, k, a in grid}
    rep["runtime_min"] = round((time.time() - t0) / 60, 1)
    (ROOT / "experiments").mkdir(exist_ok=True)
    (ROOT / "experiments" / "ana_v3.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({k: rep[k] for k in ("chosen_on_discover", "validate_chosen", "base")}, ensure_ascii=False))


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "hist")
