"""検索の入口になるページ(場ごと・日付ごと・レースごと)と sitemap を、予想と答え合わせの実データから作る。

出力先は kyotei/site_pages/(公開リポジトリの main には入れない。.gitignore)。毎朝のワークフローが
gh-pages の kyotei/ に上書きコピーする。predictions/ と results/ から毎回すべて作り直すので、作り直しても同じ中身になる。

住所(https://zeroichiworks.net/kyotei/ の下)
- kiryu/                    場の「今日の予想と展開」(毎朝入れ替わる。前回の答え合わせと通算も載せる)
- kiryu/kiroku/             場の通算成績(日ごとの一覧から過去のページへ)
- 2026-10-29/               その日の全場のまとめ
- 2026-10-29/kiryu/         その日のその場の全レース
- 2026-10-29/kiryu/12r/     レースごと(出走表の要点・確率の上位・根拠・答え合わせ)
- kako/                     過去の日付の一覧
- sitemap.xml               サイトマップの索引(sitemap-base.xml と月ごとの sitemap-YYYY-MM.xml)

決めごと
- 中身は必ずそのレース・その日の数字で変わる。数字の無いページは作らない。
- 結果が出ていないレースは「予想だけ」とはっきり書く。外れも隠さない。
- 「的中は保証しません」「舟券は20歳から」を全ページに。売り文句・当たる保証は書かない。
- 見た目は site_gen.py の決めごとに従う(紙の予想紙・枠色・朱は的中と払戻だけ)。CSS は p.css 1本にまとめて軽くする。
"""
from __future__ import annotations

import json
import re
import shutil
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from site_gen import (CSS, MANSHU, SLUG, VENUES, WD, combo, esc, hm, lane, marks, stars, tier_mark)

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "site_pages"
HOST = "https://zeroichiworks.net"
BASE = "/kyotei/"
JST = timezone(timedelta(hours=9))
SITE_NAME = "AI舟券 答え合わせ帳"
COMMITS = "https://github.com/Hiro0530/zeroichi-store/commits/main/kyotei/predictions/"
HELP_URL = "https://www.gaprsc.or.jp/"

WHY_TEXT = {
    "lane": "枠の有利さ(この場でその枠がどれだけ1着になりやすいか)",
    "power": "地力(全国勝率・2連対率・級別・能力指数)",
    "local": "この場での本人の成績",
    "lanefit": "その枠からの本人の1着率・2連対率",
    "start": "スタート(平均STと、その安定ぶり)",
    "flying": "フライング持ちかどうか",
    "form": "最近の調子",
    "series": "今節ここまでの着順",
    "motor": "モーター(2連対率・最近の成績・展示の気配)",
    "boat": "ボートの2連対率",
    "exh": "本人の最近の展示タイム",
    "course": "進入(前付けや、コースを取られやすいか)",
    "weight": "体重",
    "weather": "前日の風と波",
    "tide": "潮位と満ち引き",
    "venue": "この場の最近の枠の傾向",
}

EXTRA_CSS = """
.crumb{font-size:12px;color:var(--sub);padding:12px 0 0;display:flex;flex-wrap:wrap;gap:0 4px}
.crumb a{color:var(--sub)}
.crumb span+span:before{content:"›";margin-right:4px}
.ph{padding:6px 0 14px;border-bottom:2px solid var(--ink)}
.ph h1{font:900 clamp(24px,6.4vw,32px)/1.3 var(--jp);margin:4px 0 0;letter-spacing:.02em}
.ph .sub{font-size:13px;color:var(--sub);margin-top:4px}
.ph .sub .n{font-size:16px;color:var(--ink)}
.ph .warn{font-size:12px;color:var(--sub);margin-top:6px}
.res{margin:16px 0 4px;border:2px solid var(--ink);padding:12px 14px}
.res.ok{border-color:var(--shu)}
.res.wait{border-style:dashed;border-color:var(--rule2)}
.res .row{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px}
.res .lbl{font-size:12px;color:var(--sub);display:block}
.res .big{font:700 30px/1 var(--num)}
.res .big.hit{color:var(--shu)}
.res p{font-size:14px;margin-top:8px}
.lead2{font-size:15.5px;margin:14px 0 0}
.lead2 b{font-weight:700}
.bar{display:block;height:6px;background:var(--rule);margin-top:3px;min-width:40px}
.bar i{display:block;height:100%;background:var(--ink)}
tr.pk td{background:var(--head)}
td.nm{font-weight:700;white-space:nowrap}
td.nm small{font-weight:400;color:var(--sub);margin-left:4px}
.reasons{margin:8px 0 0;padding-left:1.2em}
.reasons li{margin:3px 0}
.reasons small{color:var(--sub)}
.picks{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:4px 20px;margin-top:8px}
.picks div{border-bottom:1px solid var(--rule);padding:6px 0}
.picks .k{font-size:12px;color:var(--sub);display:block}
.picks .cb{margin-right:6px}
.picks .pp{font:600 15px/1 var(--num);color:var(--sub)}
.rnav{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 0;padding:0;list-style:none}
.rnav a,.rnav b{display:inline-grid;place-items:center;min-width:44px;height:40px;border:1px solid var(--rule2);font:600 16px/1 var(--num);text-decoration:none;color:var(--ink);padding:0 6px}
.rnav b{background:var(--ink);color:var(--paper);border-color:var(--ink)}
.rnav a.hit{border-color:var(--shu);color:var(--shu)}
.links{margin:10px 0 0;padding:0;list-style:none;font-size:14px}
.links li{padding:9px 0;border-bottom:1px solid var(--rule)}
.vgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:6px;margin-top:10px}
.vgrid a{display:block;border:1px solid var(--rule2);padding:9px 8px;text-decoration:none;color:var(--ink);font-weight:700;font-size:15px;line-height:1.25}
.vgrid a small{display:block;font-weight:400;font-size:11.5px;color:var(--sub)}
.vgrid a.on{border-color:var(--ink);box-shadow:inset 0 0 0 1px var(--ink)}
.t-race a{color:inherit}
td .vd-ok{color:var(--shu);font-weight:700;white-space:nowrap}
td .vd-w{font-weight:700;white-space:nowrap}
td .vd-ng{color:var(--past);white-space:nowrap}
.rt .tm{display:block;font:500 13px/1.2 var(--num);color:var(--sub)}
.rt td.mk2{white-space:nowrap}.rt .mk{margin-right:2px}
.rt .tenkai{white-space:normal;max-width:16em}
.rt .vdl{display:block;font-size:12px;margin-top:2px}
.rt .pay{font-size:18px}
@media (max-width:599px){.rt .pr{font-size:18px}.rt .tier{display:none}.rt td{padding:7px 3px}}
.tenkai{font-size:13px;color:var(--sub);display:block;line-height:1.45}
@media (min-width:980px){main.wrap>section,.ph,.res{max-width:820px}}
"""

