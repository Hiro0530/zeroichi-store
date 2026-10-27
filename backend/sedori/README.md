# せどり 利益チェック — 裏側(ログイン・クラウド保存・お支払い)

公開ページ(GitHub Pages)だけでは持てない部分をここに置く。すべて無料枠で動かす。
作る手順(アカウントの作成から値の貼り付けまで)は `docs/sedori_app/muse_setup.md`。

| 置き場所 | 中身 |
|---|---|
| `firestore.rules` | Cloud Firestore の規則。本人だけが自分の台帳を読み書き。契約の状態(subscription)は Worker だけが書く。台帳の書き込みは有料の間だけ、読む・消すはいつでも |
| `firebase.json` | Firebase CLI で規則を入れる時の設定(コンソールに貼り付けてもよい) |
| `worker/` | Cloudflare Worker。PayPal の Webhook → Firestore、マイページからの一時停止・再開・プラン変更・解約、毎日の仕事(無料期間の終了3日前のメール・一時停止の自動再開・解約から3年たった台帳の削除) |
| `mailer/Code.gs` | お知らせメールの送り口(Google Apps Script・事業用の Gmail から送る) |

## データの形(Firestore・asia-northeast1)
```
users/{uid}
  email, lastLoginAt, utmFirst{...}            … 利用者が書く
  settings{target, ship, wh}, settingsAt        … 利用者が書く(端末間で揃える設定)
  subscription{                                 … Worker だけが書く
    id(PayPalの契約番号), provider:"paypal", status, planId, planKey, planName, amount, founder,
    trialEnd, nextBillingAt, paidThrough, canceledAt, retainUntil, pausedByUser, resumeAt,
    reminderSent, cancelReason, payerEmail, updatedAt, purgedAt }
users/{uid}/ledger/{行のid}
  row{...台帳の1行}, updatedAt(端末の時刻・最後に書いた方が勝つ), deleted(消した印), serverAt(サーバーの時刻・差分の受け取りに使う)
paypalSubs/{契約番号}   uid, status, counted(先着100名に数えたか)  … Worker だけ
public/founders        taken, limit, open                       … 誰でも読める・Worker だけが書く
```
status: `trialing`(無料期間)/`active`/`past_due`(支払いの失敗)/`paused`(利用者が1か月止めた)/`suspended`(PayPal が止めた)/`incomplete`/`canceled`(paidThrough まで使える)/`expired`

## 解約の動線(特商法の「解約の方法」と同じにしておくこと)
1. マイページ → 契約内容 → 「解約について」(開くと、一時停止・年払いへの変更・台帳の書き出しの案内と、同じ画面に「解約する」)→ 確認 → Worker が PayPal の契約を止める
2. PayPal → 設定 → 支払い → 自動支払いを管理 → ZEROICHI WORKS → キャンセル(Webhook で反映)
3. メールで「解約」→ 本部が PayPal の管理画面(サブスクリプション → 該当の契約 → キャンセル)で止める

引き止めの案内は同じ画面に並べるだけで、解約のボタンを隠したり、何画面も進ませたりしない(特商法の解約妨害・不実告知の禁止)。

## 検算
```
cd worker && node test/test_worker.js     # 41件(PayPal・Firestore・Google は偽物)
```
画面側の同期の検算は kt-zs の `tests/sedori/test_sync.js`。

## 料金を変える時
1. `sedori/assets/config.js`(gh-pages)の `PLAN_CATALOG` を直し、kt-zs で `python3 tools/sedori/build_pages.py` を流す
2. PayPal で新しい金額のプランを作り(既存のプランの金額は契約中の人に影響するので、新しいプランにする)、`config.js` の `PAYPAL_PLANS` と Worker の `PLANS` を差し替える
3. 特定商取引法に基づく表記(`tokushoho.html`)の金額を直す。値上げは利用規約どおり30日前までにお知らせ
