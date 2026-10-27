"""v4: いちばん長い学習外の期間での診断 + 改良候補(朝に分かるもの・直前情報)+ 市場(確定オッズ)との比較。

python kyotei/exp_v4.py [hist_dir] [weeks=52]

方法(未来の情報を混ぜない):
- 直近 weeks 週を1週ずつウォークフォワード(その週より前の365日だけで学習 → その週を予想)。2着・3着の条件付きモデルは4週ごとに学習し直す。
- 前半(古い weeks/2 週)= 選ぶ期間、後半 = 確かめる期間。候補は選ぶ期間で1つずつ足し、対数損失の差の95%区間(レース単位のブートストラップ)の
  上端が0未満のときだけ残す(exp_v3 と同じ基準)。確かめる期間は選ぶのに使わず、最後に評価だけ。
- 市場との比較: 確定払戻から「当たった組番の市場の確率」= 0.75 ÷ オッズ(払戻率75%)。当たった組番だけで計算できる対数損失で、
  モデル・市場・2つの線形の混ぜ合わせ(重みは選ぶ期間で決める)を比べる。確定オッズは締切までの情報(展示タイムなど)を含むので、
  締切前のオッズに対しては市場に有利な比較になる。
- 直前情報(展示タイム・直前の風と波・展示の進入)は競走成績ファイルの同じ値で学習・検証する。展示の進入は「実際の進入」で代用(上限寄り)。
出力: experiments/v4.json(集計の数字だけ)。model_config.json は書き換えない(採否は人が見て決める)。
"""
from __future__ import annotations

import json
import math
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import exp_bets as EB  # noqa: E402
import model2 as M  # noqa: E402
from exp_cond import CAND, Cond, tri_cond  # noqa: E402
from exp_v3 import Runner, probs  # noqa: E402
from features import ALLF, GROUPS4, ORACLE3, PRE, build  # noqa: E402
from jma import Tides  # noqa: E402
from train import load_config, load_days, load_fan  # noqa: E402

ROOT = Path(__file__).resolve().parent
JST = timezone(timedelta(hours=9))
TAKE = 0.75   # 払戻率
CODE = EB.PERMS[:, 0] * 36 + EB.PERMS[:, 1] * 6 + EB.PERMS[:, 2]
LUT = {int(c): i for i, c in enumerate(CODE)}


def r5(x):
    return None if x is None else round(float(x), 5)


def boot_mean(d, B=2000, seed=0):
    d = np.asarray(d, float)
    n = len(d)
    if n == 0:
        return {"diff": None, "lo": None, "hi": None, "n": 0}
    rng = np.random.default_rng(seed)
    bs = d[rng.integers(0, n, (B, n))].mean(1)
    return {"diff": r5(d.mean()), "lo": r5(np.percentile(bs, 2.5)), "hi": r5(np.percentile(bs, 97.5)), "n": int(n)}


def roi_ci(ret, stake, B=1000, seed=0):
    n = len(ret)
    if n == 0:
        return {"races": 0}
    rng = np.random.default_rng(seed)
    ix = rng.integers(0, n, (B, n))
    bs = ret[ix].sum(1) / stake[ix].sum(1)
    return {"races": int(n), "roi": r5(ret.sum() / stake.sum()), "lo": r5(np.percentile(bs, 2.5)),
            "hi": r5(np.percentile(bs, 97.5)), "hit": r5((ret > 0).mean())}


class Ctx:
    """学習外の期間の配列(レースの並びは Runner の te_idx と同じ)。"""

    def __init__(self, data, idx, days_by_key):
        self.idx = idx
        self.y, self.y2, self.y3 = data["y"][idx], data["y2"][idx], data["y3"][idx]
        self.V, self.D = data["V"][idx], data["D"][idx]
        self.K = [data["K"][i] for i in idx]
        self.res = [days_by_key.get(k) for k in self.K]
        n = len(idx)
        self.pay_win = np.zeros(n); self.pay_ex = np.zeros(n); self.pay_tri = np.zeros(n)
        self.pays = []
        for i, r in enumerate(self.res):
            o = r["order"]
            pd = r.get("pay") or {}
            self.pay_win[i] = (pd.get("tansho") or r.get("tansho") or {}).get(str(o[0]), 0)
            self.pay_ex[i] = (pd.get("exacta") or r.get("exacta") or {}).get(f"{o[0]}-{o[1]}", 0)
            self.pay_tri[i] = (pd.get("trifecta") or r.get("trifecta") or {}).get(f"{o[0]}-{o[1]}-{o[2]}", 0)
            self.pays.append({"tansho": pd.get("tansho") or r.get("tansho") or {},
                              "exacta": pd.get("exacta") or r.get("exacta") or {},
                              "trifecta": pd.get("trifecta") or r.get("trifecta") or {}})
        self.ai = np.array([LUT[int(a * 36 + b * 6 + c)] for a, b, c in zip(self.y, self.y2, self.y3)])
        self.ei = np.array([EB.EXL.index((a, b)) for a, b in zip(self.y, self.y2)])
        # 層別の目印(診断用。予想には使わない)
        self.wind = np.array([(r.get("wx") or {}).get("wind", -1) for r in self.res])
        self.wave = np.array([(r.get("wx") or {}).get("wave", -1) for r in self.res])
        self.maemuki = np.array([any(b.get("course") and b["course"] != b["lane"] for b in r.get("boats", [])) for r in self.res])
        self.kim = [r.get("kimarite", "") for r in self.res]


