/* せどり 利益チェック — クラウド同期の計算だけの部品(画面・通信に依存しない)。
   ブラウザでは window.SedoriSync、Node では require('./sync.js') で検算する。
   台帳の行は「最後に書いた方が勝つ」(行ごとの updatedAt)。消した行は墓標(del: {id: 消した時刻})で他の端末へ伝える。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SedoriSync = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** 有料の機能(クラウド保存)を使える契約の状態 */
  var PAID = ['trialing', 'active', 'past_due'];
  /** 解約後にクラウドの台帳を残す期間(古物台帳の保存義務に合わせて3年) */
  var RETAIN_YEARS = 3;

  function body(r) {
    var o = {};
    Object.keys(r).sort().forEach(function (k) { if (k !== 'updatedAt') o[k] = r[k]; });
    return JSON.stringify(o);
  }
  function ts(v) { var n = Number(v); return isFinite(n) ? n : 0; }

  /**
   * 保存の前に、変わった行に時刻を付け、消えた行の墓標を作る。
   * prev: 保存前の行、next: 保存する行、del: 墓標 {id: 時刻}、now: 時刻(ミリ秒)
   * 返り値 { rows, del, changed: [変わった行のid] }
   */
  function stamp(prev, next, del, now) {
    var before = {}, seen = {}, changed = [];
    del = Object.assign({}, del || {});
    (prev || []).forEach(function (r) { if (r && r.id) before[r.id] = body(r); });
    var rows = (next || []).map(function (r) {
      if (!r || !r.id) return r;
      seen[r.id] = 1;
      if (before[r.id] === undefined || before[r.id] !== body(r)) {
        r = Object.assign({}, r, { updatedAt: now });
        changed.push(r.id);
        delete del[r.id];
      }
      return r;
    });
    Object.keys(before).forEach(function (id) { if (!seen[id]) { del[id] = now; changed.push(id); } });
    return { rows: rows, del: del, changed: changed };
  }

  /** 行の並び(新しく作った順)。id の先頭は作った時刻(36進) */
  function byCreated(a, b) {
    var x = String(a.id), y = String(b.id);
    if (x.length !== y.length) return y.length - x.length;
    return x < y ? 1 : (x > y ? -1 : 0);
  }

  /**
   * この端末の台帳とクラウドの文書をまとめる。
   * remote: [{ id, updatedAt, deleted, row }](クラウドの文書。差分だけでもよい)
   * 返り値 { rows, del, push: [クラウドへ送るid], changed: この端末の台帳が変わったか }
   * remoteAll=true の時は remote がクラウドの全部(初回)なので、クラウドに無い行もすべて送る。
   */
  function merge(localRows, localDel, remote, remoteAll) {
    var L = {}, R = {}, del = Object.assign({}, localDel || {}), push = [], changed = false;
    (localRows || []).forEach(function (r) { if (r && r.id) L[r.id] = r; });
    (remote || []).forEach(function (d) { if (d && d.id) R[d.id] = d; });
    var ids = {};
    Object.keys(L).concat(Object.keys(del), Object.keys(R)).forEach(function (id) { ids[id] = 1; });
    Object.keys(ids).forEach(function (id) {
      var l = L[id], ld = del[id], r = R[id];
      if (!r) { if (remoteAll) push.push(id); return; } // クラウドに無い: 初回だけ送る(以後は保存のたびに送る)
      var rt = ts(r.updatedAt), lt = l ? ts(l.updatedAt) : ts(ld), has = !!l || ld != null;
      if (has && lt > rt) { push.push(id); return; } // この端末の方が新しい
      if (has && lt === rt) return; // 同じ
      if (r.deleted) { // クラウドで消された
        if (l) { delete L[id]; changed = true; }
        del[id] = rt;
      } else {
        L[id] = Object.assign({}, r.row || {}, { id: id, updatedAt: rt });
        delete del[id];
        changed = true;
      }
    });
    var rows = Object.keys(L).map(function (id) { return L[id]; }).sort(byCreated);
    return { rows: rows, del: del, push: push, changed: changed };
  }

  /** クラウドへ送る文書(Firestore に undefined は入らないので JSON で整える) */
  function toDoc(id, rows, del) {
    var r = null;
    for (var i = 0; i < rows.length; i++) if (rows[i].id === id) { r = rows[i]; break; }
    if (r) {
      var row = JSON.parse(JSON.stringify(r)); delete row.updatedAt; delete row.id;
      return { id: id, updatedAt: ts(r.updatedAt), deleted: false, row: row };
    }
    if (del && del[id] != null) return { id: id, updatedAt: ts(del[id]), deleted: true, row: null };
    return null;
  }

  /**
   * ログインした時の台帳の扱い。
   * owner: この端末の台帳を前に同期したアカウント(無ければ null)、uid: いまログインしたアカウント
   * 'merge'(この端末の分をクラウドへまとめる)/ 'switch'(別のアカウントの台帳。まとめずに入れ替える前に確認)
   */
  function firstSync(owner, uid, localCount) {
    if (!owner || owner === uid) return 'merge';
    return localCount > 0 ? 'switch' : 'merge';
  }

  function addYears(ms, y) { var d = new Date(ms); d.setFullYear(d.getFullYear() + y); return d.getTime(); }
  function toMs(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return v < 1e12 ? v * 1000 : v; // Stripe は秒
    if (v && typeof v.toMillis === 'function') return v.toMillis();
    var n = Date.parse(v); return isNaN(n) ? null : n;
  }

  /**
   * 契約の状態を画面向けにまとめる。sub は users/{uid}.subscription(Worker が PayPal の状態から書く)。
   * status: trialing(無料期間)/ active / past_due(支払いの失敗)/ paused(一時停止)/ suspended(PayPalが止めた)/ incomplete / canceled(解約。paidThrough まで使える)/ expired
   * 返り値 { key, paid, label, until, retainUntil, canCancel }
   */
  function planState(sub, now) {
    now = now == null ? Date.now() : now;
    if (!sub || !sub.status) return { key: 'free', paid: false, label: '無料プラン', until: null, retainUntil: null, canCancel: false };
    var stt = sub.status, name = sub.planName || 'スタンダード';
    var trialEnd = toMs(sub.trialEnd), next = toMs(sub.nextBillingAt), paidThrough = toMs(sub.paidThrough), canceledAt = toMs(sub.canceledAt);
    if (stt === 'trialing') return { key: 'trial', paid: true, label: name + '(無料期間中)', until: trialEnd, next: trialEnd, retainUntil: null, canCancel: true };
    if (stt === 'active') return { key: 'active', paid: true, label: name, until: next, next: next, retainUntil: null, canCancel: true };
    if (stt === 'past_due') return { key: 'past_due', paid: true, label: name + '(お支払いの確認待ち)', until: next, next: next, retainUntil: null, canCancel: true };
    if (stt === 'paused') return { key: 'paused', paid: false, label: name + '(一時停止中)', until: toMs(sub.resumeAt), next: toMs(sub.resumeAt), retainUntil: null, canCancel: true };
    if (stt === 'suspended') return { key: 'suspended', paid: false, label: name + '(お支払いが止まっています)', until: null, next: null, retainUntil: null, canCancel: true };
    if (stt === 'incomplete') return { key: 'incomplete', paid: false, label: 'お申し込みの手続き中', until: null, next: null, retainUntil: null, canCancel: false };
    if (stt === 'canceled' && paidThrough && paidThrough > now) return { key: 'ending', paid: true, label: name + '(解約済み・期間の終わりまで使えます)', until: paidThrough, next: null, retainUntil: addYears(paidThrough, RETAIN_YEARS), canCancel: false };
    var ended = paidThrough || canceledAt || now;
    var keep = toMs(sub.retainUntil) || addYears(ended, RETAIN_YEARS);
    return { key: 'ended', paid: false, label: '解約済み', until: ended, next: null, retainUntil: keep, canCancel: false };
  }

  return { PAID: PAID, RETAIN_YEARS: RETAIN_YEARS, stamp: stamp, merge: merge, toDoc: toDoc, firstSync: firstSync, planState: planState, addYears: addYears, toMs: toMs };
});
