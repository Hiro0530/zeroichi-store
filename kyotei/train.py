"""学習と時系列検証(毎週自動)。

python kyotei/train.py [hist_dir]  … 手元での検証用(model.json は書かない)
"""
from __future__ import annotations

import gzip
import json
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import model2 as M  # noqa: E402
from features import ALLF, FEATS, FanStore, build  # noqa: E402
from jma import Tides  # noqa: E402

JST = timezone(timedelta(hours=9))
BASE_FEATS = FEATS[:12]   # 番組表の数字だけ(旧モデル相当)


def load_days(hist: Path, max_days: int = 365, before: date | None = None) -> list:
    by_day = {}
    for f in sorted(hist.glob("*.json")) + sorted(hist.glob("*.json.gz")):
        ds = f.name[:8]
        if not ds.isdigit():
            continue
        if ds in by_day and not f.name.endswith(".gz"):
            continue
        by_day[ds] = f
    out = []
    for ds in sorted(by_day)[-max_days - 5:]:
        d = date(int(ds[:4]), int(ds[4:6]), int(ds[6:]))
        if before and d >= before:
            continue
        f = by_day[ds]
        raw = gzip.decompress(f.read_bytes()) if f.name.endswith(".gz") else f.read_bytes()
        j = json.loads(raw)
        out.append((d, j["races"], j["results"]))
    return out[-max_days:]


def load_fan(hist: Path) -> FanStore:
    files = {}
    for f in sorted((hist / "fan").glob("fan*.json.gz")) if (hist / "fan").exists() else []:
        files[f.name[3:7]] = json.loads(gzip.decompress(f.read_bytes()))
    return FanStore(files)


def _cols(X, feats):
    return X[:, :, [ALLF.index(f) for f in feats]]


V2_CONFIG = {"feats": FEATS, "vx": [], "train_days": 365, "ensemble": [[365, 30.0]]}


def load_config() -> dict:
    """採用した構成(exp_v3.py が時系列検証で決めたもの)。無ければ v2。"""
    f = Path(__file__).resolve().parent / "model_config.json"
    return json.loads(f.read_text(encoding="utf-8")) if f.exists() else dict(V2_CONFIG)


def fit_components(data, mask, cfg, s=None, w0s=None):
    """構成どおりに学習(アンサンブルの各要素)。s を渡すとその日より前の train_days 日だけで学習。"""
    X, V, y, D = data["X"], data["V"], data["y"], data["D"]
    out = []
    for i, (td, l2) in enumerate(cfg["ensemble"]):
        m = mask.copy()
        if td:
            m &= D >= (s if s is not None else D.max() + 1) - td
        out.append(M.fit(_cols(X[m], cfg["feats"]), V[m], y[m], cfg["feats"], l2=l2, vx=cfg.get("vx"),
                         w0=(w0s or [None] * 9)[i]))
    return out


def walk_forward(data: dict, weeks: int = 6, min_train_days: int = 21, cfg: dict | None = None) -> dict:
    cfg = cfg or load_config()
    D = data["D"]
    days = np.unique(D)
    if len(days) < min_train_days + 7:
        return {}
    last = days[-1]
    starts = [last - 7 * k + 1 for k in range(weeks, 0, -1)]
    starts = [s for s in starts if (days < s).sum() >= min_train_days]
    keep = {k: [] for k in ("idx", "full", "base", "prior", "oracle")}
    t0 = time.time()
    w_full = w_base = None
    w_comp = None
    for s in starts:
        tr = D < s
        te = (D >= s) & (D < s + 7)
        if te.sum() == 0:
            continue
        X, V, y = data["X"], data["V"], data["y"]
        comps = fit_components(data, tr, cfg, s, w_comp)
        w_comp = [c["w"] for c in comps]
        mb = M.fit(_cols(X[tr], BASE_FEATS), V[tr], y[tr], BASE_FEATS, w0=w_base)
        w_base = mb["w"]
        tro = tr & (D >= s - (cfg["ensemble"][0][0] or 10 ** 6))
        mo = M.fit(_cols(X[tro], cfg["feats"]), V[tro], y[tro], cfg["feats"], O=data["O"][tro], vx=cfg.get("vx"))
        keep["idx"].append(np.where(te)[0])
        keep["full"].append(M.predict_model({"components": comps}, X[te], V[te], ALLF))
        keep["base"].append(M.predict(mb, _cols(X[te], BASE_FEATS), V[te]))
        keep["prior"].append(M.lane_prior_probs(V[tr], y[tr], V[te]))
        keep["oracle"].append(M.predict(mo, _cols(X[te], cfg["feats"]), V[te], data["O"][te]))
        print(f"  fold {date.fromordinal(int(s))}: train {tr.sum()} test {te.sum()} ({time.time()-t0:.0f}s)")
    if not keep["idx"]:
        return {}
    idx = np.concatenate(keep["idx"])
    y, y2, y3, pay = data["y"][idx], data["y2"][idx], data["y3"][idx], data["pay"][idx]
    P = {k: np.concatenate(v) for k, v in keep.items() if k != "idx"}
    l2, l3 = M.fit_lambdas(P["full"], y, y2, y3)
    rep = {"test_from": date.fromordinal(int(D[idx].min())).isoformat(),
           "test_to": date.fromordinal(int(D[idx].max())).isoformat(),
           "test_days": int(len(np.unique(D[idx]))), "folds": len(keep["idx"]), "lambda": [l2, l3]}
    for k, Pk in P.items():
        T = M.trifecta_probs(Pk, *((l2, l3) if k == "full" else (1.0, 1.0)))
        rep[k] = M.metrics(Pk, y, pay, T, y2, y3)
    rep["full_harville"] = {k: v for k, v in M.metrics(P["full"], y, pay, M.trifecta_probs(P["full"]), y2, y3).items()
                            if k in ("tri3_hit", "tri_logloss")}
    lane1 = (y == 0)
    rep["lane1"] = {"races": int(len(y)), "top1": float(lane1.mean()),
                    "roi_win": float(np.where(lane1, pay, 0).sum() / (100 * len(y)))}
    hit_full = P["full"].argmax(1) == y
    rep["diff_vs_lane1"] = M.paired_diff(hit_full, lane1)
    rep["diff_vs_base"] = M.paired_diff(hit_full, P["base"].argmax(1) == y)
    rep["beats_lane1"] = bool(rep["diff_vs_lane1"]["lo"] > 0)
    rep["better_logloss_than_base"] = bool(rep["full"]["logloss"] < rep["base"]["logloss"])
    try:   # 券種ごとの組番の確率の較正(オッズの紙の上の検証で使う。学習外の予想だけで作る)
        import calib
        rep["_calib"] = calib.fit_maps(P["full"], y, y2, y3, [l2, l3])
    except Exception as e:  # noqa
        print("calib skipped:", e)
    rep["tiers"] = M.tier_table(P["full"], y, pay, cfg.get("tiers"), days=rep["test_days"])
    rep["tiers_def"] = cfg.get("tiers") or M.TIERS
    rep["config"] = {k: cfg.get(k) for k in ("feats", "vx", "train_days", "ensemble", "tiers")}
    return rep


