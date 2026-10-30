"""2着・3着の検証(2026-10-30 オーナー指示): 1号艇が強いレースで「1号艇を頭にして2着・3着を当てる」確率を上げられるか、
券種ごとの的中率・平均の倍率・回収率、荒れるレースの確率の作り直し。賭け方の助言ではなく検証の記録。

python kyotei/exp_place.py [hist_dir] [weeks=52]

方法(未来の情報を混ぜない。exp_v4 / exp_are と同じ):
- 直近 weeks 週を1週ずつウォークフォワード(1着の確率はその週より前の365日だけで学習)。2着・3着の条件付きモデルは
  13週ごとに、その時点より前の365日だけで学習し直す(本番は毎週なので、ここでの数字は控えめ寄り)。
- 前半 = 選ぶ期間、後半 = 確かめる期間。2着・3着の候補は選ぶ期間で1つずつ足し、
  「2着と3着の対数損失の合計の差」の95%区間(レース単位のブートストラップ)の上端が0未満のときだけ残す。確かめる期間は評価だけ。
- 直前の数字(展示タイム・直前の風と波・進入)は競走成績ファイルの同じ値。進入は実際の進入で代用(上限寄り)。
  スタート展示のST・周回展示・まわり足は過去分が無いので検証できない。
- 風の向き: 競走成績の風向(16方位)を場ごとの軸に直す。軸は「まくり・まくり差しの決まり手が増える向き」(=向かい風に当たる向き)を
  その時点より前の365日の決まり手から場ごとに推定し、+側を向かい風、−側を追い風とみなす(場の向きの表を使わず、データで決める)。
- 買い方: 予想の時点で決まる買い目だけ(確定払戻で計算)。2連複・3連複は払戻の記録がある日だけ。
- オッズは確定払戻(=当たった組番の確定オッズ)しか履歴に無いので、外れた組番のオッズが要る「期待値で選ぶ」は履歴では計算できない。
出力: experiments/place_v1.json(集計の数字だけ)。毎朝の設定(model_config.json)は書き換えない(採否は人が見て決める)。
"""
from __future__ import annotations

import json
import math
import sys
import time
import traceback
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
from scipy.optimize import minimize

sys.path.insert(0, str(Path(__file__).resolve().parent))
import exp_bets as EB  # noqa: E402
from place import head1, race_combos  # noqa: E402
import model2 as M  # noqa: E402
from exp_cond import CAND, Cond, tri_cond  # noqa: E402
from exp_v3 import Runner, probs  # noqa: E402
from exp_v4 import Ctx, _js, roi_ci  # noqa: E402
from features import ALLF, build  # noqa: E402
from jma import Tides, wind_uv  # noqa: E402
from train import load_config, load_days, load_fan, pre_config  # noqa: E402

ROOT = Path(__file__).resolve().parent
JST = timezone(timedelta(hours=9))
PERMS = EB.PERMS
LT, LE, LQ, LR = EB.LBL["trifecta"], EB.LBL["exacta"], EB.LBL["quinella"], EB.LBL["trio"]
H1 = np.where(PERMS[:, 0] == 0)[0]          # 1号艇が頭の20通り
BLOCK = 13


def r4(x):
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else round(float(x), 4)


def boot_mean(d, B=1000, seed=0):
    d = np.asarray(d, float)
    n = len(d)
    if n == 0:
        return {"diff": None, "lo": None, "hi": None, "n": 0}
    rng = np.random.default_rng(seed)
    bs = d[rng.integers(0, n, (B, n))].mean(1)
    return {"diff": round(float(d.mean()), 5), "lo": round(float(np.percentile(bs, 2.5)), 5),
            "hi": round(float(np.percentile(bs, 97.5)), 5), "n": int(n)}


def wil(k, n):
    lo, hi = M.wilson(int(k), int(n))
    return [r4(lo), r4(hi)]


def per_day_top(score, D, n):
    sel = np.zeros(len(score), bool)
    for d in np.unique(D):
        idx = np.where(D == d)[0]
        sel[idx[np.argsort(-score[idx])[:n]]] = True
    return sel


