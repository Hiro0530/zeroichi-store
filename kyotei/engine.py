"""kyotei engine: 公式の番組表(B)・競走成績(K)から、予想と答え合わせを作る。

方針(正直さのルール):
- 予想は公開時刻を記録し、締切が公開時刻より前のレースは採点しない。
- 答え合わせは全レース。的中も外れも全部残す。
- 「1号艇を毎回」という単純な買い方と並べて比べる。
- 仮の回収率(毎回100円)は確定払戻金から機械的に計算する。100%未満でもそのまま出す。
"""
from __future__ import annotations

import csv
import json
import math
import re
import sys
from datetime import date, datetime, timedelta, timezone
from itertools import permutations
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from run import fetch  # noqa: E402

ROOT = Path(__file__).resolve().parent
JST = timezone(timedelta(hours=9))
FW = str.maketrans("０１２３４５６７８９：", "0123456789:")
VENUES = {"01": "桐生", "02": "戸田", "03": "江戸川", "04": "平和島", "05": "多摩川", "06": "浜名湖",
          "07": "蒲郡", "08": "常滑", "09": "津", "10": "三国", "11": "びわこ", "12": "住之江",
          "13": "尼崎", "14": "鳴門", "15": "丸亀", "16": "児島", "17": "宮島", "18": "徳山",
          "19": "下関", "20": "若松", "21": "芦屋", "22": "福岡", "23": "唐津", "24": "大村"}
CLASSES = ["A1", "A2", "B1", "B2"]

ENTRY_RE = re.compile(r"^([1-6]) (\d{4})(.{4})(\d{2})(.{2})(\d{2})([AB][12])(.{40})")
NUM_SLICES = [(0, 5), (5, 11), (11, 16), (16, 22), (22, 25), (25, 31), (31, 34), (34, 40)]  # 固定幅
RACE_HDR_B = re.compile(r"^[\s　]*([０-９]{1,2})Ｒ.*?電話投票締切予定([０-９：:]+)")


# ---------------------------------------------------------------- parse
def parse_b(text: str, d: date) -> list[dict]:
    """番組表 → [{key, venue, race, close, boats:[{lane, racer, cls, nat_win, ...}]}]"""
    races, venue, cur = [], None, None
    for line in text.splitlines():
        m = re.match(r"^(\d{2})BBGN", line)
        if m:
            venue, cur = m.group(1), None
            continue
        if venue is None:
            continue
        m = RACE_HDR_B.match(line)
        if m:
            rno = int(m.group(1).translate(FW))
            hh, mm = m.group(2).translate(FW).split(":")[:2]
            close = datetime(d.year, d.month, d.day, int(hh), int(mm), tzinfo=JST)
            cur = {"key": f"{d:%Y%m%d}-{venue}-{rno:02d}", "venue": venue, "race": rno,
                   "close": close.isoformat(), "boats": []}
            races.append(cur)
            continue
        m = ENTRY_RE.match(line)
        if m and cur is not None:
            g = m.groups()
            try:
                v = [float(g[7][a:b]) for a, b in NUM_SLICES]
            except ValueError:
                continue
            cur["boats"].append({
                "lane": int(g[0]), "racer": g[1], "name": g[2].replace("　", ""), "age": int(g[3]),
                "weight": int(g[5]), "cls": g[6], "nat_win": v[0], "nat_2": v[1],
                "loc_win": v[2], "loc_2": v[3], "motor_2": v[5], "boat_2": v[7]})
    return [r for r in races if len(r["boats"]) == 6]


