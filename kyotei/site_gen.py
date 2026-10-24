"""公開用の静的ページ(kyotei/site/index.html)を作る。毎朝のワークフローがこのファイルで作り直すので、
見た目を変えるときは出力ではなくここ(テンプレート)を直すこと。"""
from __future__ import annotations

import html
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SITE = ROOT / "site"

FONTS = ("<link rel=preconnect href='https://fonts.googleapis.com'><link rel=preconnect href='https://fonts.gstatic.com' crossorigin>"
         "<link rel=stylesheet href='https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700"
         "&family=Zen+Kaku+Gothic+New:wght@400;500;700;900&display=swap'>")

# ZEROICHI WORKS 共通の土台 + この帳面の色(水面の紺と、6艇の枠色)
CSS = """
:root{--bg:#edf2f6;--surface:#fff;--sunk:#f5f8fa;--ink:#102030;--muted:#4f6071;--line:#d3dde6;--line2:#b9c7d3;
--ai:#0a5cc2;--ai-soft:#e3eefb;--base:#8794a1;--hit:#137a46;--hit-soft:#e1f3e9;--near:#9a5b00;--near-soft:#fdf0d9;--miss:#6f7b87;
--deep:#0b2540;--deep-ink:#f2f7fb;--deep-muted:#bccbd9;
--l1:#ffffff;--l1t:#111;--l2:#1b1b1b;--l2t:#fff;--l3:#e0262c;--l3t:#fff;--l4:#1167c8;--l4t:#fff;--l5:#ffd60a;--l5t:#111;--l6:#0f8a43;--l6t:#fff;
--chipline:#7f8b96;--jp:"Zen Kaku Gothic New",-apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP",Meiryo,sans-serif;
--num:"Barlow Condensed","Zen Kaku Gothic New",system-ui,sans-serif;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#0a1520;--surface:#101e2b;--sunk:#0d1924;--ink:#e5edf4;--muted:#9eb0c0;--line:#1f3244;--line2:#2c4358;
--ai:#62adff;--ai-soft:#12304f;--base:#8c9aa8;--hit:#52cc8e;--hit-soft:#123826;--near:#f2b552;--near-soft:#3a2a0f;--miss:#8a98a5;--deep:#061320;--chipline:#5d6e7d;color-scheme:dark}}
:root[data-theme=dark]{--bg:#0a1520;--surface:#101e2b;--sunk:#0d1924;--ink:#e5edf4;--muted:#9eb0c0;--line:#1f3244;--line2:#2c4358;
--ai:#62adff;--ai-soft:#12304f;--base:#8c9aa8;--hit:#52cc8e;--hit-soft:#123826;--near:#f2b552;--near-soft:#3a2a0f;--miss:#8a98a5;--deep:#061320;--chipline:#5d6e7d;color-scheme:dark}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:400 16px/1.75 var(--jp);overflow-wrap:break-word}
a{color:var(--ai)}:focus-visible{outline:3px solid var(--ai);outline-offset:2px;border-radius:4px}
.wrap{max-width:920px;margin:0 auto;padding:0 16px}
.num{font-family:var(--num);font-variant-numeric:tabular-nums;letter-spacing:.01em}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}

/* 見出しの帯: 水面の紺 + 枠色のストライプ */
.top{background:var(--deep);color:var(--deep-ink)}
.top .wrap{padding-top:18px;padding-bottom:44px}
.brand{display:inline-flex;align-items:center;gap:8px;color:var(--deep-muted);text-decoration:none;font-size:13px;font-weight:700;letter-spacing:.08em;min-height:32px}
.brand i{font-style:normal;font-family:var(--num);font-weight:700;font-size:12px;line-height:1;border:1.5px solid currentColor;border-radius:3px;padding:3px 3px 2px;letter-spacing:0}
.top h1{margin:18px 0 10px;font-weight:900;font-size:clamp(32px,8.6vw,52px);line-height:1.2;letter-spacing:.02em}
.top .lead{margin:0;max-width:36em;color:var(--deep-muted);font-size:15px}
.lanes{display:grid;grid-template-columns:repeat(6,1fr);height:8px}
.lanes span:nth-child(1){background:#fff}.lanes span:nth-child(2){background:#1b1b1b;box-shadow:inset 0 0 0 1px #3b4b5a}.lanes span:nth-child(3){background:var(--l3)}
.lanes span:nth-child(4){background:var(--l4)}.lanes span:nth-child(5){background:var(--l5)}.lanes span:nth-child(6){background:var(--l6)}
.facts{display:flex;flex-wrap:wrap;gap:10px 28px;margin:22px 0 0;padding:0;list-style:none;font-size:13px;color:var(--deep-muted)}
.facts b{display:block;color:var(--deep-ink);font-family:var(--num);font-weight:600;font-size:30px;line-height:1.1;letter-spacing:.01em}
.facts b small{font-family:var(--jp);font-size:13px;font-weight:500;margin-left:4px;color:var(--deep-muted)}

main{padding-bottom:16px}
section{margin-top:44px}
h2{font-size:21px;line-height:1.45;margin:0 0 4px;font-weight:700}
.note{color:var(--muted);font-size:13.5px;margin:4px 0 0}

/* ご利用の前に */
.warn{margin-top:22px;position:relative;background:var(--surface);border:1px solid var(--line);border-top:4px solid var(--near);border-radius:12px;padding:16px 18px 14px;font-size:14.5px}
.warn h2{font-size:16px;margin:0 0 6px}
.warn ul{margin:0;padding-left:1.2em}.warn li{margin:3px 0}

/* 比較 */
.legend{display:flex;flex-wrap:wrap;gap:6px 18px;margin:14px 0 10px;font-size:13.5px;color:var(--muted)}
.legend span{display:inline-flex;align-items:center;gap:7px}
.legend span::before{content:"";width:14px;height:10px;border-radius:2px;background:var(--ai)}
.legend .k-base::before{background:var(--base)}
.cmp{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:4px 18px}
.cmp-row{padding:14px 0 16px;border-top:1px solid var(--line)}.cmp-row:first-child{border-top:0}
.cmp-row h3{margin:0 0 10px;font-size:14.5px;font-weight:500}
.bar{display:grid;grid-template-columns:6.6em minmax(0,1fr) 4.4em;align-items:center;gap:10px;font-size:13px;color:var(--muted)}
.bar+.bar{margin-top:8px}
.track{position:relative;height:12px;background:var(--sunk);border-radius:3px;box-shadow:inset 0 0 0 1px var(--line)}
.fill{position:absolute;left:0;top:0;bottom:0;border-radius:3px;background:var(--ai)}
.bar.base .fill{background:var(--base)}
.even{position:absolute;top:-5px;bottom:-5px;width:0;border-left:2px dashed var(--ink);opacity:.55}
.bar .v{text-align:right;font-family:var(--num);font-weight:600;font-size:22px;color:var(--ink);line-height:1}
.bar.base .v{color:var(--muted);font-weight:500}
.bar .na{font-family:var(--jp);font-size:14px}
.evenkey{font-size:12.5px;color:var(--muted);margin:8px 0 0}
.empty{background:var(--ai-soft);border-radius:10px;padding:12px 14px;font-size:14px;margin:12px 0 4px}

/* 日ごと(点の並び) */
.dh{font-size:15px;margin:26px 0 4px}
.dscale{display:grid;gap:0 10px;grid-template-columns:54px minmax(0,1fr) 104px;font:500 12px/1 var(--num);color:var(--muted)}
.dscale>span{grid-column:2;display:flex;justify-content:space-between}
.days{list-style:none;margin:4px 0 0;padding:0}
.days li{display:grid;grid-template-columns:54px minmax(0,1fr) 104px;gap:0 10px;align-items:center;min-height:30px;border-top:1px solid var(--line)}
.dd{font:600 15px/1 var(--num)}
.dtrack{position:relative;height:14px;background:linear-gradient(var(--line),var(--line)) center/100% 1px no-repeat}
.dtrack i{position:absolute;top:50%}
.dtrack .dl{height:4px;margin-top:-2px;background:var(--line2);border-radius:2px}
.dot{width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;background:var(--ai);box-shadow:0 0 0 2px var(--surface)}
.dot.base{background:var(--base)}
.dv{display:flex;justify-content:flex-end;gap:8px;font:500 15px/1 var(--num);color:var(--muted)}
.dv b{color:var(--ai);font-weight:600}
/* 枠番チップ(公式の枠色) */
.ln{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:4px;font:700 15px/1 var(--num);vertical-align:middle;flex:none}
.ln.s{width:19px;height:19px;font-size:13px;border-radius:3px}
.l1{background:var(--l1);color:var(--l1t);box-shadow:inset 0 0 0 1.5px var(--chipline)}.l2{background:var(--l2);color:var(--l2t);box-shadow:inset 0 0 0 1px var(--chipline)}
.l3{background:var(--l3);color:var(--l3t)}.l4{background:var(--l4);color:var(--l4t)}.l5{background:var(--l5);color:var(--l5t)}.l6{background:var(--l6);color:var(--l6t)}
.combo{display:inline-flex;gap:2px;align-items:center;white-space:nowrap;vertical-align:middle}
.combos{display:flex;flex-wrap:wrap;gap:4px 14px;align-items:center;font-size:12.5px;color:var(--muted)}
.combos .p{font-size:13px;margin-left:4px;font-family:var(--num);font-weight:500}

/* 場ごとの折りたたみ */
.venues{display:grid;gap:8px;margin-top:14px}
details.venue{background:var(--surface);border:1px solid var(--line);border-radius:12px;overflow:hidden}
details.venue>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:12px;padding:10px 16px;min-height:56px}
details.venue>summary::-webkit-details-marker{display:none}
details.venue>summary:hover{background:var(--sunk)}
summary .vn{font-weight:700;font-size:17px;min-width:4.2em}
summary .vm{color:var(--muted);font-size:12.5px;margin-left:auto;text-align:right;line-height:1.5}
summary .vnext{color:var(--ai);font-weight:500}
summary::after{content:"";flex:none;width:8px;height:8px;border-right:2px solid var(--muted);border-bottom:2px solid var(--muted);transform:rotate(45deg);margin:-4px 2px 0 2px;transition:transform .15s}
details[open]>summary::after{transform:rotate(225deg);margin-top:4px}
details[open]>summary{border-bottom:1px solid var(--line)}
.vtally{font-family:var(--num);font-weight:600;font-size:16px;color:var(--ink)}

/* 予想の行 */
.race{display:grid;grid-template-columns:2.6em minmax(0,1fr);gap:6px 12px;padding:11px 16px;border-top:1px solid var(--line)}
.race:first-of-type{border-top:0}
.race .r{grid-row:span 2;font-family:var(--num);font-weight:700;font-size:20px;line-height:1.15}
.race .r small{display:block;font-weight:500;font-size:14px;color:var(--muted)}
.race .main{display:flex;align-items:center;gap:10px;min-width:0}
.race .pick{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);white-space:nowrap}
.race.past{opacity:.5}
.tier{display:inline-grid;place-items:center;min-width:1.7em;height:20px;border-radius:4px;font:700 13px/1 var(--num);border:1px solid var(--line2);color:var(--muted)}
.tier.t-S{background:var(--ai);border-color:var(--ai);color:#fff}.tier.t-A{background:var(--ai-soft);border-color:var(--ai);color:var(--ai)}
.tag{display:inline-block;font-size:11.5px;border:1px solid var(--line2);color:var(--muted);border-radius:999px;padding:0 8px;line-height:1.7}
.prob{flex:1;display:flex;height:24px;border-radius:4px;overflow:hidden;box-shadow:inset 0 0 0 1px var(--line2);min-width:0}
.prob span{display:grid;place-items:center;font:600 13px/1 var(--num);overflow:hidden;min-width:0}
.prob .l1{box-shadow:inset 0 0 0 1px var(--chipline)}

/* 答え合わせの行 */
.res{display:grid;grid-template-columns:2.6em minmax(0,1fr) auto;gap:6px 12px;padding:11px 16px;border-top:1px solid var(--line);align-items:center}
.res:first-of-type{border-top:0}
.res .r{font-family:var(--num);font-weight:700;font-size:20px;line-height:1.15}
.res .got{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--muted)}
.res .sub{grid-column:2/4;display:grid;gap:4px;font-size:12.5px;color:var(--muted)}
.res .sub .combo{margin-left:7px}
.res .gp{margin-left:8px;display:inline-flex;align-items:center;gap:6px}
.res .sub b{color:var(--ink);font-weight:500}
.vd{font-size:13px;font-weight:700;border-radius:999px;padding:2px 11px;white-space:nowrap;justify-self:end}
.v-的中{background:var(--hit);color:#fff}.v-惜しい{background:var(--near-soft);color:var(--near);box-shadow:inset 0 0 0 1px var(--near)}
.v-1着的中{background:var(--hit-soft);color:var(--hit)}.v-外れ{color:var(--miss);box-shadow:inset 0 0 0 1px var(--line2)}
.dayline{display:flex;flex-wrap:wrap;gap:4px 22px;margin:10px 0 0;font-size:14px}
.dayline b{font-family:var(--num);font-size:24px;font-weight:600;margin:0 3px}

.about{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:16px 18px;font-size:14.5px;color:var(--muted)}
.about h2{color:var(--ink);font-size:17px;margin-bottom:6px}
.about h3{color:var(--ink);font-size:15px;margin:14px 0 4px}
.about p{margin:6px 0}
.tw{overflow-x:auto;margin:6px 0}
table.ev{border-collapse:collapse;width:100%;min-width:300px;font-size:13.5px;color:var(--ink)}
table.ev th,table.ev td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:right;white-space:nowrap}
table.ev th:first-child,table.ev td:first-child{text-align:left;white-space:normal}
table.ev thead th{color:var(--muted);font-weight:500}
table.ev .num{font-family:var(--num);font-size:15px}
.verdict{border-left:4px solid var(--line2);background:var(--sunk);padding:8px 12px;border-radius:6px;color:var(--ink);margin:8px 0}
footer{border-top:1px solid var(--line);margin-top:48px;padding:22px 0 40px;font-size:12.5px;color:var(--muted)}
footer p{margin:0 0 6px;max-width:60em}
@media (min-width:760px){
 .top .wrap{padding-top:22px;padding-bottom:52px}
 .warn{padding:18px 24px}.cmp{padding:6px 24px}
 .bar{grid-template-columns:7.4em minmax(0,1fr) 5em}
 .race{grid-template-columns:3em minmax(0,1.25fr) minmax(0,1fr);align-items:center;padding:9px 20px}
 .race .r{grid-row:auto}
 .res{grid-template-columns:3em auto auto minmax(0,1fr);padding:9px 20px}
 .res .vd{justify-self:start}
 .res .sub{grid-column:auto;display:grid;grid-template-columns:auto 20em;justify-content:end;align-items:center;gap:18px}
 .res .sub>.combos{display:grid;grid-template-columns:9.5em 10.5em;gap:0;text-align:right;white-space:nowrap}
 details.venue>summary{padding:10px 20px}
}
/* v3: 今日の注目・収支 */
.notice{margin:14px 0 0;font-size:13px;color:var(--muted)}
.proof{font-size:13.5px;color:var(--muted);margin:4px 0 12px}.proof a{color:var(--ai)}
.picks{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
.pc{background:var(--surface);border:1px solid var(--line);border-left:5px solid var(--ai);border-radius:12px;padding:12px 14px}
.pc.past{opacity:.5}
.pc .hd{display:flex;align-items:center;gap:8px;font-weight:700;font-size:17px}
.pc .hd .tier{margin-left:auto}
.pc .tm{font-size:12.5px;color:var(--muted);margin:2px 0 8px;font-family:var(--num);letter-spacing:.02em}
.pc .hon{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--muted)}
.pc .hon b{font:600 26px/1 var(--num);color:var(--ink)}
.pc .combos{margin-top:8px}
.pnl{font-family:var(--num);font-weight:600}.pnl.pos{color:var(--hit)}.pnl.neg{color:var(--near)}
.tot{display:grid;gap:8px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));margin:10px 0}
.tot>div{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:10px 12px;font-size:13px;color:var(--muted)}
.tot b{display:block;font:600 24px/1.15 var(--num);color:var(--ink)}
.hl{background:var(--hit-soft);border-radius:10px;padding:10px 14px;font-size:14px;margin:8px 0}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
"""

