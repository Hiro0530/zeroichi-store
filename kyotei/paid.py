"""有料版(会員)への入口: 無料メールの登録・有料版の中身(前日の実データの見本)・料金・届き方・FAQ・申込み、と利用規約ページ。

site_gen.py(見た目の担当)から呼ばれる。ここだけで完結させ、site_gen.py 側は呼び出し3か所だけにする。
決めごと(docs/kyotei_paid_plan.md 非公開リポジトリ arbitrage-scout):
- 当たる・儲かる・元が取れる・必ず、は書かない。回収率が100%を下回っていることを、有料版の説明の中でも書く。
- 有料版の予想そのものは無料版と同じ(量と細かさが違うだけ)。
- 正式価格は「予定」と日付を書き、その日から本当にその値段で売る(景品表示法: 将来の価格との比較)。架空の通常価格は書かない。
- 20歳未満は登録・購入不可。のめり込みの相談窓口を載せる。
- 色: 朱(赤)は的中と払戻だけ。申込みのボタンは墨(黒)。
"""
from __future__ import annotations

import html
import itertools
from datetime import date, datetime, timedelta, timezone
from urllib.parse import quote

JST = timezone(timedelta(hours=9))
MAIL = "zeroichi.works.jp@gmail.com"

# ---- 販売の設定(ここを書き換えるだけでページの文言が切り替わる) ----
SALES_OPEN = date(2026, 11, 23)       # 有料版の販売開始(note)
FOUNDING_END = date(2026, 12, 31)     # 創業メンバーの受付の最終日
FOUNDING_CAP = 100                    # 創業メンバーの定員
FOUNDING_PRICE = 3980
REGULAR_FROM = date(2027, 1, 1)       # 正式価格の開始日(この日から新規は REGULAR_PRICE で売る)
REGULAR_PRICE = 9800
NOTE_URL = ""                         # note のメンバーシップのURL(オーナーが作ったら入れる。空なら先行登録のボタンを出す)
MAIL_LIVE = False                     # 毎朝のメール配信が動き出したら True(Gmail のアプリパスワード設定後)
MAIL_START_TEXT = "11月上旬"          # MAIL_LIVE=False のときに出す配信開始の目安

TERMS = "terms.html"


def esc(s) -> str:
    return html.escape(str(s))


def mailto(subject: str, body: str) -> str:
    return f"mailto:{MAIL}?subject={quote(subject)}&body={quote(body)}"


FREE_MAILTO = mailto("[KYOTEI-FREE] 毎朝の自信ありメール 登録",
                     "このまま送信してください。\n\n□ 20歳以上です\n\n(このメールアドレスに、毎朝の「自信あり」5レースと前日の答え合わせを送ります。止めるときは件名に「配信停止」と書いて返信してください)")
PRE_MAILTO = mailto("[KYOTEI-PRE] 有料版の先行登録",
                    "このまま送信してください。\n\n□ 20歳以上です\n\n(販売開始の日に、申込みのリンクをこのアドレスへお送りします。登録だけでお金はかかりません)")


def jd(d: date, wd: bool = True) -> str:
    return f"{d.year}年{d.month}月{d.day}日" + (f"({'月火水木金土日'[d.weekday()]})" if wd else "")


def md(d: date) -> str:
    return f"{d.month}月{d.day}日"


def today() -> date:
    return datetime.now(JST).date()


def phase(t: date | None = None) -> str:
    """pre(販売前)/founding(創業メンバー受付中)/regular(正式価格)"""
    t = t or today()
    if t < SALES_OPEN or not NOTE_URL:
        return "pre"
    return "founding" if t <= FOUNDING_END else "regular"


