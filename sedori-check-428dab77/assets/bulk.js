/* せどり 利益チェック — まとめてチェック(楽天・Yahoo!→Amazon の「まとめて」のタブ)
   JAN・ASINの一覧を貼る → 1行ずつ計算 → 目標に届く行だけを残す。
   - 価格を取るのは、利用者自身のKeepaのキー(100件ずつ)と、楽天の公式API(仕入れ値が無い行だけ・1秒に1件)だけ。
     Amazon・楽天のページそのものは読まない。どちらのキーも無ければ、貼った数字だけで計算する
   - 計算と判定は ra.js と同じもの(SedoriRA.compute / judge)。判定はポイント抜きの利益が目標以上
   - 結果は端末の ra-bulk に最後の1回分(500件まで)。クラウドには送らない
   - プランごとの1回の行数: 無料20・ライト100・総合と業務500(SedoriCalc.bulkLimit)
   進め方の部品(core)は画面に依存しないので、node の試験から読める */
(function (root, factory) {
  var core = factory();
  if (typeof module === 'object' && module.exports) module.exports = core;
  else { root.SedoriBulkCore = core; if (root.document) core.mount(root); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- 画面に依存しない部品 ---------- */
  /** 貼った1行 → 一覧の行(検索結果の行と同じ形) */
  function toRow(p) {
    var it = { src: 'bulk', name: '', price: p.cost || 0, sell: p.sell || null, inShip: 0, shopPt: 1, line: p.line };
    if (p.type === 'asin') it.asin = p.code; else it.jan = p.code;
    return it;
  }
  /** 行数の上限で分ける。返り値 { rows: 計算する行, over: 上限を超えて計算しない行の数 } */
  function plan(items, limit) {
    return { rows: items.slice(0, limit).map(toRow), over: Math.max(0, items.length - limit) };
  }
  /** Keepaの返事の商品が、その行のものか(JANは eanList・upcList、ASINは asin で見る) */
  function matches(it, pr) {
    if (!pr) return false;
    if (it.jan) {
      var codes = (pr.eanList || []).concat(pr.upcList || []).map(String);
      return codes.indexOf(it.jan) >= 0 || codes.indexOf(it.jan.replace(/^0/, '')) >= 0;
    }
    return !!it.asin && String(pr.asin || '').toUpperCase() === it.asin;
  }
  /** 楽天の検索結果から、送料込みで一番安い1件(送料込みの店が無ければ、送料別で一番安い1件) */
  function pickCheapest(list) {
    var ok = (list || []).filter(function (x) { return Number(x.price) > 0; });
    var free = ok.filter(function (x) { return x.freeShip; });
    var pool = free.length ? free : ok;
    return pool.slice().sort(function (a, b) { return a.price - b.price; })[0] || null;
  }
  /**
   * まとめての計算を進める。rows の各行に、Keepaの値(売値など)と、楽天の一番安い仕入れ値を入れていく。
   * 済んだ行には kpTry・rkTry を付けるので、途中で止まっても同じ rows でもう一度呼べば続きから進む。
   * deps: { keepa: キーがあるか, rakuten: キーがあるか, kpCall(params), applyKeepa(it, pr), rakutenCall(params), useQuota(),
   *         wait(ms), stopped(), progress(done, total, phase), gap: 楽天の呼び出しの間(ミリ秒) }
   * 返り値(Promise): { state: 'done'|'stopped'|'paused', why: 文, tokens: Keepaの残りトークン }
   */
  function runJob(rows, deps) {
    var kpRows = deps.keepa ? rows.filter(function (it) { return !it.kpTry; }) : [];
    var needRk = function (it) { return !(Number(it.price) > 0) && it.jan && !it.rkTry; };
    var done = 0, tokens = null;
    function total() { return kpRows.length + (deps.rakuten ? rows.filter(needRk).length : 0) + rkDone; }
    var rkDone = 0;
    function tick(phase) { if (deps.progress) deps.progress(done, Math.max(done, total()), phase); }
    function fail(err, who) {
      var st = err && err.status, t = String(err && err.message || err);
      if (/Failed to fetch|NetworkError|Load failed/i.test(t)) t = who + 'に接続できませんでした。通信状態を確かめて、もう一度お試しください。';
      else if (who === 'Keepa') t = st === 429 ? 'Keepaのトークンが足りなくなりました。たまるのを待ってから「続きから計算する」を押すと、残りの行を計算します。' :
        'Keepaから売値を取れませんでした。キーが正しいかを見て、もう一度お試しください。';
      return { state: 'paused', err: true, why: t.replace(/\(番号 \d+\)。?$/, ''), tokens: tokens, status: st };
    }

    // 1) Keepa: JANとASINを分けて、100件ずつ
    var groups = [];
    [['code', 'jan'], ['asin', 'asin']].forEach(function (g) {
      chunk(kpRows.filter(function (it) { return !!it[g[1]]; }), 100).forEach(function (part) { groups.push({ key: g[0], f: g[1], part: part }); });
    });
    function kpStep(i) {
      if (i >= groups.length) return Promise.resolve(null);
      if (deps.stopped && deps.stopped()) return Promise.resolve({ state: 'stopped', why: '', tokens: tokens });
      var g = groups[i], prm = {}; prm[g.key] = g.part.map(function (it) { return it[g.f]; }).join(',');
      tick('keepa');
      return deps.kpCall(prm).then(function (j) {
        if (j && j.tokensLeft != null) tokens = j.tokensLeft;
        (j && j.products || []).forEach(function (pr) {
          if (!pr || !pr.asin) return;
          g.part.forEach(function (it) {
            if (!matches(it, pr)) return;
            deps.applyKeepa(it, pr);
            if (pr.title && (!it.name || it.name === it.jan || it.name === it.asin)) it.name = pr.title;
            if (!it.jan && pr.eanList && pr.eanList[0]) it.jan = String(pr.eanList[0]);
          });
        });
        g.part.forEach(function (it) { it.kpTry = true; });
        done += g.part.length;
        return kpStep(i + 1);
      }, function (err) { return fail(err, 'Keepa'); });
    }

    // 2) 楽天: 仕入れ値が無くJANのある行だけ、1件ずつ(間をあける)
    function rkStep() {
      if (!deps.rakuten) return Promise.resolve(null);
      var it = rows.filter(needRk)[0];
      if (!it) return Promise.resolve(null);
      if (deps.stopped && deps.stopped()) return Promise.resolve({ state: 'stopped', why: '', tokens: tokens });
      if (!deps.useQuota()) return Promise.resolve({ state: 'paused', why: '無料プランの楽天の検索(1日20回)を使い切りました。仕入れ値を取れなかった行は、仕入れ値の上限を出しています。', tokens: tokens, quota: true });
      tick('rakuten');
      return deps.rakutenCall({ keyword: it.jan, sort: '+itemPrice', hits: '30', availability: '1' }).then(function (list) {
        var hit = pickCheapest(list);
        if (hit) {
          it.price = hit.price; it.shop = hit.shop; it.url = hit.url; it.img = hit.img; it.shopPt = hit.shopPt; it.freeShip = hit.freeShip; it.code = hit.code;
          if (!it.name || it.name === it.jan || it.name === it.asin) it.name = hit.name;
        }
        it.rkTry = true; done++; rkDone++;
        return Promise.resolve(deps.wait ? deps.wait(deps.gap == null ? 1100 : deps.gap) : null).then(rkStep);
      }, function (err) { return fail(err, '楽天'); });
    }

    return kpStep(0).then(function (halt) { return halt || rkStep(); }).then(function (halt) {
      tick('end');
      return halt || { state: 'done', why: '', tokens: tokens };
    });
  }
  function chunk(list, n) { var out = []; for (var i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; }

  /* ---------- 画面 ---------- */
  function mount(win) {
    var U = win.SedoriUI, C = win.SedoriCalc, R = win.SedoriRA, document = win.document;
    if (!U || !C || !R || !document.getElementById('bulk-box')) return;
    var $ = U.$, esc = U.esc;
    var TIER_NAME = { free: '無料プラン', light: 'ライト', total: '総合', business: '業務' };
    var running = false, stopAsked = false, prog = null;
    var meta = U.store.get('ra-bulk', null) || {};   // { pasted, bad, dup, over, lim, state, why, tokens } と items(ra.js が入れる)
    var ta = $('#bulk-text'), st = $('#bulk-st');

    function limit() { return C.bulkLimit(U.tier()); }
    function save() { var s = U.store.get('ra-bulk', null) || {}; ['pasted', 'bad', 'dup', 'over', 'lim', 'state', 'why', 'err', 'code', 'tokens'].forEach(function (k) { s[k] = meta[k]; }); s.items = R.lists.b.slice(0, 500); U.store.set('ra-bulk', s); }
    function paintLimit() {
      var p = ta.value.trim() ? C.parseCodes(ta.value) : null, lim = limit();
      $('#bulk-lim').textContent = TIER_NAME[U.tier()] + 'は1回' + lim + '行まで計算します。' +
        (p ? 'いま読める行は' + p.items.length + '行' + (p.bad.length ? '、読めない行は' + p.bad.length + '行' : '') + 'です。' : '');
    }

    /* 一覧の上: 進み具合、件数の1行、次にすること1つだけ。残りの注記と読めなかった行は一覧の下 */
    function paint() {
      var rows = R.lists.b, h = '', below = [];
      if (running && prog) {
        var label = { keepa: 'Keepaで売値を取っています', rakuten: '楽天で仕入れ値を探しています' }[prog.phase] || '計算しています';
        h += '<p class="bulk-prog"><b>' + prog.done + ' / ' + prog.total + '件</b><span>' + label + '</span><progress max="' + Math.max(1, prog.total) + '" value="' + prog.done + '"></progress>' +
          '<button type="button" class="btn ghost" id="bulk-stop">' + (stopAsked ? '止めています' : '止める') + '</button></p>';
      }
      if (rows.length) {
        var n = { ok: 0, ng: 0, unk: 0 };
        rows.forEach(function (it) { n[R.judge(it)]++; });
        var bad = (meta.bad || []).length, lim = meta.lim || limit(), k = R.keys(), noKeys = !k.keepa || !(k.rkApp && k.rkKey);
        var rest = [n.ng ? '届かない' + n.ng : '', n.unk ? '未入力' + n.unk : '', bad ? '読めなかった' + bad : ''].filter(Boolean).join('・');
        h += '<p class="bulk-sum"><span class="bs-k">目標に届く</span><b>' + n.ok + '</b><span class="bs-u">件</span>' +
          '<span class="bs-rest">' + (meta.pasted || rows.length) + '行のうち' + (rest ? ' ' + rest : '') + '</span></p>';
        // 次にすること(1つだけ): 止まった > 行数の上限 > キーが無い
        var overText = TIER_NAME[U.tier()] + 'は1回' + lim + '行までです。' + (lim + 1) + '行目から先の' + meta.over + '行は計算していません。ライトは100行、総合と業務は500行まで計算できます。';
        var unkText = '未入力の行は、Amazonの売値か仕入れ値がまだ無い行です。行を押して右の欄に入れると計算します。';
        var keyText = 'APIキーを入れると、' + (!k.keepa ? 'Keepaの売値' : '') + (!k.keepa && !(k.rkApp && k.rkKey) ? 'と' : '') + (!(k.rkApp && k.rkKey) ? '楽天の一番安い仕入れ値' : '') + 'を取れます。';
        var step = '';
        if (!running && (meta.state === 'paused' || meta.state === 'stopped')) {
          step = '<div class="bulk-act' + (meta.err ? ' err' : '') + '"' + (meta.err ? ' role="alert"' : '') + '><p>' + (meta.err ? '<span class="bulk-ic" aria-hidden="true">!</span>' : '') +
            esc(meta.why || '途中で止めました。') + (meta.err && meta.code ? '<small>番号 ' + esc(meta.code) + '</small>' : '') + '</p>' +
            '<button type="button" class="btn ghost" id="bulk-resume">続きから計算する</button></div>';
          if (meta.over) below.push(overText);
        } else if (meta.over && !running) {
          step = '<div class="bulk-act"><p>' + overText + '</p><a class="btn ghost" href="' + U.base() + 'plans/">料金を見る</a></div>';
        } else if (n.unk && noKeys && !running) {
          step = '<div class="bulk-act"><p>' + unkText + keyText + '</p><button type="button" class="btn ghost" id="bulk-keys">APIキーを入れる</button></div>';
          unkText = '';
        }
        h += step;
        if (n.unk && unkText && !running) below.push(unkText + (noKeys ? keyText : ''));
        if (meta.dup) below.push('同じコードの' + meta.dup + '行は、1つにまとめました。');
        if (meta.tokens != null && !running) below.push('Keepaの残りトークンは' + meta.tokens + 'です。');
      } else if (meta.msg) h += '<p class="bulk-note">' + esc(meta.msg) + '</p>';
      st.innerHTML = h;
      var badBox = $('#bulk-bad'), b = meta.bad || [];
      badBox.innerHTML = below.map(function (t) { return '<p class="bulk-note">' + t + '</p>'; }).join('') +
        (b.length && rows.length ? '<details class="bulk-bad"><summary>読めなかった行 ' + b.length + '件</summary><ol>' +
        b.slice(0, 100).map(function (x) { return '<li><span>' + x.line + '行目</span><div><code>' + esc(x.text.slice(0, 60)) + '</code><small>' + esc(x.why) + '</small></div></li>'; }).join('') +
        '</ol>' + (b.length > 100 ? '<p class="bulk-note">残りの' + (b.length - 100) + '件は省いています。</p>' : '') + '</details>' : '');
    }

    function start(resume) {
      if (running) { U.toast('いま計算しています。終わるまでお待ちください'); return; }
      if (!resume) {
        var p = C.parseCodes(ta.value), lim = limit();
        if (!p.items.length) {
          meta = { msg: ta.value.trim() ? 'JANかASINを読める行がありませんでした。1行に1商品、1列目にJAN(13桁・8桁)かASIN(B0で始まる10桁)を入れてください。' : 'JAN・ASINの一覧を貼ってから押してください。' };
          R.lists.b = []; paint(); R.render(); ta.focus(); return;
        }
        var pl = plan(p.items, lim);
        R.lists.b = pl.rows;
        meta = { pasted: p.total, bad: p.bad, dup: p.dup, over: pl.over, lim: lim, state: 'run', why: '', err: false, code: '', tokens: null };
        U.store.set('ra-bulk-text', ta.value.slice(0, 60000));
        $('#profitonly').checked = false;          // 計算中は全部の行を見せ、終わったら目標に届く行だけにする
      }
      var k = R.keys(), rows = R.lists.b;
      running = true; stopAsked = false; prog = { done: 0, total: rows.length, phase: '' };
      $('#bulk-run').textContent = '計算しています';
      R.setTab('b'); save(); paint();
      runJob(rows, {
        keepa: !!k.keepa, rakuten: !!(k.rkApp && k.rkKey), kpCall: R.kpCall, applyKeepa: R.applyKeepa, rakutenCall: R.rakuten, useQuota: R.useQuota,
        wait: function (ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); },
        stopped: function () { return stopAsked; },
        progress: function (d, t, ph) { prog = { done: d, total: t, phase: ph }; if (ph !== 'end') { save(); if (R.tab() === 'b') R.render(); else paint(); } }
      }).then(function (res) {
        running = false; prog = null;
        meta.state = res.state; meta.why = res.why || ''; meta.err = !!res.err; meta.code = res.err ? res.status || '' : ''; if (res.tokens != null) meta.tokens = res.tokens;
        $('#bulk-run').textContent = 'まとめて計算する';
        if (res.state === 'done') {
          $('#profitonly').checked = true; $('#profitonly').dispatchEvent(new Event('change', { bubbles: true }));   // 目標に届く行だけを残す(左の絞り込みで外せる)
        }
        $('#bulk-in').open = false;                // 終わっても止まっても、結果を上に出す(貼る欄は閉じる)
        save(); R.render(); paint();
        if (R.tab() !== 'b') U.toast('まとめての計算が' + (res.state === 'done' ? '終わりました' : '止まりました'), '結果を見る', function () { R.setTab('b'); });
      });
    }

    $('#bulk-run').addEventListener('click', function () { start(false); });
    st.addEventListener('click', function (e) {
      if (e.target.id === 'bulk-stop') { stopAsked = true; paint(); }
      if (e.target.id === 'bulk-resume') start(true);
      if (e.target.id === 'bulk-keys') R.openKeys();
    });
    $('#bulk-bad').addEventListener('click', function (e) { if (e.target.id === 'bulk-keys') R.openKeys(); });
    var t = null;
    ta.addEventListener('input', function () { clearTimeout(t); t = setTimeout(paintLimit, 200); });
    $('#b-watch').addEventListener('click', function () {
      var items = R.visible().map(function (o) { return o.it; }).filter(function (it) { return Number(it.price) > 0; });
      if (!items.length) { U.toast('仕入れ値の入った行がありません'); return; }
      var room = 300 - R.lists.w.length;
      U.toast(R.addWatch(items) ? items.length + '件をウォッチに入れました' + (items.length > room ? '(ウォッチは300件までで、古い行から外れます)' : '') : 'この端末では保存できませんでした', 'ウォッチを見る', function () { R.setTab('w'); });
    });
    U.hook('ra-render', function (p) { if (p.tab === 'b') paint(); });
    document.addEventListener('sedori:acct', paintLimit);

    /* 上の検索欄に複数行を貼った時は、行を保ったまま「まとめて」へ送る(検索欄は改行を捨てるため) */
    function open(text, run) {
      ta.value = text; $('#bulk-in').open = true; paintLimit(); R.setTab('b');
      if (run) start(false); else ta.focus();
    }
    var q = $('#sb-q');
    if (q) q.addEventListener('paste', function (e) {
      var text = (e.clipboardData || win.clipboardData || { getData: function () { return ''; } }).getData('text') || '';
      if (!/\n/.test(text.trim()) || C.parseCodes(text).items.length < 2) return;
      e.preventDefault(); open(text, false);
      U.toast('一覧を「まとめて」に入れました。「まとめて計算する」を押してください');
    });

    win.SedoriBulk = { open: function (text) { open(text, true); }, start: start, running: function () { return running; } };

    // 起動: 前に貼った一覧を戻す。計算の途中でページを閉じていたら「続きから」を出す
    ta.value = U.store.get('ra-bulk-text', '') || '';
    if (meta.state === 'run') { meta.state = 'stopped'; meta.err = false; meta.why = '前の計算が途中で止まっています。'; }
    if (R.lists.b.length && meta.state === 'done') $('#bulk-in').open = false;
    var sp = new URLSearchParams(win.location.search);
    if (sp.get('bulk')) open(sp.get('bulk').split(/[\s,]+/).join('\n'), true);
    paintLimit(); paint();
  }

  return { toRow: toRow, plan: plan, matches: matches, pickCheapest: pickCheapest, runJob: runJob, mount: mount };
});
