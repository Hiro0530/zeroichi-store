"""オッズを使った「紙の上だけ」の検証(ペーパートレード)。**いまは止めてある**(kyotei/odds_enabled.txt が無い限り何も取得しない)。

公式サイトのオッズのページを読むのは、BOAT RACE振興会の了承を得てから(README「オッズについて」)。了承が出たら:
  1) kyotei/odds_enabled.txt を作る(1行目に了承の日付と相手を書く)
  2) .github/workflows/kyotei-odds.yml の schedule のコメントを外す
決まりごと:
- 自信度 S のレースだけ(1日 約50レース)、締切の3〜9分前に1回だけ。単勝・複勝 / 2連単・2連複 / 3連複 / 3連単 の4ページ(1日の上限200回)。1ページごとに3秒以上あける。取り直さない。403/429/5xx でその日は止める。
- 確率は 券種ごとの較正(model.json の calib。直近8週の学習外の予想で毎週作り直す)→ 市場の確率と混ぜる(重み W_BLEND)の順。
  仮に買うのは単勝・2連単・3連複・3連単(混ぜた確率×オッズ ≥ 1.15、券種ごとに最大3点)。複勝・2連複は そのまま/較正/混ぜた の3つの期待値を記録するだけ。
- 読んだ時刻を記録し、翌朝の確定払戻(=当たった組番の確定オッズ)と比べて、オッズのずれを測る。
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
import urllib.error
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
EV_MIN = 1.15             # 仮に買う条件: 較正+市場と混ぜた確率 × オッズ
W_BLEND = 0.5             # モデルの重み(既定。券種ごとの値は W_BY_BET)
# 券種ごとのモデルの重み(2026-10-28、exp_v4 の確定オッズとの比較から): 2連単・3連単は確定オッズの方がモデルより
# 当たり具合がはっきり良く(対数損失 2連単 +0.04、3連単 +0.09 だけモデルが悪い)、線形に混ぜたときの最適なモデルの重みは
# 2連単 0.25・3連単 0.10(直前版)。0.5 のままだとモデルを信じすぎ、期待値1.15以上の「見かけの割安」が増える。
# 単勝は市場の確率の作り方(払戻率で割るだけ)に本命・大穴の偏りが残るので比較が決まらず、0.5 のまま。
# 締切前の記録がたまったら exp_blend.py(mode blend)で決め直す。
W_BY_BET = {"tansho": 0.5, "exacta": 0.25, "quinella": 0.25, "trio": 0.15, "trifecta": 0.10}
BET_TYPES = ("tansho", "exacta", "trio", "trifecta")   # 仮に買う券種(2026-10-26 オーナー判断で3連複・3連単も)。複勝・2連複は記録のみ
CORE = ("tf", "2tf", "3f", "3t")   # 毎回読むページ(単勝・複勝 / 2連単・2連複 / 3連複 / 3連単)。1日200回の上限で約50レース
OPTIONAL = ()
WINDOW = (3, 9)           # 締切の何分前に読むか
LOG_TOP = 8
MAX_PER_TYPE = 3
PAUSE = 3.0
MAX_REQ_DAY = 200  # 1日のリクエスト上限(安全装置)


class StopFetch(Exception):
    """403/429/5xx を受けたら、その日の取得をやめる"""


def others(*xs):
    return [b for b in range(1, 7) if b not in xs]


# 公式のオッズのページの並び(表の左上から右へ、上から下へ)。初回の取得で順位相関のチェックを通らなければ使わない
ORDER_3T = [(f, s, t) for r in range(20) for f in range(1, 7) for s, t in [[(s, t) for s in others(f) for t in others(f, s)][r]]]
ORDER_2T = [(f, others(f)[r]) for r in range(5) for f in range(1, 7)]
ORDER_2F = [(f, s) for s in range(2, 7) for f in range(1, s)]  # 2連複の三角表は「行=2着側の大きい番号、列=小さい番号」(2026-10-26 実物で確認)
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


def _grid3(html: str) -> dict:
    """3連単・3連複の表を、列(1着側の艇)ごとに rowspan を追って読む。空欄は飛ばす。"""
    out = {}
    tb = re.findall(r"<tbody[^>]*>(.*?)</tbody>", html, re.S)
    tb = [t for t in tb if "oddsPoint" in t]
    if not tb:
        return out
    rem, sec = [0] * 6, [None] * 6
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", tb[0], re.S):
        tds = re.findall(r"<td([^>]*)>\s*(.*?)\s*</td>", tr, re.S)
        i = 0
        for col in range(6):
            if rem[col] == 0:
                if i >= len(tds):
                    break
                a, v = tds[i]; i += 1
                m = re.search(r'rowspan="(\d+)"', a)
                rem[col] = int(m.group(1)) if m else 1
                sec[col] = re.sub("<[^>]+>", "", v).strip()
            if i + 1 >= len(tds) + 0 and i >= len(tds):
                break
            third = re.sub("<[^>]+>", "", tds[i][1]).strip(); oa, ov = tds[i + 1]; i += 2
            rem[col] -= 1
            o = _num(re.sub("<[^>]+>", "", ov)) if "oddsPoint" in oa else None
            if o and sec[col] and third:
                out[(col + 1, int(sec[col]), int(third))] = o
    return out


def parse(kind: str, html: str) -> dict:
    c = [_num(x) for x in _cells(html)]
    out = {}
    if kind == "tf" and len(c) >= 12:
        out["tansho"] = {str(i + 1): c[i] for i in range(6)}
        out["fukusho"] = {str(i + 1): c[6 + i] for i in range(6)}
    elif kind == "2tf" and len(c) >= 45:
        out["exacta"] = {f"{a}-{b}": c[i] for i, (a, b) in enumerate(ORDER_2T)}
        out["quinella"] = {f"{a}-{b}": c[30 + i] for i, (a, b) in enumerate(ORDER_2F)}
    elif kind == "3f":
        g = _grid3(html)
        out["trio"] = {"-".join(map(str, sorted(k))): v for k, v in g.items()}
    elif kind == "3t":
        g = _grid3(html)
        out["trifecta"] = {f"{a}-{b}-{e}": v for (a, b, e), v in g.items()}
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
    except urllib.error.HTTPError as e:
        time.sleep(PAUSE)
        if e.code in (403, 429) or e.code >= 500:
            raise StopFetch(f"{e.code} {url}")
        print("miss", url, e)
        b = ""
    except Exception as e:  # noqa
        print("miss", url, e)
        b = ""
    time.sleep(PAUSE)
    return b


def race_probs(x: dict, lam, maps=None, T=None) -> tuple[dict, dict]:
    """(そのままの確率, 較正した確率)。券種ごとに {組番: 確率}。T(3連単の確率、条件付きモデル)があればそれから作る"""
    import calib
    P = np.array([x["probs"]])
    pr, _ = exp_bets.probs_all(P, lam, T=None if T is None else np.array([T]))
    raw, cal = {}, {}
    for bet in pr:
        lab = exp_bets.LBL[bet]
        v = pr[bet][0]
        c = calib.apply(bet, v, maps, total=2.0 if bet == "fukusho" else 1.0) if bet in calib.BETS else v
        raw[bet] = {lab[j]: float(v[j]) for j in range(len(lab))}
        cal[bet] = {lab[j]: float(c[j]) for j in range(len(lab))}
    return raw, cal


def blend(cal: dict, odds: dict, w: float) -> tuple[dict, dict]:
    """市場の確率(オッズの逆数を合計1に直したもの)と混ぜる: p = 正規化(p_モデル^w × p_市場^(1-w))。→ (混ぜた確率, 市場の確率)"""
    ks = [k for k in odds if k in cal and odds[k] > 0]
    inv = np.array([1 / odds[k] for k in ks])
    pm = inv / inv.sum()
    pc = np.array([max(cal[k], 1e-9) for k in ks])
    pb = pc ** w * pm ** (1 - w)
    pb = pb / pb.sum()
    return dict(zip(ks, pb.tolist())), dict(zip(ks, pm.tolist()))


PRE_PAGE = "beforeinfo"   # 直前情報のページ(model.json の pre.live が true のときだけ、レースごとに1回)


def pre_probs(x: dict, d: date, model: dict, rec: dict):
    """直前情報のページを1回読んで、直前版の1着の確率と3連単の確率を作る。→ (P(6), T(120), 記録用の dict) か None。
    使えないとき(ページが怪しい・朝の特徴量が無い・model に pre が無い)は None(朝の確率のまま)。"""
    pre = model.get("pre")
    if not pre or not pre.get("live"):
        return None
    xf = PD / f"X_{d:%Y-%m-%d}.npz"
    if not xf.exists():
        return None
    import beforeinfo
    import cond as C
    from features import ALLF, apply_pre
    z = np.load(xf, allow_pickle=False)
    keys = list(z["keys"])
    if x["key"] not in keys:
        return None
    i = keys.index(x["key"])
    feats_saved = [str(f) for f in z["feats"]]
    Xr = np.zeros((6, len(ALLF)))
    for j, f in enumerate(feats_saved):
        if f in ALLF:
            Xr[:, ALLF.index(f)] = z["X"][i][:, j]
    rec["requests"] = rec.get("requests", 0) + 1
    url = beforeinfo.url(x["venue"], x["race"], d)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        html = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        time.sleep(PAUSE)
        if e.code in (403, 429) or e.code >= 500:
            raise StopFetch(f"{e.code} {url}")
        return None
    except Exception:  # noqa
        time.sleep(PAUSE)
        return None
    time.sleep(PAUSE)
    info = beforeinfo.parse(html)
    if not info:
        return None
    Xp = apply_pre(Xr, beforeinfo.as_result(info))[None]
    V = np.array([int(z["V"][i])])
    P = M.predict_model({"components": pre["components"]}, Xp, V, ALLF)
    T = C.trifecta(pre.get("cond") or model, P, Xp, V, model.get("lambda", [1.0, 1.0]))
    log = {"read_at": datetime.now(JST).isoformat(timespec="seconds"), "probs": [round(float(v), 4) for v in P[0]],
           "probs_morning": x["probs"], "exh": [b["exh"] for b in info["boats"]], "course": [b["course"] for b in info["boats"]],
           "st_exh": [b["st_exh"] for b in info["boats"]], "tilt": [b["tilt"] for b in info["boats"]],
           "parts": [b["parts"] for b in info["boats"]], "prop_new": [b["prop_new"] for b in info["boats"]], "wx": info["wx"]}
    return P[0], T[0], log


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
    model = json.loads((ROOT / "model.json").read_text())
    lam, maps = model.get("lambda", [1.0, 1.0]), model.get("calib")
    PD.mkdir(parents=True, exist_ok=True)
    rf = PD / f"{d:%Y-%m-%d}.json"
    rec = json.loads(rf.read_text()) if rf.exists() else {"date": d.isoformat(), "races": {}}
    rec["settings"] = {"window_min": WINDOW, "ev_min": EV_MIN, "w": W_BY_BET, "bet_types": list(BET_TYPES), "calibrated": bool(maps)}
    if rec.get("stopped"):
        print("stopped for today:", rec["stopped"])
        return
    Tf = PD / f"T_{d:%Y-%m-%d}.json.gz"
    Tmap = {}
    if Tf.exists():
        import gzip
        Tmap = json.loads(gzip.decompress(Tf.read_bytes()))
    targets = [x for x in pred["races"] if x.get("tier") in TIERS and x.get("scored", True)]
    for x in targets:
        if x["key"] in rec["races"]:
            continue
        mins = (datetime.fromisoformat(x["close"]) - now).total_seconds() / 60
        if not (WINDOW[0] <= mins <= WINDOW[1]):
            continue
        used = rec.get("requests", 0)
        per_race = len(CORE) + (1 if (model.get("pre") or {}).get("live") else 0)
        if used + per_race > MAX_REQ_DAY:
            print("daily request cap reached")
            return
        # 上限が足りなくなりそうなら、残りのレースのうち◎の確率が高いものを優先する
        rest = [y for y in targets if y["key"] not in rec["races"] and datetime.fromisoformat(y["close"]) > now + timedelta(minutes=WINDOW[0])]
        room = (MAX_REQ_DAY - used) // per_race
        if room < len(rest):
            keep_keys = {y["key"] for y in sorted(rest, key=lambda y: -max(y["probs"]))[:room]}
            if x["key"] not in keep_keys:
                rec["races"][x["key"]] = {"skipped": "cap_priority", "close": x["close"], "p_top": max(x["probs"])}
                rf.write_text(json.dumps(rec, ensure_ascii=False, indent=1))
                continue
        kinds = list(CORE)
        pre_log = None
        try:   # 直前版(model.json の pre.live が true のときだけ。読めなければ朝の確率のまま)
            got = pre_probs(x, d, model, rec)
        except StopFetch as e:
            rec["stopped"] = str(e)
            rf.write_text(json.dumps(rec, ensure_ascii=False, indent=1))
            print("STOP for today:", e)
            return
        except Exception as e:  # noqa
            print("pre skipped:", e)
            got = None
        if got:
            Pp, Tp, pre_log = got
            raw, cal = race_probs({**x, "probs": Pp.tolist()}, lam, (model.get("pre") or {}).get("calib") or maps, Tp.tolist())
        else:
            raw, cal = race_probs(x, lam, maps, Tmap.get(x["key"]))
        bets, logs, checks, pages = [], {}, {}, {}
        for kind in kinds:
            if kind in ("3f", "3t") and not checks.get("tansho"):   # 単勝のページの読み取りが怪しいときは3連複・3連単を読まない
                continue
            rec["requests"] = rec.get("requests", 0) + 1
            try:
                html = fetch(kind, x["venue"], x["race"], d)
            except StopFetch as e:
                rec["stopped"] = str(e)
                rf.write_text(json.dumps(rec, ensure_ascii=False, indent=1))
                print("STOP for today:", e)
                return
            pages[kind] = datetime.now(JST).isoformat(timespec="seconds")   # オッズを読んだ時刻(確定オッズとのずれを後で測る)
            for bet, odds in parse(kind, html).items():
                if bet not in raw:
                    continue
                ok = sane(bet, odds, raw[bet])
                checks[bet] = ok
                if not ok:
                    continue
                if bet == "fukusho":   # 複勝は当たりが2つあるので市場との混ぜ方が決まらない。較正した確率だけで記録
                    pb, pm = {k: cal[bet][k] for k in odds if k in cal[bet]}, {}
                else:
                    pb, pm = blend(cal[bet], odds, W_BY_BET.get(bet, W_BLEND))
                rows = []
                for k, o in odds.items():
                    if k not in pb:
                        continue
                    rows.append({"combo": k, "odds": o, "p_raw": round(raw[bet][k], 5), "p_cal": round(cal[bet][k], 5),
                                 "p_mkt": round(pm.get(k, 0.0), 5), "p_blend": round(pb[k], 5),
                                 "ev_raw": round(raw[bet][k] * o, 3), "ev_cal": round(cal[bet][k] * o, 3), "ev_blend": round(pb[k] * o, 3)})
                rows.sort(key=lambda r: -r["ev_blend"])
                logs[bet] = {"read_at": pages[kind], "top": rows[:LOG_TOP]}
                if bet == "tansho":   # 単勝は6艇ぶん全部残す(確定オッズとのずれを測るため)
                    logs[bet]["all_odds"] = {k: o for k, o in odds.items()}
                if bet in BET_TYPES:
                    for r in rows[:MAX_PER_TYPE]:
                        if r["ev_blend"] >= EV_MIN:
                            bets.append({"bet": bet, "combo": r["combo"], "odds": r["odds"], "read_at": pages[kind],
                                         "p_blend": r["p_blend"], "ev": r["ev_blend"], "ev_raw": r["ev_raw"], "ev_cal": r["ev_cal"]})
        rec["races"][x["key"]] = {"fetched_at": now.isoformat(timespec="seconds"), "close": x["close"], "tier": x.get("tier"),
                                  "pages": pages, "checks": checks, "bets": bets, "logs": logs, "pre": pre_log,
                                  "w": W_BY_BET}
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
        for b in r.get("bets", []):
            ret = (pay.get(b["bet"]) or {}).get(b["combo"], 0)
            b["return"] = ret
            t = by.setdefault(b["bet"], {"bets": 0, "hits": 0, "stake": 0, "return": 0})
            t["bets"] += 1; t["hits"] += ret > 0; t["stake"] += 100; t["return"] += ret
        # 確定オッズ(=当たった組番の払戻/100)と、読んだ時のオッズのずれ
        for bet, lg in (r.get("logs") or {}).items():
            for comb, amt in (pay.get(bet) or {}).items():
                o_read = (lg.get("all_odds") or {}).get(comb) or next((t["odds"] for t in lg.get("top", []) if t["combo"] == comb), None)
                if o_read:
                    rec.setdefault("drift", []).append({"key": key, "bet": bet, "combo": comb, "odds_read": o_read,
                                                        "odds_final": amt / 100, "read_at": lg.get("read_at"), "close": r.get("close")})
    # 直前版と朝の確率の答え合わせ(1着の対数損失・◎の的中)と、直前情報の風向の読み方の確認(競走成績の風向と同じか)
    pe = {"races": 0, "ll_pre": 0.0, "ll_morning": 0.0, "hit_pre": 0, "hit_morning": 0, "wind_dir_same": 0, "wind_dir_n": 0}
    for key, r in rec["races"].items():
        res = results.get(key)
        pl = r.get("pre")
        if not res or not pl:
            continue
        w = res["order"][0] - 1
        pe["races"] += 1
        pe["ll_pre"] += -float(np.log(max(pl["probs"][w], 1e-9)))
        pe["ll_morning"] += -float(np.log(max(pl["probs_morning"][w], 1e-9)))
        pe["hit_pre"] += int(np.argmax(pl["probs"]) == w)
        pe["hit_morning"] += int(np.argmax(pl["probs_morning"]) == w)
        a, b = (pl.get("wx") or {}).get("wind_dir"), (res.get("wx") or {}).get("wind_dir")
        if a and b:
            pe["wind_dir_n"] += 1
            pe["wind_dir_same"] += int(a == b)
    if pe["races"]:
        by["_pre_eval"] = pe
    rec["graded"] = by
    rf.write_text(json.dumps(rec, ensure_ascii=False, indent=1))
    sf = PD / "summary.json"
    summ = json.loads(sf.read_text()) if sf.exists() else {"days": {}}
    summ["days"][d.isoformat()] = by
    sf.write_text(json.dumps(summ, ensure_ascii=False, indent=1))
    print("paper graded", d, by)
    return by


WINDOWS = {"1": ("09:50", "12:48"), "2": ("12:51", "15:48"), "3": ("15:51", "18:48"), "4": ("18:51", "22:00")}


def loop(end_hm: str):
    """1回の実行の中で60秒ごとに tick。end_hm(JST)で終わる。遅れて起動しても、残りの時間をそのまま受け持つ。"""
    now = datetime.now(JST)
    h, m = map(int, end_hm.split(":"))
    end = now.replace(hour=h, minute=m, second=0, microsecond=0)
    if end <= now:
        print(f"window already over ({end_hm}); exit")
        return
    print(f"loop until {end:%H:%M}")
    while datetime.now(JST) < end:
        t0 = time.time()
        try:
            tick()
        except Exception as e:  # noqa  (1回の失敗で止めない)
            print("tick error:", e)
        rf = PD / f"{datetime.now(JST):%Y-%m-%d}.json"
        if rf.exists() and json.loads(rf.read_text()).get("stopped"):
            print("stopped for today; exit loop")
            return
        time.sleep(max(5.0, min(60 - (time.time() - t0), (end - datetime.now(JST)).total_seconds())))


if __name__ == "__main__":
    if sys.argv[1] == "loop":
        loop(WINDOWS[sys.argv[2]][1] if sys.argv[2] in WINDOWS else sys.argv[2])
    elif sys.argv[1] == "window":
        print(" ".join(WINDOWS[sys.argv[2]]))
    elif sys.argv[1] == "tick":
        tick()
    elif sys.argv[1] == "grade":
        import gzip
        dd = date.fromisoformat(sys.argv[2])
        h = json.loads(gzip.decompress((ROOT / "hist" / f"{dd:%Y%m%d}.json.gz").read_bytes()))
        grade(dd, h["results"])
