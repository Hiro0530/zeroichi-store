/* せどり 利益チェック — ウォッチ品の値上がり・売り切れのお知らせ
   仕入れる前に、値段と在庫が変わっていないかを知るための部品。出品を取り下げる働きは無い。
   - 取り直すのは楽天市場の公式の商品検索APIだけ。利用者自身のアプリIDとアクセスキーで、利用者のブラウザから呼ぶ
   - 動くのは、このアプリのページを開いている間だけ(キーを当方のサーバーに預かって見張ることはしない)
   - 手で確かめる: 全プラン(無料は楽天の検索と同じ1日の枠を使う)。自動(前回から6時間以上・古い順に50件まで)とお知らせ: 有料プラン
   - 呼ぶ間隔は控えめに1件ごとに2秒あける。楽天の回数の決まりは公式の説明で未確認(【要確認】商品コードで1件を取る書き方 itemCode、
     売り切れの品も返す指定 availability=0 も同じ)。返事が403・429・通信の失敗なら、その場で止めて行は変えない
   - 保存: ウォッチの行(端末の 'watch2')に code(楽天の商品コード)・base(保存した時の価格)・chk(確かめた時刻・価格・在庫・ポイント)・
     chg(変化の種類)・lim と limT(計算ページで出した、目標に届く仕入れ値の上限と、その時の目標)。お知らせの入・切は 'notify-watch'。どれもクラウドへは送らない
   - 「変化」に数えるのは、売り切れになった・在庫が戻った・目標に届く/届かないが替わった時だけ(1円の上下では数えない)
   計算だけの部品(Core)は node の試験から読める */
