"""せどり 利益チェック: 共通の頭(検索バー・目標の利益・メニュー)と足(法律と規約の注意)を付けて、全ページのHTMLを書き出す。

使い方: python3 tools/sedori/build_pages.py [公開フォルダ(既定 ../kt-zs-sedori-ghp)]
- 書き出すページ: トップ、5つの計算ページ、台帳(daicho)、料金とお申し込み(plans)、マイページ(mypage)、利用規約(terms)、プライバシーポリシー(privacy)。
- 手数料の出典一覧(トップの #fees)は sedori/data/fees.json から作る。
- 画面の部品は sedori/assets/ の ui.js(共通)・config.js(ログイン・お支払いの設定)・sync.js(同期の計算)・account.js(ログイン・同期)・ra.js・mz.js・market.js・ledger.js・top.js・plans.js・mypage.js。
"""
from __future__ import annotations

import html
import json
import pathlib
import sys

ROOT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else pathlib.Path(__file__).resolve().parents[3] / "kt-zs-sedori-ghp")
S = ROOT / "sedori"
FEES = json.loads((S / "data/fees.json").read_text(encoding="utf-8"))
BASE_URL = "https://hiro0530.github.io/zeroichi-store/sedori/"
VER = "20261028b"

# 料金は sedori/assets/config.js の PLAN_CATALOG だけで決める(/*PLANS*/ と /*/PLANS*/ の間の JSON)
import re as _re
CAT = json.loads(_re.search(r"/\*PLANS\*/(.*?)/\*/PLANS\*/", (S / "assets/config.js").read_text(encoding="utf-8"), _re.S).group(1))


def yen(n: int) -> str:
    return f"{n:,}円"


def per_month(k: str) -> str:
    p = CAT[k]["price"]
    return ("約" if p % 12 else "") + f"{round(p / 12):,}円"


P_SM, P_SY, P_FM, P_FY = (CAT[k]["price"] for k in ("standard_month", "standard_year", "founder_month", "founder_year"))
P_BM, P_BY = CAT["business_month"]["price"], CAT["business_year"]["price"]
SAVE_MONTHS = round((P_SM * 12 - P_SY) / P_SM)

ROUTES = [
    ("rakuten-amazon", "楽天・Yahoo!→Amazon"),
    ("muzaiko-amazon", "無在庫 Amazon中古"),
    ("mercari-calc", "メルカリ"),
    ("yahuoku-mercari", "ヤフオク→メルカリ"),
    ("auction-mercari", "業者オークション"),
]

# 検索バーの「どこを探すか」。ページごとに既定を変える
SOURCES = [
    ("rakuten", "楽天市場"),
    ("yshop", "Yahoo!ショッピング"),
    ("amazon", "Amazon(JAN・ASIN)"),
    ("yahuoku", "ヤフオク 出品中"),
    ("yahuoku-closed", "ヤフオク 落札相場"),
    ("mercari-sold", "メルカリ 売り切れ"),
    ("ledger", "台帳"),
]


def esc(s: str) -> str:
    return html.escape(s, quote=True)


def header(base: str, current: str, src: str) -> str:
    opts = "".join(f'<option value="{v}"{" selected" if v == src else ""}>{t}</option>' for v, t in SOURCES)
    nav = [("", "トップ")] + ROUTES + [("daicho", "台帳")]
    links = "".join(
        f'<a href="{base}{slug + "/" if slug else ""}"{" aria-current=\"page\"" if slug == current else ""}>{label}</a>'
        for slug, label in nav)
    return f"""<header class="hd">
  <div class="hd-in">
    <a class="logo" href="{base}"><b>ZEROICHI</b><span>せどり 利益チェック</span></a>
    <form class="sbar" id="sbar" role="search">
      <label class="sr" for="sb-src">探す場所</label>
      <select id="sb-src">{opts}</select>
      <label class="sr" for="sb-q">キーワード・JAN・ASIN</label>
      <input id="sb-q" type="search" enterkeyhint="search" autocomplete="off" placeholder="商品名・JAN・ASIN">
      <button type="submit">検索</button>
    </form>
    <div class="tgt shipm" id="shipm" title="発送のしかた">
      <span class="tgt-k">発送</span>
      <span class="seg"><button type="button" data-s="self" title="自分で発送(経費をかけない)">自分で発送</button><button type="button" data-s="3pl" title="発送代行に任せる">発送代行</button></span>
    </div>
    <div class="tgt" id="tgt">
      <span class="tgt-k">目標の利益</span>
      <input id="t-val" type="number" inputmode="decimal" min="0" step="1" aria-label="目標の利益">
      <span class="seg" role="group" aria-label="単位"><button type="button" data-m="yen">円</button><button type="button" data-m="pct">%</button></span>
    </div>
    <a class="hd-ledger" href="{base}daicho/">台帳<span class="cnt" id="hd-cnt"></span></a>
    <a class="hd-acct" id="hd-acct" href="{base}mypage/">ログイン</a>
  </div>
  <nav class="gnav" aria-label="ページ"><div class="gnav-in">{links}</div></nav>
</header>
"""


def crumb(base: str, label: str | None) -> str:
    trail = f'<a href="{base}">トップ</a><span aria-hidden="true">&gt;</span><span>{label}</span>' if label else '<span>トップ</span>'
    return f"""<div class="crumb"><div class="crumb-in"><nav aria-label="現在地">{trail}</nav><span class="feedate" data-feedate></span></div></div>
"""


LEGAL = """<details class="legal" id="legal">
      <summary>法律と規約の注意</summary>
      <div class="legal-body">
        <h3>古物営業法</h3>
        <ul>
          <li>中古品を仕入れて売ることを繰り返す場合は、古物商許可が必要です(自分の不用品を売るだけなら不要)。Amazonで中古を出品する場合は、出品者情報に許可した公安委員会名と許可番号の表示も必要です。</li>
          <li>個人から1万円以上の古物を買うときは、その都度、法律で決められた方法での本人確認が必要です。ゲームソフト・CD・DVD・書籍・バイク等と、2025年10月1日からはエアコンの室外機・電線・金属製グレーチングも、金額を問わず必要です。身分証の写しを受け取るだけでは足りず、匿名配送の取引では事実上できません。1万円未満でも、18歳未満からの買い受けでないことの確認が要ります。<a href="https://www.keishicho.metro.tokyo.lg.jp/tetsuzuki/kobutsu/kaisetsu/hitaimen.html" target="_blank" rel="noopener">警視庁の解説</a></li>
          <li>古物の取引は、年月日・品目と数量・特徴・相手方の住所氏名職業年齢・確認の方法などの記録が必要です。このアプリの台帳は記録の入れ物で、法令上の判断はしません。必要な項目は所轄の警察署で確認してください。台帳で相手確認が未入力の行には印が付きます。</li>
          <li>古物市場(業者オークション)への入会には古物商許可証が求められます。</li>
        </ul>
        <h3>Amazonの方針(無在庫・ドロップシッピング)</h3>
        <ul>
          <li>記録上の販売者は自分であること、納品書・外箱・同梱物から仕入れ先の情報を除くこと、返品は自分で受けること。仕入れ先からお客様へ直接送ってもらう形はとれません。自分(または発送代行)で受け取って検品し、自分の名義で発送します。</li>
          <li>仕入れ先が売り切れたら、すぐAmazonの在庫を0にしてください。出荷前キャンセル率の目安は2.5%未満です。</li>
          <li>ブランドやカテゴリーによっては出品の許可が要ります。セラーセントラルで確かめてから仕入れてください。</li>
        </ul>
        <h3>写真と説明文</h3>
        <ul>
          <li>仕入れ先(ヤフオク・メルカリ等の出品者)の写真や文章を、自分の出品にそのまま使わないでください。著作権の問題になります。自分で撮った写真を使い、Amazonでは既存の商品ページに相乗りしてコンディションを文字で説明します。</li>
        </ul>
        <h3>自動アクセス</h3>
        <ul>
          <li>このアプリはメルカリ・Yahoo!オークション・業者オークション・Amazonのページを自動で読み取りません。検索は各サイトの検索ページを新しいタブで開くだけです。楽天とKeepaは、ご自身のIDとキーで公式APIを使います。</li>
        </ul>
      </div>
    </details>"""


def footer(base: str, scripts: list[str]) -> str:
    # 設定(config.js)と同期の計算(sync.js)は最初に、ログイン(account.js)は ui.js の後に、全ページで読む
    order = ["config.js", "sync.js"] + [x for x in scripts if x == "calc.js"] + ["ui.js", "account.js"] + [x for x in scripts if x not in ("calc.js", "ui.js")]
    sc = "\n".join(f'<script src="{base}assets/{s}?v={VER}"></script>' for s in order)
    return f"""<footer class="ft">
  <div class="ft-in">
    <nav><a href="{base}">トップ</a><a href="{base}daicho/">台帳</a><a href="{base}#fees">手数料の出典</a><a href="{base}plans/">料金</a><a href="{base}mypage/">マイページ</a><a href="{base}terms/">利用規約</a><a href="{base}privacy/">プライバシーポリシー</a><a href="{base}../tokushoho.html">特定商取引法に基づく表記</a><a href="mailto:zeroichi.works.jp@gmail.com">お問い合わせ</a></nav>
    {LEGAL}
    <p>ZEROICHI WORKS(個人事業)。画面と計算部分はAI(Claude)を使って作成し、手計算の例で検算しています。計算は目安で、利益や販売を保証するものではありません。入力した内容と台帳はこの端末のブラウザの中に保存されます(スタンダードでログインしている時は、台帳をクラウドにも保存します)。</p>
  </div>
</footer>
{sc}
</body>
</html>
"""


