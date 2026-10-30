"""毎日の答え合わせの「券種ごと」の表(2026-10-30 オーナー指示)。summary.json・トップの前日の結果・X・本部の報告で同じ数字を使う。

- 券種ごと(単勝・2連単・2連複・3連単・3連複)に: 的中数/買った数(レース)、賭けた額、払戻の合計、当たったときの平均の倍率(確定オッズ)、回収率。
- 的中したレースは、場・レース・組番・確定オッズ(=払戻÷100)を全部並べる。外れのレースも数に入れる(買った数に含める)。
- 区分: 全レース / 自信あり上位5(star) / 荒れ予報TOP3(are)。買い目はどれも予想の公開時に決めたもの(後から足さない)。
- 金額は1点100円の仮の計算。的中・利益の保証ではない。
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent

# (キー, 券種, 買い方の説明)
ROWS_MAIN = [("tansho", "単勝", "◎ 1点"), ("exacta3", "2連単", "上位3点"), ("quinella3", "2連複", "上位3点"),
             ("trifecta3", "3連単", "上位3点"), ("trio3", "3連複", "上位3点")]
ROWS_SUB = [("exacta1", "2連単", "1点"), ("quinella1", "2連複", "1点"), ("fukusho", "複勝", "◎ 1点")]
ROWS_HEAD1 = [("h1_ex2", "2連単", "1-a・1-b 2点"), ("h1_qn2", "2連複", "1=a・1=b 2点"), ("h1_tri2", "3連単", "1-a-b・1-b-a 2点"),
              ("h1_tri4", "3連単", "1-ab-abc 4点"), ("h1_trio2", "3連複", "1を含む上位2点")]
ROWS_ARE = [("tan_34", "単勝", "3・4号艇の上位1点"), ("tri_34_6", "3連単", "3・4号艇頭 6点"), ("tri_non1_10", "3連単", "1号艇以外が頭 10点")]
KIND = {"tansho": "t", "fukusho": "f", "exacta1": "e", "exacta3": "e", "quinella1": "q", "quinella3": "q", "trifecta3": "3", "trio3": "r",
        "h1_ex2": "e", "h1_qn2": "q", "h1_tri2": "3", "h1_tri4": "3", "h1_trio2": "r", "tan_34": "t", "tri_34_6": "3", "tri_non1_10": "3",
        "cands": "3"}
GROUP_JP = {"all": "全レース", "star": "自信あり上位5", "are": "荒れ予報TOP3"}


def hit_combo(key: str, actual: str, fukusho=None) -> str:
    o = actual.split("-")
    k = KIND.get(key, "3")
    if k == "t":
        return o[0]
    if k == "f":
        return str(fukusho)
    if k == "e":
        return f"{o[0]}-{o[1]}"
    if k == "q":
        return "-".join(sorted(o[:2]))
    if k == "r":
        return "-".join(sorted(o[:3]))
    return actual


def _row(key, kind, label, items):
    """items: [(レース, {"stake", "return"})]"""
    t = {"key": key, "kind": kind, "label": label, "races": 0, "hits": 0, "stake": 0, "return": 0, "hit_list": []}
    for r, v in items:
        if not v or not v.get("stake"):
            continue
        t["races"] += 1
        t["stake"] += int(v["stake"])
        t["return"] += int(v["return"])
        if v["return"] > 0:
            t["hits"] += 1
            t["hit_list"].append({"key": r.get("key"), "venue_name": r.get("venue_name"), "race": r.get("race"),
                                  "combo": hit_combo(key, r.get("actual", ""), r.get("fukusho")), "odds": round(v["return"] / 100, 1),
                                  "payout": int(v["return"])})
    return _fin(t)


def _fin(t):
    t["roi"] = round(t["return"] / t["stake"], 4) if t["stake"] else None
    t["avg_odds"] = round(t["return"] / 100 / t["hits"], 2) if t["hits"] else None
    t["pnl"] = t["return"] - t["stake"]
    return t


def day(rows: list, are_rows: list | None = None) -> dict:
    """1日分。rows: results の races、are_rows: results の are(本命なしの全レース。top3 に買い目案 bets)"""
    out = {}
    groups = {"all": rows, "star": [r for r in rows if r.get("star")]}
    for g, rs in groups.items():
        if not rs:
            continue
        spec = ROWS_MAIN + ROWS_SUB + (ROWS_HEAD1 if g == "star" else [])
        tabs = [_row(k, kind, lab, [(r, (r.get("bets") or {}).get(k)) for r in rs]) for k, kind, lab in spec]
        out[g] = {"races": len(rs), "rows": [t for t in tabs if t["races"]]}
    are_rows = are_rows or []
    top = [a for a in are_rows if a.get("top3")]
    if top:
        by = {r["key"]: r for r in rows}
        rs = [by[a["key"]] for a in top if a["key"] in by]
        tabs = [_row(k, kind, lab, [(r, (r.get("bets") or {}).get(k)) for r in rs]) for k, kind, lab in ROWS_MAIN]
        tabs += [_row(k, kind, lab, [({**a, "actual": a["actual"]}, (a.get("bets") or {}).get(k)) for a in top]) for k, kind, lab in ROWS_ARE]
        cr = [a for a in are_rows if a.get("cands")]
        tabs.append(_row("cands", "3連単", "狙い 1号艇なし3点(本命なしの全レース)",
                         [(a, {"stake": 100 * len(a["cands"]), "return": a.get("cand_pay", 0)}) for a in cr]))
        out["are"] = {"races": len(rs), "lane1_lost": sum(not a.get("lane1_won") for a in top), "rows": [t for t in tabs if t["races"]]}
    return out


def total(days_reports: list) -> dict:
    """日ごとの表を足し合わせる(的中の一覧は持たない)。"""
    out = {}
    for rep in days_reports:
        for g, v in (rep or {}).items():
            o = out.setdefault(g, {"days": 0, "races": 0, "rows": {}})
            o["days"] += 1
            o["races"] += v.get("races", 0)
            for t in v.get("rows", []):
                u = o["rows"].setdefault(t["key"], {"key": t["key"], "kind": t["kind"], "label": t["label"], "races": 0, "hits": 0,
                                                     "stake": 0, "return": 0, "days": 0})
                u["days"] += 1
                for k in ("races", "hits", "stake", "return"):
                    u[k] += t[k]
    for o in out.values():
        o["rows"] = [_fin(u) for u in o["rows"].values()]
    return out


def yen(v) -> str:
    return f"{int(v):,}円"


def pct(x) -> str:
    return "—" if x is None else f"{x * 100:.0f}%"


def line(t: dict) -> str:
    od = f"平均{t['avg_odds']:.1f}倍" if t.get("avg_odds") else "的中なし"
    return f"{t['kind']}{t['label']} {t['hits']}/{t['races']} 払戻{yen(t['return'])}/{yen(t['stake'])} {od} 回収{pct(t['roi'])}"


def hq_text(date: str, rep: dict, total_rep: dict | None = None) -> str:
    """本部の報告用(券種ごとの表と、的中レースの確定オッズの一覧)。"""
    out = [f"■ {date} 答え合わせ(1点100円の仮の計算。的中・利益の保証ではありません)"]
    for g in ("star", "all", "are"):
        v = rep.get(g)
        if not v:
            continue
        head = f"【{GROUP_JP[g]}】{v['races']}レース" + (f"(1号艇の負け {v['lane1_lost']})" if g == "are" else "")
        out.append(head)
        for t in v["rows"]:
            if g == "all" and t["key"] not in dict((k, 1) for k, _, _ in ROWS_MAIN):
                continue
            out.append("・" + line(t))
            if g != "all" and t["hit_list"]:
                out.append("    的中: " + "、".join(f"{h['venue_name']}{h['race']}R {h['combo']} {h['odds']:.1f}倍" for h in t["hit_list"]))
    if total_rep:
        out.append("【公開からの累計】")
        for g in ("star", "all", "are"):
            v = total_rep.get(g)
            if not v:
                continue
            main = {k for k, _, _ in ROWS_MAIN + ROWS_HEAD1 + ROWS_ARE} | {"cands"}
            out.append(f"{GROUP_JP[g]}({v['days']}日・{v['races']}レース): " + " / ".join(
                f"{t['kind']}{t['label']} {t['hits']}/{t['races']} 回収{pct(t['roi'])}" for t in v["rows"] if t["key"] in main))
    out.append("舟券は20歳から。外れも全部数えています。")
    return "\n".join(out)


def x_text(date: str, rep: dict) -> str:
    """Xの答え合わせ(自信あり上位5を券種ごとに。全レースは3連単・3連複だけ)。"""
    m, d = date[5:7].lstrip("0"), date[8:10].lstrip("0")
    out = [f"【{m}/{d} 答え合わせ】"]
    v = rep.get("star")
    short = {"tansho": "単勝", "exacta3": "2連単3点", "quinella3": "2連複3点", "trifecta3": "3連単3点", "trio3": "3連複3点"}
    if v:
        out.append(f"自信あり{v['races']}R")
        for t in v["rows"]:
            if t["key"] in short:
                od = f" 平均{t['avg_odds']:.1f}倍" if t.get("avg_odds") else ""
                out.append(f"{short[t['key']]} {t['hits']}/{t['races']}{od} 回収{pct(t['roi'])}")
    a = rep.get("all")
    if a:
        bits = [f"{short[t['key']]} 回収{pct(t['roi'])}" for t in a["rows"] if t["key"] in ("trifecta3", "trio3")]
        out.append(f"全{a['races']}R " + "・".join(bits))
    out.append("外れも全部記録。的中は保証しません。舟券は20歳から")
    return "\n".join(out)


def for_results(f: Path) -> dict:
    """results のファイル1つ → その日の表(古い日は買い目のある券種だけ)。"""
    j = json.loads(f.read_text(encoding="utf-8"))
    return day(j.get("races") or [], j.get("are") or [])
