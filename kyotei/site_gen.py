"""公開用の静的ページ(kyotei/site/index.html)を作る。毎朝のワークフローがこのファイルで作り直すので、
見た目や文言を変えるときは出力ではなくここ(テンプレート)を直すこと。

デザインの決めごと(崩さないこと)
- 紙の出走表・予想紙の作法: 白い紙・黒い文字・枠番は公式の枠色(1白 2黒 3赤 4青 5黄 6緑)・印は ◎○▲。
- 赤(朱)は「的中」と払戻金のためだけに使う。万舟(3連単1万円以上)は黄色のマーカー。
- カードを並べない。表と罫線で詰めて見せる。グラデーション・影・絵文字・英語の見出しは使わない。
- 文言は競艇ファンの話し言葉で短く。「〜しましょう」「ぜひ」「徹底」「圧倒的」などの売り文句は書かない。
  当たる保証・買い方の指南(「万舟が出たらやめる」等)は書かない。注意書きは消さず、落ち着いた場所に普通の言葉で置く。

データ: kyotei/site_data.json があればそれを優先し、無い項目は predictions/ results/ summary.json model.json から読む。
"""
from __future__ import annotations

import html
import json
from urllib.parse import quote
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SITE = ROOT / "site"
HERO = SITE / "hero.jpg"  # 見出し写真(生成画像)。gh-pages の kyotei/ にも同じものを置く
PAGE_URL = "https://zeroichiworks.net/kyotei/"
COMMITS = "https://github.com/Hiro0530/zeroichi-store/commits/main/kyotei/predictions/"
HELP_URL = "https://www.gaprsc.or.jp/"

VENUES = ["桐生", "戸田", "江戸川", "平和島", "多摩川", "浜名湖", "蒲郡", "常滑", "津", "三国", "びわこ", "住之江",
          "尼崎", "鳴門", "丸亀", "児島", "宮島", "徳山", "下関", "若松", "芦屋", "福岡", "唐津", "大村"]
VORDER = {n: i for i, n in enumerate(VENUES)}
# 場ごとのページの住所(/kyotei/kiryu/ など。seo_pages.py と共通。変えると検索の入口が切れるので変えない)
SLUGS = ["kiryu", "toda", "edogawa", "heiwajima", "tamagawa", "hamanako", "gamagori", "tokoname", "tsu", "mikuni", "biwako", "suminoe",
         "amagasaki", "naruto", "marugame", "kojima", "miyajima", "tokuyama", "shimonoseki", "wakamatsu", "ashiya", "fukuoka", "karatsu", "omura"]
SLUG = dict(zip(VENUES, SLUGS))
WD = "月火水木金土日"
MANSHU = 10000

TITLE = "AI舟券 答え合わせ帳"
# 見出しの書体は使う文字だけ読み込む(軽くするため)
FONTS = ("<link rel=preconnect href='https://fonts.googleapis.com'><link rel=preconnect href='https://fonts.gstatic.com' crossorigin>"
         "<link rel=stylesheet href='https://fonts.googleapis.com/css2?family=Saira+Condensed:wght@500;600;700"
         "&display=swap'>"
         "<link rel=stylesheet href='https://fonts.googleapis.com/css2?family=Dela+Gothic+One"
         "&text=" + quote("AI舟券答え合わせ帳") + "&display=swap'>")