DISC_SHORT = "的中は保証しません。舟券は20歳から。"


# ---------- 小さな部品 ----------
def url(*parts) -> str:
    return BASE + "".join(f"{p}/" for p in parts)


def jd(d: str, wd: bool = True, year: bool = False) -> str:
    x = date.fromisoformat(d[:10])
    return (f"{x.year}年" if year else "") + f"{x.month}月{x.day}日" + (f"({WD[x.weekday()]})" if wd else "")


def clean_title(t) -> str:
    t = re.sub(r"\s+", " ", str(t or "")).strip()
    return t.translate(str.maketrans("０１２３４５６７８９ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ",
                                     "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"))


def venue_of(x: dict) -> str:
    return x.get("venue_name") or VENUES[int(x["key"].split("-")[1]) - 1]


def p0(x: float) -> str:
    return f"{x*100:.0f}%"


def verdict_text(y: dict) -> str:
    v = y.get("verdict")
    return {"的中": "3連単的中", "惜しい": "惜しい", "1着的中": "◎1着"}.get(v, "外れ")


def finish_of(pick: int, actual: str) -> str:
    a = [int(c) for c in str(actual).split("-") if c.strip().isdigit()]
    if pick in a:
        return f"{a.index(pick) + 1}着"
    return "4着以下(または不完走)"


def strength(v: float) -> str:
    return "とても大きい" if v >= 1.0 else "大きい" if v >= 0.4 else "中くらい" if v >= 0.15 else "小さめ"


# ---------- データ ----------
class Data:
    def __init__(self):
        self.preds: dict[str, dict] = {}
        self.res: dict[str, dict] = {}
        for f in sorted((ROOT / "predictions").glob("*.json")):
            self.preds[f.stem] = json.loads(f.read_text(encoding="utf-8"))
        for f in sorted((ROOT / "results").glob("*.json")):
            self.res[f.stem] = json.loads(f.read_text(encoding="utf-8"))
        self.dates = sorted(self.preds)
        self.today = self.dates[-1] if self.dates else None
        self.rmap = {d: {y["key"]: y for y in r["races"]} for d, r in self.res.items()}
        # 場ごとの通算(採点したレースだけ)
        self.vstat: dict[str, dict] = {}
        for d in self.dates:
            for y in self.rmap.get(d, {}).values():
                s = self.vstat.setdefault(venue_of(y), {"days": {}, "races": 0, "win": 0, "base": 0, "tri": 0, "ret_win": 0, "ret_tri": 0, "ret_base": 0, "hits": []})
                dd = s["days"].setdefault(d, {"races": 0, "win": 0, "base": 0, "tri": 0, "ret_win": 0, "ret_tri": 0})
                for t in (s, dd):
                    t["races"] += 1
                    t["win"] += bool(y.get("win_hit"))
                    t["tri"] += bool(y.get("tri_hit"))
                    t["ret_win"] += y.get("pay_win") or 0
                    t["ret_tri"] += y.get("pay_tri") or 0
                s["base"] += bool(y.get("lane1_won"))
                dd["base"] += bool(y.get("lane1_won"))
                s["ret_base"] += y.get("base_pay") or 0
                if y.get("tri_hit"):
                    s["hits"].append((y.get("pay_tri") or 0, d, y))

    def venue_races(self, d: str, vn: str) -> list:
        return sorted([x for x in self.preds[d]["races"] if venue_of(x) == vn], key=lambda x: x["race"])

    def venues_on(self, d: str) -> list:
        return sorted({venue_of(x) for x in self.preds[d]["races"]}, key=lambda v: VENUES.index(v))

    def venue_dates(self, vn: str) -> list:
        return [d for d in self.dates if any(venue_of(x) == vn for x in self.preds[d]["races"])]

    def result(self, d: str, key: str):
        return self.rmap.get(d, {}).get(key)


# ---------- ページの枠 ----------
def crumbs_html(items: list) -> tuple[str, str]:
    """[(名前, 住所 or None)] → 表示用のパンくずと BreadcrumbList の JSON-LD"""
    vis = "".join(f"<span><a href='{esc(u)}'>{esc(n)}</a></span>" if u else f"<span>{esc(n)}</span>" for n, u in items)
    ld = {"@context": "https://schema.org", "@type": "BreadcrumbList",
          "itemListElement": [{"@type": "ListItem", "position": i + 1, "name": n, **({"item": HOST + u} if u else {})}
                              for i, (n, u) in enumerate(items)]}
    return (f"<nav class='crumb wrap' aria-label='現在の場所'>{vis}</nav>",
            "<script type=application/ld+json>" + json.dumps(ld, ensure_ascii=False) + "</script>")


def disclaimers_html() -> str:
    import site_data  # 文言は site_data.DISCLAIMERS(全ページ共通)
    ps = []
    for x in site_data.DISCLAIMERS:
        t = esc(x).replace("ギャンブル依存症予防回復支援センター", f"<a href='{HELP_URL}'>ギャンブル依存症予防回復支援センター</a>", 1)
        ps.append(f"<p>{t}</p>")
    return "<section class=calm aria-labelledby=h-calm><h2 id=h-calm>読む前に</h2>" + "".join(ps) + "</section>"


def page(path: str, title: str, desc: str, crumbs: list, body: str, noindex: bool = False) -> None:
    vis, ld = crumbs_html(crumbs)
    canon = HOST + path
    h = ("<!doctype html><html lang=ja><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
         f"<title>{esc(title)}</title><meta name=description content='{esc(desc)}'>"
         f"<link rel=canonical href='{canon}'>" + ("<meta name=robots content=noindex>" if noindex else "")
         + f"<meta property=og:title content='{esc(title)}'><meta property=og:description content='{esc(desc)}'>"
         f"<meta property=og:type content=article><meta property=og:url content='{canon}'><meta property=og:site_name content='{SITE_NAME}'>"
         f"<meta property=og:image content='{HOST}{BASE}hero-800.jpg'><meta name=twitter:card content=summary>"
         "<meta name=theme-color content='#ffffff'>"
         "<link rel=preconnect href='https://fonts.googleapis.com'><link rel=preconnect href='https://fonts.gstatic.com' crossorigin>"
         "<link rel=stylesheet href='https://fonts.googleapis.com/css2?family=Saira+Condensed:wght@500;600;700&display=swap'>"
         f"<link rel=stylesheet href='{BASE}p.css'>{ld}</head><body>"
         "<div class=waku aria-hidden=true><i></i><i></i><i></i><i></i><i></i><i></i></div>"
         f"{vis}<main class=wrap>{body}{disclaimers_html()}</main>"
         "<footer><div class=wrap>"
         "<p>データ:BOAT RACE公式サイトのダウンロードデータ(番組表・競走成績・レーサー期別成績)をもとに計算。正式な結果は主催者の発表で確認してください。</p>"
         f"<p><a href='{BASE}'>{SITE_NAME}(今日の全レース)</a>・<a href='{url('kako')}'>過去の予想と結果</a>・"
         "<a href='/privacy.html'>プライバシーポリシー</a>・運営 ZEROICHI WORKS</p></div></footer></body></html>")
    f = OUT / path.removeprefix(BASE) / "index.html"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(h, encoding="utf-8")


