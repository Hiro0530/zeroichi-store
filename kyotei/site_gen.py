"""公開用の静的ページ(kyotei/site/index.html)を作る。公開先のリポジトリができたらそのまま置ける。"""
from __future__ import annotations

import html
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SITE = ROOT / "site"

CSS = """
:root{--bg:#fbfaf7;--fg:#1d1d1b;--muted:#6b6b66;--line:#e3e0d8;--hit:#1f7a4d;--near:#a86a00;--miss:#8a8a85;--card:#fff}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#141413;--fg:#ecebe6;--muted:#a3a29c;--line:#2e2d2a;--hit:#5cc493;--near:#e0a640;--miss:#7d7c77;--card:#1c1c1a}}
:root[data-theme=dark]{--bg:#141413;--fg:#ecebe6;--muted:#a3a29c;--line:#2e2d2a;--hit:#5cc493;--near:#e0a640;--miss:#7d7c77;--card:#1c1c1a}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.7 system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif}
main{max-width:860px;margin:0 auto;padding:24px 16px 64px}h1{font-size:1.5rem;margin:.2em 0}h2{font-size:1.1rem;margin-top:2em;border-bottom:1px solid var(--line);padding-bottom:.3em}
.note{color:var(--muted);font-size:.85rem}.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:12px 0}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px 12px}.kpi b{display:block;font-size:1.3rem;font-variant-numeric:tabular-nums}
.tbl{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:.88rem;font-variant-numeric:tabular-nums}th,td{padding:5px 6px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}
.v-的中{color:var(--hit);font-weight:700}.v-惜しい{color:var(--near);font-weight:700}.v-1着的中{color:var(--hit)}.v-外れ{color:var(--miss)}
ul{margin:.3em 0;padding-left:1.2em}.warn{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--near);padding:10px 12px;border-radius:6px;font-size:.88rem}
"""


def pct(x: float) -> str:
    return f"{x*100:.1f}%"


