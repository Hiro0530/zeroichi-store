"""2着・3着を直接モデルにする(条件付きロジット)検証と、3連複・3連単の区分探し。新しい取得はしない。検証の記録のみ(非公開の判断材料)。

python kyotei/exp_cond.py [hist_dir]

(A) 2着: P(2着=j | 1着=i)、3着: P(3着=k | 1着=i, 2着=j) を条件付きロジットで直接学習(直近365日、1週ずつウォークフォワード)。
    特徴量: 候補艇の数字(全国勝率の相対・平均ST・展示タイム(前のレースまで)・モーター・級別・枠別2連対など)、
    1着の枠×候補の枠(36通り: 逃げ・まくり・差しの形)、(3着は)2着の枠×候補の枠、1着が1号艇のときのSTと展示の効き方、場×候補の枠。
    比べる相手: いまの方法(1着の確率から Harville + 補正λ。λは前半8週で決める)。
    評価は後半8週だけ: 2着・3着の対数損失、3連単の対数損失と当たり具合、自信度Sの 3連単/3連複 上位3点の的中率。
(B) 3連複・3連単の区分探し(確定払戻で、上位k点を全部買った回収率): 前半8週で選び、後半8週だけで評価。試した数も出す。
出力: experiments/cond_v3.json
"""
from __future__ import annotations

import json
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
from scipy.optimize import minimize

sys.path.insert(0, str(Path(__file__).resolve().parent))
import exp_bets as EB  # noqa: E402
import model2 as M  # noqa: E402
from features import ALLF, build  # noqa: E402
from jma import VENUE_GEO, Tides  # noqa: E402
from train import fit_components, load_config, load_days, load_fan  # noqa: E402

ROOT = Path(__file__).resolve().parent
JST = timezone(timedelta(hours=9))
CAND = ["rel_nat", "nat_2", "h_st", "h_st_rel", "e_racer_exh", "e_motor_exh", "motor_2", "h_lane_t2", "fan_c_q2",
        "A1", "A2", "B1", "h_t3_ewma", "f_rv", "h_inner", "h_outer"]
CAND = [c for c in CAND if c in ALLF]
CI = [ALLF.index(c) for c in CAND]
IX_ST, IX_EX = CAND.index("h_st_rel"), CAND.index("e_racer_exh")


class Cond:
    """位置(1着・2着の枠)が決まったときの、残りの艇の中の条件付きロジット。

    2026-10-30 追加(exp_place.py で検証。既定は今までと同じ):
    - nige_cols: 1着が1号艇のときだけ効き方を変える列(Z の列番号)
    - lane_cols: 1着が1号艇のとき、候補の枠ごとに効き方を変える列(2コースの差し・3コースのまくり差しなどの相性)
    - nr: レース単位の数字(風・波など。R の列数)を、候補の枠ごと×(1号艇が1着か)で効かせる
    """

    def __init__(self, stage: int, nige_cols=(), lane_cols=(), nr: int = 0):
        self.stage = stage      # 2 = 2着, 3 = 3着
        self.nige_cols = list(nige_cols)
        self.lane_cols = list(lane_cols)
        self.nr = int(nr)

    def spec(self) -> dict:
        return {"nige_cols": self.nige_cols, "lane_cols": self.lane_cols, "nr": self.nr}

    def feats(self, Z, V, i, j=None, R=None):
        """Z:(n,6,c) 標準化した候補の数字, i:(n,) 1着の枠(0-5), j:(n,) 2着の枠, R:(n,nr) → (n,6,q)"""
        n = len(Z)
        lanes = np.arange(6)
        oh_i = np.zeros((n, 6, 36))
        oh_i[np.arange(n)[:, None], lanes[None, :], (i[:, None] * 6 + lanes[None, :])] = 1
        parts = [Z, oh_i]
        nige = (i == 0).astype(float)[:, None, None]
        parts.append(Z[:, :, [IX_ST, IX_EX]] * nige)
        if self.stage == 3:
            oh_j = np.zeros((n, 6, 36))
            oh_j[np.arange(n)[:, None], lanes[None, :], (j[:, None] * 6 + lanes[None, :])] = 1
            parts.append(oh_j)
        if self.nige_cols:
            parts.append(Z[:, :, self.nige_cols] * nige)
        if self.lane_cols or self.nr:
            E = np.eye(6)[None, :, :]
            for c in self.lane_cols:
                parts.append(Z[:, :, [c]] * E * nige)
            for r in range(self.nr):
                rv = R[:, r][:, None, None] * E
                parts.append(rv * nige)
                parts.append(rv * (1 - nige))
        return np.concatenate(parts, axis=2)

    def mask(self, i, j=None):
        n = len(i)
        m = np.ones((n, 6), bool)
        m[np.arange(n), i] = False
        if j is not None:
            m[np.arange(n), j] = False
        return m

    def fit(self, Z, V, i, j, target, l2=5.0, l2_v=50.0, w0=None, R=None, maxiter=300):
        F = self.feats(Z, V, i, j, R)
        msk = self.mask(i, j)
        n, _, q = F.shape
        yi = np.arange(n)

        def f(w):
            b, bv = w[:q], w[q:].reshape(24, 6)
            u = F @ b + bv[V]
            u = np.where(msk, u, -1e9)
            u -= u.max(1, keepdims=True)
            e = np.exp(u) * msk
            s = e.sum(1, keepdims=True)
            P = e / s
            ll = (u[yi, target] - np.log(s[:, 0])).sum()
            G = P.copy()
            G[yi, target] -= 1
            gb = np.einsum("nk,nkq->q", G, F) + l2 * b
            gv = np.zeros((24, 6))
            np.add.at(gv, V, G)
            gv += l2_v * bv
            return -ll + 0.5 * (l2 * b @ b + l2_v * (bv * bv).sum()), np.concatenate([gb, gv.ravel()])
        w = np.zeros(q + 144) if w0 is None or len(w0) != q + 144 else w0
        self.w = minimize(f, w, jac=True, method="L-BFGS-B", options={"maxiter": maxiter}).x
        self.q = q
        return self

    def predict(self, Z, V, i, j=None, R=None):
        F = self.feats(Z, V, i, j, R)
        msk = self.mask(i, j)
        u = F @ self.w[:self.q] + self.w[self.q:].reshape(24, 6)[V]
        u = np.where(msk, u, -1e9)
        u -= u.max(1, keepdims=True)
        e = np.exp(u) * msk
        return e / e.sum(1, keepdims=True)