def head(title: str, desc: str, path: str, base: str, body_attrs: str) -> str:
    t, d = esc(title), esc(desc)
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
<meta name="theme-color" content="#1e3348">
<link rel="stylesheet" href="{base}assets/sedori.css?v={VER}">
</head>
<body data-base="{base}" {body_attrs}>
"""


def write(slug: str, html_text: str) -> None:
    d = S / slug if slug else S
    d.mkdir(exist_ok=True)
    # 受付が始まってから見せる部分は、最初は隠しておく(account.js が config を見て出す)
    html_text = html_text.replace('data-bill="ready"', 'data-bill="ready" hidden').replace('data-acct="ready"', 'data-acct="ready" hidden')
    (d / "index.html").write_text(html_text, encoding="utf-8")


def route_page(slug: str, title: str, desc: str, src: str, route_attr: str, body: str, scripts: list[str]) -> None:
    label = dict(ROUTES)[slug]
    out = head(title, desc, f"{slug}/", "../", f'data-route="{route_attr}" data-route-label="{esc(label)}" data-page="{slug}"')
    out += header("../", slug, src) + crumb("../", esc(title)) + f'<main class="wrap">\n{body}\n</main>\n' + footer("../", scripts)
    write(slug, out)


# ------------------------------------------------------------------
# 部品
# ------------------------------------------------------------------
def box(title: str, inner: str, cls: str = "", open_: bool = True, ident: str = "") -> str:
    i = f' id="{ident}"' if ident else ""
    return f"""<details class="sbox {cls}"{i}{" open" if open_ else ""} data-desk-open>
        <summary>{title}</summary>
        <div class="sbox-b">{inner}</div>
      </details>"""


def fld(label: str, inp: str, unit: str = "", note: str = "", cls: str = "") -> str:
    u = f'<span class="u">{unit}</span>' if unit else ""
    n = f'<small>{note}</small>' if note else ""
    return f'<label class="fr {cls}"><span class="fk">{label}{n}</span><span class="fv">{inp}{u}</span></label>'


def num(ident: str, value: str = "", extra: str = "") -> str:
    v = f' value="{value}"' if value != "" else ""
    return f'<input id="{ident}" type="number" inputmode="numeric" min="0"{v}{extra}>'


def dec(ident: str, value: str = "", extra: str = "") -> str:
    v = f' value="{value}"' if value != "" else ""
    return f'<input id="{ident}" type="number" inputmode="decimal" min="0" step="0.1"{v}{extra}>'


def cell(label: str, inp: str, unit: str = "", cls: str = "") -> str:
    u = f'<span class="u">{unit}</span>' if unit else ""
    return f'<label class="cell {cls}"><span class="ck2">{label}</span><span class="cv">{inp}{u}</span></label>'


def chk(ident: str, label: str, checked: bool = False) -> str:
    return f'<label class="ck"><input id="{ident}" type="checkbox"{" checked" if checked else ""}>{label}</label>'


DETAIL_ACTIONS = """<div class="acts">
          <button type="button" class="btn pri" data-act="list">この価格で出品<kbd>Enter</kbd></button>
          <button type="button" class="btn buy" data-act="buy">仕入れた<kbd>S</kbd></button>
        </div>
        <div id="party"></div>
        <div id="brk"></div>"""


# ------------------------------------------------------------------
# 楽天・Yahoo!→Amazon
# ------------------------------------------------------------------
RA_BODY = f"""<div class="lay3">
  <aside class="side" aria-label="絞り込みと条件">
      {box("絞り込み", '''<div class="fl">
          <label class="fr col"><span class="fk">並び順</span><span class="fv"><select id="sort" style="width:100%"><option value="price">価格の安い順</option><option value="standard">標準</option><option value="review">レビューの多い順</option></select></span></label>
          ''' + chk("ptonly", "ポイント2倍以上") + chk("freeonly", "送料無料のみ") + '''
          <div class="fr2"><span class="fk">価格</span><span class="rng">''' + num("pmin", "", ' placeholder="下限" aria-label="価格の下限"') + '<span>〜</span>' + num("pmax", "", ' placeholder="上限" aria-label="価格の上限"') + '''</span></div>
          ''' + chk("profitonly", "目標を満たす行だけ") + '''
        </div>''')}
      {box("Amazon側の条件", '''<p class="hint">一覧の全行にこの条件で計算します。</p>
        <div class="fl">
          <label class="fr col"><span class="fk">カテゴリー</span><select id="c-cat"></select></label>
          <label class="fr col"><span class="fk">FBAのサイズ</span><select id="c-tier"></select></label>
          ''' + fld("納品送料", num("c-inbound", "100"), "円", "資材込み・1個") + fld("その他", num("c-other", "0"), "円", "1個") + fld("ポイント上乗せ", dec("c-pt-mine", "0"), "%", "SPU・カード") +
          chk("c-usept", "ポイントを利益に含める", True) + chk("c-self", "FBAを使わない(自分か代行が発送)") +
          '<div id="c-selfship-w" hidden><label class="fr col"><span class="fk">運送会社・サイズ</span><select id="c-carrier"></select></label>' + fld("送料", num("c-selfship", "0"), "円", "自分で入力の時") + '''</div>
        </div>''')}
      {box("APIキー", '''<p class="hint">ご自身のIDとキーをこの端末だけに保存し、楽天・Keepaへ直接問い合わせます。</p>
        <div class="fl">
          <label class="fr col"><span class="fk">楽天 アプリID</span><input id="k-rk-app" autocomplete="off" spellcheck="false"></label>
          <label class="fr col"><span class="fk">楽天 アクセスキー(pk_)</span><input id="k-rk-key" autocomplete="off" spellcheck="false"></label>
          <label class="fr col"><span class="fk">Keepa APIキー(任意)</span><input id="k-kp" autocomplete="off" spellcheck="false"></label>
          <div class="row-btns"><button class="btn sm" type="button" id="k-save">保存</button><button class="btn sm ghost" type="button" id="k-clear">消す</button></div>
          <p class="hint">楽天: <a href="https://webservice.rakuten.co.jp/" target="_blank" rel="noopener">Rakuten Developers</a>でアプリを作り、許可するWebサイトに <code>https://hiro0530.github.io</code> を入れる。Keepa: <a href="https://keepa.com/#!api" target="_blank" rel="noopener">Keepa API</a>(有料・1件1トークン)。Yahoo!ショッピングは公式の検索ページを開きます。</p>
        </div>''', "keys", False, "keys")}
  </aside>

  <section class="res" aria-label="一覧">
    <div class="tabs" role="tablist">
      <button type="button" role="tab" data-tab="s" aria-selected="false">検索結果<span class="n" id="n-s">0</span></button>
      <button type="button" role="tab" data-tab="t" aria-selected="true">今日のポイント高還元<span class="n" id="n-t">0</span></button>
      <button type="button" role="tab" data-tab="w" aria-selected="false">ウォッチ<span class="n" id="n-w">0</span></button>
    </div>
    <div class="tbar">
      <p class="tbar-t" id="res-title">今日のポイント高還元(楽天)</p>
      <span class="tbar-r"><span id="quota" class="muted"></span><button type="button" class="btn sm ghost" id="kp-bulk" hidden>Keepaで売値をまとめて取得</button><button type="button" class="btn sm ghost" id="w-csv" hidden>CSV</button></span>
    </div>
    <div id="res-msg"></div>
    <div class="gridwrap">
      <table class="grid mc" id="grid">
        <colgroup><col class="c-img"><col><col class="c-n"><col class="c-pt"><col class="c-n"><col class="c-n c-fee"><col class="c-n"><col class="c-rt"></colgroup>
        <thead><tr><th class="c-img"></th><th>商品名</th><th class="r">仕入れ値</th><th class="r c-pt">ポイント</th><th class="r">Amazon売値</th><th class="r c-fee">手数料</th><th class="r">利益</th><th class="r">利益率</th></tr></thead>
        <tbody id="rows"></tbody>
      </table>
    </div>
    <p class="credit" id="credit"></p>
  </section>

  <aside class="det" id="calc" aria-label="選んだ商品">
    <div class="det-in">
      <div class="det-h"><p class="det-k">選んだ商品</p><p class="det-name" id="d-name">一覧の行を選ぶと、ここに内訳が出ます。</p><p class="det-sub" id="d-sub"></p></div>
      <div class="dg">
        {cell("仕入れ値(税込)", num("c-cost"), "円")}
        {cell("仕入れの送料", num("c-inship", "0"), "円")}
        {cell("ショップのポイント", dec("c-pt-shop", "1"), "%")}
        {cell("仕入れる個数", num("c-qty", "1"), "個")}
        <label class="cell"><span class="ck2">JAN・ASIN</span><span class="cv"><input id="c-code" autocomplete="off" spellcheck="false"><button type="button" class="btn sm ghost in" id="kp-go">Keepa</button></span></label>
        {cell("Amazon売値(税込)", num("c-sell"), "円")}
      </div>
      <div id="wh"></div>
      <div id="kp-out"></div>
      <div id="c-out" aria-live="polite"></div>
      {DETAIL_ACTIONS}
      <p class="det-links"><button type="button" class="lnk" id="c-watch">ウォッチに追加</button><a id="amz-link" href="https://www.amazon.co.jp/" target="_blank" rel="noopener">Amazonで見る</a><a id="kp-link" href="https://keepa.com/" target="_blank" rel="noopener">Keepaで見る</a></p>
      <details class="dims"><summary>寸法と重さからFBAのサイズを出す</summary>
        <div class="dims-g">
          <label>長さcm<input id="d1" type="number" inputmode="decimal" step="0.1"></label><label>幅cm<input id="d2" type="number" inputmode="decimal" step="0.1"></label><label>高さcm<input id="d3" type="number" inputmode="decimal" step="0.1"></label><label>重さg<input id="dg" type="number" inputmode="numeric"></label>
        </div>
        <p class="hint" id="d-out">梱包した状態の寸法を入れてください。</p>
      </details>
    </div>
  </aside>
