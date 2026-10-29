# せどり 利益チェック — 裏側(ログイン・クラウド保存・お支払い)

公開ページ(GitHub Pages)だけでは持てない部分をここに置く。すべて無料枠で動かす(Stripe・PayPal は売れた分の手数料だけ)。
お支払いは **カード(Stripe。Apple Pay・Google Pay も)が本命、PayPal が2つ目**(2026-10-28 決定)。
作る手順(アカウントの作成から値の貼り付けまで)は `docs/sedori_app/muse_setup.md`、Stripe の分はこの下の「Stripe の設定」。

| 置き場所 | 中身 |
|---|---|
| `firestore.rules` | Cloud Firestore の規則。本人だけが自分の台帳を読み書き。契約の状態(subscription)は Worker だけが書く。台帳の書き込みは有料の間だけ、読む・消すはいつでも。帳簿(`books`)は種類ごとに、総合以上(売上・経費など)/業務(申告用の設定・棚卸の数)の間だけ書ける |
| `firebase.json` | Firebase CLI で規則を入れる時の設定(コンソールに貼り付けてもよい) |
| `worker/` | Cloudflare Worker。カードの申し込み画面(Stripe Checkout)を作る、Stripe・PayPal の Webhook → Firestore、マイページからの一時停止・再開・プラン変更・解約・カードの変更、毎日の仕事(無料期間の終了3日前のメール・一時停止の自動再開・解約から3年たった台帳の削除) |
| `mailer/Code.gs` | お知らせメールの送り口(Google Apps Script・事業用の Gmail から送る) |

## データの形(Firestore・asia-northeast1)
```
users/{uid}
  email, lastLoginAt, utmFirst{...}            … 利用者が書く
  settings{target, ship, wh}, settingsAt        … 利用者が書く(端末間で揃える設定)
  subscription{                                 … Worker だけが書く
    id(Stripe の sub_… / PayPal の I-…), provider:"stripe"|"paypal", customerId・itemId(Stripe だけ), status, planId, planKey, planName, amount, founder,
    trialEnd, nextBillingAt, paidThrough, canceledAt, retainUntil, pausedByUser, resumeAt,
    reminderSent, cancelReason, payerEmail, updatedAt, purgedAt }
users/{uid}/ledger/{行のid}
  row{...台帳の1行}, updatedAt(端末の時刻・最後に書いた方が勝つ), deleted(消した印), serverAt(サーバーの時刻・差分の受け取りに使う)
paypalSubs/{契約番号}   uid, status, counted(先着100名に数えたか)  … Worker だけ
stripeSubs/{sub_…}     uid, status, counted                       … Worker だけ
stripeEvents/{evt_…}   type, subId, done                          … Worker だけ(同じ通知を2回処理しない)
founderSeats/{provider_契約番号}                                   … Worker だけ(先着100名を1契約1回だけ数える)
public/founders        taken, limit, open                       … 誰でも読める・Worker だけが書く
```
status: `trialing`(無料期間)/`active`/`past_due`(支払いの失敗)/`paused`(利用者が1か月止めた)/`suspended`(PayPal が止めた・Stripe が請求をあきらめた)/`incomplete`/`canceled`(paidThrough まで使える)/`expired`

- 無料期間(14日)は初めてのお申し込みの時だけ。Stripe は Checkout の `subscription_data.trial_period_days` で付ける。申し込み直しはカードだけで、無料期間なし
- 先着100名(総合 3,980円)は **1回目のお支払いが済んだ順** に数える(Stripe は 0円より大きい `invoice.paid`、PayPal は active になった時)。100名で `public/founders.open=false` にし、それ以降は Checkout が断る(料金ページは総合の価格で出し直す)。受付中に申し込んだ方は無料期間中でもその価格のまま
- カードの解約は `cancel_at_period_end=true`(期間の終わりで終える・日割りの返金なし)。無料期間中なら無料期間の終わりで終わり、請求しない

## 解約の動線(特商法の「解約の方法」と同じにしておくこと)
1. マイページ → 契約内容 → 「解約について」(開くと、一時停止・年払いへの変更・台帳の書き出しの案内と、同じ画面に「解約する」)→ 確認 → Worker が Stripe(期間の終わりで終える)か PayPal の契約を止める
2. メールで「解約」→ 本部が止める。カード: Stripe の管理画面 → 顧客 → 該当の契約 → 「サブスクリプションをキャンセル」→ **「現在の期間の終了時」**。PayPal: 管理画面 → サブスクリプション → 該当の契約 → キャンセル
3. PayPal の方だけ: PayPal → 設定 → 支払い → 自動支払いを管理 → ZEROICHI WORKS → キャンセル(Webhook で反映)

