/* せどり 利益チェック — ログイン・クラウド保存・お支払いの設定(公開して問題のない値だけ)。
   ここが null のあいだは、ログインと有料の機能を「準備中」と表示し、無料版(この端末に保存)はそのまま使える。
   値の取り方は本部の docs/sedori_app/muse_setup.md。秘密の値(PayPal のシークレット・Webhook ID・サービスアカウントの鍵)はここに入れない。 */
window.ZW_CONFIG = {
  /* サイトの住所(最後は /)。独自ドメインに移す時はここだけ直し、tools/sedori/build_pages.py と本部の guide_build.py を流し直す。
     ページ同士のリンクは相対なので、ここを使うのは canonical・OGP・サイトマップ・楽天の「許可するWebサイト」の案内だけ。
     移す時に直す場所の一覧は本部の docs/sedori_app/domain.md */
  SITE_URL: "https://hiro0530.github.io/zeroichi-store/",
  /* Firebase の「ウェブアプリの設定」(apiKey・authDomain・projectId・appId など)。公開してよい値 */
  FIREBASE_CONFIG: null,
  /* PayPal の REST アプリの Client ID(公開してよい値。テスト中は Sandbox の ID) */
  PAYPAL_CLIENT_ID: null,
  /* PayPal のサブスクリプションのプランID(P-で始まる)。無料期間14日はプランの側で設定する */
  PAYPAL_PLANS: {
    total_month: null,     // 総合 月4,980円
    total_year: null,      // 総合 年49,800円
    founder_month: null,   // 総合 先着100名 月3,980円
    founder_year: null,    // 総合 先着100名 年39,800円
    business_month: null,  // 業務 月7,980円
    business_year: null,   // 業務 年79,800円
    light_month: null,     // ライト 月2,980円
    light_year: null       // ライト 年29,800円
  },
  /* Cloudflare Worker の URL(契約の反映・一時停止・プラン変更・解約)。https://....workers.dev */
  WORKER_URL: null,
  /* 料金(税込・円)。ここだけ直せば、料金ページ・トップの料金表・お申し込みの確認の金額が変わる
     (ページの書き出し tools/sedori/build_pages.py もここを読む)。PayPal のプランの金額と Worker の PLANS も同じ値にそろえる。
     open: false は「受付前」(申し込めない)。founder: true は先着100名の価格(総合だけ)。tier はできることの段(light/total/business)。
     badge は料金表の小さな印。有料の機能ができたかどうかは下の FEATURES_READY。
     2026-10-27 決定(安売りしない): ライト 月2,980円・年29,800円/総合 月4,980円・年49,800円(おすすめ)/先着100名は総合を月3,980円・年39,800円(続けている間ずっと)/業務 月7,980円・年79,800円(確定申告まで全部)。
     14日間の無料期間は、どのプランで申し込んでも業務のすべてを使え、終わる日から選んだプランで続く */
  PLAN_CATALOG: /*PLANS*/{
    "total_month": { "name": "総合", "tier": "total", "cycle": "month", "price": 4980, "badge": "おすすめ" },
    "total_year": { "name": "総合", "tier": "total", "cycle": "year", "price": 49800, "badge": "おすすめ" },
    "founder_month": { "name": "総合 先着100名の価格", "tier": "total", "cycle": "month", "price": 3980, "founder": true },
    "founder_year": { "name": "総合 先着100名の価格", "tier": "total", "cycle": "year", "price": 39800, "founder": true },
    "business_month": { "name": "業務", "tier": "business", "cycle": "month", "price": 7980, "badge": "確定申告まで全部" },
    "business_year": { "name": "業務", "tier": "business", "cycle": "year", "price": 79800, "badge": "確定申告まで全部", "note": "確定申告の時期だけでなく、毎月の棚卸と集計に使えます" },
    "light_month": { "name": "ライト", "tier": "light", "cycle": "month", "price": 2980, "badge": "まずは記録だけ" },
    "light_year": { "name": "ライト", "tier": "light", "cycle": "year", "price": 29800, "badge": "まずは記録だけ" }
  }/*/PLANS*/,
  /* 無料期間(日)。PayPal のプランの無料期間と同じ値にする */
  TRIAL_DAYS: 14,
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
    threepl: false,   // 業務: 発送代行への入庫・出荷の指示ファイル
    policepdf: false  // 業務: 警察提出用の台帳PDF
  },
  /* 先着100名の価格の受付終了日("2026-12-31" のように。決めていなければ null。人数で終わる) */
  FOUNDER_DEADLINE: null
};
