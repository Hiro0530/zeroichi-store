/* 読み取った一覧(スキャン一覧)の保存と、パソコンへの受け渡し。
   今はサーバーが無いので「この端末に保存」(LocalAdapter)だけ。
   アカウント(Firebase)ができたら、window.ZW_FIREBASE が { db, uid } を持った時点で FirestoreAdapter に切り替わる。
   画面側(scan.js)は ScanSync.list / upsert / remove / clear / onChange だけを使うので、保存先が変わっても画面は直さない。

   受け渡しの文字列(QR・共有・コピー): "ZWS1|<接続番号>|jan,原価,売値,売り先,カテゴリー,サイズ,読んだ時刻(10進の秒);..."
   受け取り側は、この形式のほか、JANを1行ずつ並べただけの文字や、CSV(1列目がJAN)も受け付ける。 */
(function () {
  'use strict';
  var U = window.SedoriUI;
  var KEY = 'scans', listeners = [];

  function emit() { var l = adapter.list(); listeners.forEach(function (f) { try { f(l); } catch (e) { /* 何もしない */ } }); }

  /* ---------- この端末に保存 ---------- */
  var LocalAdapter = {
    name: 'local',
    list: function () { var a = U.store.get(KEY, []); return Array.isArray(a) ? a : []; },
    save: function (a) { return U.store.set(KEY, a.slice(0, 500)); }
  };

  /* ---------- アカウントに保存(Firestore・準備中) ----------
     users/{uid}/scans/{jan} に1件1文書。onSnapshot でパソコンとスマホの画面が同時に変わる。
     ここは Firebase の設定ができた日に有効になる(window.ZW_FIREBASE = { db, uid, fs:{doc,setDoc,deleteDoc,collection,onSnapshot} })。 */
  function firestoreAdapter(fb) {
    var cache = LocalAdapter.list();
    var col = fb.fs.collection(fb.db, 'users', fb.uid, 'scans');
    fb.fs.onSnapshot(col, function (snap) {
      cache = []; snap.forEach(function (d) { cache.push(d.data()); });
      cache.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
      LocalAdapter.save(cache); emit();
    });
    return {
      name: 'cloud',
      list: function () { return cache; },
      save: function (a) {
        var before = {}; cache.forEach(function (r) { before[r.jan] = r; });
        var now = {}; a.forEach(function (r) { now[r.jan] = r; });
        a.forEach(function (r) { if (JSON.stringify(before[r.jan]) !== JSON.stringify(r)) fb.fs.setDoc(fb.fs.doc(col, r.jan), r); });
        Object.keys(before).forEach(function (k) { if (!now[k]) fb.fs.deleteDoc(fb.fs.doc(col, k)); });
        cache = a.slice(); LocalAdapter.save(cache); return true;
      }
    };
  }

  var adapter = LocalAdapter;
  function useCloudIfReady() {
    var fb = window.ZW_FIREBASE;
    if (fb && fb.db && fb.uid && fb.fs && adapter === LocalAdapter) { adapter = firestoreAdapter(fb); emit(); }
  }
  document.addEventListener('zw:auth', useCloudIfReady);   // ログインの担当がこの合図を出す
  useCloudIfReady();

  function list() { return adapter.list(); }
  function find(jan) { return list().filter(function (r) { return r.jan === jan; })[0] || null; }
  /** 1件を追加・更新。戻り値 { row, isNew } */
  function upsert(jan, patch) {
    var a = list(), hit = null;
    a.forEach(function (r) { if (r.jan === jan) hit = r; });
    var isNew = !hit;
    if (!hit) { hit = { jan: jan, at: Date.now(), cost: '', sell: '', to: 'amazon', cat: '', tier: '', watch: false, ledger: false }; a.unshift(hit); }
    Object.keys(patch || {}).forEach(function (k) { hit[k] = patch[k]; });
    adapter.save(a); emit();
    return { row: hit, isNew: isNew };
  }
  function remove(jan) { adapter.save(list().filter(function (r) { return r.jan !== jan; })); emit(); }
  function clear() { adapter.save([]); emit(); }
  function onChange(f) { listeners.push(f); }

  /* ---------- 受け渡し ---------- */
  function pairId() {
    var p = U.store.get('pair', '');
    var q = new URLSearchParams(location.search).get('pair');
    if (q && /^[A-Z0-9]{6}$/.test(q)) { p = q; U.store.set('pair', p); }
    if (!p) { p = Math.random().toString(36).slice(2, 8).toUpperCase().replace(/[^A-Z0-9]/g, '7').padEnd(6, '7'); U.store.set('pair', p); }
    return p;
  }
  function clean(s) { return String(s == null ? '' : s).replace(/[|;,]/g, ''); }
  function encode(rows) {
    return 'ZWS1|' + pairId() + '|' + rows.map(function (r) {
      return [r.jan, r.cost, r.sell, r.to === 'mercari' ? 'm' : 'a', clean(r.cat), clean(r.tier), Math.round((r.at || 0) / 1000)].map(clean).join(',');
    }).join(';');
  }
  function decode(text) {
    text = String(text || '').trim();
    var out = [];
    if (/^ZWS1\|/.test(text)) {
      var body = text.split('|').slice(2).join('|');
      body.split(';').forEach(function (s) {
        var f = s.split(',');
        if (!/^\d{8}$|^\d{12,14}$/.test(f[0] || '')) return;
        out.push({ jan: f[0], cost: f[1] ? Number(f[1]) : '', sell: f[2] ? Number(f[2]) : '', to: f[3] === 'm' ? 'mercari' : 'amazon', cat: f[4] || '', tier: f[5] || '', at: f[6] ? Number(f[6]) * 1000 : Date.now() });
      });
      return out;
    }
    text.split(/\r?\n/).forEach(function (line) {
      var m = line.replace(/^﻿/, '').match(/(?:^|[^0-9])(\d{13}|\d{8}|\d{12})(?![0-9])/);
      if (m) out.push({ jan: m[1], cost: '', sell: '', to: 'amazon', cat: '', tier: '', at: Date.now() });
    });
    return out;
  }
  /** 受け取った一覧を足す(同じJANは、空でない値だけ上書き)。戻り値 足した件数 */
  function merge(rows) {
    var n = 0;
    rows.slice().reverse().forEach(function (r) {   // 先頭が一番上に来るよう逆から足す
      var cur = find(r.jan), patch = {};
      ['cost', 'sell', 'to', 'cat', 'tier'].forEach(function (k) { if (r[k] !== '' && r[k] != null) patch[k] = r[k]; });
      if (!cur) { patch.at = r.at; n++; }
      upsert(r.jan, patch);
    });
    return n;
  }

  window.ScanSync = { list: list, find: find, upsert: upsert, remove: remove, clear: clear, onChange: onChange,
    encode: encode, decode: decode, merge: merge, pairId: pairId, where: function () { return adapter.name; } };
})();
