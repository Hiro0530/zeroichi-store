/* せどり 帳簿 — 帳簿の記録(取り込んだ売上・経費・毎月の経費・取り込みの履歴・覚えた科目・売れ残りの目安・設定・棚卸の数)のクラウド同期。
   台帳の同期(assets/sync.js・account.js)と同じ考え方:
   - いつもこの端末(localStorage)が先。保存のたびに、変わった行に時刻を付け、消えた行は墓標にして、クラウドへ送る順番待ちに入れる
   - 行ごとに「最後に書いた方が勝つ」。初めてログインした時は、この端末の分とクラウドの分をまとめる
   - 送るのは、その行の機能を使えるプランの間だけ(総合: 売上・経費・月ごとの利益・売れ残り/業務: 棚卸・申告用の数字・仕訳・古物商特例)。
     読むのはいつでもできる(プランを下げても、他の端末で入れた分は見える)
   Firestore の形: users/{uid}/books/{種類~行のid} = { kind, row, updatedAt, deleted, serverAt }
   通信の部分(fs)は外から渡す(account.js が Firebase で作る。検算では偽物を渡す)。
   ブラウザでは window.SedoriBooksSync(帳簿のページとマイページで読む)、Node では require('./books-sync.js')。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./sync.js'));
  else root.SedoriBooksSync = factory(root.SedoriSync);
})(typeof self !== 'undefined' ? self : this, function (S) {
  'use strict';

  /** 設定(bk-set)のうち、総合で使う項目(経費の家事按分の初期値)。残りは業務(申告用の数字・棚卸・古物商特例) */
  var PREF_FIELDS = ['bizDef'];
  /**
   * 同期する種類。key: この端末の保存の名前、tier: 送れる最低のプラン、type: 保存の形
   * array: 行の配列(行に id)/ map: {キー: 値}/ single: まとめて1行 / fields: 設定の一部の項目 / nested: {基準日: {台帳id: 数}}
   */
  var KINDS = {
    sale: { key: 'bk-sales', tier: 'total', type: 'array' },
    exp: { key: 'bk-exp', tier: 'total', type: 'array' },
    recur: { key: 'bk-recur', tier: 'total', type: 'array' },
    batch: { key: 'bk-batches', tier: 'total', type: 'array' },
    rule: { key: 'bk-rules', tier: 'total', type: 'map' },
    stale: { key: 'bk-stale', tier: 'total', type: 'single' },
    pref: { key: 'bk-set', tier: 'total', type: 'fields', only: PREF_FIELDS },
    tax: { key: 'bk-set', tier: 'business', type: 'fields', except: PREF_FIELDS },
    count: { key: 'bk-count', tier: 'business', type: 'nested' }
  };
  var KIND_NAMES = Object.keys(KINDS);
  var RANK = { free: 0, light: 1, total: 2, business: 3 };
  var SEP = '~';
  var CHUNK = 400;

  function kindsOfKey(key) { return KIND_NAMES.filter(function (k) { return KINDS[k].key === key; }); }
  function allowed(kind, tier) { return (RANK[tier] || 0) >= RANK[KINDS[kind].tier]; }
  function docId(kind, id) { return kind + SEP + id; }
  function splitDoc(d) { var i = String(d).indexOf(SEP); return i < 0 ? null : { kind: d.slice(0, i), id: d.slice(i + 1) }; }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
  /** id に使えない文字(/ と長すぎる文字列)を避ける */
  function safeId(s) { s = String(s); return s.length <= 120 && s.indexOf('/') < 0 && s !== '.' && s !== '..' ? s : 'h' + hash(s); }
  function hash(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36) + s.length.toString(36); }
  function fieldOK(kind, f) { var K = KINDS[kind]; return K.only ? K.only.indexOf(f) >= 0 : K.except.indexOf(f) < 0; }

  /** この端末の保存の値 → 行の配列 [{id, ...}](時刻は含まない) */
  function toRows(kind, v) {
    var K = KINDS[kind];
    if (K.type === 'array') return (Array.isArray(v) ? v : []).filter(function (r) { return r && r.id; }).map(function (r) { var o = clone(r); delete o.updatedAt; return o; });
    if (K.type === 'map') return isObj(v) ? Object.keys(v).map(function (k) { return { id: safeId(k), k: k, v: clone(v[k]) }; }) : [];
    if (K.type === 'single') return isObj(v) ? [{ id: 'cfg', v: clone(v) }] : [];
    if (K.type === 'fields') return isObj(v) ? Object.keys(v).filter(function (f) { return fieldOK(kind, f) && v[f] !== undefined; }).map(function (f) { return { id: f, v: clone(v[f]) }; }) : [];
    if (K.type === 'nested') {
      var out = [];
      if (isObj(v)) Object.keys(v).forEach(function (cut) { if (isObj(v[cut])) Object.keys(v[cut]).forEach(function (lid) { out.push({ id: safeId(cut + '_' + lid), cut: cut, lid: lid, v: v[cut][lid] }); }); });
      return out;
    }
    return [];
  }
  /** 行の配列 → この端末の保存の値。fields は cur(いまの値)の他の項目を残す */
  function fromRows(kind, rows, cur) {
    var K = KINDS[kind];
    rows = (rows || []).map(function (r) { var o = Object.assign({}, r); delete o.updatedAt; return o; });
    if (K.type === 'array') {
      // 作った順(id の先頭は時刻)に古い方から。取り込みの履歴は取り込んだ時刻の順
      var a = rows.slice().sort(function (x, y) { return kind === 'batch' ? (Number(x.at) || 0) - (Number(y.at) || 0) : cmpId(x.id, y.id); });
      return a;
    }
    if (K.type === 'map') { var m = {}; rows.forEach(function (r) { m[r.k != null ? r.k : r.id] = r.v; }); return m; }
    if (K.type === 'single') return rows.length ? rows[0].v : (isObj(cur) ? {} : cur);
    if (K.type === 'fields') {
      var o = {};
      if (isObj(cur)) Object.keys(cur).forEach(function (f) { if (!fieldOK(kind, f)) o[f] = cur[f]; });
      rows.forEach(function (r) { o[r.id] = r.v; });
      return o;
    }
    if (K.type === 'nested') { var n = {}; rows.forEach(function (r) { (n[r.cut] = n[r.cut] || {})[r.lid] = r.v; }); return n; }
    return cur;
  }
  function cmpId(a, b) { a = String(a); b = String(b); if (a.length !== b.length) return a.length - b.length; return a < b ? -1 : (a > b ? 1 : 0); }

  /**
   * 同期の本体。opts:
   *   store: { get(k, d), set(k, v), del(k) }(この端末の保存)
   *   now(): 時刻(ミリ秒)、online(): 通信できるか、emit(name, detail): 画面へ知らせる、setTimeout/clearTimeout(検算で差し替える)
   *   confirmSwitch(n): 別のアカウントで同期していた帳簿(n件)をこの端末から消して切り替えてよいか
   * fs(start に渡す): { listen(uid, since, onDocs(docs, maxServerAt), onError) → 止める関数, commit(uid, docs) → Promise }
   *   docs: [{ docId, kind, updatedAt, deleted, row }]
   */
  function create(opts) {
    var store = opts.store, now = opts.now || Date.now, online = opts.online || function () { return true; };
    var emit = opts.emit || function () {}, confirmSwitch = opts.confirmSwitch || function () { return true; };
    var later = opts.setTimeout || function (f, ms) { return setTimeout(f, ms); }, cancel = opts.clearTimeout || function (t) { clearTimeout(t); };
    var st = { uid: null, tier: 'free', fs: null, unsub: null, phase: 'local', pending: 0, error: '', first: false, since: 0, busy: false };
    var timer = null;

    function meta(kind) { var m = store.get('bk-meta:' + kind, null); return isObj(m) ? { at: m.at || {}, del: m.del || {} } : { at: {}, del: {} }; }
    function saveMeta(kind, m) { store.set('bk-meta:' + kind, m); }
    function annotate(rows, m) { return rows.map(function (r) { return Object.assign({}, r, { updatedAt: m.at[r.id] || 0 }); }); }
    function localRows(kind) { return toRows(kind, store.get(KINDS[kind].key, null)); }
    function pendingMap() { var p = store.get('bk-sync-pending', {}); return isObj(p) ? p : {}; }
    function queue(ids) {
      if (!ids.length) return;
      var pm = pendingMap(), n = Number(store.get('bk-sync-seq', 0)) || 0;
      ids.forEach(function (d) { pm[d] = ++n; });
      store.set('bk-sync-seq', n); store.set('bk-sync-pending', pm);
      count();
      if (st.unsub) { cancel(timer); timer = later(flush, 800); }
    }
    function sendable(d) { var p = splitDoc(d); return !!(p && KINDS[p.kind] && allowed(p.kind, st.tier)); }
    function count() { var pm = pendingMap(); st.pending = Object.keys(pm).filter(sendable).length; return st.pending; }
    function status(phase) { if (phase) st.phase = phase; emit('sedori:books-sync', state()); }

    /** 帳簿の画面が保存した時に呼ぶ(key: 保存の名前、prev: 保存する前の値、next: 保存した値) */
    function noteLocal(key, prev, next) {
      var ids = [], t = now();
      kindsOfKey(key).forEach(function (kind) {
        var m = meta(kind), a = annotate(toRows(kind, prev), m), b = annotate(toRows(kind, next), m);
        var r = S.stamp(a, b, m.del, t);
        if (!r.changed.length) return;
        r.rows.forEach(function (x) { if (x && x.id) m.at[x.id] = x.updatedAt; });
        Object.keys(r.del).forEach(function (id) { delete m.at[id]; });
        m.del = r.del; saveMeta(kind, m);
        r.changed.forEach(function (id) { ids.push(docId(kind, id)); });
      });
      // 一度でも同期した端末(またはいま同期中)だけ順番待ちに入れる
      if (st.unsub || store.get('bk-sync-owner', null)) queue(ids);
      return ids;
    }

    /** この端末の帳簿の記録の件数(行の数) */
    function localCount() { return ['sale', 'exp', 'recur'].reduce(function (s, k) { return s + localRows(k).length; }, 0); }
    /** この端末の帳簿の記録を消す(別のアカウントに切り替える時) */
    function wipe() {
      var keys = {};
      KIND_NAMES.forEach(function (k) { keys[KINDS[k].key] = 1; store.del('bk-meta:' + k); });
      Object.keys(keys).forEach(function (k) { store.del(k); });
      store.del('bk-sync-pending');
      emit('sedori:books-remote', {});
    }

    /** 同期を始める(有料の間)。tier: 'light'|'total'|'business'。返り値 'started'|'paused'|'running' */
    function start(uid, tier, fs) {
      st.tier = tier || 'free';
      if (st.unsub && st.uid === uid) { count(); status(); flush(); return 'running'; }
      stop();
      var owner = store.get('bk-sync-owner', null);
      if (owner && owner !== uid && localCount() > 0) {
        if (!confirmSwitch(localCount())) { st.uid = uid; status('paused'); return 'paused'; }
        wipe(); store.del('bk-sync-since:' + owner);
      }
      if (owner !== uid) {
        // 初めてこのアカウントで同期する: この端末の行をすべて送る(墓標も)
        store.set('bk-sync-owner', uid);
        store.del('bk-sync-since:' + uid);
        var all = [];
        KIND_NAMES.forEach(function (k) {
          localRows(k).forEach(function (r) { all.push(docId(k, r.id)); });
          Object.keys(meta(k).del).forEach(function (id) { all.push(docId(k, id)); });
        });
        store.set('bk-sync-pending', {}); queue(all);
      }
      st.uid = uid; st.fs = fs; st.error = '';
      st.since = Number(store.get('bk-sync-since:' + uid, 0)) || 0; st.first = !st.since;
      status('syncing');
      st.unsub = fs.listen(uid, st.since, onDocs, function (e) { st.error = (e && e.code) || String(e || ''); status('error'); });
      return 'started';
    }
    function setTier(tier) { st.tier = tier || 'free'; count(); status(); flush(); }
    function stop() { if (st.unsub) { try { st.unsub(); } catch (e) { /* 何もしない */ } } st.unsub = null; st.fs = null; cancel(timer); if (st.phase !== 'paused') st.phase = 'local'; }

    /** クラウドから届いた文書をまとめる(初回は全部、以後は差分) */
    function onDocs(docs, maxAt) {
      var byKind = {}, changed = false, push = [];
      (docs || []).forEach(function (d) {
        var p = splitDoc(d.docId); if (!p || !KINDS[p.kind]) return;
        (byKind[p.kind] = byKind[p.kind] || []).push({ id: p.id, updatedAt: d.updatedAt, deleted: !!d.deleted, row: d.row || null });
      });
      var kinds = st.first ? KIND_NAMES : Object.keys(byKind);
      // 同じ保存の名前(bk-set)を2つの種類で直すので、名前ごとに今の値を持ち回る
      var vals = {};
      kinds.forEach(function (kind) {
        var K = KINDS[kind], m = meta(kind);
        var cur = vals[K.key] !== undefined ? vals[K.key] : store.get(K.key, null);
        var rows = annotate(toRows(kind, cur), m);
        var res = S.merge(rows, m.del, byKind[kind] || [], st.first);
        res.push.forEach(function (id) { push.push(docId(kind, id)); });
        if (res.changed) {
          vals[K.key] = fromRows(kind, res.rows, cur);
          var at = {}; res.rows.forEach(function (r) { at[r.id] = r.updatedAt; });
          saveMeta(kind, { at: at, del: res.del });
          changed = true;
        } else { m.del = res.del; saveMeta(kind, m); }
      });
      Object.keys(vals).forEach(function (k) { store.set(k, vals[k]); });
      st.first = false;
      if (maxAt > st.since) { st.since = maxAt; store.set('bk-sync-since:' + st.uid, maxAt); }
      store.set('bk-sync-last', now());
      if (push.length) queue(push);
      if (changed) emit('sedori:books-remote', {});
      flush();
    }

    /** 順番待ちの行を送る(使えるプランの種類だけ。400件ずつ) */
    function flush() {
      if (!st.unsub || !st.fs || st.busy) return Promise.resolve(false);
      var pm = pendingMap(), ids = Object.keys(pm).filter(sendable);
      st.pending = ids.length;
      if (!ids.length) { status('synced'); return Promise.resolve(true); }
      if (!online()) { status('pending'); return Promise.resolve(false); }
      var chunk = ids.slice(0, CHUNK), sent = {}, docs = [], cache = {};
      chunk.forEach(function (d) {
        sent[d] = pm[d];
        var p = splitDoc(d);
        if (!cache[p.kind]) { var m = meta(p.kind); cache[p.kind] = { rows: annotate(localRows(p.kind), m), del: m.del }; }
        var doc = S.toDoc(p.id, cache[p.kind].rows, cache[p.kind].del);
        if (doc) docs.push({ docId: d, kind: p.kind, updatedAt: doc.updatedAt, deleted: doc.deleted, row: doc.row });
      });
      st.busy = true; status('syncing');
      var uid = st.uid;
      return Promise.resolve(docs.length ? st.fs.commit(uid, docs) : null).then(function () {
        st.busy = false;
        var cur = pendingMap();
        Object.keys(sent).forEach(function (d) { if (cur[d] === sent[d]) delete cur[d]; });
        store.set('bk-sync-pending', cur); store.set('bk-sync-last', now());
        if (count()) { status('pending'); return flush(); }
        status('synced'); return true;
      }, function (e) {
        st.busy = false; st.error = (e && e.code) || String(e || ''); status('error');
        cancel(timer); timer = later(flush, 30000);
        return false;
      });
    }

    function state() { return { phase: st.phase, pending: st.pending, error: st.error, uid: st.uid, tier: st.tier, running: !!st.unsub, last: store.get('bk-sync-last', null) }; }

    return { noteLocal: noteLocal, start: start, stop: stop, setTier: setTier, flush: flush, state: state, localCount: localCount, wipe: wipe, onDocs: onDocs };
  }

  return { KINDS: KINDS, KIND_NAMES: KIND_NAMES, PREF_FIELDS: PREF_FIELDS, SEP: SEP, kindsOfKey: kindsOfKey, allowed: allowed, docId: docId, splitDoc: splitDoc, toRows: toRows, fromRows: fromRows, safeId: safeId, create: create };
});
