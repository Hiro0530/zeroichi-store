"""せどり 利益チェック: 共通の頭・足・ルート切替を付けて各ページのHTMLを書き出す。

使い方: python3 tools/sedori/build_pages.py [公開フォルダ(既定 ../kt-zs-sedori-ghp)]
- 手数料の出典一覧(着地ページの #fees)は sedori/data/fees.json から作る。
- rakuten-amazon/index.html は手書きのページで、ルート切替の部分だけ置き換える。
"""
from __future__ import annotations

import html
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else pathlib.Path(__file__).resolve().parents[3] / "kt-zs-sedori-ghp")
S = ROOT / "sedori"
FEES = json.loads((S / "data/fees.json").read_text(encoding="utf-8"))
BASE_URL = "https://hiro0530.github.io/zeroichi-store/sedori/"

ROUTES = [
    ("rakuten-amazon", "楽天・Yahoo!→Amazon"),
    ("muzaiko-amazon", "無在庫(Amazon×ヤフオク中古)"),
    ("mercari-calc", "メルカリ 手数料・送料"),
    ("yahuoku-mercari", "ヤフオク→メルカリ"),
    ("auction-mercari", "ブランド中古(業者オークション)"),
]


def routes_nav(current: str) -> str:
    items = "\n".join(
        f'    <a href="../{slug}/"{" aria-current=\"page\"" if slug == current else ""}>{label}</a>'.replace(
            f'href="../{current}/"', 'href="./"') for slug, label in ROUTES)
    return f'<nav class="routes" aria-label="仕入れ先と売り先">\n{items}\n  </nav>'


def head(title: str, desc: str, path: str, base: str, body_attrs: str) -> str:
    t, d = html.escape(title), html.escape(desc)
    return f"""<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{t}｜ZEROICHI WORKS</title>
<meta name="description" content="{d}">
<link rel="canonical" href="{BASE_URL}{path}">
<meta property="og:title" content="{t}">
<meta property="og:description" content="{d}">
<meta property="og:type" content="website">
<meta property="og:url" content="{BASE_URL}{path}">
<meta property="og:image" content="{BASE_URL}og.png">
<link rel="manifest" href="{base}manifest.webmanifest">
<link rel="icon" href="{base}icon-192.png">
<link rel="apple-touch-icon" href="{base}icon-192.png">
<meta name="theme-color" content="#1b2a6b">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600&family=Zen+Kaku+Gothic+New:wght@400;500;700;900&display=swap">
<link rel="stylesheet" href="{base}../zw.css">
<link rel="stylesheet" href="{base}assets/sedori.css">
</head>
<body class="p-sedori" data-base="{base}" {body_attrs}>
<header class="zw-head">
  <div class="in">
    <a class="zw-logo" href="{base}../"><span class="zw-mark" aria-hidden="true">01</span>ZEROICHI WORKS</a>
    <nav class="nav" aria-label="せどりアプリ"><a href="{base}">せどり 利益チェック</a><a class="hide-s" href="#daicho">台帳</a></nav>
  </div>
  <div class="bar"></div>
</header>
"""


def foot(base: str, scripts: list[str]) -> str:
    sc = "\n".join(f'<script src="{base}assets/{s}"></script>' for s in scripts)
    return f"""<footer class="zw-foot">
  <div class="in">
    <nav><a href="{base}">せどり 利益チェック トップ</a><a href="{base}../tokushoho.html">特定商取引法に基づく表記</a><a href="{base}../privacy.html">プライバシーポリシー</a><a href="mailto:zeroichi.works.jp@gmail.com">お問い合わせ</a></nav>
    <p>ZEROICHI WORKS(個人事業)</p>
    <p>このアプリの画面と計算部分はAI(Claude)を使って作成し、手計算の例で検算しています。利益や販売を保証するものではありません。</p>
  </div>
</footer>
{sc}
</body>
</html>
"""