# ---- 3連単の上位10点(公開している6艇の1着確率から、予想と同じ計算で出す) ----
def trifecta_all(probs, lam=(1.0, 1.0)) -> dict:
    l2, l3 = lam
    P = [min(max(float(p), 1e-6), 1.0) for p in probs]
    Q2 = [p ** l2 for p in P]
    Q3 = [p ** l3 for p in P]
    out = {}
    for a, b, c in itertools.permutations(range(6), 3):
        s2 = sum(Q2) - Q2[a]
        s3 = sum(Q3) - Q3[a] - Q3[b]
        out[f"{a+1}-{b+1}-{c+1}"] = P[a] * Q2[b] / s2 * Q3[c] / s3
    s = sum(out.values())
    return {k: v / s for k, v in out.items()}


def top10(probs, lam=(1.0, 1.0), n: int = 10) -> list:
    t = trifecta_all(probs, lam)
    return sorted(t.items(), key=lambda kv: -kv[1])[:n]


def fair_odds(p: float) -> str:
    """確率から計算した倍率の線(1÷確率)。オッズがこれより上なら、確率の上では割安という目安。"""
    return f"{1 / p:.1f}" if p > 0 else "—"


# ---- 見た目 ----
CSS = """
.slim{margin:10px 0 0;font-size:13.5px}
.slim a{font-weight:700}
.pay-sec{border-top:3px solid var(--ink);margin-top:34px}
.mailbox{border:2px solid var(--ink);padding:16px 14px 14px;margin-top:30px}
.mailbox h2{font-size:20px}
.mailbox p{margin-top:8px;font-size:14.5px}
.btn{display:inline-block;background:var(--ink);color:var(--paper);text-decoration:none;font-weight:700;font-size:16px;padding:13px 18px;border-radius:3px;margin-top:12px;min-height:48px}
.btn:hover{opacity:.88}
.btn.sub{background:transparent;color:var(--ink);border:2px solid var(--ink);padding:11px 16px}
.fine{font-size:12.5px;color:var(--sub);margin-top:8px}
.status{display:inline-block;font-size:12.5px;border:1px solid var(--rule2);padding:2px 7px;margin-top:10px}
.cmp td{font-size:13.5px}.cmp td.c,.cmp th.c{text-align:center;white-space:nowrap}
.cmp td.c b{font-weight:700}
.smp{margin-top:14px}
.smp .rh{font-weight:700;font-size:15px;margin:16px 0 4px}
.smp .rh .n{font-size:18px}
.smp td{padding:5px 5px}
.smp tr.in td{background:var(--shu-soft)}
.smp .res{font-size:13.5px;margin:6px 0 0}
.price{border-collapse:collapse;width:100%;margin-top:8px}
.price th{background:none;color:var(--ink);font-size:14px;font-weight:700;padding:12px 6px 12px 0;vertical-align:top;white-space:normal;width:42%}
.price td{font-size:13.5px;padding:12px 0}
.price .yen-b{font:700 30px/1 var(--num)}
.price .yen-b small{font:700 14px var(--jp);margin-left:2px}
.steps{margin:8px 0 0;padding-left:1.4em;font-size:14px}.steps li+li{margin-top:6px}
.faq details{border-bottom:1px solid var(--rule)}
.faq summary{cursor:pointer;padding:12px 0;font-weight:700;font-size:14px;list-style:none}
.faq summary::-webkit-details-marker{display:none}
.faq summary::before{content:"Q ";color:var(--sub)}
.faq details p{font-size:13.5px;padding:0 0 12px;color:var(--ink)}
.apply{border:2px solid var(--ink);padding:16px 14px;margin-top:24px}
@media (min-width:980px){.pay-sec,.mailbox{max-width:760px}}
"""


def slim_html() -> str:
    """題字の下(当たりの帯の後)に置く一行。下の登録欄へ飛ぶだけ。"""
    return ("<p class=slim>毎朝の「自信あり」5レースを、<a href='#mail'>メールで受け取る(無料)</a>"
            f"/<a href='#paid'>有料版について</a></p>")