# ---------- 文章 ----------
def tenkai(x: dict) -> str:
    """◎の枠と確率からの見立て(展開の言い方)。モデルは進入や決まり手を直接は出さないので、言い切らない。"""
    pr = x["probs"]
    k = x["pick"]
    order = sorted(range(6), key=lambda i: -pr[i])
    s2 = order[1] + 1
    p, q = pr[k - 1], pr[s2 - 1]
    if k == 1:
        if p >= 0.6:
            return f"1号艇の逃げが本線。ほかの艇はどれも{p0(q)}以下の見立てです。"
        if p - q < 0.15:
            return f"1号艇の逃げが本線ですが、{s2}号艇({p0(q)})との差は小さく、攻め合いになるとみています。"
        return f"1号艇の逃げが本線。ただ{p0(p)}どまりで、{s2}号艇({p0(q)})の攻めも残ります。"
    if k == 2:
        return f"インの1号艇({p0(pr[0])})より、2号艇の差し・まくりが先に決まるとみた予想です。"
    if k in (3, 4):
        return f"{k}号艇が◎。センターからのまくり・まくり差しを本線にしています(1号艇は{p0(pr[0])})。"
    return f"{k}号艇が◎という外枠の本命。1号艇は{p0(pr[0])}と低めにみています。"


def tenkai_short(x: dict) -> str:
    """表の中の短い見立て(場の全レース一覧用)。"""
    pr = x["probs"]
    k = x["pick"]
    s2 = sorted(range(6), key=lambda i: -pr[i])[1] + 1
    q = pr[s2 - 1]
    if k == 1:
        return "逃げ本線" + ("" if pr[0] >= 0.6 else f"・対抗は{s2}号艇{p0(q)}")
    if k == 2:
        return f"2号艇の差し・まくり本線(1号艇{p0(pr[0])})"
    if k in (3, 4):
        return f"{k}号艇の攻め本線(1号艇{p0(pr[0])})"
    return f"外枠{k}号艇が本命(1号艇{p0(pr[0])})"


def racer_line(x: dict) -> str:
    """◎の選手を番組表の数字で一言(メンバー内の順位つき)。"""
    rs = x.get("racers") or []
    if len(rs) != 6:
        return ""
    b = rs[x["pick"] - 1]

    def rank(k):
        return 1 + sum(1 for z in rs if z[k] > b[k])
    t = f"{b['name']}({b['cls']})は全国勝率{b['nat_win']:.2f}でメンバー{rank('nat_win')}位"
    if b["loc_win"] > 0:
        t += f"、当地勝率{b['loc_win']:.2f}({rank('loc_win')}位)"
    t += f"、モーター2連率{b['motor_2']:.0f}%({rank('motor_2')}位)。"
    return t


def reasons_html(x: dict) -> str:
    w = x.get("why")
    o = ["<section aria-labelledby=h-why><h2 id=h-why>◎の根拠</h2>"]
    line = racer_line(x)
    if w and w.get("plus"):
        o.append("<p class=cap>モデルの計算で、◎を6艇の平均より押し上げた要素を効いた順に並べています。</p><ol class=reasons>")
        for g, v in w["plus"]:
            o.append(f"<li>{esc(WHY_TEXT.get(g, g))} <small>効き目:{strength(v)}</small></li>")
        o.append("</ol>")
        if w.get("minus"):
            g, v = w["minus"][0]
            o.append(f"<p class=lead2>逆に足を引っぱったのは「{esc(WHY_TEXT.get(g, g))}」。</p>")
    else:
        o.append("<p class=cap>この日の予想ファイルには計算の内訳を残していないので、番組表の数字で◎を見ています。</p>")
    if line:
        o.append(f"<p class=lead2>番組表の数字では、{esc(line)}</p>")
    if not (w and w.get("plus")) and not line:
        return ""
    o.append("</section>")
    return "".join(o)


def result_box(x: dict, y: dict | None, d: str, published: str, today: str) -> tuple[str, str]:
    """(HTML, 状態: graded / unscored / wait / missing)"""
    if y:
        hit = bool(y.get("tri_hit"))
        win = bool(y.get("win_hit"))
        pay = y.get("trifecta_payout")
        tp = y.get("tansho_payout")
        msg = (f"◎{x['pick']}号艇は{finish_of(x['pick'], y['actual'])}。"
               + ("3連単の3点のうち1点が当たりました。" if hit else "3連単の3点は外れました。" if not win else "◎は勝ちましたが、3連単の3点は外れ。"))
        if y.get("verdict") == "惜しい":
            msg += "1・2着か、3着までの顔ぶれは合っていました。"
        money = (f"仮に100円ずつ買っていたら、◎の単勝は{int(y.get('pay_win') or 0):,}円、"
                 + (f"3連単3点(300円)は{int(y.get('pay_tri')):,}円の払戻。" if y.get('pay_tri') else "3連単3点(300円)は払戻なし。"))
        h = (f"<div class='res{' ok' if hit or win else ''}'><div class=row>"
             f"<span><span class=lbl>結果</span>{combo(y['actual'], False)}</span>"
             f"<span><span class=lbl>判定</span>" + (f"<span class=stamp>的中</span>" if hit else f"<b>{esc(verdict_text(y))}</b>") + "</span>"
             + (f"<span><span class=lbl>3連単の払戻</span><span class='big{' hit' if hit else ''}'>{int(pay):,}</span>円</span>" if pay else "")
             + (f"<span><span class=lbl>単勝</span><span class=big>{int(tp):,}</span>円</span>" if tp else "")
             + f"</div><p>{esc(msg)}{esc(money)}</p></div>")
        return h, "graded"
    if x.get("scored") is False:
        return (f"<div class='res wait'><p>予想を出した{esc(hm(published))}より前に締切だったレースです。"
                "後出しにならないよう、答え合わせの数には入れていません。</p></div>", "unscored")
    if d >= today:
        return ("<div class='res wait'><p><b>まだ結果は出ていません。</b>ここにあるのは締切前に出した予想だけです。"
                "明日の朝、このページに結果と当たり外れを書き足します。</p></div>", "wait")
    return ("<div class='res wait'><p>このレースの結果はまだ取り込めていません(中止・取り込み待ちなど)。予想だけを載せています。</p></div>", "missing")