LEDGER = """  <section class="card" id="daicho">
    <h2>仕入れ台帳 <small id="ledger-count"></small></h2>
    <p class="note-s" style="margin-top:0">5つの計算ページで共通の台帳です。CSV(Excel・Googleスプレッドシートで開けます)には古物台帳の項目(品目・特徴・相手方の氏名・住所・職業・年齢・確認の方法)も入ります。</p>
    <div id="ledger"></div>
    <div class="btns"><button type="button" id="ledger-csv" class="b g s">CSVで書き出す</button></div>
    <div id="ledger-form-box"></div>
    <p class="note-s">記帳が必要かどうか・必要な項目は、古物営業法と所轄の警察署の案内で確認してください。このツールは記録の入れ物で、法令上の判断はしません。データはこの端末のブラウザの中だけに保存され、当方には送られません。機種変更の前にCSVで書き出してください。</p>
  </section>
"""

KOBUTSU = """<div class="warn" id="guard" hidden><b>1万円以上の中古品です。</b>古物商が、ヤフオク・フリマなどで個人から1万円以上の古物(ゲームソフト・CD・DVD・書籍・バイク等は金額を問わず)を買うときは、<b>その都度、法律で決められた方法での本人確認</b>が必要です(身分証の写しを受け取るだけでは足りません)。<a href="https://www.keishicho.metro.tokyo.lg.jp/tetsuzuki/kobutsu/kaisetsu/hitaimen.html" target="_blank" rel="noopener">警視庁の解説</a></div>"""

SELL = """      <section class="card ac" id="sell">
        <h2>売る側</h2>
        <div class="f">
          <label class="full">商品名(メモ)<input id="m-name"></label>
          <label>売る場所<select id="s-market"><option value="mercari">メルカリ(10%)</option><option value="yahuoku">Yahoo!オークション(10%)</option><option value="other">その他(率を入力)</option></select></label>
          <label class="yen pct" id="s-rate-w" hidden>販売手数料の率<small>楽天ラクマ等は各サービスで確認</small><input id="s-rate" type="number" inputmode="decimal" step="0.1" value="10"></label>
          <label class="yen">販売価格<input id="s-price" type="number" inputmode="numeric" min="0"></label>
          <label class="full">配送方法<small>メルカリ便の料金(税込・資材代込み)。ほかの売り場では「自分で入力する」</small><select id="s-ship"></select></label>
          <label class="yen" id="s-shipfee-w" hidden>送料<input id="s-shipfee" type="number" inputmode="numeric" min="0" value="0"></label>
          <label class="yen">追加の梱包資材<input id="s-mat" type="number" inputmode="numeric" min="0" value="0"></label>
          <label class="yen">その他<small>クリーニング・付属品など</small><input id="s-other" type="number" inputmode="numeric" min="0" value="0"></label>
          <div data-target></div>
        </div>
        <div class="result" id="m-out" aria-live="polite" style="margin-top:14px"></div>
        <div class="btns"><button type="button" class="b g" id="m-ledger">台帳に書く</button></div>
      </section>
"""


def page(slug: str, title: str, desc: str, tag: str, h1: str, lead: str, body: str, scripts: list[str], route_attr: str, extra: str = "") -> None:
    out = head(title, desc, f"{slug}/", "../", f'data-route="{route_attr}" data-route-label="{html.escape(dict(ROUTES)[slug])}"')
    out += f"""
<main class="app-wrap">
  {routes_nav(slug)}

  <div class="app-title">
    <span class="tag">{tag}</span>
    <h1>{h1}</h1>
    <p>{lead}</p>
    <span class="feedate" data-feedate>手数料データを読み込み中…</span>
  </div>
{body}
{LEDGER}{extra}
</main>

""" + foot("../", scripts)
    (S / slug).mkdir(exist_ok=True)
    (S / slug / "index.html").write_text(out, encoding="utf-8")


def buy_unit_line() -> str:
    return '<p class="note-s" style="font-size:14px">1個あたりの仕入れ原価: <b id="b-unit" class="num" style="font-size:20px">—</b></p>'