JS = """
(function(){var now=Date.now();document.querySelectorAll('.pc[data-close]').forEach(function(c){if(Date.parse(c.dataset.close)<now)c.classList.add('past')});document.querySelectorAll('details.venue[data-pred]').forEach(function(d){var next=null;
d.querySelectorAll('.race[data-close]').forEach(function(r){var t=Date.parse(r.dataset.close);if(t<now){r.classList.add('past')}else if(!next){next=r}});
var m=d.querySelector('.vnext');if(!m)return;if(next){m.textContent='次は '+next.dataset.r+'R '+next.dataset.close.slice(11,16)+' 締切'}else{m.textContent='本日の締切は終了'}});})();
"""


def pct(x: float) -> str:
    return f"{x*100:.1f}%"


def esc(s) -> str:
    return html.escape(str(s))


def lane(n, small: bool = False) -> str:
    return f"<span class='ln l{int(n)}{' s' if small else ''}'>{int(n)}</span>"


def combo(c: str, small: bool = True) -> str:
    parts = [p for p in str(c).split("-") if p.strip().isdigit()]
    if len(parts) != 3:
        return esc(c)
    return f"<span class=combo role=img aria-label='{esc(c)}'>" + "".join(lane(p, small) for p in parts) + "</span>"


def bar(label: str, v, cls: str, scale: float, even: bool) -> str:
    if v is None:
        return f"<div class='bar {cls}'><span>{label}</span><span class=track></span><span class='v na'>—</span></div>"
    w = max(0.0, min(v / scale, 1.0)) * 100
    mark = f"<span class=even style='left:{100/scale:.2f}%'></span>" if even else ""
    return (f"<div class='bar {cls}'><span>{label}</span><span class=track><span class=fill style='width:{w:.2f}%'></span>{mark}</span>"
            f"<span class=v>{pct(v)}</span></div>")