def entry_table(x: dict) -> str:
    pr = x["probs"]
    rs = x.get("racers") or []
    order = sorted(range(6), key=lambda i: -pr[i])
    mk = {order[0]: "◎", order[1]: "○", order[2]: "▲"}
    has = len(rs) == 6
    o = ["<div class=tw><table><thead><tr><th>枠</th><th></th>"
         + ("<th>選手</th><th class=r>全国</th><th class=r>当地</th><th class=r>モーター</th>" if has else "")
         + "<th class=r>1着率</th></tr></thead><tbody>"]
    for i in range(6):
        b = rs[i] if has else None
        loc = ("%.2f" % b["loc_win"] if b["loc_win"] > 0 else "—") if b else ""
        cells = (f"<td class=nm>{esc(b['name'])}<small>{esc(b['cls'])}</small></td><td class='r n'>{b['nat_win']:.2f}</td>"
                 f"<td class='r n'>{loc}</td><td class='r n'>{b['motor_2']:.0f}%</td>") if b else ""
        o.append(f"<tr{' class=pk' if i == order[0] else ''}><td>{lane(i + 1)}</td><td>{mk.get(i, '')}</td>{cells}"
                 f"<td class=r><span class='n' style='font-size:17px'>{pr[i]*100:.1f}%</span><span class=bar><i style='width:{min(100, pr[i]*100):.0f}%'></i></span></td></tr>")
    o.append("</tbody></table></div>")
    if has:
        o.append("<p class=cap>全国・当地は勝率、モーターは2連対率(番組表の値)。1着率はAIの計算です。</p>")
    return "".join(o)


def picks_html(x: dict) -> str:
    blocks = []
    for name, k in (("3連単", "trifecta"), ("3連複", "trio"), ("2連単", "exacta")):
        v = x.get(k)
        if not v:
            continue
        items = "".join(f"<div><span class=k>{name} {i + 1}番手</span>{combo(c)}<span class=pp>{p*100:.1f}%</span></div>" for i, (c, p) in enumerate(v[:3]))
        blocks.append(items)
    if not blocks:
        return ""
    return ("<section aria-labelledby=h-pk><h2 id=h-pk>確率の上位</h2><p class=cap>AIが出した組番ごとの確率。高い順に3つずつです。"
            "答え合わせは3連単の3点で数えています。</p><div class=picks>" + "".join(blocks) + "</div></section>")


# ---------- レースのページ ----------
def race_page(D: Data, d: str, x: dict, siblings: list) -> None:
    vn = venue_of(x)
    sl = SLUG[vn]
    n = x["race"]
    pub = D.preds[d]["published_at"]
    y = D.result(d, x["key"])
    box, state = result_box(x, y, d, pub, D.today)
    ttl = clean_title(x.get("title"))
    graded = state == "graded"
    title = f"{vn}{n}R 予想{'と結果' if graded else ''}｜AIの確率と答え合わせ {jd(d, False)}"
    tri = "・".join(c for c, _ in x["trifecta"][:3])
    p = max(x["probs"])
    rs = x.get("racers") or []
    nm = f"{rs[x['pick'] - 1]['name']}" if len(rs) == 6 else ""
    if graded:
        pay = y.get("trifecta_payout")
        desc = (f"{jd(d, False, True)}の{vn}{n}R。AIの本命は{x['pick']}号艇{nm}(1着率{p0(p)})、結果は{y['actual']}で{verdict_text(y)}。"
                + (f"3連単の払戻は{int(pay):,}円。" if pay else "") + "出走表の要点、確率の上位、本命の根拠も載せています。")
    else:
        desc = (f"{jd(d, False, True)}の{vn}{n}R(締切{hm(x['close'])})。AIの本命は{x['pick']}号艇{nm}で1着率{p0(p)}。"
                f"3連単の上位は{tri}。結果は翌朝このページで答え合わせします。")
    o = [f"<header class=ph><h1>{esc(vn)}{n}R {'予想と結果' if graded else '予想'}</h1>"
         f"<p class=sub>{esc(jd(d, True, True))}・締切 <span class=n>{esc(hm(x['close']))}</span>"
         + (f"・{esc(ttl)}" if ttl else "") + (tier_mark(x.get("tier")) if x.get("tier") else "") + "</p>"
         f"<p class=warn>予想は{esc(jd(pub, False))} {esc(hm(pub))}に公開(<a href='{COMMITS}{d}.json'>記録の履歴</a>)。{DISC_SHORT}</p></header>", box]
    o.append(f"<section aria-labelledby=h-mi><h2 id=h-mi>AIの見立て</h2><p class=lead2>◎は<b>{x['pick']}号艇{('の' + esc(nm)) if nm else ''}</b>、1着の確率は<b>{p*100:.1f}%</b>"
             + (f"(自信度{esc(x['tier'])})" if x.get("tier") else "") + f"。{esc(tenkai(x))}</p>{entry_table(x)}</section>")
    o.append(picks_html(x))
    o.append(reasons_html(x))
    # ほかのレースへ
    nav = []
    for z in siblings:
        zy = D.result(d, z["key"])
        if z["race"] == n:
            nav.append(f"<li><b>{z['race']}R</b></li>")
        else:
            nav.append(f"<li><a{' class=hit' if zy and zy.get('tri_hit') else ''} href='{url(d, sl, str(z['race']) + 'r')}'>{z['race']}R</a></li>")
    links = [f"<li><a href='{url(d, sl)}'>{esc(vn)} {esc(jd(d, False))}の全レース</a></li>",
             f"<li><a href='{url(sl)}'>{esc(vn)} 今日の予想と展開</a></li>",
             f"<li><a href='{url(sl, 'kiroku')}'>{esc(vn)}のAI予想 通算成績</a></li>",
             f"<li><a href='{url(d)}'>{esc(jd(d, False))}の全場まとめ</a></li>"]
    prev_d = [z for z in D.venue_dates(vn) if z < d]
    if prev_d and any(r["race"] == n for r in D.venue_races(prev_d[-1], vn)):
        links.append(f"<li><a href='{url(prev_d[-1], sl, str(n) + 'r')}'>前の開催日({esc(jd(prev_d[-1], False))})の{esc(vn)}{n}R</a></li>")
    o.append(f"<section aria-labelledby=h-nx><h2 id=h-nx>{esc(vn)}のほかのレース</h2><ul class=rnav>{''.join(nav)}</ul><ul class=links>{''.join(links)}</ul></section>")
    crumbs = [(SITE_NAME, BASE), (jd(d, False), url(d)), (vn, url(d, sl)), (f"{n}R", None)]
    page(url(d, sl, f"{n}r"), title, desc, crumbs, "".join(o))