def mail_box_html() -> str:
    """無料メールの登録(リードの入口)。"""
    st = ("<span class=status>配信中。毎朝、予想を出したら1通</span>" if MAIL_LIVE else
          f"<span class=status>登録受付中・配信は{esc(MAIL_START_TEXT)}に始める予定</span>")
    after = "" if MAIL_LIVE else "<p class=fine>配信を始める日は、登録した方にメールでお知らせします。</p>"
    return ("<section id=mail class=mailbox aria-labelledby=h-mail><h2 id=h-mail>毎朝の「自信あり」をメールで(無料)</h2>"
            "<p>その日の「自信あり」5レースと、前の日の答え合わせを、予想を出したら1通にまとめて送ります。"
            "ページを開かなくても、締切前に見られます。</p>" + st + after +
            f"<p><a class=btn href='{esc(FREE_MAILTO)}'>メールで登録する(無料)</a></p>"
            f"<p class=fine>メールのアプリが開きます。「20歳以上です」の行を残したまま送信してください。20歳未満の方は登録できません。"
            f"開かないときは、件名に「競艇メール登録」と書いて {esc(MAIL)} へ送ってください。"
            "メールアドレスは配信のためだけに使います(<a href='../privacy.html'>プライバシーポリシー</a>)。"
            "止めるときは、届いたメールに「配信停止」と返信するだけです。</p></section>")


def sample_html(prev: dict | None, r: dict | None, lam) -> str:
    """有料版の見本: 前日の朝に公開した確率から作った3連単の上位10点と目安オッズ、翌朝の結果。
    予想の計算(λ)が公開当時と違う日は、公開した上位3点と計算が一致するレースだけを使う。"""
    if not prev or not r:
        return ""
    res = {x["key"]: x for x in r["races"]}
    ok, n, h10, pay10 = [], 0, 0, 0
    for x in prev["races"]:
        y = res.get(x["key"])
        t10 = top10(x["probs"], lam)
        same = [c for c, _ in t10[:3]] == [c for c, _ in x["trifecta"]]
        if not y or not y.get("actual") or not same:
            continue
        n += 1
        combos = [c for c, _ in t10]
        if y["actual"] in combos:
            h10 += 1
            pay10 += int(y.get("trifecta_payout") or 0)
        ok.append((x, y, t10))
    if not ok or n < 20:
        return ""
    ok.sort(key=lambda z: (-max(z[0]["probs"]), z[0]["close"]))
    # 自信ありの上位から2レース(1つは10点の中に結果があったもの、1つは無かったものを選べるなら選ぶ)
    pick = []
    inn = [z for z in ok if z[1]["actual"] in [c for c, _ in z[2]]]
    out = [z for z in ok if z[1]["actual"] not in [c for c, _ in z[2]]]
    if inn:
        pick.append(inn[0])
    if out:
        pick.append(out[0])
    pick.sort(key=lambda z: z[0]["close"])
    pub = datetime.fromisoformat(prev["published_at"])
    d = date.fromisoformat(prev["date"])
    o = ["<div class=smp>"
         f"<p class=cap>{esc(md(d))}の朝{pub.hour}:{pub.minute:02d}に公開した確率から作った、有料版と同じ形の見本です。"
         "確率は公開した数字のままで、レースの後に作り直したものではありません。</p>"]
    for x, y, t10 in pick:
        actual = y["actual"]
        rank = next((i + 1 for i, (c, _) in enumerate(t10) if c == actual), None)
        o.append(f"<p class=rh>{esc(x['venue_name'])}<span class=n>{x['race']}R</span> "
                 f"<span class=cap style='display:inline'>{esc(x['close'][11:16])}締切・◎{x['pick']}号艇 1着率{max(x['probs'])*100:.0f}%</span></p>"
                 "<div class=tw><table><thead><tr><th>順</th><th>3連単</th><th class=r>確率</th><th class=r>目安オッズ</th></tr></thead><tbody>")
        for i, (c, p) in enumerate(t10):
            o.append(f"<tr{' class=in' if c == actual else ''}><td class=n>{i+1}</td><td class=n>{esc(c)}</td>"
                     f"<td class='r n'>{p*100:.1f}%</td><td class='r n'>{fair_odds(p)}倍</td></tr>")
        o.append("</tbody></table></div>")
        pay = int(y.get("trifecta_payout") or 0)
        if rank:
            o.append(f"<p class=res>結果 {esc(actual)}(3連単 <span class='pay hit'>{pay:,}<small>円</small></span>)。10点の{rank}番目にありました。</p>")
        else:
            o.append(f"<p class=res>結果 {esc(actual)}(3連単 {pay:,}円)。10点の中にはありませんでした。</p>")
    roi = pay10 / (n * 1000) if n else 0
    o.append(f"<p class=cap>この日、結果が上位10点の中にあったのは{n}レース中{h10}レース({h10/n*100:.0f}%)。"
             f"10点を100円ずつ全部買っていたら、仮の回収率は{roi*100:.0f}%でした"
             + ("(100%を下回り、平均では負け)。" if roi < 1 else "(この日はたまたま100%を超えましたが、毎日こうなるわけではありません)。")
             + "目安オッズは「1÷確率」で、実際のオッズがこれより高ければ、確率の上では割安という線です。確率そのものがずれることもあります。</p></div>")
    return "".join(o)


