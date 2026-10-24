"""公式ダウンロードデータの読み取り(番組表 B / 競走成績 K / レーサー期別成績 fan)。

ここで読んだ内容は、学習用の履歴(Actionsのキャッシュ、非公開)にだけ保存する。
生ファイルそのものは保存も公開もしない。
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone

JST = timezone(timedelta(hours=9))
FW = str.maketrans("０１２３４５６７８９：", "0123456789:")

ENTRY_RE = re.compile(r"^([1-6]) (\d{4})(.{4})(\d{2})(.{2})(\d{2})([AB][12])(.{40})(.*)$")
NUM_SLICES = [(0, 5), (5, 11), (11, 16), (16, 22), (22, 25), (25, 31), (31, 34), (34, 40)]  # 固定幅
RACE_HDR_B = re.compile(r"^[\s　]*([０-９]{1,2})Ｒ(.*?)電話投票締切予定([０-９：:]+)")
K_BOAT_RE = re.compile(r"^\s+(\S{1,2})\s+([1-6])\s+(\d{4})\s(.{8})(.*)$")
K_HDR_RE = re.compile(r"^\s+(\d{1,2})R\s+(.*?)\s+H(\d{3,4})m\s+(\S+)\s+風\s+(\S+)\s+(\d+)m\s+波\s+(\d+)cm")


# ---------------------------------------------------------------- 番組表
def _konsetsu(s: str) -> dict:
    """今節成績(この節の、その日より前の着順)。数字=着順、F/L/K/S等=事故・欠場。"""
    fins = [int(c) for c in s if c in "123456"]
    return {"n": len(fins), "pts": sum(fins), "f": s.count("F"), "bad": sum(1 for c in s if c in "LKS転落沈妨欠失エ")}


def parse_b(text: str, d: date) -> list[dict]:
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
            hh, mm = m.group(3).translate(FW).split(":")[:2]
            close = datetime(d.year, d.month, d.day, int(hh), int(mm), tzinfo=JST)
            title = re.sub(r"Ｈ[０-９]+ｍ.*$", "", m.group(2)).replace("　", " ").strip()
            cur = {"key": f"{d:%Y%m%d}-{venue}-{rno:02d}", "venue": venue, "race": rno,
                   "close": close.isoformat(), "title": title[:20],
                   "fixed": "進入固定" in title, "boats": []}
            races.append(cur)
            continue
        m = ENTRY_RE.match(line)
        if m and cur is not None:
            g = m.groups()
            try:
                v = [float(g[7][a:b]) for a, b in NUM_SLICES]
            except ValueError:
                continue
            rest = g[8]
            cur["boats"].append({
                "lane": int(g[0]), "racer": g[1], "name": g[2].replace("　", ""), "age": int(g[3]),
                "weight": int(g[5]), "cls": g[6], "nat_win": v[0], "nat_2": v[1],
                "loc_win": v[2], "loc_2": v[3], "motor_no": int(v[4]), "motor_2": v[5],
                "boat_no": int(v[6]), "boat_2": v[7], "ks": _konsetsu(rest[1:13])})
    return [r for r in races if len(r["boats"]) == 6]


# ---------------------------------------------------------------- 競走成績
def _st(s: str):
    """スタートタイミング。'0.13' / 'F.01'(フライング) / 'L' など。"""
    s = s.strip()
    if not s:
        return None, False
    flying = s.startswith("F")
    num = re.sub(r"[^0-9.]", "", s)
    if num.startswith("."):
        num = "0" + num
    try:
        x = float(num)
    except ValueError:
        return None, flying
    return (-x if flying else x), flying


def parse_k(text: str, d: date) -> dict[str, dict]:
    """→ {key: {order:[1-3着の艇], tansho, exacta, trifecta, void, boats:[...], wx:{...}, kimarite}}"""
    out, venue, cur = {}, None, None
    for line in text.splitlines():
        m = re.match(r"^(\d{2})KBGN", line)
        if m:
            venue, cur = m.group(1), None
            continue
        if venue is None:
            continue
        m = re.match(r"^\s+(\d{1,2})R\s+\S", line)
        if m and "H" in line and "m" in line and "波" in line:
            rno = int(m.group(1))
            wx = {}
            h = K_HDR_RE.match(line)
            if h:
                wx = {"weather": h.group(4).replace("　", ""), "wind_dir": h.group(5).replace("　", ""),
                      "wind": int(h.group(6)), "wave": int(h.group(7)), "dist": int(h.group(3))}
            cur = {"order": {}, "tansho": {}, "trifecta": {}, "exacta": {}, "void": False,
                   "boats": [], "wx": wx, "kimarite": ""}
            out[f"{d:%Y%m%d}-{venue}-{rno:02d}"] = cur
            continue
        if cur is None:
            continue
        if "着 艇 登番" in line:
            km = re.search(r"ﾚｰｽﾀｲﾑ\s*(\S+)", line)
            cur["kimarite"] = km.group(1).replace("　", "") if km else ""
            continue
        m = K_BOAT_RE.match(line)
        if m and not line.strip().startswith(("単勝", "複勝")):
            code, lane, racer, _name, rest = m.groups()
            toks = rest.split()
            fin = int(code) if code.isdigit() and 1 <= int(code) <= 6 else 7
            b = {"lane": int(lane), "racer": racer, "fin": fin, "code": code}
            # rest: モーター ボート 展示 進入 ST タイム(欠場などは欠ける)
            try:
                if len(toks) >= 3:
                    b["exh"] = float(toks[2]) if re.match(r"^\d\.\d\d$", toks[2]) else None
                if len(toks) >= 4 and toks[3].isdigit():
                    b["course"] = int(toks[3])
                if len(toks) >= 5:
                    st, fl = _st(toks[4])
                    b["st"] = st
                    b["F"] = fl or code == "F"
                if len(toks) >= 6:   # レースタイム '1.48.5' → 秒(v3から保存。古い履歴には無い)
                    tm = re.match(r"^(\d)\.(\d\d)\.(\d)$", toks[5])
                    if tm:
                        b["rt"] = int(tm.group(1)) * 60 + int(tm.group(2)) + int(tm.group(3)) / 10
                if toks and toks[0].isdigit():
                    b["motor_no"] = int(toks[0])
            except (ValueError, IndexError):
                pass
            if code == "F":
                b["F"] = True
            cur["boats"].append(b)
            if fin <= 6:
                cur["order"][fin] = int(lane)
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
        res[k] = {"order": order, "tansho": v["tansho"], "exacta": v["exacta"], "trifecta": v["trifecta"],
                  "void": v["void"], "boats": v["boats"], "wx": v["wx"], "kimarite": v["kimarite"]}
    return res


# ---------------------------------------------------------------- レーサー期別成績(ファン手帳)
def _num(b: bytes):
    s = b.decode("ascii", errors="ignore").strip()
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _scale(vals: list, hi: float) -> float:
    """小数点なしの固定桁(例 '0645')の倍率を、値の範囲から決める。"""
    xs = sorted(v for v in vals if v is not None)
    if not xs:
        return 1.0
    q = xs[int(len(xs) * 0.95)]
    for div in (1.0, 10.0, 100.0, 1000.0):
        if q / div <= hi:
            return div
    return 1000.0


def parse_fan(raw: bytes) -> dict:
    """公式レイアウト(1レコード416バイト)。→ {登番: {...}}"""
    recs = []
    for line in raw.replace(b"\r\n", b"\n").split(b"\n"):
        if len(line) < 402 or not line[:4].isdigit():
            continue
        r = {"racer": line[:4].decode(), "cls": line[39:41].decode("ascii", "ignore"),
             "win": _num(line[58:62]), "q2": _num(line[62:66]), "st": _num(line[79:82]),
             "starts": _num(line[72:75]), "ability": _num(line[170:174]), "c": []}
        for c in range(6):
            o = 82 + 13 * c
            o2 = 198 + 34 * c
            r["c"].append({"n": _num(line[o:o + 3]), "q2": _num(line[o + 3:o + 7]),
                           "st": _num(line[o + 7:o + 10]), "sr": _num(line[o + 10:o + 13]),
                           "w": _num(line[o2:o2 + 3]), "w2": _num(line[o2 + 3:o2 + 6]),
                           "w3": _num(line[o2 + 6:o2 + 9]), "F": _num(line[o2 + 18:o2 + 20])})
        r["period"] = line[179:195].decode("ascii", "ignore")
        recs.append(r)
    if not recs:
        return {}
    sw = _scale([r["win"] for r in recs], 10)
    sq = _scale([r["q2"] for r in recs] + [c["q2"] for r in recs for c in r["c"]], 100)
    sst = _scale([r["st"] for r in recs] + [c["st"] for r in recs for c in r["c"]], 1)
    ssr = _scale([c["sr"] for r in recs for c in r["c"]], 6)
    sab = _scale([r["ability"] for r in recs], 100)
    out = {}
    for r in recs:
        f = lambda v, s: None if v is None else v / s  # noqa: E731
        out[r["racer"]] = {
            "cls": r["cls"], "win": f(r["win"], sw), "q2": f(r["q2"], sq), "st": f(r["st"], sst),
            "ability": f(r["ability"], sab), "period": r["period"],
            "c": [{"n": int(c["n"] or 0), "q2": f(c["q2"], sq), "st": f(c["st"], sst), "sr": f(c["sr"], ssr),
                   "w": int(c["w"] or 0), "top2": int((c["w"] or 0) + (c["w2"] or 0)),
                   "top3": int((c["w"] or 0) + (c["w2"] or 0) + (c["w3"] or 0)), "F": int(c["F"] or 0)}
                  for c in r["c"]]}
    return out
