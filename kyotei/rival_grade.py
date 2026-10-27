"""ほかのAI予想アカウントの公開の買い目を、私たちと同じレース・同じ券種・同じ点数でそろえて答え合わせする(RIVALS.md)。

python kyotei/rival_grade.py rivals.csv [--json out.json] [--k 3]

入力(UTF-8 の CSV、1行=1点):
  date,venue,race,source,bet_type,combo,rank[,posted_at]
  2026-10-28,大村,5,アカウントA,3連単,1-2-3,1
  - venue: 場の名前(大村)か2桁のコード(24)。race: レース番号。source: 予想元の名前(私たちの分は自動で足すので書かない)
  - bet_type: 単勝 / 複勝 / 2連単 / 2連複 / 拡連複 / 3連単 / 3連複。combo: 1-2-3 の形(連複は順不同でよい)
  - rank: その予想元が付けた順番(1が本命)。posted_at(任意): 投稿の時刻(ISO 8601)。締切より後の投稿は数えない
答え合わせ: 公式の競走成績(このリポジトリの results/、あれば非公開の hist/ の確定払戻)。X は読みに行かない(買い目は手で集める)。
比べ方:
  - 予想元ごとに、私たちが同じ日に公開した予想(predictions/、締切前の公開)のある同じレース・同じ券種だけを数える。
  - 上位1点の的中率と、上位k点(k=予想元が出した点数と私たちの点数の少ない方、最大 --k)の的中率。
  - 回収率は毎回100円/点。払戻が分からないレースは回収率から外し、その件数を出す。
  - 差(私たち − 予想元)は同じレースの対応ありで、レース単位のブートストラップ95%区間。的中率はウィルソンの95%区間。
"""
from __future__ import annotations

import argparse
import csv
import gzip
import json
import math
import sys
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
OURS = "ZEROICHI"
VENUES = {"01": "桐生", "02": "戸田", "03": "江戸川", "04": "平和島", "05": "多摩川", "06": "浜名湖",
          "07": "蒲郡", "08": "常滑", "09": "津", "10": "三国", "11": "びわこ", "12": "住之江",
          "13": "尼崎", "14": "鳴門", "15": "丸亀", "16": "児島", "17": "宮島", "18": "徳山",
          "19": "下関", "20": "若松", "21": "芦屋", "22": "福岡", "23": "唐津", "24": "大村"}
CODE = {v: k for k, v in VENUES.items()}
BET = {"単勝": "tansho", "複勝": "fukusho", "2連単": "exacta", "２連単": "exacta", "2連複": "quinella", "２連複": "quinella",
       "拡連複": "wide", "ワイド": "wide", "3連単": "trifecta", "３連単": "trifecta", "3連複": "trio", "３連複": "trio"}
JP = {"tansho": "単勝", "fukusho": "複勝", "exacta": "2連単", "quinella": "2連複", "wide": "拡連複", "trifecta": "3連単", "trio": "3連複"}
UNORDERED = {"quinella", "wide", "trio"}


def norm_combo(bet: str, s: str) -> str:
    xs = [c for c in s.replace("=", "-").replace("ー", "-").replace("－", "-").split("-") if c.strip()]
    xs = [str(int(c)) for c in xs]
    if bet in UNORDERED:
        xs = sorted(xs)
    return "-".join(xs)


def wilson(k, n, z=1.96):
    if n == 0:
        return (float("nan"), float("nan"))
    p = k / n
    den = 1 + z * z / n
    c = (p + z * z / (2 * n)) / den
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return (c - h, c + h)


def boot_ci(x, den=None, B=2000, seed=0):
    x = np.asarray(x, float)
    n = len(x)
    if n == 0:
        return (float("nan"), float("nan"))
    rng = np.random.default_rng(seed)
    ix = rng.integers(0, n, (B, n))
    bs = x[ix].mean(1) if den is None else x[ix].sum(1) / np.asarray(den, float)[ix].sum(1)
    return (float(np.percentile(bs, 2.5)), float(np.percentile(bs, 97.5)))


# ------------------------------------------------------------------ 公式の結果と私たちの予想
class Official:
    def __init__(self):
        self.res, self.pred, self.hist = {}, {}, {}

    def _day(self, d: str):
        if d in self.res:
            return
        rf, pf = ROOT / "results" / f"{d}.json", ROOT / "predictions" / f"{d}.json"
        self.res[d] = {r["key"]: r for r in json.loads(rf.read_text(encoding="utf-8"))["races"]} if rf.exists() else {}
        self.pred[d] = {r["key"]: r for r in json.loads(pf.read_text(encoding="utf-8"))["races"]} if pf.exists() else {}
        hf = ROOT / "hist" / f"{d.replace('-', '')}.json.gz"
        try:
            self.hist[d] = json.loads(gzip.decompress(hf.read_bytes()))["results"] if hf.exists() else {}
        except Exception:  # noqa
            self.hist[d] = {}

    def race(self, d: str, venue: str, rno: int):
        self._day(d)
        key = f"{d.replace('-', '')}-{venue}-{rno:02d}"
        return key, self.res[d].get(key), self.pred[d].get(key), self.hist[d].get(key)


