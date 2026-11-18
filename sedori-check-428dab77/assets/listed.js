/* せどり 利益チェック — 在庫番(取り寄せ販売の品)の在庫の見張りと、止める品の一覧
   使える売り方は1つだけ: 注文が入る → 仕入れる → 自分か発送代行に届く → 自分の名前で発送する。小売店から購入者へ直接送らせる形には使えない。
   - 確かめるのは、仕入れ先(楽天市場)の公式の商品検索APIの返事だけ。呼ぶのは watch-check.js の口(SedoriWatchCheck.stock と .source)。販売サイトのページは読まない
   - 動くのは、このアプリのページを開いている間だけ。Amazonへは何も書き込まない(数量を0にするのは利用者)。自動で買わない
   - 止めた品を見張りに戻すのは、利用者が押した時だけ
   - 保存: 端末の 'mz-items'(品の一覧)・'mz-set'(止める判断の設定)・'mz-run'(最後に確かめた時刻など)・'mz-inbox'(ほかのページからの送り込み)。クラウドへは送らない。
     注文が入った時だけ、台帳に1行足す(台帳の行は今までどおり同期される)
   - 【確認待ち】Amazonの出品レポートの列名(REPORT_COLS)、数量だけを変える在庫ファイルの書式(STOCK_FILE)、楽天の回数の決まり
   前半は計算だけの部品(node の試験 tests/sedori/test_listed.js が読む)。後半が画面 */
