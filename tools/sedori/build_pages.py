"""せどり 利益チェック: 共通の頭(検索バー・目標の利益・メニュー)と足(法律と規約の注意)を付けて、全ページのHTMLを書き出す。

使い方: python3 tools/sedori/build_pages.py [公開フォルダ(既定 ../kt-zs-sedori-ghp)]
- 書き出すページ: トップ、5つの計算ページ、台帳(daicho)、料金とお申し込み(plans)、マイページ(mypage)、利用規約(terms)、プライバシーポリシー(privacy)、
  利益の仕組み(shikumi)、コンサル・スクールとの違い(chigai)。
- 手数料の出典一覧(トップの #fees)は sedori/data/fees.json から作る。
- 画面の部品は sedori/assets/ の ui.js(共通)・config.js(ログイン・お支払いの設定)・sync.js(同期の計算)・account.js(ログイン・同期)・ra.js・mz.js・market.js・ledger.js・top.js・plans.js・mypage.js・ai.js(AIに相談)。
"""
from __future__ import annotations

import html
import json
import pathlib
import sys

import os

ROOT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else pathlib.Path(__file__).resolve().parents[3] / "kt-zs-sedori-ghp")


def out_dir(root: pathlib.Path, env: dict | None = None) -> str:
    """書き出す先のフォルダの名前(公開フォルダの中)。tests/sedori/_dir.js と同じ決め方。
    1) 環境変数 SEDORI_OUT  2) sedori/MAINTENANCE.txt がある間(準備中)は、そこに書いてあるテスト用の写し  3) それ以外は sedori。
    準備中の間に sedori へ書こうとしたら止める(公開側の「準備中」を上書きしないため)。"""
    env = os.environ if env is None else env
    maint = root / "sedori" / "MAINTENANCE.txt"
    name = (env.get("SEDORI_OUT") or "").strip("/")
    if not name and maint.exists():
        m = _re.search(r"テスト用の写し\s*[:：]\s*/?([A-Za-z0-9_.-]+)/?", maint.read_text(encoding="utf-8"))
        if not m:
            raise SystemExit("sedori/MAINTENANCE.txt にテスト用の写しの場所がありません。SEDORI_OUT で書き出し先を指定してください")
        name = m.group(1)
    name = name or "sedori"
    if name == "sedori" and maint.exists():
        raise SystemExit("準備中(sedori/MAINTENANCE.txt あり)なので、公開側の sedori/ には書き出しません")
    return name


import re as _re
OUT = out_dir(ROOT)
S = ROOT / OUT
# テスト用の写し(sedori 以外)は、全ページを検索エンジンに載せない
NOINDEX = OUT != "sedori"
ROBOTS = '<meta name="robots" content="noindex,nofollow">'
FEES = json.loads((S / "data/fees.json").read_text(encoding="utf-8"))
VER = "20261030d"

_CONFIG = (S / "assets/config.js").read_text(encoding="utf-8")
# 料金は sedori/assets/config.js の PLAN_CATALOG だけで決める(/*PLANS*/ と /*/PLANS*/ の間の JSON)
CAT = json.loads(_re.search(r"/\*PLANS\*/(.*?)/\*/PLANS\*/", _CONFIG, _re.S).group(1))
# サイトの住所も config.js の SITE_URL だけで決める(独自ドメインに移す時はそこを直して、このスクリプトを流し直す)。
# ページ同士のリンクは相対で書くので、絶対の住所が要るのは canonical・OGP・サイトマップ・楽天の「許可するWebサイト」の案内だけ
# 年払いの決まりの文と、先着の価格の続く期間の言い方も config.js だけで決める(料金ページ・規約・Worker の YEAR_TEXT・特商法と同じ文)
YEAR_TEXT = _re.search(r'YEAR_TEXT:\s*"([^"]+)"', _CONFIG).group(1)
YEAR_DAYS = int(_re.search(r'YEAR_REFUND_DAYS:\s*(\d+)', _CONFIG).group(1))
FOUNDER_KEEP = _re.search(r'FOUNDER_KEEP:\s*"([^"]+)"', _CONFIG).group(1)
# 先着の定員(人数)も config.js の FOUNDER_LIMIT だけで決める(2026-10-28 オーナー決定で 200名)
FOUNDER_N = int(_re.search(r"FOUNDER_LIMIT:\s*(\d+)", _CONFIG).group(1))
FOUNDER = f"先着{FOUNDER_N}名"
# 有料版の受付開始日も config.js の PREREG の1行だけで決める。日付が決まっていない間(null)は日付を出さない
_PRE = _re.search(r'^\s*PREREG:\s*\{\s*open:\s*(null|"[^"]+"),\s*notice:\s*(null|"[^"]+")', _CONFIG, _re.M)
PREREG_OPEN, PREREG_NOTICE = (None if v == "null" else v.strip('"') for v in _PRE.groups())
if PREREG_OPEN:
    PRE_HEAD = f"有料版の受付は{PREREG_OPEN}から"
    PRE_SHORT = f"(受付は{PREREG_OPEN}から)"
    PRE_FAQ = (f"{PREREG_OPEN}から受け付けます。事前登録(メール1通・無料)の方へは、"
               f"{PREREG_NOTICE or '受付開始の前日'}にメールでご案内します。")
    PRE_PAY = f"お申し込みの受付は<b>{PREREG_OPEN}</b>からです。"
else:
    PRE_HEAD = "有料版の受付開始日は、決まりしだいこのページでお知らせします"
    PRE_SHORT = "(受付開始日は、決まりしだいこのページでお知らせします)"
    PRE_FAQ = "受付開始日は、決まりしだいこのページでお知らせします。事前登録(メール1通・無料)の方へは、受付が始まる前にメールでご案内します。"
    PRE_PAY = "有料版の受付開始日は、決まりしだいこのページでお知らせします。"
SITE_URL = _re.search(r'SITE_URL:\s*"([^"]+)"', _CONFIG).group(1).rstrip("/") + "/"
SITE_ORIGIN = _re.match(r"https?://[^/]+", SITE_URL).group(0)
BASE_URL = SITE_URL + "sedori/"


def yen(n: int) -> str:
    return f"{n:,}円"


def per_month(k: str) -> str:
    p = CAT[k]["price"]
    return ("約" if p % 12 else "") + f"{round(p / 12):,}円"


P_TM, P_TY, P_FM, P_FY, P_LM, P_LY, P_BM, P_BY = (CAT[k]["price"] for k in (
    "total_month", "total_year", "founder_month", "founder_year", "light_month", "light_year", "business_month", "business_year"))
LIGHT_LIMIT = int(_re.search(r"LIGHT_MONTHLY_LIMIT:\s*(\d+)", _CONFIG).group(1))
# 有料の機能ができたかどうか(config.js の FEATURES_READY)。できていない機能だけ「11月中に追加」と書く
_FR = _re.search(r"FEATURES_READY:\s*\{(.*?)\}", _CONFIG, _re.S).group(1)
READY = {k: v == "true" for k, v in _re.findall(r"(\w+):\s*(true|false)", _FR)}


def ready(*keys: str) -> bool:
    return all(READY.get(k, False) for k in keys)


def save_months(m: str, y: str) -> int:
    return round((CAT[m]["price"] * 12 - CAT[y]["price"]) / CAT[m]["price"])


# 年払いは「何か月分の料金で1年」か(ライト・総合・業務・先着で同じ。違えば料金を見直す合図なので止める)
PAY_MONTHS = {12 - save_months(b + "_month", b + "_year") for b in ("light", "total", "business", "founder")}
assert len(PAY_MONTHS) == 1, PAY_MONTHS
PAY_MONTHS = PAY_MONTHS.pop()
SAVE_MONTHS = 12 - PAY_MONTHS
YEAR_DEAL = f"{PAY_MONTHS}か月分の料金で1年({SAVE_MONTHS}か月分お得)"


# 未完成の機能の印(比べる表の中だけ。表の下に「※は11月中に追加」と1回だけ書く)
def mk(*keys: str) -> str:
    return "" if ready(*keys) else '<sup class="mk">※</sup>'

# プランごとにできること(料金ページの「機能を詳しく比べる」)。列は 無料/ライト/総合/業務。8行まで
FEATURES = [
    ("計算ページ(5つ)", "回数制限なし", "回数制限なし", "回数制限なし", "回数制限なし"),
    ("古物台帳の保存", "この端末だけ", f"クラウド(月{LIGHT_LIMIT}件まで)", "クラウド(件数の制限なし)", "クラウド(件数の制限なし)"),
    ("パソコンとスマホで同じ台帳", "—", "○", "○", "○"),
    ("ヤフオク終了60分前の通知", "入れた端末だけ", "どの端末の出品も", "どの端末の出品も", "どの端末の出品も"),
    ("楽天の検索", "1日20回", "制限なし", "制限なし", "制限なし"),
    ("売上・経費・月ごとの利益", "台帳の期間合計", "台帳の期間合計", f"○{mk('books')}", f"○{mk('books')}"),
    ("在庫", "状態ごとの件数", "状態ごとの件数", f"売れ残りアラート{mk('books')}", f"売れ残りアラート{mk('books')}・期末の棚卸{mk('stock')}"),
    ("確定申告と複数人", "—", "—", "—", f"申告用の数字と書き出し・仕入税額控除の特例チェック{mk('tax')}・3人まで{mk('team')}・発送代行への指示{mk('threepl')}・警察提出用PDF{mk('policepdf')}"),
]
ANY_LATER = not all(READY.values())


def feature_rows() -> str:
    return "\n".join("<tr><th>" + f[0] + "</th>" + "".join(f'<td{" class=\"rec\"" if i == 3 else ""}>{f[i]}</td>' for i in range(1, 5)) + "</tr>"
                     for f in FEATURES)


# 料金ページ・トップ・紹介で見せる3つのプラン(順は PC の左から)。items は (文, その機能の FEATURES_READY のキー)。
# できている機能は bullets、まだの機能は later(「11月中に追加」)に分ける(合わせて4つまで)
CARDS = [
    {"base": "light", "who": "まずは台帳をクラウドに残したい方",
     "items": [(f"台帳をクラウドに保存(月{LIGHT_LIMIT}件まで)", ()), ("パソコンとスマホで同じ台帳", ()), ("ヤフオク終了前の通知をどの端末にも", ()), ("楽天の検索 制限なし", ())]},
    {"base": "total", "who": "売上・経費・利益まで1か所で見たい方",
     "items": [("ライトのすべて", ()), ("台帳の件数は無制限", ()), ("売上の取り込みと経費", ("books",)), ("月ごとの利益と売れ残りアラート", ("books",))]},
    {"base": "business", "who": "棚卸と確定申告の数字まで任せたい方",
     "items": [("総合のすべて", ()), ("期末の棚卸(スマホで数える)", ("stock",)), ("確定申告用の数字と会計ソフト向けの書き出し", ("tax",)), ("3人まで・発送代行への指示・警察提出用の台帳PDF", ("team", "threepl", "policepdf"))]},
]
for _c in CARDS:
    _c["bullets"] = [t for t, k in _c["items"] if ready(*k)]
    _c["later"] = [t for t, k in _c["items"] if not ready(*k)]


def _amount(parts: list[tuple[str, tuple]]) -> str:
    # できている機能を先に、まだの機能は「(…は11月中に追加。追加の料金はかかりません)」と1回だけ添える
    now = [t for t, k in parts if ready(*k)]
    later = [t for t, k in parts if not ready(*k)]
    return "・".join(now + later) + (f"({'・'.join(later)}は11月中に追加。追加の料金はかかりません)" if later else "")