def compare_html() -> str:
    rows = [
        ("全レースの◎○▲・◎の1着率・3連単の上位3点", "ページ", "メール+ページ"),
        ("今日の「自信あり」5レース", "ページ・メール", "○"),
        ("全レースの3連単 上位10点と、それぞれの確率", "—", "○"),
        ("目安オッズ(1÷確率。これより高い倍率なら確率の上では割安という線)", "—", "○"),
        ("6艇すべての1着率と、選手の公開データ(級別・勝率・モーター2連率)", "◎だけ", "○"),
        ("自信度S・Aのレースの一覧(締切順)", "表の印だけ", "○"),
        ("週1の検証レポート(場・自信度ごとの的中率と仮の回収率。100%未満もそのまま)", "—", "毎週月曜"),
        ("全予想・全結果のCSV(ご自分で検証できます)", "—", "毎月1日"),
    ]
    o = ["<div class=tw><table class=cmp><thead><tr><th></th><th class=c>無料</th><th class=c>有料版</th></tr></thead><tbody>"]
    for a, b, c in rows:
        o.append(f"<tr><td>{esc(a)}</td><td class=c>{esc(b)}</td><td class=c><b>{esc(c)}</b></td></tr>")
    o.append("</tbody></table></div>")
    return "".join(o)


def price_html(ph: str) -> str:
    if ph == "regular":
        return ("<table class=price><tr><th>月額</th>"
                f"<td><span class=yen-b>{REGULAR_PRICE:,}<small>円</small></span>(税込)<br>"
                f"創業メンバー(〜{esc(md(FOUNDING_END))}の受付分)は、続けている間 月{FOUNDING_PRICE:,}円のままです。</td></tr></table>")
    return ("<table class=price>"
            f"<tr><th>創業メンバー<br><span class=fine style='font-weight:400'>先着{FOUNDING_CAP}人・受付は{esc(md(SALES_OPEN))}〜{esc(md(FOUNDING_END))}</span></th>"
            f"<td><span class=yen-b>{FOUNDING_PRICE:,}<small>円/月</small></span>(税込)<br>続けている間は、ずっとこの値段のままです。"
            f"{FOUNDING_CAP}人に達した時点か{esc(md(FOUNDING_END))}の、早いほうで受付を締め切ります。</td></tr>"
            f"<tr><th>正式価格(予定)</th><td><span class=yen-b>{REGULAR_PRICE:,}<small>円/月</small></span>(税込)<br>"
            f"{esc(jd(REGULAR_FROM, False))}以降に新しく入る方の値段です。</td></tr></table>"
            "<p class=fine>お支払いは note のメンバーシップ(クレジットカードなど note で使える方法)。毎月自動で更新され、note の画面からいつでも解約できます。"
            "日割りの返金はありません。</p>")