def parse_k(text: str, d: date) -> dict[str, dict]:
    """競走成績 → {key: {order:[lane...](1-3着), tansho, trifecta:{combo:pay}, exacta, ...}}"""
    out, venue, cur = {}, None, None
    for line in text.splitlines():
        m = re.match(r"^(\d{2})KBGN", line)
        if m:
            venue, cur = m.group(1), None
            continue
        if venue is None:
            continue
        m = re.match(r"^\s+(\d{1,2})R\s+\S", line)
        if m and "H" in line and "m" in line:
            rno = int(m.group(1))
            cur = {"order": {}, "tansho": {}, "trifecta": {}, "exacta": {}, "void": False}
            out[f"{d:%Y%m%d}-{venue}-{rno:02d}"] = cur
            continue
        if cur is None:
            continue
        m = re.match(r"^\s+(0[1-6])\s+([1-6])\s+\d{4}", line)
        if m:
            cur["order"][int(m.group(1))] = int(m.group(2))
            continue
        m = re.match(r"^\s+単勝\s+([1-6])\s+(\d+)", line)
        if m:
            cur["tansho"][m.group(1)] = int(m.group(2))
            continue
        m = re.match(r"^\s+２連単\s+([1-6]-[1-6])\s+(\d+)", line)
        if m:
            cur["exacta"][m.group(1)] = int(m.group(2))
            continue
        m = re.match(r"^\s+３連単\s+([1-6]-[1-6]-[1-6])\s+(\d+)", line)
        if m:
            cur["trifecta"][m.group(1)] = int(m.group(2))
            continue
        if "特払" in line or "返還" in line:
            cur["void"] = True
    res = {}
    for k, v in out.items():
        order = [v["order"].get(i) for i in (1, 2, 3)]
        if None in order or not v["trifecta"]:
            continue  # 中止・不成立などは採点しない
        res[k] = {"order": order, "tansho": v["tansho"], "exacta": v["exacta"],
                  "trifecta": v["trifecta"], "void": v["void"]}
    return res


# ---------------------------------------------------------------- features / model
def feats(race: dict) -> np.ndarray:
    """6艇 × 特徴量。レース内で相対化した値も入れる。"""
    rows = []
    for b in race["boats"]:
        loc = b["loc_win"] if b["loc_win"] > 0 else b["nat_win"]
        rows.append([b["nat_win"], b["nat_2"] / 10, loc, b["motor_2"] / 10, b["boat_2"] / 10,
                     *[1.0 if b["cls"] == c else 0.0 for c in CLASSES[:3]], (b["weight"] - 52) / 3])
    X = np.array(rows)
    rel = X[:, [0, 2, 3]] - X[:, [0, 2, 3]].mean(axis=0)
    return np.hstack([X, rel])


def design(race: dict, n_feat: int) -> np.ndarray:
    """[lane one-hot(6) | venue×lane one-hot(24*6) | features]"""
    v = int(race["venue"]) - 1
    D = np.zeros((6, 6 + 24 * 6 + n_feat))
    for i in range(6):
        D[i, i] = 1.0
        D[i, 6 + v * 6 + i] = 1.0
    D[:, 150:] = feats(race)
    return D


N_FEAT = 12


def fit(races: list[dict], results: dict, l2: float = 1.0, iters: int = 400) -> dict:
    Xs, ys = [], []
    for r in races:
        res = results.get(r["key"])
        if not res:
            continue
        Xs.append(design(r, N_FEAT))
        ys.append(res["order"][0] - 1)
    X = np.stack(Xs)  # (n, 6, p)
    y = np.array(ys)
    n, _, p = X.shape
    mu = X[:, :, 150:].reshape(-1, N_FEAT).mean(0)
    sd = X[:, :, 150:].reshape(-1, N_FEAT).std(0) + 1e-9
    X[:, :, 150:] = (X[:, :, 150:] - mu) / sd
    w = np.zeros(p)
    reg = np.full(p, l2)
    reg[:6] = 0.01          # 枠の全体効果はほぼ自由
    reg[6:150] = l2 * 5     # 場×枠は全体に寄せる
    lr = 0.5
    for _ in range(iters):  # 勾配法(フルバッチ)
        u = X @ w
        u -= u.max(1, keepdims=True)
        P = np.exp(u)
        P /= P.sum(1, keepdims=True)
        Y = np.zeros_like(P)
        Y[np.arange(n), y] = 1
        g = np.einsum("nk,nkp->p", P - Y, X) / n + reg * w / n
        w -= lr * g
    u = X @ w
    P = np.exp(u - u.max(1, keepdims=True))
    P /= P.sum(1, keepdims=True)
    ll = float(np.log(P[np.arange(n), y]).mean())
    acc = float((P.argmax(1) == y).mean())
    base = float((y == 0).mean())
    return {"w": w.tolist(), "mu": mu.tolist(), "sd": sd.tolist(), "n_races": int(n),
            "train_logloss": ll, "train_top1": acc, "train_lane1_rate": base,
            "fitted_at": datetime.now(JST).isoformat(timespec="minutes")}


