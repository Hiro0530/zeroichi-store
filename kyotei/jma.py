"""気象庁(JMA)の公開データ: 潮位表(天文潮位の予測値)と、アメダスの最新観測(毎朝の予想時点)。

出典: 気象庁ホームページ(https://www.jma.go.jp/ , https://www.data.jma.go.jp/)。
気象庁ホームページのコンテンツは「政府標準利用規約(第2.0版)」に準拠した利用ルールのもとで、
出典を記載すれば複製・加工・公開できる(加工したものは加工した旨を書く)。
- 潮位表: 1地点1年で1ファイル(毎時の予測潮位)。レースの前から分かる(天文潮位の計算値)。
- アメダス: 予想を作る朝(06時台)の最新の観測を1回だけ読む(全国の地点が1ファイル)。
取得は少なく: 潮位は 地点×年 で1回だけ、アメダスは1日1〜2ファイル。いずれも1ファイルごとに数秒あける。
"""
from __future__ import annotations

import json
import math
import re
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

JST = timezone(timedelta(hours=9))
UA = "kyotei-kotaeawase/0.3 (+low-frequency; tide table once per station-year)"
PAUSE = 3.0

# 場の位置(おおよそ)と水面。tide=True は海水・汽水(潮の満ち引きがある)
VENUE_GEO = {
    "01": (36.40, 139.30, False), "02": (35.81, 139.68, False), "03": (35.69, 139.86, True), "04": (35.58, 139.75, True),
    "05": (35.65, 139.49, False), "06": (34.69, 137.57, True), "07": (34.82, 137.22, True), "08": (34.89, 136.83, True),
    "09": (34.71, 136.53, True), "10": (36.20, 136.17, False), "11": (35.01, 135.87, False), "12": (34.61, 135.48, False),
    "13": (34.73, 135.42, False), "14": (34.21, 134.62, True), "15": (34.30, 133.80, True), "16": (34.46, 133.80, True),
    "17": (34.33, 132.32, True), "18": (34.03, 131.77, True), "19": (34.00, 130.98, True), "20": (33.90, 130.79, True),
    "21": (33.89, 130.66, False), "22": (33.60, 130.39, True), "23": (33.45, 129.97, False), "24": (32.92, 129.94, True),
}
# 潮位表の地点(記号)。気象庁の地点一覧(station{年}.php)から最寄りを選ぶ。取れないときの控え
TIDE_FALLBACK = {"03": "TK", "04": "TK", "06": "MI", "07": "G5", "08": "ZD", "09": "G3", "14": "KM",
                 "15": "TX", "16": "J8", "17": "Q8", "18": "QA", "19": "CF"}
DIR16 = ["北", "北北東", "北東", "東北東", "東", "東南東", "南東", "南南東", "南", "南南西", "南西", "西南西", "西", "西北西", "北西", "北北西"]


def _get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        b = urllib.request.urlopen(req, timeout=60).read()
    except Exception as e:  # noqa
        print(f"jma miss {url}: {e}")
        b = b""
    time.sleep(PAUSE)
    return b


def _km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


def wind_uv(speed, dir_name) -> tuple[float, float]:
    """風向(16方位の名前、または0〜16の番号。0=静穏)と風速 → (東西成分, 南北成分)。向きは「吹いてくる方向」。"""
    if not speed:
        return 0.0, 0.0
    if isinstance(dir_name, (int, float)):
        k = int(dir_name)
        if k <= 0 or k > 16:
            return 0.0, 0.0
        k = k % 16   # アメダス: 1=北北東 … 16=北
    else:
        s = str(dir_name).replace("　", "").replace("風", "").strip()
        if s not in DIR16:
            return 0.0, 0.0
        k = DIR16.index(s)
    th = 2 * math.pi * k / 16
    return float(speed) * math.sin(th), float(speed) * math.cos(th)


# ---------------------------------------------------------------- 潮位表
def tide_stations(jd: Path, year: int) -> dict:
    """場 → 潮位の地点記号。地点一覧を年に1回だけ読み、最寄り(40km以内)を選ぶ。"""
    f = jd / f"tide_stations_{year}.json"
    if f.exists():
        return json.loads(f.read_text())
    out = dict(TIDE_FALLBACK)
    raw = b""
    for base in ("https://www.data.jma.go.jp/kaiyou/db/tide/suisan", "https://www.data.jma.go.jp/gmd/kaiyou/db/tide/suisan"):
        raw = _get(f"{base}/station{year}.php")
        if raw:
            break
    txt = re.sub(r"<[^>]+>", " ", raw.decode("utf-8", "replace"))
    sts = []
    for m in re.finditer(r"\b([A-Z0-9]{2})\s+([^\s\d][^\s]*)\s+(\d+)°\s*(\d+)['′]\s+(\d+)°\s*(\d+)['′]", txt):
        sts.append((m.group(1), m.group(2), int(m.group(3)) + int(m.group(4)) / 60, int(m.group(5)) + int(m.group(6)) / 60))
    print(f"tide stations {year}: {len(sts)} parsed")
    if len(sts) > 50:
        for v, (la, lo, tidal) in VENUE_GEO.items():
            if not tidal:
                continue
            best = min(sts, key=lambda s: _km((la, lo), (s[2], s[3])))
            if _km((la, lo), (best[2], best[3])) <= 40:
                out[v] = best[0]
    out = {v: c for v, c in out.items() if VENUE_GEO[v][2]}
    f.write_text(json.dumps(out))
    return out