# ---------- その日のその場 ----------
def races_table(D: Data, d: str, xs: list, with_tenkai: bool = False) -> str:
    """場の全レース。スマホ幅でも横にはみ出さないよう4列に詰める(締切はRの下、判定は結果の下)。"""
    sl = SLUG[venue_of(xs[0])]
    any_res = any(D.result(d, x["key"]) for x in xs)
    o = ["<div class=tw><table class=rt><thead><tr><th>R</th><th>" + ("◎" if any_res else "印") + "</th><th class=r>1着率</th>"
         + ("<th>結果</th><th class=r>3連単</th>" if any_res else "<th>3連単の上位</th>") + "</tr></thead><tbody>"]
    for x in xs:
        y = D.result(d, x["key"])
        link = f"<a href='{url(d, sl, str(x['race']) + 'r')}'>{x['race']}R</a>"
        ten = f"<span class=tenkai>{esc(tenkai_short(x))}</span>" if with_tenkai else ""
        mk = lane(x["pick"]) if any_res else marks(x["probs"])
        head = (f"<tr{' class=hit' if y and y.get('tri_hit') else ''}><td class=t-race><span class=n>{link}</span><span class=tm>{esc(hm(x['close']))}</span></td>"
                f"<td class=mk2>{mk}{ten}</td>"
                f"<td class='r pr'>{max(x['probs'])*100:.0f}<small>%</small>{tier_mark(x.get('tier'))}</td>")
        if any_res:
            if y:
                pay = y.get("trifecta_payout")
                big = (pay or 0) >= MANSHU
                vd = ("<span class=vd-ok>的中</span>" if y.get("tri_hit") else
                      "<span class=vd-w>◎1着</span>" if y.get("win_hit") else "<span class=vd-ng>外れ</span>")
                ps = (f"<span class='pay{' hit' if y.get('tri_hit') else ''}'><span class={'man' if big else ''}>{int(pay):,}</span><small>円</small></span>" if pay else "—")
                head += f"<td>{combo(y['actual'])}<span class=vdl>{vd}</span></td><td class=r>{ps}</td>"
            else:
                head += "<td colspan=2 class=cap>" + ("採点外(公開前に締切)" if x.get("scored") is False else "結果待ち") + "</td>"
        else:
            head += "<td class=tri3>" + "".join(f"<span>{esc(c)}</span>" for c, _ in x["trifecta"]) + "</td>"
        o.append(head + "</tr>")
    o.append("</tbody></table></div>")
    return "".join(o)


def day_summary(D: Data, d: str, xs: list) -> str:
    ys = [D.result(d, x["key"]) for x in xs]
    ys = [y for y in ys if y]
    if not ys:
        return ""
    n = len(ys)
    w = sum(1 for y in ys if y.get("win_hit"))
    t = sum(1 for y in ys if y.get("tri_hit"))
    b = sum(1 for y in ys if y.get("lane1_won"))
    rw = sum(y.get("pay_win") or 0 for y in ys)
    best = max((y for y in ys if y.get("tri_hit")), key=lambda y: y.get("pay_tri") or 0, default=None)
    s = f"採点した{n}レースで、◎の1着は{w}本(1号艇の1着は{b}本)、3連単の的中は{t}本。◎の単勝を100円ずつなら{n*100:,}円が{int(rw):,}円。"
    if best:
        s += f"いちばん高い的中は{best['race']}Rの{int(best['pay_tri']):,}円。"
    return f"<p class=lead2>{esc(s)}</p>"


def venue_day_page(D: Data, d: str, vn: str) -> None:
    sl = SLUG[vn]
    xs = D.venue_races(d, vn)
    graded = any(D.result(d, x["key"]) for x in xs)
    title = f"{vn} {jd(d, False)}の全レース予想{'と結果' if graded else ''}｜{SITE_NAME}"
    top = max(xs, key=lambda x: max(x["probs"]))
    desc = (f"{jd(d, False, True)}の{vn}、{len(xs)}レース全部のAI予想" + ("と答え合わせ。" if graded else "。")
            + f"いちばん自信があるのは{top['race']}Rの{top['pick']}号艇(1着率{p0(max(top['probs']))})。")
    if graded:
        ys = [D.result(d, x["key"]) for x in xs]
        desc += f"◎の1着は{sum(1 for y in ys if y and y.get('win_hit'))}本、3連単の的中は{sum(1 for y in ys if y and y.get('tri_hit'))}本。"
    vd = D.venue_dates(vn)
    i = vd.index(d)
    nav = []
    if i > 0:
        nav.append(f"<li><a href='{url(vd[i-1], sl)}'>前の開催日 {esc(jd(vd[i-1], False))}</a></li>")
    if i + 1 < len(vd):
        nav.append(f"<li><a href='{url(vd[i+1], sl)}'>次の開催日 {esc(jd(vd[i+1], False))}</a></li>")
    nav += [f"<li><a href='{url(sl)}'>{esc(vn)} 今日の予想と展開</a></li>", f"<li><a href='{url(sl, 'kiroku')}'>{esc(vn)}の通算成績</a></li>",
            f"<li><a href='{url(d)}'>{esc(jd(d, False))}の全場まとめ</a></li>"]
    body = (f"<header class=ph><h1>{esc(vn)} {esc(jd(d, False))}の全レース予想{'と結果' if graded else ''}</h1>"
            f"<p class=sub>{esc(jd(d, True, True))}・{len(xs)}R・締切 {esc(hm(xs[0]['close']))}〜{esc(hm(xs[-1]['close']))}</p>"
            f"<p class=warn>{DISC_SHORT}" + ("" if graded else "結果はまだ出ていません。ここにあるのは予想だけです。") + "</p></header>"
            + day_summary(D, d, xs)
            + f"<section aria-labelledby=h-rs><h2 id=h-rs>レースごと</h2><p class=cap>Rの数字から、出走表の要点・確率・根拠のページへ。印は1着の確率が高い順に◎○▲。</p>"
            + races_table(D, d, xs, with_tenkai=not graded) + "</section>"
            + f"<section aria-labelledby=h-lk><h2 id=h-lk>ほかの日・ほかのページ</h2><ul class=links>{''.join(nav)}</ul></section>")
    page(url(d, sl), title, desc, [(SITE_NAME, BASE), (jd(d, False), url(d)), (vn, None)], body)


