"""券種ごとの組番の確率の当たり具合(較正)と、確定払戻を使って分かること・分からないことの整理。新しい取得はしない。

python kyotei/exp_calib.py [hist_dir]
- 直近16週のウォークフォワード(構成は model_config.json)。前半8週で較正(単調回帰)を当て、後半8週で評価。
- (1) 予想確率の区分ごとの実際の的中率と件数(全レース/自信度S/「◎1着+外枠・人気薄が2・3着」の組番)
- (2) 区分の組番を全部100円ずつ買った場合の回収率(件数=賭けた点数が分かるので計算できる)。
      「確率×オッズ≥1.2 の組番だけ」の回収率は、外れた組番のオッズが分からないので計算できない。代わりに、当たった組番のうち
      確率×確定オッズ≥1.2 だった割合を出す。
- (3) 前半で当てた較正を後半に使うと、確率×確定オッズ≥1.2 の当たり組番がどれだけ減るか。
出力: experiments/calib_v3.json
"""
from __future__ import annotations

import json
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import exp_bets as EB  # noqa: E402
import model2 as M  # noqa: E402
from features import ALLF, build  # noqa: E402
from jma import Tides  # noqa: E402
from train import fit_components, load_config, load_days, load_fan  # noqa: E402

ROOT = Path(__file__).resolve().parent
JST = timezone(timedelta(hours=9))
EDGES = [0, 0.02, 0.05, 0.10, 0.20, 0.40, 1.01]
TYPES = ["tansho", "exacta", "quinella", "trio", "trifecta"]


def pav(x, y, w=None):
    """単調(増加)回帰。→ (区切りのx, 値) で、np.interp で使う。"""
    o = np.argsort(x)
    x, y = x[o], y[o]
    w = np.ones_like(y) if w is None else w[o]
    vals, wts, xs = [], [], []
    for xi, yi, wi in zip(x, y, w):
        vals.append(yi); wts.append(wi); xs.append(xi)
        while len(vals) > 1 and vals[-2] > vals[-1]:
            v = (vals[-2] * wts[-2] + vals[-1] * wts[-1]) / (wts[-2] + wts[-1])
            ww = wts[-2] + wts[-1]
            vals[-2:] = [v]; wts[-2:] = [ww]; xs[-2:] = [xs[-1]]
    return np.array(xs), np.array(vals)


def table(p, hit, pay):
    out = []
    for lo, hi in zip(EDGES[:-1], EDGES[1:]):
        m = (p >= lo) & (p < hi)
        n = int(m.sum())
        if not n:
            continue
        k = int(hit[m].sum())
        out.append({"bucket": f"{lo*100:.0f}-{min(hi,1)*100:.0f}%", "n": n, "mean_p": round(float(p[m].mean()), 4),
                    "hit": round(k / n, 4), "hits": k, "lo": round(M.wilson(k, n)[0], 4), "hi": round(M.wilson(k, n)[1], 4),
                    "roi_bet_all": round(float(pay[m].sum() / (100 * n)), 4)})
    return out


