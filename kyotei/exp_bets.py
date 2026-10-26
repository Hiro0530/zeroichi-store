"""全券種(単勝・複勝・2連単・2連複・拡連複・3連単・3連複)の「100円ずつ買ったら」を学習外で調べる。賭け方の助言ではなく検証の記録。

python kyotei/exp_bets.py [hist_dir]

- 直近16週を1週ずつウォークフォワード(構成は model_config.json)。前半8週=見つける期間、後半8週=確かめる期間。
- 券種ごとの確率は 1着の確率 → 3連単の確率(Harville+補正) から計算(2連単・2連複・拡連複・3連複・複勝はその合計)。
- (1) 券種 × 点数 × 自信度 の回収率と的中率
- (2) オッズを使わない絞り込み: ◎の確率 ≥ X かつ「◎が1着のときの2着」の散らばり(エントロピー)≤ H
- (3) オッズの代わりに「その組番の過去の平均払戻」(その期間より前のレースだけ)を使い、確率×平均払戻 ≥ t の組番だけ買う
- (2)(3) は見つける期間でいちばん良かった条件を選び、確かめる期間だけで評価する。何通り試したかも出す(多重比較の注意)。
- 出力: experiments/bets_v3.json(集計の数字だけ)
"""
from __future__ import annotations

import json
import sys
import time
from datetime import date, datetime, timedelta, timezone
from itertools import combinations
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
EXL = [(a, b) for a in range(6) for b in range(6) if a != b]
PAIRS = list(combinations(range(6), 2))
TRIPS = list(combinations(range(6), 3))


def _mat(rows, cols, fn):
    A = np.zeros((rows, cols))
    for i, pm in enumerate(PERMS):
        for j in range(cols):
            if fn(pm, j):
                A[i, j] = 1
    return A


M_EX = _mat(120, 30, lambda pm, j: (pm[0], pm[1]) == EXL[j])
M_WIDE = _mat(120, 15, lambda pm, j: set(PAIRS[j]) <= set(pm))
M_TRIO = _mat(120, 20, lambda pm, j: set(TRIPS[j]) == set(pm))
M_TOP2 = _mat(120, 6, lambda pm, j: j in pm[:2])
LBL = {
    "tansho": [str(i + 1) for i in range(6)], "fukusho": [str(i + 1) for i in range(6)],
    "exacta": [f"{a+1}-{b+1}" for a, b in EXL], "quinella": [f"{a+1}-{b+1}" for a, b in PAIRS],
    "wide": [f"{a+1}-{b+1}" for a, b in PAIRS], "trifecta": [f"{a+1}-{b+1}-{c+1}" for a, b, c in PERMS],
    "trio": [f"{a+1}-{b+1}-{c+1}" for a, b, c in TRIPS]}
BETS = [("tansho", 1), ("fukusho", 1), ("exacta", 1), ("exacta", 3), ("quinella", 1), ("quinella", 3), ("wide", 1), ("wide", 3),
        ("trifecta", 1), ("trifecta", 3), ("trifecta", 5), ("trifecta", 10), ("trio", 1), ("trio", 3), ("trio", 5)]
JP = {"tansho": "単勝", "fukusho": "複勝", "exacta": "2連単", "quinella": "2連複", "wide": "拡連複", "trifecta": "3連単", "trio": "3連複"}


def probs_all(P, lam, T=None):
    """券種ごとの確率。T(3連単の確率)を渡せばそれを使う(本番は2着・3着の条件付きモデル)。無ければ Harville+補正。"""
    if T is None:
        T = M.trifecta_probs(P, *lam)
    ex = T @ M_EX
    qu = np.stack([ex[:, EXL.index((a, b))] + ex[:, EXL.index((b, a))] for a, b in PAIRS], 1)
    return {"tansho": P, "fukusho": T @ M_TOP2, "exacta": ex, "quinella": qu, "wide": T @ M_WIDE, "trifecta": T, "trio": T @ M_TRIO}, ex


def returns_for(prob, labels, pays, bet, k, mask=None):
    """各レースで確率の高い k 点(mask で選んだ組番だけ)を100円ずつ。→ (払戻, 賭け金) の配列"""
    order = np.argsort(-prob, axis=1)
    ret = np.zeros(len(prob))
    stake = np.zeros(len(prob))
    for i in range(len(prob)):
        d = (pays[i] or {}).get(bet) or {}
        cols = order[i, :k] if mask is None else np.where(mask[i])[0]
        stake[i] = 100 * len(cols)
        ret[i] = sum(d.get(labels[c], 0) for c in cols)
    return ret, stake