def by_venue(rows):
    groups: dict[str, list] = {}
    for x in rows:
        groups.setdefault(x["venue_name"], []).append(x)
    return groups


GROUP_TEXT = [
    (("f_form30", "f_form90"), "選手の最近30日・90日の成績(枠ごとの平均との差)"),
    (("f_rv",), "選手のその場での成績(枠ごとの平均との差)"),
    (("f_rlv",), "選手×枠×場の1着率(場×枠 → 選手×枠 の順に寄せて推定)"),
    (("m_res_all", "m_res30"), "モーター番号ごとの最近の成績(乗った選手の力を差し引いた2連対)、モーター入れ替え直後かどうか"),
    (("e_racer_exh",), "選手の最近の展示タイム(前のレースまでの、同じレース内の平均との差)"),
    (("e_motor_exh",), "モーター番号ごとの最近の展示タイム(回り足の目安)"),
    (("e_draw_exh", "e_draw_res"), "モーターの平均より良い展示・成績を出せているか(整備・調整の力の目安)"),
    (("t_lvl_l1",), "潮位(気象庁の潮位表。締切時刻の潮の高さと満ち引き。海水・汽水の場だけ)"),
    (("w_u_l1",), "前日の同じ場の風の向きと強さ(場ごとの向きの効き方を学習)"),
]