# お申し込み内容の確認の「分量」(プランの段ごと。短く)
AMOUNT = {
    "light": f"台帳のクラウド保存(月{LIGHT_LIMIT}件まで)、パソコンとスマホの同期、ヤフオク終了前の通知、楽天の検索 制限なし。1アカウント",
    "total": "ライトのすべてと、台帳の件数の制限なし。" + _amount([("売上の取り込み", ("books",)), ("経費", ("books",)), ("月ごとの利益", ("books",)), ("売れ残りアラート", ("books",))]) + "。1アカウント",
    "business": "総合のすべてと、" + _amount([("期末の棚卸", ("stock",)), ("確定申告用の数字と会計ソフト向けの書き出し", ("tax",)), ("仕入税額控除の特例チェック", ("tax",)), ("3人まで", ("team",)), ("発送代行への指示", ("threepl",)), ("警察提出用の台帳PDF", ("policepdf",))]),
}


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
    # 帳簿(/sedori/books/)は別の班が作る。ページがまだ無い間は、押すと「準備中」と出す(ui.js が確かめる)
    nav = [("", "トップ")] + ROUTES + [("daicho", "台帳"), ("books", "帳簿"), ("shikumi", "利益の仕組み"), ("chigai", "コンサルとの違い"), ("plans", "料金")]
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
    <button type="button" class="hd-ai" data-ai-open>AIに相談</button>
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
          <li>個人から古物を買うとき、対価の総額が1万円以上なら、その都度、法律で決められた方法で売り手の確認(住所・氏名・職業・年齢)が必要です。ゲームソフト・CD・DVD・書籍・バイクの部品等と、2025年10月1日からはエアコンの室外機・電気温水機器のヒートポンプ・電線・金属製グレーチングも、金額を問わず必要です。身分証の写しを受け取るだけでは足りず、匿名配送の取引では事実上できません。1万円未満でも、18歳未満からの買い受けでないことの確認が要ります。<a href="https://www.keishicho.metro.tokyo.lg.jp/tetsuzuki/kobutsu/kaisetsu/hitaimen.html" target="_blank" rel="noopener">警視庁の解説</a></li>
          <li>古物の取引は、年月日・品目と数量・特徴・相手方の住所氏名職業年齢・確認の方法などの記録が必要です。このアプリの台帳は記録の入れ物で、法令上の判断はしません。必要な項目は所轄の警察署で確認してください。台帳で売り手の確認が未入力の行には印が付きます。</li>
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
    # 設定(config.js)と同期の計算(sync.js)は最初に、ログイン(account.js)は ui.js の後に、全ページで読む。
    # 帳簿の同期(books-sync.js)は account.js より前、売り手の確認の判定(seller-check.js)は ui.js より前
    first = ["books-sync.js"] if "books-sync.js" in scripts else []
    order = ["config.js", "sync.js"] + first + [x for x in scripts if x == "calc.js"] + ["seller-check.js", "ui.js", "account.js"] + [x for x in scripts if x not in ("calc.js", "ui.js", "books-sync.js", "seller-check.js")] + ["ai.js"]
    sc = "\n".join(f'<script src="{base}assets/{s}?v={VER}"></script>' for s in order)
    return f"""<footer class="ft">
  <div class="ft-in">
    <nav><a href="{base}">トップ</a><a href="{base}daicho/">台帳</a><a href="{base}#fees">手数料の出典</a><a href="{base}plans/">料金</a><a href="{base}mypage/">マイページ</a><a href="{base}terms/">利用規約</a><a href="{base}privacy/">プライバシーポリシー</a><a href="{base}../tokushoho.html">特定商取引法に基づく表記</a><a href="{base}lp/">はじめての方へ</a><a href="{base}shikumi/">利益の仕組み</a><a href="{base}chigai/">コンサル・スクールとの違い</a><a href="{base}#ai" data-ai-open>AIに相談</a><a href="{base}guide/">手引き</a><a href="mailto:zeroichi.works.jp@gmail.com">お問い合わせ</a></nav>
    {LEGAL}
    <p>ZEROICHI WORKS(個人事業)。計算は公開されている料金表にもとづく目安で、利益や販売を保証するものではありません。画面と計算はAI(Claude)を使って作り、手計算の例で検算しています。入力した内容と台帳は、この端末のブラウザに保存されます(有料プランでログイン中は、クラウドにも保存します)。</p>
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
    (d / "index.html").write_text(with_noindex(html_text), encoding="utf-8")


def with_noindex(html_text: str) -> str:
    """テスト用の写しなら、<head> の直後に noindex を入れる(もう入っていれば何もしない)"""
    if not NOINDEX or 'content="noindex' in html_text[:3000]:
        return html_text
    return html_text.replace("<head>", "<head>" + ROBOTS, 1)


def route_page(slug: str, title: str, desc: str, src: str, route_attr: str, body: str, scripts: list[str]) -> None:
    label = dict(ROUTES)[slug]
    out = head(title, desc, f"{slug}/", "../", f'data-route="{route_attr}" data-route-label="{esc(label)}" data-page="{slug}"')
    out += header("../", slug, src) + crumb("../", esc(title)) + f'<main class="wrap">\n{NOJS}\n{body}\n</main>\n' + footer("../", scripts)
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


MEDIA_LABEL = '<span>金額を問わず確認が要る品<small class="ckn">ゲーム・CD・DVD・書籍・バイク部品・室外機など</small></span>'


def chk(ident: str, label: str, checked: bool = False) -> str:
    return f'<label class="ck"><input id="{ident}" type="checkbox"{" checked" if checked else ""}>{label}</label>'


DETAIL_ACTIONS = """<div class="acts">
          <button type="button" class="btn pri" data-act="list">この価格で出品<kbd>Enter</kbd></button>
          <button type="button" class="btn buy" data-act="buy">仕入れた<kbd>S</kbd></button>
        </div>
        <div id="party"></div>
        <div id="brk"></div>"""


# ------------------------------------------------------------------
# 初期表示分を HTML にも入れる部品(JavaScript が動かない環境・読み上げ・テキスト取得でも中身が分かるように)。
# JavaScript が動けば、同じ内容で描き直す(選択肢は ui.js / ra.js / mz.js / market.js、表は market.js)
# ------------------------------------------------------------------
def _opts(items, sel: str) -> str:
    return "".join(f'<option value="{esc(i)}"{" selected" if i == sel else ""}>{esc(l)}</option>' for i, l in items)


def cat_options(sel: str = "toys") -> str:
    return _opts([(c["id"], c["label"]) for c in FEES["amazon"]["categories"]], sel)


def tier_options(sel: str = "std2c") -> str:
    return _opts([(x["id"], x["label"]) for x in FEES["amazon"]["fba_tiers"]], sel)


def carrier_options(sel: str = "yp60") -> str:
    # ui.js の carrierOptions と同じ形(グループごと・料金は送料+資材)
    groups: dict[str, list] = {}
    for c in FEES.get("self_ship", {}).get("carriers", []):
        groups.setdefault(c["group"], []).append(c)
    return "".join(f'<optgroup label="{esc(g)}">' + "".join(
        f'<option value="{c["id"]}"{" selected" if c["id"] == sel else ""}>{esc(c["label"])}{"" if c["id"] == "custom" else " " + format(c["fee"] + c["material"], ",") + "円"}</option>'
        for c in cs) + "</optgroup>" for g, cs in groups.items())


def venue_options() -> str:
    ps = FEES["auctions"]["presets"]
    return _opts([(x["id"], x["label"]) for x in ps], ps[0]["id"])


# 目標の利益の初期値(ui.js の target() と同じ: 利益率15%)
DEFAULT_TARGET_PCT = 15


def _need(p: int, pct: int) -> int:
    return -(-p * pct // 100)  # 切り上げ(calc.js の needProfit と同じ)


def market_price_for(fixed: int, rate: float, pct: int) -> int | None:
    """calc.js の marketPriceFor と同じ(手数料は1円未満切り捨て)。目標の利益率 pct% を残せる最安の売値"""
    def ok(v: int) -> bool:
        return v - int(v * rate + 1e-9) - fixed >= _need(v, pct)
    denom = 1 - rate - pct / 100
    if denom <= 0:
        return None
    p = max(1, int(fixed / denom) - 3)
    for _ in range(100000):
        if ok(p):
            while p > 1 and ok(p - 1):
                p -= 1
            return p
        p += 1
    return None


def market_rows_initial() -> str:
    """メルカリの表の初期表示(仕入れ値0円・メルカリ・自分で発送・目標 利益率15%・実際の売値は未入力)。market.js の render と同じ並び"""
    rate = FEES["mercari"]["rate"]
    out, grp = [], ""
    for sh in FEES["mercari"]["shipping"]:
        if sh["group"] != grp:
            grp = sh["group"]
            out.append(f'<tr class="grp"><td colspan="7">{esc(grp)}</td></tr>')
        fixed = (0 if sh["id"] == "custom" else sh["fee"]) + sh["material"]
        be, tp = market_price_for(fixed, rate, 0), market_price_for(fixed, rate, DEFAULT_TARGET_PCT)
        on = ' class="on"' if sh["id"] == "tq60" else ""
        out.append(f'<tr data-i="{esc(sh["id"])}"{on}><td><div class="nm">{esc(sh["label"])}</div></td>'
                   f'<td class="r fee" data-k="送料・資材">{fixed:,}</td><td class="r c-fee fee">{be:,}</td>'
                   f'<td class="r" data-k="目標の売値"><span class="yen">{tp:,}<i>円</i></span></td>'
                   f'<td class="r c-fee fee">{int(tp * rate + 1e-9):,}</td>'
                   '<td class="r" data-k="利益"><span class="muted">—</span></td><td class="r c-rt"><span class="muted">—</span></td></tr>')
    return "".join(out)


def empty_row(cols: int, text: str) -> str:
    return f'<tr><td colspan="{cols}" class="empty">{text}</td></tr>'


NOJS = ('<noscript><p class="nojs">この計算ページは JavaScript で動きます。JavaScript を有効にすると、入れた数字で利益がその場で出ます。'
        '利益は「実際の売値 − 仕入れ値 − 手数料 − 送料」で、ポイントはその後に上乗せとして足します。</p></noscript>')

# ポイント還元率の目安とヒント(計算は 仕入れ値÷1.1×率。率はご自身の実際の率が正)
PT_HINT_RA = ('<p class="hint pt-hint">ポイントの率の目安: 楽天の通常分は1%(ショップの倍率がP1倍の時)。SPU・お買い物マラソンなどのキャンペーンや、カードの分は人によって違うので、'
              'ご自身の実際の率を入れてください。ポイントは 仕入れ値÷1.1×率 で計算し、利益には上乗せとして後から足します。</p>')

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
          <label class="fr col"><span class="fk">カテゴリー</span><select id="c-cat">''' + cat_options() + '''</select></label>
          <label class="fr col"><span class="fk">FBAのサイズ</span><select id="c-tier">''' + tier_options() + '''</select></label>
          ''' + fld("納品送料", num("c-inbound", "100"), "円", "資材込み・1個") + fld("その他", num("c-other", "0"), "円", "1個") + fld("ポイント上乗せ", dec("c-pt-mine", "0"), "%", "SPU・キャンペーン・カード") +
          '<p class="hint">ショップの倍率に足す分です。人によって違うので、ご自身の実際の率を入れてください(分からなければ0のまま)。</p>' +
          chk("c-usept", "ポイントを利益に含める(上乗せとして)", True) + chk("c-self", "FBAを使わない(自分か代行が発送)") +
          '<div id="c-selfship-w" hidden><label class="fr col"><span class="fk">運送会社・サイズ</span><select id="c-carrier">' + carrier_options() + '</select></label>' + fld("送料", num("c-selfship", "0"), "円", "自分で入力の時") + '''</div>
        </div>''')}
      {box("APIキー", '''<p class="hint">ご自身のIDとキーをこの端末だけに保存し、楽天・Keepaへ直接問い合わせます。</p>
        <div class="fl">
          <label class="fr col"><span class="fk">楽天 アプリID</span><input id="k-rk-app" autocomplete="off" spellcheck="false"></label>
          <label class="fr col"><span class="fk">楽天 アクセスキー(pk_)</span><input id="k-rk-key" autocomplete="off" spellcheck="false"></label>
          <label class="fr col"><span class="fk">Keepa APIキー(任意)</span><input id="k-kp" autocomplete="off" spellcheck="false"></label>
          <div class="row-btns"><button class="btn sm" type="button" id="k-save">保存</button><button class="btn sm ghost" type="button" id="k-clear">消す</button></div>
          <p class="hint">楽天: <a href="https://webservice.rakuten.co.jp/" target="_blank" rel="noopener">Rakuten Developers</a>でアプリを作り、許可するWebサイトに <code>''' + SITE_ORIGIN + '''</code> を入れる。Keepa: <a href="https://keepa.com/#!api" target="_blank" rel="noopener">Keepa API</a>(有料・1件1トークン)。Yahoo!ショッピングは公式の検索ページを開きます。</p>
        </div>''', "keys", False, "keys")}
  </aside>

  <section class="res" aria-label="一覧">
    <div class="tabs" role="tablist">
      <button type="button" role="tab" data-tab="s" aria-selected="true">検索結果<span class="n" id="n-s">0</span></button>
      <button type="button" role="tab" data-tab="w" aria-selected="false">ウォッチ<span class="n" id="n-w">0</span></button>
    </div>
    <div class="tbar">
      <p class="tbar-t" id="res-title">検索結果<small>上の検索欄から探せます</small></p>
      <span class="tbar-r"><span id="quota" class="muted"></span><button type="button" class="btn sm ghost" id="kp-bulk" hidden>Keepaで売値をまとめて取得</button><button type="button" class="btn sm ghost" id="w-csv" hidden>CSV</button></span>
    </div>
    <div id="res-msg"></div>
    <div class="gridwrap">
      <table class="grid mc" id="grid">
        <colgroup><col class="c-img"><col><col class="c-n"><col class="c-pt"><col class="c-n"><col class="c-n c-fee"><col class="c-n"><col class="c-rt"></colgroup>
        <thead><tr><th class="c-img"></th><th>商品名</th><th class="r">仕入れ値</th><th class="r c-pt">ポイント</th><th class="r">Amazon売値</th><th class="r c-fee">手数料</th><th class="r" title="ポイント抜きの利益。+Pはポイントの上乗せ">利益</th><th class="r">利益率</th></tr></thead>
        <tbody id="rows">{empty_row(8, "検索欄にキーワードかJANコードを入れて、検索してください。")}</tbody>
      </table>
    </div>
    <p class="credit" id="credit">「目安」の売値は、Amazonの実際の売値が未入力のため、目標の利益からポイント抜きで逆算した値です(その値段で売れるという意味ではありません)。利益はポイント抜き、+Pはポイントの上乗せです。</p>
  </section>

  <aside class="det" id="calc" aria-label="選んだ商品">
    <div class="det-in">
      <div class="det-h"><p class="det-k">選んだ商品</p><p class="det-name" id="d-name">一覧の行を選ぶと、ここに内訳が出ます。</p><p class="det-sub" id="d-sub"></p></div>
      <div class="dg">
        <label class="cell w2 act"><span class="ck2">Amazonの実際の売値(税込)<small>Amazonで確かめた今の価格。利益はこの値段で見ます</small></span><span class="cv">{num("c-sell", "", ' placeholder="Amazonで見た価格"')}<span class="u">円</span></span></label>
        {cell("仕入れ値(税込)", num("c-cost"), "円")}
        {cell("仕入れの送料", num("c-inship", "0"), "円")}
        {cell("ショップのポイント", dec("c-pt-shop", "1"), "%")}
        {cell("仕入れる個数", num("c-qty", "1"), "個")}
        <label class="cell w2"><span class="ck2">JAN・ASIN</span><span class="cv"><input id="c-code" autocomplete="off" spellcheck="false"><button type="button" class="btn sm ghost in" id="kp-go">Keepa</button></span></label>
      </div>
      {PT_HINT_RA}
      <div id="wh"></div>
      <div id="kp-out"></div>
      <div id="c-out" aria-live="polite"><p class="note">仕入れ値を入れると、目標の利益に届く売値の目安と、損益分岐が出ます。Amazonの実際の売値を入れると、利益の内訳が出ます。</p></div>
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
          ''' + fld("中古の実際の売値", num("mz-actual"), "円", "Amazonで確かめた今の中古の価格") + fld("新品の価格", num("mz-new"), "円", "Amazon") + '''
          <label class="fr col"><span class="fk">カテゴリー</span><select id="mz-cat">''' + cat_options() + '''</select></label>
        </div>''')}
      {box("ヤフオクの価格", '''<div class="fl">
          <label class="fr col"><span class="fk">検索する言葉</span><input id="mz-q"></label>
          <p class="row-links"><a id="mz-yh" href="https://auctions.yahoo.co.jp/" target="_blank" rel="noopener">出品中を見る</a><a id="mz-yh-closed" href="https://auctions.yahoo.co.jp/" target="_blank" rel="noopener">落札相場を見る</a></p>
          ''' + fld("価格", num("mz-yprice"), "円", "即決・落札見込み") + fld("送料", num("mz-yship", "0"), "円", "出品者→自分") + chk("mz-media", MEDIA_LABEL) + '''
          <label class="fr col"><span class="fk">ヤフオクの終了日時<small>入れると「出品した(見張る)」で台帳に入り、終了60分前に通知</small></span><input id="mz-yend" type="datetime-local"></label>
          <label class="fr col"><span class="sr">終了日時の文字を貼り付け</span><input id="mz-yend-paste" type="text" autocomplete="off" placeholder="終了日時の文字を貼り付け"></label>
        </div>''')}
      {box("発送", '''<div class="fl">
          ''' + '''<label class="fr col"><span class="fk">運送会社・サイズ</span><select id="mz-carrier">''' + carrier_options() + '''</select></label>''' + fld("送料", num("mz-outship", "0"), "円", "自分で入力の時") + fld("その他", num("mz-other", "0"), "円") + '''
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
        <tbody id="rows">{empty_row(7, "新品の価格がまだありません。<br>「JAN・ASIN」で Keepa を押すか、「新品の価格」に入れてください。")}</tbody>
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
      <div id="mz-out" aria-live="polite"><p class="note">一覧の行を選ぶか、出品価格を入れてください。Amazon(中古)の実際の売値を入れると、その値段で売れた時の利益が先に出ます。</p></div>
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
def market_body(side: str, title_hint: str, rows: str = "") -> str:
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
        <label class="inl act">実際の売値 {num("s-price", "", ' placeholder="売れた値段" title="同じ品が実際に売れた値段(売り切れ・落札相場で確かめた価格)"')}円</label>
      </span>
    </div>
    <div class="gridwrap">
      <table class="grid nimg mc" id="grid">
        <thead><tr><th>配送方法</th><th class="r">送料・資材</th><th class="r c-fee">損益分岐</th><th class="r">目標の売値</th><th class="r c-fee">手数料</th><th class="r">利益</th><th class="r">利益率</th></tr></thead>
        <tbody id="rows">{rows}</tbody>
      </table>
    </div>
    <p class="credit">利益(ポイント抜き)は、上の「実際の売値」で売れた場合です。未入力の間は、目標の売値(目標の利益からポイント抜きで逆算した目安)だけを出します。送料はメルカリ便の料金(税込・資材代込み)。行を選ぶと配送方法が決まります。</p>
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
      <div id="m-out" aria-live="polite"><p class="note">配送方法を選び、実際の売値を入れると、利益の内訳が出ます。</p></div>
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
           "mercari-sold", "mercari", market_body(MC_SIDE, "配送方法ごとの売値と利益", market_rows_initial()), ["calc.js", "ui.js", "market.js"])

YM_SIDE = box("仕入れ(ヤフオク)", '<div class="fl">' + fld("落札価格", num("b-bid"), "円") + fld("送料", num("b-ship", "0"), "円", "出品者→自分") +
              fld("その他", num("b-other", "0"), "円", "支払い手数料など") + fld("ポイント", dec("b-pt", "0"), "%", "落札価格に対して") +
              '<p class="hint">もらえる率は、支払い方法やキャンペーンで人によって違います。ご自身の実際の率を入れてください(分からなければ0のまま)。利益には上乗せとして後から足します。</p>' +
              fld("個数", num("b-qty", "1", ' min="1"'), "個", "まとめ落札") + chk("b-media", MEDIA_LABEL) + "</div>" + unit_line() +
              '<p class="hint" id="guard" hidden><span class="badge">売り手の確認が必要</span> 合計1万円以上(またはゲーム等)の中古品です。仕入れた後、台帳で売り手の確認を入力してください。</p>')
route_page("yahuoku-mercari", "ヤフオク→メルカリ 利益計算",
           "Yahoo!オークションで落札した品をメルカリで売った時の、配送方法ごとの利益と損益分岐を一覧で計算。まとめ落札の1個原価、ポイント。仕入れると古物台帳に自動で記録。無料・登録不要。",
           "yahuoku-closed", "yahuoku", market_body(YM_SIDE, "配送方法ごとの売値と利益", empty_row(7, "「仕入れ」に落札価格を入れると、配送方法ごとの売値と利益が並びます。")), ["calc.js", "ui.js", "market.js"])

AU_SIDE = box("仕入れ(業者オークション)", '<div class="fl">' +
              '<label class="fr col"><span class="fk">市場</span><select id="b-venue">' + venue_options() + '</select></label><p class="hint" id="b-venue-note"></p>' +
              fld("落札価格", num("b-bid"), "円") + chk("b-bidex", "落札価格は税別", True) +
              '<div id="b-rate-w" hidden>' + fld("手数料率", dec("b-rate", "5"), "%") + "</div>" +
              fld("落札手数料", num("b-fee", "0"), "円", "自動。上書き可") + chk("b-feeex", "手数料は税別", True) +
              fld("参加費(1回)", num("b-session", "0"), "円") + fld("その回の点数", num("b-sessionn", "1", ' min="1"'), "点", "参加費を割る数") +
              fld("送料", num("b-ship", "0"), "円", "市場→自分") + fld("その他", num("b-other", "0"), "円", "修理・クリーニング") +
              fld("個数", num("b-qty", "1", ' min="1"'), "個", "ロットの点数") + "</div>" + unit_line() +
              '<p class="hint">入会金・年会費は含みません。</p>')
route_page("auction-mercari", "業者オークション→メルカリ 利益計算",
           "古物市場(業者オークション)で落札したブランド中古品を、メルカリ等で売った時の配送方法ごとの利益を一覧で計算。落札手数料・参加費の按分・税別落札の換算・ロットの1個原価。古物台帳に自動で記録。",
           "mercari-sold", "auction", market_body(AU_SIDE, "配送方法ごとの売値と利益", empty_row(7, "「仕入れ」に落札価格を入れると、配送方法ごとの売値と利益が並びます。")), ["calc.js", "ui.js", "market.js"])

# ------------------------------------------------------------------
# 台帳
# ------------------------------------------------------------------
LEDGER_BODY = """<div class="lg">
  <div class="lg-head">
    <h1>古物台帳</h1>
    <dl class="sum" id="lg-sum"></dl>
    <span class="lg-act"><button type="button" class="btn sm ghost" id="lg-add">手で追加</button><button type="button" class="btn sm ghost" id="lg-csv">CSVで書き出す</button><button type="button" class="btn sm" id="lg-xlsx">Excelで書き出す</button></span>
  </div>
  <div id="lg-up" aria-live="polite"></div>
  <div class="tabs" role="tablist" id="lg-tabs"></div>
  <div class="tbar"><p class="tbar-t" id="lg-title"></p><span class="tbar-r"><button type="button" class="btn sm ghost tg" id="lg-notify" aria-pressed="false" title="ヤフオクの終了60分前に、ブラウザの通知でお知らせ(このアプリのページを開いている間)">終了60分前の通知: オフ</button><label class="inl">期間 <select id="lg-period"><option value="all">すべて</option><option value="m0">今月</option><option value="m1">先月</option><option value="y0">今年</option></select></label></span></div>
  <div id="lg-form-box"></div>
  <div class="gridwrap">
    <table class="grid ledger" id="lg-grid">
      <thead><tr><th>状態</th><th>仕入日</th><th>品名・品目・特徴</th><th class="r">数量</th><th class="r">仕入れ値</th><th>仕入れ先・相手</th><th>売り手の確認</th><th>売却</th><th class="r">売値</th><th class="r">見込み利益</th><th></th></tr></thead>
      <tbody id="lg-rows"></tbody>
    </table>
  </div>
  <ul class="credit memo">
    <li>個人から1回の取引で合計1万円以上で買った中古品と、金額を問わず確認が要る品(ゲーム・CD・DVD・書籍・バイク部品・エアコンの室外機・ヒートポンプ・電線・金属製グレーチング)は、売り手の氏名と確認の方法を入れるまで「売り手の確認が未入力」と表示します。</li>
    <li>CSV・Excelは、古物台帳の項目(受入れ・払出し)の順で書き出します。</li>
    <li>「出品中」の行にヤフオクの終了日時を入れると、終了が近い順に並び、2時間前から色が付きます。通知をオンにすると、このアプリのページを開いている間、60分前にお知らせします(ヤフオク・Amazonへの自動アクセスはしません)。</li>
    <li>無料プランのデータは、この端末のブラウザの中だけにあります。機種変更の前に書き出してください。</li>
  </ul>
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