# ---- メルカリ 手数料・送料 ----
page("mercari-calc", "メルカリ 手数料・送料・利益の計算", "メルカリの販売手数料10%と、らくらくメルカリ便・ゆうゆうメルカリ便の送料(資材代込み)から、手元に残る金額と、利益を残せる販売価格を計算。Yahoo!オークションとの比較にも。無料・登録不要。",
     "フリマ", "メルカリ 手数料・送料・利益の計算",
     "販売価格から手数料10%と送料を引いた手取りと利益、「いくらで出せば利益が残るか」を計算します。送料はメルカリ便の全サイズ(資材代込み)から選べます。",
     f"""  <div class="cols">
    <div>
      <section class="card" id="buy">
        <h2>仕入れ</h2>
        <div class="f">
          <label class="yen">仕入れ値(1個)<small>不用品なら0円</small><input id="b-cost" type="number" inputmode="numeric" min="0" value="0"></label>
          <label class="yen">その他(1個)<input id="b-other" type="number" inputmode="numeric" min="0" value="0"></label>
        </div>
        {buy_unit_line()}
      </section>
      <section class="card" id="howto">
        <h2>メモ</h2>
        <ul class="items">
          <li><strong>手数料</strong>: メルカリは販売価格の10%(1円未満切り捨て)。Yahoo!オークションの落札システム利用料も2024年6月4日から一律10%です。</li>
          <li><strong>送料は込みで考える</strong>: 送料込みの出品が多いため、送料と資材代を先に引いた手取りで比べるのが分かりやすい方法です。</li>
          <li><strong>らくらくメルカリ便の集荷</strong>は別に100円かかります(このツールでは「その他」に入れてください)。</li>
        </ul>
      </section>
    </div>
    <div class="sticky">
{SELL}    </div>
  </div>
""", ["calc.js", "ui.js", "market.js"], "mercari")

# ---- ヤフオク→メルカリ ----
page("yahuoku-mercari", "ヤフオク→メルカリ 利益計算", "Yahoo!オークションで落札した品をメルカリで売った時の、送料・手数料込みの利益と損益分岐の価格を計算。古物台帳の項目つきの仕入れ台帳(CSV)も。無料・登録不要。",
     "フリマ・中古", "ヤフオク→メルカリ 利益計算",
     "落札価格と送料から1個あたりの原価を出し、メルカリ(またはYahoo!オークション)で売った時の利益を計算します。ヤフオクのページを自動で読み取る機能はありません。見た価格を入れてください。",
     f"""  <div class="cols">
    <div>
      <section class="card" id="buy">
        <h2>仕入れ(Yahoo!オークション)</h2>
        <div class="f">
          <label class="yen">落札価格<input id="b-bid" type="number" inputmode="numeric" min="0"></label>
          <label class="yen">送料(出品者→自分)<input id="b-ship" type="number" inputmode="numeric" min="0" value="0"></label>
          <label class="yen">その他<small>支払い手数料など</small><input id="b-other" type="number" inputmode="numeric" min="0" value="0"></label>
          <label class="yen pct">ポイント還元<small>落札価格に対して</small><input id="b-pt" type="number" inputmode="decimal" min="0" step="0.1" value="0"></label>
          <label>個数<small>まとめて落札した時</small><input id="b-qty" type="number" inputmode="numeric" min="1" value="1"></label>
          <label class="chk full"><input id="b-media" type="checkbox">ゲームソフト・CD・DVD・書籍・バイク等</label>
        </div>
        {buy_unit_line()}
        {KOBUTSU}
      </section>
      <section class="card" id="rules">
        <h2>先に確認すること</h2>
        <ul class="items">
          <li><strong>古物商許可</strong>: 中古品を仕入れて売ることを繰り返すなら、古物商許可が必要です(自分の不用品を売るだけなら不要)。</li>
          <li><strong>1万円以上の買い受け</strong>: 個人から1万円以上の古物を買う時は、その都度、法定の方法で本人確認が必要です。1万円未満でも、18歳未満からの買い受けでないことの確認が要ります。</li>
          <li><strong>写真と説明文</strong>: 出品者の写真や文章を、メルカリの出品にそのまま使わないでください(著作権の問題になります)。自分で撮った写真を使います。</li>
        </ul>
      </section>
    </div>
    <div class="sticky">
{SELL}    </div>
  </div>
""", ["calc.js", "ui.js", "market.js"], "yahuoku")