def tier_section(model: dict, summ: dict) -> str:
    ev = model.get("eval", {})
    tiers = ev.get("tiers")
    if not tiers:
        return ""
    o = ["<h3>自信度(本命の1着確率)ごとの成績</h3><p class=note>自信度は、AIの本命の1着確率で分けています: "
         "<span class='tier t-S'>S</span> 70%以上 / <span class='tier t-A'>A</span> 55〜70% / <span class=tier>B</span> 40〜55% / <span class=tier>C</span> 40%未満。"
         f"下の表は学習に使っていない期間({esc(ev.get('test_from', ''))}〜{esc(ev.get('test_to', ''))})での結果で、同じレースで1号艇を毎回選んだ場合と並べています。"
         "自信度が高くても外れることはあり、回収率が100%を超える保証もありません。</p>"
         "<div class=tw><table class=ev><thead><tr><th>自信度</th><th>レース数</th><th>本命の1着的中率(95%の幅)</th><th>1号艇を毎回</th><th>単勝の回収率</th></tr></thead><tbody>"]
    for t in tiers:
        if not t["races"]:
            continue
        o.append(f"<tr><td><span class='tier t-{esc(t['tier'])}'>{esc(t['tier'])}</span></td><td class=num>{t['races']:,}</td>"
                 f"<td class=num>{pct(t['hit'])}({pct(t['hit_lo'])}〜{pct(t['hit_hi'])})</td><td class=num>{pct(t['lane1'])}</td>"
                 f"<td class=num>{pct(t['roi_win'])}</td></tr>")
    o.append("</tbody></table></div>")
    live = summ.get("tiers") or {}
    if live:
        o.append("<p class=note>公開してからの実際の成績(答え合わせ済み): " + " / ".join(
            f"{esc(k)}: {v['races']}レース中 本命の1着 {v['win_hits']}・1号艇の1着 {v['base_hits']}"
            for k, v in sorted(live.items()) if v["races"]) + "</p>")
    return "".join(o)