# ---------- 場の通算 ----------
def vstat_table(s: dict) -> str:
    n = s["races"]
    note = (f"<p class=cap>まだ{n}レース分なので、数字は大きくぶれます。</p>" if n < 300 else "")
    return ("<div class=tw><table class=rec><thead><tr><th></th><th class=r>◎</th><th class=r>1号艇を毎回</th></tr></thead><tbody>"
            f"<tr><td>1着率</td><td class='r n'>{s['win']/n*100:.1f}%</td><td class='r n base'>{s['base']/n*100:.1f}%</td></tr>"
            f"<tr><td>単勝の回収率(100円ずつ)</td><td class='r n'>{s['ret_win']/n:.1f}%</td><td class='r n base'>{s['ret_base']/n:.1f}%</td></tr>"
            f"<tr><td>3連単3点の的中率</td><td class='r n'>{s['tri']/n*100:.1f}%</td><td class='r base'>—</td></tr>"
            f"<tr><td>3連単3点の回収率</td><td class='r n'>{s['ret_tri']/(3*n):.1f}%</td><td class='r base'>—</td></tr>"
            "</tbody></table></div>" + note)


def venue_record_page(D: Data, vn: str) -> None:
    sl = SLUG[vn]
    s = D.vstat.get(vn)
    vd = D.venue_dates(vn)
    title = f"{vn}のAI予想 通算成績｜的中率と回収率・過去の答え合わせ"
    if s:
        n = s["races"]
        desc = (f"{vn}で公開したAI予想の通算成績。{len(s['days'])}日・{n}レースで◎の1着率{s['win']/n*100:.1f}%"
                f"(1号艇を毎回だと{s['base']/n*100:.1f}%)、3連単3点の的中{s['tri']}本。日ごとの答え合わせへのリンクつき。")
    else:
        desc = f"{vn}で公開したAI予想の記録。答え合わせが始まったら、ここに通算の成績を載せます。"
    o = [f"<header class=ph><h1>{esc(vn)}のAI予想 通算成績</h1><p class=sub>"
         + (f"{esc(jd(min(s['days']), False, True))}から{esc(jd(max(s['days']), False))}まで" if s else "答え合わせ待ち")
         + f"</p><p class=warn>{DISC_SHORT}これまでの成績が続くとは限りません。</p></header>"]
    if s:
        n = s["races"]
        o.append(f"<section aria-labelledby=h-tt><h2 id=h-tt>通算<small>{len(s['days'])}日・{n}R</small></h2>" + vstat_table(s))
        if s["ret_win"] < 100 * n or s["ret_tri"] < 300 * n:
            o.append("<p class=cap>回収率が100%を切っているものは、そのまま買っていたら平均では負けていたということです。</p>")
        o.append("<p class=cap>採点は、予想を公開した時刻より後に締切があったレースだけ。払戻は公式の確定値(100円あたり)。</p></section>")
        hits = sorted(s["hits"], key=lambda t: -t[0])[:5]
        if hits:
            o.append("<section aria-labelledby=h-ht><h2 id=h-ht>この場で当たった3連単<small>払戻の高い順</small></h2><div class=tw><table><tbody>")
            for pay, d, y in hits:
                o.append(f"<tr><td class=t-race><a href='{url(d, sl, str(y['race']) + 'r')}'>{esc(jd(d, False))} {y['race']}R</a></td><td>{combo(y['actual'])}</td>"
                         f"<td class=r><span class='pay hit'>{int(pay):,}<small>円</small></span></td></tr>")
            o.append("</tbody></table></div></section>")
    o.append("<section aria-labelledby=h-dd><h2 id=h-dd>日ごとの答え合わせ</h2><div class=tw><table class=rec><thead><tr><th>日付</th><th class=r>R数</th>"
             "<th class=r>◎1着</th><th class=r>1号艇</th><th class=r>3連単</th><th class=r>単勝の差</th></tr></thead><tbody>")
    for d in reversed(vd):
        dd = (s or {}).get("days", {}).get(d)
        if dd:
            pn = dd["ret_win"] - 100 * dd["races"]
            sg = f"+{pn:,}円" if pn > 0 else (f"−{abs(pn):,}円" if pn < 0 else "±0円")
            o.append(f"<tr><td><a href='{url(d, sl)}'>{esc(jd(d))}</a></td><td class='r n'>{dd['races']}</td><td class='r n'>{dd['win']}</td>"
                     f"<td class='r n base'>{dd['base']}</td><td class='r n'>{dd['tri']}</td><td class='r'><span class='pnl{' pos' if pn > 0 else ''}'>{sg}</span></td></tr>")
        else:
            o.append(f"<tr><td><a href='{url(d, sl)}'>{esc(jd(d))}</a></td><td class=cap colspan=5>予想のみ(結果待ち)</td></tr>")
    o.append(f"</tbody></table></div></section><section><ul class=links><li><a href='{url(sl)}'>{esc(vn)} 今日の予想と展開</a></li>"
             f"<li><a href='{url('kako')}'>ほかの場・過去の日付</a></li></ul></section>")
    page(url(sl, "kiroku"), title, desc, [(SITE_NAME, BASE), (vn, url(sl)), ("通算成績", None)], "".join(o))


