"""券種ごとの組番の確率の較正(単調回帰)。週1回の学習し直しのとき、直近8週の学習外の予想で当て直す(model.json の calib)。"""
from __future__ import annotations

import numpy as np

import exp_bets as EB
import model2 as M

BETS = ("tansho", "fukusho", "exacta", "quinella", "trio", "trifecta")


def pav(x, y):
    o = np.argsort(x)
    x, y = x[o], y[o].astype(float)
    vals, wts, xs = [], [], []
    for xi, yi in zip(x, y):
        vals.append(yi); wts.append(1.0); xs.append(xi)
        while len(vals) > 1 and vals[-2] > vals[-1]:
            v = (vals[-2] * wts[-2] + vals[-1] * wts[-1]) / (wts[-2] + wts[-1])
            ww = wts[-2] + wts[-1]
            vals[-2:] = [v]; wts[-2:] = [ww]; xs[-2:] = [xs[-1]]
    return np.array(xs), np.array(vals)


def hits(bet, y, y2, y3):
    n = len(y)
    lab = EB.LBL[bet]
    H = np.zeros((n, len(lab)), bool)
    for i in range(n):
        a, b, c = y[i] + 1, y2[i] + 1, y3[i] + 1
        keys = {"tansho": [str(a)], "fukusho": [str(a), str(b)], "exacta": [f"{a}-{b}"],
                "quinella": ["-".join(map(str, sorted((a, b))))], "trio": ["-".join(map(str, sorted((a, b, c))))],
                "trifecta": [f"{a}-{b}-{c}"]}[bet]
        for k in keys:
            H[i, lab.index(k)] = True
    return H


def fit_maps(P, y, y2, y3, lam, max_points: int = 200, T=None) -> dict:
    """学習外の予想 P(n,6)(と3連単の確率 T)と着順から、券種ごとの 予想確率→実際の的中率 の対応(単調)を作る。"""
    pr, _ = EB.probs_all(P, lam, T=T)
    out = {}
    for bet in BETS:
        xs, vs = pav(pr[bet].ravel(), hits(bet, y, y2, y3).ravel())
        if len(xs) > max_points:   # 保存用に間引く(np.interp で使う)
            j = np.unique(np.linspace(0, len(xs) - 1, max_points).astype(int))
            xs, vs = xs[j], vs[j]
        out[bet] = [[round(float(a), 6) for a in xs], [round(float(b), 6) for b in vs]]
    out["n_races"] = int(len(y))
    return out


def apply(bet: str, p: np.ndarray, maps: dict | None, total: float = 1.0) -> np.ndarray:
    """較正して、合計が total(単勝・2連単・2連複・3連複・3連単=1、複勝=2)になるように直す。"""
    if not maps or bet not in maps:
        return p
    xs, vs = maps[bet]
    q = np.interp(p, xs, vs)
    s = q.sum()
    return q * (total / s) if s > 0 else p