def model_section(model: dict, summ: dict | None = None) -> str:
    ev = model.get("eval", {})
    feats = set((model.get("config") or {}).get("feats") or model.get("feats") or [])
    extra = "".join(f"<li>{t}</li>" for keys, t in GROUP_TEXT if any(k in feats for k in keys))
    o = ["<section class=about aria-labelledby=m-h><h2 id=m-h>モデルについて</h2>"
         "<p>公式に公開されているダウンロードデータ(番組表・競走成績・レーサー期別成績)だけを使い、各艇が1着になる確率を推定する統計モデル(条件付きロジット)です。"
         f"学習したレース数: {model.get('n_races', 0):,}({esc(model.get('train_from', ''))}〜{esc(model.get('train_to', ''))})。毎週月曜に自動で学習し直します。</p>"
         "<h3>使っている数字(すべてレースの前に分かるもの)</h3><ul>"
         "<li>番組表: 全国・当地の勝率と2連対率、級別、体重、モーターとボートの2連対率、今節のここまでの着順</li>"
         "<li>過去の競走成績(前日まで): 選手ごとの<b>枠別</b>の1着率・2連対率、実際の<b>進入コース別</b>の1着率、平均スタートタイミング、フライング回数、前付け・コースを取られる傾向、最近の調子</li>"
         "<li>レーサー期別成績(公開済みの期のもの): コース別の1着率・2連対率・平均スタートタイミング・平均スタート順位</li>"
         "<li>場ごとの枠の有利不利、前日の同じ場の風速・波高</li>" + extra + "</ul>"
         "<p>使っていないもの: 当日の展示タイム・直前の気象・部品交換やプロペラの情報(直前情報のページにしか無く、朝の公開時点では分からないため。取得もしていません)、オッズ(取得していません)。"
         "当日の気象は結果ファイルにしか無いので、予想には使いません。</p>"]
    if ev.get("full"):
        f, b, pr, l1 = ev["full"], ev.get("base", {}), ev.get("prior", {}), ev["lane1"]
        dv = ev.get("diff_vs_lane1", {})
        o.append(f"<h3>学習に使っていない期間での成績(事後の検証)</h3><p class=note>{esc(ev['test_from'])}〜{esc(ev['test_to'])}の{f['races']:,}レース。"
                 "1週ずつ「その週より前のデータだけで学習 → その週を予想」を繰り返した結果です(この記録帳の公開前の期間を含みます)。</p>")
        o.append("<div class=tw><table class=ev><thead><tr><th></th><th>1着の的中率</th><th>単勝の回収率</th><th>3連単3点の的中率</th></tr></thead><tbody>")
        o.append(f"<tr><td>AIの本命(このモデル)</td><td class=num>{pct(f['top1'])}</td><td class=num>{pct(f.get('roi_win', 0))}</td><td class=num>{pct(f.get('tri3_hit', 0))}</td></tr>")
        if b:
            o.append(f"<tr><td>番組表の数字だけのモデル(以前のモデル相当)</td><td class=num>{pct(b['top1'])}</td><td class=num>{pct(b.get('roi_win', 0))}</td><td class=num>{pct(b.get('tri3_hit', 0))}</td></tr>")
        o.append(f"<tr><td>1号艇を毎回</td><td class=num>{pct(l1['top1'])}</td><td class=num>{pct(l1.get('roi_win', 0))}</td><td>—</td></tr></tbody></table></div>")
        diff = dv.get("diff", 0) * 100
        rng = f"95%の幅 {dv.get('lo', 0)*100:+.1f}〜{dv.get('hi', 0)*100:+.1f}ポイント"
        if ev.get("beats_lane1"):
            o.append(f"<p class=verdict>この期間では、AIの本命の1着的中率が1号艇を毎回を<b>{diff:+.1f}ポイント</b>上回りました({rng})。今後も上回る保証はありません。</p>")
        else:
            o.append(f"<p class=verdict>この期間では、AIの本命は1号艇を毎回を<b>はっきりとは上回れていません</b>(差 {diff:+.1f}ポイント、{rng})。</p>")
        if f.get("roi_win", 0) < 1:
            o.append("<p class=note>単勝の回収率は100%を下回っています。この予想どおりに買うと、平均では損をします。</p>")
        if b:
            better = f["logloss"] < b["logloss"]
            o.append(f"<p class=note>確率の精度(対数損失・小さいほど良い): このモデル {f['logloss']:.3f} / 番組表だけ {b['logloss']:.3f} / 場と枠だけ {pr.get('logloss', 0):.3f}。"
                     + ("枠別・コース別の成績などを足したことで、確率の精度は少し良くなりました。" if better else "足した数字による確率の精度の改善は、この期間では確認できませんでした。") + "</p>")
        cal = [c for c in f.get("calibration", []) if c[2] >= 100]
        if cal:
            o.append("<h3>確率の当たり具合</h3><p class=note>AIが示した1着の確率と、実際に1着になった割合です(全艇。100艇未満の区分は省略)。近いほど確率が信用できます。</p>"
                     "<div class=tw><table class=ev><thead><tr><th>AIの確率(平均)</th><th>実際の1着率</th><th>艇数</th></tr></thead><tbody>")
            for pm, om, n in cal:
                o.append(f"<tr><td class=num>{pct(pm)}</td><td class=num>{pct(om)}</td><td class=num>{n:,}</td></tr>")
            o.append("</tbody></table></div>")
        orc = ev.get("oracle")
        if orc and b:
            o.append(f"<p class=note>参考: もしレース前に当日の風・波・展示タイムが分かったとしたら、確率の精度は {f['logloss']:.3f} → {orc['logloss']:.3f}"
                     "(この数字は検証用で、予想には使っていません)。</p>")
    else:
        o.append("<p class=note>学習に使っていない期間での検証は、履歴がそろってから表示します。</p>")
    o.append(tier_section(model, summ or {}))
    lam = model.get("lambda", [1, 1])
    o.append(f"<p class=note>3連単の確率は、1着の確率から順番に積み上げて計算し(Harville法)、2着・3着は人気側に偏りすぎないよう補正しています(補正の強さ {lam[0]:.2f} / {lam[1]:.2f}、学習外の期間で決定)。</p>")
    o.append("</section>")
    return "".join(o)


COMMITS = "https://github.com/Hiro0530/zeroichi-store/commits/main/kyotei/predictions/"


def yen(v: int, sign: bool = False) -> str:
    if sign:
        cls = "pos" if v > 0 else ("neg" if v < 0 else "")
        return f"<span class='pnl {cls}'>{'+' if v > 0 else ('−' if v < 0 else '±')}{abs(int(v)):,}円</span>"
    return f"{int(v):,}円"


