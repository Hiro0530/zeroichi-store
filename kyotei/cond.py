"""本番用: 2着・3着の条件付きモデル(exp_cond.py で検証、2026-10-26 採用)。
学習: 直近365日。保存: model.json の "cond"(無ければ Harville+補正 にもどる)。

2026-10-30: exp_place.py の検証で残った構成(model_config.json の "cond")を使えるようにした。
  cols … 候補艇の数字(先頭は CAND と同じ並び)
  nige … 1着が1号艇のときだけ効き方を変える数字(名前)
  lane … 1着が1号艇のとき、候補の枠ごとに効き方を変える数字(名前)
  race … レース単位の数字(X の1号艇の列から読む名前。例: 前日の風速 wxp_wind_l1)を候補の枠ごとに
どれも無ければ今までと同じ。
"""
from __future__ import annotations

import numpy as np

from exp_cond import CAND, CI, Cond, tri_cond  # noqa: F401
from features import ALLF
import model2 as M


def _spec(cols: list, opt: dict | None):
    opt = opt or {}
    nige = [cols.index(f) for f in opt.get("nige", []) if f in cols]
    lane = [cols.index(f) for f in opt.get("lane", []) if f in cols]
    race = [f for f in opt.get("race", []) if f in ALLF]
    return nige, lane, race


def race_vars(X_all: np.ndarray, race: list) -> np.ndarray | None:
    """レース単位の数字: 1号艇の行に入っている値(例: wxp_wind_l1 は 風速×(1号艇))"""
    if not race:
        return None
    ci = [ALLF.index(f) for f in race]
    return np.asarray(X_all)[:, 0, ci].astype(np.float64)


def fit(data: dict, mask: np.ndarray, w2=None, w3=None, cols: list | None = None, opt: dict | None = None) -> dict:
    """cols: 使う特徴量(既定 CAND)。先頭は CAND と同じ並びにする(1号艇のST・展示の効き方の列の位置が決まっているため)。"""
    cols = list(cols or CAND)
    assert cols[:len(CAND)] == CAND
    ci = [ALLF.index(f) for f in cols]
    X = data["X"][mask][:, :, ci].astype(np.float64)
    mu = X.reshape(-1, X.shape[2]).mean(0)
    sd = X.reshape(-1, X.shape[2]).std(0) + 1e-9
    Z = (X - mu) / sd
    nige, lane, race = _spec(cols, opt)
    R = race_vars(data["X"][mask], race)
    rmu = R.mean(0).tolist() if R is not None else []
    rsd = (R.std(0) + 1e-9).tolist() if R is not None else []
    if R is not None:
        R = (R - np.array(rmu)) / np.array(rsd)
    V, y, y2, y3 = data["V"][mask], data["y"][mask], data["y2"][mask], data["y3"][mask]
    m2 = Cond(2, nige, lane, len(race)).fit(Z, V, y, None, y2, w0=w2, R=R)
    m3 = Cond(3, nige, lane, len(race)).fit(Z, V, y, y2, y3, w0=w3, R=R)
    return {"features": cols, "mu": mu.tolist(), "sd": sd.tolist(), "w2": m2.w.tolist(), "q2": int(m2.q),
            "w3": m3.w.tolist(), "q3": int(m3.q), "n_races": int(mask.sum()),
            "opt": {"nige": [cols[i] for i in nige], "lane": [cols[i] for i in lane], "race": race}, "rmu": rmu, "rsd": rsd}


def _models(c: dict):
    nige, lane, race = _spec(c.get("features") or CAND, c.get("opt"))
    m2, m3 = Cond(2, nige, lane, len(race)), Cond(3, nige, lane, len(race))
    m2.w, m2.q = np.array(c["w2"]), c["q2"]
    m3.w, m3.q = np.array(c["w3"]), c["q3"]
    return m2, m3, race


def trifecta(model_or_cond: dict | None, P1: np.ndarray, X_all: np.ndarray, V: np.ndarray, lam=(1.0, 1.0)) -> np.ndarray:
    """(n,120) PERMS 順の3連単の確率。条件付きモデルがあればそれを、無ければ Harville+補正。"""
    c = (model_or_cond or {}).get("cond") if model_or_cond and "w2" not in model_or_cond else model_or_cond
    if not c or len(P1) == 0:
        return M.trifecta_probs(P1, *lam)
    ci = [ALLF.index(f) for f in (c.get("features") or CAND)]
    Z = (np.asarray(X_all)[:, :, ci].astype(np.float64) - np.array(c["mu"])) / np.array(c["sd"])
    m2, m3, race = _models(c)
    R = race_vars(X_all, race)
    if R is not None:
        R = (R - np.array(c["rmu"])) / np.array(c["rsd"])
    return tri_cond(P1, Z, np.asarray(V), m2, m3, R)[0]
