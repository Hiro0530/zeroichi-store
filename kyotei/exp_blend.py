"""モデルと市場(締切前に読んだ単勝オッズ)の混ぜ方の重みを、紙の上の記録(非公開の hist/paper/)から決める。新しい取得はしない。

python kyotei/exp_blend.py [hist_dir]

- 単勝は読んだ時の6艇のオッズが全部残っている(odds_paper の logs.tansho.all_odds)ので、混ぜた確率をきちんと正規化できる。
- 混ぜ方: odds_paper.blend と同じ p ∝ p_モデル^w × p_市場^(1−w)(市場=オッズの逆数を合計1に直したもの)。
- モデルの確率: 朝の確率(較正なし・較正あり)、直前版があればそれも。
- 締切までの分(読んだ時刻→締切)ごとに、w=0〜1 の対数損失。前半の日で w を選び、後半の日で評価(日が少ないうちは参考)。
出力: experiments/blend.json(集計の数字だけ。オッズそのものは含まない)
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
JST = timezone(timedelta(hours=9))
WS = np.round(np.arange(0, 1.0001, 0.1), 2)


def load(hist: Path):
    import gzip
    rows = []
    for f in sorted((hist / "paper").glob("20??-??-??.json")):
        rec = json.loads(f.read_text())
        hf = hist / f"{f.stem.replace('-', '')}.json.gz"
        if not hf.exists():
            continue
        res = json.loads(gzip.decompress(hf.read_bytes()))["results"]
        pf = ROOT / "predictions" / f"{f.stem}.json"
        pred = {x["key"]: x for x in json.loads(pf.read_text(encoding="utf-8"))["races"]} if pf.exists() else {}
        for key, r in rec.get("races", {}).items():
            lg = ((r.get("logs") or {}).get("tansho") or {})
            odds = lg.get("all_odds")
            if not odds or key not in res or key not in pred or len(odds) < 6:
                continue
            o = np.array([float(odds.get(str(i + 1), 0) or 0) for i in range(6)])
            if (o <= 0).any():
                continue
            mins = (datetime.fromisoformat(r["close"]) - datetime.fromisoformat(lg["read_at"])).total_seconds() / 60
            pm = (1 / o) / (1 / o).sum()
            row = {"day": f.stem, "y": res[key]["order"][0] - 1, "pm": pm, "pk": np.array(pred[key]["probs"]), "mins": mins}
            if r.get("pre"):
                row["pp"] = np.array(r["pre"]["probs"])
            rows.append(row)
    return rows


def ll(rows, w, key):
    out = []
    for r in rows:
        if key not in r:
            continue
        p = np.clip(r[key], 1e-9, 1) ** w * np.clip(r["pm"], 1e-9, 1) ** (1 - w)
        p = p / p.sum()
        out.append(-np.log(p[r["y"]]))
    return np.array(out)


def main(hist: Path):
    rows = load(hist)
    rep = {"generated_at": datetime.now(JST).isoformat(timespec="minutes"), "races": len(rows),
           "days": sorted({r["day"] for r in rows})}
    if len(rows) < 50:
        rep["note"] = "記録が50レース未満。決めない"
    days = rep["days"]
    half = set(days[: len(days) // 2])
    for key, name in (("pk", "morning"), ("pp", "pre")):
        sub = [r for r in rows if key in r]
        if len(sub) < 30:
            continue
        sel = [r for r in sub if r["day"] in half]
        conf = [r for r in sub if r["day"] not in half]
        curve = {str(w): round(float(ll(sub, w, key).mean()), 5) for w in WS}
        ent = {"races": len(sub), "curve_all": curve}
        if sel and conf:
            wbest = float(WS[int(np.argmin([ll(sel, w, key).mean() for w in WS]))])
            a, b = ll(conf, wbest, key), ll(conf, 0.0, key)
            d = a - b
            rng = np.random.default_rng(0)
            bs = [d[rng.integers(0, len(d), len(d))].mean() for _ in range(2000)]
            ent.update({"w_selected": wbest, "confirm_races": len(conf), "confirm_ll_blend": round(float(a.mean()), 5),
                        "confirm_ll_market": round(float(b.mean()), 5),
                        "confirm_diff": [round(float(d.mean()), 5), round(float(np.percentile(bs, 2.5)), 5), round(float(np.percentile(bs, 97.5)), 5)]})
        by_t = {}
        for lo, hi in ((0, 6), (6, 12), (12, 30), (30, 999)):
            s2 = [r for r in sub if lo <= r["mins"] < hi]
            if len(s2) >= 20:
                c2 = [float(ll(s2, w, key).mean()) for w in WS]
                by_t[f"{lo}-{hi}分前"] = {"races": len(s2), "w_best": float(WS[int(np.argmin(c2))]), "ll_market": round(c2[0], 5),
                                         "ll_best": round(min(c2), 5)}
        ent["by_minutes_to_close"] = by_t
        rep[name] = ent
    (ROOT / "experiments").mkdir(exist_ok=True)
    (ROOT / "experiments" / "blend.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(rep, ensure_ascii=False)[:2000])


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "hist")
