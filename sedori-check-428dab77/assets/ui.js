/* せどり 利益チェック — 画面の共通部品
   保存(localStorage・try/catch)、手数料の読み込み、検索バー、目標の利益、キー操作、お知らせ、
   古物台帳(自動記録・状態・売り手の確認・取引相手の情報の貼り付け)、CSV・Excel(xlsx)の書き出し */
(function () {
  'use strict';
  var PREFIX = 'zw-sedori:';
  var MAIL = 'zeroichi.works.jp@gmail.com';

  /** 端末をまたいで揃える設定(ログイン中・有料のみクラウドへ) */
  var SYNC_KEYS = ['target', 'ship', 'wh'];
  function emit(name, detail) { try { document.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (e) { /* 何もしない */ } }
  var store = {
    get: function (k, d) {
      try { var v = localStorage.getItem(PREFIX + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
    },
    set: function (k, v) {
      try { localStorage.setItem(PREFIX + k, JSON.stringify(v)); } catch (e) { return false; }
      if (SYNC_KEYS.indexOf(k) >= 0) emit('sedori:settings', { key: k });
      return true;
    },
    del: function (k) { try { localStorage.removeItem(PREFIX + k); } catch (e) { /* 何もしない */ } }
  };

  function base() { return document.body.getAttribute('data-base') || './'; }
  function $(s, el) { return (el || document).querySelector(s); }
  function $$(s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function yen(n) { n = Math.round(Number(n) || 0); return (n < 0 ? '-' : '') + Math.abs(n).toLocaleString('ja-JP'); }
  function pct(x, d) { return (Math.round((Number(x) || 0) * 1000) / 10).toFixed(d == null ? 1 : d) + '%'; }
  function val(id) { var el = document.getElementById(id); if (!el) return 0; var n = Number(String(el.value).replace(/[,，\s円]/g, '')); return isFinite(n) ? n : 0; }
  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function isTyping(el) { return el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable); }
  function narrow() { return window.matchMedia && window.matchMedia('(max-width:860px)').matches; }

  /* ---------- 手数料 ---------- */
  var feesPromise = null;
  function loadFees() {
    if (!feesPromise) {
      feesPromise = fetch(base() + 'data/fees.json', { cache: 'no-cache' }).then(function (r) {
        if (!r.ok) throw new Error('fees ' + r.status);
        return r.json();
      });
    }
    return feesPromise;
  }
  function showFeeDate(fees) {
    $$('[data-feedate]').forEach(function (el) {
      el.innerHTML = '手数料・送料 ' + esc(fees.checked_label) + ' 確認 <a href="' + base() + '#fees">出典</a>';
    });
  }

  /* ---------- お知らせ ---------- */
  var toastTimer;
  function toast(msg, actionLabel, action) {
    var t = $('#toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg;
    if (actionLabel) {
      var b = document.createElement('button'); b.type = 'button'; b.textContent = actionLabel; b.className = 'toast-act';
      b.addEventListener('click', function () { t.classList.remove('on'); action(); });
      t.appendChild(b);
    }
    t.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('on'); }, actionLabel ? 6000 : 2400);
  }

  function download(name, data, type) {
    var blob = data instanceof Blob ? data : new Blob([data], { type: type || 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* ---------- 目標の利益(円/%)。全ページ共通・端末に保存 ---------- */
  function target() {
    var t = store.get('target', null);
    if (!t || (t.mode !== 'yen' && t.mode !== 'pct')) t = { mode: 'pct', value: 15 };
    t.value = Number(t.value) || 0;
    return t;
  }
  function targetLabel(t) { t = t || target(); return t.mode === 'pct' ? '利益率' + t.value + '%' : '利益' + Number(t.value).toLocaleString('ja-JP') + '円'; }
  function fireTarget() { document.dispatchEvent(new CustomEvent('sedori:target', { detail: target() })); }
  function mountTarget() {
    var inp = $('#t-val'); if (!inp) return;
    var t = target();
    inp.value = t.value;
    function paint() { var x = target(); $$('#tgt .seg button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-m') === x.mode)); }); }
    paint();
    inp.addEventListener('input', function () { var x = target(); x.value = Number(inp.value) || 0; store.set('target', x); fireTarget(); });
    $$('#tgt .seg button').forEach(function (b) {
      b.addEventListener('click', function () {
        var x = target(), m = b.getAttribute('data-m');
        if (x.mode !== m) { x.mode = m; x.value = m === 'pct' ? 15 : 1000; inp.value = x.value; }
        store.set('target', x); paint(); fireTarget();
      });
    });
  }

  /* ---------- 発送のしかた(自分で発送 / 発送代行)。全ページ共通・端末に保存 ---------- */
  function shipMode() { var m = store.get('ship', 'self'); return m === '3pl' ? '3pl' : 'self'; }
  function whCosts(fees) {
    var d = (fees && fees.warehouse && fees.warehouse.defaults) || { in: 50, store: 100, photo: 300, out: 300 };
    var w = store.get('wh', null) || {};
    return { in: w['in'] != null ? w['in'] : d['in'], store: w.store != null ? w.store : d.store, photo: w.photo != null ? w.photo : d.photo, out: w.out != null ? w.out : d.out };
  }
  function whTotal(fees) { return window.SedoriCalc.warehouseCost(shipMode(), whCosts(fees)); }
  function mountShip() {
    var box = $('#shipm'); if (!box) return;
    function paint() { var m = shipMode(); $$('button', box).forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-s') === m)); }); document.body.setAttribute('data-ship', m); }
    paint();
    $$('button', box).forEach(function (b) {
      b.addEventListener('click', function () { store.set('ship', b.getAttribute('data-s')); paint(); fireTarget(); toast(b.getAttribute('data-s') === '3pl' ? '発送代行に任せる: 倉庫の費用を足して計算します' : '自分で発送: 倉庫の費用なし、送料は運送会社の料金で計算します'); });
    });
  }
  /** 発送代行の費用の欄(内訳の上)。自分で発送の時は1行の説明だけ */
  function mountWh(box, fees, note) {
    if (!box) return;
    function draw() {
      var n = typeof note === 'function' ? note() : (note || '');
      var sn = n && typeof n === 'object' ? n : { self: '自分で発送: 倉庫の費用なし' + (n ? '。' + n : ''), pl: n };
      if (shipMode() !== '3pl') { box.innerHTML = '<p class="shipnote">' + sn.self + '</p>'; return; }
      note = sn.pl;
      var w = whCosts(fees), L = (fees.warehouse && fees.warehouse.labels) || { in: '入庫', store: '保管(1か月)', photo: '撮影', out: '出荷作業' };
      box.innerHTML = '<div class="whbox"><p class="whh">発送代行の費用(1個)<span>合計 <b>' + yen(whTotal(fees)) + '円</b></span></p><div class="whg">' +
        ['in', 'store', 'photo', 'out'].map(function (k) { return '<label><span>' + esc(L[k]) + '</span><input type="number" inputmode="numeric" min="0" data-wh="' + k + '" value="' + esc(w[k]) + '"></label>'; }).join('') +
        '</div>' + (note ? '<p class="shipnote">' + note + '</p>' : '') + '</div>';
      $$('[data-wh]', box).forEach(function (el) {
        el.addEventListener('input', function () {
          var cur = whCosts(fees); cur[el.getAttribute('data-wh')] = Number(el.value) || 0; store.set('wh', cur);
          $('.whh b', box).textContent = yen(whTotal(fees)); document.dispatchEvent(new CustomEvent('sedori:wh'));
        });
      });
    }
    draw();
    if (!box._wired) { box._wired = true; document.addEventListener('sedori:target', function () { box._draw(); }); }
    box._draw = draw;
  }
  function carrierOptions(fees, sel) {
    var g = {};
    ((fees.self_ship || {}).carriers || []).forEach(function (c) { (g[c.group] = g[c.group] || []).push(c); });
    return Object.keys(g).map(function (k) {
      return '<optgroup label="' + esc(k) + '">' + g[k].map(function (c) { return '<option value="' + c.id + '"' + (c.id === sel ? ' selected' : '') + '>' + esc(c.label) + (c.id === 'custom' ? '' : ' ' + yen(c.fee + c.material) + '円') + '</option>'; }).join('') + '</optgroup>';
    }).join('');
  }

  /* ---------- 検索バー ---------- */
  function extUrl(src, q) {
    var e = encodeURIComponent(q);
    switch (src) {
      case 'yshop': return 'https://shopping.yahoo.co.jp/search?p=' + e;
      case 'amazon': return /^B0[A-Z0-9]{8}$/i.test(q) ? 'https://www.amazon.co.jp/dp/' + e : 'https://www.amazon.co.jp/s?k=' + e;
      case 'yahuoku': return 'https://auctions.yahoo.co.jp/search/search?p=' + e + '&va=' + e;
      case 'yahuoku-closed': return 'https://auctions.yahoo.co.jp/closedsearch/closedsearch?p=' + e + '&va=' + e;
      case 'mercari-sold': return 'https://jp.mercari.com/search?keyword=' + e + '&status=sold_out';
    }
    return '';
  }
  var api = { onSearch: null, page: null };
  function mountSearch() {
    var f = $('#sbar'); if (!f) return;
    var q = $('#sb-q'), src = $('#sb-src');
    var last = store.get('sb-src:' + (document.body.getAttribute('data-page') || ''), null);
    if (last && src.querySelector('option[value="' + last + '"]')) src.value = last;
    src.addEventListener('change', function () { store.set('sb-src:' + (document.body.getAttribute('data-page') || ''), src.value); });
    var p = new URLSearchParams(location.search);
    if (p.get('q')) q.value = p.get('q');
    var kb = document.createElement('kbd'); kb.className = 'kb'; kb.textContent = '/'; kb.title = '「/」で検索欄へ';
    q.insertAdjacentElement('afterend', kb);
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var s = src.value, text = q.value.trim();
      if (api.onSearch && api.onSearch(s, text) === true) return;
      if (!text) { q.focus(); toast('キーワードかJAN・ASINを入れてください'); return; }
      if (s === 'rakuten') { location.href = base() + 'rakuten-amazon/?q=' + encodeURIComponent(text); return; }
      if (s === 'ledger') { location.href = base() + 'daicho/?q=' + encodeURIComponent(text); return; }
      if (s === 'amazon' && document.body.getAttribute('data-page') !== 'muzaiko-amazon' && document.body.getAttribute('data-page') !== 'rakuten-amazon') {
        window.open(extUrl(s, text), '_blank', 'noopener'); return;
      }
      var u = extUrl(s, text);
      if (u) { window.open(u, '_blank', 'noopener'); toast('新しいタブで開きました。見た価格を入れてください'); }
    });
  }

  /* ---------- キー操作 ---------- */
  function mountKeys() {
    document.addEventListener('keydown', function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var t = e.target;
      if (e.key === '/' && !isTyping(t)) { e.preventDefault(); var q = $('#sb-q'); if (q) { q.focus(); q.select(); } return; }
      if (e.key === 'Escape' && isTyping(t)) { t.blur(); return; }
      if (isTyping(t) || !api.page) return;
      if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); api.page.move && api.page.move(1); }
      else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); api.page.move && api.page.move(-1); }
      else if (e.key === 'Enter' && !(t && t.tagName === 'BUTTON') && !(t && t.tagName === 'A')) { e.preventDefault(); api.page.list && api.page.list(); }
      else if (e.key === 's' || e.key === 'S') { e.preventDefault(); api.page.buy && api.page.buy(); }
    });
  }

  /* ---------- メール(事前登録・メルマガ) ---------- */
  /** 料金は config.js の PLAN_CATALOG から(無ければ既定の表示) */
  function catPrice(k, d) { var c = ((window.ZW_CONFIG || {}).PLAN_CATALOG || {})[k]; return c ? Number(c.price).toLocaleString('ja-JP') : d; }
  function mailto(subject, body) { return 'mailto:' + MAIL + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body); }
  /* 事前登録は「件名『せどりアプリ事前登録』のメール1通」。届いたメールは事業用の Gmail に残り、
     受付開始の前日(config の PREREG.notice)に、そのメールへの返信でご案内を1通送る(手順は zeroichi-store の backend/sedori/README.md「事前登録」)。
     Worker やデータベースに頼らないので、裏側の準備が遅れても受け付けられる。パソコンでメールソフトが無い方のために「Gmailで送る」も並べる */
  var PRE_SUBJECT = 'せどりアプリ事前登録';
  function preCfg() { var p = (window.ZW_CONFIG || {}).PREREG || {}; return { open: p.open || '受付開始', notice: p.notice || '受付開始の前日' }; }
  function preBody(plan) {
    var c = preCfg();
    return 'このまま送信してください。これで事前登録は完了です(料金はかかりません)。\n' +
      c.notice + 'に、このメールアドレスへ受付開始のご案内を1通だけお送りします。\n\n' +
      (plan ? '気になっているプラン: ' + plan + '\n' : '') +
      '(任意)いま一番手間に感じている作業:\n\n' +
      '有料版: ライト 月' + catPrice('light_month', '2,980') + '円/総合 月' + catPrice('total_month', '4,980') + '円(先着' + (Number((window.ZW_CONFIG || {}).FOUNDER_LIMIT) || 200) + '名は月' + catPrice('founder_month', '3,980') + '円)/業務 月' + catPrice('business_month', '7,980') + '円(税込)。' +
      '月払いは14日無料、年払いは10か月分の料金で1年(30日以内の解約は全額返金)。\n' +
      '登録の取り消しは、このメールに「取り消し」と返信するだけでできます。';
  }
  function gmailCompose(subject, body) { return 'https://mail.google.com/mail/?view=cm&fs=1&to=' + encodeURIComponent(MAIL) + '&su=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body); }
  var PREREG = mailto(PRE_SUBJECT, preBody(''));
  var NEWS = mailto('せどりメルマガ登録',
    'このまま送信してください。毎週1回、無料のメールマガジンをお送りします。\n\nお名前(ニックネーム可):\n知りたいこと:\n\n※配信停止は、届いたメールに「配信停止」とご返信いただくだけでできます。');
  var prePlan = '';
  /** 事前登録の欄(data-prereg の中身)。「Gmailで送る」「メールアプリで送る」の2つと、宛先・件名のコピー */
  function preregHTML(opt) {
    opt = opt || {}; var c = preCfg(), body = preBody(prePlan);
    return '<div class="prg' + (opt.compact ? ' cmp' : '') + '">' +
      (opt.compact ? '' : '<p class="prg-h">事前登録<span>無料・メール1通</span></p>') +
      '<p class="prg-t">' + esc(c.notice) + 'に受付開始のご案内を1通だけお送りします。それ以外のメールは届きません。</p>' +
      '<div class="prg-b"><a class="btn" data-pre="gmail" href="' + esc(gmailCompose(PRE_SUBJECT, body)) + '" target="_blank" rel="noopener">Gmailで送る</a>' +
      '<a class="btn ghost" data-pre="mail" href="' + esc(mailto(PRE_SUBJECT, body)) + '">メールアプリで送る</a></div>' +
      '<p class="prg-s">開かない時は、宛先 <b>' + MAIL + '</b> へ件名「' + PRE_SUBJECT + '」で送ってください。<button type="button" class="lnk" data-pre-copy>宛先と件名をコピー</button></p>' +
      '</div>';
  }
  function paintPrereg() {
    $$('[data-prereg]').forEach(function (box) { box.innerHTML = preregHTML({ compact: box.hasAttribute('data-compact') }); });
    $$('[data-mail="prereg"]').forEach(function (a) { a.href = mailto(PRE_SUBJECT, preBody(prePlan)); });
  }
  function setPreregPlan(p) { if (p === prePlan) return; prePlan = p || ''; paintPrereg(); }
  function wireMail() {
    paintPrereg();
    $$('[data-mail="news"]').forEach(function (a) { a.href = NEWS; });
    document.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-pre-copy]'); if (!b) return;
      var t = MAIL + '\n件名: ' + PRE_SUBJECT;
      var done = function () { toast('宛先と件名をコピーしました'); };
      try { navigator.clipboard.writeText(t).then(done, function () { window.prompt('コピーしてください', t); }); } catch (err) { window.prompt('コピーしてください', t); }
    });
  }

  /* ==================================================================
     古物台帳
     ================================================================== */
  var HINMOKU = ['美術品類', '衣類', '時計・宝飾品類', '自動車', '自動二輪車及び原動機付自転車', '自転車類', '写真機類', '事務機器類', '機械工具類', '道具類', '皮革・ゴム製品類', '書籍', '金券類'];
  var STATUS = ['仕入れ済', '入庫', '出品中', '売約', '発送済', '出品停止'];
  var NEXT_LABEL = ['入庫', '出品中', '売れた', '発送済'];
  var VERIFY = ['本人限定受取郵便で確認', '転送不要の簡易書留+本人名義口座へ振込', '対面で身分証を確認', '1万円未満のため不要', '古物商・法人から購入', 'その他(メモに記入)'];
  // Amazonのカテゴリー → 古物の13区分(目安)
  var CAT_HINMOKU = { clothes: '衣類', shoes: '皮革・ゴム製品類', bags: '皮革・ゴム製品類', watch: '時計・宝飾品類', jewelry: '時計・宝飾品類', eyewear: '道具類',
    electronics: '機械工具類', small_appliance: '機械工具類', large_appliance: '機械工具類', home_appliance: '機械工具類', elec_acc: '機械工具類', diy: '機械工具類', industrial: '機械工具類',
    pc: '事務機器類', stationery: '事務機器類', car: '道具類', instruments: '道具類', game_console: '道具類' };
  function hinmokuFor(catId) { return CAT_HINMOKU[catId] || '道具類'; }

  /* 売り手の確認が要る品か(金額を問わない品・1回の取引の合計1万円以上)の判定は seller-check.js(帳簿の古物商特例と共通) */
  function SC() { return window.SedoriSellerCheck; }
  function anyPriceItem(r) { return SC() ? !!SC().anyPriceItem(r) : false; }
  // 同じ日に同じ売り手から買った行は1回の取引として合計する。台帳が変わるたびに作り直す
  var txMemo = null;
  function txTotal(r) {
    if (!SC() || !r || !r.id) return null;
    if (!txMemo) txMemo = SC().txTotals(ledger.all());
    return txMemo[r.id] == null ? null : Math.max(txMemo[r.id], SC().rowTotal(r));
  }
  /** 売り手の確認の状態: 'na'(不要)/'need'(未入力)/'ok'(入力済み) */
  function checkState(r) { return SC() ? SC().state(r, txTotal(r)) : 'na'; }
  /** 確認が要る理由(要らなければ '') */
  function checkReason(r) { return SC() ? SC().reason(r, txTotal(r)) : ''; }
  window.addEventListener && window.addEventListener('storage', function () { txMemo = null; });

  var ledger = {
    all: function () { var r = store.get('ledger', []); return Array.isArray(r) ? r : []; },
    /** 保存。変わった行に時刻を付け、消えた行は墓標に残す(クラウド同期で使う) */
    save: function (rows) {
      var S = window.SedoriSync, changed = [];
      if (S) { var st = S.stamp(ledger.all(), rows, store.get('ledger-del', {}), Date.now()); rows = st.rows; changed = st.changed; store.set('ledger-del', st.del); }
      var ok = store.set('ledger', rows); txMemo = null; updateCount();
      if (ok && changed.length) emit('sedori:ledger', { ids: changed });
      return ok;
    },
    /** クラウドから受け取った台帳をそのまま置く(時刻は付け直さない) */
    replace: function (rows, del) { store.set('ledger', rows); txMemo = null; store.set('ledger-del', del || {}); updateCount(); emit('sedori:remote', {}); },
    get: function (id) { return ledger.all().filter(function (r) { return r.id === id; })[0] || null; },
    update: function (id, patch) {
      var rows = ledger.all(), hit = null;
      rows.forEach(function (r) { if (r.id === id) { Object.keys(patch).forEach(function (k) { r[k] = patch[k]; }); hit = r; } });
      ledger.save(rows); return hit;
    },
    add: function (row, quiet) {
      var rows = ledger.all();
      row.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      row.date = row.date || today();
      row.qty = Math.max(1, Number(row.qty) || 1);
      row.unit = Math.round(Number(row.unit) || 0);
      row.status = row.status || '仕入れ済';
      row.kind = '仕入れ';
      row.ship = row.ship || shipMode();
      if (!row.recvId) row.recvId = row.ship === 'self' ? '自宅' : (row.ship === 'fba' ? 'Amazon FBA' : '');
      rows.unshift(row);
      if (!ledger.save(rows)) { toast('この端末では保存できませんでした(プライベートブラウズ等)'); return null; }
      if (!quiet) toast('台帳に記録しました', '台帳を開く', function () { location.href = base() + 'daicho/'; });
      return row;
    },
    remove: function (id) { ledger.save(ledger.all().filter(function (r) { return r.id !== id; })); },
    /** 状態を1つ進める。「売れた」(売約)で売却日・売値・相手を自動で入れる */
    advance: function (id) {
      var rows = ledger.all(), hit = null;
      rows.forEach(function (r) {
        if (r.id !== id) return;
        var fl = flowOf(r), i = fl.indexOf(r.status || '仕入れ済');
        if (i < 0) i = Math.max(0, STATUS.indexOf(r.status) - 1);
        if (i >= fl.length - 1) return;
        r.status = fl[i + 1];
        if (r.status === '売約' && r.wait) { r.wait = false; r.date = today(); } // 無在庫: 売れてから仕入れる
        if (r.status === '売約') {
          if (!r.saleDate) r.saleDate = today();
          if (!r.salePrice && r.sellPrice) r.salePrice = r.sellPrice;
          if (!r.saleParty) r.saleParty = (r.sellTo || '') + ' 購入者';
        }
        if (r.status === '発送済' && !r.shipDate) r.shipDate = today();
        hit = r;
      });
      ledger.save(rows); return hit;
    }
  };

  /** その行の状態の流れ(自分で発送は入庫を飛ばす。以前の行は入庫あり) */
  function flowOf(r) { return window.SedoriCalc.statusFlow(r.ship === 'self' ? 'self' : '3pl'); }
  function nextLabel(r) {
    var fl = flowOf(r), i = fl.indexOf(r.status || '仕入れ済');
    if (i < 0 || i >= fl.length - 1) return '';
    return fl[i + 1] === '売約' ? (r.wait ? '売れた(仕入れる)' : '売れた') : fl[i + 1] + 'へ';
  }
  var SHIP_LABEL = { self: '自分で発送', '3pl': '発送代行', fba: 'FBA(Amazonが発送)' };

  function updateCount() {
    var el = $('#hd-cnt'); if (!el) return;
    var rows = ledger.all(), need = rows.filter(function (r) { return checkState(r) === 'need'; }).length;
    el.textContent = rows.length ? String(rows.length) : '';
    el.hidden = !rows.length;
    var w = $('#hd-need');
    if (!w) { w = document.createElement('span'); w.id = 'hd-need'; w.className = 'cnt warn'; w.title = '売り手の確認が未入力'; el.insertAdjacentElement('afterend', w); }
    w.textContent = need ? '売り手の確認 ' + need : ''; w.hidden = !need;
    var soon = endingRows(rows).filter(function (x) { return x.e.state !== 'far'; }).length;
    var e = $('#hd-end');
    if (!e) { e = document.createElement('span'); e.id = 'hd-end'; e.className = 'cnt end'; e.title = 'ヤフオクの終了が2時間以内(出品中)'; w.insertAdjacentElement('afterend', e); }
    e.textContent = soon ? '終了間近' + soon : ''; e.hidden = !soon;
    var a = $('.hd-ledger'); if (a) a.href = base() + 'daicho/' + (soon ? '?tab=ending' : '');
  }

  /* ---------- 無在庫の見張り: ヤフオクの終了が近い出品中の行 ---------- */
  /** 出品中で終了日時がある行(終了が近い順)。e は SedoriCalc.endState */
  function endingRows(rows, now) {
    var C = window.SedoriCalc; if (!C || !C.endState) return [];
    return (rows || ledger.all()).map(function (r) { return { r: r, e: C.endState(r, now) }; })
      .filter(function (x) { return x.e && x.e.watch; })
      .sort(function (a, b) { return a.e.end - b.e.end; });
  }
  var NOTIFY_BEFORE = 60 * 60000;
  function notifyOn() { return !!store.get('notify-end', false) && 'Notification' in window && Notification.permission === 'granted'; }
  /** 通知を有効にする(ボタンを押した時だけ許可を求める) */
  function enableNotify(on) {
    if (!on) { store.set('notify-end', false); emit('sedori:notify', { on: false }); return Promise.resolve(false); }
    if (!('Notification' in window)) { toast('このブラウザは通知に対応していません'); return Promise.resolve(false); }
    var ask = Notification.permission === 'granted' ? Promise.resolve('granted') : Notification.requestPermission();
    return Promise.resolve(ask).then(function (p) {
      var ok = p === 'granted'; store.set('notify-end', ok); emit('sedori:notify', { on: ok });
      if (ok) setTimeout(tickEnd, 0);
      toast(ok ? '終了の60分前に通知します(このアプリのページを開いている間)' : '通知が許可されませんでした。ブラウザの設定で許可してください');
      return ok;
    });
  }
  function showEndNotice(r) {
    var title = 'あと60分でヤフオクが終了します', bodyText = (r.name || '(名前なし)') + '\nAmazonの在庫を0にしてください';
    var url = base() + 'daicho/?tab=ending&focus=' + encodeURIComponent(r.id);
    var opt = { body: bodyText, tag: 'zw-end-' + r.id, requireInteraction: true, icon: base() + 'icon-192.png', data: { id: r.id, url: url, stopUrl: base() + 'daicho/?tab=ending&stop=' + encodeURIComponent(r.id) },
      actions: [{ action: 'stop', title: '出品停止にした' }] };
    var sw = 'serviceWorker' in navigator && navigator.serviceWorker.controller ? navigator.serviceWorker.ready : null;
    if (sw) { sw.then(function (reg) { return reg.showNotification(title, opt); }).catch(function () { plain(); }); return; }
    plain();
    function plain() {
      try { var n = new Notification(title, { body: bodyText, tag: opt.tag, requireInteraction: true, icon: opt.icon }); n.onclick = function () { window.focus(); location.href = url; n.close(); }; } catch (e) { /* 何もしない */ }
    }
  }
  /** 出品停止にする(元に戻すつき) */
  function stopListing(id, quiet) {
    var before = ledger.get(id); if (!before) return null;
    before = JSON.parse(JSON.stringify(before));
    var r = ledger.update(id, { status: '出品停止', stoppedAt: new Date().toISOString().slice(0, 16) });
    emit('sedori:remote', {});
    if (!quiet) toast('出品停止にしました: ' + (r.name || ''), '元に戻す', function () { ledger.update(id, before); emit('sedori:remote', {}); });
    return r;
  }
  function tickEnd() {
    updateCount();
    if (!notifyOn()) return;
    var sent = store.get('end-notified', {}), dirty = false, now = Date.now();
    endingRows(null, now).forEach(function (x) {
      var key = x.r.yEnd;
      if (x.e.left <= NOTIFY_BEFORE && x.e.left > -10 * 60000 && sent[x.r.id] !== key) { sent[x.r.id] = key; dirty = true; showEndNotice(x.r); }
    });
    if (dirty) store.set('end-notified', sent);
  }
  function mountEndWatch() {
    tickEnd(); var iv = setInterval(tickEnd, 20000); if (iv && iv.unref) iv.unref();
    if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', function (e) { if (e.data && e.data.type === 'zw-stop' && e.data.id) stopListing(e.data.id); });
  }

  /* ---------- 取引相手の情報(貼り付けから取り出す) ---------- */
  var PREF = '(北海道|青森県|岩手県|宮城県|秋田県|山形県|福島県|茨城県|栃木県|群馬県|埼玉県|千葉県|東京都|神奈川県|新潟県|富山県|石川県|福井県|山梨県|長野県|岐阜県|静岡県|愛知県|三重県|滋賀県|京都府|大阪府|兵庫県|奈良県|和歌山県|鳥取県|島根県|岡山県|広島県|山口県|徳島県|香川県|愛媛県|高知県|福岡県|佐賀県|長崎県|熊本県|大分県|宮崎県|鹿児島県|沖縄県)';
  function toHalf(s) {
    return String(s || '').replace(/[！-～]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/　/g, ' ').replace(/\r/g, '');
  }
  function normDash(s) { return s.replace(/(\d)\s*[‐‑‒–—―−ーｰ－-]\s*(?=\d)/g, '$1-'); }
  var LABEL = /^\s*(?:【[^】]*】\s*)?(氏名|お名前|名前|購入者(?:名|様)?|出品者(?:名|様)?|落札者(?:名|様)?|送り主|発送者|差出人|ご依頼主|お届け先(?:氏名)?|住所|ご住所|発送元住所|郵便番号|〒|電話番号|電話|TEL|Tel|携帯|メールアドレス|メール|E-?mail|mail)\s*[:：]?\s*/i;
  function parseParty(text) {
    var out = {};
    var t = normDash(toHalf(text));
    var url = t.match(/https?:\/\/[^\s<>"']+/); if (url) out.ref = url[0];
    var mail = t.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/); if (mail) out.pMail = mail[0];
    var lines = t.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    var zipIdx = -1, addrIdx = -1;
    lines.forEach(function (l, i) {
      if (out.pZip) return;
      var m = l.match(/〒\s*(\d{3})-?(\d{4})/) || (/郵便番号/.test(l) && l.match(/(\d{3})-?(\d{4})/)) || l.match(/^(\d{3})-(\d{4})(?!\d)/);
      if (m) { out.pZip = m[1] + '-' + m[2]; zipIdx = i; }
    });
    var pr = new RegExp(PREF);
    for (var i = 0; i < lines.length; i++) {
      var m2 = lines[i].match(pr);
      if (!m2) continue;
      var a = lines[i].slice(m2.index).replace(/\s*(?:TEL|電話|tel)[:：]?.*$/, '').trim();
      var nx = lines[i + 1];
      if (nx && !LABEL.test(nx) && !/@|\d{2,4}-\d{2,4}-\d{3,4}/.test(nx) && /(号室|マンション|ハイツ|コーポ|アパート|ビル|荘|レジデンス|棟|\d+F|\d+階|\d+号)/.test(nx)) { a += ' ' + nx; }
      out.pAddr = a.replace(/\s+/g, ' '); addrIdx = i; break;
    }
    var tel = null;
    lines.forEach(function (l) {
      if (tel) return;
      var s = l.replace(/〒\s*\d{3}-?\d{4}/, '');
      var m3 = s.match(/(?:\+81[-\s]?)?\(?0\d{1,4}\)?[-\s]?\d{1,4}[-\s]?\d{3,4}/);
      if (m3) {
        var digits = m3[0].replace(/\D/g, '').replace(/^81/, '0');
        if (digits.length >= 10 && digits.length <= 11 && (/電話|TEL|携帯|tel/i.test(l) || /^0[789]0/.test(digits) || /-/.test(m3[0]))) tel = m3[0].replace(/^\+81[-\s]?/, '0').replace(/^\(/, '').replace(/\)\s*/g, '-').replace(/\(/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-');
      }
    });
    if (tel && /^0[789]0\d{8}$/.test(tel)) tel = tel.slice(0, 3) + '-' + tel.slice(3, 7) + '-' + tel.slice(7);
    if (tel) out.pTel = tel;
    // 氏名: 見出し付き → 「様」で終わる行 → 郵便番号・住所の直前の短い行
    var name = null;
    lines.forEach(function (l) {
      if (name) return;
      var m4 = l.match(/^\s*(?:【[^】]*】\s*)?(?:氏名|お名前|名前|購入者(?:名|様)?|出品者(?:名|様)?|落札者(?:名|様)?|送り主|発送者|差出人|ご依頼主|お届け先氏名)\s*[:：]\s*(.+)$/);
      if (m4) name = m4[1];
    });
    if (!name) lines.forEach(function (l) { if (!name && /^[^\d@:：]{2,20}\s*様$/.test(l)) name = l; });
    if (!name) {
      var k = zipIdx >= 0 ? zipIdx : addrIdx;
      for (var j = k - 1; j >= 0 && j >= k - 2; j--) {
        var c = lines[j].replace(LABEL, '');
        if (c && c.length <= 20 && !/[\d@:：]/.test(c) && !/(ありがとう|お願い|連絡|取引|発送|支払|落札|メッセージ|住所|情報)/.test(c)) { name = c; break; }
      }
    }
    if (name) out.pName = name.replace(/\s*(様|さん|殿)\s*$/, '').replace(/\s+/g, ' ').trim();
    // 職業・年齢(古物台帳の項目)。見出し付きの行だけ取り出す
    var job = t.match(/(?:^|\n)\s*(?:【[^】]*】\s*)?職業\s*[:：]\s*([^\n]{1,30})/); if (job && job[1].trim()) out.pJob = job[1].trim();
    var age = t.match(/(?:^|\n)\s*(?:【[^】]*】\s*)?年齢\s*[:：]\s*(\d{1,3})/); if (age) out.pAge = age[1];
    return out;
  }
  function partyFromUrl(u) {
    if (/auctions\.yahoo\.co\.jp|page\.auctions/.test(u)) return 'Yahoo!オークション';
    if (/mercari\.com|merc\.li/.test(u)) return 'メルカリ';
    if (/paypayfleamarket/.test(u)) return 'Yahoo!フリマ';
    if (/fril\.jp|rakuma/.test(u)) return '楽天ラクマ';
    return '';
  }

  var P_FIELDS = [['pName', '氏名'], ['pZip', '〒'], ['pAddr', '住所'], ['pTel', '電話'], ['pMail', 'メール'], ['pJob', '職業'], ['pAge', '年齢'], ['ref', 'URL']];
  function badgeHTML(r) {
    var s = checkState(r);
    if (s === 'need') return '<span class="badge" data-badge title="' + esc('確認が要る理由: ' + checkReason(r)) + '">売り手の確認が未入力</span>';
    if (s === 'ok') return '<span class="badge ok" data-badge>売り手の確認 済</span>';
    return '<span class="badge na" data-badge>確認不要</span>';
  }
  /** 取引相手の情報の欄(貼り付け+取り出した値+確認方法)。入力のたびに台帳へ保存 */
  function partyPanel(box, id, opts) {
    opts = opts || {};
    var r = ledger.get(id); if (!r || !box) return;
    box.innerHTML = '<div class="party' + (checkState(r) === 'need' ? '' : ' okc') + '">' +
      '<div class="party-h"><span>' + esc(opts.title || '取引相手の情報') + '</span>' + badgeHTML(r) + '</div>' +
      '<textarea data-paste rows="3" placeholder="取引ナビ・メルカリ・メールの本文をそのまま貼り付け(氏名・〒・住所・電話・メール・職業・年齢を取り出します)"></textarea>' +
      '<div class="pgrid">' + P_FIELDS.map(function (f) {
        return '<span>' + f[1] + '</span><input data-f="' + f[0] + '" value="' + esc(r[f[0]] || '') + '"' + (f[0] === 'ref' ? ' type="url" placeholder="ヤフオク・メルカリの取引URL"' : '') + (f[0] === 'pMail' ? ' type="email"' : '') + (f[0] === 'pTel' ? ' type="tel"' : '') + '>';
      }).join('') +
      '<span>確認方法</span><select data-f="verify"><option value="">選んでください</option>' + VERIFY.map(function (v) { return '<option' + (r.verify === v ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('') + '</select>' +
      '</div>' + (opts.foot || '') + '</div>';
    var root = box.firstChild;
    function refresh() {
      var cur = ledger.get(id); if (!cur) return;
      var st = checkState(cur);
      root.classList.toggle('okc', st !== 'need');
      $('[data-badge]', root).outerHTML = badgeHTML(cur);
      updateCount();
      if (opts.onChange) opts.onChange(cur);
    }
    function put(k, v) {
      var patch = {}; patch[k] = v;
      if (k === 'ref') { var cur = ledger.get(id); var p = partyFromUrl(v); if (p && cur && !/[^\s]/.test((cur.party || '').replace(/^(Yahoo!オークション|メルカリ|Yahoo!フリマ|楽天ラクマ)\s*(出品者[:：]?)?\s*/, ''))) patch.party = p + ' 出品者'; }
      ledger.update(id, patch); refresh();
    }
    $$('[data-f]', root).forEach(function (el) {
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', function () { el.classList.remove('got'); put(el.getAttribute('data-f'), el.value.trim()); });
    });
    var ta = $('[data-paste]', root);
    function run() {
      var got = parseParty(ta.value), n = 0;
      Object.keys(got).forEach(function (k) {
        var el = $('[data-f="' + k + '"]', root); if (!el || !got[k]) return;
        el.value = got[k]; el.classList.add('got'); n++;
        put(k, got[k]);
      });
      if (got.pName && !(ledger.get(id) || {}).party) ledger.update(id, { party: got.pName });
      if (n) toast(n + '項目を取り出しました。緑の欄を確かめてください');
      else if (ta.value.trim()) toast('取り出せる項目が見つかりませんでした。欄に直接入れてください');
    }
    ta.addEventListener('paste', function () { setTimeout(run, 0); });
    ta.addEventListener('change', run);
    if (opts.focus) setTimeout(function () { ta.focus({ preventScroll: true }); }, 50);
  }

  /* ---------- 書き出し(古物台帳の形) ---------- */
  var K_HEAD = ['No', '受入れ 年月日', '区別', '品目', '品名', '特徴', '数量', '代価(円)', '相手方 氏名', '相手方 住所', '郵便番号', '電話', 'メール', '相手方 職業', '相手方 年齢', '確認の方法',
    '仕入れ先', 'URL', '払出し 年月日', '区別', '代価(円)', '相手方', '状態', '発送のしかた', '受取先・入庫ID', 'メモ'];
  var K_WIDTH = [5, 11, 7, 12, 34, 24, 6, 10, 14, 34, 10, 14, 22, 10, 8, 26, 20, 30, 11, 7, 10, 18, 9, 14, 14, 20];
  var K_NUM = { 6: 1, 7: 1, 20: 1 };
  function kobutsuRows(rows) {
    return rows.filter(function (r) { return !r.wait; }).slice().reverse().map(function (r, i) {
      var sold = !!r.saleDate;
      return [i + 1, r.date || '', '買受け', r.hinmoku || '', r.name || '', r.feature || '', Number(r.qty) || 1, Math.round((Number(r.unit) || 0) * (Number(r.qty) || 1)),
        r.pName || '', r.pAddr || '', r.pZip || '', r.pTel || '', r.pMail || '', r.pJob || '', r.pAge || '', r.verify || '',
        r.party || '', r.ref || '', r.saleDate || '', sold ? '売却' : '', sold ? Math.round((Number(r.salePrice) || 0) * (Number(r.qty) || 1)) : '', r.saleParty || '',
        r.status || '', SHIP_LABEL[r.ship] || '', r.recvId || '', r.memo || ''];
    });
  }
  function exportCSV(rows) { download('kobutsu-daicho_' + today() + '.csv', window.SedoriCalc.toCSV(K_HEAD, kobutsuRows(rows))); }
  function exportXLSX(rows) {
    var body = kobutsuRows(rows);
    var blob = xlsx([['古物台帳(' + today() + ' 書き出し・' + body.length + '件)']].concat([K_HEAD], body), { widths: K_WIDTH, nums: K_NUM, headerRow: 1, titleRow: 0 });
    download('kobutsu-daicho_' + today() + '.xlsx', blob);
  }

  /* ---------- 小さなxlsx書き出し(無圧縮zip) ---------- */
  var CRC = (function () { var t = []; for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { var c = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zip(files) {
    var enc = new TextEncoder(), parts = [], central = [], off = 0;
    var d = new Date(), dt = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(), tm = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    function u16(v) { return [v & 255, (v >> 8) & 255]; }
    function u32(v) { return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; }
    files.forEach(function (f) {
      var name = enc.encode(f[0]), data = enc.encode(f[1]), c = crc32(data);
      var lh = [].concat(u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(tm), u16(dt), u32(c), u32(data.length), u32(data.length), u16(name.length), u16(0));
      parts.push(new Uint8Array(lh), name, data);
      central.push(new Uint8Array([].concat(u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(tm), u16(dt), u32(c), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(off))), name);
      off += lh.length + name.length + data.length;
    });
    var cdSize = central.reduce(function (s, p) { return s + p.length; }, 0);
    var end = new Uint8Array([].concat(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(cdSize), u32(off), u16(0)));
    return new Blob(parts.concat(central, [end]), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  function xe(s) { return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function colName(i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  function xlsx(rows, o) {
    var ncol = Math.max.apply(null, rows.map(function (r) { return r.length; }));
    var sd = rows.map(function (r, ri) {
      var cells = r.map(function (v, ci) {
        var ref = colName(ci) + (ri + 1);
        var st = ri === o.titleRow ? 4 : (ri === o.headerRow ? 1 : (o.nums[ci] ? 3 : 2));
        if (v === '' || v == null) return ri > o.headerRow ? '<c r="' + ref + '" s="2"/>' : '';
        if (typeof v === 'number' && ri > o.headerRow) return '<c r="' + ref + '" s="' + st + '"><v>' + v + '</v></c>';
        return '<c r="' + ref + '" s="' + st + '" t="inlineStr"><is><t xml:space="preserve">' + xe(v) + '</t></is></c>';
      }).join('');
      return '<row r="' + (ri + 1) + '"' + (ri === o.headerRow ? ' ht="30" customHeight="1"' : '') + '>' + cells + '</row>';
    }).join('');
    var cols = '<cols>' + o.widths.map(function (w, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>'; }).join('') + '</cols>';
    var sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' + cols +
      '<sheetData>' + sd + '</sheetData><autoFilter ref="A2:' + colName(ncol - 1) + Math.max(2, rows.length) + '"/><pageSetup orientation="landscape" paperSize="9" fitToHeight="0"/></worksheet>';
    var styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="3"><font><sz val="10"/><name val="Meiryo UI"/></font><font><b/><sz val="10"/><name val="Meiryo UI"/></font><font><b/><sz val="13"/><name val="Meiryo UI"/></font></fonts>' +
      '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEEF1F4"/><bgColor indexed="64"/></patternFill></fill></fills>' +
      '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFB9C1CB"/></left><right style="thin"><color rgb="FFB9C1CB"/></right><top style="thin"><color rgb="FFB9C1CB"/></top><bottom style="thin"><color rgb="FFB9C1CB"/></bottom><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
      '<xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>' +
      '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
    return zip([
      ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
      ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="古物台帳" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">古物台帳!$A$2:$' + colName(ncol - 1) + '$' + Math.max(2, rows.length) + '</definedName><definedName name="_xlnm.Print_Titles" localSheetId="0">古物台帳!$2:$2</definedName></definedNames></workbook>'],
      ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
      ['xl/styles.xml', styles],
      ['xl/worksheets/sheet1.xml', sheet]
    ]);
  }

  /* ---------- 内訳の表示(各ページ共通) ---------- */
  function brkRows(rows) {
    return '<table class="brk">' + rows.map(function (a) {
      return '<tr' + (a[2] ? ' class="' + a[2] + '"' : '') + '><td>' + a[0] + '</td><td>' + (typeof a[1] === 'number' ? yen(a[1]) + '円' : a[1]) + '</td></tr>';
    }).join('') + '</table>';
  }
  function profitHead(label, profit, cls) {
    return '<div class="pfbox"><div class="hl"><span>' + esc(label) + '</span><b class="' + cls + '">' + yen(profit) + '<i>円</i></b></div>';
  }
  /** 結果を2か所に描く: 上(利益・目安の価格)と、ボタンの下(内訳) */
  function result(sumEl, sum, rows, notes) {
    sumEl.innerHTML = sum;
    var b = $('#brk'); if (!b) return;
    var open = store.get('brk-open', true);
    b.innerHTML = rows ? '<details class="brkd"' + (open ? ' open' : '') + '><summary>内訳</summary>' + brkRows(rows) + (notes || '') + '</details>' : (notes || '');
    var d = $('details', b); if (d) d.addEventListener('toggle', function () { store.set('brk-open', d.open); });
  }
  /* ---------- 価格差が先、ポイントは後(各計算ページ共通) ----------
     利益はまず「ポイント抜き(売値−仕入れ−手数料−送料)」で黒字かを見せ、ポイントはその下に上乗せとして足す */
  function gateHTML(o) {
    var v = Math.round(Number(o.noPt) || 0), ok = v > 0;
    var verdict = v > 0 ? '<b>黒字</b>価格差だけで利益が残ります' :
      (v === 0 ? '<b>±0円</b>手数料と送料を引くと、利益が残りません' :
        (o.plain ? '<b>赤字</b>この売値では損が出ます' : '<b>赤字</b>ポイント抜きでは損が出ます。価格差のない商品は、ポイントを足して黒字に見えても、仕入れの候補から外すのが基本です'));
    var h = '<div class="gate ' + (ok ? 'ok' : 'ng') + '"><div class="hl"><span>' + esc(o.title || 'ポイント抜きの利益') + '<small>' + esc(o.sub || '売値−仕入れ−手数料−送料') + '</small></span>' +
      '<b class="' + (ok ? 'good' : 'bad') + '">' + yen(v) + '<i>円</i></b></div><p class="gate-v">' + verdict + '</p>';
    if (o.pt != null) {
      h += '<table class="brk gate-pt"><tr><td>ポイント(上乗せ' + (o.ptLabel ? '・' + o.ptLabel : '') + ')</td><td>' + (o.pt > 0 ? '+' : '') + yen(o.pt) + '円</td></tr>' +
        '<tr class="t"><td>ポイント込みの利益</td><td>' + yen(v + (Number(o.pt) || 0)) + '円</td></tr></table>';
    }
    return h + '</div>';
  }
  /** 実際の売値(判断の主役)と、目標の売値(目標の利益から逆算した目安)を並べ、差を出す。
      ポイントのあるルート(plain でない)では、目標の売値はポイント抜きで逆算した値(価格差が先、ポイントは後) */
  function tgSub(o) { return esc(o.tgLabel || '') + (o.plain ? 'から逆算した目安' : 'からポイント抜きで逆算した目安'); }
  function compareHTML(o) {
    var h = '<table class="cmp"><tr class="act"><th>実際の売値<small>' + esc(o.where || '売り先') + 'で確かめた今の価格</small></th><td>' + yen(o.actual) + '<i>円</i></td></tr>' +
      '<tr><th>目標の売値<small>' + tgSub(o) + '</small></th><td>' + (o.target ? yen(o.target) + '<i>円</i>' : '届かない') + '</td></tr>';
    if (o.target) {
      var d = o.actual - o.target;
      h += '<tr class="diff ' + (d >= 0 ? 'good' : 'bad') + '"><th>差</th><td>' + (d >= 0 ? '目標より' + yen(d) + '円高い' : '目標に' + yen(-d) + '円足りない') + '</td></tr>';
    }
    return h + '</table>';
  }
  /** 実際の売値が未入力の時の案内(目標の売値は目安として小さく) */
  function askActualHTML(o) {
    return '<div class="ask"><p class="ask-h">' + esc(o.where || '売り先') + 'の実際の売値を入れてください</p>' +
      '<p>利益は、実際に売れている値段で決まります。' + (o.how || '') + '</p></div>' +
      brkRows([['目標の売値(' + tgSub(o) + ')', o.target ? yen(o.target) + '円' : '届かない', 'key'], ['損益分岐の売値' + (o.plain ? '' : '(ポイント抜き)'), o.be ? yen(o.be) + '円' : '—', 'key']]) +
      '<p class="note">目標の売値は、目標の利益から' + (o.plain ? '' : 'ポイントを足さずに(価格差だけで)') + '逆算した値です。その値段で売れるという意味ではありません。</p>';
  }
  function profitClass(profit, sell, tg) {
    if (profit < 0) return 'bad';
    return profit >= window.SedoriCalc.needProfit(sell, tg || target()) ? 'good' : '';
  }

  /* ---------- 起動 ---------- */
  function registerSW() {
    if (!('serviceWorker' in navigator) || location.protocol !== 'https:') return;
  /* 帳簿(books/)はまだ無いことがある。無ければ、押した時に「準備中」と出す(ページができたら何もしない) */
  (function () {
    var links = $$('a[href$="books/"]'); if (!links.length || !window.fetch) return;
    fetch(base() + 'books/', { method: 'HEAD', cache: 'no-cache' }).then(function (r) { return r.ok; }).catch(function () { return false; }).then(function (ok) {
      if (ok) return;
      links.forEach(function (a) {
        a.setAttribute('aria-disabled', 'true'); a.classList.add('soon-link');
        a.addEventListener('click', function (e) { e.preventDefault(); toast('帳簿(売上・経費・月ごとの集計・確定申告の数字)は準備中です。11月中に公開します'); });
      });
    });
  })();
    try { navigator.serviceWorker.register(base() + 'sw.js', { scope: base() }).catch(function () {}); } catch (e) { /* 何もしない */ }
  }
  function mountSide() {
    if (narrow() && document.body.getAttribute('data-route') === 'ra') $$('.side details[data-desk-open]').forEach(function (d) { d.open = false; });
    var cur = $('.gnav [aria-current="page"]'); if (cur) cur.parentNode.scrollLeft = Math.max(0, cur.offsetLeft - 24);
    if (location.hash === '#legal') { var l = $('#legal'); if (l) { l.open = true; setTimeout(function () { l.scrollIntoView(); }, 50); } }
  }

  function init() {
    mountTarget(); mountShip(); mountSearch(); mountKeys(); wireMail(); mountSide(); updateCount(); registerSW(); mountEndWatch();
    loadFees().then(showFeeDate).catch(function () {
      $$('[data-feedate]').forEach(function (el) { el.textContent = '手数料データを読み込めませんでした。再読み込みしてください'; });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.SedoriUI = {
    store: store, $: $, $$: $$, esc: esc, yen: yen, pct: pct, val: val, today: today, narrow: narrow, loadFees: loadFees,
    toast: toast, download: download, target: target, targetLabel: targetLabel, api: api, extUrl: extUrl,
    STATUS: STATUS, NEXT_LABEL: NEXT_LABEL, HINMOKU: HINMOKU, VERIFY: VERIFY, hinmokuFor: hinmokuFor, checkState: checkState, checkReason: checkReason, anyPriceItem: anyPriceItem,
    ledger: ledger, partyPanel: partyPanel, parseParty: parseParty, partyFromUrl: partyFromUrl, badgeHTML: badgeHTML,
    exportCSV: exportCSV, exportXLSX: exportXLSX, xlsx: xlsx, kobutsuRows: kobutsuRows, K_HEAD: K_HEAD,
    brkRows: brkRows, profitHead: profitHead, result: result, gateHTML: gateHTML, compareHTML: compareHTML, askActualHTML: askActualHTML,
    shipMode: shipMode, endingRows: endingRows, enableNotify: enableNotify, notifyOn: notifyOn, stopListing: stopListing, emit: emit, SYNC_KEYS: SYNC_KEYS, base: base, whCosts: whCosts, whTotal: whTotal, mountWh: mountWh, carrierOptions: carrierOptions, flowOf: flowOf, nextLabel: nextLabel, SHIP_LABEL: SHIP_LABEL, profitClass: profitClass, updateCount: updateCount, PREREG: PREREG, NEWS: NEWS,
    preregHTML: preregHTML, setPreregPlan: setPreregPlan
  };
})();