</div>"""

route_page("rakuten-amazon", "楽天・Yahoo!→Amazon 利益チェック",
           "楽天市場・Yahoo!ショッピングの商品を、Amazon(FBA)で売った時の手数料・ポイント込みの利益を一覧で計算。目標の利益を満たす売値、損益分岐、仕入れ上限。仕入れると古物台帳に自動で記録。無料・登録不要。",
           "rakuten", "ra", RA_BODY, ["calc.js", "ui.js", "ra.js"])

# ------------------------------------------------------------------
# 無在庫 Amazon中古 × ヤフオク
# ------------------------------------------------------------------
MZ_BODY = f"""<div class="lay3">
  <aside class="side" aria-label="条件">
      {box("Amazonの商品", '''<div class="fl">
          <label class="fr col"><span class="fk">JAN・ASIN</span><span class="fv"><input id="mz-code" autocomplete="off" spellcheck="false"><button type="button" class="btn sm ghost in" id="mz-go">Keepa</button></span></label>
          <div id="mz-kp"></div>
          <label class="fr col"><span class="fk">商品名</span><input id="mz-name"></label>
          ''' + fld("新品の価格", num("mz-new"), "円", "Amazon") + '''
          <label class="fr col"><span class="fk">カテゴリー</span><select id="mz-cat"></select></label>
        </div>''')}
      {box("ヤフオクの価格", '''<div class="fl">
          <label class="fr col"><span class="fk">検索する言葉</span><input id="mz-q"></label>
          <p class="row-links"><a id="mz-yh" href="https://auctions.yahoo.co.jp/" target="_blank" rel="noopener">出品中を見る</a><a id="mz-yh-closed" href="https://auctions.yahoo.co.jp/" target="_blank" rel="noopener">落札相場を見る</a></p>
          ''' + fld("価格", num("mz-yprice"), "円", "即決・落札見込み") + fld("送料", num("mz-yship", "0"), "円", "出品者→自分") + chk("mz-media", "ゲーム・CD・DVD・書籍・バイク・エアコン室外機・電線・金属製グレーチング等") + '''
          <label class="fr col"><span class="fk">ヤフオクの終了日時<small>入れると「出品した(見張る)」で台帳に入り、終了60分前に通知</small></span><input id="mz-yend" type="datetime-local"></label>
          <label class="fr col"><span class="sr">終了日時の文字を貼り付け</span><input id="mz-yend-paste" type="text" autocomplete="off" placeholder="終了日時の文字を貼り付け"></label>
        </div>''')}
      {box("発送", '''<div class="fl">
          ''' + '''<label class="fr col"><span class="fk">運送会社・サイズ</span><select id="mz-carrier"></select></label>''' + fld("送料", num("mz-outship", "0"), "円", "自分で入力の時") + fld("その他", num("mz-other", "0"), "円") + '''
          <p class="hint">FBAは使いません。自分か発送代行が、お客様へ直接送ります。</p>
        </div>''', "", True)}
      {box("APIキー", '''<div class="fl"><label class="fr col"><span class="fk">Keepa APIキー</span><input id="mz-key" autocomplete="off" spellcheck="false"></label>
        <div class="row-btns"><button type="button" class="btn sm" id="mz-key-save">保存</button></div></div>''', "", False)}
  </aside>

  <section class="res" aria-label="出品価格の候補">
    <div class="tabs" role="tablist"><button type="button" role="tab" aria-selected="true">出品価格の候補</button></div>
    <div class="tbar"><p class="tbar-t" id="mz-title">新品の価格を入れると、値下げ幅ごとの利益が並びます</p></div>
    <div class="gridwrap">
      <table class="grid nimg mc" id="grid">
        <thead><tr><th>出品価格の決め方</th><th class="r">出品価格</th><th class="r c-fee">販売手数料</th><th class="r c-fee">発送</th><th class="r">利益</th><th class="r">利益率</th><th class="r">ヤフオク上限</th></tr></thead>
        <tbody id="rows"></tbody>
      </table>
    </div>
    <p class="credit">ヤフオク上限は、目標の利益を残せるヤフオクの価格(送料別)です。行を選ぶと出品価格に入ります。</p>
  </section>

  <aside class="det" id="mz-calc" aria-label="内訳">
    <div class="det-in">
      <div class="det-h"><p class="det-k">選んだ出品価格</p><p class="det-name" id="d-name">—</p><p class="det-sub" id="d-sub"></p></div>
      <div class="dg">
        {cell("出品価格(中古)", num("mz-sell"), "円")}
      </div>
      <div id="wh"></div>
      <div id="mz-out" aria-live="polite"></div>
      {DETAIL_ACTIONS}
      <p class="det-links"><a id="mz-amz" href="https://www.amazon.co.jp/" target="_blank" rel="noopener">Amazonで見る</a></p>
    </div>
  </aside>
</div>"""

route_page("muzaiko-amazon", "無在庫 Amazon中古×ヤフオク 価格差チェック",
           "Amazonの新品価格(ご自身のKeepa APIキー)と、ご自身で確かめたヤフオクの価格から、Amazon中古の出品価格ごとの利益と、ヤフオクで払ってよい上限を一覧で計算。仕入れると古物台帳に自動で記録。",
           "amazon", "muzaiko", MZ_BODY, ["calc.js", "ui.js", "mz.js"])


# ------------------------------------------------------------------
# メルカリ系(3ページ共通の右側)
# ------------------------------------------------------------------
def market_body(side: str, title_hint: str) -> str:
    return f"""<div class="lay3">
  <aside class="side" aria-label="仕入れ">
      {side}
  </aside>

  <section class="res" aria-label="配送方法ごとの売値と利益">
    <div class="tabs" role="tablist" id="mk-tabs">
      <button type="button" role="tab" data-mk="mercari" aria-selected="true">メルカリ 10%</button>
      <button type="button" role="tab" data-mk="yahuoku" aria-selected="false">Yahoo!オークション 10%</button>
      <button type="button" role="tab" data-mk="other" aria-selected="false">その他</button>
    </div>
    <div class="tbar">
      <p class="tbar-t">{title_hint}</p>
      <span class="tbar-r">
        <label class="inl" id="s-rate-w" hidden>手数料率 {dec("s-rate", "10")}%</label>
        <label class="inl">販売価格 {num("s-price")}円</label>
      </span>
    </div>
    <div class="gridwrap">
      <table class="grid nimg mc" id="grid">
        <thead><tr><th>配送方法</th><th class="r">送料・資材</th><th class="r c-fee">損益分岐</th><th class="r">目標の売値</th><th class="r c-fee">手数料</th><th class="r">利益</th><th class="r">利益率</th></tr></thead>
        <tbody id="rows"></tbody>
      </table>
    </div>
    <p class="credit">利益と手数料は、上の販売価格で売れた場合です(未入力なら目標の売値で計算)。送料はメルカリ便の料金(税込・資材代込み)。行を選ぶと配送方法が決まります。</p>
  </section>

  <aside class="det" id="sell" aria-label="内訳">
    <div class="det-in">
      <div class="det-h"><p class="det-k">選んだ配送方法</p><p class="det-name" id="d-name">—</p><p class="det-sub" id="d-sub"></p></div>
      <div class="dg">
        <label class="cell w2"><span class="ck2">商品名(台帳に入ります)</span><span class="cv"><input id="m-name"></span></label>
        {cell("追加の資材", num("s-mat", "0"), "円")}
        {cell("その他(集荷・付属品)", num("s-other", "0"), "円")}
        <div id="s-shipfee-w" class="w2" hidden>{cell("送料(自分で入力)", num("s-shipfee", "0"), "円")}</div>
      </div>
      <div id="wh"></div>
      <div id="m-out" aria-live="polite"></div>
      {DETAIL_ACTIONS}
    </div>
  </aside>