def predict(race: dict, model: dict) -> list[float]:
    X = design(race, N_FEAT)
    X[:, 150:] = (X[:, 150:] - np.array(model["mu"])) / np.array(model["sd"])
    u = X @ np.array(model["w"])
    p = np.exp(u - u.max())
    return (p / p.sum()).tolist()


def trifecta_top(p: list[float], k: int = 3) -> list[tuple[str, float]]:
    """Plackett-Luce(Harville)で3連単の確率を出し、上位k点。"""
    out = []
    for a, b, c in permutations(range(6), 3):
        pr = p[a] * p[b] / (1 - p[a]) * p[c] / (1 - p[a] - p[b])
        out.append((f"{a+1}-{b+1}-{c+1}", pr))
    out.sort(key=lambda t: -t[1])
    return out[:k]


# ---------------------------------------------------------------- storage
def save_hist(d: date, races: list[dict], results: dict):
    hd = ROOT / "hist"
    hd.mkdir(exist_ok=True)
    (hd / f"{d:%Y%m%d}.json").write_text(json.dumps({"races": races, "results": results},
                                                     ensure_ascii=False, separators=(",", ":")),
                                         encoding="utf-8")


def load_hist(days: int = 120) -> tuple[list[dict], dict]:
    races, results = [], {}
    files = sorted((ROOT / "hist").glob("*.json"))[-days:]
    for f in files:
        j = json.loads(f.read_text(encoding="utf-8"))
        races += j["races"]
        results.update(j["results"])
    return races, results


