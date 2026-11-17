/* せどり 利益チェック — 利用の鍵(ログインなし・こちらの名簿なし。2026-11-17)。window.SedoriLicense
   - config.js の KEY_MODE が true の時だけ働く(false の間は今までのログイン=account.js のまま)。
   - お客が持つのは「利用の鍵」(16文字)。申し込み直後に自動でこの端末に入り、Stripe の請求書・領収書にも載る。
   - この端末が持つのは「利用の証明」(Worker の署名つき。段・期限・契約番号・端末番号)。署名をここで確かめ、期限までは通信なしで有料の機能を開く。
     1日1回 Worker に出して、契約が生きていれば期限の延びた証明に替える。証明は長くても7日。解約・未払いなら延びず、期限で無料の範囲に戻る。
   - データ(台帳・在庫番・ウォッチ・帳簿・設定・Keepaのキー)は、この端末のブラウザの中だけ。機種変更は「書き出す/取り込む」(ファイル)。
   - 署名を確かめられない証明・期限切れの証明・端末の時計を戻した時は、有料の機能を開かない。
   計算だけの部分(decode・verify・stateOf・exportData・importData・deviceLabel)は Node でも読める(tests/sedori/test_license.js)。 */
(function (root, factory) {
  var L = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = L; else root.SedoriLicense = L;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  var DAY = 864e5;
  var PREFIX = 'zw-sedori:';
  var RENEW_AFTER = 20 * 36e5;   // 証明を受け取ってから20時間たったら、次に開いた時に替える(1日1回)
  var RETRY_AFTER = 36e5;        // 通信に失敗したら、1時間は試さない
  var LIC_KEYS = ['lic-code', 'lic-pass', 'lic-sid', 'lic-dev', 'lic-seen', 'lic-info', 'lic-try'];
  var TIER_NAME = { free: '無料', light: 'ライト', total: '総合', business: '業務' };

  /* ---------- 計算だけ ---------- */
  function b64d(s) {
    s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
    var bin = (typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('binary')), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function utf8(bytes) { return typeof TextDecoder !== 'undefined' ? new TextDecoder().decode(bytes) : Buffer.from(bytes).toString('utf8'); }
  /** 証明の中身(署名は見ない)。形が違えば null */
  function decode(pass) {
    var parts = String(pass || '').split('.');
    if (parts.length !== 2) return null;
    try { var p = JSON.parse(utf8(b64d(parts[0]))); return p && p.v === 1 ? p : null; } catch (e) { return null; }
  }
  /**
   * 署名を確かめて中身を返す(だめなら null)。
   * 試験用(署名なし .test)は cfg.KEY_ALLOW_TEST === true の時だけ(試験版の写しだけ。公開の設定では必ず false)。
   */
  function verify(pass, cfg, subtle) {
    var p = decode(pass); if (!p) return Promise.resolve(null);
    var parts = String(pass).split('.');
    if (parts[1] === 'test') return Promise.resolve(cfg && cfg.KEY_ALLOW_TEST === true && p.m === 'test' ? p : null);
    var jwk = cfg && cfg.KEY_PUBLIC_JWK;
    subtle = subtle || (root.crypto && root.crypto.subtle);
    if (!jwk || !subtle) return Promise.resolve(null);
    var enc = new TextEncoder();
    return subtle.importKey('jwk', { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
      .then(function (key) { return subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64d(parts[1]), enc.encode(parts[0])); })
      .then(function (ok) { return ok ? p : null; }, function () { return null; });
  }
  /**
   * 証明(確かめ済みの中身)と最後に聞いた契約の様子から、画面に出す状態を決める。
   * now は「端末の時計」と「今までに見た一番新しい時刻」の大きい方(時計を戻しても期限は延びない)。
   * 返り値 { key, paid, tier, label, until, end, next }
   *   key: none(鍵なし)/ active / trial / past_due / ending(解約済み・期限まで使える)/ ended(期限が過ぎた)/ removed(この端末は外された)
   */
  function stateOf(p, info, now) {
    info = info || {};
    if (info.removed) return { key: 'removed', paid: false, tier: 'free', label: 'この端末は外されました', until: null, end: null, next: null };
    var name = info.planName || (p ? TIER_NAME[p.t] || '' : '');
    if (p && Number(p.exp) > now && Number(p.iat || 0) <= now + DAY) {
      var st = p.st === 'trialing' ? 'trial' : (p.st === 'past_due' ? 'past_due' : (p.st === 'ending' ? 'ending' : 'active'));
      var end = p.end || info.end || null;
      var label = name + (st === 'trial' ? '(無料期間中)' : st === 'past_due' ? '(お支払いの確認待ち)' : st === 'ending' ? '(解約済み・期限まで使えます)' : '');
      return { key: st, paid: true, tier: p.t || 'total', label: label, until: st === 'ending' ? end : null, end: end, next: info.next || null };
    }
    if (p || info.status) return { key: 'ended', paid: false, tier: 'free', label: '有料の機能は止まっています', until: null, end: info.end || (p ? p.end || p.exp : null), next: null };
    return { key: 'none', paid: false, tier: 'free', label: '無料の範囲', until: null, end: null, next: null };
  }
  function deviceLabel(ua) {
    ua = String(ua || '');
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua)) return 'iPad';
    if (/Android/.test(ua)) return 'Android';
    if (/Macintosh|Mac OS X/.test(ua)) return 'Mac';
    if (/Windows/.test(ua)) return 'Windows';
    return 'パソコン';
  }
  /**
   * この端末のデータを1つのファイルにまとめる。kv は { 名前(PREFIX なし): 保存された文字 }。
   * 利用の鍵と証明は入れない(鍵は請求書・領収書にある)。Keepa・楽天のキー(keys)は withKeys の時だけ。
   */
  function exportData(kv, withKeys, now) {
    var data = {};
    Object.keys(kv).sort().forEach(function (k) {
      if (LIC_KEYS.indexOf(k) >= 0) return;
      if (k === 'keys' && !withKeys) return;
      data[k] = kv[k];
    });
    return { app: 'zw-sedori', v: 1, at: now || Date.now(), n: Object.keys(data).length, data: data };
  }
  /** 取り込む前の確かめ。だめなら理由の文を throw。戻り値は書き込む { 名前: 文字 } */
  function importData(obj) {
    if (!obj || obj.app !== 'zw-sedori' || obj.v !== 1 || !obj.data || typeof obj.data !== 'object') throw new Error('このアプリで書き出したファイルではありません');
    var out = {};
    Object.keys(obj.data).forEach(function (k) {
      if (LIC_KEYS.indexOf(k) >= 0 || !/^[\w:.-]{1,80}$/.test(k)) return;
      var v = obj.data[k];
      if (typeof v !== 'string') v = JSON.stringify(v);
      try { JSON.parse(v); } catch (e) { return; }
      out[k] = v;
    });
    return out;
  }
  var pure = { decode: decode, verify: verify, stateOf: stateOf, deviceLabel: deviceLabel, exportData: exportData, importData: importData, LIC_KEYS: LIC_KEYS, TIER_NAME: TIER_NAME };
  if (typeof document === 'undefined') return pure;

  /* ---------- 画面(ブラウザだけ) ---------- */
  var cfg = root.ZW_CONFIG || {};
  if (!cfg.KEY_MODE) return pure;
  function get(k, d) { try { var v = localStorage.getItem(PREFIX + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function set(k, v) { try { localStorage.setItem(PREFIX + k, JSON.stringify(v)); } catch (e) { /* 何もしない */ } }
  function del(k) { try { localStorage.removeItem(PREFIX + k); } catch (e) { /* 何もしない */ } }
  function now() { var t = Date.now(), seen = Number(get('lic-seen', 0)) || 0; if (t > seen) set('lic-seen', t); return Math.max(t, seen); }
  function device() {
    var d = get('lic-dev', '');
    if (!/^[a-z0-9]{8,24}$/.test(d)) {
      var a = new Uint8Array(10); (root.crypto || {}).getRandomValues ? root.crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.random() * 256; });
      d = Array.prototype.map.call(a, function (x) { return (x % 36).toString(36); }).join('');
      set('lic-dev', d);
    }
    return d;
  }
  var cur = { p: null, checked: false, busy: false, error: '' };
  function info() { return get('lic-info', {}) || {}; }
  function state() { var s = stateOf(cur.p, info(), now()); s.code = get('lic-code', ''); s.checked = cur.checked; s.busy = cur.busy; s.error = cur.error; s.info = info(); s.device = device(); return s; }
  function emit() { var e; try { e = new CustomEvent('sedori:acct', { detail: state() }); } catch (x) { return; } document.dispatchEvent(e); paintHeader(); }
  function appBase() { var seg = location.pathname.split('/').filter(Boolean)[0] || 'sedori'; return location.origin + '/' + seg + '/'; }
  function call(path, body) {
    if (!cfg.WORKER_URL) return Promise.reject(new Error('準備中です'));
    var b = Object.assign({ app: appBase(), device: device(), label: deviceLabel(navigator.userAgent), sid: get('lic-sid', '') }, body || {});
    return fetch(cfg.WORKER_URL.replace(/\/$/, '') + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j.error || ('通信 ' + r.status)); e.status = r.status; e.code = j.code || ''; e.data = j; throw e; } return j; }); });
  }
  /** Worker の答えを受け取る(証明を確かめてから置く) */
  function take(j) {
    var keep = { status: j.status, planKey: j.planKey, planName: j.planName, amount: j.amount, tier: j.tier, next: j.next, end: j.end, devices: j.devices || [], limit: j.limit, at: now() };
    set('lic-info', keep);
    if (j.code) set('lic-code', j.code);
    if (j.sid) set('lic-sid', j.sid);
    set('lic-try', now());
    if (!j.pass) { del('lic-pass'); cur.p = null; cur.checked = true; emit(); return Promise.resolve(state()); }
    return verify(j.pass, cfg).then(function (p) {
      if (p && p.d === device()) { set('lic-pass', j.pass); cur.p = p; cur.error = ''; }
      else { cur.error = '証明を確かめられませんでした'; }
      cur.checked = true; emit(); return state();
    });
  }
  function fail(e) {
    cur.busy = false;
    if (e && e.code === 'device-removed') { set('lic-info', { removed: true }); del('lic-pass'); del('lic-code'); del('lic-sid'); cur.p = null; }
    else if (e && e.code === 'no-key' && get('lic-sid', '')) { set('lic-info', { removed: true }); del('lic-pass'); del('lic-code'); del('lic-sid'); cur.p = null; }
    cur.error = (e && e.message) || '通信できませんでした';
    emit();
    throw e;
  }
  function run(p) { cur.busy = true; emit(); return p.then(function (s) { cur.busy = false; emit(); return s; }, fail); }
  /** 申し込み直後(Stripe の画面から戻った時): この端末に鍵を受け取る */
  function claim(sessionId) { return run(call('/key/claim', { sessionId: sessionId }).then(take)); }
  /** 鍵を入れる(別の端末・機種変更)。known=false(新しい端末として数える) */
  function use(code) { del('lic-sid'); set('lic-info', {}); return run(call('/key/renew', { code: code, known: false }).then(take)); }
  /** 1日1回の更新 */
  function renew(force) {
    var code = get('lic-code', ''); if (!code) return Promise.resolve(state());
    var t = now(), last = Number(get('lic-try', 0)) || 0;
    if (!force && (cur.p && t - Number(cur.p.iat || 0) < RENEW_AFTER || t - last < RETRY_AFTER)) return Promise.resolve(state());
    set('lic-try', t);
    return run(call('/key/renew', { code: code, known: true }).then(take));
  }
  function portal() { return call('/key/portal', { code: get('lic-code', '') }).then(function (j) { if (j.url) location.href = j.url; return j; }, fail); }
  function rotate() { return run(call('/key/rotate', { code: get('lic-code', '') }).then(take)); }
  function removeDevice(target, code) {
    return call('/key/devices/remove', { code: code || get('lic-code', ''), target: target }).then(function (j) {
      var i = info(); if (!i.removed) { i.devices = j.devices; set('lic-info', i); } emit(); return j;
    }, fail);
  }
  /** この端末から鍵を外す(端末の数から外すのは、ほかの端末か Worker 側の35日で) */
  function forget() {
    var code = get('lic-code', ''), d = device();
    var p = code ? call('/key/devices/remove', { code: code, target: d }).catch(function () { /* 外せなくても、この端末の鍵は消す */ }) : Promise.resolve();
    return p.then(function () { LIC_KEYS.forEach(function (k) { if (k !== 'lic-dev' && k !== 'lic-seen') del(k); }); cur.p = null; emit(); });
  }
  function checkout(planKey) { return call('/key/checkout', { planKey: planKey }).then(function (j) { if (j.url) location.href = j.url; return j; }); }
  var spPromise = null;
  function stripePlans() {
    if (!cfg.WORKER_URL) return Promise.resolve([]);
    if (spPromise) return spPromise;
    spPromise = fetch(cfg.WORKER_URL.replace(/\/$/, '') + '/stripe/plans').then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (j) { return Array.isArray(j.ready) ? j.ready : []; }).catch(function () { spPromise = null; return []; });
    return spPromise;
  }
  /** この端末のデータを全部(localStorage の zw-sedori: の分) */
  function allKv() {
    var kv = {};
    try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf(PREFIX) === 0) kv[k.slice(PREFIX.length)] = localStorage.getItem(k); } } catch (e) { /* 何もしない */ }
    return kv;
  }
  function exportFile(withKeys) {
    var obj = exportData(allKv(), !!withKeys, Date.now());
    var d = new Date(), ymd = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    var blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'sedori-data-' + ymd + '.json';
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    return obj.n;
  }
  /** 取り込む: いまのこの端末のデータを、ファイルの中身に置き換える(利用の鍵はそのまま) */
  function importText(text) {
    var obj; try { obj = JSON.parse(text); } catch (e) { throw new Error('ファイルを読めませんでした'); }
    var w = importData(obj), n = 0;
    Object.keys(allKv()).forEach(function (k) { if (LIC_KEYS.indexOf(k) < 0 && (k !== 'keys' || 'keys' in w)) { try { localStorage.removeItem(PREFIX + k); } catch (e) { /* 何もしない */ } } });
    Object.keys(w).forEach(function (k) { try { localStorage.setItem(PREFIX + k, w[k]); n++; } catch (e) { /* 何もしない */ } });
    return n;
  }

  /* ---------- 上の帯・準備中の切り替え ---------- */
  function paintHeader() {
    var a = document.getElementById('hd-acct'); if (!a) return;
    var s = stateOf(cur.p, info(), now());
    a.textContent = 'マイページ';
    a.title = s.paid ? s.label : '利用の鍵・データの書き出し';
  }
  function paintFlags() {
    var bill = !!cfg.WORKER_URL;
    Array.prototype.forEach.call(document.querySelectorAll('[data-bill]'), function (el) { el.hidden = (el.getAttribute('data-bill') === 'ready') !== bill; });
    Array.prototype.forEach.call(document.querySelectorAll('[data-acct]'), function (el) { el.hidden = true; });
  }

  /* ---------- 今までの SedoriAccount と同じ口(ほかの部品はこれを読む) ---------- */
  function acctState() {
    var s = state(), i = s.info || {};
    return { phase: 'ready', ready: false, billingReady: !!cfg.WORKER_URL, keyMode: true, user: null, sync: 'local', pending: 0, lastSync: null, error: s.error,
      sub: s.paid || i.status ? { status: i.status || '', planKey: i.planKey || (cur.p && cur.p.k) || '', planName: i.planName || '', amount: i.amount || '', provider: 'stripe' } : null,
      plan: { key: s.key, paid: s.paid, tier: s.tier, label: s.label, until: s.until, next: s.next, retainUntil: null, canCancel: false }, lic: s };
  }
  var no = function () { return Promise.reject(new Error('利用の鍵の形では使いません')); };
  root.SedoriAccount = {
    keyMode: true, state: acctState, paid: function () { return stateOf(cur.p, info(), now()).paid; }, tier: function () { var s = stateOf(cur.p, info(), now()); return s.paid ? s.tier : 'free'; },
    open: function () { location.href = (document.body.getAttribute('data-base') || './') + 'mypage/#mp-key'; }, signOut: function () { return Promise.resolve(); },
    stripePlans: stripePlans, checkout: checkout, paypalReady: function () { return false; }, provider: function () { return 'stripe'; }, portal: portal,
    renderPayButton: no, pause: no, resume: no, revise: no, cancel: no, linkStripe: no, worker: function (path, body) { return call(path, body); },
    lightCap: function () { return null; }, deleteCloud: no, cloudRows: no, deleteAccount: no, syncNow: function () {}, cfg: cfg, ready: false, billingReady: !!cfg.WORKER_URL
  };

  function init() {
    try { localStorage.removeItem(PREFIX + 'acct-hint'); } catch (e) { /* 何もしない */ }
    paintFlags(); paintHeader();
    var ui = root.SedoriUI; if (ui && ui.settingsSettled) ui.settingsSettled();
    var pass = get('lic-pass', '');
    verify(pass, cfg).then(function (p) {
      cur.p = p && p.d === device() ? p : null; cur.checked = true; emit();
      var q = new URLSearchParams(location.search), sid = q.get('session_id');
      if (sid && /^cs_[\w-]+$/.test(sid)) {
        claim(sid).catch(function () { /* 画面が案内を出す */ }).then(function () { if (history.replaceState) history.replaceState(null, '', location.pathname + (cur.p ? '?subscribed=1' : '') + location.hash); emit(); });
      } else if (navigator.onLine !== false) renew(false).catch(function () { /* 期限までは手元の証明で使える */ });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  return Object.assign({}, pure, { state: state, claim: claim, use: use, renew: renew, portal: portal, rotate: rotate, removeDevice: removeDevice, forget: forget, checkout: checkout, exportFile: exportFile, importText: importText, device: device, now: now });
});
