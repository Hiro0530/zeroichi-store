"""条件付きロジット(1レース6艇の中で誰が1着か)と、3連単の確率、時系列での検証。

- 1着の確率: softmax( 枠の効果 + 場×枠の効果 + 特徴量×係数 )。L2正則化。
- 3連単: 1着の確率から順に積み上げる(Harville)。ただし2着・3着は確率を λ 乗して弱める
  (Harvilleは人気側を出しすぎる傾向があるため)。λ は学習に使っていない期間で決める。
- 検証: 週ごとに「その週より前のデータだけで学習 → その週を予想」を繰り返す(ウォークフォワード)。
"""
from __future__ import annotations

import math
from itertools import permutations

import numpy as np

from features import FEATS, LANE_X

try:
    from scipy.optimize import minimize
except ImportError:  # pragma: no cover
    minimize = None

PERMS = np.array(list(permutations(range(6), 3)))


def _design(X: np.ndarray, mu, sd, feats, O=None) -> np.ndarray:
    Z = (X - mu) / sd
    idx = [feats.index(f) for f in LANE_X if f in feats]
    n = X.shape[0]
    inter = np.zeros((n, 6, len(idx) * 6))
    for j, fi in enumerate(idx):
        for L in range(6):
            inter[:, L, j * 6 + L] = Z[:, L, fi]
    parts = [Z, inter]
    if O is not None:
        parts.append(O)
    return np.concatenate(parts, axis=2)


def fit(X, V, y, feats=None, l2: float = 30.0, l2_vl: float = 150.0, O=None, w0=None) -> dict:
    """X は feats(既定 FEATS)の列だけを持つ (n,6,p)。"""
    feats = list(feats or FEATS)
    mu = X.reshape(-1, X.shape[2]).mean(0)
    sd = X.reshape(-1, X.shape[2]).std(0) + 1e-9
    Om = Os = None
    if O is not None:
        Om = O.reshape(-1, O.shape[2]).mean(0)
        Os = O.reshape(-1, O.shape[2]).std(0) + 1e-9
        O = (O - Om) / Os
    Z = _design(X, mu, sd, feats, O)
    n, _, p = Z.shape
    nP = 6 + 24 * 6 + p
    yi = np.arange(n)

    def unpack(w):
        return w[:6], w[6:150].reshape(24, 6), w[150:]

    def f(w):
        lb, vl, b = unpack(w)
        u = Z @ b + lb[None, :] + vl[V]
        u -= u.max(1, keepdims=True)
        e = np.exp(u)
        s = e.sum(1, keepdims=True)
        P = e / s
        ll = (u[yi, y] - np.log(s[:, 0])).sum()
        G = P.copy()
        G[yi, y] -= 1
        g_b = np.einsum("nk,nkp->p", G, Z) + l2 * b
        g_lb = G.sum(0) + 1e-3 * lb
        g_vl = np.zeros((24, 6))
        np.add.at(g_vl, V, G)
        g_vl += l2_vl * vl
        obj = -ll + 0.5 * (l2 * (b @ b) + l2_vl * (vl * vl).sum() + 1e-3 * (lb @ lb))
        return obj, np.concatenate([g_lb, g_vl.ravel(), g_b])

    w = np.zeros(nP) if w0 is None else np.array(w0)
    if minimize is not None:
        r = minimize(f, w, jac=True, method="L-BFGS-B", options={"maxiter": 500})
        w = r.x
    else:  # scipy が無いときの予備(Adam)
        m = v = np.zeros(nP)
        for t in range(1, 3001):
            _, g = f(w)
            g = g / n
            m = 0.9 * m + 0.1 * g
            v = 0.999 * v + 0.001 * g * g
            w = w - 0.05 * (m / (1 - 0.9 ** t)) / (np.sqrt(v / (1 - 0.999 ** t)) + 1e-8)
    return {"w": w.tolist(), "mu": mu.tolist(), "sd": sd.tolist(), "n_races": int(n),
            "oracle": O is not None, "Om": None if Om is None else Om.tolist(), "Os": None if Os is None else Os.tolist(),
            "feats": feats}


def predict(m: dict, X, V, O=None) -> np.ndarray:
    mu, sd = np.array(m["mu"]), np.array(m["sd"])
    if m.get("oracle"):
        O = (O - np.array(m["Om"])) / np.array(m["Os"])
    else:
        O = None
    Z = _design(X, mu, sd, m.get("feats") or FEATS, O)
    w = np.array(m["w"])
    u = Z @ w[150:] + w[:6][None, :] + w[6:150].reshape(24, 6)[V]
    u -= u.max(1, keepdims=True)
    P = np.exp(u)
    return P / P.sum(1, keepdims=True)