def faq_html(model: dict | None = None) -> str:
    qa = [
        ("有料版にすると、当たりやすくなりますか?",
         "いいえ。予想そのものは無料のページと同じです。有料版は、同じ予想を細かく(3連単10点・目安オッズ・6艇すべての確率)まとめて、毎朝届けるものです。"),
        ("有料版で儲かりますか?",
         "お約束できません。これまでの答え合わせでは、◎の単勝も3連単も、100円ずつ買い続けた場合の回収率は100%を下回っています(上の「これまでの成績」)。"
         "ボートレースの払戻率はおよそ75%なので、買い続けると平均では減っていきます。"),
        ("締切直前の情報(展示タイム・オッズ)は入りますか?",
         "入りません。公式サイトに大量のアクセスをしないため、直前情報とオッズは取りに行っていません。目安オッズと実際のオッズを見比べるのは、ご自身でお願いします。"),
        ("メールはいつ届きますか?",
         "その日の予想を出したらすぐ、だいたい朝6時〜9時ごろです(予想を出す時刻は日によって前後し、ページの「公開」に毎日書いています)。"
         "送り主は " + MAIL + " です。"),
        ("やめるときは?",
         "note のメンバーシップの画面から、いつでも解約できます。次の更新日から請求が止まります。メールは「配信停止」と返信すれば、その日のうちに止めます。"),
        ("舟券の購入の代行や、お金を預かることはありますか?",
         "ありません。舟券は、ご自身で公式の投票サービスなどからお買い求めください。"),
        ("20歳未満でも登録できますか?",
         "できません。舟券を買えるのは20歳からです。無料のメールも有料版も、20歳以上の方に限ります。"),
    ]
    s_t = next((t for t in ((model or {}).get("eval") or {}).get("tiers") or [] if t.get("tier") == "S" and t.get("races")), None)
    if s_t:
        days = ((model or {}).get("eval") or {}).get("test_days")
        span = f"{days}日間" if days else "期間"
        qa.insert(2, ("自信度Sは、よく当たるのでは?",
                      f"学習に使っていない{span}の検証では、Sの◎の1着率は{s_t['hit']*100:.1f}%でした。ただ、同じレースで毎回1号艇を選んでも{s_t['lane1']*100:.1f}%で、"
                      + ("ほとんど差がありません。" if abs(s_t['hit'] - s_t['lane1']) < 0.02 else "差はそれほど大きくありません。")
                      + f"払戻が安いレースが多く、単勝の仮の回収率は{s_t['roi_win']*100:.1f}%です。「1号艇が逃げやすいレース」を見分ける目安としてお使いください。"))
    return "<div class=faq>" + "".join(f"<details><summary>{esc(q)}</summary><p>{esc(a)}</p></details>" for q, a in qa) + "</div>"


def apply_html(ph: str) -> str:
    if ph == "pre":
        return ("<div class=apply id=apply><h3 style='margin-top:0'>先行登録(無料)</h3>"
                f"<p>有料版の販売は{esc(jd(SALES_OPEN))}からです。先行登録の方には、販売を始める日に申込みのリンクをメールでお送りします。"
                "登録してもお金はかかりませんし、申し込まなくてもかまいません。</p>"
                f"<p><a class=btn href='{esc(PRE_MAILTO)}'>有料版の先行登録をする(無料)</a></p>"
                f"<p class=fine>「20歳以上です」の行を残したまま送信してください。開かないときは、件名に「有料版 先行登録」と書いて {esc(MAIL)} へ。"
                f"<a href='{TERMS}'>利用規約と特定商取引法に基づく表記</a></p></div>")
    label = "noteで創業メンバーになる" if ph == "founding" else "noteで申し込む"
    return ("<div class=apply id=apply><h3 style='margin-top:0'>申込み</h3>"
            f"<p><a class=btn href='{esc(NOTE_URL)}' rel=noopener>{label}</a></p>"
            f"<p class=fine>お支払いと解約は note で行います。申し込む前に<a href='{TERMS}'>利用規約と特定商取引法に基づく表記</a>をお読みください。"
            "20歳未満の方は申し込めません。</p></div>")