def train_all(hist: Path, weeks: int = 6) -> tuple[dict, dict]:
    days = load_days(hist, max_days=1095)
    fan = load_fan(hist)
    tides = Tides(hist / "jma")
    cfg = load_config()
    print(f"history: {len(days)} days {days[0][0] if days else ''}..{days[-1][0] if days else ''}, fan files: {[i[1] for i in fan.items]}")
    data, _ = build(days, fan, tides=tides)
    print(f"races: {len(data['y'])}")
    rep = walk_forward(data, weeks, cfg=cfg)
    comps = fit_components(data, np.ones(len(data["y"]), bool), cfg)
    lam = rep.get("lambda", [1.0, 1.0])
    cal = rep.pop("_calib", None)
    model = {"calib": cal, **comps[0], "components": comps, "version": 3, "lambda": lam, "n_days": len(days),
             "config": {k: cfg.get(k) for k in ("feats", "vx", "train_days", "ensemble", "tiers", "select_window")},
             "train_from": days[0][0].isoformat(), "train_to": days[-1][0].isoformat(),
             "fitted_at": datetime.now(JST).isoformat(timespec="minutes"),
             "n_v2_days": sum(1 for _, _, res in days if any("boats" in v for v in list(res.values())[:3])),
             "fan_files": [i[1] for i in fan.items], "data_check": data_check(days, data)}
    return model, rep


def data_check(days, data) -> dict:
    """読み取りの抜けがないかの点検(ページには出さない)。"""
    nb = nc = ns = nwx = nr = 0
    for _, _, res in days:
        for v in res.values():
            nr += 1
            nwx += bool(v.get("wx"))
            for b in v.get("boats", []):
                nb += 1
                nc += b.get("course") is not None
                ns += b.get("st") is not None
    X = data["X"]
    return {"results": nr, "boats_parsed": nb, "course_rate": round(nc / max(nb, 1), 4),
            "st_rate": round(ns / max(nb, 1), 4), "wx_rate": round(nwx / max(nr, 1), 4),
            "fan_rate": round(float(X[:, :, ALLF.index("fan_has")].mean()), 4) if len(X) else 0.0,
            "tide_rate": round(float((X[:, 0, ALLF.index("t_d_l1")] != 0).mean()), 4) if len(X) else 0.0,
            "exh_rate": round(sum(1 for _, _, res in days for v in res.values() for b in v.get("boats", []) if b.get("exh")) / max(nb, 1), 4)}


def coef_table(model: dict) -> list:
    w = np.array(model["w"])[150:]
    feats = model.get("feats") or FEATS
    return sorted([[f, round(float(w[i]), 3)] for i, f in enumerate(feats)], key=lambda t: -abs(t[1]))
    # (場ごとの係数・枠ごとの係数は表に出さない)


if __name__ == "__main__":
    hist = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent / "hist"
    model, rep = train_all(hist, int(sys.argv[2]) if len(sys.argv) > 2 else 4)
    short = {k: ({kk: vv for kk, vv in v.items() if kk != "calibration"} if isinstance(v, dict) else v) for k, v in rep.items()}
    print(json.dumps(short, ensure_ascii=False, indent=1))
    print("calibration(full):", rep.get("full", {}).get("calibration"))
    print("coefs:", coef_table(model)[:20])
