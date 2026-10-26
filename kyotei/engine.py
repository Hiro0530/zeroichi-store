"""kyotei engine: 公式の番組表(B)・競走成績(K)から、予想と答え合わせを作る。

方針(正直さのルール):
- 予想は公開時刻を記録し、締切が公開時刻より前のレースは採点しない。
- 答え合わせは全レース。的中も外れも全部残す。
- 「1号艇を毎回」という単純な買い方と並べて比べる。
- 仮の回収率(毎回100円)は確定払戻金から機械的に計算する。100%未満でもそのまま出す。
"""
from __future__ import annotations

import gzip
import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import run as run_mod  # noqa: E402
import model2 as M  # noqa: E402
from features import ALLF, build  # noqa: E402
import jma  # noqa: E402
from parse import parse_b, parse_fan, parse_k  # noqa: E402
from run import fetch, fetch_fan  # noqa: E402
from train import coef_table, load_days, load_fan, train_all  # noqa: E402

ROOT = Path(__file__).resolve().parent
JST = timezone(timedelta(hours=9))
VENUES = {"01": "桐生", "02": "戸田", "03": "江戸川", "04": "平和島", "05": "多摩川", "06": "浜名湖",
          "07": "蒲郡", "08": "常滑", "09": "津", "10": "三国", "11": "びわこ", "12": "住之江",
          "13": "尼崎", "14": "鳴門", "15": "丸亀", "16": "児島", "17": "宮島", "18": "徳山",
          "19": "下関", "20": "若松", "21": "芦屋", "22": "福岡", "23": "唐津", "24": "大村"}


# ---------------------------------------------------------------- 履歴(学習用・非公開)
HIST_DAYS = 1095         # 履歴を持つ期間(日)。約3年
CAP_DAILY = 40           # 毎朝の追加取得の上限(ファイル数)。少しずつ過去へさかのぼる
CAP_BACKFILL = 600       # 手動の履歴づくり1回あたりの上限(ファイル数)。3秒間隔で約30〜40分
SLOW_PAUSE = 3.0         # 履歴づくりのときの1ファイルごとの待ち時間(秒)


def hist_dir() -> Path:
    hd = ROOT / "hist"
    hd.mkdir(exist_ok=True)
    return hd


def save_hist(d: date, races: list[dict], results: dict):
    """読み取った数字だけを保存(生ファイルは保存しない)。Actionsのキャッシュに入り、公開しない。"""
    hd = hist_dir()
    body = json.dumps({"v": 2, "races": races, "results": results}, ensure_ascii=False, separators=(",", ":"))
    (hd / f"{d:%Y%m%d}.json.gz").write_bytes(gzip.compress(body.encode("utf-8")))
    old = hd / f"{d:%Y%m%d}.json"
    if old.exists():
        old.unlink()


def has_v2(d: date) -> bool:
    return (hist_dir() / f"{d:%Y%m%d}.json.gz").exists()


def top_up_history(cap_files: int, pause: float):
    """直近 HIST_DAYS 日のうち、まだ無い日(新しい日から)を上限つきで取得。"""
    run_mod.PAUSE = pause
    today = datetime.now(JST).date()
    need = [today - timedelta(days=i) for i in range(1, HIST_DAYS + 1) if not has_v2(today - timedelta(days=i))]
    got = 0
    for d in need:
        if run_mod.N_FETCH[0] + 2 > cap_files:
            break
        races = parse_b(fetch("B", d), d)
        res = parse_k(fetch("K", d), d)
        save_hist(d, races, res)   # データが無い日も空で記録し、毎日取りに行かない
        got += 1
        print(d, len(races), "races", len(res), "results")
    left = len(need) - got
    print(f"history: +{got} days, missing {left} (files fetched this run: {run_mod.N_FETCH[0]})")
    run_mod.PAUSE = 1.0
    return left