def price_block(base: str) -> str:
    # 月払い/年払いの切り替えで片方だけ見せる(data-c)。年払いは月あたりと「2か月分お得」も
    m, y = CAT[base + "_month"]["price"], CAT[base + "_year"]["price"]
    sv = save_months(base + "_month", base + "_year")
    return (f'<div class="pc-pr"><p class="pc-price" data-c="month"><span class="pc-per">月</span><b>{m:,}</b><span class="pc-u">円</span><small>税込</small></p>'
            f'<p class="pc-price" data-c="year" hidden><span class="pc-per">年</span><b>{y:,}</b><span class="pc-u">円</span><small>税込</small></p>'
            f'<p class="pc-sub" data-c="year" hidden>{PAY_MONTHS}か月分の料金で1年・{sv}か月分お得(月あたり{per_month(base + "_year")})</p>'
            f'<p class="pc-sub pc-alt" data-c="month">年払いなら{y:,}円({PAY_MONTHS}か月分)</p></div>')


def founder_line() -> str:
    f = CAT.get("founder_month")
    if not f or f.get("open") is False:
        return '<div class="pc-fd"></div>'
    return (f'<div class="pc-fd"><p class="pc-founder" id="pc-founder"><span data-c="month">{FOUNDER}は <b>月{yen(P_FM)}</b></span>'
            f'<span data-c="year" hidden>{FOUNDER}は <b>年{yen(P_FY)}</b></span><span class="pc-keep">。{FOUNDER_KEEP}</span><span class="pc-left" id="pl-founder-left"></span></p></div>')


