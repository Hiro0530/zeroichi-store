"""本番用: 2着・3着の条件付きモデル(exp_cond.py で検証、2026-10-26 採用)。
学習: 直近365日。保存: model.json の "cond"(無ければ Harville+補正 にもどる)。"""
from __future__ import annotations

import numpy as np

from exp_cond import CAND, CI, Cond, tri_cond  # noqa: F401
from features import ALLF
import model2 as M


def fit(data: dict, mask: np.ndarray, w2=None, w3=None, cols: list | None = None) -> dict:
    """cols: 使う特徴量(既定 CAND)。先頭は CAND と同じ並びにする(1号艇のST・展示の効き方の列の位置が決まっているため)。"""
    cols = list(cols or CAND)
    assert cols[:len(CAND)] == CAND
    ci = [ALLF.index(f) for f in cols]
    X = data["X"][mask][:, :, ci].astype(np.float64)
    mu = X.reshape(-1, X.shape[2]).mean(0)
    sd = X.reshape(-1, X.shape[2]).std(0) + 1e-9
    Z = (X - mu) / sd
    V, y, y2, y3 = data["V"][mask], data["y"][mask], data["y2"][mask], data["y3"][mask]
    m2 = Cond(2).fit(Z, V, y, None, y2, w0=w2)
    m3 = Cond(3).fit(Z, V, y, y2, y3, w0=w3)
    return {"features": cols, "mu": mu.tolist(), "sd": sd.tolist(), "w2": m2.w.tolist(), "q2": int(m2.q),
            "w3": m3.w.tolist(), "q3": int(m3.q), "n_races": int(mask.sum())}


def _models(c: dict):
    m2, m3 = Cond(2), Cond(3)
    m2.w, m2.q = np.array(c["w2"]), c["q2"]
    m3.w, m3.q = np.array(c["w3"]), c["q3"]
    return m2, m3


def trifecta(model_or_cond: dict | None, P1: np.ndarray, X_all: np.ndarray, V: np.ndarray, lam=(1.0, 1.0)) -> np.ndarray:
    """(n,120) PERMS 順の3連単の確率。条件付きモデルがあればそれを、無ければ Harville+補正。"""
    c = (model_or_cond or {}).get("cond") if model_or_cond and "w2" not in model_or_cond else model_or_cond
    if not c or len(P1) == 0:
        return M.trifecta_probs(P1, *lam)
    ci = [ALLF.index(f) for f in (c.get("features") or CAND)]
    Z = (np.asarray(X_all)[:, :, ci].astype(np.float64) - np.array(c["mu"])) / np.array(c["sd"])
    m2, m3 = _models(c)
    return tri_cond(P1, Z, np.asarray(V), m2, m3)[0]
