"""荒れるレース(1号艇が負ける・3連単1万円以上=万舟)を、レースの前に分かる数字だけで見分けられるか。賭け方の助言ではなく検証の記録。

python kyotei/exp_are.py [hist_dir] [weeks=52]

方法(未来の情報を混ぜない):
- exp_v4 と同じ: 直近 weeks 週を1週ずつウォークフォワード(その週より前の365日だけで学習 → その週を予想)。
  前半 = 選ぶ期間、後半 = 確かめる期間。確かめる期間は選ぶのに使わず、最後に評価だけ。
- 確率は2つ: 朝の版(公開している予想と同じ構成 model_config.json)と、直前版(model_config.json の pre。
  展示タイム・直前の風と波・進入。学習は競走成績ファイルの同じ値で、進入は「実際の進入」で代用=上限寄り)。
  2着・3着は条件付きモデル(4週ごとに学習し直す)。
- (1) 条件ごとの診断: 1号艇の1着率(実際)とモデルの見積もりの差(=モデルが見落としているか)、万舟率。両方の期間で。
- (2) 「荒れ」の点数: 1−1号艇の1着の確率(朝・直前)、万舟になるかのロジスティック回帰(選ぶ期間で学習・確かめる期間で評価)、
  1号艇が負けるかの補正(モデルの確率+条件。モデルより良くなるか)、今までの穴の決め方(exp_ana)の点数。AUC で比べる。
- (3) 買い方: 1日の点数の上位 n レース × 券種(3・4号艇頭の3連単、1号艇を外した2連単・3連単・3連複、単勝など)。
  選ぶ期間でいちばん回収率の高い組み合わせを選び、確かめる期間で評価。決まった条件(ライバル型など)は選ばずにそのまま評価。
  3連複は払戻の記録が直近182日分しか無いので確かめる期間だけ(参考)。
- 直前の「スタート展示のST」は競走成績ファイルに無く、過去分で検証できない(直前情報ページの読み取りは紙の上の検証で貯めている)。
出力: experiments/are_v1.json(集計の数字だけ。2026-10-29 の2回目から混戦度の点数を追加)。毎朝の設定(are_config.json)は書かない(採否は人が見て決める)。
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
import exp_ana as EA  # noqa: E402
import model2 as M  # noqa: E402
from exp_cond import CAND, Cond, tri_cond  # noqa: E402
from exp_v3 import Runner, probs  # noqa: E402
from exp_v4 import Ctx, _js, roi_ci  # noqa: E402
from features import ALLF, build  # noqa: E402
from jma import Tides  # noqa: E402
from train import load_config, load_days, load_fan, pre_config  # noqa: E402

ROOT = Path(__file__).resolve().parent
JST = timezone(timedelta(hours=9))
PERMS = EB.PERMS
EXL = EB.EXL
TRIPS = EB.TRIPS
FI = {f: i for i, f in enumerate(ALLF)}


def r4(x):
    return None if x is None else round(float(x), 4)


def auc(score, y):
    y = np.asarray(y, bool)
    if y.all() or (~y).all():
        return None
    r = np.argsort(np.argsort(score)) + 1.0
    n1, n0 = y.sum(), (~y).sum()
    return r4((r[y].sum() - n1 * (n1 + 1) / 2) / (n1 * n0))


def boot_mean(d, B=1000, seed=0):
    d = np.asarray(d, float)
    n = len(d)
    if n == 0:
        return {"mean": None, "lo": None, "hi": None, "n": 0}
    rng = np.random.default_rng(seed)
    bs = d[rng.integers(0, n, (B, n))].mean(1)
    return {"mean": r4(d.mean()), "lo": r4(np.percentile(bs, 2.5)), "hi": r4(np.percentile(bs, 97.5)), "n": int(n)}


# ------------------------------------------------------------------ ロジスティック回帰(L2、ニュートン法)
def logit_fit(Z, y, l2=1.0, it=30):
    X = np.hstack([np.ones((len(Z), 1)), Z])
    w = np.zeros(X.shape[1])
    R = np.eye(X.shape[1]) * l2
    R[0, 0] = 0
    for _ in range(it):
        p = 1 / (1 + np.exp(-(X @ w)))
        g = X.T @ (p - y) + R @ w
        H = (X * (p * (1 - p))[:, None]).T @ X + R
        step = np.linalg.solve(H, g)
        w -= step
        if np.abs(step).max() < 1e-7:
            break
    return w


def logit_pred(w, Z):
    return 1 / (1 + np.exp(-(np.hstack([np.ones((len(Z), 1)), Z]) @ w)))


def ll_bin(p, y):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


# ------------------------------------------------------------------ レースごとの「レース前に分かる」目印
def race_cov(X, V):
    """X: (n,6,F) の特徴量(朝の値+直前の値の列)。→ 名前つきの配列(1号艇・外の艇・水面)"""
    g = lambda f, L: X[:, L, FI[f]].astype(float)  # noqa: E731
    l1A1, l1A2, l1B1 = g("A1", 0), g("A2", 0), g("B1", 0)
    a1 = np.stack([g("A1", L) for L in range(6)], 1)
    nat = np.stack([g("nat_win", L) for L in range(6)], 1)
    hst = np.stack([g("h_st", L) for L in range(6)], 1)
    exr = np.stack([g("p_exh_rank", L) for L in range(6)], 1)
    csh = np.stack([g("p_cshift", L) for L in range(6)], 1)
    cov = {
        "l1_A1": l1A1, "l1_A2": l1A2, "l1_B": 1 - l1A1 - l1A2,
        "l1_nat": g("nat_win", 0), "l1_loc": g("loc_win", 0), "l1_motor": g("motor_2", 0) * 10,
        "l1_hst": g("h_st", 0), "l1_Fper": g("s_Fper", 0), "l1_ksF": g("ks_F", 0), "l1_lanewin": g("h_lane_win", 0),
        "a1_34": a1[:, 2:4].sum(1), "a1_26": a1[:, 1:].sum(1),
        "nat_gap34": nat[:, 2:4].max(1) - nat[:, 0], "nat_gap26": nat[:, 1:].max(1) - nat[:, 0],
        "st_gap34": hst[:, 0] - hst[:, 2:4].min(1),   # 1号艇の平均STが3・4号艇の速い方より遅い(秒)
        "wind_prev": g("wxp_wind_l1", 0),
        # 直前(締切の約10〜20分前に出る数字。学習は競走成績ファイルの同じ値)
        "wind_pre": g("p_wind_l1", 0), "wave_pre": g("p_wave_l1", 0),
        "l1_exh_rank": exr[:, 0], "exh_best34": (exr[:, 2:4].min(1) < exr[:, 0]).astype(float),
        "entry_shift": (np.abs(csh) > 0).any(1).astype(float), "l1_not_c1": (g("p_c1", 0) < 0).astype(float),
    }
    return cov


MORNING_COV = ["l1_A1", "l1_A2", "l1_nat", "l1_loc", "l1_motor", "l1_hst", "l1_Fper", "l1_ksF", "l1_lanewin",
               "a1_34", "a1_26", "nat_gap34", "nat_gap26", "st_gap34", "wind_prev"]
PRE_COV = MORNING_COV + ["wind_pre", "wave_pre", "l1_exh_rank", "exh_best34", "entry_shift", "l1_not_c1"]


def bins_of(cov):
    """診断用の区分(決まった区切り。結果を見て区切りを変えない)"""
    c = cov
    return {
        "1号艇の級別": {"A1": c["l1_A1"] == 1, "A2": c["l1_A2"] == 1, "B1・B2": c["l1_B"] == 1},
        "1号艇の全国勝率": {"<5.0": c["l1_nat"] < 5, "5.0-6.0": (c["l1_nat"] >= 5) & (c["l1_nat"] < 6),
                       "6.0-7.0": (c["l1_nat"] >= 6) & (c["l1_nat"] < 7), "7.0+": c["l1_nat"] >= 7},
        "1号艇のモーター2連率": {"<30%": c["l1_motor"] < 30, "30-40%": (c["l1_motor"] >= 30) & (c["l1_motor"] < 40),
                          "40%+": c["l1_motor"] >= 40},
        "3・4号艇のA1": {"0人": c["a1_34"] == 0, "1人以上": c["a1_34"] >= 1},
        "1号艇がA1でなく3・4号艇にA1(ライバル型)": {"該当": (c["l1_A1"] == 0) & (c["a1_34"] >= 1),
                                         "該当しない": ~((c["l1_A1"] == 0) & (c["a1_34"] >= 1))},
        "3・4号艇の全国勝率−1号艇": {"<0": c["nat_gap34"] < 0, "0-1": (c["nat_gap34"] >= 0) & (c["nat_gap34"] < 1),
                             "1+": c["nat_gap34"] >= 1},
        "1号艇の平均STが3・4号艇より遅い": {"0.02秒以上遅い": c["st_gap34"] >= 0.02, "それ以外": c["st_gap34"] < 0.02},
        "1号艇の今期のF": {"あり": c["l1_Fper"] > 0, "なし": c["l1_Fper"] == 0},
        "前日の風(同じ場)": {"0-4m": c["wind_prev"] < 5, "5m+": c["wind_prev"] >= 5},
        "直前の風": {"0-2m": c["wind_pre"] <= 2, "3-4m": (c["wind_pre"] >= 3) & (c["wind_pre"] <= 4),
                  "5-6m": (c["wind_pre"] >= 5) & (c["wind_pre"] <= 6), "7m+": c["wind_pre"] >= 7},
        "直前の波": {"0-4cm": c["wave_pre"] <= 4, "5cm+": c["wave_pre"] >= 5},
        "1号艇の展示タイムの順位": {"1-2位": c["l1_exh_rank"] <= -1.5, "3-4位": np.abs(c["l1_exh_rank"]) < 1.5,
                          "5-6位": c["l1_exh_rank"] >= 1.5},
        "進入(実際の進入で代用)": {"枠なり": c["entry_shift"] == 0, "変化あり": c["entry_shift"] == 1,
                           "1号艇が1コースでない": c["l1_not_c1"] == 1},
    }


RULES = {   # 決まった条件(選ばずにそのまま評価)。pre=True は直前の数字を使う
    "R1 ライバル型: 1号艇がA1でなく、3・4号艇にA1": (False, lambda c: (c["l1_A1"] == 0) & (c["a1_34"] >= 1)),
    "R2 1号艇がB級": (False, lambda c: c["l1_B"] == 1),
    "R3 1号艇の平均STが3・4号艇より0.02秒以上遅い": (False, lambda c: c["st_gap34"] >= 0.02),
    "R4 1号艇に今期のF": (False, lambda c: c["l1_Fper"] > 0),
    "R5 直前の風5m以上または波5cm以上": (True, lambda c: (c["wind_pre"] >= 5) | (c["wave_pre"] >= 5)),
    "R6 1号艇の展示タイムが5・6位": (True, lambda c: c["l1_exh_rank"] >= 1.5),
    "R7 進入の変化あり(実際の進入で代用)": (True, lambda c: c["entry_shift"] == 1),
    "R8 R1 かつ 1号艇の展示5・6位": (True, lambda c: (c["l1_A1"] == 0) & (c["a1_34"] >= 1) & (c["l1_exh_rank"] >= 1.5)),
    "R9 R1 かつ 直前の風5m以上": (True, lambda c: (c["l1_A1"] == 0) & (c["a1_34"] >= 1) & (c["wind_pre"] >= 5)),
}


# ------------------------------------------------------------------ 買い方(各レースの組番の一覧)
BETS = ["tan_non1", "tan_34", "tan_34w", "ex_non1_3", "ex_34_4", "tri_non1_5", "tri_non1_10", "tri_non1_20",
        "tri_34_6", "tri_34_12", "tri_1out2_10", "tri_top3", "trio_non1_3", "trio_non1_5"]
BET_JP = {"tan_non1": "単勝 1号艇以外で確率最大の1点", "tan_34": "単勝 3・4号艇の確率の高い方1点", "tan_34w": "単勝 3号艇と4号艇の2点",
          "ex_non1_3": "2連単 1号艇以外が頭の上位3点", "ex_34_4": "2連単 3・4号艇頭の上位4点",
          "tri_non1_5": "3連単 1号艇以外が頭の上位5点", "tri_non1_10": "3連単 1号艇以外が頭の上位10点",
          "tri_non1_20": "3連単 1号艇以外が頭の上位20点", "tri_34_6": "3連単 3・4号艇頭の上位6点",
          "tri_34_12": "3連単 3・4号艇頭の上位12点", "tri_1out2_10": "3連単 1号艇が3着以下の上位10点",
          "tri_top3": "3連単 確率の上位3点(いつもの本線)", "trio_non1_3": "3連複 1号艇を含まない上位3点",
          "trio_non1_5": "3連複 1号艇を含まない上位5点"}
CONF_ONLY = {"trio_non1_3", "trio_non1_5"}   # 選ぶ期間に払戻の記録が無い


def bet_table(P, T, pays):
    """→ {買い方: (払戻(n,), 賭け金(n,))}。pays[i] = {tansho, exacta, trifecta, trio} の組番→払戻"""
    n = len(P)
    Ex = T @ EB.M_EX
    Tr = T @ EB.M_TRIO
    head = PERMS[:, 0]
    sec = PERMS[:, 1]
    m_non1 = head != 0
    m_34 = (head == 2) | (head == 3)
    m_1out2 = (head != 0) & (sec != 0)
    ex_head = np.array([a for a, _ in EXL])
    tr_no1 = np.array([0 not in t for t in TRIPS])
    LT = EB.LBL["trifecta"]; LE = EB.LBL["exacta"]; LR = EB.LBL["trio"]
    out = {b: (np.zeros(n), np.zeros(n)) for b in BETS}

    def top(prob, mask, k):
        s = np.where(mask, prob, -1.0)
        return np.argsort(-s)[:k]

    for i in range(n):
        pt = pays[i]
        tan, exa, tri, trio = pt["tansho"], pt["exacta"], pt["trifecta"], pt.get("trio")
        lst = {
            "tan_non1": ("t", [str(1 + 1 + int(np.argmax(P[i, 1:])))]),
            "tan_34": ("t", [str(3 + int(np.argmax(P[i, 2:4])))]),
            "tan_34w": ("t", ["3", "4"]),
            "ex_non1_3": ("e", [LE[j] for j in top(Ex[i], ex_head != 0, 3)]),
            "ex_34_4": ("e", [LE[j] for j in top(Ex[i], (ex_head == 2) | (ex_head == 3), 4)]),
            "tri_non1_5": ("3", [LT[j] for j in top(T[i], m_non1, 5)]),
            "tri_non1_10": ("3", [LT[j] for j in top(T[i], m_non1, 10)]),
            "tri_non1_20": ("3", [LT[j] for j in top(T[i], m_non1, 20)]),
            "tri_34_6": ("3", [LT[j] for j in top(T[i], m_34, 6)]),
            "tri_34_12": ("3", [LT[j] for j in top(T[i], m_34, 12)]),
            "tri_1out2_10": ("3", [LT[j] for j in top(T[i], m_1out2, 10)]),
            "tri_top3": ("3", [LT[j] for j in np.argsort(-T[i])[:3]]),
            "trio_non1_3": ("r", [LR[j] for j in top(Tr[i], tr_no1, 3)]),
            "trio_non1_5": ("r", [LR[j] for j in top(Tr[i], tr_no1, 5)]),
        }
        for b, (kind, combos) in lst.items():
            src = {"t": tan, "e": exa, "3": tri, "r": trio}[kind]
            if src is None or not src:
                continue   # 払戻の記録が無い(3連複の古い日)→ 賭けなかったことにする
            out[b][1][i] = 100 * len(combos)
            out[b][0][i] = sum(src.get(c, 0) for c in combos)
    return out


def eval_bet(ret, stake, D=None):
    m = stake > 0
    if m.sum() == 0:
        return {"races": 0}
    r = roi_ci(ret[m], stake[m])
    hit = ret[m] > 0
    k = int(hit.sum())
    lo, hi = M.wilson(k, int(m.sum()))
    pts = float(stake[m].mean() / 100)
    r.update({"hits": k, "hit_lo": r4(lo), "hit_hi": r4(hi), "points": round(pts, 2),
              "avg_pay_when_hit": int(ret[m][hit].mean()) if k else 0,
              "median_pay_when_hit": int(np.median(ret[m][hit])) if k else 0,
              # 損益分岐: 当たったときの平均払戻がこれ以上なら回収率100%(この的中率のまま)
              "breakeven_avg_pay": int(100 * pts / max(hit.mean(), 1e-9)) if k else None,
              "manshu_hits": int((ret[m] >= 10000).sum())})
    if D is not None:
        r["per_day"] = round(float(m.sum() / max(len(np.unique(D)), 1)), 2)
    return r


def tri_entropy(T):
    return -(T * np.log(np.clip(T, 1e-12, 1))).sum(1)


def per_day_top(score, D, n):
    sel = np.zeros(len(score), bool)
    for d in np.unique(D):
        idx = np.where(D == d)[0]
        sel[idx[np.argsort(-score[idx])[:n]]] = True
    return sel


def main(hist: Path, weeks: int = 52):
    t0 = time.time()
    cfg = load_config()
    pcfg = pre_config(cfg)
    days = load_days(hist, max_days=1095)
    data, _ = build(days, load_fan(hist), tides=Tides(hist / "jma"))
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

    def P_of(name, feats, vx, ens):
        Us = [R.run(f"{name}_{i}", feats, vx, t or td, l2_) for i, (t, l2_) in enumerate(ens or [[td, 30.0]])]
        return probs(sum(Us) / len(Us))

    def cond_T(P1, cols, tag):
        ci = [ALLF.index(f) for f in cols]
        Xc = data["X"][:, :, ci].astype(np.float64)
        T = np.zeros((len(P1), 120))
        w2 = w3 = None
        for b0 in range(0, weeks, 4):
            s = starts[b0]
            tr = (D < s) & (D >= s - 365)
            mu = Xc[tr].reshape(-1, len(ci)).mean(0); sd = Xc[tr].reshape(-1, len(ci)).std(0) + 1e-9
            m2 = Cond(2).fit((Xc[tr] - mu) / sd, data["V"][tr], data["y"][tr], None, data["y2"][tr], w0=w2); w2 = m2.w
            m3 = Cond(3).fit((Xc[tr] - mu) / sd, data["V"][tr], data["y"][tr], data["y2"][tr], data["y3"][tr], w0=w3); w3 = m3.w
            msk = (fold >= b0) & (fold < b0 + 4)
            T[msk] = tri_cond(P1[msk], (Xc[c.idx[msk]] - mu) / sd, c.V[msk], m2, m3)[0]
        print(f"  cond[{tag}] {time.time()-t0:.0f}s", flush=True)
        return T

    P_m = P_of("morn", cfg["feats"], cfg.get("vx") or [], cfg.get("ensemble"))
    T_m = cond_T(P_m, CAND, "morn")
    if pcfg:
        P_p = P_of("pre", pcfg["feats"], pcfg["vx"], pcfg.get("ensemble"))
        T_p = cond_T(P_p, pcfg.get("cond_feats") or CAND, "pre")
    else:
        P_p, T_p = P_m, T_m
    Xo = data["X"][c.idx]
    cov = race_cov(Xo, c.V)
    y = c.y
    lane1_lost = (y != 0)
    man = c.pay_tri >= 10000
    w34 = (y == 2) | (y == 3)
    pays = []
    for r in c.res:
        pd = r.get("pay") or {}
        pays.append({"tansho": pd.get("tansho") or r.get("tansho") or {}, "exacta": pd.get("exacta") or r.get("exacta") or {},
                     "trifecta": pd.get("trifecta") or r.get("trifecta") or {}, "trio": pd.get("trio")})
    rep = {"generated_at": datetime.now(JST).isoformat(timespec="minutes"),
           "history": [days[0][0].isoformat(), days[-1][0].isoformat()],
           "select_window": [date.fromordinal(starts[0]).isoformat(), date.fromordinal(starts[half] - 1).isoformat(), int(SEL.sum())],
           "confirm_window": [date.fromordinal(starts[half]).isoformat(), date.fromordinal(starts[-1] + 6).isoformat(), int(CONF.sum())],
           "pre_model": bool(pcfg),
           "notes": ["直前の数字(展示タイム・風・波・進入)は競走成績ファイルの同じ値。進入は実際の進入で代用(上限寄り)。",
                     "スタート展示のSTは過去分が無いので検証していない。",
                     "3連複は払戻の記録がある日(直近約182日)だけ。"]}
    base = {}
    for ph, m in (("select", SEL), ("confirm", CONF)):
        base[ph] = {"races": int(m.sum()), "lane1_win": r4((~lane1_lost[m]).mean()), "manshu_rate": r4(man[m].mean()),
                    "lane34_win": r4(w34[m].mean()), "mean_pay_tri": int(c.pay_tri[m].mean()),
                    "trio_paid_races": int(sum(1 for i in np.where(m)[0] if pays[i]["trio"]))}
    rep["base"] = base
    print("base", base, flush=True)

    # ---- (1) 条件ごとの診断
    diag = {}
    for name, groups in bins_of(cov).items():
        diag[name] = {}
        for g, mk in groups.items():
            diag[name][g] = {}
            for ph, m in (("select", SEL), ("confirm", CONF)):
                mm = mk & m
                k = int(mm.sum())
                if k < 50:
                    diag[name][g][ph] = {"races": k}
                    continue
                act = (y[mm] == 0).astype(float)
                diag[name][g][ph] = {
                    "races": k, "lane1_win": r4(act.mean()), "model_morning": r4(P_m[mm, 0].mean()),
                    "model_pre": r4(P_p[mm, 0].mean()),
                    "gap_morning": boot_mean(act - P_m[mm, 0]),   # 実際 − 朝のモデル(マイナス=モデルが1号艇を高く見すぎ)
                    "gap_pre": boot_mean(act - P_p[mm, 0]),
                    "manshu_rate": r4(man[mm].mean()), "lane34_win": r4(w34[mm].mean())}
    rep["diagnostics"] = diag
    # 場ごと(確かめる期間)
    from engine import VENUES
    rep["venue_confirm"] = {}
    for v in range(24):
        mm = (c.V == v) & CONF
        if mm.sum() >= 100:
            act = (y[mm] == 0).astype(float)
            rep["venue_confirm"][VENUES[f"{v+1:02d}"]] = {"races": int(mm.sum()), "lane1_win": r4(act.mean()),
                                                         "gap_morning": boot_mean(act - P_m[mm, 0])["mean"],
                                                         "manshu_rate": r4(man[mm].mean())}

    # ---- (2) 「荒れ」の点数
    def zfeat(names, P, T):
        cols = [cov[n] for n in names]
        lp = np.log(np.clip(P[:, 0], 1e-4, 1 - 1e-4) / np.clip(1 - P[:, 0], 1e-4, 1))
        ent = -(P * np.log(np.clip(P, 1e-9, 1))).sum(1)
        ent_t = -(T * np.log(np.clip(T, 1e-12, 1))).sum(1)
        cols += [lp, ent, ent_t, np.sort(T, 1)[:, -10:].sum(1)]
        vo = np.eye(24)[c.V]
        Z = np.column_stack(cols + [vo])
        mu, sd = Z[SEL].mean(0), Z[SEL].std(0) + 1e-9
        return (Z - mu) / sd, mu, sd

    scores = {"朝: 1−1号艇の1着の確率": 1 - P_m[:, 0], "直前: 1−1号艇の1着の確率": 1 - P_p[:, 0],
              # 混戦度: 3連単の確率の散らばり(エントロピー)。万舟の回帰でいちばん効いた項だけを取り出した、学習の要らない点数
              "朝: 混戦度(3連単の確率の散らばり)": tri_entropy(T_m), "直前: 混戦度(3連単の確率の散らばり)": tri_entropy(T_p)}
    clf = {}
    for tag, names, P, T in (("朝", MORNING_COV, P_m, T_m), ("直前", PRE_COV, P_p, T_p)):
        Z, zmu, zsd = zfeat(names, P, T)
        # 万舟になるか
        w = logit_fit(Z[SEL], man[SEL].astype(float), l2=10.0)
        pm = logit_pred(w, Z)
        scores[f"{tag}: 万舟の回帰"] = pm
        # 1号艇が負けるか(モデルの確率に条件を足して、モデルより良くなるか)
        w1 = logit_fit(Z[SEL], lane1_lost[SEL].astype(float), l2=10.0)
        pl = logit_pred(w1, Z)
        ll_new = ll_bin(pl[CONF], lane1_lost[CONF])
        ll_mod = ll_bin(1 - P[CONF, 0], lane1_lost[CONF])
        names_all = names + ["logit_p1", "entropy_p", "entropy_tri", "tri_top10_sum"] + [f"venue{v+1:02d}" for v in range(24)]
        clf[tag] = {"manshu_coef_top": sorted([[n_, r4(x)] for n_, x in zip(names_all, w[1:])], key=lambda t: -abs(t[1]))[:12],
                    "manshu_ll_confirm": r4(ll_bin(pm[CONF], man[CONF]).mean()),
                    "manshu_ll_const": r4(ll_bin(np.full(CONF.sum(), man[SEL].mean()), man[CONF]).mean()),
                    "lane1_lost_ll_model": r4(ll_mod.mean()), "lane1_lost_ll_with_conditions": r4(ll_new.mean()),
                    "lane1_lost_ll_diff": boot_mean(ll_new - ll_mod),
                    "lane1_coef_top": sorted([[n_, r4(x)] for n_, x in zip(names_all, w1[1:])], key=lambda t: -abs(t[1]))[:12]}
        if tag == "朝":
            clf_m = {"w": w.tolist(), "names": names_all, "mu": zmu.tolist(), "sd": zsd.tolist()}
    rep["classifiers"] = clf
    # 今までの穴の決め方(exp_ana): 万舟らしさ = 平均払戻1万円以上の組番の確率の合計
    old = np.zeros(len(y))
    for m, s0 in ((SEL, starts[0]), (CONF, starts[half])):
        bf = D < s0
        avg, _ = EA.tri_pattern_avg(data["y"][bf], data["y2"][bf], data["y3"][bf], data["pay_tri"][bf])
        old[m] = (T_m[m] * (avg[None, :] >= 10000)).sum(1)
    scores["今までの穴(exp_ana)の万舟らしさ"] = old
    rng = np.random.default_rng(1)
    scores["くじ引き(比較用)"] = rng.random(len(y))
    rep["score_quality"] = {}
    for nm, s in scores.items():
        q = {}
        for ph, m in (("select", SEL), ("confirm", CONF)):
            q[ph] = {"auc_manshu": auc(s[m], man[m]), "auc_lane1_lost": auc(s[m], lane1_lost[m])}
            for n in (3, 5, 10):
                sel = per_day_top(s[m], c.D[m], n)
                q[ph][f"top{n}_per_day"] = {"races": int(sel.sum()), "manshu_rate": r4(man[m][sel].mean()),
                                            "lane1_win": r4((y[m][sel] == 0).mean()), "lane34_win": r4(w34[m][sel].mean())}
        rep["score_quality"][nm] = q
    print("scores done", time.time() - t0, flush=True)

    # ---- (3) 買い方
    tab_m = bet_table(P_m, T_m, pays)
    tab_p = bet_table(P_p, T_p, pays) if pcfg else tab_m
    rep["all_races_confirm"] = {BET_JP[b]: eval_bet(tab_m[b][0][CONF], tab_m[b][1][CONF], c.D[CONF]) for b in BETS}
    grid = []
    for nm, s in scores.items():
        if nm.startswith("くじ"):
            continue
        tab = tab_p if nm.startswith("直前") else tab_m
        for n in (2, 3, 5, 10):
            sel_all = np.zeros(len(y), bool)
            for m in (SEL, CONF):
                sel_all[np.where(m)[0][per_day_top(s[m], c.D[m], n)]] = True
            for b in BETS:
                rs = {}
                for ph, m in (("select", SEL), ("confirm", CONF)):
                    mm = sel_all & m
                    rs[ph] = eval_bet(tab[b][0][mm], tab[b][1][mm], c.D[mm])
                grid.append({"score": nm, "n_per_day": n, "bet": BET_JP[b], "bet_id": b, **rs})
    rep["grid_tested"] = len(grid)
    chosen = {}
    for kind in ("朝", "直前"):
        cand = [g for g in grid if g["score"].startswith(kind) and g["bet_id"] not in CONF_ONLY
                and g["select"].get("races", 0) >= 300]
        cand.sort(key=lambda g: -g["select"]["roi"])
        chosen[kind] = cand[:3]
    rep["chosen_on_select"] = chosen
    rep["confirm_best_after_the_fact"] = sorted([g for g in grid if g["confirm"].get("races", 0) >= 300],
                                                key=lambda g: -g["confirm"]["roi"])[:10]
    rep["confirm_lo_above_100"] = [g for g in grid if (g["confirm"].get("lo") or 0) > 1.0]
    rep["grid"] = grid
    # 決まった条件(ライバル型など)
    rr = {}
    for nm, (is_pre, fn) in RULES.items():
        mk = fn(cov)
        tab = tab_p if is_pre else tab_m
        P = P_p if is_pre else P_m
        rr[nm] = {}
        for ph, m in (("select", SEL), ("confirm", CONF)):
            mm = mk & m
            k = int(mm.sum())
            if k < 50:
                rr[nm][ph] = {"races": k}
                continue
            act = (y[mm] == 0).astype(float)
            rr[nm][ph] = {"races": k, "per_day": round(k / max(len(np.unique(c.D[mm])), 1), 2),
                          "lane1_win": r4(act.mean()), "model_p1": r4(P[mm, 0].mean()), "gap": boot_mean(act - P[mm, 0]),
                          "manshu_rate": r4(man[mm].mean()), "lane34_win": r4(w34[mm].mean()),
                          "bets": {BET_JP[b]: eval_bet(tab[b][0][mm], tab[b][1][mm]) for b in BETS
                                   if not (ph == "select" and b in CONF_ONLY)}}
    rep["rules"] = rr
    rep["morning_manshu_classifier"] = clf_m
    rep["runtime_min"] = round((time.time() - t0) / 60, 1)
    ed = ROOT / "experiments"
    ed.mkdir(exist_ok=True)
    (ed / "are_v1.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1, default=_js), encoding="utf-8")
    print("are done", rep["runtime_min"], "min", json.dumps({k: rep[k] for k in ("base", "chosen_on_select")}, ensure_ascii=False,
                                                             default=_js)[:3000], flush=True)


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "hist", int(sys.argv[2]) if len(sys.argv) > 2 else 52)


# ------------------------------------------------------------------ 追加(2026-10-29): 2号艇のF持ち(1号艇の隣)
def main_fadj(hist: Path, weeks: int = 52):
    """「2号艇(1号艇の隣)にF持ちがいると1号艇が逃げにくい」を、朝のモデルの見積もりと比べる(exp_are と同じ52週の学習外)。
    → experiments/are_fadj.json。判定: 選ぶ期間・確かめる期間の両方で「実際 − 朝のモデル」の95%区間の上端が0未満なら
    「モデルが見落としている」(missed=true)。are.py はこの判定で理由の言い方を変える。"""
    t0 = time.time()
    cfg = load_config()
    days = load_days(hist, max_days=1095)
    data, _ = build(days, load_fan(hist), tides=Tides(hist / "jma"))
    by_key = {k: v for _, _, res in days for k, v in res.items()}
    D = data["D"]
    last = int(np.unique(D)[-1])
    starts = [last - 7 * k + 1 for k in range(weeks, 0, -1)]
    half = weeks // 2
    R = Runner(data, starts)
    c = Ctx(data, R.te_idx, by_key)
    fold = np.concatenate([np.full(((D >= s) & (D < s + 7)).sum(), i) for i, s in enumerate(starts)])
    SEL, CONF = fold < half, fold >= half
    td = cfg.get("train_days") or 365
    ens = cfg.get("ensemble") or [[td, 30.0]]
    Us = [R.run(f"morn_{i}", cfg["feats"], cfg.get("vx") or [], t or td, l2_) for i, (t, l2_) in enumerate(ens)]
    P = probs(sum(Us) / len(Us))
    print(f"fadj: model {time.time()-t0:.0f}s", flush=True)
    Xo = data["X"][c.idx]
    F = lambda L: Xo[:, L, FI["s_Fper"]].astype(float)  # noqa: E731
    f1, f2, f3 = F(0), F(1), F(2)
    y = c.y
    man = c.pay_tri >= 10000
    groups = {
        "2号艇に今期のF": {"あり": f2 > 0, "なし": f2 == 0},
        "2号艇にFあり・1号艇はFなし": {"該当": (f2 > 0) & (f1 == 0)},
        "2号艇のF2本以上": {"該当": f2 >= 2},
        "参考: 3号艇に今期のF": {"あり": f3 > 0, "なし": f3 == 0},
        "参考: 1号艇に今期のF": {"あり": f1 > 0, "なし": f1 == 0},
    }
    out = {}
    for name, gs in groups.items():
        out[name] = {}
        for g, mk in gs.items():
            out[name][g] = {}
            for ph, m in (("select", SEL), ("confirm", CONF)):
                mm = mk & m
                k = int(mm.sum())
                if k < 50:
                    out[name][g][ph] = {"races": k}
                    continue
                act = (y[mm] == 0).astype(float)
                out[name][g][ph] = {"races": k, "lane1_win": r4(act.mean()), "model_morning": r4(P[mm, 0].mean()),
                                    "gap_morning": boot_mean(act - P[mm, 0]), "lane2_win": r4((y[mm] == 1).mean()),
                                    "manshu_rate": r4(man[mm].mean())}
    g = out["2号艇に今期のF"]["あり"]
    missed = all(isinstance(g[ph].get("gap_morning"), dict) and g[ph]["gap_morning"]["hi"] < 0 for ph in ("select", "confirm"))
    rep = {"generated_at": datetime.now(JST).isoformat(timespec="minutes"),
           "select_window": [date.fromordinal(starts[0]).isoformat(), date.fromordinal(starts[half] - 1).isoformat(), int(SEL.sum())],
           "confirm_window": [date.fromordinal(starts[half]).isoformat(), date.fromordinal(starts[-1] + 6).isoformat(), int(CONF.sum())],
           "feature": "s_Fper(今期のフライング数。レーサー期別成績と前日までの競走成績から)",
           "diagnostics": out, "missed": bool(missed),
           "gap_confirm": (g.get("confirm") or {}).get("gap_morning"),
           "rule": "両方の期間で 実際の1号艇の1着率 − 朝のモデル の95%区間の上端が0未満なら missed=true",
           "runtime_min": round((time.time() - t0) / 60, 1)}
    (ROOT / "experiments").mkdir(exist_ok=True)
    (ROOT / "experiments" / "are_fadj.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1, default=_js), encoding="utf-8")
    print("fadj", json.dumps({"missed": missed, "gap_confirm": rep["gap_confirm"]}, ensure_ascii=False, default=_js), flush=True)