def plan_card(c: dict) -> str:
    b = c["base"]
    m = CAT[b + "_month"]
    tag = {"total": '<span class="pc-tag rec">おすすめ</span>', "business": '<span class="pc-tag">確定申告まで全部</span>'}.get(b, "")
    lis = "".join(f"<li>{x}</li>" for x in c["bullets"])
    later = ""
    if c["later"]:
        later = '<p class="pc-later"><span class="soon">11月中に追加</span></p><ul class="pc-list later">' + "".join(f"<li>{x}</li>" for x in c["later"]) + "</ul>"
    return (f'<article class="pc pc-{b}{" rec" if b == "total" else ""}" data-base="{b}" aria-labelledby="pc-n-{b}">'
            f'<header class="pc-h"><h3 class="pc-name" id="pc-n-{b}">{m["name"]}</h3>{tag}</header>'
            f'<p class="pc-who">{c["who"]}</p>'
            f'{price_block(b)}'
            f'{founder_line() if b == "total" else '<div class="pc-fd"></div>'}'
            f'<a class="btn pc-go{"" if b == "total" else " ghost"}" href="?plan={b}#pl-step2" data-pick="{b}" aria-pressed="false">このプランで14日無料</a>'
            f'<div class="pc-feat"><ul class="pc-list">{lis}</ul>{later}</div>'
            f'</article>')


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

def _mini(c: dict) -> str:
    b = c["base"]
    m = CAT[b + "_month"]
    tag = '<span class="pill">おすすめ</span>' if b == "total" else ""
    fl = f'<span class="mp-f">{FOUNDER}は月{yen(P_FM)}</span>' if b == "total" and CAT.get("founder_month", {}).get("open", True) else ""
    return (f'<a class="mp-c{" rec" if b == "total" else ""}" href="plans/?plan={b}#pl-step2"><span class="mp-n">{m["name"]}{tag}</span><span class="mp-w">{c["who"]}</span>'
            f'<span class="mp-p">月<b>{m["price"]:,}</b>円<small>税込</small></span><span class="mp-y">年払いは{CAT[b + "_year"]["price"]:,}円({PAY_MONTHS}か月分)</span>{fl}</a>')


top_plans = "".join(_mini(c) for c in CARDS)
HERO_FOUNDER = (f'<tr class="fd"><th>総合 {FOUNDER}</th><td>{yen(P_FM)}</td><td>{yen(P_FY)}</td></tr>'
                if CAT.get("founder_month", {}).get("open", True) is not False else "")

TOP_BODY = f"""<div class="lay2">
  <aside class="side" aria-label="メニュー">
    <div class="sbox"><p class="sbox-t">台帳の状況</p><div class="sbox-b" id="top-ledger"></div></div>
    <div class="sbox"><p class="sbox-t">はじめての方へ</p><div class="sbox-b">
      <ul class="side-links"><li><a href="shikumi/">せどりで利益が出る仕組み</a><small>計算の例・向き不向き・失敗のパターン</small></li><li><a href="chigai/">コンサル・スクールとの違い</a><small>申し込む前に確かめたい9つのこと</small></li><li><a href="#ai" data-ai-open>AIに相談</a><small>無料のAIに、当店の前提つきで相談</small></li></ul>
    </div></div>
    <div class="sbox"><p class="sbox-t">週刊メルマガ(無料)</p><div class="sbox-b"><p class="hint">手数料の改定、ポイントの日程、台帳のつけ方を週1回お届けします。</p><p class="row-links"><a data-mail="news" href="#">メール1通で登録</a></p></div></div>
  </aside>

  <section class="res">
    <h1 class="pg-h">せどりの利益計算と、古物台帳の自動記録</h1>
    <div class="hero" id="intro">
      <div class="hero-m">
        <p>仕入れ先と売り先を選ぶだけで、手数料・送料・ポイントを引いた利益が出ます。目標の利益に届く売値と、仕入れ値の上限も一緒に。「仕入れた」を押せば古物台帳に記録され、「売れた」で売却欄まで埋まります。</p>
        <ul class="memo">
          <li>5つの仕入れルートに対応。業者オークションの参加費も、まとめ落札の1個あたりの原価も計算します</li>
          <li>台帳は古物台帳の項目どおりの並び。そのままExcel・CSVで書き出せます</li>
          <li>計算と台帳は無料・登録なしで使えます。入れた内容は、この端末にだけ保存されます</li>
        </ul>
        <div class="row-btns"><a class="btn" href="#shindan-sec">向いている仕入れルートを診断(6問)</a><a class="btn ghost" href="daicho/">台帳を開く</a></div>
        <p class="hero-read"><a href="shikumi/">せどりで利益が出る仕組み(計算の例つき)</a><a href="chigai/">コンサル・スクールとの違い</a><a href="#ai" data-ai-open>AIに相談</a></p>
      </div>
      <aside class="hero-p" aria-labelledby="hero-p-h">
        <p class="hero-p-h" id="hero-p-h">料金<small>税込</small></p>
        <table class="hp-t">
          <thead><tr><th></th><th>月払い</th><th>年払い<small>{PAY_MONTHS}か月分</small></th></tr></thead>
          <tbody>
            <tr><th>ライト</th><td>{yen(P_LM)}</td><td>{yen(P_LY)}</td></tr>
            <tr class="rec"><th>総合<span class="pill">おすすめ</span></th><td>{yen(P_TM)}</td><td>{yen(P_TY)}</td></tr>
            {HERO_FOUNDER}
            <tr><th>業務</th><td>{yen(P_BM)}</td><td>{yen(P_BY)}</td></tr>
          </tbody>
        </table>
        <p class="hp-n">年払いは{YEAR_DEAL}。月払いは14日無料、年払いは{YEAR_DAYS}日以内の解約で全額返金。計算と、この端末の台帳は0円です。<a href="plans/">条件を詳しく見る</a></p>
        <div data-bill="prep" class="hp-pre"><p class="hp-pre-h">{PRE_HEAD}</p><div data-prereg data-compact></div></div>
        <div data-bill="ready"><a class="btn wide" href="plans/">プランを選ぶ(月払いは14日無料)</a></div>
      </aside>
    </div>

    <h2 class="sec-h">仕入れ先と売り先で選ぶ</h2>
    <div class="gridwrap"><table class="grid nimg rt" id="route-grid">
      <thead><tr><th>ページ</th><th>仕入れ先</th><th>売り先</th><th>商品</th><th>古物商許可</th><th>計算する手数料</th></tr></thead>
      <tbody>{route_rows}</tbody>
    </table></div>

    <h2 class="sec-h" id="shindan-sec">向いている仕入れルートを診断(6問)</h2>
    <form id="shindan" class="qtab">
      <table class="kv wide">{q_rows}</table>
      <div class="row-btns"><button class="btn pri" type="submit">診断する</button><span class="hint">収入の見込みを示すものではありません。答えはこの端末の中だけで使います。</span></div>
    </form>
    <div id="shindan-out" class="out-box" hidden aria-live="polite"></div>

    <h2 class="sec-h" id="plans">料金</h2>
    <p>計算と、この端末に保存する台帳は無料です。台帳をクラウドに残すなら、3つのプランから選べます。月払いは<b>14日無料</b>、年払いは<b>{YEAR_DEAL}</b>で、<b>{YEAR_DAYS}日以内の解約は全額返金</b>です<span data-bill="prep">{PRE_SHORT}</span>。</p>
    <div class="mini-plans">{top_plans}</div>
    <p class="row-links"><a href="plans/">機能を比べて申し込む</a><a href="../tokushoho.html">特定商取引法に基づく表記</a></p>

    <h2 class="sec-h" id="faq">よくある質問</h2>
    <div class="faq">
      <details><summary>無料でどこまで使えますか。</summary><p>5つの計算ページと台帳は、無料・回数制限なし・登録なしで使えます。楽天の検索だけは1日20回までで、楽天の開発者サイトで無料のIDを取ってお使いください。</p></details>
      <details><summary>いま使っている出品ツールと一緒に使えますか。</summary><p>使えます。このアプリは出品も価格改定もしません。仕入れ前の計算と、仕入れた後の古物台帳を受け持ちます。</p></details>
      <details><summary>入れたデータはどこに保存されますか。</summary><p>無料版は、この端末のブラウザの中だけです。当方のサーバーには送られません。ブラウザのデータを消すと台帳も消えるので、CSV・Excelで書き出しておいてください。有料プランでログインすると、台帳をクラウド(Google Cloud の東京リージョン)にも保存します。中身は見ず、ほかの目的にも使いません(<a href="privacy/">プライバシーポリシー</a>)。解約後も3年間は保管し、マイページから書き出せます。</p></details>
      <details><summary>Amazonの価格はどう入れますか。</summary><p>「Amazonで見る」で価格を確かめて入れてください。価格データのサービスのAPIキーをお持ちなら、設定に入れると自動で入ります(そのサービスの料金と利用条件は、そのサービスとのご契約です)。</p></details>
      <details><summary>メルカリやヤフオクの価格は自動で取れますか。</summary><p>取りません。各サービスの規約で自動アクセスが制限されているためです。検索バーで各サイトの検索ページを開き、見た価格を入れてください。</p></details>
      <details><summary>台帳はどう使いますか。</summary><p>計算ページで「仕入れた」を押すと1行入ります。台帳では状態を1クリックずつ進め、「売れた」を押すと売却日・売値・相手が入ります。</p></details>
      <details id="honnin"><summary>1万円以上の中古品を買うときの、売り手の確認はどう記録しますか。</summary><p>台帳に、相手の氏名・住所と確認の方法を入れる欄があります。個人から1万円以上で買った中古品など、法律で確認が必要な行は、入力するまで印が付きます。確認のやり方は<a href="guide/honnin-kakunin/">手引き「中古品を買うときの売り手の確認」</a>にまとめています。</p></details>
      <details><summary>計算は正確ですか。</summary><p>公開されている料金表で計算し、手計算の例で検算していますが、目安です。在庫保管手数料・返品・値下がりは含みません。</p></details>
      <details><summary>有料版はいつから使えますか。</summary><p><span data-bill="prep">{PRE_FAQ}</span><span data-bill="ready">いまから使えます。</span>料金・支払い・解約の条件は<a href="plans/">料金ページ</a>と<a href="../tokushoho.html">特定商取引法に基づく表記</a>に載せています。</p></details>
      <details><summary>解約はどうしますか。</summary><p>マイページの「契約内容」にある「解約について」を開き、「解約する」を押して確認すれば完了です。メール1通でのお申し出でも解約できます(PayPalでお支払いの方は、PayPalの自動支払いの管理画面からも)。次の請求日の前日までに解約すれば、次回からは請求しません。</p></details>
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
# 料金ページの組み立て。1) 月払い/年払いの切り替えと3枚のカード 2) 選んだプランの最終確認(特商法2022年改正の表示事項)と申し込みのボタン
MAIL_A = '<a href="mailto:zeroichi.works.jp@gmail.com">zeroichi.works.jp@gmail.com</a>'
CONF = [
    ("分量(できること)", '<span id="cf-amount">' + "".join(f'<span data-tier="{k}"{"" if k == "total" else " hidden"}>{v}</span>' for k, v in AMOUNT.items()) + "</span>"),
    ("価格(税込)", f'<b id="cf-price2">月{yen(P_TM)}</b>。ほかの費用はかかりません(通信費を除く)'),
    ("無料期間", '<span id="cf-trial">お申し込みの日から14日間</span><span id="cf-trial2">。期間中は業務のすべてを使えます</span>'),
    ("支払いの時期", '<span id="cf-when">無料期間が終わる日に1回目、以後は毎月同じ日に自動で請求します(前払い)</span>'),
    ("支払いの方法", "クレジットカード・デビットカード(Visa・Mastercard・JCB・American Express・Diners Club・Discover。Apple Pay・Google Pay も使えます。決済代行: Stripe)<span id=\"cf-pay-pp\">、またはPayPal</span>"),
    ("使える時期", "お申し込みの手続きが終わったら、すぐ"),
    ("申込みの期間", '<span id="cf-period">期限はありません</span>'),
    ("契約の期間", '<span id="cf-term">1か月ごとに自動で更新し、解約するまで続きます</span>'),
    ("解約の方法", f"マイページの「契約内容」→「解約について」→「解約する」。メール({MAIL_A})でも解約できます。PayPalでお支払いの方は、PayPalの自動支払いの管理画面からも止められます"),
    ("解約の期限", '<span id="cf-limit">次の請求日の前日まで。無料期間中に解約すれば0円です</span>'),
    ("返金", '<span id="cf-refund">途中で解約しても日割りの返金はなく、支払い済みの期間の終わりまで使えます。当方の不具合で使えなかった期間は返金します</span>'),
    ("解約後の台帳", "クラウドの台帳は3年間保管し、マイページから書き出せます(古物台帳は3年間の保存が必要なため)"),
]
conf_dl = "\n".join(f'          <div class="cf-r"><dt>{k}</dt><dd>{v}</dd></div>' for k, v in CONF)
cards = "\n".join("      " + plan_card(c) for c in CARDS)
cmp_note = '<p class="hint">※は11月中に追加します。追加した日から、そのプランで自動で使えます(追加の料金はかかりません)。</p>' if ANY_LATER else ""


PLANS_BODY = f"""<div class="pl">
  <div class="pl-head">
    <h1 class="pg-h">料金</h1>
    <p class="pl-lead">3つのプランから選べます。月払いは<b>14日無料</b>で、その間は業務のすべてを使えます。年払いは<b>{YEAR_DEAL}</b>。無料期間なしでお申し込みの日にお支払いいただき、<b>1回目のお支払いから{YEAR_DAYS}日以内の解約は全額返金</b>です。プランはあとから変えられます。</p>
  </div>

  <section class="pl-s1" id="pl-step1" aria-labelledby="pl-s1h">
    <div class="pl-bar">
      <h2 class="pl-step" id="pl-s1h"><span class="no" aria-hidden="true">1</span>プランを選ぶ</h2>
      <fieldset class="cyc" id="pl-cyc"><legend class="sr">お支払いの周期</legend>
        <label><input type="radio" name="cyc" value="month" checked><span>月払い</span></label>
        <label><input type="radio" name="cyc" value="year"><span>年払い<small>{PAY_MONTHS}か月分で1年</small></span></label>
      </fieldset>
    </div>
    <div class="pcs" id="pl-cards">
{cards}
    </div>
    <p class="pl-free">5つの計算ページと、この端末に保存する台帳は、登録なしでずっと無料です。<a href="../">無料のまま使う</a></p>
    <details class="pl-cmp" id="pl-cmp">
      <summary>機能を詳しく比べる</summary>
      <div class="gridwrap"><table class="grid nimg cmp plcmp">
        <thead><tr><th></th><th>無料</th><th>ライト</th><th class="rec">総合</th><th>業務</th></tr></thead>
        <tbody>
{feature_rows()}
        </tbody>
      </table></div>
      {cmp_note}
    </details>
  </section>

  <section class="pl-s2" id="pl-step2" aria-labelledby="pl-s2h">
    <div class="pl-bar">
      <h2 class="pl-step" id="pl-s2h"><span class="no" aria-hidden="true">2</span>お申し込み内容の確認</h2>
      <a class="pl-back" href="#pl-step1">プランを変える</a>
    </div>
    <div class="cf-box">
      <div class="cf-top">
        <p class="cf-plan"><b id="cf-plan">総合(月払い)</b><span class="cf-fd" id="cf-fd" hidden></span></p>
        <p class="cf-price"><b id="cf-price">月{yen(P_TM)}</b><small>税込</small></p>
        <p class="cf-trial" id="cf-t1">14日無料</p>
      </div>
      <dl class="cf">
{conf_dl}
      </dl>
      <div class="pay" id="pl-pay">
        <div data-bill="prep">
          <p class="pay-st"><span class="dlg-st">準備中</span>{PRE_PAY}いまは事前登録(無料・メール1通)を受け付けています。</p>
          <div data-prereg data-compact id="pl-prereg"></div>
        </div>
        <div data-bill="ready">
          <div id="pl-login"><button type="button" class="btn wide" id="pl-login-btn">ログインして申し込む</button><p class="hint">申し込むアカウントを決めるため、先にログインします(メールのリンクかGoogle)。</p></div>
          <div id="pl-buy" hidden>
            <p class="pay-who" id="pl-who"></p>
            <button type="button" class="btn wide pay-card" id="pl-card" disabled><span class="pay-card-l">カードで申し込む</span><small>(Apple Pay・Google Pay も可)</small></button>
            <p class="pay-prep" id="pl-card-prep" hidden><span class="dlg-st">準備中</span>カードでのお申し込みは準備中です。</p>
            <p class="msg err" id="pl-pay-err" role="alert" hidden></p>
            <p class="hint">上の内容と<a href="../terms/">利用規約</a>・<a href="../privacy/">プライバシーポリシー</a>をご確認ください。決済代行の Stripe の画面でカードを登録すると、お申し込みが完了します。カードの番号は当方に届きません。</p>
            <div class="pay-alt" id="pl-pp-alt" hidden>
              <button type="button" class="lnk" id="pl-pp-open" aria-expanded="false" aria-controls="pl-pp">PayPalで払う</button>
              <div id="pl-pp" class="pp" hidden></div>
            </div>
          </div>
          <div id="pl-has" hidden><p class="msg" id="pl-has-t"></p><a class="btn ghost wide" href="../mypage/">マイページで契約内容を見る</a></div>
        </div>
      </div>
    </div>
    <p class="hint pl-legal">ログインはメールのリンクかGoogleで。台帳は Google Cloud(東京)に保存し、ログインした本人だけが読み書きできます(<a href="../privacy/">プライバシーポリシー</a>)。<a href="../../tokushoho.html">特定商取引法に基づく表記</a></p>
  </section>
