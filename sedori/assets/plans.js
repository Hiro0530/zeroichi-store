/* 料金: 1) 月払い/年払いと3枚のカードからプランを選ぶ 2) 同じ画面の「お申し込み内容の確認」(特商法の最終確認の表示事項)を、選んだプランに合わせて書き換え、
   申し込みのボタンを出す。主は「カードで申し込む」(Stripe の申し込み画面へ1回で移る)、その下に小さく「PayPalで払う」。
   受付前は事前登録、カードの価格IDが Worker に無いプランは「準備中」。料金は config.js の PLAN_CATALOG だけで決める。
   無料期間は初めてのお申し込みの時だけ(解約後の申し込み直しはカードのみ・無料期間なしで、確認の欄もそう書き換える)。
   総合を選ぶと、先着100名の受付中は先着の価格(founder_*)で申し込む(カードと確認の両方にそう書く)。 */
(function () {
  'use strict';
  var U = window.SedoriUI, $ = U.$, $$ = U.$$, esc = U.esc;
  var cfg = window.ZW_CONFIG || {}, SA = window.SedoriAccount;
  var CAT = cfg.PLAN_CATALOG || {};
  var DAYS = Number(cfg.TRIAL_DAYS) || 14;
  var WD = '日月火水木金土';
  function jdate(d, y) { return (y === false ? '' : d.getFullYear() + '年') + (d.getMonth() + 1) + '月' + d.getDate() + '日(' + WD[d.getDay()] + ')'; }
  function yen(n) { return Number(n).toLocaleString('ja-JP') + '円'; }
  function open(k) { return !!CAT[k] && CAT[k].open !== false; }

  var founder = { open: open('founder_month'), left: null };
  // 画面で選ぶのは base(light/total/business)と cyc(month/year)。chosen はカードを選んだか(選ぶまで確認の欄は出さない)
  var st = { base: 'total', cyc: 'month', chosen: false };
  (function init() {
    var q = new URLSearchParams(location.search).get('plan') || '';
    var m = /^(light|total|business|founder)(?:_(month|year))?$/.exec(q);
    if (m) { st.base = m[1] === 'founder' ? 'total' : m[1]; if (m[2]) st.cyc = m[2]; st.chosen = true; }
    else {
      var saved = U.store.get('plan-pick2', null);
      if (saved && /^(light|total|business)_(month|year)$/.test(saved)) { var p = saved.split('_'); st.base = p[0]; st.cyc = p[1]; }
    }
    if (!open(st.base + '_' + st.cyc)) { st.base = 'total'; st.cyc = 'month'; }
  })();

  /** 実際に申し込むプランのキー(総合は先着の受付中なら founder_*) */
  function key() {
    if (st.base === 'total' && founder.open && open('founder_' + st.cyc)) return 'founder_' + st.cyc;
    return st.base + '_' + st.cyc;
  }

  /** 前に契約があったアカウント(解約後の申し込み直し)か */
  function returning() { var s = SA && SA.state ? SA.state() : null; return !!(s && s.user && s.sub && s.sub.status); }

  var preHref = null;
  function paint() {
    var k = key(), c = CAT[k], isF = !!c.founder, per = st.cyc === 'year' ? '年' : '月', again = returning();
    var now = new Date(), end = new Date(now.getTime() + DAYS * 864e5);
    var name = CAT[st.base + '_month'].name, cycl = st.cyc === 'year' ? '年払い' : '月払い';
    // 1) 切り替えとカード
    $$('#pl-cyc input').forEach(function (i) { i.checked = i.value === st.cyc; i.parentNode.classList.toggle('on', i.checked); });
    $$('#pl-step1 [data-c]').forEach(function (el) { el.hidden = el.getAttribute('data-c') !== st.cyc; });
    $$('#pl-cards .pc').forEach(function (card) {
      var on = st.chosen && card.getAttribute('data-base') === st.base;
      card.classList.toggle('on', on);
      var b = $('.pc-go', card);
      if (b) { b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.href = '?plan=' + card.getAttribute('data-base') + '_' + st.cyc + '#pl-step2'; }
    });
    var fl = $('#pc-founder'); if (fl) fl.hidden = !founder.open;
    // 2) 最終確認
    $('#pl-step2').hidden = !st.chosen;
    $('#cf-plan').textContent = name + '(' + cycl + ')';
    var fd = $('#cf-fd'); fd.hidden = !isF;
    if (isF) fd.textContent = '先着100名の価格' + (founder.left != null ? '(残り' + founder.left + '名)' : '');
    $('#cf-price').textContent = per + yen(c.price);
    $('#cf-price2').textContent = per + yen(c.price);
    $$('#cf-amount [data-tier]').forEach(function (el) { el.hidden = el.getAttribute('data-tier') !== (c.tier || 'total'); });
    var every = st.cyc === 'month' ? '毎月' : '毎年';
    if (again) {
      $('#cf-t1').textContent = '無料期間なし(2回目のお申し込み)';
      $('#cf-trial').textContent = 'ありません。無料期間は初めてのお申し込みの時だけです';
      $('#cf-trial2').hidden = true;
      var cpp = $('#cf-pay-pp'); if (cpp) cpp.hidden = true; // 申し込み直しはカードだけ
      $('#cf-when').textContent = 'お申し込みの日に1回目の' + yen(c.price) + 'を請求し、以後は' + every + '同じ日に自動で請求します(前払い)';
    } else {
      $('#cf-t1').textContent = '14日無料: ' + jdate(now, false) + '〜' + jdate(end, false);
      $('#cf-trial').textContent = jdate(now) + '〜' + jdate(end) + 'の' + DAYS + '日間';
      $('#cf-trial2').hidden = false;
      var cpp2 = $('#cf-pay-pp'); if (cpp2) cpp2.hidden = false;
      $('#cf-when').textContent = jdate(end) + 'に1回目の' + yen(c.price) + 'を自動で請求し、以後は' + every + '同じ日に請求します(前払い)。終了3日前にメールでお知らせします';
    }
    $('#cf-term').textContent = (st.cyc === 'month' ? '1か月' : '1年') + 'ごとに自動で更新し、解約するまで続きます';
    $('#cf-period').textContent = isF
      ? '1回目のお支払いが済んだ方が100名に達するまで' + (cfg.FOUNDER_DEADLINE ? '(遅くとも' + jdate(new Date(cfg.FOUNDER_DEADLINE + 'T00:00:00')) + 'まで)' : '') + '。受付中にお申し込みの方は、無料期間中でもこの価格のまま。続けている間は上がりません'
      : '期限はありません';
    // 事前登録のメールに、選んだプランを書き添える
    var pr = $('#pl-prereg');
    if (pr) {
      if (!preHref && /body=/.test(pr.getAttribute('href') || '')) preHref = pr.getAttribute('href');
      if (preHref) pr.setAttribute('href', preHref.replace('body=', 'body=' + encodeURIComponent('希望のプラン: ' + name + '(' + cycl + ')\n')));
    }
    payBox();
  }

  function choose(base, scroll) {
    if (!open(base + '_' + st.cyc)) return;
    st.base = base; st.chosen = true; U.store.set('plan-pick2', base + '_' + st.cyc);
    if (history.replaceState) history.replaceState(null, '', '?plan=' + base + '_' + st.cyc + '#pl-step2');
    paint();
    if (scroll) {
      var s2 = $('#pl-step2');
      s2.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      var h = $('#pl-s2h'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    }
  }
  $$('#pl-cards .pc-go').forEach(function (a) {
    a.addEventListener('click', function (e) { e.preventDefault(); choose(a.getAttribute('data-pick'), true); });
  });
  $$('#pl-cyc input').forEach(function (i) {
    i.addEventListener('change', function () {
      if (!i.checked) return; st.cyc = i.value;
      if (st.chosen) { U.store.set('plan-pick2', st.base + '_' + st.cyc); if (history.replaceState) history.replaceState(null, '', '?plan=' + st.base + '_' + st.cyc + location.hash); }
      paint();
    });
  });
  var back = $('.pl-back');
  if (back) back.addEventListener('click', function (e) { e.preventDefault(); var s1 = $('#pl-step1'); s1.scrollIntoView({ block: 'start' }); var b = $('#pl-cards .pc.on .pc-go'); if (b) b.focus({ preventScroll: true }); });

  /* 先着100名の残り(Worker が public/founders に書く。誰でも読める) */
  function loadFounders() {
    var fc = cfg.FIREBASE_CONFIG; if (!fc || !fc.projectId) return;
    fetch('https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(fc.projectId) + '/databases/(default)/documents/public/founders?key=' + encodeURIComponent(fc.apiKey))
      .then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
        if (!j || !j.fields) return;
        var f = j.fields, taken = Number((f.taken || {}).integerValue || 0), limit = Number((f.limit || {}).integerValue || 100), on = !(f.open && f.open.booleanValue === false);
        if (cfg.FOUNDER_DEADLINE && Date.now() > new Date(cfg.FOUNDER_DEADLINE + 'T23:59:59').getTime()) on = false;
        founder = { open: on && taken < limit && open('founder_month'), left: Math.max(0, limit - taken) };
        var l = $('#pl-founder-left'); if (l) l.textContent = founder.open ? '・残り' + founder.left + '名' : '';
        paint();
      }).catch(function () { /* 表示はそのまま */ });
  }

  /* 申し込みの欄: 未ログイン → ログイン/契約あり → マイページへ/それ以外 → 「カードで申し込む」(主)と「PayPalで払う」(小さく) */
  var drawn = null, busy = false;
  var CARD_HTML = null;
  function payErr(t) { var m = $('#pl-pay-err'); if (!m) return; m.textContent = t || ''; m.hidden = !t; }
  function cardIdle() { var b = $('#pl-card'); if (b && CARD_HTML != null) { b.innerHTML = CARD_HTML; b.removeAttribute('aria-busy'); } busy = false; }
  function payBox() {
    if (!SA || !SA.billingReady) return;
    var s = SA.state(), login = $('#pl-login'), buy = $('#pl-buy'), has = $('#pl-has');
    login.hidden = !!s.user || s.phase === 'loading'; buy.hidden = true; has.hidden = true;
    if (!s.user) { drawn = null; return; }
    var pk = s.plan.key;
    if (pk !== 'free' && pk !== 'ended') {
      has.hidden = false;
      $('#pl-has-t').textContent = 'このアカウント(' + s.user.email + ')は「' + s.plan.label + '」です。プランの変更・一時停止・解約はマイページからできます。';
      return;
    }
    buy.hidden = false;
    $('#pl-who').innerHTML = 'お申し込みのアカウント: <b>' + esc(s.user.email) + '</b>';
    var k = key(), again = returning(), sig = k + (again ? ':again' : '');
    if (drawn === sig) return;
    drawn = sig;
    var cb = $('#pl-card'), prep = $('#pl-card-prep'), alt = $('#pl-pp-alt'), box = $('#pl-pp'), open = $('#pl-pp-open');
    if (CARD_HTML == null) CARD_HTML = cb.innerHTML;
    payErr('');
    // PayPal は初めてのお申し込みの時だけ(PayPal のプランには無料期間が付いているため)。押した時に読み込む
    var ppOk = !again && SA.paypalReady(k);
    alt.hidden = !ppOk; box.hidden = true; box.innerHTML = ''; open.hidden = false; open.setAttribute('aria-expanded', 'false');
    cb.disabled = true; prep.hidden = true;
    SA.stripePlans().then(function (list) {
      if (drawn !== sig) return;
      var ok = list.indexOf(k) >= 0;
      cb.disabled = !ok || busy; prep.hidden = ok;
      if (!ok && ppOk) showPayPal(); // カードが準備中で PayPal があれば、PayPal のボタンをそのまま出す
    });
  }
  function showPayPal() {
    var box = $('#pl-pp'), open = $('#pl-pp-open'), k = key();
    open.hidden = true; open.setAttribute('aria-expanded', 'true'); box.hidden = false;
    if (box.getAttribute('data-k') === k && box.children.length) return;
    box.setAttribute('data-k', k);
    box.innerHTML = '<p class="muted">PayPalのボタンを読み込んでいます…</p>';
    SA.renderPayButton(box, k, function () { location.href = '../mypage/?subscribed=1'; })
      .catch(function () { box.removeAttribute('data-k'); box.innerHTML = '<p class="msg err">PayPalのボタンを読み込めませんでした。通信を確かめて、ページを開き直してください。</p>'; });
  }
  var ppo = $('#pl-pp-open'); if (ppo) ppo.addEventListener('click', showPayPal);
  var cbtn = $('#pl-card');
  if (cbtn) cbtn.addEventListener('click', function () {
    if (busy) return; busy = true; payErr('');
    if (CARD_HTML == null) CARD_HTML = cbtn.innerHTML;
    cbtn.disabled = true; cbtn.setAttribute('aria-busy', 'true');
    cbtn.innerHTML = '<span class="pay-card-l">カードの画面を開いています…</span>';
    SA.checkout(key()).catch(function (e) {
      cardIdle(); drawn = null;
      var code = e && e.code;
      if (code === 'founder-closed') {
        founder = { open: false, left: 0 };
        var l = $('#pl-founder-left'); if (l) l.textContent = '';
        paint();
        payErr('先着100名の価格の受付は、たったいま終わりました。上の金額が変わったので、ご確認のうえ、もう一度お申し込みください。');
        var s2 = $('#pl-step2'); if (s2) s2.scrollIntoView({ block: 'start' });
        return;
      }
      paint();
      if (code === 'has-sub') payErr('このアカウントには、いまの契約があります。マイページの契約内容をご確認ください。');
      else if (e && e.status === 401) payErr('ログインの期限が切れました。ページを開き直して、もう一度お試しください。');
      else payErr('カードの画面を開けませんでした。通信を確かめて、もう一度お試しください。' + (SA.paypalReady(key()) && !returning() ? '下の「PayPalで払う」からも申し込めます。' : ''));
    });
  });
  // Stripe の画面から「戻る」で帰ってきた時(ページが保存から戻る)に、ボタンを元に戻す
  window.addEventListener('pageshow', function (e) { if (e.persisted) { cardIdle(); drawn = null; payBox(); } });
  var lb = $('#pl-login-btn'); if (lb) lb.addEventListener('click', function () { SA.open(location.pathname + '?plan=' + st.base + '_' + st.cyc + '#pl-step2'); });
  document.addEventListener('sedori:acct', paint);

  paint();
  if (st.chosen && location.hash === '#pl-step2') setTimeout(function () { var s2 = $('#pl-step2'); if (s2) s2.scrollIntoView({ block: 'start' }); }, 0);
  loadFounders();
})();
