"""ページとXが使う数字を1つのJSON(kyotei/site_data.json)にまとめる。見た目(site_gen.py)とは切り離す。

形は README の「site_data.json の形」に書いてある。項目を消したり意味を変えたりするときは schema を上げる。
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
JST = timezone(timedelta(hours=9))
SCHEMA = 1
PAGE = "https://hiro0530.github.io/zeroichi-store/kyotei/"
PROOF = "https://github.com/Hiro0530/zeroichi-store/commits/main/kyotei/predictions/"
EVAL_KEYS = ("races", "top1", "logloss", "brier", "ece", "roi_win", "tri3_hit", "pick_lane1_share")

FEATURE_TEXT = [
    (None, "番組表: 全国・当地の勝率と2連対率、級別、体重、モーターとボートの2連対率、今節のここまでの着順"),
    (None, "過去の競走成績(前日まで): 選手ごとの枠別の1着率・2連対率、実際の進入コース別の1着率、平均スタートタイミング、フライング回数、前付け・コースを取られる傾向、最近の調子"),
    (None, "レーサー期別成績(公開済みの期のもの): コース別の1着率・2連対率・平均スタートタイミング・平均スタート順位"),
    (None, "場ごとの枠の有利不利、前日の同じ場の風速・波高"),
    (("f_form30", "f_form90"), "選手の最近30日・90日の成績(枠ごとの平均との差)"),
    (("f_rv",), "選手のその場での成績(枠ごとの平均との差)"),
    (("f_rlv",), "選手×枠×場の1着率(場×枠 → 選手×枠 の順に寄せて推定)"),
    (("m_res_all", "m_res30"), "モーター番号ごとの最近の成績(乗った選手の力を差し引いた2連対)、モーター入れ替え直後かどうか"),
    (("e_racer_exh",), "選手の最近の展示タイム(前のレースまでの、同じレース内の平均との差)"),
    (("e_motor_exh",), "モーター番号ごとの最近の展示タイム(回り足の目安)"),
    (("e_draw_exh", "e_draw_res"), "モーターの平均より良い展示・成績を出せているか(整備・調整の力の目安)"),
    (("t_lvl_l1",), "潮位(気象庁の潮位表。締切時刻の潮の高さと満ち引き。海水・汽水の場だけ)"),
    (("w_u_l1",), "前日の同じ場の風の向きと強さ(場ごとの向きの効き方を学習)"),
]
NOT_USED = "当日の展示タイム・直前の気象・部品交換やプロペラの情報(直前情報のページにしか無く、朝の公開時点では分からないため。取得もしていません)、オッズ(取得していません)"
DISCLAIMERS = [   # 文言はページの見た目側の担当が管理(削らない。言い回しだけ変える)
    "ここの予想は無料の参考情報です。当たる保証はありませんし、これまでの成績がこの先も続くとは限りません。舟券を買うかどうかは、ご自身で決めてください。",
    "舟券は20歳になってから。ボートレースの払戻率はおよそ75%なので、買い続けると平均では賭けた額の4分の1ほどが減っていきます。",
    "のめり込んでいるかもと感じたら、ギャンブル依存症予防回復支援センターの相談電話 0120-683-705(無料・24時間)や、お住まいの都道府県の精神保健福祉センターへ。",
    "このサイトでは舟券の購入や代行はしていません。有料版(会員)も予想そのものは無料のページと同じで、的中や利益は保証しません。",
]


def _load(p: Path):
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def _today(p: dict | None) -> dict | None:
    if not p:
        return None
    races = []
    for x in p["races"]:
        races.append({k: x.get(k) for k in ("key", "venue", "venue_name", "race", "close", "scored", "tier", "pick", "probs", "trifecta", "title", "racers")}
                     | {"p_pick": max(x["probs"])})
    feat = sorted([x for x in races if x["scored"] is not False], key=lambda x: -x["p_pick"])[:6]
    return {"date": p["date"], "published_at": p["published_at"], "proof_url": f"{PROOF}{p['date']}.json",
            "model_fitted_at": p.get("model_fitted_at"), "races": races,
            "featured": [x["key"] for x in sorted(feat, key=lambda x: x["close"])],
            "ana": p.get("ana")}   # 今日の穴(万舟ねらい): {"rule", "races": [{key, venue_name, race, close, p_manshu, combos: [[組番, 確率, 過去の平均払戻]]}]}


def _yesterday(r: dict | None) -> dict | None:
    if not r:
        return None
    s = dict(r["summary"])
    n = s["graded_races"]
    s["pnl_win"] = s["return_win"] - s["stake_win"]
    s["pnl_tri"] = s["return_tri"] - s["stake_tri"]
    s["stake_base"] = 100 * n
    s["pnl_base"] = s["base_return"] - 100 * n
    races = []
    for x in r["races"]:
        y = dict(x)
        y["pnl_win"] = (x.get("pay_win") or 0) - 100          # 本命の単勝100円
        y["pnl_tri"] = (x.get("pay_tri") or 0) - 300          # 3連単3点×100円
        y["pnl_base"] = (x.get("base_pay") or 0) - 100        # 1号艇の単勝100円
        y["pnl_race"] = y["pnl_win"] + y["pnl_tri"]
        races.append(y)
    hits = sorted([x for x in races if x.get("tri_hit")], key=lambda x: -(x.get("pay_tri") or 0))
    best = {k: hits[0].get(k) for k in ("key", "venue_name", "race", "actual", "pay_tri")} if hits else None
    return {"date": s["date"], "proof_url": f"{PROOF}{s['date']}.json", "summary": s, "best_tri_hit": best, "races": races,
            "ana": r.get("ana") or []}   # 前日の穴の結果: [{key, venue_name, race, combos, actual, trifecta_payout, hit, pay, stake, manshu}]


def _model(m: dict | None) -> dict | None:
    if not m:
        return None
    ev = m.get("eval") or {}
    e = {k: ev.get(k) for k in ("test_from", "test_to", "test_days", "folds", "diff_vs_lane1", "beats_lane1", "tiers", "tiers_def")}
    for k in ("full", "base", "prior", "oracle"):
        if ev.get(k):
            e[k] = {kk: ev[k].get(kk) for kk in EVAL_KEYS}
    if ev.get("full"):
        e["full"]["calibration"] = ev["full"].get("calibration")
    e["lane1"] = ev.get("lane1")
    feats = set((m.get("config") or {}).get("feats") or m.get("feats") or [])
    return {"version": m.get("version"), "n_races": m.get("n_races"), "train_from": m.get("train_from"), "train_to": m.get("train_to"),
            "fitted_at": m.get("fitted_at"), "lambda": m.get("lambda"),
            "config": {"feats": sorted(feats), "tiers": (m.get("config") or {}).get("tiers")},
            "features_used": [t for keys, t in FEATURE_TEXT if keys is None or any(k in feats for k in keys)],
            "not_used": NOT_USED, "uses_tide": "t_lvl_l1" in feats, "eval": e}


def build() -> dict:
    summ = _load(ROOT / "summary.json") or {"total": {}, "daily": []}
    preds = sorted((ROOT / "predictions").glob("*.json"))
    results = sorted((ROOT / "results").glob("*.json"))
    t = dict(summ.get("total") or {})
    if t.get("graded_races"):
        t["stake_base"] = 100 * t["graded_races"]
        t["pnl_win"] = t["return_win"] - t["stake_win"]
        t["pnl_tri"] = t["return_tri"] - t["stake_tri"]
        t["pnl_base"] = t["base_return"] - t["stake_base"]
    data = {
        "schema": SCHEMA, "generated_at": datetime.now(JST).isoformat(timespec="seconds"), "page_url": PAGE,
        "today": _today(_load(preds[-1]) if preds else None),
        "yesterday": _yesterday(_load(results[-1]) if results else None),
        "record": {"total": t, "daily": summ.get("daily", [])[-60:], "tiers_live": summ.get("tiers") or {}},
        "model": _model(_load(ROOT / "model.json")),
        "disclaimers": DISCLAIMERS,
        "sources": ["BOAT RACE公式サイトのダウンロードデータ(番組表・競走成績・レーサー期別成績)。データファイルそのものは置いていません。"],
    }
    if (data["model"] or {}).get("uses_tide"):
        data["sources"].append("潮位:気象庁ホームページ「潮位表」のデータを加工して作成(締切時刻の潮位と満ち引きを計算)。")
    (ROOT / "site_data.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    return data


if __name__ == "__main__":
    d = build()
    print("site_data.json", {k: (len(v["races"]) if isinstance(v, dict) and "races" in v else type(v).__name__) for k, v in d.items()})