</div>"""

out = head("料金", f"せどり 利益チェックの料金。ライト 月{yen(P_LM)}/総合 月{yen(P_TM)}({FOUNDER}は月{yen(P_FM)})/業務 月{yen(P_BM)}(税込)。月払いは14日無料。年払いは2か月分お得で、30日以内の解約は全額返金。",
           "plans/", "../", 'data-page="plans"')
out += header("../", "plans", "rakuten") + crumb("../", "料金") + f'<main class="wrap">\n{PLANS_BODY}\n</main>\n' + footer("../", ["calc.js", "ui.js", "plans.js"])
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
        <div data-acct="prep"><p class="dlg-st">準備中</p><p>ログインとクラウド保存は準備中です。計算と台帳は、いまもログインなしで使えます(この端末に保存)。台帳の書き出しと通知の設定は、このページの下からできます。</p></div>
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
              <li id="mp-alt-pp">PayPalでお支払いの方は、PayPalからも: PayPalにログイン → 右上の歯車(設定) → 「支払い」 → 「自動支払いを管理」 → 「ZEROICHI WORKS」 → 「キャンセル」。マイページの表示にも数分で反映されます。</li>
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
          <summary>クラウドの台帳・帳簿・アカウントを消す</summary>
          <div class="mp-danger-b">
            <p>クラウドの台帳と帳簿を消すと元に戻せません。古物台帳は3年間の保存が必要なので、先に書き出してください。</p>
            <label class="ck"><input type="checkbox" id="mp-del-local">この端末の台帳と帳簿も消す</label>
            <div class="row-btns"><input type="text" id="mp-del-word" placeholder="「消す」と入力" aria-label="確認のため「消す」と入力"><button type="button" class="btn sm danger" id="mp-del-cloud">クラウドの台帳と帳簿を消す</button><button type="button" class="btn sm danger ghost" id="mp-del-acct">アカウントを削除</button></div>
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
out += header("../", "mypage", "ledger") + crumb("../", "マイページ") + f'<main class="wrap">\n{MYPAGE_BODY}\n</main>\n' + footer("../", ["calc.js", "books-sync.js", "ui.js", "mypage.js"])
write("mypage", out)


# ------------------------------------------------------------------
# 利用規約・プライバシーポリシー
# ------------------------------------------------------------------
def doc_page(slug: str, title: str, desc: str, body: str) -> None:
    o = head(title, desc, f"{slug}/", "../", f'data-page="{slug}"')
    o += header("../", slug, "rakuten") + crumb("../", title) + f'<main class="wrap">\n<article class="docx">\n{body}\n</article>\n</main>\n' + footer("../", ["calc.js", "ui.js"])
    write(slug, o)


TERMS = """<h1>利用規約(せどり 利益チェック)</h1>
<p class="muted">制定日 2026年10月27日・改定日 2026年10月30日(先着の価格の定員を200名に。年払いを無料期間なし・30日以内の全額返金に。31日目からの解約は返金なし・次回の更新の停止として扱うことを明記。先着の価格の続く期間の書き方。サービスをやめる時の返金)</p>
<p>この規約は、ZEROICHI WORKS(以下「当方」)が提供する「せどり 利益チェック」(以下「本サービス」)の利用条件です。本サービスを使う方(以下「利用者」)は、この規約に同意したうえで使ってください。有料プランは、ログインしてお申し込みいただいた時に、この規約に同意したものとします。</p>

<h2>第1条(本サービスの内容)</h2>
<ol>
<li>本サービスは、仕入れと販売の手数料・送料・ポイントを含めた利益の計算、古物台帳の項目に沿った記録(以下「台帳」)、その書き出しを行うウェブアプリです。</li>
<li>無料プランでは、計算と台帳を、利用者の端末のブラウザの中に保存して使えます。登録は要りません。</li>
<li>有料プラン(ライト・総合・業務)では、無料プランの機能に加えて、台帳をクラウドに保存し、複数の端末で同じ台帳を使えます。総合・業務では、売上・経費・利益・棚卸・確定申告の数字をまとめる帳簿も使えます。{TERMS_LATER}中身と料金は<a href="../plans/">料金ページ</a>と<a href="../../tokushoho.html">特定商取引法に基づく表記</a>のとおりです。</li>
</ol>

<h2>第2条(アカウント)</h2>
<ol>
<li>有料プランを使うには、メールのリンクかGoogleアカウントでログインします。1人1アカウントで、他人と共有しないでください。</li>
<li>ログインに使うメールアカウント・Googleアカウントは、利用者の責任で管理してください。第三者に使われたことによる損害について、当方の故意または重過失による場合を除き、当方は責任を負いません。</li>
</ol>

<h2>第3条(料金と支払い)</h2>
<ol>
<li>有料プランの料金(税込)、支払いの時期と方法は、料金ページのお申し込み内容の確認に表示したとおりです。支払いは、クレジットカード・デビットカード(決済代行: Stripe)またはPayPalによる自動の定期支払いで行います。</li>
<li>月払いの初めてのお申し込みには14日間の無料期間があります。無料期間が終わる日に1回目の料金を請求し、以後は毎月同じ日に自動で請求します(前払い)。無料期間中に解約した場合、料金はかかりません。解約後に申し込み直した場合は、カードでのお申し込みには無料期間がなく、お申し込みの日に1回目を請求します。</li>
<li>{YEAR_TEXT}以後は毎年同じ日に自動で請求します(前払い)。全額返金の対象は、年払いでお申し込みいただいた1回目のお支払いです(2年目以降の更新の分と、月払いから年払いへ変えた分は対象外です)。返金すると、その日で有料プランは終わります(台帳は第6条のとおり保管し、書き出せます)。</li>
<li>{FOUNDER}の価格は、1回目のお支払いが済んだ方が{FOUNDER_N}名に達するまで受け付け、その契約は{FOUNDER_KEEP}この価格のままです。受付中にお申し込みの方は、無料期間中の方を含めて、この価格のままです。解約後に申し込み直した場合は、その時の価格になります。</li>
<li>支払いが確認できない時は、当方は有料プランの機能(クラウドへの保存)を止めることがあります。その間も、保存済みの台帳の閲覧と書き出しはできます。</li>
</ol>