(function (root) {
  'use strict';

  /* ================= 計算だけ ================= */
  var MIN = 60 * 1000;
  /** 止める判断の初期値(安全側)。全体の設定('mz-set')と品ごとの項目(floor・minShops)で変えられる */
  var DEFAULTS = {
    stopOnOut: true,    // 1) 在庫切れは1回で止める(控えの店に在庫があっても、まず止める)
    minShops: 2,        // 2) 在庫のある店が2店未満で止める
    failTimes: 2,       // 5) 続けて2回確かめられない
    failMin: 60,        //    または、最後に確かめてから60分
    allFailHours: 3,    //    全品が確かめられない状態が3時間続いたら、全品を止める品に入れる
    backTimes: 2,       // 条件が外れた回が続けて2回で「戻せる」(見張りに戻すのは利用者)
    nameSim: 0.3        // 4) 商品名の似かたがこれ未満なら「店か商品が変わった」
  };
  /** プランごとの、見張れる品数と、自動で確かめる間隔(分。0 = 自動なし) */
  var PAID_UNI = (function () { var c = (typeof window !== 'undefined' && window.ZW_CONFIG) || {}; return 'PAID_UNIFORM' in c ? c.PAID_UNIFORM : { bulk: 500, listed: 300 }; })();   // config.js の PAID_UNIFORM(null で前の形: ライト30・総合100・業務300)
  var LIMIT = { free: 5, light: PAID_UNI ? PAID_UNI.listed : 30, total: PAID_UNI ? PAID_UNI.listed : 100, business: 300 };
  var AUTO_MIN = { free: 0, light: 30, total: 15, business: 10 };
  var CALL_GAP = 2000, PAGE = 30;

  /** 【確認待ち】Amazonに上げる「数量だけを変えるファイル」の書式。確認が取れたら、ここの列名・区切り・文字コードを直して ready を true にする。
      ready が false の間、画面の書き出しのボタンは「準備中(書式を確認中)」のまま(SKUのコピーと手順の案内で代える) */
  var STOCK_FILE = {
    ready: false,
    name: 'amazon-zaiko', ext: 'txt', sep: '\t', bom: false,
    cols: [{ head: 'sku', value: 'sku' }, { head: 'quantity', value: 'qty' }]   // value: sku = 出品者SKU / qty = 数量(止める時は0) / '' = 空のまま
  };
  /** 【確認待ち】出品レポートの列名の候補。当たらない列は、画面で選び直せる */
  var REPORT_COLS = {
    sku: ['seller-sku', '出品者SKU', 'sku'], asin: ['asin1', 'asin', 'ASIN'], name: ['item-name', '商品名'],
    price: ['price', '価格'], qty: ['quantity', '数量'], cond: ['item-condition', 'コンディション'], ch: ['fulfillment-channel', 'フルフィルメントチャネル']
  };
  var COL_LABEL = { sku: '出品者SKU', asin: 'ASIN', name: '商品名', price: '出品価格', qty: '数量', cond: 'コンディション', ch: '発送のしかた(自分かFBAか)' };
  var COL_NEED = ['sku'];

  function num(v) { var n = Number(String(v == null ? '' : v).replace(/[,，\s円¥￥]/g, '')); return isFinite(n) ? n : 0; }
  function half(s) { s = String(s == null ? '' : s); return (s.normalize ? s.normalize('NFKC') : s).trim(); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function yen(n) { n = Math.round(num(n)); return (n < 0 ? '-' : '') + Math.abs(n).toLocaleString('ja-JP'); }
  function hm(t) { var d = new Date(t); return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); }
  function dur(ms) { var m = Math.max(0, Math.floor(ms / MIN)), h = Math.floor(m / 60); return (h ? h + '時間' : '') + (m % 60 || !h ? (m % 60) + '分' : ''); }
  function newId(t) { return 'z' + Number(t || Date.now()).toString(36) + Math.random().toString(36).slice(2, 6); }

  /* ---------- ファイルの読み込み(タブ区切り・カンマ区切り) ---------- */
  /** 文字の並びを表にする。1行目にタブがあればタブ区切り、無ければカンマ区切り。引用符の中の区切りと改行は中身として読む */
  function parseTable(text) {
    text = String(text || '').replace(/^﻿/, '');
    var first = text.split(/\r?\n/)[0] || '', sep = first.indexOf('\t') >= 0 ? '\t' : ',';
    var rows = [], row = [], cell = '', q = false, i, c;
    for (i = 0; i < text.length; i++) {
      c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
      if (c === '"' && cell === '') q = true;
      else if (c === sep) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; rows.push(row); row = []; }
      else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return String(x).trim() !== ''; }); });
  }
  /** バイトの並びを文字にする(UTF-8で読めなければShift_JIS) */
  function decode(buf) {
    var u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch (e) { /* 次へ */ }
    try { return new TextDecoder('shift_jis').decode(u8); } catch (e2) { return new TextDecoder('utf-8').decode(u8); }
  }
  /** 見出しの行から、列の場所を当てる。当たらない列は -1 */
  function detectCols(head) {
    var h = (head || []).map(function (x) { return half(x).toLowerCase(); }), map = {};
    Object.keys(REPORT_COLS).forEach(function (k) {
      map[k] = -1;
      REPORT_COLS[k].some(function (name) { var i = h.indexOf(name.toLowerCase()); if (i >= 0) { map[k] = i; return true; } return false; });
    });
    return map;
  }
  /** 表(1行目は見出し)を、列の場所(map)で品の形にする。発送のしかたの列が AMAZON・FBA・AFN を含む行は ch='fba' */
  function readReport(table, map) {
    var at = function (r, k) { return map[k] >= 0 && map[k] < r.length ? String(r[map[k]]).trim() : ''; };
    return (table || []).slice(1).map(function (r) {
      var ch = at(r, 'ch');
      return { sku: at(r, 'sku'), asin: half(at(r, 'asin')).toUpperCase(), name: at(r, 'name'), price: num(at(r, 'price')), qty: at(r, 'qty') === '' ? 1 : num(at(r, 'qty')),
        cond: at(r, 'cond'), ch: /amazon|fba|afn/i.test(ch) ? 'fba' : 'self' };
    });
  }

  /* ---------- 品の一覧 ---------- */
  /** 品の形にそろえる(古い形・足りない項目があっても壊れない) */
  function norm(o, t) {
    o = o && typeof o === 'object' ? o : {};
    var x = { id: o.id || newId(t), sku: String(o.sku || '').trim(), asin: half(o.asin).toUpperCase(), name: String(o.name || ''), cond: o.cond || '',
      price: num(o.price), qty: o.qty == null || o.qty === '' ? 1 : Math.max(0, num(o.qty)), ch: o.ch === 'fba' ? 'fba' : 'self', jan: half(o.jan).replace(/\D/g, ''),
      src: Array.isArray(o.src) ? o.src.filter(function (s) { return s && s.code; }).slice(0, 3) : [],
      calc: o.calc && typeof o.calc === 'object' ? o.calc : null, floor: o.floor == null || o.floor === '' ? null : num(o.floor), minShops: o.minShops == null ? null : num(o.minShops),
      chk: o.chk && typeof o.chk === 'object' ? o.chk : {}, st: ['watch', 'stop', 'stopped', 'back'].indexOf(o.st) >= 0 ? o.st : 'watch', why: Array.isArray(o.why) ? o.why : [],
      stAt: o.stAt || 0, upAt: o.upAt || 0, clear: num(o.clear), from: o.from || 'manual', addedAt: o.addedAt || t || Date.now() };
    if (o.gone) x.gone = true;
    return x;
  }
  function normAll(list, t) { return (Array.isArray(list) ? list : []).filter(function (o) { return o && typeof o === 'object'; }).map(function (o) { return norm(o, t); }); }

  /** 出品レポートを一覧へ入れる。同じSKUは価格・数量・名前だけ上書き(仕入れ先の対応づけは残す)。FBAの行は入れない。
      レポートから消えたSKUは印(gone)を付けるだけで消さない。limit を超える新しい品は入れない */
  function mergeReport(items, rows, limit, t) {
    var out = normAll(items, t), by = {}, seen = {}, res = { added: 0, updated: 0, fba: 0, nosku: 0, over: 0, gone: 0 };
    out.forEach(function (it) { if (it.sku) by[it.sku] = it; });
    (rows || []).forEach(function (r) {
      if (!r.sku) { res.nosku++; return; }
      if (r.ch === 'fba') { res.fba++; return; }
      if (seen[r.sku]) return; seen[r.sku] = 1;
      var it = by[r.sku];
      if (it) { it.price = r.price; it.qty = r.qty; if (r.name) it.name = r.name; if (r.asin) it.asin = r.asin; if (r.cond) it.cond = r.cond; delete it.gone; res.updated++; return; }
      if (limit != null && out.length >= limit) { res.over++; return; }
      it = norm({ sku: r.sku, asin: r.asin, name: r.name, price: r.price, qty: r.qty, cond: r.cond, from: 'report' }, t);
      out.push(it); by[r.sku] = it; res.added++;
    });
    out.forEach(function (it) { if (it.from === 'report' && it.sku && !seen[it.sku] && !it.gone) { it.gone = true; res.gone++; } });
    res.items = out;
    return res;
  }
  /** ほかのページからの送り込み(まとめて・ウォッチ・商品ページ)と手入力。SKU → JAN → ASIN の順に同じ品を探し、あれば足りない所だけ埋める */
  function addIncoming(items, rows, from, limit, t) {
    var out = normAll(items, t), res = { added: 0, updated: 0, over: 0, ids: [] };
    (rows || []).forEach(function (r) {
      if (!r || typeof r !== 'object') return;
      var jan = half(r.jan).replace(/\D/g, ''), asin = half(r.asin).toUpperCase(), sku = String(r.sku || '').trim();
      if (!jan && !asin && !sku) return;
      var hit = out.filter(function (it) { return (sku && it.sku === sku) || (jan && it.jan === jan) || (!sku && !jan && asin && it.asin === asin); })[0];
      var s = r.code ? { mall: 'rakuten', code: r.code, shop: r.shop || '', shopCode: r.shopCode || String(r.code).split(':')[0], url: r.url || '', base: num(r.cost != null ? r.cost : r.base), name: r.srcName || r.name || '', freeShip: !!r.freeShip, pt: num(r.pt) || 1 } : null;
      if (hit) {
        if (!hit.sku && sku) hit.sku = sku; if (!hit.jan && jan) hit.jan = jan; if (!hit.asin && asin) hit.asin = asin;
        if (!hit.name && r.name) hit.name = r.name; if (!hit.price && num(r.price)) hit.price = num(r.price);
        if (!hit.src.length && s) hit.src = [s]; if (!hit.calc && r.calc) hit.calc = clone(r.calc);
        res.updated++; res.ids.push(hit.id); return;
      }
      if (limit != null && out.length >= limit) { res.over++; return; }
      var it = norm({ sku: sku, asin: asin, jan: jan, name: r.name, price: r.price, qty: r.qty, cond: r.cond, src: s ? [s] : [], calc: r.calc ? clone(r.calc) : null, from: from || 'manual' }, t);
      out.unshift(it); res.added++; res.ids.push(it.id);
    });
    res.items = out;
    return res;
  }

  /* ---------- 仕入れ先(楽天の返事の読み方) ---------- */
  /** JANで検索した返事から、在庫のある店を安い順に(同じ店は一番安い1件) */
  function shopsOf(json) {
    var by = {}, list = [];
    ((json && json.Items) || []).forEach(function (it) {
      it = it.Item || it;
      if (Number(it.availability) === 0 || !(num(it.itemPrice) > 0) || !it.itemCode) return;
      var sc = it.shopCode || String(it.itemCode).split(':')[0];
      var s = { mall: 'rakuten', code: it.itemCode, shop: it.shopName || '', shopCode: sc, url: it.itemUrl || '', price: num(it.itemPrice), name: it.itemName || '', freeShip: Number(it.postageFlag) === 0, pt: num(it.pointRate) || 1 };
      if (!by[sc] || s.price < by[sc].price) by[sc] = s;
    });
    Object.keys(by).forEach(function (k) { list.push(by[k]); });
    return list.sort(function (a, b) { return a.price - b.price; });
  }
  /** 主の店を決める。控えは、残りの安い順に2店まで。base = 対応づけた時の価格 */
  function setSources(item, shops, mainCode) {
    var main = shops.filter(function (s) { return s.code === mainCode; })[0]; if (!main) return item;
    var mk = function (s) { return { mall: 'rakuten', code: s.code, shop: s.shop, shopCode: s.shopCode, url: s.url, base: s.price, name: s.name, freeShip: s.freeShip, pt: s.pt }; };
    item.src = [mk(main)].concat(shops.filter(function (s) { return s.code !== mainCode; }).slice(0, 2).map(mk));
    item.chk = {}; item.clear = 0;
    if (item.st !== 'stopped') { item.st = 'watch'; item.why = []; }
    return item;
  }
  /** watch-check.js の取り直し(SedoriWatchCheck.stock)に渡す形 */
  function stockInput(item) { return { id: item.id, jan: item.jan || '', sources: item.src.map(function (s) { return { code: s.code, shop: s.shop, url: s.url }; }) }; }
  /** 取り直しの結果(1品分)を、判断に使う形にする。主の店が確かめられなかった時は ok = false(売り切れと決めつけない)。
      shops = 在庫のある店(登録した店と、JANの検索に出たほかの店の上位)。JANの無い品は、登録した店のうち在庫のある店だけ */
  function fromStock(item, res) {
    var main = res && res.shops && res.shops[0];
    if (!main || main.state === 'unknown') return { ok: false };
    var shops = null, sc = function (code) { return String(code || '').split(':')[0]; };
    {   // JANの検索の返事が無い品(JANなし)も、登録した店のうち在庫のある店だけで数える(仕入れ先が1店だけの品は、初めから止める候補)
      var by = {};
      res.shops.filter(function (x) { return x.state === 'in'; }).concat(res.market ? res.market.top || [] : []).forEach(function (x) {
        var s = { code: x.code, shop: x.shop || '', shopCode: sc(x.code), price: num(x.price), freeShip: x.freeShip };
        if (!by[s.shopCode] || s.price < by[s.shopCode].price) by[s.shopCode] = s;
      });
      shops = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return a.price - b.price; });
    }
    return { ok: true, stock: main.state === 'in', missing: !!main.missing, price: main.state === 'in' ? num(main.price) : null, freeShip: main.freeShip, name: main.name || '', shopCode: sc(main.code), shops: shops };
  }
  /** 2つの名前の似かた(0〜1。2文字ずつの重なり) */
  function sim(a, b) {
    var g = function (s) { s = half(s).toLowerCase().replace(/\s+/g, ''); var o = {}, n = 0; for (var i = 0; i < s.length - 1; i++) { var k = s.substr(i, 2); o[k] = (o[k] || 0) + 1; n++; } return { o: o, n: n }; };
    var x = g(a), y = g(b), hit = 0; if (!x.n || !y.n) return 1;
    Object.keys(x.o).forEach(function (k) { if (y.o[k]) hit += Math.min(x.o[k], y.o[k]); });
    return 2 * hit / (x.n + y.n);
  }

  /* ---------- 止める判断 ---------- */
  function optsOf(set) { var o = {}; Object.keys(DEFAULTS).forEach(function (k) { o[k] = set && set[k] != null ? set[k] : DEFAULTS[k]; }); return o; }
  /** 計算の条件はあるが、自分で送る品の購入者への送料が未入力 */
  function shipMissing(item) { var c = item && item.calc; return !!(c && c.selfShip && (c.selfShipCost == null || c.selfShipCost === '')); }
  /** 利益を見ていない理由(見ているなら空) */
  function noProfit(item) { return !item.calc ? 'カテゴリー未選択' : (shipMissing(item) ? '送料が未入力' : ''); }
  /** その仕入れ値での利益(ポイント抜き)。計算の条件が無ければ null。env = { C: SedoriCalc, fees, target } */
  function profitAt(env, item, cost) {
    if (!env || !env.C || !env.fees || !item.calc || !(num(cost) > 0)) return null;
    if (shipMissing(item)) return null;   // 購入者への送料が未入力なら、利益は見ない(0円と決めつけて甘く出さない)
    var x = Object.assign({}, item.calc, { cost: num(cost), usePoints: false }); if (item.price > 0) x.sell = item.price;
    if (!(num(x.sell) > 0)) return null;
    try { return env.C.amazonProfit(env.fees, x).profitNoPoints; } catch (e) { return null; }
  }
  /** 止める利益の線。品ごとの値が無ければ、全ページ共通の目標の利益 */
  function floorOf(env, item) {
    if (item.floor != null) return num(item.floor);
    var sell = item.price > 0 ? item.price : num((item.calc || {}).sell);
    return env && env.C ? env.C.needProfit(sell, env.target) : 0;
  }
  /**
   * 1品を判断する。obs = fromStock の結果。set = 全体の設定。
   * 返す: { unknown: 確かめられなかった, why: 止める理由の並び(空なら止めない), profit, floor, shops(線に届く在庫のある店の数。数えられない時は null), price }
   * 理由: out(在庫切れ)・few(在庫のある店が足りない)・profit(利益が線を割る)・shop(店か商品が変わった)・ship(送料無料でなくなった)
   */
  function judge(item, obs, env, set) {
    if (!obs || !obs.ok) return { unknown: true, why: [] };
    var o = optsOf(set), main = item.src[0] || {}, why = [], floor = floorOf(env, item);
    var reach = function (s) { var p = profitAt(env, item, s.price); return p == null ? true : p >= floor; };
    var okShops = obs.shops ? obs.shops.filter(reach) : null;
    var minShops = item.minShops != null ? item.minShops : o.minShops;
    var pf = obs.stock ? profitAt(env, item, obs.price) : null;
    if (!obs.stock) {
      var spare = okShops ? okShops.filter(function (s) { return s.code !== main.code; }).length : 0;
      if (o.stopOnOut || !spare) why.push('out');
    }
    if (okShops && okShops.length < minShops) why.push('few');
    if (obs.stock && pf != null && pf < floor) why.push('profit');
    var changed = (obs.missing && obs.shops && obs.shops.length > 0) || (obs.stock && obs.shopCode && main.shopCode && obs.shopCode !== main.shopCode) ||
      (obs.stock && main.name && obs.name && sim(main.name, obs.name) < o.nameSim);
    if (changed) why.push('shop');
    if (obs.stock && main.freeShip === true && obs.freeShip === false) why.push('ship');
    return { unknown: false, why: why, profit: pf, floor: floor, shops: okShops ? okShops.length : null, price: obs.stock ? obs.price : null, stock: !!obs.stock, missing: !!obs.missing };
  }
  /** 判断を品に入れる(品そのものを書き換える)。止める品に入った後で条件が外れても、見張り中へは戻さない(続けて backTimes 回で「戻せる」) */
  function applyCheck(item, res, t, set) {
    var o = optsOf(set); item.chk = item.chk || {};
    if (res.unknown) { item.chk.fails = num(item.chk.fails) + 1; item.chk.tFail = t; return item; }
    item.chk = { t: t, fails: 0, price: res.price, stock: res.stock, missing: res.missing, shops: res.shops, profit: res.profit, floor: res.floor };
    if (res.why.length) {
      item.clear = 0; item.why = res.why.slice();
      if (item.st === 'watch' || item.st === 'back') { item.st = 'stop'; item.stAt = t; }
    } else if (item.st === 'stop' || item.st === 'stopped') {
      item.clear = num(item.clear) + 1;
      if (item.clear >= o.backTimes) { item.st = 'back'; item.stAt = t; item.why = []; }
    }
    return item;
  }
  /** 利用者が押した時だけ: 数量を0にした/見張りに戻す(今の店と送料の条件を、新しい基準にする) */
  function markStopped(item, t) { item.st = 'stopped'; item.upAt = t; item.clear = 0; return item; }
  function resume(item, t) {
    item.st = 'watch'; item.why = []; item.clear = 0; item.stAt = t; item.upAt = 0;
    if (item.chk) { item.chk.fails = 0; if (item.src[0] && item.chk.stock && item.chk.price != null) item.src[0].base = item.chk.price; }
    return item;
  }
  /** 注文が入った: 数量が1なら、次の注文を受けないために止める品へ。2以上なら数量を1つ減らす */
  function onOrder(item, t) {
    if (item.qty > 1) { item.qty -= 1; return item; }
    item.st = 'stop'; item.why = ['order']; item.stAt = t; item.clear = 0; return item;
  }

  /**
   * 画面に出す状態。ctx = { now, set, limit(見張れる品数), index(一覧の中の順), allFailSince(全品が確かめられなくなった時刻) }
   * 返す: { st: none(仕入れ先が未入力)/ over(プランの上限の外)/ new(まだ確かめていない)/ watch / stop / stopped / back, why: [...] }
   * 「確かめられない」は保存せず、その場で出す(確かめ直せたら見張り中に戻る): unknown(続けて失敗)・stale(時間がたった)・halt(見張りが止まったまま)
   */
  function view(item, ctx) {
    var o = optsOf(ctx.set), now = ctx.now, c = item.chk || {};
    var beyond = ctx.limit != null && ctx.index >= ctx.limit;   // プランの上限の外(これから確かめない品)
    // 止める品・止めた品・戻せる品は、上限より先に決める(上限の外でも「止める」を隠さない)
    if (item.st === 'stopped' || item.st === 'back') return { st: item.st, why: item.why || [], beyond: beyond };
    if (item.st === 'stop') return { st: 'stop', why: item.why && item.why.length ? item.why : ['unknown'], beyond: beyond };
    if (beyond) return { st: 'over', why: [] };
    if (!item.src.length) return { st: 'none', why: [] };
    // 品ごとの判定(続けての失敗・時間切れ)を先に。全部の通信が失敗している間も、止める品は止める品のまま
    if (num(c.fails) >= o.failTimes) return { st: 'stop', why: ['unknown'] };
    if (c.t && now - c.t >= o.failMin * MIN) return { st: 'stop', why: ['stale'] };
    if (ctx.allFailSince && now - ctx.allFailSince >= o.allFailHours * 60 * MIN) return { st: 'stop', why: ['halt'] };
    return { st: c.t ? 'watch' : 'new', why: [] };
  }
  /** 理由を文にする(色だけに頼らない) */
  function whyText(item, v, now, set) {
    var c = item.chk || {}, o = optsOf(set), min = item.minShops != null ? item.minShops : o.minShops;
    return (v.why || []).map(function (w) {
      if (w === 'out') return c.missing ? '楽天で見つからない(売り切れか、取り扱いの終了)' : '売り切れ';
      if (w === 'few') return '在庫のある店が' + num(c.shops) + '店(' + min + '店未満)';
      if (w === 'profit') return '利益が目標を割る(今 ' + yen(c.profit) + '円・目標 ' + yen(c.floor) + '円)';
      if (w === 'shop') return '仕入れ先の店か商品が変わった';
      if (w === 'ship') return '送料無料でなくなった';
      if (w === 'unknown') return '確かめられない(' + o.failTimes + '回続けて取れていません)';
      if (w === 'stale') return '確かめられない(最後に確かめてから' + dur(now - c.t) + ')';
      if (w === 'halt') return '見張りが' + o.allFailHours + '時間以上止まっている';
      if (w === 'order') return '注文が入った(次の注文を受けないため)';
      return w;
    }).join('・');
  }
  /** 一覧をまとめて数える */
  function summarize(items, ctx) {
    var s = { stop: [], back: [], none: [], over: [], fresh: [], watch: [], stopped: [] };
    (items || []).forEach(function (it, i) {
      var v = view(it, Object.assign({}, ctx, { index: i })), row = { it: it, v: v };
      (v.st === 'new' ? s.fresh : s[v.st]).push(row);
    });
    return s;
  }

  /* ---------- 確かめた結果を一覧に入れる ----------
     out = SedoriWatchCheck.stock の返事 { results: [1品分…], stopped: ''/user/quota/error/nokeys/busy, error }。judgeOf(item, obs) → judge の結果
     返す: { done(確かめられた品の数), stops: [新しく止める品に入った id], backs: [戻せるに移った id], allFail(失敗で止まり、1品も確かめられなかった) }
     allFail の時は、品ごとには数えない(見張りが止まっていることを帯で1つ知らせ、allFailHours 続いたら全品を止める品に入れる) */
  function applyRound(items, out, judgeOf, t, set) {
    var by = {}, r = { done: 0, stops: [], backs: [], allFail: false };
    ((out && out.results) || []).forEach(function (x) { by[x.id] = x; });
    var obs = {}; (items || []).forEach(function (it) { if (by[it.id]) { obs[it.id] = fromStock(it, by[it.id]); if (obs[it.id].ok) r.done++; } });
    if (out && out.stopped === 'error' && !r.done) { r.allFail = true; return r; }
    (items || []).forEach(function (it) {
      var o = obs[it.id], was = it.st; if (!o) return;
      applyCheck(it, o.ok ? judgeOf(it, o) : { unknown: true, why: [] }, t, set);
      if (it.st === 'stop' && was !== 'stop' && was !== 'stopped') r.stops.push(it.id);
      if (it.st === 'back' && was !== 'back') r.backs.push(it.id);
    });
    return r;
  }
  /** 確かめる順: 仕入れ先のある品を、確かめた時刻の古い順に。limit を超えた品は入れない */
  function pickRound(items, limit) {
    return (items || []).filter(function (it, i) { return it.src.length && (limit == null || i < limit); })
      .sort(function (a, b) { return num(a.chk && a.chk.t) - num(b.chk && b.chk.t); });
  }
  /** その品数を、その間隔(分)で回りきれるか(1品1回・2秒おきで数える) */
  function fits(n, minutes, gap) { return n * (gap == null ? CALL_GAP : gap) <= minutes * MIN; }

  /* ---------- 書き出し ---------- */
  /** 在庫ファイルに書ける品(SKUがあり、自分で送る品だけ。FBAの品は決して書かない) */
  function fileItems(items) { return (items || []).filter(function (it) { return it && it.sku && it.ch !== 'fba'; }); }
  function cell(v, sep) { v = String(v == null ? '' : v); return v.indexOf(sep) >= 0 || /["\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  /** 数量を変えるファイルの中身。qty = 入れる数量(止める時は0、戻す時は1)。fmt を渡さなければ STOCK_FILE */
  function stockFile(items, qty, fmt) {
    fmt = fmt || STOCK_FILE;
    var lines = [fmt.cols.map(function (c) { return cell(c.head, fmt.sep); }).join(fmt.sep)];
    fileItems(items).forEach(function (it) {
      lines.push(fmt.cols.map(function (c) { return cell(c.value === 'sku' ? it.sku : (c.value === 'qty' ? qty : ''), fmt.sep); }).join(fmt.sep));
    });
    return (fmt.bom ? '﻿' : '') + lines.join('\r\n') + '\r\n';
  }
  var STOP_HEAD = ['出品者SKU', 'ASIN', '商品名', '止める理由', '止める品に入った時刻'];
  function stopRows(rows, now, set) {
    return (rows || []).map(function (x) { var d = x.it.stAt ? new Date(x.it.stAt) : null;
      return [x.it.sku, x.it.asin, x.it.name, whyText(x.it, x.v, now, set), d ? d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' + hm(d) : '']; });
  }
  function skuList(rows) { return (rows || []).map(function (x) { return x.it.sku; }).filter(Boolean); }

  /* ---------- 注文が入った時に、台帳へ足す行 ---------- */
  /** o = { amzOrder: Amazonの注文番号, shipBy: 発送の期限(YYYY-MM-DD), today }。行は「売約・仕入れ前」で入る(仕入れ額の合計と古物台帳の書き出しには、仕入れるまで入らない) */
  function orderRow(item, o) {
    var main = item.src[0] || {}, c = item.chk || {};
    var row = { status: '売約', wait: true, route: '取り寄せ販売', cond: /中古|used/i.test(item.cond) ? '中古' : '新品', name: item.name || '(名前なし)',
      feature: [item.jan ? 'JAN ' + item.jan : '', item.asin ? 'ASIN ' + item.asin : ''].filter(Boolean).join(' '), qty: 1, unit: num(c.price != null ? c.price : main.base),
      party: main.shop ? '楽天市場 ' + main.shop : '', ref: main.url || '', sellTo: 'Amazon', sellPrice: item.price || '', saleDate: o.today, salePrice: item.price || '', saleParty: 'Amazon 購入者',
      ship: 'self', profit: c.profit == null ? '' : c.profit, pnp: true,
      mz: { itemId: item.id, sku: item.sku || '', amzOrder: String(o.amzOrder || '').trim(), shipBy: o.shipBy || '', orderedAt: o.today } };
    if (item.calc) row.calc = clone(item.calc);
    return row;
  }

  var Core = { DEFAULTS: DEFAULTS, LIMIT: LIMIT, AUTO_MIN: AUTO_MIN, CALL_GAP: CALL_GAP, PAGE: PAGE, STOCK_FILE: STOCK_FILE, REPORT_COLS: REPORT_COLS, COL_LABEL: COL_LABEL, COL_NEED: COL_NEED,
    parseTable: parseTable, decode: decode, detectCols: detectCols, readReport: readReport, norm: norm, normAll: normAll, mergeReport: mergeReport, addIncoming: addIncoming,
    shopsOf: shopsOf, setSources: setSources, stockInput: stockInput, fromStock: fromStock, sim: sim, optsOf: optsOf, profitAt: profitAt, floorOf: floorOf, judge: judge, applyCheck: applyCheck,
    markStopped: markStopped, resume: resume, onOrder: onOrder, noProfit: noProfit, view: view, whyText: whyText, summarize: summarize, applyRound: applyRound, pickRound: pickRound, fits: fits,
    fileItems: fileItems, stockFile: stockFile, STOP_HEAD: STOP_HEAD, stopRows: stopRows, skuList: skuList, orderRow: orderRow, dur: dur, hm: hm };
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  root.SedoriListedCore = Core;
  if (typeof document === 'undefined' || !root.SedoriUI) return;

  /* ================= 画面 =================
     置き場は #listed(新しいページ「在庫番」)。置き場の無いページでは、自動の確かめと送り込みの口だけ動く */
  var U = root.SedoriUI, $ = U.$, $$ = U.$$, esc = U.esc;
  var box = null, fees = null, running = false, stopFlag = false, prog = null, openId = null, pick = null, lastErr = '', gapNote = '', more = {}, dlgState = null;

  function SRC() { var w = root.SedoriWatchCheck; return w && w.source ? w.source : null; }   // 仕入れ先を探す時に、楽天を1回呼ぶ口
  /* 利用の鍵の形(KEY_MODE)では、品数と自動の確かめの間隔は Worker の /core が利用の証明を見て決める(2026-11-17 21:50 の決定)。
     端末の段の判定や設定(LISTED_LIMIT)を書き換えても増えない。答えが無い間(通信できない・まだ聞いていない)は無料の数(5品・自動なし)で数える */
  function SA() { return root.SedoriAccount || {}; }
  function keyMode() { return !!SA().keyMode && typeof SA().limits === 'function'; }
  function srv() { return keyMode() ? SA().limitsNow() : null; }
  function tier() { if (keyMode()) { var l = srv(); return (l && l.tier) || 'free'; } return U.tier ? U.tier() : 'free'; }
  function limit() {
    if (keyMode()) { var l = srv(); return l ? l.listed : LIMIT.free; }
    var c = (root.ZW_CONFIG || {}).LISTED_LIMIT || {}; return c[tier()] != null ? c[tier()] : LIMIT[tier()];
  }
  function autoMin() { if (keyMode()) { var l = srv(); return l ? l.auto : 0; } return AUTO_MIN[tier()] || 0; }
  function load() { return normAll(U.store.get('mz-items', []), Date.now()); }
  function save(items) { var ok = U.store.set('mz-items', items); if (!ok) U.toast('この端末では保存できませんでした(プライベートブラウズ等)'); return ok; }
  function setOf() { var s = U.store.get('mz-set', {}); return s && typeof s === 'object' ? s : {}; }
  function runOf() { var s = U.store.get('mz-run', {}); return s && typeof s === 'object' ? s : {}; }
  function env() { return { C: root.SedoriCalc, fees: fees, target: U.target() }; }
  function ctx() { return { now: Date.now(), set: setOf(), limit: limit(), allFailSince: runOf().allFailSince || 0 }; }
  function sum() { return summarize(load(), ctx()); }
  function edit(id, fn) { var items = load(), it = items.filter(function (x) { return x.id === id; })[0]; if (!it) return null; fn(it, items); save(items); return it; }
  function pageUrl() { return (root.ZW_CONFIG || {}).LISTED_URL || (box ? location.pathname : U.base() + 'zaiko-ban/'); }

  /* ---------- 送り込み(ほかのページから) ---------- */
  function send(rows, from) {
    if (keyMode() && !srv()) {
      // 品数をサーバーに聞いてから入れる。通信できない時は、受け箱に置いて次に開いた時に入れる
      return SA().limits().then(function () { return sendNow(rows, from); }, function () {
        var inb = U.store.get('mz-inbox', []); if (!Array.isArray(inb)) inb = [];
        U.store.set('mz-inbox', inb.concat(rows).slice(-300));
        U.toast('通信できないため、在庫番の品数を確かめられませんでした。つながってから在庫番を開くと入ります');
        return { added: 0, updated: 0, over: 0, later: rows.length };
      });
    }
    return sendNow(rows, from);
  }
  function sendNow(rows, from) {
    var r = addIncoming(load(), rows, from || 'bulk', limit(), Date.now());
    if (r.added || r.updated) save(r.items);
    var t = (r.added ? r.added + '品を「在庫番」に入れました。' : '') + (r.updated ? r.updated + '品は、もう入っています。' : '') +
      (r.over ? planName() + 'プランは' + limit() + '品までのため、' + r.over + '品は入れていません。' : '');
    if (t) U.toast(t, box ? '' : '在庫番を開く', box ? null : function () { location.href = pageUrl(); });
    if (box) paint();
    return { added: r.added, updated: r.updated, over: r.over };
  }
  function drainInbox() {
    var inb = U.store.get('mz-inbox', []); if (!Array.isArray(inb) || !inb.length) return;
    U.store.del('mz-inbox'); send(inb, 'bulk');
  }
  function planName() { return { free: '無料', light: 'ライト', total: '総合', business: '業務' }[tier()] || '無料'; }

  /* ---------- 確かめる(楽天への取り直しは watch-check.js の SedoriWatchCheck.stock。2秒おき・失敗でその場で止める、は向こうが守る) ---------- */
  function W() { var w = root.SedoriWatchCheck; return w && w.stock && w.source ? w : null; }
  function check(auto) {
    if (running) return Promise.resolve(null);
    if (keyMode()) {
      // 確かめる品の数は、その都度サーバーに聞く(証明が切れていれば無料の5品)
      return SA().limits().then(function () { return checkNow(auto); }, function () {
        lastErr = '通信できないため、確かめられません(在庫番の確かめは通信が要ります)'; if (!auto) U.toast(lastErr); paint(); return null;
      });
    }
    return checkNow(auto);
  }
  function checkNow(auto) {
    if (running) return Promise.resolve(null);
    var w = W(), items = load(), list = pickRound(items, limit());
    if (!list.length) { if (!auto) U.toast(items.length ? '仕入れ先を入れた品がありません。品を開いて、仕入れ先を入れてください' : 'まだ品がありません'); return Promise.resolve(null); }
    if (!w) { if (!auto) U.toast('楽天を確かめる部品を読み込めませんでした。ページを開き直してください'); return Promise.resolve(null); }
    if (!w.source.hasKeys()) { lastErr = 'keys'; if (!auto) U.toast('楽天のアプリIDとアクセスキーが未入力です'); paint(); return Promise.resolve(null); }
    if (w.stockBusy && w.stockBusy()) { if (!auto) U.toast('ほかの確かめが動いています。終わってから、もう一度押してください'); return Promise.resolve(null); }
    running = true; stopFlag = false; prog = [0, list.length]; lastErr = ''; paint();
    var set = setOf(), e = env();
    var done = function (out) {
      running = false; prog = null;
      if (!out || out.stopped === 'busy' || out.stopped === 'nokeys') { if (!auto) U.toast((out && out.error) || '確かめられませんでした'); paint(); return out; }
      var r = applyRound(list, out, function (it, obs) { return judge(it, obs, e, set); }, Date.now(), set);
      // 確かめている間に足された品・直された品を消さないよう、今の一覧へ結果だけ戻す
      var by = {}; list.forEach(function (it) { by[it.id] = it; });
      save(load().map(function (it) { var d = by[it.id]; if (!d) return it; ['chk', 'st', 'why', 'stAt', 'clear'].forEach(function (k) { it[k] = d[k]; }); return it; }));
      var run = runOf(); run.last = Date.now();
      if (r.allFail) { if (!run.allFailSince) run.allFailSince = Date.now(); } else if (r.done) run.allFailSince = 0;
      U.store.set('mz-run', run);
      lastErr = out.stopped === 'error' || out.stopped === 'quota' ? out.error || '' : ''; gapNote = '';
      if (r.stops.length) notify(r.stops.length);
      if (!auto) U.toast(r.done ? r.done + '品を確かめました。' + (r.stops.length ? '止める品が' + r.stops.length + '件増えました。' : '止める品は増えていません。') + (out.stopped === 'user' ? '途中で止めました。' : '') : (lastErr || '確かめられませんでした'));
      paint();
      return r;
    };
    return w.stock(list.map(stockInput), { stopped: function () { return stopFlag; }, onProgress: function (n, all) { prog = [n, all]; paintStatus(); } })
      .then(done, function () { return done(null); });
  }
  /** 自動: 有料・キーあり・間隔がたった・別のタブが動いていない時だけ(ページを開いている間) */
  function tryAuto() {
    var m = autoMin(), w = W(); if (running || !m || !w || !w.source.hasKeys() || (w.stockBusy && w.stockBusy())) return;
    var n = pickRound(load(), limit()).length; if (!n || !fits(n, m)) return;
    if (Date.now() - num(runOf().last) < m * MIN) return;
    check(true);
  }
  function notify(n) {
    var w = root.SedoriWatchCheck, title = '止める品が' + n + '件あります', body = 'Amazonの数量を0にしてください(在庫番を開く)';
    try {
      document.title = '(止める ' + sum().stop.length + ')' + document.title.replace(/^\(止める \d+\)/, '');
      if (!w || !w.notifyOn || !w.notifyOn()) return;
      if (w.notify) { w.notify(title, body, pageUrl(), 'zw-mz'); return; }
      var x = new root.Notification(title, { body: body, tag: 'zw-mz', icon: U.base() + 'icon-192.png' });
      x.onclick = function () { root.focus(); if (!box) location.href = pageUrl(); x.close(); };
    } catch (e) { /* 通知を出せない端末では、画面の表示だけ */ }
  }
  function paintHead() {
    var a = $('#hd-mz'); if (!a) return;
    var n = sum().stop.length; a.hidden = !n; a.textContent = n ? '止める ' + n : '';
  }

  /* ---------- 描く ---------- */
  var NOTES = '<ul class="ls-note"><li>ページを開いている間だけ確かめます</li><li>小売店から購入者への直送には使えません</li></ul>';
  function yenH(n) { return '<span class="yen">' + U.yen(n) + '<i>円</i></span>'; }
  function subLine(it) {
    return [it.sku ? 'SKU ' + esc(it.sku) : '<span class="warnt">SKUが未入力</span>', it.price ? '出品 ' + U.yen(it.price) + '円' : '', '数量 ' + it.qty].filter(Boolean).join('・');
  }
  function srcLine(it) {
    var m = it.src[0], c = it.chk || {}; if (!m) return '';
    return '楽天 ' + esc(m.shop || m.shopCode || '') + (c.t ? (c.stock ? '・在庫あり' : '・在庫なし') + (c.shops != null && c.shops > 1 ? '・ほか' + (c.shops - (c.stock ? 1 : 0)) + '店' : '') : '');
  }
  function rowHTML(x, kind) {
    var it = x.it, v = x.v, c = it.chk || {}, now = Date.now(), open = openId === it.id, state, right = '';
    if (v.st === 'stop') state = '<span class="ls-why">▲ ' + esc(whyText(it, v, now, setOf())) + '</span>' + (v.beyond ? '<span class="ls-out">上限の外のため、これ以上は確かめません。Amazonの数量を0にしたままにするか、品を減らしてください</span>' : '');
    else if (v.st === 'stopped') state = '数量を0にした ' + esc(hm(it.upAt)) + (it.why.length ? '・' + esc(whyText(it, { why: it.why }, now, setOf())) : '');
    else if (v.st === 'back') state = '<span class="ls-ok">✓ 止める理由がなくなりました</span>・' + srcLine(it);
    else if (v.st === 'none') state = '<span class="warnt">仕入れ先が未入力</span>';
    else if (v.st === 'over') state = planName() + 'プランの上限(' + limit() + '品)をこえているため、見張っていません';
    else if (v.st === 'new') state = 'まだ確かめていません・' + srcLine(it);
    else state = srcLine(it);
    if ((v.st === 'watch' || v.st === 'new' || v.st === 'back') && noProfit(it)) state += '<span class="ls-np">利益は見ていません(' + noProfit(it) + ')</span>';
    if (c.t && c.profit != null && (v.st === 'watch' || v.st === 'back')) right = '<span class="ls-v"><small>利益</small><b class="pf' + (c.profit < 0 ? ' bad' : '') + '">' + U.yen(c.profit) + '<i>円</i></b></span>';
    var acts = kind === 'stop' ? '<div class="ls-ra"><button type="button" class="btn sm ghost" data-ls="copy1" data-id="' + esc(it.id) + '">SKUをコピー</button><button type="button" class="btn sm ghost" data-ls="zero1" data-id="' + esc(it.id) + '">数量を0にした</button></div>'
      : (kind === 'back' ? '<div class="ls-ra"><button type="button" class="btn sm ghost" data-ls="resume" data-id="' + esc(it.id) + '">見張りに戻す</button></div>' : '');
    return '<li data-id="' + esc(it.id) + '"' + (open ? ' class="open"' : '') + '><button type="button" class="ls-row" data-ls="open" data-id="' + esc(it.id) + '" aria-expanded="' + open + '">' +
      '<span class="ls-m"><span class="ls-nm">' + esc(it.name || it.asin || it.sku || '(名前が未入力)') + '</span><span class="ls-sub">' + subLine(it) + (it.gone ? '・<span class="warnt">前回のレポートに無い(Amazon側で消えた可能性)</span>' : '') + '</span>' +
      '<span class="ls-st">' + state + (c.t ? '<time>' + esc(hm(c.t)) + ' 確認</time>' : '') + '</span></span>' + right + '</button>' + acts + (open ? panelHTML(it, v) : '') + '</li>';
  }
  function secHTML(key, title, rows, head, tail) {
    if (!rows.length) return '';
    var n = more[key] || PAGE, rest = rows.length - Math.min(n, rows.length);
    return '<section class="ls-sec ' + key + '"><h2' + (key === 'stop' ? ' class="sr"' : '') + '>' + title + (key === 'stop' ? '' : '<b>' + rows.length + '件</b>') + '</h2>' + (head || '') + '<ul class="ls-list">' + rows.slice(0, n).map(function (x) { return rowHTML(x, key); }).join('') + '</ul>' +
      (rest > 0 ? '<button type="button" class="btn ghost lp-more" data-ls="more" data-key="' + key + '">次の' + Math.min(PAGE, rest) + '件を見る(残り' + rest + '件)</button>' : '') + (tail || '') + '</section>';
  }
  function stopHead(rows) {
    var nSku = skuList(rows).length, ready = STOCK_FILE.ready;
    return '<p class="ls-do">Amazonの数量を0にしてください。</p>' +
      '<div class="ls-acts"><button type="button" class="btn' + (ready ? ' ghost' : '') + '" data-ls="copy">止める品のSKUをまとめてコピー(' + nSku + '件)</button>' +
      '<button type="button" class="btn' + (ready ? '' : ' ghost') + '" data-ls="file">数量0のファイルを書き出す' + (ready ? '' : '<small>準備中(書式を確認中)</small>') + '</button></div>';
  }
  function stopTail() {
    return '<details class="ls-how"><summary>セラーセントラルで数量を0にする手順</summary><ol><li>セラーセントラルを開き、在庫を管理する画面(「全在庫の管理」)を出す。</li><li>検索の欄に、コピーしたSKUを貼って品を出す。</li>' +
      '<li>その品の「在庫あり」の数を0に直して保存する。</li><li>この画面に戻り、その品の「数量を0にした」を押す。</li></ol><p>画面の名前は、Amazon側で変わることがあります。数量を0にしても、商品の情報と価格が残るかは、ご自身の画面で確かめてください。</p></details>';
  }
  function statusHTML() {
    var run = runOf(), m = autoMin(), S = SRC(), s = sum(), n = pickRound(load(), limit()).length, t = '';
    if (running) t = '1品ずつ間をあけて確かめています ' + prog[0] + '/' + prog[1] + '。ページを閉じると止まります。';
    else {
      t = run.last ? '最後に確かめた ' + hm(run.last) : 'まだ確かめていません';
      if (m && n && fits(n, m)) t += '・次は ' + hm(num(run.last || Date.now()) + m * MIN) + ' ごろ(' + m + '分おき)';
      else if (m && n) t += '・' + n + '品は' + m + '分で回りきれません。品を減らしてください';
      else if (!m) t += '・無料プランは自動では確かめません(手で確かめるのは、楽天の検索と同じ1日の枠)';
    }
    var warn = '';
    if (lastErr === 'keys' || (S && !S.hasKeys() && n)) warn = '楽天のアプリIDとアクセスキーが未入力です。<a href="' + esc(U.base()) + 'rakuten-amazon/">楽天・Yahoo!→Amazon のページ</a>で入れると、確かめられます。';
    else if (run.allFailSince) warn = '見張りが止まっています(' + esc(hm(run.allFailSince)) + ' から)。' + esc(lastErr || '楽天から値を取れていません。') + ' ' + DEFAULTS.allFailHours + '時間続くと、全部の品を止める品に入れます。';
    else if (lastErr) warn = esc(lastErr);
    else if (gapNote) warn = esc(gapNote);
    var nt = '';
    return (warn ? '<p class="ls-alert" role="alert">▲ ' + warn + '</p>' : '') + '<div class="ls-run"><p role="status">' + esc(t) + '</p>' +
      (running ? '<button type="button" class="btn sm ghost" data-ls="halt">止める</button>' : '<button type="button" class="btn' + (s.stop.length ? ' ghost' : '') + ' sm" data-ls="check">今すぐ確かめる</button>') + '</div>' + nt;
  }
  /** 通知が切の時の知らせ。止める品の一覧より下に置く(止める品を最初の画面に出すため) */
  function noteNotify() {
    var w = root.SedoriWatchCheck, n = pickRound(load(), limit()).length;
    return w && w.notifyOn && !w.notifyOn() && n ? '<p class="ls-nt"><span>通知が切です。止める品が出ても、この画面を見るまで気づけません。</span><a class="btn sm ghost" href="' + esc(U.base()) + 'mypage/">通知を入にする</a></p>' : '';
  }
  function paintStatus() { var el = box && $('#ls-status', box); if (el) el.innerHTML = statusHTML(); }
  function paint() {
    paintHead(); if (!box) return;
    var items = load(), s = summarize(items, ctx());
    var head = '<div class="ls-head"><h1>在庫番</h1>' + (items.length ? '<button type="button" class="btn sm ghost" data-ls="add">品を足す</button>' : '') + '</div>' +
      '<p class="ls-lead">取り寄せ販売の品の、仕入れ先の在庫の見張り</p>' + NOTES;
    if (!items.length) {
      box.innerHTML = head + '<div class="ls-empty"><p>まだ品がありません。<br>Amazonの出品レポートを取り込むと、<br>ここに並びます。</p><button type="button" class="btn" data-ls="add-report">出品レポートを取り込む</button>' +
        '<button type="button" class="lnk" data-ls="add-manual">1品ずつ手で入れる</button></div>' + footHTML();
      return;
    }
    var noPf = s.watch.concat(s.fresh, s.back).filter(function (x) { return noProfit(x.it); }).length;
    var rest = [['見張り中', s.watch.length], ['うち利益を見ていない', noPf], ['止めた', s.stopped.length], ['戻せる', s.back.length], ['まだ見張れていない', s.none.length + s.fresh.length + s.over.length]]
      .filter(function (x) { return x[1]; }).map(function (x) { return x[0] + ' ' + x[1]; }).join('・');
    box.innerHTML = head + '<p class="ls-nums' + (s.stop.length ? ' on' : '') + '">' + (s.stop.length ? '▲ ' : '') + '止める品 <b>' + s.stop.length + '</b>件<small>' + items.length + '品のうち ' + (rest || '—') + '(' + planName() + 'プランは' + limit() + '品まで)</small></p>' +
      '<div id="ls-status">' + statusHTML() + '</div>' +
      secHTML('stop', '止める品', s.stop, stopHead(s.stop), stopTail()) +
      secHTML('back', '戻せる品', s.back, '<p class="ls-do">止める理由がなくなった品です。Amazonの数量を戻してから「見張りに戻す」を押してください。押すまで、見張り中には戻しません。</p>') +
      secHTML('none', 'まだ見張れていない品', s.none.concat(s.fresh, s.over), '<p class="ls-do">仕入れ先を入れて1回確かめるまで、止める判断ができません。品を押して開いてください。</p>') +
      secHTML('watch', '見張り中', s.watch) +
      secHTML('stopped', '止めた品', s.stopped, '<p class="ls-do">数量を0にした品です。見張りは続け、止める理由がなくなったら「戻せる品」に移します。</p>') + noteNotify() + footHTML();
  }
  function footHTML() {
    var o = optsOf(setOf());
    return '<details class="ls-set"><summary>止める判断と、この道具がしないこと</summary><ul>' +
      '<li>在庫切れ: 主の仕入れ先が売り切れか見つからない時、1回で止める品に入れます(控えの店に在庫があっても、まず止めます)。</li>' +
      '<li>在庫のある店: 目標の利益に届く値段で在庫のある店が' + o.minShops + '店未満なら、止める品に入れます(品ごとに「1店でも続ける」にできます)。</li>' +
      '<li>利益: 今の仕入れ値での利益(ポイント抜き)が、目標の利益(' + esc(U.targetLabel()) + ')を割ったら、止める品に入れます(品ごとに線を変えられます)。</li>' +
      '<li>店が変わった: 主の店の商品が消えて別の店だけが出る、商品名が大きく変わる、送料無料でなくなる、のどれかで止める品に入れます。</li>' +
      '<li>確かめられない: 続けて' + o.failTimes + '回取れない、または最後に確かめてから' + o.failMin + '分たった品は、止める品と同じ扱いにします。</li>' +
      '<li>在庫と値段は、楽天市場の公式の検索の返事にもとづきます。実際の在庫と食い違うことや、確かめの間に売り切れることがあります。残りの個数は分かりません。</li>' +
      '<li>Amazonの数量を変えるのは、ご自身です。このアプリは、Amazonへの書き込み、仕入れ先での購入、販売サイトのページの読み取りをしません。</li>' +
      '<li>販売サイトの決まり(キャンセルや発送の遅れの基準、新品として出せる条件)は、Amazonの出品者向けの案内で確かめてください。</li></ul></details>';
  }

  /* ---------- 1品の中身(開いた時) ---------- */
  function fld(k, label, v, type, ph) { return '<label>' + label + '<input data-ls-e="' + k + '" type="' + (type || 'text') + '"' + (type === 'number' ? ' inputmode="numeric" min="0"' : '') + ' value="' + esc(v == null ? '' : v) + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + ' autocomplete="off"></label>'; }
  function panelHTML(it, v) {
    var m = it.src[0], c = it.chk || {}, e = env(), fl = floorOf(e, it);
    var srcHTML = m ? '<p class="ls-src"><b>' + esc(m.shop || m.shopCode) + '</b>' + (m.url ? '<a href="' + esc(m.url) + '" target="_blank" rel="noopener">商品ページを開く</a>' : '') +
        '<span>対応づけた時 ' + U.yen(m.base) + '円' + (c.price != null ? '・今 ' + U.yen(c.price) + '円' : '') + (it.src.length > 1 ? '・控え ' + it.src.slice(1).map(function (s) { return esc(s.shop || s.shopCode); }).join('、') : '・控えの店なし') + '</span></p>'
      : '<p class="ls-src"><span>仕入れ先が未入力です。JANを入れて、楽天で探してください。</span></p>';
    var cats = fees && fees.amazon && fees.amazon.categories ? fees.amazon.categories : [];
    var calcHTML = it.calc ? (it.calc.selfShip ? fld('shipCost', '購入者へ送る送料(1個)', it.calc.selfShipCost == null ? '' : it.calc.selfShipCost, 'number', '未入力(0円なら0)') : '')
      : '<label class="w2">Amazonのカテゴリー(利益の判断に使う)<select data-ls-e="cat"><option value="">選んでください</option>' + cats.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.label || x.id) + '</option>'; }).join('') + '</select></label>';
    var act = v.st === 'stop' || v.st === 'stopped' || v.st === 'back' ? '<button type="button" class="btn sm ghost" data-ls="resume" data-id="' + esc(it.id) + '">見張りに戻す</button>' : '';
    return '<div class="ls-pn">' + srcHTML + (pick && pick.id === it.id ? pickHTML(it) : '<div class="ls-pa"><button type="button" class="btn sm ghost" data-ls="find" data-id="' + esc(it.id) + '">' + (m ? '仕入れ先を選び直す' : '楽天で仕入れ先を探す') + '</button></div>') +
      '<div class="ls-f">' + fld('sku', '出品者SKU', it.sku) + fld('asin', 'ASIN', it.asin) + fld('price', '出品価格', it.price || '', 'number') + fld('qty', '数量', it.qty, 'number') + fld('jan', 'JAN', it.jan, 'text') + fld('name', '商品名', it.name) +
      fld('floor', '止める利益の線(円)', it.floor == null ? '' : it.floor, 'number', '目標の利益 ' + U.yen(fl)) + calcHTML +
      '<label class="ck w2"><input type="checkbox" data-ls-e="one"' + (it.minShops === 1 ? ' checked' : '') + '>在庫のある店が1店でも続ける</label></div>' +
      (it.qty > 1 ? '<p class="ls-hint">数量を1にすると、同時に2つ売れて仕入れられない事故を防げます。</p>' : '') +
      (it.calc ? (shipMissing(it) ? '<p class="ls-hint">購入者への送料が未入力のため、利益は見ていません。送料を入れると利益で止めます(0円なら0と入れてください)。</p>' : '') : '<p class="ls-hint">カテゴリーを選ぶまで、利益は見ていません(在庫と店の数だけで判断します)。</p>') +
      '<div class="ls-pa"><button type="button" class="btn sm ghost" data-ls="order" data-id="' + esc(it.id) + '">注文が入った</button>' + act +
      '<button type="button" class="lnk ls-del" data-ls="del" data-id="' + esc(it.id) + '">一覧から消す</button></div></div>';
  }
  function pickHTML(it) {
    if (pick.loading) return '<p class="ls-hint" role="status">楽天市場を検索しています</p>';
    if (pick.err) return '<p class="ls-alert" role="alert">▲ ' + esc(pick.err) + '</p>';
    if (!pick.shops.length) return '<p class="ls-hint">在庫のある店が見つかりませんでした。JANを確かめてください。</p>';
    var e = env(), fl = floorOf(e, it);
    return '<fieldset class="ls-pick"><legend>主の仕入れ先を選ぶ(在庫のある店・安い順)</legend>' + pick.shops.slice(0, 8).map(function (s, i) {
      var p = profitAt(e, it, s.price);
      return '<label><input type="radio" name="ls-shop" value="' + esc(s.code) + '"' + (s.code === pick.sel ? ' checked' : '') + '><span><b>' + esc(s.shop || s.shopCode) + '</b><small>' + esc(s.name).slice(0, 60) + '</small></span>' +
        '<span class="ls-v"><b>' + U.yen(s.price) + '<i>円</i></b><small>' + (s.freeShip ? '送料無料' : '送料別') + (p == null ? '' : '・利益 ' + U.yen(p) + '円' + (p >= fl ? '' : '(目標に届かない)')) + '</small></span></label>';
    }).join('') + '<p class="ls-hint">別の商品でないか、商品ページで確かめてください。届け先は自分か発送代行の住所だけです(小売店から購入者へ直接送らせる形には使えません)。控えは、残りの安い順に2店まで自動で入ります。</p>' +
      '<div class="ls-pa"><button type="button" class="btn sm" data-ls="pick-ok" data-id="' + esc(it.id) + '">この店を主の仕入れ先にする</button><button type="button" class="lnk" data-ls="pick-no">やめる</button></div></fieldset>';
  }
  function find(id) {
    var it = load().filter(function (x) { return x.id === id; })[0], S = SRC(); if (!it) return;
    if (!it.jan) { U.toast('先にJANを入れてください'); var j = $('[data-ls-e="jan"]', box); if (j) j.focus(); return; }
    if (!S) { U.toast('楽天を確かめる部品を読み込めませんでした。ページを開き直してください'); return; }
    if (!S.hasKeys()) { lastErr = 'keys'; paint(); U.toast('楽天のアプリIDとアクセスキーが未入力です'); return; }
    if (!S.useQuota()) { U.toast('無料プランの今日の枠を使い切りました。明日また探せます'); return; }
    pick = { id: id, loading: true }; paint();
    S.searchJan(it.jan).then(function (json) {
      var shops = shopsOf(json), e = env(), fl = floorOf(e, it);
      var best = shops.filter(function (s) { var p = profitAt(e, it, s.price); return p == null || p >= fl; })[0] || shops[0];
      pick = { id: id, shops: shops, sel: best ? best.code : '' };
    }, function (err) { pick = { id: id, err: S.errText(err && err.status) }; }).then(paint);
  }

  /* ---------- 小窓(品を足す・注文が入った) ---------- */
  function dialog(title, body) {
    var d = document.getElementById('ls-dlg'); if (d) d.remove();
    d = document.createElement('dialog'); d.id = 'ls-dlg'; d.className = 'dlg lp-dlg ls-dlg';
    d.innerHTML = '<div class="dlg-in"><div class="dlg-h"><h2>' + esc(title) + '</h2><button type="button" class="dlg-x" data-x aria-label="閉じる">×</button></div><div id="ls-dlg-b">' + body + '</div></div>';
    document.body.appendChild(d);
    d.addEventListener('click', function (e) { if (e.target === d || e.target.closest('[data-x]')) closeDlg(); else onDlg(e); });
    d.addEventListener('close', function () { d.remove(); });
    if (d.showModal) d.showModal(); else d.setAttribute('open', '');
    return d;
  }
  function closeDlg() { var d = document.getElementById('ls-dlg'); if (d) { if (d.close && d.open) d.close(); d.remove(); } dlgState = null; }
  function dlgBody(html) { var b = document.getElementById('ls-dlg-b'); if (b) b.innerHTML = html; }
  var NO = '<button type="button" class="lnk lp-no" data-x>やめる</button>';
  function addMenu() {
    dialog('品を足す', '<div class="lp-go ls-menu"><button type="button" class="btn ghost" data-d="report"><b>Amazonの出品レポートを取り込む</b><small>セラーセントラルで書き出したファイルを選ぶか、中身を貼る</small></button>' +
      '<button type="button" class="btn ghost" data-d="manual"><b>1品ずつ手で入れる</b><small>SKU・ASIN・出品価格・数量・JAN</small></button>' + NO + '</div>' +
      '<p class="hint">「まとめて」の結果や商品ページの品は、そのページの「在庫番に登録」から入ります。</p>').classList.add('lp-menu');
  }
  function reportForm() {
    dlgState = { step: 'report' };
    dlgBody('<p class="dlg-lead">セラーセントラルで出品の一覧のレポートを書き出し、そのファイルを選んでください。中身を貼り付けても読めます。列は次の画面で選び直せます。</p>' +
      '<label class="ls-file">ファイルを選ぶ<input type="file" id="ls-file" accept=".txt,.tsv,.csv,text/plain,text/csv"></label>' +
      '<label class="ls-paste">または、中身を貼り付ける<textarea id="ls-text" rows="5" placeholder="1行目に列の名前がある表(タブ区切り・カンマ区切り)"></textarea></label>' +
      '<p class="ls-err" id="ls-err" role="alert" hidden></p><div class="lp-go"><button type="button" class="btn" data-d="read">読み込む</button>' + NO + '</div>');
    var d = document.getElementById('ls-dlg'); if (d) d.classList.remove('lp-menu');
  }
  function mapForm(table) {
    var map = detectCols(table[0]); dlgState = { step: 'map', table: table, map: map };
    var opt = function (k) { return '<option value="-1">(この列は無い)</option>' + table[0].map(function (h, i) { return '<option value="' + i + '"' + (map[k] === i ? ' selected' : '') + '>' + esc(h || '(' + (i + 1) + '列目)') + '</option>'; }).join(''); };
    var miss = Object.keys(COL_LABEL).filter(function (k) { return map[k] < 0; });
    dlgBody('<p class="dlg-lead">' + (table.length - 1) + '行を読みました。どの列が何かを確かめてください' + (miss.length ? '(' + miss.map(function (k) { return COL_LABEL[k]; }).join('・') + 'は、列の名前から当てられませんでした)' : '') + '。</p>' +
      '<div class="ls-map">' + Object.keys(COL_LABEL).map(function (k) { return '<label>' + COL_LABEL[k] + (COL_NEED.indexOf(k) >= 0 ? '(必須)' : '') + '<select data-map="' + k + '">' + opt(k) + '</select></label>'; }).join('') + '</div>' +
      '<p class="ls-prev" id="ls-prev"></p><p class="ls-err" id="ls-err" role="alert" hidden></p>' +
      '<p class="hint">同じSKUの品は、価格と数量だけ上書きします(仕入れ先の対応づけは残ります)。Amazonが発送する品(FBA)は取り込みません。</p>' +
      '<div class="lp-go"><button type="button" class="btn" data-d="import">取り込む</button>' + NO + '</div>');
    prevMap();
  }
  function prevMap() {
    var el = document.getElementById('ls-prev'); if (!el || !dlgState || dlgState.step !== 'map') return;
    var rows = readReport(dlgState.table, dlgState.map), r = rows[0];
    el.innerHTML = r ? '1行目の読み方: SKU <b>' + esc(r.sku || '—') + '</b>・ASIN <b>' + esc(r.asin || '—') + '</b>・出品価格 <b>' + (r.price ? U.yen(r.price) + '円' : '—') + '</b>・数量 <b>' + r.qty + '</b>' + (r.name ? '<br>' + esc(r.name.slice(0, 60)) : '') : '';
  }
  function manualForm() {
    dlgState = { step: 'manual' };
    dlgBody('<div class="ls-f">' + fld('sku', '出品者SKU', '') + fld('asin', 'ASIN', '') + fld('price', '出品価格', '', 'number') + fld('qty', '数量', 1, 'number') + fld('jan', 'JAN', '') + fld('name', '商品名', '') + '</div>' +
      '<p class="ls-err" id="ls-err" role="alert" hidden></p><p class="hint">足した後、その品を開いて「楽天で仕入れ先を探す」を押すと、見張りが始まります。</p>' +
      '<div class="lp-go"><button type="button" class="btn" data-d="manual-ok">一覧に足す</button>' + NO + '</div>');
    var d = document.getElementById('ls-dlg'); if (d) d.classList.remove('lp-menu');
  }
  function dlgErr(t) { var e = document.getElementById('ls-err'); if (e) { e.textContent = t; e.hidden = !t; } }
  function readNow() {
    var f = document.getElementById('ls-file'), tx = document.getElementById('ls-text');
    var go = function (text) {
      var table = parseTable(text);
      if (table.length < 2) { dlgErr('表として読めませんでした。1行目に列の名前、2行目から品が並ぶファイルを選んでください。'); return; }
      mapForm(table);
    };
    if (f && f.files && f.files[0]) { var rd = new FileReader(); rd.onload = function () { go(decode(rd.result)); }; rd.onerror = function () { dlgErr('ファイルを読めませんでした。もう一度選んでください。'); }; rd.readAsArrayBuffer(f.files[0]); }
    else if (tx && tx.value.trim()) go(tx.value);
    else dlgErr('ファイルを選ぶか、中身を貼り付けてください。');
  }
  function importNow() {
    var st = dlgState; if (!st || st.step !== 'map') return;
    if (st.map.sku < 0) { dlgErr('出品者SKUの列を選んでください。SKUが無いと、同じ品を見分けられません。'); return; }
    var r = mergeReport(load(), readReport(st.table, st.map), limit(), Date.now());
    if (!r.added && !r.updated) { dlgErr(r.fba ? '取り込める品がありませんでした(' + r.fba + '行はAmazonが発送する品でした)。' : (r.over ? planName() + 'プランは' + limit() + '品までです。' : 'SKUの入った行がありませんでした。列の選び方を確かめてください。')); return; }
    save(r.items); closeDlg(); paint();
    U.toast([r.added ? r.added + '品を足しました' : '', r.updated ? r.updated + '品の価格と数量を直しました' : '', r.fba ? 'Amazonが発送する' + r.fba + '行は入れていません' : '',
      r.over ? planName() + 'プランは' + limit() + '品までのため、' + r.over + '品は入れていません' : '', r.gone ? r.gone + '品は今回のレポートにありません(消していません)' : ''].filter(Boolean).join('。') + '。', r.over ? '料金を見る' : '', r.over ? function () { location.href = U.base() + 'plans/?from=listed'; } : null);
  }
  function manualNow() {
    var d = document.getElementById('ls-dlg'), o = {}; $$('[data-ls-e]', d).forEach(function (el) { o[el.getAttribute('data-ls-e')] = el.value; });
    if (!half(o.sku) && !half(o.asin) && !half(o.jan)) { dlgErr('SKU・ASIN・JANのどれか1つは入れてください。'); return; }
    var r = addIncoming(load(), [o], 'manual', limit(), Date.now());
    if (r.over) { dlgErr(planName() + 'プランは' + limit() + '品までです。品を減らすか、プランを変えてください。'); return; }
    save(r.items); closeDlg(); openId = r.ids[0]; paint();
    U.toast(r.added ? '1品足しました。仕入れ先を入れてください' : '同じ品がもう入っています');
  }
  function orderForm(id) {
    var it = load().filter(function (x) { return x.id === id; })[0]; if (!it) return;
    dialog('注文が入った', '<p class="dlg-lead"><b>' + esc(it.name || it.sku || it.asin) + '</b><br>台帳に「売約・仕入れ前」の行を1つ足します。' + (it.qty > 1 ? '数量は1つ減らします。' : 'この品は、次の注文を受けないよう「止める品」に入れます。') + '</p>' +
      '<div class="ls-f">' + fld('amzOrder', 'Amazonの注文番号', '') + fld('shipBy', '発送の期限', '', 'date') + '</div>' +
      '<p class="hint">発送の期限は、セラーセントラルの注文の画面に出ている日付を入れてください。仕入れる時の届け先は、自分か発送代行の住所だけです(小売店から購入者へ直接送らせる形には使えません)。</p>' +
      '<div class="lp-go"><button type="button" class="btn" data-d="order-ok">台帳に入れる</button>' + NO + '</div>');
    dlgState = { step: 'order', id: id };
  }
  function orderNow() {
    var d = document.getElementById('ls-dlg'), o = { today: U.today() }; $$('[data-ls-e]', d).forEach(function (el) { o[el.getAttribute('data-ls-e')] = el.value; });
    var id = dlgState.id, before = load(), it = before.filter(function (x) { return x.id === id; })[0]; if (!it) return;
    var draft = orderRow(it, o); if (it.calc && it.calc.category && U.hinmokuFor) draft.hinmoku = U.hinmokuFor(it.calc.category);
    var row = U.ledger.add(draft, true); if (!row) return;
    edit(id, function (x) { onOrder(x, Date.now()); });
    closeDlg(); paint();
    U.toast('台帳に1行足しました。仕入れたら、台帳の「発送待ち」で記録してください', '台帳を開く', function () { location.href = U.base() + 'daicho/?tab=mzship'; });
  }
  function onDlg(e) {
    var b = e.target.closest ? e.target.closest('[data-d]') : null; if (!b) return;
    var k = b.getAttribute('data-d');
    if (k === 'report') reportForm(); else if (k === 'manual') manualForm(); else if (k === 'read') readNow();
    else if (k === 'import') importNow(); else if (k === 'manual-ok') manualNow(); else if (k === 'order-ok') orderNow();
  }

  /* ---------- 押した時 ---------- */
  function copy(text, done) {
    var ok = function () { U.toast(done); }, ng = function () {
      var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); ok(); } catch (e2) { U.toast('コピーできませんでした。SKUを長押しして写してください'); } ta.remove();
    };
    try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, ng); else ng(); } catch (e) { ng(); }
  }
  function onClick(e) {
    var b = e.target.closest ? e.target.closest('[data-ls]') : null; if (!b) return;
    var k = b.getAttribute('data-ls'), id = b.getAttribute('data-id'), s, before;
    if (k === 'open') { openId = openId === id ? null : id; pick = null; paint(); }
    else if (k === 'add') addMenu();
    else if (k === 'add-report') { addMenu(); reportForm(); }
    else if (k === 'add-manual') { addMenu(); manualForm(); }
    else if (k === 'check') check(false);
    else if (k === 'halt') stopFlag = true;
    else if (k === 'more') { more[b.getAttribute('data-key')] = (more[b.getAttribute('data-key')] || PAGE) + PAGE; paint(); }
    else if (k === 'copy') { s = skuList(sum().stop); if (!s.length) { U.toast('SKUの入った止める品がありません。品を開いてSKUを入れてください'); return; } copy(s.join('\n'), s.length + '件のSKUをコピーしました。セラーセントラルで数量を0にしてください'); }
    else if (k === 'copy1') { s = load().filter(function (x) { return x.id === id; })[0]; if (!s || !s.sku) { U.toast('SKUが未入力です。品を開いて入れてください'); return; } copy(s.sku, 'SKU ' + s.sku + ' をコピーしました'); }
    else if (k === 'file') {
      s = sum().stop;
      if (!STOCK_FILE.ready) { U.toast('Amazonに上げるファイルの書式を確認中です。今は、SKUをコピーして、下の手順で数量を0にしてください', '一覧をCSVで書き出す', function () { U.download('tomeru-shina_' + U.today() + '.csv', root.SedoriCalc.toCSV(STOP_HEAD, stopRows(s, Date.now(), setOf()))); }); return; }
      if (!fileItems(s.map(function (x) { return x.it; })).length) { U.toast('SKUの入った止める品がありません'); return; }
      U.download(STOCK_FILE.name + '_' + U.today() + '.' + STOCK_FILE.ext, stockFile(s.map(function (x) { return x.it; }), 0), 'text/plain;charset=utf-8');
    }
    else if (k === 'zero1') { before = load(); edit(id, function (it) { markStopped(it, Date.now()); }); paint(); U.toast('「止めた品」に移しました。見張りは続けます', '元に戻す', function () { save(before); paint(); }); }
    else if (k === 'resume') { before = load(); edit(id, function (it) { resume(it, Date.now()); }); paint(); U.toast('見張り中に戻しました。Amazonの数量を戻したか、確かめてください', '元に戻す', function () { save(before); paint(); }); }
    else if (k === 'del') { before = load(); save(before.filter(function (x) { return x.id !== id; })); openId = null; paint(); U.toast('一覧から消しました(Amazonの出品はそのままです)', '元に戻す', function () { save(before); paint(); }); }
    else if (k === 'find') find(id);
    else if (k === 'pick-no') { pick = null; paint(); }
    else if (k === 'pick-ok') {
      var r = $('input[name="ls-shop"]:checked', box), shops = pick.shops; if (!r) return;
      var st = '';
      edit(id, function (it) {   // 選んだ時の返事で、そのまま1回判断する(在庫のある店が足りない品は、初めから止める品に入る)
        setSources(it, shops, r.value); var m = shops.filter(function (s) { return s.code === r.value; })[0];
        applyCheck(it, judge(it, { ok: true, stock: true, missing: false, price: m.price, freeShip: m.freeShip, name: m.name, shopCode: m.shopCode, shops: shops }, env(), setOf()), Date.now(), setOf());
        st = it.st;
      });
      var rn = runOf(); if (!rn.last) { rn.last = Date.now(); U.store.set('mz-run', rn); }
      pick = null; paint(); U.toast(st === 'stop' ? '仕入れ先を入れました。止める理由があるため「止める品」に入れています' : '仕入れ先を入れました。見張りを始めます');
    }
    else if (k === 'order') orderForm(id);
  }
  function onInput(e) {
    var el = e.target, k = el.getAttribute && el.getAttribute('data-ls-e'); if (!k || !openId || el.closest('#ls-dlg')) return;
    if (el.name === 'ls-shop') return;
    edit(openId, function (it) {
      if (k === 'one') it.minShops = el.checked ? 1 : null;
      else if (k === 'floor') it.floor = el.value === '' ? null : num(el.value);
      else if (k === 'price' || k === 'qty') it[k] = num(el.value);
      else if (k === 'jan') it.jan = half(el.value).replace(/\D/g, '');
      else if (k === 'asin') it.asin = half(el.value).toUpperCase();
      else if (k === 'sku') it.sku = el.value.trim();
      else if (k === 'name') it.name = el.value;
      else if (k === 'shipCost' && it.calc) it.calc.selfShipCost = el.value.trim() === '' ? null : num(el.value);
    });
    if (k === 'cat') return;
    // 入力欄はそのままにして、行の上の段だけ書き直す
    var li = $('li[data-id="' + openId + '"] .ls-row', box), x = sum(), all = [].concat(x.stop, x.back, x.none, x.fresh, x.over, x.watch, x.stopped).filter(function (r) { return r.it.id === openId; })[0];
    if (li && all) { var tmp = document.createElement('ul'); tmp.innerHTML = rowHTML(all, ''); var nb = $('.ls-row', tmp); if (nb) li.innerHTML = nb.innerHTML; }
  }
  /** 計算の条件が無い品: カテゴリーを選んだ時に、自分で送る前提の条件を作る(送料は、後から下の欄で入れる) */
  function onChange(e) {
    var el = e.target; if (!openId || !el.getAttribute || el.getAttribute('data-ls-e') !== 'cat' || !el.value) return;
    var tiers = fees && fees.amazon && fees.amazon.fba_tiers ? fees.amazon.fba_tiers : [];
    edit(openId, function (it) { it.calc = { category: el.value, fbaTier: tiers[0] ? tiers[0].id : '', selfShip: true, selfShipCost: null, inbound: 0, other: 0, inShip: 0, pointRate: 0, usePoints: false, sell: it.price }; });
    paint();
  }

  function start() {
    box = $('#listed');
    drainInbox();
    var run = runOf(), m = autoMin();
    if (run.last && Date.now() - run.last > Math.max(m, 30) * 2 * MIN && load().some(function (it) { return it.src.length; })) gapNote = dur(Date.now() - run.last) + '、見張りが止まっていました(ページを閉じていた間は確かめられません)。' + (m ? '今から確かめ直します。' : '「今すぐ確かめる」を押してください。');
    if (box) {
      box.addEventListener('click', onClick); box.addEventListener('input', onInput); box.addEventListener('change', onChange);
      document.addEventListener('change', function (e) { var k = e.target && e.target.getAttribute && e.target.getAttribute('data-map'); if (k && dlgState && dlgState.map) { dlgState.map[k] = Number(e.target.value); prevMap(); } });
    }
    paint();
    U.loadFees().then(function (f) { fees = f; paint(); }).catch(function () { /* 手数料が読めない時は、利益の判断をしないまま */ });
    setTimeout(tryAuto, 4000); setInterval(tryAuto, 30000);
    setInterval(function () { if (box && !running && !openId && !document.getElementById('ls-dlg')) paint(); }, 60000);   // 時間がたって「確かめられない」になった品を出す
    document.addEventListener('sedori:acct', function () { paint(); setTimeout(tryAuto, 3000); });
    document.addEventListener('sedori:limits', function () { if (!openId && !document.getElementById('ls-dlg')) paint(); });
    // 呼び出しを減らす: 上限を聞くのは、在庫番のページか、仕入れ先の入った品がある時だけ(ほかのページを開くたびには聞かない)
    if (keyMode() && (box || load().some(function (it) { return it.src.length; }))) SA().limits().catch(function () { /* 答えが無い間は無料の数で数える */ });
    document.addEventListener('sedori:target', function () { if (box && !openId) paint(); });
    root.addEventListener('storage', function (e) { if (e.key && /mz-items|mz-run$/.test(e.key) && box && !running && !openId) paint(); });
  }
  root.SedoriListed = { core: Core, send: send, add: function (rows, from) { return send(Array.isArray(rows) ? rows : [rows], from || 'manual'); }, check: check, tryAuto: tryAuto, paint: paint, count: function () { return sum().stop.length; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(typeof window !== 'undefined' ? window : globalThis);
