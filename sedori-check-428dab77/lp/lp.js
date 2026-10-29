/* 紹介ページ: 画面の動き(5場面×4秒)、ルートのタブ(#rakuten 等で直接開く)、UTMの引き継ぎ、手数料の確認日、スマホの下のボタン */
(function () {
  'use strict';
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  document.documentElement.classList.add('js');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 保存(使えない端末でも動く) ---------- */
  function sget(k) { try { return JSON.parse(localStorage.getItem('zw-sedori:' + k)); } catch (e) { return null; } }
  function sset(k, v) { try { localStorage.setItem('zw-sedori:' + k, JSON.stringify(v)); } catch (e) { /* 何もしない */ } }

  /* ---------- UTM: 初めて来た時の値を1回だけ残し、ボタンの行き先に付ける ---------- */
  var KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
  var qs = new URLSearchParams(location.search), utm = {};
  KEYS.forEach(function (k) { var v = qs.get(k); if (v) utm[k] = v.slice(0, 80); });
  if (Object.keys(utm).length && !sget('utm-first')) sset('utm-first', Object.assign({ at: new Date().toISOString(), landing: location.pathname + location.hash }, utm));
  if (!Object.keys(utm).length) { var f = sget('utm-first'); if (f) KEYS.forEach(function (k) { if (f[k]) utm[k] = f[k]; }); }
  $$('a[data-cta]').forEach(function (a) {
    a.addEventListener('click', function () {
      // ボタンに書いてある条件(?plan= など)は残し、来た時のUTMと押した場所を足す
      var u = new URL(a.getAttribute('href'), location.href);
      Object.keys(utm).forEach(function (k) { u.searchParams.set(k, utm[k]); });
      u.searchParams.set('from', 'lp-' + a.getAttribute('data-cta'));
      a.href = u.pathname + u.search + u.hash;
    });
  });

  /* ---------- 画面の動きの上の住所(公開している住所をそのまま出す。独自ドメインに移っても直さなくてよい) ---------- */
  var du = $('#demo-url'); if (du) du.textContent = location.host + location.pathname.replace(/lp\/.*$/, '');

  /* ---------- 手数料の確認日 ---------- */
  fetch('../data/fees.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (f) {
    if (!f || !f.checked_label) return;
    $$('[data-feedate-long]').forEach(function (el) { el.textContent = f.checked_label; });
    var m = f.checked_label.match(/(\d+)月(\d+)日/);
    if (m) $$('[data-feedate-short]').forEach(function (el) { el.textContent = m[1] + '月' + m[2] + '日'; });
  }).catch(function () { /* 書いてある日付のまま */ });

  /* ---------- 画面の動き ---------- */
  // z: 拡大(s=倍率、x・y=拡大の中心。画像の幅・高さに対する割合)
  var STEPS = [
    { t: '一覧のどの行にも、手数料・FBA・ポイントを引いた利益が出ます。行を選ぶと、右に内訳が出ます。', go: 'f2', z: { s: 1.45, x: 0.62, y: 0.62 } },
    { t: '「この価格で出品」を押すと、目標の利益(この例は15%)が残る一番安い売値が入ります。', go: 'f3', z: { s: 1.75, x: 0.99, y: 0.86 } },
    { t: '「仕入れた」を押すと、その場で古物台帳に1行。品目・仕入れ先・金額まで入ります。', go: null, z: { s: 1.55, x: 0.9, y: 0.95 } },
    { t: '台帳では、仕入れ済 → 出品中 → 売約 → 発送済を1クリックずつ進めます。', go: 'f4', z: { s: 1.5, x: 0.3, y: 0.45 } },
    { t: '「売れた」で売却日・売値・相手が入ります。Excel・CSVでいつでも書き出せます。', go: null, z: { s: 1.5, x: 0.3, y: 0.45 } }
  ];
  var POS = { f1: { x: 0.4641, y: 0.6269 }, f2: { x: 0.8117, y: 0.7956 }, f3: { x: 0.9187, y: 0.8985 }, f4: { x: 0.0447, y: 0.4464 } };
  var DUR = 4000, i = 0, timer = 0, moveT = 0, playing = !reduce, started = false;
  var imgs = $$('#demo-stage img'), lis = $$('#demo-steps li'), cur = $('#demo-cur');
  function place(p, instant) {
    if (!p) return;
    if (instant) { cur.style.transition = 'none'; }
    cur.style.left = (p.x * 100) + '%'; cur.style.top = (p.y * 100) + '%';
    if (instant) { void cur.offsetWidth; cur.style.transition = ''; }
  }
  function show(n, user) {
    i = (n + STEPS.length) % STEPS.length;
    imgs.forEach(function (im, k) { im.classList.toggle('on', k === i); if (k <= i + 1) im.loading = 'eager'; });
    lis.forEach(function (li, k) {
      li.classList.remove('on', 'done', 'paused'); void li.offsetWidth;
      if (k < i) li.classList.add('done');
      if (k === i) { li.classList.add('on'); if (!playing) li.classList.add('paused'); }
    });
    $('#demo-txt').textContent = STEPS[i].t;
    var z = STEPS[i].z, zoomEl = $('#demo-stage');
    zoomEl.style.transformOrigin = (z.x * 100) + '% ' + (z.y * 100) + '%';
    zoomEl.style.transform = 'scale(' + z.s + ')';
    cur.style.transform = 'scale(' + (1 / z.s).toFixed(3) + ')';
    clearTimeout(timer); clearTimeout(moveT);
    // カーソル: 場面の始めは前に押した所、1.6秒後に次に押す所へ動き、終わりの直前に押す
    var start = i === 0 ? POS.f1 : POS[STEPS[i - 1].go] || cur._last;
    if (i === 3) start = { x: 0.62, y: 0.24 };
    place(start, true);
    var go = POS[STEPS[i].go];
    if (playing) {
      if (go) moveT = setTimeout(function () { place(go); cur._last = go; setTimeout(function () { cur.classList.remove('click'); void cur.offsetWidth; cur.classList.add('click'); }, 1250); }, 1400);
      timer = setTimeout(function () { show(i + 1); }, DUR);
    }
  }
  function setPlay(on) {
    playing = on;
    $('#demo-pp').textContent = on ? '一時停止' : '再生';
    $('#demo-pp').setAttribute('aria-label', on ? '一時停止' : '再生');
    show(i);
  }
  $('#demo-pp').addEventListener('click', function () { setPlay(!playing); });
  lis.forEach(function (li, k) { $('button', li).addEventListener('click', function () { show(k, true); }); });
  document.documentElement.style.setProperty('--dur', DUR + 'ms');
  // 画面に入ってから再生(最初の場面から見せる)
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (e.isIntersecting && !started) { started = true; show(0); }
        else if (!e.isIntersecting && started && playing) { clearTimeout(timer); clearTimeout(moveT); started = false; }
      });
    }, { threshold: 0.35 });
    io.observe($('#demo'));
  } else show(0);
  if (!playing) { $('#demo-pp').textContent = '再生'; show(0); }

  /* ---------- ルートのタブ(#rakuten などで直接開く) ---------- */
  var ROUTES = $$('.rt').map(function (r) { return r.id; });
  function openRoute(id, scroll) {
    if (ROUTES.indexOf(id) < 0) id = ROUTES[0];
    $$('.rt').forEach(function (r) { r.classList.toggle('on', r.id === id); });
    $$('.rt-tabs a').forEach(function (a) {
      var on = a.getAttribute('data-r') === id; a.setAttribute('aria-selected', String(on));
      if (on) { var bar = a.parentNode; if (bar.scrollWidth > bar.clientWidth) bar.scrollLeft = Math.max(0, a.offsetLeft - 16); }
    });
    if (scroll) {
      var top = $('#routes').getBoundingClientRect().top + window.pageYOffset - 64;
      window.scrollTo({ top: top, behavior: reduce ? 'auto' : 'smooth' });
    }
  }
  $$('.rt-tabs a').forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault(); var id = a.getAttribute('data-r');
      openRoute(id, false);
      try { history.replaceState(null, '', location.pathname + location.search + '#' + id); } catch (er) { /* 何もしない */ }
    });
  });
  function fromHash() {
    var h = decodeURIComponent(location.hash.slice(1));
    if (ROUTES.indexOf(h) >= 0) { openRoute(h, true); return; }
    var d = h && document.getElementById(h); if (d && d.tagName === 'DETAILS') d.open = true;   // よくある質問(#honnin など)は開いて見せる
    openRoute(ROUTES[0], false);
  }
  window.addEventListener('hashchange', fromHash);
  fromHash();
  if (ROUTES.indexOf(location.hash.slice(1)) >= 0) setTimeout(fromHash, 60);   // 画像の読み込みで位置がずれた時の補正

  /* ---------- スマホの画面: 画像の上から下まで流す ---------- */
  var ph = $('.phone-screen img');
  function pan() { if (ph && ph.clientHeight) ph.style.setProperty('--pan', (ph.parentNode.clientHeight - ph.clientHeight) + 'px'); }
  if (ph) { ph.loading = 'eager'; if (ph.complete) pan(); ph.addEventListener('load', pan); window.addEventListener('resize', pan); }

  /* ---------- スマホの下のボタン: 最初の画面を過ぎたら出し、料金・最後の段では隠す ---------- */
  var st = $('#sticky'), ctas = $$('main .cta');
  function stick() {
    var y = window.pageYOffset, h = window.innerHeight;
    var heroEnd = $('.hero').offsetTop + $('.hero').offsetHeight;
    var pr = $('#price').getBoundingClientRect(), end = $('.end').getBoundingClientRect();
    var near = ctas.some(function (c) { var r = c.getBoundingClientRect(); return r.bottom > 60 && r.top < h; });
    var hide = near || (pr.top < h && pr.bottom > 0) || end.top < h;
    st.classList.toggle('on', y > heroEnd - h * 0.3 && !hide);
  }
  window.addEventListener('scroll', stick, { passive: true }); stick();
})();
