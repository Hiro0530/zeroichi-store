/* マイページ: アカウント、契約内容(一時停止・プラン変更・解約について)、台帳とデータ(書き出し・同期・削除)、通知。
   解約は「契約内容」の「解約について」の中。一時停止・年払いへの変更・書き出しのご案内と同じ画面に「解約する」を置く(操作は2回+確認)。
   カード(Stripe)の契約は Worker の /stripe/…、PayPal の契約は /paypal/… に頼む(SedoriAccount が契約の provider で分ける)。
   カードの解約は期間の終わりで終える(日割りの返金なし)。 */
(function () {
  'use strict';
  var U = window.SedoriUI, $ = U.$, $$ = U.$$, esc = U.esc;
  var SA = window.SedoriAccount, cfg = window.ZW_CONFIG || {};
  var WD = '日月火水木金土';
  function jd(ms) { if (!ms) return '—'; var d = new Date(ms); return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日(' + WD[d.getDay()] + ')'; }
  function jdt(ms) { if (!ms) return '—'; var d = new Date(ms); return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); }
  var q = new URLSearchParams(location.search);
  var busy = false, note = '';
  if (q.get('subscribed')) note = 'お申し込みを受け付けました。契約内容に反映されるまで、数秒〜1分ほどかかります。';
  if (q.get('revised')) note = 'プランの変更をPayPalで承認しました。反映まで数分かかることがあります。';
  if (q.get('card')) note = 'カードを変えました。次回からは新しいカードで請求します。';
  // Stripe の申し込み画面から戻った時は、Webhook を待たずに反映を頼む(1回だけ)
  var sessionId = /^cs_[\w-]+$/.test(q.get('session_id') || '') ? q.get('session_id') : null;
  function linkOnce(s) {
    if (!sessionId || !s.user || !SA.linkStripe) return;
    var id = sessionId; sessionId = null;
    SA.linkStripe(id).catch(function () { /* Webhook で反映される */ }).then(function () {
      if (history.replaceState) history.replaceState(null, '', location.pathname + '?subscribed=1' + location.hash);
    });
  }

  /* ---------- アカウント ---------- */
  function paintAccount(s) {
    if (!s.ready) return;
    $('#mp-out').hidden = !!s.user; $('#mp-in').hidden = !s.user;
    if (s.user) $('#mp-email').textContent = s.user.email;
  }
  var lb = $('#mp-login'); if (lb) lb.addEventListener('click', function () { SA.open(); });
  var lo = $('#mp-logout'); if (lo) lo.addEventListener('click', function () { SA.signOut().then(function () { U.toast('ログアウトしました。この端末の台帳はそのまま残ります'); }); });

  /* ---------- 契約内容 ---------- */
  function yearText(k) {
    var c = (cfg.PLAN_CATALOG || {})[k]; if (!c) return '年払い';
    var m = Math.round(c.price / 12);
    return '年' + c.price.toLocaleString('ja-JP') + '円(月あたり' + (c.price % 12 ? '約' : '') + m.toLocaleString('ja-JP') + '円)';
  }
  function planKeyOf(sub) { return (sub && sub.planKey) || ''; }
  /** 年払いの全額返金の期限(Worker が subscription.refundUntil に書く。1回目のお支払いから30日)。過ぎていれば 0 */
  function refundUntil(sub) {
    var t = sub && sub.refundUntil ? (window.SedoriSync && SedoriSync.toMs ? SedoriSync.toMs(sub.refundUntil) : new Date(sub.refundUntil).getTime()) : 0;
    return t && Date.now() <= t ? t : 0;
  }
  function amountOf(sub) { return (sub && sub.amount ? String(sub.amount).replace(/^(月|年)/, '') : '支払った金額'); }
  /** プランの切り替え先(同じ支払いの周期で。ライト・総合・業務のうち、いまのプラン以外) */
  var TIER_RANK = { light: 1, total: 2, business: 3 };
  function switchList(pk) {
    var cat = cfg.PLAN_CATALOG || {}, cyc = /_year$/.test(pk) ? '_year' : '_month', cur = cat[pk];
    if (!cur) return [];
    return ['light', 'total', 'business'].filter(function (t) { return t !== cur.tier; }).map(function (t) {
      var key = t + cyc, c = cat[key]; if (!c || c.open === false) return null;
      var up = TIER_RANK[t] > TIER_RANK[cur.tier];
      return { key: key, up: up, tier: t, label: c.name + 'に変える(' + (cyc === '_year' ? '年' : '月') + c.price.toLocaleString('ja-JP') + '円)',
        note: cur.founder ? '先着' + (Number(cfg.FOUNDER_LIMIT) || 200) + '名の価格から変えると、元の価格には戻せません' : '' };
    }).filter(Boolean);
  }
  function isCard(sub) { return !!(sub && sub.provider === 'stripe'); }
  /** カードの契約でプランを変える時の説明(その場で変わる・差額は日割り) */
  function reviseText(toKey, p) {
    var c = (cfg.PLAN_CATALOG || {})[toKey]; if (!c) return '';
    var price = (c.cycle === 'year' ? '年' : '月') + c.price.toLocaleString('ja-JP') + '円';
    if (p.key === 'trial') return 'その場で「' + c.name + '(' + price + ')」に変わります。無料期間はそのまま続き、終わる日からこの料金になります。';
    if (c.cycle === 'year' && !/_year$/.test(planKeyOf(SA.state().sub))) return 'その場で年払いに変わり、今日、' + price + 'から今月の残りの日数分を差し引いて請求します。次からは毎年同じ日の請求です(月払いから変えた年払いは、30日以内の全額返金の対象外です)。';
    return 'その場で「' + c.name + '(' + price + ')」に変わります。差額は日割りで、次回の請求で精算します。';
  }
  function paintPlan(s) {
    var box = $('#mp-plan-box'), det = $('#cancel');
    if (!s.ready) { box.innerHTML = '<p class="muted">有料プランは準備中です。<a href="../plans/">料金を見る</a></p>'; det.hidden = true; return; }
    if (!s.user) { box.innerHTML = '<p class="muted">ログインすると表示します。</p>'; det.hidden = true; return; }
    var p = s.plan, sub = s.sub || {}, rows = [];
    rows.push(['プラン', esc(p.label)]);
    if (p.key === 'trial') rows.push(['無料期間', jd(p.until) + 'まで。それまでは業務のすべてを使えます。この日から上のプランで続き、1回目の請求があります']);
    if (p.key === 'active' || p.key === 'past_due') rows.push(['次回の請求日', jd(p.next)]);
    var card = isCard(sub);
    if (p.key === 'past_due' || p.key === 'suspended') rows.push(['お支払い', '<span class="warnt">' + (card ? '前回の請求がカードで通っていません。カードを変えるか、カード会社にご確認ください' : '前回のお支払いが確認できていません。PayPalのお支払い方法をご確認ください') + '</span>']);
    if (p.key === 'paused') rows.push(['再開する日', jd(p.until) + '(この日から請求を再開します)']);
    if (p.key === 'ending') rows.push(['使える期限', jd(p.until) + 'まで。以後は請求しません']);
    if (p.key === 'ending' || p.key === 'ended') rows.push(['台帳の保管', jd(p.retainUntil) + 'まで保管し、その後に消します']);
    if (sub.amount) rows.push(['料金(税込)', esc(sub.amount)]);
    var ru = refundUntil(sub);
    if (ru && p.key === 'active') rows.push(['全額返金', jd(ru) + 'までに解約すれば、' + esc(amountOf(sub)) + 'を全額返金します(年払いの1回目のお支払いから30日以内)']);
    if (sub.refunded) rows.push(['返金', '全額を返金しました。カードの明細に出るまで、カード会社により5〜10営業日ほどかかります']);
    if (p.key !== 'free') rows.push(['お支払いの方法', card
      ? 'カード(決済代行: Stripe)' + (sub.customerId ? '<span class="meta"><button type="button" class="lnk" data-portal="card">カードを変える</button><button type="button" class="lnk" data-portal="">請求の履歴・領収書</button></span>' : '')
      : 'PayPal' + (sub.id ? '<span class="meta">契約番号 ' + esc(sub.id) + '</span>' : '')]);
    var btns = '';
    if (card && (p.key === 'past_due' || p.key === 'suspended')) btns += '<button type="button" class="btn" data-portal="card">カードを変える</button>';
    if (p.key === 'free' || p.key === 'ended') btns = '<a class="btn" href="../plans/">プランを選ぶ(14日無料)</a>';
    if (p.key === 'paused') btns = '<button type="button" class="btn" id="mp-resume">今すぐ再開する</button>';
    var sws = (p.key === 'trial' || p.key === 'active') ? switchList(planKeyOf(sub)) : [];
    sws.forEach(function (sw, i) { btns += '<button type="button" class="btn sm ghost" data-sw="' + i + '">' + esc(sw.label) + '</button>'; });
    if (sws.length && sws[0].note) btns += '<span class="hint">' + esc(sws[0].note) + '</span>';
    box.innerHTML = (note ? '<p class="msg">' + esc(note) + '</p>' : '') + '<table class="kv wide">' + rows.map(function (r) { return '<tr><th>' + r[0] + '</th><td>' + r[1] + '</td></tr>'; }).join('') + '</table>' + (btns ? '<div class="row-btns">' + btns + '</div>' : '');
    $$('#mp-plan-box [data-sw]').forEach(function (b) { b.addEventListener('click', function () {
      var sw = sws[Number(b.getAttribute('data-sw'))];
      if (card && !window.confirm(reviseText(sw.key, p) + '\n\nよろしいですか。')) return;
      act(SA.revise(sw.key), card ? 'プランを変えました' : 'PayPalの画面に移ります');
    }); });
    $$('#mp-plan-box [data-portal]').forEach(function (b) { b.addEventListener('click', function () { b.disabled = true; SA.portal(b.getAttribute('data-portal')).catch(function () { b.disabled = false; U.toast('Stripeの画面を開けませんでした。通信を確かめてください'); }); }); });
    var rs = $('#mp-resume'); if (rs) rs.addEventListener('click', function () { act(SA.resume(), '再開しました'); });
    det.hidden = false;
    paintCancel(s);
  }

  function paintCancel(s) {
    var p = s.plan, alt = $('#mp-alt'), doBox = $('#mp-cancel-do'), pk = planKeyOf(s.sub);
    if (!p.canCancel) {
      alt.innerHTML = '';
      doBox.innerHTML = '<p class="muted">' + (p.key === 'ending' ? '解約の手続きは済んでいます。' + jd(p.until) + 'まで使えます。' : '解約する契約はありません。') + '</p>';
      return;
    }
    var items = [], card = isCard(s.sub);
    var ru = card && p.key === 'active' ? refundUntil(s.sub) : 0;
    var refundNote = '年払いの1回目のお支払いから30日以内(' + jd(ru) + 'まで)のため、' + amountOf(s.sub) + 'を全額返金し、今日で終わります。';
    var ppLi = $('#mp-alt-pp'); if (ppLi) ppLi.hidden = card;
    if (p.key === 'active') items.push('<div class="alt-i"><b>1か月だけ止める</b><p>1か月の間は請求せず、' + jd(Date.now() + 30 * 864e5) + 'ごろに自動で再開します。止めている間もクラウドの台帳は読めて、書き出せます(保存は再開後に)。</p><button type="button" class="btn sm ghost" id="mp-pause">1か月止める</button></div>');
    if (/_month$/.test(pk)) items.push('<div class="alt-i"><b>年払いに変える</b><p>' + yearText(pk.replace('_month', '_year')) + '。' + (card ? reviseText(pk.replace('_month', '_year'), p) : 'PayPalの画面で承認すると、次の請求から変わります。') + '</p><button type="button" class="btn sm ghost" id="mp-year">年払いに変える</button></div>');
    var swc = switchList(pk).filter(function (x) { return x.tier === 'light'; })[0];
    if (swc) items.push('<div class="alt-i"><b>ライトに変える</b><p>台帳のクラウド保存(月' + (Number(cfg.LIGHT_MONTHLY_LIMIT) || 100) + '件まで)・バーコードの同期・終了前の通知は、そのまま使えます。' + esc(swc.note) + '</p><button type="button" class="btn sm ghost" id="mp-light">' + esc(swc.label) + '</button></div>');
    if (/^founder/.test(pk)) items.push('<div class="alt-i"><p class="hint">先着' + (Number(cfg.FOUNDER_LIMIT) || 200) + '名の価格は、' + esc(cfg.FOUNDER_KEEP || '解約しない限りずっと(サービス提供中)') + 'の価格です。解約して申し込み直すと、その時の価格になります。</p></div>');
    if (p.key === 'trial') items.push('<div class="alt-i"><p class="hint">いまは無料期間中です。' + jd(p.until) + 'より前に解約すれば、料金はかかりません。</p></div>');
    alt.innerHTML = items.join('');
    doBox.innerHTML = '<label class="inl">解約の理由(任意) <select id="mp-reason"><option value="">選ばない</option><option>使う機会が減った</option><option>料金が合わない</option><option>機能が足りない</option><option>ほかの道具にした</option><option>その他</option></select></label>' +
      '<div class="row-btns"><button type="button" class="btn danger" id="mp-cancel">解約する</button><span class="hint">' + (p.key === 'trial' ? '無料期間中のため、料金はかかりません。' : ru ? refundNote : '次回の請求日 ' + jd(p.next) + ' からは請求しません。それまで使えます。') + '</span></div>';
    var moved = card ? 'プランを変えました' : 'PayPalの画面に移ります';
    var lt = $('#mp-light'); if (lt) lt.addEventListener('click', function () { if (card && !window.confirm(reviseText(swc.key, p) + '\n\nよろしいですか。')) return; act(SA.revise(swc.key), moved); });
    var pz = $('#mp-pause'); if (pz) pz.addEventListener('click', function () { act(SA.pause(), '1か月止めました'); });
    var yr = $('#mp-year'); if (yr) yr.addEventListener('click', function () { var yk = pk.replace('_month', '_year'); if (card && !window.confirm(reviseText(yk, p) + '\n\nよろしいですか。')) return; act(SA.revise(yk), moved); });
    $('#mp-cancel').addEventListener('click', function () {
      var msg = '解約します。\n\n' + (p.key === 'trial' ? '無料期間中のため、料金はかかりません。' : ru ? refundNote : '次回の請求日 ' + jd(p.next) + ' からは請求しません。それまでは使えます。') + '\nクラウドの台帳は3年間保管し、マイページから書き出せます。';
      if (!window.confirm(msg)) return;
      act(SA.cancel($('#mp-reason').value), ru ? '解約し、全額を返金しました' : '解約しました');
    });
  }
  function act(promise, okMsg) {
    if (busy) return; busy = true;
    $$('#cancel button').forEach(function (b) { b.disabled = true; });
    promise.then(function () { U.toast(okMsg); }).catch(function (e) {
      var card = isCard(SA.state().sub);
      $('#mp-cancel-do').insertAdjacentHTML('beforeend', '<p class="msg err">いま手続きできませんでした(' + esc((e && e.message) || '通信') + ')。' + (card ? '下のメールでも解約できます。' : '下の「PayPalから」の手順か、メールでも解約できます。') + '</p>');
    }).then(function () { busy = false; $$('#cancel button').forEach(function (b) { b.disabled = false; }); });
  }

  /* ---------- 台帳とデータ ---------- */
  function paintData(s) {
    var all = U.ledger.all(), wait = all.filter(function (r) { return r.wait; }).length;
    var syncLabel = { local: 'この端末だけに保存', synced: 'クラウドと同期済み', pending: '同期待ち ' + s.pending + '件', syncing: '同期中', error: '同期できていません(通信を確かめてください)', paused: '同期を止めています' }[s.sync] || '';
    var t = [['この端末の台帳', all.length + '件' + (wait ? '<span class="meta">うち仕入れ前(無在庫で出品中)' + wait + '件</span>' : '')], ['保存先', s.user && s.plan.paid ? 'この端末とクラウド(Google Cloud 東京リージョン)' : 'この端末のブラウザの中だけ']];
    if (s.user) t.push(['同期', esc(syncLabel) + (s.lastSync ? '<span class="meta">最後に確認 ' + jdt(s.lastSync) + '</span>' : '')]);
    $('#mp-data-t').innerHTML = t.map(function (r) { return '<tr><th>' + r[0] + '</th><td>' + r[1] + '</td></tr>'; }).join('');
    $('#mp-sync').hidden = !(s.user && s.plan.paid);
    $('#mp-cloud-exp').hidden = !s.user;
    $('#mp-del').hidden = !s.user;
  }
  function exportRows(kind, rows) {
    if (!rows.length) { U.toast('書き出す行がありません'); return; }
    if (kind === 'csv') U.exportCSV(rows); else U.exportXLSX(rows);
  }
  $$('[data-exp]').forEach(function (b) { b.addEventListener('click', function () { exportRows(b.getAttribute('data-exp'), U.ledger.all()); }); });
  $('#mp-cloud-exp').addEventListener('click', function () {
    SA.cloudRows().then(function (rows) { exportRows('xlsx', rows); }).catch(function () { U.toast('クラウドの台帳を読めませんでした'); });
  });
  $('#mp-sync').addEventListener('click', function () { SA.syncNow(); U.toast('同期しています'); });
  $('#mp-del-cloud').addEventListener('click', function () {
    if ($('#mp-del-word').value.trim() !== '消す') { U.toast('確認のため「消す」と入れてください'); $('#mp-del-word').focus(); return; }
    SA.deleteCloud($('#mp-del-local').checked).then(function (n) { U.toast('クラウドの台帳と帳簿を消しました(' + n + '件)'); render(); }).catch(function () { U.toast('消せませんでした。通信を確かめてください'); });
  });
  $('#mp-del-acct').addEventListener('click', function () {
    if (SA.paid()) { U.toast('先に解約してください(契約内容 > 解約について)'); return; }
    if ($('#mp-del-word').value.trim() !== '消す') { U.toast('確認のため「消す」と入れてください'); $('#mp-del-word').focus(); return; }
    SA.deleteAccount().then(function () { U.toast('アカウントを削除しました'); setTimeout(function () { location.href = '../'; }, 1200); })
      .catch(function (e) { U.toast(e && e.code === 'auth/requires-recent-login' ? 'もう一度ログインしてから、削除してください' : '削除できませんでした'); });
  });

  /* ---------- 通知 ---------- */
  var nb = $('#lg-notify');
  function paintNotify() { var on = U.notifyOn(); nb.setAttribute('aria-pressed', String(on)); nb.textContent = on ? '終了60分前の通知: オン' : '終了60分前の通知: オフ'; }
  nb.addEventListener('click', function () { U.enableNotify(!U.notifyOn()).then(paintNotify); });
  document.addEventListener('sedori:notify', paintNotify);

  function render() {
    var s = SA ? SA.state() : { ready: false, plan: {}, sync: 'local', pending: 0 };
    paintAccount(s); paintPlan(s); paintData(s);
    if (SA) linkOnce(s);
  }
  document.addEventListener('sedori:acct', render);
  document.addEventListener('sedori:remote', render);
  render(); paintNotify();
  // #cancel(マイページ > 契約内容 > 解約について)で開いた時は、表示できた時に開いておく
  var wantCancel = location.hash === '#cancel';
  function openCancel() { var d = $('#cancel'); if (wantCancel && d && !d.hidden) { d.open = true; d.scrollIntoView({ block: 'start' }); wantCancel = false; } }
  document.addEventListener('sedori:acct', openCancel); openCancel();
  window.addEventListener('hashchange', function () { if (location.hash === '#cancel') { wantCancel = true; openCancel(); } });
})();