def tri_cond(P1, Z, V, m2: Cond, m3: Cond, R=None):
    """1着の確率 × 2着(条件付き) × 3着(条件付き) → (n,120) PERMS 順"""
    n = len(P1)
    P2 = np.zeros((n, 6, 6))
    for i in range(6):
        P2[:, i, :] = m2.predict(Z, V, np.full(n, i), None, R)
    T = np.zeros((n, 120))
    P3 = {}
    for a in range(6):
        for b in range(6):
            if a != b:
                P3[(a, b)] = m3.predict(Z, V, np.full(n, a), np.full(n, b), R)
    for idx, (a, b, c) in enumerate(EB.PERMS):
        T[:, idx] = P1[:, a] * P2[:, a, b] * P3[(a, b)][:, c]
    return T / T.sum(1, keepdims=True), P2


def pl_cond(P1, lam):
    P = np.clip(P1, 1e-6, 1)
    n = len(P)
    P2 = np.zeros((n, 6, 6))
    Q = P ** lam[0]
    for i in range(6):
        q = Q.copy()
        q[:, i] = 0
        P2[:, i, :] = q / q.sum(1, keepdims=True)
    return M.trifecta_probs(P1, *lam), P2


def stdz(X, ref):
    mu = ref.reshape(-1, ref.shape[2]).mean(0)
    sd = ref.reshape(-1, ref.shape[2]).std(0) + 1e-9
    return (X - mu) / sd


def roi(ret, stake, B=1000, seed=0):
    n = len(ret)
    if n == 0:
        return {"races": 0}
    rng = np.random.default_rng(seed)
    ix = rng.integers(0, n, (B, n))
    bs = ret[ix].sum(1) / stake[ix].sum(1)
    return {"races": int(n), "roi": round(float(ret.sum() / stake.sum()), 4), "lo": round(float(np.percentile(bs, 2.5)), 4),
            "hi": round(float(np.percentile(bs, 97.5)), 4), "hit": round(float((ret > 0).mean()), 4)}


