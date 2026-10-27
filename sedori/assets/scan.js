/* バーコード読み取りのページ: 読む → その場で検索リンクと利益 → 1タップでウォッチ・台帳。
   連続読み取り・音と振動・同じ商品は1回だけ・手入力。一覧はスマホ→パソコンへ(共有・コピー・QR)、パソコン側で受け取る。 */
(function () {
  'use strict';
  var U = window.SedoriUI, C = window.SedoriCalc, S = window.ScanSync, Z = window.ZScan;
  var $ = U.$, $$ = U.$$, esc = U.esc, yen = U.yen;
  var fees = null, cur = null, lastCode = '', lastAt = 0, scanning = false, torchOn = false;
  var opt = { beep: U.store.get('scan-beep', true), vib: U.store.get('scan-vib', true) };

  /* ---------- 音・振動 ---------- */
  var actx = null;
  function beep(ok) {
    if (opt.beep) {
      try {
        actx = actx || new (window.AudioContext || window.webkitAudioContext)();
        var o = actx.createOscillator(), g = actx.createGain();
        o.type = 'square'; o.frequency.value = ok ? 1760 : 440;
        g.gain.setValueAtTime(0.06, actx.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + (ok ? 0.09 : 0.18));
        o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + (ok ? 0.1 : 0.2));
      } catch (e) { /* 音が出せない端末 */ }
    }
    if (opt.vib && navigator.vibrate) { try { navigator.vibrate(ok ? 50 : [40, 60, 40]); } catch (e) { /* 何もしない */ } }
  }

  /* ---------- 読み取った時 ---------- */
  function normalize(code) {
    code = String(code || '').replace(/\D/g, '');
    if (code.length === 12) code = '0' + code;                 // UPC-A → EAN-13
    return code;
  }
  function onCode(raw, manual) {
    var code = normalize(raw);
    if (!/^\d{8}$|^\d{13}$/.test(code)) { if (manual) U.toast('8桁か13桁の数字を入れてください'); return; }
    var now = Date.now();
    if (!manual && code === lastCode && now - lastAt < 2500) return;   // 同じ枠で何度も読まない
    lastCode = code; lastAt = now;
    var valid = C.janValid(code);
    if (!valid && !manual) return;                              // 読み違いは黙って捨てる
    var exist = S.find(code);
    if (exist) {
      beep(false); select(code);
      flashRow(code); camMsg('読み取り済み: ' + code + '(一覧の上に出しました)');
      S.upsert(code, { at: now });
      return;
    }
    var def = defaults();
    S.upsert(code, { to: def.to, cat: def.cat, tier: def.tier, ship: def.ship });
    beep(true); select(code); camMsg('読み取りました: ' + code);
  }
  function defaults() {
    return { to: U.store.get('scan-to', 'amazon'), cat: U.store.get('scan-cat', 'toys'), tier: U.store.get('scan-tier', 'std1'), ship: U.store.get('scan-ship', 'nekopos') };
  }
  function camMsg(t) { var m = $('#cam-msg'); m.textContent = t; m.classList.add('on'); clearTimeout(camMsg._t); camMsg._t = setTimeout(function () { m.classList.remove('on'); }, 2200); }

  /* ---------- カメラ ---------- */
  function startCam() {
    var cam = $('#cam');
    cam.setAttribute('data-state', 'loading'); camMsg('カメラを準備しています');
    Z.start($('#video'), { kind: 'product', onCode: function (t) { onCode(t, false); } }).then(function (info) {
      scanning = true; cam.setAttribute('data-state', 'on');
      $('#cam-stop').hidden = false; $('#cam-torch').hidden = !info.torch;
      camMsg(Z.engine() === 'native' ? 'バーコードを帯に入れてください' : 'バーコードを帯に入れてください(少し離すと読みやすくなります)');
      U.store.set('scan-cam', true);
    }).catch(function (e) {
      cam.setAttribute('data-state', 'idle');
      var name = e && e.name;
      var msg = name === 'NotAllowedError' ? 'カメラの使用が許可されていません。ブラウザの設定でこのサイトのカメラを「許可」にしてください。下の欄にJANを入れても使えます。'
        : name === 'NotFoundError' || (e && e.message === 'nocamera') ? 'この端末ではカメラが使えません。下の欄にJANを入れてください。'
        : 'カメラを開けませんでした(' + esc(name || e.message || '') + ')。下の欄にJANを入れてください。';
      $('#cam-idle p').textContent = msg;
    });
  }
  function stopCam() {
    Z.stop(); scanning = false; torchOn = false;
    $('#cam').setAttribute('data-state', 'idle'); $('#cam-stop').hidden = true; $('#cam-torch').hidden = true;
    $('#cam-torch').setAttribute('aria-pressed', 'false');
    U.store.set('scan-cam', false);
  }
  document.addEventListener('visibilitychange', function () { if (document.hidden && scanning) { Z.stop(); scanning = false; $('#cam').setAttribute('data-state', 'idle'); $('#cam-stop').hidden = true; } });

  /* ---------- 選んだ商品の計算 ---------- */
  function links(code) {
    var e = encodeURIComponent(code);
    var L = [
      ['楽天', 'https://search.rakuten.co.jp/search/mall/' + e + '/'],
      ['Yahoo!', 'https://shopping.yahoo.co.jp/search?p=' + e],
      ['Amazon', 'https://www.amazon.co.jp/s?k=' + e],
      ['メルカリ 売り切れ', U.extUrl('mercari-sold', code)],
      ['ヤフオク 落札相場', U.extUrl('yahuoku-closed', code)]
    ];
    return L.map(function (l) { return '<a href="' + esc(l[1]) + '" target="_blank" rel="noopener">' + esc(l[0]) + '</a>'; }).join('');
  }
  function select(code) {
    cur = code;
    var r = S.find(code); if (!r) return;
    $('#now-empty').hidden = true; $('#now').hidden = false;
    $('#now-jan').textContent = code;
    var ok = C.janValid(code);
    $('#now-chk').textContent = ok ? '' : 'チェック数字が合いません';
    $('#now-chk').className = 'now-chk' + (ok ? '' : ' bad');
    var d = new Date(r.at || Date.now());
    $('#now-at').textContent = d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0') + ' 読み取り';
    $('#now-links').innerHTML = links(code);
    $('#n-name').value = r.name || '';
    $('#n-cost').value = r.cost === '' || r.cost == null ? '' : r.cost;
    $('#n-sell').value = r.sell === '' || r.sell == null ? '' : r.sell;
    if (fees) {
      $('#n-cat').value = r.cat || defaults().cat;
      $('#n-tier').value = r.tier || defaults().tier;
      $('#n-ship').value = r.ship || defaults().ship;
    }
    paintTo(r.to || 'amazon');
    calc();
    renderList();
  }
  function paintTo(to) {
    $$('#now-to button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-to') === to)); });
    $$('[data-for]').forEach(function (el) { el.hidden = el.getAttribute('data-for') !== to; });
    $('#n-sell-k').textContent = to === 'mercari' ? 'メルカリ売値' : 'Amazon売値(税込)';
  }
  function num(id) { var v = $(id).value; return v === '' ? '' : Math.max(0, Math.round(Number(v) || 0)); }

  /** 行の計算: { profit, sug(目標に届く売値), max(仕入れ上限), cls } */
  function compute(r) {
    if (!fees) return null;
    var tg = U.target(), cost = Number(r.cost) || 0, sell = Number(r.sell) || 0;
    if (r.to === 'mercari') {
      var sh = (fees.mercari.shipping || []).filter(function (s) { return s.id === (r.ship || 'nekopos'); })[0] || fees.mercari.shipping[0];
      var base = { rate: fees.mercari.rate, shipFee: sh.fee, material: sh.material, cost: cost, other: 0 };
      var sug = C.marketPriceFor(base, tg);
      var out = { sug: sug, ship: sh, to: 'mercari' };
      if (sell) {
        var p = C.marketProfit(Object.assign({}, base, { sell: sell }));
        out.profit = p.profit; out.res = p;
        var need = C.needProfit(sell, tg);
        out.max = Math.max(0, Math.floor(sell - p.fee - sh.fee - sh.material - need));
        if (out.max > 0 && C.marketProfit(Object.assign({}, base, { sell: sell, cost: out.max })).profit < need) out.max -= 1;
        out.cls = U.profitClass(p.profit, sell, tg);
      }
      return out;
    }
    var input = { category: r.cat || 'toys', fbaTier: r.tier || 'std1', cost: cost, inShip: 0, inbound: 100, other: 0, pointRate: 0, usePoints: false };
    var o = { sug: C.amazonPriceFor(fees, input, tg), to: 'amazon' };
    if (sell) {
      var x = Object.assign({}, input, { sell: sell }), a = C.amazonProfit(fees, x);
      o.profit = a.profit; o.res = a; o.max = C.amazonMaxCost(fees, x, tg); o.cls = U.profitClass(a.profit, sell, tg);
    }
    return o;
  }
  function calc() {
    if (!cur) return;
    var r = S.find(cur); if (!r) return;
    var o = compute(r), v = $('#verdict');
    if (!o) { v.innerHTML = '<p class="note">手数料を読み込んでいます</p>'; return; }
    var cost = Number(r.cost) || 0, sell = Number(r.sell) || 0;
    var head;
    if (!cost && !sell) head = '<div class="vd-main"><span>店頭の価格と、売れている価格を入れると判定します</span></div>';
    else if (!sell) head = '<div class="vd-main"><span>この売値以上なら目標に届く</span><b>' + (o.sug ? yen(o.sug) + '<i>円</i>' : '—') + '</b></div>';
    else if (!cost) head = '<div class="vd-main"><span>この売値なら、仕入れ値の上限は</span><b>' + (o.max != null ? yen(o.max) + '<i>円</i>' : '—') + '</b></div>';
    else {
      var ok = o.cls === 'good';
      head = '<div class="vd-main ' + (o.profit < 0 ? 'bad' : ok ? 'good' : 'mid') + '"><span>' + (o.profit < 0 ? '赤字' : ok ? '目標に届く' : '目標に届かない') + '</span><b>' + yen(o.profit) + '<i>円</i></b></div>';
    }
    var cells = [
      ['目標に届く売値', !cost ? '仕入れ値を入れると出ます' : o.sug ? yen(o.sug) + '円' : '—'],
      ['仕入れ上限', sell ? (o.max != null ? yen(o.max) + '円' : '届かない') : '売値を入れると出ます'],
      ['目標', esc(U.targetLabel())]
    ];
    var brk = '';
    if (o.res && o.to === 'amazon') brk = '販売手数料 ' + yen(o.res.referral) + '円・FBA ' + yen(o.res.fba) + '円・納品送料 ' + yen(o.res.inbound) + '円(1個の目安)';
    if (o.res && o.to === 'mercari') brk = '手数料 ' + yen(o.res.fee) + '円・送料 ' + yen(o.res.ship + o.res.material) + '円(' + esc(o.ship.label) + ')';
    v.innerHTML = head + '<div class="vd-cells">' + cells.map(function (c) { return '<div><span>' + c[0] + '</span><b>' + c[1] + '</b></div>'; }).join('') + '</div>' + (brk ? '<p class="note">' + brk + '</p>' : '');
    var b = $('#a-buy'), w = $('#a-watch');
    b.textContent = r.ledger ? '台帳に記録済み' : '仕入れた(台帳へ)'; b.classList.toggle('done', !!r.ledger);
    w.textContent = r.watch ? 'ウォッチ済み' : 'ウォッチに入れる'; w.classList.toggle('done', !!r.watch);
  }
  function saveCur(patch) { if (!cur) return; S.upsert(cur, patch); calc(); renderList(); }

  ['#n-cost', '#n-sell'].forEach(function (id) { $(id).addEventListener('input', function () { var p = {}; p[id === '#n-cost' ? 'cost' : 'sell'] = num(id); saveCur(p); }); });
  $('#n-name').addEventListener('input', function () { saveCur({ name: $('#n-name').value.trim() }); });
  $('#n-cat').addEventListener('change', function () { U.store.set('scan-cat', this.value); saveCur({ cat: this.value }); });
  $('#n-tier').addEventListener('change', function () { U.store.set('scan-tier', this.value); saveCur({ tier: this.value }); });
  $('#n-ship').addEventListener('change', function () { U.store.set('scan-ship', this.value); saveCur({ ship: this.value }); });
  $$('#now-to button').forEach(function (b) { b.addEventListener('click', function () { var to = b.getAttribute('data-to'); U.store.set('scan-to', to); paintTo(to); saveCur({ to: to }); }); });
  document.addEventListener('sedori:target', function () { calc(); renderList(); paintTarget(); });

  /* ---------- 1タップ: ウォッチ・台帳 ---------- */
  function addWatch(r) {
    var o = compute(r) || {};
    var w = U.store.get('watch2', []); if (!Array.isArray(w)) w = [];
    w.unshift({ name: r.name || 'JAN ' + r.jan, price: Number(r.cost) || 0, jan: r.jan, sell: Number(r.sell) || '', saved: U.today(), shopPt: 1, src: 'scan', manual: true, cat: r.cat, tier: r.tier });
    U.store.set('watch2', w.slice(0, 300));
    S.upsert(r.jan, { watch: true });
    return o;
  }
  function addLedger(r) {
    var o = compute(r) || {};
    if (!(Number(r.cost) > 0)) return null;
    var row = U.ledger.add({
      ship: r.to === 'amazon' ? 'fba' : U.shipMode(), cond: '新品', hinmoku: r.to === 'amazon' ? U.hinmokuFor(r.cat) : '道具類',
      name: r.name || '(品名未入力) JAN ' + r.jan, feature: 'JAN ' + r.jan, qty: 1, unit: Number(r.cost) || 0,
      party: '店舗', sellTo: r.to === 'mercari' ? 'メルカリ' : 'Amazon', sellPrice: Number(r.sell) || o.sug || '',
      profit: o.profit != null ? o.profit : '', route: '店舗(バーコード読み取り)'
    }, true);
    if (row) S.upsert(r.jan, { ledger: row.id });
    return row;
  }
  $('#a-watch').addEventListener('click', function () {
    var r = S.find(cur); if (!r) return;
    if (r.watch) { U.toast('ウォッチに入っています', 'ウォッチを見る', function () { location.href = '../rakuten-amazon/'; }); return; }
    addWatch(r); calc(); renderList(); U.toast('ウォッチに入れました');
  });
  $('#a-buy').addEventListener('click', function () {
    var r = S.find(cur); if (!r) return;
    if (r.ledger) { location.href = '../daicho/?q=' + encodeURIComponent(r.jan); return; }
    if (!(Number(r.cost) > 0)) { U.toast('仕入れ値を入れてください'); $('#n-cost').focus(); return; }
    if (addLedger(r)) { calc(); renderList(); U.toast('台帳に1行入れました', '台帳を開く', function () { location.href = '../daicho/'; }); }
  });

  /* ---------- 一覧 ---------- */
  function renderList() {
    var list = S.list();
    $('#l-n').textContent = list.length;
    $('#l-empty').hidden = !!list.length;
    $('.list-wrap').hidden = !list.length; $('.list-foot').hidden = !list.length;
    $('#l-rows').innerHTML = list.map(function (r) {
      var o = compute(r) || {};
      var p = o.profit != null ? '<b class="' + o.cls + '">' + yen(o.profit) + '</b>' : '<span class="muted">—</span>';
      var tags = (r.ledger ? '<span class="tag ok">台帳</span>' : '') + (r.watch ? '<span class="tag">ウォッチ</span>' : '');
      return '<tr data-jan="' + esc(r.jan) + '"' + (r.jan === cur ? ' class="sel"' : '') + '>' +
        '<td><span class="jan">' + esc(r.jan) + '</span>' + (r.name ? '<span class="nm">' + esc(r.name) + '</span>' : '') + '</td>' +
        '<td class="r">' + (r.cost !== '' && r.cost != null ? yen(r.cost) : '<span class="muted">—</span>') + '</td>' +
        '<td class="r">' + (r.sell !== '' && r.sell != null ? yen(r.sell) : '<span class="muted">—</span>') + '</td>' +
        '<td class="r">' + p + '</td><td>' + (tags || '<span class="muted">—</span>') + '</td>' +
        '<td class="r"><button type="button" class="linkbtn" data-del="' + esc(r.jan) + '">消す</button></td></tr>';
    }).join('');
  }
  function flashRow(code) { var tr = $('#l-rows tr[data-jan="' + code + '"]'); if (tr) { tr.classList.remove('flash'); void tr.offsetWidth; tr.classList.add('flash'); } }
  $('#l-rows').addEventListener('click', function (e) {
    var del = e.target.closest('[data-del]');
    if (del) {
      var jan = del.getAttribute('data-del'), keep = S.find(jan);
      S.remove(jan); if (cur === jan) { cur = null; $('#now').hidden = true; $('#now-empty').hidden = false; }
      renderList();
      U.toast('消しました', '元に戻す', function () { S.upsert(jan, keep); renderList(); });
      return;
    }
    var tr = e.target.closest('tr[data-jan]'); if (tr) { select(tr.getAttribute('data-jan')); if (U.narrow()) $('#now').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });
  $('#l-clear').addEventListener('click', function () {
    var keep = S.list().slice(); if (!keep.length) return;
    S.clear(); cur = null; $('#now').hidden = true; $('#now-empty').hidden = false; renderList();
    U.toast('一覧を空にしました', '元に戻す', function () { S.merge(keep); renderList(); });
  });
  $('#l-csv').addEventListener('click', function () {
    var rows = S.list().map(function (r) { var o = compute(r) || {}; return [r.jan, r.name || '', r.cost, r.sell, r.to === 'mercari' ? 'メルカリ' : 'Amazon', o.profit == null ? '' : o.profit, o.sug || '', new Date(r.at || 0).toLocaleString('ja-JP')]; });
    U.download('scan_' + U.today() + '.csv', C.toCSV(['JAN', '品名', '仕入れ値(円)', '売値(円)', '売り先', '利益(円)', '目標に届く売値(円)', '読み取り日時'], rows));
  });

  /* ---------- 受け渡し(スマホ → パソコン) ---------- */
  function sheet(title, html) {
    $('#sheet-h').textContent = title; $('#sheet-b').innerHTML = html; $('#sheet').hidden = false;
    document.body.classList.add('noscroll');
  }
  function closeSheet() { $('#sheet').hidden = true; document.body.classList.remove('noscroll'); if (window.ZScan && sheetCam) { Z.stop(); sheetCam = false; if (U.store.get('scan-cam', false) && resumeCam) startCam(); } }
  $('#sheet-x').addEventListener('click', closeSheet);
  $('#sheet').addEventListener('click', function (e) { if (e.target.id === 'sheet') closeSheet(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });

  function qrSvg(text, cell) {
    if (typeof window.qrcode !== 'function') return '';
    var q = window.qrcode(0, 'L'); q.addData(text, 'Byte'); q.make();
    return q.createSvgTag({ cellSize: cell || 4, margin: 2, scalable: true });
  }
  $('#l-send').addEventListener('click', function () {
    var list = S.list();
    if (!list.length) { U.toast('一覧がまだありません'); return; }
    var txt = S.encode(list), fits = txt.length <= 1800;
    sheet('スキャン一覧をPCへ(' + list.length + '件)',
      '<p>パソコンで「スマホから受け取る」を開き、次のどれか1つで送ってください。</p>' +
      '<div class="send-acts">' + (navigator.share ? '<button type="button" class="btn" id="s-share">共有(LINE・メール・AirDrop)</button>' : '') +
      '<button type="button" class="btn ghost" id="s-copy">文字をコピー</button></div>' +
      (fits ? '<div class="send-qr"><div class="qr big">' + qrSvg(txt, 4) + '</div><p class="hint">パソコンのカメラでこのQRを読むこともできます(「スマホから受け取る」→「カメラでQRを読む」)。</p></div>'
        : '<p class="hint">件数が多いのでQRは出せません。共有かコピーで送ってください。</p>') +
      '<textarea class="send-txt" readonly rows="3">' + esc(txt) + '</textarea>');
    var sh = $('#s-share');
    if (sh) sh.addEventListener('click', function () { navigator.share({ title: 'スキャン一覧', text: txt }).catch(function () { /* 取り消し */ }); });
    $('#s-copy').addEventListener('click', function () {
      var ta = $('.send-txt'); ta.select();
      (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () { U.toast('コピーしました'); }, function () { try { document.execCommand('copy'); U.toast('コピーしました'); } catch (e) { U.toast('長押しでコピーしてください'); } });
    });
  });
  var sheetCam = false, resumeCam = false;
  $('#l-recv').addEventListener('click', function () {
    sheet('スマホから受け取る',
      '<p>スマホの「スキャン一覧をPCへ」で送った文字を貼り付けてください。JANを1行ずつ並べた文字や、1列目がJANのCSVでも受け取れます。</p>' +
      '<textarea id="r-txt" rows="5" placeholder="ZWS1|…  または  4901234567894"></textarea>' +
      '<div class="send-acts"><button type="button" class="btn" id="r-go">一覧に足す</button><button type="button" class="btn ghost" id="r-cam">カメラでQRを読む</button></div>' +
      '<div class="r-cam" id="r-camw" hidden><video id="r-video" playsinline muted></video></div>');
    $('#r-txt').focus();
    $('#r-go').addEventListener('click', function () { take($('#r-txt').value); });
    $('#r-cam').addEventListener('click', function () {
      resumeCam = scanning; if (scanning) { Z.stop(); scanning = false; $('#cam').setAttribute('data-state', 'idle'); $('#cam-stop').hidden = true; }
      $('#r-camw').hidden = false; sheetCam = true;
      Z.start($('#r-video'), { kind: 'qr', onCode: function (t) { if (/^ZWS1\|/.test(t)) { beep(true); take(t); } } })
        .catch(function () { U.toast('カメラを開けませんでした。文字の貼り付けで受け取ってください'); $('#r-camw').hidden = true; });
    });
  });
  function take(text) {
    var rows = S.decode(text);
    if (!rows.length) { U.toast('JANが見つかりませんでした'); return; }
    var n = S.merge(rows);
    closeSheet(); renderList(); select(rows[0].jan);
    U.toast(rows.length + '件を受け取りました(新しく' + n + '件)');
  }

  /* ---------- パソコン: スマホで開くQR ---------- */
  function paintPair() {
    var id = S.pairId();
    $('#pair-id').textContent = id;
    var url = location.origin + location.pathname + '?pair=' + id + '&utm_source=app&utm_medium=pair';
    $('#pair-qr').innerHTML = qrSvg(url, 3);
  }
  function paintTarget() { $$('[data-tlabel]').forEach(function (el) { el.textContent = U.targetLabel(); }); }

  /* ---------- 起動 ---------- */
  $('#o-beep').checked = opt.beep; $('#o-vib').checked = opt.vib;
  $('#o-beep').addEventListener('change', function () { opt.beep = this.checked; U.store.set('scan-beep', opt.beep); });
  $('#o-vib').addEventListener('change', function () { opt.vib = this.checked; U.store.set('scan-vib', opt.vib); });
  $('#cam-go').addEventListener('click', startCam);
  $('#cam-stop').addEventListener('click', stopCam);
  $('#cam-torch').addEventListener('click', function () { torchOn = !torchOn; Z.torch(torchOn); this.setAttribute('aria-pressed', String(torchOn)); });
  $('#manual').addEventListener('submit', function (e) { e.preventDefault(); var v = $('#m-jan').value; onCode(v, true); $('#m-jan').value = ''; });
  S.onChange(function () { renderList(); });
  paintPair(); paintTarget(); renderList();

  U.loadFees().then(function (f) {
    fees = f;
    $('#n-cat').innerHTML = f.amazon.categories.map(function (c) { return '<option value="' + c.id + '">' + esc(c.label) + '</option>'; }).join('');
    $('#n-tier').innerHTML = f.amazon.fba_tiers.map(function (t) { return '<option value="' + t.id + '">' + esc(t.label) + '</option>'; }).join('');
    $('#n-ship').innerHTML = f.mercari.shipping.map(function (s) { return '<option value="' + s.id + '">' + esc(s.group + ' ' + s.label + ' ' + yen(s.fee + s.material) + '円') + '</option>'; }).join('');
    $('#n-cat').value = defaults().cat; $('#n-tier').value = defaults().tier; $('#n-ship').value = defaults().ship;
    $('#now-note').textContent = 'Amazonは納品送料100円/個・ポイントなしの目安。手数料は ' + f.checked_label + ' 確認の料金表。';
    var first = S.list()[0]; if (first) select(first.jan);
    renderList();
    var q = new URLSearchParams(location.search).get('jan'); if (q) onCode(q, true);
  });
  window.ScanPage = { onCode: onCode };
})();
