/* マイページ(利用の鍵の形。config の KEY_MODE が true の時)。
   利用の鍵と契約(状態・次回の請求日・使える期限・鍵・「契約の管理」= Stripe の画面)、解約について(いつまで使えるか・止まった後にできること)、
   データ(この端末の中。すべて書き出す/取り込む・台帳だけ表で)、通知。
   解約・カードの変更・プランの変更・領収書は、お客が「契約の管理」から自分で行う。こちらは名簿を持たない。 */
(function () {
  'use strict';
  var U = window.SedoriUI, $ = U.$, $$ = U.$$, esc = U.esc;
  var L = window.SedoriLicense, SA = window.SedoriAccount, cfg = window.ZW_CONFIG || {};
  if (!L || !L.state || !SA || !SA.keyMode) return;
  var WD = '日月火水木金土';
  function jd(ms) { if (!ms) return '—'; var d = new Date(ms); return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日(' + WD[d.getDay()] + ')'; }
  function jdShort(ms) { if (!ms) return '—'; var d = new Date(ms); return (d.getMonth() + 1) + '月' + d.getDate() + '日'; }
  var showCode = false, fullList = null, typed = '';
  var PAID_WHAT = '帳簿・在庫番の自動の確かめ・まとめての計算の行数など';

  function err(t) { var m = $('#mk-err'); m.textContent = t || ''; m.hidden = !t; }
  function masked(c) { return c ? c.slice(0, 4) + '-••••-••••-' + c.slice(-4) : ''; }

  function paintKey(s) {
    var q = new URLSearchParams(location.search);   // 申し込み直後は license.js が ?session_id を ?subscribed=1 に替えるので、毎回読む
    var box = $('#mk-box'), form = $('#mk-form'), i = s.info || {}, rows = [], btns = '', lead = '';
    form.hidden = !(s.key === 'none' || s.key === 'removed');
    $('#mk-more').hidden = !s.code;
    if (s.busy && !s.checked) { box.innerHTML = '<p class="muted">確かめています…</p>'; return; }
    if (q.get('session_id') && s.busy) { box.innerHTML = '<p class="msg">お申し込みを確かめています。数秒お待ちください…</p>'; return; }
    if (s.key === 'none') {
      box.innerHTML = '<p>この端末には、利用の鍵が入っていません。いまは無料の範囲で使えます。</p>' +
        '<div class="row-btns"><a class="btn" href="../plans/">プランを選ぶ</a></div>' +
        '<p class="hint">ほかの端末で申し込んだ方は、下に利用の鍵を入れてください。ログインは要りません。</p>';
      return;
    }
    if (s.key === 'removed') {
      box.innerHTML = '<p class="msg">この端末は、ほかの端末から外されたか、鍵が作り直されました。続けて使う時は、いまの利用の鍵を入れてください。</p>';
      return;
    }
    if (q.get('subscribed')) lead = '<p class="msg">お申し込みが済み、この端末に利用の鍵が入りました。鍵は Stripe から届く請求書・領収書にも載っています。ほかの端末(3台まで)では、この鍵を入れてください。</p>';
    if (q.get('back')) lead = '<p class="msg">契約の管理から戻りました。変えた内容は、下の「今すぐ確かめる」で反映します(1日1回は自動で確かめます)。</p>';
    rows.push(['プラン', esc(s.label)]);
    if (s.key === 'active') rows.push(['次回の請求日', jd(s.next)]);
    if (s.key === 'past_due') rows.push(['お支払い', '<span class="warnt">前回の請求がカードで通っていません。「契約の管理」でカードを変えてください。Stripe が数日おきに請求し直す間は使えます</span>']);
    if (s.key === 'ending') rows.push(['使える期限', '<b>' + jd(s.until) + '</b>まで。以後は請求しません']);
    if (s.key === 'ended') rows.push(['状態', '有料の機能は止まっています' + (s.end ? '(' + jd(s.end) + 'に終わりました)' : '') + '。データの書き出しは、いつでもできます']);
    if (i.amount) rows.push(['料金(税込)', esc(i.amount)]);
    rows.push(['利用の鍵', '<code class="mk-code" id="mk-code-v">' + esc(showCode ? s.code : masked(s.code)) + '</code><span class="meta"><button type="button" class="lnk" id="mk-show">' + (showCode ? '隠す' : '表示する') + '</button><button type="button" class="lnk" id="mk-copy">写す</button></span>']);
    rows.push(['お支払いの方法', 'カード(決済代行: Stripe)']);
    if (s.key !== 'ended') btns += '<button type="button" class="btn" id="mk-portal">契約の管理(解約・カード・領収書)</button>';
    else btns += '<a class="btn" href="../plans/">プランを選んで続ける</a>';
    btns += '<button type="button" class="btn sm ghost" id="mk-renew"' + (s.busy ? ' disabled' : '') + '>今すぐ確かめる</button>';
    box.innerHTML = lead + '<table class="kv wide">' + rows.map(function (r) { return '<tr><th>' + r[0] + '</th><td>' + r[1] + '</td></tr>'; }).join('') + '</table><div class="row-btns">' + btns + '</div>' +
      '<p class="hint">契約の管理は、決済代行の Stripe の画面です。プランの変更・解約・カードの変更・請求書と領収書は、そこでご自身でできます。</p>';
    var sh = $('#mk-show'); if (sh) sh.addEventListener('click', function () { showCode = !showCode; render(); });
    var cp = $('#mk-copy'); if (cp) cp.addEventListener('click', function () {
      var c = L.state().code; (navigator.clipboard ? navigator.clipboard.writeText(c) : Promise.reject()).then(function () { U.toast('利用の鍵を写しました'); }, function () { showCode = true; render(); U.toast('鍵を表示しました。長押しで写してください'); });
    });
    var po = $('#mk-portal'); if (po) po.addEventListener('click', function () { po.disabled = true; err(''); L.portal().catch(function (e) { po.disabled = false; err('Stripe の画面を開けませんでした(' + ((e && e.message) || '通信') + ')'); }); });
    var rn = $('#mk-renew'); if (rn) rn.addEventListener('click', function () { err(''); L.renew(true).then(function () { U.toast('契約の様子を確かめました'); }, function (e) { err((e && e.message) || '通信できませんでした'); }); });
  }

  function paintDevices(s) {
    var box = $('#mk-dev-box'), list = fullList ? fullList.devices : ((s.info || {}).devices || []), lim = fullList ? fullList.limit : ((s.info || {}).limit || 3);
    box.hidden = !list.length; if (!list.length) return;
    if (fullList) box.open = true;
    $('#mk-dev').innerHTML = '<p>1つの鍵で' + lim + '台まで使えます。35日使っていない端末は自動で外れます。</p><ul class="mk-devs">' + list.map(function (d) {
      return '<li><span>' + esc(d.name) + (d.me ? '(この端末)' : '') + '<small>最後に使った日 ' + jdShort(d.lastDay) + 'ごろ</small></span>' + (d.me ? '' : '<button type="button" class="btn sm ghost" data-rm="' + esc(d.id) + '">外す</button>') + '</li>';
    }).join('') + '</ul>';
    $$('#mk-dev [data-rm]').forEach(function (b) { b.addEventListener('click', function () {
      if (!window.confirm('この端末を外します。外した端末は、鍵を入れ直すまで無料の範囲に戻ります。よろしいですか。')) return;
      b.disabled = true;
      L.removeDevice(b.getAttribute('data-rm'), fullList ? typed : '').then(function () {
        if (fullList) { var code = typed; fullList = null; return L.use(code).then(function () { U.toast('端末を外し、この端末に鍵を入れました'); }); }
        U.toast('端末を外しました');
      }).catch(function (e) { err((e && e.message) || '外せませんでした'); }).then(render);
    }); });
  }

  function paintCancel(s) {
    var el = $('#mk-cancel'), t;
    if (s.key === 'active' || s.key === 'past_due') t = '<p class="mk-when">いま解約すると: 支払い済みの期間の終わり(<b>' + jd(s.next) + '</b>)まで使えます。次回からは請求しません。</p>';
    else if (s.key === 'ending') t = '<p class="mk-when">解約済みです。<b>' + jd(s.until) + '</b>まで使えます。</p>';
    else if (s.key === 'ended') t = '<p class="mk-when">契約は終わっています' + (s.end ? '(' + jd(s.end) + ')' : '') + '。</p>';
    else t = '<p class="muted">この端末には、解約する契約がありません。</p>';
    var after = s.key === 'none' || s.key === 'removed' ? '' : '<p>その日に、有料の機能(' + PAID_WHAT + ')は止まり、無料の範囲に戻ります。<b>台帳・帳簿などのデータはこの端末に残り、解約の後もいつでも書き出せます</b>(期限はありません)。</p>';
    el.innerHTML = t + after;
  }

  function paintData() {
    var all = U.ledger.all(), last = U.store.get('last-export', null);
    $('#mp-data-t').innerHTML = [['この端末の台帳', all.length + '件'], ['保存先', 'この端末のブラウザの中だけ(当方のサーバーには送りません)'], ['最後に書き出した日', last ? jd(last) : 'まだありません']]
      .map(function (r) { return '<tr><th>' + r[0] + '</th><td>' + r[1] + '</td></tr>'; }).join('');
  }

  function render() { var s = L.state(); paintKey(s); paintDevices(s); paintCancel(s); paintData(); }

  /* 鍵を入れる */
  $('#mk-form').addEventListener('submit', function (e) {
    e.preventDefault(); err('');
    typed = $('#mk-code').value.trim();
    if (!/^[2-9A-HJ-NP-Za-hj-np-z\s-]{16,22}$/.test(typed)) { err('利用の鍵は16文字です(例 ABCD-EFGH-JKLM-NPQR)。0・1・I・O は使っていません'); return; }
    L.use(typed).then(function (s) { fullList = null; $('#mk-code').value = ''; U.toast(s.paid ? '利用の鍵を入れました。有料の機能が使えます' : '鍵を入れました(契約は終わっています)'); render(); })
      .catch(function (x) {
        if (x && x.code === 'devices-full' && x.data) { fullList = { devices: x.data.devices || [], limit: x.data.limit || 3 }; err(x.message + '(下の一覧から外せます)'); render(); return; }
        err((x && x.message) || '鍵を確かめられませんでした');
      });
  });
  $('#mk-rotate').addEventListener('click', function () {
    if (!window.confirm('利用の鍵を作り直します。古い鍵は使えなくなり、ほかの端末には新しい鍵を入れ直す必要があります。よろしいですか。')) return;
    L.rotate().then(function () { showCode = true; U.toast('新しい鍵にしました。請求書・領収書の鍵も替わります'); render(); }, function (e) { err((e && e.message) || '作り直せませんでした'); });
  });
  $('#mk-forget').addEventListener('click', function () {
    if (!window.confirm('この端末から利用の鍵を外します。データはこの端末に残ります。よろしいですか。')) return;
    L.forget().then(function () { U.toast('この端末から鍵を外しました'); render(); });
  });

  /* データ: すべて書き出す/取り込む・台帳だけ表で */
  $('#mk-export').addEventListener('click', function () { var n = L.exportFile($('#mk-withkeys').checked); U.store.set('last-export', Date.now()); U.toast('書き出しました(' + n + '項目)'); paintData(); });
  $('#mk-import-btn').addEventListener('click', function () { $('#mk-import').click(); });
  $('#mk-import').addEventListener('change', function () {
    var f = this.files && this.files[0]; this.value = ''; if (!f) return;
    if (!window.confirm('この端末のいまのデータを、ファイルの中身に置き換えます(利用の鍵はそのまま)。よろしいですか。')) return;
    f.text().then(function (t) { var n = L.importText(t); U.toast('取り込みました(' + n + '項目)。ページを開き直します'); setTimeout(function () { location.reload(); }, 900); })
      .catch(function (e) { U.toast((e && e.message) || '取り込めませんでした'); });
  });
  $$('[data-exp]').forEach(function (b) { b.addEventListener('click', function () { var rows = U.ledger.all(); if (!rows.length) { U.toast('書き出す行がありません'); return; } if (b.getAttribute('data-exp') === 'csv') U.exportCSV(rows); else U.exportXLSX(rows); }); });

  /* 通知(今までのマイページと同じ) */
  var nb = $('#lg-notify');
  function paintNotify() { var on = U.notifyOn(), v = nb.querySelector('.sw-v'); nb.setAttribute('aria-pressed', String(on)); nb.setAttribute('aria-checked', String(on)); if (v) v.textContent = on ? '入' : '切'; }
  if (nb) { nb.addEventListener('click', function () { U.enableNotify(!U.notifyOn()).then(paintNotify); }); document.addEventListener('sedori:notify', paintNotify); paintNotify(); }

  document.addEventListener('sedori:acct', render);
  render();
})();