def market_ll(pay):
    """当たった組番の市場の確率(0.75 ÷ オッズ)。払戻が無いレースは nan。"""
    p = np.where(pay > 0, TAKE * 100.0 / np.maximum(pay, 1), np.nan)
    return np.clip(p, 1e-6, 0.999)


def pool_eval(pm_sel, pk_sel, pm_conf, pk_conf):
    """線形の混ぜ合わせ p = w×モデル + (1−w)×市場。w は選ぶ期間で決め、確かめる期間で評価。"""
    ws = np.round(np.arange(0, 1.0001, 0.05), 2)
    ok = ~np.isnan(pk_sel)
    ll = [float(-np.log(w * pm_sel[ok] + (1 - w) * pk_sel[ok]).mean()) for w in ws]
    w = float(ws[int(np.argmin(ll))])
    ok2 = ~np.isnan(pk_conf)
    lm = -np.log(pm_conf[ok2]); lk = -np.log(pk_conf[ok2]); lp = -np.log(w * pm_conf[ok2] + (1 - w) * pk_conf[ok2])
    return {"w_model": w, "select_curve": [[float(a), round(b, 5)] for a, b in zip(ws, ll)],
            "confirm": {"races": int(ok2.sum()), "ll_model": r5(lm.mean()), "ll_market": r5(lk.mean()), "ll_pool": r5(lp.mean()),
                        "model_minus_market": boot_mean(lm - lk), "pool_minus_market": boot_mean(lp - lk)}}


def tri_from(P1, Zc, V, m2, m3):
    return tri_cond(P1, Zc, V, m2, m3)[0]


def full_metrics(P, T, c: Ctx, sl=slice(None)):
    y, y2, y3 = c.y[sl], c.y2[sl], c.y3[sl]
    P, T = P[sl], T[sl]
    n = len(y)
    r = np.arange(n)
    pick = P.argmax(1)
    Ex = T @ EB.M_EX
    ei, ai = c.ei[sl], c.ai[sl]
    ordT = np.argsort(-T, 1)
    ordE = np.argsort(-Ex, 1)
    out = {"races": int(n), "top1": r5((pick == y).mean()), "lane1": r5((y == 0).mean()),
           "logloss": r5(-np.log(np.clip(P[r, y], 1e-9, 1)).mean()),
           "brier": r5(((P - np.eye(6)[y]) ** 2).sum(1).mean()),
           "pick_lane1_share": r5((pick == 0).mean()), "mean_p_top": r5(P.max(1).mean()),
           "exacta_ll": r5(-np.log(np.clip(Ex[r, ei], 1e-9, 1)).mean()),
           "tri_ll": r5(-np.log(np.clip(T[r, ai], 1e-12, 1)).mean())}
    for k in (1, 3, 5):
        out[f"exacta_top{k}"] = r5((ordE[:, :k] == ei[:, None]).any(1).mean())
    for k in (1, 3, 5, 10):
        out[f"tri_top{k}"] = r5((ordT[:, :k] == ai[:, None]).any(1).mean())
    pw, pe, pt = c.pay_win[sl], c.pay_ex[sl], c.pay_tri[sl]
    out["roi_tansho_top1"] = roi_ci(np.where(pick == y, pw, 0.0), np.full(n, 100.0))
    out["roi_exacta_top1"] = roi_ci(np.where(ordE[:, 0] == ei, pe, 0.0), np.full(n, 100.0))
    out["roi_trifecta_top3"] = roi_ci(np.where((ordT[:, :3] == ai[:, None]).any(1), pt, 0.0), np.full(n, 300.0))
    out["roi_lane1_tansho"] = roi_ci(np.where(y == 0, pw, 0.0), np.full(n, 100.0))
    out["vs_lane1_top1"] = {k: r5(v) for k, v in M.paired_diff(pick == y, y == 0).items()}
    out["ece"] = r5(M.metrics(P, y)["ece"])
    out["calibration"] = M.metrics(P, y)["calibration"]
    # 3連単の確率の当たり具合(組番ごと)
    bins = [0, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 1.01]
    H = np.zeros_like(T, dtype=bool)
    H[r, ai] = True
    cal = []
    for a, b in zip(bins[:-1], bins[1:]):
        m = (T >= a) & (T < b)
        if m.sum():
            cal.append([a, b, r5(T[m].mean()), r5(H[m].mean()), int(m.sum())])
    out["tri_calibration"] = cal
    return out