CSS = """
:root{--paper:#fff;--ink:#222426;--sub:#62676d;--rule:#d9dcdf;--rule2:#9aa0a6;--head:#f2f3f1;
--shu:#c8161d;--shu-soft:#fdeceb;--navy:#17407e;--mark:#ffe55c;--past:#9aa0a6;
--l1:#fff;--l1t:#222;--l2:#222;--l2t:#fff;--l3:#e2262c;--l3t:#fff;--l4:#1662c4;--l4t:#fff;--l5:#f6d200;--l5t:#222;--l6:#11884a;--l6t:#fff;
--jp:"Hiragino Kaku Gothic ProN","Hiragino Sans","BIZ UDPGothic","Noto Sans JP","Noto Sans CJK JP",Meiryo,sans-serif;
--num:"Saira Condensed","Arial Narrow",var(--jp);--disp:"Dela Gothic One",var(--jp);color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--paper:#17191c;--ink:#e9e9e6;--sub:#a3a8ad;--rule:#33373c;--rule2:#5b6168;--head:#202327;
--shu:#ff5d55;--shu-soft:#3a1d1c;--navy:#93b8ff;--mark:#6b5a00;--past:#6c7278;--l1:#f4f4f4;--l2:#000;color-scheme:dark}}
:root[data-theme=dark]{--paper:#17191c;--ink:#e9e9e6;--sub:#a3a8ad;--rule:#33373c;--rule2:#5b6168;--head:#202327;
--shu:#ff5d55;--shu-soft:#3a1d1c;--navy:#93b8ff;--mark:#6b5a00;--past:#6c7278;--l1:#f4f4f4;--l2:#000;color-scheme:dark}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]) .l2{box-shadow:inset 0 0 0 1px #5b6168}}
:root[data-theme=dark] .l2{box-shadow:inset 0 0 0 1px #5b6168}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font:400 15px/1.7 var(--jp);overflow-wrap:break-word}
a{color:var(--navy);text-underline-offset:3px}:focus-visible{outline:3px solid var(--navy);outline-offset:2px}
.wrap{max-width:1080px;margin:0 auto;padding:0 16px}
.n{font-family:var(--num);font-variant-numeric:tabular-nums;font-weight:600;letter-spacing:.01em}
p{margin:0}

/* 題字 */
.mast{padding:14px 0 0}
.mast .by{font-size:12px;color:var(--sub);text-decoration:none}
.mast h1{font:400 clamp(30px,8.4vw,46px)/1.15 var(--disp);margin:6px 0 0;letter-spacing:.02em}
.mast .lead{margin:10px 0 0;font-size:14.5px;max-width:34em}
.waku{display:flex;height:5px;margin-top:14px}.waku i{flex:1}
.waku i:nth-child(1){background:var(--l1);box-shadow:inset 0 0 0 1px var(--rule2)}.waku i:nth-child(2){background:var(--l2)}.waku i:nth-child(3){background:var(--l3)}
.waku i:nth-child(4){background:var(--l4)}.waku i:nth-child(5){background:var(--l5)}.waku i:nth-child(6){background:var(--l6)}

/* 見出し写真 */
.hero{position:relative;background:#0d1b26;color:#fff;overflow:hidden}
.hero img{display:block;width:100%;height:clamp(250px,62vw,420px);object-fit:cover;object-position:45% 60%}
.hero .over{position:absolute;inset:auto 0 0 0;padding:60px 0 16px;background:linear-gradient(to top,rgba(5,14,22,.82),rgba(5,14,22,0))}
.hero .by{color:#d5dde3}
.hero h1{color:#fff;text-shadow:0 1px 12px rgba(0,0,0,.35)}
.hero .lead{color:#e4eaee;margin-top:6px}
.hero .credit{position:absolute;top:8px;right:10px;font-size:10px;color:rgba(255,255,255,.7)}
.mast.hero{padding:0}

/* 自信あり(このページの主役) */
.star{border-top:3px solid var(--ink)}
.srow{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:4px 14px;align-items:center;padding:14px 0 13px;border-bottom:1px solid var(--rule)}
.srow .big{grid-row:span 2}
.srow .big .ln{width:46px;height:46px;font-size:32px;border-radius:3px}
.srow .where{font-weight:700;font-size:19px;line-height:1.2;white-space:nowrap}
.srow .where .n{font-size:24px;margin-left:3px}
.srow .when{font-size:12.5px;color:var(--sub);white-space:nowrap}
.srow .when .n{font-size:17px;color:var(--ink)}
.srow .p{grid-row:span 2;text-align:right;font:700 38px/1 var(--num)}
.srow .p small{font-size:16px}
.srow .p span{display:block;font:500 11px/1.3 var(--jp);color:var(--sub);margin-top:3px}
.srow .tri3{grid-column:2/4;font-size:15px}
.srow.past{opacity:.5}
.srow .closedtag{display:none;font-size:11px;font-weight:700;border:1px solid var(--rule2);padding:1px 4px;margin-left:6px;color:var(--sub)}
.srow.past .closedtag{display:inline-block}
.pub{display:inline-block;background:var(--ink);color:var(--paper);font-size:12.5px;padding:3px 8px;margin-top:10px}
.pub .n{font-size:15px;margin:0 2px}
.ans{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 10px;align-items:center;padding:11px 0;border-bottom:1px solid var(--rule)}
.ans .where{font-weight:700;white-space:nowrap}.ans .where .n{font-size:19px;margin-left:2px}
.ans .what{font-size:12.5px;color:var(--sub);display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.ans .vd{grid-row:span 2;text-align:right}
.ans .vd b{display:inline-block;font-size:17px;font-weight:900;padding:6px 11px;border:3px solid currentColor;line-height:1}
.ans .vd b.ok{color:var(--shu)}.ans .vd b.ng{color:var(--past);border-width:1px;font-weight:700}
.ans .vd small{display:block;font:600 15px/1.3 var(--num);color:var(--shu);margin-top:4px}
.score{font-size:15px;margin:10px 0 2px}.score b{font:700 30px/1 var(--num);color:var(--shu);margin:0 2px}

/* 前日の一行(題字のすぐ下) */
.hook{border-bottom:2px solid var(--ink);padding:14px 0 12px}
.hook p{font-size:16px;line-height:1.6}
.hook b{font:700 30px/1 var(--num);margin:0 2px;color:var(--shu)}
.hook .when{display:block;font-size:12.5px;color:var(--sub);margin-bottom:2px}
.hook .tiny{font-size:12px;color:var(--sub);margin-top:6px}

section{padding:26px 0 6px}
h2{font:900 23px/1.3 var(--jp);margin:0;letter-spacing:.03em}
h2 small{font:700 15px/1 var(--jp);margin-left:10px;color:var(--sub);letter-spacing:0}
h3{font-size:15.5px;margin:22px 0 6px;padding-bottom:4px;border-bottom:2px solid var(--ink)}
.cap{font-size:13px;color:var(--sub);margin:6px 0 0}
.cap b{color:var(--ink)}

/* 枠番 */
.ln{display:inline-grid;place-items:center;width:22px;height:22px;font:700 15px/1 var(--num);flex:none;border-radius:2px}
.ln.s{width:18px;height:18px;font-size:13px}
.l1{background:var(--l1);color:var(--l1t);box-shadow:inset 0 0 0 1px var(--rule2)}.l2{background:var(--l2);color:var(--l2t)}
.l3{background:var(--l3);color:var(--l3t)}.l4{background:var(--l4);color:var(--l4t)}.l5{background:var(--l5);color:var(--l5t)}.l6{background:var(--l6);color:var(--l6t)}
.cb{display:inline-flex;gap:1px;vertical-align:middle;white-space:nowrap}
.mk{display:inline-flex;align-items:center;gap:2px;white-space:nowrap;margin-right:4px;font-size:12px}
td.mks{white-space:nowrap}
.mk:last-child{margin-right:0}

/* 表(出走表ふう) */
.tw{overflow-x:auto;-webkit-overflow-scrolling:touch}
table{border-collapse:collapse;width:100%}
th{font-weight:500;font-size:12px;color:var(--sub);background:var(--head);text-align:left;padding:5px 6px;white-space:nowrap}
td{padding:7px 5px;border-bottom:1px solid var(--rule);vertical-align:middle}
td.r,th.r{text-align:right}
.t-time{font:600 17px/1 var(--num);white-space:nowrap}
.t-race{white-space:nowrap;font-weight:700}
.t-race .n{font-size:18px;margin-left:2px}
.pr{font:700 21px/1 var(--num);white-space:nowrap}
.pr small{font-size:13px;margin-left:1px}
.tier{display:inline-block;font:700 12px/1 var(--num);padding:2px 4px 1px;margin-left:4px;border:1px solid currentColor;border-radius:2px;vertical-align:2px;color:var(--sub)}
.tier.S{color:var(--shu)}
.tri{display:grid;gap:2px}
.tri3{font:500 15px/1.35 var(--num);color:var(--sub);white-space:nowrap}
.tri3 span{margin-right:8px}
td.tri3 span{display:block;margin:0;line-height:1.25}
@media (min-width:600px){td.tri3 span{display:inline;margin-right:8px}}.tri3 span:first-child{color:var(--ink);font-weight:600}
tr.past td{color:var(--past)}tr.past .ln{opacity:.45}tr.past .pr{color:var(--past)}
.closed{display:none;font-size:11px;color:var(--past)}tr.past .closed{display:block}

/* 場ごと */
details.v{border-bottom:1px solid var(--rule)}
details.v>summary{list-style:none;cursor:pointer;display:grid;grid-template-columns:5em 1fr auto;align-items:center;gap:8px;padding:11px 2px;min-height:48px}
details.v>summary::-webkit-details-marker{display:none}
details.v>summary::after{content:"＋";color:var(--sub);font-size:15px;width:1.2em;text-align:center}
details.v[open]>summary::after{content:"－"}
.v-name{font-weight:700;font-size:17px}
.v-meta{font-size:12.5px;color:var(--sub);line-height:1.45}
.v-meta .next{color:var(--ink);font-weight:700}
details.v table{margin-bottom:12px}
.vlist{border-top:2px solid var(--ink);margin-top:10px}

/* 答え合わせ */
.sum{display:flex;flex-wrap:wrap;gap:10px 28px;margin:12px 0 4px;padding:0;list-style:none}
.sum li{font-size:12.5px;color:var(--sub);line-height:1.3}
.sum b{display:block;font:700 30px/1.05 var(--num);color:var(--ink)}
.sum b.hit{color:var(--shu)}
.sum b small{font:500 13px var(--jp);color:var(--sub);margin-left:3px}
.pay{font:700 20px/1 var(--num);white-space:nowrap}
.pay.hit{color:var(--shu)}
.pay.big{font-size:24px}
.man{background:linear-gradient(transparent 55%,var(--mark) 55%)}
.tag{display:inline-block;font-size:11px;font-weight:700;line-height:1;padding:3px 4px 2px;border:1px solid var(--ink);margin-left:6px;vertical-align:2px;border-radius:2px}
.stamp{display:inline-grid;place-items:center;width:46px;height:46px;border:3px solid var(--shu);border-radius:50%;color:var(--shu);font-weight:900;font-size:14px;line-height:1;transform:rotate(-8deg)}
/* 当たりの帯(題字のすぐ下) */
.atari{padding:14px 0 6px;border-bottom:2px solid var(--ink)}
.atari h2{font-size:18px}
.atari h2 small{font-size:13px}
.strip{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(150px,1fr);gap:8px;overflow-x:auto;scroll-snap-type:x mandatory;padding:10px 0 8px;-webkit-overflow-scrolling:touch}
.tile{scroll-snap-align:start;position:relative;border:2px solid var(--shu);padding:10px 10px 9px;background:var(--paper)}
.tile .stamp{position:absolute;top:-4px;right:6px;width:40px;height:40px;font-size:12px;background:var(--paper)}
.tile .w{font-weight:700;font-size:15px;white-space:nowrap}.tile .w .n{font-size:19px;margin-left:2px}
.tile .cb{margin:6px 0 4px}
.tile .pay{display:block;font-size:30px;line-height:1.05}
.tile .pay small{font-size:14px}
.tile .tag{margin:4px 0 0}
.atari .more-l{font-size:13px}
@media (min-width:980px){.strip{grid-auto-flow:row;grid-template-columns:repeat(6,1fr);overflow:visible}}
.why{display:block;grid-column:2/4;font-size:12.5px;color:var(--sub);line-height:1.4}
.near{font-size:12px;color:var(--ink);border:1px solid var(--rule2);padding:2px 5px;border-radius:2px;white-space:nowrap}
.won{font-size:12px;color:var(--ink);white-space:nowrap}
.miss{color:var(--past)}
tr.hit td{background:var(--shu-soft)}
.more>summary{cursor:pointer;color:var(--navy);font-size:13.5px;padding:10px 0;list-style:none}
.more>summary::-webkit-details-marker{display:none}
.pnl{font:600 16px/1 var(--num);white-space:nowrap}
.pnl.pos{color:var(--shu)}
.yen{font:600 16px/1 var(--num);white-space:nowrap}

/* 成績 */
.rec td:first-child{font-size:13.5px}
.rec .n{font-size:19px}
.rec td.base{color:var(--sub)}

/* 注意・作り方 */
.calm{font-size:13px;color:var(--sub);border-top:1px solid var(--rule);margin-top:30px;padding-top:16px}
.calm h2{font:700 14px/1.5 var(--jp);color:var(--ink);margin-bottom:6px}
.calm p+p{margin-top:6px}
.how{margin-top:18px;border-top:1px solid var(--rule)}
.how>summary{cursor:pointer;padding:12px 0;font-weight:700;font-size:14px;list-style:none}
.how>summary::-webkit-details-marker{display:none}
.how>summary::after{content:" ＋";color:var(--sub);font-weight:400}.how[open]>summary::after{content:" －"}
.how .in{font-size:13.5px;color:var(--sub);padding-bottom:10px}
.how .in h3{color:var(--ink);font-size:14px;border-bottom-width:1px;margin-top:16px}
.how .in p,.how .in ul{margin:6px 0}
.how table{font-size:13px;color:var(--ink);min-width:300px}
.how td,.how th{white-space:nowrap}.how td:first-child{white-space:normal}
footer{margin-top:26px;border-top:2px solid var(--ink);padding:14px 0 36px;font-size:12px;color:var(--sub)}
footer p+p{margin-top:5px}

@media (min-width:980px){
 body{font-size:15.5px}
 .mast{padding-top:22px}
 .top2{display:grid;grid-template-columns:minmax(0,1fr) 380px;grid-template-areas:"st ans" "all hits";gap:0 56px;align-items:start}
 .top2>.st{grid-area:st}.top2>.ans-s{grid-area:ans}.top2>.all{grid-area:all}.top2>.hits{grid-area:hits}
 .hook p{font-size:18px}
 #kotae,.recs,.calm,.how{max-width:760px}
 h2{font-size:26px}
}
.vgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(76px,1fr));gap:6px;margin-top:10px}
.vgrid a{display:block;text-align:center;border:1px solid var(--ink);padding:9px 4px;text-decoration:none;color:var(--ink);font-weight:700;font-size:15px}
.vgrid a.off{border-color:var(--rule2);color:var(--sub);font-weight:500}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
"""