</div>"""


def unit_line() -> str:
    return '<p class="unit">1個の原価 <b id="b-unit">—</b></p>'


MC_SIDE = box("仕入れ", '<div class="fl">' + fld("仕入れ値", num("b-cost", "0"), "円", "不用品なら0") + fld("その他", num("b-other", "0"), "円", "1個") + "</div>" + unit_line()) + \
    box("メモ", '<ul class="memo"><li>手数料は販売価格の10%(1円未満切り捨て)。</li><li>らくらくメルカリ便の集荷は別に100円(「その他」へ)。</li><li>売上金の振込申請は1回200円(計算に含めません)。</li></ul>', "", False)
route_page("mercari-calc", "メルカリ 手数料・送料・利益の計算",
           "メルカリの販売手数料10%と、らくらくメルカリ便・ゆうゆうメルカリ便の全サイズの送料(資材代込み)から、配送方法ごとの利益と、目標の利益を残す売値を一覧で計算。無料・登録不要。",
           "mercari-sold", "mercari", market_body(MC_SIDE, "配送方法ごとの売値と利益"), ["calc.js", "ui.js", "market.js"])

YM_SIDE = box("仕入れ(ヤフオク)", '<div class="fl">' + fld("落札価格", num("b-bid"), "円") + fld("送料", num("b-ship", "0"), "円", "出品者→自分") +
              fld("その他", num("b-other", "0"), "円", "支払い手数料など") + fld("ポイント", dec("b-pt", "0"), "%", "落札価格に対して") +
              fld("個数", num("b-qty", "1", ' min="1"'), "個", "まとめ落札") + chk("b-media", "ゲーム・CD・DVD・書籍・バイク・エアコン室外機・電線・金属製グレーチング等") + "</div>" + unit_line() +
              '<p class="hint" id="guard" hidden><span class="badge">相手確認が必要</span> 1万円以上(またはゲーム等)の中古品です。仕入れた後、台帳で相手の確認を入力してください。</p>')
route_page("yahuoku-mercari", "ヤフオク→メルカリ 利益計算",
           "Yahoo!オークションで落札した品をメルカリで売った時の、配送方法ごとの利益と損益分岐を一覧で計算。まとめ落札の1個原価、ポイント。仕入れると古物台帳に自動で記録。無料・登録不要。",
           "yahuoku-closed", "yahuoku", market_body(YM_SIDE, "配送方法ごとの売値と利益"), ["calc.js", "ui.js", "market.js"])

AU_SIDE = box("仕入れ(業者オークション)", '<div class="fl">' +
              '<label class="fr col"><span class="fk">市場</span><select id="b-venue"></select></label><p class="hint" id="b-venue-note"></p>' +
              fld("落札価格", num("b-bid"), "円") + chk("b-bidex", "落札価格は税別", True) +
              '<div id="b-rate-w" hidden>' + fld("手数料率", dec("b-rate", "5"), "%") + "</div>" +
              fld("落札手数料", num("b-fee", "0"), "円", "自動。上書き可") + chk("b-feeex", "手数料は税別", True) +
              fld("参加費(1回)", num("b-session", "0"), "円") + fld("その回の点数", num("b-sessionn", "1", ' min="1"'), "点", "参加費を割る数") +
              fld("送料", num("b-ship", "0"), "円", "市場→自分") + fld("その他", num("b-other", "0"), "円", "修理・クリーニング") +
              fld("個数", num("b-qty", "1", ' min="1"'), "個", "ロットの点数") + "</div>" + unit_line() +
              '<p class="hint">入会金・年会費は含みません。</p>')
route_page("auction-mercari", "業者オークション→メルカリ 利益計算",
           "古物市場(業者オークション)で落札したブランド中古品を、メルカリ等で売った時の配送方法ごとの利益を一覧で計算。落札手数料・参加費の按分・税別落札の換算・ロットの1個原価。古物台帳に自動で記録。",
           "mercari-sold", "auction", market_body(AU_SIDE, "配送方法ごとの売値と利益"), ["calc.js", "ui.js", "market.js"])

# ------------------------------------------------------------------
# 台帳
# ------------------------------------------------------------------
LEDGER_BODY = """<div class="lg">
  <div class="lg-head">
    <h1>古物台帳</h1>
    <dl class="sum" id="lg-sum"></dl>
    <span class="lg-act"><button type="button" class="btn sm ghost" id="lg-add">手で追加</button><button type="button" class="btn sm ghost" id="lg-csv">CSVで書き出す</button><button type="button" class="btn sm" id="lg-xlsx">Excelで書き出す</button></span>
  </div>
  <div class="tabs" role="tablist" id="lg-tabs"></div>
  <div class="tbar"><p class="tbar-t" id="lg-title"></p><span class="tbar-r"><button type="button" class="btn sm ghost tg" id="lg-notify" aria-pressed="false" title="ヤフオクの終了60分前に、ブラウザの通知でお知らせ(このアプリのページを開いている間)">終了60分前の通知: オフ</button><label class="inl">期間 <select id="lg-period"><option value="all">すべて</option><option value="m0">今月</option><option value="m1">先月</option><option value="y0">今年</option></select></label></span></div>
  <div id="lg-form-box"></div>
  <div class="gridwrap">
    <table class="grid ledger" id="lg-grid">
      <thead><tr><th>状態</th><th>仕入日</th><th>品名・品目・特徴</th><th class="r">数量</th><th class="r">仕入れ値</th><th>仕入れ先・相手</th><th>相手確認</th><th>売却</th><th class="r">売値</th><th class="r">見込み利益</th><th></th></tr></thead>
      <tbody id="lg-rows"></tbody>
    </table>
  </div>
  <p class="credit">仕入れ値1万円以上の中古品と、ゲーム・CD・DVD・書籍・バイク・エアコン室外機・電線・金属製グレーチング等の中古品は、相手の氏名と確認の方法を入れるまで「相手確認が未入力」と表示します。CSV・Excelは古物台帳の項目(受入れ・払出し)の順で書き出します。「出品中」の行にヤフオク終了日時を入れると「終了が近い順」に並び、2時間前から色が付きます。通知をオンにすると、このアプリのページを開いている間、終了60分前にお知らせします(ヤフオク・Amazonへの自動アクセスはしません)。データはこの端末のブラウザの中にあります。無料プランでは、機種変更の前に書き出してください。</p>