# ---------- 場の「今日」 ----------
def venue_today_page(D: Data, vn: str) -> None:
    sl = SLUG[vn]
    t = D.today
    vd = D.venue_dates(vn)
    held = t in vd
    last_graded = [d for d in vd if any(D.result(d, x["key"]) for x in D.venue_races(d, vn))]
    o = []
    if held:
        xs = D.venue_races(t, vn)
        top = max(xs, key=lambda x: max(x["probs"]))
        title = f"{vn} 今日の競艇予想と展開｜AIの確率と答え合わせ {jd(t, False)}"
        desc = (f"{jd(t, False, True)}の{vn}、全{len(xs)}レースのAI予想。本命・1着の確率・自信度と展開の見立て。"
                f"いちばん自信があるのは{top['race']}Rの{top['pick']}号艇({p0(max(top['probs']))})。翌朝に答え合わせします。")
        o.append(f"<header class=ph><h1>{esc(vn)} 今日の予想と展開</h1><p class=sub>{esc(jd(t, True, True))}・{len(xs)}R・"
                 f"締切 {esc(hm(xs[0]['close']))}〜{esc(hm(xs[-1]['close']))}</p>"
                 f"<p class=warn>{DISC_SHORT}今日の分は予想だけで、結果は明日の朝に書き足します。</p></header>")
        st = [x for x in stars(D.preds[t]) if venue_of(x) == vn]
        lead = f"いちばん自信があるのは{top['race']}R。{top['pick']}号艇を◎に1着の確率{max(top['probs'])*100:.0f}%とみています。"
        if st:
            lead += f"全場の「自信あり」5レースのうち{len(st)}つがこの場です。"
        o.append(f"<p class=lead2>{esc(lead)}</p>")
        o.append(f"<section aria-labelledby=h-td><h2 id=h-td>全レースの本命と見立て</h2><p class=cap>Rの数字から、出走表の要点・確率・根拠へ。"
                 "印は1着の確率が高い順に◎○▲。</p>" + races_table(D, t, xs, with_tenkai=True) + "</section>")
    else:
        title = f"{vn}の競艇予想｜AIの確率と答え合わせ" + (f"(前回 {jd(vd[-1], False)})" if vd else "")
        desc = (f"{vn}のAI予想。今日({jd(t, False)})は{vn}の開催がありません。"
                + (f"前回{jd(vd[-1], False)}の予想と答え合わせ、通算の成績を載せています。" if vd else ""))
        o.append(f"<header class=ph><h1>{esc(vn)}の予想と答え合わせ</h1><p class=sub>今日 {esc(jd(t, True, True))} は{esc(vn)}の開催がありません。</p>"
                 f"<p class=warn>{DISC_SHORT}</p></header>")
    if last_graded:
        d = last_graded[-1]
        xs = D.venue_races(d, vn)
        o.append(f"<section aria-labelledby=h-lg><h2 id=h-lg>前回の答え合わせ<small>{esc(jd(d))}</small></h2>" + day_summary(D, d, xs)
                 + races_table(D, d, xs) + f"<p class=cap><a href='{url(d, sl)}'>{esc(jd(d, False))}の{esc(vn)}を詳しく</a></p></section>")
    elif vd and not held:
        d = vd[-1]
        o.append(f"<section><h2>前回の予想<small>{esc(jd(d))}</small></h2>" + races_table(D, d, D.venue_races(d, vn)) + "</section>")
    s = D.vstat.get(vn)
    if s:
        o.append(f"<section aria-labelledby=h-vs><h2 id=h-vs>{esc(vn)}での通算<small>{len(s['days'])}日・{s['races']}R</small></h2>" + vstat_table(s)
                 + f"<p class=cap><a href='{url(sl, 'kiroku')}'>日ごとの成績と過去の答え合わせ</a></p></section>")
    o.append("<section aria-labelledby=h-ov><h2 id=h-ov>ほかの場</h2>" + venue_grid(D, vn) + "</section>")
    page(url(sl), title, desc, [(SITE_NAME, BASE), (vn, None)], "".join(o))


def venue_grid(D: Data, current: str | None = None) -> str:
    """24場の入口。今日開催の場は締切の範囲を添える。"""
    t = D.today
    on = set(D.venues_on(t)) if t else set()
    known = {venue_of(x) for d in D.dates for x in D.preds[d]["races"]}
    o = ["<div class=vgrid>"]
    for vn in VENUES:
        if vn not in known:
            continue
        if vn in on:
            xs = D.venue_races(t, vn)
            sub = f"今日 {hm(xs[0]['close'])}〜"
        else:
            sub = "開催なし"
        o.append(f"<a class='{'on' if vn == current else ''}' href='{url(SLUG[vn])}'>{esc(vn)}<small>{esc(sub)}</small></a>")
    o.append("</div>")
    return "".join(o)


# ---------- 日付のまとめ ----------
def date_page(D: Data, d: str) -> None:
    p = D.preds[d]
    vs = D.venues_on(d)
    allx = p["races"]
    ys = [D.result(d, x["key"]) for x in allx]
    ys = [y for y in ys if y]
    graded = bool(ys)
    title = f"{jd(d, False)}の競艇予想 全場まとめ{'と結果' if graded else ''}｜{SITE_NAME}"
    desc = f"{jd(d, False, True)}のボートレース{len(vs)}場・{len(allx)}レースのAI予想" + ("と答え合わせ。" if graded else "。")
    if graded:
        desc += (f"◎の1着は{sum(1 for y in ys if y.get('win_hit'))}/{len(ys)}本、3連単の的中は{sum(1 for y in ys if y.get('tri_hit'))}本。")
    desc += "場ごと・レースごとのページへ。"
    o = [f"<header class=ph><h1>{esc(jd(d, False))}の競艇予想 全場まとめ</h1><p class=sub>{esc(jd(d, True, True))}・{len(vs)}場{len(allx)}R・"
         f"予想の公開 {esc(jd(p['published_at'], False))} {esc(hm(p['published_at']))}</p><p class=warn>{DISC_SHORT}"
         + ("" if graded else "結果はまだ出ていません。ここにあるのは予想だけです。") + "</p></header>"]
    if graded:
        n = len(ys)
        w = sum(1 for y in ys if y.get("win_hit"))
        b = sum(1 for y in ys if y.get("lane1_won"))
        t = sum(1 for y in ys if y.get("tri_hit"))
        man = sum(1 for y in ys if y.get("tri_hit") and (y.get("pay_tri") or 0) >= MANSHU)
        o.append(f"<p class=lead2>採点した{n}レースで、◎の1着は<b>{w}</b>本(1号艇を毎回なら{b}本)。3連単は<b>{t}</b>本的中"
                 + (f"、うち万舟{man}本" if man else "") + "。外れも含めて、場ごとのページに全部載せています。</p>")
    st = stars(p)
    if st:
        o.append("<section aria-labelledby=h-st><h2 id=h-st>この日の自信あり</h2><p class=cap>◎の1着率が高い順に5レース(締切順)。</p><div class=tw><table><tbody>")
        for x in st:
            y = D.result(d, x["key"])
            vn = venue_of(x)
            r = (("<span class=vd-w>◎1着</span>" if y.get("win_hit") else "<span class=vd-ng>外れ</span>") + f" {combo(y['actual'])}") if y else "<span class=cap>結果待ち</span>"
            o.append(f"<tr><td class=t-race><a href='{url(d, SLUG[vn], str(x['race']) + 'r')}'>{esc(vn)}{x['race']}R</a></td><td class=t-time>{esc(hm(x['close']))}</td>"
                     f"<td>{lane(x['pick'])}</td><td class='r pr'>{max(x['probs'])*100:.0f}<small>%</small></td><td>{r}</td></tr>")
        o.append("</tbody></table></div></section>")
    o.append("<section aria-labelledby=h-vv><h2 id=h-vv>場ごと</h2><div class=tw><table><thead><tr><th>場</th><th>締切</th><th class=r>R</th>"
             + ("<th class=r>◎1着</th><th class=r>3連単</th>" if graded else "<th>いちばん自信</th>") + "</tr></thead><tbody>")
    for vn in vs:
        xs = D.venue_races(d, vn)
        row = (f"<tr><td class=t-race><a href='{url(d, SLUG[vn])}'>{esc(vn)}</a></td><td class=t-time>{esc(hm(xs[0]['close']))}〜</td><td class='r n'>{len(xs)}</td>")
        if graded:
            yy = [D.result(d, x["key"]) for x in xs]
            yy = [y for y in yy if y]
            row += f"<td class='r n'>{sum(1 for y in yy if y.get('win_hit'))}/{len(yy)}</td><td class='r n'>{sum(1 for y in yy if y.get('tri_hit'))}</td>"
        else:
            top = max(xs, key=lambda x: max(x["probs"]))
            row += f"<td>{top['race']}R {lane(top['pick'], True)} {max(top['probs'])*100:.0f}%</td>"
        o.append(row + "</tr>")
    o.append("</tbody></table></div></section>")
    i = D.dates.index(d)
    nav = []
    if i > 0:
        nav.append(f"<li><a href='{url(D.dates[i-1])}'>前の日 {esc(jd(D.dates[i-1], False))}</a></li>")
    if i + 1 < len(D.dates):
        nav.append(f"<li><a href='{url(D.dates[i+1])}'>次の日 {esc(jd(D.dates[i+1], False))}</a></li>")
    nav.append(f"<li><a href='{url('kako')}'>過去の日付の一覧</a></li>")
    o.append(f"<section><ul class=links>{''.join(nav)}</ul></section>")
    page(url(d), title, desc, [(SITE_NAME, BASE), (jd(d, False), None)], "".join(o))