JS = """
(function(){var now=Date.now();
document.querySelectorAll('tr[data-close],.srow[data-close],.ac[data-close]').forEach(function(r){if(Date.parse(r.dataset.close)<now)r.classList.add('past')});
document.querySelectorAll('details.v[data-pred]').forEach(function(d){var nx=null;d.querySelectorAll('tr[data-close]').forEach(function(r){if(!nx&&Date.parse(r.dataset.close)>=now)nx=r});
var m=d.querySelector('.next');if(!m)return;m.textContent=nx?('次 '+nx.dataset.r+'R '+nx.dataset.close.slice(11,16).replace(/^0/,'')):'本日終了'});})();
"""


# ---------- 小さな部品 ----------
def esc(s) -> str:
    return html.escape(str(s))


def pct(x: float, nd: int = 1) -> str:
    return f"{x*100:.{nd}f}%"


def hm(iso: str) -> str:
    """'2026-10-25T09:05:00+09:00' -> '9:05'"""
    t = iso[11:16]
    return t[1:] if t.startswith("0") else t


def jday(d: str, wd: bool = True) -> str:
    x = date.fromisoformat(d[:10])
    return f"{x.month}月{x.day}日" + (f"({WD[x.weekday()]})" if wd else "")


def sday(d: str) -> str:
    x = date.fromisoformat(d[:10])
    return f"{x.month}/{x.day}"


def lane(n, small: bool = False) -> str:
    return f"<span class='ln l{int(n)}{' s' if small else ''}'>{int(n)}</span>"


def combo(c, small: bool = True) -> str:
    parts = [p for p in str(c).split("-") if p.strip().isdigit()]
    if len(parts) != 3:
        return esc(c)
    return f"<span class=cb role=img aria-label='{esc(c)}'>" + "".join(lane(p, small) for p in parts) + "</span>"


def yen(v) -> str:
    return f"{int(v):,}円"


def signed(v: int) -> str:
    cls = "pos" if v > 0 else ""
    s = "+" if v > 0 else ("−" if v < 0 else "±")
    return f"<span class='pnl {cls}'>{s}{abs(int(v)):,}円</span>"


def marks(probs) -> str:
    """確率の高い順に ◎○▲(予想紙の印)"""
    order = sorted(range(len(probs)), key=lambda i: -probs[i])[:3]
    return "".join(f"<span class=mk>{m}{lane(i + 1, True)}</span>" for m, i in zip("◎○▲", order))


def vkey(name: str) -> int:
    return VORDER.get(name, 99)


def group(rows):
    g: dict[str, list] = {}
    for x in rows:
        g.setdefault(x["venue_name"], []).append(x)
    return dict(sorted(g.items(), key=lambda kv: vkey(kv[0])))


def rlink(d: str, vn: str, n) -> str:
    """レースごとのページ(seo_pages.py が作る /kyotei/{日付}/{場}/{R}r/)へのリンク"""
    sl = SLUG.get(vn)
    return f"<a href='{esc(d)}/{sl}/{int(n)}r/' style='color:inherit'>{int(n)}</a>" if sl else str(n)


def venues_nav_html(p: dict | None) -> str:
    """場ごとのページ(/kyotei/kiryu/ など)と過去の一覧への入口。今日開催の場を先に。"""
    on = [v for v in VENUES if p and any(x["venue_name"] == v for x in p["races"])]
    known = set()   # ページがある場(予想を出したことのある場)だけ
    for f in (ROOT / "predictions").glob("*.json"):
        known |= {x.get("venue_name") for x in json.loads(f.read_text(encoding="utf-8"))["races"]}
    rest = [v for v in VENUES if v not in on and v in known]
    a = "".join(f"<a href='{SLUG[v]}/'>{esc(v)}</a>" for v in on)
    b = "".join(f"<a class=off href='{SLUG[v]}/'>{esc(v)}</a>" for v in rest)
    return ("<section class=vnav aria-labelledby=h-vnav><h2 id=h-vnav>場ごとの予想と成績</h2>"
            "<p class=cap>場の名前から、その場の今日の本命と展開の見立て、前回の答え合わせ、通算の成績へ。</p>"
            f"<div class=vgrid>{a}{b}</div><p class=cap><a href='kako/'>過去の予想と結果(日付・場から探す)</a></p></section>")


def tier_mark(t) -> str:
    return f"<span class='tier {esc(t)}' title='自信度'>{esc(t)}</span>" if t in ("S", "A") else ""


# ---------- データ ----------
def load():
    """数字は site_data.py(予想側)がまとめる site_data.json から。ここは見た目と文言だけ。"""
    import site_data  # type: ignore
    data = site_data.build()
    rec = data.get("record") or {}
    summ = {"total": rec.get("total") or {}, "daily": rec.get("daily") or [], "tiers": rec.get("tiers_live") or {}}
    return data, data.get("today"), data.get("yesterday"), summ, data.get("model") or {}


STAR_N = 5  # 自信あり = 採点対象のうち◎の1着率が高い順に5レース(前日の答え合わせも同じ決め方で選ぶ)


def stars(pred: dict | None) -> list:
    if not pred:
        return []
    xs = [x for x in pred["races"] if x.get("scored", True)]
    top = sorted(xs, key=lambda x: (-max(x["probs"]), x["close"]))[:STAR_N]
    return sorted(top, key=lambda x: x["close"])


def load_pred(d: str):
    f = ROOT / "predictions" / f"{d}.json"
    return json.loads(f.read_text(encoding="utf-8")) if f.exists() else None


def why_html(x: dict) -> str:
    """◎の選手の公開データ(番組表)を一言。予想の根拠の目安で、計算そのものではない。"""
    rs = x.get("racers") or []
    if len(rs) != 6:
        return ""
    b = rs[x["pick"] - 1]
    top = lambda k: b[k] > 0 and b[k] >= max(z[k] for z in rs)  # noqa: E731
    t = f"{b['name']}({b['cls']}) 全国勝率{b['nat_win']:.2f}" + ("(メンバー1位)" if top("nat_win") else "")
    if b["loc_win"] > 0:
        t += f"・当地{b['loc_win']:.2f}"
    t += f"・モーター2連率{b['motor_2']:.0f}%"
    return f"<span class=why>{esc(t)}</span>"


def star_today_html(p: dict) -> str:
    xs = stars(p)
    if not xs:
        return ""
    pub = p["published_at"]
    first = min(x["close"] for x in p["races"])
    o = [f"<section class=st aria-labelledby=h-star><h2 id=h-star>今日の自信あり<small>{esc(jday(p['date']))}</small></h2>"
         f"<p class=pub>公開 <span class=n>{esc(jday(pub, False))} {esc(hm(pub))}</span>/最初の締切 <span class=n>{esc(hm(first))}</span></p>"
         f"<p class=cap>◎の1着率が高い順に{len(xs)}レース。並びは締切順。明日の朝、このまま答え合わせします。</p><div class=star>"]
    for x in xs:
        tri = "".join(f"<span>{esc(c)}</span>" for c, _ in x["trifecta"])
        o.append(f"<div class=srow data-close='{esc(x['close'])}'><span class=big>{lane(x['pick'])}</span>"
                 f"<span class=where>{esc(x['venue_name'])}<span class=n>{x['race']}R</span><span class=closedtag>締切済</span></span>"
                 f"<span class=p>{max(x['probs'])*100:.0f}<small>%</small><span>1着率</span></span>"
                 f"<span class=when><span class=n>{esc(hm(x['close']))}</span> 締切</span>"
                 f"<span class=tri3>3連単 {tri}</span>{why_html(x)}</div>")
    o.append("</div></section>")
    return "".join(o)


def star_answer_html(r: dict, prev: dict | None, label: str) -> str:
    xs = stars(prev)
    if not xs:
        return ""
    res = {x["key"]: x for x in r["races"]}
    rows, win, tri = [], 0, 0
    for x in xs:
        y = res.get(x["key"])
        if not y:
            continue
        win += bool(y.get("win_hit"))
        tri += bool(y.get("tri_hit"))
        if y.get("win_hit"):
            vd = f"<b class=ok>当たり</b><small>単勝 {int(y.get('pay_win') or 0):,}円</small>"
            if y.get("tri_hit"):
                vd += f"<small>3連単 {int(y['pay_tri']):,}円</small>"
        else:
            vd = "<b class=ng>外れ</b>"
        rows.append(f"<div class=ans><span class=where>{esc(x['venue_name'])}<span class=n>{x['race']}R</span></span>"
                    f"<span class=vd>{vd}</span><span class=what>◎{lane(x['pick'], True)} 結果 {combo(y['actual'])}</span></div>")
    if not rows:
        return ""
    n = len(rows)
    return (f"<section class=ans-s aria-labelledby=h-ans><h2 id=h-ans>{esc(label)}の自信あり、結果</h2>"
            f"<p class=score>{n}レース中 ◎が<b>{win}</b>勝。3連単も<b>{tri}</b>本的中。</p>"
            f"<p class=cap>{esc(jday(prev['published_at'], False))} {esc(hm(prev['published_at']))}に出した{n}レースです。</p>"
            f"<div class=star>{''.join(rows)}</div></section>")