引き止めの案内は同じ画面に並べるだけで、解約のボタンを隠したり、何画面も進ませたりしない(特商法の解約妨害・不実告知の禁止)。

## 検算
```
cd worker && node test/test_worker.js     # 107件(Stripe・PayPal・Firestore・Google は偽物)
```
Stripe の署名(正しい・別の鍵・本文の書き換え・5分より古い/先・v1 が複数)、5つの出来事、同じ通知の2回目、同時に届いた通知で先着を2回数えないこと、
解約・一時停止・プラン変更・カードの変更、毎日の仕事を確かめる。
画面側は、このリポジトリの `tests/sedori/*.js`(公開フォルダ=gh-pages の作業ツリーを引数に)。お支払いまわりの画面と法務ページは `tests/sedori/test_billing_pages.js`。

## 料金を変える時
1. `sedori/assets/config.js`(gh-pages)の `PLAN_CATALOG` を直し、kt-zs で `python3 tools/sedori/build_pages.py` を流す
2. Stripe で新しい金額の価格を作り(既存の価格は変えられないので、新しい価格にする)、Worker の `STRIPE_PRICE_…` を差し替える。PayPal も新しい金額のプランを作り、`config.js` の `PAYPAL_PLANS` と Worker の `PLANS` を差し替える
3. 特定商取引法に基づく表記(`tokushoho.html`)の金額を直す。値上げは利用規約どおり30日前までにお知らせ

## Stripe の設定(ブラウザで操作する担当=ミューズ向け)
最初はすべて **テストモード** で作る(画面右上の「テストモード」をオン)。秘密の値(sk_… と whsec_…)は Cloudflare にだけ入れ、Issue・チャット・スクリーンショットに出さない。

**1. 商品と価格を作る(テストモード)**
1. https://dashboard.stripe.com → 商品カタログ → 「商品を追加」
2. 次の4つの商品を作り、それぞれに「継続」の価格を足す(通貨は円。金額は税込の値をそのまま入れる)

| 商品名 | 価格(月) | 価格(年) | Cloudflare の変数(月 / 年) |
|---|---|---|---|
| せどり 利益チェック ライト | 2,980円 | 29,800円 | `STRIPE_PRICE_LIGHT_MONTH` / `STRIPE_PRICE_LIGHT_YEAR` |
| せどり 利益チェック 総合 | 4,980円 | 49,800円 | `STRIPE_PRICE_TOTAL_MONTH` / `STRIPE_PRICE_TOTAL_YEAR` |
| せどり 利益チェック 総合 先着100名 | 3,980円 | 39,800円 | `STRIPE_PRICE_FOUNDER_MONTH` / `STRIPE_PRICE_FOUNDER_YEAR` |
| せどり 利益チェック 業務 | 7,980円 | 79,800円 | `STRIPE_PRICE_BUSINESS_MONTH` / `STRIPE_PRICE_BUSINESS_YEAR` |

   - 無料期間は価格に付けない(Worker が申し込みの時に14日を付ける)
   - 8つの価格の ID(`price_…`)を控える。公開してよい値

**2. 価格IDを Worker に入れる**
Cloudflare → Workers & Pages → `zw-sedori-billing` → 設定 → 変数とシークレット → 上の8つを **テキスト** で追加(値は `price_…`)。
入れたプランから、料金ページの「カードで申し込む」が押せるようになる(空のプランは「準備中」のまま)。
同じ画面でコード(`worker/src/index.js`)も貼り直して「デプロイ」する。

**3. Webhook を登録する**
1. Stripe → 開発者 → Webhook → 「エンドポイントを追加」
2. URL: `https://zw-sedori-billing.〇〇.workers.dev/stripe/webhook`
3. 送るイベント(この5つだけ選ぶ)
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
4. 保存すると出る **署名シークレット**(`whsec_…`)を控える

**4. 秘密の値を入れる(シークレット)**
Cloudflare の同じ画面で **シークレット** として追加し、デプロイし直す(ターミナルなら `npx wrangler secret put STRIPE_SECRET_KEY` と `npx wrangler secret put STRIPE_WEBHOOK_SECRET`)。
- `STRIPE_SECRET_KEY` … 開発者 → APIキー → シークレットキー(`sk_test_…`)
- `STRIPE_WEBHOOK_SECRET` … 3. の `whsec_…`