def parse_tide_txt(raw: bytes) -> dict:
    """1行=1日: 毎時の潮位(3桁×24) + 年月日(2桁×3) + 地点記号。→ {'YYYY-MM-DD': [24 cm]}"""
    out = {}
    for line in raw.decode("ascii", "ignore").splitlines():
        if len(line) < 80:
            continue
        try:
            hrs = [int(line[i * 3:i * 3 + 3]) for i in range(24)]
            y, mo, d = int(line[72:74]), int(line[74:76]), int(line[76:78])
        except ValueError:
            continue
        out[f"{2000 + y:04d}-{mo:02d}-{d:02d}"] = hrs
    return out


def ensure_tides(jd: Path, years: list[int]):
    """地点×年で1ファイルずつ。取得済みは取り直さない(来年分は公開されていれば取る)。"""
    td = jd / "tide"
    td.mkdir(parents=True, exist_ok=True)
    for y in years:
        st = tide_stations(jd, y)
        for code in sorted(set(st.values())):
            f = td / f"{code}_{y}.json"
            if f.exists():
                continue
            data = {}
            for base in ("https://www.data.jma.go.jp/kaiyou/data/db/tide/suisan/txt",
                         "https://www.data.jma.go.jp/gmd/kaiyou/data/db/tide/suisan/txt"):
                data = parse_tide_txt(_get(f"{base}/{y}/{code}.txt"))
                if data:
                    break
            print(f"tide {code} {y}: {len(data)} days")
            if data:
                f.write_text(json.dumps(data, separators=(",", ":")))


class Tides:
    def __init__(self, jd: Path):
        self.st, self.d = {}, {}
        td = jd / "tide"
        for f in sorted(jd.glob("tide_stations_*.json")):
            self.st.update(json.loads(f.read_text()))
        for f in sorted(td.glob("*.json")) if td.exists() else []:
            self.d.setdefault(f.name[:2], {}).update(json.loads(f.read_text()))

    def at(self, venue: str, t: datetime):
        """(その日の平均からの潮位 m, 1時間あたりの変化 m/h)。潮の無い場・データ無しは None"""
        code = self.st.get(venue)
        if not code or code not in self.d:
            return None
        ser = self.d[code]
        day = ser.get(t.date().isoformat())
        if not day:
            return None
        nxt = ser.get((t.date() + timedelta(days=1)).isoformat(), day)

        def lvl(h: float) -> float:
            vals = day + nxt[:2]
            i = int(h)
            fr = h - i
            return vals[i] * (1 - fr) + vals[min(i + 1, len(vals) - 1)] * fr
        h = t.hour + t.minute / 60
        mean = sum(day) / 24
        return (lvl(h) - mean) / 100, (lvl(min(h + 0.5, 25)) - lvl(max(h - 0.5, 0))) / 100


# ---------------------------------------------------------------- アメダス(毎朝1回の最新観測。今後の検証用に貯める)
def amedas_snapshot(jd: Path, d: date):
    """予想を作る時点の最新観測(全国1ファイル)から、各場の最寄り地点の風を保存する。"""
    ad = jd / "amedas"
    ad.mkdir(parents=True, exist_ok=True)
    out = ad / f"{d:%Y%m%d}.json"
    if out.exists():
        return
    tf = jd / "amedastable.json"
    if not tf.exists():
        raw = _get("https://www.jma.go.jp/bosai/amedas/const/amedastable.json")
        if not raw:
            return
        tf.write_bytes(raw)
    table = json.loads(tf.read_text())
    near = {}
    for v, (la, lo, _) in VENUE_GEO.items():
        best = None
        for code, s in table.items():
            el = s.get("elems", "")
            if len(el) < 3 or el[2] != "1":
                continue   # 風を測っていない地点
            p = (s["lat"][0] + s["lat"][1] / 60, s["lon"][0] + s["lon"][1] / 60)
            dk = _km((la, lo), p)
            if best is None or dk < best[1]:
                best = (code, dk, s.get("kjName"))
        near[v] = best
    lt = _get("https://www.jma.go.jp/bosai/amedas/data/latest_time.txt").decode().strip()
    if not lt:
        return
    ts = datetime.fromisoformat(lt)
    raw = _get(f"https://www.jma.go.jp/bosai/amedas/data/map/{ts:%Y%m%d%H%M}00.json")
    if not raw:
        return
    m = json.loads(raw)
    rec = {"time": lt, "venues": {}}
    for v, (code, dk, name) in near.items():
        x = m.get(code) or {}
        w, wd = (x.get("wind") or [None])[0], (x.get("windDirection") or [None])[0]
        rec["venues"][v] = {"station": code, "name": name, "km": round(dk, 1), "wind": w, "dir": wd}
    out.write_text(json.dumps(rec, ensure_ascii=False))
    print(f"amedas {lt}: {sum(1 for x in rec['venues'].values() if x['wind'] is not None)} venues")