def trifecta_probs(P: np.ndarray, l2: float = 1.0, l3: float = 1.0) -> np.ndarray:
    """(n,6) → (n,120) PERMS 順の3連単の確率。"""
    a, b, c = PERMS[:, 0], PERMS[:, 1], PERMS[:, 2]
    P = np.clip(P, 1e-6, 1)
    Q2 = P ** l2
    Q3 = P ** l3
    s2 = Q2.sum(1, keepdims=True) - Q2[:, a]
    s3 = Q3.sum(1, keepdims=True) - Q3[:, a] - Q3[:, b]
    T = P[:, a] * Q2[:, b] / s2 * Q3[:, c] / s3
    return T / T.sum(1, keepdims=True)


def fit_lambdas(P, y, y2, y3) -> tuple[float, float]:
    best = (1.0, 1.0, -1e18)
    n = len(y)
    P = np.clip(P, 1e-6, 1)
    for l2 in np.arange(0.5, 1.21, 0.05):
        Q = P ** l2
        s = Q.sum(1) - Q[np.arange(n), y]
        ll2 = np.log(Q[np.arange(n), y2] / s).sum()
        for l3 in np.arange(0.4, 1.21, 0.05):
            R = P ** l3
            s3 = R.sum(1) - R[np.arange(n), y] - R[np.arange(n), y2]
            ll = ll2 + np.log(R[np.arange(n), y3] / s3).sum()
            if ll > best[2]:
                best = (round(float(l2), 2), round(float(l3), 2), ll)
    return best[0], best[1]


def metrics(P, y, pay=None, T=None, y2=None, y3=None) -> dict:
    n = len(y)
    yi = np.arange(n)
    pick = P.argmax(1)
    Y = np.zeros_like(P)
    Y[yi, y] = 1
    out = {"races": int(n), "top1": float((pick == y).mean()),
           "logloss": float(-np.log(np.clip(P[yi, y], 1e-9, 1)).mean()),
           "brier": float(((P - Y) ** 2).sum(1).mean()),
           "pick_lane1_share": float((pick == 0).mean())}
    # 確率の当たり具合(全艇の1着確率を10区分)
    bins = np.linspace(0, 1, 11)
    pf, yf = P.ravel(), Y.ravel()
    cal, ece = [], 0.0
    for i in range(10):
        msk = (pf >= bins[i]) & (pf < bins[i + 1] + (1e-9 if i == 9 else 0))
        if msk.sum() == 0:
            continue
        pm, om = float(pf[msk].mean()), float(yf[msk].mean())
        cal.append([round(pm, 4), round(om, 4), int(msk.sum())])
        ece += msk.sum() / len(pf) * abs(pm - om)
    out["ece"] = float(ece)
    out["calibration"] = cal
    if pay is not None:
        out["roi_win"] = float(np.where(pick == y, pay, 0).sum() / (100 * n))
    if T is not None and y2 is not None:
        actual = y * 36 + y2 * 6 + y3
        code = PERMS[:, 0] * 36 + PERMS[:, 1] * 6 + PERMS[:, 2]
        top3 = np.argsort(-T, axis=1)[:, :3]
        hit = (code[top3] == actual[:, None]).any(1)
        out["tri3_hit"] = float(hit.mean())
        lut = {c: i for i, c in enumerate(code)}
        out["tri_logloss"] = float(-np.mean([math.log(max(T[i, lut[a]], 1e-12)) for i, a in enumerate(actual)]))
    return out


def lane_prior_probs(V_tr, y_tr, V_te) -> np.ndarray:
    """比較用: 場×枠の1着率だけ(全国平均へ寄せる)。"""
    g = np.bincount(y_tr, minlength=6) + 1.0
    g = g / g.sum()
    P = np.zeros((len(V_te), 6))
    for v in range(24):
        m = V_tr == v
        c = np.bincount(y_tr[m], minlength=6) + 50 * g
        P[V_te == v] = c / c.sum()
    return P


def paired_diff(a_hit: np.ndarray, b_hit: np.ndarray, B: int = 2000, seed: int = 0) -> dict:
    """的中率の差(a−b)のブートストラップ95%区間(レース単位で対応あり)。"""
    rng = np.random.default_rng(seed)
    d = a_hit.astype(float) - b_hit.astype(float)
    n = len(d)
    bs = [d[rng.integers(0, n, n)].mean() for _ in range(B)]
    return {"diff": float(d.mean()), "lo": float(np.percentile(bs, 2.5)), "hi": float(np.percentile(bs, 97.5))}