</div>"""
out = head("古物台帳", "仕入れた品を自動で記録する古物台帳。状態(仕入れ済→入庫→出品中→売約→発送済)を1クリックで進め、売れたら売却日・売値・相手を自動で記入。CSV・Excelで書き出し。",
           "daicho/", "../", 'data-page="daicho"')
out += header("../", "daicho", "ledger") + crumb("../", "台帳") + f'<main class="wrap">\n{LEDGER_BODY}\n</main>\n' + footer("../", ["calc.js", "ui.js", "ledger.js"])
write("daicho", out)

# ------------------------------------------------------------------
# トップ
# ------------------------------------------------------------------
fee_rows = "\n".join(
    f'      <li><a href="{esc(s["url"])}" target="_blank" rel="noopener">{esc(s["topic"])}</a>' + (f' <small>{esc(s["note"])}</small>' if s.get("note") else "") + "</li>"
    for s in FEES["sources"])

TOP_ROUTES = [
    ("rakuten-amazon", "楽天・Yahoo!→Amazon", "楽天市場・Yahoo!ショッピング", "Amazon(FBA)", "新品", "不要", "販売手数料・FBA・ポイント"),
    ("muzaiko-amazon", "無在庫 Amazon中古", "ヤフオク(売れてから)", "Amazon(中古・自己発送)", "中古", "必要", "販売手数料・発送代行"),
    ("mercari-calc", "メルカリ", "不用品・少額の仕入れ", "メルカリ", "新品・中古", "不用品は不要", "10%・メルカリ便"),
    ("yahuoku-mercari", "ヤフオク→メルカリ", "Yahoo!オークション", "メルカリ・ヤフオク", "中古", "必要", "10%・送料・まとめ落札"),
    ("auction-mercari", "業者オークション", "古物市場(エコオク・大吉 等)", "メルカリ・ヤフオク", "中古・ブランド", "必要", "落札手数料・参加費"),
]
route_rows = "\n".join(
    f'<tr data-href="{slug}/"><td><a href="{slug}/">{name}</a></td><td>{src}</td><td>{dst}</td><td>{kind}</td><td>{lic}</td><td>{fee}</td></tr>'
    for slug, name, src, dst, kind, lic, fee in TOP_ROUTES)

Q = [
    ("cap", "仕入れに使えるお金", [("low", "5万円未満"), ("mid", "5〜30万円"), ("high", "30万円以上")]),
    ("time", "1日に使える時間", [("short", "1時間未満"), ("mid", "1〜3時間"), ("long", "3時間以上")]),
    ("lic", "古物商許可", [("yes", "持っている"), ("plan", "取る予定"), ("no", "持っていない")]),
    ("risk", "在庫・値下がりのリスク", [("low", "小さく"), ("mid", "ほどほど"), ("high", "大きめでもよい")]),
    ("kind", "扱いたい物", [("new", "新品"), ("used", "中古"), ("both", "どちらでも")]),
    ("where", "仕入れの場所", [("net", "ネットだけ"), ("store", "お店・市場にも行ける")]),
]
q_rows = "\n".join(
    f'<tr><th scope="row">{label}</th><td>' + "".join(f'<label class="rd"><input type="radio" name="{k}" value="{v}">{t}</label>' for v, t in opts) + "</td></tr>"
    for k, label, opts in Q)

TOP_BODY = f"""<div class="lay2">
  <aside class="side" aria-label="メニュー">
    <div class="sbox"><p class="sbox-t">台帳の状況</p><div class="sbox-b" id="top-ledger"></div></div>
    <div class="sbox"><p class="sbox-t">料金</p><div class="sbox-b">
      <table class="kv"><tr><th>無料</th><td>0円・登録不要</td></tr><tr><th>スタンダード</th><td>月{yen(P_SM)}(税込)<br>14日間無料<span data-bill="prep">・準備中</span></td></tr><tr><th>先着100名</th><td>月{yen(P_FM)}<br>途中で上がりません</td></tr></table>
      <p class="row-links"><a href="plans/" data-bill="ready">14日間無料で始める</a><a data-mail="prereg" href="#" data-bill="prep">事前登録(無料)</a><a href="plans/">料金の詳しい説明</a></p>
    </div></div>
    <div class="sbox"><p class="sbox-t">週刊メルマガ(無料)</p><div class="sbox-b"><p class="hint">手数料の改定、ポイントの日程、台帳の付け方を週1回。</p><p class="row-links"><a data-mail="news" href="#">メール1通で登録</a></p></div></div>
  </aside>

  <section class="res">
    <h1 class="pg-h">せどりの利益計算と、古物台帳の自動記録</h1>
    <div class="out-box" id="intro">
      <p>仕入れ先と売り先を選ぶと、手数料・送料・ポイントを引いた利益と、目標の利益を残せる販売価格・仕入れ値の上限が出ます。「仕入れた」を押すと古物台帳に1行入り、「売れた」で売却の欄が埋まります。</p>
      <ul class="memo">
        <li>5つの仕入れルートに対応。業者オークションの参加費や、まとめ落札の1個あたりの原価も計算</li>
        <li>台帳は古物台帳の項目と列の順。相手確認が未入力の行には印。CSV・Excelで書き出し</li>
        <li>無料・登録なし。入れた内容はこの端末の中だけに保存</li>
      </ul>
      <div class="row-btns"><a class="btn" href="#shindan-sec">合うルートを診断する(6問)</a><a class="btn ghost" href="daicho/">台帳を開く</a></div>
    </div>

    <h2 class="sec-h">仕入れ先と売り先で選ぶ</h2>
    <div class="gridwrap"><table class="grid nimg rt" id="route-grid">
      <thead><tr><th>ページ</th><th>仕入れ先</th><th>売り先</th><th>商品</th><th>古物商許可</th><th>計算する手数料</th></tr></thead>
      <tbody>{route_rows}</tbody>
    </table></div>

    <h2 class="sec-h">今日のポイント高還元(楽天) <small id="today-time"></small></h2>
    <div class="gridwrap"><table class="grid mc" id="today-grid">
      <thead><tr><th class="c-img"></th><th>商品名</th><th class="r">価格</th><th class="r c-pt">ポイント</th><th class="c-fee">期限</th><th></th></tr></thead>
      <tbody id="today-rows"><tr><td colspan="6" class="empty">読み込み中</td></tr></tbody>
    </table></div>
    <p class="credit">楽天市場の公式APIで毎朝取得した見本です。Amazonで売れるかは判定していません。PR: 商品へのリンクは楽天アフィリエイトのリンクです(価格は変わりません)。<a href="https://developers.rakuten.com/" target="_blank" rel="noopener">Supported by Rakuten Developers</a></p>

    <h2 class="sec-h" id="shindan-sec">合うやり方の診断(6問)</h2>
    <form id="shindan" class="qtab">
      <table class="kv wide">{q_rows}</table>
      <div class="row-btns"><button class="btn pri" type="submit">診断する</button><span class="hint">収入の見込みを示すものではありません。答えはこの端末の中だけで使います。</span></div>
    </form>
    <div id="shindan-out" class="out-box" hidden aria-live="polite"></div>

    <h2 class="sec-h" id="plans">料金とプラン</h2>
    <p>無料 0円/スタンダード <b>月{yen(P_SM)}</b>(先着100名は月{yen(P_FM)})/業務 月{yen(P_BM)}(予定)。すべて税込。スタンダードは14日間無料で、お支払いはPayPalです。<span data-bill="prep">いまは準備中です。</span></p>
    <div class="gridwrap"><table class="grid nimg cmp" style="min-width:600px">
      <thead><tr><th></th><th>無料(いま使えます)</th><th>スタンダード<span data-bill="prep">(準備中)</span></th><th>業務(受付前)</th></tr></thead>
      <tbody>
        <tr><th>料金(税込)</th><td>0円・登録不要</td><td><b>月{yen(P_SM)}</b>・年{yen(P_SY)}<br>先着100名は月{yen(P_FM)}・年{yen(P_FY)}</td><td>月{yen(P_BM)}・年{yen(P_BY)}(予定)</td></tr>
        <tr><th>無料期間</th><td>—</td><td>14日(終わると自動で有料)</td><td>14日</td></tr>
        <tr><th>計算ページ</th><td>5つすべて・回数制限なし</td><td>同じ</td><td>同じ</td></tr>
        <tr><th>台帳</th><td>この端末に保存・行数の制限なし・CSV・Excel</td><td>クラウドに保存し、パソコンとスマホで同じ台帳。3年分を保管</td><td>作業する人3人まで・提出用のPDF・変更の記録</td></tr>
        <tr><th>楽天の検索</th><td>1日20回</td><td>制限なし</td><td>制限なし</td></tr>
        <tr><th>ウォッチ</th><td>保存・CSV</td><td>価格・ポイントの再確認、出品者数の変化の記録※</td><td>同じ</td></tr>
        <tr><th>まとめて計算</th><td>—</td><td>JANを一括で計算(CSV)</td><td>同じ</td></tr>
        <tr><th>発送代行</th><td>自分で発送との切り替えで計算</td><td>同じ</td><td>入庫予定・出荷依頼のCSVを台帳から作成</td></tr>
        <tr><th>解約</th><td>—</td><td colspan="2">マイページの「契約内容」→「解約について」から、いつでも。PayPalの自動支払いの管理、メール1通でも解約できます。無料期間中の解約は0円。無料期間の終了3日前にメールでお知らせ</td></tr>
      </tbody>
    </table></div>
    <p class="hint"><span data-bill="prep">有料版のお申し込みはまだ受け付けていません。準備ができたら、事前登録の方へ順にメールでご案内します(登録しても料金は発生しません)。</span>先着100名の価格は、お申し込みの順に100名までで、続けている間は上がりません。※価格データのサービスのAPIキーをお持ちの場合。</p>
    <p class="row-links"><a class="btn" href="plans/" data-bill="ready">14日間無料で始める</a><a data-mail="prereg" href="#" data-bill="prep">事前登録(メール1通・無料)</a><a href="plans/">料金とお申し込みの条件</a><a href="../tokushoho.html">特定商取引法に基づく表記</a></p>

    <h2 class="sec-h" id="faq">よくある質問</h2>
    <div class="faq">
      <details><summary>無料でどこまで使えますか。</summary><p>5つの計算ページと台帳は、無料・回数制限なし・登録なしで使えます。楽天の検索は1日20回までで、楽天の開発者サイトでご自身の無料IDを取っていただきます。</p></details>
      <details><summary>いま使っている出品・価格改定の道具と一緒に使えますか。</summary><p>使えます。このアプリは出品や価格改定はしません。仕入れる前の計算と、仕入れた後の古物台帳を受け持ちます。</p></details>
      <details><summary>入れたデータはどこに保存されますか。</summary><p>無料版は、この端末のブラウザの中だけです。当方のサーバーには送られません。ブラウザのデータを消すと台帳も消えるので、CSV・Excelで書き出してください。スタンダードでログインすると台帳をクラウド(Google Cloud の東京リージョン)にも保存しますが、当方は中身を見ず、使いません(<a href="privacy/">プライバシーポリシー</a>)。解約後も3年間は保管し、マイページから書き出せます。</p></details>
      <details><summary>Amazonの価格はどう入れますか。</summary><p>「Amazonで見る」で価格を確かめて入れてください。価格データのサービスのAPIキーをお持ちなら、設定に入れると自動で入ります。そのサービスの料金と利用条件は、そのサービスとのご契約になります。</p></details>
      <details><summary>メルカリやヤフオクの価格を自動で取れませんか。</summary><p>取りません。各サービスの規約で自動アクセスが制限されているためです。検索バーで各サイトの検索ページを開き、見た価格を入れてください。</p></details>
      <details><summary>台帳はどう使いますか。</summary><p>計算ページで「仕入れた」を押すと1行できます。台帳では状態を1クリックで進め、「売れた」で売却日・売値・相手が入ります。1万円以上の中古品などは、相手確認を入れるまで印が付きます。</p></details>
      <details><summary>計算は正確ですか。</summary><p>公開されている料金表で計算し、手計算の例で検算していますが、目安です。在庫保管手数料・返品・値下がりは含みません。</p></details>
      <details><summary>有料版はいつから使えますか。</summary><p><span data-bill="prep">準備ができたら、事前登録の方へメールでご案内します。</span><span data-bill="ready">いまから使えます。</span>料金・支払い・解約の条件は<a href="plans/">料金ページ</a>と<a href="../tokushoho.html">特定商取引法に基づく表記</a>に載せています。</p></details>
      <details><summary>解約はどうしますか。</summary><p>マイページの「契約内容」にある「解約について」を開き、「解約する」を押して確認すると完了します。PayPalの自動支払いの管理画面から止めることも、メール1通でのお申し出もできます。次回の請求日の前日までに解約すれば、次回からは請求されません。</p></details>
    </div>

    <h2 class="sec-h" id="fees">手数料・送料の出典(確認日 <!--CHECKED-->{FEES['checked_label']}<!--/CHECKED-->)</h2>
    <p class="hint">計算に使う数値は <a href="data/fees.json">fees.json</a> にまとめています。Amazonの販売手数料は税抜(計算で消費税10%を足す)、FBA・メルカリ・Yahoo!オークションは税込。Amazonの公式ページは確認環境から開けなかったため、2026年4月改定を反映した複数の記事の一致で確認しています。</p>
    <ul class="srcs">
      <!--FEES-->
{fee_rows}
      <!--/FEES-->
    </ul>
  </section>
