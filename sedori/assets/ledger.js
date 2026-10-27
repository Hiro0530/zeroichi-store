/* 古物台帳のページ: 状態のタブ・期間・検索で絞り込み、状態を1クリックで進める(売れたで売却欄を自動記入)、
   行の編集(取引相手の情報の貼り付けつき)、手で追加、CSV・Excel(古物台帳の形) */
(function () {
  'use strict';
  var U = window.SedoriUI;
  var $ = U.$, $$ = U.$$, esc = U.esc, yen = U.yen;
  var L = U.ledger, ST = U.STATUS, C = window.SedoriCalc;
  var tab = U.store.get('lg-tab', 'all'), q = '', openId = null;
  var p = new URLSearchParams(location.search); if (p.get('q')) q = p.get('q');
  if (p.get('tab')) tab = p.get('tab');
  var focusId = p.get('focus') || p.get('stop');
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
    if (tab === 'ending') return U.endingRows(L.all().filter(function (r) { return inPeriod(r) && match(r); })).map(function (x) { return x.r; });
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
    var ending = U.endingRows(all), soon = ending.filter(function (x) { return x.e.state !== 'far'; }).length;
    var list = [['all', 'すべて', all.length]].concat(ST.map(function (s) { return [s, s, cnt(function (r) { return (r.status || '仕入れ済') === s; })]; }),
      [['ending', '終了が近い順', ending.length, soon], ['need', '相手確認が未入力', need]]);
    $('#lg-tabs').innerHTML = list.map(function (t) {
      return '<button type="button" role="tab" data-tab="' + esc(t[0]) + '" aria-selected="' + (t[0] === tab) + '">' + esc(t[1]) + '<span class="n' + ((t[0] === 'need' && t[2]) || t[3] ? ' w' : '') + '">' + (t[3] ? t[3] + '/' : '') + t[2] + '</span></button>';
    }).join('');
    var tb = $('#lg-tabs'), cur = $('#lg-tabs [aria-selected="true"]');
    if (cur && (cur.offsetLeft + cur.offsetWidth > tb.scrollLeft + tb.clientWidth || cur.offsetLeft < tb.scrollLeft)) tb.scrollLeft = Math.max(0, cur.offsetLeft - 16);
    $$('#lg-tabs button').forEach(function (b) { b.addEventListener('click', function () { tab = b.getAttribute('data-tab'); U.store.set('lg-tab', tab); openId = null; render(); }); });
  }

  function summary(list) {
    var buy = 0, sale = 0, prof = 0;
    list.forEach(function (r) {
      var qn = Number(r.qty) || 1; if (!r.wait) buy += (Number(r.unit) || 0) * qn;
      if (r.saleDate) sale += (Number(r.salePrice) || 0) * qn;
      if (r.profit !== '' && r.profit != null) prof += Number(r.profit) * qn;
    });
    $('#lg-sum').innerHTML = '<div><dt>件数</dt><dd>' + list.length + '件</dd></div><div><dt>仕入れ額</dt><dd>' + yen(buy) + '円</dd></div><div><dt>売上(売約・発送済)</dt><dd>' + yen(sale) + '円</dd></div><div><dt>見込み利益</dt><dd>' + yen(prof) + '円</dd></div>';
  }

  /* 上のプランのご案内(控えめに1行ずつ。閉じたら、その月・その年は出さない)
     ライト → 総合: 今月のクラウド保存の残り(月100件)/今月の利益の一行(内訳は総合で)
     総合 → 業務: 期末の棚卸と申告用の書き出しは業務で
     ライト・総合とも: 1〜3月は確定申告の案内(業務へ) */
  function upsell() {
    var box = $('#lg-up'); if (!box) return;
    var SA = window.SedoriAccount, tier = SA && SA.tier ? SA.tier() : 'free';
    if (tier !== 'light' && tier !== 'total') { box.innerHTML = ''; return; }
    var cfg = window.ZW_CONFIG || {}, soon = cfg.ACCOUNTING_READY ? '' : '(11月中に追加)';
    var d = new Date(), ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'), mon = d.getMonth() + 1;
    var hide = U.store.get('up-hide', {});
    var toTotal = '../plans/?plan=total_month&from=ledger', toBiz = '../plans/?plan=business_month&from=ledger';
    var items = [];
    if (tier === 'light') {
      var prof = 0;
      L.all().forEach(function (r) { if (String(r.saleDate || '').slice(0, 7) === ym && r.profit !== '' && r.profit != null) prof += Number(r.profit) * (Number(r.qty) || 1); });
      var cap = SA.lightCap ? SA.lightCap() : null;
      if (cap && cap.left === 0 && cap.blocked.length) items.push(['cap', 'warn', '今月のクラウド保存が' + cap.limit + '件に達しました。' + cap.blocked.length + '件はこの端末にだけ保存しています。総合なら件数の上限はなく、すぐ同期されます。', '総合に変える', toTotal]);
      else if (cap && cap.left <= 10) items.push(['cap', '', '今月のクラウド保存は、あと' + cap.left + '件です(ライトは月' + cap.limit + '件まで)。', '総合を見る', toTotal]);
      if (!hide['m-' + ym]) items.push(['m-' + ym, 'lock', '今月の利益 <b>' + yen(prof) + '円</b>。内訳・グラフ・経費は総合で' + soon + '。', '総合を見る', toTotal]);
    }
    if (tier === 'total' && !hide['b-' + ym]) items.push(['b-' + ym, 'lock', '期末の棚卸と、確定申告用の数字・仕訳帳の書き出しは業務で' + soon + '。', '業務を見る', toBiz]);
    if (mon <= 3 && !hide['tax-' + d.getFullYear()]) items.unshift(['tax-' + d.getFullYear(), '', '確定申告の時期です。申告用の数字(青色申告決算書・収支内訳書の科目)の書き出しは業務で使えます' + soon + '。', '業務を見る', toBiz]);
    box.innerHTML = items.map(function (it) {
      return '<p class="up ' + it[1] + '"><span>' + it[2] + '</span><a href="' + it[4] + '">' + it[3] + '</a>' + (it[0] !== 'cap' ? '<button type="button" class="up-x" data-up-x="' + esc(it[0]) + '" aria-label="閉じる">×</button>' : '') + '</p>';
    }).join('');
    $$('#lg-up [data-up-x]').forEach(function (b) { b.addEventListener('click', function () { var h = U.store.get('up-hide', {}); h[b.getAttribute('data-up-x')] = 1; U.store.set('up-hide', h); upsell(); }); });
  }
  document.addEventListener('sedori:acct', function () { upsell(); });

  function rowHTML(r) {
    var si = Math.max(0, ST.indexOf(r.status || '仕入れ済'));
    var nl = U.nextLabel(r);
    var nx = nl ? '<button type="button" class="adv' + (nl === '売れた' ? ' sold' : '') + '" data-adv="' + esc(r.id) + '">' + nl + '</button>' : '';
    var st = U.checkState(r);
    var qn = Number(r.qty) || 1;
    var e = C.endState(r), endHTML = '', rowCls = openId === r.id ? 'open' : '';
    if (e && e.watch) {
      endHTML = '<span class="endc ' + e.state + '" data-end="' + e.end + '">' + esc(C.fmtLeft(e.left)) + '</span>' +
        (e.state !== 'far' ? '<button type="button" class="adv stop" data-stop="' + esc(r.id) + '">出品停止</button>' : '');
      if (e.state !== 'far') rowCls += ' end-' + e.state;
    } else if (r.yEnd && r.status === '出品停止') endHTML = '<span class="meta">ヤフオク終了 ' + esc(r.yEnd.slice(5).replace('T', ' ').replace('-', '/')) + '</span>';
    if (focusId === r.id) rowCls += ' focus';
    var url = r.ref ? '<a href="' + esc(r.ref) + '" target="_blank" rel="noopener">取引ページ</a>' : '';
    return '<tr data-id="' + esc(r.id) + '"' + (rowCls.trim() ? ' class="' + rowCls.trim() + '"' : '') + '>' +
      '<td data-k="状態"><div class="st"><span class="st1"><span class="stl s' + si + '">' + esc(r.status || '仕入れ済') + '</span>' + endHTML.replace(/<button[\s\S]*$/, '') + '</span><span class="st2">' + (endHTML.match(/<button[\s\S]*$/) || [''])[0] + nx + '</span><span class="meta">' + (r.wait ? '仕入れ前(無在庫)' : esc(U.SHIP_LABEL[r.ship] || '発送代行')) + '</span></div></td>' +
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
    ['date', '仕入日', 'date'], ['cond', '新品/中古', ['新品', '中古']], ['hinmoku', '品目', [''].concat(U.HINMOKU)], ['status', '状態', 'flow'], ['ship', '発送のしかた', 'ship'],
    ['name', '品名', 'text', 'w2'], ['feature', '特徴(型番・色・シリアル)', 'text', 'w2'],
    ['qty', '数量', 'number'], ['unit', '仕入れ値(1個)', 'number'], ['party', '仕入れ先', 'text', 'w2'],
    ['media', 'ゲーム・CD・DVD・書籍・バイク・エアコン室外機・電線・金属製グレーチング等', 'check', 'w2'], ['recvId', '受取先・入庫ID', 'text'], ['memo', 'メモ', 'text'],
    ['sec', '無在庫の見張り(ヤフオク)'], ['yEnd', 'ヤフオク終了日時', 'datetime-local'], ['yEndPaste', '終了日時の文字を貼り付け', 'paste', 'w2'], ['wait', 'まだ仕入れていない(売れてから仕入れる)', 'check'],
    ['sec', '売却'], ['sellTo', '売り先', 'text'], ['sellPrice', '予定売値(1個)', 'number'], ['saleDate', '売却日', 'date'], ['salePrice', '売値(1個)', 'number'], ['saleParty', '売却相手', 'text', 'w2'], ['profit', '見込み利益(1個)', 'number']
  ];
  function editHTML(r) {
    var left = F.map(function (f) {
      if (f[0] === 'sec') return '<div class="sec">' + f[1] + '</div>';
      var v = r[f[0]] == null ? '' : r[f[0]], cls = f[3] ? ' class="' + f[3] + '"' : '';
      if (f[2] === 'flow' || f[2] === 'ship') {
        var opts = f[2] === 'flow' ? U.flowOf(r).concat(['出品停止']).map(function (s) { return [s, s]; }) : [['self', '自分で発送'], ['3pl', '発送代行'], ['fba', 'FBA(Amazonが発送)']];
        return '<label' + cls + '>' + f[1] + '<select data-e="' + f[0] + '">' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (String(v || (f[2] === 'ship' ? '3pl' : '')) === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>';
      }
      if (Array.isArray(f[2])) return '<label' + cls + '>' + f[1] + '<select data-e="' + f[0] + '">' + f[2].map(function (o) { return '<option value="' + esc(o) + '"' + (String(v) === o ? ' selected' : '') + '>' + (o || '選んでください') + '</option>'; }).join('') + '</select></label>';
      if (f[2] === 'paste') return '<label' + cls + '>' + f[1] + '<input data-endpaste type="text" autocomplete="off" placeholder="例: 終了日時 10月29日（水）22時15分"></label>';
      if (f[2] === 'check') return '<label class="ck ' + (f[3] || '') + '" style="flex-direction:row"><input type="checkbox" data-e="' + f[0] + '"' + (v ? ' checked' : '') + '>' + f[1] + '</label>';
      return '<label' + cls + '>' + f[1] + '<input data-e="' + f[0] + '" type="' + f[2] + '" value="' + esc(v) + '"' + (f[2] === 'number' ? ' inputmode="numeric"' : '') + '></label>';
    }).join('');
    return '<div class="edwrap"><div class="edf">' + left +
      '<div class="row-btns"><button type="button" class="btn sm" data-close>閉じる</button><span class="hint">入力するとすぐ保存されます。ヤフオク終了日時を入れて「出品中」にすると、終了が近い順に並び、2時間前から色が付きます。</span></div></div><div id="ed-party"></div></div>';
  }

  function render() {
    var list = rows();
    tabs(); summary(list); upsell();
    var label = tab === 'all' ? 'すべて' : (tab === 'need' ? '相手確認が未入力' : (tab === 'ending' ? '終了が近い順(出品中でヤフオク終了日時がある行)' : tab));
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
        if (k === 'ship') { var r1 = L.get(openId); var fl = U.flowOf(r1); if (fl.indexOf(r1.status) < 0) L.update(openId, { status: fl[1] }); if (!r1.recvId || /^(自宅|Amazon FBA)$/.test(r1.recvId)) L.update(openId, { recvId: v === 'self' ? '自宅' : (v === 'fba' ? 'Amazon FBA' : '') }); }
        if (k === 'status' || k === 'ship') render();
      });
    });
    var ep = $('[data-endpaste]', tr);
    if (ep) {
      var runEnd = function () {
        var v = C.parseEndTime(ep.value); if (!ep.value.trim()) return;
        if (!v) { U.toast('終了日時が読み取れませんでした。日時の欄に直接入れてください'); return; }
        L.update(openId, { yEnd: v }); $('[data-e="yEnd"]', tr).value = v; $('[data-e="yEnd"]', tr).classList.add('got'); ep.value = '';
        U.toast('終了日時を ' + v.replace('T', ' ') + ' にしました'); refreshRow();
      };
      ep.addEventListener('paste', function () { setTimeout(runEnd, 0); });
      ep.addEventListener('change', runEnd);
    }
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
    var sp = e.target.closest('[data-stop]');
    if (sp) { U.stopListing(sp.getAttribute('data-stop')); render(); return; }
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
  /* 通知のオン/オフ(押した時だけ許可を求める) */
  var nb = $('#lg-notify');
  function paintNotify() {
    if (!nb) return;
    var on = U.notifyOn();
    nb.setAttribute('aria-pressed', String(on));
    nb.textContent = on ? '終了60分前の通知: オン' : '終了60分前の通知: オフ';
  }
  if (nb) nb.addEventListener('click', function () { U.enableNotify(!U.notifyOn()).then(paintNotify); });
  document.addEventListener('sedori:notify', paintNotify);

  /* 他の端末・通知からの変更 */
  document.addEventListener('sedori:remote', function () {
    var a = document.activeElement;
    if (openId && a && a.closest && a.closest('#lg-rows tr.ed')) { tabs(); summary(rows()); return; }
    render();
  });
  /* 残り時間を1秒ごとに書き換える(2時間に入った・終了した行は描き直す) */
  setInterval(function () {
    var redraw = false, now = Date.now();
    $$('#lg-rows [data-end]').forEach(function (el) {
      var left = Number(el.getAttribute('data-end')) - now;
      var stt = left <= 0 ? 'ended' : (left <= 36e5 ? 'due' : (left <= 72e5 ? 'soon' : 'far'));
      if (!el.classList.contains(stt)) redraw = true;
      el.textContent = C.fmtLeft(left);
    });
    if (redraw) { var a = document.activeElement; if (!(openId && a && a.closest && a.closest('#lg-rows tr.ed'))) render(); }
  }, 1000);

  // 通知の「出品停止にした」(ページが閉じていた時)
  if (p.get('stop')) { var sid = p.get('stop'), sr = L.get(sid); if (sr && sr.status === '出品中') U.stopListing(sid); history.replaceState(null, '', location.pathname + '?tab=' + tab); }
  render();
  paintNotify();
  if (focusId) { var ft = $('#lg-rows tr[data-id="' + focusId + '"]'); if (ft) ft.scrollIntoView({ block: 'center' }); }
})();