def stats(ret, stake, B=2000, seed=0):
    n = len(ret)
    if n == 0 or stake.sum() == 0:
        return {"races": int(n), "bets": 0}
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, n, (B, n))
    bs = ret[idx].sum(1) / np.maximum(stake[idx].sum(1), 1)
    played = stake > 0
    return {"races": int(played.sum()), "bets": int(stake.sum() / 100), "roi": round(float(ret.sum() / stake.sum()), 4),
            "lo": round(float(np.percentile(bs, 2.5)), 4), "hi": round(float(np.percentile(bs, 97.5)), 4),
            "hit": round(float((ret[played] > 0).mean()), 4) if played.any() else 0.0}


def pattern_avg(pays, bet, labels, m=5.0):
    """組番ごとの過去の平均払戻(当たったときの額)。数が少ない組番は券種全体の平均へ寄せる。"""
    s, c = np.zeros(len(labels)), np.zeros(len(labels))
    li = {l: i for i, l in enumerate(labels)}
    for p in pays:
        for comb, amt in ((p or {}).get(bet) or {}).items():
            if comb in li:
                s[li[comb]] += amt
                c[li[comb]] += 1
    g = s.sum() / max(c.sum(), 1)
    return (s + m * g) / (c + m), c


def main(hist: Path, weeks: int = 8):
    t0 = time.time()
    cfg = load_config()
    tiers = cfg.get("tiers") or M.TIERS
    days = load_days(hist, max_days=1095)
    data, _ = build(days, load_fan(hist), tides=Tides(hist / "jma"))
    D = data["D"]
    payd = data["payd"]
    last = int(np.unique(D)[-1])
    starts = [last - 7 * k + 1 for k in range(2 * weeks, 0, -1)]
    keep, w0 = [], None
    for s in starts:
        tr = D < s
        te = (D >= s) & (D < s + 7)
        comps = fit_components(data, tr, cfg, s, w0)
        w0 = [c["w"] for c in comps]
        keep.append((np.where(te)[0], M.predict_model({"components": comps}, data["X"][te], data["V"][te], ALLF)))
    print(f"folds done {time.time()-t0:.0f}s", flush=True)
    A = (np.concatenate([i for i, _ in keep[:weeks]]), np.concatenate([p for _, p in keep[:weeks]]))
    Bv = (np.concatenate([i for i, _ in keep[weeks:]]), np.concatenate([p for _, p in keep[weeks:]]))
    lam = M.fit_lambdas(A[1], data["y"][A[0]], data["y2"][A[0]], data["y3"][A[0]])
    have = np.array([bool(p and p.get("trio")) for p in payd])
    rep = {"generated_at": datetime.now(JST).isoformat(timespec="minutes"), "lambda": lam, "tiers": tiers,
           "discover": [date.fromordinal(starts[0]).isoformat(), date.fromordinal(starts[weeks] - 1).isoformat()],
           "validate": [date.fromordinal(starts[weeks]).isoformat(), date.fromordinal(last).isoformat()],
           "payout_coverage": {"discover": round(float(have[A[0]].mean()), 4), "validate": round(float(have[Bv[0]].mean()), 4),
                               "before_discover": int(have[D < starts[0]].sum())}}
    out = {}
    tests = {"rule2": 0, "rule3": 0}
    for ph, (idx, P) in (("discover", A), ("validate", Bv)):
        ok = have[idx]
        idx, P = idx[ok], P[ok]
        pays = [payd[i] for i in idx]
        pr, ex = probs_all(P, lam)
        top = P.max(1)
        segs = {"all": np.ones(len(idx), bool)}
        for i, (nm, lo) in enumerate(tiers):
            hi = tiers[i - 1][1] if i else 1.01
            segs[nm] = (top >= lo) & (top < hi)
        tab = {}
        R = {}
        for bet, k in BETS:
            ret, stake = returns_for(pr[bet], LBL[bet], pays, bet, k)
            R[(bet, k)] = (ret, stake)
            tab[f"{JP[bet]}{k}点"] = {sn: stats(ret[m], stake[m]) for sn, m in segs.items()}
        # (2) ◎の確率と、◎が1着のときの2着の散らばり
        pk = P.argmax(1)
        E = np.zeros((len(P), 6, 6))
        for c, (a, b) in enumerate(EXL):
            E[:, a, b] = ex[:, c]
        q = E[np.arange(len(P)), pk, :]
        q = q / np.maximum(q.sum(1, keepdims=True), 1e-12)
        H = -(np.where(q > 0, q * np.log(np.maximum(q, 1e-12)), 0)).sum(1)
        out[ph] = {"idx_n": int(len(idx)), "tab": tab, "R": R, "top": top, "H": H, "pays": pays, "pr": pr, "D": D[idx]}
    # (2) 条件の格子: 見つける期間で選ぶ
    Xs = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8]
    Hq = [None, 0.5, 0.35, 0.2]   # 2着の散らばりの分位(見つける期間の分布で決める)。None=条件なし
    Hcut = {qq: (float(np.quantile(out["discover"]["H"], qq)) if qq else 9.0) for qq in Hq}
    rule2 = []
    for bet, k in BETS:
        best = None
        for X in Xs:
            for qq in Hq:
                tests["rule2"] += 1
                m = (out["discover"]["top"] >= X) & (out["discover"]["H"] <= Hcut[qq])
                if m.sum() < 300:
                    continue
                r, s_ = out["discover"]["R"][(bet, k)]
                st = stats(r[m], s_[m], B=300)
                if best is None or st["roi"] > best[0]["roi"]:
                    best = (st, X, qq)
        if best:
            st, X, qq = best
            mv = (out["validate"]["top"] >= X) & (out["validate"]["H"] <= Hcut[qq])
            r, s_ = out["validate"]["R"][(bet, k)]
            rule2.append({"bet": f"{JP[bet]}{k}点", "X": X, "H_quantile": qq, "H_cut": round(Hcut[qq], 3),
                          "discover": st, "validate": stats(r[mv], s_[mv])})
    # (3) 過去の平均払戻 × 確率
    rule3 = []
    Dall = data["D"]
    for bet in ("tansho", "fukusho", "exacta", "quinella", "wide", "trifecta", "trio"):
        res_ph = {}
        for ph, start in (("discover", starts[0]), ("validate", starts[weeks])):
            before = [payd[i] for i in np.where((Dall < start) & have)[0]]
            avg, cnt = pattern_avg(before, bet, LBL[bet])
            ev = out[ph]["pr"][bet] * avg[None, :] / 100
            res_ph[ph] = ev
        best = None
        for t in (1.0, 1.1, 1.2, 1.3, 1.5, 1.75, 2.0, 2.5):
            tests["rule3"] += 1
            r, s_ = returns_for(out["discover"]["pr"][bet], LBL[bet], out["discover"]["pays"], bet, 0, mask=res_ph["discover"] >= t)
            if s_.sum() < 100 * 500:
                continue
            st = stats(r, s_, B=300)
            if best is None or st["roi"] > best[0]["roi"]:
                best = (st, t)
        if best:
            st, t = best
            r, s_ = returns_for(out["validate"]["pr"][bet], LBL[bet], out["validate"]["pays"], bet, 0, mask=res_ph["validate"] >= t)
            rule3.append({"bet": JP[bet], "t": t, "discover": st, "validate": stats(r, s_)})
    rep["table_discover"] = out["discover"]["tab"]
    rep["table_validate"] = out["validate"]["tab"]
    rep["rule2_entropy"] = rule2
    rep["rule3_pattern_ev"] = rule3
    rep["tests"] = tests
    rep["survivors"] = [x for x in rule2 + rule3 if x["validate"].get("lo", 0) > 1.0 and x["validate"].get("races", 0) >= 100]
    rep["runtime_min"] = round((time.time() - t0) / 60, 1)
    (ROOT / "experiments").mkdir(exist_ok=True)
    (ROOT / "experiments" / "bets_v3.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({k: rep[k] for k in ("discover", "validate", "payout_coverage", "tests", "runtime_min")}, ensure_ascii=False))
    for b, v in rep["table_validate"].items():
        print(b, v["all"], v[tiers[0][0]])
    print("survivors", rep["survivors"])


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "hist")
