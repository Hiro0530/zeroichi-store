/* せどり 帳簿の画面: 売上の取り込み・経費・月ごとの利益・売れ残り・期末の棚卸・申告用の数字・仕訳帳と書き出し・古物商特例。
   計算は books-core.js(SedoriBooks)。台帳は SedoriUI.ledger をそのまま使い、帳簿の記録(売上・経費・設定)はこの端末に保存する。
   ?demo=1 で見本のデータ(保存しない)。 */
(function () {
  'use strict';
  var U = window.SedoriUI, B = window.SedoriBooks;
  var $ = U.$, $$ = U.$$, esc = U.esc, yen = U.yen;
  var params = new URLSearchParams(location.search);
  var DEMO = params.get('demo') === '1';
  var TODAY = U.today();
  var CUR_Y = Number(TODAY.slice(0, 4));

  /* ==================================================================
     保存(見本の時はメモリだけ)
     ================================================================== */
  var mem = {};
  var K = { sales: 'bk-sales', exp: 'bk-exp', recur: 'bk-recur', set: 'bk-set', batches: 'bk-batches', count: 'bk-count', rules: 'bk-rules', stale: 'bk-stale', tab: 'bk-tab', year: 'bk-year' };
  function get(k, d) { if (DEMO && k !== K.tab) return mem[k] !== undefined ? mem[k] : d; var v = U.store.get(k, d); return v == null ? d : v; }
  function put(k, v) { if (DEMO && k !== K.tab) { mem[k] = v; return true; } var ok = U.store.set(k, v); if (!ok) U.toast('この端末では保存できませんでした(プライベートブラウズ等)'); return ok; }
  function ledger() { return DEMO ? mem.ledger : U.ledger.all(); }
  function saveLedger(rows) { if (DEMO) { mem.ledger = rows; return true; } return U.ledger.save(rows); }
  function sales() { var v = get(K.sales, []); return Array.isArray(v) ? v : []; }
  function expenses() { var v = get(K.exp, []); return Array.isArray(v) ? v : []; }
  function recur() { var v = get(K.recur, []); return Array.isArray(v) ? v : []; }
  function batches() { var v = get(K.batches, []); return Array.isArray(v) ? v : []; }
  function rules() { return get(K.rules, {}) || {}; }
  function data() { return { ledger: ledger(), sales: sales(), expenses: expenses() }; }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  var DEF_SET = { tax: 'exempt', incl: true, form: 'ao', points: 'discount', pointYen: {}, opening: {}, closing: {}, method: 'last', pay: '事業主借', bizDef: {} };
  function settings() { var s = get(K.set, {}) || {}; return Object.assign({}, DEF_SET, s, { pointYen: s.pointYen || {}, opening: s.opening || {}, closing: s.closing || {}, bizDef: s.bizDef || {} }); }
  function saveSettings(patch) { put(K.set, Object.assign(settings(), patch)); }
  function counts(cutoff) { var c = get(K.count, {}) || {}; return c[cutoff] || {}; }
  function saveCounts(cutoff, v) { var c = get(K.count, {}) || {}; c[cutoff] = v; put(K.count, c); }
  function taxSet(y) {
    var s = settings();
    return { tax: s.tax, incl: s.tax === 'exempt' ? true : s.incl !== false, points: s.points, pointYen: Number(s.pointYen[y]) || 0,
      opening: s.opening[y] === '' ? null : s.opening[y], closing: s.closing[y] === '' ? null : s.closing[y], method: s.method, pay: s.pay, counts: counts(y + '-12-31') };
  }
  function bizDef(acct) { var v = settings().bizDef[acct]; return v == null || v === '' ? 100 : Number(v); }

  /* 毎月の経費: 開いた時に、まだ無い月の分を作る */
  function runRecurring() {
    var due = B.dueRecurring(recur(), expenses(), TODAY);
    if (!due.length) return;
    var list = expenses();
    due.forEach(function (e) { e.id = uid(); list.push(e); });
    put(K.exp, list);
  }

  /* ==================================================================
     プラン
     ================================================================== */
  function tier() {
    var SA = window.SedoriAccount, cfg = window.ZW_CONFIG || {};
    var pv = params.get('plan');
    if (!SA || !cfg.FIREBASE_CONFIG) return pv && /^(free|light|total|biz)$/.test(pv) ? pv : 'trial';
    var s = SA.state();
    if (!s.user) return 'trial';
    if (!s.plan || !s.plan.paid) return 'free';
    var k = s.sub && s.sub.planKey, c = (cfg.PLAN_CATALOG || {})[k] || {};
    return B.tierOf(k, (c.name || '') + ' ' + (c.tier || ''));
  }
  function can(f) { var t = tier(); return t === 'trial' || B.allowed(f, t); }
  var TIER_NAME = { trial: 'お試し(この端末だけ)', free: '無料プラン', light: 'ライト', total: '総合', biz: '業務' };

  /* ==================================================================
     共通
     ================================================================== */
  var TABS = [
    ['import', '売上の取り込み'], ['expense', '経費'], ['monthly', '月ごとの利益'], ['stale', '売れ残り'],
    ['stock', '期末の棚卸'], ['tax', '申告用の数字'], ['journal', '仕訳帳・書き出し'], ['kobutsu', '古物商特例']
  ];
  var tab = (location.hash || '').slice(1) || get(K.tab, 'import');
  if (!TABS.some(function (t) { return t[0] === tab; })) tab = 'import';
  var year = Number(get(K.year, 0)) || (TODAY.slice(5, 7) <= '03' ? CUR_Y - 1 : CUR_Y);

  function years() {
    var ys = {}; ys[CUR_Y] = 1; ys[CUR_Y - 1] = 1;
    ledger().forEach(function (r) { var y = Number(String(r.date || '').slice(0, 4)); if (y > 2000) ys[y] = 1; });
    sales().forEach(function (r) { var y = Number(String(r.date || '').slice(0, 4)); if (y > 2000) ys[y] = 1; });
    return Object.keys(ys).map(Number).sort(function (a, b) { return b - a; });
  }
  function money(n, cls) { n = Math.round(Number(n) || 0); return '<span class="nw' + (n < 0 ? ' neg' : '') + (cls ? ' ' + cls : '') + '">' + yen(n) + '</span>'; }
  function pctTxt(x) { return isFinite(x) && x ? (Math.round(x * 1000) / 10).toFixed(1) + '%' : '—'; }
  function ym(s) { return Number(s.slice(5, 7)) + '月'; }
  function md(d) { return d ? d.slice(5).replace('-', '/') : ''; }
  function daichoLink(id, label) { return DEMO ? esc(label || '台帳') : '<a href="../daicho/?focus=' + encodeURIComponent(id) + '">' + esc(label || '台帳') + '</a>'; }
  function seg2(name, opts, cur, disabled) {
    return '<span class="seg2" data-seg="' + name + '">' + opts.map(function (o) { return '<button type="button" data-v="' + esc(o[0]) + '" aria-pressed="' + (String(cur) === String(o[0])) + '"' + (disabled ? ' disabled' : '') + '>' + esc(o[1]) + '</button>'; }).join('') + '</span>';
  }
  function sumHTML(pairs) { return pairs.map(function (p) { return '<div><dt>' + esc(p[0]) + '</dt><dd' + (p[2] ? ' class="' + p[2] + '"' : '') + '>' + p[1] + '</dd></div>'; }).join(''); }

  /* ---------- 見出し ---------- */
  function renderHead() {
    var t = tier(), M = B.monthly(data(), year).total, st = B.stocktake(ledger(), TODAY < year + '-12-31' ? TODAY : year + '-12-31', 'each', {});
    var old = B.stale(ledger(), get(K.stale, {}), TODAY).filter(function (x) { return x.over; }).length;
    $('#bk-year').innerHTML = years().map(function (y) { return '<option value="' + y + '"' + (y === year ? ' selected' : '') + '>' + y + '年</option>'; }).join('');
    var mode = $('#bk-mode');
    mode.textContent = TIER_NAME[t] || t;
    mode.className = 'bk-mode' + (t === 'trial' ? '' : ' paid');
    mode.title = t === 'trial' ? 'ログインする前は、すべての機能をこの端末の中だけで試せます。データはこのブラウザに保存されます(見本の時は保存しません)。' : 'ご契約のプラン';
    $('#bk-sum').innerHTML = sumHTML([
      [year + '年の売上', money(M.sales) + '<small>円</small>'],
      ['利益', money(M.profit) + '<small>円</small>', M.profit < 0 ? 'bad' : ''],
      ['いまの在庫(仕入れ値)', money(st.book) + '<small>円・' + st.total + '件</small>'],
      ['売れ残り', old + '<small>件</small>']
    ]);
  }
  function renderTabs() {
    $('#bk-tabs').innerHTML = TABS.map(function (t) {
      var locked = !can(t[0]);
      return '<button type="button" role="tab" data-tab="' + t[0] + '" aria-selected="' + (t[0] === tab) + '">' + esc(t[1]) + (locked ? '<span class="lk">' + (B.FEATURE_TIER[t[0]] === 'biz' ? '業務' : '総合') + '</span>' : '') + '</button>';
    }).join('');
    var cur = $('#bk-tabs [aria-selected="true"]'), tb = $('#bk-tabs');
    if (cur && (cur.offsetLeft + cur.offsetWidth > tb.scrollLeft + tb.clientWidth || cur.offsetLeft < tb.scrollLeft)) tb.scrollLeft = Math.max(0, cur.offsetLeft - 16);
  }
  function render() {
    renderHead(); renderTabs();
    var pane = $('#bk-pane');
    if (!can(tab)) { pane.innerHTML = lockHTML(tab); return; }
    ({ import: renderImport, expense: renderExpense, monthly: renderMonthly, stale: renderStale, stock: renderStock, tax: renderTax, journal: renderJournal, kobutsu: renderKobutsu })[tab](pane);
  }
  function go(t) { tab = t; put(K.tab, t); history.replaceState(null, '', location.pathname + location.search + '#' + t); render(); window.scrollTo({ top: 0 }); }

  /* ---------- 鍵の付いた機能: 実際の数字のまとめと、プランの案内 ---------- */
  function lockHTML(f) {
    var need = B.FEATURE_TIER[f] === 'biz' ? '業務' : '総合', D = data(), pairs = [], desc = '';
    if (f === 'stock') { var s = B.stocktake(D.ledger, year + '-12-31', settings().method, {}); pairs = [['在庫', s.total + '件'], ['期末商品棚卸高(帳簿)', yen(s.book) + '円']]; desc = '年末の在庫を一覧にして、スマホのカメラでJANを読みながら数を確かめ、期末商品棚卸高を出します。'; }
    else if (f === 'tax') { var T = B.taxReport(D, year, taxSet(year)); pairs = [['売上(収入)金額', yen(T.A.sales + T.A.misc) + '円'], ['売上原価', yen(T.A.cogs) + '円'], ['経費', yen(T.A.expTotal) + '円'], ['所得の目安', yen(T.A.income) + '円']]; desc = '青色申告決算書・収支内訳書の欄ごとに、記録から計算した数字を並べます。どの数字も元の記録まで開けます。'; }
    else if (f === 'journal') { var J = B.journal(D, year, taxSet(year)); pairs = [['仕訳', J.length + '行']]; desc = '台帳・売上・経費から複式の仕訳帳を作り、freee会計・マネーフォワード クラウド確定申告・やよいの青色申告に取り込める形で書き出します。'; }
    else if (f === 'kobutsu') { var k = B.kobutsuCheck(D.ledger, year); pairs = [['記載がそろった仕入れ', k.ok + '件'], ['記載が足りない仕入れ', k.missing + '件']]; desc = '課税事業者の方向け。個人から仕入れた中古品のうち、帳簿の記載がそろっている行と足りない行を分けます。'; }
    else { var M = B.monthly(D, year).total; pairs = [[year + '年の売上', yen(M.sales) + '円'], ['利益', yen(M.profit) + '円']]; desc = '売上の取り込み・経費・月ごとの利益・売れ残りのお知らせは、総合で使えます。'; }
    var name = (TABS.filter(function (t) { return t[0] === f; })[0] || [0, ''])[1];
    return '<div class="lock"><div class="h">' + esc(name) + '<span class="tag ac">' + need + 'プラン</span></div><div class="b"><p>' + esc(desc) + '</p><dl class="sum">' + sumHTML(pairs.map(function (p) { return [p[0], esc(p[1])]; })) + '</dl>' +
      '<a class="btn" href="../plans/">' + need + 'で使えます</a> <span class="muted">いまの記録から計算した数字です。プランを変えると、そのまま続きから使えます。</span></div></div>';
  }

  /* ==================================================================
     1. 売上の取り込み
     ================================================================== */
  var pv = null; // 取り込みの確認中のデータ
  function existingKeys() {
    var k = {};
    sales().forEach(function (s) { if (s.key) k[s.key] = 1; });
    expenses().forEach(function (e) { if (e.key) k[e.key] = 1; });
    return k;
  }
  function renderImport(pane) {
    var hist = batches().slice().reverse().slice(0, 12);
    pane.innerHTML = '<div class="bk-pane bk-2"><div>' +
      '<section class="bk-box"><h2>ファイルから<small>CSV・TSV</small></h2><div class="in">' +
      '<label class="drop" id="im-drop"><input type="file" id="im-file" accept=".csv,.tsv,.txt,text/csv,text/plain"><b>CSVをここへドラッグ</b>またはクリックしてファイルを選ぶ<span class="muted">Amazonのペイメントレポート・カード明細・ほかの売上表</span></label>' +
      '<details class="bk-note"><summary>Amazonのレポートの出し方</summary>セラーセントラルの「レポート」→「ペイメント」→「日付範囲レポート」→「レポートを生成」で「トランザクション(詳細)」と期間を選び、できたCSVをダウンロードして、ここへ入れます。同じ期間を2回入れても、同じ行は二重に取り込みません。</details>' +
      '</div></section>' +
      '<section class="bk-box"><h2>メルカリ<small>文字の貼り付け</small></h2><div class="in">' +
      '<textarea class="paste" id="im-paste" placeholder="取引画面か売上履歴を全部選んでコピーし、ここに貼り付け。何件分まとめてでも読めます"></textarea>' +
      '<div class="row-btns"><button type="button" class="btn sm" id="im-read">読み取る</button><span class="muted">メルカリの個人の売上はCSVで出せないため、画面の文字から商品代金・手数料・送料を読み取ります。</span></div>' +
      '</div></section>' +
      '<section class="bk-box"><h2>取り込みの履歴<small>' + (hist.length ? '新しい順' : '') + '</small></h2>' +
      (hist.length ? '<ul class="hist">' + hist.map(function (b) {
        return '<li><span class="t' + (b.undone ? ' undone' : '') + '">' + esc(b.label) + '</span><button type="button" class="btn sm ghost" data-undo="' + esc(b.id) + '"' + (b.undone ? ' disabled' : '') + '>' + (b.undone ? '取り消し済み' : '取り消す') + '</button>' +
          '<span class="m">' + esc(new Date(b.at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })) + '・' + b.n + '件・' + yen(b.total) + '円</span></li>';
      }).join('') + '</ul>' : '<p class="empty-pv" style="padding:12px">まだありません。</p>') + '</section>' +
      '</div><div id="im-pv" class="bk-box">' + previewHTML() + '</div></div>';
    wireImport();
  }
  function emptyPreview() {
    var n = sales().length;
    return '<div class="empty-pv"><b>取り込むと、ここに全部の行を表示します。</b>確かめてから「取り込む」を押すまで、何も保存されません。<ol>' +
      '<li>Amazonは、注文・返金・手数料・振込みを分けて読み、注文番号・SKU(ASIN・JAN)で台帳の品と結び付けます。</li>' +
      '<li>結び付いた品は、台帳の売却日・売値が自動で入ります。</li>' +
      '<li>取り込んだあとも、履歴の「取り消す」で元に戻せます。</li></ol>' +
      (n ? '<p class="muted">取り込み済みの売上: ' + n + '件</p>' : '') + '</div>';
  }
  function previewHTML() {
    if (!pv) return emptyPreview();
    var L = ledger(), byId = {}; L.forEach(function (r) { byId[r.id] = r; });
    var rows = pv.rows, inc = pv.include, nInc = 0, tot = { gross: 0, fee: 0, ship: 0, net: 0, amount: 0 };
    rows.forEach(function (r, i) { if (!inc[i] || pv.dup[i]) return; nInc++; tot.gross += (r.gross || 0) + (r.disc || 0); tot.fee += r.fee || 0; tot.ship += r.ship || 0; if (r.kind !== 'transfer') tot.net += r.net || 0; tot.amount += r.amount || 0; });
    var isExp = pv.target === 'expense';
    var title = { amazon: 'Amazon ペイメントレポート', mercari: 'メルカリ(貼り付け)', generic: 'CSV(' + (isExp ? '経費' : '売上') + 'として読み取り)' }[pv.kind];
    var cnt = {}; rows.forEach(function (r) { var k = r.typeLabel || (isExp ? r.acct : ''); if (k) cnt[k] = (cnt[k] || 0) + 1; });
    var head = '<div class="pv-head"><span class="t">' + esc(title) + '</span><span class="muted">' + esc(pv.name || '') + (pv.enc ? '・' + pv.enc : '') + '・' + rows.length + '行' +
      (Object.keys(cnt).length && !isExp ? '(' + Object.keys(cnt).map(function (k) { return esc(k) + cnt[k]; }).join('・') + ')' : '') + '</span>' +
      '<dl class="sum">' + (isExp ? sumHTML([['経費の合計', money(tot.amount)]]) : sumHTML([['売上', money(tot.gross)], ['手数料', money(tot.fee)]].concat(pv.kind === 'amazon' ? [] : [['送料', money(tot.ship)]]).concat([['差引の入金', money(tot.net)]]))) + '</dl></div>';
    var map = '';
    if (pv.kind === 'generic') {
      var d = pv.det, opts = function (f) { return '<option value="-1">(使わない)</option>' + d.header.concat(d.headerIdx < 0 ? [] : []).map(function (h, j) { return '<option value="' + j + '"' + (pv.map[f] === j ? ' selected' : '') + '>' + esc(h || '列' + (j + 1)) + '</option>'; }).join('') + (d.headerIdx < 0 ? Array.apply(null, Array(d.width)).map(function (_, j) { return '<option value="' + j + '"' + (pv.map[f] === j ? ' selected' : '') + '>列' + (j + 1) + '</option>'; }).join('') : ''); };
      var fields = isExp ? ['date', 'name', 'amount', 'acct', 'memo'] : ['date', 'name', 'amount', 'fee', 'ship', 'order', 'sku', 'qty'];
      map = '<div class="pv-map"><label>取り込む先' + seg2('target', [['sale', '売上'], ['expense', '経費(カード明細など)']], pv.target) + '</label>' +
        fields.map(function (f) { return '<label>' + esc(B.FIELD_LABEL[f]) + '<select data-map="' + f + '">' + opts(f) + '</select></label>'; }).join('') +
        (!isExp ? '<label>売り先<input id="pv-ch" value="' + esc(pv.ch || '') + '" placeholder="例: ラクマ"></label>' : '') + '</div>';
    }
    var warn = (pv.warn || []).concat((pv.skipped || []).map(function (s) { return { line: s.line, msg: s.reason }; }));
    var wHTML = warn.length ? '<p class="pv-warn">' + warn.slice(0, 4).map(function (w) { return esc((w.line ? w.line + '行目: ' : '') + w.msg); }).join('<br>') + (warn.length > 4 ? '<br>ほか' + (warn.length - 4) + '件' : '') + '</p>' : '';
    var th, body;
    if (isExp) {
      th = '<tr><th><input type="checkbox" id="pv-all" checked aria-label="すべて"></th><th>日付</th><th>支払先・内容</th><th class="r">金額</th><th>科目</th><th class="r">事業の割合</th><th>状態</th></tr>';
      body = rows.map(function (r, i) {
        return '<tr data-i="' + i + '" class="' + (pv.dup[i] ? 'dup' : (inc[i] ? '' : 'off')) + '"><td><input type="checkbox" data-inc="' + i + '"' + (inc[i] && !pv.dup[i] ? ' checked' : '') + (pv.dup[i] ? ' disabled' : '') + '></td>' +
          '<td class="nw">' + esc(r.date) + '</td><td class="nmw" title="' + esc(r.payee) + '">' + esc(r.payee) + '</td><td class="r">' + money(r.amount) + '</td>' +
          '<td><select data-acct="' + i + '">' + B.ACCTS.map(function (a) { return '<option' + (a === r.acct ? ' selected' : '') + '>' + a + '</option>'; }).join('') + '</select></td>' +
          '<td class="r"><input type="number" min="0" max="100" data-biz="' + i + '" value="' + esc(r.biz) + '">%</td>' +
          '<td>' + (pv.dup[i] ? '<span class="tag">取り込み済み</span>' : '<span class="tag ac">新規</span>') + '</td></tr>';
      }).join('');
    } else {
      var shipCol = pv.kind !== 'amazon';
      th = '<tr><th><input type="checkbox" id="pv-all" checked aria-label="すべて"></th><th>日付</th><th>種類</th><th>品名・注文番号</th><th class="r">売上</th><th class="r">手数料</th>' + (shipCol ? '<th class="r">送料</th>' : '') + '<th class="r">入金額</th><th>台帳の品</th></tr>';
      body = rows.map(function (r, i) {
        var canMatch = r.kind === 'order' || r.kind === 'sale', mid = pv.match[i], lr = mid ? byId[mid] : null, cell = '';
        if (canMatch && !pv.dup[i]) {
          var cands = B.candidates(r, L, 25);
          if (lr && cands.indexOf(lr) < 0) cands.unshift(lr);
          cell = '<select data-match="' + i + '"><option value="">(結び付けない)</option>' + cands.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === mid ? ' selected' : '') + '>' + esc(md(c.date) + ' ' + (c.name || '').slice(0, 28) + ' ' + yen(c.unit) + '円') + '</option>'; }).join('') + '</select>' +
            (lr ? '<div class="meta"><span class="tag ' + (pv.by[i] === 'name' ? 'w' : 'ok') + '">' + (pv.by[i] ? { order: '注文番号', sku: 'SKU', asin: 'ASIN', jan: 'JAN', name: '品名が近い・確認を' }[pv.by[i]] + (pv.by[i] === 'name' ? '' : 'で一致') : '手で選択') + '</span></div>' : '');
        } else if (lr) cell = esc(lr.name);
        var dateCell = r.date ? esc(r.date) : '<input type="date" data-date="' + i + '" aria-label="日付">';
        var est = r.est && r.est.length ? '<div class="meta" title="' + esc(r.est.join('・')) + '">推定あり</div>' : '';
        return '<tr data-i="' + i + '" class="' + (pv.dup[i] ? 'dup' : (inc[i] ? '' : 'off')) + '"><td><input type="checkbox" data-inc="' + i + '"' + (inc[i] && !pv.dup[i] ? ' checked' : '') + (pv.dup[i] ? ' disabled' : '') + '></td>' +
          '<td class="nw">' + dateCell + '</td><td class="nw">' + esc(r.typeLabel || '') + '</td>' +
          '<td class="nmw" title="' + esc(r.name) + '">' + esc(r.name || '') + '<div class="meta">' + esc([r.order, r.sku].filter(Boolean).join('・')) + '</div>' + est + '</td>' +
          '<td class="r">' + money((r.gross || 0) + (r.disc || 0)) + (r.disc ? '<div class="meta">値引き ' + yen(r.disc) + '</div>' : '') + '</td><td class="r">' + money(r.fee) + '</td>' + (shipCol ? '<td class="r">' + money(r.ship) + '</td>' : '') + '<td class="r">' + money(r.net) + (r.other ? '<div class="meta">調整 ' + yen(r.other) + '</div>' : '') + '</td>' +
          '<td>' + (pv.dup[i] ? '<span class="tag">取り込み済み</span>' : (canMatch ? cell + (lr ? '' : '<div class="meta"><span class="tag w">台帳に無い</span></div>') : '<span class="muted">—</span>')) + '</td></tr>';
      }).join('');
    }
    var nDup = pv.dup.filter(Boolean).length, nMatch = pv.match.filter(Boolean).length, noDate = rows.filter(function (r, i) { return inc[i] && !pv.dup[i] && !r.date; }).length;
    return head + map + wHTML + '<div class="gridwrap sc" style="border:0;border-bottom:1px solid var(--line)"><table class="grid pv"><thead>' + th + '</thead><tbody>' + (body || '<tr><td colspan="11" class="empty">読み取れる行がありません。列の当てはめを確かめてください。</td></tr>') + '</tbody></table></div>' +
      '<div class="pv-foot"><button type="button" class="btn" id="pv-go"' + (nInc && !noDate ? '' : ' disabled') + '>' + nInc + '件を取り込む</button><button type="button" class="btn ghost" id="pv-cancel">やめる</button>' +
      '<p class="meta">' + (noDate ? '日付が無い行が' + noDate + '件あります。日付を入れてください。' : (isExp ? '科目を直すと、同じ支払先は次から同じ科目になります。' : (nMatch ? '台帳と結び付く' + nMatch + '件は、売却日・売値を台帳へ記入します。' : '')) + (nDup ? ' 取り込み済みの' + nDup + '件は除きます。' : '')) + '</p></div>';
  }
  function setPreview(p) {
    pv = p;
    if (pv) {
      var keys = existingKeys(), taken = {}, L = ledger();
      pv.include = pv.include || pv.rows.map(function () { return true; });
      pv.dup = pv.rows.map(function (r) { return !!keys[r.key]; });
      pv.match = pv.rows.map(function () { return ''; }); pv.by = pv.rows.map(function () { return ''; });
      if (pv.target !== 'expense') {
        pv.rows.forEach(function (r, i) { if (pv.dup[i]) return; var m = B.matchLedger(r, L, taken); if (m) { taken[m.id] = 1; pv.match[i] = m.id; pv.by[i] = m.by; } });
      }
    }
    var box = $('#im-pv'); if (box) { box.innerHTML = previewHTML(); wirePreview(); }
  }
  function regenGeneric() {
    var a = B.applyMapping(pv.det.rows, pv.map, pv.target, { year: year, ch: pv.ch || 'その他', rules: rules(), card: pv.det.card });
    if (pv.target === 'expense') a.rows.forEach(function (e) { e.biz = bizDef(e.acct); });
    var keep = { kind: 'generic', name: pv.name, enc: pv.enc, det: pv.det, map: pv.map, target: pv.target, ch: pv.ch, rows: a.rows, skipped: a.skipped, warn: [] };
    setPreview(keep);
  }
  function readFile(file) {
    var fr = new FileReader();
    fr.onload = function () {
      var d = B.decode(fr.result), kind = B.sniff(d.text);
      if (kind === 'amazon') {
        var r = B.parseAmazon(d.text);
        if (!r.ok) { U.toast('Amazonのレポートの列が足りません(' + r.missing.join('・') + ')'); return; }
        setPreview({ kind: 'amazon', name: file.name, enc: d.enc, rows: r.rows, warn: r.warn, skipped: r.skipped, target: 'sale' });
      } else if (kind === 'mercari') {
        var m = B.parseMercari(d.text, { year: year });
        setPreview({ kind: 'mercari', name: file.name, enc: d.enc, rows: m.rows, warn: m.warn, target: 'sale' });
      } else {
        var det = B.detectColumns(d.text);
        pv = { kind: 'generic', name: file.name, enc: d.enc, det: det, map: Object.assign({}, det.map), target: det.kind, ch: '' };
        regenGeneric();
      }
    };
    fr.readAsArrayBuffer(file);
  }
  function readPaste() {
    var t = $('#im-paste').value; if (!t.trim()) { U.toast('メルカリの画面の文字を貼り付けてください'); return; }
    var kind = B.sniff(t);
    if (kind === 'amazon') { var r = B.parseAmazon(t); setPreview({ kind: 'amazon', name: '貼り付け', rows: r.rows, warn: r.warn, skipped: r.skipped, target: 'sale' }); return; }
    var m = B.parseMercari(t, { year: year });
    if (!m.rows.length) { U.toast('金額が読み取れませんでした。「商品代金」「販売利益」が入るように選んでください'); return; }
    setPreview({ kind: 'mercari', name: '貼り付け', rows: m.rows, warn: m.warn, target: 'sale' });
  }
  function wireImport() {
    var drop = $('#im-drop'), file = $('#im-file');
    file.addEventListener('change', function () { if (file.files[0]) readFile(file.files[0]); file.value = ''; });
    ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('on'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('on'); }); });
    drop.addEventListener('drop', function (e) { var f = e.dataTransfer.files[0]; if (f) readFile(f); });
    $('#im-read').addEventListener('click', readPaste);
    $('#im-paste').addEventListener('paste', function () { setTimeout(readPaste, 0); });
    $$('[data-undo]').forEach(function (b) { b.addEventListener('click', function () { undoBatch(b.getAttribute('data-undo')); }); });
    wirePreview();
  }
  function wirePreview() {
    if (!pv) return;
    var box = $('#im-pv');
    $$('[data-inc]', box).forEach(function (c) { c.addEventListener('change', function () { pv.include[+c.getAttribute('data-inc')] = c.checked; refreshPv(); }); });
    var all = $('#pv-all', box); if (all) all.addEventListener('change', function () { pv.include = pv.rows.map(function () { return all.checked; }); refreshPv(); });
    $$('[data-match]', box).forEach(function (s) { s.addEventListener('change', function () { var i = +s.getAttribute('data-match'); pv.match[i] = s.value; pv.by[i] = ''; refreshPv(); }); });
    $$('[data-date]', box).forEach(function (s) { s.addEventListener('change', function () { var i = +s.getAttribute('data-date'); pv.rows[i].date = s.value; refreshPv(); }); });
    $$('[data-acct]', box).forEach(function (s) { s.addEventListener('change', function () { var i = +s.getAttribute('data-acct'); pv.rows[i].acct = s.value; pv.rows[i].learn = true; pv.rows[i].biz = bizDef(s.value); refreshPv(); }); });
    $$('[data-biz]', box).forEach(function (s) { s.addEventListener('change', function () { pv.rows[+s.getAttribute('data-biz')].biz = Math.max(0, Math.min(100, Number(s.value) || 0)); }); });
    $$('[data-map]', box).forEach(function (s) { s.addEventListener('change', function () { var v = Number(s.value); if (v < 0) delete pv.map[s.getAttribute('data-map')]; else pv.map[s.getAttribute('data-map')] = v; regenGeneric(); }); });
    $$('[data-seg="target"] button', box).forEach(function (b) { b.addEventListener('click', function () { pv.target = b.getAttribute('data-v'); regenGeneric(); }); });
    var ch = $('#pv-ch', box); if (ch) ch.addEventListener('change', function () { pv.ch = ch.value.trim(); regenGeneric(); });
    $('#pv-go', box).addEventListener('click', commit);
    $('#pv-cancel', box).addEventListener('click', function () { setPreview(null); });
  }
  function refreshPv() { var box = $('#im-pv'), y = box.querySelector('.gridwrap') ? box.querySelector('.gridwrap').scrollLeft : 0; box.innerHTML = previewHTML(); var g = box.querySelector('.gridwrap'); if (g) g.scrollLeft = y; wirePreview(); }

  function commit() {
    if (!pv) return;
    var b = { id: uid(), at: Date.now(), src: pv.kind, n: 0, total: 0, saleIds: [], expIds: [], ledgerBefore: {} };
    if (pv.target === 'expense') {
      var list = expenses(), R = rules();
      pv.rows.forEach(function (r, i) {
        if (!pv.include[i] || pv.dup[i]) return;
        var e = Object.assign({}, r, { id: uid() + i, batch: b.id }); delete e.learn;
        list.push(e); b.expIds.push(e.id); b.n++; b.total += r.amount;
        if (r.learn && r.payee) R[B.payeeKey(r.payee)] = r.acct;
      });
      put(K.exp, list); put(K.rules, R);
      b.label = (pv.name || 'CSV') + ' → 経費';
    } else {
      var S = sales(), L = ledger(), byId = {};
      L.forEach(function (r) { byId[r.id] = r; });
      pv.rows.forEach(function (r, i) {
        if (!pv.include[i] || pv.dup[i] || !r.date) return;
        var s = Object.assign({}, r, { id: uid() + i, batch: b.id });
        var lr = pv.match[i] ? byId[pv.match[i]] : null;
        if (lr) {
          s.ledgerId = lr.id;
          b.ledgerBefore[lr.id] = { status: lr.status, saleDate: lr.saleDate || '', salePrice: lr.salePrice || '', saleParty: lr.saleParty || '', saleRef: lr.saleRef || '', saleOrder: lr.saleOrder || '', shipDate: lr.shipDate || '' };
          var q = Number(lr.qty) || 1;
          lr.saleDate = s.date; lr.salePrice = Math.round(((s.gross || 0) + (s.disc || 0)) / q); lr.saleParty = (s.ch || '') + ' 購入者'; lr.saleRef = s.id; if (s.order) lr.saleOrder = s.order;
          var fba = s.src === 'amazon' && /amazon|fba/i.test(s.fulfil || '');
          if (lr.status !== '発送済') { lr.status = fba ? '発送済' : '売約'; if (fba && !lr.shipDate) lr.shipDate = s.date; }
        }
        S.push(s); b.saleIds.push(s.id); b.n++; b.total += (s.gross || 0) + (s.disc || 0);
      });
      put(K.sales, S);
      if (Object.keys(b.ledgerBefore).length) saveLedger(L);
      b.label = (pv.kind === 'amazon' ? 'Amazon ' : pv.kind === 'mercari' ? 'メルカリ ' : '') + (pv.name || '') + ' → 売上';
    }
    if (!b.n) { U.toast('取り込む行がありません'); return; }
    var all = batches(); all.push(b); put(K.batches, all.slice(-60));
    var nm = Object.keys(b.ledgerBefore).length;
    pv = null; render();
    U.toast(b.n + '件を取り込みました' + (nm ? '(台帳の' + nm + '件に売却を記入)' : ''), '元に戻す', function () { undoBatch(b.id); });
  }
  function undoBatch(id) {
    var all = batches(), b = all.filter(function (x) { return x.id === id; })[0]; if (!b || b.undone) return;
    var sid = {}; b.saleIds.forEach(function (x) { sid[x] = 1; });
    put(K.sales, sales().filter(function (s) { return !sid[s.id]; }));
    var eid = {}; b.expIds.forEach(function (x) { eid[x] = 1; });
    put(K.exp, expenses().filter(function (e) { return !eid[e.id]; }));
    var L = ledger(), ch = false;
    L.forEach(function (r) { var bf = b.ledgerBefore[r.id]; if (bf && sid[r.saleRef]) { Object.keys(bf).forEach(function (k) { r[k] = bf[k]; }); ch = true; } });
    if (ch) saveLedger(L);
    b.undone = true; put(K.batches, all);
    render(); U.toast('取り込みを取り消しました(' + b.n + '件)');
  }

  /* ==================================================================
     2. 経費
     ================================================================== */
  var exFilter = { m: '', acct: '' }, lastQE = null, exMore = 0;
  function renderExpense(pane) {
    var y = String(year), list = expenses().filter(function (e) { return String(e.date).slice(0, 4) === y; }).sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    var shown = list.filter(function (e) { return (!exFilter.m || String(e.date).slice(5, 7) === exFilter.m) && (!exFilter.acct || e.acct === exFilter.acct); });
    var by = {}; list.forEach(function (e) { by[e.acct] = (by[e.acct] || 0) + B.bizAmount(e); });
    var tot = list.reduce(function (s, e) { return s + B.bizAmount(e); }, 0);
    var q = lastQE || { date: TODAY.slice(0, 4) === y ? TODAY : y + '-12-31', acct: '荷造運賃' };
    var R = recur();
    pane.innerHTML = '<div class="bk-pane">' +
      '<form class="qe" id="qe" autocomplete="off"><label>日付<input type="date" id="qe-date" value="' + esc(q.date) + '" required></label>' +
      '<label>科目<select id="qe-acct">' + B.ACCTS.map(function (a) { return '<option' + (a === q.acct ? ' selected' : '') + '>' + a + '</option>'; }).join('') + '</select></label>' +
      '<label>金額(税込)<input type="number" id="qe-amt" inputmode="numeric" min="1" required placeholder="0"></label>' +
      '<label class="qe-memo">支払先・メモ<input id="qe-memo" placeholder="例: ヤマト運輸 宅急便コンパクト"></label>' +
      '<label>事業の割合<input type="number" id="qe-biz" inputmode="numeric" min="0" max="100" value="' + bizDef(q.acct) + '"></label>' +
      '<button class="btn" type="submit">追加<kbd style="margin-left:4px">Enter</kbd></button><p class="qe-hint" id="qe-hint">' + esc(B.ACCT_HINT[q.acct] || '') + '</p></form>' +
      '<div class="bk-2r" style="margin-top:12px"><div>' +
      '<div class="tbar"><p class="tbar-t">' + y + '年の経費<small>' + shown.length + '件' + (shown.length !== list.length ? '(全' + list.length + '件)' : '') + '</small></p><span class="tbar-r">' +
      '<label class="inl">月 <select id="ex-m"><option value="">すべて</option>' + Array.apply(null, Array(12)).map(function (_, i) { var m = String(i + 1).padStart(2, '0'); return '<option value="' + m + '"' + (exFilter.m === m ? ' selected' : '') + '>' + (i + 1) + '月</option>'; }).join('') + '</select></label>' +
      '<label class="inl">科目 <select id="ex-a"><option value="">すべて</option>' + B.ACCTS.map(function (a) { return '<option' + (exFilter.acct === a ? ' selected' : '') + '>' + a + '</option>'; }).join('') + '</select></label>' +
      '<button type="button" class="btn sm ghost" id="ex-csv">カード明細を取り込む</button></span></div>' +
      '<div class="gridwrap"><table class="grid cards"><thead><tr><th>日付</th><th>科目</th><th>支払先・メモ</th><th class="r">金額</th><th class="r">事業の割合</th><th class="r">経費になる額</th><th></th></tr></thead><tbody>' +
      (shown.length ? shown.slice(0, (U.narrow() ? 20 : 100) + exMore).map(function (e) {
        return '<tr data-id="' + esc(e.id) + '"><td data-k="日付" class="nw">' + esc(e.date) + '</td>' +
          '<td data-k="科目"><select class="inl" data-ea="' + esc(e.id) + '">' + B.ACCTS.map(function (a) { return '<option' + (a === e.acct ? ' selected' : '') + '>' + a + '</option>'; }).join('') + '</select></td>' +
          '<td class="wide nmw" title="' + esc((e.payee || '') + ' ' + (e.memo || '')) + '">' + (e.recurId ? '<span class="tag">毎月</span> ' : '') + esc(e.payee || '') + (e.memo ? '<span class="muted"> ' + esc(e.memo) + '</span>' : '') + '</td>' +
          '<td data-k="金額" class="r">' + money(e.amount) + '</td><td data-k="事業の割合" class="r"><input class="inl" type="number" min="0" max="100" data-eb="' + esc(e.id) + '" value="' + esc(e.biz == null ? 100 : e.biz) + '">%</td>' +
          '<td data-k="経費になる額" class="r"><b>' + money(B.bizAmount(e)) + '</b></td><td class="ops r"><button type="button" class="btn sm ghost" data-ed="' + esc(e.id) + '">消す</button></td></tr>';
      }).join('') : '<tr><td colspan="7" class="empty emp">' + (list.length ? '条件に合う経費がありません。' : 'まだありません。上の欄に金額を入れて Enter で追加できます。カード明細のCSVもまとめて取り込めます。') + '</td></tr>') +
      '</tbody></table></div>' + (shown.length > (U.narrow() ? 20 : 100) + exMore ? '<div class="row-btns"><button type="button" class="btn sm ghost" id="ex-more">さらに表示(残り' + (shown.length - (U.narrow() ? 20 : 100) - exMore) + '件)</button></div>' : '') + '</div><div>' +
      '<section class="bk-box"><h2>科目ごとの合計<small>' + y + '年・事業の分</small></h2><table class="mini">' +
      B.ACCTS.filter(function (a) { return by[a]; }).map(function (a) { return '<tr><th>' + a + '</th><td class="r">' + money(by[a]) + '円</td></tr>'; }).join('') +
      '<tr class="tot"><td>計</td><td class="r">' + money(tot) + '円</td></tr></table></section>' +
      '<section class="bk-box"><h2>毎月の経費<small>月の決まった日に自動で追加</small></h2>' +
      (R.length ? '<table class="mini">' + R.map(function (r) { return '<tr><td>' + esc(r.payee || r.acct) + '<div class="meta">毎月' + r.day + '日・' + esc(r.acct) + (Number(r.biz) < 100 ? '・事業' + r.biz + '%' : '') + '</div></td><td class="r">' + money(r.amount) + '円<br><button type="button" class="lnk" data-rdel="' + esc(r.id) + '">やめる</button></td></tr>'; }).join('') + '</table>' : '<p class="bk-note" style="padding:0 12px">スマホ代・ツールの月額・倉庫代などを入れておくと、毎月の入力が要りません。</p>') +
      '<form class="rec-f" id="rec-f"><input type="number" id="rc-day" min="1" max="28" value="27" aria-label="毎月の日" title="毎月の日(1〜28)"><select id="rc-acct">' + B.ACCTS.map(function (a) { return '<option' + (a === '通信費' ? ' selected' : '') + '>' + a + '</option>'; }).join('') + '</select><input type="number" id="rc-amt" placeholder="金額" min="1" inputmode="numeric">' +
      '<input class="w3" id="rc-payee" placeholder="支払先(例: ドコモ スマホ代)"><label class="w3 muted" style="display:flex;gap:6px;align-items:center">事業の割合<input type="number" id="rc-biz" min="0" max="100" value="' + bizDef('通信費') + '" style="width:64px">% ・ ' + TODAY.slice(0, 7).replace('-', '年') + '月から</label><button class="btn sm" type="submit">毎月の経費を追加</button></form></section>' +
      '<section class="bk-box"><h2>事業の割合の初期値<small>家事按分</small></h2><div class="in"><div class="bizdef">' +
      ['通信費', '地代家賃', '水道光熱費', '旅費交通費'].map(function (a) { return '<span>' + a + '</span><input type="number" min="0" max="100" data-bd="' + a + '" value="' + bizDef(a) + '" aria-label="' + a + 'の事業の割合">'; }).join('') +
      '</div><p class="bk-note">自宅で使うスマホ・家賃・電気などは、事業に使った割合だけが経費です。割合は使った時間や面積など、説明できる根拠で決めてください。</p></div></section>' +
      '</div></div></div>';
    wireExpense();
  }
  function wireExpense() {
    var f = $('#qe'), acct = $('#qe-acct');
    acct.addEventListener('change', function () { $('#qe-biz').value = bizDef(acct.value); $('#qe-hint').textContent = B.ACCT_HINT[acct.value] || ''; });
    $('#qe-memo').addEventListener('input', function () {
      var g = B.guessAcct(this.value, rules());
      if (this.value.length >= 2 && g !== '雑費' && !acct._touched) { acct.value = g; $('#qe-biz').value = bizDef(g); $('#qe-hint').textContent = (B.ACCT_HINT[g] || '') + '(支払先から選びました)'; }
    });
    acct.addEventListener('mousedown', function () { acct._touched = true; });
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var amt = Math.round(Number($('#qe-amt').value) || 0); if (!amt) { $('#qe-amt').focus(); return; }
      var x = { id: uid(), date: $('#qe-date').value || TODAY, acct: acct.value, amount: amt, payee: $('#qe-memo').value.trim(), memo: '', biz: Math.max(0, Math.min(100, Number($('#qe-biz').value))), src: 'manual' };
      if (x.payee && acct._touched) { var R = rules(); R[B.payeeKey(x.payee)] = x.acct; put(K.rules, R); }
      var list = expenses(); list.push(x); put(K.exp, list);
      lastQE = { date: x.date, acct: x.acct };
      if (String(x.date).slice(0, 4) !== String(year)) { year = Number(String(x.date).slice(0, 4)); put(K.year, year); }
      render(); $('#qe-amt').focus();
      U.toast(x.acct + ' ' + yen(x.amount) + '円を追加しました', '元に戻す', function () { put(K.exp, expenses().filter(function (e) { return e.id !== x.id; })); render(); });
    });
    var exm = $('#ex-more'); if (exm) exm.addEventListener('click', function () { exMore += 200; render(); });
    $('#ex-m').addEventListener('change', function () { exFilter.m = this.value; exMore = 0; render(); });
    $('#ex-a').addEventListener('change', function () { exFilter.acct = this.value; render(); });
    $('#ex-csv').addEventListener('click', function () { go('import'); setTimeout(function () { var d = $('#im-drop'); if (d) d.click(); }, 50); });
    $$('[data-ea]').forEach(function (s) { s.addEventListener('change', function () { patchExp(s.getAttribute('data-ea'), { acct: s.value }, true); }); });
    $$('[data-eb]').forEach(function (s) { s.addEventListener('change', function () { patchExp(s.getAttribute('data-eb'), { biz: Math.max(0, Math.min(100, Number(s.value) || 0)) }); }); });
    $$('[data-ed]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-ed'), before = expenses();
        put(K.exp, before.filter(function (e) { return e.id !== id; })); render();
        U.toast('1件消しました', '元に戻す', function () { put(K.exp, before); render(); });
      });
    });
    $$('[data-bd]').forEach(function (i) { i.addEventListener('change', function () { var s = settings(); s.bizDef[i.getAttribute('data-bd')] = Math.max(0, Math.min(100, Number(i.value) || 0)); put(K.set, s); U.toast('次から入れる' + i.getAttribute('data-bd') + 'は ' + s.bizDef[i.getAttribute('data-bd')] + '% から始まります'); }); });
    $('#rc-acct').addEventListener('change', function () { $('#rc-biz').value = bizDef(this.value); });
    $('#rec-f').addEventListener('submit', function (e) {
      e.preventDefault();
      var amt = Math.round(Number($('#rc-amt').value) || 0); if (!amt) { $('#rc-amt').focus(); return; }
      var r = { id: uid(), day: Math.min(28, Math.max(1, Number($('#rc-day').value) || 1)), acct: $('#rc-acct').value, amount: amt, payee: $('#rc-payee').value.trim(), biz: Number($('#rc-biz').value), start: TODAY.slice(0, 7) };
      var R = recur(); R.push(r); put(K.recur, R); runRecurring(); render();
      U.toast('毎月' + r.day + '日に ' + r.acct + ' ' + yen(amt) + '円を追加します');
    });
    $$('[data-rdel]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-rdel'), R = recur(), r = R.filter(function (x) { return x.id === id; })[0]; if (!r) return;
        var prev = TODAY.slice(0, 7); r.end = prev; put(K.recur, R.filter(function (x) { return x.id !== id; }));
        render(); U.toast('毎月の経費をやめました(今までの分はそのまま残ります)');
      });
    });
  }
  function patchExp(id, patch, learn) {
    var list = expenses();
    list.forEach(function (e) { if (e.id === id) { Object.assign(e, patch); if (learn && e.payee) { var R = rules(); R[B.payeeKey(e.payee)] = e.acct; put(K.rules, R); } } });
    put(K.exp, list); render();
  }

  /* ==================================================================
     3. 月ごとの利益
     ================================================================== */
  var moView = 'month', moOpen = null;
  function renderMonthly(pane) {
    var D = data(), M = B.monthly(D, year);
    var views = [['month', '月ごと'], ['route', 'ルート別'], ['party', '仕入れ先別'], ['ch', '売り先別']];
    var html = '<div class="bk-pane"><div class="tbar" style="padding-top:0"><p class="tbar-t">' + year + '年の利益<small>売上 − 売上原価 − 手数料 − 送料 − 経費(事業の分)</small></p><span class="tbar-r">' + seg2('mo', views, moView) + '</span></div>';
    if (moView === 'month') {
      html += chartHTML(M.months);
      html += '<div class="gridwrap sc"><table class="grid mo"><thead><tr><th>月</th><th class="r">売上</th><th class="r mh">売上原価</th><th class="r mh">手数料</th><th class="r mh">送料</th><th class="r mh">調整</th><th class="r mh">経費</th><th class="r">利益</th><th class="r">利益率</th><th class="r mh">件数</th></tr></thead><tbody>' +
        M.months.map(function (m) {
          var zero = !m.n && !m.exp;
          return '<tr class="mrow' + (moOpen === m.ym ? ' open' : '') + (zero ? ' zero' : '') + '" data-ym="' + m.ym + '"><td>' + ym(m.ym) + (m.est ? '<span class="est" title="台帳の「売れた」から数えた売上を含みます(手数料は見込み利益から推定)">※</span>' : '') + '</td>' +
            '<td class="r">' + money(m.sales) + '</td><td class="r mh">' + money(m.cogs) + '</td><td class="r mh">' + money(m.fee) + '</td><td class="r mh">' + money(m.ship) + '</td><td class="r mh">' + money(m.other) + '</td><td class="r mh">' + money(m.exp) + '</td>' +
            '<td class="r pf">' + money(m.profit) + '</td><td class="r">' + pctTxt(m.rate) + '</td><td class="r mh">' + m.n + '</td></tr>' +
            (moOpen === m.ym ? '<tr class="drill"><td colspan="10">' + drillMonth(D, m.ym) + '</td></tr>' : '');
        }).join('') + '</tbody><tfoot><tr><td>計</td><td class="r">' + money(M.total.sales) + '</td><td class="r mh">' + money(M.total.cogs) + '</td><td class="r mh">' + money(M.total.fee) + '</td><td class="r mh">' + money(M.total.ship) + '</td><td class="r mh">' + money(M.total.other) + '</td><td class="r mh">' + money(M.total.exp) + '</td><td class="r">' + money(M.total.profit) + '</td><td class="r">' + pctTxt(M.total.rate) + '</td><td class="r mh">' + M.total.n + '</td></tr></tfoot></table></div>';
      html += '<p class="bk-note">月の行を押すと、その月の内訳と元の記録が開きます。' + (M.total.est ? '※は台帳の「売れた」から数えた売上を含む月です(手数料は見込み利益から推定。Amazonのレポートやメルカリの取引画面を取り込むと実際の金額になります)。' : '') + '売上原価は「その月に売れた品の仕入れ値」です(確定申告の売上原価は、期首+仕入−期末で計算します)。' + (M.total.nocost ? ' 台帳と結び付いていない売上が' + M.total.nocost + '件あり、その分の原価は入っていません(<button type="button" class="lnk" data-go="import">取り込み</button>で結び付けられます)。' : '') + '</p>';
    } else {
      var key = moView, G = B.groupBy(D, year, key);
      html += '<div class="gridwrap sc"><table class="grid mo"><thead><tr><th>' + { route: 'ルート', party: '仕入れ先', ch: '売り先' }[key] + '</th><th class="r">売上</th><th class="r">売上原価</th><th class="r">手数料</th><th class="r">送料</th><th class="r">粗利</th><th class="r">粗利率</th><th class="r">件数</th></tr></thead><tbody>' +
        (G.length ? G.map(function (g) { return '<tr><td>' + esc(g.key) + '</td><td class="r">' + money(g.sales) + '</td><td class="r">' + money(g.cogs) + '</td><td class="r">' + money(g.fee) + '</td><td class="r">' + money(g.ship) + '</td><td class="r pf">' + money(g.gross) + '</td><td class="r">' + pctTxt(g.grate) + '</td><td class="r">' + g.n + '</td></tr>'; }).join('') : '<tr><td colspan="8" class="empty">この年の売上がありません。</td></tr>') +
        '</tbody></table></div><p class="bk-note">経費はルートや仕入れ先に分けられないため、粗利(売上 − 売上原価 − 手数料 − 送料)で比べます。</p>';
    }
    pane.innerHTML = html + '</div>';
    $$('[data-seg="mo"] button', pane).forEach(function (b) { b.addEventListener('click', function () { moView = b.getAttribute('data-v'); render(); }); });
    $$('tr.mrow', pane).forEach(function (tr) { tr.addEventListener('click', function () { var k = tr.getAttribute('data-ym'); moOpen = moOpen === k ? null : k; render(); }); });
    $$('[data-go]', pane).forEach(function (b) { b.addEventListener('click', function () { go(b.getAttribute('data-go')); }); });
    wireChart(pane, M.months);
  }
  function drillMonth(D, ymk) {
    var ev = B.events(D).filter(function (e) { return String(e.date).slice(0, 7) === ymk; });
    var ex = (D.expenses || []).filter(function (e) { return String(e.date).slice(0, 7) === ymk; });
    var h = '';
    if (ev.length) h += '<p class="drill-t">売上・手数料(' + ev.length + '件)</p><table class="grid sub"><thead><tr><th>日付</th><th>元</th><th>品名</th><th>売り先</th><th class="r">売上</th><th class="r">原価</th><th class="r">手数料</th><th class="r">送料</th><th class="r">調整</th><th class="r">粗利</th></tr></thead><tbody>' +
      ev.map(function (e) { var g = e.sales + e.other - e.cogs - e.fee - e.ship; return '<tr><td class="nw">' + md(e.date) + '</td><td class="nw">' + (e.src === 'import' ? '<span class="tag ac">取り込み</span>' : '<span class="tag" title="台帳の売値と見込み利益から">台帳</span>') + '</td><td class="nmw">' + (e.ledgerId ? daichoLink(e.ledgerId, e.name || '(名前なし)') : esc(e.name)) + (e.nocost ? ' <span class="tag w">原価なし</span>' : '') + '</td><td class="nw">' + esc(e.ch) + '</td><td class="r">' + money(e.sales) + '</td><td class="r">' + money(e.cogs) + '</td><td class="r">' + money(e.fee) + (e.est ? '<span class="est">見込み</span>' : '') + '</td><td class="r">' + money(e.ship) + '</td><td class="r">' + money(e.other) + '</td><td class="r"><b>' + money(g) + '</b></td></tr>'; }).join('') + '</tbody></table>';
    if (ex.length) h += '<p class="drill-t">経費(' + ex.length + '件)</p><table class="grid sub"><thead><tr><th>日付</th><th>科目</th><th>支払先・メモ</th><th class="r">金額</th><th class="r">事業の分</th></tr></thead><tbody>' +
      ex.map(function (e) { return '<tr><td class="nw">' + md(e.date) + '</td><td>' + esc(e.acct) + '</td><td class="nmw">' + esc((e.payee || '') + ' ' + (e.memo || '')) + '</td><td class="r">' + money(e.amount) + '</td><td class="r">' + money(B.bizAmount(e)) + '</td></tr>'; }).join('') + '</tbody></table>';
    return h || '<p class="muted">この月の記録はありません。</p>';
  }
  /* 利益の棒グラフ(1系列。赤字の月は赤) */
  function chartHTML(months) {
    var nw = U.narrow(), W = nw ? 420 : 960, H = nw ? 190 : 170, pl = nw ? 34 : 44, pr = 8, pt = 10, pb = 22, iw = W - pl - pr, ih = H - pt - pb;
    var vals = months.map(function (m) { return m.profit; });
    var max = Math.max(0, Math.max.apply(null, vals)), min = Math.min(0, Math.min.apply(null, vals));
    if (max === min) max = min + 10000;
    var step = niceStep((max - min) / 3), top = Math.ceil(max / step) * step, bot = Math.floor(min / step) * step;
    var y = function (v) { return pt + (top - v) / (top - bot) * ih; };
    var bw = iw / 12, w = Math.min(36, bw * 0.56);
    var g = '';
    for (var v = bot; v <= top + 1; v += step) g += '<line class="' + (v === 0 ? 'zl' : 'gl') + '" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/><text class="ax" x="' + (pl - 6) + '" y="' + (y(v) + 3.5).toFixed(1) + '" text-anchor="end">' + axisYen(v) + '</text>';
    months.forEach(function (m, i) {
      var x = pl + bw * i + (bw - w) / 2, v = m.profit, y0 = y(0), y1 = y(v), hgt = Math.abs(y1 - y0);
      var r = Math.min(4, hgt / 2), up = v >= 0;
      var d = hgt < 0.5 ? '' : (up ? 'M' + x + ',' + y0 + 'V' + (y1 + r) + 'Q' + x + ',' + y1 + ' ' + (x + r) + ',' + y1 + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + y1 + ' ' + (x + w) + ',' + (y1 + r) + 'V' + y0 + 'Z'
        : 'M' + x + ',' + y0 + 'V' + (y1 - r) + 'Q' + x + ',' + y1 + ' ' + (x + r) + ',' + y1 + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + y1 + ' ' + (x + w) + ',' + (y1 - r) + 'V' + y0 + 'Z');
      g += '<rect class="hit" data-ci="' + i + '" x="' + (pl + bw * i) + '" y="' + pt + '" width="' + bw + '" height="' + ih + '"/>' + (d ? '<path class="bar' + (v < 0 ? ' neg' : '') + (m.ym > TODAY.slice(0, 7) ? ' dim' : '') + '" d="' + d + '"/>' : '') +
        '<text class="ax" x="' + (pl + bw * i + bw / 2) + '" y="' + (H - 6) + '" text-anchor="middle">' + (i + 1) + (nw ? '' : '月') + '</text>';
    });
    return '<div class="chart" id="mo-chart"><p class="ttl">月ごとの利益<span>単位: 円</span></p><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + year + '年の月ごとの利益">' + g + '</svg><div class="tip" id="mo-tip"></div></div>';
  }
  function niceStep(x) { if (!(x > 0)) return 10000; var p = Math.pow(10, Math.floor(Math.log10(x))), f = x / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }
  function axisYen(v) { if (v === 0) return '0'; return Math.abs(v) >= 10000 ? (v / 10000).toLocaleString('ja-JP') + '万' : yen(v); }
  function wireChart(pane, months) {
    var box = $('#mo-chart', pane), tip = $('#mo-tip', pane); if (!box) return;
    $$('.hit', box).forEach(function (h) {
      h.addEventListener('mousemove', function (e) {
        var m = months[+h.getAttribute('data-ci')], rc = box.getBoundingClientRect();
        tip.innerHTML = '<b>' + ym(m.ym) + '</b>　利益 <b>' + yen(m.profit) + '円</b><br>売上 ' + yen(m.sales) + '円・経費 ' + yen(m.exp) + '円・' + m.n + '件';
        tip.style.display = 'block';
        var x = e.clientX - rc.left + 12; if (x + tip.offsetWidth > rc.width) x = e.clientX - rc.left - tip.offsetWidth - 12;
        tip.style.left = x + 'px'; tip.style.top = (e.clientY - rc.top - 10) + 'px';
      });
      h.addEventListener('mouseleave', function () { tip.style.display = 'none'; });
      h.addEventListener('click', function () { moOpen = months[+h.getAttribute('data-ci')].ym; render(); var tr = $('tr.mrow.open'); if (tr) tr.scrollIntoView({ block: 'center', behavior: 'smooth' }); });
    });
  }

  /* ==================================================================
     4. 売れ残り
     ================================================================== */
  var stOnly = true;
  function renderStale(pane) {
    var cfg = Object.assign({ days: 60, cats: {}, items: {} }, get(K.stale, {}));
    var all = B.stale(ledger(), cfg, TODAY), list = stOnly ? all.filter(function (x) { return x.over; }) : all;
    var over = all.filter(function (x) { return x.over; }), sleep = over.reduce(function (s, x) { return s + x.cost; }, 0);
    var cats = {}; all.forEach(function (x) { if (x.r.hinmoku) cats[x.r.hinmoku] = 1; });
    pane.innerHTML = '<div class="bk-pane"><div class="tbar" style="padding-top:0"><p class="tbar-t">売れ残り<small>仕入れてから目安の日数を過ぎても売れていない品</small></p>' +
      '<span class="tbar-r"><label class="inl">目安 <input type="number" id="st-days" min="1" value="' + esc(cfg.days) + '" style="width:64px;height:28px;text-align:right"> 日</label>' + seg2('st', [['1', '目安を過ぎた品'], ['0', 'すべての在庫']], stOnly ? '1' : '0') + '</span></div>' +
      '<dl class="sum" style="margin-bottom:12px">' + sumHTML([['目安を過ぎた品', over.length + '件'], ['眠っている仕入れ額', money(sleep) + '円'], ['在庫ぜんぶ', all.length + '件']]) + '</dl>' +
      (Object.keys(cats).length ? '<details class="bk-note" style="margin:0 0 8px"><summary>品目ごとに目安の日数を変える</summary><div class="catlim">' + Object.keys(cats).map(function (c) { return '<label>' + esc(c) + '<input type="number" min="1" data-cat="' + esc(c) + '" value="' + esc(cfg.cats[c] || '') + '" placeholder="' + cfg.days + '"></label>'; }).join('') + '</div></details>' : '') +
      '<div class="gridwrap"><table class="grid cards"><thead><tr><th class="r">経過</th><th>仕入日</th><th>品名</th><th class="r">仕入れ値(1個)</th><th class="r">予定売値</th><th class="r">損益ゼロの売値</th><th class="r">値下げ候補</th><th class="r">この品の目安</th><th></th></tr></thead><tbody>' +
      (list.length ? list.map(function (x) {
        var r = x.r;
        return '<tr><td data-k="経過" class="r"><span class="days' + (x.over ? ' over' : '') + '">' + x.days + '日</span></td><td data-k="仕入日" class="nw">' + esc(r.date) + '</td>' +
          '<td class="wide nmw" title="' + esc(r.name) + '">' + esc(r.name || '(名前なし)') + '<div class="meta">' + esc([r.hinmoku, r.sellTo ? r.sellTo + 'で販売予定' : '', r.status].filter(Boolean).join('・')) + '</div></td>' +
          '<td data-k="仕入れ値(1個)" class="r">' + money(r.unit) + ((Number(r.qty) || 1) > 1 ? '<div class="meta">' + r.qty + '個 計' + yen(x.cost) + '</div>' : '') + '</td><td data-k="予定売値" class="r">' + (x.plan ? money(x.plan) : '<span class="muted">—</span>') + '</td>' +
          '<td data-k="損益ゼロの売値" class="r">' + money(x.be) + '</td><td data-k="値下げ候補" class="r"><b>' + money(x.suggest) + '</b>' + (x.plan && x.suggest < x.plan ? '<div class="meta">−' + yen(x.plan - x.suggest) + '円</div>' : '') + '</td>' +
          '<td data-k="この品の目安" class="r"><input class="lim" type="number" min="1" data-lim="' + esc(r.id) + '" value="' + esc(cfg.items[r.id] || '') + '" placeholder="' + x.limit + '">日</td>' +
          '<td class="ops">' + daichoLink(r.id, '台帳で開く') + '</td></tr>';
      }).join('') : '<tr><td colspan="9" class="empty">' + (all.length ? '目安の日数を過ぎた品はありません。' : '売れていない在庫がありません。') + '</td></tr>') + '</tbody></table></div>' +
      '<p class="bk-note">損益ゼロの売値は、仕入れ値と、見込み利益を計算した時の手数料・送料から逆算した目安です(Amazonは販売手数料11%前後で計算)。値下げ候補は、予定売値の1割引きか損益ゼロの売値の高い方です。売れ残りは、早めに値下げして次の仕入れのお金に回すと全体の利益が増えることがあります。</p></div>';
    var save = function (c) { put(K.stale, c); render(); };
    $('#st-days').addEventListener('change', function () { cfg.days = Math.max(1, Number(this.value) || 60); save(cfg); });
    $$('[data-seg="st"] button', pane).forEach(function (b) { b.addEventListener('click', function () { stOnly = b.getAttribute('data-v') === '1'; render(); }); });
    $$('[data-cat]', pane).forEach(function (i) { i.addEventListener('change', function () { var v = Number(i.value); if (v > 0) cfg.cats[i.getAttribute('data-cat')] = v; else delete cfg.cats[i.getAttribute('data-cat')]; save(cfg); }); });
    $$('[data-lim]', pane).forEach(function (i) { i.addEventListener('change', function () { var v = Number(i.value); if (v > 0) cfg.items[i.getAttribute('data-lim')] = v; else delete cfg.items[i.getAttribute('data-lim')]; save(cfg); }); });
  }

  /* ==================================================================
     5. 期末の棚卸
     ================================================================== */
  var stockCut = null;
  function renderStock(pane) {
    var cut = stockCut || year + '-12-31', s = settings(), cnt = counts(cut), T = B.stocktake(ledger(), cut, s.method, cnt);
    var diffN = T.rows.filter(function (x) { return x.count != null && x.diff; }).length;
    pane.innerHTML = '<div class="bk-pane"><div class="tbar" style="padding-top:0"><p class="tbar-t">期末の棚卸<small>基準日の終わりに手元にある品(仕入れ済みで、まだ売れていない)</small></p><span class="tbar-r">' +
      '<label class="inl">基準日 <input type="date" id="sk-cut" value="' + esc(cut) + '" style="height:28px"></label>' +
      '<label class="inl">評価の方法 <select id="sk-m"><option value="last"' + (s.method === 'last' ? ' selected' : '') + '>最終仕入原価法(届出をしていない場合)</option><option value="each"' + (s.method === 'each' ? ' selected' : '') + '>個別法(1品ずつの仕入れ値)</option></select></label>' +
      '<button type="button" class="btn sm" id="sk-scan">スマホのカメラで数える</button><button type="button" class="btn sm ghost" id="sk-csv">CSVで書き出す</button></span></div>' +
      '<dl class="sum" style="margin-bottom:12px">' + sumHTML([['在庫', T.total + '件'], ['数えた', T.counted + '/' + T.total], ['帳簿の棚卸高', money(T.book) + '円'], ['実地の棚卸高', money(T.real) + '円'], ['差', money(T.real - T.book) + '円', T.real < T.book ? 'bad' : '']]) + '</dl>' +
      '<div class="gridwrap"><table class="grid cards"><thead><tr><th>仕入日</th><th>品名</th><th>JAN・ASIN</th><th class="r">帳簿の数</th><th class="r">実地の数</th><th class="r">差</th><th class="r">評価の単価</th><th class="r">金額</th></tr></thead><tbody>' +
      (T.rows.length ? T.rows.map(function (x) {
        var c = B.ledgerCodes(x.r);
        return '<tr' + (x.count != null && x.diff ? ' class="diff"' : '') + '><td data-k="仕入日" class="nw">' + esc(x.r.date) + '</td><td class="wide nmw" title="' + esc(x.r.name) + '">' + daichoLink(x.r.id, x.r.name || '(名前なし)') + '</td>' +
          '<td data-k="JAN・ASIN" class="nw">' + esc(c.jan || c.asin || '—') + '</td><td data-k="帳簿の数" class="r">' + x.qty + '</td>' +
          '<td data-k="実地の数" class="r"><input class="cnt-in' + (x.count != null ? ' done' : '') + '" type="number" min="0" inputmode="numeric" data-cnt="' + esc(x.r.id) + '" value="' + (x.count == null ? '' : x.count) + '" placeholder="' + x.qty + '"></td>' +
          '<td data-k="差" class="r">' + (x.count == null ? '<span class="muted">—</span>' : (x.diff ? '<b class="neg">' + (x.diff > 0 ? '+' : '') + x.diff + '</b>' : '0')) + '</td>' +
          '<td data-k="評価の単価" class="r">' + money(x.price) + '</td><td data-k="金額" class="r"><b>' + money(x.real) + '</b></td></tr>';
      }).join('') : '<tr><td colspan="8" class="empty">基準日の在庫はありません。</td></tr>') + '</tbody></table></div>' +
      '<p class="bk-note">実地の数を入れた行は、その数で金額を計算します(空欄は帳簿の数)。' + (diffN ? '数が合わない行が' + diffN + '件あります。紛失・破損は台帳で直すか、そのまま期末の数として使います。' : '') + ' ' + (cut === year + '-12-31' ? 'この金額が「申告用の数字」の期末商品棚卸高になります。' : '') +
      ' 個人の棚卸資産の評価は、税務署へ届出をしていなければ最終仕入原価法です。届出の有無は、ご自身の書類で確かめてください。</p></div>';
    $('#sk-cut').addEventListener('change', function () { stockCut = this.value || null; render(); });
    $('#sk-m').addEventListener('change', function () { saveSettings({ method: this.value }); render(); });
    $$('[data-cnt]', pane).forEach(function (i) {
      i.addEventListener('change', function () { var c = counts(cut); if (i.value === '') delete c[i.getAttribute('data-cnt')]; else c[i.getAttribute('data-cnt')] = Math.max(0, Number(i.value) || 0); saveCounts(cut, c); render(); });
    });
    $('#sk-csv').addEventListener('click', function () {
      var rows = T.rows.map(function (x) { var c = B.ledgerCodes(x.r); return [x.r.date, x.r.name || '', c.jan || c.asin || '', x.qty, x.count == null ? '' : x.count, x.price, x.book, x.real]; });
      rows.push(['', '計', '', '', '', '', T.book, T.real]);
      U.download('tanaoroshi_' + cut + '.csv', '﻿' + B.toCSV(rows, ['仕入日', '品名', 'JAN・ASIN', '帳簿の数', '実地の数', '評価の単価', '帳簿の金額', '実地の金額']));
    });
    $('#sk-scan').addEventListener('click', function () { openScan(cut); });
  }
  function loadDecoder() {
    if (window.ZScan) return Promise.resolve();
    return new Promise(function (ok, ng) { var s = document.createElement('script'); s.src = '../assets/scan-decoder.js'; s.onload = ok; s.onerror = ng; document.head.appendChild(s); });
  }
  function openScan(cut) {
    var ov = document.createElement('div'); ov.className = 'scan';
    ov.innerHTML = '<div class="sc-top"><span id="sc-n"></span><button type="button" id="sc-close">終わる</button></div><video playsinline muted autoplay></video><div class="bandg"></div>' +
      '<div class="sc-bot"><div class="sc-last" id="sc-last">商品のバーコードを枠に入れてください</div><div class="sc-sub" id="sc-sub"></div><form id="sc-f"><input id="sc-in" inputmode="numeric" placeholder="読めない時はJANを入力" autocomplete="off"><button class="btn" type="submit">数える</button></form></div>';
    document.body.appendChild(ov);
    var last = '', lastAt = 0;
    function paint() { var T = B.stocktake(ledger(), cut, settings().method, counts(cut)), done = T.rows.filter(function (x) { return x.count != null && x.count >= x.qty; }).length; $('#sc-n', ov).textContent = '数え終わり ' + done + '/' + T.total + '件'; return T; }
    function onCode(code) {
      code = String(code).trim(); if (!code) return;
      if (code === last && Date.now() - lastAt < 1500) return; last = code; lastAt = Date.now();
      var T = paint(), c = counts(cut), hit = B.countScan(T.rows, c, code);
      var el = $('#sc-last', ov), sub = $('#sc-sub', ov);
      if (!hit) { el.textContent = code + ' は在庫にありません'; el.className = 'sc-last ng'; sub.textContent = '台帳の特徴欄に「JAN ' + code + '」が無い品です'; if (navigator.vibrate) navigator.vibrate([60, 40, 60]); return; }
      saveCounts(cut, c); paint();
      el.textContent = (hit.row.name || code).slice(0, 40); el.className = 'sc-last';
      sub.textContent = '実地 ' + hit.count + ' / 帳簿 ' + hit.of + (hit.over ? '(帳簿より多い)' : '');
      if (navigator.vibrate) navigator.vibrate(40);
    }
    paint();
    function close() { try { window.ZScan && window.ZScan.stop(); } catch (e) { /* 何もしない */ } ov.remove(); render(); }
    $('#sc-close', ov).addEventListener('click', close);
    $('#sc-f', ov).addEventListener('submit', function (e) { e.preventDefault(); var v = $('#sc-in', ov).value; $('#sc-in', ov).value = ''; last = ''; onCode(v); });
    loadDecoder().then(function () { return window.ZScan.start($('video', ov), { kind: 'product', onCode: onCode }); })
      .catch(function () { $('#sc-last', ov).textContent = 'カメラを使えませんでした。JANを入力して数えられます'; });
  }

  /* ==================================================================
     6. 確定申告用の数字
     ================================================================== */
  var taxOpen = null;
  function renderTax(pane) {
    var s = settings(), TS = taxSet(year), T = B.taxReport(data(), year, TS), A = T.A;
    var lines = s.form === 'shiro' ? T.shiro : T.ao;
    var keyRows = s.form === 'shiro' ? { '⑨': 1, '⑲': 1 } : { '⑥': 1, '㉝': 1 };
    var calcRows = s.form === 'shiro' ? { '④': 1, '⑦': 1, '⑩': 1, '⑰': 1, '⑱': 1 } : { '④': 1, '⑦': 1, '㉜': 1 };
    pane.innerHTML = '<div class="bk-pane"><div class="disc"><b>確定申告に必要な数字が、毎日の記録から自動でそろいます。</b><br>表示は記録から計算した参考の値です。申告の前に、必ずご自身で内容を確認してください。経費にできるかなど個別の判断は、税務署または税理士にご相談ください。</div>' +
      (T.warn.length ? '<div class="warns"><b>確認してください</b><ul>' + T.warn.map(function (w) { return '<li>' + esc(w.msg) + '</li>'; }).join('') + '</ul></div>' : '') +
      '<div class="bk-2"><div><section class="bk-box"><h2>設定<small>' + year + '年分</small></h2><div class="setf">' +
      '<div class="fld"><span>申告の書類</span>' + seg2('form', [['ao', '青色申告決算書(一般用)'], ['shiro', '収支内訳書(白色)']], s.form) + '</div>' +
      '<div class="fld"><span>消費税</span>' + seg2('tax', [['exempt', '免税事業者'], ['taxable', '課税事業者']], s.tax) + '</div>' +
      '<div class="fld"><span>経理の方式</span>' + seg2('incl', [['1', '税込経理'], ['0', '税抜経理(参考)']], TS.incl ? '1' : '0', s.tax === 'exempt') + (s.tax === 'exempt' ? '<span class="auto">免税事業者は税込経理です</span>' : '') + '</div>' +
      '<div class="fld"><span>仕入れで付いたポイント(この年の合計)</span><div class="pair"><input type="number" id="tx-pt" min="0" inputmode="numeric" value="' + esc(s.pointYen[year] || '') + '" placeholder="0">円 ' + seg2('points', [['discount', '仕入れの値引き'], ['misc', '雑収入']], s.points) + '</div><span class="auto">楽天・Yahoo!のポイントなど。どちらで扱うかは毎年そろえてください</span></div>' +
      '<div class="fld"><span>期首商品棚卸高</span><div class="pair"><input type="number" id="tx-open" min="0" value="' + esc(s.opening[year] == null ? '' : s.opening[year]) + '" placeholder="' + T.openAuto + '">円</div><span class="auto">空欄は台帳から計算(' + yen(T.openAuto) + '円)。前の年の期末と同じ額にします</span></div>' +
      '<div class="fld"><span>期末商品棚卸高</span><div class="pair"><input type="number" id="tx-close" min="0" value="' + esc(s.closing[year] == null ? '' : s.closing[year]) + '" placeholder="' + T.closeT.real + '">円</div><span class="auto">空欄は<button type="button" class="lnk" data-go="stock">期末の棚卸</button>の金額(' + yen(T.closeT.real) + '円・' + T.closeT.counted + '/' + T.closeT.total + '件を実地で確認)</span></div>' +
      '<div class="fld"><span>家事按分</span><span class="auto">経費ごとの「事業の割合」で計算します。初期値は<button type="button" class="lnk" data-go="expense">経費</button>で変えられます</span></div>' +
      '</div></section></div><div><section class="bk-box"><h2>' + (s.form === 'shiro' ? '収支内訳書(一般用)' : '青色申告決算書(一般用) 損益計算書') + '<small>' + year + '年1月1日〜12月31日・円</small></h2>' +
      '<table class="form"><tbody>' + lines.map(function (l, i) {
        var cls = keyRows[l.no] ? 'key' : (calcRows[l.no] ? 'calc' : (l.sub ? 'sub' : ''));
        var open = taxOpen === i;
        return '<tr class="' + cls + '"><td class="no">' + esc(l.no) + '</td><td>' + esc(l.label) + '</td><td class="amt">' + money(l.amount) + '</td><td class="src">' + (l.src.length ? '<button type="button" class="lnk" data-tx="' + i + '">' + (open ? '閉じる' : '内訳 ' + l.src.length + '件') + '</button>' : '') + '</td></tr>' +
          (open ? '<tr class="drill"><td colspan="4">' + drillTax(l) + '</td></tr>' : '');
      }).join('') + '</tbody></table></section>' +
      '<p class="bk-note">欄の番号は令和7年分の様式で確かめたものです。様式が変わることがあるので、申告書の欄の名前と合わせて確認してください。' + (s.form === 'ao' ? '㉕〜㉚は空いている欄に科目名を書いて使います。青色申告特別控除(65万円・55万円・10万円)の要件と金額は、ご自身で確かめてください。' : '') + (s.tax === 'taxable' && !TS.incl ? ' 税抜経理の値は、10%で割り戻した参考の値です。' : '') + '</p>' +
      '<div class="row-btns"><button type="button" class="btn sm ghost" id="tx-csv">この表をCSVで書き出す</button><button type="button" class="btn sm ghost" data-go="journal">仕訳帳と会計ソフト向けの書き出し</button></div></div></div></div>';
    $$('[data-seg] button', pane).forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.parentNode.getAttribute('data-seg'), v = b.getAttribute('data-v'), p = {};
        p[k] = k === 'incl' ? v === '1' : v; if (k === 'tax' && v === 'exempt') p.incl = true;
        saveSettings(p); taxOpen = null; render();
      });
    });
    function yearVal(id, field) { $('#' + id).addEventListener('change', function () { var s2 = settings(); s2[field][year] = this.value === '' ? '' : Math.max(0, Math.round(Number(this.value) || 0)); put(K.set, s2); render(); }); }
    yearVal('tx-pt', 'pointYen'); yearVal('tx-open', 'opening'); yearVal('tx-close', 'closing');
    $$('[data-tx]', pane).forEach(function (b) { b.addEventListener('click', function () { var i = +b.getAttribute('data-tx'); taxOpen = taxOpen === i ? null : i; render(); }); });
    $$('[data-go]', pane).forEach(function (b) { b.addEventListener('click', function () { go(b.getAttribute('data-go')); }); });
    $('#tx-csv').addEventListener('click', function () {
      U.download((s.form === 'shiro' ? 'shushi-uchiwake_' : 'aoiro-kessansho_') + year + '.csv', '﻿' + B.toCSV(lines.map(function (l) { return [l.no, l.label.trim(), l.amount]; }), ['欄', '項目', '金額(円)']));
    });
  }
  function drillTax(l) {
    var D = data(), byL = {}, byS = {}, byE = {};
    D.ledger.forEach(function (r) { byL[r.id] = r; }); D.sales.forEach(function (r) { byS[r.id] = r; }); D.expenses.forEach(function (r) { byE[r.id] = r; });
    var keys = l.keys || [], seen = {}, rows = [];
    l.src.forEach(function (s) {
      var k = s.type + ':' + s.id; if (seen[k]) return; seen[k] = 1;
      if (s.type === 'expense' && byE[s.id]) { var e = byE[s.id]; rows.push([e.date, '経費', (e.payee || e.acct) + (Number(e.biz) < 100 ? '(事業' + e.biz + '%)' : ''), B.bizAmount(e)]); }
      else if (s.type === 'import' && byS[s.id]) {
        var x = byS[s.id], amt = keys.indexOf('sales') >= 0 ? (x.gross || 0) + (x.disc || 0) : keys.indexOf('misc') >= 0 ? (x.other || 0) + (x.withheld || 0) : keys.indexOf('荷造運賃') >= 0 ? x.ship : (x.fee || 0) + Math.max(0, -((x.other || 0) + (x.withheld || 0)));
        rows.push([x.date, (x.ch || '') + ' ' + (x.typeLabel || ''), x.name || x.order || '', amt]);
      } else if (s.type === 'ledger' && byL[s.id]) {
        var r = byL[s.id], q = Number(r.qty) || 1;
        var a2 = keys.indexOf('sales') >= 0 ? (Number(r.salePrice) || 0) * q : keys.indexOf('支払手数料') >= 0 ? (B.events(D).filter(function (e) { return e.ledgerId === r.id && e.src === 'ledger'; })[0] || {}).fee || 0 : (Number(r.unit) || 0) * q;
        rows.push([keys.indexOf('sales') >= 0 || keys.indexOf('支払手数料') >= 0 ? r.saleDate : r.date, '台帳', r.name || '(名前なし)', a2, r.id]);
      }
    });
    rows.sort(function (a, b) { return String(a[0]).localeCompare(String(b[0])); });
    var extra = (keys.indexOf('buy') >= 0 || keys.indexOf('misc') >= 0) && Number(taxSet(year).pointYen) ? '<p class="muted">仕入れで付いたポイント ' + yen(taxSet(year).pointYen) + '円 を' + (settings().points === 'misc' ? '雑収入に足しています' : '仕入金額から引いています') + '。</p>' : '';
    var note = keys.indexOf('closing') >= 0 || keys.indexOf('opening') >= 0 ? '<p class="muted">金額は評価の方法(' + (settings().method === 'last' ? '最終仕入原価法' : '個別法') + ')と実地の数で変わります。下は仕入れ値です。</p>' : '';
    return note + extra + '<table class="grid sub"><thead><tr><th>日付</th><th>元</th><th>内容</th><th class="r">金額</th></tr></thead><tbody>' + rows.slice(0, 300).map(function (r) { return '<tr><td class="nw">' + esc(r[0]) + '</td><td class="nw">' + esc(r[1]) + '</td><td class="nmw">' + (r[4] ? daichoLink(r[4], r[2]) : esc(r[2])) + '</td><td class="r">' + money(r[3]) + '</td></tr>'; }).join('') + '</tbody></table>' + (rows.length > 300 ? '<p class="muted">ほか' + (rows.length - 300) + '件</p>' : '');
  }

  /* ==================================================================
     7. 仕訳帳・書き出し
     ================================================================== */
  var jnMonth = '', jnMore = 300;
  function renderJournal(pane) {
    var TS = taxSet(year), J = B.journal(data(), year, TS), shown = J.filter(function (e) { return !jnMonth || e.date.slice(5, 7) === jnMonth; });
    var tot = shown.reduce(function (s, e) { return s + e.amt; }, 0);
    pane.innerHTML = '<div class="bk-pane"><div class="tbar" style="padding-top:0"><p class="tbar-t">' + year + '年の仕訳帳<small>' + shown.length + '行・借方と貸方の合計 ' + yen(tot) + '円(一致)</small></p><span class="tbar-r">' +
      '<label class="inl">月 <select id="jn-m"><option value="">すべて</option>' + Array.apply(null, Array(12)).map(function (_, i) { var m = String(i + 1).padStart(2, '0'); return '<option value="' + m + '"' + (jnMonth === m ? ' selected' : '') + '>' + (i + 1) + '月</option>'; }).join('') + '</select></label></span></div>' +
      '<section class="bk-box" style="margin-bottom:12px"><h2>会計ソフトへ書き出す<small>' + year + '年の全部の仕訳</small></h2><div class="in"><div class="exp-bar">' +
      '<button type="button" class="btn sm" data-ex="freee">freee会計</button><button type="button" class="btn sm" data-ex="mf">マネーフォワード クラウド確定申告</button><button type="button" class="btn sm" data-ex="yayoi">やよいの青色申告</button><button type="button" class="btn sm ghost" data-ex="plain">そのほか(汎用CSV)</button>' +
      '<label class="inl">文字コード <select id="jn-enc"><option value="auto">おすすめ(ソフトごと)</option><option value="sjis">Shift_JIS</option><option value="utf8">UTF-8</option></select></label></div>' +
      '<ul class="howto"><li>freee会計: 「取引」→「エクセルインポート」で仕訳(振替伝票)として取り込み、列を当てはめます。</li><li>マネーフォワード: 「仕訳帳」→「インポート」→「仕訳帳」で取り込みます(列は公式の見本と同じ順)。</li><li>やよいの青色申告: 「ファイル」→「インポート」で弥生インポート形式(25項目)として取り込みます。</li>' +
      '<li>勘定科目の名前がソフトの科目と違う時は、取り込む前にソフト側で科目を作るか、CSVの科目名を直してください。取り込む前に、少ない件数で試すと安心です。</li></ul></div></section>' +
      '<div class="gridwrap sc"><table class="grid"><thead><tr><th class="r">No</th><th>日付</th><th>借方</th><th>貸方</th><th class="r">金額</th><th>摘要</th></tr></thead><tbody>' +
      (shown.length ? shown.slice(0, jnMore).map(function (e) { return '<tr><td class="r muted">' + e.no + '</td><td class="nw">' + esc(e.date) + '</td><td class="nw">' + esc(e.dr) + '</td><td class="nw">' + esc(e.cr) + '</td><td class="r">' + money(e.amt) + '</td><td class="nmw" title="' + esc(e.memo) + '">' + esc(e.memo) + '</td></tr>'; }).join('') : '<tr><td colspan="6" class="empty">この期間の仕訳はありません。</td></tr>') +
      '</tbody></table></div>' + (shown.length > jnMore ? '<div class="row-btns"><button type="button" class="btn sm ghost" id="jn-more">さらに表示(残り' + (shown.length - jnMore) + '行)</button></div>' : '') +
      '<p class="bk-note">仕入れ・経費の支払いは「' + esc(TS.pay) + '」(個人のお金やカードで払った扱い)、売上は「売掛金」に入れ、Amazonの振込みで「普通預金」へ移します。期首・期末の商品棚卸高の振替も入れています。仕訳は記録から自動で作った参考のもので、取り込んだ後は会計ソフト側で確かめてください。</p></div>';
    $('#jn-m').addEventListener('change', function () { jnMonth = this.value; jnMore = 300; render(); });
    var more = $('#jn-more'); if (more) more.addEventListener('click', function () { jnMore += 1000; render(); });
    $$('[data-ex]', pane).forEach(function (b) {
      b.addEventListener('click', function () {
        if (!J.length) { U.toast('書き出す仕訳がありません'); return; }
        var soft = b.getAttribute('data-ex'), out = B.exportRows(J, soft, TS), enc = $('#jn-enc').value;
        if (enc === 'auto') enc = soft === 'yayoi' || soft === 'mf' ? 'sjis' : 'utf8';
        var csv = B.toCSV(out.rows, out.header);
        var blob = enc === 'sjis' ? new Blob([B.encodeSJIS(csv)], { type: 'text/csv;charset=shift_jis' }) : new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
        U.download('shiwake_' + soft + '_' + year + '.csv', blob);
        U.toast((B.SOFT[soft] ? B.SOFT[soft].label : '汎用') + 'の形で ' + J.length + '行を書き出しました');
      });
    });
  }

  /* ==================================================================
     8. 古物商特例の確認
     ================================================================== */
  var kbFilter = 'missing';
  function renderKobutsu(pane) {
    var s = settings();
    if (s.tax !== 'taxable') {
      pane.innerHTML = '<div class="bk-pane"><div class="lock"><div class="h">古物商特例の確認<span class="tag">課税事業者の方向け</span></div><div class="b"><p>消費税の免税事業者は、仕入税額控除がないため確認は要りません。課税事業者の方は、設定を切り替えると、個人から仕入れた中古品ごとに帳簿の記載がそろっているかを表示します。</p><button type="button" class="btn" id="kb-on">課税事業者に切り替える</button></div></div></div>';
      $('#kb-on').addEventListener('click', function () { saveSettings({ tax: 'taxable' }); render(); });
      return;
    }
    var k = B.kobutsuCheck(ledger(), year), list = k.rows.filter(function (x) { return kbFilter === 'all' ? true : x.state === kbFilter; });
    var ST = { ok: ['記載そろい', 'ok'], missing: ['記載が足りない', 'ng'], biz: ['事業者から(インボイスが必要)', ''], new: ['新品', ''] };
    pane.innerHTML = '<div class="bk-pane"><div class="tbar" style="padding-top:0"><p class="tbar-t">古物商特例の確認<small>' + year + '年の仕入れ・個人(インボイスを出せない相手)からの中古品</small></p><span class="tbar-r">' +
      seg2('kb', [['missing', '足りない ' + k.missing], ['ok', 'そろい ' + k.ok], ['biz', '事業者 ' + k.biz], ['all', 'すべて ' + k.rows.length]], kbFilter) + '</span></div>' +
      '<dl class="sum" style="margin-bottom:12px">' + sumHTML([['記載がそろった仕入れ', k.ok + '件・' + money(k.amountOk) + '円'], ['うち消費税の目安(10/110)', money(k.taxOk) + '円'], ['記載が足りない', k.missing + '件・' + money(k.amountMissing) + '円', k.missing ? 'bad' : '']]) + '</dl>' +
      '<div class="gridwrap"><table class="grid cards"><thead><tr><th>仕入日</th><th>品名</th><th>仕入れ先</th><th class="r">対価</th><th>売り手の確認</th><th>状態</th><th>足りない項目</th><th></th></tr></thead><tbody>' +
      (list.length ? list.map(function (x) {
        var r = x.r, st = ST[x.state];
        return '<tr><td data-k="仕入日" class="nw">' + esc(r.date) + '</td><td class="wide nmw" title="' + esc(r.name) + '">' + esc(r.name || '(名前なし)') + '</td><td data-k="仕入れ先" class="nmw">' + esc(r.party || '—') + (r.pName ? '<div class="meta">' + esc(r.pName) + '</div>' : '') + '</td>' +
          '<td data-k="対価" class="r">' + money(x.amt) + '</td><td data-k="売り手の確認">' + (x.state === 'ok' || x.state === 'missing' ? (x.idReq ? '要る' : '<span class="muted">不要(1万円未満)</span>') : '<span class="muted">—</span>') + '</td>' +
          '<td data-k="状態"><span class="tag ' + st[1] + '">' + st[0] + '</span></td><td data-k="足りない項目">' + (x.need.length ? '<b class="neg">' + esc(x.need.join('・')) + '</b>' : '') + '</td>' +
          '<td class="ops">' + (x.state === 'missing' ? daichoLink(r.id, '台帳で入れる') : '') + '</td></tr>';
      }).join('') : '<tr><td colspan="8" class="empty">' + ({ missing: '記載が足りない仕入れはありません。', ok: '記載がそろった仕入れはまだありません。', biz: '事業者からの中古の仕入れはありません。' }[kbFilter] || 'この年の仕入れはありません。') + '</td></tr>') +
      '</tbody></table></div>' +
      '<p class="bk-note">古物商が、適格請求書発行事業者でない個人から古物(売るための商品)を買った時は、帳簿に一定の事項を書いて保存すれば、請求書なしで仕入税額控除を受けられます(古物商等特例)。帳簿には、売り手の氏名・住所(古物営業法で売り手の確認が要る取引の時)、年月日、品名、数量、対価と、特例の対象であることを書きます。書き出す仕訳の摘要には「古物商特例」と入れます。' +
      ' 相手が事業者(店舗・ショップ等)の時は、その相手が発行する適格請求書(レシート)の保存が必要です。記載が足りない仕入れは特例の対象にならず、経過措置の割合での控除になる場合があります。' +
      ' 参考: <a href="https://www.nta.go.jp/taxes/shiraberu/zeimokubetsu/shohi/keigenzeiritsu/pdf/qa/01-13.pdf" target="_blank" rel="noopener">国税庁 インボイス制度Q&A(古物商等特例)</a>・<a href="https://www.nta.go.jp/taxes/shiraberu/zeimokubetsu/shohi/keigenzeiritsu/pdf/qa/106.pdf" target="_blank" rel="noopener">問106</a>(2026年10月27日確認)。判定は台帳の入力からの目安で、適用できるかの最終判断はご自身で確かめてください。</p></div>';
    $$('[data-seg="kb"] button', pane).forEach(function (b) { b.addEventListener('click', function () { kbFilter = b.getAttribute('data-v'); render(); }); });
  }

  /* ==================================================================
     見本のデータ(?demo=1・保存しない)
     ================================================================== */
  function demoSeed() {
    var Y = CUR_Y, P = Y - 1, seedN = 7;
    function rnd() { seedN = (seedN * 16807) % 2147483647; return (seedN - 1) / 2147483646; }
    function pick(a) { return a[Math.floor(rnd() * a.length)]; }
    function dstr(t) { var d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
    // 品名, 特徴, 新品/中古, 仕入れ値, 売り先, 売値, 仕入れ先, ルート, 品目, 本人確認が要る品
    var CAT = [
      ['ポケモンカードゲーム 拡張パック 1BOX', 'JAN 4521329400001 ASIN B0DEMO0001', '新品', 5400, 'Amazon', 8800, '楽天市場 カードショップA', '楽天・Yahoo!→Amazon', '', false],
      ['Nintendo Switch Proコントローラー', 'JAN 4902370551259', '新品', 5980, 'Amazon', 7980, 'Yahoo!ショッピング ゲーム館', '楽天・Yahoo!→Amazon', '', false],
      ['LEGO クリエイター ポルシェ911', 'JAN 5702016912340', '新品', 14800, 'Amazon', 21800, '楽天市場 トイショップ', '楽天・Yahoo!→Amazon', '', false],
      ['アネッサ パーフェクトUV 60mL', 'JAN 4909978000001', '新品', 2380, 'Amazon', 3980, '楽天市場 ドラッグストア', '楽天・Yahoo!→Amazon', '', false],
      ['ダイソン 交換バッテリー', 'JAN 5025155000001', '新品', 8900, 'Amazon', 12800, '楽天市場 家電店', '楽天・Yahoo!→Amazon', '', false],
      ['ドラゴンクエスト フィギュア 未開封', 'JAN 4988601000001', '新品', 3200, 'Amazon', 5980, 'Yahoo!ショッピング ホビー堂', '楽天・Yahoo!→Amazon', '', false],
      ['タミヤ ミニ四駆 限定キット', 'JAN 4950344000001', '新品', 1100, 'メルカリ', 2400, '店舗', '店舗(バーコード読み取り)', '', false],
      ['SONY ワイヤレスヘッドホン 中古 美品', '', '中古', 16000, 'Amazon', 26800, 'メルカリ 出品者', 'メルカリ', '機械工具類', false],
      ['中古 PS5ソフト 3本セット', '', '中古', 4200, 'メルカリ', 7800, 'メルカリ 出品者', 'メルカリ', '道具類', true],
      ['ブランド 長財布 中古', '', '中古', 18000, 'メルカリ', 29800, 'ジモティー 個人', '店舗(バーコード読み取り)', '皮革・ゴム製品類', false],
      ['中古 一眼レフ用 単焦点レンズ 50mm', '', '中古', 9800, 'メルカリ', 16800, 'ヤフオク 出品者', 'ヤフオク→メルカリ', '写真機類', false],
      ['カシオ G-SHOCK 中古', '', '中古', 11000, 'メルカリ', 17800, 'セカンドストリート 渋谷', '店舗(バーコード読み取り)', '時計・宝飾品類', false],
      ['中古 ゲームボーイアドバンスSP', '', '中古', 7000, 'メルカリ', 12800, 'メルカリ 出品者', 'メルカリ', '道具類', true],
      ['無印良品 収納ケース 新品', 'JAN 4550000000001', '新品', 1490, 'メルカリ', 2980, '店舗', '店舗(バーコード読み取り)', '', false]
    ];
    var NAMES = [['佐藤 一郎', '東京都杉並区高円寺南1-1-1'], ['鈴木 花子', '神奈川県川崎市中原区2-3-4'], ['', ''], ['高橋 健', '']];
    var led = [], S = [], n = 0, sn = 0, now = Date.parse(TODAY + 'T00:00:00');
    function addItem(t, c, sold) {
      n++;
      var qty = c[2] === '新品' && rnd() < 0.3 ? 2 : 1, unit = Math.round(c[3] * (0.9 + rnd() * 0.2) / 10) * 10, sell = c[5];
      var fee = c[4] === 'Amazon' ? Math.round(sell * 0.11 + 420) : Math.floor(sell * 0.1) + 750;
      var r = { id: 'dm' + n, date: dstr(t), name: c[0], feature: c[1], cond: c[2], qty: qty, unit: unit, party: c[6], route: c[7], sellTo: c[4], sellPrice: sell, profit: sell - unit - fee, status: '出品中', ship: c[4] === 'Amazon' ? 'fba' : 'self', hinmoku: c[8] || (c[2] === '中古' ? '道具類' : ''), media: c[9] };
      if (c[6] === 'ジモティー 個人' || (c[2] === '中古' && /メルカリ|ヤフオク/.test(c[6]) && rnd() < 0.5)) { var nm = pick(NAMES); r.pName = nm[0]; r.pAddr = nm[1]; if (nm[0]) r.verify = '本人限定受取郵便で確認'; }
      if (c[6].indexOf('セカンドストリート') === 0) r.verify = '古物商・法人から購入';
      led.push(r);
      if (!sold) return;
      var sd = dstr(t + (6 + Math.floor(rnd() * 50)) * 864e5); if (sd > TODAY) return;
      if (c[4] === 'Amazon') {
        sn++; var s = { id: 'ds' + sn, src: 'amazon', ch: 'Amazon', date: sd, kind: 'order', typeLabel: '注文', order: '503-' + (1000000 + sn) + '-' + (2000000 + sn), sku: '', name: c[0], qty: qty, gross: sell * qty, disc: 0, fee: fee * qty, ship: 0, other: 0, withheld: 0, net: (sell - fee) * qty, fulfil: 'Amazon', key: 'demo|' + sn, batch: 'demo', ledgerId: r.id };
        S.push(s); r.saleRef = s.id; r.saleOrder = s.order; r.saleParty = 'Amazon 購入者';
      } else r.saleParty = 'メルカリ 購入者';
      r.saleDate = sd; r.salePrice = sell; r.status = '発送済';
    }
    // 前の年の終わりの在庫(売れ残りの見本)
    addItem(Date.parse(P + '-10-12'), CAT[11], false); addItem(Date.parse(P + '-11-20'), CAT[2], false); addItem(Date.parse(P + '-12-05'), CAT[12], true);
    for (var m = 0; m < 12; m++) {
      var t0 = Date.parse(Y + '-' + String(m + 1).padStart(2, '0') + '-01T00:00:00');
      if (t0 > now) break;
      var k = 14 + Math.floor(rnd() * 6);
      for (var i = 0; i < k; i++) { var t = t0 + Math.floor(rnd() * 27) * 864e5; if (t > now) continue; addItem(t, pick(CAT), rnd() < 0.85); }
    }
    // Amazon の手数料・調整・返金・振込み
    for (var mm = 1; mm <= 12; mm++) {
      var d = Y + '-' + String(mm).padStart(2, '0') + '-15'; if (d > TODAY) break;
      sn++; S.push({ id: 'ds' + sn, src: 'amazon', ch: 'Amazon', date: d, kind: 'fee', typeLabel: 'サービス料金', name: '月額登録料', qty: 0, gross: 0, disc: 0, fee: 0, ship: 0, other: -5390, withheld: 0, net: -5390, key: 'demo|' + sn, batch: 'demo' });
      if (mm % 3 === 0) { sn++; S.push({ id: 'ds' + sn, src: 'amazon', ch: 'Amazon', date: d, kind: 'fee', typeLabel: 'FBA在庫関連の手数料', name: 'FBA保管手数料', qty: 0, gross: 0, disc: 0, fee: 380 + mm * 40, ship: 0, other: 0, withheld: 0, net: -(380 + mm * 40), key: 'demo|' + sn, batch: 'demo' }); }
    }
    S.push({ id: 'dsx1', src: 'amazon', ch: 'Amazon', date: Y + '-06-12', kind: 'adjust', typeLabel: '調整', name: 'FBA在庫の返金 - 紛失:倉庫', qty: 1, gross: 0, disc: 0, fee: 0, ship: 0, other: 1500, withheld: 0, net: 1500, key: 'demo|x1', batch: 'demo' });
    S.push({ id: 'dsx2', src: 'amazon', ch: 'Amazon', date: Y + '-07-10', kind: 'refund', typeLabel: '返金', order: '503-7777777-0000001', name: 'ドラゴンクエスト フィギュア 未開封(返品)', qty: 1, gross: -5980, disc: 0, fee: -520, ship: 0, other: 0, withheld: 0, net: -5460, key: 'demo|x2', batch: 'demo' });
    S.push({ id: 'dsm1', src: 'mercari', ch: 'メルカリ', date: Y + '-08-19', kind: 'sale', typeLabel: '売上', order: 'm84719283745', name: 'ニンテンドースイッチ プロコントローラー 純正(手持ち)', qty: 1, gross: 6800, disc: 0, fee: 680, ship: 750, other: 0, withheld: 0, net: 5370, key: 'demo|m1', batch: 'demo' });
    // 経費
    var E = [], en = 0;
    function ex(date, acct, amount, payee, biz) { if (date > TODAY) return; en++; E.push({ id: 'de' + en, date: date, acct: acct, amount: amount, payee: payee, memo: '', biz: biz == null ? 100 : biz, src: 'manual' }); }
    for (var q = 1; q <= 12; q++) {
      var mo = Y + '-' + String(q).padStart(2, '0');
      ex(mo + '-27', '通信費', 7480, 'ドコモ スマホ代', 50);
      ex(mo + '-05', '荷造運賃', 4200 + q * 230, 'ヤマト運輸 宅急便コンパクト');
      ex(mo + '-11', '消耗品費', 1880 + (q % 4) * 420, 'ダイソー 梱包材・テープ');
      if (q % 2) ex(mo + '-18', '旅費交通費', 3200, 'ENEOS 仕入れのガソリン');
      ex(mo + '-01', '通信費', 1100, 'Keepa 月額');
    }
    ex(Y + '-04-01', '支払手数料', 330, '振込手数料');
    ex(Y + '-05-15', '新聞図書費', 1650, 'せどりの本');
    led.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    return { ledger: led, sales: S, expenses: E, recur: [{ id: 'dr1', day: 27, acct: '通信費', amount: 7480, payee: 'ドコモ スマホ代', biz: 50, start: Y + '-01' }], set: { tax: 'exempt', method: 'last', bizDef: { 通信費: 50 } }, stale: { days: 60, cats: {}, items: {} } };
  }

  /* ==================================================================
     起動
     ================================================================== */
  if (DEMO) {
    var seed = demoSeed();
    mem.ledger = seed.ledger; mem[K.sales] = seed.sales; mem[K.exp] = seed.expenses; mem[K.recur] = seed.recur; mem[K.set] = seed.set; mem[K.stale] = seed.stale;
    mem[K.batches] = [{ id: 'demo', at: Date.now() - 864e5, src: 'amazon', label: 'Amazon 日付範囲レポート(見本) → 売上', n: seed.sales.length, total: seed.sales.reduce(function (s, x) { return s + (x.gross || 0); }, 0), saleIds: [], expIds: [], ledgerBefore: {} }];
    year = CUR_Y;
    var bar = $('#bk-demo'); bar.hidden = false;
  }
  runRecurring();
  $('#bk-year').addEventListener('change', function () { year = Number(this.value); put(K.year, year); stockCut = null; taxOpen = null; moOpen = null; render(); });
  $('#bk-tabs').addEventListener('click', function (e) { var b = e.target.closest('[data-tab]'); if (b) go(b.getAttribute('data-tab')); });
  window.addEventListener('hashchange', function () { var t = location.hash.slice(1); if (t && t !== tab && TABS.some(function (x) { return x[0] === t; })) { tab = t; render(); } });
  document.addEventListener('sedori:remote', function () { if (!DEMO) render(); });
  document.addEventListener('sedori:acct', function () { render(); });
  U.api.onSearch = function (src, text) { if (src !== 'ledger') return false; location.href = '../daicho/?q=' + encodeURIComponent(text); return true; };
  history.replaceState(null, '', location.pathname + location.search + '#' + tab);
  render();
})();