<h2>第4条(解約)</h2>
<ol>
<li>利用者は、いつでも解約できます。方法は、マイページの「契約内容」にある「解約について」から「解約する」を押して確認する方法と、メールで申し出る方法です。PayPalでお支払いの場合は、PayPalの自動支払いの管理画面から止めることもできます。</li>
<li>次回の請求日の前日までに解約すれば、次回からは請求しません。支払い済みの期間の途中で解約しても月割り・日割りの返金はなく、解約は次回の自動更新を止めるものとして扱い、その期間の終わりまで有料プランを使えます。ただし、年払いの1回目のお支払いから{YEAR_DAYS}日以内の解約は、前条第3項のとおり全額を返金します。</li>
<li>当方の不具合で有料プランを使えなかった期間があるときは、その分を返金します。</li>
</ol>

<h2>第5条(一時停止とプランの変更)</h2>
<ol>
<li>利用者は、マイページから契約を1か月間一時停止できます。停止中は請求せず、クラウドへの保存は止まります(保存済みの台帳の閲覧と書き出しはできます)。1か月たつと自動で再開し、再開した日から請求を再開します。再開の日より前にマイページから再開することもできます。</li>
<li>月払いと年払いの切り替えなどのプランの変更は、マイページから行います。カードでお支払いの場合はその場で変わり、差額は日割りで精算します(月払いから年払いへの変更は、その日に年額から今月の残りの分を差し引いて請求します)。PayPalでお支払いの場合は、PayPalの画面での承認をもって変わります。</li>
</ol>

<h2>第6条(台帳のデータ)</h2>
<ol>
<li>台帳に入れたデータは利用者のものです。当方は、保存・同期・書き出しのために必要な範囲でだけ扱い、中身を見たり、ほかの目的に使ったりしません。</li>
<li>クラウドの台帳は、契約中は保管し、解約(支払い済みの期間の終わり)から3年間保管したあと消します。この間は、ログインしてマイページから書き出せます。利用者がマイページで消した時は、すぐ消します。</li>
<li>端末のブラウザの中のデータは、当方は保管していません。ブラウザのデータを消すと消えるので、利用者が書き出して保管してください。</li>
</ol>

<h2>第7条(古物台帳と法令)</h2>
<ol>
<li>本サービスの台帳は記録の入れ物で、古物営業法その他の法令に合っているかどうかの判断はしません。帳簿の記載事項・保存・売り手の確認などの義務は、古物商である利用者が負います。必要な項目は所轄の警察署で確認してください。</li>
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
<li>設備の保守・障害・天災などで、本サービスを止めることがあります。本サービスをやめる時は、90日前までにお知らせし、台帳を書き出せる期間を設けます。前払いの料金のうち、本サービスをやめる日より後の分は、日割りで返金します。</li>
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
<p class="muted">制定日 2026年10月27日・改定日 2026年10月29日(事前登録・メールマガジンのメールの扱いを追加。前回 2026年10月28日: 帳簿の記録のクラウド保存、カードでのお支払い(Stripe)を追加)</p>
<p>ZEROICHI WORKS(以下「当方」)は、「せどり 利益チェック」(以下「本サービス」)で扱う個人情報を、次のとおり取り扱います。事業者の氏名・住所等は、<a href="../../tokushoho.html">特定商取引法に基づく表記</a>のとおり、ご請求があれば遅滞なく開示します。</p>

<h2>1. 扱う情報</h2>
<table class="legal-t">
<tr><th>アカウント</th><td>メールアドレス。Googleでログインした場合はGoogleアカウントのメールアドレスと識別子(パスワードは当方に届きません)</td></tr>
<tr><th>台帳(有料プラン)</th><td>利用者が入れた仕入れ・売却の記録。取引相手の氏名・住所・電話・メール・職業・年齢・確認の方法など、古物台帳の項目を含みます</td></tr>
<tr><th>帳簿(総合・業務)</th><td>取り込んだ売上(Amazonのレポート・メルカリの取引の内容)、経費と支払先、毎月の経費、取り込みの履歴、売れ残りの目安、棚卸の数、申告用の数字の設定(消費税の区分・棚卸高・登録番号の無い仕入れ先の印など)</td></tr>
<tr><th>設定(有料プラン)</th><td>目標の利益、発送のしかた、発送代行の費用</td></tr>
<tr><th>契約</th><td>Stripeの顧客ID・契約ID、またはPayPalのサブスクリプションID、プラン、契約の状態、無料期間の終わり・次回の請求日。カード番号・有効期限・セキュリティコード・口座番号は当方に届かず、決済代行会社(Stripe・PayPal)が直接受け取って扱います</td></tr>
<tr><th>事前登録・メールマガジン</th><td>登録のメールの送信元のメールアドレスと、本文に書いていただいた内容(任意の質問への答え)。登録は事業用のメール(Gmail)に届いたメールとして保管し、ほかの場所には写しません</td></tr>
<tr><th>お問い合わせ</th><td>メールでいただいた内容</td></tr>
<tr><th>端末の中だけの情報</th><td>無料プランの台帳、入力した値、楽天・Keepaのキーは、利用者の端末のブラウザの中だけに保存し、当方には送られません</td></tr>
</table>

<h2>2. 利用目的</h2>
<ol>
<li>ログインと、台帳・帳簿・設定のクラウドへの保存・端末間の同期・書き出しのため</li>
<li>契約の管理(お申し込み・無料期間の終了のお知らせ・請求・一時停止・解約)のため</li>
<li>お問い合わせへの返事、料金や規約の変更などの大切なお知らせのため</li>
<li>事前登録の方へ、有料版の受付開始のご案内を1通お送りするため(それ以外のメールは送りません)。メールマガジンに登録の方へ、メールマガジンをお送りするため</li>
<li>事前登録・メールマガジンの本文に書いていただいた内容を、本サービスの改善の参考にするため(個人を特定できる形で外に出しません)</li>
<li>不正な利用を防ぐため</li>
</ol>
<p><b>台帳の中身は、上の1のためだけに扱います。</b>当方は台帳の中身を見たり、分析・営業・広告・AIの学習などに使ったりしません。障害の調査などで中身を見る必要が出た時は、事前に利用者の同意を得た範囲に限ります。</p>

<h2>3. 第三者への提供の制限</h2>
<ol>
<li>当方は、法令に基づく場合などを除き、本人の同意なく個人情報を第三者に提供しません。</li>
<li><b>クラウドへの保存について</b>: 台帳・帳簿・設定は、Google LLC の Firebase(Cloud Firestore)の東京リージョン(日本)に保存します。Googleは、当方との契約(データ処理の規約)に基づいてデータを保管するだけで、中身を取り扱いません。このため、個人情報保護委員会の考え方(いわゆるクラウド例外)に照らし、Googleへの「第三者提供」にはあたらないものとして扱い、当方が安全管理の責任を負います。</li>
<li>利用者が取引相手から得た個人情報について、当方は保管の場所を提供する立場で、その情報を取り扱いません。利用者の側でも、当方のクラウドに保存することは第三者への提供にあたらないものと考えています。</li>
<li><b>決済代行会社への提供</b>: 有料プランのお支払いのため、お申し込みの時に、メールアドレス・お申し込みのプラン・当方の利用者の識別子を、利用者が選んだ決済代行会社に提供します。カードの場合は Stripe, Inc.(米国)とその日本法人 Stripe Payments Japan 株式会社、PayPalの場合は PayPal Pte. Ltd.(シンガポール)です。カードの情報は利用者が決済代行会社の画面に直接入れ、当方を通りません。決済代行会社は、受け取った情報を各社のプライバシーポリシーに従って扱い、不正利用の検知などにも使います。お申し込みのボタンを押して決済代行会社の画面に進むことで、この提供に同意したものとします。</li>
<li>外国にある第三者への提供について: Stripe, Inc. は米国、PayPal Pte. Ltd. はシンガポールの事業者です。各国の個人情報の保護の制度は、<a href="https://www.ppc.go.jp/personalinfo/legal/kaiseihogohou/#gaikoku" target="_blank" rel="noopener">個人情報保護委員会のページ</a>で確かめられます。両社とも、個人情報の保護のための措置(プライバシーポリシーの公表・安全管理の措置)を講じています。</li>
<li>契約の状態の受け渡しは Cloudflare, Inc. の Workers、お知らせのメールの送信は Google(Gmail)を使います。これらに渡すのは、それぞれの目的に必要な情報(メールアドレス・契約の識別子など)だけで、台帳の中身は渡しません。</li>
</ol>

<h2>4. 安全管理のためにしていること</h2>
<ul>
<li>通信はすべて暗号化(HTTPS)します。保存したデータもGoogleの仕組みで暗号化されます。</li>
<li>データベースの規則で、ログインした本人だけが自分の台帳を読み書きできるようにしています。ほかの利用者からは見えません。契約の状態は、当方のサーバーだけが書き換えられます。</li>
<li>管理用のアカウントは2段階認証で守り、秘密の鍵は公開の場所に置きません。運営責任者1名だけが管理画面に入れます。</li>
<li>外国の制度: 利用するクラウド・決済の会社は米国・シンガポール等の事業者ですが、台帳の保存場所は日本です。決済代行会社には台帳の中身を渡しません。</li>
<li>漏えいなどが起きた時は、法令に従って個人情報保護委員会への報告と本人への通知を行います。</li>
</ul>

<h2>5. 保存の期間</h2>
<table class="legal-t">
<tr><th>クラウドの台帳・帳簿・設定</th><td>契約中は保管します。解約(支払い済みの期間の終わり)から<b>3年間</b>保管し、その後に消します。古物台帳は最後の記入から3年間の保存が必要なため、解約後もマイページから書き出せるようにしています。利用者がマイページで消した時は、すぐ消します</td></tr>
<tr><th>アカウント</th><td>アカウントを削除するまで(解約後、マイページから削除できます)</td></tr>
<tr><th>契約・請求の記録</th><td>税法などの法令で決められた期間(最長7年)</td></tr>
<tr><th>お問い合わせのメール</th><td>対応が終わってから1年</td></tr>
<tr><th>事前登録のメール</th><td>受付開始のご案内を送ってから3か月(その間に有料版にお申し込みの方は、契約の記録として上の期間)。取り消しのご連絡があれば、すぐ消します</td></tr>
<tr><th>メールマガジンの登録</th><td>配信の停止のご連絡をいただくまで。停止後はすぐ配信先から外し、登録のメールは3か月以内に消します</td></tr>
</table>

<h2>6. 開示・訂正・利用停止など</h2>
<p>ご本人の情報の開示・訂正・削除・利用停止のご請求は、ログインに使うメールアドレスから<a href="mailto:zeroichi.works.jp@gmail.com">zeroichi.works.jp@gmail.com</a>へご連絡ください。ご本人であることを確かめたうえで、遅くとも2週間以内に対応します。台帳の書き出しと削除は、マイページからいつでもできます。</p>

<h2>7. Cookie などの扱い</h2>
<p>ログインの状態と端末の中の台帳を保つため、ブラウザの保存領域(localStorage・IndexedDB)を使います。アクセス解析と広告のための仕組みは使っていません。カードでのお申し込みでは Stripe の画面に移り、PayPalを選んだ時は料金ページにPayPalの部品を読み込みます。その中で各社がCookieを使うことがあります(各社のプライバシーポリシーに従います)。</p>

<h2>8. このポリシーの変更</h2>
<p>内容を変える時は、このページでお知らせします。大きく変える時は、ログインに使うメールアドレスにもお知らせします。</p>

