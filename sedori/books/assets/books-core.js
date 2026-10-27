/* せどり 利益チェック — 帳簿の計算だけの部品(画面・保存に依存しない)。
   ブラウザでは window.SedoriBooks、Node では require('./books-core.js') で検算する。
   金額はすべて円の整数。日付は 'YYYY-MM-DD'。計算は参考で、申告の前に本人が確認する前提。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SedoriBooks = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ==================================================================
     文字・数字・日付
     ================================================================== */
  function z2h(s) {
    return String(s == null ? '' : s).replace(/[！-～]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }).replace(/　/g, ' ');
  }
  /** 見出しの比較用(空白・記号を除き、半角・小文字に) */
  function norm(s) { return z2h(s).toLowerCase().replace(/[\s_\-・/()（）「」\[\]:：.、。'"]/g, ''); }

  /** 金額の文字 → 整数。"¥1,234" "-¥300" "(500)" "▲200" "1,234円" "+¥2,490" */
  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var s = z2h(v).trim(); if (!s) return 0;
    var neg = /^\(.*\)$/.test(s) || /^[-−‐–▲△]/.test(s) || /[-−]\s*[¥￥]/.test(s);
    s = s.replace(/[^0-9.]/g, '');
    if (!s) return 0;
    var n = Number(s); if (!isFinite(n)) return 0;
    return neg ? -n : n;
  }
  function round(n) { return Math.round(Number(n) || 0); }
  function pad(n) { return String(n).padStart(2, '0'); }
  var MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  var ERA = { r: 2018, h: 1988, '令和': 2018, '平成': 1988 };
  /** 日付の文字 → 'YYYY-MM-DD'(読めなければ '')。defYear は年が無い時(メルカリの「10月20日」) */
  function date(v, defYear) {
    var s = z2h(v).trim(); if (!s) return '';
    var m = s.match(/(\d{4})\s*[-\/.年]\s*(\d{1,2})\s*[-\/.月]\s*(\d{1,2})/);
    if (m) return ymd(+m[1], +m[2], +m[3]);
    m = s.match(/(令和|平成|[RH])\s*(\d{1,2})\s*[-\/.年]\s*(\d{1,2})\s*[-\/.月]\s*(\d{1,2})/i);
    if (m) return ymd(ERA[m[1].length > 1 ? m[1] : m[1].toLowerCase()] + Number(m[2]), +m[3], +m[4]);
    m = s.match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/); // Oct 1, 2026
    if (m && MON[m[1].toLowerCase()]) return ymd(+m[3], MON[m[1].toLowerCase()], +m[2]);
    m = s.match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{4})/); // 1 Oct 2026
    if (m && MON[m[2].toLowerCase()]) return ymd(+m[3], MON[m[2].toLowerCase()], +m[1]);
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); // 10/01/2026(米国式)
    if (m) return ymd(+m[3], +m[1], +m[2]);
    m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return ymd(+m[1], +m[2], +m[3]);
    m = s.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
    if (m && defYear) return ymd(defYear, +m[1], +m[2]);
    return '';
  }
  function ymd(y, m, d) {
    if (!(y > 1990 && y < 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return '';
    return y + '-' + pad(m) + '-' + pad(d);
  }
  function daysBetween(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5); }
  function addDays(d, n) { var t = new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5); return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate()); }

  /* ==================================================================
     CSV
     ================================================================== */
  /** バイト列 → 文字。UTF-8 で読めなければ Shift_JIS(Amazonの古い書き出し・カード会社の明細) */
  function decode(bytes) {
    var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(u8).replace(/^﻿/, ''), enc: 'UTF-8' }; } catch (e) { /* 次へ */ }
    try { return { text: new TextDecoder('shift_jis').decode(u8), enc: 'Shift_JIS' }; } catch (e) { /* 次へ */ }
    return { text: new TextDecoder('utf-8').decode(u8), enc: 'UTF-8' };
  }
  /** CSV・TSV を2次元の配列に(引用符・改行入りの欄・BOM に対応)。区切りは1行目から自動 */
  function parseCSV(text) {
    text = String(text || '').replace(/^﻿/, '');
    var head = text.slice(0, 4000), tabs = (head.match(/\t/g) || []).length, commas = (head.match(/,/g) || []).length;
    var sep = tabs > commas ? '\t' : ',';
    var rows = [], row = [], f = '', q = false, i = 0, n = text.length;
    for (; i < n; i++) {
      var c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
        else f += c;
      } else if (c === '"' && f === '') q = true;
      else if (c === sep) { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(f); f = ''; rows.push(row); row = [];
      } else f += c;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return String(x).trim() !== ''; }); });
  }
  function csvCell(v) {
    var s = v == null ? '' : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCSV(rows, header) { return (header ? [header] : []).concat(rows).map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n'; }

  /** 見出しの行を探す。cols: {key: [見出しの候補…]}。最初の20行で一番多く当たった行 */
  function findHeader(rows, cols, minHits) {
    var best = { idx: -1, hits: 0, map: {} };
    for (var i = 0; i < Math.min(rows.length, 20); i++) {
      var map = mapHeader(rows[i], cols), hits = Object.keys(map).length;
      if (hits > best.hits) best = { idx: i, hits: hits, map: map };
    }
    return best.hits >= (minHits || 3) ? best : { idx: -1, hits: best.hits, map: {} };
  }
  function mapHeader(header, cols) {
    var map = {}, used = {};
    var H = header.map(norm);
    // 完全一致を先に、次に前方一致
    [function (h, a) { return h === a; }, function (h, a) { return a.length >= 2 && h.indexOf(a) === 0; }].forEach(function (eq) {
      Object.keys(cols).forEach(function (k) {
        if (map[k] != null) return;
        var al = cols[k].map(norm);
        for (var j = 0; j < H.length; j++) { if (used[j]) continue; if (al.some(function (a) { return eq(H[j], a); })) { map[k] = j; used[j] = 1; return; } }
      });
    });
    return map;
  }

  /* ==================================================================
     Amazon ペイメントレポート(日付範囲レポート・トランザクション)
     ================================================================== */
  var AMZ_COLS = {
    date: ['日付/時間', '日付', 'date/time', 'date'],
    settle: ['決済番号', 'settlement id'],
    type: ['トランザクションの種類', 'トランザクションタイプ', 'type', 'transaction type'],
    order: ['注文番号', 'order id'],
    sku: ['SKU'],
    desc: ['説明', 'description'],
    qty: ['数量', 'quantity'],
    market: ['Amazon 出品サービス', 'marketplace'],
    fulfil: ['フルフィルメント', 'fulfillment', 'fulfilment'],
    sales: ['商品売上', '商品の売り上げ', '商品の売上', 'product sales'],
    salesTax: ['商品の売上税', '商品売上税', 'product sales tax'],
    ship: ['配送料', 'shipping credits'],
    shipTax: ['配送料の税金', '配送料の税', 'shipping credits tax'],
    gift: ['ギフト包装手数料', 'ギフト包装クレジット', 'gift wrap credits'],
    giftTax: ['ギフト包装クレジットの税金', 'ギフト包装手数料の税', 'giftwrap credits tax', 'gift wrap credits tax'],
    point: ['Amazonポイントの費用', 'amazon point cost', 'points granted'],
    promo: ['プロモーション割引額', 'プロモーション割引', 'promotional rebates'],
    promoTax: ['プロモーション割引の税金', 'プロモーション割引税', 'promotional rebates tax'],
    withheld: ['源泉徴収税を伴うマーケットプレイス', 'ストアの源泉徴収税', 'marketplace withheld tax', 'marketplace facilitator tax'],
    sellFee: ['手数料', '販売手数料', 'selling fees'],
    fbaFee: ['FBA 手数料', 'FBA手数料', 'fba fees'],
    otherFee: ['トランザクションに関するその他の手数料', 'other transaction fees'],
    other: ['その他', 'other'],
    total: ['合計', 'total']
  };
  /** 種類の文字 → order / refund / adjust / transfer / fee / other */
  function amzType(s) {
    var t = norm(s);
    if (!t) return 'other';
    if (/^(注文|order)$/.test(t) || t === '注文') return 'order';
    if (/返金|refund|chargeback|チャージバック|保証請求|atoz|guarantee/.test(t)) return 'refund';
    if (/振込|transfer|送金/.test(t)) return 'transfer';
    if (/調整|adjustment|補填|reimburse/.test(t)) return 'adjust';
    if (/手数料|fee|料金|サービス|service|subscription|月額|広告|cost of advertising|注文外|在庫|storage|保管/.test(t)) return 'fee';
    if (/注文|order/.test(t)) return 'order';
    return 'other';
  }
  var TYPE_LABEL = { order: '注文', refund: '返金', adjust: '調整', transfer: '振込み', fee: '手数料', other: 'その他', sale: '売上', expense: '経費' };
  function asinOf(s) { var m = String(s || '').match(/\bB0[0-9A-Z]{8}\b/i); return m ? m[0].toUpperCase() : ''; }
  function janOf(s) { var m = String(s || '').match(/(?:^|\D)(4[59]\d{11}|\d{13})(?:\D|$)/); return m ? m[1] : ''; }

  /**
   * Amazon のレポートを読む。
   * 返り値 { ok, kind:'amazon', header, map, missing:[], rows:[売上の行], skipped:[{line, reason}], warn:[] }
   * 売上の行: { src:'amazon', ch:'Amazon', date, kind, typeLabel, settle, order, sku, asin, name, qty,
   *   gross(売上・税込: 商品+配送料+ギフト), disc(値引き: プロモーション・ポイント、マイナス), fee(手数料・プラス),
   *   ship(自分で払った送料: 0), other(調整などの ±), withheld, net(合計=入金額), key(重複の判定) }
   */
  function parseAmazon(text) {
    var rows = parseCSV(text), h = findHeader(rows, AMZ_COLS, 6);
    var out = { ok: false, kind: 'amazon', header: [], map: {}, missing: [], rows: [], skipped: [], warn: [] };
    if (h.idx < 0) return out;
    out.ok = true; out.header = rows[h.idx]; out.map = h.map;
    ['date', 'type', 'total'].forEach(function (k) { if (h.map[k] == null) out.missing.push(k); });
    if (out.missing.length) { out.ok = false; return out; }
    var M = h.map, g = function (r, k) { return M[k] == null ? '' : r[M[k]]; }, n = function (r, k) { return num(g(r, k)); };
    for (var i = h.idx + 1; i < rows.length; i++) {
      var r = rows[i], d = date(g(r, 'date'));
      if (!d) { out.skipped.push({ line: i + 1, reason: '日付が読めません' }); continue; }
      var kind = amzType(g(r, 'type'));
      var gross = n(r, 'sales') + n(r, 'salesTax') + n(r, 'ship') + n(r, 'shipTax') + n(r, 'gift') + n(r, 'giftTax');
      var disc = n(r, 'promo') + n(r, 'promoTax') + n(r, 'point');
      var fee = -(n(r, 'sellFee') + n(r, 'fbaFee') + n(r, 'otherFee'));
      var other = n(r, 'other'), withheld = n(r, 'withheld'), total = n(r, 'total');
      var diff = round(gross + disc + withheld - fee + other - total);
      if (Math.abs(diff) > 1) { other += -diff; out.warn.push({ line: i + 1, msg: '内訳の合計と「合計」が ' + diff + ' 円ずれています(差は調整に入れました)' }); }
      var sku = String(g(r, 'sku') || '').trim(), desc = String(g(r, 'desc') || '').trim();
      var row = {
        src: 'amazon', ch: 'Amazon', date: d, kind: kind, typeLabel: String(g(r, 'type') || '').trim() || TYPE_LABEL[kind],
        settle: String(g(r, 'settle') || '').trim(), order: String(g(r, 'order') || '').trim(), sku: sku, asin: asinOf(sku + ' ' + desc), jan: janOf(sku),
        name: desc, qty: Math.abs(num(g(r, 'qty'))) || (kind === 'order' || kind === 'refund' ? 1 : 0),
        gross: round(gross), disc: round(disc), fee: round(fee), ship: 0, other: round(other), withheld: round(withheld), net: round(total),
        fulfil: String(g(r, 'fulfil') || '').trim()
      };
      row.key = ['amazon', row.settle, row.date, row.kind, row.order, row.sku, row.net, row.gross, row.fee].join('|');
      out.rows.push(row);
    }
    // 同じファイルの中で全く同じ行(同じ注文の同じ品が2行)には連番を付けて別物にする
    var seen = {};
    out.rows.forEach(function (r) { var k = r.key; seen[k] = (seen[k] || 0) + 1; if (seen[k] > 1) r.key = k + '#' + seen[k]; });
    return out;
  }

  /* ==================================================================
     メルカリ(取引画面・売上履歴の文字の貼り付け)
     ================================================================== */
  var MC_LABEL = [
    ['price', /^(商品代金|販売価格|商品価格|価格)$/],
    ['fee', /^(販売手数料|手数料)$/],
    ['ship', /^(配送料|送料|配送料金)$/],
    ['net', /^(販売利益|売上金|利益|受取金額|売上)$/],
    ['date', /^(購入日時|取引日時|取引日|購入日|日付|取引完了日時|取引完了日|発送日時|受取評価日時)$/],
    ['id', /^(商品ID|取引ID|注文番号|取引番号)$/],
    ['name', /^(商品名)$/],
    ['method', /^(配送の方法|配送方法)$/]
  ];
  function labelOf(s) {
    var t = z2h(s).replace(/[\s:：]/g, '');
    for (var i = 0; i < MC_LABEL.length; i++) if (MC_LABEL[i][1].test(t)) return MC_LABEL[i][0];
    return null;
  }
  var MONEY = /^[+\-−]?\s*[¥￥]\s*[\d,，]+$|^[+\-−]?[\d,，]+\s*円$/;
  var NOISE = /^(取引画面|取引情報|商品情報|購入者情報|発送通知|評価|取引メッセージ|商品の情報|ご購入ありがとうございます|この商品の取引|取引が完了しました|お届け先|配送状況|購入者|出品者|コメント|いいね|送料込み|送料込み\(出品者負担\)|出品者負担|着払い\(購入者負担\)|もっと見る|閉じる|戻る|やることリスト|お知らせ|メルカリ|売上・振込申請|売上履歴|すべて|売上金|ポイント|メルペイ残高|内訳|詳細|\d+件)$/;
  /**
   * メルカリの取引画面(出品者側)・売上履歴の文字を読む。複数の取引をまとめて貼ってもよい。
   * 返り値 { ok, kind:'mercari', rows:[売上の行], warn:[] }
   */
  function parseMercari(text, opts) {
    opts = opts || {};
    var defYear = opts.year || new Date().getFullYear();
    var lines = String(text || '').split(/\r?\n/).map(function (l) { return z2h(l).replace(/\s+/g, ' ').trim(); }).filter(Boolean);
    var recs = [], cur = null, warn = [];
    function flush() { if (cur && (cur.price || cur.net)) recs.push(cur); cur = null; }
    function start() { flush(); cur = { names: [] }; }
    function put(k, v) {
      if (!cur) start();
      if (k === 'price' && cur.price != null) start(); // 2件目の取引
      if (k === 'net' && cur.net != null && cur.price == null) start(); // 売上履歴: 利益だけの行が続く
      cur[k] = v;
    }
    for (var i = 0; i < lines.length; i++) {
      var L = lines[i], k = null, v = null, m;
      // 「商品代金 ¥3,000」「販売手数料：-¥300」のように1行にある形
      m = L.match(/^([^\d¥￥+\-−]+?)\s*[:：]?\s*([+\-−]?\s*[¥￥]\s*[\d,]+|[+\-−]?[\d,]+\s*円)$/);
      var m2 = !m && L.match(/^(\S+?)(?:\s*[:：]\s*|\s+)(.+)$/);
      if (m && labelOf(m[1])) { k = labelOf(m[1]); v = m[2]; }
      else if (m2 && /^(date|id|name|method)$/.test(labelOf(m2[1]) || '')) { k = labelOf(m2[1]); v = m2[2]; }
      else if (labelOf(L) === 'net' && cur && cur.hist && cur.net == null) continue; // 売上履歴の「販売利益」の見出し
      else if (labelOf(L)) {
        k = labelOf(L);
        v = lines[i + 1] || ''; i++;
        if ((k === 'price' || k === 'fee' || k === 'ship' || k === 'net') && !MONEY.test(v.replace(/\s/g, ''))) {
          // 「配送料」の次が「らくらくメルカリ便」などで金額が更に後ろ
          var j = i; while (j < lines.length - 1 && j < i + 3 && !MONEY.test(lines[j].replace(/\s/g, ''))) j++;
          if (MONEY.test(lines[j].replace(/\s/g, ''))) { v = lines[j]; i = j; } else { v = ''; i--; }
        }
      } else if ((m = L.match(/^(\d{4}[\/年.-]\d{1,2}[\/月.-]\d{1,2}日?)(?:\s+\d{1,2}:\d{2})?(?:\s+(.*))?$/))) {
        // 売上履歴: 「2026/10/20 12:34」の行、続けて 内容 と 金額
        var d0 = date(m[1], defYear), rest = m[2] || '';
        var mm = rest.match(/([+\-−]?\s*[¥￥]\s*[\d,]+)\s*$/);
        if (cur && cur.price != null && !cur.date) { cur.date = d0; continue; }
        start(); cur.date = d0; cur.hist = true;
        if (rest) { var nm = rest.replace(/([+\-−]?\s*[¥￥]\s*[\d,]+)\s*$/, '').replace(/^(売上|販売利益)\s*/, '').trim(); if (nm) cur.names.push(nm); }
        if (mm) cur.net = num(mm[1]);
        continue;
      } else if (MONEY.test(L.replace(/\s/g, '')) && cur && cur.hist && cur.net == null) { cur.net = num(L); continue; }
      else if (/^(m\d{9,12}|\d{10,12})$/i.test(L) && cur && !cur.id) { cur.id = L; continue; }
      else if (/^(売上|販売利益)$/.test(L) && cur && cur.hist) continue;
      if (k) {
        if (k === 'price' || k === 'fee' || k === 'ship' || k === 'net') put(k, Math.abs(num(v)));
        else if (k === 'date') { if (!cur) start(); cur.date = date(v, defYear); }
        else if (k === 'id') { if (!cur) start(); cur.id = String(v).trim(); }
        else if (k === 'name') { if (!cur) start(); cur.names.unshift(String(v).trim()); }
        else if (k === 'method') { if (!cur) start(); cur.method = v; }
        continue;
      }
      if (NOISE.test(L) || /^[¥￥]/.test(L) || L.length < 2) continue;
      if (/^(らくらく|ゆうゆう|梱包・発送たのメル便|普通郵便|ゆうパケット|ネコポス|宅急便|クリックポスト|レターパック|エクスプレス配送)/.test(L)) { if (cur) cur.method = L; continue; }
      if (/^(商品の状態|カテゴリー|ブランド|発送元の地域|発送までの日数|配送料の負担)/.test(L)) { i++; continue; }
      // 商品名らしい行(次の取引の頭のこともある)
      if (cur && cur.price != null && cur.net != null) start();
      if (!cur) start();
      if (cur.names.length < 3) cur.names.push(L);
    }
    flush();
    var rows = recs.map(function (c, idx) {
      var price = c.price, fee = c.fee, ship = c.ship, net = c.net, est = [];
      if (price == null && net != null && c.hist) { // 売上履歴は利益だけ: 手数料10%・送料は不明
        price = null;
      }
      if (price != null) {
        if (fee == null) { fee = Math.floor(price * 0.1); est.push('手数料(10%で計算)'); }
        if (ship == null && net != null) ship = Math.max(0, price - fee - net);
        if (ship == null) { ship = 0; est.push('送料(不明・0円)'); }
        if (net == null) net = price - fee - ship;
        var diff = price - fee - ship - net;
        if (Math.abs(diff) > 1) warn.push({ line: idx + 1, msg: '商品代金・手数料・送料・販売利益の計算が ' + diff + ' 円合いません' });
      }
      var name = (c.names || []).filter(function (s) { return !/^[¥￥\d]/.test(s); })[0] || '';
      var r = {
        src: 'mercari', ch: 'メルカリ', date: c.date || '', kind: 'sale', typeLabel: '売上', settle: '', order: c.id || '', sku: '', asin: '', jan: '',
        name: name, qty: 1, gross: price != null ? round(price) : round(net), disc: 0, fee: price != null ? round(fee) : 0, ship: price != null ? round(ship) : 0,
        other: 0, withheld: 0, net: round(net), method: c.method || '', est: price != null ? est : ['売上履歴の金額(販売利益)のみ。取引画面を貼ると手数料と送料に分かれます']
      };
      r.key = 'mercari|' + (r.order || [r.date, r.name, r.gross, r.net].join('|'));
      return r;
    }).filter(function (r) { return r.gross || r.net; });
    rows.forEach(function (r, i) { if (!r.date) warn.push({ line: i + 1, msg: '「' + (r.name || '取引' + (i + 1)) + '」の日付が読めません。日付を入れてください' }); });
    return { ok: rows.length > 0, kind: 'mercari', rows: rows, warn: warn };
  }

  /* ==================================================================
     汎用CSV(列の自動判定)
     ================================================================== */
  var GEN_COLS = {
    date: ['日付', '取引日', '利用日', 'ご利用日', '利用年月日', 'ご利用年月日', '売上日', '購入日', '発生日', '注文日', '決済日', '日時', 'date', '年月日'],
    name: ['利用店名', 'ご利用店名', 'ご利用先', '利用先', 'ご利用店名・商品名', '利用店名・商品名', '摘要', '内容', '店名', '商品名', '品名', '取引内容', '明細', 'description', 'item', 'name', '件名', 'お取引内容'],
    amount: ['利用金額', 'ご利用金額', '支払金額', 'お支払金額', '請求金額', 'ご請求金額', '今回請求額', '金額', '売上金額', '販売価格', '売上', '合計', '支払総額', 'amount', 'price', '税込金額', '出金', '出金額', 'お支払い金額', '利用金額(円)'],
    fee: ['手数料', '販売手数料', 'fee', 'fees'],
    ship: ['送料', '配送料', 'shipping'],
    order: ['注文番号', '取引ID', '注文ID', '伝票番号', 'order id', 'order', '管理番号'],
    sku: ['SKU', 'JAN', 'ASIN', '商品コード', '品番'],
    qty: ['数量', '個数', 'quantity', 'qty'],
    acct: ['勘定科目', '科目', '費目', 'カテゴリ', 'カテゴリー', '分類', 'category'],
    memo: ['メモ', '備考', 'note', 'memo']
  };
  var FIELD_LABEL = { date: '日付', name: '内容・店名', amount: '金額', fee: '手数料', ship: '送料', order: '注文番号', sku: 'SKU・JAN', qty: '数量', acct: '科目', memo: 'メモ' };
  /**
   * 汎用CSVの見出しと列の当てはめを推測する。
   * 返り値 { headerIdx, header, map:{field: 列番号}, rows(見出しより下の行), kind:'expense'|'sale'(推測), card(カード明細らしい) }
   */
  function detectColumns(rowsOrText) {
    var rows = typeof rowsOrText === 'string' ? parseCSV(rowsOrText) : rowsOrText;
    var h = findHeader(rows, GEN_COLS, 2), headerIdx = h.idx, map = h.map;
    if (headerIdx < 0) { headerIdx = -1; map = {}; }
    var body = rows.slice(headerIdx + 1), width = Math.max.apply(null, [0].concat(rows.map(function (r) { return r.length; })));
    var sample = body.slice(0, 50);
    function score(j, test) { var ok = 0, all = 0; sample.forEach(function (r) { var v = String(r[j] == null ? '' : r[j]).trim(); if (!v) return; all++; if (test(v)) ok++; }); return all ? ok / all : 0; }
    // 中身から推測(見出しで決まらなかった欄)
    var used = {}; Object.keys(map).forEach(function (k) { used[map[k]] = 1; });
    if (map.date == null) for (var j = 0; j < width; j++) if (!used[j] && score(j, function (v) { return !!date(v); }) > 0.8) { map.date = j; used[j] = 1; break; }
    if (map.amount == null) {
      var best = -1, bs = 0;
      for (var j2 = width - 1; j2 >= 0; j2--) { if (used[j2]) continue; var s = score(j2, function (v) { return /^[+\-−(]?[¥￥]?\s*[\d,]+(\.\d+)?\)?円?$/.test(z2h(v).replace(/\s/g, '')) && !date(v); }); if (s > bs + 0.05) { bs = s; best = j2; } }
      if (bs > 0.8) { map.amount = best; used[best] = 1; }
    }
    if (map.name == null) {
      var bl = 0, bj = -1;
      for (var j3 = 0; j3 < width; j3++) { if (used[j3]) continue; var len = 0, c = 0; sample.forEach(function (r) { var v = String(r[j3] || ''); if (/[^\d\s,.\-\/:¥￥円]/.test(v)) { len += v.length; c++; } }); if (c >= sample.length * 0.6 && len > bl) { bl = len; bj = j3; } }
      if (bj >= 0) { map.name = bj; used[bj] = 1; }
    }
    var hd = headerIdx >= 0 ? rows[headerIdx].join(' ') : '';
    var card = /利用店|ご利用|請求|カード|支払区分|お支払/.test(hd);
    var sale = /売上|販売|注文|order|sales/i.test(hd) && !card;
    return { headerIdx: headerIdx, header: headerIdx >= 0 ? rows[headerIdx] : [], map: map, rows: body, width: width, kind: sale ? 'sale' : 'expense', card: card };
  }
  /** 当てはめに従って行を作る。kind: 'sale' | 'expense' */
  function applyMapping(body, map, kind, opts) {
    opts = opts || {};
    var out = [], skipped = [];
    // 経費: 金額がほとんどマイナス(銀行の出金など)なら符号を反転(払い戻しはマイナスの経費になる)
    var negs = 0, alls = 0;
    if (kind !== 'sale') body.forEach(function (r) { var v = map.amount == null ? 0 : num(r[map.amount]); if (v) { alls++; if (v < 0) negs++; } });
    var flip = alls > 0 && negs / alls > 0.5;
    body.forEach(function (r, i) {
      var g = function (k) { return map[k] == null || map[k] < 0 ? '' : String(r[map[k]] == null ? '' : r[map[k]]).trim(); };
      var d = date(g('date'), opts.year), amt = num(g('amount'));
      if (!d || !amt) { skipped.push({ line: i + 1, reason: !d ? '日付が読めません' : '金額が0か読めません', raw: r.join(' / ') }); return; }
      if (kind === 'sale') {
        var fee = Math.abs(num(g('fee'))), ship = Math.abs(num(g('ship')));
        var row = { src: 'csv', ch: opts.ch || 'その他', date: d, kind: amt < 0 ? 'refund' : 'sale', typeLabel: amt < 0 ? '返金' : '売上', settle: '', order: g('order'), sku: g('sku'), asin: asinOf(g('sku') + ' ' + g('name')), jan: janOf(g('sku')),
          name: g('name'), qty: Math.abs(num(g('qty'))) || 1, gross: round(amt), disc: 0, fee: round(fee) * (amt < 0 ? -1 : 1), ship: round(ship), other: 0, withheld: 0, net: round(amt - fee - ship) };
        row.key = 'csv|' + [row.ch, row.date, row.order, row.name, row.gross].join('|');
        out.push(row);
      } else {
        var payee = g('name');
        var e = { src: 'csv', date: d, acct: g('acct') && ACCTS.indexOf(g('acct')) >= 0 ? g('acct') : guessAcct(payee, opts.rules), amount: round(amt) * (flip ? -1 : 1), payee: payee, memo: g('memo'), biz: 100 };
        e.key = 'exp|' + [e.date, e.payee, e.amount].join('|');
        out.push(e);
      }
    });
    var seen = {};
    out.forEach(function (r) { seen[r.key] = (seen[r.key] || 0) + 1; if (seen[r.key] > 1) r.key += '#' + seen[r.key]; });
    return { rows: out, skipped: skipped };
  }
  /** ファイルの種類を見分けて読む */
  function sniff(text) {
    var rows = parseCSV(text);
    var a = findHeader(rows, AMZ_COLS, 6);
    if (a.idx >= 0 && a.map.type != null && a.map.total != null) return 'amazon';
    var lines = String(text).split(/\r?\n/).filter(function (l) { return l.trim(); });
    var tabular = lines.filter(function (l) { return l.split(/[,\t]/).length >= 3; }).length;
    if (tabular < lines.length / 2 && /(販売利益|販売手数料|商品代金|売上履歴)/.test(text)) return 'mercari';
    return 'generic';
  }

  /* ==================================================================
     経費
     ================================================================== */
  var ACCTS = ['荷造運賃', '消耗品費', '通信費', '支払手数料', '旅費交通費', '地代家賃', '水道光熱費', '広告宣伝費', '外注工賃', '新聞図書費', '租税公課', '接待交際費', '修繕費', '損害保険料', '雑費'];
  var ACCT_HINT = {
    荷造運賃: '送料・梱包材・段ボール', 消耗品費: '10万円未満の道具・文具・テープ', 通信費: 'スマホ・ネット・ツール月額', 支払手数料: '振込手数料・販売手数料・プラン月額',
    旅費交通費: '仕入れの交通費・ガソリン・駐車場', 地代家賃: '倉庫・事務所(自宅は按分)', 水道光熱費: '電気・ガス・水道(按分)', 広告宣伝費: '広告・販促', 外注工賃: '発送代行・検品・撮影の外注',
    新聞図書費: '本・雑誌・有料記事', 租税公課: '印紙・事業税・自動車税(事業分)', 接待交際費: '取引先との飲食・贈答', 修繕費: '道具・車の修理', 損害保険料: '事業の保険', 雑費: 'どれにも当てはまらない少額'
  };
  var RULES = [
    [/ヤマト|クロネコ|日本郵便|郵便局|ゆうパック|佐川|西濃|福山通運|クリックポスト|レターパック|宅急便|ネコポス|送料/, '荷造運賃'],
    [/段ボール|ダンボール|梱包|プチプチ|緩衝|OPP|テープ/, '荷造運賃'],
    [/ダイソー|セリア|キャンドゥ|100円|ホームセンター|カインズ|コーナン|DCM|ニトリ|ヨドバシ|ビックカメラ|ケーズ|ヤマダ|文具|アスクル|ロハコ|モノタロウ/, '消耗品費'],
    [/ドコモ|docomo|au |KDDI|ソフトバンク|softbank|楽天モバイル|ワイモバイル|UQ|ahamo|povo|LINEMO|NTT|フレッツ|ニフティ|ビッグローブ|ソネット|so-net|google|apple\.com|icloud|adobe|keepa|chatgpt|openai|anthropic|claude|プライスター|マカド|サーバー|ドメイン/i, '通信費'],
    [/振込手数料|手数料|amazon.*(出品|月額)|大口出品|paypal/i, '支払手数料'],
    [/JR|鉄道|メトロ|地下鉄|バス|タクシー|ETC|高速|NEXCO|駐車|パーキング|タイムズ|ガソリン|ENEOS|エネオス|出光|コスモ石油|昭和シェル|suica|pasmo|icoca/i, '旅費交通費'],
    [/電力|でんき|電気|ガス|水道/, '水道光熱費'],
    [/家賃|レンタル倉庫|トランクルーム|コンテナ/, '地代家賃'],
    [/書店|紀伊國屋|ジュンク|丸善|蔦屋|TSUTAYA|kindle|note\.com|新聞/i, '新聞図書費'],
    [/発送代行|代行|外注|ランサーズ|クラウドワークス|ココナラ/, '外注工賃'],
    [/広告|PR|スポンサー/, '広告宣伝費'],
    [/収入印紙|印紙|税務署|都税|県税|市税|自動車税/, '租税公課']
  ];
  /** 支払先の文字から科目を推測(使う人が選んだ科目を覚えた rules を優先) */
  function guessAcct(payee, rules) {
    var p = z2h(payee || '');
    if (rules) { var k = payeeKey(p); if (rules[k]) return rules[k]; }
    for (var i = 0; i < RULES.length; i++) if (RULES[i][0].test(p)) return RULES[i][1];
    return '雑費';
  }
  function payeeKey(p) { return norm(p).replace(/\d+/g, '').slice(0, 16); }
  /** 事業の分(家事按分) */
  function bizAmount(e) { var b = e.biz == null || e.biz === '' ? 100 : Number(e.biz); return round((Number(e.amount) || 0) * Math.max(0, Math.min(100, b)) / 100); }
  /**
   * 毎月の経費から、まだ無い月の経費を作る。recur: [{id, day, acct, amount, payee, memo, biz, start:'YYYY-MM', end:'YYYY-MM'|''}]
   * 返り値: 新しく作る経費の配列(既にある月は作らない)
   */
  function dueRecurring(recur, expenses, today) {
    var have = {}, out = [];
    (expenses || []).forEach(function (e) { if (e.recurId) have[e.recurId + '|' + String(e.date).slice(0, 7)] = 1; });
    (recur || []).forEach(function (r) {
      if (!r || !r.start || !(Number(r.amount) > 0)) return;
      var y = +r.start.slice(0, 4), m = +r.start.slice(5, 7), day = Math.min(28, Math.max(1, Number(r.day) || 1));
      for (var guard = 0; guard < 120; guard++) {
        var ym = y + '-' + pad(m), d = ym + '-' + pad(day);
        if (d > today) break;
        if (r.end && ym > r.end) break;
        if (!have[r.id + '|' + ym]) out.push({ date: d, acct: r.acct, amount: round(r.amount), payee: r.payee || '', memo: r.memo || '', biz: r.biz == null ? 100 : r.biz, recurId: r.id, src: 'recur' });
        m++; if (m > 12) { m = 1; y++; }
      }
    });
    return out;
  }

  /* ==================================================================
     台帳との照合
     ================================================================== */
  function ledgerCodes(r) {
    var s = [r.feature, r.name, r.sku, r.memo].join(' ');
    return { asin: asinOf(s), jan: janOf(s), sku: String(r.sku || '').trim() };
  }
  function sold(r) { return !!r.saleDate; }
  /**
   * 売上の行に合う台帳の行を探す。注文番号 → SKU → ASIN・JAN → 品名の一部、の順。
   * 返り値 { id, by:'order'|'sku'|'asin'|'jan'|'name', sure:boolean } または null
   * taken: すでに他の行に使った台帳のid(同じ品を2回売らない)
   */
  function matchLedger(sale, ledger, taken) {
    taken = taken || {};
    if (sale.kind !== 'order' && sale.kind !== 'sale') return null;
    var rows = (ledger || []).filter(function (r) { return !r.wait && !taken[r.id]; });
    if (sale.order) { var o = rows.filter(function (r) { return r.saleOrder && r.saleOrder === sale.order; })[0]; if (o) return { id: o.id, by: 'order', sure: true }; }
    var open = rows.filter(function (r) { return !sold(r) || (sale.date && r.saleDate === sale.date && !r.saleRef); })
      .sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); }); // 古い仕入れから(先入先出)
    function pick(test, by) { var hit = open.filter(test)[0]; return hit ? { id: hit.id, by: by, sure: true } : null; }
    var m = null;
    if (sale.sku) m = pick(function (r) { return r.sku && String(r.sku).trim() === sale.sku; }, 'sku');
    if (!m && sale.asin) m = pick(function (r) { return ledgerCodes(r).asin === sale.asin; }, 'asin');
    if (!m && sale.jan) m = pick(function (r) { return ledgerCodes(r).jan === sale.jan; }, 'jan');
    if (!m && sale.sku) { var sj = janOf(sale.sku), sa = asinOf(sale.sku); if (sj || sa) m = pick(function (r) { var c = ledgerCodes(r); return (sj && c.jan === sj) || (sa && c.asin === sa); }, sj ? 'jan' : 'asin'); }
    if (!m && sale.name) {
      var sn = norm(sale.name);
      var cands = open.filter(function (r) { var rn = norm(r.name); return rn.length >= 6 && sn.length >= 6 && (sn.indexOf(rn.slice(0, 14)) >= 0 || rn.indexOf(sn.slice(0, 14)) >= 0); });
      if (cands.length) m = { id: cands[0].id, by: 'name', sure: false };
    }
    return m;
  }
  /** 照合の候補(手で選ぶ時): 未売却の行を、品名が近い順に */
  function candidates(sale, ledger, limit) {
    var sn = norm(sale.name || '');
    function sim(r) {
      var rn = norm(r.name || ''); if (!rn || !sn) return 0;
      var grams = {}, hit = 0, tot = 0;
      for (var i = 0; i < rn.length - 1; i++) grams[rn.substr(i, 2)] = 1;
      for (var j = 0; j < sn.length - 1; j++) { tot++; if (grams[sn.substr(j, 2)]) hit++; }
      return tot ? hit / tot : 0;
    }
    return (ledger || []).filter(function (r) { return !r.wait && !sold(r); })
      .map(function (r) { return { r: r, s: sim(r) }; })
      .sort(function (a, b) { return b.s - a.s || String(a.r.date).localeCompare(String(b.r.date)); })
      .slice(0, limit || 30).map(function (x) { return x.r; });
  }

  /* ==================================================================
     集計の元(売上・原価・手数料・送料・経費)
     ================================================================== */
  var CH_OF_SELL = function (s) {
    s = String(s || '');
    if (/amazon/i.test(s)) return 'Amazon'; if (/メルカリ/.test(s)) return 'メルカリ'; if (/ヤフオク|オークション/.test(s)) return 'ヤフオク'; if (/ラクマ/.test(s)) return 'ラクマ';
    return s || 'その他';
  };
  /** 仕入れ先を集計向けに丸める(「楽天市場 ○○ショップ」→「楽天市場」) */
  function partyGroup(p) {
    p = String(p || '').trim();
    if (!p) return '(仕入れ先なし)';
    var m = p.match(/^(楽天市場|Yahoo!ショッピング|Yahoo!オークション|メルカリ|ラクマ|PayPayフリマ|Amazon|店舗|ブックオフ|セカンドストリート|ハードオフ)/);
    return m ? m[1] : p.split(/\s+/)[0];
  }
  /**
   * 1件ずつの「売れた」記録にまとめる(月・ルート・仕入れ先の集計と申告の元)。
   * - 取り込んだ売上(台帳と照合済みなら原価つき)
   * - 台帳で売れた行のうち、取り込んだ売上と結び付いていない行(売値と見込み利益から手数料・送料を推定)
   * 返り値 [{ id, date, src:'import'|'ledger', saleId, ledgerId, kind, ch, route, party, name, qty, sales, cogs, fee, ship, other, est }]
   */
  function events(data) {
    var L = data.ledger || [], S = data.sales || [], byId = {}, linked = {};
    L.forEach(function (r) { byId[r.id] = r; });
    S.forEach(function (s) { if (s.ledgerId) linked[s.ledgerId] = 1; });
    var out = [];
    S.forEach(function (s) {
      if (s.kind === 'transfer') return;
      var lr = s.ledgerId ? byId[s.ledgerId] : null;
      var cogs = lr && (s.kind === 'order' || s.kind === 'sale') ? round((Number(lr.unit) || 0) * (Number(lr.qty) || 1)) : 0;
      out.push({ id: 's:' + s.id, date: s.date, src: 'import', saleId: s.id, ledgerId: lr ? lr.id : '', kind: s.kind, ch: s.ch || 'その他',
        route: lr ? (lr.route || '(ルートなし)') : (s.ch || 'その他') + '(台帳と未照合)', party: lr ? partyGroup(lr.party) : '(台帳と未照合)', name: s.name || (lr && lr.name) || '',
        qty: s.qty || 0, sales: round((Number(s.gross) || 0) + (Number(s.disc) || 0)), cogs: cogs, fee: round(s.fee), ship: round(s.ship), other: round(s.other) + round(s.withheld), est: false, nocost: !lr && (s.kind === 'order' || s.kind === 'sale') });
    });
    L.forEach(function (r) {
      if (r.wait || !r.saleDate || linked[r.id]) return;
      var q = Number(r.qty) || 1, sale = round((Number(r.salePrice) || 0) * q), cost = round((Number(r.unit) || 0) * q);
      var pf = r.profit === '' || r.profit == null ? null : Number(r.profit) * q;
      // 見込み利益の計算のときの売値と、実際の売値の差は利益にそのまま足す(手数料は予定の売値での額のまま)
      var plan = round((Number(r.sellPrice) || Number(r.salePrice) || 0) * q);
      var costs = pf == null ? 0 : Math.max(0, plan - cost - round(pf));
      out.push({ id: 'l:' + r.id, date: r.saleDate, src: 'ledger', saleId: '', ledgerId: r.id, kind: 'sale', ch: CH_OF_SELL(r.sellTo), route: r.route || '(ルートなし)', party: partyGroup(r.party), name: r.name || '',
        qty: q, sales: sale, cogs: cost, fee: costs, ship: 0, other: 0, est: true, nocost: false });
    });
    return out.sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
  }
  function emptyAgg() { return { sales: 0, cogs: 0, fee: 0, ship: 0, other: 0, exp: 0, profit: 0, n: 0, est: 0, nocost: 0 }; }
  function addEv(a, e) { a.sales += e.sales; a.cogs += e.cogs; a.fee += e.fee; a.ship += e.ship; a.other += e.other; a.n++; if (e.est) a.est++; if (e.nocost) a.nocost++; }
  function finish(a) { a.gross = a.sales + a.other - a.cogs - a.fee - a.ship; a.profit = a.gross - a.exp; a.rate = a.sales ? a.profit / a.sales : 0; a.grate = a.sales ? a.gross / a.sales : 0; return a; }
  /**
   * 月ごとの利益。year: 2026。返り値 { months:[{ym, ...agg}], total }
   * 利益 = 売上 + 調整 − 売上原価 − 手数料 − 送料 − 経費(事業の分)
   * 売上原価はその月に売れた品の仕入れ値(月次の目安。申告の売上原価は期首+仕入−期末で別に計算)
   */
  function monthly(data, year) {
    var ev = events(data), months = {}, y = String(year);
    for (var m = 1; m <= 12; m++) months[y + '-' + pad(m)] = emptyAgg();
    ev.forEach(function (e) { var k = String(e.date).slice(0, 7); if (months[k]) addEv(months[k], e); });
    (data.expenses || []).forEach(function (x) { var k = String(x.date).slice(0, 7); if (months[k]) months[k].exp += bizAmount(x); });
    var total = emptyAgg(), list = Object.keys(months).sort().map(function (k) {
      var a = finish(months[k]); a.ym = k;
      ['sales', 'cogs', 'fee', 'ship', 'other', 'exp', 'n', 'est', 'nocost'].forEach(function (f) { total[f] += a[f]; });
      return a;
    });
    return { months: list, total: finish(total) };
  }
  /** ルート別・仕入れ先別・売り先別(経費は分けられないので粗利まで) */
  function groupBy(data, year, key) {
    var g = {}, y = String(year);
    events(data).forEach(function (e) {
      if (String(e.date).slice(0, 4) !== y) return;
      var k = e[key] || '(なし)'; if (!g[k]) g[k] = emptyAgg(); addEv(g[k], e);
    });
    return Object.keys(g).map(function (k) { var a = finish(g[k]); a.key = k; return a; }).sort(function (a, b) { return b.sales - a.sales; });
  }

  /* ==================================================================
     売れ残り
     ================================================================== */
  /** 売り先ごとの手数料率の目安(売値に比例する分)。Amazonは販売手数料10%前後+税 */
  var CH_RATE = { Amazon: 0.11, メルカリ: 0.10, ヤフオク: 0.10, ラクマ: 0.10, その他: 0.10 };
  /**
   * 損益ゼロになる売値の目安。見込み利益の計算に使った売値・利益から、売値に比例しない費用(送料・FBA手数料など)を逆算する。
   */
  function breakEven(r) {
    var unit = Number(r.unit) || 0, rate = CH_RATE[CH_OF_SELL(r.sellTo)] || 0.1;
    var sell = Number(r.sellPrice) || 0, pf = r.profit === '' || r.profit == null ? null : Number(r.profit);
    var fixed = 0;
    if (sell > 0 && pf != null) fixed = Math.max(0, sell - unit - pf - sell * rate);
    return Math.ceil((unit + fixed) / (1 - rate) / 10) * 10;
  }
  /**
   * 売れ残りの一覧。cfg: { days: 全体の日数, cats: {品目: 日数}, items: {id: 日数} }
   * 返り値 [{ r, days, limit, over, be(損益ゼロの売値), suggest(値下げ候補), room(今の予定売値から下げられる幅) }](古い順)
   */
  function stale(ledger, cfg, today) {
    cfg = cfg || {};
    var g = Number(cfg.days) || 60;
    return (ledger || []).filter(function (r) { return !r.wait && !r.saleDate && r.date; }).map(function (r) {
      var limit = Number((cfg.items || {})[r.id]) || Number((cfg.cats || {})[r.hinmoku]) || g;
      var days = daysBetween(r.date, today), be = breakEven(r), plan = Number(r.sellPrice) || 0;
      var suggest = plan ? Math.max(be, Math.floor(plan * 0.9 / 10) * 10) : be;
      return { r: r, days: days, limit: limit, over: days >= limit, be: be, plan: plan, suggest: suggest, room: plan ? plan - be : 0, cost: round((Number(r.unit) || 0) * (Number(r.qty) || 1)) };
    }).sort(function (a, b) { return b.days - a.days; });
  }

  /* ==================================================================
     棚卸
     ================================================================== */
  /** その日の終わりに手元にある在庫(仕入れ済みで、まだ売れていない) */
  function stockAt(ledger, cutoff) {
    return (ledger || []).filter(function (r) { return !r.wait && r.date && r.date <= cutoff && (!r.saleDate || r.saleDate > cutoff); });
  }
  function itemKey(r) { var c = ledgerCodes(r); return c.jan ? 'J' + c.jan : (c.asin ? 'A' + c.asin : 'N' + norm(r.name)); }
  /**
   * 期末の棚卸。method: 'last'(最終仕入原価法・届出をしていない時の方法)/ 'each'(個別法: 1品ずつの仕入れ値)
   * counts: {台帳id: 実地の数量}(数えた行だけ)
   * 返り値 { rows:[{r, qty(帳簿), count(実地|null), price(評価単価), book(帳簿の金額), real(実地の金額), diff}], book, real, counted, total }
   */
  function stocktake(ledger, cutoff, method, counts) {
    counts = counts || {};
    var list = stockAt(ledger, cutoff), last = {};
    if (method === 'last') {
      (ledger || []).forEach(function (r) {
        if (r.wait || !r.date || r.date > cutoff) return;
        var k = itemKey(r); if (!last[k] || r.date >= last[k].date) last[k] = { date: r.date, unit: Number(r.unit) || 0 };
      });
    }
    var book = 0, real = 0, counted = 0;
    var rows = list.map(function (r) {
      var qty = Number(r.qty) || 1, price = method === 'last' ? last[itemKey(r)].unit : (Number(r.unit) || 0);
      var c = counts[r.id] == null || counts[r.id] === '' ? null : Number(counts[r.id]);
      var b = round(price * qty), rl = round(price * (c == null ? qty : c));
      book += b; real += rl; if (c != null) counted++;
      return { r: r, qty: qty, count: c, price: price, book: b, real: rl, diff: c == null ? 0 : c - qty };
    }).sort(function (a, b) { return String(a.r.date).localeCompare(String(b.r.date)); });
    return { rows: rows, book: book, real: real, counted: counted, total: rows.length };
  }
  /** JANで実地の数を1つ足す(同じJANの行のうち、まだ数え切っていない古い行へ) */
  function countScan(rows, counts, code) {
    var hits = rows.filter(function (x) { var c = ledgerCodes(x.r); return c.jan === code || c.asin === code || String(x.r.sku || '') === code; });
    if (!hits.length) return null;
    for (var i = 0; i < hits.length; i++) {
      var id = hits[i].r.id, cur = counts[id] == null ? 0 : Number(counts[id]);
      if (cur < hits[i].qty) { counts[id] = cur + 1; return { id: id, count: cur + 1, of: hits[i].qty, row: hits[i].r }; }
    }
    var h = hits[hits.length - 1]; counts[h.r.id] = (Number(counts[h.r.id]) || 0) + 1;
    return { id: h.r.id, count: counts[h.r.id], of: h.qty, row: h.r, over: true };
  }

  /* ==================================================================
     確定申告用の数字(青色申告決算書・収支内訳書の一般用)
     ================================================================== */
  /** 経費の科目 → 決算書の欄(青色: 番号, 白色: 番号または内訳) */
  var AO_EXP = [['租税公課', '⑧'], ['荷造運賃', '⑨'], ['水道光熱費', '⑩'], ['旅費交通費', '⑪'], ['通信費', '⑫'], ['広告宣伝費', '⑬'], ['接待交際費', '⑭'], ['損害保険料', '⑮'], ['修繕費', '⑯'], ['消耗品費', '⑰'],
    ['外注工賃', '㉑'], ['地代家賃', '㉓'], ['支払手数料', '㉕'], ['新聞図書費', '㉖'], ['雑費', '㉛']];
  var SHIRO_EXP = [['外注工賃', '⑫'], ['地代家賃', '⑮'], ['租税公課', ''], ['荷造運賃', ''], ['水道光熱費', ''], ['旅費交通費', ''], ['通信費', ''], ['広告宣伝費', ''], ['接待交際費', ''], ['損害保険料', ''], ['修繕費', ''], ['消耗品費', ''], ['支払手数料', ''], ['新聞図書費', ''], ['雑費', '']];
  function inYear(d, y) { return String(d || '').slice(0, 4) === String(y); }
  /** 税抜きにする(課税事業者で税抜経理を選んだ時だけ)。10%で割り戻す参考の値 */
  function exTax(n, set, taxable) { return set && set.tax === 'taxable' && set.incl === false && taxable !== false ? round(n * 100 / 110) : round(n); }
  /**
   * 申告用の数字。set: { tax:'exempt'|'taxable', incl:true(税込経理), points:'discount'|'misc', pointYen:数字, opening:数字|null, closing:数字|null, method:'last'|'each' }
   * 返り値 { year, lines:{key: {label, amount, src:[{type,id}]}}, ao:[...], shiro:[...], warn:[] }
   */
  function taxReport(data, year, set) {
    set = set || {};
    var y = String(year), L = data.ledger || [], warn = [];
    var src = {}; function S(k, type, id) { (src[k] = src[k] || []).push({ type: type, id: id }); }
    var ev = events(data).filter(function (e) { return inYear(e.date, y); });
    var sales = 0, misc = 0, fee = 0, ship = 0, nocost = 0, est = 0;
    ev.forEach(function (e) {
      sales += e.sales; if (e.sales) S('sales', e.src, e.src === 'import' ? e.saleId : e.ledgerId);
      if (e.other > 0) { misc += e.other; S('misc', e.src, e.saleId); }
      else if (e.other < 0) { fee += -e.other; S('支払手数料', e.src, e.saleId); }
      if (e.fee) { fee += e.fee; S('支払手数料', e.src, e.src === 'import' ? e.saleId : e.ledgerId); }
      if (e.ship) { ship += e.ship; S('荷造運賃', e.src, e.saleId); }
      if (e.nocost) nocost++; if (e.est) est++;
    });
    // Amazon の手数料だけの行(在庫保管料・月額など)は events に入っている(kind:'fee')
    var pt = round(set.pointYen || 0);
    if (pt && set.points === 'misc') misc += pt;
    // 仕入
    var buy = 0;
    L.forEach(function (r) { if (!r.wait && inYear(r.date, y)) { buy += round((Number(r.unit) || 0) * (Number(r.qty) || 1)); S('buy', 'ledger', r.id); } });
    if (pt && set.points !== 'misc') buy -= pt;
    // 棚卸
    var method = set.method || 'last';
    var openAuto = stocktake(L, (Number(y) - 1) + '-12-31', method, {}).book;
    var closeT = stocktake(L, y + '-12-31', method, set.counts || {});
    var opening = set.opening == null || set.opening === '' ? openAuto : round(set.opening);
    var closing = set.closing == null || set.closing === '' ? closeT.real : round(set.closing);
    stockAt(L, (Number(y) - 1) + '-12-31').forEach(function (r) { S('opening', 'ledger', r.id); });
    closeT.rows.forEach(function (x) { S('closing', 'ledger', x.r.id); });
    // 経費
    var exp = {};
    ACCTS.forEach(function (a) { exp[a] = 0; });
    (data.expenses || []).forEach(function (x) { if (!inYear(x.date, y)) return; var a = ACCTS.indexOf(x.acct) >= 0 ? x.acct : '雑費'; exp[a] += bizAmount(x); S(a, 'expense', x.id); });
    exp['支払手数料'] += fee; exp['荷造運賃'] += ship;
    var tx = function (n, taxable) { return exTax(n, set, taxable); };
    var A = {
      sales: tx(sales), misc: tx(misc, false), opening: opening, buy: tx(buy), closing: closing
    };
    Object.keys(exp).forEach(function (k) { A[k] = tx(exp[k], k !== '租税公課'); });
    A.cogs = A.opening + A.buy - A.closing;
    A.expTotal = ACCTS.reduce(function (s, k) { return s + A[k]; }, 0);
    A.income = A.sales + A.misc - A.cogs - A.expTotal;
    if (nocost) warn.push({ k: 'nocost', msg: '台帳と結び付いていない売上が ' + nocost + ' 件あります。申告の売上原価は「期首+仕入−期末」なので影響しませんが、仕入れが台帳に無い場合は仕入金額が少なくなります。' });
    if (est) warn.push({ k: 'est', msg: '台帳の「売れた」から数えた売上が ' + est + ' 件あります(手数料は見込み利益からの推定)。Amazonのレポートやメルカリの取引画面を取り込むと、実際の金額に置き換わります。' });
    if (set.opening == null || set.opening === '') warn.push({ k: 'opening', msg: '期首商品棚卸高は、台帳から ' + (Number(y) - 1) + '年12月31日 時点の在庫を計算した値です。前の年の決算書の期末商品棚卸高と同じ額にしてください(違う時は申告用の数字の設定で直せます)。' });
    var ao = [
      ['①', '売上(収入)金額(雑収入を含む)', A.sales + A.misc, ['sales', 'misc']],
      ['②', '期首商品棚卸高', A.opening, ['opening']], ['③', '仕入金額', A.buy, ['buy']], ['④', '小計(②+③)', A.opening + A.buy, null],
      ['⑤', '期末商品棚卸高', A.closing, ['closing']], ['⑥', '差引原価(④−⑤)', A.cogs, null], ['⑦', '差引金額(①−⑥)', A.sales + A.misc - A.cogs, null]
    ].concat(AO_EXP.map(function (p) { return [p[1], p[0], A[p[0]], [p[0]]]; }).filter(function (l) { return l[2] || ['荷造運賃', '消耗品費', '通信費', '支払手数料'].indexOf(l[1]) >= 0; }))
      .concat([['㉜', '経費の計', A.expTotal, null], ['㉝', '差引金額(⑦−㉜)', A.income, null]]);
    var shiroOther = SHIRO_EXP.filter(function (p) { return !p[1]; });
    var shiro = [
      ['①', '売上(収入)金額', A.sales, ['sales']], ['②', '家事消費', 0, null], ['③', 'その他の収入', A.misc, ['misc']], ['④', '計(①+②+③)', A.sales + A.misc, null],
      ['⑤', '期首商品棚卸高', A.opening, ['opening']], ['⑥', '仕入金額', A.buy, ['buy']], ['⑦', '小計(⑤+⑥)', A.opening + A.buy, null],
      ['⑧', '期末商品棚卸高', A.closing, ['closing']], ['⑨', '差引原価(⑦−⑧)', A.cogs, null], ['⑩', '差引金額(④−⑨)', A.sales + A.misc - A.cogs, null]
    ].concat(SHIRO_EXP.filter(function (p) { return p[1]; }).map(function (p) { return [p[1], p[0], A[p[0]], [p[0]]]; }))
      .concat([['⑰', 'その他の経費(下の内訳の計)', shiroOther.reduce(function (s, p) { return s + A[p[0]]; }, 0), null]])
      .concat(shiroOther.map(function (p) { return ['', '　' + p[0], A[p[0]], [p[0]], 'sub']; }).filter(function (l) { return l[2] || ['荷造運賃', '消耗品費', '通信費', '支払手数料'].indexOf(l[1].trim()) >= 0; }))
      .concat([['⑱', '経費の計', A.expTotal, null], ['⑲', '専従者控除前の所得金額(⑩−⑱)', A.income, null]]);
    function lines(list) { return list.map(function (l) { var s = []; (l[3] || []).forEach(function (k) { s = s.concat(src[k] || []); }); return { no: l[0], label: l[1], amount: l[2], keys: l[3], src: s, sub: l[4] === 'sub' }; }); }
    return { year: Number(y), A: A, ao: lines(ao), shiro: lines(shiro), warn: warn, closeT: closeT, openAuto: openAuto };
  }

  /* ==================================================================
     仕訳帳(複式)
     ================================================================== */
  /**
   * 台帳・売上・経費から仕訳を作る。set.pay: 仕入れ・経費の支払いの科目(既定 事業主借)
   * 返り値 [{ no, date, dr, cr, amt, memo, src:{type,id}, taxDr, taxCr }](1行=借方1・貸方1)
   * 税区分のキー: 'sale'(課税売上)/ 'buy'(課税仕入)/ 'out'(対象外)/ 'kobutsu'(古物商特例の仕入)
   */
  function journal(data, year, set) {
    set = set || {};
    var y = String(year), pay = set.pay || '事業主借', out = [], no = 0, L = data.ledger || [], byId = {};
    L.forEach(function (r) { byId[r.id] = r; });
    var kob = set.tax === 'taxable' ? kobutsuCheck(L, y) : null, kobOk = {};
    if (kob) kob.rows.forEach(function (x) { if (x.state === 'ok') kobOk[x.r.id] = 1; });
    function J(date, lines, memo, src) { no++; lines.forEach(function (l) { if (!l[2]) return; out.push({ no: no, date: date, dr: l[0], cr: l[1], amt: round(l[2]), memo: (l[3] || memo || '').slice(0, 60), src: src, taxDr: l[4] || 'out', taxCr: l[5] || 'out' }); }); }
    // 期首の棚卸(年の初め)
    var T = taxReport(data, y, set);
    if (T.A.opening) J(y + '-01-01', [['期首商品棚卸高', '商品', T.A.opening, '期首商品棚卸高の振替', 'out', 'out']], '', { type: 'stock', id: 'opening' });
    // 仕入
    L.filter(function (r) { return !r.wait && inYear(r.date, y); }).sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); }).forEach(function (r) {
      var amt = round((Number(r.unit) || 0) * (Number(r.qty) || 1));
      var m = ('仕入 ' + (r.name || '') + (kobOk[r.id] ? ' 古物商特例' : '')).trim();
      J(r.date, [['仕入高', pay, amt, m, kobOk[r.id] ? 'kobutsu' : 'buy', 'out']], '', { type: 'ledger', id: r.id });
    });
    // 売上(取り込み)
    (data.sales || []).filter(function (s) { return inYear(s.date, y); }).sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); }).forEach(function (s) {
      var ar = s.src === 'amazon' ? '売掛金' : '売掛金', nm = (s.ch || '') + ' ' + (s.name || s.typeLabel || '') + (s.order ? ' ' + s.order : '');
      var src = { type: 'sale', id: s.id };
      if (s.kind === 'transfer') { if (s.net) J(s.date, s.net < 0 ? [['普通預金', ar, -s.net, (s.ch || '') + ' 入金', 'out', 'out']] : [[ar, '普通預金', s.net, (s.ch || '') + ' 振込の戻り', 'out', 'out']], '', src); return; }
      var sales = round((Number(s.gross) || 0) + (Number(s.disc) || 0)), lines = [];
      if (sales > 0) lines.push([ar, '売上高', sales, '売上 ' + nm, 'out', 'sale']);
      if (sales < 0) lines.push(['売上高', ar, -sales, '返金 ' + nm, 'sale', 'out']);
      if (s.fee > 0) lines.push(['支払手数料', ar, s.fee, '手数料 ' + nm, 'buy', 'out']);
      if (s.fee < 0) lines.push([ar, '支払手数料', -s.fee, '手数料の戻り ' + nm, 'out', 'buy']);
      if (s.ship > 0) lines.push(['荷造運賃', ar, s.ship, '送料 ' + nm, 'buy', 'out']);
      var oth = round((Number(s.other) || 0) + (Number(s.withheld) || 0));
      if (oth > 0) lines.push([ar, '雑収入', oth, '調整 ' + nm, 'out', 'out']);
      if (oth < 0) lines.push(['支払手数料', ar, -oth, '調整 ' + nm, 'buy', 'out']);
      J(s.date, lines, '', src);
    });
    // 台帳だけの売上(見込み)
    var linked = {}; (data.sales || []).forEach(function (s) { if (s.ledgerId) linked[s.ledgerId] = 1; });
    events(data).filter(function (e) { return e.src === 'ledger' && inYear(e.date, y); }).forEach(function (e) {
      var nm = e.ch + ' ' + e.name;
      J(e.date, [['売掛金', '売上高', e.sales, '売上 ' + nm, 'out', 'sale'], ['支払手数料', '売掛金', e.fee, '手数料(見込み) ' + nm, 'buy', 'out']], '', { type: 'ledger', id: e.ledgerId });
    });
    // 経費
    (data.expenses || []).filter(function (x) { return inYear(x.date, y); }).sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); }).forEach(function (x) {
      var a = bizAmount(x); if (!a) return;
      var m = (x.payee || '') + (x.memo ? ' ' + x.memo : '') + (Number(x.biz) < 100 ? ' (事業' + x.biz + '%)' : '');
      J(x.date, [[x.acct || '雑費', pay, a, m.trim() || x.acct, x.acct === '租税公課' ? 'out' : 'buy', 'out']], '', { type: 'expense', id: x.id });
    });
    // ポイント
    var pt = round(set.pointYen || 0);
    if (pt) J(y + '-12-31', [[pay, set.points === 'misc' ? '雑収入' : '仕入高', pt, set.points === 'misc' ? '仕入れで付いたポイント(雑収入)' : '仕入れで付いたポイント(仕入値引き)', 'out', set.points === 'misc' ? 'out' : 'buy']], '', { type: 'points', id: 'points' });
    // 期末の棚卸(年の終わり)
    if (T.A.closing) J(y + '-12-31', [['商品', '期末商品棚卸高', T.A.closing, '期末商品棚卸高の振替', 'out', 'out']], '', { type: 'stock', id: 'closing' });
    return out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.no - b.no; });
  }

  /* ---------- 会計ソフト向けの書き出し ---------- */
  var SOFT = {
    freee: { label: 'freee会計', acct: { '期首商品棚卸高': '期首商品棚卸', '期末商品棚卸高': '期末商品棚卸', '仕入高': '仕入高' } },
    mf: { label: 'マネーフォワード クラウド確定申告', acct: {} },
    yayoi: { label: 'やよいの青色申告', acct: { '仕入高': '仕入高' } }
  };
  function taxName(soft, k, set) {
    if (!set || set.tax !== 'taxable') return '対象外';
    var T = {
      freee: { sale: '課税売上10%', buy: '課対仕入10%', kobutsu: '課対仕入10%', out: '対象外' },
      mf: { sale: '課税売上 10%', buy: '課税仕入 10%', kobutsu: '課税仕入 10%', out: '対象外' },
      yayoi: { sale: '課税売上込10%', buy: '課対仕入込10%', kobutsu: '課対仕入込10%', out: '対象外' }
    };
    return (T[soft] || T.mf)[k] || '対象外';
  }
  function slash(d) { return String(d).replace(/-/g, '/'); }
  /**
   * 仕訳をCSVの行に。soft: 'freee' | 'mf' | 'yayoi' | 'plain'
   * 返り値 { header: [..] | null, rows: [[..]], name: 'ファイル名の一部' }
   */
  function exportRows(entries, soft, set) {
    var map = (SOFT[soft] || {}).acct || {}, A = function (a) { return map[a] || a; };
    var taxOf = function (k, amt) { return set && set.tax === 'taxable' && set.incl === false && (k === 'sale' || k === 'buy' || k === 'kobutsu') ? round(amt * 10 / 110) : ''; };
    if (soft === 'yayoi') {
      // 弥生インポート形式(25項目・見出しなし)。1行の仕訳は 2000
      return { header: null, rows: entries.map(function (e) {
        return ['2000', '', '', slash(e.date), A(e.dr), '', '', taxName('yayoi', e.taxDr, set), e.amt, taxOf(e.taxDr, e.amt), A(e.cr), '', '', taxName('yayoi', e.taxCr, set), e.amt, taxOf(e.taxCr, e.amt),
          e.memo.slice(0, 32), '', '', '0', '', '', '0', '0', 'no'];
      }) };
    }
    if (soft === 'mf') {
      return { header: ['取引No', '取引日', '借方勘定科目', '借方補助科目', '借方部門', '借方取引先', '借方税区分', '借方インボイス', '借方金額(円)', '借方税額', '貸方勘定科目', '貸方補助科目', '貸方部門', '貸方取引先', '貸方税区分', '貸方インボイス', '貸方金額(円)', '貸方税額', '摘要', '仕訳メモ', 'タグ', 'MF仕訳タイプ', '決算整理仕訳'],
        rows: entries.map(function (e, i) { return [i + 1, slash(e.date), A(e.dr), '', '', '', taxName('mf', e.taxDr, set), '', e.amt, taxOf(e.taxDr, e.amt), A(e.cr), '', '', '', taxName('mf', e.taxCr, set), '', e.amt, taxOf(e.taxCr, e.amt), e.memo, '', '', '', /棚卸高の振替/.test(e.memo) ? '1' : '']; }) };
    }
    if (soft === 'freee') {
      return { header: ['伝票番号', '発生日', '借方勘定科目', '借方税区分', '借方金額', '借方税額', '貸方勘定科目', '貸方税区分', '貸方金額', '貸方税額', '摘要'],
        rows: entries.map(function (e, i) { return [i + 1, slash(e.date), A(e.dr), taxName('freee', e.taxDr, set), e.amt, taxOf(e.taxDr, e.amt) || 0, A(e.cr), taxName('freee', e.taxCr, set), e.amt, taxOf(e.taxCr, e.amt) || 0, e.memo]; }) };
    }
    return { header: ['番号', '日付', '借方', '借方金額', '貸方', '貸方金額', '摘要'], rows: entries.map(function (e) { return [e.no, e.date, e.dr, e.amt, e.cr, e.amt, e.memo]; }) };
  }

  /* ---------- Shift_JIS(弥生・マネーフォワードの取り込み用) ---------- */
  var SJ = null;
  function sjisTable() {
    if (SJ) return SJ;
    SJ = {};
    var dec = new TextDecoder('shift_jis'), b = new Uint8Array(2);
    for (var lead = 0x81; lead <= 0xFC; lead++) {
      if (lead > 0x9F && lead < 0xE0) continue;
      for (var tr = 0x40; tr <= 0xFC; tr++) {
        if (tr === 0x7F) continue;
        b[0] = lead; b[1] = tr;
        var ch = dec.decode(b);
        if (ch.length === 1 && ch !== '�' && SJ[ch] == null) SJ[ch] = (lead << 8) | tr;
      }
    }
    for (var k = 0xA1; k <= 0xDF; k++) SJ[String.fromCharCode(0xFF61 + k - 0xA1)] = k; // 半角カナ
    return SJ;
  }
  function encodeSJIS(str) {
    var t = sjisTable(), out = [];
    var s = String(str).replace(/[−]/g, '－').replace(/〜/g, '～');
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) { out.push(c); continue; }
      var code = t[s[i]];
      if (code == null) { out.push(0x3F); continue; }
      if (code > 0xFF) out.push(code >> 8, code & 0xFF); else out.push(code);
    }
    return new Uint8Array(out);
  }

  /* ==================================================================
     古物商特例(課税事業者の仕入税額控除)
     ================================================================== */
  /** 事業者(インボイスを受け取るべき相手)からの仕入れらしいか */
  var BIZ = /楽天市場|Yahoo!ショッピング|Amazon|店舗|株式会社|\(株\)|（株）|有限会社|合同会社|ショップ|ストア|ブックオフ|セカンドストリート|ハードオフ|オフハウス|トレジャー|ゲオ|駿河屋|業者|市場|オークション会/;
  /**
   * 古物商特例の確認。対象は中古品を個人(適格請求書発行事業者以外)から買った仕入れ。
   * 帳簿に要る事項: 相手の氏名・住所(古物営業法で本人確認が要る取引のみ)、年月日、品名(内容)、数量、対価、特例の対象である旨。
   * 返り値 { rows:[{r, state:'ok'|'missing'|'biz'|'new', need:[足りない項目], idReq}], ok, missing, biz, amountOk }
   */
  function kobutsuCheck(ledger, year) {
    var y = String(year), rows = [];
    (ledger || []).forEach(function (r) {
      if (r.wait || !inYear(r.date, y)) return;
      var amt = round((Number(r.unit) || 0) * (Number(r.qty) || 1));
      if (r.cond !== '中古') { rows.push({ r: r, state: 'new', need: [], amt: amt }); return; }
      if (r.verify === '古物商・法人から購入' || BIZ.test(String(r.party || ''))) { rows.push({ r: r, state: 'biz', need: [], amt: amt }); return; }
      var idReq = amt >= 10000 || !!r.media || r.hinmoku === '書籍' || r.hinmoku === '自動二輪車及び原動機付自転車' || /(室外機|電線|グレーチング)/.test(String(r.name || '') + ' ' + String(r.feature || ''));
      var need = [];
      if (!r.date) need.push('年月日');
      if (!String(r.name || '').trim() || /^\(名前なし\)$/.test(r.name)) need.push('品名');
      if (!(Number(r.qty) > 0)) need.push('数量');
      if (!(Number(r.unit) > 0)) need.push('対価');
      if (idReq) { if (!String(r.pName || '').trim()) need.push('相手の氏名'); if (!String(r.pAddr || '').trim()) need.push('相手の住所'); }
      rows.push({ r: r, state: need.length ? 'missing' : 'ok', need: need, idReq: idReq, amt: amt });
    });
    var c = function (s) { return rows.filter(function (x) { return x.state === s; }); };
    var ok = c('ok'), mi = c('missing');
    return { rows: rows, ok: ok.length, missing: mi.length, biz: c('biz').length, nw: c('new').length,
      amountOk: ok.reduce(function (s, x) { return s + x.amt; }, 0), amountMissing: mi.reduce(function (s, x) { return s + x.amt; }, 0),
      taxOk: round(ok.reduce(function (s, x) { return s + x.amt; }, 0) * 10 / 110) };
  }

  /* ==================================================================
     料金プランと機能
     ================================================================== */
  /** 機能の番号 → 必要なプラン('total' 総合 / 'biz' 業務) */
  var FEATURE_TIER = { import: 'total', expense: 'total', monthly: 'total', stale: 'total', stock: 'biz', tax: 'biz', journal: 'biz', kobutsu: 'biz' };
  /** 契約のプランの名前・キーから段階を決める(free < light < total < biz) */
  function tierOf(planKey, planName) {
    var s = String(planKey || '') + ' ' + String(planName || '');
    if (/business|業務|biz/i.test(s)) return 'biz';
    if (/light|ライト/i.test(s)) return 'light';
    if (/total|sogo|総合|standard|スタンダード|founder|先着/i.test(s)) return 'total';
    return s.trim() ? 'total' : 'free';
  }
  var RANK = { free: 0, light: 1, total: 2, biz: 3 };
  function allowed(feature, tier) { return RANK[tier] >= RANK[FEATURE_TIER[feature] || 'total']; }

  return {
    z2h: z2h, norm: norm, num: num, date: date, daysBetween: daysBetween, addDays: addDays, decode: decode, parseCSV: parseCSV, toCSV: toCSV, csvCell: csvCell,
    findHeader: findHeader, mapHeader: mapHeader, AMZ_COLS: AMZ_COLS, amzType: amzType, parseAmazon: parseAmazon, parseMercari: parseMercari, TYPE_LABEL: TYPE_LABEL,
    GEN_COLS: GEN_COLS, FIELD_LABEL: FIELD_LABEL, detectColumns: detectColumns, applyMapping: applyMapping, sniff: sniff, asinOf: asinOf, janOf: janOf,
    ACCTS: ACCTS, ACCT_HINT: ACCT_HINT, guessAcct: guessAcct, payeeKey: payeeKey, bizAmount: bizAmount, dueRecurring: dueRecurring,
    matchLedger: matchLedger, candidates: candidates, ledgerCodes: ledgerCodes, events: events, monthly: monthly, groupBy: groupBy, partyGroup: partyGroup, chOf: CH_OF_SELL,
    breakEven: breakEven, stale: stale, stockAt: stockAt, stocktake: stocktake, countScan: countScan,
    taxReport: taxReport, journal: journal, exportRows: exportRows, encodeSJIS: encodeSJIS, SOFT: SOFT, kobutsuCheck: kobutsuCheck,
    FEATURE_TIER: FEATURE_TIER, tierOf: tierOf, allowed: allowed
  };
});
