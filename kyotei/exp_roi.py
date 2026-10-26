"""舟券の種類・自信度・場ごとの「100円ずつ買ったら」の回収率(学習外)。賭け方の助言ではなく、検証の記録。

python kyotei/exp_roi.py [hist_dir]

- 直近16週を1週ずつウォークフォワード(その週より前だけで学習 → その週を予想)。構成は model_config.json。
- 前半8週(見つける期間)で回収率が100%以上の区分を探し、後半8週(確かめる期間)だけで評価する(何十もの区分を見ると、
  偶然100%を超えるものが必ず出るため。見つけた期間の数字は「確かめた」ことにしない)。
- 舟券: 単勝◎(100円)、3連単 上位3/5/10点(各100円)。3連単の順位は1着の確率から Harville+補正 で計算。
- 払戻は公式の競走成績の確定払戻金(100円あたり)。返還・特払いは考えない(数は少ない)。
- 出力: experiments/roi_v3.json(集計の数字だけ)。
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
CODE = M.PERMS[:, 0] * 36 + M.PERMS[:, 1] * 6 + M.PERMS[:, 2]
VEN = ["桐生", "戸田", "江戸川", "平和島", "多摩川", "浜名湖", "蒲郡", "常滑", "津", "三国", "びわこ", "住之江",
       "尼崎", "鳴門", "丸亀", "児島", "宮島", "徳山", "下関", "若松", "芦屋", "福岡", "唐津", "大村"]
BETS = {"win": 1, "tri3": 3, "tri5": 5, "tri10": 10}


def roi_stats(ret, stake, B=2000, seed=0) -> dict:
    """ret: レースごとの払戻、stake: レースごとの賭け金。レース単位のブートストラップで回収率の95%区間。"""
    n = len(ret)
    if n == 0:
        return {"races": 0}
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, n, (B, n))
    bs = ret[idx].sum(1) / (stake * n)
    return {"races": int(n), "roi": round(float(ret.sum() / (stake * n)), 4), "lo": round(float(np.percentile(bs, 2.5)), 4),
            "hi": round(float(np.percentile(bs, 97.5)), 4), "hit": round(float((ret > 0).mean()), 4)}


def returns(P, T, y, y2, y3, pay, pay_tri) -> dict:
    actual = y * 36 + y2 * 6 + y3
    order = np.argsort(-T, axis=1)
    out = {"win": np.where(P.argmax(1) == y, pay, 0.0)}
    for k in (3, 5, 10):
        hit = (CODE[order[:, :k]] == actual[:, None]).any(1)
        out[f"tri{k}"] = np.where(hit, pay_tri, 0.0)
    return out


def segments(P, V, tiers):
    top = P.max(1)
    seg = {"all": np.ones(len(P), bool)}
    for i, (nm, lo) in enumerate(tiers):
        hi = tiers[i - 1][1] if i else 1.01
        seg[f"tier_{nm}"] = (top >= lo) & (top < hi)
    for v in range(24):
        seg[f"venue_{VEN[v]}"] = V == v
    for nm, lo in tiers[:2]:
        for v in range(24):
            seg[f"tier_{nm}&venue_{VEN[v]}"] = seg[f"tier_{nm}"] & (V == v)
    seg["pick_not_lane1"] = P.argmax(1) != 0
    seg["pick_not_lane1&p>=0.4"] = (P.argmax(1) != 0) & (top >= 0.4)
    return seg


def main(hist: Path, weeks: int = 8):
    t0 = time.time()
    cfg = load_config()
    days = load_days(hist, max_days=1095)
    data, _ = build(days, load_fan(hist), tides=Tides(hist / "jma"))
    D = data["D"]
    last = int(np.unique(D)[-1])
    starts = [last - 7 * k + 1 for k in range(2 * weeks, 0, -1)]
    keep, w0 = [], None
    for s in starts:
        tr = D < s
        te = (D >= s) & (D < s + 7)
        comps = fit_components(data, tr, cfg, s, w0)
        w0 = [c["w"] for c in comps]
        keep.append((np.where(te)[0], M.predict_model({"components": comps}, data["X"][te], data["V"][te], ALLF)))
        print(f"fold {date.fromordinal(s)} {time.time()-t0:.0f}s", flush=True)
    half = weeks
    idx_a = np.concatenate([i for i, _ in keep[:half]]); P_a = np.concatenate([p for _, p in keep[:half]])
    idx_b = np.concatenate([i for i, _ in keep[half:]]); P_b = np.concatenate([p for _, p in keep[half:]])
    g = lambda k, idx: data[k][idx]  # noqa: E731
    lam = M.fit_lambdas(P_a, g("y", idx_a), g("y2", idx_a), g("y3", idx_a))   # 3連単の補正も見つける期間だけで決める
    rep = {"generated_at": datetime.now(JST).isoformat(timespec="minutes"), "config_tiers": cfg.get("tiers"), "lambda": lam,
           "discover": [date.fromordinal(starts[0]).isoformat(), date.fromordinal(starts[half] - 1).isoformat(), int(len(idx_a))],
           "validate": [date.fromordinal(starts[half]).isoformat(), date.fromordinal(last).isoformat(), int(len(idx_b))]}
    tiers = cfg.get("tiers") or M.TIERS
    res = {}
    for nm, idx, P in (("discover", idx_a, P_a), ("validate", idx_b, P_b)):
        T = M.trifecta_probs(P, *lam)
        R = returns(P, T, g("y", idx), g("y2", idx), g("y3", idx), g("pay", idx), g("pay_tri", idx))
        seg = segments(P, data["V"][idx], tiers)
        res[nm] = {b: {sn: roi_stats(R[b][m], 100 * BETS[b]) for sn, m in seg.items() if m.sum() > 0} for b in BETS}
    rep["discover_table"] = {b: {k: v for k, v in res["discover"][b].items() if not k.count("&")} for b in BETS}
    rep["validate_table"] = {b: {k: v for k, v in res["validate"][b].items() if not k.count("&")} for b in BETS}
    # 見つける期間で回収率100%以上(100レース以上)の区分 → 確かめる期間だけで評価
    found = []
    for b in BETS:
        for sn, st in res["discover"][b].items():
            if st.get("races", 0) >= 100 and st["roi"] >= 1.0:
                found.append({"bet": b, "segment": sn, "discover": st, "validate": res["validate"][b].get(sn, {"races": 0})})
    rep["candidates_from_discover"] = sorted(found, key=lambda x: -x["discover"]["roi"])
    rep["n_segments_tested"] = sum(len(res["discover"][b]) for b in BETS)
    rep["held_up"] = [f for f in found if f["validate"].get("races", 0) >= 100 and f["validate"].get("lo", 0) > 1.0]
    rep["runtime_min"] = round((time.time() - t0) / 60, 1)
    (ROOT / "experiments").mkdir(exist_ok=True)
    (ROOT / "experiments" / "roi_v3.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({k: rep[k] for k in ("discover", "validate", "lambda", "n_segments_tested")}, ensure_ascii=False))
    for b in BETS:
        print(b, {k: rep["validate_table"][b][k] for k in ("all", "tier_S", "tier_A", "tier_B", "tier_C")})
    print("candidates", len(found), "held", len(rep["held_up"]))


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "hist")