# ---- 業者オークション(ブランド中古) ----
page("auction-mercari", "ブランド中古 業者オークション→メルカリ 利益計算", "古物市場(業者オークション)で落札したブランド中古品を、メルカリ等で売った時の利益を計算。落札手数料(価格帯別・率)・参加費の按分・税別落札の換算・まとめ落札の1個原価に対応。古物台帳CSVつき。",
     "ブランド中古", "業者オークション→メルカリ 利益計算",
     "古物市場で落札したブランド品などの1個あたりの原価(落札価格・手数料・参加費・送料)を出し、メルカリ等で売った時の利益を計算します。古物市場への参加には古物商許可が必要です。",
     f"""  <div class="cols">
    <div>
      <section class="card" id="buy">
        <h2>仕入れ(業者オークション)</h2>
        <div class="f">
          <label class="full">市場(手数料の目安)<select id="b-venue"></select></label>
          <p class="note-s full" id="b-venue-note" style="margin:0"></p>
          <label class="yen">落札価格<input id="b-bid" type="number" inputmode="numeric" min="0"></label>
          <label class="chk"><input id="b-bidex" type="checkbox" checked>落札価格は税別</label>
          <label class="yen pct" id="b-rate-w" hidden>手数料率<input id="b-rate" type="number" inputmode="decimal" step="0.1" value="5"></label>
          <label class="yen">落札手数料<small>自動で入ります。上書きもできます</small><input id="b-fee" type="number" inputmode="numeric" min="0" value="0"></label>
          <label class="chk"><input id="b-feeex" type="checkbox" checked>手数料は税別</label>
          <label class="yen">参加費(1回)<input id="b-session" type="number" inputmode="numeric" min="0" value="0"></label>
          <label>その回の落札点数<small>参加費を割る数</small><input id="b-sessionn" type="number" inputmode="numeric" min="1" value="1"></label>
          <label class="yen">送料(市場→自分)<input id="b-ship" type="number" inputmode="numeric" min="0" value="0"></label>
          <label class="yen">その他<small>修理・クリーニング等</small><input id="b-other" type="number" inputmode="numeric" min="0" value="0"></label>
          <label>個数<small>まとめ落札(ロット)の点数</small><input id="b-qty" type="number" inputmode="numeric" min="1" value="1"></label>
        </div>
        {buy_unit_line()}
        <p class="note-s">入会金・年会費は含みません(月の仕入れ点数で割って「その他」に入れると、より実際に近くなります)。</p>
      </section>
      <section class="card" id="rules">
        <h2>先に確認すること</h2>
        <ul class="items">
          <li><strong>古物商許可が必要</strong>: 古物市場への入会には古物商許可証が求められます。許可の申請先は営業所のある地域の警察署です。</li>
          <li><strong>古物台帳</strong>: 古物の取引は、年月日・品目と数量・特徴・相手方などの記録が必要な場合があります。下の台帳(CSV)を記録の入れ物として使えます。</li>
          <li><strong>真贋と出品ルール</strong>: ブランド品は、売り場ごとに出品の条件や禁止事項があります。メルカリ等のガイドを確認してから出品してください。</li>
        </ul>
      </section>
    </div>
    <div class="sticky">
{SELL}    </div>
  </div>
""", ["calc.js", "ui.js", "market.js"], "auction")

