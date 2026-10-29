/* バーコードの読み取り(カメラ)。
   - 読み取りの部品: ブラウザ内蔵の BarcodeDetector(Android Chrome 等)を優先し、無ければ ZXing(iPhone Safari 等)。
   - ZXing は jsDelivr から読み、読めない時(オフライン等)はこのサイトに置いた同じ版を使う。
   - カメラの映像の中央の帯だけを切り出して 1秒に約8回 読む(速さと電池のため)。
   window.ZScan = { start(video, opts), stop(), decodeCanvas(canvas, formats), decodeImage(url, formats), engine() } */
(function () {
  'use strict';
  var ZX_CDN = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
  var ZX_LOCAL = (document.body.getAttribute('data-base') || './') + 'assets/vendor/zxing-library-0.21.3.min.js';
  var native = null, nativeFormats = [], zxPromise = null, engineName = '';

  function loadScript(src) {
    return new Promise(function (ok, ng) {
      var s = document.createElement('script'); s.src = src; s.async = true;
      s.onload = function () { window.ZXing ? ok() : ng(new Error('no ZXing')); };
      s.onerror = function () { s.remove(); ng(new Error('load ' + src)); };
      document.head.appendChild(s);
    });
  }
  function loadZX() {
    if (window.ZXing) return Promise.resolve();
    if (!zxPromise) zxPromise = loadScript(ZX_CDN).catch(function () { return loadScript(ZX_LOCAL); });
    return zxPromise;
  }

  /** 読む種類: 'product'(JAN/EAN-13・EAN-8・UPC)/ 'qr'(QRコード) */
  function wantNative(kind) { return kind === 'qr' ? ['qr_code'] : ['ean_13', 'ean_8', 'upc_a', 'upc_e']; }
  function wantZX(kind) {
    var F = window.ZXing.BarcodeFormat;
    return kind === 'qr' ? [F.QR_CODE] : [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E];
  }

  /** どちらで読むかを決める(1回だけ)。?engine=zxing で ZXing を強制(検証用) */
  var ready = null;
  function prepare() {
    if (ready) return ready;
    var force = /[?&]engine=zxing\b/.test(location.search);
    ready = (!force && 'BarcodeDetector' in window && window.BarcodeDetector.getSupportedFormats
      ? window.BarcodeDetector.getSupportedFormats().catch(function () { return []; })
      : Promise.resolve([])
    ).then(function (fmts) {
      nativeFormats = fmts || [];
      if (nativeFormats.indexOf('ean_13') >= 0) { engineName = 'native'; return; }
      return loadZX().then(function () { engineName = 'zxing'; });
    });
    return ready;
  }

  var readers = {};
  function zxReader(kind) {
    if (readers[kind]) return readers[kind];
    var Z = window.ZXing, hints = new Map();
    hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, wantZX(kind));
    hints.set(Z.DecodeHintType.TRY_HARDER, true);
    var r = new Z.MultiFormatReader(); r.setHints(hints);
    readers[kind] = r; return r;
  }
  function zxDecode(canvas, kind) {
    var Z = window.ZXing;
    try {
      var src = new Z.HTMLCanvasElementLuminanceSource(canvas);
      var res = zxReader(kind).decodeWithState(new Z.BinaryBitmap(new Z.HybridBinarizer(src)));
      return res ? res.getText() : null;
    } catch (e) { return null; } finally { try { zxReader(kind).reset(); } catch (e2) { /* 何もしない */ } }
  }
  var detectors = {};
  function nativeDecode(source, kind) {
    var f = wantNative(kind).filter(function (x) { return nativeFormats.indexOf(x) >= 0; });
    if (!f.length) return Promise.resolve(null);
    var d = detectors[kind] || (detectors[kind] = new window.BarcodeDetector({ formats: f }));
    return d.detect(source).then(function (list) { return list && list.length ? list[0].rawValue : null; }).catch(function () { return null; });
  }

  /** キャンバス1枚を読む(Promise<string|null>) */
  function decodeCanvas(canvas, kind) {
    return prepare().then(function () {
      if (engineName === 'native' && (kind !== 'qr' || nativeFormats.indexOf('qr_code') >= 0)) return nativeDecode(canvas, kind);
      return loadZX().then(function () { return zxDecode(canvas, kind); });
    });
  }
  /** 画像のURLを読む(検証・画像からの読み取り用) */
  function decodeImage(url, kind) {
    return new Promise(function (ok, ng) {
      var img = new Image(); img.crossOrigin = 'anonymous';
      img.onload = function () {
        var c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0); decodeCanvas(c, kind).then(ok, ng);
      };
      img.onerror = ng; img.src = url;
    });
  }

  /* ---------- カメラ ---------- */
  var stream = null, timer = 0, busy = false, work = document.createElement('canvas');
  function stop() {
    clearTimeout(timer); timer = 0;
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    stream = null;
  }
  /**
   * opts: { kind:'product'|'qr', onCode(text), onError(err), interval(ms) }
   * 戻り値: Promise<{ torch: boolean }>(ライトが使えるか)
   */
  function start(video, opts) {
    opts = opts || {};
    stop();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.reject(new Error('nocamera'));
    var kind = opts.kind || 'product', every = opts.interval || 120;
    return prepare().then(function () {
      return navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
    }).then(function (s) {
      stream = s;
      video.setAttribute('playsinline', ''); video.muted = true; video.srcObject = s;
      return video.play().catch(function () { /* iOS は操作の後に再生される */ });
    }).then(function () {
      function tick() {
        if (!stream) return;
        if (!busy && video.videoWidth) {
          busy = true;
          var vw = video.videoWidth, vh = video.videoHeight;
          // 商品のバーコードは横長なので中央の帯(高さ45%)、QRは中央の正方形
          var sw, sh;
          if (kind === 'qr') { sw = sh = Math.min(vw, vh) * 0.8; } else { sw = vw * 0.9; sh = vh * 0.45; }
          var scale = Math.min(1, 960 / sw);
          work.width = Math.round(sw * scale); work.height = Math.round(sh * scale);
          var ctx = work.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, work.width, work.height);
          decodeCanvas(work, kind).then(function (txt) {
            busy = false;
            if (txt && opts.onCode) opts.onCode(txt);
          }, function () { busy = false; });
        }
        timer = setTimeout(tick, every);
      }
      tick();
      var track = stream.getVideoTracks()[0], caps = track && track.getCapabilities ? track.getCapabilities() : {};
      return { torch: !!caps.torch };
    });
  }
  function torch(on) {
    var t = stream && stream.getVideoTracks()[0];
    if (!t || !t.applyConstraints) return Promise.resolve(false);
    return t.applyConstraints({ advanced: [{ torch: !!on }] }).then(function () { return true; }, function () { return false; });
  }

  window.ZScan = { start: start, stop: stop, torch: torch, decodeCanvas: decodeCanvas, decodeImage: decodeImage, prepare: prepare,
    engine: function () { return engineName; }, active: function () { return !!stream; } };
})();