</div>"""

out = head("せどり 利益チェック", "楽天・Yahoo!・ヤフオク・業者オークションで仕入れて、Amazon・メルカリで売る時の手数料・送料・ポイント込みの利益を一覧で計算。仕入れると古物台帳に自動で記録。無料・登録不要。",
           "", "./", 'data-page="top"')
out += header("./", "", "rakuten") + crumb("./", None) + f'<main class="wrap">\n{TOP_BODY}\n</main>\n' + footer("./", ["calc.js", "ui.js", "top.js", "shindan.js"])
write("", out)

# ------------------------------------------------------------------
# 料金とお申し込み(/sedori/plans/)。特商法(2022年改正)の最終確認画面の表示事項を、ボタンと同じ画面に置く
# ------------------------------------------------------------------
PLAN_ROWS = [
    # key, プラン, 支払い, 価格(税込), 補足, 先着
    (k, c["name"], "年払い" if c["cycle"] == "year" else "月払い", yen(c["price"]),
     ("毎年。月あたり" + per_month(k) + (f"(月払いより{SAVE_MONTHS}か月分安い)" if not c.get("founder") else "") if c["cycle"] == "year" else "毎月") + ("。続けている間は上がりません" if c.get("founder") else ""),
     bool(c.get("founder")))
    for k, c in CAT.items() if c.get("open", True)
]
plan_pick = "\n".join(
    f'<tr data-plan="{k}"{" data-founder" if f else ""}><td class="pk"><input type="radio" name="plan" value="{k}" id="pl-{k}"{" checked" if k == "standard_month" else ""}></td>'
    f'<td><label for="pl-{k}"><b>{n}</b><span class="meta">{c}</span></label></td><td class="r"><span class="yen">{p.replace("円", "")}<i>円</i></span><span class="meta">{"/月" if c == "月払い" else "/年"}(税込)</span></td><td class="note2">{note}</td></tr>'
    for k, n, c, p, note, f in PLAN_ROWS) + \
    f'<tr class="off"><td class="pk"><input type="radio" disabled aria-label="業務(受付前)"></td><td><b>業務</b><span class="meta">月払い・年払い</span></td><td class="r"><span class="yen">{P_BM:,}<i>円</i></span><span class="meta">/月(予定)</span></td><td class="note2">受付前。発送代行の連携・作業者3人・提出用PDF。機能ができてから販売します</td></tr>'

PLANS_BODY = """<div class="pl">
  <h1 class="pg-h">料金とお申し込み</h1>
  <p class="pl-lead">計算と、この端末に保存する台帳は、無料・登録なしで使えます。スタンダードは、台帳をクラウドに保存してパソコンとスマホで同じ台帳を使う人向けです。<b>14日間は無料</b>で、終わると自動で有料になります。</p>
  <div class="pl-grid">
    <section class="pl-main pl-a" aria-label="プランを選ぶ">
      <h2 class="sec-h">1. プランを選ぶ</h2>
      <div class="gridwrap"><table class="grid nimg pick" id="pl-pick">
        <thead><tr><th class="pk"></th><th>プラン</th><th class="r">価格(税込)</th><th>支払い</th></tr></thead>
        <tbody>""" + plan_pick + """</tbody>
      </table></div>
      <p class="hint" id="pl-founder-note">先着100名の価格は、お申し込み(無料期間の始まり)の順に100名までです。<span id="pl-founder-left"></span></p>
    </section>
    <section class="pl-b" aria-label="使えるようになること">

      <h2 class="sec-h">2. 使えるようになること(分量)</h2>
      <div class="gridwrap"><table class="grid nimg cmp">
        <thead><tr><th></th><th>無料</th><th>スタンダード<span class="meta">先着100名の価格も同じ中身</span></th></tr></thead>
        <tbody>
          <tr><th>台帳</th><td>この端末に保存</td><td><b>クラウドに保存</b>し、パソコン・スマホ・タブレットで同じ台帳(1アカウント・端末数の制限なし・行数の制限なし)。解約後も3年間保管</td></tr>
          <tr><th>計算ページ</th><td>5つすべて</td><td>同じ</td></tr>
          <tr><th>楽天の検索</th><td>1日20回</td><td>制限なし</td></tr>
          <tr><th>設定</th><td>この端末だけ</td><td>目標の利益・発送のしかた・発送代行の費用を端末間で揃える</td></tr>
          <tr><th>無在庫の見張り</th><td>終了が近い順・60分前の通知</td><td>同じ(他の端末で入れた終了日時も届く)</td></tr>
          <tr><th>今後の追加</th><td>—</td><td>ウォッチの再確認、JANの一括計算、ポイントの上限枠、バーコード読み取り(できたものから順に。料金は変わりません)</td></tr>
        </tbody>
      </table></div>
      <p class="hint">ログインと保存の方法: メールのリンクかGoogleアカウントでログイン。台帳は Google Cloud(東京リージョン)に保存し、ログインした本人だけが読み書きできます。当方は中身を見ません(<a href="../privacy/">プライバシーポリシー</a>)。</p>
    </section>

    <aside class="pl-conf" aria-label="お申し込み内容の確認">
      <div class="conf-in">
        <h2 class="conf-h">お申し込み内容の確認</h2>
        <table class="kv conf" id="pl-conf">
          <tr><th>プラン</th><td id="cf-plan">スタンダード(月払い)</td></tr>
          <tr><th>分量</th><td>台帳のクラウド保存と端末間の同期(1アカウント)、楽天の検索 制限なし、設定の同期。左の「2. 使えるようになること」のとおり</td></tr>
          <tr><th>価格(税込)</th><td><b id="cf-price">月""" + yen(P_SM) + """</b><span class="meta">これ以外の費用はかかりません(通信費を除く)</span></td></tr>
          <tr><th>無料期間</th><td><b id="cf-trial">お申し込みの日から14日間</b></td></tr>
          <tr><th>支払いの時期</th><td id="cf-when">無料期間が終わる日に1回目、以後は毎月同じ日に、自動で請求します(前払い)</td></tr>
          <tr><th>支払いの方法</th><td>PayPal(PayPal残高・PayPalに登録したクレジットカード・デビットカード・銀行口座)。お申し込みには支払い方法の登録が必要です</td></tr>
          <tr><th>使える時期</th><td>PayPalでの手続きが終わった時から、すぐ(無料期間中も同じ機能)</td></tr>
          <tr><th>申込みの期間</th><td id="cf-period">期限はありません</td></tr>
          <tr><th>契約の期間</th><td id="cf-term">1か月ごとに自動で更新。解約するまで続きます</td></tr>
          <tr><th>解約の方法</th><td>マイページの「契約内容」にある「解約について」を開き、「解約する」を押して確認すると完了します(同じ画面に一時停止・プラン変更のご案内があります)。PayPalの「自動支払い」の管理画面から止めることも、メール(<a href="mailto:zeroichi.works.jp@gmail.com">zeroichi.works.jp@gmail.com</a>)でのお申し出もできます</td></tr>
          <tr><th>解約の期限</th><td id="cf-deadline">次回の請求日の前日までに解約すれば、次回からは請求しません。無料期間中に解約すれば0円です</td></tr>
          <tr><th>返金</th><td>支払い済みの期間の途中で解約しても、日割りの返金はありません。その期間の終わりまで使えます。当方の不具合で使えなかった期間は返金します</td></tr>
          <tr><th>解約後の台帳</th><td>クラウドの台帳は解約から3年間保管し、マイページから書き出せます(古物台帳は3年間の保存が必要なため)。ご自身でいつでも消せます</td></tr>
        </table>
        <div class="trial-box" id="cf-trialbox">
          <p><b id="cf-t1">今日から14日間は無料です。</b></p>
          <p id="cf-t2">無料期間が終わる日に、1回目の""" + yen(P_SM) + """(税込)をPayPalで自動でお支払いいただき、以後は毎月同じ日に請求します。無料期間の終了3日前に、メールでお知らせします。</p>
        </div>
        <div class="pay" id="pl-pay">
          <div data-bill="prep">
            <p class="dlg-st">準備中</p>
            <p class="hint">お申し込みの受付はまだ始めていません。準備ができたら、事前登録の方へメールでご案内します(登録しても料金はかかりません)。</p>
            <a class="btn wide" data-mail="prereg" href="#">事前登録(メール1通・無料)</a>
          </div>
          <div data-bill="ready">
            <div id="pl-login"><button type="button" class="btn wide" id="pl-login-btn">ログインして申し込む</button><p class="hint">申し込むアカウントを決めるため、先にログインします(メールのリンクかGoogle)。</p></div>
            <div id="pl-buy" hidden>
              <p class="pay-who" id="pl-who"></p>
              <div id="pl-pp" class="pp"></div>
              <p class="hint">上の内容と<a href="../terms/">利用規約</a>・<a href="../privacy/">プライバシーポリシー</a>をご確認のうえ、PayPalの画面で「同意して続行」を押すとお申し込みが完了します。</p>
            </div>
            <div id="pl-has" hidden><p class="msg" id="pl-has-t"></p><a class="btn ghost wide" href="../mypage/">マイページで契約内容を見る</a></div>
          </div>
        </div>
      </div>
    </aside>
  </div>
