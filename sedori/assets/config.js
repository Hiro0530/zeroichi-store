/* せどり 利益チェック — ログイン・クラウド保存・お支払いの設定(公開して問題のない値だけ)。
   ここが null のあいだは、ログインと有料の機能を「準備中」と表示し、無料版(この端末に保存)はそのまま使える。
   値の取り方は本部の docs/sedori_app/muse_setup.md。秘密の値(PayPal のシークレット・Webhook ID・サービスアカウントの鍵)はここに入れない。 */
window.ZW_CONFIG = {
  /* Firebase の「ウェブアプリの設定」(apiKey・authDomain・projectId・appId など)。公開してよい値 */
  FIREBASE_CONFIG: null,
  /* PayPal の REST アプリの Client ID(公開してよい値。テスト中は Sandbox の ID) */
  PAYPAL_CLIENT_ID: null,
  /* PayPal のサブスクリプションのプランID(P-で始まる)。無料期間14日はプランの側で設定する */
  PAYPAL_PLANS: {
    standard_month: null, // スタンダード 月2,480円
    standard_year: null,  // スタンダード 年24,800円
    founder_month: null,  // 先着100名 月1,980円
    founder_year: null    // 先着100名 年19,800円
  },
  /* Cloudflare Worker の URL(契約の反映・一時停止・プラン変更・解約)。https://....workers.dev */
  WORKER_URL: null,
  /* 無料期間(日)。PayPal のプランの無料期間と同じ値にする */
  TRIAL_DAYS: 14,
  /* 先着100名の価格の受付終了日("2026-12-31" のように。決めていなければ null。人数で終わる) */
  FOUNDER_DEADLINE: null
};