**5. Stripe の画面の設定**
- 設定 → 支払い方法: カード・Apple Pay・Google Pay をオン(ほかは要らない)
- 設定 → ビジネス → 公開情報: 表示名 `ZEROICHI WORKS`、明細書表記 `ZEROICHI WORKS`、カナ `ゼロイチワークス`、サポートのメール `zeroichi.works.jp@gmail.com`、ウェブサイト `https://zeroichiworks.net/sedori/`、特商法・規約・プライバシーの URL(`https://zeroichiworks.net/tokushoho.html`・`https://zeroichiworks.net/sedori/terms/`・`https://zeroichiworks.net/sedori/privacy/`)
- 設定 → Billing → カスタマーポータル: 「支払い方法の更新」と「請求の履歴」をオン、**「サブスクリプションのキャンセル」と「プランの切り替え」はオフ**(解約・変更はマイページで行うため)→ 保存
- 設定 → Billing → サブスクリプションと請求書: 支払いに失敗した時の再試行は既定(スマートリトライ)のまま、すべて失敗したら「サブスクリプションを未払いのままにする」
- 設定 → カスタマーへのメール: 「支払いの成功」(領収書)をオン

**6. 通しの確認(テストモード)**
| # | すること | 期待すること |
|---|---|---|
| 1 | /sedori/plans/ → ログイン → 総合を選ぶ → 「カードで申し込む」 | Stripe の画面(日本語)に移り、ボタンの下に無料期間・金額・解約の案内 |
| 2 | テストカード `4242 4242 4242 4242`(期限は先の日付・CVC 何でも)で登録 | マイページに戻り、契約内容が「無料期間中」・終わりの日が14日後・お支払いの方法が「カード(決済代行: Stripe)」 |
| 3 | 3Dセキュアのカード `4000 0027 6000 3184` でも申し込む(別のアカウント) | 認証の画面が出て、通すと同じく反映 |
| 4 | マイページ → 解約について → 「解約する」 | 「解約済み・期間の終わりまで使えます」。Stripe 側は「キャンセル予定」 |
| 5 | Stripe → 開発者 → Webhook → 該当のエンドポイント → イベントの一覧 | 5つの出来事が 200 で届いている(400 なら署名シークレットの入れ間違い) |
| 6 | テストクロック(Billing → テストクロック)で15日進める | 1回目の請求が通り「総合」に。先着のプランなら Firestore の `public/founders.taken` が1増える |
| 7 | 失敗するカード `4000 0000 0000 0341` に変えて期間を進める | マイページに「前回の請求がカードで通っていません」と「カードを変える」 |

確認が済んだら、オーナーの了承のあと本番モードで 1.〜5. を同じように作り、Cloudflare の値(価格ID8つ・`sk_live_…`・本番の `whsec_…`)を差し替え、Firestore の `public/founders` と `founderSeats` を消す(テストの人数を0に戻す)。

## 事前登録(2026-10-29 決定 D2。受付開始 11/4 まで)
Worker・Firebase に頼らない形にした(裏側の公開が遅れても受け付けられるように)。
- 受け口: 公開ページの「事前登録」欄(トップ・料金・利益の仕組み・違いのページ・ログインの画面)。「Gmailで送る」か「メールアプリで送る」で、
  **件名「せどりアプリ事前登録」** のメールが `zeroichi.works.jp@gmail.com` に届く。これが登録の記録(同意の記録も兼ねる)。宛先・件名だけの手入力でもよい
- 保存: 事業用 Gmail の受信箱そのもの。ほかの場所に写さない(プライバシーポリシーの「事前登録・メールマガジン」の行)。数えるのは Gmail で `subject:せどりアプリ事前登録`
- 日付の文言: `sedori/assets/config.js` の `PREREG`(open・notice)。受付が始まり `WORKER_URL` が入ると、欄(`data-bill="prep"`)は自動で隠れる
- 取り消し: 「取り消し」と返信があれば、そのスレッドを削除してご案内を送らない

### 11/3(火)のご案内の送り方
1. Gmail で `subject:せどりアプリ事前登録 -subject:Re` を検索し、「取り消し」の返信がある人を除く
2. 各メールに **返信** で次の文を送る(1日100通まで。超えたら翌日に回す)。BCCの一斉送信はしない
3. 送ったスレッドにラベル「事前登録 案内済み」を付ける(二重送信を防ぐ)。案内から3か月たったら、申し込みの無かった登録のメールを消す

```
件名: Re: せどりアプリ事前登録
せどり 利益チェックの事前登録をありがとうございます。ZEROICHI WORKS です。
有料版のお申し込みを 11月4日(水)から受け付けます。
https://zeroichiworks.net/sedori/plans/

・ライト 月2,980円/総合 月4,980円(先着100名は月3,980円)/業務 月7,980円(税込)
・年払いは10か月分の料金で1年。月払いは14日無料(初めての方)、年払いは30日以内の解約で全額返金
・計算と、この端末の台帳は、これまでどおり無料・登録なしで使えます

ご案内はこの1通だけです。このメールに返信いただければ、ご質問にお答えします。
ZEROICHI WORKS zeroichi.works.jp@gmail.com
```

<!-- 2026-10-29: Cloudflare Workers の Git 連携の初回ビルド用 -->