def offer_html(prev: dict | None, r: dict | None, model: dict | None) -> str:
    """有料版のまとまり(ページの下の方、成績の後に置く)。"""
    lam = tuple((model or {}).get("lambda") or (1.0, 1.0))
    ph = phase()
    head_small = (f"{esc(md(SALES_OPEN))}から販売の予定" if ph == "pre" else
                  (f"創業メンバー受付中(〜{esc(md(FOUNDING_END))})" if ph == "founding" else "受付中"))
    o = [f"<section id=paid class=pay-sec aria-labelledby=h-paid><h2 id=h-paid>有料版(会員)<small>{head_small}</small></h2>"
         "<p class=cap style='font-size:14px;color:var(--ink)'>無料のページで出しているのは、各レースの◎○▲と3連単の上位3点です。"
         "有料版では、同じ予想を細かくして、毎朝メールで届けます。予想が変わるわけではなく、当たりやすくなるものでもありません。</p>",
         "<h3>毎朝届くもの</h3>", compare_html()]
    smp = sample_html(prev, r, lam)
    if smp:
        o += ["<h3>有料版の見本(前日の実際の予想と結果)</h3>", smp]
    o += ["<h3>料金</h3>", price_html(ph),
          "<h3>届き方</h3><ol class=steps>"
          f"<li>note のメンバーシップで申し込む({esc(md(SALES_OPEN))}から)。</li>"
          "<li>note のメンバー向けページにある「メール登録」のリンクを開き、そのまま送信。</li>"
          f"<li>次の朝から、予想を出したらすぐ {esc(MAIL)} からメールが届きます(全レースの表はメールに付けたファイルで)。</li></ol>",
          "<h3>よくある質問</h3>", faq_html(model), apply_html(ph), "</section>"]
    return "".join(o)


def footer_links() -> str:
    return f"<a href='{TERMS}'>有料版の利用規約・特定商取引法に基づく表記</a>"