# ---------- 荒れ予報(2026-10-29〜。are.py が予想ファイルに書いた荒れ度・理由・組み合わせ候補を見せる) ----------
ARE_NAMES = {1: ("晴れ", "堅め"), 2: ("くもり", "ふつう"), 3: ("雨", "荒れ気味"), 4: ("嵐", "大荒れ注意")}
ARE_NOTE = "試験中。荒れ予報は1号艇以外が来やすいかの目安で、的中や利益を保証するものではありません。舟券は20歳から。"
ARE_EVID = ("過去半年(2026年4月30日〜10月28日・28,325レース)の検証では、混戦度が1日の上位3レースは"
            "万舟(3連単1万円以上)が26%(全体は16%)、1号艇の1着が30%(全体は55%)でした。それでも4レースに3レースは万舟になっていません。")
ARE_PRE = ("締切前に公式の直前情報で「風5m以上」「波5cm以上」「1号艇の展示タイムが5・6番手」「進入の乱れ」があれば、"
           "朝の見立てよりさらに1号艇が苦しくなりやすい傾向です(同じ検証で1号艇の1着が2〜7ポイント下がる)。この予報は朝の数字だけで作っています。")
ARE_CSS = """
:root{--sun:#e9a100;--cloud:#a9b1ba;--cloud2:#7d8792;--rain:#2f6fd1;--storm:#3b4250;--bolt:#ffc93d;--lv1:#e9a100;--lv2:#8d97a2;--lv3:#2f6fd1;--lv4:#3a2f6b;--lvs:#f4f1fb}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--cloud:#8e98a3;--cloud2:#6d7782;--storm:#c9cfd8;--lv4:#a99bf0;--lvs:#24213a}}
:root[data-theme=dark]{--cloud:#8e98a3;--cloud2:#6d7782;--storm:#c9cfd8;--lv4:#a99bf0;--lvs:#24213a}
.wxi{display:inline-block;vertical-align:middle;flex:none}
.arek{padding-top:22px}
.are-hd{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.beta{font-size:11px;font-weight:700;border:1px solid var(--ink);padding:2px 5px 1px;border-radius:2px;line-height:1.2}
.are-cards{display:grid;gap:12px;margin-top:12px}
@media (min-width:760px){.are-cards{grid-template-columns:repeat(3,minmax(0,1fr))}}
.ac{position:relative;border:1px solid var(--rule2);border-top:5px solid var(--lvc,var(--lv3));padding:12px 14px 12px;background:var(--paper);display:flex;flex-direction:column;gap:9px}
.ac.lv1{--lvc:var(--lv1)}.ac.lv2{--lvc:var(--lv2)}.ac.lv3{--lvc:var(--lv3)}.ac.lv4{--lvc:var(--lv4)}
.ac-top{display:flex;align-items:center;gap:10px}
.ac-lv b{display:block;font:900 26px/1 var(--jp);color:var(--lvc)}
.ac-lv span{font-size:12px;color:var(--sub)}
.meter{margin-left:auto;display:flex;gap:3px;align-items:flex-end}
.meter i{display:block;width:9px;background:var(--rule);border-radius:1px}
.meter i:nth-child(1){height:8px}.meter i:nth-child(2){height:13px}.meter i:nth-child(3){height:18px}.meter i:nth-child(4){height:23px}
.meter i.on{background:var(--lvc,var(--lv3))}
.ac-race{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.ac-race a{font-weight:900;font-size:20px;color:var(--ink);text-decoration:none}
.ac-race a .n{font-size:24px;margin-left:2px}
.ac-race .when{font-size:12.5px;color:var(--sub)}.ac-race .when .n{font-size:16px;color:var(--ink)}
.ac .closedtag{display:none;font-size:11px;font-weight:700;border:1px solid var(--rule2);padding:1px 4px;color:var(--sub)}
.ac.past{opacity:.55}.ac.past .closedtag{display:inline-block}
.ac-type{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px;color:var(--sub)}
.ac-type .tp{font-weight:900;font-size:13px;color:var(--paper);background:var(--lvc,var(--lv3));padding:3px 7px 2px;border-radius:2px}
.ac-type .tp.hon{background:none;color:var(--ink);border:1px solid var(--ink)}
.ac-type b{font:700 18px/1 var(--num);color:var(--ink)}
.ac-why{margin:0;padding:0;list-style:none;font-size:13px;line-height:1.45}
.ac-why li{padding-left:12px;position:relative}.ac-why li:before{content:"";position:absolute;left:2px;top:.6em;width:5px;height:5px;background:var(--lvc,var(--lv3));border-radius:50%}
.mot{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:3px;align-items:end;max-width:440px}
.mot>span{display:flex;flex-direction:column;align-items:center;gap:2px;font:600 13px/1 var(--num);color:var(--sub);padding:3px 0 2px;border-radius:2px}
.mot>span.low{background:var(--lvs);color:var(--ink);box-shadow:inset 0 0 0 1px var(--lvc,var(--lv3))}
.mot .ml{font:500 10.5px/1.2 var(--jp);color:var(--sub)}
.k2{font-size:11.5px;color:var(--sub);display:flex;justify-content:space-between;gap:6px}
.cands{display:grid;gap:4px}
.cand{display:grid;grid-template-columns:auto auto 1fr;align-items:center;gap:2px 8px;border-top:1px dashed var(--rule);padding-top:5px}
.cand .ap{font:700 16px/1 var(--num)}
.cand .hs{grid-column:1/4;font-size:11.5px;color:var(--sub);line-height:1.35}
.ac-go{font-size:13px;margin-top:auto}
.ly{display:inline-block;font-size:11px;font-weight:900;color:var(--paper);background:var(--ink);padding:2px 5px 1px;border-radius:2px;margin-right:6px;line-height:1.3}
.ly.sub{background:none;color:var(--ink);box-shadow:inset 0 0 0 1px var(--ink)}
.lys{display:grid;gap:5px}
.lyr{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.lyr .ap{font:700 15px/1 var(--num);color:var(--sub);margin-right:6px}
.are-note{font-size:12.5px;color:var(--sub);margin-top:10px;line-height:1.6}
.are-note b{color:var(--ink)}
.are-note p+p{margin-top:6px}
.are-res{margin-top:18px;max-width:820px}
.are-res .score b{color:var(--ink)}
.are-res .score b.hit{color:var(--shu)}
.are-sec{border:1px solid var(--rule2);border-top:5px solid var(--lvc,var(--lv3));padding:12px 14px;margin-top:16px}
.are-sec .ac-top{margin-bottom:6px}
.are-sec h2{font-size:18px}
.are-sec .out{font-size:14px;margin-top:8px;padding-top:8px;border-top:1px solid var(--rule)}
td .wxi{margin-left:3px;vertical-align:-3px}
.art .wxi{margin:0 4px 0 0}.art .vdl{display:block;font-size:12px;margin-top:2px}.art td{padding:7px 4px}.art .t-race .tag{margin-left:4px}
@media (max-width:599px){.art .t-race .tag{display:block;width:max-content;margin:3px 0 0}.art .pay{font-size:17px}}
"""


def wx_icon(lv: int, s: int = 40) -> str:
    """荒れ度の天気の絵(SVG)。1 晴れ・2 くもり・3 雨・4 嵐。"""
    lv = int(lv or 1)
    cloud = lambda f, dy=0: (f"<path fill='{f}' d='M13 {29+dy}h20a7 7 0 0 0 0-14 9.5 9.5 0 0 0-18-2.4A6.6 6.6 0 0 0 13 {29+dy}z'/>")  # noqa: E731
    if lv == 1:
        rays = "".join(f"<line x1='20' y1='4' x2='20' y2='8' transform='rotate({a} 20 20)'/>" for a in range(0, 360, 45))
        body = f"<g stroke='var(--sun)' stroke-width='2.6' stroke-linecap='round'>{rays}</g><circle cx='20' cy='20' r='8' fill='var(--sun)'/>"
    elif lv == 2:
        body = ("<circle cx='14' cy='14' r='6' fill='var(--sun)' opacity='.85'/>" + cloud("var(--cloud)", 2))
    elif lv == 3:
        body = (cloud("var(--cloud2)", -3) + "<g stroke='var(--rain)' stroke-width='2.4' stroke-linecap='round'>"
                "<line x1='15' y1='30' x2='13' y2='35'/><line x1='21' y1='30' x2='19' y2='35'/><line x1='27' y1='30' x2='25' y2='35'/></g>")
    else:
        body = (cloud("var(--storm)", -4) + "<path fill='var(--bolt)' d='M21 23l-6 9h5l-2 7 8-10h-5l3-6z'/>"
                "<g stroke='var(--rain)' stroke-width='2.2' stroke-linecap='round'><line x1='12' y1='29' x2='10' y2='34'/><line x1='31' y1='29' x2='29' y2='34'/></g>")
    return f"<svg class=wxi width={s} height={s} viewBox='0 0 40 40' role=img aria-label='{ARE_NAMES[lv][0]}'>{body}</svg>"


