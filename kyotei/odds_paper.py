"""オッズを使った「紙の上だけ」の検証(ペーパートレード)。**いまは止めてある**(kyotei/odds_enabled.txt が無い限り何も取得しない)。

公式サイトのオッズのページを読むのは、BOAT RACE振興会の了承を得てから(README「オッズについて」)。了承が出たら:
  1) kyotei/odds_enabled.txt を作る(1行目に了承の日付と相手を書く)
  2) .github/workflows/kyotei-odds.yml の schedule のコメントを外す
決まりごと:
- 自信度 S のレースだけ(1日 約50レース)、締切の約10分前に1回だけ、券種ごとに1ページ(単勝・複勝 / 2連複 / 3連複 / 3連単 の最大4ページ)。1ページごとに3秒以上あける。取り直さない。
- オッズの表は保存も公開もしない。保存するのは「買うと決めた組番とそのときのオッズ」だけ(非公開の履歴 hist/paper/)。
- 期待値 = モデルの確率 × オッズ が しきい値 以上の組番だけ、仮に100円ずつ買ったことにする(実際には買わない)。翌朝の答え合わせで払戻を当てる。
- 読み取りが怪しいとき(オッズの逆数の合計が 1.05〜1.8 の外、またはモデルの確率とオッズの逆数の順位相関が 0.3 未満)は、そのページを使わない。
- 結果はページにもXにも出さない(非公開の hist/paper/summary.json と、控えの非公開リポジトリだけ)。

python kyotei/odds_paper.py tick     … いまが締切10分前前後のSのレースについて1回だけ取得して記録(止めてあるときは何もしない)
python kyotei/odds_paper.py grade D  … D(YYYY-MM-DD)の記録を、競走成績の払戻で答え合わせ
"""
from __future__ import annotations

import json
import re
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone
from itertools import combinations
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import exp_bets  # noqa: E402
import model2 as M  # noqa: E402

ROOT = Path(__file__).resolve().parent
PD = ROOT / "hist" / "paper"
JST = timezone(timedelta(hours=9))
ENABLED = ROOT / "odds_enabled.txt"
UA = "kyotei-kotaeawase/0.4 (+low-frequency; one odds page per bet type, ~10 min before close, tier S only)"
PAGES = {"tf": "oddstf", "2tf": "odds2tf", "3f": "odds3f", "3t": "odds3t"}
TIERS = ("S",)
EV_MIN = 1.2
MAX_PER_TYPE = 3
PAUSE = 3.0


def others(*xs):
    return [b for b in range(1, 7) if b not in xs]


# 公式のオッズのページの並び(表の左上から右へ、上から下へ)。初回の取得で順位相関のチェックを通らなければ使わない
ORDER_3T = [(f, s, t) for r in range(20) for f in range(1, 7) for s, t in [[(s, t) for s in others(f) for t in others(f, s)][r]]]
ORDER_2T = [(f, others(f)[r]) for r in range(5) for f in range(1, 7)]
ORDER_2F = [(f, f + 1 + r) for r in range(5) for f in range(1, 6) if f + 1 + r <= 6]
ORDER_3F = [c for c in combinations(range(1, 7), 3)]


def _cells(html: str) -> list[str]:
    return re.findall(r'class="oddsPoint[^"]*"[^>]*>\s*([^<]*?)\s*<', html)


def _num(s: str):
    s = s.strip()
    if "-" in s:   # 複勝・拡連複は「下限-上限」。下限を使う(控えめに)
        s = s.split("-")[0]
    try:
        return float(s)
    except ValueError:
        return None


def parse(kind: str, html: str) -> dict:
    c = [_num(x) for x in _cells(html)]
    out = {}
    if kind == "tf" and len(c) >= 12:
        out["tansho"] = {str(i + 1): c[i] for i in range(6)}
        out["fukusho"] = {str(i + 1): c[6 + i] for i in range(6)}
    elif kind == "2tf" and len(c) >= 45:
        out["exacta"] = {f"{a}-{b}": c[i] for i, (a, b) in enumerate(ORDER_2T)}
        out["quinella"] = {f"{a}-{b}": c[30 + i] for i, (a, b) in enumerate(ORDER_2F)}
    elif kind == "3f" and len(c) >= 20:
        out["trio"] = {f"{a}-{b}-{e}": c[i] for i, (a, b, e) in enumerate(ORDER_3F)}
    elif kind == "3t" and len(c) >= 120:
        out["trifecta"] = {f"{a}-{b}-{e}": c[i] for i, (a, b, e) in enumerate(ORDER_3T)}
    return {k: {kk: vv for kk, vv in v.items() if vv} for k, v in out.items()}


