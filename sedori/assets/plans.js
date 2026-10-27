/* 料金とお申し込み: プランを選ぶと、同じ画面の「お申し込み内容の確認」(価格・無料期間の終わる日・支払いの時期・申込みの期間)が変わる。
   ログイン済みなら PayPal のボタンを出す。設定(config.js)が null の間は「準備中」。 */
(function () {
  'use strict';
  var U = window.SedoriUI, $ = U.$, $$ = U.$$, esc = U.esc;
  var cfg = window.ZW_CONFIG || {}, SA = window.SedoriAccount;
  var DAYS = Number(cfg.TRIAL_DAYS) || 14;
  var PLAN = {
    standard_month: { name: 'スタンダード(月払い)', price: 2480, per: '月', cyc: 'month' },
    standard_year: { name: 'スタンダード(年払い)', price: 24800, per: '年', cyc: 'year' },
    founder_month: { name: '先着100名の価格(月払い)', price: 1980, per: '月', cyc: 'month', founder: true },
    founder_year: { name: '先着100名の価格(年払い)', price: 19800, per: '年', cyc: 'year', founder: true }
  };
  var WD = '日月火水木金土';
  function jdate(d) { return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日(' + WD[d.getDay()] + ')'; }
  var founder = { open: true, left: null };
  var sel = new URLSearchParams(location.search).get('plan');
  if (!PLAN[sel]) sel = U.store.get('plan-pick', 'standard_month');
  if (!PLAN[sel]) sel = 'standard_month';

  function paint() {
    var p = PLAN[sel], now = new Date(), end = new Date(now.getTime() + DAYS * 864e5);
    var price = p.price.toLocaleString('ja-JP') + '円';
    $$('#pl-pick tbody tr[data-plan]').forEach(function (tr) {
      var on = tr.getAttribute('data-plan') === sel; tr.classList.toggle('on', on);
      var r = $('input', tr); if (r) r.checked = on;
    });
    $('#cf-plan').textContent = p.name;
    $('#cf-price').textContent = p.per + price;
    $('#cf-trial').textContent = jdate(now) + 'から' + jdate(end) + 'まで(' + DAYS + '日間)';
    $('#cf-when').textContent = jdate(end) + '(無料期間が終わる日)に1回目の' + price + 'を請求し、以後は' + (p.cyc === 'month' ? '毎月' : '毎年') + '同じ日に自動で請求します(前払い)';
    $('#cf-term').textContent = (p.cyc === 'month' ? '1か月' : '1年') + 'ごとに自動で更新。解約するまで続きます';
    $('#cf-period').textContent = p.founder ? '先着100名まで' + (founder.left != null ? '(残り' + founder.left + '名)' : '') + (cfg.FOUNDER_DEADLINE ? '、または' + jdate(new Date(cfg.FOUNDER_DEADLINE + 'T00:00:00')) + 'まで' : '') + '。続けている間は価格が上がりません' : '期限はありません';
    $('#cf-t1').textContent = '今日から' + jdate(end) + 'までの' + DAYS + '日間は無料です。';
    $('#cf-t2').textContent = jdate(end) + 'に、1回目の' + price + '(税込)をPayPalで自動でお支払いいただき、以後は' + (p.cyc === 'month' ? '毎月' : '毎年') + '同じ日に請求します。それまでに解約すれば0円です。無料期間の終了3日前に、メールでお知らせします。';
    payBox();
  }

  $$('#pl-pick tbody tr[data-plan]').forEach(function (tr) {
    tr.addEventListener('click', function () { sel = tr.getAttribute('data-plan'); U.store.set('plan-pick', sel); paint(); });
  });

  /* 先着100名の残り(Worker が public/founders に書く。誰でも読める) */
  function loadFounders() {
    var fc = cfg.FIREBASE_CONFIG; if (!fc || !fc.projectId) return;
    fetch('https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(fc.projectId) + '/databases/(default)/documents/public/founders?key=' + encodeURIComponent(fc.apiKey))
      .then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
        if (!j || !j.fields) return;
        var f = j.fields, taken = Number((f.taken || {}).integerValue || 0), limit = Number((f.limit || {}).integerValue || 100), open = !(f.open && f.open.booleanValue === false);
        if (cfg.FOUNDER_DEADLINE && Date.now() > new Date(cfg.FOUNDER_DEADLINE + 'T23:59:59').getTime()) open = false;
        founder = { open: open && taken < limit, left: Math.max(0, limit - taken) };
        $('#pl-founder-left').textContent = founder.open ? 'いま残り' + founder.left + '名です。' : '100名に達したため、受付を終えました。';
        if (!founder.open) {
          $$('#pl-pick tr[data-founder]').forEach(function (tr) { tr.classList.add('off'); tr.style.display = 'none'; });
          if (PLAN[sel].founder) sel = sel.replace('founder', 'standard');
        }
        paint();
      }).catch(function () { /* 表示はそのまま */ });
  }

  /* 申し込みの欄: 未ログイン → ログイン/契約あり → マイページへ/それ以外 → PayPal のボタン */
  var drawn = null;
  function payBox() {
    if (!SA || !SA.billingReady) return;
    var s = SA.state(), login = $('#pl-login'), buy = $('#pl-buy'), has = $('#pl-has');
    login.hidden = !!s.user || s.phase === 'loading'; buy.hidden = true; has.hidden = true;
    if (!s.user) { drawn = null; return; }
    var k = s.plan.key;
    if (k !== 'free' && k !== 'ended') {
      has.hidden = false;
      $('#pl-has-t').textContent = 'このアカウント(' + s.user.email + ')は「' + s.plan.label + '」です。プランの変更・一時停止・解約はマイページからできます。';
      return;
    }
    buy.hidden = false;
    $('#pl-who').innerHTML = 'お申し込みのアカウント: <b>' + esc(s.user.email) + '</b>';
    if (drawn === sel) return;
    drawn = sel;
    $('#pl-pp').innerHTML = '<p class="muted">PayPalのボタンを読み込んでいます…</p>';
    SA.renderPayButton($('#pl-pp'), sel, function () { location.href = '../mypage/?subscribed=1'; })
      .catch(function () { drawn = null; $('#pl-pp').innerHTML = '<p class="msg err">PayPalのボタンを読み込めませんでした。通信を確かめて、ページを開き直してください。</p>'; });
  }
  var lb = $('#pl-login-btn'); if (lb) lb.addEventListener('click', function () { SA.open(location.pathname + '?plan=' + sel); });
  document.addEventListener('sedori:acct', payBox);

  paint();
  loadFounders();
})();