def strata(P, T, c: Ctx, tiers):
    """層ごと: レース数・1着的中率・1号艇の1着率・対数損失・市場の対数損失・3連単3点の的中率"""
    y = c.y
    n = len(y)
    r = np.arange(n)
    llm = -np.log(np.clip(P[r, y], 1e-9, 1))
    pk = market_ll(c.pay_win)
    llk = -np.log(pk)
    hit = P.argmax(1) == y
    tri3 = (np.argsort(-T, 1)[:, :3] == c.ai[:, None]).any(1)

    def row(m):
        k = int(m.sum())
        if k < 30:
            return None
        ok = m & ~np.isnan(pk)
        return {"races": k, "top1": r5(hit[m].mean()), "lane1": r5((y[m] == 0).mean()), "logloss": r5(llm[m].mean()),
                "ll_market": r5(llk[ok].mean()), "gap_vs_market": r5((llm[ok] - llk[ok]).mean()),
                "mean_p_top": r5(P[m].max(1).mean()), "tri3_hit": r5(tri3[m].mean())}

    from engine import VENUES
    out = {"venue": {VENUES[f"{v+1:02d}"]: row(c.V == v) for v in range(24)}}
    top = P.max(1)
    tv = {}
    for i, (name, lo) in enumerate(tiers):
        hi = tiers[i - 1][1] if i else 1.01
        tv[name] = row((top >= lo) & (top < hi))
    out["tier"] = tv
    out["wind"] = {k: row(m) for k, m in (("0-2m", (c.wind >= 0) & (c.wind <= 2)), ("3-4m", (c.wind >= 3) & (c.wind <= 4)),
                                          ("5-6m", (c.wind >= 5) & (c.wind <= 6)), ("7m+", c.wind >= 7))}
    out["wave"] = {k: row(m) for k, m in (("0-2cm", (c.wave >= 0) & (c.wave <= 2)), ("3-5cm", (c.wave >= 3) & (c.wave <= 5)),
                                          ("6cm+", c.wave >= 6))}
    out["entry"] = {"枠なり": row(~c.maemuki), "前付け・進入の変化あり": row(c.maemuki)}
    out["winner_lane"] = {f"{L+1}号艇が1着": row(y == L) for L in range(6)}
    return out


