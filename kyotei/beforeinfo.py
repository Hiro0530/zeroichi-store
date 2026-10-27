"""公式の直前情報ページ(beforeinfo)の読み取り。1レース1ページ。保存も公開もしない(読んだ数字だけ使う)。

読む数字: 各艇の展示タイム・チルト・プロペラ(新)・部品交換、スタート展示の進入コースとST、水面気象(風速・風向・波高)。
読み取りが怪しいとき(6艇そろわない・展示タイムが 6.0〜7.5 の外・進入が1〜6の並びでない)は None を返し、使わない。
"""
from __future__ import annotations

import re
from datetime import date

URL = "https://www.boatrace.jp/owpc/pc/race/beforeinfo?rno={rno}&jcd={jcd}&hd={hd:%Y%m%d}"
# 風向の画像(is-wind1〜16)。公式のページで1=北から時計回りに16方位(風の吹いてくる向き)とみなす。
# 学習の風向(競走成績ファイルの文字)と同じ並びにするため、名前に直して jma.wind_uv に渡す。
DIR16 = ["北", "北北東", "北東", "東北東", "東", "東南東", "南東", "南南東", "南", "南南西", "南西", "西南西", "西", "西北西", "北西", "北北西"]


def _txt(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s.replace("&nbsp;", " "))).strip()


def parse(html: str) -> dict | None:
    if not html or "is-w748" not in html:
        return None
    boats = {}
    for tb in re.findall(r'<tbody class="is-fs12\s*">(.*?)</tbody>', html, re.S):
        tds = re.findall(r"<td[^>]*>(.*?)</td>", tb, re.S)
        if len(tds) < 8:
            continue
        lane = _txt(tds[0])
        if not lane.isdigit():
            continue
        m = re.search(r"toban=(\d{4})", tb)
        ex = _txt(tds[4])
        tilt = _txt(tds[5])
        parts = re.findall(r'<span class="label4[^"]*">(.*?)</span>', tds[7], re.S)
        try:
            exh = float(ex) if re.match(r"^\d\.\d\d$", ex) else None
        except ValueError:
            exh = None
        try:
            tl = float(tilt)
        except ValueError:
            tl = None
        boats[int(lane)] = {"lane": int(lane), "racer": m.group(1) if m else None, "exh": exh, "tilt": tl,
                            "prop_new": "新" in _txt(tds[6]), "parts": [_txt(p) for p in parts]}
    if sorted(boats) != [1, 2, 3, 4, 5, 6]:
        return None
    # スタート展示: 上から順にコース1〜6。数字は艇番
    course, st = {}, {}
    rows = re.findall(r'table1_boatImage1Number[^>]*>(\d)</span>.*?table1_boatImage1Time[^>]*>([^<]*)</span>', html, re.S)
    for i, (ln, t) in enumerate(rows[:6]):
        course[int(ln)] = i + 1
        t = t.strip()
        num = re.sub(r"[^0-9.]", "", t)
        try:
            v = float("0" + num if num.startswith(".") else num)
            st[int(ln)] = -v if t.startswith("F") else v
        except ValueError:
            st[int(ln)] = None
    if sorted(course) != [1, 2, 3, 4, 5, 6] or sorted(course.values()) != [1, 2, 3, 4, 5, 6]:
        course = {}
    for ln, b in boats.items():
        b["course"] = course.get(ln)
        b["st_exh"] = st.get(ln)
    wx = {}
    m = re.search(r"風速</span>\s*<span[^>]*>(\d+)m", html)
    if m:
        wx["wind"] = int(m.group(1))
    m = re.search(r"波高</span>\s*<span[^>]*>(\d+)cm", html)
    if m:
        wx["wave"] = int(m.group(1))
    m = re.search(r"is-wind(\d{1,2})\"", html)
    if m and 1 <= int(m.group(1)) <= 16:
        wx["wind_dir"] = DIR16[int(m.group(1)) - 1]
    m = re.search(r"水面気象情報\s*(\d+)R時点", html)
    wx["as_of_race"] = int(m.group(1)) if m else None
    ex = [b["exh"] for b in boats.values() if b["exh"]]
    if len(ex) < 4 or not all(6.0 <= e <= 7.5 for e in ex):
        return None
    return {"boats": [boats[i] for i in range(1, 7)], "wx": wx if "wind" in wx else {}}


def as_result(info: dict) -> dict:
    """features.race_features の res の形(展示タイム・進入・気象だけ)。着順などは入れない。"""
    return {"boats": [{"lane": b["lane"], "exh": b["exh"], "course": b["course"]} for b in info["boats"]],
            "wx": info.get("wx") or {}}


def url(jcd: str, rno: int, d: date) -> str:
    return URL.format(rno=rno, jcd=jcd, hd=d)
