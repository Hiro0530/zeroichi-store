/* せどり 利益チェック — ログイン・クラウド保存・お支払いの設定(公開して問題のない値だけ)。
   ここが null のあいだは、ログインと有料の機能を「準備中」と表示し、無料版(この端末に保存)はそのまま使える。
   値の取り方は本部の docs/sedori_app/muse_setup.md と zeroichi-store の backend/sedori/README.md(Stripe)。
   秘密の値(Stripe のシークレットキー・Webhook の署名シークレット、PayPal のシークレット・Webhook ID、サービスアカウントの鍵)はここに入れない。
   お支払いはカード(Stripe)が本命、PayPal が2つ目。カードの価格IDは Worker の変数(STRIPE_PRICE_…)にだけ入れる。
   料金ページは Worker の /stripe/plans を見て、価格IDの入ったプランだけ「カードで申し込む」を押せるようにする(空なら「準備中」)。 */
window.ZW_CONFIG = {
  /* サイトの住所(最後は /)。独自ドメインに移す時はここだけ直し、tools/sedori/build_pages.py と本部の guide_build.py を流し直す。
     ページ同士のリンクは相対なので、ここを使うのは canonical・OGP・サイトマップ・楽天の「許可するWebサイト」の案内だけ。
     移す時に直す場所の一覧は本部の docs/sedori_app/domain.md */
  SITE_URL: "https://zeroichiworks.net/",
  /* Firebase の「ウェブアプリの設定」(apiKey・authDomain・projectId・appId など)。公開してよい値 */
  FIREBASE_CONFIG: {"apiKey": "AIzaSyA_3_--I5dJUZXKQuwIWVvovNGYs8JcQ0c", "authDomain": "zw-sedori.firebaseapp.com", "projectId": "zw-sedori", "storageBucket": "zw-sedori.firebasestorage.app", "messagingSenderId": "161667599172", "appId": "1:161667599172:web:1f535e952dd12bd0732511"},
  /* PayPal の REST アプリの Client ID(公開してよい値。テスト中は Sandbox の ID) */
  PAYPAL_CLIENT_ID: null,
  /* PayPal のサブスクリプションのプランID(P-で始まる)。無料期間14日はプランの側で設定する(月払いだけ)。
     年払いは無料期間なしなので、PayPal の年払いのプランは「無料期間なし」で作り、PAYPAL_YEAR を true にした時だけ使う */
  PAYPAL_PLANS: {
    total_month: null,     // 総合 月4,980円
    total_year: null,      // 総合 年49,800円
    founder_month: null,   // 総合 先着200名 月3,980円
    founder_year: null,    // 総合 先着200名 年39,800円
    business_month: null,  // 業務 月7,980円
    business_year: null,   // 業務 年79,800円
    light_month: null,     // ライト 月2,980円
    light_year: null       // ライト 年29,800円
  },
  /* PayPal で年払いを受けるか。PayPal の年払いのプランが「無料期間なし」になっていて、返金を手で行える時だけ true。
     false の間、年払いはカード(Stripe)だけ(料金ページの PayPal のボタンを出さない) */
  PAYPAL_YEAR: false,
  /* 年払いの決まり(料金ページの確認の欄・マイページ・利用規約・特商法・Worker の YEAR_TEXT と同じ文。変える時は全部そろえる) */
  YEAR_TEXT: "年払いは、お申し込みの日に1年分をお支払いいただきます。1回目のお支払いから30日以内に解約すれば、全額を返金します(同じカード・同じメールアドレスでは1回まで)。",
  YEAR_REFUND_DAYS: 30,
  /* 先着の定員(人数)。ここだけ直せば、料金ページ・トップ・規約・AIに相談の前提・事前登録のメールの数が変わる
     (ページの書き出し tools/sedori/build_pages.py もここを読む)。Worker の FOUNDER_LIMIT(wrangler.toml)と特商法も同じ数にそろえる。
     2026-10-28 オーナー決定で 100名 → 200名 */
  FOUNDER_LIMIT: 200,
  /* 先着200名の価格の続く期間の言い方(「一生」とは書かない。2026-10-30) */
  FOUNDER_KEEP: "解約しない限りずっと(サービス提供中)",
  /* 利用の鍵(2026-11-17 オーナー指示「お客の管理はしない。月額の利用料だけ取る」)。true の間は、ログインとクラウド保存を使わず、
     お支払いが済むとこの端末に「利用の鍵」が入り、有料の機能が開く(assets/license.js)。データはこの端末の中だけ(書き出す/取り込む)。
     KEY_PUBLIC_JWK: Worker の署名の鍵の公開の部分(公開してよい値。Worker の /key/pub と同じもの。秘密の部分 d は入れない)。
     KEY_ALLOW_TEST: 署名の鍵が入る前の「試験用(署名なし)」の証明を受けるか。試験版の写しだけ true。公開の設定では必ず false(誰でも有料の機能を開けてしまうため) */
  KEY_MODE: true,
  /* 申し込みの決済(2026-11-18。Stripe の指摘を受けた切り替えの準備)。"stripe" か "paypal"。ここ1つで、料金ページの申し込みの行き先・
     「準備中」の判定(Worker の /key/plans)・マイページの「契約の管理」の文が変わる。鍵の発行・更新・止める流れはどちらも同じ(Worker が受け持つ)。
     PayPal は Worker に PayPal の鍵・プランID・KV(ZW_KEYS)が揃うまで「準備中」と出る */
  PAY_PROVIDER: "stripe",
  KEY_PUBLIC_JWK: null,
  KEY_ALLOW_TEST: true,
  /* 有料の段どうしの「まとめての行数・在庫番の品数」をそろえる(2026-11-18。plan_regroup の勧め・オーナーの最終の返事待ち)。
     前の形(ライト100行・30品/総合500行・100品/業務500行・300品)に戻す時は null にする。Worker の core.js の PAID_UNIFORM も null にし、ページを書き出し直す */
  PAID_UNIFORM: { bulk: 500, listed: 300 },
  /* Cloudflare Worker の URL(カードの申し込み・契約の反映・一時停止・プラン変更・解約)。https://....workers.dev */
  WORKER_URL: "https://zw-sedori-billing.zeroichi-works-jp.workers.dev",
  /* 料金(税込・円)。ここだけ直せば、料金ページ・トップの料金表・お申し込みの確認の金額が変わる
     (ページの書き出し tools/sedori/build_pages.py もここを読む)。Stripe の価格・PayPal のプランの金額と Worker の PLANS も同じ値にそろえる。
     open: false は「受付前」(申し込めない)。founder: true は先着200名の価格(総合だけ)。tier はできることの段(light/total/business)。
     badge は料金表の小さな印。有料の機能ができたかどうかは下の FEATURES_READY。
     2026-10-27 決定(安売りしない): ライト 月2,980円・年29,800円/総合 月4,980円・年49,800円(おすすめ)/先着200名は総合を月3,980円・年39,800円(解約しない限りずっと。サービス提供中)/業務 月7,980円・年79,800円(確定申告まで全部)。
     無料のお試しは無し(2026-11-17 21:50 決定)。年払いはその場で決済し、1回目のお支払いから30日以内の解約は全額返金(同じカード・同じメールでは1回まで) */
  PLAN_CATALOG: /*PLANS*/{
    "total_month": { "name": "総合", "tier": "total", "cycle": "month", "price": 4980, "badge": "おすすめ" },
    "total_year": { "name": "総合", "tier": "total", "cycle": "year", "price": 49800, "badge": "おすすめ" },
    "founder_month": { "name": "総合 先着200名の価格", "tier": "total", "cycle": "month", "price": 3980, "founder": true },
    "founder_year": { "name": "総合 先着200名の価格", "tier": "total", "cycle": "year", "price": 39800, "founder": true },
    "business_month": { "name": "業務", "tier": "business", "cycle": "month", "price": 7980, "badge": "確定申告まで全部" },
    "business_year": { "name": "業務", "tier": "business", "cycle": "year", "price": 79800, "badge": "確定申告まで全部", "note": "確定申告の時期だけでなく、毎月の棚卸と集計に使えます" },
    "light_month": { "name": "ライト", "tier": "light", "cycle": "month", "price": 2980, "badge": "まずは記録だけ" },
    "light_year": { "name": "ライト", "tier": "light", "cycle": "year", "price": 29800, "badge": "まずは記録だけ" }
  }/*/PLANS*/,
  /* 無料のお試しは 2026-11-17 21:50 のオーナー決定で無し(0)。有料は初日から課金。月額はいつでも解約でき、払った期間の終わりまで使える */
  TRIAL_DAYS: 0,
  /* ライトでクラウドに保存できる台帳の件数(1か月あたり。仕入日の月で数える) */
  LIGHT_MONTHLY_LIMIT: 100,
  /* 有料の機能ができたかどうか(true: 使える/false: 「11月中に追加」と表示)。
     料金ページ・トップ・紹介・利用規約の書き出し(tools/sedori/build_pages.py)と、台帳の案内・帳簿の画面がここを読む。
     2026-10-28: 帳簿(/sedori/books/)の売上の取り込み・経費・月ごとの利益・売れ残り・期末の棚卸・申告用の数字と仕訳帳の書き出し・古物商特例の確認ができた。
     帳簿の記録のクラウド保存は、ログインの設定(FIREBASE_CONFIG)が入ると動く(それまでは、この端末に保存) */
  FEATURES_READY: {
    books: true,      // 総合: 売上の取り込み・経費・月ごとの利益・売れ残りアラート
    stock: true,      // 業務: 期末の棚卸(スマホで数える)
    tax: true,        // 業務: 確定申告用の数字・会計ソフト向けの書き出し・仕入税額控除の特例チェック(経過措置の計算を含む)
    team: false,      // 業務: 3人まで
    threepl: true,    // 業務: 発送代行への入庫・出荷の指示ファイル
    policepdf: false  // 業務: 警察提出用の台帳PDF
  },
  /* 事前登録(件名「せどりアプリ事前登録」のメール1通)。open は有料の受付を始める日、notice はご案内を送る日(画面とメールの本文に出す)。
     日付が決まっていない間は null(画面は「有料版の受付開始日は、決まりしだいこのページでお知らせします」)。
     決まったら、下の1行の null を  open: "11月4日(水)", notice: "11月3日(火)"  のように日付の文字に直して tools/sedori/build_pages.py を流し直せば、全ページに出る。
     受付が始まって WORKER_URL が入ると、事前登録の欄(data-bill="prep")は自動で隠れる。
     2026-10-29: 11月4日はテストの結果を見てオーナーが決め直すので、いったん日付を外した */
  PREREG: { open: null, notice: null },
  /* 商品ページの目安の基準(画面では直せない。変える時はここだけ)。計算は assets/calc.js の sellThrough・stockAdvice
     speed: 直近30日の販売の目安がこの個数以上なら、売れる速さの段階 5・4・3・2(未満は1)
     pricey: 売値がこの額(円)以上は「1個の金額が大きい」と見る / minShops: 仕入れ先で在庫のある店がこの数以上なら、取り寄せ販売でも切れにくいと見る */
  ITEM_RULES: { speed: [100, 30, 10, 3], pricey: 10000, minShops: 3 },
  /* 在庫番(取り寄せ販売の品)の、Amazonの基準の数字。出品者向けの案内の原文で確かめるまで null(画面は数字を出さず「案内で確かめてください」と出す) */
  MZ_LIMITS: { cancelRate: null, lateRate: null, handlingMaxDays: null, window: null, checkedAt: null, source: null },
  /* 先着200名の価格の受付終了日("2026-12-31" のように。決めていなければ null。人数で終わる) */
  FOUNDER_DEADLINE: null
};
