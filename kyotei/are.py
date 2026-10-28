"""荒れ予報(1号艇以外が来やすいかの目安)。毎朝の予想ファイルに書き、翌朝に答え合わせする。決め方は exp_are.py で検証(experiments/are_v1.json)。

- 設定は are_config.json(無い・enabled が false なら何もしない)。show が true のときだけページ・Xに出す(site_data.py が渡す)。
- 使うのは朝の予想の確率と、番組表の公開データ(級別・勝率・モーター2連率)、前日までの履歴だけ。公開時刻より後の情報は使わない。
- 荒れ度 = 混戦度(3連単の確率の散らばり)。直近の公開済みの日(非公開の hist/paper の T_*.json.gz)の分布で4段階に分ける
  (晴れ・くもり・雨・嵐)。参考が少ないうちはその日のレースの分布で分ける。
- 荒れ予報 TOP3 = 採点対象のうち混戦度の高い3レース(検証: 万舟 16%→26%、1号艇の1着 55%→30%)。
- 本命なし(荒れ予想) = TOP3 か 嵐。このレースだけ「万舟の組み合わせ候補」= 1号艇を含まない3連単を AIの確率の高い順に3点出す。
  その組み合わせの過去の出現率と平均配当(前日までの約1年。全体と場ごと)を添える。参考の組み合わせで、回収率100%超えは確かめていない。
- 理由の言葉(1号艇のモーターが下位、外枠に強い選手 など)は番組表の数字の言い換え。モデルの計算そのものではない。
- 買い目案(plans)は 2026-10-29 に決めた3つを記録だけする(ページ・Xには出さない)。公開後の新しいレースで確かめる。
"""
from __future__ import annotations

import gzip
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
CFG = ROOT / "are_config.json"
LEVELS = {1: ("晴れ", "堅め"), 2: ("くもり", "ふつう"), 3: ("雨", "荒れ気味"), 4: ("嵐", "大荒れ注意")}
QUANT = (0.40, 0.75, 0.92)     # くもり・雨・嵐 の下限(参考の分布の分位)
MIN_REF = 400                  # 参考の分布に必要なレース数(足りなければその日の分布)
N_CANDS = 3
STAT_DAYS = 365                # 組み合わせの出現率・平均配当を数える期間(前日まで)
VENUE_MIN = 300                # 場ごとの数字を出すのに必要なレース数


