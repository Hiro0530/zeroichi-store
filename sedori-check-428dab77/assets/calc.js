/* ZEROICHI WORKS せどり計算 — 計算だけの部品(画面に依存しない)。
   ブラウザでは window.SedoriCalc、Node では require('./calc.js') で使う。
   金額はすべて円(整数)。手数料の数値は data/fees.json から渡す。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SedoriCalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var EPS = 1e-9;
  function int(v) { var n = Math.round(Number(v)); return isFinite(n) ? n : 0; }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }

  /* ---------- Amazon ---------- */
  function findCategory(fees, id) {
    var cats = fees.amazon.categories;
    for (var i = 0; i < cats.length; i++) if (cats[i].id === id) return cats[i];
    return cats[cats.length - 1];
  }

  /** 販売手数料(税抜)。価格帯で率が変わる。split のある段は「split円までは rate_below、超えた分は rate」 */
  function referralExTax(price, cat) {
    price = int(price);
    if (price <= 0) return 0;
    var fee = 0;
    for (var i = 0; i < cat.tiers.length; i++) {
      var t = cat.tiers[i];
      if (t.upto === null || price <= t.upto) {
        if (t.split) fee = t.split * t.rate_below + (price - t.split) * t.rate;
        else fee = price * t.rate;
        break;
      }
    }
    return Math.max(Math.round(fee + EPS), cat.min || 0);
  }

  /** 販売手数料(消費税込み) */
  function referralFee(price, cat, taxRate) {
    var ex = referralExTax(price, cat);
    return Math.round(ex * (1 + (taxRate == null ? 0.1 : taxRate)) + EPS);
  }

  function findFbaTier(fees, id) {
    var t = fees.amazon.fba_tiers;
    for (var i = 0; i < t.length; i++) if (t[i].id === id) return t[i];
    return null;
  }

  /** FBA配送代行手数料(税込) */
  function fbaFee(price, tier, fees) {
    if (!tier) return 0;
    return int(price) <= fees.amazon.fba_price_threshold ? tier.under : tier.over;
  }

  /** 寸法(cm)と重さ(g)からサイズ区分の目安を返す */
  function guessFbaTier(fees, dims, grams) {
    var d = (dims || []).map(num).filter(function (x) { return x > 0; }).sort(function (a, b) { return b - a; });
    if (d.length !== 3 || !(grams > 0)) return null;
    var sum = d[0] + d[1] + d[2];
    var tiers = fees.amazon.fba_tiers;
    for (var i = 0; i < tiers.length; i++) {
      var t = tiers[i];
      if (grams > t.max_g) continue;
      if (t.max_dims) {
        if (d[0] <= t.max_dims[0] && d[1] <= t.max_dims[1] && d[2] <= t.max_dims[2]) return t;
      } else if (sum <= t.max_sum) {
        return t;
      }
    }
    return null;
  }

  /** 楽天・Yahoo!のポイント(税抜価格×還元率、1円未満切り捨て)。rate は 0.1 = 10% */
  function points(cost, rate, taxIncluded) {
    cost = int(cost); rate = num(rate);
    if (cost <= 0 || rate <= 0) return 0;
    var base = taxIncluded === false ? cost : cost / 1.1;
    return Math.floor(base * rate + EPS);
  }

  /**
   * Amazon FBA の1個あたりの利益。
   * input: { sell, category, fbaTier, cost, inShip, inbound, other, pointRate, usePoints }
   *   sell=販売価格(税込) cost=仕入れ値(税込・1個) inShip=仕入れの送料(1個) inbound=FBA納品の送料・資材(1個)
   *   other=その他(1個) pointRate=ポイント還元率の合計(0.1=10%)
   */
  function amazonProfit(fees, input) {
    var cat = findCategory(fees, input.category);
    var tier = findFbaTier(fees, input.fbaTier);
    var sell = int(input.sell);
    var referral = referralFee(sell, cat, fees.amazon.tax_rate);
    var fba = input.selfShip ? 0 : fbaFee(sell, tier, fees);
    var ship = input.selfShip ? int(input.selfShipCost) : 0;
    var cost = int(input.cost), inShip = int(input.inShip), inbound = input.selfShip ? 0 : int(input.inbound), other = int(input.other);
    var pt = input.usePoints === false ? 0 : points(cost, input.pointRate);
    var payout = sell - referral - fba - ship;               // Amazonからの入金(1個)
    var profit = payout - inbound - other - cost - inShip + pt;
    return {
      sell: sell, referral: referral, referralEx: referralExTax(sell, cat), fba: fba, selfShipCost: ship,
      payout: payout, cost: cost, inShip: inShip, inbound: inbound, other: other, points: pt,
      profit: profit, profitNoPoints: profit - pt,
      margin: sell > 0 ? profit / sell : 0,
      roi: (cost + inShip) > 0 ? profit / (cost + inShip) : 0,
      category: cat, tier: tier
    };
  }

  /** 目標利益: {mode:'yen'|'pct', value}。数値だけなら円。必要な利益(円)を返す */
  function needProfit(sell, target) {
    if (target == null) return 0;
    if (typeof target === 'number') return int(target);
    if (target.mode === 'pct') return Math.ceil(int(sell) * num(target.value) / 100 - EPS);
    return int(target.value);
  }

  /** 目標利益を満たす最安の販売価格(手数料が売値の%なので、1円ずつ確かめる。下限は原価-ポイント) */
  function amazonPriceFor(fees, input, target, limit) {
    var x = Object.assign({}, input);
    x.sell = 0;
    var z = amazonProfit(fees, x);             // 売値0円のときの利益 = -(原価) + ポイント
    var start = Math.max(1, -z.profit);
    limit = limit || Math.max(start * 20, 100000);
    // 1円ずつ確かめるのと同じ答えを、飛ばしながら探す(仕入れ値が大きい時に画面が固まらないように)。
    // 売値を1円上げても利益は1円までしか増えないので、目標まで d 円足りなければ、次の候補は d 円先。
    // ただし手数料の段が替わる所(販売手数料の価格帯・FBAの1,000円の境目)は利益が跳ぶことがあるので、境目とその次の1円では必ず止まって確かめる
    var marks = [], cat = findCategory(fees, x.category);
    (cat.tiers || []).forEach(function (t) { if (t.upto != null) marks.push(t.upto, t.upto + 1); if (t.split) marks.push(t.split, t.split + 1); });
    if (fees.amazon.fba_price_threshold) marks.push(fees.amazon.fba_price_threshold, fees.amazon.fba_price_threshold + 1);
    marks.sort(function (a, b) { return a - b; });
    for (var p = start, guard = 0; p <= limit && guard < 200000; guard++) {
      x.sell = p;
      var d = needProfit(p, target) - amazonProfit(fees, x).profit;
      if (d <= 0) return p;
      var next = p + d;
      for (var i = 0; i < marks.length; i++) if (marks[i] > p) { next = Math.min(next, marks[i]); break; }
      p = next;
    }
    return null;
  }
  /** 計算する金額の上限(円)。これ以上は入れ間違い(金額の欄にJANを貼ったなど)として、計算せずに「金額を確かめてください」と出す */
  var MAX_YEN = 10000000;
  function tooBig(v) { return Number(v) >= MAX_YEN; }

  /** 利益が0円以上になる最安の販売価格(損益分岐) */
  function amazonBreakEvenSell(fees, input, limit) { return amazonPriceFor(fees, input, 0, limit); }

  /** 利益率 targetMargin(0.15=15%)以上を守れる仕入れ値の上限(1個・税込・仕入れ送料は別に入力した値を使う) */
  function amazonMaxCost(fees, input, targetMargin) {
    var x = Object.assign({}, input);
    var sell = int(x.sell);
    if (sell <= 0) return null;
    x.cost = 0;
    var base = amazonProfit(fees, x);
    var need = (targetMargin !== null && typeof targetMargin === 'object') ? needProfit(sell, targetMargin) : Math.ceil(sell * num(targetMargin) - EPS);
    if (base.profit < need) return null;
    // 目安から上下に詰める
    var r = x.usePoints === false ? 0 : num(x.pointRate) / 1.1;
    var c = Math.max(0, Math.floor((base.profit - need) / Math.max(1 - r, 0.01)));
    function ok(v) { x.cost = v; return amazonProfit(fees, x).profit >= need; }
    while (c > 0 && !ok(c)) c--;
    while (ok(c + 1)) c++;
    return c;
  }

  /* ---------- メルカリ・Yahoo!オークション(売る側) ---------- */
  function marketFee(price, rate) { return Math.floor(int(price) * num(rate) + EPS); }

  function findShipping(fees, id) {
    var s = fees.mercari.shipping;
    for (var i = 0; i < s.length; i++) if (s[i].id === id) return s[i];
    return null;
  }

  /**
   * フリマ・オークションで売った時の利益。
   * input: { sell, rate, shipFee, material, cost, other }
   */
  function marketProfit(input) {
    var sell = int(input.sell);
    var fee = marketFee(sell, input.rate);
    var ship = int(input.shipFee), material = int(input.material), cost = int(input.cost), other = int(input.other);
    var profit = sell - fee - ship - material - cost - other;
    return { sell: sell, fee: fee, ship: ship, material: material, cost: cost, other: other,
      payout: sell - fee, profit: profit, margin: sell > 0 ? profit / sell : 0,
      roi: cost > 0 ? profit / cost : 0 };
  }

  /** 目標利益(円)を残せる最安の販売価格 */
  /** 目標利益(円、または {mode,value})を残せる最安の販売価格 */
  function marketPriceFor(input, target) {
    var fixed = int(input.shipFee) + int(input.material) + int(input.cost) + int(input.other);
    var pctT = target && typeof target === 'object' && target.mode === 'pct' ? num(target.value) / 100 : 0;
    var yenT = pctT ? 0 : needProfit(0, target);
    var denom = 1 - num(input.rate) - pctT;
    if (denom <= 0) return null;
    var p = Math.max(1, Math.floor((yenT + fixed) / denom) - 3);
    var x = Object.assign({}, input);
    function ok(v) { x.sell = v; return marketProfit(x).profit >= needProfit(v, target); }
    for (var guard = 0; guard < 100000; guard++, p++) {
      if (ok(p)) {
        while (p > 1 && ok(p - 1)) p--;   // 切り捨ての影響で1円下でも足りる時
        return p;
      }
    }
    return null;
  }

  /** 業者オークションなどの仕入れ1個あたりの原価 */
  function auctionUnitCost(input) {
    var qty = Math.max(1, int(input.qty) || 1);
    var tax = num(input.taxRate == null ? 0.1 : input.taxRate);
    var bid = int(input.bid);
    var bidTotal = input.bidTaxExcluded ? Math.round(bid * (1 + tax) + EPS) : bid;
    var fee = int(input.fee);
    var feeTotal = input.feeTaxExcluded ? Math.round(fee * (1 + tax) + EPS) : fee;
    var total = bidTotal + feeTotal + int(input.ship) + int(input.other);
    return { qty: qty, bidTotal: bidTotal, feeTotal: feeTotal, total: total, unit: Math.ceil(total / qty - EPS) };
  }

  /** 業者オークションの落札手数料(1点・プリセットの税区分のまま)。rate を渡すとプリセットの率を上書き */
  function auctionFee(preset, bid, rate) {
    bid = int(bid);
    if (!preset || bid <= 0) return 0;
    if (preset.type === 'band') {
      for (var i = 0; i < preset.bands.length; i++) {
        var b = preset.bands[i];
        if (b.upto === null || bid <= b.upto) return b.fee;
      }
    }
    if (preset.type === 'rate') return Math.round(bid * num(rate == null ? preset.rate : rate) + EPS);
    return 0;
  }

  /* ---------- CSV ---------- */
  function csvCell(v) {
    var s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;           // 表計算ソフトで式として動かないように
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /* ---------- ヤフオクの終了日時(取り寄せ販売の見張り) ---------- */
  function half(s) {
    return String(s || '').replace(/[！-～]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }).replace(/　/g, ' ');
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  /** Date → datetime-local の値("2026-10-29T22:15") */
  function toLocalInput(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  /** datetime-local の値 → ミリ秒(端末の時刻)。読めなければ null */
  function endMs(v) {
    var m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() : null;
  }
  /** 貼り付けた文字から終了日時を取り出す。
      「終了日時 10月29日（水）22時15分」「2026.10.29（水）22:15」「2026年10月29日 22時15分」「10/29 22:15」「残り 2日 3時間」に対応。
      年が無い時は now の年(半年以上前になるなら翌年)。返り値は datetime-local の値か null */
  function parseEndTime(text, now) {
    now = now || new Date();
    var t = half(text).replace(/\r/g, '');
    var lines = t.split('\n'), pick = lines.filter(function (l) { return /終了|締切|残り/.test(l); });
    var srcs = pick.length ? [pick.join('\n'), t] : [t];
    var DOW = '\\s*(?:[(（][^)）]{1,3}[)）])?\\s*';
    var reY = new RegExp('(\\d{4})\\s*[年./-]\\s*(\\d{1,2})\\s*[月./-]\\s*(\\d{1,2})\\s*日?' + DOW + '(\\d{1,2})\\s*[時:：]\\s*(\\d{1,2})');
    var reMD = new RegExp('(\\d{1,2})\\s*[月/]\\s*(\\d{1,2})\\s*日?' + DOW + '(\\d{1,2})\\s*[時:：]\\s*(\\d{1,2})');
    for (var i = 0; i < srcs.length; i++) {
      var s = srcs[i], m = s.match(reY), d = null;
      if (m) d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
      else if ((m = s.match(reMD))) {
        d = new Date(now.getFullYear(), +m[1] - 1, +m[2], +m[3], +m[4]);
        if (d.getTime() < now.getTime() - 183 * 864e5) d.setFullYear(d.getFullYear() + 1);
      } else {
        var r = s.match(/残り\s*(?:時間)?\s*[:：]?\s*(?:(\d+)\s*日)?\s*(?:(\d+)\s*時間)?\s*(?:(\d+)\s*分)?/);
        if (r && (r[1] || r[2] || r[3])) d = new Date(now.getTime() + ((+r[1] || 0) * 1440 + (+r[2] || 0) * 60 + (+r[3] || 0)) * 6e4);
      }
      if (d && !isNaN(d.getTime()) && (!m || (+m[m.length - 2] < 24 && +m[m.length - 1] < 60))) return toLocalInput(d);
    }
    return null;
  }
  /** 終了までの状態。ended(終了)/due(60分以内)/soon(2時間以内)/far。終了日時が無ければ null */
  function endState(row, now) {
    var e = endMs(row && row.yEnd); if (e == null) return null;
    var left = e - (now == null ? Date.now() : now);
    return { left: left, end: e, state: left <= 0 ? 'ended' : (left <= 36e5 ? 'due' : (left <= 72e5 ? 'soon' : 'far')), watch: (row.status || '') === '出品中' };
  }
  /** 残り時間の表示。2時間未満は秒まで */
  function fmtLeft(ms) {
    if (ms <= 0) return '終了';
    var s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), mi = Math.floor(s % 3600 / 60), se = s % 60;
    if (ms < 72e5) return 'あと' + h + ':' + pad2(mi) + ':' + pad2(se);
    if (d) return 'あと' + d + '日' + h + '時間';
    return 'あと' + h + '時間' + mi + '分';
  }

  function toCSV(header, rows) {
    var lines = [header.map(csvCell).join(',')];
    rows.forEach(function (r) { lines.push(r.map(csvCell).join(',')); });
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  /** 商品名・説明からJAN(13桁/8桁)らしき数字を拾う */
  function extractJan(text) {
    var m = String(text || '').match(/(?:^|[^0-9])(4[59]\d{11})(?![0-9])/);
    if (m && janValid(m[1])) return m[1];
    return '';
  }
  function janValid(code) {
    code = String(code || '');
    if (!/^\d{13}$/.test(code) && !/^\d{8}$/.test(code)) return false;
    var digits = code.split('').map(Number), check = digits.pop(), sum = 0;
    digits.reverse().forEach(function (d, i) { sum += d * (i % 2 === 0 ? 3 : 1); });
    return (10 - (sum % 10)) % 10 === check;
  }

  /* ---------- 発送のしかた(自分で発送 / 発送代行) ---------- */
  /** 自分で発送する時の運送会社・サイズ(fees.self_ship.carriers)。送料=運賃+資材 */
  function findCarrier(fees, id) {
    var c = (fees.self_ship || { carriers: [] }).carriers;
    for (var i = 0; i < c.length; i++) if (c[i].id === id) return c[i];
    return null;
  }
  function carrierCost(fees, id, custom) {
    var c = findCarrier(fees, id);
    if (!c || c.id === 'custom') return int(custom);
    return int(c.fee) + int(c.material);
  }
  /** 発送代行の1個あたりの費用(入庫+保管+撮影+出荷)。自分で発送なら0 */
  function warehouseCost(mode, w) {
    if (mode !== '3pl' || !w) return 0;
    return int(w['in']) + int(w.store) + int(w.photo) + int(w.out);
  }
  /** 台帳の状態の流れ。自分で発送は「入庫」を飛ばす(FBA・発送代行は倉庫に入庫する) */
  function statusFlow(mode) {
    return mode === 'self' ? ['仕入れ済', '出品中', '売約', '発送済'] : ['仕入れ済', '入庫', '出品中', '売約', '発送済'];
  }


  /* ---------- FBAの納品代行の費用 ---------- */
  /** 納品代行の1個あたりの費用 = 代行料 + 切り上げ(1箱ごとの費用 ÷ 1箱の個数)。個数が0や空なら1個として扱う */
  function prepCost(p) {
    if (!p) return 0;
    var per = Math.max(1, int(p.per) || 1), box = Math.max(0, int(p.box));
    return Math.max(0, int(p.fee)) + Math.ceil(box / per - EPS);
  }

  /* ---------- 月の固定費 ---------- */
  /** 入になっている行の月額の合計。rows: [{on, amount}] */
  function fixedTotal(rows) {
    return (rows || []).reduce(function (s, r) { return s + (r && r.on ? Math.max(0, int(r.amount)) : 0); }, 0);
  }
  /** 月に何個で固定費に届くか = 切り上げ(固定費 ÷ 1個の利益)。利益が0円以下、固定費が0円以下なら null */
  function breakEvenUnits(fixed, unitProfit) {
    fixed = int(fixed); unitProfit = int(unitProfit);
    if (!(fixed > 0) || !(unitProfit > 0)) return null;
    return Math.ceil(fixed / unitProfit - EPS);
  }

  /* ---------- まとめてチェック: 貼った一覧を読む ---------- */
  /* 有料の段どうしの行数・品数の差をなくす設定は config.js の PAID_UNIFORM(null で前の形: ライト100行・総合と業務500行)。2026-11-18。
     利用の鍵の形では、行数は Worker の /core の limits が決める(これは前のログインの形と試験のための表) */
  var PAID_UNI = (function () { var c = (typeof window !== 'undefined' && window.ZW_CONFIG) || {}; return 'PAID_UNIFORM' in c ? c.PAID_UNIFORM : { bulk: 500, listed: 300 }; })();
  var BULK_LIMIT = { free: 20, light: PAID_UNI ? PAID_UNI.bulk : 100, total: 500, business: 500 };
  /** プランごとの1回の行数の上限 */
  function bulkLimit(tier) { return BULK_LIMIT[tier] || BULK_LIMIT.free; }
  function money(v) {
    var t = String(v == null ? '' : v).replace(/[\s,¥￥\\円]/g, '');
    if (!/^\d+(\.\d+)?$/.test(t)) return null;
    var n = Math.round(Number(t)); return n > 0 ? n : null;
  }
  /** 1行を列に分ける。タブがあればタブ、無くて空白があれば空白(金額の「,」は桁区切り)、どちらも無ければカンマ(""で囲んだ列に対応) */
  function splitCols(line) {
    if (line.indexOf('\t') >= 0) return line.split('\t').map(function (c) { return c.trim().replace(/^"(.*)"$/, '$1'); });
    var t = line.trim();
    if (/\s/.test(t) && !/^[^\s,]+,\s/.test(t)) return t.split(/\s+/).map(function (c) { return c.replace(/^"(.*)"$/, '$1'); });
    var out = [], cur = '', q = false;
    for (var i = 0; i < t.length; i++) {
      var ch = t[i];
      if (ch === '"') { if (q && t[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (ch === ',' && !q) { out.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  }
  /**
   * 貼った文字を1行=1商品として読む。1列目=JAN(13桁・8桁)かASIN(B0で始まる10桁)、2列目=仕入れ値(任意)、3列目=Amazonの売値(任意)。
   * 全角は半角に直し、同じコードは1つにまとめる(後の行にだけ金額があれば、それを足す)。
   * 返り値: { items: [{code, type:'jan'|'asin', cost, sell, line}], bad: [{line, text, why}], dup: まとめた行の数, total: 空行を除いた行の数 }
   */
  function parseCodes(text) {
    var lines = half(text).replace(/\r/g, '').split('\n');
    var items = [], bad = [], seen = {}, dup = 0, total = 0, first = true;
    lines.forEach(function (raw, idx) {
      if (!raw.trim()) return;
      var cols = splitCols(raw), c0 = String(cols[0] || '').replace(/[\s\-‐－ー]/g, '').toUpperCase();
      if (!/\d/.test(c0) && first) { first = false; return; }   // 最初の行が見出し(JAN、コード など)なら数えない。2行目からの文字だけの行は、読めなかった行に出す
      first = false;
      total++;
      var type = null;
      if (/^B0[A-Z0-9]{8}$/.test(c0)) type = 'asin';
      else if (/^\d{13}$/.test(c0) || /^\d{8}$/.test(c0)) {
        if (!janValid(c0)) { bad.push({ line: idx + 1, text: raw.trim(), why: 'JANの検査の数字が合いません(打ち間違いの可能性)' }); return; }
        type = 'jan';
      } else { bad.push({ line: idx + 1, text: raw.trim(), why: '1列目がJAN(13桁・8桁)でもASIN(B0で始まる10桁)でもありません' }); return; }
      var cost = money(cols[1]), sell = money(cols[2]);
      if (tooBig(cost) || tooBig(sell)) { bad.push({ line: idx + 1, text: raw.trim(), why: '金額を確かめてください(1,000万円以上は計算しません。金額の列にJANを貼っていないか見てください)' }); return; }
      if (seen[c0]) {
        dup++;
        if (seen[c0].cost == null && cost != null) seen[c0].cost = cost;
        if (seen[c0].sell == null && sell != null) seen[c0].sell = sell;
        return;
      }
      seen[c0] = { code: c0, type: type, cost: cost, sell: sell, line: idx + 1 };
      items.push(seen[c0]);
    });
    return { items: items, bad: bad, dup: dup, total: total };
  }
  /** 配列を n 件ずつに分ける(Keepaは1回100件まで) */
  function chunk(list, n) {
    var out = []; n = Math.max(1, int(n) || 1);
    for (var i = 0; i < (list || []).length; i += n) out.push(list.slice(i, i + n));
    return out;
  }
  /** まとめての1行の判定。r = 計算の結果(ポイント抜きの利益 profitNoPoints・必要な利益 need・売値が未入力なら est)、maxCost = 仕入れ値が無い行の上限。
      'ok'(目標に届く)/'ng'(届かない)/'unk'(売値か仕入れ値が無く、確かめられない) */
  function bulkJudge(r, hasCost, maxCost) {
    if (!hasCost) return maxCost === null ? 'ng' : 'unk';  // 売値も無い(上限が出せない=undefined)なら未入力。仕入れ値0円でも目標に届かない売値(null)だけ「届かない」
    if (!r || r.est || !(r.sell > 0)) return 'unk';
    return r.profitNoPoints >= r.need ? 'ok' : 'ng';
  }

  /* ---------- 商品ページ: 売れ行きの目安・在庫で持つかの目安・価格の推移 ---------- */
  /** 目安の基準の初期値(config.js の ITEM_RULES で上書きできる)。
      speed = 30日の販売の目安がこの個数以上なら 段階5・4・3・2(未満は1)。pricey = 売値がこの額以上は「金額が大きい」。
      minShops = 仕入れ先で在庫のある店がこの数以上なら、取り寄せ販売にしても切れにくいと見る */
  var ITEM_RULES = { speed: [100, 30, 10, 3], pricey: 10000, minShops: 3 };
  var SPEED_LABEL = ['', 'ほとんど動かない', 'ゆっくり', 'ふつう', '速い', 'とても速い'];
  function posInt(v) { var n = Math.round(Number(v)); return isFinite(n) && n > 0 ? n : 0; }
  /**
   * 売れ行きの目安。Keepaの値から推定する(実際の販売数ではない)。
   *   k = { sold: 月間販売数(Amazonの「過去1か月で○点以上購入」。無ければ null), d30・d90: ランキングが上がった回数(30日・90日。取れていなければ null) }
   *   30日の目安 n30 = max(月間販売数, 30日の回数)。月間販売数は「以上」の値、回数は1日に何個売れても1回としか数えないことがあるので、どちらも下の見積もり
   *   90日の目安 n90 = max(90日の回数, n30)。90日は30日を含むので、30日の目安より小さくしない
   *   1か月の目安 monthly = max(n30, n90 ÷ 3)。段階とペースは、どちらもこの1つの数から出す(食い違わせない)
   *   何日に1個 per = 30 ÷ monthly(丸めない。画面に出す時は paceText で整数にする)
   *   段階 level = monthly を rules.speed に当てる。5=とても速い … 1=ほとんど動かない
   * 値が1つも取れていなければ null(出さない)
   */
  function sellThrough(k, rules) {
    k = k || {}; rules = rules || ITEM_RULES;
    var hasSold = k.sold != null && Number(k.sold) > 0, has30 = k.d30 != null && Number(k.d30) >= 0, has90 = k.d90 != null && Number(k.d90) >= 0;
    if (!hasSold && !has30 && !has90) return null;
    var sold = hasSold ? posInt(k.sold) : 0, d30 = has30 ? posInt(k.d30) : 0, d90 = has90 ? posInt(k.d90) : 0;
    var n30 = hasSold || has30 ? Math.max(sold, d30) : null;
    var n90 = has90 || n30 != null ? Math.max(d90, n30 || 0) : null;
    var monthly = Math.max(n30 || 0, (n90 || 0) / 3);
    var per = monthly > 0 ? 30 / monthly : null;
    var sp = rules.speed || ITEM_RULES.speed, level = 1;
    for (var i = 0; i < sp.length; i++) { if (monthly >= sp[i]) { level = 5 - i; break; } }
    return { n30: n30, n90: n90, monthly: monthly, per: per, level: level, label: SPEED_LABEL[level],
      src: hasSold && sold >= d30 ? 'sold' : 'drops', has30: n30 != null, has90: has90 };
  }
  /** ペースの文。1日に1個以上なら「1日に約N個」、未満なら「約N日に1個」(どちらも整数。目安なので小数は出さない) */
  function paceText(s) {
    if (!s || !(s.monthly > 0)) return '—';
    var perDay = s.monthly / 30;
    return perDay >= 1 ? '1日に約' + Math.max(1, Math.round(perDay)) + '個' : '約' + Math.max(1, Math.round(30 / s.monthly)) + '日に1個';
  }
  /**
   * 在庫で持つか、取り寄せ販売にするかの目安(断定ではない)。
   *   o = { level: 売れる速さの段階(1〜5。取れていなければ null), sell: 売値, shops: 仕入れ先で在庫のある店の数(取れていなければ null), big: 大型・特大型か }
   *   速い(4以上)                         → 在庫で持つ向き
   *   ふつう(3)で、金額が小さく大型でない → 在庫で持つ向き
   *   ふつう(3)で、金額が大きいか大型      → 店が少ない(minShops未満)なら「どちらも向かない」、それ以外は取り寄せ販売の向き
   *   ゆっくり(2)                          → 店が少ないなら「どちらも向かない」、それ以外は取り寄せ販売の向き
   *   ほとんど動かない(1)                  → 店が minShops 以上と分かっている時だけ取り寄せ販売の向き、それ以外は「どちらも向かない」
   * 返り値 { kind: 'stock'|'order'|'none'|'unk', why: [理由の文], check: 店の数を確かめる必要があるか }
   */
  function stockAdvice(o, rules) {
    o = o || {}; rules = rules || ITEM_RULES;
    var lv = o.level, why = [];
    if (!(lv >= 1)) return { kind: 'unk', why: ['売れ行きが取れていないため、目安を出せません。'], check: false };
    var sellKnown = Number(o.sell) > 0, pricey = sellKnown && Number(o.sell) >= rules.pricey, big = !!o.big, min = rules.minShops;
    var known = o.shops != null && isFinite(Number(o.shops)), few = known && Number(o.shops) < min, enough = known && Number(o.shops) >= min;
    var speed = '売れる速さは「' + SPEED_LABEL[lv] + '」';
    var shopsText = known ? '仕入れ先で在庫のある店は' + Number(o.shops) + '店' : '仕入れ先で在庫のある店の数は取れていません';
    var kind;
    if (lv >= 4) {
      kind = 'stock'; why.push(speed + '。在庫を持っても長く寝かせにくい速さです。');
      if (big) why.push('大型のため、保管の費用がかさみます。少ない個数から。');
      if (pricey) why.push('1個の金額が大きいので、少ない個数から。');
    } else if (lv === 3 && !pricey && !big) {
      kind = 'stock'; why.push(speed + (sellKnown ? '。金額が小さく、大型でもないので、少ない個数なら在庫で持てます。' : '。大型でもないので、少ない個数なら在庫で持てます(売値が入っていないため、金額の大きさは見ていません)。'));
    } else if (lv === 3 || lv === 2) {
      why.push(speed + (lv === 3 ? '。' + (pricey ? '1個の金額が大きい' : '') + (pricey && big ? '・' : '') + (big ? '大型で保管の費用がかさむ' : '') + 'ため、在庫で持つと資金が寝ます。' : '。在庫で持つと、売れるまで資金が寝ます。'));
      kind = few ? 'none' : 'order'; why.push(shopsText + (few ? '。注文が入った時に仕入れられないおそれがあります。' : (enough ? '。注文が入ってから仕入れても、切れにくい数です。' : '。' + min + '店以上あるかを確かめてください。')));
    } else {
      why.push(speed + '。在庫で持つと長く寝ます。');
      kind = enough ? 'order' : 'none'; why.push(shopsText + (enough ? '。注文が入ってから仕入れる形なら、在庫を抱えずに済みます。' : (few ? '。取り寄せ販売の形も切れるおそれがあります。' : '。')));
    }
    return { kind: kind, why: why, check: !known && kind !== 'stock' };
  }
  /**
   * Keepaの価格の履歴([時刻, 値, 時刻, 値, …]。時刻は Keepa の分 = Unix分 − 21564000、値は円。−1は在庫なし)を、
   * 1日1つの値(その日の終わりの値)に直す。now から days 日ぶん。値が無い日は null。step = 1件の幅(カート価格は3)
   */
  function keepaDaily(csv, nowMs, days, step) {
    days = days || 90; step = step || 2;
    if (!csv || !csv.length) return null;
    var DAY = 86400000, end = Math.floor(nowMs / DAY) * DAY + DAY, start = end - days * DAY, out = [], j = 0, cur = null, any = false;
    for (var d = 0; d < days; d++) {
      var lim = start + (d + 1) * DAY;
      while (j + 1 < csv.length && (Number(csv[j]) + 21564000) * 60000 < lim) { cur = Number(csv[j + 1]); j += step; }
      var v = cur != null && cur > 0 ? cur : null; if (v != null) any = true;
      out.push(v);
    }
    return any ? out : null;
  }
  /** 推移の図に出す数字: 今(最後の値)・最安・最高・値のある日数 */
  function seriesStats(list) {
    var v = (list || []).filter(function (x) { return x != null; });
    if (!v.length) return null;
    var last = null; for (var i = list.length - 1; i >= 0; i--) if (list[i] != null) { last = list[i]; break; }
    return { last: last, min: Math.min.apply(null, v), max: Math.max.apply(null, v), days: v.length };
  }
  /** 送料込みの店が無く、送料別の一番安い店を入れた行(it.needShip。まとめてが付ける)で、送料がまだ入っていないか。
      送料なしで利益を出さないための判定。it.shipSet = 利用者が送料の欄を触った印(0円と入れた時も計算する) */
  function needShip(it) { return !!it && !!it.needShip && Number(it.price) > 0 && !(Number(it.inShip) > 0) && !it.shipSet; }

  return {
    ITEM_RULES: ITEM_RULES, SPEED_LABEL: SPEED_LABEL, sellThrough: sellThrough, paceText: paceText, stockAdvice: stockAdvice, keepaDaily: keepaDaily, seriesStats: seriesStats, needShip: needShip,
    MAX_YEN: MAX_YEN, tooBig: tooBig, prepCost: prepCost, fixedTotal: fixedTotal, breakEvenUnits: breakEvenUnits, bulkLimit: bulkLimit, parseCodes: parseCodes, chunk: chunk, bulkJudge: bulkJudge, splitCols: splitCols,
    findCarrier: findCarrier, carrierCost: carrierCost, warehouseCost: warehouseCost, statusFlow: statusFlow,
    findCategory: findCategory, referralExTax: referralExTax, referralFee: referralFee,
    findFbaTier: findFbaTier, fbaFee: fbaFee, guessFbaTier: guessFbaTier, points: points,
    amazonProfit: amazonProfit, needProfit: needProfit, amazonPriceFor: amazonPriceFor, amazonBreakEvenSell: amazonBreakEvenSell, amazonMaxCost: amazonMaxCost,
    marketFee: marketFee, findShipping: findShipping, marketProfit: marketProfit, marketPriceFor: marketPriceFor,
    auctionUnitCost: auctionUnitCost, auctionFee: auctionFee, toCSV: toCSV, csvCell: csvCell, parseEndTime: parseEndTime, endState: endState, endMs: endMs, fmtLeft: fmtLeft, toLocalInput: toLocalInput, extractJan: extractJan, janValid: janValid
  };
});