# ---- 無在庫型 ----
page("muzaiko-amazon", "無在庫型 Amazon中古×ヤフオク 価格差チェック", "Amazonの新品価格(ご自身のKeepa APIキー)と、ご自身で確かめたヤフオクの価格から、Amazon中古の出品価格と手数料後の利益・損益分岐を計算。古物営業法の本人確認・Amazonのドロップシッピング方針の注意つき。",
     "無在庫型・中古", "Amazon中古×ヤフオク 価格差チェック",
     "Amazonの新品価格から中古の出品価格を決め、ヤフオクで見た価格との差から、手数料・発送費を引いた利益を計算します。ヤフオクは検索ページを開くリンクだけで、自動では読み取りません。",
     """  <div class="warn" style="margin-top:14px"><b>はじめる前に(必ず)</b>
    <ul style="margin:6px 0 0">
      <li><b>古物商許可が必要です。</b>中古品を仕入れて売ることを繰り返す場合、古物商許可が要ります。Amazonの出品者情報には、許可した公安委員会名と許可番号の表示も必要です。</li>
      <li><b>1万円以上の買い受けは、その都度、非対面の本人確認</b>が必要です(ゲームソフト・CD・DVD・書籍・バイク等は金額を問わず)。身分証の写しを受け取るだけでは足りず、匿名配送の取引では事実上できません。1万円未満でも、18歳未満からの買い受けでないことの確認が要ります。<a href="https://www.keishicho.metro.tokyo.lg.jp/tetsuzuki/kobutsu/kaisetsu/hitaimen.html" target="_blank" rel="noopener">警視庁の解説</a></li>
      <li><b>Amazonのドロップシッピング方針</b>: 記録上の販売者は自分であること、納品書・外箱・同梱物から仕入れ先(ヤフオクの出品者)の情報を除くこと、返品は自分で受けること。ヤフオクの出品者からお客様へ直接送ってもらう形はとれません。自分(または発送代行)で受け取って検品し、自分の名義で発送します。</li>
      <li><b>ヤフオク出品者の写真・説明文は使わない</b>でください(著作権侵害になります)。既存の商品ページに相乗りし、コンディションは文字で説明します。</li>
      <li><b>仕入れ先が売り切れたら、すぐAmazonの在庫を0に。</b>キャンセルが続くとアカウントの評価に響きます(出荷前キャンセル率の目安は2.5%未満)。</li>
      <li>このツールはヤフオクに自動でアクセスしません(検索ページを開くリンクだけです)。</li>
    </ul>
  </div>
  <div class="cols">
    <div>
      <section class="card ac" id="amazon">
        <h2>1. Amazonの新品価格</h2>
        <div class="f">
          <label class="full">JAN または ASIN<input id="mz-code" autocomplete="off" spellcheck="false" placeholder="例: 4901234567894 / B0XXXXXXXX"></label>
          <div class="full btns" style="margin:0"><button type="button" class="b g s" id="mz-go">Keepaで取得</button><a class="b g s" id="mz-amz" href="https://www.amazon.co.jp/" target="_blank" rel="noopener">Amazonで見る</a></div>
          <div class="full" id="mz-kp"></div>
          <label class="full">商品名<input id="mz-name"></label>
        </div>
        <details class="more"><summary>Keepa APIキー(任意・ご自身のキー)</summary>
          <div class="f"><label class="full">Keepa APIキー<small>この端末のブラウザの中だけに保存し、Keepaへ直接問い合わせます。1回1トークン。</small><input id="mz-key" autocomplete="off" spellcheck="false"></label></div>
          <div class="btns"><button type="button" class="b g s" id="mz-key-save">保存する</button></div>
        </details>
      </section>
      <section class="card" id="yahoo">
        <h2>2. ヤフオクの中古価格を見る</h2>
        <div class="f">
          <label class="full">検索する言葉<small>型番や短い商品名が見つけやすい</small><input id="mz-q"></label>
          <div class="full btns" style="margin:0">
            <a class="b" id="mz-yh" href="https://auctions.yahoo.co.jp/" target="_blank" rel="noopener">ヤフオクで中古価格を見る</a>
            <a class="b g" id="mz-yh-closed" href="https://auctions.yahoo.co.jp/" target="_blank" rel="noopener">落札相場を見る</a>
          </div>
        </div>
        <p class="note-s">新しいタブでYahoo!オークションの検索ページを開きます。見た価格を下の「ヤフオクの価格」に入れてください。</p>
      </section>
    </div>
    <div class="sticky">
      <section class="card ac" id="mz-calc">
        <h2>3. 出品価格と利益</h2>
        <div class="f">
          <label class="yen">Amazonの新品価格<input id="mz-new" type="number" inputmode="numeric" min="0"></label>
          <label class="yen pct">新品より何%安く出すか<input id="mz-off" type="number" inputmode="decimal" min="0" max="90" step="1" value="15"></label>
          <label class="yen">Amazonの出品価格(中古)<small>自動で入ります。上書きもできます</small><input id="mz-sell" type="number" inputmode="numeric" min="0"></label>
          <label>カテゴリー<select id="mz-cat"></select></label>
          <label class="yen">ヤフオクの価格<small>即決・落札の見込み</small><input id="mz-yprice" type="number" inputmode="numeric" min="0"></label>
          <label class="yen">ヤフオクの送料<input id="mz-yship" type="number" inputmode="numeric" min="0" value="0"></label>
          <label class="yen">お客様への発送<small>発送代行の料金・送料</small><input id="mz-outship" type="number" inputmode="numeric" min="0" value="900"></label>
          <label class="yen">その他<input id="mz-other" type="number" inputmode="numeric" min="0" value="0"></label>
          <div data-target></div>
          <label class="chk"><input id="mz-media" type="checkbox">ゲームソフト・CD・DVD・書籍・バイク等</label>
        </div>
        <div class="warn" id="mz-guard" hidden><b>本人確認が必要な取引です。</b>この価格(または品目)の古物を個人から買う場合、その都度、法定の非対面の本人確認が必要です。確認できない取引は見送ってください。</div>
        <div class="result" id="mz-out" aria-live="polite" style="margin-top:14px"></div>
        <div class="btns"><button type="button" class="b g" id="mz-ledger">仕入れたので台帳に書く</button></div>
        <p class="note-s">FBAは使わない前提(自己発送・発送代行)で計算しています。中古の出品には、カテゴリーによって出品許可が要るものがあります。</p>
      </section>
    </div>
  </div>
""", ["calc.js", "ui.js", "mz.js"], "muzaiko")