def place_metrics(T, y, y2, y3, m):
    """1号艇が1着だったレースの中で、2着・3着をどれだけ当てたか(予想は締切前の確率だけで決まる)。"""
    won = m & (y == 0)
    n_all, n = int(m.sum()), int(won.sum())
    if n < 30:
        return {"races": n_all, "lane1_won": n}
    Q, q = head1(T[won])
    r = np.arange(n)
    a2, a3 = y2[won], y3[won]
    o2 = np.argsort(-q, 1)
    Qf = Q.reshape(n, 36)
    oq = np.argsort(-Qf, 1)
    act = a2 * 6 + a3
    U = Q + Q.transpose(0, 2, 1)
    Uf = np.triu(U, 1).reshape(n, 36)
    ou = np.argsort(-Uf, 1)
    act_u = np.minimum(a2, a3) * 6 + np.maximum(a2, a3)
    out = {"races": n_all, "lane1_won": n, "lane1_win_rate": r4(n / n_all),
           "ll_2nd": r4(-np.log(np.clip(q[r, a2], 1e-9, 1)).mean()),
           "ll_2nd3rd": r4(-np.log(np.clip(Qf[r, act], 1e-12, 1)).mean())}
    for k in (1, 2, 3):
        h = (o2[:, :k] == a2[:, None]).any(1)
        out[f"2nd_top{k}"] = r4(h.mean()); out[f"2nd_top{k}_ci"] = wil(h.sum(), n)
    for k in (1, 2, 3, 4, 6):
        h = (oq[:, :k] == act[:, None]).any(1)
        out[f"pair_ordered_top{k}"] = r4(h.mean()); out[f"pair_ordered_top{k}_ci"] = wil(h.sum(), n)
    for k in (1, 2, 3):
        h = (ou[:, :k] == act_u[:, None]).any(1)
        out[f"pair_set_top{k}"] = r4(h.mean()); out[f"pair_set_top{k}_ci"] = wil(h.sum(), n)
    # 当たり具合: 2着の確率(1号艇が勝ったとき)と、(2着,3着)の組の確率
    cal2, calq = [], []
    Y2 = np.zeros((n, 6)); Y2[r, a2] = 1
    msk = np.ones((n, 6), bool); msk[:, 0] = False
    for lo, hi in ((0, .1), (.1, .2), (.2, .3), (.3, .4), (.4, .5), (.5, .6), (.6, 1.01)):
        mm = msk & (q >= lo) & (q < hi)
        if mm.sum() >= 30:
            cal2.append([f"{lo*100:.0f}-{hi*100:.0f}%", int(mm.sum()), r4(q[mm].mean()), r4(Y2[mm].mean())])
    YQ = np.zeros((n, 36)); YQ[r, act] = 1
    for lo, hi in ((0, .02), (.02, .05), (.05, .1), (.1, .15), (.15, .2), (.2, .3), (.3, 1.01)):
        mm = (Qf >= lo) & (Qf < hi) & (Qf > 0)
        if mm.sum() >= 30:
            calq.append([f"{lo*100:.0f}-{hi*100:.0f}%", int(mm.sum()), r4(Qf[mm].mean()), r4(YQ[mm].mean())])
    out["calib_2nd"] = cal2
    out["calib_pair"] = calq
    # 2着の枠ごと: 予想の平均と実際
    out["2nd_by_lane"] = {f"{L+1}": [r4(q[:, L].mean()), r4((a2 == L).mean())] for L in range(1, 6)}
    out["3rd_by_lane"] = {f"{L+1}": [r4(Q[:, :, L].sum(1).mean()), r4((a3 == L).mean())] for L in range(1, 6)}
    return out


# ---------------------------------------------------------------- 買い方
CONF_BETS = {   # 名前: (券種, 説明)
    "tan_1": ("tansho", "単勝 1号艇"),
    "ex_1a": ("exacta", "2連単 1-a(2着の1番手)"),
    "ex_1ab": ("exacta", "2連単 1-a・1-b(2点)"),
    "qn_1a": ("quinella", "2連複 1=a"),
    "qn_1ab": ("quinella", "2連複 1=a・1=b(2点)"),
    "tri_1": ("trifecta", "3連単 1頭の1番手(1点)"),
    "tri_swap": ("trifecta", "3連単 1-a-b・1-b-a(2・3着の組を表裏、2点)"),
    "tri_1a_bc": ("trifecta", "3連単 1-a-b・1-a-c(2着固定、2点)"),
    "tri_top2": ("trifecta", "3連単 1頭の上位2点"),
    "tri_top3": ("trifecta", "3連単 1頭の上位3点"),
    "tri_form4": ("trifecta", "3連単 1-ab-abc(4点)"),
    "tri_top4": ("trifecta", "3連単 1頭の上位4点"),
    "tri_box3": ("trifecta", "3連単 1-abc-abc(6点)"),
    "tri_top6": ("trifecta", "3連単 1頭の上位6点"),
    "trio_1": ("trio", "3連複 1を含む1番手(1点)"),
    "trio_2": ("trio", "3連複 1を含む上位2点"),
    "trio_3": ("trio", "3連複 1を含む上位3点"),
    "prod_tan": ("tansho", "(今の毎日の買い目)単勝◎"),
    "prod_ex1": ("exacta", "(今の毎日の買い目)2連単1点"),
    "prod_ex3": ("exacta", "(今の毎日の買い目)2連単3点"),
    "prod_qn1": ("quinella", "(参考)2連複1点"),
    "prod_tri3": ("trifecta", "(今の毎日の買い目)3連単3点"),
    "prod_trio3": ("trio", "(今の毎日の買い目)3連複3点"),
}
ARE_BETS = {
    "tan_non1": ("tansho", "単勝 1号艇以外の1番手"),
    "tan_non1_2": ("tansho", "単勝 1号艇以外の上位2艇"),
    "ex_non1_3": ("exacta", "2連単 1号艇以外が頭の上位3点"),
    "ex_top5": ("exacta", "2連単 上位5点(1号艇頭も含む)"),
    "qn_top3": ("quinella", "2連複 上位3点"),
    "tri_non1_5": ("trifecta", "3連単 1号艇以外が頭の上位5点"),
    "tri_non1_10": ("trifecta", "3連単 1号艇以外が頭の上位10点"),
    "tri_top10": ("trifecta", "3連単 上位10点(1号艇頭も含む)"),
    "tri_34_6": ("trifecta", "(今の荒れ予報の案)3連単 3・4号艇頭6点"),
    "trio_no1_3": ("trio", "3連複 1号艇を含まない上位3点"),
    "trio_top5": ("trio", "3連複 上位5点"),
}