def are_meter(lv: int) -> str:
    return "<span class=meter aria-hidden=true>" + "".join(f"<i{' class=on' if i < lv else ''}></i>" for i in range(4)) + "</span>"


def are_head(a: dict, size: int = 44) -> str:
    lv = int(a.get("lv") or 1)
    nm, sub = ARE_NAMES[lv]
    return (f"<div class=ac-top>{wx_icon(lv, size)}<div class=ac-lv><b>{nm}</b><span>荒れ度{lv}/4・{sub}</span></div>{are_meter(lv)}</div>")


def are_motor(x: dict, a: dict) -> str:
    rs = x.get("racers") or []
    if len(rs) != 6:
        return ""
    cells = []
    for i, b in enumerate(rs):
        low = i == 0 and a.get("motor_low")
        m = f"{b['motor_2']:.0f}%" if b.get("motor_2") else "—"
        cells.append(f"<span{' class=low' if low else ''}>{lane(i + 1, True)}{m}" + ("<span class=ml>下位</span>" if low else "") + "</span>")
    return "<div><div class=k2><span>モーター2連率(番組表)</span></div><div class=mot>" + "".join(cells) + "</div></div>"


def are_cands(a: dict, vn: str) -> str:
    cs = a.get("cands") or []
    if not cs:
        return ""
    o = ["<div><div class=k2><span><b class=ly>狙い</b>万舟の組み合わせ候補(参考)</span><span>1号艇抜き・AIの確率順</span></div><div class=cands>"]
    for c in cs:
        k, p, fa, pa, fv, pv = (list(c) + [None] * 6)[:6]
        hs = []
        if fa is not None:
            hs.append(f"全国 {fa*100:.2f}%" + (f"・平均{int(pa):,}円" if pa else ""))
        if fv is not None:
            hs.append(f"{esc(vn)} {fv*100:.2f}%" + (f"・平均{int(pv):,}円" if pv else ""))
        o.append(f"<div class=cand>{combo(k)}<span class=ap>{p*100:.1f}<small>%</small></span><span class=cap style='margin:0'>AIの確率</span>"
                 + (f"<span class=hs>過去1年の出た割合 {' / '.join(hs)}</span>" if hs else "") + "</div>")
    o.append("</div></div>")
    return "".join(o)


def are_layers(x: dict, a: dict, vn: str) -> str:
    """買い目の3層: 本線=AIの本命(3連単の1番手)、抑え=次点(2・3番手)、狙い=本命なしのレースだけ万舟の組み合わせ候補。"""
    tri = x.get("trifecta") or []
    o = ["<div class=lys>"]
    if tri:
        c0, p0_ = tri[0]
        o.append(f"<div class=lyr><b class=ly>本線</b><span>◎{lane(x['pick'], True)}</span>{combo(c0)}<span class=ap>{p0_*100:.1f}<small>%</small></span></div>")
    if len(tri) > 1:
        o.append("<div class=lyr><b class='ly sub'>抑え</b>" + "".join(f"{combo(c)}<span class=ap>{p*100:.1f}<small>%</small></span>" for c, p in tri[1:3]) + "</div>")
    o.append("</div>")
    if a.get("cands"):
        o.append(are_cands(a, vn))
    else:
        o.append("<p class=cap style='margin:0'><b class='ly sub'>狙い</b>本命ありのレースなので、万舟の候補は出していません。</p>")
    return "".join(o)


def are_type(x: dict, a: dict) -> str:
    if a.get("nashi"):
        return f"<div class=ac-type><span class=tp>本命なし=荒れ予想</span><span>1号艇の1着 AI <b>{x['probs'][0]*100:.0f}%</b></span></div>"
    return (f"<div class=ac-type><span class='tp hon'>本命あり</span><span>◎{lane(x['pick'], True)} AI <b>{max(x['probs'])*100:.0f}%</b></span></div>")


def are_card(d: str, x: dict) -> str:
    a = x.get("are") or {}
    lv = int(a.get("lv") or 1)
    vn = x["venue_name"]
    why = "".join(f"<li>{esc(t)}</li>" for t in a.get("reasons") or [])
    return (f"<article class='ac lv{lv}' data-close='{esc(x['close'])}'>{are_head(a)}"
            f"<div class=ac-race><a href='{rlink_url(d, vn, x['race'])}'>{esc(vn)}<span class=n>{x['race']}R</span></a>"
            f"<span class=when>締切 <span class=n>{esc(hm(x['close']))}</span></span><span class=closedtag>締切済</span></div>"
            + are_type(x, a) + (f"<ul class=ac-why>{why}</ul>" if why else "") + are_motor(x, a) + are_layers(x, a, vn)
            + f"<a class=ac-go href='{rlink_url(d, vn, x['race'])}'>出走表と確率を見る</a></article>")


def rlink_url(d: str, vn: str, n) -> str:
    sl = SLUG.get(vn)
    return f"{esc(d)}/{sl}/{int(n)}r/" if sl else "#"


def are_today_html(p: dict | None, r: dict | None, total: dict | None, label: str) -> str:
    """トップの「今日の荒れ予報 TOP3」と、前日の結果・通算。are が無い(出さない日)は空。"""
    a = (p or {}).get("are")
    races = {x["key"]: x for x in (p or {}).get("races", [])}
    top = [races[z["key"]] for z in (a or {}).get("races", []) if z["key"] in races and races[z["key"]].get("are")]
    res_html = are_result_html(r, total, label, placeholder=bool(top))
    if not top and not res_html:
        return ""
    o = ["<section class=arek aria-labelledby=h-are><div class=are-hd><h2 id=h-are>今日の荒れ予報<small>TOP3</small></h2><span class=beta>試験中</span></div>"]
    if top:
        n_nashi = len((a or {}).get("nashi") or [])
        o.append("<p class=cap>AIの予想が割れている(混戦の)レースほど荒れ度が上がります。今日いちばん割れている3レースを締切順に。"
                 + (f"全レースのうち「本命なし」は{n_nashi}レース。" if n_nashi else "") + "</p><div class=are-cards>")
        o += [are_card(p["date"], x) for x in top]
        o.append("</div>")
    else:
        o.append("<p class=cap>今日の荒れ予報はまだ出ていません。毎朝7時ごろ、予想と一緒に出ます。</p>")
    o.append(f"<div class=are-note><p><b>{esc(ARE_NOTE)}</b></p><p>{esc(ARE_EVID)}</p><p>{esc(ARE_PRE)}</p>"
             "<p>買い目は3つの層で見せています。本線=AIの本命(3連単の1番手)、抑え=次点(2・3番手)、狙い=本命なしのレースだけ、1号艇を含まない3連単をAIの確率が高い順に3つ。買い方の指南ではなく、回収率が100%を超えることも確かめていません。</p></div>")
    o.append(res_html)
    o.append("</section>")
    return "".join(o)


