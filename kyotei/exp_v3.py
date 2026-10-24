"""v3 の改良候補を、v2 と同じ時系列検証(ウォークフォワード)で1つずつ試す。

python kyotei/exp_v3.py [hist_dir]

- 期間を2つに分ける。「選ぶ期間」(古い方の8週)で候補を1つずつ足し、対数損失が良くなったものだけ残す。
  残す基準: 対数損失の差(レース単位のブートストラップ95%区間)の上端が0未満。
  「確かめる期間」(直近8週)は選ぶのに使わず、最後に v2・1号艇 と並べて成績を出す(選び方の甘さを持ち込まないため)。
- 各週: その週より前のデータだけで学習 → その週を予想。特徴量はすべてその日の朝までに分かるもの。
- 出力: experiments/v3_ablation.json(集計の数字だけ。データそのものは含まない)、model_config.json(採用した構成)。
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
from features import ALLF, FEATS, GROUPS, ORACLE3, VX_CAND  # noqa: E402
from jma import Tides  # noqa: E402
from train import load_days, load_fan  # noqa: E402

ROOT = Path(__file__).resolve().parent
JST = timezone(timedelta(hours=9))

# 足す順番(1つずつ試す)。値は (足す特徴量, 場ごとの係数も持たせる特徴量)
STEPS = [
    ("form", GROUPS["form"], []),
    ("racer_venue", ["f_rv"], []),
    ("racer_lane_venue", ["f_rlv"], []),
    ("motor_recent", GROUPS["motor"], []),
    ("exh_racer", ["e_racer_exh"], []),
    ("exh_motor", ["e_motor_exh"], []),
    ("drawout", ["e_draw_exh", "e_draw_res"], []),
    ("tide", GROUPS["tide"], GROUPS["tide"]),
    ("wind_prevday_dir", GROUPS["wxdir"], GROUPS["wxdir"]),
    ("venue_coef", [], VX_CAND["venue_coef"]),
]


class Runner:
    def __init__(self, data, starts):
        self.d = data
        self.starts = starts
        D = data["D"]
        self.te_idx = np.concatenate([np.where((D >= s) & (D < s + 7))[0] for s in starts])
        self.cache = {}

    def run(self, name, feats, vx=(), train_days=None, l2=30.0, oracle=False):
        key = (tuple(feats), tuple(vx), train_days, l2)
        if key in self.cache:
            return self.cache[key]
        X, V, y, D = self.d["X"], self.d["V"], self.d["y"], self.d["D"]
        ci = [ALLF.index(f) for f in feats]
        out, w0, t0 = [], None, time.time()
        for s in self.starts:
            tr = D < s
            if train_days:
                tr &= D >= s - train_days
            te = (D >= s) & (D < s + 7)
            m = M.fit(X[tr][:, :, ci], V[tr], y[tr], list(feats), l2=l2, vx=list(vx), w0=w0)
            w0 = m["w"]
            out.append(M.predict(m, X[te][:, :, ci], V[te], logits=True))
        U = np.concatenate(out)
        print(f"  {name}: {time.time()-t0:.0f}s", flush=True)
        self.cache[key] = U
        return U


def probs(U):
    U = U - U.max(1, keepdims=True)
    P = np.exp(U)
    return P / P.sum(1, keepdims=True)


def summarize(P, data, idx, ref=None) -> dict:
    y, pay = data["y"][idx], data["pay"][idx]
    m = M.metrics(P, y, pay)
    out = {k: round(m[k], 5) for k in ("races", "top1", "logloss", "brier", "ece", "roi_win", "pick_lane1_share")}
    if ref is not None:
        ll = M.paired_ll(P, ref, y)
        acc = M.paired_diff(P.argmax(1) == y, ref.argmax(1) == y)
        out["vs_ref_logloss"] = {k: round(v, 5) for k, v in ll.items()}
        out["vs_ref_top1"] = {k: round(v, 5) for k, v in acc.items()}
    return out


def week_starts(days, last, k_from, k_to):
    return [int(last - 7 * k + 1) for k in range(k_from, k_to, -1)]


def main(hist: Path, weeks: int = 8):
    t0 = time.time()
    days = load_days(hist, max_days=1095)
    fan = load_fan(hist)
    tides = Tides(hist / "jma")
    print(f"history {len(days)} days {days[0][0]}..{days[-1][0]}; tide stations {tides.st}; tide series {list(tides.d)}", flush=True)
    from features import build
    data, _ = build(days, fan, tides=tides)
    print(f"built {len(data['y'])} races in {time.time()-t0:.0f}s", flush=True)
    D = data["D"]
    last = int(np.unique(D)[-1])
    sel = week_starts(D, last, 2 * weeks, weeks)       # 選ぶ期間(古い方)
    conf = week_starts(D, last, weeks, 0)              # 確かめる期間(直近)
    rs, rc = Runner(data, sel), Runner(data, conf)
    rep = {"generated_at": datetime.now(JST).isoformat(timespec="minutes"), "history_days": len(days),
           "history_from": days[0][0].isoformat(), "history_to": days[-1][0].isoformat(), "races_total": int(len(D)),
           "select_window": [date.fromordinal(sel[0]).isoformat(), date.fromordinal(sel[-1] + 6).isoformat(), int(len(rs.te_idx))],
           "confirm_window": [date.fromordinal(conf[0]).isoformat(), date.fromordinal(conf[-1] + 6).isoformat(), int(len(rc.te_idx))],
           "coverage": {f: round(float((data["X"][:, :, ALLF.index(f)] != 0).mean()), 4) for f in ALLF[len(FEATS):]},
           "steps": []}
    idx_s = rs.te_idx
    ys = data["y"][idx_s]

    # 0) v2(直近365日で学習)
    P_v2 = probs(rs.run("v2", FEATS, train_days=365))
    rep["v2_select"] = summarize(P_v2, data, idx_s)
    rep["lane1_select"] = {"top1": round(float((ys == 0).mean()), 5)}
    # 1) 学習期間: 365日 / 730日 / 全部
    best = {"name": "v2", "feats": list(FEATS), "vx": [], "train_days": 365, "P": P_v2}
    for td in (730, None):
        P = probs(rs.run(f"window_{td}", FEATS, train_days=td))
        s = summarize(P, data, idx_s, best["P"])
        keep = s["vs_ref_logloss"]["hi"] < 0   # 95%区間の上端も0未満(はっきり良くなった)ときだけ残す
        rep["steps"].append({"step": f"train_window_{td or 'all'}", "kept": keep, **s})
        if keep:
            best = {**best, "name": f"window_{td}", "train_days": td, "P": P}
    # 2) 候補を1つずつ
    for name, add, vx in STEPS:
        feats = best["feats"] + [f for f in add if f not in best["feats"]]
        vxs = best["vx"] + [f for f in vx if f not in best["vx"]]
        if feats == best["feats"] and vxs == best["vx"]:
            continue
        P = probs(rs.run(name, feats, vxs, best["train_days"]))
        s = summarize(P, data, idx_s, best["P"])
        keep = s["vs_ref_logloss"]["hi"] < 0   # 95%区間の上端も0未満(はっきり良くなった)ときだけ残す
        rep["steps"].append({"step": name, "added": add, "venue_specific": vx, "kept": keep, **s})
        print(f"  -> {name}: d_ll {s['vs_ref_logloss']['diff']:+.5f} d_top1 {s['vs_ref_top1']['diff']:+.4f} kept={keep}", flush=True)
        if keep:
            best = {**best, "name": name, "feats": feats, "vx": vxs, "P": P}
    # 3) まとめ(アンサンブル): 正則化の強さ・学習期間の違うもの、の対数確率の平均
    comps = [(best["feats"], best["vx"], best["train_days"], 30.0), (best["feats"], best["vx"], best["train_days"], 100.0),
             (best["feats"], best["vx"], 365, 30.0)]
    Us = [rs.run(f"ens{i}", f, v, td, l2) for i, (f, v, td, l2) in enumerate(comps)]
    P_ens = probs(sum(Us) / len(Us))
    s = summarize(P_ens, data, idx_s, best["P"])
    use_ens = s["vs_ref_logloss"]["hi"] < 0
    rep["steps"].append({"step": "ensemble_3", "components": [[c[2], c[3]] for c in comps], "kept": use_ens, **s})
    # 4) 参考: 当日のレース時の風(向きつき・場ごと)が前もって分かったら(上限。予想には使えない)
    P_or = probs(rs.run("oracle_wind", best["feats"] + ORACLE3, best["vx"] + ORACLE3, best["train_days"]))
    rep["oracle_racetime_wind_select"] = summarize(P_or, data, idx_s, best["P"])
    final_sel = P_ens if use_ens else best["P"]
    rep["final_select"] = summarize(final_sel, data, idx_s, P_v2)
    cfg = {"feats": best["feats"], "vx": best["vx"], "train_days": best["train_days"],
           "ensemble": [[c[2], c[3]] for c in comps] if use_ens else [[best["train_days"], 30.0]],
           "selected_at": rep["generated_at"], "select_window": rep["select_window"]}
    rep["config"] = cfg

    # 5) 確かめる期間(選ぶのに使っていない直近の期間)
    idx_c = rc.te_idx
    yc, payc = data["y"][idx_c], data["pay"][idx_c]
    P_v2c = probs(rc.run("v2", FEATS, train_days=365))
    Uc = [rc.run(f"final{i}", cfg["feats"], cfg["vx"], td, l2) for i, (td, l2) in enumerate(cfg["ensemble"])]
    P_fc = probs(sum(Uc) / len(Uc))
    lane1 = np.zeros_like(P_fc)
    lane1[:, 0] = 1.0
    rep["confirm"] = {
        "final": summarize(P_fc, data, idx_c, P_v2c),
        "v2": summarize(P_v2c, data, idx_c),
        "lane1": {"races": int(len(yc)), "top1": round(float((yc == 0).mean()), 5),
                  "roi_win": round(float(np.where(yc == 0, payc, 0).sum() / (100 * len(yc))), 5)},
        "final_vs_lane1_top1": {k: round(v, 5) for k, v in M.paired_diff(P_fc.argmax(1) == yc, yc == 0).items()},
        "v2_vs_lane1_top1": {k: round(v, 5) for k, v in M.paired_diff(P_v2c.argmax(1) == yc, yc == 0).items()},
        "tiers_final": M.tier_table(P_fc, yc, payc),
        "tiers_v2": M.tier_table(P_v2c, yc, payc),
        "calibration_final": M.metrics(P_fc, yc)["calibration"],
    }
    # 場ごとの当たり具合(確かめる期間)
    Vc = data["V"][idx_c]
    pv = []
    for v in range(24):
        msk = Vc == v
        if msk.sum() < 50:
            continue
        a = M.metrics(P_fc[msk], yc[msk])
        b = M.metrics(P_v2c[msk], yc[msk])
        pv.append({"venue": f"{v+1:02d}", "races": int(msk.sum()), "top1": round(a["top1"], 4), "v2_top1": round(b["top1"], 4),
                   "lane1": round(float((yc[msk] == 0).mean()), 4), "logloss": round(a["logloss"], 4), "v2_logloss": round(b["logloss"], 4),
                   "mean_p_top": round(float(P_fc[msk].max(1).mean()), 4), "ece": round(a["ece"], 4)})
    rep["confirm"]["per_venue"] = pv
    rep["runtime_min"] = round((time.time() - t0) / 60, 1)
    ed = ROOT / "experiments"
    ed.mkdir(exist_ok=True)
    (ed / "v3_ablation.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1), encoding="utf-8")
    (ROOT / "model_config.json").write_text(json.dumps(cfg, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({k: rep[k] for k in ("final_select", "confirm")}, ensure_ascii=False)[:3000])


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "hist", int(sys.argv[2]) if len(sys.argv) > 2 else 8)