def sane(bet: str, odds: dict, prob: dict) -> bool:
    """読み取りの点検: オッズの逆数の合計(控除があるので1より大きい)と、モデルの確率との順位相関。"""
    ks = [k for k in odds if k in prob]
    if len(ks) < 5:
        return False
    inv = np.array([1 / odds[k] for k in ks])
    if bet not in ("fukusho",) and not (1.05 <= inv.sum() <= 1.8):
        return False
    p = np.array([prob[k] for k in ks])
    rc = np.corrcoef(np.argsort(np.argsort(inv)), np.argsort(np.argsort(p)))[0, 1]
    return bool(rc >= 0.3)


def fetch(kind: str, jcd: str, rno: int, d: date) -> str:
    url = f"https://www.boatrace.jp/owpc/pc/race/{PAGES[kind]}?rno={rno}&jcd={jcd}&hd={d:%Y%m%d}"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        b = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace")
    except Exception as e:  # noqa
        print("miss", url, e)
        b = ""
    time.sleep(PAUSE)
    return b


def race_probs(x: dict, lam) -> dict:
    P = np.array([x["probs"]])
    pr, _ = exp_bets.probs_all(P, lam)
    return {bet: {exp_bets.LBL[bet][j]: float(pr[bet][0, j]) for j in range(pr[bet].shape[1])} for bet in pr}


def tick(now: datetime | None = None):
    if not ENABLED.exists():
        print("odds paper trading is disabled (no kyotei/odds_enabled.txt)")
        return
    now = now or datetime.now(JST)
    d = now.date()
    pf = ROOT / "predictions" / f"{d:%Y-%m-%d}.json"
    if not pf.exists():
        return
    pred = json.loads(pf.read_text(encoding="utf-8"))
    lam = json.loads((ROOT / "model.json").read_text()).get("lambda", [1.0, 1.0])
    PD.mkdir(parents=True, exist_ok=True)
    rf = PD / f"{d:%Y-%m-%d}.json"
    rec = json.loads(rf.read_text()) if rf.exists() else {"date": d.isoformat(), "races": {}}
    for x in pred["races"]:
        if x.get("tier") not in TIERS or not x.get("scored", True) or x["key"] in rec["races"]:
            continue
        mins = (datetime.fromisoformat(x["close"]) - now).total_seconds() / 60
        if not (5 <= mins <= 15):
            continue
        probs = race_probs(x, lam)
        bets, checks = [], {}
        for kind in PAGES:
            got = parse(kind, fetch(kind, x["venue"], x["race"], d))
            for bet, odds in got.items():
                if bet not in ("tansho", "fukusho", "quinella", "trio", "trifecta"):
                    continue
                ok = sane(bet, odds, probs[bet])
                checks[bet] = ok
                if not ok:
                    continue
                ev = sorted(((probs[bet][k] * o, k, o) for k, o in odds.items() if k in probs[bet]), reverse=True)
                for e, k, o in ev[:MAX_PER_TYPE]:
                    if e >= EV_MIN:
                        bets.append({"bet": bet, "combo": k, "prob": round(probs[bet][k], 4), "odds": o, "ev": round(e, 3)})
        rec["races"][x["key"]] = {"fetched_at": now.isoformat(timespec="seconds"), "close": x["close"], "tier": x.get("tier"),
                                  "checks": checks, "bets": bets}
        rf.write_text(json.dumps(rec, ensure_ascii=False, indent=1))
        print(x["key"], len(bets), "paper bets", checks)


def grade(d: date, results: dict) -> dict | None:
    """results: その日の競走成績(parse_k の出力。全券種の払戻 pay を含む)"""
    rf = PD / f"{d:%Y-%m-%d}.json"
    if not rf.exists():
        return None
    rec = json.loads(rf.read_text())
    by = {}
    for key, r in rec["races"].items():
        res = results.get(key)
        if not res:
            continue
        pay = res.get("pay") or {}
        for b in r["bets"]:
            ret = (pay.get(b["bet"]) or {}).get(b["combo"], 0)
            b["return"] = ret
            t = by.setdefault(b["bet"], {"bets": 0, "hits": 0, "stake": 0, "return": 0})
            t["bets"] += 1; t["hits"] += ret > 0; t["stake"] += 100; t["return"] += ret
    rec["graded"] = by
    rf.write_text(json.dumps(rec, ensure_ascii=False, indent=1))
    sf = PD / "summary.json"
    summ = json.loads(sf.read_text()) if sf.exists() else {"days": {}}
    summ["days"][d.isoformat()] = by
    sf.write_text(json.dumps(summ, ensure_ascii=False, indent=1))
    print("paper graded", d, by)
    return by


if __name__ == "__main__":
    if sys.argv[1] == "tick":
        tick()
    elif sys.argv[1] == "grade":
        import gzip
        dd = date.fromisoformat(sys.argv[2])
        h = json.loads(gzip.decompress((ROOT / "hist" / f"{dd:%Y%m%d}.json.gz").read_bytes()))
        grade(dd, h["results"])
