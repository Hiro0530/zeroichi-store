"""荒れ注意(1号艇が負けやすいレース)の印と買い目案を、毎朝の予想ファイルに記録する。決め方は exp_are.py で検証(experiments/are_v1.json)。

- 設定は are_config.json(無い・enabled が false なら何もしない)。
- show が false の間は、ページ・Xには出さない(site_data.py には渡さない)。予想ファイルの "are" と、翌朝の答え合わせ
  (results の "are"、summary.json の total.are)にだけ残し、公開後の実績で確かめる。
- 使うのは朝の予想の確率だけ(公開時刻より後の情報は使わない)。点数 = 混戦度(3連単の確率の散らばり)。採点対象のレースの上位 n レース。
- 買い目案は検証で回収率100%を超えると確かめられたものではない。2026-10-29 に決めた3つを、公開後の新しいレースで確かめるために記録する。
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
CFG = ROOT / "are_config.json"


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


def today(preds: list, Ts: list) -> dict | None:
    cfg = load()
    if not cfg:
        return None
    idx = [i for i, x in enumerate(preds) if x["scored"]]
    sc = {i: score(np.array(preds[i]["probs"]), Ts[i], cfg.get("score", "entropy")) for i in idx}
    order = sorted(idx, key=lambda i: -sc[i])[:int(cfg["n_per_day"])]
    out = []
    for i in sorted(order, key=lambda i: preds[i]["close"]):
        x = preds[i]
        plans = []
        for b in cfg["bets"]:
            kind, combos = combos_for(np.array(x["probs"]), np.asarray(Ts[i]), b)
            plans.append({"bet": b, "bet_type": kind, "combos": combos})
        out.append({"key": x["key"], "venue_name": x["venue_name"], "race": x["race"], "close": x["close"],
                    "score": round(sc[i], 4), "p_lane1": x["probs"][0], "plans": plans})
    return {"rule": {k: cfg[k] for k in ("score", "n_per_day", "bets") if k in cfg}, "show": bool(cfg.get("show")), "races": out}


def grade(pred: dict, res: dict) -> tuple[dict | None, list]:
    """→ (集計 {races, lane1_lost, manshu_races, bets: {買い方: {races, hits, stake, return}}}, レースごと)"""
    a = pred.get("are")
    if not a or not a.get("races"):
        return None, []
    rows = []
    for x in a["races"]:
        r = res.get(x["key"])
        if not r:
            continue
        o = r["order"]
        pay = r.get("pay") or {}
        act = {"tansho": str(o[0]), "exacta": f"{o[0]}-{o[1]}", "trifecta": f"{o[0]}-{o[1]}-{o[2]}",
               "trio": "-".join(sorted(map(str, o[:3])))}
        bets = {}
        for pl in x["plans"]:
            k = pl["bet_type"]
            src = pay.get(k) or r.get(k) or {}
            hit = act[k] in pl["combos"]
            bets[pl["bet"]] = {"stake": 100 * len(pl["combos"]), "return": src.get(act[k], 0) if hit else 0}
        tri = (pay.get("trifecta") or r.get("trifecta") or {}).get(act["trifecta"], 0)
        rows.append({"key": x["key"], "venue_name": x["venue_name"], "race": x["race"], "actual": act["trifecta"],
                     "lane1_won": o[0] == 1, "trifecta_payout": tri, "bets": bets})
    s = {"races": len(rows), "lane1_lost": sum(not r["lane1_won"] for r in rows),
         "manshu_races": sum(r["trifecta_payout"] >= 10000 for r in rows), "bets": {}}
    for r in rows:
        for b, v in r["bets"].items():
            t = s["bets"].setdefault(b, {"races": 0, "hits": 0, "stake": 0, "return": 0})
            t["races"] += 1; t["hits"] += v["return"] > 0; t["stake"] += v["stake"]; t["return"] += v["return"]
    return s, rows


def total(daily: list) -> dict:
    t = {"days": 0, "races": 0, "lane1_lost": 0, "manshu_races": 0, "bets": {}}
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
    for u in t["bets"].values():
        u["roi"] = round(u["return"] / max(u["stake"], 1), 4)
    return t
