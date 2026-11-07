/* 取引履歴CSVの読み込みと、列の対応づけ
 *
 * 取引所ごとの列名は決め打ちしない。
 * 見出しに含まれる言葉(「日時」「数量」「手数料」など)から候補を選び、利用者が画面で確認・変更する。
 * 見出しから判断できない列は空欄のままにし、利用者に選んでもらう。
 */
(function (root) {
  'use strict';

  /* 文字コード: UTF-8 として読めなければ Shift_JIS として読む */
  function decode(buf) {
    var bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    try {
      var t = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return t.replace(/^﻿/, '');
    } catch (e) {
      return new TextDecoder('shift_jis').decode(bytes);
    }
  }

  /* CSVを行×列に分ける(ダブルクォート・改行入りの値・タブ区切りに対応) */
  function parseCSV(text) {
    var first = text.split(/\r?\n/, 1)[0] || '';
    var delim = (first.split('\t').length > first.split(',').length) ? '\t' : ',';
    var rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
        } else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return c.trim() !== ''; }); })
      .map(function (r) { return r.map(function (c) { return c.trim(); }); });
  }

  /* 項目ごとの「見出しに含まれていたら候補にする言葉」。先にあるものほど優先。
   * 取引所固有の列名ではなく、一般的な日本語・英語の言葉だけを使う。 */
  var FIELDS = [
    { key: 'time',   label: '日時',           need: true,  words: ['約定日時', '取引日時', '日時', '約定日', '取引日', '日付', 'date', 'time'] },
    { key: 'asset',  label: '通貨(銘柄)',     need: true,  words: ['銘柄', '通貨ペア', '通貨', 'symbol', 'pair', 'currency', 'coin'] },
    { key: 'side',   label: '売買の区分',     need: true,  words: ['売買区分', '売買', '取引種別', '取引区分', '種別', '区分', 'side', 'type', 'kind'] },
    { key: 'qty',    label: '数量',           need: true,  words: ['約定数量', '数量', 'amount', 'quantity', 'qty', 'size'] },
    { key: 'price',  label: '単価(円)',       need: false, words: ['約定レート', '約定価格', '約定単価', '取引価格', '単価', 'レート', '価格', 'rate', 'price'] },
    { key: 'amount', label: '約定金額(円)',   need: false, words: ['約定代金', '約定金額', '取引金額', '受渡金額', '金額', '代金', 'total'] },
    { key: 'fee',    label: '手数料',         need: false, words: ['手数料', 'fee', 'commission'] }
  ];

  function norm(s) { return String(s || '').toLowerCase().replace(/[\s_()\uFF08\uFF09\[\]「」]/g, ''); }

  /* 見出しの行を探す(先頭に説明の行がある場合に備えて、最初の10行から一番それらしい行) */
  function findHeaderRow(rows) {
    var best = 0, bestScore = -1;
    for (var i = 0; i < Math.min(rows.length, 10); i++) {
      var score = 0;
      rows[i].forEach(function (c) {
        var n = norm(c);
        if (!n || /^[-\d.,\/: +]+$/.test(n)) return;
        FIELDS.forEach(function (f) { if (f.words.some(function (w) { return n.indexOf(norm(w)) >= 0; })) score++; });
      });
      if (score > bestScore) { bestScore = score; best = i; }
    }
    return best;
  }

  /* 見出しから列の候補を選ぶ。見つからない項目は -1。同じ列を2つの項目に使わない。 */
  function guessMapping(headers) {
    var map = {}, used = {};
    var H = headers.map(norm);
    FIELDS.forEach(function (f) {
      map[f.key] = -1;
      for (var w = 0; w < f.words.length && map[f.key] < 0; w++) {
        var word = norm(f.words[w]);
        for (var i = 0; i < H.length; i++) {
          if (used[i] || !H[i]) continue;
          if (H[i].indexOf(word) < 0) continue;
          // 「手数料」「対円」「残高」「注文」などを含む列は、数量・価格・金額の候補にしない
          if (f.key !== 'fee' && /手数料|fee|commission/.test(H[i])) continue;
          if ((f.key === 'qty' || f.key === 'price' || f.key === 'amount') && /残高|balance|注文id|orderid|id$/.test(H[i])) continue;
          if (f.key === 'price' && /対円/.test(H[i])) continue;
          map[f.key] = i; used[i] = true; break;
        }
      }
    });
    // 手数料の単位: 見出しに「円」「JPY」とあれば円、通貨記号や「数量」とあれば数量。それ以外は空欄(利用者が選ぶ)。
    map.feeUnit = '';
    if (map.fee >= 0) {
      var fh = headers[map.fee];
      if (/円|jpy|¥/i.test(fh)) map.feeUnit = 'jpy';
      else if (/数量|btc|eth|xrp|コイン|coin/i.test(fh)) map.feeUnit = 'coin';
    }
    return map;
  }

  function mappingComplete(map) {
    if (!map) return false;
    var ok = ['time', 'asset', 'side', 'qty'].every(function (k) { return map[k] >= 0; });
    ok = ok && (map.price >= 0 || map.amount >= 0);
    if (map.fee >= 0 && !map.feeUnit) ok = false;
    return ok;
  }

  /* 数値: カンマ・円記号・通貨記号・全角数字を取り除いて読む */
  function num(s) {
    if (s == null) return NaN;
    // 全角の数字・記号(U+FF0C〜U+FF19)を半角に
    var t = String(s).replace(/[，-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/[−ー―]/g, '-').replace(/[,\u00A5\uFFE5\\円\s]/g, '').replace(/[A-Za-z]+$/, '').replace(/^[A-Za-z]+/, '');
    if (t === '' || t === '-') return NaN;
    var v = Number(t);
    return isFinite(v) ? v : NaN;
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* 日時: 「2024/01/02 12:34:56」「2024-01-02T12:34:56Z」「2024年1月2日」などを日本時間の 'YYYY-MM-DD HH:MM:SS' にする */
  function parseTime(s) {
    var m = String(s || '').match(/(\d{4})\s*[\/\-.年]\s*(\d{1,2})\s*[\/\-.月]\s*(\d{1,2})日?(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?\s*(Z|[+\-]\d{2}:?\d{2}|UTC|JST)?/i);
    if (!m) return null;
    var Y = +m[1], Mo = +m[2], D = +m[3], h = +(m[4] || 0), mi = +(m[5] || 0), se = +(m[6] || 0);
    if (Mo < 1 || Mo > 12 || D < 1 || D > 31) return null;
    var tz = (m[7] || '').toUpperCase();
    if (tz && tz !== 'JST') {
      var off = 0;
      if (tz !== 'Z' && tz !== 'UTC') {
        var mm = tz.match(/([+\-])(\d{2}):?(\d{2})/);
        off = (mm[1] === '-' ? -1 : 1) * (+mm[2] * 60 + +mm[3]);
      }
      var d = new Date(Date.UTC(Y, Mo - 1, D, h, mi, se) - off * 60000 + 9 * 3600000);
      Y = d.getUTCFullYear(); Mo = d.getUTCMonth() + 1; D = d.getUTCDate();
      h = d.getUTCHours(); mi = d.getUTCMinutes(); se = d.getUTCSeconds();
    }
    return Y + '-' + pad(Mo) + '-' + pad(D) + ' ' + pad(h) + ':' + pad(mi) + ':' + pad(se);
  }

  /* 通貨の値から銘柄と相手通貨を取り出す: 「BTC」「BTC/JPY」「btc_jpy」「ETH-BTC」 */
  function parseAsset(s) {
    var t = String(s || '').trim();
    if (!t) return null;
    var parts = t.split(/\s*[\/_\-:]\s*/);
    var base = parts[0].toUpperCase();
    var quote = parts.length > 1 ? parts[1].toUpperCase() : '';
    return { base: base, quote: quote };
  }

  /* 売買の区分の値を分類: 'buy' | 'sell' | ''(分からない) */
  function classifySide(v) {
    var s = String(v || '').toLowerCase();
    if (/買|購入|buy|bid/.test(s)) return 'buy';
    if (/売|sell|ask/.test(s)) return 'sell';
    return '';
  }

  /* 区分の列に出てくる値の一覧(画面で「買い・売り・計算しない」を選んでもらうため) */
  function sideValues(rows, col) {
    var seen = {}, out = [];
    rows.forEach(function (r) {
      var v = (r[col] || '').trim();
      if (!(v in seen)) { seen[v] = true; out.push({ value: v, guess: classifySide(v) }); }
    });
    return out;
  }

  /* 行を取引に直す
   *   sideMap: { '買い': 'buy', '売り': 'sell', '入金': '' } 空なら計算しない
   *   返り値: { txs: [...], skipped: [{ line, reason, raw }] } */
  function toTransactions(rows, map, sideMap, srcName, startLine) {
    var txs = [], skipped = [];
    rows.forEach(function (r, i) {
      var line = (startLine || 2) + i;
      var raw = r.join(', ');
      function skip(reason) { skipped.push({ src: srcName, line: line, reason: reason, raw: raw }); }
      var sv = (r[map.side] || '').trim();
      var side = sideMap && (sv in sideMap) ? sideMap[sv] : classifySide(sv);
      if (side !== 'buy' && side !== 'sell') return skip('売買以外の記録(' + (sv || '区分なし') + ')');
      var t = parseTime(r[map.time]);
      if (!t) return skip('日時が読めません');
      var as = parseAsset(r[map.asset]);
      if (!as) return skip('通貨が空欄です');
      if (as.base === 'JPY' && as.quote) as = { base: as.quote, quote: 'JPY' };
      if (as.quote && as.quote !== 'JPY') return skip('円以外との交換(' + as.base + '/' + as.quote + ')は計算に入れていません');
      if (as.base === 'JPY') return skip('円の記録です');
      var qty = Math.abs(num(r[map.qty]));
      if (!(qty > 0)) return skip('数量が読めません');
      var amount = map.amount >= 0 ? Math.abs(num(r[map.amount])) : NaN;
      var price = map.price >= 0 ? Math.abs(num(r[map.price])) : NaN;
      var jpy = isFinite(amount) && amount > 0 ? amount : (isFinite(price) ? price * qty : NaN);
      if (!isFinite(jpy)) return skip('金額・単価が読めません');
      var fee = map.fee >= 0 ? Math.abs(num(r[map.fee])) : 0;
      if (!isFinite(fee)) fee = 0;
      txs.push({
        t: t, asset: as.base, side: side, qty: qty, jpy: jpy,
        feeJpy: map.feeUnit === 'jpy' ? fee : 0,
        feeQty: map.feeUnit === 'coin' ? fee : 0,
        src: srcName, line: line
      });
    });
    return { txs: txs, skipped: skipped };
  }

  var api = {
    FIELDS: FIELDS, decode: decode, parseCSV: parseCSV, findHeaderRow: findHeaderRow,
    guessMapping: guessMapping, mappingComplete: mappingComplete, num: num, parseTime: parseTime,
    parseAsset: parseAsset, classifySide: classifySide, sideValues: sideValues, toTransactions: toTransactions
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TaxCSV = api;
})(typeof self !== 'undefined' ? self : this);