def main(hist: Path, weeks: int = 8):
    t0 = time.time()
    cfg = load_config()
    tiers = cfg.get("tiers") or M.TIERS
    days = load_days(hist, max_days=1095)
    data, _ = build(days, load_fan(hist), tides=Tides(hist / "jma"))
    D, V, y, y2, y3, payd = data["D"], data["V"], data["y"], data["y2"], data["y3"], data["payd"]
    Xc = data["X"][:, :, CI].astype(np.float64)
    last = int(np.unique(D)[-1])
    starts = [last - 7 * k + 1 for k in range(2 * weeks, 0, -1)]
    P1s, Tc, P2c, idxs = [], [], [], []
    w1 = w2 = w3 = None
    for k, s in enumerate(starts):
        tr = (D < s) & (D >= s - 365)
        te = (D >= s) & (D < s + 7)
        comps = fit_components(data, D < s, cfg, s, w1)
        w1 = [c["w"] for c in comps]
        P1 = M.predict_model({"components": comps}, data["X"][te], V[te], ALLF)
        Ztr, Zte = stdz(Xc[tr], Xc[tr]), stdz(Xc[te], Xc[tr])
        m2 = Cond(2).fit(Ztr, V[tr], y[tr], None, y2[tr], w0=w2)
        w2 = m2.w
        m3 = Cond(3).fit(Ztr, V[tr], y[tr], y2[tr], y3[tr], w0=w3)
        w3 = m3.w
        T, P2 = tri_cond(P1, Zte, V[te], m2, m3)
        P1s.append(P1); Tc.append(T); P2c.append(P2); idxs.append(np.where(te)[0])
        print(f"fold {k} {date.fromordinal(s)} {time.time()-t0:.0f}s", flush=True)
    A = slice(0, weeks)
    B = slice(weeks, 2 * weeks)
    cat = lambda xs, sl: np.concatenate(xs[sl])  # noqa: E731
    iA, iB = cat(idxs, A), cat(idxs, B)
    P1A, P1B = cat(P1s, A), cat(P1s, B)
    lam = M.fit_lambdas(P1A, y[iA], y2[iA], y3[iA])
    T_pl, P2_pl = pl_cond(P1B, lam)
    T_c, P2_c = cat(Tc, B), cat(P2c, B)
    yb, y2b, y3b = y[iB], y2[iB], y3[iB]
    n = len(iB)
    r = np.arange(n)
    code = yb * 36 + y2b * 6 + y3b
    lut = {c: i for i, c in enumerate(EB.PERMS[:, 0] * 36 + EB.PERMS[:, 1] * 6 + EB.PERMS[:, 2])}
    ai = np.array([lut[c] for c in code])

    def ll3(T, P2):
        p2 = P2[r, yb, y2b]
        p3 = T[r, ai] / np.maximum(P1B[r, yb] * p2, 1e-12)
        return {"ll_2nd": round(float(-np.log(np.clip(p2, 1e-9, 1)).mean()), 5),
                "ll_3rd": round(float(-np.log(np.clip(p3, 1e-9, 1)).mean()), 5),
                "ll_trifecta": round(float(-np.log(np.clip(T[r, ai], 1e-12, 1)).mean()), 5)}
    rep = {"generated_at": datetime.now(JST).isoformat(timespec="minutes"), "lambda_pl": lam, "features": CAND,
           "discover": [date.fromordinal(starts[0]).isoformat(), date.fromordinal(starts[weeks] - 1).isoformat()],
           "validate": [date.fromordinal(starts[weeks]).isoformat(), date.fromordinal(last).isoformat(), int(n)]}
    rep["loss"] = {"pl": ll3(T_pl, P2_pl), "cond": ll3(T_c, P2_c)}
    d3 = -np.log(np.clip(T_c[r, ai], 1e-12, 1)) + np.log(np.clip(T_pl[r, ai], 1e-12, 1))
    rng = np.random.default_rng(0)
    bs = [d3[rng.integers(0, n, n)].mean() for _ in range(1000)]
    rep["loss"]["trifecta_diff_cond_minus_pl"] = {"diff": round(float(d3.mean()), 5), "lo": round(float(np.percentile(bs, 2.5)), 5),
                                                  "hi": round(float(np.percentile(bs, 97.5)), 5)}
    tierS = P1B.max(1) >= tiers[0][1]
    trio_lab = EB.LBL["trio"]
    tset = np.array([trio_lab.index("-".join(map(str, sorted((a + 1, b + 1, c + 1))))) for a, b, c in zip(yb, y2b, y3b)])
    hitk = {}
    for nm, T in (("pl", T_pl), ("cond", T_c)):
        Tr = T @ EB.M_TRIO
        o = {}
        for seg, m in (("all", np.ones(n, bool)), ("tier_S", tierS)):
            for k in (1, 3, 5):
                tk = np.argsort(-T[m], 1)[:, :k]
                rk = np.argsort(-Tr[m], 1)[:, :k]
                o[f"{seg}_trifecta_top{k}"] = round(float((tk == ai[m][:, None]).any(1).mean()), 4)
                o[f"{seg}_trio_top{k}"] = round(float((rk == tset[m][:, None]).any(1).mean()), 4)
        cal = []
        pf, yf = T.ravel(), np.zeros_like(T)
        yf[r, ai] = 1
        yf = yf.ravel()
        for lo, hi in ((0, .01), (.01, .03), (.03, .06), (.06, .1), (.1, .2), (.2, 1.01)):
            mm = (pf >= lo) & (pf < hi)
            if mm.sum():
                cal.append([f"{lo*100:.0f}-{hi*100:.0f}%", int(mm.sum()), round(float(pf[mm].mean()), 4), round(float(yf[mm].mean()), 4)])
        o["calibration_trifecta"] = cal
        hitk[nm] = o
    rep["hits"] = hitk
    # (B) 3連複・3連単の区分探し(確定払戻、上位k点を全部買う)。よかった方の3連単の確率を使う
    use = "cond" if rep["loss"]["cond"]["ll_trifecta"] < rep["loss"]["pl"]["ll_trifecta"] else "pl"
    rep["segment_model"] = use
    T_A = cat(Tc, A) if use == "cond" else pl_cond(P1A, lam)[0]
    P2_A = cat(P2c, A) if use == "cond" else pl_cond(P1A, lam)[1]
    T_B, P2_B = (T_c, P2_c) if use == "cond" else (T_pl, P2_pl)
    tidal = np.array([VENUE_GEO[f"{v+1:02d}"][2] for v in range(24)])
    wind_ix = ALLF.index("wxp_wind_l1")

    def seg_feats(idx, P1, P2):
        fav = P1.argmax(1)
        q = P2[np.arange(len(idx)), fav, :]
        H = -(np.where(q > 0, q * np.log(np.maximum(q, 1e-12)), 0)).sum(1)
        return {"top": P1.max(1), "H": H, "wind": data["X"][idx, 0, wind_ix], "tidal": tidal[V[idx]]}
    SA, SB = seg_feats(iA, P1A, P2_A), seg_feats(iB, P1B, P2_B)
    Hq = {q_: float(np.quantile(SA["H"], q_)) for q_ in (0.25, 0.5)}

    def returns(idx, T, bet, k):
        prob = T if bet == "trifecta" else T @ EB.M_TRIO
        lab = EB.LBL[bet]
        top = np.argsort(-prob, 1)[:, :k]
        ret = np.array([sum((payd[i] or {}).get(bet, {}).get(lab[c], 0) for c in top[j]) for j, i in enumerate(idx)], float)
        return ret, np.full(len(idx), 100.0 * k)
    ok_A = np.array([bool(payd[i] and payd[i].get("trio")) for i in iA])
    ok_B = np.array([bool(payd[i] and payd[i].get("trio")) for i in iB])
    conds = []
    for tier in ("all", "S", "SA"):
        for hq in (None, 0.5, 0.25):
            for wind in (None, "calm", "windy"):
                for water in (None, "tidal", "fresh"):
                    conds.append((tier, hq, wind, water))

    def cmask(S, c):
        tier, hq, wind, water = c
        m = np.ones(len(S["top"]), bool)
        if tier == "S":
            m &= S["top"] >= tiers[0][1]
        elif tier == "SA":
            m &= S["top"] >= tiers[1][1]
        if hq:
            m &= S["H"] <= Hq[hq]
        if wind == "calm":
            m &= S["wind"] < 3
        elif wind == "windy":
            m &= S["wind"] >= 4
        if water == "tidal":
            m &= S["tidal"]
        elif water == "fresh":
            m &= ~S["tidal"]
        return m
    bets = [("trio", 1), ("trio", 3), ("trio", 5), ("trifecta", 3), ("trifecta", 5), ("trifecta", 10)]
    found, tested = [], 0
    for bet, k in bets:
        rA, sA = returns(iA, T_A, bet, k)
        rB, sB = returns(iB, T_B, bet, k)
        best = None
        for c in conds:
            tested += 1
            m = cmask(SA, c) & ok_A
            if m.sum() < 200:
                continue
            st = roi(rA[m], sA[m], B=200)
            if best is None or st["roi"] > best[1]["roi"]:
                best = (c, st)
        if best:
            c, st = best
            mB = cmask(SB, c) & ok_B
            found.append({"bet": f"{EB.JP[bet]}{k}点", "condition": {"tier": c[0], "H_quantile": c[1], "wind_prevday": c[2], "water": c[3]},
                          "discover": st, "validate": roi(rB[mB], sB[mB])})
        mB = ok_B
        found.append({"bet": f"{EB.JP[bet]}{k}点", "condition": "baseline_all", "validate": roi(rB[mB], sB[mB])})
    rep["segments"] = found
    rep["segments_tested"] = tested
    rep["survivors"] = [f for f in found if f.get("validate", {}).get("lo", 0) > 1.0 and f["condition"] != "baseline_all"]
    rep["runtime_min"] = round((time.time() - t0) / 60, 1)
    (ROOT / "experiments").mkdir(exist_ok=True)
    (ROOT / "experiments" / "cond_v3.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({k: rep[k] for k in ("loss", "hits", "segments_tested", "survivors", "runtime_min")}, ensure_ascii=False)[:4000])


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "hist")
