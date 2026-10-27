/* 料金とお申し込み: プランを選ぶと、同じ画面の「お申し込み内容の確認」(価格・無料期間の終わる日・支払いの時期・申込みの期間)が変わる。
   ログイン済みなら PayPal のボタンを出す。設定(config.js)が null の間は「準備中」。 */
(function () {
  'use strict';
  var U = window.SedoriUI, $ = U.$, $$ = U.$$, esc = U.esc;
  var cfg = window.ZW_CONFIG || {}, SA = window.SedoriAccount;
  var DAYS = Number(cfg.TRIAL_DAYS) || 14;
  // 料金は config.js の PLAN_CATALOG だけで決める
  var PLAN = {};
  Object.keys(cfg.PLAN_CATALOG || {}).forEach(function (k) {
    var c = cfg.PLAN_CATALOG[k]; if (c.open === false) return;
    PLAN[k] = { name: c.name + (c.cycle === 'year' ? '(年払い)' : '(月払い)'), price: c.price, per: c.cycle === 'year' ? '年' : '月', cyc: c.cycle, founder: !!c.founder, tier: c.tier || 'total' };
  });
  var WD = '日月火水木金土';
  function jdate(d) { return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日(' + WD[d.getDay()] + ')'; }
  var founder = { open: true, left: null };
  var sel = new URLSearchParams(location.search).get('plan');
  if (!PLAN[sel]) sel = U.store.get('plan-pick', 'total_month');
  if (!PLAN[sel]) sel = 'total_month';   // 選んでいない時は総合・月払い
  // 画面では「プラン(4つ)」と「月払い/年払い」を別々に選ぶ。sel はその組み合わせ(total_year など)
  function parts(k) { var i = k.lastIndexOf('_'); return { base: k.slice(0, i), cyc: k.slice(i + 1) }; }

  function paint() {
    var p = PLAN[sel], now = new Date(), end = new Date(now.getTime() + DAYS * 864e5);
    var price = p.price.toLocaleString('ja-JP') + '円';
    var pt = parts(sel);
    $$('#pl-cyc input').forEach(function (i) { i.checked = i.value === pt.cyc; i.parentNode.classList.toggle('on', i.checked); });
    $$('#pl-pick [data-c]').forEach(function (el) { el.hidden = el.getAttribute('data-c') !== pt.cyc; });
    $$('#pl-pick tbody tr[data-base]').forEach(function (tr) {
      var on = tr.getAttribute('data-base') === pt.base; tr.classList.toggle('on', on);
      var r = $('input', tr); if (r) r.checked = on;
    });
    $('#cf-plan').textContent = p.name;
    $$('#cf-amount [data-tier]').forEach(function (el) { el.hidden = el.getAttribute('data-tier') !== p.tier; });
    $('#cf-price').textContent = p.per + price;
    $('#cf-trial').textContent = jdate(now) + 'から' + jdate(end) + 'まで(' + DAYS + '日間)';
    $('#cf-when').textContent = jdate(end) + '(無料期間が終わる日)に1回目の' + price + 'を請求し、以後は' + (p.cyc === 'month' ? '毎月' : '毎年') + '同じ日に自動で請求します(前払い)';
    $('#cf-term').textContent = (p.cyc === 'month' ? '1か月' : '1年') + 'ごとに自動で更新。解約するまで続きます';
    $('#cf-period').textContent = p.founder ? '先着100名まで' + (founder.left != null ? '(残り' + founder.left + '名)' : '') + (cfg.FOUNDER_DEADLINE ? '、または' + jdate(new Date(cfg.FOUNDER_DEADLINE + 'T00:00:00')) + 'まで' : '') + '。続けている間は価格が上がりません' : '期限はありません';
    $('#cf-t1').textContent = '今日から' + jdate(end) + 'までの' + DAYS + '日間は無料です。';
    $('#cf-t2').textContent = '無料期間中は、業務のすべての機能を使えます。' + jdate(end) + 'から「' + p.name + '」で続き、1回目の' + price + '(税込)をPayPalで自動でお支払いいただきます。以後は' + (p.cyc === 'month' ? '毎月' : '毎年') + '同じ日に請求します。それまでに解約すれば0円、プランの変更もマイページからできます。終了3日前にメールでお知らせします。';
    payBox();
  }

  function pick(base, cyc) {
    var k = base + '_' + cyc; if (!PLAN[k]) return;
    sel = k; U.store.set('plan-pick', sel); paint();
  }
  // 行のどこを押しても選べる。キーボードはラジオボタン(矢印キー)の change で動く
  $$('#pl-pick tbody tr[data-base]').forEach(function (tr) {
    tr.addEventListener('click', function (e) { if (e.target.tagName === 'INPUT') return; pick(tr.getAttribute('data-base'), parts(sel).cyc); });
    var r = $('input', tr); if (r) r.addEventListener('change', function () { if (r.checked) pick(r.value, parts(sel).cyc); });
  });
  $$('#pl-cyc input').forEach(function (i) { i.addEventListener('change', function () { if (i.checked) pick(parts(sel).base, i.value); }); });

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
          $$('#pl-pick tr[data-founder]').forEach(function (tr) { tr.classList.add('off'); tr.hidden = true; var fi = $('input', tr); if (fi) fi.disabled = true; });
          if (PLAN[sel].founder) sel = sel.replace('founder', 'total');
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
