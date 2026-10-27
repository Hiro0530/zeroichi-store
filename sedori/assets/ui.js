/* せどり 利益チェック — 画面の共通部品(保存・手数料の読み込み・台帳・お知らせ) */
(function () {
  'use strict';
  var PREFIX = 'zw-sedori:';
  var MAIL = 'zeroichi.works.jp@gmail.com';

  var store = {
    get: function (k, d) {
      try { var v = localStorage.getItem(PREFIX + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
    },
    set: function (k, v) {
      try { localStorage.setItem(PREFIX + k, JSON.stringify(v)); return true; } catch (e) { return false; }
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
      el.innerHTML = '手数料・送料は <b>' + esc(fees.checked_label) + '</b> 確認(<a href="' + base() + '#fees">出典</a>)';
    });
  }

  var toastTimer;
  function toast(msg, actionLabel, action) {
    var t = $('#toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg;
    if (actionLabel) {
      var b = document.createElement('button'); b.type = 'button'; b.textContent = actionLabel; b.className = 'toast-act';
      b.addEventListener('click', function () { action(); t.classList.remove('on'); });
      t.appendChild(b);
    }
    t.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('on'); }, actionLabel ? 5000 : 2400);
  }

  function download(name, text, type) {
    var blob = new Blob([text], { type: type || 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* ---------- 目標の利益(円/%) — 全ページ共通の設定 ---------- */
  function target() {
    var t = store.get('target', null);
    if (!t || (t.mode !== 'yen' && t.mode !== 'pct')) t = { mode: 'pct', value: 15 };
    return t;
  }
  function targetLabel(t) { t = t || target(); return t.mode === 'pct' ? '利益率' + t.value + '%' : '利益' + Number(t.value).toLocaleString('ja-JP') + '円'; }
  function mountTarget() {
    $$('[data-target]').forEach(function (box) {
      var t = target();
      box.innerHTML = '<span class="fl">目標の利益</span><div class="tgt"><input id="t-val" type="number" inputmode="decimal" min="0" step="1" value="' + esc(t.value) + '" aria-label="目標の利益">' +
        '<div class="seg" role="group" aria-label="単位"><button type="button" data-m="yen" aria-pressed="' + (t.mode === 'yen') + '">円</button><button type="button" data-m="pct" aria-pressed="' + (t.mode === 'pct') + '">%</button></div></div>';
      var inp = $('#t-val', box);
      inp.addEventListener('input', function () { var x = target(); x.value = Number(inp.value) || 0; store.set('target', x); });
      $$('.seg button', box).forEach(function (b) {
        b.addEventListener('click', function () {
          var x = target(), m = b.getAttribute('data-m');
          if (x.mode !== m) { x.mode = m; x.value = m === 'pct' ? 15 : 1000; inp.value = x.value; }
          store.set('target', x);
          $$('.seg button', box).forEach(function (o) { o.setAttribute('aria-pressed', String(o === b)); });
          inp.dispatchEvent(new Event('input', { bubbles: true }));
        });
      });
    });
  }

  /* ---------- メール(事前登録・メルマガ) ---------- */
  function mailto(subject, body) {
    return 'mailto:' + MAIL + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
  }
  var PREREG = mailto('せどりアプリ事前登録',
    'このまま送信してください(分かる所だけで大丈夫です)。\n\n' +
    'お名前(ニックネーム可):\n' +
    'よく使う仕入れ先(楽天/Yahoo!/ヤフオク/業者オークション/店舗 など):\n' +
    'よく使う売り先(Amazon/メルカリ/Yahoo!オークション など):\n' +
    'いま一番面倒な作業:\n\n' +
    '※有料版(月1,480円・30日無料)の準備ができたら、このアドレスにご案内を1通お送りします。登録しても料金は発生しません。');
  var NEWS = mailto('せどりメルマガ登録',
    'このまま送信してください。毎週1回、無料のメールマガジンをお送りします。\n\n' +
    'お名前(ニックネーム可):\n' +
    '知りたいこと(手数料の改定/ポイントの日程/台帳の付け方 など):\n\n' +
    '※配信停止は、届いたメールに「配信停止」とご返信いただくだけでできます。');
  function wireMail() {
    $$('[data-mail="prereg"]').forEach(function (a) { a.href = PREREG; });
    $$('[data-mail="news"]').forEach(function (a) { a.href = NEWS; });
  }

  /* ---------- 仕入れ台帳(古物台帳の項目つき) ---------- */
  var HINMOKU = ['', '美術品類', '衣類', '時計・宝飾品類', '自動車', '自動二輪車及び原動機付自転車', '自転車類', '写真機類', '事務機器類', '機械工具類', '道具類', '皮革・ゴム製品類', '書籍', '金券類'];
  var STATUS = ['仕入れ済', '入庫', '出品中', '売約', '発送済'];
  var L_HEAD = ['状態', '受取先・入庫ID', '取引日', '区分', '新品/中古', '古物の品目', '品名', '特徴(型番・色・シリアル等)', '数量', '単価(円)', '合計(円)',
    '仕入れ先・販売先', '注文番号・URL', '相手方の氏名', '相手方の住所', '相手方の職業', '相手方の年齢', '確認の方法',
    '売り先', '予定売値(円)', '見込み利益(円/個)', 'ルート', 'メモ'];
  var L_KEYS = ['status', 'recvId', 'date', 'kind', 'cond', 'hinmoku', 'name', 'feature', 'qty', 'unit', 'total',
    'party', 'ref', 'pName', 'pAddr', 'pJob', 'pAge', 'verify', 'sellTo', 'sellPrice', 'profit', 'route', 'memo'];

  function U_toastLater(m) { setTimeout(function () { toast(m); }, 300); }
  var LEDGER_FORM =
    '<details class="more"><summary>手で1件追加する(古物台帳の項目つき)</summary>' +
    '<form id="ledger-form" class="f" autocomplete="off">' +
    '<label>取引日<input type="date" id="lg-date" name="date"></label>' +
    '<label>区分<select name="kind"><option>仕入れ</option><option>販売</option></select></label>' +
    '<label>新品/中古<select name="cond"><option>新品</option><option>中古</option></select></label>' +
    '<label>古物の品目<small>中古品のとき</small><select id="lg-hinmoku" name="hinmoku"></select></label>' +
    '<label class="full">品名<input name="name" required placeholder="例: ○○ ミニカー 1/64"></label>' +
    '<label class="full">特徴<small>型番・色・シリアル番号など、品物を見分けられること</small><input name="feature"></label>' +
    '<label>数量<input name="qty" type="number" inputmode="numeric" min="1" value="1"></label>' +
    '<label class="yen">単価<input name="unit" type="number" inputmode="numeric" min="0"></label>' +
    '<label class="full">仕入れ先・販売先<small>店名・サイト名・会場名</small><input name="party"></label>' +
    '<label class="full">注文番号・URL<input name="ref"></label>' +
    '<label>相手方の氏名<small>個人から中古品を買ったとき</small><input name="pName"></label>' +
    '<label>相手方の住所<input name="pAddr"></label>' +
    '<label>相手方の職業<input name="pJob"></label>' +
    '<label>相手方の年齢<input name="pAge" inputmode="numeric"></label>' +
    '<label class="full">確認の方法<small>例: 身分証(運転免許証)で確認、非対面の確認方法 など</small><input name="verify"></label>' +
    '<label>売り先<input name="sellTo" placeholder="Amazon / メルカリ など"></label>' +
    '<label>受取先・入庫ID<small>発送代行に送る場合の受付番号など</small><input name="recvId"></label>' +
    '<label>メモ<input name="memo"></label>' +
    '<div class="full btns"><button class="b" type="submit">台帳に追加</button></div>' +
    '</form></details>';

  var ledger = {
    all: function () { return store.get('ledger', []); },
    save: function (rows) { return store.set('ledger', rows); },
    add: function (row) {
      var rows = ledger.all();
      row.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      row.date = row.date || today();
      row.qty = Number(row.qty) || 1;
      row.status = row.status || '仕入れ済';
      row.total = row.total || Math.round((Number(row.unit) || 0) * row.qty);
      rows.unshift(row);
      if (!ledger.save(rows)) { toast('この端末では保存できませんでした(プライベートブラウズ等)'); return false; }
      ledger.render(); toast('台帳に追加しました'); return true;
    },
    /** 手入力の欄に値を入れて開く(中古は相手方の項目を本人が埋めてから追加する) */
    prefill: function (row) {
      var f = $('#ledger-form'); if (!f) return;
      Object.keys(row).forEach(function (k) { var el = f.querySelector('[name="' + k + '"]'); if (el) el.value = row[k]; });
      f.closest('details').open = true;
      f.scrollIntoView({ behavior: 'smooth', block: 'start' });
      U_toastLater('内容を確かめて、相手方の項目を埋めてから「台帳に追加」を押してください');
    },
    remove: function (id) { ledger.save(ledger.all().filter(function (r) { return r.id !== id; })); ledger.render(); },
    csv: function () {
      var rows = ledger.all().map(function (r) { return L_KEYS.map(function (k) { return r[k] == null ? '' : r[k]; }); });
      download('shiire-daicho_' + today() + '.csv', window.SedoriCalc.toCSV(L_HEAD, rows));
    },
    render: function () {
      var box = $('#ledger'); if (!box) return;
      var rows = ledger.all();
      var body = rows.length ? rows.map(function (r) {
        return '<tr><td><select data-st="' + esc(r.id) + '" aria-label="状態">' + STATUS.map(function (x) { return '<option' + ((r.status || '仕入れ済') === x ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select></td><td>' + esc(r.date) + '</td><td>' + esc(r.kind) + '</td><td class="nm">' + esc(r.name) +
          (r.feature ? '<br><small>' + esc(r.feature) + '</small>' : '') + '</td><td class="n">' + esc(r.qty) + '</td><td class="n">' + yen(r.unit) +
          '</td><td>' + esc(r.party) + '</td><td>' + esc(r.hinmoku || '') + '</td><td class="n">' + (r.profit === '' || r.profit == null ? '' : yen(r.profit)) +
          '</td><td><button type="button" data-del="' + esc(r.id) + '" aria-label="この行を消す">消す</button></td></tr>';
      }).join('') : '<tr><td colspan="10" class="empty">まだありません。計算結果の「台帳に追加」か、下の入力欄から追加できます。</td></tr>';
      box.innerHTML = '<div class="ledger-wrap"><table class="ledger"><thead><tr><th>状態</th><th>日付</th><th>区分</th><th>品名・特徴</th><th>数量</th><th>単価</th><th>相手方</th><th>品目</th><th>見込み利益</th><th></th></tr></thead><tbody>' + body + '</tbody></table></div>';
      $$('[data-del]', box).forEach(function (b) {
        b.addEventListener('click', function () {
          var all = ledger.all(), id = b.getAttribute('data-del');
          ledger.remove(id);
          toast('1件消しました', '元に戻す', function () { ledger.save(all); ledger.render(); });
        });
      });
      $$('[data-st]', box).forEach(function (sel) {
        sel.addEventListener('change', function () {
          var all = ledger.all(); all.forEach(function (r) { if (r.id === sel.getAttribute('data-st')) r.status = sel.value; });
          ledger.save(all);
        });
      });
      var c = $('#ledger-count'); if (c) c.textContent = rows.length + '件';
    },
    mountForm: function () {
      var holder = $('#ledger-form-box');
      if (holder) holder.innerHTML = LEDGER_FORM;
      var f = $('#ledger-form'); if (!f) return;
      var sel = $('#lg-hinmoku', f);
      if (sel) sel.innerHTML = HINMOKU.map(function (h) { return '<option value="' + esc(h) + '">' + (h || '(新品のみ・該当なし)') + '</option>'; }).join('');
      var d = $('#lg-date', f); if (d && !d.value) d.value = today();
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        var row = {};
        ['date', 'kind', 'cond', 'hinmoku', 'name', 'feature', 'qty', 'unit', 'party', 'ref', 'pName', 'pAddr', 'pJob', 'pAge', 'verify', 'sellTo', 'recvId', 'memo'].forEach(function (k) {
          var el = f.querySelector('[name="' + k + '"]'); if (el) row[k] = el.value.trim();
        });
        if (!row.name) { toast('品名を入れてください'); return; }
        row.route = document.body.getAttribute('data-route-label') || '';
        if (ledger.add(row)) { f.reset(); if (d) d.value = today(); }
      });
      var x = $('#ledger-csv'); if (x) x.addEventListener('click', ledger.csv);
    }
  };

  function registerSW() {
    if (!('serviceWorker' in navigator) || location.protocol !== 'https:') return;
    try { navigator.serviceWorker.register(base() + 'sw.js', { scope: base() }).catch(function () {}); } catch (e) { /* 何もしない */ }
  }

  function init() {
    var cur = $('.routes [aria-current="page"]');
    if (cur) cur.parentNode.scrollLeft = Math.max(0, cur.offsetLeft - 16);
    mountTarget(); wireMail(); ledger.mountForm(); ledger.render(); registerSW();
    loadFees().then(showFeeDate).catch(function () {
      $$('[data-feedate]').forEach(function (el) { el.textContent = '手数料データを読み込めませんでした。通信を確認して再読み込みしてください。'; });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.SedoriUI = { store: store, $: $, $$: $$, esc: esc, yen: yen, pct: pct, val: val, today: today, loadFees: loadFees,
    toast: toast, download: download, target: target, targetLabel: targetLabel, STATUS: STATUS, ledger: ledger, HINMOKU: HINMOKU, PREREG: PREREG, NEWS: NEWS };
})();