def are_result_html(r: dict | None, total: dict | None, label: str, placeholder: bool = False) -> str:
    """前日の荒れ予報の結果(TOP3 と本命なしの組み合わせ候補。外れも全部)と通算。"""
    rows = (r or {}).get("are") or []
    s = ((r or {}).get("summary") or {}).get("are")
    t = total or {}
    o = []
    if rows and s:
        t3 = [z for z in rows if z.get("top3")]
        b = s.get("best")
        o.append(f"<div class=are-res><h3>{esc(label)}の荒れ予報、結果<small style='font-weight:400;color:var(--sub);margin-left:6px'>{esc(jday(r['summary']['date']))}</small></h3>"
                 f"<p class='score'>TOP3のうち、1号艇が負けたのは<b>{s['lane1_lost']}</b>レース、万舟は<b class={'hit' if s['manshu_races'] else ''}>{s['manshu_races']}</b>本。")
        if b and b.get("pay"):
            o.append(f"いちばん高い3連単は{esc(b['venue_name'])}{b['race']}Rの{int(b['pay']):,}円でした。")
        o.append("</p><div class=tw><table class=art><thead><tr><th>レース</th><th>結果</th><th>1号艇</th><th class=r>3連単・買い目</th></tr></thead><tbody>")
        for z in sorted(rows, key=lambda z: (not z.get("top3"), z["venue_name"], z["race"])):
            pay = z.get("trifecta_payout") or 0
            big = pay >= MANSHU
            o.append(f"<tr{' class=hit' if z.get('cand_hit') or z.get('layer') else ''}><td class=t-race>{wx_icon(z.get('lv') or 1, 20)}{esc(z['venue_name'])}<span class=n>{rlink(r['summary']['date'], z['venue_name'], z['race'])}R</span>"
                     + ("<span class=tag>TOP3</span>" if z.get("top3") else "") + f"</td><td>{combo(z['actual'])}</td>"
                     f"<td>{'勝ち' if z.get('lane1_won') else '<b>負け</b>'}</td>"
                     f"<td class=r>" + (f"<span class='pay{' hit' if z.get('cand_hit') else ''}'><span class={'man' if big else ''}>{int(pay):,}</span><small>円</small></span>" if pay else "—")
                     + (f"<span class=vdl style='color:var(--shu);font-weight:700'>{esc(z.get('layer') or '狙い')}が的中</span>" if z.get('layer') or z.get('cand_hit') else "<span class='vdl miss'>本線・抑え・狙いとも外れ</span>") + "</td></tr>")
        o.append("</tbody></table></div>")
        nb = s.get("nashi") or {}
        if nb.get("races"):
            o.append(f"<p class=cap>本命なしの{nb['races']}レースで出した狙い(万舟の組み合わせ候補・各3点)は、的中{nb['cand_hits']}本。"
                     f"仮に100円ずつなら{nb['cand_stake']:,}円が{nb['cand_return']:,}円。TOP3以外の本命なし(嵐)のレースも全部載せています。</p>")
        o.append("</div>")
    if t.get("races"):
        nb = t.get("nashi") or {}
        o.append(f"<div class=are-res><h3>荒れ予報の通算<small style='font-weight:400;color:var(--sub);margin-left:6px'>{t['days']}日</small></h3>"
                 "<div class=tw><table class=rec><thead><tr><th></th><th class=r>レース</th><th class=r>1号艇の負け</th><th class=r>万舟</th></tr></thead><tbody>"
                 f"<tr><td>荒れ予報TOP3</td><td class='r n'>{t['races']}</td><td class='r n'>{t['lane1_lost']}({t['lane1_lost']/t['races']*100:.0f}%)</td>"
                 f"<td class='r n'>{t['manshu_races']}({t['manshu_races']/t['races']*100:.0f}%)</td></tr>")
        if nb.get("races"):
            o.append(f"<tr><td>本命なし(全部)</td><td class='r n'>{nb['races']}</td><td class='r n'>{nb['lane1_lost']}({nb['lane1_lost']/nb['races']*100:.0f}%)</td>"
                     f"<td class='r n'>{nb['manshu_races']}({nb['manshu_races']/nb['races']*100:.0f}%)</td></tr>")
        o.append("</tbody></table></div>")
        lv = t.get("levels") or {}
        if lv:
            o.append("<div class=tw style='margin-top:8px'><table class=rec><thead><tr><th>荒れ度(全レース)</th><th class=r>レース</th><th class=r>1号艇の1着</th><th class=r>万舟</th></tr></thead><tbody>")
            for k in ("1", "2", "3", "4"):
                v = lv.get(k)
                if v and v.get("races"):
                    o.append(f"<tr><td>{wx_icon(int(k), 22)} {ARE_NAMES[int(k)][0]}</td><td class='r n'>{v['races']}</td>"
                             f"<td class='r n'>{v['lane1_won']/v['races']*100:.0f}%</td><td class='r n'>{v['manshu']/v['races']*100:.0f}%</td></tr>")
            o.append("</tbody></table></div>")
        if nb.get("cand_stake"):
            o.append(f"<p class=cap>組み合わせ候補は通算 的中{nb['cand_hits']}本、仮の回収率{nb['cand_return']/nb['cand_stake']*100:.0f}%"
                     f"(100円ずつ・{nb['cand_stake']:,}円)。100%を切っていれば、そのまま買うと平均では負けていたということです。</p>")
        o.append("</div>")
    if not o and placeholder:
        o.append("<p class=cap style='margin-top:14px'>荒れ予報の答え合わせは翌朝から。1号艇が負けたか・万舟になったか・組み合わせ候補の当たり外れを、外れも含めて全部ここに載せます。</p>")
    return "".join(o)


def are_mark(x: dict) -> str:
    """表の中の小さな天気(雨・嵐だけ)。"""
    a = x.get("are") or {}
    lv = int(a.get("lv") or 0)
    return wx_icon(lv, 18) if lv >= 3 else ""


# ---------- 各ブロック ----------
def hook_html(p, r, prev) -> str:
    """題字の下の一行。前日の自信ありの成績と、3連単の本数・最高払戻。毎日ここを見に来てもらう場所。"""
    if not r:
        return ""
    s, xs = r["summary"], r["races"]
    hits = sorted([x for x in xs if x.get("tri_hit")], key=lambda x: -(x.get("pay_tri") or 0))
    when = "昨日" if p and (date.fromisoformat(p["date"]) - date.fromisoformat(s["date"])).days == 1 else sday(s["date"])
    res = {x["key"]: x for x in xs}
    st = [res[x["key"]] for x in stars(prev) if x["key"] in res]
    o = [f"<div class=hook><p><span class=when>{esc(jday(s['date']))}の答え合わせ</span>"]
    if st:
        o.append(f"{when}の自信ありは{len(st)}レース中、◎が<b>{sum(1 for y in st if y.get('win_hit'))}</b>勝。")
    if hits:
        b = hits[0]
        o.append(f"3連単は全体で<b>{len(hits)}</b>本的中。")
        man = sum(1 for x in hits if (x.get("pay_tri") or 0) >= MANSHU)
        if man:
            o.append(f"万舟も{man}本取っています。")
    else:
        o.append(f"3連単の的中はありませんでした。◎の1着は{s['win_hits']}本。")
    o.append(f"</p><p class=tiny>外れも含めて全{s['graded_races']}レース、<a href='#kotae'>下の答え合わせ</a>に載せています。</p></div>")
    return "".join(o)


def today_html(p: dict) -> str:
    races = p["races"]
    first = min(x["close"] for x in races)
    pub = p["published_at"]
    proof = f"{COMMITS}{esc(p['date'])}.json"
    nv = len(group(races))
    o = [f"<section class=all aria-labelledby=h-today><h2 id=h-today>全レースの予想<small>{nv}場{len(races)}R</small></h2>"
         f"<p class=cap>どれも<b>{esc(jday(pub, False))} {esc(hm(pub))}</b>に公開(いちばん早い締切は{esc(hm(first))})。"
         f"出したあとで書き換えると<a href='{proof}'>記録の履歴</a>に残ります。</p>"]
    o.append("<p class=cap>印は1着の確率が高い順に◎○▲。3連単は確率の高い3点です。</p><div class=vlist>")
    for vn, xs in group(races).items():
        o.append(f"<details class=v data-pred><summary><span class=v-name>{esc(vn)}</span>"
                 f"<span class=v-meta>{len(xs)}R・{esc(hm(xs[0]['close']))}〜{esc(hm(xs[-1]['close']))}<br><span class=next></span></span></summary>"
                 "<div class=tw><table><thead><tr><th>R</th><th>締切</th><th>印</th><th class=r>◎1着率</th><th>3連単</th></tr></thead><tbody>")
        for x in xs:
            tri = "".join(f"<span>{esc(c)}</span>" for c, _ in x["trifecta"])
            note = "" if x.get("scored", True) else "<span class=closed style='display:block'>公開前に締切(採点外)</span>"
            o.append(f"<tr data-close='{esc(x['close'])}' data-r='{x['race']}'><td class='t-race'><span class=n>{rlink(p['date'], vn, x['race'])}</span>{are_mark(x)}</td>"
                     f"<td class=t-time>{esc(hm(x['close']))}{note}</td><td class=mks>{marks(x['probs'])}</td>"
                     f"<td class='r pr'>{max(x['probs'])*100:.0f}<small>%</small>{tier_mark(x.get('tier'))}</td><td class=tri3>{tri}</td></tr>")
        o.append("</tbody></table></div></details>")
    o.append("</div></section>")
    return "".join(o)


def atari_html(r: dict | None, label: str) -> str:
    """題字のすぐ下の「当たり」の帯。前日の3連単の的中を払戻の高い順に6本。"""
    if not r:
        return ""
    hits = sorted([x for x in r["races"] if x.get("tri_hit")], key=lambda x: -(x.get("pay_tri") or 0))
    if not hits:
        return ""
    o = [f"<section class=atari aria-labelledby=h-atari><h2 id=h-atari>{esc(label)}の当たり<small>3連単 {len(hits)}本・払戻の高い順</small></h2><div class=strip>"]
    for x in hits[:6]:
        pay = int(x["pay_tri"])
        big = pay >= MANSHU
        o.append(f"<div class=tile><span class=stamp>的中</span><span class=w>{esc(x['venue_name'])}<span class=n>{x['race']}R</span></span>"
                 f"<div>{combo(x['actual'])}</div><span class='pay hit'><span class={'man' if big else ''}>{pay:,}</span><small>円</small></span>"
                 + ("<span class=tag>万舟</span>" if big else "") + "</div>")
    o.append("</div>" + (f"<p class=more-l><a href='#h-hits'>残りの{len(hits) - 6}本も見る</a></p>" if len(hits) > 6 else "") + "</section>")
    return "".join(o)