def warn_html() -> str:
    return ("<section class=warn aria-labelledby=w-h><h2 id=w-h>ご利用の前に</h2><ul>"
            "<li>ここの予想は<b>無料の参考情報</b>です。的中や利益を<b>保証するものではありません</b>。</li>"
            "<li><b>過去の成績は、将来の成績を約束するものではありません。</b></li>"
            "<li><b>20歳未満の方は舟券を購入(投票)できません。</b></li>"
            "<li>ボートレースの払戻率は75%で、平均すると賭け金の25%が失われます。舟券は余裕のある範囲で、ご自身の判断で。</li>"
            "<li>のめり込みが心配なときは、各都道府県の精神保健福祉センターなどの相談窓口へ。</li>"
            "<li>当サイトは投票の受付・代行、有料の予想販売を行っていません。</li></ul></section>")


def today_html(p: dict) -> str:
    pub = p["published_at"].replace("T", " ")[:16]
    pub_hm = pub[11:16]
    proof = f"{COMMITS}{esc(p['date'])}.json"
    h = [f"<section aria-labelledby=p-h><h2 id=p-h>今日の予想 {esc(p['date'])}</h2>"
         f"<p class=proof>予想公開 <b>{esc(pub)}</b>(全レースの締切より前)。公開した記録は Git に残り、あとから書き換えると履歴に残ります: "
         f"<a href='{proof}'>この日の予想ファイルの履歴</a>。締切が公開時刻より前のレースは採点しません。</p>"]
    cand = [x for x in p["races"] if x.get("scored", True)]
    top = sorted(cand, key=lambda x: -max(x["probs"]))[:6]
    top.sort(key=lambda x: x["close"])
    if top:
        h.append("<h3>AIの確率が高いレース(締切順)</h3><div class=picks>")
        for x in top:
            tier = x.get("tier") or ""
            tri = "".join(f"<span>{combo(c)}<span class=p>{pr*100:.1f}%</span></span>" for c, pr in x["trifecta"])
            h.append(f"<div class=pc data-close='{esc(x['close'])}'><div class=hd>{esc(x['venue_name'])} {x['race']}R"
                     + (f"<span class='tier t-{esc(tier)}' title='自信度'>{esc(tier)}</span>" if tier else "") + "</div>"
                     f"<div class=tm>予想公開 {pub_hm}(締切 {x['close'][11:16]})</div>"
                     f"<div class=hon>本命 {lane(x['pick'])}<b>{max(x['probs'])*100:.0f}%</b>1着の確率</div>"
                     f"<div class=combos>3連単 {tri}</div></div>")
        h.append("</div><p class=note>確率はAIの見積もりで、外れることもあります。自信度(S:70%以上 A:55%以上 B:40%以上 C:それ未満)ごとの過去の成績は「モデルについて」にあります。</p>")
    h.append("<h3>全レース</h3><p class=note>色の帯は、AIが見積もった1着になる確率です(左から1〜6号艇の枠色、数字は%)。その横は3連単の予想3点と、その確率です。</p><div class=venues>")
    for vn, xs in by_venue(p["races"]).items():
        first, last = xs[0]["close"][11:16], xs[-1]["close"][11:16]
        h.append(f"<details class=venue data-pred><summary><span class=vn>{esc(vn)}</span><span class=vm>{len(xs)}レース・締切 {first}〜{last}"
                 "<br><span class=vnext></span></span></summary>")
        for x in xs:
            probs = x["probs"]
            segs = "".join(f"<span class='l{i+1}' style='width:{v*100:.2f}%'>{f'{v*100:.0f}' if v >= 0.09 else ''}</span>" for i, v in enumerate(probs))
            aria = "、".join(f"{i+1}号艇 {v*100:.0f}%" for i, v in enumerate(probs))
            tri = "".join(f"<span>{combo(c)}<span class=p>{pr*100:.1f}%</span></span>" for c, pr in x["trifecta"])
            tag = "" if x.get("scored", True) else "<span class=tag>採点外</span>"
            tr = f"<span class='tier t-{esc(x['tier'])}' title='自信度'>{esc(x['tier'])}</span>" if x.get("tier") else ""
            h.append(f"<div class=race data-close='{esc(x['close'])}' data-r='{x['race']}'><span class=r>{x['race']}R<small>{x['close'][11:16]}</small></span>"
                     f"<span class=main><span class=pick>本命 {lane(x['pick'])}{tr}</span><span class=prob role=img aria-label='1着の確率: {aria}'>{segs}</span></span>"
                     f"<span class=combos>{tri}{tag}</span></div>")
        h.append("</details>")
    h.append("</div></section>")
    return "".join(h)