# ---- 利用規約と特定商取引法の表記(kyotei/site/terms.html) ----
def terms_page() -> str:
    rows = [
        ("販売事業者", "ZEROICHI WORKS(個人事業主・代表 古林浩敬)"),
        ("運営責任者", "古林 浩敬"),
        ("所在地・電話番号", "請求があった場合は遅滞なく開示します。お問い合わせはメールでお願いします。"),
        ("メールアドレス", f"<a href='mailto:{MAIL}'>{MAIL}</a>"),
        ("サービス名", "AI舟券 答え合わせ帳 有料版(会員)。ボートレースの予想(統計モデルによる確率の計算結果)を毎朝メールで届ける情報サービスです。"),
        ("販売価格", f"創業メンバー: 月額{FOUNDING_PRICE:,}円(税込)。受付は{jd(SALES_OPEN, False)}〜{jd(FOUNDING_END, False)}、先着{FOUNDING_CAP}人。続けている間はこの値段のままです。<br>"
                     f"正式価格: 月額{REGULAR_PRICE:,}円(税込)。{jd(REGULAR_FROM, False)}以降の新規のお申込みに適用する予定です。"),
        ("販売価格以外の費用", "インターネット接続・メール受信の通信費はお客様のご負担です。舟券の購入代金は含みません(当方は舟券の購入・代行をしません)。"),
        ("お支払い方法・時期", "note株式会社が運営する「note」のメンバーシップでのお支払い(note で使える方法)。申込み時に初回、以降は毎月 note の定める日に自動で請求されます。"),
        ("提供の時期", "お申込みとメール登録の確認後、次の朝の配信から。毎日、その日の予想を公開したあと(通常 朝6時〜9時ごろ)にメールでお送りします。"),
        ("解約", "note のメンバーシップの画面から、いつでも解約できます。次回の請求日から請求が止まります。支払い済みの期間の日割りの返金はありません。"),
        ("返金", "デジタルの情報サービスのため、お申込み後の返金はお受けしていません。ただし、当方の不具合で配信できなかった日が続いた場合は、ご連絡をいただければその分を返金します(手続きは note の定めによります)。"),
        ("動作環境", "メールを受信できること。添付のHTML・CSVファイルを開けること(スマートフォン・パソコン)。"),
    ]
    terms = [
        "このサービスは、BOAT RACE公式が公開しているデータから統計モデルで計算した予想と、その答え合わせの情報を提供するものです。的中や利益を保証するものではありません。過去の成績は将来の成績を約束しません。",
        "お申込み・ご利用は20歳以上の方に限ります。舟券の購入は20歳からです。",
        "舟券を買うかどうか、いくら買うかは、ご自身の判断と責任で決めてください。当方は舟券の購入・代行・資金の預かり・投票の指示はしません。",
        "配信内容(メール・添付ファイル)を、会員以外の方に転送・公開・販売しないでください。違反があった場合は、配信を止めることがあります。",
        "データの公開が遅れた日や、公式の開催の中止・番組の変更があった場合は、配信が遅れたり、一部のレースが抜けたりします。",
        "予想の方法・配信の内容を変える場合や、サービスをやめる場合は、1か月前までにメールとこのページでお知らせします。",
        "お預かりしたメールアドレスは配信と連絡のためだけに使い、第三者には渡しません(プライバシーポリシーに従います)。",
    ]
    tr = "".join(f"<tr><th>{esc(a)}</th><td>{b}</td></tr>" for a, b in rows)
    li = "".join(f"<li>{esc(x)}</li>" for x in terms)
    return f"""<!doctype html><html lang=ja><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>
<title>有料版の利用規約</title><meta name=robots content=noindex><meta name=theme-color content='#ffffff'>
<style>
:root{{--paper:#fff;--ink:#222426;--sub:#62676d;--rule:#d9dcdf;--head:#f2f3f1;--navy:#17407e;color-scheme:light}}
@media (prefers-color-scheme:dark){{:root:not([data-theme=light]){{--paper:#17191c;--ink:#e9e9e6;--sub:#a3a8ad;--rule:#33373c;--head:#202327;--navy:#93b8ff;color-scheme:dark}}}}
:root[data-theme=dark]{{--paper:#17191c;--ink:#e9e9e6;--sub:#a3a8ad;--rule:#33373c;--head:#202327;--navy:#93b8ff;color-scheme:dark}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--paper);color:var(--ink);font:400 15px/1.75 "Hiragino Kaku Gothic ProN","Hiragino Sans","BIZ UDPGothic","Noto Sans JP",Meiryo,sans-serif;overflow-wrap:break-word}}
a{{color:var(--navy)}}.wrap{{max-width:760px;margin:0 auto;padding:18px 16px 40px}}
h1{{font-size:22px;margin:8px 0 4px}}h2{{font-size:17px;margin:28px 0 8px;padding-bottom:4px;border-bottom:2px solid var(--ink)}}
.sub{{color:var(--sub);font-size:13px}}table{{border-collapse:collapse;width:100%}}
th{{text-align:left;vertical-align:top;background:var(--head);font-weight:500;font-size:13px;padding:9px 8px;width:30%}}
td{{padding:9px 8px;border-bottom:1px solid var(--rule);font-size:14px}}
@media (max-width:560px){{th,td{{display:block;width:auto}}th{{border-bottom:0}}}}
ol{{padding-left:1.3em}}li+li{{margin-top:6px}}.help{{border:1px solid var(--rule);padding:12px 14px;margin-top:24px;font-size:14px}}
</style></head><body><main class=wrap>
<p class=sub><a href='./'>AI舟券 答え合わせ帳</a> / ZEROICHI WORKS</p>
<h1>有料版の利用規約・特定商取引法に基づく表記</h1>
<p class=sub>最終更新日: 2026年10月26日</p>
<h2>特定商取引法に基づく表記</h2><table>{tr}</table>
<h2>利用規約</h2><ol>{li}</ol>
<div class=help><b>のめり込んでいるかもと感じたら</b><br>
<a href='https://www.gaprsc.or.jp/'>ギャンブル依存症予防回復支援センター</a>の相談電話 0120-683-705(無料・24時間)、
またはお住まいの都道府県・政令指定都市の精神保健福祉センターへご相談ください。</div>
<p class=sub style='margin-top:24px'><a href='./'>答え合わせ帳に戻る</a> ・ <a href='../privacy.html'>プライバシーポリシー</a> ・ <a href='../tokushoho.html'>ほかの商品の特定商取引法に基づく表記</a></p>
</main></body></html>"""