</div>"""

out = head("料金とお申し込み", f"せどり 利益チェックの料金(無料/スタンダード 月{yen(P_SM)}・年{yen(P_SY)}/先着100名 月{yen(P_FM)}・年{yen(P_FY)})、14日間の無料期間、支払いの時期と方法、解約の方法。",
           "plans/", "../", 'data-page="plans"')
out += header("../", "plans", "rakuten") + crumb("../", "料金とお申し込み") + f'<main class="wrap">\n{PLANS_BODY}\n</main>\n' + footer("../", ["calc.js", "ui.js", "plans.js"])
write("plans", out)

# ------------------------------------------------------------------
# マイページ(/sedori/mypage/)
# ------------------------------------------------------------------
MYPAGE_BODY = """<div class="mp">
  <h1 class="pg-h">マイページ</h1>
  <div class="mp-grid">
    <nav class="mp-nav" aria-label="マイページの項目">
      <a href="#mp-account">アカウント</a><a href="#mp-plan">契約内容</a><a href="#cancel" class="sub">解約について</a><a href="#mp-data">台帳とデータ</a><a href="#mp-notify">通知</a>
    </nav>
    <div class="mp-main">
      <section id="mp-account" class="mp-sec">
        <h2 class="sec-h">アカウント</h2>
        <div data-acct="prep"><p class="dlg-st">準備中</p><p>ログインと台帳のクラウド保存は準備中です。計算と台帳は、このままログインなしで使えます(この端末に保存)。下の「台帳とデータ」から書き出しと、「通知」の設定ができます。</p></div>
        <div data-acct="ready">
          <div id="mp-out"><p>ログインすると、契約内容の確認と、台帳のクラウド保存の状態が見られます。</p><button type="button" class="btn" id="mp-login">ログイン</button></div>
          <div id="mp-in" hidden>
            <table class="kv wide"><tr><th>メールアドレス</th><td id="mp-email"></td></tr><tr><th>ログインの方法</th><td>メールのリンク・Google(パスワードは使いません)</td></tr></table>
            <div class="row-btns"><button type="button" class="btn sm ghost" id="mp-logout">ログアウト</button></div>
          </div>
        </div>
      </section>

      <section id="mp-plan" class="mp-sec">
        <h2 class="sec-h">契約内容</h2>
        <div id="mp-plan-box"><p class="muted">ログインすると表示します。</p></div>
        <details class="mp-cancel" id="cancel">
          <summary>解約について</summary>
          <div class="mp-cancel-b" id="mp-cancel-b">
            <p>いつでも解約できます。次回の請求日の前日までに解約すれば、次回からは請求しません(無料期間中なら0円)。解約の前に、次の方法もあります。</p>
            <div class="alt" id="mp-alt"></div>
            <h3>解約する前に: 台帳を書き出す</h3>
            <p class="hint">古物台帳は、最後の記入から3年間の保存が必要です。解約後もクラウドの台帳は3年間保管し、ここから書き出せますが、手元にも残しておくと安心です。</p>
            <div class="row-btns"><button type="button" class="btn sm ghost" data-exp="csv">CSVで書き出す</button><button type="button" class="btn sm ghost" data-exp="xlsx">Excelで書き出す</button></div>
            <h3>解約する</h3>
            <div id="mp-cancel-do"></div>
            <h3>ほかの解約の方法</h3>
            <ul class="steps">
              <li>PayPalから: PayPalにログイン → 右上の歯車(設定) → 「支払い」 → 「自動支払いを管理」 → 「ZEROICHI WORKS」 → 「キャンセル」。マイページの表示にも数分で反映されます。</li>
              <li>メールで: <a href="mailto:zeroichi.works.jp@gmail.com?subject=%E3%81%9B%E3%81%A9%E3%82%8A%E3%82%A2%E3%83%97%E3%83%AA%E8%A7%A3%E7%B4%84">zeroichi.works.jp@gmail.com</a> へ、ログインに使うメールアドレスから「解約」とお送りください。受け取った日に解約の手続きをします。</li>
            </ul>
          </div>
        </details>
      </section>

      <section id="mp-data" class="mp-sec">
        <h2 class="sec-h">台帳とデータ</h2>
        <table class="kv wide" id="mp-data-t"></table>
        <div class="row-btns"><button type="button" class="btn sm" data-exp="xlsx">Excelで書き出す</button><button type="button" class="btn sm ghost" data-exp="csv">CSVで書き出す</button><button type="button" class="btn sm ghost" id="mp-cloud-exp" hidden>クラウドの台帳を書き出す</button><button type="button" class="btn sm ghost" id="mp-sync" hidden>今すぐ同期</button></div>
        <p class="hint" id="mp-keep">保管の期間: 契約中はずっと。解約後は3年間保管し、その後に消します。ご自身で消した時は、すぐ消します。</p>
        <details class="mp-danger" id="mp-del" hidden>
          <summary>クラウドの台帳・アカウントを消す</summary>
          <div class="mp-danger-b">
            <p>クラウドの台帳を消すと元に戻せません。古物台帳は3年間の保存が必要なので、先に書き出してください。</p>
            <label class="ck"><input type="checkbox" id="mp-del-local">この端末の台帳も消す</label>
            <div class="row-btns"><input type="text" id="mp-del-word" placeholder="「消す」と入力" aria-label="確認のため「消す」と入力"><button type="button" class="btn sm danger" id="mp-del-cloud">クラウドの台帳を消す</button><button type="button" class="btn sm danger ghost" id="mp-del-acct">アカウントを削除</button></div>
            <p class="hint">アカウントの削除は、解約が済んでからできます。</p>
          </div>
        </details>
      </section>

      <section id="mp-notify" class="mp-sec">
        <h2 class="sec-h">通知</h2>
        <table class="kv wide"><tr><th>ヤフオクの終了60分前</th><td><button type="button" class="btn sm ghost tg" id="lg-notify" aria-pressed="false">終了60分前の通知: オフ</button><p class="hint">台帳で「出品中」の行にヤフオクの終了日時を入れると、60分前に「Amazonの在庫を0にしてください」と通知します。このアプリのページ(どれでも)を開いている間だけ届きます。ヤフオク・Amazonへの自動アクセスはしません。</p></td></tr></table>
      </section>
    </div>
  </div>
</div>"""

out = head("マイページ", "ログイン、契約内容、台帳のクラウド保存と書き出し、通知の設定。", "mypage/", "../", 'data-page="mypage"')
out = out.replace('<meta name="description"', '<meta name="robots" content="noindex">\n<meta name="description"', 1)
out += header("../", "mypage", "ledger") + crumb("../", "マイページ") + f'<main class="wrap">\n{MYPAGE_BODY}\n</main>\n' + footer("../", ["calc.js", "ui.js", "mypage.js"])
write("mypage", out)


# ------------------------------------------------------------------
# 利用規約・プライバシーポリシー
# ------------------------------------------------------------------
def doc_page(slug: str, title: str, desc: str, body: str) -> None:
    o = head(title, desc, f"{slug}/", "../", f'data-page="{slug}"')
    o += header("../", slug, "rakuten") + crumb("../", title) + f'<main class="wrap">\n<article class="docx">\n{body}\n</article>\n</main>\n' + footer("../", ["calc.js", "ui.js"])
    write(slug, o)


TERMS = """<h1>利用規約(せどり 利益チェック)</h1>
<p class="muted">制定日 2026年10月27日</p>
<p>この規約は、ZEROICHI WORKS(以下「当方」)が提供する「せどり 利益チェック」(以下「本サービス」)の利用条件です。本サービスを使う方(以下「利用者」)は、この規約に同意したうえで使ってください。有料プランは、ログインしてお申し込みいただいた時に、この規約に同意したものとします。</p>

<h2>第1条(本サービスの内容)</h2>
<ol>
<li>本サービスは、仕入れと販売の手数料・送料・ポイントを含めた利益の計算、古物台帳の項目に沿った記録(以下「台帳」)、その書き出しを行うウェブアプリです。</li>
<li>無料プランでは、計算と台帳を、利用者の端末のブラウザの中に保存して使えます。登録は要りません。</li>
<li>有料プラン(スタンダード)では、無料プランの機能に加えて、台帳をクラウドに保存し、複数の端末で同じ台帳を使えます。中身と料金は<a href="../plans/">料金ページ</a>と<a href="../../tokushoho.html">特定商取引法に基づく表記</a>のとおりです。</li>
</ol>

<h2>第2条(アカウント)</h2>
<ol>
<li>有料プランを使うには、メールのリンクかGoogleアカウントでログインします。1人1アカウントで、他人と共有しないでください。</li>
<li>ログインに使うメールアカウント・Googleアカウントは、利用者の責任で管理してください。第三者に使われたことによる損害について、当方の故意または重過失による場合を除き、当方は責任を負いません。</li>
</ol>

<h2>第3条(料金と支払い)</h2>
<ol>
<li>有料プランの料金(税込)、支払いの時期と方法は、料金ページのお申し込み内容の確認に表示したとおりです。支払いはPayPalのサブスクリプション(自動の定期支払い)で行います。</li>
<li>有料プランには14日間の無料期間があります。無料期間が終わる日に1回目の料金を請求し、以後は月払いなら毎月、年払いなら毎年、同じ日に自動で請求します(前払い)。無料期間中に解約した場合、料金はかかりません。</li>
<li>先着100名の価格は、お申し込みの順に100名までに適用し、その契約が続いている間は上げません。解約後に申し込み直した場合は、その時の価格になります。</li>
<li>支払いが確認できない時は、当方は有料プランの機能(クラウドへの保存)を止めることがあります。その間も、保存済みの台帳の閲覧と書き出しはできます。</li>
</ol>

<h2>第4条(解約)</h2>
<ol>
<li>利用者は、いつでも解約できます。方法は、マイページの「契約内容」にある「解約について」から「解約する」を押して確認する方法、PayPalの自動支払いの管理画面から止める方法、メールで申し出る方法のいずれかです。</li>
<li>次回の請求日の前日までに解約すれば、次回からは請求しません。支払い済みの期間の途中で解約しても日割りの返金はなく、その期間の終わりまで有料プランを使えます。</li>
<li>当方の不具合で有料プランを使えなかった期間があるときは、その分を返金します。</li>
</ol>

<h2>第5条(一時停止とプランの変更)</h2>
<ol>
<li>利用者は、マイページから契約を1か月間一時停止できます。停止中は請求せず、クラウドへの保存は止まります(保存済みの台帳の閲覧と書き出しはできます)。1か月たつと自動で再開し、再開した日から請求を再開します。再開の日より前にマイページから再開することもできます。</li>
<li>月払いと年払いの切り替えなどのプランの変更は、マイページから行い、PayPalの画面での承認をもって変わります。</li>
</ol>

<h2>第6条(台帳のデータ)</h2>
<ol>
<li>台帳に入れたデータは利用者のものです。当方は、保存・同期・書き出しのために必要な範囲でだけ扱い、中身を見たり、ほかの目的に使ったりしません。</li>
<li>クラウドの台帳は、契約中は保管し、解約(支払い済みの期間の終わり)から3年間保管したあと消します。この間は、ログインしてマイページから書き出せます。利用者がマイページで消した時は、すぐ消します。</li>
<li>端末のブラウザの中のデータは、当方は保管していません。ブラウザのデータを消すと消えるので、利用者が書き出して保管してください。</li>
</ol>

<h2>第7条(古物台帳と法令)</h2>
<ol>
<li>本サービスの台帳は記録の入れ物で、古物営業法その他の法令に合っているかどうかの判断はしません。帳簿の記載事項・保存・本人確認などの義務は、古物商である利用者が負います。必要な項目は所轄の警察署で確認してください。</li>
<li>利用者は、取引相手の個人情報を、法令に従って取得し、台帳に入れてください。</li>
<li>本サービスは、Yahoo!オークション・メルカリ・Amazonなどのページを自動で読み取りません。各サービスの規約は利用者が守ってください。</li>
</ol>

<h2>第8条(禁止事項)</h2>
<p>次のことをしないでください。法令や公序良俗に反すること/他人のアカウントを使うこと/本サービスの仕組みに過大な負荷をかけること、不正にアクセスすること/盗品など不正な品の取引の記録・隠ぺいに使うこと/本サービスを当方の許可なく再販売すること。</p>