<h2>9. お問い合わせ</h2>
<p>ZEROICHI WORKS(事業者の名前・住所等は<a href="../../tokushoho.html">特定商取引法に基づく表記</a>)/<a href="mailto:zeroichi.works.jp@gmail.com">zeroichi.works.jp@gmail.com</a></p>"""

TERMS_LATER = "業務の機能のうち、料金ページに「11月中に追加」と示したものは順に追加します。" if ANY_LATER else ""
doc_page("terms", "利用規約", "せどり 利益チェックの利用規約(料金・無料期間・解約・台帳のデータ・古物台帳と法令)。", TERMS.replace("{TERMS_LATER}", TERMS_LATER).replace("{YEAR_TEXT}", YEAR_TEXT).replace("{YEAR_DAYS}", str(YEAR_DAYS)).replace("{FOUNDER_KEEP}", FOUNDER_KEEP).replace("{FOUNDER_N}", str(FOUNDER_N)).replace("{FOUNDER}", FOUNDER))
doc_page("privacy", "プライバシーポリシー", "せどり 利益チェックのプライバシーポリシー(利用目的・安全管理・第三者提供の制限とクラウドへの保存・解約後の保存期間)。", PRIVACY)


# ------------------------------------------------------------------
# 読み物のページ: 利益の仕組み(/sedori/shikumi/)・コンサル・スクールとの違い(/sedori/chigai/)
# 2026-10-29 本部承認(D3・D4)。表現は Gemini 093(法令チェック)に合わせる:
#  - 利益を約束しない(「稼げる」「誰でも月○万円」「元手ゼロ」は使わない)。計算の例のすぐ下に「約束しない」旨を書く
#  - 比べるのは、相手を名指しせず、こちらの事実だけ。相手側について根拠の無い言い切り(「多い」「後出し」など)はしない
# ------------------------------------------------------------------
def read_page(slug: str, title: str, desc: str, body: str, scripts: list[str] | None = None) -> None:
    o = head(title, desc, f"{slug}/", "../", f'data-page="{slug}"')
    o += header("../", slug, "rakuten") + crumb("../", title) + f'<main class="wrap">\n<article class="rdg">\n{body}\n</article>\n</main>\n' + footer("../", ["calc.js", "ui.js"] + (scripts or []))
    write(slug, o)


# 計算の例(ヤフオク→メルカリ)。数字は fees.json と同じ決まりで、ここで計算する(market.js・calc.js と同じ式。tests/sedori/test_funnel.js で照合)
EX_SHIP = next(x for x in FEES["mercari"]["shipping"] if x["id"] == "tq60")
EX_SHIP80 = next(x for x in FEES["mercari"]["shipping"] if x["id"] == "tq80")
EX = {"bid": 3000, "in_ship": 750, "pt_pct": 1, "sell": 6500, "rate": FEES["mercari"]["rate"]}
EX["points"] = EX["bid"] * EX["pt_pct"] // 100
EX["unit"] = EX["bid"] + EX["in_ship"] - EX["points"]
EX["fee"] = int(EX["sell"] * EX["rate"] + 1e-9)
EX["ship"] = EX_SHIP["fee"] + EX_SHIP["material"]
EX["profit"] = EX["sell"] - EX["fee"] - EX["ship"] - EX["unit"]


def _ex_profit(sell: int, ship: int = EX["ship"]) -> int:
    return sell - int(sell * EX["rate"] + 1e-9) - ship - EX["unit"]


EX["be"] = next(p for p in range(1, 100000) if _ex_profit(p) >= 0)
EX["low"] = EX["sell"] - 1000
EX["profit_low"] = _ex_profit(EX["low"])
EX["profit_80"] = _ex_profit(EX["sell"], EX_SHIP80["fee"] + EX_SHIP80["material"])
EX_URL = ("../yahuoku-mercari/?b-bid={bid}&b-ship={in_ship}&b-pt={pt_pct}&b-other=0&b-qty=1&s-price={sell}&s-mat=0&s-other=0&ship=tq60&mk=mercari"
          .format(**EX))


def wf_row(label: str, note: str, amount: int, kind: str, left: int) -> str:
    # 利益の内訳の1行。棒は「その時点の残り」の位置から伸び縮みする(滝の形)。長さと位置は売値に対する割合
    w = max(0.6, abs(amount) / EX["sell"] * 100)
    sign = {"in": "", "out": "−", "plus": "+", "total": "="}[kind]
    return (f'<tr class="wf-{kind}"><th scope="row">{label}<small>{note}</small></th>'
            f'<td class="wf-bar"><span style="margin-left:{left / EX["sell"] * 100:.2f}%;width:{w:.2f}%"></span></td><td class="wf-y">{sign}{amount:,}円</td></tr>')


def _waterfall() -> str:
    rows, rest = [wf_row("売値", "メルカリで売れた値段", EX["sell"], "in", 0)], EX["sell"]
    for label, note, amt in (("販売手数料", f"売値の{int(EX['rate'] * 100)}%", EX["fee"]),
                             ("送料", "らくらくメルカリ便 " + EX_SHIP["label"], EX["ship"]),
                             ("仕入れ値", "ヤフオクの落札価格", EX["bid"]),
                             ("仕入れの送料", "出品者から自分へ", EX["in_ship"])):
        rest -= amt
        rows.append(wf_row(label, note, amt, "out", rest))
    rows.append(wf_row("ポイント", f"落札価格の{EX['pt_pct']}%", EX["points"], "plus", rest))
    rest += EX["points"]
    assert rest == EX["profit"], (rest, EX["profit"])
    rows.append(wf_row("利益", f"売値の{EX['profit'] / EX['sell'] * 100:.1f}%", EX["profit"], "total", 0))
    return "\n".join(rows)


WATERFALL = _waterfall()

ROUTE_FIT = [
    ("rakuten-amazon", "新品をネットで仕入れたい。ポイントの付く日や倍率を調べるのが苦にならない", "在庫を持つのが不安な人。ブランドやカテゴリーによっては Amazon の出品の許可が要る"),
    ("muzaiko-amazon", "在庫を持たずに始めたい。中古の状態を文字で正確に書ける", "仕入れ先の売り切れや遅れでキャンセルが出やすい。販売者は自分・同梱物の除去・返品の受け付けなど Amazon の方針を守る必要がある"),
    ("mercari-calc", "まず家の不用品から始めて、売る流れを覚えたい", "不用品が尽きたら仕入れが要る。仕入れて売るのを繰り返すなら古物商許可が要る"),
    ("yahuoku-mercari", "中古の状態を見極められる。写真と説明文を読み比べるのが苦にならない", "1回の取引で合計1万円以上なら売り手の確認が要る。状態の思い違いで返品になることがある"),
    ("auction-mercari", "古物商許可があり、まとめて仕入れて手早く出品できる", "入会金・参加費がかかる。ブランド品は真贋の見極めが要る"),
]
_LIC = {slug: lic for slug, _n, _s, _d, _k, lic, _f in TOP_ROUTES}
fit_rows = "\n".join(
    f'<tr><th scope="row"><a href="../{slug}/">{dict(ROUTES)[slug]}</a></th><td>{good}</td><td>{bad}</td><td>{_LIC[slug]}</td></tr>'
    for slug, good, bad in ROUTE_FIT)

PREREG_BLOCK = f"""<div class="rd-pre" data-bill="prep">
  <p class="rd-pre-h">{PRE_HEAD}</p>
  <div data-prereg data-compact></div>
</div>"""

SHIKUMI_BODY = f"""<header class="rd-h">
  <p class="rd-k">はじめての方へ</p>
  <h1>せどりで利益が出る仕組み</h1>
  <p class="rd-lead">せどりの利益は「安く買って高く売る」の差だけでは決まりません。売れた値段から販売サイトの手数料と送料が引かれ、仕入れの時に付いたポイントが少し戻ります。手元に残るかどうかは、この足し引きで決まります。このページでは、その仕組みを実際の数字で説明します。</p>
  <nav class="rd-toc" aria-label="このページの目次"><a href="#shiki">1. 利益の式</a><a href="#rei">2. 計算の例</a><a href="#route">3. 仕入れルートの向き不向き</a><a href="#tejun">4. 始める手順</a><a href="#risk">5. リスクとよくある失敗</a><a href="#okane">6. お金の出入りの時期</a><a href="#soft">7. このソフトがすること</a></nav>
</header>

<section class="rd-s" id="shiki">
  <h2><span class="no">1</span>利益の式</h2>
  <p class="rd-formula"><b>利益</b> = 売値 − 販売手数料 − 送料・資材 − 仕入れ値 − 仕入れの送料 − その他の経費 <span class="plus">+ ポイント</span></p>
  <dl class="rd-dl">
    <div><dt>売値</dt><dd>実際に売れた値段です。出品した値段ではありません。値下げして売れたら、下げた値段で計算します。</dd></div>
    <div><dt>販売手数料</dt><dd>メルカリ・Yahoo!オークションは売値の10%。Amazonはカテゴリーごとの率と、FBAを使えば配送代行の手数料がかかります(<a href="../#fees">出典と確認日</a>)。</dd></div>
    <div><dt>送料・資材</dt><dd>お客様へ送る送料と箱・袋の代金。箱が1サイズ大きくなるだけで、送料は100円以上変わります。</dd></div>
    <div><dt>仕入れ値と仕入れの送料</dt><dd>買った値段と、手元に届くまでの送料。まとめて買った時は1個あたりに割ります。</dd></div>
    <div><dt>その他の経費</dt><dd>発送代行の費用、市場の参加費、修理やクリーニングの代金など、その品物のためにかかったお金です。</dd></div>
    <div><dt>ポイント</dt><dd>楽天市場・Yahoo!ショッピングなどで仕入れた時に付くポイント。足してよいのは、実際に使い切れる分だけです。</dd></div>
  </dl>
</section>

<section class="rd-s" id="rei">
  <h2><span class="no">2</span>計算の例</h2>
  <p>中古のホットプレートを、ヤフオクで個人の出品者から落札し、メルカリで売った場合です。</p>
  <div class="rd-ex">
    <table class="wf" aria-label="利益の内訳">
      <tbody>
{WATERFALL}
      </tbody>
    </table>
    <ul class="rd-exn">
      <li>利益が0円になる売値(損益分岐)は <b>{EX['be']:,}円</b>。これより安く売ると赤字です。</li>
      <li>相場が下がって {EX['low']:,}円で売れた場合、利益は <b>{EX['profit_low']:,}円</b> に減ります。</li>
      <li>箱が1サイズ大きく(宅急便80サイズ)なると、同じ{EX['sell']:,}円で売れても利益は <b>{EX['profit_80']:,}円</b> です。</li>
    </ul>
    <p class="rd-note">上の数字は計算の例です。この値段で売れることや、この利益が出ることを約束するものではありません。手数料と送料は{FEES['checked_label']}に確認した料金表によります。</p>
    <div class="row-btns"><a class="btn" href="{EX_URL}">この例を計算機で開く</a><span class="hint">「発送」が「自分で発送」の時の数字です。数字を変えると、その場で計算し直します。</span></div>
  </div>
</section>

<section class="rd-s" id="route">
  <h2><span class="no">3</span>仕入れルートの向き不向き</h2>
  <p>仕入れ先と売り先の組み合わせで、必要なお金・時間・許可が変わります。迷ったら<a href="../#shindan-sec">6問の診断</a>で、合いそうなルートを1つ選んでください。</p>
  <div class="gridwrap"><table class="grid nimg rd-t">
    <thead><tr><th>ルート</th><th>向いている人</th><th>注意すること</th><th>古物商許可</th></tr></thead>
    <tbody>
{fit_rows}
    </tbody>
  </table></div>
</section>

<section class="rd-s" id="tejun">
  <h2><span class="no">4</span>始める手順</h2>
  <ol class="rd-steps">
    <li><b>古物商許可が要るか確かめる</b><span>中古品を仕入れて売ることを繰り返すなら、古物商許可が必要です。自分の不用品を売るだけなら要りません。申請は、住んでいる所を受け持つ警察署で行います。</span></li>
    <li><b>ルートを1つ選ぶ</b><span>最初は1つに絞ります。<a href="../#shindan-sec">診断(6問)</a>で、元手・時間・許可から合いそうなルートが出ます。</span></li>
    <li><b>1件だけ計算する</b><span>売りたい品物の相場(売れた値段)を見て、計算ページに入れます。先に「目標の利益」を決めておくと、仕入れてよい値段の上限が出ます。</span></li>
    <li><b>少しだけ仕入れて、台帳に残す</b><span>計算ページで「仕入れた」を押すと、古物台帳に1行入ります。1万円以上の中古品は、売り手の確認を入れるまで印が付きます。</span></li>
    <li><b>売れたら記録して、月末に見直す</b><span>「売れた」を押すと売却の欄が埋まります。月末に、見込みと実際の利益の差を見て、次の仕入れを決めます。</span></li>
  </ol>