def join_page() -> str:
    """note のメンバー向けURLから開く「メール登録」ページ。URLの ?c= の合言葉を件名に入れたメールを作るだけ(合言葉の確認はメール側で行う)。"""
    return f"""<!doctype html><html lang=ja><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>
<title>会員のメール登録</title><meta name=robots content=noindex>
<style>
:root{{--paper:#fff;--ink:#222426;--sub:#62676d;color-scheme:light}}
@media (prefers-color-scheme:dark){{:root:not([data-theme=light]){{--paper:#17191c;--ink:#e9e9e6;--sub:#a3a8ad;color-scheme:dark}}}}
:root[data-theme=dark]{{--paper:#17191c;--ink:#e9e9e6;--sub:#a3a8ad;color-scheme:dark}}
body{{margin:0;background:var(--paper);color:var(--ink);font:400 15px/1.75 "Hiragino Kaku Gothic ProN","Hiragino Sans","Noto Sans JP",Meiryo,sans-serif}}
.wrap{{max-width:560px;margin:0 auto;padding:24px 16px}}h1{{font-size:21px}}
.btn{{display:inline-block;background:var(--ink);color:var(--paper);text-decoration:none;font-weight:700;padding:13px 18px;border-radius:3px;margin-top:12px}}
.sub{{color:var(--sub);font-size:13px}}code{{font-size:16px}}
</style></head><body><main class=wrap>
<h1>有料版のメール登録</h1>
<p>下のボタンでメールを作り、そのまま送信してください。確認が済むと返信が届き、次の朝から配信が始まります。</p>
<p id=code class=sub></p>
<p><a class=btn id=go href='mailto:{MAIL}'>登録のメールを作る</a></p>
<p class=sub>「20歳以上です」の行を残したまま送ってください。このページのアドレスは、ほかの方に教えないでください(会員の方だけが使える合言葉が入っています)。
<a href='{TERMS}'>利用規約</a></p>
<script>
(function(){{var c=(new URLSearchParams(location.search).get('c')||'').replace(/[^A-Za-z0-9]/g,'').slice(0,16);
var s='[KYOTEI-JOIN '+c+'] 有料版のメール登録',b='このまま送信してください。\\n\\n□ 20歳以上です\\n\\nnoteの名前(任意): ';
document.getElementById('go').href='mailto:{MAIL}?subject='+encodeURIComponent(s)+'&body='+encodeURIComponent(b);
document.getElementById('code').textContent=c?('合言葉: '+c):'合言葉が見つかりません。note のメンバー向けページのリンクから開いてください。';}})();
</script></main></body></html>"""
