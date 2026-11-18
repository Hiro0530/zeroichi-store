/* せどり 利益チェック — 帳簿の計算だけの部品(画面・保存に依存しない)。
   ブラウザでは window.SedoriBooks、Node では require('./books-core.js') で検算する。
   金額はすべて円の整数。日付は 'YYYY-MM-DD'。計算は参考で、申告の前に本人が確認する前提。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../../assets/seller-check.js'));
  else root.SedoriBooks = factory(root.SedoriSellerCheck);
})(typeof self !== 'undefined' ? self : this, function (SC) {
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
  var PG_KNOWN = /^(楽天市場|Yahoo!ショッピング|Yahoo!オークション|メルカリ|ラクマ|PayPayフリマ|Amazon|店舗|ブックオフ|セカンドストリート|ハードオフ)/;
  /** 決まった店の名前で始まる時だけ、その店の名前(個人の名前などは '' = サーバーへは文字を送らず番号にする) */
  function partyGroupKnown(p) { var m = String(p || '').trim().match(PG_KNOWN); return m ? m[1] : ''; }
  function partyGroup(p) {
    p = String(p || '').trim();
    if (!p) return '(仕入れ先なし)';
    var m = p.match(PG_KNOWN);
    return m ? m[1] : p.split(/\s+/)[0];
  }
  /* events・monthly・groupBy(月ごと・ルート別・仕入れ先別の集計と申告の元)は、2026-11-18 に端末から消した。計算は Worker の /core(books_calc.js)だけにある */

  /* 売れ残りの判定(breakEven・stale)も Worker の /core(stale)へ移した */

  /* ==================================================================
     棚卸
     ================================================================== */
  /** 同じ品をまとめる印(JAN・ASIN・なければ品名)。サーバーへは、この印を 1,2,3… の番号に置き換えて送る(文字は送らない) */
  function itemKey(r) { var c = ledgerCodes(r); return c.jan ? 'J' + c.jan : (c.asin ? 'A' + c.asin : 'N' + norm(r.name)); }
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

  /* 申告用の数字(taxReport)・仕訳帳(journal)・会計ソフト向けの行(exportRows)は Worker の /core へ移した。ここには会計ソフトの名前だけ残す */
  var SOFT = { freee: { label: 'freee会計' }, mf: { label: 'マネーフォワード クラウド確定申告' }, yayoi: { label: 'やよいの青色申告' } };

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
  /** 事業者らしい仕入れ先か(文字の分類だけ。判定の結果の true/false を、端末がサーバーへ送る) */
  function isBizParty(r) { return r.verify === '古物商・法人から購入' || BIZ.test(String(r.party || '')); }
  function partyKey(name) { return 'p:' + payeeKey(name); }
  /* 古物商特例の確認(kobutsuCheck)・インボイスの経過措置(transitionCredit・割合・上限)は Worker の /core へ移した */

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
    matchLedger: matchLedger, candidates: candidates, ledgerCodes: ledgerCodes, partyGroup: partyGroup, partyGroupKnown: partyGroupKnown, chOf: CH_OF_SELL,
    itemKey: itemKey, countScan: countScan,
    encodeSJIS: encodeSJIS, SOFT: SOFT, isBizParty: isBizParty, partyKey: partyKey,
    FEATURE_TIER: FEATURE_TIER, tierOf: tierOf, allowed: allowed
  };
});