# ---- rakuten-amazon: ルート切替だけ差し替え ----
ra = S / "rakuten-amazon/index.html"
t = ra.read_text(encoding="utf-8")
t = re.sub(r'<nav class="routes".*?</nav>', routes_nav("rakuten-amazon"), t, count=1, flags=re.S)
t = t.replace("4つの計算ページで共通の台帳", "5つの計算ページで共通の台帳")
ra.write_text(t, encoding="utf-8")

# ---- 着地ページの出典一覧(index.html の <!--FEES--> の間) ----
idx = S / "index.html"
if idx.exists():
    rows = "\n".join(
        f'      <li><a href="{html.escape(s["url"])}" target="_blank" rel="noopener">{html.escape(s["topic"])}</a>'
        + (f'<br><small>{html.escape(s["note"])}</small>' if s.get("note") else "") + "</li>" for s in FEES["sources"])
    t = idx.read_text(encoding="utf-8")
    t = re.sub(r"<!--FEES-->.*?<!--/FEES-->", "<!--FEES-->\n" + rows + "\n      <!--/FEES-->", t, flags=re.S)
    t = re.sub(r"<!--CHECKED-->.*?<!--/CHECKED-->", f"<!--CHECKED-->{FEES['checked_label']}<!--/CHECKED-->", t, flags=re.S)
    idx.write_text(t, encoding="utf-8")

# ---- サイトマップ ----
urls = [("", "0.9")] + [(f"{slug}/", "0.8") for slug, _ in ROUTES]
sm = "\n".join(f"<url><loc>{BASE_URL}{u}</loc><lastmod>{FEES['checked']}</lastmod><priority>{p}</priority></url>" for u, p in urls)
(S / "sitemap.xml").write_text(f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{sm}\n</urlset>\n', encoding="utf-8")
print("built", [slug for slug, _ in ROUTES])