def load() -> dict | None:
    try:
        c = json.loads(CFG.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return c if c.get("enabled") else None


def combos_for(P: np.ndarray, T: np.ndarray, bet: str) -> tuple[str, list[str]]:
    """1レースの買い目(exp_are.bet_table と同じ決め方)。→ (券種 tansho/exacta/trifecta/trio, 組番の一覧)"""
    import exp_bets as EB
    PERMS = EB.PERMS
    head, sec = PERMS[:, 0], PERMS[:, 1]
    exh = np.array([a for a, _ in EB.EXL])

    def top(prob, mask, k):
        return list(np.argsort(-np.where(mask, prob, -1.0))[:k])

    LT, LE, LR = EB.LBL["trifecta"], EB.LBL["exacta"], EB.LBL["trio"]
    if bet == "tan_non1":
        return "tansho", [str(2 + int(np.argmax(P[1:])))]
    if bet == "tan_34":
        return "tansho", [str(3 + int(np.argmax(P[2:4])))]
    if bet == "tan_34w":
        return "tansho", ["3", "4"]
    if bet.startswith("ex_"):
        Ex = T @ EB.M_EX
        if bet == "ex_non1_3":
            return "exacta", [LE[j] for j in top(Ex, exh != 0, 3)]
        if bet == "ex_34_4":
            return "exacta", [LE[j] for j in top(Ex, (exh == 2) | (exh == 3), 4)]
    if bet.startswith("trio_non1_"):
        Tr = T @ EB.M_TRIO
        no1 = np.array([0 not in t for t in EB.TRIPS])
        return "trio", [LR[j] for j in top(Tr, no1, int(bet.rsplit("_", 1)[1]))]
    if bet == "tri_top3":
        return "trifecta", [LT[j] for j in np.argsort(-T)[:3]]
    k = int(bet.rsplit("_", 1)[1])
    if bet.startswith("tri_non1_"):
        return "trifecta", [LT[j] for j in top(T, head != 0, k)]
    if bet.startswith("tri_34_"):
        return "trifecta", [LT[j] for j in top(T, (head == 2) | (head == 3), k)]
    if bet.startswith("tri_1out2_"):
        return "trifecta", [LT[j] for j in top(T, (head != 0) & (sec != 0), k)]
    raise ValueError(bet)


def score(P: np.ndarray, T: np.ndarray, kind: str) -> float:
    """荒れの点数。entropy = 混戦度(3連単の確率の散らばり)、lane1 = 1 − 1号艇の1着の確率。"""
    if kind == "lane1":
        return float(1 - P[0])
    T = np.clip(np.asarray(T, float), 1e-12, 1)
    return float(-(T * np.log(T)).sum())


# ---------------------------------------------------------------- 朝: 荒れ度・理由・組み合わせ候補
def ref_scores(before: str, kind: str = "entropy", max_files: int = 30) -> list[float]:
    """直近の公開済みの日の3連単の確率(非公開の hist/paper/T_<日>.json.gz)から混戦度の分布。今日の分は使わない。"""
    pdir = ROOT / "hist" / "paper"
    out: list[float] = []
    for f in sorted(pdir.glob("T_*.json.gz"))[::-1]:
        d = f.name[2:12]
        if d >= before:
            continue
        try:
            j = json.loads(gzip.decompress(f.read_bytes()))
        except Exception:  # noqa
            continue
        out += [score(np.zeros(6), np.array(t, float), kind) for t in j.values() if len(t) == 120]
        max_files -= 1
        if max_files <= 0:
            break
    return out


def thresholds(ref: list[float], today: list[float]) -> tuple[list[float], str, int]:
    base, src = (ref, "recent") if len(ref) >= MIN_REF else (today, "today")
    if not base:
        return [9e9, 9e9, 9e9], src, 0
    return [round(float(np.quantile(base, q)), 4) for q in QUANT], src, len(base)


def level_of(s: float, th: list[float]) -> int:
    return 1 + sum(s >= t for t in th)


def combo_stats(days: list | None) -> dict:
    """前日までの約1年: 3連単の組番ごとの {全体: [出た回数, 払戻の合計], 場: {場: [...]}, 全体のレース数, 場ごとのレース数}"""
    st = {"n": 0, "nv": {}, "all": {}, "v": {}}
    for _, _, res in (days or [])[-STAT_DAYS:]:
        for k, r in res.items():
            o = r.get("order") or []
            if r.get("void") or len(o) < 3:
                continue
            v = k[9:11]
            c = f"{o[0]}-{o[1]}-{o[2]}"
            pay = (r.get("trifecta") or {}).get(c, 0) or 0
            st["n"] += 1
            st["nv"][v] = st["nv"].get(v, 0) + 1
            a = st["all"].setdefault(c, [0, 0])
            a[0] += 1; a[1] += pay
            b = st["v"].setdefault(v, {}).setdefault(c, [0, 0])
            b[0] += 1; b[1] += pay
    return st


def prev_wind(days: list | None, venue: str, d: str) -> float | None:
    """前日のその場の平均風速(競走成績の各レースの値)。前日に開催が無ければ None。"""
    if not days:
        return None
    dd, _, res = days[-1]
    from datetime import date as _d
    if (_d.fromisoformat(d) - dd).days != 1:
        return None
    w = [r["wx"]["wind"] for k, r in res.items() if k[9:11] == venue and (r.get("wx") or {}).get("wind") is not None]
    return round(sum(w) / len(w), 1) if w else None


def motor_pct(preds: list) -> dict:
    """場ごとの今日のモーター2連率の並び(0=最下位 … 1=最上位)。同じモーターが何度も出るので、値の重複を除いて並べる。"""
    vals: dict[str, set] = {}
    for x in preds:
        for b in x.get("racers") or []:
            if b.get("motor_2"):
                vals.setdefault(x["venue"], set()).add(round(float(b["motor_2"]), 2))
    out = {}
    for v, s in vals.items():
        arr = sorted(s)
        out[v] = arr
    return out


def _pct_in(arr: list, val: float) -> float | None:
    if not arr or not val:
        return None
    lo = sum(1 for a in arr if a < val - 1e-9)
    return lo / max(len(arr) - 1, 1)


def fadj_rule() -> dict:
    """2号艇のF持ちの検証結果(experiments/are_fadj.json、exp_are.main_fadj)。無ければ {}(事実として出すだけ)。"""
    try:
        return json.loads((ROOT / "experiments" / "are_fadj.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def lane2_F(X) -> int:
    """2号艇の今期のF数(朝の特徴量 s_Fper。予想に使っている数字と同じ)。"""
    try:
        from features import ALLF
        return int(round(float(np.asarray(X)[1, ALLF.index("s_Fper")])))
    except Exception:  # noqa
        return 0


def reasons_for(x: dict, mp: dict, wind: float | None, f2: int = 0, fr: dict | None = None) -> tuple[list[str], dict]:
    """理由の言葉(強い順に最大3つ)と、モーターの印(1号艇が下位か)。"""
    rs = x.get("racers") or []
    P = x["probs"]
    out: list[tuple[int, str]] = []
    flags: dict = {"motor_low": False}
    if max(P) < 0.45:
        out.append((10, f"AIの1着の確率は、いちばん高い{int(np.argmax(P)) + 1}号艇でも{max(P) * 100:.0f}%(混戦)"))
    if len(rs) == 6:
        b1 = rs[0]
        arr = mp.get(x["venue"]) or []
        q = _pct_in(arr, b1.get("motor_2") or 0)
        rk = 1 + sum(1 for z in rs if (z.get("motor_2") or 0) > (b1.get("motor_2") or 0))
        if b1.get("motor_2") and ((q is not None and q <= 0.25) or rk >= 5):
            flags["motor_low"] = True
            where = f"この場の下位{max(1, int(np.ceil(q * 10)))}割" if q is not None and q <= 0.25 else f"6艇中{rk}番目"
            out.append((9, f"1号艇のモーター2連率{b1['motor_2']:.0f}%({where})"))
        if b1.get("cls") in ("B1", "B2"):
            out.append((8, f"1号艇がB級({b1['name']} {b1['cls']})"))
        strong = [z for z in rs[2:] if z.get("cls") == "A1" or (z.get("nat_win", 0) >= b1.get("nat_win", 0) + 0.8)]
        if strong:
            z = max(strong, key=lambda z: z.get("nat_win", 0))
            out.append((7, f"外枠に強い選手({z['lane']}号艇 {z['name']} {z['cls']}・勝率{z['nat_win']:.2f})"))
        nrk = 1 + sum(1 for z in rs if z.get("nat_win", 0) > b1.get("nat_win", 0))
        if nrk >= 4 and b1.get("cls") not in ("B1", "B2"):
            out.append((6, f"1号艇の全国勝率{b1['nat_win']:.2f}はメンバー{nrk}位"))
    if f2 > 0 and len(rs) == 6:
        fr = fr or {}
        g = fr.get("gap_confirm") or {}
        if fr.get("missed") and g.get("mean") is not None:   # モデルが見落としている(検証済み): 強めの理由
            out.append((8.5, f"2号艇がF持ち(今期F{f2}・{rs[1]['name']})。検証では1号艇の1着がAIの見立てより{abs(g['mean']) * 100:.1f}ポイント低い"))
        else:   # 見落としていない・未検証: 事実として(AIの確率にもう入っている)
            out.append((4, f"2号艇がF持ち(今期F{f2}・{rs[1]['name']})"))
    if wind is not None and wind >= 5:
        out.append((5, f"前日のこの場は風が強め(平均{wind:.0f}m)"))
    out.sort(key=lambda t: -t[0])
    return [t for _, t in out[:3]], flags


def cands_for(T: np.ndarray, venue: str, st: dict) -> list:
    """1号艇を含まない3連単を確率の高い順に N_CANDS 点。[組番, AIの確率, 全体の出現率, 全体の平均配当, 場の出現率, 場の平均配当]"""
    import exp_bets as EB
    PERMS = EB.PERMS
    no1 = ~(PERMS == 0).any(1)
    idx = np.argsort(-np.where(no1, T, -1.0))[:N_CANDS]
    out = []
    for j in idx:
        c = EB.LBL["trifecta"][j]
        a = st["all"].get(c, [0, 0])
        nv = st["nv"].get(venue, 0)
        b = (st["v"].get(venue) or {}).get(c, [0, 0])
        out.append([c, round(float(T[j]), 4),
                    round(a[0] / st["n"], 5) if st["n"] else None, int(a[1] / a[0]) if a[0] else None,
                    round(b[0] / nv, 5) if nv >= VENUE_MIN else None, int(b[1] / b[0]) if nv >= VENUE_MIN and b[0] else None])
    return out


def today(preds: list, Ts: list, days: list | None = None, Xs: list | None = None) -> dict | None:
    """毎朝: 全レースに荒れ度(x["are"])を書き、TOP3 と本命なしのレースをまとめて返す(予想ファイルの "are")。"""
    cfg = load()
    if not cfg:
        return None
    kind = cfg.get("score", "entropy")
    d = preds[0]["key"][:8] if preds else ""
    d = f"{d[:4]}-{d[4:6]}-{d[6:8]}" if d else ""
    sc = [score(np.array(x["probs"]), Ts[i], kind) for i, x in enumerate(preds)]
    idx = [i for i, x in enumerate(preds) if x["scored"]]
    th, src, nref = thresholds(ref_scores(d, kind) if d else [], [sc[i] for i in idx])
    order = sorted(idx, key=lambda i: -sc[i])
    top = order[:int(cfg["n_per_day"])]
    rank = {i: r + 1 for r, i in enumerate(order)}
    st = combo_stats(days)
    mp = motor_pct(preds)
    winds: dict[str, float | None] = {}
    fr = fadj_rule()
    for i, x in enumerate(preds):
        if x["venue"] not in winds:
            winds[x["venue"]] = prev_wind(days, x["venue"], d) if d else None
        lv = level_of(sc[i], th)
        why, fl = reasons_for(x, mp, winds[x["venue"]], lane2_F(Xs[i]) if Xs is not None and i < len(Xs) else 0, fr)
        if Xs is not None and i < len(Xs):
            fl["f2"] = lane2_F(Xs[i])
        nashi = i in top or lv == 4
        a = {"lv": lv, "score": round(sc[i], 4), "rank": rank.get(i), "top3": i in top, "nashi": nashi, "reasons": why,
             "motor_low": fl["motor_low"], **({"f2": fl["f2"]} if fl.get("f2") else {})}
        if nashi:
            a["cands"] = cands_for(np.asarray(Ts[i]), x["venue"], st)
        x["are"] = a
    out = []
    for i in sorted(top, key=lambda i: preds[i]["close"]):
        x = preds[i]
        plans = []
        for b in cfg["bets"]:
            k, combos = combos_for(np.array(x["probs"]), np.asarray(Ts[i]), b)
            plans.append({"bet": b, "bet_type": k, "combos": combos})
        out.append({"key": x["key"], "venue_name": x["venue_name"], "race": x["race"], "close": x["close"],
                    "score": round(sc[i], 4), "p_lane1": x["probs"][0], "lv": x["are"]["lv"], "plans": plans})
    lv_n = {str(k): sum(1 for x in preds if x["are"]["lv"] == k) for k in LEVELS}
    return {"rule": {k: cfg[k] for k in ("score", "n_per_day", "bets") if k in cfg}, "show": bool(cfg.get("show")),
            "levels": {"thresholds": th, "source": src, "n_ref": nref, "names": {str(k): v[0] for k, v in LEVELS.items()}, "count": lv_n},
            "stats": {"days": min(len(days or []), STAT_DAYS), "races": st["n"]},
            "races": out, "nashi": [x["key"] for x in preds if x["are"]["nashi"]]}


# ---------------------------------------------------------------- 翌朝: 答え合わせ
def _act(r: dict) -> dict:
    o = r["order"]
    return {"tansho": str(o[0]), "exacta": f"{o[0]}-{o[1]}", "trifecta": f"{o[0]}-{o[1]}-{o[2]}",
            "trio": "-".join(sorted(map(str, o[:3])))}


def _layer(x: dict, actual: str, cands: list) -> str | None:
    """どの層が当たったか: 本線=3連単の1番手、抑え=2・3番手、狙い=万舟の組み合わせ候補。"""
    tri = [c for c, _ in x.get("trifecta") or []]
    if tri[:1] == [actual]:
        return "本線"
    if actual in tri[1:3]:
        return "抑え"
    return "狙い" if actual in cands else None


def grade(pred: dict, res: dict) -> tuple[dict | None, list]:
    """→ (集計, レースごと)。集計: TOP3 の {races, lane1_lost, manshu_races, bets}、本命なしの組み合わせ候補 nashi、荒れ度ごと levels。
    レースごと: 本命なし(TOP3を含む)の全レース。外れも全部。"""
    a = pred.get("are")
    if not a or not a.get("races"):
        return None, []
    px = {x["key"]: x for x in pred["races"]}
    top = {x["key"]: x for x in a["races"]}
    keys = list(dict.fromkeys(list(top) + list(a.get("nashi") or [])))
    rows = []
    for k in keys:
        r = res.get(k)
        x = px.get(k)
        if not r or not x or len(r.get("order") or []) < 3 or (x.get("scored") is False):
            continue
        act = _act(r)
        pay = r.get("pay") or {}
        tri = (pay.get("trifecta") or r.get("trifecta") or {}).get(act["trifecta"], 0)
        xa = x.get("are") or {}
        cands = [c[0] for c in xa.get("cands") or []]
        hit = act["trifecta"] in cands
        row = {"key": k, "venue_name": x["venue_name"], "race": x["race"], "lv": xa.get("lv"), "top3": k in top,
               "actual": act["trifecta"], "lane1_won": r["order"][0] == 1, "trifecta_payout": tri,
               "cands": cands, "cand_hit": hit, "cand_pay": tri if hit else 0,
               "layer": _layer(x, act["trifecta"], cands)}
        if k in top:
            bets = {}
            for pl in top[k]["plans"]:
                bt = pl["bet_type"]
                src = pay.get(bt) or r.get(bt) or {}
                h = act[bt] in pl["combos"]
                bets[pl["bet"]] = {"stake": 100 * len(pl["combos"]), "return": src.get(act[bt], 0) if h else 0}
            row["bets"] = bets
        rows.append(row)
    t3 = [r for r in rows if r["top3"]]
    s = {"races": len(t3), "lane1_lost": sum(not r["lane1_won"] for r in t3),
         "manshu_races": sum(r["trifecta_payout"] >= 10000 for r in t3), "bets": {},
         "best": max(({"key": r["key"], "venue_name": r["venue_name"], "race": r["race"], "actual": r["actual"], "pay": r["trifecta_payout"]}
                      for r in t3), key=lambda z: z["pay"], default=None)}
    for r in t3:
        for b, v in r["bets"].items():
            t = s["bets"].setdefault(b, {"races": 0, "hits": 0, "stake": 0, "return": 0})
            t["races"] += 1; t["hits"] += v["return"] > 0; t["stake"] += v["stake"]; t["return"] += v["return"]
    cr = [r for r in rows if r["cands"]]
    s["nashi"] = {"races": len(cr), "lane1_lost": sum(not r["lane1_won"] for r in cr),
                  "manshu_races": sum(r["trifecta_payout"] >= 10000 for r in cr),
                  "cand_hits": sum(r["cand_hit"] for r in cr), "cand_stake": sum(100 * len(r["cands"]) for r in cr),
                  "cand_return": sum(r["cand_pay"] for r in cr)}
    lv = {}
    for x in pred["races"]:
        r = res.get(x["key"])
        xa = x.get("are")
        if not r or not xa or x.get("scored") is False or len(r.get("order") or []) < 3:
            continue
        o = r["order"]
        tri = ((r.get("pay") or {}).get("trifecta") or r.get("trifecta") or {}).get(f"{o[0]}-{o[1]}-{o[2]}", 0)
        t = lv.setdefault(str(xa["lv"]), {"races": 0, "lane1_won": 0, "manshu": 0})
        t["races"] += 1; t["lane1_won"] += o[0] == 1; t["manshu"] += tri >= 10000
    s["levels"] = lv
    return s, rows


def total(daily: list) -> dict:
    t = {"days": 0, "races": 0, "lane1_lost": 0, "manshu_races": 0, "bets": {},
         "nashi": {"races": 0, "lane1_lost": 0, "manshu_races": 0, "cand_hits": 0, "cand_stake": 0, "cand_return": 0}, "levels": {}}
    for s in daily:
        a = s.get("are")
        if not a:
            continue
        t["days"] += 1
        for k in ("races", "lane1_lost", "manshu_races"):
            t[k] += a.get(k, 0)
        for b, v in (a.get("bets") or {}).items():
            u = t["bets"].setdefault(b, {"races": 0, "hits": 0, "stake": 0, "return": 0})
            for k in u:
                u[k] += v.get(k, 0)
        for k in t["nashi"]:
            t["nashi"][k] += (a.get("nashi") or {}).get(k, 0)
        for l, v in (a.get("levels") or {}).items():
            u = t["levels"].setdefault(l, {"races": 0, "lane1_won": 0, "manshu": 0})
            for k in u:
                u[k] += v.get(k, 0)
    for u in t["bets"].values():
        u["roi"] = round(u["return"] / max(u["stake"], 1), 4)
    t["nashi"]["cand_roi"] = round(t["nashi"]["cand_return"] / max(t["nashi"]["cand_stake"], 1), 4)
    return t