def ensure_fan_files():
    """レーサー期別成績: 学習期間に必要な期のファイルだけ、無ければ1回だけ取得(年2回の公開)。"""
    fd = hist_dir() / "fan"
    fd.mkdir(exist_ok=True)
    today = datetime.now(JST).date()
    first = today - timedelta(days=HIST_DAYS + 240)
    for y in range(first.year, today.year + 1):
        for mth in (4, 10):
            yymm = f"{y % 100:02d}{mth:02d}"
            m2 = mth + 2
            avail = date(y + (m2 - 1) // 12, (m2 - 1) % 12 + 1, 1)
            if avail > today or avail < first:
                continue
            out = fd / f"fan{yymm}.json.gz"
            if out.exists():
                continue
            recs = parse_fan(fetch_fan(yymm))
            print(f"fan{yymm}: {len(recs)} racers")
            if recs:
                out.write_bytes(gzip.compress(json.dumps(recs, separators=(",", ":")).encode()))


def repay_history(days_back: int = 182, cap_files: int = 200):
    """v3: 履歴の競走成績に「全券種の払戻」を足す(以前は単勝・2連単・3連単だけ保存していた)。
    足りない日だけ K ファイルを取り直す(1ファイル3秒、上限つき)。保存するのは読み取った数字だけ。"""
    run_mod.PAUSE = SLOW_PAUSE
    hd = hist_dir()
    today = datetime.now(JST).date()
    got = 0
    for i in range(1, days_back + 1):
        d = today - timedelta(days=i)
        f = hd / f"{d:%Y%m%d}.json.gz"
        if not f.exists():
            continue
        j = json.loads(gzip.decompress(f.read_bytes()))
        res = j.get("results") or {}
        if not res or any("pay" in v for v in res.values()):
            continue
        if run_mod.N_FETCH[0] + 1 > cap_files:
            break
        new = parse_k(fetch("K", d), d)
        for k, v in res.items():
            if k in new:
                v["pay"] = new[k].get("pay", {})
        f.write_bytes(gzip.compress(json.dumps({**j, "results": res}, ensure_ascii=False, separators=(",", ":")).encode("utf-8")))
        got += 1
    print(f"repay: +{got} days (files fetched {run_mod.N_FETCH[0]})")
    run_mod.PAUSE = 1.0


def ensure_jma():
    """気象庁: 潮位表(地点×年で1回だけ)と、今朝のアメダス(1日1回、今後の検証用に貯める)。失敗しても予想は続ける。"""
    jd = hist_dir() / "jma"
    jd.mkdir(exist_ok=True)
    today = datetime.now(JST).date()
    try:
        years = list(range((today - timedelta(days=HIST_DAYS + 7)).year, today.year + 1))
        jma.ensure_tides(jd, years)
        jma.amedas_snapshot(jd, today)
    except Exception as e:  # noqa
        print("jma skipped:", e)


def refit():
    """時系列の検証(直近8週を1週ずつ、前のデータだけで学習して予想)→ 全期間で学習し直して保存。
    8週の学習外の予想で、券種ごとの確率の較正(model.json の calib)も作り直す。"""
    model, rep = train_all(hist_dir(), weeks=8)
    model["eval"] = rep
    model["coefs"] = coef_table(model)[:15]
    (ROOT / "model.json").write_text(json.dumps(model), encoding="utf-8")
    short = {k: v for k, v in rep.items() if k in ("test_from", "test_to", "lambda", "diff_vs_lane1", "beats_lane1")}
    for k in ("full", "base", "prior", "lane1"):
        if k in rep:
            short[k] = {kk: round(vv, 4) for kk, vv in rep[k].items() if isinstance(vv, float)}
    print("model", json.dumps(short, ensure_ascii=False))


def predict_day(d: date, races: list[dict], model: dict) -> list[dict]:
    days = load_days(hist_dir(), HIST_DAYS, before=d)
    _, tgt = build(days, load_fan(hist_dir()), target=(d, races), tides=jma.Tides(hist_dir() / "jma"))
    if not races:
        return []
    P = M.predict_model(model, tgt["X"], tgt["V"], ALLF)
    T = M.trifecta_probs(P, *model.get("lambda", [1.0, 1.0]))
    out = []
    for i, r in enumerate(races):
        top = np.argsort(-T[i])[:3]
        out.append({"probs": P[i].tolist(), "_T": T[i],
                    "trifecta": [(f"{a+1}-{b+1}-{c+1}", float(T[i, j])) for j, (a, b, c) in ((j, M.PERMS[j]) for j in top)]})
    return out


# ---------------------------------------------------------------- modes
def make_predictions(d: date, model: dict) -> dict | None:
    pf = ROOT / "predictions" / f"{d:%Y-%m-%d}.json"
    if pf.exists():  # 公開済みの予想は書き換えない(公開時刻を守る)
        print(f"predictions {d} already published; keep as is")
        return None
    races = parse_b(fetch("B", d), d)
    now = datetime.now(JST)
    preds, Ts = [], []
    for r, pr in zip(races, predict_day(d, races, model)):
        Ts.append(pr["_T"])
        p = pr["probs"]
        top = int(np.argmax(p))
        tri = pr["trifecta"]
        scored = datetime.fromisoformat(r["close"]) > now + timedelta(minutes=5)
        preds.append({"key": r["key"], "venue": r["venue"], "venue_name": VENUES[r["venue"]],
                      "race": r["race"], "close": r["close"], "scored": scored,
                      "probs": [round(x, 4) for x in p], "pick": top + 1, "tier": M.tier_of(max(p), (model.get("config") or {}).get("tiers")),
                      "trifecta": [[c, round(x, 4)] for c, x in tri],
                      # 番組表の公開データ(ページ・Xの「根拠の一言」用。予想の計算には使わない)
                      "title": r.get("title", ""),
                      "racers": [{"lane": b["lane"], "name": b["name"], "cls": b["cls"], "nat_win": b["nat_win"],
                                  "loc_win": b["loc_win"], "motor_2": b["motor_2"]} for b in r["boats"]]})
    out = {"date": d.isoformat(), "published_at": now.isoformat(timespec="seconds"),
           "model_fitted_at": model.get("fitted_at"), "model_version": model.get("version", 1), "races": preds}
    try:   # 券種ごとの仮の収支のため、複勝◎と3連複3点も締切前に出しておく(後から足すと後出しになるので、公開時に決める)
        import exp_bets
        Tm = np.array(Ts)
        top2 = Tm @ exp_bets.M_TOP2
        trio = Tm @ exp_bets.M_TRIO
        for i, x in enumerate(preds):
            x["fukusho"] = int(np.argmax(top2[i])) + 1
            x["trio"] = [[exp_bets.LBL["trio"][j], round(float(trio[i, j]), 4)] for j in np.argsort(-trio[i])[:3]]
        sc = [x for x in preds if x["scored"]]
        for x in sorted(sc, key=lambda x: (-max(x["probs"]), x["close"]))[:5]:
            x["star"] = True   # 今日の自信あり(ページ・Xと同じ決め方: ◎の1着率が高い順に5つ)
    except Exception as e:  # noqa
        print("extra picks skipped:", e)
    try:
        out["ana"] = ana_picks_today(d, preds, Ts)
    except Exception as e:  # noqa  (穴が作れなくても本命の予想は公開する)
        print("ana skipped:", e)
    pd = ROOT / "predictions"
    pd.mkdir(exist_ok=True)
    (pd / f"{d:%Y-%m-%d}.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"predictions {d}: {len(preds)} races, scored {sum(x['scored'] for x in preds)}")
    return out


ANA_DEFAULT = {"n_races_per_day": 3, "points": 5, "min_avg_payout": 5000}


def ana_picks_today(d: date, preds: list, Ts: list) -> dict:
    """今日の穴(万舟ねらい): 3連単の組番ごとの過去の平均払戻(前日まで)をオッズの代わりの目安にして、
    万舟になりそうなレースを選び、◎が1着の組番を除いた平均払戻の高い組番を確率の高い順に。決め方は exp_ana.py で検証。"""
    import exp_ana
    cf = ROOT / "ana_config.json"
    rule = json.loads(cf.read_text()) if cf.exists() else dict(ANA_DEFAULT)
    days = load_days(hist_dir(), HIST_DAYS, before=d)
    yy, y2, y3, pt = [], [], [], []
    for _, _, res in days:
        for v in res.values():
            o = v["order"]
            yy.append(o[0] - 1); y2.append(o[1] - 1); y3.append(o[2] - 1)
            pt.append(v["trifecta"].get(f"{o[0]}-{o[1]}-{o[2]}", 0))
    avg, _ = exp_ana.tri_pattern_avg(np.array(yy), np.array(y2), np.array(y3), np.array(pt, dtype=float))
    idx = [i for i, x in enumerate(preds) if x["scored"]]
    if not idx:
        return {"rule": rule, "races": []}
    P = np.array([preds[i]["probs"] for i in idx])
    T = np.array([Ts[i] for i in idx])
    p_man, picks = exp_ana.ana_picks(P, T, avg, rule["points"], rule["min_avg_payout"])
    order = np.argsort(-p_man)[:rule["n_races_per_day"]]
    out = []
    for j in sorted(order, key=lambda j: preds[idx[j]]["close"]):
        x = preds[idx[j]]
        combos = [[f"{a+1}-{b+1}-{c+1}", round(float(T[j, q]), 4), int(avg[q])] for q in picks[j] for a, b, c in [M.PERMS[q]]]
        out.append({"key": x["key"], "venue_name": x["venue_name"], "race": x["race"], "close": x["close"],
                    "p_manshu": round(float(p_man[j]), 4), "combos": combos})
    return {"rule": rule, "races": out}


def grade_ana(pred: dict, res: dict) -> tuple[dict | None, list]:
    a = pred.get("ana")
    if not a or not a.get("races"):
        return None, []
    rows = []
    for x in a["races"]:
        r = res.get(x["key"])
        if not r:
            continue
        o = r["order"]
        act = f"{o[0]}-{o[1]}-{o[2]}"
        hit = any(c == act for c, _, _ in x["combos"])
        pay = r["trifecta"].get(act, 0)
        rows.append({"key": x["key"], "venue_name": x["venue_name"], "race": x["race"], "combos": [c for c, _, _ in x["combos"]],
                     "actual": act, "trifecta_payout": pay, "hit": hit, "pay": pay if hit else 0,
                     "stake": 100 * len(x["combos"]), "manshu": pay >= 10000})
    s = {"races": len(rows), "hits": sum(r["hit"] for r in rows), "stake": sum(r["stake"] for r in rows),
         "return": sum(r["pay"] for r in rows), "manshu_hits": sum(1 for r in rows if r["hit"] and r["manshu"]),
         "manshu_races": sum(1 for r in rows if r["manshu"])}
    return s, rows


BET_NAMES = {"tansho": "単勝◎", "fukusho": "複勝◎", "trio3": "3連複3点", "trifecta3": "3連単3点"}


def by_bet(rows: list) -> dict:
    """券種ごとの仮の収支(100円ずつ)。{券種: {races, hits, stake, return, pnl}}"""
    out = {}
    for r in rows:
        for b, v in (r.get("bets") or {}).items():
            t = out.setdefault(b, {"races": 0, "hits": 0, "stake": 0, "return": 0})
            t["races"] += 1
            t["hits"] += v["return"] > 0
            t["stake"] += v["stake"]
            t["return"] += v["return"]
    for t in out.values():
        t["pnl"] = t["return"] - t["stake"]
        t["roi"] = round(t["return"] / max(t["stake"], 1), 4)
    return out


def grade(d: date) -> dict | None:
    pf = ROOT / "predictions" / f"{d:%Y-%m-%d}.json"
    if not pf.exists():
        print(f"no predictions for {d}")
        return None
    pred = json.loads(pf.read_text(encoding="utf-8"))
    res = parse_k(fetch("K", d), d)
    rows = []
    for r in pred["races"]:
        x = res.get(r["key"])
        if not x or not r["scored"]:
            continue
        o = x["order"]
        win_hit = r["pick"] == o[0]
        tri_combo = r["trifecta"][0][0]
        actual = f"{o[0]}-{o[1]}-{o[2]}"
        tri_hit = any(c == actual for c, _ in r["trifecta"])
        top_set = set(int(s) for s in tri_combo.split("-"))
        near = (not tri_hit) and (tri_combo[:3] == actual[:3] or top_set == set(o))
        verdict = "的中" if tri_hit else ("惜しい" if near else ("1着的中" if win_hit else "外れ"))
        pay_win = x["tansho"].get(str(r["pick"]), 0) if win_hit else 0
        pay_tri = x["trifecta"].get(actual, 0) if tri_hit else 0
        base_pay = x["tansho"].get("1", 0) if o[0] == 1 else 0
        pay = x.get("pay") or {}
        bets = {"tansho": {"stake": 100, "return": pay.get("tansho", {}).get(str(r["pick"]), 0)},
                "trifecta3": {"stake": 300, "return": pay.get("trifecta", x["trifecta"]).get(actual, 0) if tri_hit else 0}}
        if r.get("fukusho"):
            bets["fukusho"] = {"stake": 100, "return": pay.get("fukusho", {}).get(str(r["fukusho"]), 0)}
        if r.get("trio"):
            tset = "-".join(sorted(actual.split("-")))
            bets["trio3"] = {"stake": 300, "return": pay.get("trio", {}).get(tset, 0) if any(c == tset for c, _ in r["trio"]) else 0}
        rows.append({"bets": bets, "star": bool(r.get("star")), "fukusho": r.get("fukusho"), "trio": [c for c, _ in r.get("trio", [])],
                     "key": r["key"], "venue_name": r["venue_name"], "race": r["race"], "tier": r.get("tier"),
                     "pick": r["pick"], "trifecta": [c for c, _ in r["trifecta"]], "actual": actual,
                     "verdict": verdict, "win_hit": win_hit, "tri_hit": tri_hit,
                     "pay_win": pay_win, "pay_tri": pay_tri, "base_pay": base_pay,
                     "lane1_won": o[0] == 1, "trifecta_payout": x["trifecta"].get(actual),
                     "tansho_payout": x["tansho"].get(str(o[0]))})
    n = len(rows)
    summ = {"date": d.isoformat(), "graded_races": n,
            "win_hits": sum(r["win_hit"] for r in rows),
            "tri_hits": sum(r["tri_hit"] for r in rows),
            "near": sum(r["verdict"] == "惜しい" for r in rows),
            "stake_win": 100 * n, "return_win": sum(r["pay_win"] for r in rows),
            "stake_tri": 300 * n, "return_tri": sum(r["pay_tri"] for r in rows),
            "base_hits": sum(r["lane1_won"] for r in rows), "base_return": sum(r["base_pay"] for r in rows)}
    summ["by_bet"] = by_bet(rows)
    summ["star_by_bet"] = by_bet([r for r in rows if r.get("star")])
    gd = ROOT / "results"
    gd.mkdir(exist_ok=True)
    ana_s, ana_rows = grade_ana(pred, res)
    if ana_s:
        summ["ana"] = ana_s
    (gd / f"{d:%Y-%m-%d}.json").write_text(json.dumps({"summary": summ, "races": rows, "ana": ana_rows},
                                                      ensure_ascii=False, indent=1), encoding="utf-8")
    print("graded", json.dumps(summ, ensure_ascii=False))
    # オッズを使った紙の上だけの検証(止めてあるときは記録が無いので何もしない。結果は非公開)
    try:
        import odds_paper
        odds_paper.grade(d, res)
    except Exception as e:  # noqa
        print("paper grade skipped:", e)
    # 学習用の履歴にも足す(読み取った数字だけ。非公開のキャッシュ)
    save_hist(d, parse_b(fetch("B", d), d), res)
    return summ


def cumulative() -> dict:
    tot = {"days": 0, "graded_races": 0, "win_hits": 0, "tri_hits": 0, "near": 0, "stake_win": 0,
           "return_win": 0, "stake_tri": 0, "return_tri": 0, "base_hits": 0, "base_return": 0}
    daily = []
    for f in sorted((ROOT / "results").glob("*.json")):
        s = json.loads(f.read_text(encoding="utf-8"))["summary"]
        daily.append(s)
        tot["days"] += 1
        for k in tot:
            if k != "days":
                tot[k] += s.get(k, 0)
    n = max(tot["graded_races"], 1)
    tot["win_rate"] = round(tot["win_hits"] / n, 4)
    tot["base_win_rate"] = round(tot["base_hits"] / n, 4)
    tot["tri_rate"] = round(tot["tri_hits"] / n, 4)
    tot["roi_win"] = round(tot["return_win"] / max(tot["stake_win"], 1), 4)
    tot["roi_tri"] = round(tot["return_tri"] / max(tot["stake_tri"], 1), 4)
    tot["roi_base"] = round(tot["base_return"] / max(tot["graded_races"] * 100, 1), 4)
    ana = {"days": 0, "races": 0, "hits": 0, "stake": 0, "return": 0, "manshu_hits": 0, "manshu_races": 0}
    for s_ in daily:
        if s_.get("ana"):
            ana["days"] += 1
            for k in ana:
                if k != "days":
                    ana[k] += s_["ana"].get(k, 0)
    ana["roi"] = round(ana["return"] / max(ana["stake"], 1), 4)
    tot["ana"] = ana
    for key in ("by_bet", "star_by_bet"):
        agg = {}
        for s_ in daily:
            for b, v in (s_.get(key) or {}).items():
                t = agg.setdefault(b, {"days": 0, "races": 0, "hits": 0, "stake": 0, "return": 0})
                t["days"] += 1
                for k2 in ("races", "hits", "stake", "return"):
                    t[k2] += v.get(k2, 0)
        for t in agg.values():
            t["pnl"] = t["return"] - t["stake"]
            t["roi"] = round(t["return"] / max(t["stake"], 1), 4)
        tot[key] = agg
    tiers = {}
    for f in sorted((ROOT / "results").glob("*.json")):
        for x in json.loads(f.read_text(encoding="utf-8"))["races"]:
            if not x.get("tier"):
                continue
            t = tiers.setdefault(x["tier"], {"races": 0, "win_hits": 0, "base_hits": 0, "return_win": 0})
            t["races"] += 1
            t["win_hits"] += bool(x["win_hit"])
            t["base_hits"] += bool(x["lane1_won"])
            t["return_win"] += x.get("pay_win", 0)
    (ROOT / "summary.json").write_text(json.dumps({"total": tot, "tiers": tiers, "daily": daily}, ensure_ascii=False,
                                                  indent=1), encoding="utf-8")
    return tot


def main(mode: str):
    today = datetime.now(JST).date()
    if mode.startswith("backfill"):
        # 手動: 履歴を上限つきでさかのぼって作る(1ファイルごとに数秒あける)
        top_up_history(CAP_BACKFILL, SLOW_PAUSE)
        ensure_fan_files()
        ensure_jma()
        refit()
    elif mode == "refit":
        ensure_jma()
        refit()
    elif mode == "bets":
        # 全券種の払戻を履歴に足して(上限つき)、券種・自信度・選び方ごとの仮の回収率を検証
        repay_history()
        import exp_bets
        exp_bets.main(hist_dir())
    elif mode == "ana":
        # 「今日の穴(万舟ねらい)」の決め方の検証
        import exp_ana
        exp_ana.main(hist_dir())
    elif mode == "robots":
        # 公式サイトの robots.txt を確認するだけ(オッズは取得しない)
        import urllib.request
        out = []
        for u in ("https://www.boatrace.jp/robots.txt", "https://boatrace.jp/robots.txt"):
            try:
                req = urllib.request.Request(u, headers={"User-Agent": run_mod.UA})
                r = urllib.request.urlopen(req, timeout=30)
                out.append(f"# {u} -> {r.status}\n" + r.read().decode("utf-8", "replace")[:5000])
            except Exception as e:  # noqa
                out.append(f"# {u} -> {e}")
        (ROOT / "experiments").mkdir(exist_ok=True)
        (ROOT / "experiments" / "robots_boatrace.txt").write_text(f"checked {datetime.now(JST).isoformat(timespec='minutes')}\n" + "\n\n".join(out), encoding="utf-8")
        print("\n".join(out))
        return
    elif mode == "calib":
        # 券種ごとの組番の確率の当たり具合(新しい取得はしない)
        import exp_calib
        exp_calib.main(hist_dir())
    elif mode == "roi":
        # 舟券の種類・自信度・場ごとの仮の回収率(学習外。見つける期間と確かめる期間を分ける)
        import exp_roi
        exp_roi.main(hist_dir())
    elif mode == "exp":
        # 改良候補の検証(v3_ablation.json と model_config.json を作る)→ その構成で学習し直す
        ensure_jma()
        import exp_v3
        exp_v3.main(hist_dir())
        refit()
    else:  # daily
        grade(today - timedelta(days=1))
        left = top_up_history(CAP_DAILY, SLOW_PAUSE)   # 足りない過去分を毎朝少しずつ
        ensure_fan_files()
        ensure_jma()
        model = json.loads((ROOT / "model.json").read_text()) if (ROOT / "model.json").exists() else {}
        if today.weekday() == 0 or model.get("version") != 3:
            refit()   # 毎週月曜に学習し直す(採用した構成 model_config.json のまま。構成の見直しは手動の exp)
    model = json.loads((ROOT / "model.json").read_text())
    make_predictions(today, model)
    tot = cumulative()
    print("cumulative", json.dumps(tot, ensure_ascii=False))
    try:
        from site_gen import build  # type: ignore
        build()
    except ImportError:
        pass
