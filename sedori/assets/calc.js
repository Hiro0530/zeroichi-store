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
    for (var p = start; p <= limit; p++) {
      x.sell = p;
      if (amazonProfit(fees, x).profit >= needProfit(p, target)) return p;
    }
    return null;
  }

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

  /* ---------- ヤフオクの終了日時(無在庫の見張り) ---------- */
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

  return {
    findCarrier: findCarrier, carrierCost: carrierCost, warehouseCost: warehouseCost, statusFlow: statusFlow,
    findCategory: findCategory, referralExTax: referralExTax, referralFee: referralFee,
    findFbaTier: findFbaTier, fbaFee: fbaFee, guessFbaTier: guessFbaTier, points: points,
    amazonProfit: amazonProfit, needProfit: needProfit, amazonPriceFor: amazonPriceFor, amazonBreakEvenSell: amazonBreakEvenSell, amazonMaxCost: amazonMaxCost,
    marketFee: marketFee, findShipping: findShipping, marketProfit: marketProfit, marketPriceFor: marketPriceFor,
    auctionUnitCost: auctionUnitCost, auctionFee: auctionFee, toCSV: toCSV, csvCell: csvCell, parseEndTime: parseEndTime, endState: endState, endMs: endMs, fmtLeft: fmtLeft, toLocalInput: toLocalInput, extractJan: extractJan, janValid: janValid
  };
});