def main(hist: Path, weeks: int = 8):
    t0 = time.time()
    cfg = load_config()
    tiers = cfg.get("tiers") or M.TIERS
    days = load_days(hist, max_days=1095)
    data, _ = build(days, load_fan(hist), tides=Tides(hist / "jma"))
    D, payd = data["D"], data["payd"]
    last = int(np.unique(D)[-1])
    starts = [last - 7 * k + 1 for k in range(2 * weeks, 0, -1)]
    keep, w0 = [], None
    for s in starts:
        tr = D < s
        te = (D >= s) & (D < s + 7)
        comps = fit_components(data, tr, cfg, s, w0)
        w0 = [c["w"] for c in comps]
        keep.append((np.where(te)[0], M.predict_model({"components": comps}, data["X"][te], data["V"][te], ALLF)))
    have = np.array([bool(p and p.get("trio")) for p in payd])
    ph = {}
    for nm, part in (("discover", keep[:weeks]), ("validate", keep[weeks:])):
        idx = np.concatenate([i for i, _ in part]); P = np.concatenate([p for _, p in part])
        ok = have[idx]
        ph[nm] = (idx[ok], P[ok])
    lam = M.fit_lambdas(ph["discover"][1], data["y"][ph["discover"][0]], data["y2"][ph["discover"][0]], data["y3"][ph["discover"][0]])
    rep = {"generated_at": datetime.now(JST).isoformat(timespec="minutes"), "lambda": lam,
           "discover": [date.fromordinal(starts[0]).isoformat(), date.fromordinal(starts[weeks] - 1).isoformat(), int(len(ph["discover"][0]))],
           "validate": [date.fromordinal(starts[weeks]).isoformat(), date.fromordinal(last).isoformat(), int(len(ph["validate"][0]))],
           "note": "回収率 roi_bet_all は区分の組番を全部100円ずつ買った場合(点数が分かるので計算できる)。"
                   "確率×オッズ≥1.2の組番だけ買った回収率は、外れた組番のオッズが分からないので計算できない。"}
    flat = {}
    for nm, (idx, P) in ph.items():
        pr, _ = EB.probs_all(P, lam)
        top = P.max(1)
        fav = P.argmax(1)
        rank = np.argsort(np.argsort(-P, axis=1), axis=1)   # 1着の確率の順位(0=◎)
        tierS = top >= tiers[0][1]
        flat[nm] = {}
        for bet in TYPES:
            lab = EB.LBL[bet]
            n, m = pr[bet].shape
            hit = np.zeros((n, m), bool)
            pay = np.zeros((n, m))
            for i, r in enumerate(idx):
                for comb, amt in (payd[r].get(bet) or {}).items():
                    if comb in lab:
                        j = lab.index(comb)
                        hit[i, j] = True
                        pay[i, j] = amt
            seg = {"all": np.ones((n, m), bool), "tier_S": np.repeat(tierS[:, None], m, 1)}
            if bet == "trifecta":
                a, b, c = EB.PERMS[:, 0], EB.PERMS[:, 1], EB.PERMS[:, 2]
                out_b = rank[:, b] >= 3
                out_c = rank[:, c] >= 3
                seg["fav1_outsider23"] = (a[None, :] == fav[:, None]) & (out_b | out_c)
                seg["fav1_outsider23_tierS"] = seg["fav1_outsider23"] & tierS[:, None]
            flat[nm][bet] = (pr[bet], hit, pay, seg)
    out = {}
    for bet in TYPES:
        o = {}
        pD, hD, _, sD = flat["discover"][bet]
        xs, vs = pav(pD.ravel(), hD.ravel().astype(float))
        for nm in ("discover", "validate"):
            p, h, pay, seg = flat[nm][bet]
            o[nm] = {sn: table(p[m], h[m], pay[m]) for sn, m in seg.items()}
        p, h, pay, seg = flat["validate"][bet]
        pc = np.interp(p, xs, vs)
        win = h
        odds = pay / 100
        ev_raw = (p * odds)[win]
        ev_cal = (pc * odds)[win]
        o["validate_calibrated"] = {"all": table(pc.ravel(), h.ravel(), pay.ravel())}
        o["winners"] = {"n": int(win.sum()), "share_ev_ge_1.2_raw": round(float((ev_raw >= 1.2).mean()), 4),
                        "share_ev_ge_1.2_calibrated": round(float((ev_cal >= 1.2).mean()), 4),
                        "share_ev_ge_1.0_raw": round(float((ev_raw >= 1.0).mean()), 4),
                        "share_ev_ge_1.0_calibrated": round(float((ev_cal >= 1.0).mean()), 4),
                        "return_of_winners_ev_ge_1.2_raw": int(pay[win][ev_raw >= 1.2].sum()),
                        "return_of_winners_ev_ge_1.2_calibrated": int(pay[win][ev_cal >= 1.2].sum())}
        o["calibration_map"] = [[round(float(a), 4), round(float(b), 4)] for a, b in zip(xs[:: max(1, len(xs) // 40)], vs[:: max(1, len(vs) // 40)])]
        out[bet] = o
    rep["by_bet"] = out
    rep["runtime_min"] = round((time.time() - t0) / 60, 1)
    (ROOT / "experiments").mkdir(exist_ok=True)
    (ROOT / "experiments" / "calib_v3.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1), encoding="utf-8")
    for bet in TYPES:
        print(bet, out[bet]["validate"]["all"], out[bet]["winners"])


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "hist")