def winners(bet: str, order: list[int]) -> set[str]:
    a, b, c = order
    return {"tansho": {f"{a}"}, "fukusho": {f"{a}", f"{b}"}, "exacta": {f"{a}-{b}"},
            "quinella": {"-".join(sorted((str(a), str(b))))},
            "wide": {"-".join(sorted((str(x), str(y)))) for x, y in ((a, b), (a, c), (b, c))},
            "trifecta": {f"{a}-{b}-{c}"}, "trio": {"-".join(sorted((str(a), str(b), str(c))))}}[bet]


def payout(bet: str, combo: str, res: dict, hist: dict | None):
    """100円あたりの払戻。当たっていなければ0。分からなければ None。"""
    order = [int(x) for x in res["actual"].split("-")]
    if combo not in winners(bet, order):
        return 0
    if hist:
        p = ((hist.get("pay") or {}).get(bet) or (hist.get(bet) if bet in ("tansho", "exacta", "trifecta") else None) or {})
        if combo in p:
            return p[combo]
    if bet == "tansho" and res.get("tansho_payout") is not None:
        return res["tansho_payout"]
    if bet == "trifecta" and res.get("trifecta_payout") is not None:
        return res["trifecta_payout"]
    if bet == "exacta" and res.get("exacta_payout") is not None:
        return res["exacta_payout"]
    return None


def our_picks(bet: str, pred: dict) -> list[str]:
    """公開した予想から、その券種の私たちの買い目(順番つき)。公開していない券種は []。"""
    if bet == "tansho":
        return [str(i + 1) for i in np.argsort(-np.array(pred["probs"]))]
    if bet == "fukusho":
        return [str(pred["fukusho"])] if pred.get("fukusho") else []
    if bet == "exacta":
        return [c for c, _ in pred.get("exacta", [])]
    if bet == "trifecta":
        return [c for c, _ in pred.get("trifecta", [])]
    if bet == "trio":
        return [c for c, _ in pred.get("trio", [])]
    return []


# ------------------------------------------------------------------ 本体
def load_csv(path: Path) -> tuple[dict, list]:
    picks = defaultdict(list)   # (source, date, venue, race, bet) -> [(rank, combo)]
    bad = []
    with open(path, encoding="utf-8-sig") as f:
        for i, row in enumerate(csv.DictReader(f), start=2):
            try:
                d = date.fromisoformat(row["date"].strip()).isoformat()
                v = row["venue"].strip()
                v = v.zfill(2) if v.isdigit() else CODE[v]
                bet = BET[row["bet_type"].strip()]
                combo = norm_combo(bet, row["combo"].strip())
                rk = int(row.get("rank") or 1)
                src = row["source"].strip()
                if src == OURS:
                    raise ValueError("source に ZEROICHI は使わない(自動で足す)")
                picks[(src, d, v, int(row["race"]), bet)].append((rk, combo, (row.get("posted_at") or "").strip()))
            except Exception as e:  # noqa
                bad.append(f"{i}行目: {e}")
    return picks, bad