def bet_returns(names, table, P1, T, pays, idx):
    """→ {名前: (払戻(n,), 賭け金(n,))}。払戻の記録が無い券種のレースは賭け金0(数えない)。"""
    out = {nm: (np.zeros(len(idx)), np.zeros(len(idx))) for nm in names}
    for t, i in enumerate(idx):
        pd = pays[i]
        cc = race_combos(names, P1[i], T[i])
        for nm in names:
            kind = table[nm][0]
            src = pd.get(kind)
            if not src:
                continue
            cs = cc[nm]
            out[nm][1][t] = 100 * len(cs)
            out[nm][0][t] = sum(src.get(x, 0) for x in cs)
    return out


def bet_stats(ret, stake, D=None):
    m = stake > 0
    n = int(m.sum())
    if n == 0:
        return {"races": 0}
    r = roi_ci(ret[m], stake[m])
    hit = ret[m] > 0
    k = int(hit.sum())
    pts = float(stake[m].mean() / 100)
    # 平均の倍率 = 当たった組番の払戻(100円あたり)÷100。2点以上で同時に2つ当たることは無い(同じ券種の別の組番)ので1つ
    od = ret[m][hit] / 100
    r.update({"hits": k, "hit_rate": r4(k / n), "hit_ci": wil(k, n), "points": round(pts, 2),
              "stake": int(stake[m].sum()), "return": int(ret[m].sum()),
              "avg_odds": round(float(od.mean()), 2) if k else None, "median_odds": round(float(np.median(od)), 2) if k else None,
              "breakeven_odds": round(pts / max(k / n, 1e-9), 2) if k else None})
    if D is not None:
        r["per_day"] = round(n / max(len(np.unique(D[m])), 1), 2)
    return r


# ---------------------------------------------------------------- 風の軸(場ごと)
def wind_axes(V, u, v, mk, m):
    """場ごとに、まくり・まくり差しが増える風の向き(単位ベクトル)。m の中だけで推定。"""
    ax = np.zeros((24, 2))
    for k in range(24):
        s = m & (V == k) & ((u != 0) | (v != 0))
        if s.sum() < 200:
            continue
        A = np.c_[np.ones(s.sum()), u[s], v[s]]
        b = np.linalg.lstsq(A, mk[s].astype(float), rcond=None)[0]
        nv = math.hypot(b[1], b[2])
        if nv > 0:
            ax[k] = b[1:] / nv
    return ax


# ---------------------------------------------------------------- 荒れの作り直し(確率の補正)
def decompose(T):
    P1 = np.zeros((len(T), 6))
    for k, (a, _, _) in enumerate(PERMS):
        P1[:, a] += T[:, k]
    return P1


def recal_apply(T, th):
    """T を「1着の確率の鋭さ a と枠ごとの寄せ β、2・3着の鋭さ g」で作り直す。th = [a, g, β2..β6]"""
    a, g = th[0], th[1]
    beta = np.r_[0.0, th[2:]]
    P1 = np.clip(decompose(T), 1e-9, 1)
    w1 = np.exp(a * np.log(P1) + beta)
    w1 /= w1.sum(1, keepdims=True)
    cond = np.clip(T / P1[:, PERMS[:, 0]], 1e-12, 1)
    # 2・3着の部分を g 乗して、1着ごとに正規化
    C = cond ** g
    S = np.zeros_like(P1)
    for k, (h, _, _) in enumerate(PERMS):
        S[:, h] += C[:, k]
    C = C / S[:, PERMS[:, 0]]
    T2 = w1[:, PERMS[:, 0]] * C
    return T2 / T2.sum(1, keepdims=True)


def recal_fit(T, ai):
    r = np.arange(len(T))

    def f(th):
        return -np.log(np.clip(recal_apply(T, th)[r, ai], 1e-12, 1)).mean() + 1e-3 * (th[2:] ** 2).sum()
    th0 = np.r_[1.0, 1.0, np.zeros(5)]
    res = minimize(f, th0, method="Powell", options={"maxiter": 3000, "xtol": 1e-3, "ftol": 1e-6})
    return res.x