<h2>第9条(計算と情報の扱い)</h2>
<ol>
<li>計算は、公開されている料金表をもとにした参考の値(目安)です。利益・販売・仕入れの結果を保証しません。手数料・送料は変わることがあるので、確認日と出典を見て、各サービスで確かめてください。</li>
<li>CSV・Excelの取り込み、貼り付けた文字からの項目の取り出しなど、データの取り込みは、利用者が自分で行い、取り込んだ内容を利用者が確かめて確定するものです。当方はデータの移し替えの代行(移行代行)は行いません。</li>
<li>取り込んだデータ・利用者が入れたデータの誤りや抜け、およびそれにもとづく税務・法令上の結果(確定申告・古物台帳の記載など)について、当方は責任を負いません。申告や警察への提出などに使う前に、利用者が内容を確かめてください。</li>
</ol>

<h2>第10条(サービスの変更・停止)</h2>
<ol>
<li>当方は、機能を追加・変更することがあります。有料プランの機能を減らす時や、料金を変える時は、30日前までにメールとこのページでお知らせします。</li>
<li>設備の保守・障害・天災などで、本サービスを止めることがあります。本サービスをやめる時は、90日前までにお知らせし、台帳を書き出せる期間を設けます。</li>
</ol>

<h2>第11条(責任の範囲)</h2>
<ol>
<li>当方は、本サービスに不具合がないこと、特定の目的に合うことを保証しません。</li>
<li>当方の責任による損害は、当方に故意または重過失がある場合を除き、損害が生じた月に利用者が支払った有料プランの料金の額を上限とします。軽過失の場合に限り、この上限を適用します。</li>
</ol>

<h2>第12条(規約の変更)</h2>
<p>当方は、民法の定めに従い、この規約を変えることがあります。変える時は、変更の内容と効力が生じる日を、その日より前にこのページとメールでお知らせします。</p>

<h2>第13条(準拠法・管轄)</h2>
<p>この規約は日本の法律に従います。本サービスについて争いが生じた時は、当方の所在地を管轄する地方裁判所を第一審の専属的合意管轄裁判所とします。ただし、利用者が消費者である場合は、法令の定めに従います。</p>

<h2>お問い合わせ</h2>
<p>ZEROICHI WORKS(事業者の名前・連絡先は<a href="../../tokushoho.html">特定商取引法に基づく表記</a>をご覧ください)/<a href="mailto:zeroichi.works.jp@gmail.com">zeroichi.works.jp@gmail.com</a></p>"""

PRIVACY = """<h1>プライバシーポリシー(せどり 利益チェック)</h1>
<p class="muted">制定日 2026年10月27日</p>
<p>ZEROICHI WORKS(以下「当方」)は、「せどり 利益チェック」(以下「本サービス」)で扱う個人情報を、次のとおり取り扱います。事業者の氏名・住所等は<a href="../../tokushoho.html">特定商取引法に基づく表記</a>に載せています。</p>

<h2>1. 扱う情報</h2>
<table class="legal-t">
<tr><th>アカウント</th><td>メールアドレス。Googleでログインした場合はGoogleアカウントのメールアドレスと識別子(パスワードは当方に届きません)</td></tr>
<tr><th>台帳(スタンダード)</th><td>利用者が入れた仕入れ・売却の記録。取引相手の氏名・住所・電話・メール・職業・年齢・確認の方法など、古物台帳の項目を含みます</td></tr>
<tr><th>設定(スタンダード)</th><td>目標の利益、発送のしかた、発送代行の費用</td></tr>
<tr><th>契約</th><td>PayPalのサブスクリプションID、プラン、契約の状態、無料期間の終わり・次回の請求日。カード番号・口座番号は当方に届かず、PayPalが扱います</td></tr>
<tr><th>お問い合わせ</th><td>メールでいただいた内容</td></tr>
<tr><th>端末の中だけの情報</th><td>無料プランの台帳、入力した値、楽天・Keepaのキーは、利用者の端末のブラウザの中だけに保存し、当方には送られません</td></tr>
</table>

<h2>2. 利用目的</h2>
<ol>
<li>ログインと、台帳・設定のクラウドへの保存・端末間の同期・書き出しのため</li>
<li>契約の管理(お申し込み・無料期間の終了のお知らせ・請求・一時停止・解約)のため</li>
<li>お問い合わせへの返事、料金や規約の変更などの大切なお知らせのため</li>
<li>不正な利用を防ぐため</li>
</ol>
<p><b>台帳の中身は、上の1のためだけに扱います。</b>当方は台帳の中身を見たり、分析・営業・広告・AIの学習などに使ったりしません。障害の調査などで中身を見る必要が出た時は、事前に利用者の同意を得た範囲に限ります。</p>

<h2>3. 第三者への提供の制限</h2>
<ol>
<li>当方は、法令に基づく場合などを除き、本人の同意なく個人情報を第三者に提供しません。</li>
<li><b>クラウドへの保存について</b>: 台帳と設定は、Google LLC の Firebase(Cloud Firestore)の東京リージョン(日本)に保存します。Googleは、当方との契約(データ処理の規約)に基づいてデータを保管するだけで、中身を取り扱いません。このため、個人情報保護委員会の考え方(いわゆるクラウド例外)に照らし、Googleへの「第三者提供」にはあたらないものとして扱い、当方が安全管理の責任を負います。</li>
<li>利用者が取引相手から得た個人情報について、当方は保管の場所を提供する立場で、その情報を取り扱いません。利用者の側でも、当方のクラウドに保存することは第三者への提供にあたらないものと考えています。</li>
<li>支払いはPayPal(PayPal Pte. Ltd.)、契約の状態の受け渡しは Cloudflare, Inc. の Workers、お知らせのメールの送信は Google(Gmail)を使います。これらに渡すのは、それぞれの目的に必要な情報(メールアドレス・契約の識別子など)だけで、台帳の中身は渡しません。</li>
</ol>

<h2>4. 安全管理のためにしていること</h2>
<ul>
<li>通信はすべて暗号化(HTTPS)します。保存したデータもGoogleの仕組みで暗号化されます。</li>
<li>データベースの規則で、ログインした本人だけが自分の台帳を読み書きできるようにしています。ほかの利用者からは見えません。契約の状態は、当方のサーバーだけが書き換えられます。</li>
<li>管理用のアカウントは2段階認証で守り、秘密の鍵は公開の場所に置きません。運営責任者1名だけが管理画面に入れます。</li>
<li>外国の制度: 利用するクラウド・決済の会社は米国・シンガポール等の事業者ですが、台帳の保存場所は日本です。</li>
<li>漏えいなどが起きた時は、法令に従って個人情報保護委員会への報告と本人への通知を行います。</li>
</ul>

<h2>5. 保存の期間</h2>
<table class="legal-t">
<tr><th>クラウドの台帳・設定</th><td>契約中は保管します。解約(支払い済みの期間の終わり)から<b>3年間</b>保管し、その後に消します。古物台帳は最後の記入から3年間の保存が必要なため、解約後もマイページから書き出せるようにしています。利用者がマイページで消した時は、すぐ消します</td></tr>
<tr><th>アカウント</th><td>アカウントを削除するまで(解約後、マイページから削除できます)</td></tr>
<tr><th>契約・請求の記録</th><td>税法などの法令で決められた期間(最長7年)</td></tr>
<tr><th>お問い合わせのメール</th><td>対応が終わってから1年</td></tr>
</table>

<h2>6. 開示・訂正・利用停止など</h2>
<p>ご本人の情報の開示・訂正・削除・利用停止のご請求は、ログインに使うメールアドレスから<a href="mailto:zeroichi.works.jp@gmail.com">zeroichi.works.jp@gmail.com</a>へご連絡ください。ご本人であることを確かめたうえで、遅くとも2週間以内に対応します。台帳の書き出しと削除は、マイページからいつでもできます。</p>

<h2>7. Cookie などの扱い</h2>
<p>ログインの状態と端末の中の台帳を保つため、ブラウザの保存領域(localStorage・IndexedDB)を使います。アクセス解析と広告のための仕組みは使っていません。お申し込みの画面ではPayPalの部品を読み込み、PayPalがCookieを使うことがあります(PayPalのプライバシーステートメントに従います)。</p>

<h2>8. このポリシーの変更</h2>
<p>内容を変える時は、このページでお知らせします。大きく変える時は、ログインに使うメールアドレスにもお知らせします。</p>

<h2>9. お問い合わせ</h2>
<p>ZEROICHI WORKS(事業者の名前・住所等は<a href="../../tokushoho.html">特定商取引法に基づく表記</a>)/<a href="mailto:zeroichi.works.jp@gmail.com">zeroichi.works.jp@gmail.com</a></p>"""

doc_page("terms", "利用規約", "せどり 利益チェックの利用規約(料金・無料期間・解約・台帳のデータ・古物台帳と法令)。", TERMS)
doc_page("privacy", "プライバシーポリシー", "せどり 利益チェックのプライバシーポリシー(利用目的・安全管理・第三者提供の制限とクラウドへの保存・解約後の保存期間)。", PRIVACY)


# ---- サイトマップ ----
# 手書きのページ(紹介・読み取り・手引き)もサイトマップに載せる(このスクリプトでは書き出さない)
HAND = [("lp/", "0.9"), ("scan/", "0.7"), ("guide/", "0.6"), ("guide/mercari-tesuryo/", "0.7"), ("guide/kobutsu-daicho-excel/", "0.7"), ("guide/honnin-kakunin/", "0.7"), ("guide/neduke/", "0.7")]
urls = [("", "0.9")] + [(f"{slug}/", "0.8") for slug, _ in ROUTES] + [("daicho/", "0.5")] + [(u, p) for u, p in HAND if (S / u / "index.html").exists()] + [("plans/", "0.6"), ("terms/", "0.2"), ("privacy/", "0.2")]
sm = "\n".join(f"<url><loc>{BASE_URL}{u}</loc><lastmod>{FEES['checked']}</lastmod><priority>{p}</priority></url>" for u, p in urls)
(S / "sitemap.xml").write_text(f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{sm}\n</urlset>\n', encoding="utf-8")
print("built", ["top"] + [slug for slug, _ in ROUTES] + ["daicho", "plans", "mypage", "terms", "privacy"])