def hits_html(r: dict) -> str:
    """前日の的中一覧(払戻の高い順)。サイド列に置く。"""
    s, xs = r["summary"], r["races"]
    n = s["graded_races"]
    hits = sorted([x for x in xs if x.get("tri_hit")], key=lambda x: -(x.get("pay_tri") or 0))
    best = int(hits[0]["pay_tri"]) if hits else 0
    o = [f"<section class=hits aria-labelledby=h-hits><h2 id=h-hits>当たった3連単<small>{esc(jday(s['date']))}</small></h2>"
         "<ul class=sum>"
         f"<li>3連単の的中<b class=hit>{s['tri_hits']}<small>/{n}R</small></b></li>"
         f"<li>◎の1着<b>{s['win_hits']}<small>/{n}R</small></b></li>"
         + (f"<li>最高払戻<b class=hit>{best:,}<small>円</small></b></li>" if best else "") + "</ul>"]
    if hits:
        o.append("<div class=tw style='margin-top:10px'><table><tbody>")
        for i, x in enumerate(hits):
            if i == 8 and len(hits) > 10:
                o.append(f"</tbody></table></div><details class=more><summary>残りの{len(hits) - 8}本を見る</summary><div class=tw><table><tbody>")
            pay = int(x["pay_tri"])
            big = pay >= MANSHU
            o.append(f"<tr><td class=t-race>{esc(x['venue_name'])}<span class=n>{x['race']}R</span></td><td>{combo(x['actual'])}</td>"
                     f"<td class=r><span class='pay hit{' big' if big else ''}'><span class={'man' if big else ''}>{pay:,}</span><small>円</small></span>"
                     + ("<span class=tag>万舟</span>" if big else "") + "</td></tr>")
        o.append("</tbody></table></div>" + ("</details>" if len(hits) > 10 else ""))
        o.append("<p class=cap>払戻金は100円あたり。公式の競走成績の確定値です。</p>")
    o.append("</section>")
    return "".join(o)


def verdict(x) -> str:
    v = x.get("verdict")
    if v == "的中":
        return "<span class=stamp>的中</span>"
    if v == "惜しい":
        return "<span class=near>惜しい</span>"
    if v == "1着的中":
        return "<span class=won>◎1着</span>"
    return "<span class=miss>—</span>"


def results_html(r: dict, prev: dict | None = None) -> str:
    s, xs = r["summary"], r["races"]
    n = s["graded_races"]
    pw, pt, pb = s["return_win"] - s["stake_win"], s["return_tri"] - s["stake_tri"], s["base_return"] - 100 * n
    man_all = sum(1 for x in xs if (x.get("trifecta_payout") or 0) >= MANSHU)
    o = [f"<section id=kotae aria-labelledby=h-kotae><h2 id=h-kotae>答え合わせ<small>{esc(jday(s['date']))}・全{n}R</small></h2>"
         f"<p class=cap>予想は{esc(jday(prev['published_at'], False)) + ' ' + esc(hm(prev['published_at'])) if prev else 'レース当日の朝'}に出したものです(<a href='{COMMITS}{esc(s['date'])}.json'>記録の履歴</a>)。"
         f"外れも全部そのまま。この日の万舟は全体で{man_all}本でした。</p>"
         "<h3>100円ずつ買っていたら(仮の計算)</h3><div class=tw><table class=rec><thead><tr><th></th><th class=r>的中</th><th class=r>購入額</th><th class=r>払戻</th><th class=r>収支</th></tr></thead><tbody>"
         f"<tr><td>◎の単勝</td><td class='r n'>{s['win_hits']}</td><td class='r yen'>{yen(s['stake_win'])}</td><td class='r yen'>{yen(s['return_win'])}</td><td class=r>{signed(pw)}</td></tr>"
         f"<tr><td>3連単 3点</td><td class='r n'>{s['tri_hits']}</td><td class='r yen'>{yen(s['stake_tri'])}</td><td class='r yen'>{yen(s['return_tri'])}</td><td class=r>{signed(pt)}</td></tr>"
         f"<tr><td class=base>比較用:1号艇の単勝</td><td class='r n base'>{s['base_hits']}</td><td class='r yen base'>{yen(100 * n)}</td><td class='r yen base'>{yen(s['base_return'])}</td><td class='r base'>{signed(pb)}</td></tr>"
         "</tbody></table></div>"
         "<h3>場ごとの全レース</h3><p class=cap>的中=3連単3点のどれかが当たり。惜しい=1点目の1・2着が合っていた、または1〜3着の3艇は合っていた(並びが違った)。◎1着=◎の1着だけ当たり。</p><div class=vlist>"]
    for vn, ys in group(xs).items():
        th = sum(1 for x in ys if x.get("tri_hit"))
        wh = sum(1 for x in ys if x.get("win_hit"))
        o.append(f"<details class=v><summary><span class=v-name>{esc(vn)}</span><span class=v-meta>全{len(ys)}R・3連単的中 <b>{th}</b>・◎1着 {wh}</span></summary>"
                 "<div class=tw><table><thead><tr><th>R</th><th>結果</th><th>予想</th><th></th><th class=r>3連単</th></tr></thead><tbody>")
        for x in sorted(ys, key=lambda x: x["race"]):
            pay = x.get("trifecta_payout")
            big = (pay or 0) >= MANSHU
            hit = bool(x.get("tri_hit"))
            pays = (f"<span class='pay{' hit' if hit else ''}'><span class={'man' if big else ''}>{int(pay):,}</span><small>円</small></span>" if pay else "—")
            tri = "".join(f"<span>{esc(c)}</span>" for c in x["trifecta"])
            o.append(f"<tr{' class=hit' if hit else ''}><td class=t-race><span class=n>{rlink(s['date'], vn, x['race'])}</span></td><td>{combo(x['actual'])}</td>"
                     f"<td class=tri3>{tri}</td><td>{verdict(x)}</td><td class=r>{pays}</td></tr>")
        o.append("</tbody></table></div></details>")
    o.append("</div></section>")
    return "".join(o)


def record_html(t: dict, summ: dict, model: dict) -> str:
    ev = (model or {}).get("eval", {})
    if not t.get("graded_races") and not ev.get("full"):
        return ""
    o = ["<section class=recs aria-labelledby=h-rec><h2 id=h-rec>これまでの成績</h2>"]
    if t.get("graded_races"):
        n = t["graded_races"]
        o.append(f"<p class=cap>公開を始めてから{t['days']}日・{n:,}レース。毎回「1号艇を買う」だけの場合と並べています。</p>"
                 "<div class=tw><table class=rec><thead><tr><th></th><th class=r>◎</th><th class=r>1号艇を毎回</th></tr></thead><tbody>"
                 f"<tr><td>1着率</td><td class='r n'>{pct(t['win_rate'])}</td><td class='r n base'>{pct(t['base_win_rate'])}</td></tr>"
                 f"<tr><td>単勝の回収率(100円ずつ)</td><td class='r n'>{pct(t['roi_win'])}</td><td class='r n base'>{pct(t['roi_base'])}</td></tr>"
                 f"<tr><td>単勝の収支</td><td class=r>{signed(t['return_win'] - t['stake_win'])}</td><td class='r base'>{signed(t['base_return'] - 100 * n)}</td></tr>"
                 f"<tr><td>3連単3点の的中率</td><td class='r n'>{pct(t['tri_rate'])}</td><td class='r base'>—</td></tr>"
                 f"<tr><td>3連単3点の回収率</td><td class='r n'>{pct(t['roi_tri'])}</td><td class='r base'>—</td></tr>"
                 "</tbody></table></div>")
        if t["roi_win"] < 1 or t["roi_tri"] < 1:
            o.append("<p class=cap>回収率が100%を切っているものは、そのまま買うと平均では負けていたということです。</p>")
    else:
        o.append("<p class=cap>答え合わせは公開の翌朝から始まります。</p>")
    daily = [d for d in summ.get("daily", []) if d.get("graded_races")][-14:]
    if len(daily) >= 2:
        o.append("<h3>日ごと(直近14日)</h3><div class=tw><table class=rec><thead><tr><th>日付</th><th class=r>R数</th><th class=r>◎1着</th><th class=r>1号艇</th><th class=r>3連単</th><th class=r>単勝の差</th></tr></thead><tbody>")
        for d in reversed(daily):
            o.append(f"<tr><td class=n>{esc(sday(d['date']))}</td><td class='r n'>{d['graded_races']}</td><td class='r n'>{d['win_hits']}</td>"
                     f"<td class='r n base'>{d['base_hits']}</td><td class='r n'>{d['tri_hits']}</td><td class=r>{signed(d['return_win'] - d['stake_win'])}</td></tr>")
        o.append("</tbody></table></div>")
    if ev.get("full"):
        f, l1 = ev["full"], ev["lane1"]
        o.append(f"<p class=cap>公開前の検証(学習に使っていない{esc(sday(ev['test_from']))}〜{esc(sday(ev['test_to']))}の{f['races']:,}レース)では、"
                 f"◎の1着率は{pct(f['top1'])}、毎回1号艇を買った場合は{pct(l1['top1'])}でした。</p>")
    o.append("</section>")
    return "".join(o)