def main(hist: Path, weeks: int = 52):
    t0 = time.time()
    cfg = load_config()
    pcfg = pre_config(cfg)
    tierS = (cfg.get("tiers") or M.TIERS)[0][1]
    days = load_days(hist, max_days=1095)
    data, _ = build(days, load_fan(hist), tides=Tides(hist / "jma"))
    by_key = {k: v for _, _, res in days for k, v in res.items()}
    D, V = data["D"], data["V"]
    print(f"built {len(D)} races {days[0][0]}..{days[-1][0]} in {time.time()-t0:.0f}s", flush=True)
    last = int(np.unique(D)[-1])
    starts = [last - 7 * k + 1 for k in range(weeks, 0, -1)]
    half = weeks // 2
    R = Runner(data, starts)
    c = Ctx(data, R.te_idx, by_key)
    fold = np.concatenate([np.full(((D >= s) & (D < s + 7)).sum(), i) for i, s in enumerate(starts)])
    SEL, CONF = fold < half, fold >= half
    n_oos = len(c.y)
    rr = np.arange(n_oos)
    td = cfg.get("train_days") or 365
    out_path = ROOT / "experiments" / "place_v1.json"
    out_path.parent.mkdir(exist_ok=True)
    rep = {"generated_at": datetime.now(JST).isoformat(timespec="minutes"), "history": [days[0][0].isoformat(), days[-1][0].isoformat()],
           "select_window": [date.fromordinal(starts[0]).isoformat(), date.fromordinal(starts[half] - 1).isoformat(), int(SEL.sum())],
           "confirm_window": [date.fromordinal(starts[half]).isoformat(), date.fromordinal(starts[-1] + 6).isoformat(), int(CONF.sum())],
           "tier_S": tierS, "block_weeks": BLOCK, "errors": []}

    def save():
        rep["runtime_min"] = round((time.time() - t0) / 60, 1)
        out_path.write_text(json.dumps(rep, ensure_ascii=False, indent=1, default=_js), encoding="utf-8")

    # 払戻(全券種)。キーは組番のラベル
    pays = []
    for r in c.res:
        pd = r.get("pay") or {}
        pays.append({"tansho": pd.get("tansho") or r.get("tansho") or {}, "exacta": pd.get("exacta") or r.get("exacta") or {},
                     "trifecta": pd.get("trifecta") or r.get("trifecta") or {}, "quinella": pd.get("quinella"), "trio": pd.get("trio")})
    rep["paid_races"] = {"trio_select": int(sum(1 for i in np.where(SEL)[0] if pays[i]["trio"])),
                         "trio_confirm": int(sum(1 for i in np.where(CONF)[0] if pays[i]["trio"]))}

    # 風(向き)と決まり手(全レース、学習用にも)
    res_all = [by_key.get(k) or {} for k in data["K"]]
    wnd = np.array([float((r.get("wx") or {}).get("wind", 0) or 0) for r in res_all])
    uv = np.array([wind_uv((r.get("wx") or {}).get("wind", 0), (r.get("wx") or {}).get("wind_dir", "")) for r in res_all])
    u_all, v_all = uv[:, 0], uv[:, 1]
    mk_all = np.array(["まくり" in (r.get("kimarite") or "") for r in res_all])
    has_wx = np.array([bool(r.get("wx")) for r in res_all])

    def P_of(name, feats, vx, ens):
        Us = [R.run(f"{name}_{i}", feats, vx, t or td, l2_) for i, (t, l2_) in enumerate(ens or [[td, 30.0]])]
        return probs(sum(Us) / len(Us))

    P_m = P_of("morn", cfg["feats"], cfg.get("vx") or [], cfg.get("ensemble"))
    P_p = P_of("pre", pcfg["feats"], pcfg["vx"], pcfg.get("ensemble")) if pcfg else P_m
    print(f"P1 done {time.time()-t0:.0f}s", flush=True)

    # 風の軸(13週ごと、その時点より前の365日の決まり手だけで推定)。+: 向かい風相当、−: 追い風相当(m)
    axes = {}
    tail = np.zeros(len(D))   # 確かめる・選ぶ期間のレースの値(そのブロックの軸で)
    for b0 in range(0, weeks, BLOCK):
        s = starts[b0]
        tr = (D < s) & (D >= s - 365) & has_wx
        axes[b0] = wind_axes(V, u_all, v_all, mk_all, tr)
        gi = c.idx[(fold >= b0) & (fold < b0 + BLOCK)]
        tail[gi] = u_all[gi] * axes[b0][V[gi], 0] + v_all[gi] * axes[b0][V[gi], 1]
    rep["wind_axes"] = {date.fromordinal(starts[b0]).isoformat(): ax.round(3).tolist() for b0, ax in axes.items()}

    # ---------------------------------------------------------------- 2着・3着の条件付きモデル(候補ごと)
    cache = {}

    def cond_run(tag, cols, opt=None, rnames=(), use_tail=False, P1=None, need_T=False):
        """cols: 候補の数字。opt: {"nige": [...], "lane": [...]}。rnames: レース単位の数字(X の1号艇の列)。use_tail: 風の軸の成分も。
        → {"ll2": (n,), "ll3": (n,), "T": (n,120) or None}"""
        key = (tag, need_T)
        if key in cache:
            return cache[key]
        opt = opt or {}
        ci = [ALLF.index(f) for f in cols]
        nige = [cols.index(f) for f in opt.get("nige", []) if f in cols]
        lane = [cols.index(f) for f in opt.get("lane", []) if f in cols]
        rci = [ALLF.index(f) for f in rnames]
        nr = len(rci) + (1 if use_tail else 0)
        Xc = data["X"][:, :, ci].astype(np.float64)

        def Rof(gi, b0):
            if not nr:
                return None
            parts = [data["X"][gi][:, 0, rci].astype(np.float64)] if rci else []
            if use_tail:
                ax = axes[b0]
                parts.append((u_all[gi] * ax[V[gi], 0] + v_all[gi] * ax[V[gi], 1])[:, None])
            return np.concatenate(parts, 1)
        ll2 = np.zeros(n_oos); ll3 = np.zeros(n_oos)
        T = np.zeros((n_oos, 120)) if need_T else None
        w2 = w3 = None
        for b0 in range(0, weeks, BLOCK):
            s = starts[b0]
            tr = (D < s) & (D >= s - 365)
            mu = Xc[tr].reshape(-1, len(ci)).mean(0); sd = Xc[tr].reshape(-1, len(ci)).std(0) + 1e-9
            Rtr = Rof(np.where(tr)[0], b0)
            if Rtr is not None:
                rmu, rsd = Rtr.mean(0), Rtr.std(0) + 1e-9
                Rtr = (Rtr - rmu) / rsd
            Ztr = (Xc[tr] - mu) / sd
            m2 = Cond(2, nige, lane, nr).fit(Ztr, V[tr], data["y"][tr], None, data["y2"][tr], w0=w2, R=Rtr); w2 = m2.w
            m3 = Cond(3, nige, lane, nr).fit(Ztr, V[tr], data["y"][tr], data["y2"][tr], data["y3"][tr], w0=w3, R=Rtr); w3 = m3.w
            del Ztr
            msk = (fold >= b0) & (fold < b0 + BLOCK)
            gi = c.idx[msk]
            Zte = (Xc[gi] - mu) / sd
            Rte = Rof(gi, b0)
            if Rte is not None:
                Rte = (Rte - rmu) / rsd
            yy, yy2, yy3 = c.y[msk], c.y2[msk], c.y3[msk]
            k = np.arange(len(yy))
            ll2[msk] = -np.log(np.clip(m2.predict(Zte, c.V[msk], yy, None, Rte)[k, yy2], 1e-9, 1))
            ll3[msk] = -np.log(np.clip(m3.predict(Zte, c.V[msk], yy, yy2, Rte)[k, yy3], 1e-9, 1))
            if need_T:
                T[msk] = tri_cond(P1[msk], Zte, c.V[msk], m2, m3, Rte)[0]
        print(f"  cond[{len(cols)} cols, opt={ {k: len(v) for k, v in opt.items()} }, race={list(rnames)}, tail={use_tail}] {time.time()-t0:.0f}s", flush=True)
        o = {"ll2": ll2, "ll3": ll3, "T": T}
        cache[key] = o
        return o

    assert np.all(np.diff(c.idx) > 0), "c.idx は昇順の想定"
    nige_idx = c.y == 0
    confS = (P_m[:, 0] >= tierS) & (P_m.argmax(1) == 0)
    star5 = per_day_top(P_m.max(1), c.D, 5)

    def step(new, ref, sel):
        d = (new["ll2"] + new["ll3"]) - (ref["ll2"] + ref["ll3"])
        return boot_mean(d[sel])

    # 朝に分かる候補(選ぶ期間で1つずつ)
    MORN = [
        ("lane_t3", {"add": ["h_lane_t3", "fan_c_q3"]}, "選手の枠別3連対率・期別成績のコース別3連対率"),
        ("course", {"add": ["h_lane_win", "h_course_win", "fan_c_win"]}, "枠別・進入コース別の1着率(期別成績も)"),
        ("fan_st", {"add": ["fan_c_st", "fan_c_sr"]}, "期別成績のコース別の平均ST・平均スタート順位"),
        ("st2", {"add": ["s_st90", "s_st_sd", "s_Fper"]}, "STの最近90日・ばらつき・今期のF数"),
        ("loc", {"add": ["rel_loc", "loc_win"]}, "当地勝率"),
        ("boat_motor", {"add": ["boat_2", "rel_motor", "m_res30", "m_res_all"]}, "ボート2連率・モーターの最近の成績"),
        ("form", {"add": ["f_form30", "f_form90", "f_form90_t3", "h_win_ewma"]}, "選手の最近の調子"),
        ("nige_all", {"nige": "all"}, "1号艇が逃げたときだけ全部の数字の効き方を変える"),
        ("lane_shape", {"lane": ["rel_nat", "h_st_rel", "h_lane_t2", "motor_2", "e_racer_exh", "A1"]},
         "1号艇が逃げたとき、候補の枠ごとに効き方を変える(2コースの差し・3コースのまくり差しの相性)"),
        ("wx_prev", {"race": ["wxp_wind_l1", "wxp_wave_l1"]}, "前日の同じ場の風速・波高 × 候補の枠"),
    ]
    PRE_C = [
        ("p_exh", {"add": ["p_exh_rel", "p_exh_self", "p_exh_rank", "p_exh_motor"]}, "その日の展示タイム"),
        ("p_course", {"add": ["p_cshift", "p_c1"]}, "進入(実際の進入で代用=上限寄り)"),
        ("p_wx", {"race": ["p_wind_l1", "p_wave_l1"]}, "直前の風速・波高 × 候補の枠"),
        ("p_wdir", {"tail": True}, "直前の風の向き(場ごとの軸: 向かい風/追い風)× 候補の枠"),
        ("p_exh_lane", {"lane": ["p_exh_rel"]}, "展示タイム × 候補の枠(1号艇が逃げたとき)"),
    ]

    def apply(cur, spec):
        cols, opt, rn, tl = list(cur["cols"]), {k: list(v) for k, v in cur["opt"].items()}, list(cur["race"]), cur["tail"]
        for f in spec.get("add", []):
            if f not in cols:
                cols.append(f)
        if spec.get("nige") == "all":
            opt["nige"] = list(cols)
        for f in spec.get("lane", []):
            if f in cols and f not in opt.setdefault("lane", []):
                opt["lane"].append(f)
            elif f not in cols:
                cols.append(f); opt.setdefault("lane", []).append(f)
        for f in spec.get("race", []):
            if f not in rn:
                rn.append(f)
        if spec.get("tail"):
            tl = True
        return {"cols": cols, "opt": opt, "race": rn, "tail": tl}

    def tag_of(cur):
        return json.dumps(cur, sort_keys=True)

    def run_cfg(cur, P1=None, need_T=False):
        return cond_run(tag_of(cur), cur["cols"], cur["opt"], cur["race"], cur["tail"], P1, need_T)

    base_cfg = {"cols": list(CAND), "opt": {}, "race": [], "tail": False}
    steps = []
    try:
        cur = dict(base_cfg)
        ref = run_cfg(cur)
        base_ll = {"select": {"ll2": r4(ref["ll2"][SEL].mean()), "ll3": r4(ref["ll3"][SEL].mean())},
                   "confirm": {"ll2": r4(ref["ll2"][CONF].mean()), "ll3": r4(ref["ll3"][CONF].mean())}}
        for phase, cands in (("morning", MORN), ("pre", PRE_C)):
            for name, spec, jp in cands:
                if phase == "morning" and spec.get("nige") == "all" and len(cur["cols"]) > 40:
                    continue
                new_cfg = apply(cur, spec)
                try:
                    new = run_cfg(new_cfg)
                except Exception as e:  # noqa
                    rep["errors"].append(f"step {name}: {e}")
                    continue
                s_sel = step(new, ref, SEL)
                keep = s_sel["hi"] is not None and s_sel["hi"] < 0
                row = {"phase": phase, "step": name, "jp": jp, "kept": keep, "select": s_sel, "confirm": step(new, ref, CONF),
                       "confirm_lane1_won": step(new, ref, CONF & nige_idx), "confirm_S": step(new, ref, CONF & confS),
                       "select_2nd_only": boot_mean((new["ll2"] - ref["ll2"])[SEL]),
                       "confirm_2nd_only": boot_mean((new["ll2"] - ref["ll2"])[CONF])}
                steps.append(row)
                print("  step", name, s_sel, keep, flush=True)
                if keep:
                    cur, ref = new_cfg, new
                rep["cond_steps"] = steps
                save()
            if phase == "morning":
                morn_cfg = dict(cur)
        pre_cfg = dict(cur)
    except Exception as e:  # noqa
        rep["errors"].append("steps: " + traceback.format_exc()[-1500:])
        morn_cfg = locals().get("morn_cfg", base_cfg)
        pre_cfg = locals().get("cur", morn_cfg)
        base_ll = locals().get("base_ll", {})
    rep["cond_base_ll"] = base_ll
    rep["cond_steps"] = steps
    rep["cond_morning_best"] = morn_cfg
    rep["cond_pre_best"] = pre_cfg
    save()

    # ---------------------------------------------------------------- 3連単の確率(朝: 今の構成と新しい構成、直前版)
    T_base = run_cfg(base_cfg, P_m, need_T=True)["T"]
    T_new = run_cfg(morn_cfg, P_m, need_T=True)["T"] if morn_cfg != base_cfg else T_base
    T_pre = run_cfg(pre_cfg, P_p, need_T=True)["T"] if pcfg else T_new
    T_hv = M.trifecta_probs(P_m, *M.fit_lambdas(P_m[SEL], c.y[SEL], c.y2[SEL], c.y3[SEL]))
    models = {"now": T_base, "new": T_new, "pre": T_pre, "harville": T_hv}
    rep["models"] = {"now": "今の毎朝の予想(2着・3着は条件付きモデル、候補の数字16個)", "new": "選ぶ期間で残した候補を足した朝の版",
                     "pre": "直前版(1着も2着・3着も展示タイム・直前の風と波・進入を使う。進入は上限寄り)", "harville": "参考: 1着の確率だけから(Harville+補正)"}
    ai = c.ai
    rep["trifecta_ll"] = {nm: {ph: r4(-np.log(np.clip(T[rr, ai], 1e-12, 1))[m].mean()) for ph, m in (("select", SEL), ("confirm", CONF))}
                          for nm, T in models.items()}
    rep["trifecta_ll_diff_confirm"] = {"new_minus_now": boot_mean((-np.log(np.clip(T_new[rr, ai], 1e-12, 1)) + np.log(np.clip(T_base[rr, ai], 1e-12, 1)))[CONF]),
                                       "pre_minus_new": boot_mean((-np.log(np.clip(T_pre[rr, ai], 1e-12, 1)) + np.log(np.clip(T_new[rr, ai], 1e-12, 1)))[CONF])}
    save()

    # ---------------------------------------------------------------- 1) 自信ありレースの2着・3着
    segs = {"S": confS, "star5": star5, "all": np.ones(n_oos, bool)}
    pm = {}
    for sg, m in segs.items():
        pm[sg] = {}
        for nm, T in models.items():
            pm[sg][nm] = {ph: place_metrics(T, c.y, c.y2, c.y3, m & w) for ph, w in (("select", SEL), ("confirm", CONF))}
    rep["place"] = pm
    # 2着を当てる率の差(新 − 今)の区間(S・確かめる期間・1号艇が勝ったレース)
    try:
        w = CONF & confS & nige_idx
        qa = head1(T_base[w])[1].argmax(1) == c.y2[w]
        qb = head1(T_new[w])[1].argmax(1) == c.y2[w]
        qp = head1(T_pre[w])[1].argmax(1) == c.y2[w]
        rep["place_diff_S_confirm"] = {"2nd_top1_new_minus_now": {k: r4(v) for k, v in M.paired_diff(qb, qa).items()},
                                       "2nd_top1_pre_minus_new": {k: r4(v) for k, v in M.paired_diff(qp, qb).items()}}
    except Exception:  # noqa
        rep["errors"].append("place_diff: " + traceback.format_exc()[-800:])
    save()

    # ---------------------------------------------------------------- 2) 2着を決める要因(1号艇が勝ったレース、確かめる期間の実際と予想)
    try:
        Xo = data["X"][c.idx]
        col = lambda f: ALLF.index(f)  # noqa: E731
        cls = lambda L: np.where(Xo[:, L, col("A1")] > 0, "A1", np.where(Xo[:, L, col("A2")] > 0, "A2", np.where(Xo[:, L, col("B1")] > 0, "B1", "B2")))  # noqa: E731
        q_now = head1(T_base)[1]
        q_pre = head1(T_pre)[1]
        tl = tail[c.idx]
        wd = wnd[c.idx]
        exr = Xo[:, :, col("p_exh_rank")]
        st_rel = Xo[:, :, col("h_st_rel")]
        cshift = (Xo[:, :, col("p_cshift")] != 0).any(1)

        def grp(m):
            mm = m & nige_idx
            n = int(mm.sum())
            if n < 50:
                return {"races": n}
            o = {"races": n}
            for L in (1, 2, 3):
                o[f"{L+1}号艇が2着"] = {"actual": r4((c.y2[mm] == L).mean()), "now": r4(q_now[mm, L].mean()), "pre": r4(q_pre[mm, L].mean())}
            o["5・6号艇が2着"] = {"actual": r4(((c.y2[mm] == 4) | (c.y2[mm] == 5)).mean()), "now": r4(q_now[mm, 4:].sum(1).mean()),
                                "pre": r4(q_pre[mm, 4:].sum(1).mean())}
            return o
        fac = {}
        for ph, PH in (("select", SEL), ("confirm", CONF)):
            f = {"全体": grp(PH)}
            f["風"] = {"追い風相当 2m以上": grp(PH & (tl <= -2)), "弱い(2m未満)": grp(PH & (np.abs(tl) < 2)), "向かい風相当 2m以上": grp(PH & (tl >= 2)),
                      "風速5m以上": grp(PH & (wd >= 5))}
            f["2号艇の級別"] = {k: grp(PH & (cls(1) == k)) for k in ("A1", "A2", "B1", "B2")}
            f["3号艇の級別"] = {k: grp(PH & (cls(2) == k)) for k in ("A1", "A2", "B1", "B2")}
            f["2号艇と3号艇の平均STの差"] = {"2号艇が0.02秒以上速い": grp(PH & (st_rel[:, 1] - st_rel[:, 2] <= -0.02)),
                                       "ほぼ同じ": grp(PH & (np.abs(st_rel[:, 1] - st_rel[:, 2]) < 0.02)),
                                       "3号艇が0.02秒以上速い": grp(PH & (st_rel[:, 1] - st_rel[:, 2] >= 0.02))}
            f["2号艇の展示タイムの順位"] = {"1・2位": grp(PH & (exr[:, 1] <= -1.5)), "5・6位": grp(PH & (exr[:, 1] >= 1.5))}
            f["3号艇の展示タイムの順位"] = {"1・2位": grp(PH & (exr[:, 2] <= -1.5)), "5・6位": grp(PH & (exr[:, 2] >= 1.5))}
            f["進入"] = {"枠なり": grp(PH & ~cshift), "変化あり": grp(PH & cshift)}
            f["2号艇のF持ち(今期)"] = {"あり": grp(PH & (Xo[:, 1, col("s_Fper")] > 0)), "なし": grp(PH & (Xo[:, 1, col("s_Fper")] == 0))}
            fac[ph] = f
        rep["factors_2nd"] = fac
    except Exception:  # noqa
        rep["errors"].append("factors: " + traceback.format_exc()[-1200:])
    save()

    # ---------------------------------------------------------------- 3) 買い方(自信ありレース)
    bets = {}
    names = list(CONF_BETS)
    for sg in ("S", "star5"):
        bets[sg] = {}
        for nm in ("now", "new", "pre"):
            T = models[nm]
            P1 = P_p if nm == "pre" else P_m
            bets[sg][nm] = {}
            for ph, PH in (("select", SEL), ("confirm", CONF)):
                idx = np.where(PH & segs[sg])[0]
                br = bet_returns(names, CONF_BETS, P1, T, pays, idx)
                bets[sg][nm][ph] = {b: bet_stats(*br[b], c.D[idx]) for b in names}
            print(f"  bets {sg} {nm} {time.time()-t0:.0f}s", flush=True)
        save()
    rep["bets_conf"] = bets
    rep["bet_names"] = {k: v[1] for k, v in {**CONF_BETS, **ARE_BETS}.items()}
    # 10/29 の 3連単118%・3連複105% は偶然か: 確かめる期間の「自信あり上位5」の日ごとの回収率の分布
    try:
        idx = np.where(CONF & star5)[0]
        br = bet_returns(["prod_tan", "prod_ex1", "prod_ex3", "prod_tri3", "prod_trio3", "tri_swap", "ex_1ab", "trio_1"], CONF_BETS, P_m, T_base, pays, idx)
        days_u = np.unique(c.D[idx])
        dist = {}
        for b, thr in (("prod_tri3", 1.18), ("prod_trio3", 1.05), ("prod_tan", 0.80), ("prod_ex1", 1.0), ("tri_swap", 1.0), ("ex_1ab", 1.0), ("trio_1", 1.0)):
            ret, stk = br[b]
            roi_d = []
            for d in days_u:
                mm = (c.D[idx] == d) & (stk > 0)
                if mm.sum() == 5:
                    roi_d.append(ret[mm].sum() / stk[mm].sum())
            roi_d = np.array(roi_d)
            if len(roi_d):
                dist[b] = {"days": int(len(roi_d)), "mean_daily_roi": r4(roi_d.mean()), "median_daily_roi": r4(np.median(roi_d)),
                           "share_days_ge": [thr, r4((roi_d >= thr).mean())], "share_days_ge_1": r4((roi_d >= 1).mean()),
                           "pooled": bet_stats(ret, stk)}
        rep["star5_daily"] = dist
    except Exception:  # noqa
        rep["errors"].append("star5_daily: " + traceback.format_exc()[-800:])
    save()

    # レースの選び方(オッズの代わりに、確率の集まり具合で選ぶ。選ぶ期間で決めて確かめる期間で評価)
    try:
        sel_rows = []
        Q_new = head1(T_new)
        U = np.array([np.triu(Q_new[0][i] + Q_new[0][i].T, 1).max() for i in range(n_oos)])
        q1 = Q_new[1].max(1)
        grid_bets = ["tri_swap", "tri_form4", "tri_top3", "trio_1", "trio_2", "ex_1ab", "qn_1a", "ex_1a"]
        tested = 0
        for b in grid_bets:
            best = None
            for pt in (tierS, 0.75, 0.80, 0.85):
                for uc in (0.0, 0.30, 0.40, 0.50):
                    for qc in (0.0, 0.45, 0.55):
                        tested += 1
                        m = (P_m[:, 0] >= pt) & (P_m.argmax(1) == 0) & (U >= uc) & (q1 >= qc)
                        idx = np.where(SEL & m)[0]
                        if len(idx) < 150:
                            continue
                        ret, stk = bet_returns([b], CONF_BETS, P_m, T_new, pays, idx)[b]
                        if (stk > 0).sum() < 150:
                            continue
                        st = bet_stats(ret, stk)
                        if best is None or st["roi"] > best[1]["roi"]:
                            best = ((pt, uc, qc), st)
            if best:
                (pt, uc, qc), st = best
                m = (P_m[:, 0] >= pt) & (P_m.argmax(1) == 0) & (U >= uc) & (q1 >= qc)
                idx = np.where(CONF & m)[0]
                ret, stk = bet_returns([b], CONF_BETS, P_m, T_new, pays, idx)[b]
                sel_rows.append({"bet": b, "rule": {"p1_min": pt, "pair_min": uc, "q2_min": qc}, "select": st,
                                 "confirm": bet_stats(ret, stk, c.D[idx])})
        rep["conf_selection"] = {"tested": tested, "rows": sel_rows,
                                 "survivors": [x["bet"] for x in sel_rows if (x["confirm"].get("lo") or 0) > 1.0]}
    except Exception:  # noqa
        rep["errors"].append("selection: " + traceback.format_exc()[-800:])
    save()

    # ---------------------------------------------------------------- 4) 荒れるレース
    try:
        ent = -(T_base * np.log(np.clip(T_base, 1e-12, 1))).sum(1)
        aseg = {"weak1": P_m[:, 0] < 0.40, "konsen_top3": per_day_top(ent, c.D, 3), "weak1_top3": per_day_top(1 - P_m[:, 0], c.D, 3)}
        are = {"segments": {k: {"select": int((v & SEL).sum()), "confirm": int((v & CONF).sum())} for k, v in aseg.items()}}
        # 作り直し: 荒れの区分ごとに、選ぶ期間で確率の鋭さ・枠ごとの寄せを決める
        ths = {}
        for k, m in aseg.items():
            ths[k] = recal_fit(T_new[SEL & m], ai[SEL & m]).tolist()
        are["recal_params"] = {k: [round(x, 4) for x in v] for k, v in ths.items()}
        res_a = {}
        for k, m in aseg.items():
            Tr_ = np.zeros_like(T_new)
            Tr_[m] = recal_apply(T_new[m], np.array(ths[k]))
            mods = {"now": (P_m, T_base), "new": (P_m, T_new), "recal": (decompose(Tr_), Tr_), "pre": (P_p, T_pre)}
            res_a[k] = {}
            for ph, PH in (("select", SEL), ("confirm", CONF)):
                mm = PH & m
                idx = np.where(mm)[0]
                o = {"races": int(mm.sum()), "lane1_win": r4((c.y[mm] == 0).mean()), "manshu": r4((c.pay_tri[mm] >= 10000).mean()),
                     "winner_by_lane_actual": [r4((c.y[mm] == L).mean()) for L in range(6)]}
                for nm, (P1x, Tx) in mods.items():
                    P1d = decompose(Tx)
                    tri_ll = -np.log(np.clip(Tx[rr, ai], 1e-12, 1))
                    oT = np.argsort(-Tx[mm], 1)
                    o[nm] = {"winner_by_lane_pred": [r4(P1d[mm, L].mean()) for L in range(6)],
                             "win_ll": r4(-np.log(np.clip(P1d[idx, c.y[idx]], 1e-9, 1)).mean()),
                             "tri_ll": r4(tri_ll[mm].mean()),
                             "winner_top1": r4((P1d[mm].argmax(1) == c.y[mm]).mean()),
                             **{f"tri_top{kk}": r4((oT[:, :kk] == ai[mm][:, None]).any(1).mean()) for kk in (1, 3, 5, 10, 20)}}
                    if nm != "now":
                        o[nm]["tri_ll_minus_now"] = boot_mean(tri_ll[mm] + np.log(np.clip(T_base[rr, ai], 1e-12, 1))[mm])
                    br = bet_returns(list(ARE_BETS), ARE_BETS, P1x if nm != "recal" else decompose(Tx), Tx, pays, idx)
                    o[nm]["bets"] = {b: bet_stats(*br[b], c.D[idx]) for b in ARE_BETS}
                res_a[k][ph] = o
            print(f"  are {k} {time.time()-t0:.0f}s", flush=True)
            save()
        are["results"] = res_a
        rep["are"] = are
    except Exception:  # noqa
        rep["errors"].append("are: " + traceback.format_exc()[-1500:])
    save()
    print("place done", rep["runtime_min"], "min", flush=True)


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "hist", int(sys.argv[2]) if len(sys.argv) > 2 else 52)