</section>

<section class="rd-s" id="risk">
  <h2><span class="no">5</span>リスクとよくある失敗</h2>
  <div class="rd-risk">
    <div><h3>値下がり</h3><p>同じ品物の出品が増えると相場は下がります。上の例では、1,000円下がるだけで利益は{EX['profit']:,}円から{EX['profit_low']:,}円になります。</p></div>
    <div><h3>売れ残り</h3><p>売れるまで、仕入れたお金は戻りません。置き場所も要ります。売れない時の値下げの下限(損益分岐)を、仕入れる前に決めておきます。</p></div>
    <div><h3>手数料・送料の見落とし</h3><p>箱のサイズ、仕入れの送料、振込の手数料。小さな費用の見落としが、薄い利益を消します。</p></div>
    <div><h3>販売サイトの規約</h3><p>Amazonのカテゴリーごとの出品許可、無在庫の販売の方針、他人の写真や説明文を使わないこと。違反するとアカウントが止まることがあります。</p></div>
    <div><h3>古物営業法</h3><p>許可、1万円以上(品物によっては金額を問わず)の売り手の確認、取引の記録。<a href="../guide/honnin-kakunin/">売り手の確認の手引き</a>にまとめています。</p></div>
    <div><h3>状態の思い違い・偽物</h3><p>中古品は、写真で分からない傷や不具合があります。ブランド品は真贋の見極めが要ります。返品や悪い評価につながります。</p></div>
  </div>
</section>

<section class="rd-s" id="okane">
  <h2><span class="no">6</span>お金の出入りの時期</h2>
  <p>仕入れのお金を払う日と、売上が入る日はずれます。売上は販売サイトごとに決まった周期で入金されるので、売れてもすぐには使えません。クレジットカードで仕入れる時は、引き落としの日までに売上が入るかを先に確かめてください。最初は、手元のお金で払える範囲で始めるのが安全です。台帳に仕入れ日と売却日を残しておくと、お金が戻るまでの日数が分かります。</p>
</section>

<section class="rd-s" id="soft">
  <h2><span class="no">7</span>このソフトがすること・しないこと</h2>
  <div class="rd-two">
    <div><h3>すること</h3><ul>
      <li>手数料・送料・ポイントを引いた利益の計算(5つのルート)</li>
      <li>目標の利益に届く売値と、仕入れ値の上限</li>
      <li>古物台帳への記録と、CSV・Excelへの書き出し</li>
      <li>有料版: 台帳のクラウド保存、売上・経費・月ごとの利益、確定申告用の数字</li>
    </ul></div>
    <div><h3>しないこと</h3><ul>
      <li>何を仕入れれば売れるかを教えること</li>
      <li>メルカリ・ヤフオク・Amazonのページの自動の読み取り</li>
      <li>利益や販売の保証</li>
    </ul></div>
  </div>
  <p>迷った時は、ソフトの中の<a href="#ai" data-ai-open>AIに相談</a>で、このページの計算の決まりを前提に、無料のAIへ相談できます。人が教えるサービスとの違いは<a href="../chigai/">コンサル・スクールとの違い</a>にまとめています。</p>
  <div class="row-btns rd-cta"><a class="btn" href="../">無料で計算してみる(登録なし)</a><a class="btn ghost" href="../daicho/">台帳を見る</a><a class="btn ghost" href="../plans/">料金を見る</a></div>
  {PREREG_BLOCK}
</section>"""

CHIGAI_ROWS = [
    ("料金", "総額・支払いの回数・追加の費用が、申し込む前に分かるか",
     f'月{yen(P_LM)}から(税込)。ほかの費用はかかりません。金額と条件は<a href="../plans/">料金ページ</a>と<a href="../../tokushoho.html">特定商取引法に基づく表記</a>に全部載せています。'),
    ("成果の言い方", "収入の例を出している場合、その条件と根拠が書かれているか",
     '利益を約束しません。利益が出る仕組みを、実際の数字の例で<a href="../shikumi/">説明</a>しているだけです。'),
    ("試せる範囲", "お金を払う前に、中身を自分で確かめられるか",
     '計算と台帳は、登録なしで全部使えます。有料版も、月払いは14日無料です。'),
    ("数字の根拠", "手数料や送料の出典と、確かめた日が書かれているか",
     f'計算に使う手数料・送料は、<a href="../#fees">出典と確認日</a>({FEES["checked_label"]})を公開しています。計算は手計算の例で検算し、目安には「目安」と書いています。'),
    ("リスクの説明", "値下がり・売れ残り・規約・法律の注意が、先に書かれているか",
     '<a href="../shikumi/#risk">リスクとよくある失敗</a>を、仕組みの説明と同じページに載せています。'),
    ("申し込みの方法", "電話や面談なしで、条件を読んで自分で決められるか",
     '電話や面談はしません。申し込みも解約も、このサイトの中で済みます。'),
    ("解約と返金", "解約のやり方と返金の条件が、申し込む前に分かるか",
     f'マイページの「解約する」か、メール1通で解約できます。年払いは1回目のお支払いから{YEAR_DAYS}日以内の解約で全額返金(その日で終了)。{YEAR_DAYS + 1}日目からは返金はなく、期間の終わりまで使えて、次の更新はされません。'),
    ("データ", "やめた後も、自分のデータを持ち出せるか",
     '台帳はいつでもCSV・Excelで書き出せます。解約後もクラウドの台帳は3年間保管し、書き出せます。'),
    ("運営者", "事業者と連絡先が分かるか",
     '<a href="../../tokushoho.html">特定商取引法に基づく表記</a>を公開しています(氏名・住所はご請求があれば遅滞なく開示)。お問い合わせは<a href="mailto:zeroichi.works.jp@gmail.com">メール</a>で受けています。'),
]
chigai_rows = "\n".join(
    f'<tr><th scope="row"><span class="no">{i}</span>{k}</th><td>{q}</td><td>{a}</td></tr>'
    for i, (k, q, a) in enumerate(CHIGAI_ROWS, 1))

CHIGAI_BODY = f"""<header class="rd-h">
  <p class="rd-k">申し込む前に</p>
  <h1>コンサル・スクールと、このソフトの違い</h1>
  <p class="rd-lead">せどりを始める時、人が教えるコンサルやスクールを考える方もいます。どちらが良い悪いではなく、売っているものが違います。比べて決められるように、このソフトの条件をこのページに全部出しています。</p>
</header>

<section class="rd-s">
  <h2>売っているものの違い</h2>
  <div class="rd-vs">
    <div class="vs-a"><p class="vs-k">人が教えるサービス(コンサル・スクール)</p>
      <dl><div><dt>売っているもの</dt><dd>講師の知識と時間(指導・相談・添削)</dd></div><div><dt>料金</dt><dd>講師の時間に対する料金。内容と期間で決まります</dd></div><div><dt>向いている人</dt><dd>人に直接教わりながら進めたい人</dd></div></dl></div>
    <div class="vs-b"><p class="vs-k">このソフト(せどり 利益チェック)</p>
      <dl><div><dt>売っているもの</dt><dd>毎日の計算と記録を受け持つ道具</dd></div><div><dt>料金</dt><dd>月{yen(P_LM)}〜{yen(P_BM)}(税込)。年払いは{PAY_MONTHS}か月分の料金で1年</dd></div><div><dt>向いている人</dt><dd>自分で調べて決め、計算と記録を間違えずに続けたい人</dd></div></dl></div>
  </div>
</section>

<section class="rd-s">
  <h2>申し込む前に確かめたい9つのこと</h2>
  <p>どのサービスを選ぶ時にも使える確かめ方です。右の列は、このソフトの答えです。</p>
  <div class="gridwrap"><table class="grid nimg rd-t rd-cmp">
    <thead><tr><th>項目</th><th>確かめたいこと</th><th>このソフトの場合</th></tr></thead>
    <tbody>
{chigai_rows}
    </tbody>
  </table></div>
</section>

<section class="rd-s">
  <h2>一人で決める時の手がかり</h2>
  <div class="rd-two">
    <div><h3>AIに相談</h3><p>ソフトの中の「AIに相談」から、当店の計算の決まりを前提にした相談文をコピーして、無料のGemini・ChatGPTに相談できます。計算ページの数字も相談文に入ります。<a href="#ai" data-ai-open>開いてみる</a></p></div>
    <div><h3>仕組みと手引き</h3><p><a href="../shikumi/">利益が出る仕組み</a>(計算の例・失敗のパターン)と、<a href="../guide/">手引き</a>(手数料・古物台帳・売り手の確認)を、登録なしで読めます。</p></div>
  </div>
  <p class="hint">契約のことで困った時は、消費者ホットライン「188」に電話すると、お近くの消費生活センターなどの相談窓口につながります。</p>
</section>

<section class="rd-s rd-end">
  <p class="rd-quote">私たちが売っているのは「稼げる情報」ではありません。毎日の計算と記録を、間違えずに続けるための道具です。合うかどうかは、登録なしの無料の範囲で確かめてから決めてください。</p>
  <div class="row-btns rd-cta"><a class="btn" href="../">無料で計算してみる(登録なし)</a><a class="btn ghost" href="../plans/">料金と条件を見る</a></div>
  {PREREG_BLOCK}
</section>"""

read_page("shikumi", "せどりで利益が出る仕組み",
          "せどりの利益は、売値から販売手数料・送料・仕入れ値を引き、ポイントを足して決まります。実際の数字の計算例、5つの仕入れルートの向き不向き、始める手順、リスクとよくある失敗を説明します。",
          SHIKUMI_BODY)
read_page("chigai", "コンサル・スクールとの違い",
          "人が教えるコンサル・スクールと、毎日の計算と記録を受け持つソフトの違い。申し込む前に確かめたい9つのこと(料金・成果の言い方・試せる範囲・数字の根拠・リスク・申し込み・解約と返金・データ・運営者)と、このソフトの答え。",
          CHIGAI_BODY)


# ---- 手書きのページ(紹介・読み取り・貼り付け用の計算機)の canonical・OGP を SITE_URL にそろえる ----
# 絶対の住所が要るのはここだけ。ページ同士のリンクは相対で書いてあるので、独自ドメインに移っても直さなくてよい
_ABS = _re.compile(r'(<(?:link rel="canonical"|meta property="og:(?:url|image)")[^>]*?(?:href|content)=")https?://[^"]*?/sedori/')
for _hp in ("lp/index.html", "scan/index.html", "widget/mercari/index.html"):
    _f = S / _hp
    if _f.exists():
        _t = _f.read_text(encoding="utf-8")
        _n = _ABS.sub(lambda m: m.group(1) + BASE_URL, _t)
        if _n != _t:
            _f.write_text(_n, encoding="utf-8")


# ---- サイトマップ ----
# 手書きのページ(紹介・読み取り・手引き)もサイトマップに載せる(このスクリプトでは書き出さない)
HAND = [("lp/", "0.9"), ("scan/", "0.7"), ("guide/", "0.6"), ("guide/mercari-tesuryo/", "0.7"), ("guide/kobutsu-daicho-excel/", "0.7"), ("guide/honnin-kakunin/", "0.7"), ("guide/neduke/", "0.7")]
urls = [("", "0.9")] + [(f"{slug}/", "0.8") for slug, _ in ROUTES] + [("daicho/", "0.5")] + [(u, p) for u, p in HAND if (S / u / "index.html").exists()] + [("shikumi/", "0.8"), ("chigai/", "0.6"), ("plans/", "0.6"), ("terms/", "0.2"), ("privacy/", "0.2")]
sm = "\n".join(f"<url><loc>{BASE_URL}{u}</loc><lastmod>{FEES['checked']}</lastmod><priority>{p}</priority></url>" for u, p in urls)
(S / "sitemap.xml").write_text(f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{sm}\n</urlset>\n', encoding="utf-8")
# ---- テスト用の写しは、手書きのページも含めて全ページに noindex ----
if NOINDEX:
    for _f in S.rglob("*.html"):
        _t = _f.read_text(encoding="utf-8")
        _n = with_noindex(_t)
        if _n != _t:
            _f.write_text(_n, encoding="utf-8")
print("built", OUT, ["top"] + [slug for slug, _ in ROUTES] + ["daicho", "plans", "mypage", "terms", "privacy", "shikumi", "chigai"])