def yesterday_html(r: dict) -> str:
    s = r["summary"]
    n = s["graded_races"]
    xs = r["races"]
    pnl_w = s["return_win"] - s["stake_win"]
    pnl_t = s["return_tri"] - s["stake_tri"]
    pnl_b = s["base_return"] - 100 * n
    h = [f"<section aria-labelledby=r-h><h2 id=r-h>昨日の答え合わせ {esc(s['date'])}(採点 {n}レース)</h2>"
         f"<p class=proof>この日の予想は前日の朝に公開済み(<a href='{COMMITS}{esc(s['date'])}.json'>予想ファイルの履歴</a>)。払戻金は公式の競走成績ファイルの確定払戻金(100円あたり)です。</p>"
         "<div class=tot>"
         f"<div>本命の単勝を毎回100円<b>{s['win_hits']}<small>/{n} 的中</small></b>{yen(s['stake_win'])} → {yen(s['return_win'])}(収支 {yen(pnl_w, True)})</div>"
         f"<div>3連単3点を毎回(300円)<b>{s['tri_hits']}<small>/{n} 的中</small></b>{yen(s['stake_tri'])} → {yen(s['return_tri'])}(収支 {yen(pnl_t, True)})</div>"
         f"<div>比較: 1号艇の単勝を毎回100円<b>{s['base_hits']}<small>/{n} 的中</small></b>{yen(100 * n)} → {yen(s['base_return'])}(収支 {yen(pnl_b, True)})</div>"
         "</div>"]
    hits = sorted([x for x in xs if x.get("tri_hit")], key=lambda x: -(x.get("pay_tri") or 0))
    if hits:
        best = hits[0]
        h.append(f"<p class=hl>この日の3連単の的中 {len(hits)}レース。いちばん高い払戻: <b>{esc(best['venue_name'])} {best['race']}R</b> "
                 f"{combo(best['actual'], False)} <b class=num>{int(best['pay_tri']):,}円</b>(100円あたり)</p>")
    else:
        h.append("<p class=hl>この日は3連単の的中がありませんでした。</p>")
    h.append("<p class=note>判定: 的中=3連単の予想3点のどれかが当たり/惜しい=予想1点目の1・2着が当たり、または3艇の顔ぶれが同じ/1着的中=本命の1着だけ当たり/外れ。"
             "収支は「本命の単勝100円+3連単3点300円」を買ったと仮定した、そのレースの増減です。</p><div class=venues>")
    for vn, ys in by_venue(xs).items():
        wins = sum(1 for x in ys if x.get("win_hit"))
        base = sum(1 for x in ys if x.get("lane1_won"))
        pv = sum((x.get("pay_win") or 0) + (x.get("pay_tri") or 0) - 400 for x in ys)
        h.append(f"<details class=venue><summary><span class=vn>{esc(vn)}</span><span class=vm>{len(ys)}レース・収支 {yen(pv, True)}<br>"
                 f"AIの本命の1着 <span class=vtally>{wins}</span>/1号艇の1着 <span class=vtally>{base}</span></span></summary>")
        for x in ys:
            pay = f"{int(x['trifecta_payout']):,}円" if x.get("trifecta_payout") else "—"
            tri = "".join(combo(c) for c in x["trifecta"])
            tw = x.get("tansho_payout")
            tws = f"単勝 {int(tw):,}円" if tw else ""
            rp = (x.get("pay_win") or 0) + (x.get("pay_tri") or 0) - 400
            h.append(f"<div class=res><span class=r>{x['race']}R</span>"
                     f"<span class=got>結果 {combo(x['actual'], False)}<span class=gp>本命 {lane(x['pick'], True)}</span></span>"
                     f"<span class='vd v-{esc(x['verdict'])}'>{esc(x['verdict'])}</span>"
                     f"<span class=sub><span>予想 {tri} 収支 {yen(rp, True)}</span>"
                     f"<span class=combos><span>1号艇 <b>{'1着' if x['lane1_won'] else '外れ'}</b> {tws}</span><span>3連単払戻 <b class=num>{pay}</b></span></span></span></div>")
        h.append("</details>")
    h.append("</div></section>")
    return "".join(h)


def record_html(t: dict, summ: dict, model: dict) -> str:
    ev = model.get("eval", {}) if model else {}
    ho = {"races": ev["full"]["races"], "top1": ev["full"]["top1"], "lane1_rate": ev["lane1"]["top1"]} if ev.get("full") else {}
    rows = []
    if t.get("graded_races"):
        rows += [("1着の的中率(採点した全レース)", t["win_rate"], t["base_win_rate"], False),
                 ("仮の回収率 単勝(毎回100円)", t["roi_win"], t["roi_base"], True),
                 ("3連単(3点)的中率", t["tri_rate"], None, False),
                 ("仮の回収率 3連単(3点×100円)", t["roi_tri"], None, True)]
    if ho:
        rows.append((f"参考: 学習に使っていない直近{ev.get('test_days', 0)}日の1着的中率({ho.get('races', 0):,}レース・事後の検証)", ho.get("top1", 0), ho.get("lane1_rate", 0), False))
    if not rows:
        return ""
    cap = f"採点したレース: {t['graded_races']:,}(公開 {t['days']} 日分)" if t.get("graded_races") else "答え合わせは公開の翌朝から始まります"
    h = ["<section aria-labelledby=c-h><h2 id=c-h>これまでの成績:AIの本命 と 1号艇を毎回</h2>", f"<p class=note>{cap}</p>"]
    if t.get("graded_races"):
        n = t["graded_races"]
        h.append("<div class=tot>"
                 f"<div>本命の単勝を毎回100円(累計)<b>{yen(t['return_win'] - t['stake_win'], True)}</b>{yen(t['stake_win'])} → {yen(t['return_win'])}</div>"
                 f"<div>3連単3点を毎回(累計)<b>{yen(t['return_tri'] - t['stake_tri'], True)}</b>{yen(t['stake_tri'])} → {yen(t['return_tri'])}</div>"
                 f"<div>比較: 1号艇の単勝を毎回100円(累計)<b>{yen(t['base_return'] - 100 * n, True)}</b>{yen(100 * n)} → {yen(t['base_return'])}</div></div>")
    else:
        h.append("<p class=empty>まだ答え合わせをしたレースはありません。それまでは、学習に使っていない期間で試した参考の数字だけを載せています。</p>")
    h.append("<div class=legend><span>AIの本命</span><span class=k-base>1号艇を毎回</span></div><div class=cmp>")
    any_roi = False
    for label, a, b, roi in rows:
        vals = [v for v in (a, b) if v is not None] or [0]
        scale = max(1.25, max(vals) * 1.1) if roi else 1.0
        any_roi |= roi
        h.append(f"<div class=cmp-row><h3>{esc(label)}</h3>{bar('AIの本命', a, 'ai', scale, roi)}{bar('1号艇を毎回', b, 'base', scale, roi)}</div>")
    h.append("</div>")
    if any_roi:
        h.append("<p class=evenkey>回収率の点線は100%(賭けた額がそのまま戻る線)です。</p>")
    h.append("<p class=note>回収率・収支は確定払戻金から機械的に計算しています。100%を下回る・マイナスは損をしたという意味です。"
             "AIの本命が1号艇を上回らない期間は、そのまま表示します。</p>")
    daily = [d for d in summ.get("daily", []) if d.get("graded_races")][-14:]
    if len(daily) >= 2:
        pts = [(d, d["win_hits"] / d["graded_races"], d["base_hits"] / d["graded_races"]) for d in daily]
        lo = max(0.0, min(min(a, b) for _, a, b in pts) - 0.05)
        hi = min(1.0, max(max(a, b) for _, a, b in pts) + 0.05)
        pos = lambda v: (v - lo) / max(hi - lo, 1e-9) * 100  # noqa: E731
        h.append("<h3 class=dh>日ごとの1着の的中率(直近14日)</h3>"
                 f"<div class=dscale aria-hidden=true><span><span>{lo*100:.0f}%</span><span>{hi*100:.0f}%</span></span></div><ul class=days>")
        for d, a, b in reversed(pts):
            h.append(f"<li><span class=dd>{esc(d['date'][5:].replace('-', '/'))}</span>"
                     f"<span class=dtrack role=img aria-label='AIの本命 {pct(a)}、1号艇を毎回 {pct(b)}'>"
                     f"<i class=dl style='left:{min(pos(a), pos(b)):.1f}%;width:{abs(pos(a)-pos(b)):.1f}%'></i>"
                     f"<i class='dot base' style='left:{pos(b):.1f}%'></i><i class='dot ai' style='left:{pos(a):.1f}%'></i></span>"
                     f"<span class=dv><b>{pct(a)}</b><span>{pct(b)}</span></span></li>")
        h.append("</ul><p class=note>青の点がAIの本命、灰色の点が1号艇を毎回の、その日の1着の的中率です。</p>")
    h.append("</section>")
    return "".join(h)