def main(hist: Path, weeks: int = 52):
    t0 = time.time()
    cfg = load_config()
    tiers = cfg.get("tiers") or M.TIERS
    days = load_days(hist, max_days=1095)
    fan = load_fan(hist)
    data, _ = build(days, fan, tides=Tides(hist / "jma"))
    by_key = {k: v for _, _, res in days for k, v in res.items()}
    D = data["D"]
    print(f"built {len(D)} races {days[0][0]}..{days[-1][0]} in {time.time()-t0:.0f}s", flush=True)
    last = int(np.unique(D)[-1])
    starts = [last - 7 * k + 1 for k in range(weeks, 0, -1)]
    half = weeks // 2
    R = Runner(data, starts)
    c = Ctx(data, R.te_idx, by_key)
    fold = np.concatenate([np.full(((D >= s) & (D < s + 7)).sum(), i) for i, s in enumerate(starts)])
    SEL, CONF = fold < half, fold >= half
    td = cfg.get("train_days") or 365
    base_feats, base_vx = list(cfg["feats"]), list(cfg.get("vx") or [])

    def P_of(name, feats, vx, l2=30.0):
        Us = [R.run(f"{name}_{i}", feats, vx, t or td, l2_) for i, (t, l2_) in enumerate(cfg.get("ensemble") or [[td, 30.0]])]
        return probs(sum(Us) / len(Us))

    rep = {"generated_at": datetime.now(JST).isoformat(timespec="minutes"), "history_from": days[0][0].isoformat(),
           "history_to": days[-1][0].isoformat(), "weeks": weeks,
           "oos_window": [date.fromordinal(starts[0]).isoformat(), date.fromordinal(starts[-1] + 6).isoformat(), int(len(c.y))],
           "select_window": [date.fromordinal(starts[0]).isoformat(), date.fromordinal(starts[half] - 1).isoformat(), int(SEL.sum())],
           "confirm_window": [date.fromordinal(starts[half]).isoformat(), date.fromordinal(starts[-1] + 6).isoformat(), int(CONF.sum())],
           "base_config": {"feats": base_feats, "vx": base_vx, "train_days": td}}

    # ---- 2着・3着の条件付きモデル(4週ごとに学習し直す)。cols で特徴量を変えられる
    def cond_T(P1, cols, tag):
        ci = [ALLF.index(f) for f in cols]
        Xc = data["X"][:, :, ci].astype(np.float64)
        T = np.zeros((len(P1), 120))
        w2 = w3 = None
        for b0 in range(0, weeks, 4):
            s = starts[b0]
            tr = (D < s) & (D >= s - 365)
            mu = Xc[tr].reshape(-1, len(ci)).mean(0); sd = Xc[tr].reshape(-1, len(ci)).std(0) + 1e-9
            Ztr = (Xc[tr] - mu) / sd
            m2 = Cond(2).fit(Ztr, data["V"][tr], data["y"][tr], None, data["y2"][tr], w0=w2); w2 = m2.w
            m3 = Cond(3).fit(Ztr, data["V"][tr], data["y"][tr], data["y2"][tr], data["y3"][tr], w0=w3); w3 = m3.w
            msk = (fold >= b0) & (fold < b0 + 4)
            Zte = (Xc[c.idx[msk]] - mu) / sd
            T[msk] = tri_from(P1[msk], Zte, c.V[msk], m2, m3)
            print(f"  cond[{tag}] block {b0} {time.time()-t0:.0f}s", flush=True)
        return T

    # ---- 1) いまの構成(診断)
    P_base = P_of("base", base_feats, base_vx)
    T_base = cond_T(P_base, CAND, "base")
    rep["baseline"] = {"oos": full_metrics(P_base, T_base, c), "select": full_metrics(P_base, T_base, c, SEL),
                       "confirm": full_metrics(P_base, T_base, c, CONF)}
    rep["baseline_strata_oos"] = strata(P_base, T_base, c, tiers)
    # 市場(確定オッズ)との比較: 単勝・2連単・3連単
    r_ = np.arange(len(c.y))
    pm_w = np.clip(P_base[r_, c.y], 1e-9, 1)
    pm_e = np.clip((T_base @ EB.M_EX)[r_, c.ei], 1e-9, 1)
    pm_t = np.clip(T_base[r_, c.ai], 1e-12, 1)
    mk = {"tansho": (pm_w, market_ll(c.pay_win)), "exacta": (pm_e, market_ll(c.pay_ex)), "trifecta": (pm_t, market_ll(c.pay_tri))}
    rep["market_vs_model_baseline"] = {b: pool_eval(a[SEL], k[SEL], a[CONF], k[CONF]) for b, (a, k) in mk.items()}
    print("baseline done", json.dumps(rep["baseline"]["confirm"], ensure_ascii=False)[:600], flush=True)

    # ---- 2) 朝に分かる候補(選ぶ期間で1つずつ)
    def step_eval(P_new, P_ref, m):
        ys = c.y[m]
        ll = M.paired_ll(P_new[m], P_ref[m], ys)
        acc = M.paired_diff(P_new[m].argmax(1) == ys, P_ref[m].argmax(1) == ys)
        return {"d_logloss": {k: r5(v) for k, v in ll.items()}, "d_top1": {k: r5(v) for k, v in acc.items()}}

    best = {"feats": base_feats, "vx": base_vx, "P": P_base}
    rep["morning_steps"] = []
    for name, add in GROUPS4.items():
        feats = best["feats"] + [f for f in add if f not in best["feats"]]
        P = P_of(f"m_{name}", feats, best["vx"])
        s = step_eval(P, best["P"], SEL)
        keep = s["d_logloss"]["hi"] < 0
        rep["morning_steps"].append({"step": name, "added": add, "kept": keep, "select": s, "confirm_info": step_eval(P, best["P"], CONF)})
        print(f"  morning {name}: {s} kept={keep}", flush=True)
        if keep:
            best = {"feats": feats, "vx": best["vx"], "P": P}
    P_morn = best["P"]
    rep["morning_final"] = {"feats_added": [f for f in best["feats"] if f not in base_feats],
                            "confirm_vs_base": step_eval(P_morn, P_base, CONF)}

    # ---- 3) 直前情報(朝の最良の上に1つずつ)
    pbest = dict(best)
    rep["pre_steps"] = []
    for name, add in PRE.items():
        feats = pbest["feats"] + [f for f in add if f not in pbest["feats"]]
        vx = pbest["vx"] + ([f for f in ORACLE3 if f not in pbest["vx"]] if name == "pre_wx" else [])
        P = P_of(f"p_{name}", feats, vx)
        s = step_eval(P, pbest["P"], SEL)
        keep = s["d_logloss"]["hi"] < 0
        rep["pre_steps"].append({"step": name, "added": add, "kept": keep, "select": s, "confirm_info": step_eval(P, pbest["P"], CONF)})
        print(f"  pre {name}: {s} kept={keep}", flush=True)
        if keep:
            pbest = {"feats": feats, "vx": vx, "P": P}
    P_pre = pbest["P"]
    # 展示の進入(実際の進入で代用)を抜いた版も出す(本番で使う前の控えめな見積もり)
    no_course = [f for f in pbest["feats"] if f not in PRE["pre_course"]]
    P_pre_nc = P_pre if no_course == pbest["feats"] else P_of("p_nocourse", no_course, pbest["vx"])
    T_pre = cond_T(P_pre, CAND, "pre_P1")
    cand_pre = CAND + [f for f in ("p_exh_rel", "p_exh_self") if f in pbest["feats"]]
    T_pre2 = cond_T(P_pre, cand_pre, "pre_cond") if cand_pre != CAND else T_pre
    rep["pre_final"] = {"feats_added": [f for f in pbest["feats"] if f not in best["feats"]], "vx": pbest["vx"],
                        "confirm": full_metrics(P_pre, T_pre2, c, CONF),
                        "confirm_vs_morning": step_eval(P_pre, P_morn, CONF),
                        "confirm_no_course_vs_morning": step_eval(P_pre_nc, P_morn, CONF),
                        "cond_with_exh_confirm": {"tri_ll_cond_base": full_metrics(P_pre, T_pre, c, CONF)["tri_ll"],
                                                  "tri_ll_cond_pre": full_metrics(P_pre, T_pre2, c, CONF)["tri_ll"],
                                                  "d_tri_ll": boot_mean(-np.log(np.clip(T_pre2[r_, c.ai], 1e-12, 1))[CONF]
                                                                        + np.log(np.clip(T_pre[r_, c.ai], 1e-12, 1))[CONF])}}
    pm_w2 = np.clip(P_pre[r_, c.y], 1e-9, 1)
    pm_e2 = np.clip((T_pre2 @ EB.M_EX)[r_, c.ei], 1e-9, 1)
    pm_t2 = np.clip(T_pre2[r_, c.ai], 1e-12, 1)
    rep["market_vs_model_pre"] = {b: pool_eval(a[SEL], k[SEL], a[CONF], k[CONF]) for b, (a, k) in
                                  {"tansho": (pm_w2, mk["tansho"][1]), "exacta": (pm_e2, mk["exacta"][1]),
                                   "trifecta": (pm_t2, mk["trifecta"][1])}.items()}
    rep["pre_strata_confirm"] = {"tier": strata(P_pre[CONF], T_pre2[CONF], _sub(c, CONF), tiers)["tier"]}
    rep["config_candidates"] = {"morning_feats": best["feats"], "morning_vx": best["vx"],
                                "pre_feats": pbest["feats"], "pre_vx": pbest["vx"],
                                "pre_cond_feats": cand_pre}
    rep["runtime_min"] = round((time.time() - t0) / 60, 1)
    ed = ROOT / "experiments"
    ed.mkdir(exist_ok=True)
    (ed / "v4.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1, default=_js), encoding="utf-8")
    print("v4 done", rep["runtime_min"], "min", flush=True)


def _js(o):
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return None if math.isnan(o) else float(o)
    if isinstance(o, np.bool_):
        return bool(o)
    raise TypeError(type(o))


def _sub(c: Ctx, m):
    s = object.__new__(Ctx)
    for k, v in c.__dict__.items():
        if isinstance(v, np.ndarray) and len(v) == len(m):
            setattr(s, k, v[m])
        elif isinstance(v, list) and len(v) == len(m):
            setattr(s, k, [x for x, t in zip(v, m) if t])
        else:
            setattr(s, k, v)
    return s


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "hist", int(sys.argv[2]) if len(sys.argv) > 2 else 52)