def build():
    SITE.mkdir(exist_ok=True)
    summ = json.loads((ROOT / "summary.json").read_text(encoding="utf-8")) if (ROOT / "summary.json").exists() else {"total": {}, "daily": []}
    t = summ["total"]
    preds = sorted((ROOT / "predictions").glob("*.json"))
    results = sorted((ROOT / "results").glob("*.json"))
    model = json.loads((ROOT / "model.json").read_text()) if (ROOT / "model.json").exists() else {}
    h = []
    h.append("<!doctype html><html lang=ja><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
             "<title>AI舟券 答え合わせ帳</title><meta name=description content='統計モデルのボートレース予想をレース前に公開し、翌日に全レースを答え合わせする記録。的中も外れも全部載せます。'>"
             f"<style>{CSS}</style></head><body><main>")
    h.append("<h1>AI舟券 答え合わせ帳</h1><p>統計モデルの予想をレースの前に公開し、翌日に全レースを答え合わせします。的中も外れも全部載せます。"
             "すべての数字は「1号艇を毎回」という単純な選び方と並べて出します。</p>")
    h.append("<div class=warn><b>ご利用の前に</b><ul>"
             "<li>ここの予想は<b>無料の参考情報</b>です。的中や利益を<b>保証するものではありません</b>。</li>"
             "<li><b>過去の成績は、将来の成績を約束するものではありません。</b></li>"
             "<li><b>20歳未満の方は舟券を購入(投票)できません。</b></li>"
             "<li>ボートレースの払戻率は75%で、平均すると賭け金の25%が失われます。舟券は余裕のある範囲で、ご自身の判断で。</li>"
             "<li>のめり込みが心配なときは、各都道府県の精神保健福祉センターなどの相談窓口へ。</li>"
             "<li>当サイトは投票の受付・代行、有料の予想販売を行っていません。</li></ul></div>")
    ho = model.get("holdout", {}) if model else {}
    rows = []
    if t.get("graded_races"):
        rows += [("1着の的中率(採点した全レース)", pct(t["win_rate"]), pct(t["base_win_rate"])),
                 ("仮の回収率 単勝(毎回100円)", pct(t["roi_win"]), pct(t["roi_base"])),
                 ("3連単(3点)的中率", pct(t["tri_rate"]), "—"),
                 ("仮の回収率 3連単(3点×100円)", pct(t["roi_tri"]), "—")]
    if ho:
        rows.append((f"参考: 学習に使っていない直近7日の1着的中率({ho.get('races', 0):,}レース)", pct(ho.get("top1", 0)), pct(ho.get("lane1_rate", 0))))
    if rows:
        cap = f"採点したレース: {t['graded_races']:,}(公開 {t['days']} 日分)" if t.get("graded_races") else "答え合わせは公開の翌朝から始まります"
        h.append(f"<h2>成績:AIの本命 と 1号艇を毎回 の比較</h2><p class=note>{cap}</p><div class=tbl><table>"
                 "<tr><th>項目</th><th>AIの本命</th><th>1号艇を毎回</th></tr>")
        for a, b, c in rows:
            h.append(f"<tr><td>{a}</td><td>{b}</td><td>{c}</td></tr>")
        h.append("</table></div><p class=note>回収率は確定払戻金から機械的に計算しています。100%を下回るのは損をしたという意味です。"
                 "AIの本命が1号艇を上回らない期間は、そのまま表示します。</p>")
    if results:
        r = json.loads(results[-1].read_text(encoding="utf-8"))
        s = r["summary"]
        h.append(f"<h2>答え合わせ {s['date']}(採点 {s['graded_races']}レース)</h2><p class=note>この日: AIの本命の1着 {s['win_hits']} / 1号艇の1着 {s['base_hits']}</p><div class=tbl><table><tr><th>場</th><th>R</th><th>本命</th><th>3連単の予想</th><th>結果</th><th>判定</th><th>1号艇を毎回</th><th>3連単払戻</th></tr>")
        for x in r["races"]:
            h.append(f"<tr><td>{html.escape(x['venue_name'])}</td><td>{x['race']}</td><td>{x['pick']}</td><td>{' / '.join(x['trifecta'])}</td>"
                     f"<td>{x['actual']}</td><td class='v-{x['verdict']}'>{x['verdict']}</td><td>{'1着' if x['lane1_won'] else '外れ'}</td><td>{x['trifecta_payout'] or ''}</td></tr>")
        h.append("</table></div>")
    if preds:
        p = json.loads(preds[-1].read_text(encoding="utf-8"))
        h.append(f"<h2>予想 {p['date']}</h2><p class=note>公開時刻: {p['published_at']}。締切がこの時刻より前のレースは採点しません(後出しを防ぐため)。"
                 "記録はGitの履歴に残り、後から書き換えると履歴に残ります。</p><div class=tbl><table><tr><th>場</th><th>R</th><th>締切</th><th>本命</th><th>1着の確率(1〜6号艇)</th><th>3連単の予想</th></tr>")
        for x in p["races"]:
            probs = " ".join(f"{v*100:.0f}" for v in x["probs"])
            h.append(f"<tr><td>{html.escape(x['venue_name'])}</td><td>{x['race']}</td><td>{x['close'][11:16]}</td><td>{x['pick']}</td><td>{probs}</td>"
                     f"<td>{' / '.join(c for c, _ in x['trifecta'])}</td></tr>")
        h.append("</table></div>")
    if model:
        ho = model.get("holdout", {})
        h.append("<h2>モデルについて</h2><p class=note>公式に公開されている番組表と競走成績(全国勝率・当地勝率・モーターとボートの2連率・級別・枠・場)から、"
                 f"1着になる確率を推定する統計モデル(条件付きロジット)です。学習したレース数: {model.get('n_races', 0):,}。"
                 + (f"学習に使っていない直近7日での1着的中率: {pct(ho.get('top1', 0))}(同じ期間の1号艇の1着率: {pct(ho.get('lane1_rate', 0))})。" if ho else "")
                 + "3連単の確率は、1着の確率から順番に積み上げて計算しています(Harville法)。展示タイム・オッズ・直前の気象は使っていません。</p>")
    h.append("<p class=note>データ出典: BOAT RACE 公式サイトのダウンロードデータ(番組表・競走成績)。内容は主催者発行のものと照合してください。"
             "予想は無料の参考情報で、的中・利益を保証しません。過去の成績は将来の成績を約束しません。20歳未満の方は投票できません。"
             "運営: ZEROICHI WORKS(AIが運用する個人事業)。このページはAIが自動で作成しています。"
             "記録の履歴: <a href='https://github.com/Hiro0530/zeroichi-store/commits/main/kyotei'>GitHub</a></p></main></body></html>")
    (SITE / "index.html").write_text("\n".join(h), encoding="utf-8")
    print("site built", SITE / "index.html")