def grade(picks: dict, kmax: int = 3) -> dict:
    off = Official()
    rows = defaultdict(list)   # (source, bet) -> [{...}]
    skipped = defaultdict(int)
    for (src, d, v, rno, bet), lst in picks.items():
        key, res, pred, hist = off.race(d, v, rno)
        if not res or not pred:
            skipped["公式の結果か私たちの予想が無いレース"] += 1
            continue
        lst = sorted(lst)
        late = [p for p in lst if p[2] and datetime.fromisoformat(p[2]) >= datetime.fromisoformat(pred["close"])]
        if late:
            skipped["締切より後の投稿"] += 1
            continue
        theirs = [c for _, c, _ in lst]
        ours = our_picks(bet, pred)
        if not ours:
            skipped[f"私たちが{JP[bet]}を公開していないレース"] += 1
            continue
        k = min(len(theirs), len(ours), kmax)
        r = {"key": key}
        for who, cs in (("them", theirs), ("us", ours)):
            pays1 = payout(bet, cs[0], res, hist)
            paysk = [payout(bet, c, res, hist) for c in cs[:k]]
            r[who] = {"hit1": pays1 != 0, "hitk": any(p != 0 for p in paysk), "ret1": pays1,
                      "retk": None if any(p is None for p in paysk) else sum(paysk), "stakek": 100 * k}
        r["k"] = k
        rows[(src, bet)].append(r)
    out = {"by_source_bet": [], "skipped": dict(skipped)}
    for (src, bet), rs in sorted(rows.items()):
        n = len(rs)
        ent = {"source": src, "bet": JP[bet], "races": n, "k_mean": round(float(np.mean([r["k"] for r in rs])), 2)}
        for who in ("them", "us"):
            h1 = np.array([r[who]["hit1"] for r in rs], float)
            hk = np.array([r[who]["hitk"] for r in rs], float)
            ok1 = [r for r in rs if r[who]["ret1"] is not None]
            okk = [r for r in rs if r[who]["retk"] is not None]
            ret1 = np.array([r[who]["ret1"] for r in ok1], float)
            retk = np.array([r[who]["retk"] for r in okk], float)
            stk = np.array([r[who]["stakek"] for r in okk], float)
            ent[who] = {"top1_hit": float(h1.mean()), "top1_ci": wilson(int(h1.sum()), n),
                        "topk_hit": float(hk.mean()), "topk_ci": wilson(int(hk.sum()), n),
                        "roi_top1": float(ret1.sum() / (100 * len(ok1))) if ok1 else None,
                        "roi_top1_ci": boot_ci(ret1, np.full(len(ok1), 100.0)) if ok1 else None, "roi_top1_races": len(ok1),
                        "roi_topk": float(retk.sum() / stk.sum()) if okk else None,
                        "roi_topk_ci": boot_ci(retk, stk) if okk else None, "roi_topk_races": len(okk)}
        d1 = np.array([r["us"]["hit1"] - r["them"]["hit1"] for r in rs], float)
        dk = np.array([r["us"]["hitk"] - r["them"]["hitk"] for r in rs], float)
        ent["diff_top1_pt"] = (float(d1.mean() * 100), *[x * 100 for x in boot_ci(d1)])
        ent["diff_topk_pt"] = (float(dk.mean() * 100), *[x * 100 for x in boot_ci(dk)])
        out["by_source_bet"].append(ent)
    return out


def pct(x, nd=1):
    return "—" if x is None or (isinstance(x, float) and math.isnan(x)) else f"{x*100:.{nd}f}%"


def ci(t):
    return "" if not t or any(math.isnan(v) for v in t) else f"[{t[0]*100:.1f}, {t[1]*100:.1f}]"


def print_table(rep: dict):
    print("予想元 × 券種(同じレース・同じ券種・同じ点数でそろえた比較。[ ]は95%区間)")
    for e in rep["by_source_bet"]:
        print(f"\n■ {e['source']} vs {OURS} / {e['bet']}  レース数 {e['races']}(上位k点の k 平均 {e['k_mean']})")
        print(f"  {'':10}{'1点目の的中':>18}{'上位k点の的中':>22}{'1点目の回収率':>24}{'上位k点の回収率':>24}")
        for who, name in (("them", e["source"]), ("us", OURS)):
            s = e[who]
            print(f"  {name[:10]:10}{pct(s['top1_hit']):>8} {ci(s['top1_ci']):>14}{pct(s['topk_hit']):>8} {ci(s['topk_ci']):>14}"
                  f"{pct(s['roi_top1']):>8} {ci(s['roi_top1_ci']):>14}(n={s['roi_top1_races']})"
                  f"{pct(s['roi_topk']):>8} {ci(s['roi_topk_ci']):>14}(n={s['roi_topk_races']})")
        a, lo, hi = e["diff_top1_pt"]
        b, lo2, hi2 = e["diff_topk_pt"]
        print(f"  差({OURS} − {e['source']}): 1点目 {a:+.1f}pt [{lo:+.1f}, {hi:+.1f}] / 上位k点 {b:+.1f}pt [{lo2:+.1f}, {hi2:+.1f}]")
        if e["races"] < 100:
            print("  ※ 100レース未満。差があるとは言えないことが多い(区間を見る)")
    if rep["skipped"]:
        print("\n数えなかったもの:", ", ".join(f"{k} {v}件" for k, v in rep["skipped"].items()))


def main(argv=None):
    ap = argparse.ArgumentParser(description="ほかの予想アカウントの買い目を、公式の結果で私たちと並べて答え合わせする")
    ap.add_argument("csv")
    ap.add_argument("--json")
    ap.add_argument("--k", type=int, default=3, help="上位k点の上限(既定3)")
    a = ap.parse_args(argv)
    picks, bad = load_csv(Path(a.csv))
    if bad:
        print("読めなかった行:", *bad[:20], sep="\n  ", file=sys.stderr)
    rep = grade(picks, a.k)
    rep["bad_rows"] = bad
    print_table(rep)
    if a.json:
        Path(a.json).write_text(json.dumps(rep, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