def build():
    SITE.mkdir(exist_ok=True)
    summ = json.loads((ROOT / "summary.json").read_text(encoding="utf-8")) if (ROOT / "summary.json").exists() else {"total": {}, "daily": []}
    t = summ["total"]
    preds = sorted((ROOT / "predictions").glob("*.json"))
    results = sorted((ROOT / "results").glob("*.json"))
    model = json.loads((ROOT / "model.json").read_text()) if (ROOT / "model.json").exists() else {}
    p = json.loads(preds[-1].read_text(encoding="utf-8")) if preds else None
    r = json.loads(results[-1].read_text(encoding="utf-8")) if results else None
    h = ["<!doctype html><html lang=ja><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
         "<title>AI舟券 答え合わせ帳</title><meta name=description content='統計モデルのボートレース予想をレース前に公開し、翌朝に全レースの当たり外れと払戻金を答え合わせする記録。的中も外れも全部載せます。'>"
         "<meta name=theme-color content='#0b2540'>"
         f"{FONTS}<style>{CSS}</style></head><body>"]
    h.append("<header class=top><div class=wrap><a class=brand href='../'><i>01</i>ZEROICHI WORKS</a>"
             "<h1>AI舟券 答え合わせ帳</h1><p class=lead>レースの前に予想を公開し、翌朝に全レースの当たり外れと払戻金を答え合わせします。的中も外れも、損も全部載せます。"
             "すべての数字は「1号艇を毎回」という単純な選び方と並べて出します。</p><ul class=facts>")
    if p:
        nv = len(by_venue(p["races"]))
        h.append(f"<li>{esc(p['date'][5:7].lstrip('0'))}月{esc(p['date'][8:10].lstrip('0'))}日の予想<b>{len(p['races'])}<small>レース・{nv}場</small></b></li>"
                 f"<li>予想公開<b>{esc(p['published_at'][11:16])}<small>締切より前</small></b></li>")
    if r:
        s = r["summary"]
        h.append(f"<li>昨日の3連単の的中<b>{s['tri_hits']}<small>/{s['graded_races']}レース</small></b></li>")
    if t.get("graded_races"):
        h.append(f"<li>1着の的中率(AI / 1号艇)<b>{pct(t['win_rate'])}<small>/ {pct(t['base_win_rate'])}</small></b></li>")
    h.append("</ul></div><div class=lanes aria-hidden=true><span></span><span></span><span></span><span></span><span></span><span></span></div></header>")
    h.append("<main class=wrap><p class=notice>無料の参考情報です。的中や利益を保証しません。過去の成績は将来を約束しません。<b>20歳未満は舟券を購入できません。</b>(くわしくは下の「ご利用の前に」)</p>")
    if p:
        h.append(today_html(p))
    if r:
        h.append(yesterday_html(r))
    h.append(record_html(t, summ, model))
    h.append(warn_html())
    if model:
        h.append(model_section(model, summ))
    h.append("</main><footer><div class=wrap><p>データ出典: BOAT RACE 公式サイトのダウンロードデータ(番組表・競走成績・レーサー期別成績)。データファイルそのものは再配布していません。内容は主催者発行のものと照合してください。</p>"
             + ("<p>潮位: 気象庁ホームページ「潮位表」のデータを加工して作成(締切時刻の潮位と満ち引きを計算)。</p>"
                if "t_lvl_l1" in ((model.get("config") or {}).get("feats") or []) else "") +
             "<p>予想は無料の参考情報で、的中・利益を保証しません。過去の成績は将来の成績を約束しません。20歳未満の方は投票できません。</p>"
             "<p>運営: ZEROICHI WORKS(AIが運用する個人事業)。このページはAIが自動で作成しています。"
             "記録の履歴: <a href='https://github.com/Hiro0530/zeroichi-store/commits/main/kyotei'>GitHub</a></p></div></footer>"
             f"<script>{JS}</script></body></html>")
    (SITE / "index.html").write_text("\n".join(h), encoding="utf-8")
    print("site built", SITE / "index.html")


if __name__ == "__main__":
    build()
