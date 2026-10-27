/* せどり 利益チェック — ログイン(Firebase Auth: メールのリンク・Google)と、台帳のクラウド保存(Cloud Firestore)。
   - config.js の FIREBASE_CONFIG が null のあいだは「準備中」と表示し、何も読み込まない(無料版はそのまま)。
   - 台帳はいつもこの端末(localStorage)が先。有料(無料期間を含む)の間だけ、変わった行をクラウドへ送り、他の端末の変更を受け取る。
   - お支払いは PayPal のサブスクリプション(JS SDK のボタン)。契約の状態は Worker が PayPal の Webhook を受けて users/{uid}.subscription に書く。
   - データの形: users/{uid}(email・settings・subscription ※subscription は Worker だけが書く)、users/{uid}/ledger/{行のid}、
     users/{uid}/books/{種類~行のid}(帳簿の記録。帳簿のページで books-sync.js を読んだ時だけ。総合・業務の機能ごとに送る)
   - Firebase の部品は、ログインしたことのある端末と、マイページ・料金ページでだけ読み込む。 */
(function () {
  'use strict';
  var U = window.SedoriUI, S = window.SedoriSync;
  if (!U || !S) return;
  var $ = U.$, $$ = U.$$, esc = U.esc, store = U.store;
  var cfg = window.ZW_CONFIG || {};
  var FB_VER = '10.12.2';
  var ready = !!(cfg.FIREBASE_CONFIG && cfg.FIREBASE_CONFIG.apiKey);
  var plans = cfg.PAYPAL_PLANS || {};
  var billingReady = ready && !!cfg.PAYPAL_CLIENT_ID && Object.keys(plans).some(function (k) { return !!plans[k]; });

  var st = { phase: ready ? 'idle' : 'off', user: null, sub: null, plan: S.planState(null), sync: 'local', pending: 0, lastSync: store.get('sync-last', null), error: '' };
  var fb = null, fbPromise = null, unsubLedger = null, unsubUser = null, flushTimer = null, settingsTimer = null, applyingSettings = false, pausedFor = null, switchedFor = null;

  /* ---------- 帳簿の同期(帳簿のページだけ。books-sync.js) ----------
     この端末の記録の時刻と墓標は、ログインの準備の前からつけておく(あとで初めて同期する時にまとめるため) */
  var BS = window.SedoriBooksSync, books = null;
  if (BS && BS.create) {
    books = BS.create({
      store: store, emit: U.emit, online: function () { return navigator.onLine !== false; },
      confirmSwitch: function (n) {
        if (st.user && switchedFor === st.user.uid) return true; // 台帳の切り替えで確認済み
        return window.confirm('この端末の帳簿(' + n + '件)は、別のアカウントで同期していたものです。\n\nOK: この端末の分を消して、ログインしたアカウントの帳簿に切り替えます\nキャンセル: 帳簿は同期しません(先に仕訳帳などを書き出してください)');
      }
    });
    BS.local = books;
  }
  /** 帳簿の同期の通信の部分(Firestore) */
  function booksFs() {
    var F = fb.F;
    return {
      listen: function (uid, since, onDocs, onErr) {
        var col = F.collection(fb.db, 'users', uid, 'books');
        var q = since ? F.query(col, F.where('serverAt', '>', F.Timestamp.fromMillis(since))) : col;
        return F.onSnapshot(q, function (snap) {
          var docs = [], max = since;
          snap.docChanges().forEach(function (c) {
            if (c.type === 'removed' || c.doc.metadata.hasPendingWrites) return;
            var d = c.doc.data(), at = d.serverAt && d.serverAt.toMillis ? d.serverAt.toMillis() : 0;
            if (at > max) max = at;
            docs.push({ docId: c.doc.id, kind: d.kind, updatedAt: d.updatedAt, deleted: !!d.deleted, row: d.row || null });
          });
          onDocs(docs, max);
        }, onErr);
      },
      commit: function (uid, docs) {
        var b = F.writeBatch(fb.db);
        docs.forEach(function (d) { b.set(F.doc(fb.db, 'users', uid, 'books', d.docId), { kind: d.kind, row: d.row, updatedAt: d.updatedAt, deleted: d.deleted, serverAt: F.serverTimestamp() }); });
        return b.commit();
      }
    };
  }
  function startBooks(uid) {
    if (!books || !fb) return;
    var tier = st.plan.tier || 'free';
    if (books.state().running && books.state().uid === uid) books.setTier(tier); else books.start(uid, tier, booksFs());
  }

  function emit() { U.emit('sedori:acct', state()); paintHeader(); }
  function state() { return Object.assign({}, st, { ready: ready, billingReady: billingReady }); }
  function pendingMap() { return store.get('sync-pending', {}); }

  /* ---------- 準備中/受付中で表示を切り替える(data-acct="prep|ready"、data-bill="prep|ready") ---------- */
  function paintFlags() {
    $$('[data-acct]').forEach(function (el) { el.hidden = (el.getAttribute('data-acct') === 'ready') !== ready; });
    $$('[data-bill]').forEach(function (el) { el.hidden = (el.getAttribute('data-bill') === 'ready') !== billingReady; });
  }

  /* ---------- 上の帯: ログイン / マイページ ---------- */
  function paintHeader() {
    var a = $('#hd-acct'); if (!a) return;
    var dot = st.user ? (st.sync === 'synced' ? 'ok' : (st.sync === 'pending' || st.sync === 'syncing' ? 'wait' : (st.sync === 'error' ? 'err' : 'off'))) : '';
    var tip = { ok: 'クラウドと同期済み', wait: '同期待ち ' + st.pending + '件', err: '同期できていません', off: 'この端末だけに保存' }[dot] || '';
    a.innerHTML = (st.user ? 'マイページ' : 'ログイン') + (dot ? '<i class="sy ' + dot + '" aria-hidden="true"></i>' : '');
    a.title = st.user ? (st.user.email || '') + (tip ? '(' + tip + ')' : '') : 'ログイン';
  }
  function wireHeader() {
    var a = $('#hd-acct'); if (!a) return;
    a.addEventListener('click', function (e) { if (!st.user) { e.preventDefault(); openLogin(); } });
  }

  /* ---------- ログインの窓 ---------- */
  function dlg() {
    var d = $('#acct-dlg');
    if (d) return d;
    d = document.createElement('dialog'); d.id = 'acct-dlg'; d.className = 'dlg'; d.setAttribute('aria-labelledby', 'acct-dlg-h');
    document.body.appendChild(d);
    d.addEventListener('click', function (e) { if (e.target === d) d.close(); });
    return d;
  }
  function openLogin(next) {
    var d = dlg(), b = U.base();
    if (!ready) {
      d.innerHTML = '<div class="dlg-in"><div class="dlg-h"><h2 id="acct-dlg-h">ログイン</h2><button type="button" class="dlg-x" data-x aria-label="閉じる">×</button></div>' +
        '<p class="dlg-st">準備中</p><p>ログインと台帳のクラウド保存は準備中です。計算と台帳は、このままログインなしで使えます(この端末に保存)。</p>' +
        '<p class="hint">始まったら事前登録の方へメールでお知らせします。</p>' +
        '<div class="row-btns"><a class="btn" href="' + esc(U.PREREG) + '">事前登録(メール1通・無料)</a><button type="button" class="btn ghost" data-x>閉じる</button></div></div>';
    } else {
      d.innerHTML = '<div class="dlg-in"><div class="dlg-h"><h2 id="acct-dlg-h">ログイン</h2><button type="button" class="dlg-x" data-x aria-label="閉じる">×</button></div>' +
        '<p class="dlg-lead">ログインすると、台帳をクラウドに保存して、パソコンとスマホで同じ台帳を使えます(ライト・総合)。</p>' +
        '<button type="button" class="btn wide" id="dl-google">Googleでログイン</button>' +
        '<div class="dlg-or"><span>またはメールで</span></div>' +
        '<form id="dl-mail" class="dlg-mail"><label class="sr" for="dl-email">メールアドレス</label><input id="dl-email" type="email" autocomplete="email" inputmode="email" required placeholder="メールアドレス">' +
        '<button type="submit" class="btn ghost">ログイン用のリンクを送る</button></form>' +
        '<p class="dlg-msg" id="dl-msg" role="status"></p>' +
        '<p class="hint">パスワードは使いません。ログインすると<a href="' + b + 'terms/" target="_blank">利用規約</a>と<a href="' + b + 'privacy/" target="_blank">プライバシーポリシー</a>に同意したことになります。計算とこの端末の台帳は、ログインなしで使えます。</p></div>';
      $('#dl-google', d).addEventListener('click', function () { googleLogin(next); });
      $('#dl-mail', d).addEventListener('submit', function (e) { e.preventDefault(); mailLogin($('#dl-email', d).value.trim()); });
      if (next) store.set('login-next', next);
    }
    $$('[data-x]', d).forEach(function (x) { x.addEventListener('click', function () { d.close(); }); });
    if (d.showModal) d.showModal(); else d.setAttribute('open', '');
    var f = $('#dl-google', d) || $('[data-x]', d); if (f) f.focus();
    if (ready) loadFB();
  }
  function msg(t, err) { var m = $('#dl-msg'); if (m) { m.textContent = t; m.classList.toggle('err', !!err); } }

  /* ---------- Firebase の読み込み(必要な時だけ) ---------- */
  function loadFB() {
    if (!ready) return Promise.reject(new Error('not-ready'));
    if (fbPromise) return fbPromise;
    var base = 'https://www.gstatic.com/firebasejs/' + FB_VER + '/';
    st.phase = 'loading';
    fbPromise = Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js')]).then(function (m) {
      var app = m[0].initializeApp(cfg.FIREBASE_CONFIG);
      fb = { A: m[1], F: m[2], app: app, auth: m[1].getAuth(app), db: m[2].getFirestore(app) };
      fb.auth.languageCode = 'ja';
      fb.A.onAuthStateChanged(fb.auth, onUser);
      finishMailLink();
      return fb;
    }).catch(function (e) { st.phase = 'error'; st.error = '読み込めませんでした。通信を確かめてください'; emit(); fbPromise = null; throw e; });
    return fbPromise;
  }

  function googleLogin(next) {
    loadFB().then(function () {
      var p = new fb.A.GoogleAuthProvider();
      return fb.A.signInWithPopup(fb.auth, p).catch(function (e) {
        if (e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment')) return fb.A.signInWithRedirect(fb.auth, p);
        throw e;
      });
    }).then(function () { var d = $('#acct-dlg'); if (d && d.open) d.close(); afterLogin(next); })
      .catch(function (e) { if (e && e.code === 'auth/popup-closed-by-user') return; msg('ログインできませんでした(' + ((e && e.code) || '通信') + ')', true); });
  }
  function mailLogin(email) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg('メールアドレスを確かめてください', true); return; }
    msg('送っています…');
    loadFB().then(function () {
      var url = new URL(U.base() + 'mypage/?signin=1', location.href).href;
      return fb.A.sendSignInLinkToEmail(fb.auth, email, { url: url, handleCodeInApp: true });
    }).then(function () {
      store.set('signin-email', email);
      msg(email + ' にログイン用のリンクを送りました。この端末でメールを開き、リンクを押してください(届かない時は迷惑メールも確かめてください)。');
    }).catch(function (e) { msg('送れませんでした(' + ((e && e.code) || '通信') + ')', true); });
  }
  function finishMailLink() {
    if (!fb.A.isSignInWithEmailLink(fb.auth, location.href)) return;
    var email = store.get('signin-email', '') || window.prompt('確認のため、ログインに使ったメールアドレスを入れてください') || '';
    if (!email) return;
    fb.A.signInWithEmailLink(fb.auth, email, location.href).then(function () {
      store.del('signin-email');
      history.replaceState(null, '', location.pathname);
      afterLogin();
    }).catch(function () { U.toast('リンクの期限が切れたか、使用済みです。もう一度ログインしてください'); });
  }
  function afterLogin(next) {
    next = next || store.get('login-next', null); store.del('login-next');
    if (next && typeof next === 'string') location.href = next;
  }

  /* ---------- ログインの状態 ---------- */
  function onUser(user) {
    if (unsubUser) { unsubUser(); unsubUser = null; }
    stopSync();
    st.user = user ? { uid: user.uid, email: user.email || '' } : null;
    st.phase = 'ready';
    if (!user) { store.del('acct-hint'); st.sub = null; st.plan = S.planState(null); st.sync = 'local'; emit(); return; }
    store.set('acct-hint', 1);
    var F = fb.F, ref = F.doc(fb.db, 'users', user.uid);
    F.setDoc(ref, { email: user.email || '', lastLoginAt: F.serverTimestamp() }, { merge: true }).catch(function () { /* オフライン等 */ });
    unsubUser = F.onSnapshot(ref, function (snap) {
      var d = snap.exists() ? snap.data() : {};
      // 最初に来た経路(紹介ページ等が保存した zw-sedori:utm-first)を、まだ無ければプロフィールに残す
      if (!d.utmFirst) { var utm = null; try { utm = JSON.parse(localStorage.getItem('zw-sedori:utm-first') || 'null'); } catch (e) { utm = null; } if (utm && typeof utm === 'object') F.setDoc(ref, { utmFirst: JSON.parse(JSON.stringify(utm)) }, { merge: true }).catch(function () {}); }
      st.sub = d.subscription || null;
      st.plan = S.planState(st.sub);
      if (d.settings && Number(d.settingsAt) > Number(store.get('settings-at', 0))) applySettings(d.settings, d.settingsAt);
      if (st.plan.paid) { startSync(user.uid); if (!pausedFor) startBooks(user.uid); } else { stopSync(); st.sync = 'local'; }
      emit();
    }, function () { st.error = '契約の状態を読めませんでした'; emit(); });
    emit();
  }

  /* ---------- 台帳の同期 ---------- */
  function stopSync() { if (unsubLedger) { unsubLedger(); unsubLedger = null; } if (books) books.stop(); }
  function startSync(uid) {
    if (unsubLedger || pausedFor === uid) return;
    var L = U.ledger, owner = store.get('sync-owner', null), local = L.all();
    var plan = S.firstSync(owner, uid, local.length);
    if (plan === 'switch') {
      var ok = window.confirm('この端末の台帳(' + local.length + '件)は、別のアカウントで同期していたものです。\n\nOK: この端末の分を消して、ログインしたアカウントの台帳に切り替えます\nキャンセル: 同期しません(先に台帳ページでCSV・Excelに書き出してください)');
      if (!ok) { pausedFor = uid; st.sync = 'paused'; emit(); return; }
      L.replace([], {}); store.set('sync-pending', {});
      store.del('sync-since:' + owner);
      switchedFor = uid; // 帳簿も同じアカウントに切り替える(もう一度は聞かない)
    }
    if (owner !== uid) {
      store.set('sync-owner', uid);
      // この端末の行をすべて送る(初回)
      var pm = {}; L.all().forEach(function (r) { pm[r.id] = 1; }); Object.keys(store.get('ledger-del', {})).forEach(function (id) { pm[id] = 1; });
      store.set('sync-pending', pm);
    }
    var F = fb.F, col = F.collection(fb.db, 'users', uid, 'ledger');
    var since = Number(store.get('sync-since:' + uid, 0)) || 0, first = !since;
    var q = since ? F.query(col, F.where('serverAt', '>', F.Timestamp.fromMillis(since))) : col;
    st.sync = 'syncing'; emit();
    unsubLedger = F.onSnapshot(q, function (snap) {
      var docs = [], max = since;
      snap.docChanges().forEach(function (c) {
        if (c.type === 'removed' || c.doc.metadata.hasPendingWrites) return;
        var d = c.doc.data(), at = d.serverAt && d.serverAt.toMillis ? d.serverAt.toMillis() : 0;
        if (at > max) max = at;
        docs.push({ id: c.doc.id, updatedAt: d.updatedAt, deleted: !!d.deleted, row: d.row || null });
      });
      if (docs.length || first) {
        var res = S.merge(L.all(), store.get('ledger-del', {}), docs, first);
        if (res.changed) L.replace(res.rows, res.del); else store.set('ledger-del', res.del);
        if (res.push.length) queue(res.push);
        if (first && L.all().length) U.toast('台帳をクラウドと同期しました(' + L.all().length + '件)');
      }
      first = false;
      if (max > since) { since = max; store.set('sync-since:' + uid, max); }
      st.lastSync = Date.now(); store.set('sync-last', st.lastSync);
      flush();
    }, function (e) { st.sync = 'error'; st.error = (e && e.code) || ''; emit(); });
  }
  /** ライトの今月の件数(ライト以外は null) */
  function capNow() {
    if (!st.plan || st.plan.tier !== 'light') return null;
    var d = new Date(), ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    return S.lightCap(U.ledger.all(), ym, Number(cfg.LIGHT_MONTHLY_LIMIT) || 100);
  }
  function queue(ids) {
    var pm = pendingMap(), n = Number(store.get('sync-seq', 0));
    ids.forEach(function (id) { pm[id] = ++n; });
    store.set('sync-seq', n); store.set('sync-pending', pm);
    st.pending = Object.keys(pm).length;
    if (st.sync !== 'local' && st.sync !== 'paused') st.sync = 'pending';
    clearTimeout(flushTimer); flushTimer = setTimeout(flush, 800);
    emit();
  }
  function flush() {
    if (!fb || !st.user || !st.plan.paid || !unsubLedger) return;
    var pm = pendingMap(), ids = Object.keys(pm);
    // ライトは、1か月にクラウドへ送る行を上限までにする(超えた行はこの端末に残り、総合に変えると送られる)
    var cap = capNow();
    if (cap && cap.blocked.length) { var bl = {}; cap.blocked.forEach(function (id) { bl[id] = 1; }); ids = ids.filter(function (id) { return !bl[id]; }); }
    st.pending = ids.length;
    if (!ids.length) { st.sync = 'synced'; emit(); return; }
    if (navigator.onLine === false) { st.sync = 'pending'; emit(); return; }
    var F = fb.F, rows = U.ledger.all(), del = store.get('ledger-del', {}), uid = st.user.uid;
    var chunk = ids.slice(0, 400), sent = {}, b = F.writeBatch(fb.db);
    chunk.forEach(function (id) {
      sent[id] = pm[id];
      var d = S.toDoc(id, rows, del);
      if (!d) return;
      b.set(F.doc(fb.db, 'users', uid, 'ledger', id), { row: d.row, updatedAt: d.updatedAt, deleted: d.deleted, serverAt: F.serverTimestamp() });
    });
    st.sync = 'syncing'; emit();
    b.commit().then(function () {
      var now = pendingMap();
      Object.keys(sent).forEach(function (id) { if (now[id] === sent[id]) delete now[id]; });
      store.set('sync-pending', now);
      st.pending = Object.keys(now).length; st.lastSync = Date.now(); store.set('sync-last', st.lastSync);
      st.sync = st.pending ? 'pending' : 'synced'; emit();
      if (st.pending) setTimeout(flush, 200);
    }).catch(function (e) { st.sync = 'error'; st.error = (e && e.code) || ''; emit(); setTimeout(flush, 30000); });
  }

  /* ---------- 設定(目標の利益・発送のしかた・発送代行の費用) ---------- */
  function applySettings(s, at) {
    applyingSettings = true;
    U.SYNC_KEYS.forEach(function (k) { if (s[k] != null) store.set(k, s[k]); });
    store.set('settings-at', Number(at));
    applyingSettings = false;
    var t = U.target(), inp = $('#t-val'); if (inp) inp.value = t.value;
    $$('#tgt .seg button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-m') === t.mode)); });
    var m = U.shipMode(); $$('#shipm button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-s') === m)); }); document.body.setAttribute('data-ship', m);
    document.dispatchEvent(new CustomEvent('sedori:target', { detail: t }));
  }
  function pushSettings() {
    if (applyingSettings || !fb || !st.user || !st.plan.paid) return;
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(function () {
      var s = {}, at = Date.now();
      U.SYNC_KEYS.forEach(function (k) { var v = store.get(k, null); if (v != null) s[k] = v; });
      store.set('settings-at', at);
      fb.F.setDoc(fb.F.doc(fb.db, 'users', st.user.uid), { settings: JSON.parse(JSON.stringify(s)), settingsAt: at }, { merge: true }).catch(function () { /* 次の変更で送る */ });
    }, 1000);
  }

  /* ---------- お申し込み(PayPal のサブスクリプション)・契約の変更 ---------- */
  var ppPromise = null;
  function loadPayPal() {
    if (!billingReady) return Promise.reject(new Error('not-ready'));
    if (ppPromise) return ppPromise;
    ppPromise = new Promise(function (ok, ng) {
      var sc = document.createElement('script');
      sc.src = 'https://www.paypal.com/sdk/js?client-id=' + encodeURIComponent(cfg.PAYPAL_CLIENT_ID) + '&vault=true&intent=subscription&currency=JPY&locale=ja_JP&components=buttons';
      sc.setAttribute('data-namespace', 'paypalZW');
      sc.onload = function () { ok(window.paypalZW); }; sc.onerror = function () { ppPromise = null; ng(new Error('paypal')); };
      document.head.appendChild(sc);
    });
    return ppPromise;
  }
  /** Worker を呼ぶ(ログイン中の本人であることを ID トークンで示す) */
  function worker(path, body) {
    if (!cfg.WORKER_URL || !fb || !fb.auth.currentUser) return Promise.reject(new Error('no-worker'));
    return fb.auth.currentUser.getIdToken().then(function (tok) {
      return fetch(cfg.WORKER_URL.replace(/\/$/, '') + path, { method: 'POST', headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j.error || ('worker ' + r.status)); e.status = r.status; throw e; } return j; }); });
  }
  /**
   * PayPal のボタンを box に描く。planKey は config の PAYPAL_PLANS のキー。
   * 本人の uid を custom_id に入れて、どのアカウントの契約かを Worker が分かるようにする。
   */
  function renderPayButton(box, planKey, onDone) {
    var planId = plans[planKey];
    if (!planId || !st.user) return Promise.reject(new Error('no-plan'));
    return loadPayPal().then(function (pp) {
      box.innerHTML = '';
      return pp.Buttons({
        style: { layout: 'vertical', color: 'gold', shape: 'rect', label: 'subscribe', height: 44, tagline: false },
        createSubscription: function (data, actions) {
          return actions.subscription.create({ plan_id: planId, custom_id: st.user.uid, application_context: { brand_name: 'ZEROICHI WORKS', locale: 'ja-JP', shipping_preference: 'NO_SHIPPING', user_action: 'SUBSCRIBE_NOW' } });
        },
        onApprove: function (data) {
          // Webhook でも反映されるが、すぐ使えるように Worker に確かめてもらう
          return worker('/paypal/link', { subscriptionID: data.subscriptionID }).catch(function () { /* Webhook で反映される */ })
            .then(function () { if (onDone) onDone(data.subscriptionID); });
        },
        onError: function () { U.toast('PayPalの画面を開けませんでした。時間をおいて、もう一度お試しください'); }
      }).render(box);
    });
  }
  /** 一時停止(1か月)・再開・プランの変更・解約(どれも Worker から PayPal に頼む) */
  function pause() { return worker('/paypal/pause', { months: 1 }); }
  function resume() { return worker('/paypal/resume', {}); }
  function revise(planKey) { return worker('/paypal/revise', { planKey: planKey, return_url: new URL(U.base() + 'mypage/?revised=1', location.href).href }).then(function (j) { if (j.approve) location.href = j.approve; return j; }); }
  function cancel(reason) { return worker('/paypal/cancel', { reason: reason || '' }); }

  /* ---------- 削除・ログアウト ---------- */
  function deleteCloud(alsoLocal) {
    if (!fb || !st.user) return Promise.reject(new Error('no-user'));
    var F = fb.F, uid = st.user.uid, col = F.collection(fb.db, 'users', uid, 'ledger');
    stopSync();
    // 台帳と帳簿の記録をまとめて消す
    return Promise.all([F.getDocs(col), F.getDocs(F.collection(fb.db, 'users', uid, 'books'))]).then(function (snaps) {
      var refs = snaps[0].docs.concat(snaps[1].docs).map(function (d) { return d.ref; }), jobs = [];
      for (var i = 0; i < refs.length; i += 400) { var b = F.writeBatch(fb.db); refs.slice(i, i + 400).forEach(function (r) { b.delete(r); }); jobs.push(b.commit()); }
      return Promise.all(jobs).then(function () { return refs.length; });
    }).then(function (n) {
      store.set('sync-pending', {}); store.del('sync-since:' + uid); store.del('sync-owner');
      store.del('bk-sync-pending'); store.del('bk-sync-since:' + uid); store.del('bk-sync-owner');
      if (alsoLocal) { U.ledger.replace([], {}); if (books) books.wipe(); }
      st.sync = 'paused'; emit();
      return n;
    });
  }
  function deleteAccount() {
    if (st.plan.paid) return Promise.reject(new Error('active'));
    var uid = st.user.uid;
    return deleteCloud(false).then(function () { return fb.F.deleteDoc(fb.F.doc(fb.db, 'users', uid)); })
      .then(function () { return fb.A.deleteUser(fb.auth.currentUser); })
      .then(function () { store.del('acct-hint'); });
  }
  /** クラウドの台帳を読む(解約後の書き出し・別の端末の分の確認用) */
  function cloudRows() {
    if (!fb || !st.user) return Promise.reject(new Error('no-user'));
    return fb.F.getDocs(fb.F.collection(fb.db, 'users', st.user.uid, 'ledger')).then(function (snap) {
      var rows = [];
      snap.forEach(function (d) { var x = d.data(); if (!x.deleted && x.row) rows.push(Object.assign({}, x.row, { id: d.id, updatedAt: x.updatedAt })); });
      return S.merge([], {}, [], false).rows.concat(rows).sort(function (a, b) { return String(a.id) < String(b.id) ? 1 : -1; });
    });
  }
  function signOut() { if (!fb) return Promise.resolve(); stopSync(); return fb.A.signOut(fb.auth); }

  /* ---------- 起動 ---------- */
  // 一度でも同期した端末では、オフライン中・読み込み前の変更も送る順番待ちに入れる
  document.addEventListener('sedori:ledger', function (e) { if (ready && (store.get('sync-owner', null) || unsubLedger)) queue(e.detail.ids || []); });
  document.addEventListener('sedori:settings', pushSettings);
  window.addEventListener('online', flush);
  window.addEventListener('online', function () { if (books) books.flush(); });
  function init() {
    paintFlags(); wireHeader(); paintHeader();
    var page = document.body.getAttribute('data-page');
    var need = /[?&](signin|apiKey|oobCode)=/.test(location.search) || store.get('acct-hint', 0) || page === 'mypage' || page === 'plans';
    if (ready && need) loadFB().catch(function () { /* 表示は emit 済み */ });
    if (!ready || !need) { st.phase = ready ? 'ready' : 'off'; emit(); }
  }
  /* 発送代行に切り替えた時、ライト・総合の方へ1回だけ(この画面を開いている間)ご案内 */
  var told3pl = false;
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('#shipm [data-s="3pl"]') : null;
    if (!t || told3pl) return;
    var tier = st.plan.tier;
    if (tier !== 'light' && tier !== 'total') return;
    told3pl = true;
    setTimeout(function () { U.toast('発送代行への入庫・出荷の指示ファイルは業務で使えます' + ((cfg.FEATURES_READY || {}).threepl ? '' : '(11月中に追加)'), '業務を見る', function () { location.href = U.base() + 'plans/?plan=business_month&from=3pl'; }); }, 2600);
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.SedoriAccount = {
    state: state, open: openLogin, signOut: signOut, paid: function () { return !!st.plan.paid; }, renderPayButton: renderPayButton, pause: pause, resume: resume, revise: revise, cancel: cancel, worker: worker,
    tier: function () { return st.plan.tier || "free"; }, lightCap: capNow,
    deleteCloud: deleteCloud, cloudRows: cloudRows, deleteAccount: deleteAccount, syncNow: flush, cfg: cfg, ready: ready, billingReady: billingReady
  };
})();
