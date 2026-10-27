/* 古物台帳のページ: 状態のタブ・期間・検索で絞り込み、状態を1クリックで進める(売れたで売却欄を自動記入)、
   行の編集(取引相手の情報の貼り付けつき)、手で追加、CSV・Excel(古物台帳の形) */
(function () {
  'use strict';
  var U = window.SedoriUI;
  var $ = U.$, $$ = U.$$, esc = U.esc, yen = U.yen;
  var L = U.ledger, ST = U.STATUS;
  var tab = U.store.get('lg-tab', 'all'), q = '', openId = null;
  var p = new URLSearchParams(location.search); if (p.get('q')) q = p.get('q');
  if (p.get('tab')) tab = p.get('tab');
  $('#lg-period').value = U.store.get('lg-period', 'all');

  function inPeriod(r) {
    var v = $('#lg-period').value; if (v === 'all') return true;
    var d = new Date(), y = d.getFullYear(), m = d.getMonth();
    var ds = String(r.date || '');
    if (v === 'y0') return ds.slice(0, 4) === String(y);
    if (v === 'm1') { m -= 1; if (m < 0) { m = 11; y--; } }
    return ds.slice(0, 7) === y + '-' + String(m + 1).padStart(2, '0');
  }
  function match(r) {
    if (!q) return true;
    var s = [r.name, r.feature, r.party, r.pName, r.pAddr, r.ref, r.memo, r.sellTo, r.saleParty, r.hinmoku].join(' ').toLowerCase();
    return q.toLowerCase().split(/\s+/).every(function (w) { return s.indexOf(w) >= 0; });
  }
  function rows() {
    return L.all().filter(function (r) {
      if (!inPeriod(r) || !match(r)) return false;
      if (tab === 'all') return true;
      if (tab === 'need') return U.checkState(r) === 'need';
      return (r.status || '仕入れ済') === tab;
    });
  }

  function tabs() {
    var all = L.all().filter(function (r) { return inPeriod(r) && match(r); });
    var cnt = function (f) { return all.filter(f).length; };
    var need = cnt(function (r) { return U.checkState(r) === 'need'; });
    var list = [['all', 'すべて', all.length]].concat(ST.map(function (s) { return [s, s, cnt(function (r) { return (r.status || '仕入れ済') === s; })]; }), [['need', '相手確認が未入力', need]]);
    $('#lg-tabs').innerHTML = list.map(function (t) {
      return '<button type="button" role="tab" data-tab="' + esc(t[0]) + '" aria-selected="' + (t[0] === tab) + '">' + esc(t[1]) + '<span class="n' + (t[0] === 'need' && t[2] ? ' w' : '') + '">' + t[2] + '</span></button>';
    }).join('');
    $$('#lg-tabs button').forEach(function (b) { b.addEventListener('click', function () { tab = b.getAttribute('data-tab'); U.store.set('lg-tab', tab); openId = null; render(); }); });
  }

  function summary(list) {
    var buy = 0, sale = 0, prof = 0;
    list.forEach(function (r) {
      var qn = Number(r.qty) || 1; buy += (Number(r.unit) || 0) * qn;
      if (r.saleDate) sale += (Number(r.salePrice) || 0) * qn;
      if (r.profit !== '' && r.profit != null) prof += Number(r.profit) * qn;
    });
    $('#lg-sum').innerHTML = '<div><dt>件数</dt><dd>' + list.length + '件</dd></div><div><dt>仕入れ額</dt><dd>' + yen(buy) + '円</dd></div><div><dt>売上(売約・発送済)</dt><dd>' + yen(sale) + '円</dd></div><div><dt>見込み利益</dt><dd>' + yen(prof) + '円</dd></div>';
  }

  function rowHTML(r) {
    var si = Math.max(0, ST.indexOf(r.status || '仕入れ済'));
    var nx = si < ST.length - 1 ? '<button type="button" class="adv' + (si === 2 ? ' sold' : '') + '" data-adv="' + esc(r.id) + '">' + (si === 2 ? '売れた' : U.NEXT_LABEL[si] + 'へ') + '</button>' : '';
    var st = U.checkState(r);
    var qn = Number(r.qty) || 1;
    var url = r.ref ? '<a href="' + esc(r.ref) + '" target="_blank" rel="noopener">取引ページ</a>' : '';
    return '<tr data-id="' + esc(r.id) + '"' + (openId === r.id ? ' class="open"' : '') + '>' +
      '<td data-k="状態"><div class="st"><span class="stl s' + si + '">' + esc(r.status || '仕入れ済') + '</span>' + nx + '</div></td>' +
      '<td data-k="仕入日" class="nw">' + esc(r.date || '') + '</td>' +
      '<td class="nmc"><div class="nm">' + esc(r.name || '(名前なし)') + '</div><div class="meta">' + [esc(r.cond || ''), r.hinmoku ? esc(r.hinmoku) : '<span class="warnt">品目未選択</span>', esc(r.feature || ''), url].filter(Boolean).join('<span aria-hidden="true">　</span>') + '</div></td>' +
      '<td class="r" data-k="数量">' + qn + '</td>' +
      '<td class="r" data-k="仕入れ値"><span class="yen">' + yen(r.unit) + '<i>円</i></span>' + (qn > 1 ? '<div class="meta">計 ' + yen((Number(r.unit) || 0) * qn) + '円</div>' : '') + '</td>' +
      '<td data-k="仕入れ先・相手">' + esc(r.party || '') + (r.pName ? '<div class="meta">' + esc(r.pName) + '</div>' : '') + '</td>' +
      '<td data-k="相手確認">' + (st === 'need' ? '<span class="badge" data-edit="' + esc(r.id) + '">相手確認が未入力</span>' : (st === 'ok' ? '<span class="badge ok">済</span><div class="meta">' + esc(r.verify || '') + '</div>' : '<span class="muted">不要</span>')) + '</td>' +
      '<td data-k="売却">' + (r.saleDate ? '<span class="nw">' + esc(r.saleDate) + '</span>' : '<span class="muted">未売却</span>') + '<div class="meta">' + esc(r.saleParty || (r.sellTo ? r.sellTo + 'で販売予定' : '')) + '</div></td>' +
      '<td class="r" data-k="売値">' + (r.salePrice ? '<span class="yen">' + yen(r.salePrice) + '<i>円</i></span>' : (r.sellPrice ? '<span class="muted">予定 ' + yen(r.sellPrice) + '</span>' : '')) + '</td>' +
      '<td class="r" data-k="見込み利益">' + (r.profit === '' || r.profit == null ? '' : '<span class="pf ' + (r.profit < 0 ? 'bad' : '') + '">' + yen(Number(r.profit) * qn) + '</span>') + '</td>' +
      '<td class="ops"><button type="button" data-edit="' + esc(r.id) + '">' + (openId === r.id ? '閉じる' : '編集') + '</button><button type="button" data-del="' + esc(r.id) + '">消す</button></td></tr>' +
      (openId === r.id ? '<tr class="ed"><td colspan="11">' + editHTML(r) + '</td></tr>' : '');
  }

  var F = [
    ['sec', '品物'],
    ['date', '仕入日', 'date'], ['cond', '新品/中古', ['新品', '中古']], ['hinmoku', '品目', [''].concat(U.HINMOKU)], ['status', '状態', ST],
    ['name', '品名', 'text', 'w2'], ['feature', '特徴(型番・色・シリアル)', 'text', 'w2'],
    ['qty', '数量', 'number'], ['unit', '仕入れ値(1個)', 'number'], ['party', '仕入れ先', 'text', 'w2'],
    ['media', 'ゲーム・CD・DVD・書籍・バイク等', 'check', 'w2'], ['recvId', '受取先・入庫ID', 'text'], ['memo', 'メモ', 'text'],
    ['sec', '売却'], ['sellTo', '売り先', 'text'], ['sellPrice', '予定売値(1個)', 'number'], ['saleDate', '売却日', 'date'], ['salePrice', '売値(1個)', 'number'], ['saleParty', '売却相手', 'text', 'w2'], ['profit', '見込み利益(1個)', 'number']
  ];
  function editHTML(r) {
    var left = F.map(function (f) {
      if (f[0] === 'sec') return '<div class="sec">' + f[1] + '</div>';
      var v = r[f[0]] == null ? '' : r[f[0]], cls = f[3] ? ' class="' + f[3] + '"' : '';
      if (Array.isArray(f[2])) return '<label' + cls + '>' + f[1] + '<select data-e="' + f[0] + '">' + f[2].map(function (o) { return '<option value="' + esc(o) + '"' + (String(v) === o ? ' selected' : '') + '>' + (o || '選んでください') + '</option>'; }).join('') + '</select></label>';
      if (f[2] === 'check') return '<label class="ck ' + (f[3] || '') + '" style="flex-direction:row"><input type="checkbox" data-e="' + f[0] + '"' + (v ? ' checked' : '') + '>' + f[1] + '</label>';
      return '<label' + cls + '>' + f[1] + '<input data-e="' + f[0] + '" type="' + f[2] + '" value="' + esc(v) + '"' + (f[2] === 'number' ? ' inputmode="numeric"' : '') + '></label>';
    }).join('');
    return '<div class="edwrap"><div class="edf">' + left +
      '<div class="row-btns"><button type="button" class="btn sm" data-close>閉じる</button><span class="hint">入力するとすぐ保存されます。</span></div></div><div id="ed-party"></div></div>';
  }

  function render() {
    var list = rows();
    tabs(); summary(list);
    var label = tab === 'all' ? 'すべて' : (tab === 'need' ? '相手確認が未入力' : tab);
    $('#lg-title').innerHTML = esc(label) + '<small>' + list.length + '件' + (q ? '　「' + esc(q) + '」で絞り込み <button type="button" class="lnk" id="lg-clear">解除</button>' : '') + '</small>';
    var c = $('#lg-clear'); if (c) c.addEventListener('click', function () { q = ''; $('#sb-q').value = ''; history.replaceState(null, '', location.pathname); render(); });
    var empty = L.all().length ? '条件に合う行がありません。' : 'まだ記録がありません。<br>計算ページで「仕入れた」を押すと、ここに自動で1行できます。手で入れる場合は「手で追加」。';
    $('#lg-rows').innerHTML = list.length ? list.map(rowHTML).join('') : '<tr><td colspan="11" class="empty emp">' + empty + '</td></tr>';
    if (openId) bindEdit();
  }

  function bindEdit() {
    var tr = $('#lg-rows tr.ed'); if (!tr) return;
    $$('[data-e]', tr).forEach(function (el) {
      el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', function () {
        var k = el.getAttribute('data-e'), v = el.type === 'checkbox' ? el.checked : el.value;
        if (el.type === 'number') v = v === '' ? '' : Number(v);
        var patch = {}; patch[k] = v;
        if (k === 'status' && v === '売約') { var r0 = L.get(openId); if (r0 && !r0.saleDate) { patch.saleDate = U.today(); patch.salePrice = r0.salePrice || r0.sellPrice || ''; patch.saleParty = r0.saleParty || (r0.sellTo || '') + ' 購入者'; } }
        L.update(openId, patch);
        refreshRow();
        if (k === 'status') render();
      });
    });
    $('[data-close]', tr).addEventListener('click', function () { openId = null; render(); });
    U.partyPanel($('#ed-party'), openId, { onChange: refreshRow });
  }
  /** 編集中の行の上の段だけ描き直す(入力欄はそのまま) */
  function refreshRow() {
    var r = L.get(openId); if (!r) return;
    var tr = $('#lg-rows tr[data-id="' + openId + '"]'); if (!tr) return;
    var tmp = document.createElement('tbody'); tmp.innerHTML = rowHTML(r).replace(/<tr class="ed">[\s\S]*$/, '');
    tr.replaceWith(tmp.firstChild);
    tabs(); summary(rows());
  }

  $('#lg-rows').addEventListener('click', function (e) {
    var a = e.target.closest('[data-adv]'), ed = e.target.closest('[data-edit]'), del = e.target.closest('[data-del]');
    if (a) {
      var id = a.getAttribute('data-adv'), before = JSON.parse(JSON.stringify(L.get(id)));
      var r = L.advance(id); render();
      U.toast(r.status === '売約' ? '売れた: 売却日・売値・相手を記入しました' : '「' + r.status + '」にしました', '元に戻す', function () { L.update(id, before); render(); });
    } else if (ed) {
      var id2 = ed.getAttribute('data-edit'); openId = openId === id2 ? null : id2; render();
      if (openId) { var t = $('#lg-rows tr.ed'); if (t) t.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    } else if (del) {
      var all = L.all(), id3 = del.getAttribute('data-del');
      L.remove(id3); if (openId === id3) openId = null; render();
      U.toast('1件消しました', '元に戻す', function () { L.save(all); render(); });
    }
  });

  $('#lg-add').addEventListener('click', function () {
    var r = L.add({ cond: '中古', name: '', party: '', status: '仕入れ済' }, true);
    if (!r) return;
    tab = 'all'; q = ''; openId = r.id; render();
    var n = $('#lg-rows tr.ed [data-e="name"]'); if (n) n.focus();
  });
  $('#lg-csv').addEventListener('click', function () { var l = rows(); if (!l.length) { U.toast('書き出す行がありません'); return; } U.exportCSV(l); });
  $('#lg-xlsx').addEventListener('click', function () { var l = rows(); if (!l.length) { U.toast('書き出す行がありません'); return; } U.exportXLSX(l); });
  $('#lg-period').addEventListener('change', function () { U.store.set('lg-period', this.value); render(); });

  U.api.onSearch = function (src, text) { if (src !== 'ledger') return false; q = text; render(); return true; };
  U.api.page = {
    move: function (d) {
      var list = rows(); if (!list.length) return;
      var i = list.findIndex(function (r) { return r.id === openId; });
      i = Math.max(0, Math.min(list.length - 1, (i < 0 ? 0 : i + d))); openId = list[i].id; render();
    }
  };
  render();
})();