# ---------------------------------------------------------------- modes
def make_predictions(d: date, model: dict) -> dict | None:
    pf = ROOT / "predictions" / f"{d:%Y-%m-%d}.json"
    if pf.exists():  # 公開済みの予想は書き換えない(公開時刻を守る)
        print(f"predictions {d} already published; keep as is")
        return None
    races = parse_b(fetch("B", d), d)
    now = datetime.now(JST)
    preds = []
    for r in races:
        p = predict(r, model)
        top = int(np.argmax(p))
        tri = trifecta_top(p, 3)
        scored = datetime.fromisoformat(r["close"]) > now + timedelta(minutes=5)
        preds.append({"key": r["key"], "venue": r["venue"], "venue_name": VENUES[r["venue"]],
                      "race": r["race"], "close": r["close"], "scored": scored,
                      "probs": [round(x, 4) for x in p], "pick": top + 1,
                      "trifecta": [[c, round(x, 4)] for c, x in tri]})
    out = {"date": d.isoformat(), "published_at": now.isoformat(timespec="seconds"),
           "model_fitted_at": model.get("fitted_at"), "races": preds}
    pd = ROOT / "predictions"
    pd.mkdir(exist_ok=True)
    (pd / f"{d:%Y-%m-%d}.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"predictions {d}: {len(preds)} races, scored {sum(x['scored'] for x in preds)}")
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
        rows.append({"key": r["key"], "venue_name": r["venue_name"], "race": r["race"],
                     "pick": r["pick"], "trifecta": [c for c, _ in r["trifecta"]], "actual": actual,
                     "verdict": verdict, "win_hit": win_hit, "tri_hit": tri_hit,
                     "pay_win": pay_win, "pay_tri": pay_tri, "base_pay": base_pay,
                     "lane1_won": o[0] == 1, "trifecta_payout": x["trifecta"].get(actual)})
    n = len(rows)
    summ = {"date": d.isoformat(), "graded_races": n,
            "win_hits": sum(r["win_hit"] for r in rows),
            "tri_hits": sum(r["tri_hit"] for r in rows),
            "near": sum(r["verdict"] == "惜しい" for r in rows),
            "stake_win": 100 * n, "return_win": sum(r["pay_win"] for r in rows),
            "stake_tri": 300 * n, "return_tri": sum(r["pay_tri"] for r in rows),
            "base_hits": sum(r["lane1_won"] for r in rows), "base_return": sum(r["base_pay"] for r in rows)}
    gd = ROOT / "results"
    gd.mkdir(exist_ok=True)
    (gd / f"{d:%Y-%m-%d}.json").write_text(json.dumps({"summary": summ, "races": rows},
                                                      ensure_ascii=False, indent=1), encoding="utf-8")
    print("graded", json.dumps(summ, ensure_ascii=False))
    # 学習用の履歴にも足す
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
    (ROOT / "summary.json").write_text(json.dumps({"total": tot, "daily": daily}, ensure_ascii=False,
                                                  indent=1), encoding="utf-8")
    return tot


def backfill(days: int):
    today = datetime.now(JST).date()
    for i in range(days, 0, -1):
        d = today - timedelta(days=i)
        if (ROOT / "hist" / f"{d:%Y%m%d}.json").exists():
            continue
        races = parse_b(fetch("B", d), d)
        res = parse_k(fetch("K", d), d)
        save_hist(d, races, res)
        print(d, len(races), "races", len(res), "results")


def refit():
    races, results = load_hist(120)
    # 直近7日を検証用に取り分けて、学習外の成績も記録する
    keys_by_day = sorted({r["key"][:8] for r in races})
    hold = set(keys_by_day[-7:]) if len(keys_by_day) >= 14 else set()
    tr = [r for r in races if r["key"][:8] not in hold]
    te = [r for r in races if r["key"][:8] in hold]
    m = fit(tr, results) if hold else {}
    hit = base = n = 0
    ll = 0.0
    for r in te:
        x = results.get(r["key"])
        if not x:
            continue
        p = predict(r, m)
        n += 1
        hit += int(np.argmax(p)) + 1 == x["order"][0]
        base += x["order"][0] == 1
        ll += math.log(max(p[x["order"][0] - 1], 1e-9))
    holdout = {"races": n, "top1": round(hit / max(n, 1), 4),
               "lane1_rate": round(base / max(n, 1), 4), "logloss": round(ll / max(n, 1), 4)} if n else {}
    m = {**fit(races, results), "holdout": holdout}  # 本番は全期間で学習し直す
    (ROOT / "model.json").write_text(json.dumps(m), encoding="utf-8")
    print("model", json.dumps({k: v for k, v in m.items() if k not in ("w", "mu", "sd")}, ensure_ascii=False))


def main(mode: str):
    today = datetime.now(JST).date()
    if mode.startswith("backfill"):
        days = int(mode.split(":")[1]) if ":" in mode else 60
        backfill(days)
        refit()
        make_predictions(today, json.loads((ROOT / "model.json").read_text()))
    elif mode == "daily":
        grade(today - timedelta(days=1))
        n_hist = len(list((ROOT / "hist").glob("*.json"))) if (ROOT / "hist").exists() else 0
        if n_hist < 30:  # 学習用の履歴(キャッシュ)が消えていたら作り直す
            backfill(60)
        if today.weekday() == 0 or n_hist < 30 or not (ROOT / "model.json").exists():
            refit()
        make_predictions(today, json.loads((ROOT / "model.json").read_text()))
    tot = cumulative()
    print("cumulative", json.dumps(tot, ensure_ascii=False))
    try:
        from site_gen import build  # type: ignore
        build()
    except ImportError:
        pass