(function (root) {
  'use strict';

  /* ================= 計算だけ ================= */
  var AUTO_GAP = 6 * 60 * 60 * 1000;   // 自動で確かめる間隔
  var AUTO_MAX = 50;                    // 自動で1回に確かめる件数
  var CALL_GAP = 2000;                  // 1件ごとにあける時間(控えめ。楽天の決まりは未確認)
  var LOCK_MS = 3 * 60 * 1000;          // 別のタブが確かめている印の有効時間
  var FREE_PER_DAY = 20;                // 無料の1日の枠(ra.js の楽天の検索と同じ枠・同じ保存先 'quota')

  function num(v) { v = Number(v); return isFinite(v) ? v : 0; }
  /** 目標に届くか。lim(仕入れ値の上限)が分からなければ null */
  function reach(price, lim) { return lim == null || lim === '' ? null : num(price) <= num(lim); }
  function crossing(prev, cur, lim) {
    var a = reach(prev, lim), b = reach(cur, lim);
    if (a === null || b === null || a === b) return null;
    return b ? 'gained' : 'lost';
  }
  /** 前に確かめた価格(最初は保存した時の価格) */
  function prevPrice(row) { return row.chk && row.chk.price != null ? num(row.chk.price) : (row.base != null ? num(row.base) : num(row.price)); }
  function wasOut(row) { return !!(row.chk && row.chk.stock === false); }

  /** 1件を比べる。now = { ok: true, price, stock, pt } か { ok: false }(取れなかった)。lim = 仕入れ値の上限(分からなければ null)
      返す: { kind: soldout/up/down/same/unknown, diff, cross: lost/gained/null, back: 在庫が戻った, changed: 変化に数えるか } */
  function compare(row, now, lim) {
    if (!row || !row.code || !now || !now.ok) return { kind: 'unknown', diff: 0, cross: null, back: false, changed: false };
    if (now.stock === false) return { kind: 'soldout', diff: 0, cross: null, back: false, changed: !wasOut(row), missing: !!now.missing };
    var prev = prevPrice(row), diff = num(now.price) - prev;
    var cross = crossing(prev, now.price, lim), back = wasOut(row);
    return { kind: diff > 0 ? 'up' : (diff < 0 ? 'down' : 'same'), diff: diff, cross: cross, back: back, changed: !!cross || back };
  }
  function yen(n) { n = Math.round(num(n)); return Math.abs(n).toLocaleString('ja-JP'); }
  /** 行に出す文(色だけに頼らない) */
  function label(c) {
    if (!c || c.kind === 'unknown') return '今の価格を取れていません';
    if (c.kind === 'soldout') return c.missing ? '楽天で見つからない(売り切れか、取り扱いの終了)' : '売り切れ';
    var t = c.kind === 'same' ? '変わらず' : (c.kind === 'up' ? '値上がり +' : '値下がり −') + (c.kind === 'same' ? '' : yen(c.diff) + '円');
    if (c.back) t = '在庫が戻った・' + t;
    if (c.cross === 'lost') t += '・目標に届かなくなった';
    if (c.cross === 'gained') t += '・目標に届いた';
    return t;
  }
  /** 確かめた結果を行に入れる(行そのものを書き換える)。t = 時刻(ms) */
  function apply(row, now, lim, t) {
    var c = compare(row, now, lim);
    if (c.kind === 'unknown') return c;
    if (row.base == null) row.base = num(row.price);
    var prev = prevPrice(row), keep = row.chg && row.chg.changed && !c.changed ? row.chg : null;
    if (c.kind === 'soldout') row.chk = { t: t, price: prev, prev: prev, stock: false, pt: row.chk ? row.chk.pt : row.shopPt };
    else {
      row.chk = { t: t, price: num(now.price), prev: prev, stock: true, pt: now.pt };
      row.price = num(now.price);
      if (now.pt != null) row.shopPt = now.pt;
    }
    // 前の変化をまだ見ていないうちに「変わらず」が来ても、前の変化の印は残す(t は変化があった時刻のまま)
    row.chg = keep ? keep : { kind: c.kind, diff: c.diff, cross: c.cross, back: c.back, changed: c.changed, missing: !!c.missing, t: t };
    if (lim != null) row.lim = lim;
    return c;
  }
  /** 目標を変えた時の数え直し。limOf(row) が新しい上限を返す。新しく変化になった行は、時刻を t にして「まだ見ていない」に戻す */
  function recount(list, limOf, t) {
    (list || []).forEach(function (row) {
      if (!row.chk || !row.chg || row.chk.stock === false) return;
      var lim = limOf(row), cross = crossing(row.chk.prev, row.chk.price, lim);
      row.lim = lim == null ? null : lim;
      var was = !!row.chg.changed;
      row.chg.cross = cross; row.chg.changed = !!cross || !!row.chg.back;
      if (!was && row.chg.changed && t) row.chg.t = t;
    });
    return list;
  }
  /** まだ見ていない変化の数。seenAt = ウォッチのタブを最後に見た時刻 */
  function unseen(list, seenAt) {
    return (list || []).filter(function (r) { return r.chg && r.chg.changed && num(r.chg.t) > num(seenAt); }).length;
  }
  /** 自動で確かめる行: 商品コードのある行を、確かめた時刻の古い順に max 件 */
  function pickAuto(list, max) {
    return (list || []).filter(function (r) { return !!r.code; })
      .sort(function (a, b) { return num(a.chk && a.chk.t) - num(b.chk && b.chk.t); }).slice(0, max == null ? AUTO_MAX : max);
  }
  /** 自動で走ってよいか。s = { paid, hasKeys, last(前回の時刻), now, lock({ t, id }), me } */
  function canAuto(s) {
    if (!s.paid || !s.hasKeys) return false;
    if (num(s.now) - num(s.last) < AUTO_GAP) return false;
    return lockFree(s.lock, s.now, s.me);
  }
  /** 別のタブが確かめている最中でないか */
  function lockFree(lock, now, me) { return !lock || lock.id === me || num(now) - num(lock.t) > LOCK_MS; }

  /** 楽天の返事から、商品コードが同じ1件を取り出す。返事が空なら「見つからない」(販売不可と同じ扱い)。
      別の商品だけが返ってきた時は、商品コードの指定が効いていないので「取れていません」にする(売り切れと決めつけない) */
  function parseItem(json, code) {
    var items = (json && json.Items) || [], hit = null;
    items.forEach(function (it) { it = it.Item || it; if (!hit && it.itemCode === code) hit = it; });
    if (!hit) return items.length ? { ok: false } : { ok: true, stock: false, missing: true };
    return { ok: true, stock: Number(hit.availability) !== 0, price: num(hit.itemPrice), pt: num(hit.pointRate) || 1, freeShip: Number(hit.postageFlag) === 0 };
  }
  /** JANで探し直した返事から、在庫のある一番安い1件 */
  function cheapest(json) {
    var best = null;
    ((json && json.Items) || []).forEach(function (it) {
      it = it.Item || it;
      if (Number(it.availability) === 0 || !(num(it.itemPrice) > 0) || !it.itemCode) return;
      if (!best || num(it.itemPrice) < num(best.itemPrice)) best = it;
    });
    return best ? { code: best.itemCode, price: num(best.itemPrice), shop: best.shopName || '', url: best.itemUrl || '', pt: num(best.pointRate) || 1, freeShip: Number(best.postageFlag) === 0, name: best.itemName || '' } : null;
  }
  /** 失敗の文。status: 403・429・それ以外の番号、0 は通信の失敗 */
  function errText(status, origin) {
    if (status === 403) return '楽天が403を返しました。アプリ設定の「許可するWebサイト」に ' + (origin || 'このサイト') + ' が入っているか確認してください。';
    if (status === 429) return '楽天の回数の制限に当たりました。時間をおいてから、もう一度確かめてください。';
    if (!status) return '楽天に接続できませんでした。通信の状態を確認してください。';
    return '楽天から値を取れませんでした(' + status + ')。';
  }
  /** 行を見分ける名前(保存し直す時に、同じ行を探す) */
  function rowKey(r) { return [r.code || '', r.url || '', r.jan || r.asin || '', r.saved || '', r.name || ''].join('|'); }
  /** 確かめた結果(done = 書き換えた行の写し)を、保存されている最新の一覧へ戻す。途中で足された行・消された行はそのまま */
  function mergeBack(fresh, done) {
    var by = {}; (done || []).forEach(function (r) { by[r._k || rowKey(r)] = r; });
    return (fresh || []).map(function (r) {
      var d = by[rowKey(r)]; if (!d) return r;
      var o = {}; Object.keys(r).forEach(function (k) { o[k] = r[k]; });
      ['code', 'base', 'chk', 'chg', 'lim', 'limT', 'name', 'src', 'price', 'shopPt', 'shop', 'url', 'freeShip'].forEach(function (k) { if (d[k] !== undefined) o[k] = d[k]; });
      return o;
    });
  }
  function stamp(t) { var d = new Date(t); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); }

  var Core = { AUTO_GAP: AUTO_GAP, AUTO_MAX: AUTO_MAX, CALL_GAP: CALL_GAP, LOCK_MS: LOCK_MS, FREE_PER_DAY: FREE_PER_DAY,
    reach: reach, compare: compare, label: label, apply: apply, recount: recount, unseen: unseen, pickAuto: pickAuto, canAuto: canAuto, lockFree: lockFree,
    parseItem: parseItem, cheapest: cheapest, errText: errText, rowKey: rowKey, mergeBack: mergeBack, stamp: stamp };

  /* ================= 取り直し(順に1件ずつ) =================
     env = { fetchItem(row) → Promise<now>(失敗は { status } を投げる), useQuota() → 続けてよいか, wait(ms) → Promise, now() → 時刻,
             limOf(row), stopped() → 止めるか, onProgress(済み, 全部) } */
  function runCheck(rows, env) {
    var out = { done: 0, changed: 0, stopped: '', error: '' }, i = 0;
    function step() {
      if (i >= rows.length) return Promise.resolve(out);
      if (env.stopped && env.stopped()) { out.stopped = 'user'; return Promise.resolve(out); }
      if (!env.useQuota()) { out.stopped = 'quota'; return Promise.resolve(out); }
      var row = rows[i];
      return env.fetchItem(row).then(function (now) {
        var c = apply(row, now, env.limOf(row), env.now());
        out.done++; if (c.changed) out.changed++;
        i++; if (env.onProgress) env.onProgress(i, rows.length);
        return i < rows.length ? env.wait(CALL_GAP).then(step) : out;
      }, function (err) {
        out.stopped = 'error'; out.error = errText(err && err.status, env.origin);
        return out;
      });
    }
    return step();
  }
  Core.runCheck = runCheck;

  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  root.SedoriWatchCore = Core;
  if (typeof document === 'undefined' || !root.SedoriUI) return;

  /* ================= 画面 =================
     置き場は制作係Aの build_slots_2026-11-13.md のとおり: #slot-watch-top(ウォッチの上)・#n-w-chg(タブの「変化 3」)・
     #slot-notify-watch(マイページの通知)・SedoriRA.rowBadge(行の印)。楽天・Yahoo!→Amazon 以外のページでは、端末の一覧だけを書き換える */
  var U = root.SedoriUI, $ = U.$, esc = U.esc;
  var RAKUTEN_EP = 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701';  // ra.js と同じ
  var ME = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  var running = false, stopFlag = false, lastMsg = '', prog = null;

  function RA() { var r = root.SedoriRA; return r && r.lists ? r : null; }
  function keys() { return U.store.get('keys', {}) || {}; }
  function hasKeys() { var k = keys(); return !!(k.rkApp && k.rkKey); }
  function paid() { return !!(root.SedoriAccount && root.SedoriAccount.paid()); }
  function list() { var ra = RA(); if (ra && Array.isArray(ra.lists.w)) return ra.lists.w; var w = U.store.get('watch2', []); return Array.isArray(w) ? w : []; }
  function seenAt() { return Number(U.store.get('watch-seen', 0)) || 0; }
  function unseenNow() { return unseen(list(), seenAt()); }
  function tgKey() { try { return JSON.stringify(U.target()); } catch (e) { return ''; } }
  /** 目標に届く仕入れ値の上限。計算ページでは ra.js の計算(画面と同じ値)。ほかのページでは、計算ページで行に残した値を、目標が同じ間だけ使う */
  function lim(row) {
    var ra = RA();
    if (ra && ra.maxCostOf) { try { var m = ra.maxCostOf(row); return m == null ? null : m; } catch (e) { return null; } }
    return row.lim != null && row.limT === tgKey() ? row.lim : null;
  }
  /** 計算ページを開いた時・目標を変えた時: 上限を行に残し、届く・届かないを数え直す */
  function stampLims() {
    var ra = RA(); if (!ra || !ra.maxCostOf) return;
    var w = ra.lists.w, k = tgKey(), dirty = false;
    w.forEach(function (row) {
      var m = lim(row);
      if (row.lim !== m || row.limT !== k) { row.lim = m; row.limT = k; dirty = true; }
    });
    if (w.some(function (r) { return r.chk; })) { recount(w, lim, Date.now()); dirty = true; }
    if (dirty) ra.persist('w');
  }
  function useQuota() {
    if (paid()) return true;
    var ra = RA(); if (ra && ra.useQuota) return ra.useQuota();
    var q = U.store.get('quota', {}); if (q.d !== U.today()) q = { d: U.today(), n: 0 };
    if (q.n >= FREE_PER_DAY) return false;
    q.n++; U.store.set('quota', q); return true;
  }
  function call(params) {
    var k = keys(), p = new URLSearchParams(Object.assign({ applicationId: k.rkApp, accessKey: k.rkKey, formatVersion: '2' }, params));
    return fetch(RAKUTEN_EP + '?' + p.toString(), { referrerPolicy: 'strict-origin-when-cross-origin' }).then(function (r) {
      if (!r.ok) { var e = new Error('rakuten ' + r.status); e.status = r.status; throw e; }
      return r.json();
    }, function () { var e = new Error('network'); e.status = 0; throw e; });
  }
  function fetchItem(row) { return call({ itemCode: row.code, hits: '1', availability: '0' }).then(function (j) { return parseItem(j, row.code); }); }

  /** 確かめた行(done)を、今の一覧へ戻して保存し、開いている表を描き直す */
  function commit(done) {
    var ra = RA(), k = tgKey();
    (done || []).forEach(function (r) { if (r.lim != null) r.limT = k; });
    var merged = mergeBack(ra ? ra.lists.w : list(), done);
    if (ra) { ra.lists.w = merged; ra.persist('w'); ra.render(); if (ra.tab() === 'w') ra.fillDetail(); }
    else if (!U.store.set('watch2', merged)) return false;
    paint();
    return true;
  }
  /** 確かめる。rows = 一覧の行の写し。auto = 自動か */
  function check(rows, auto) {
    if (running || !rows.length) return Promise.resolve(null);
    running = true; stopFlag = false; prog = [0, rows.length];
    U.store.set('watch-chk-lock', { t: Date.now(), id: ME });
    rows.forEach(function (r) { r._k = rowKey(r); });
    paint();
    return runCheck(rows, {
      fetchItem: fetchItem, useQuota: useQuota, limOf: lim, now: Date.now, origin: location.origin,
      wait: function (ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); },
      stopped: function () { return stopFlag; },
      onProgress: function (n, all) { U.store.set('watch-chk-lock', { t: Date.now(), id: ME }); prog = [n, all]; paint(); }
    }).then(function (out) {
      running = false; prog = null;
      U.store.set('watch-chk-last', Date.now()); U.store.del('watch-chk-lock');
      lastMsg = (out.done ? out.done + '件を確かめました。' + (out.changed ? '変化 ' + out.changed + '件。' : '変化はありません。') : '') +   // 1件も取れなかった時は、理由だけを出す
        (out.stopped === 'quota' ? '無料プランの今日の枠(' + FREE_PER_DAY + '回)を使い切ったので、残りは明日確かめられます。' : '') +
        (out.stopped === 'user' ? '途中で止めました。' : '') + (out.stopped === 'error' ? out.error : '');
      if (out.changed && notifyOn()) notify(out.changed);
      if (out.done) commit(rows); else paint();
      if (!auto) U.toast(lastMsg);
      return out;
    });
  }
  function checkAll() {
    if (!hasKeys()) { U.toast('楽天のアプリIDとアクセスキーを入れると確かめられます'); var ra = RA(); if (ra && ra.openKeys) ra.openKeys(); return Promise.resolve(null); }
    var rows = JSON.parse(JSON.stringify(list())).filter(function (r) { return !!r.code; });
    if (!rows.length) { U.toast('商品コードのある行がありません。JANのある行は「楽天で探し直す」を押してください'); return Promise.resolve(null); }
    return check(rows, false);
  }
  /** 自動: 有料・キーあり・前回から6時間以上・別のタブが動いていない時だけ */
  function tryAuto() {
    if (running) return;
    if (!canAuto({ paid: paid(), hasKeys: hasKeys(), last: U.store.get('watch-chk-last', 0), now: Date.now(), lock: U.store.get('watch-chk-lock', null), me: ME })) return;
    var rows = pickAuto(JSON.parse(JSON.stringify(list())));
    if (rows.length) check(rows, true);
  }
  /** 商品コードの無い行を、JANで探し直す(在庫のある一番安い店を当て直す。元に戻せる) */
  function relink(i) {
    var row = list()[i]; if (!row || !row.jan) return;
    if (!hasKeys()) { U.toast('楽天のアプリIDとアクセスキーを入れると探せます'); return; }
    if (!useQuota()) { U.toast('無料プランの今日の枠(' + FREE_PER_DAY + '回)を使い切りました。明日また探せます'); return; }
    call({ keyword: row.jan, hits: '30', availability: '1', sort: '+itemPrice' }).then(function (j) {
      var hit = cheapest(j);
      if (!hit) { U.toast('楽天で見つかりませんでした'); return; }
      var before = JSON.parse(JSON.stringify(row)), t = Date.now();
      var next = Object.assign({}, before, { code: hit.code, shop: hit.shop, url: hit.url, price: hit.price, base: hit.price, shopPt: hit.pt, freeShip: hit.freeShip, src: 'rakuten',
        chk: { t: t, price: hit.price, prev: hit.price, stock: true, pt: hit.pt }, chg: { kind: 'same', diff: 0, cross: null, back: false, changed: false, t: t }, _k: rowKey(before) });
      if (!before.name || /^JAN /.test(before.name)) next.name = hit.name;
      commit([next]);
      U.toast('楽天の ' + (hit.shop || '店') + '(' + yen(hit.price) + '円)を当てました。別の商品でないか、商品ページで確かめてください', '元に戻す', function () {
        var k = rowKey(next), ra = RA(), cur = list().map(function (r) { return rowKey(r) === k ? before : r; });
        if (ra) { ra.lists.w = cur; ra.persist('w'); ra.render(); if (ra.tab() === 'w') ra.fillDetail(); } else U.store.set('watch2', cur);
        paint();
      });
    }, function (err) { U.toast(errText(err && err.status, location.origin)); });
  }
  /** Keepaで売値を取り直す(入っている行も。利用者のキー。JANのある行を100件まで) */
  function keepaRefresh() {
    var ra = RA(); if (!ra || !ra.kpCall) return;
    var items = ra.lists.w.filter(function (r) { return !!r.jan; }).slice(0, 100); if (!items.length) return;
    var b = $('#wc-kp'); b.disabled = true; b.textContent = 'Keepaに問い合わせています';
    ra.kpCall({ code: items.map(function (r) { return r.jan; }).join(',') }).then(function (j) {
      var n = 0;
      (j.products || []).forEach(function (pr) {
        var codes = (pr.eanList || []).concat(pr.upcList || []);
        items.forEach(function (it) { if (codes.indexOf(it.jan) >= 0) { ra.applyKeepa(it, pr); n++; } });
      });
      ra.persist('w'); stampLims(); ra.render(); if (ra.tab() === 'w') ra.fillDetail();
      U.toast(n + '件の売値を取り直しました' + (j.tokensLeft != null ? '(残りトークン ' + j.tokensLeft + ')' : ''));
    }, function (err) { U.toast(String(err && err.message || 'Keepaから取れませんでした')); }).then(function () { b.disabled = false; paint(); });
  }

  /* ---------- お知らせ(ブラウザの通知・ページを開いている間) ---------- */
  function notifyOn() { return !!U.store.get('notify-watch', false) && 'Notification' in root && root.Notification.permission === 'granted'; }
  function enableNotify(on) {
    if (!on) { U.store.set('notify-watch', false); paintNotify(); return Promise.resolve(false); }
    if (!('Notification' in root)) { U.toast('このブラウザは通知に対応していません'); return Promise.resolve(false); }
    var ask; try { ask = root.Notification.permission === 'granted' ? 'granted' : root.Notification.requestPermission(); } catch (e) { ask = 'denied'; }
    return Promise.resolve(ask).then(function (p) {
      var ok = p === 'granted'; U.store.set('notify-watch', ok); paintNotify();
      U.toast(ok ? 'ウォッチの値段か在庫が変わった時に通知します(このアプリのページを開いている間)' : '通知が許可されませんでした。ブラウザの設定で許可してください');
      return ok;
    }, function () { return false; });
  }
  function notify(n) {
    var title = 'ウォッチの' + n + '件で値段か在庫が変わりました', url = U.base() + 'rakuten-amazon/?tab=w';
    var opt = { body: '仕入れる前に、ウォッチで確かめてください', tag: 'zw-watch', icon: U.base() + 'icon-192.png', data: { url: url } };
    function plain() { try { var x = new root.Notification(title, { body: opt.body, tag: opt.tag, icon: opt.icon }); x.onclick = function () { root.focus(); location.href = url; x.close(); }; } catch (e) { /* 通知を出せない端末では何もしない */ } }
    try {
      var sw = 'serviceWorker' in navigator && navigator.serviceWorker.controller ? navigator.serviceWorker.ready : null;
      if (sw) sw.then(function (reg) { return reg.showNotification(title, opt); }).catch(plain); else plain();
    } catch (e) { /* 何もしない */ }
  }
  /** マイページの通知の欄に1行出す */
  function paintNotify() {
    var el = $('#slot-notify-watch'); if (!el) return;
    var rowEl = $('#slot-notify-watch-row'); if (rowEl) rowEl.hidden = false;
    var on = notifyOn();
    el.innerHTML = '<button type="button" class="sw-row" id="wc-notify" role="switch" aria-checked="' + on + '"><span class="sw-k">ウォッチの値段と在庫が変わったら知らせる</span>' +
      '<span class="sw-v">' + (on ? '入' : '切') + '</span><span class="sw" aria-hidden="true"><i></i></span></button>' +
      '<p class="hint">このアプリのページを開いている間だけ確かめます。自動の確かめは有料プランで、前回から6時間以上たった時に動きます。</p>';
    $('#wc-notify').addEventListener('click', function () { enableNotify(!notifyOn()); });
  }

  /* ---------- ウォッチのタブ ---------- */
  /** 行の印(文字つき)。ra.js が各行の2行目の末尾に出す */
  function rowBadge(row, tab) {
    if (tab !== 'w') return '';
    if (!row.code) {
      var i = list().indexOf(row);
      return '<span class="wc-b"><span class="wc-k">今の価格を取れていません</span>' + (row.jan ? '<button type="button" class="lnk" data-wc-relink="' + i + '">楽天で探し直す</button>' :
        (row.url ? '<a href="' + esc(row.url) + '" target="_blank" rel="noopener">商品ページを開く</a>' : '')) + '</span>';
    }
    if (!row.chk) return '';
    var c = row.chg || { kind: 'same' }, cls = c.kind === 'soldout' || c.cross === 'lost' ? ' ng' : (c.cross === 'gained' ? ' ok' : '');
    return '<span class="wc-b"><span class="wc-k' + cls + '">' + esc(label(c)) + '</span><span class="wc-t">' + esc(stamp(row.chk.t)) + ' 確認</span></span>';
  }
  function mountBar() {
    var bar = $('#slot-watch-top'), ra = RA(); if (!bar || !ra) return;
    ra.rowBadge = rowBadge;
    bar.classList.add('wc-bar');
    bar.addEventListener('click', function (e) {
      var id = e.target && e.target.id;
      if (id === 'wc-go') checkAll(); else if (id === 'wc-stop') stopFlag = true; else if (id === 'wc-kp') keepaRefresh();
    });
    $('#rows').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-wc-relink]') : null;
      if (b) { e.stopPropagation(); relink(Number(b.getAttribute('data-wc-relink'))); }
    }, true);
    U.hook('ra-render', function (p) { paint(); if (p && p.tab === 'w') markSeen(); });
    U.hook('ra-ready', function () { stampLims(); ra.render(); });
    document.addEventListener('sedori:target', function () { stampLims(); ra.render(); });
    if (ra.fees && ra.fees()) { stampLims(); ra.render(); }
  }
  /** ウォッチのタブを見たら、変化を「見た」ことにする(行の印は残る。数だけ消える) */
  var seenTimer = null;
  function markSeen() {
    if (!unseenNow() || seenTimer) return;
    seenTimer = setTimeout(function () { seenTimer = null; var ra = RA(); if (ra && ra.tab() === 'w') { U.store.set('watch-seen', Date.now()); paintCount(); } }, 4000);
  }
  function paintCount() {
    // 変化の数はウォッチのタブの横だけに出す。上の帯(#hd-watch)には出さない(スマホ幅で帯の段が増えるため。2026-11-13 批評C1)
    var n = unseenNow(), t = $('#n-w-chg');
    if (t) { t.hidden = !n; t.textContent = n ? '変化 ' + n : ''; }
    U.emit('sedori:watch', { unseen: n });
  }
  function paint() {
    paintCount();
    var bar = $('#slot-watch-top'), ra = RA(); if (!bar || !ra) return;
    var w = ra.lists.w;
    if (!w.length) { bar.innerHTML = ''; return; }
    var last = Number(U.store.get('watch-chk-last', 0)) || 0, kn = w.filter(function (r) { return !!r.jan; }).length;
    var st = running ? '1件ずつ間をあけて確かめています。ページを閉じると止まります。' :
      (lastMsg || (last ? '前回 ' + stamp(last) + ' に確かめました。' : '今の価格と在庫を、楽天から取り直します' + (paid() ? '。' : '(1件につき検索の枠を1回使います)。')));
    var html = '<button type="button" class="btn sm ghost" id="wc-go"' + (running ? ' disabled' : '') + '>' + (running ? '確かめています ' + prog[0] + '/' + prog[1] : '今の価格と在庫を確かめる') + '</button>' +
      (running ? '<button type="button" class="btn sm ghost" id="wc-stop">止める</button>' : '') +
      (!running && ra.kpCall && keys().keepa && kn ? '<button type="button" class="btn sm ghost" id="wc-kp">Keepaで売値を取り直す(' + Math.min(kn, 100) + '件。Keepaのトークンを使います)</button>' : '') +
      '<p class="wc-st" role="status">' + esc(st) + '</p>';
    if (bar.innerHTML !== html) bar.innerHTML = html;
  }

  function start() {
    mountBar(); paintNotify(); paint();
    setTimeout(tryAuto, 3000);
    document.addEventListener('sedori:acct', function () { setTimeout(tryAuto, 3000); paint(); });
  }
  root.SedoriWatchCheck = { checkAll: checkAll, tryAuto: tryAuto, unseen: unseenNow, enableNotify: enableNotify, notifyOn: notifyOn, relink: relink, paint: paint };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(typeof window !== 'undefined' ? window : this);