def archive_page(D: Data) -> None:
    o = ["<header class=ph><h1>過去の予想と結果</h1><p class=sub>公開した日の予想と、翌朝の答え合わせの一覧です。</p>"
         f"<p class=warn>{DISC_SHORT}</p></header>",
         "<section aria-labelledby=h-vg><h2 id=h-vg>場から探す</h2>" + venue_grid(D) + "</section>",
         "<section aria-labelledby=h-dl><h2 id=h-dl>日付から探す</h2><div class=tw><table class=rec><thead><tr><th>日付</th><th class=r>場</th><th class=r>R</th>"
         "<th class=r>◎1着</th><th class=r>3連単</th></tr></thead><tbody>"]
    for d in reversed(D.dates):
        r = D.res.get(d)
        s = r["summary"] if r else None
        o.append(f"<tr><td><a href='{url(d)}'>{esc(jd(d))}</a></td><td class='r n'>{len(D.venues_on(d))}</td><td class='r n'>{len(D.preds[d]['races'])}</td>"
                 + (f"<td class='r n'>{s['win_hits']}/{s['graded_races']}</td><td class='r n'>{s['tri_hits']}</td>" if s else "<td class=cap colspan=2>結果待ち</td>") + "</tr>")
    o.append("</tbody></table></div></section>")
    page(url("kako"), f"過去の競艇予想と結果の一覧｜{SITE_NAME}",
         f"{SITE_NAME}で公開したAI予想の過去分。{jd(D.dates[0], False, True)}から毎日、全レースの予想と答え合わせを場・日付から探せます。",
         [(SITE_NAME, BASE), ("過去の予想と結果", None)], "".join(o))


# ---------- sitemap ----------
def sitemaps(D: Data) -> list[str]:
    def lm(d: str) -> str:   # 答え合わせ済みなら翌朝、まだなら当日
        return (date.fromisoformat(d) + timedelta(days=1)).isoformat() if d in D.res else d
    t = D.today
    base = [(BASE, t), (url("kako"), t)]
    for vn in VENUES:
        if D.venue_dates(vn):
            base += [(url(SLUG[vn]), t), (url(SLUG[vn], "kiroku"), lm(D.venue_dates(vn)[-1]))]
    months: dict[str, list] = {}
    for d in D.dates:
        m = months.setdefault(d[:7], [])
        m.append((url(d), lm(d)))
        for vn in D.venues_on(d):
            m.append((url(d, SLUG[vn]), lm(d)))
            for x in D.venue_races(d, vn):
                m.append((url(d, SLUG[vn], f"{x['race']}r"), lm(d)))

    def urlset(rows):
        return ('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
                + "\n".join(f"<url><loc>{HOST}{u}</loc><lastmod>{m}</lastmod></url>" for u, m in rows) + "\n</urlset>\n")
    (OUT / "sitemap-base.xml").write_text(urlset(base), encoding="utf-8")
    files = ["sitemap-base.xml"]
    for mo, rows in months.items():
        (OUT / f"sitemap-{mo}.xml").write_text(urlset(rows), encoding="utf-8")
        files.append(f"sitemap-{mo}.xml")
    (OUT / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "\n".join(f"<sitemap><loc>{HOST}{BASE}{f}</loc><lastmod>{t}</lastmod></sitemap>" for f in files) + "\n</sitemapindex>\n", encoding="utf-8")
    return files


def build() -> dict:
    D = Data()
    if not D.dates:
        print("seo_pages: no predictions")
        return {}
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    (OUT / "p.css").write_text(CSS + EXTRA_CSS, encoding="utf-8")
    n = {"race": 0, "venue_day": 0, "date": 0, "venue": 0, "record": 0}
    for d in D.dates:
        date_page(D, d)
        n["date"] += 1
        for vn in D.venues_on(d):
            xs = D.venue_races(d, vn)
            venue_day_page(D, d, vn)
            n["venue_day"] += 1
            for x in xs:
                race_page(D, d, x, xs)
                n["race"] += 1
    for vn in VENUES:
        if D.venue_dates(vn):
            venue_today_page(D, vn)
            venue_record_page(D, vn)
            n["venue"] += 1
            n["record"] += 1
    archive_page(D)
    files = sitemaps(D)
    print("seo_pages", n, "sitemaps", len(files), "->", OUT)
    return n


if __name__ == "__main__":
    build()