def calm_html(items: list) -> str:
    """注意書き(文言は site_data.py の DISCLAIMERS)。相談窓口の名前にリンクを付ける。"""
    ps = []
    for x in items:
        t = esc(x)
        t = t.replace("ギャンブル依存症予防回復支援センター", f"<a href='{HELP_URL}'>ギャンブル依存症予防回復支援センター</a>", 1)
        ps.append(f"<p>{t}</p>")
    return "<section class=calm aria-labelledby=h-calm><h2 id=h-calm>読む前に</h2>" + "".join(ps) + "</section>"


def how_html(model: dict, summ: dict) -> str:
    """予想の作り方。普段は閉じておく。"""
    ev = model.get("eval", {})
    used = "".join(f"<li>{esc(t)}</li>" for t in model.get("features_used") or [])
    o = ["<details class=how><summary>予想の作り方と検証</summary><div class=in>"
         "<p>BOAT RACE公式が公開している番組表・競走成績・レーサー期別成績から、各艇の1着の確率を出す統計モデルです。"
         f"学習は{model.get('n_races', 0):,}レース分({esc(model.get('train_from', ''))}〜{esc(model.get('train_to', ''))})。毎週月曜に学習し直しています。</p>"
         "<h3>見ている数字(どれもレース前に分かるもの)</h3><ul>" + used + "</ul>"
         "<p>当日の直前情報(展示タイム・風・波)とオッズは使っていません(朝の時点ではまだ出ていないため)。</p>"]
    if ev.get("full"):
        f, l1 = ev["full"], ev["lane1"]
        dv = ev.get("diff_vs_lane1", {})
        o.append(f"<h3>公開前の検証</h3><p>{esc(ev['test_from'])}〜{esc(ev['test_to'])}の{f['races']:,}レースを、その週より前のデータだけで学習して1週ずつ予想した結果です。</p>"
                 "<div class=tw><table><thead><tr><th></th><th class=r>◎の1着率</th><th class=r>単勝の回収率</th><th class=r>3連単3点</th></tr></thead><tbody>"
                 f"<tr><td>◎(このモデル)</td><td class='r n'>{pct(f['top1'])}</td><td class='r n'>{pct(f.get('roi_win', 0))}</td><td class='r n'>{pct(f.get('tri3_hit', 0))}</td></tr>"
                 f"<tr><td>1号艇を毎回</td><td class='r n'>{pct(l1['top1'])}</td><td class='r n'>{pct(l1.get('roi_win', 0))}</td><td class=r>—</td></tr></tbody></table></div>"
                 f"<p>1号艇との差は{dv.get('diff', 0)*100:+.1f}ポイント(95%の幅 {dv.get('lo', 0)*100:+.1f}〜{dv.get('hi', 0)*100:+.1f})。"
                 + ("この先も上回るとは限りません。" if ev.get("beats_lane1") else "はっきり上回れているとは言えません。") + "</p>")
    tiers = ev.get("tiers")
    if tiers:
        o.append("<h3>自信度</h3><p>◎の1着率で S・A・B・C に分けています(境目は学習に使っていない期間で決めたもの)。表では S と A だけ印を付けています。"
                 "自信度が高いレースは1号艇が◎のことが多く、払戻が安いので、当たりが多くても回収率は100%を下回るのがふつうです。</p>"
                 "<div class=tw><table><thead><tr><th>自信度</th><th class=r>レース数</th><th class=r>◎の1着率</th><th class=r>1号艇</th><th class=r>単勝の回収率</th></tr></thead><tbody>")
        for t in tiers:
            if t.get("races"):
                o.append(f"<tr><td>{esc(t['tier'])}</td><td class='r n'>{t['races']:,}</td><td class='r n'>{pct(t['hit'])}</td><td class='r n'>{pct(t['lane1'])}</td><td class='r n'>{pct(t['roi_win'])}</td></tr>")
        o.append("</tbody></table></div>")
    lam = model.get("lambda", [1, 1])
    o.append(f"<p>3連単の確率は1着の確率から順に積み上げて計算し(Harville法)、2・3着が人気側に寄りすぎないよう補正しています(補正 {lam[0]:.2f}/{lam[1]:.2f})。</p></div></details>")
    return "".join(o)


def build():
    SITE.mkdir(exist_ok=True)
    import paid  # 有料版への入口(無料メール・有料版の中身・料金・申込み)。中身は paid.py だけで直す
    data, p, r, summ, model = load()
    t = summ.get("total") or {}
    desc = "ボートレースの全レース予想を毎朝、締切前に公開。翌朝に当たり外れと払戻金を全部答え合わせしています。"
    h = ["<!doctype html><html lang=ja><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
         f"<title>{TITLE}</title><meta name=description content='{desc}'>"
         f"<meta property=og:title content='{TITLE}'><meta property=og:description content='{desc}'><meta property=og:type content=website>"
         f"<meta property=og:url content='{PAGE_URL}'><meta name=twitter:card content=summary><link rel=canonical href='{PAGE_URL}'>"
         "<meta name=theme-color content='#ffffff'>"
         f"{FONTS}<style>{CSS}{ARE_CSS}{paid.CSS}</style></head><body>"]
    prev = load_pred(r["summary"]["date"]) if r else None
    label = "昨日" if (p and r and (date.fromisoformat(p["date"]) - date.fromisoformat(r["summary"]["date"])).days == 1) else (sday(r["summary"]["date"]) if r else "")
    lead = "毎朝、その日の全レースの予想を締切前に出しています。翌朝に全部答え合わせ。当たりも外れも、払戻金もそのまま載せています。"
    if HERO.exists():
        h.append("<header class='mast hero'><img src='hero.jpg' srcset='hero-800.jpg 800w, hero.jpg 1600w' sizes='100vw' alt='' fetchpriority=high width=1600 height=900>"
                 "<span class=credit>写真はイメージ(生成画像)</span>"
                 f"<div class=over><div class=wrap><a class=by href='../'>ZEROICHI WORKS</a><h1>{TITLE}</h1><p class=lead>{lead}</p></div></div></header>"
                 "<div class=waku aria-hidden=true><i></i><i></i><i></i><i></i><i></i><i></i></div>"
                 f"<div class=wrap>{hook_html(p, r, prev)}{atari_html(r, label)}{paid.slim_html()}</div><main class=wrap>")
    else:
        h.append("<header class=mast><div class=wrap><a class=by href='../'>ZEROICHI WORKS</a>"
                 f"<h1>{TITLE}</h1><p class=lead>{lead}</p>"
                 "<div class=waku aria-hidden=true><i></i><i></i><i></i><i></i><i></i><i></i></div>"
                 + hook_html(p, r, prev) + atari_html(r, label) + paid.slim_html() + "</div></header><main class=wrap>")
    try:   # 荒れ予報(試験中)。作れなくてもほかは出す
        h.append(are_today_html(p, r, t.get("are"), label))
    except Exception as e:  # noqa
        print("are section skipped:", e)
    h.append("<div class=top2>")
    h.append(star_today_html(p) if p else "<section class=st><h2>今日の自信あり</h2><p class=cap>今日の予想はまだ出ていません。毎朝7時ごろに出ます。</p></section>")
    h.append(star_answer_html(r, prev, label) if r else "")
    h.append(today_html(p) if p else "")
    h.append(hits_html(r) if r else "")
    h.append("</div>")
    h.append(venues_nav_html(p))
    h.append(paid.mail_box_html())
    if r:
        h.append(results_html(r, prev))
    h.append(record_html(t, summ, model))
    h.append(paid.offer_html(prev, r, model))
    h.append(calm_html(data.get("disclaimers") or []))
    if model:
        h.append(how_html(model, summ))
    src = data.get("sources") or []
    h.append("</main><footer><div class=wrap>" + "".join(f"<p>{'データ:' if i == 0 else ''}{esc(x)}</p>" for i, x in enumerate(src))
             + "<p>正式な結果は主催者の発表で確認してください。</p>"
             "<p>予想と集計は毎朝プログラムで自動更新しています。運営 ZEROICHI WORKS。"
             "<a href='https://github.com/Hiro0530/zeroichi-store/commits/main/kyotei'>更新の記録</a>"
             "・X <a href='https://x.com/ai_kyotei_kotae'>@ai_kyotei_kotae</a>(自動投稿)</p>"
             f"<p>{paid.footer_links()}・<a href='../tokushoho.html'>特定商取引法に基づく表記(ほかの商品)</a>・<a href='../privacy.html'>プライバシーポリシー</a></p></div></footer>"
             + paid.sticky_html() + f"<script>{JS}</script></body></html>")
    (SITE / "index.html").write_text("\n".join(h), encoding="utf-8")
    (SITE / "terms.html").write_text(paid.terms_page(), encoding="utf-8")
    (SITE / "join.html").write_text(paid.join_page(), encoding="utf-8")
    print("site built", SITE / "index.html")


if __name__ == "__main__":
    build()
