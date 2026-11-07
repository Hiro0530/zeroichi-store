/* 仮想通貨の損益計算 ― 画面の動き
 * CSVはブラウザの中で読むだけで、どこにも送らない(index.html の CSP で通信も禁止している)。
 * 端末に覚えるのは「見出しの並び → 列の対応」だけ。 */
(function () {
  'use strict';
  var C = window.TaxCSV, K = window.TaxCalc;
  var $ = function (id) { return document.getElementById(id); };
  var files = [];
  var opening = {};
  var view = { year: null, method: 'average' };
  var last = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function yen(v) {
    var n = Math.round(v);
    if (Object.is(n, -0)) n = 0;
    return (n < 0 ? '−' : '') + Math.abs(n).toLocaleString('ja-JP');
  }
  function qtyFmt(v) {
    if (!v) return '0';
    return Number(v.toFixed(8)).toLocaleString('ja-JP', { maximumFractionDigits: 8 });
  }

  /* ---- 列の対応を端末に覚える ---- */
  function sigOf(headers) { return 'taxcrypto.map.' + headers.join('|'); }
  function loadMap(headers) {
    try { var s = localStorage.getItem(sigOf(headers)); return s ? JSON.parse(s) : null; } catch (e) { return null; }
  }
  function saveMap(f) {
    try { localStorage.setItem(sigOf(f.headers), JSON.stringify({ map: f.map, sideMap: f.sideMap })); } catch (e) { /* 保存できなくても計算はできる */ }
  }

  /* ---- ファイルを読む ---- */
  function addFiles(list) {
    var jobs = Array.prototype.map.call(list, function (file) {
      return file.arrayBuffer().then(function (buf) {
        var rows = C.parseCSV(C.decode(buf));
        if (!rows.length) { files.push({ name: file.name, error: '中身が空でした' }); return; }
        var h = C.findHeaderRow(rows);
        var headers = rows[h];
        var body = rows.slice(h + 1);
        var saved = loadMap(headers);
        var map = saved ? saved.map : C.guessMapping(headers);
        var f = { name: file.name, headers: headers, body: body, headerIdx: h, map: map, sideMap: saved ? saved.sideMap : {}, remembered: !!saved };
        refreshSides(f);
        files.push(f);
      }).catch(function () { files.push({ name: file.name, error: '読み込めませんでした' }); });
    });
    Promise.all(jobs).then(function () {
      run();
      // 列の対応がそろっていれば、すぐ結果のところまで移動する(操作の手間を減らす)
      if (files.length && files.every(function (f) { return f.ok; }) && !$('result').hidden) {
        $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  function refreshSides(f) {
    f.sideVals = f.map.side >= 0 ? C.sideValues(f.body, f.map.side) : [];
    var next = {};
    f.sideVals.forEach(function (sv) {
      next[sv.value] = (f.sideMap && sv.value in f.sideMap) ? f.sideMap[sv.value] : sv.guess;
    });
    f.sideMap = next;
  }

  /* ---- 計算して表示 ---- */
  function run() {
    var txs = [], skipped = [];
    files.forEach(function (f, i) {
      f.ok = !f.error && C.mappingComplete(f.map);
      if (!f.ok) return;
      var out = C.toTransactions(f.body, f.map, f.sideMap, f.name, f.headerIdx + 2);
      out.txs.forEach(function (t) { t.seq = txs.length; txs.push(t); });
      skipped = skipped.concat(out.skipped);
      f.count = out.txs.length;
    });
    renderFiles();
    last = { result: K.calculate(txs, opening), skipped: skipped, txs: txs };
    renderResult();
  }

  function renderFiles() {
    $('files').hidden = files.length === 0;
    var html = files.map(function (f, i) {
      if (f.error) {
        return '<div class="file"><div class="file-h"><b>' + esc(f.name) + '</b><span class="st ng">' + esc(f.error) + '</span>' +
          '<button class="rm" data-rm="' + i + '">外す</button></div></div>';
      }
      var st = f.ok ? '<span class="st">売買 ' + f.count + '件を計算' + '</span>' : '<span class="st ng">列の対応を選んでください</span>';
      var line = C.FIELDS.map(function (fd) {
        var c = f.map[fd.key];
        return '<span>' + esc(fd.label) + ': ' + (c >= 0 ? esc(f.headers[c]) : '—') + '</span>';
      }).join(' / ');
      if (f.map.fee >= 0) line += ' / <span>手数料の単位: ' + (f.map.feeUnit === 'jpy' ? '円' : f.map.feeUnit === 'coin' ? '暗号資産の数量' : '—') + '</span>';
      return '<div class="file" data-i="' + i + '">' +
        '<div class="file-h"><b>' + esc(f.name) + '</b>' + st + '<button class="rm" data-rm="' + i + '">外す</button></div>' +
        '<p class="mapline">' + line + (f.remembered ? '<br>前に選んだ対応を使っています。' : '') + '</p>' +
        '<details' + (f.ok ? '' : ' open') + '><summary>列の対応を確認・変更</summary>' + mapForm(f, i) + '</details></div>';
    }).join('');
    $('fileList').innerHTML = html;
  }

  function opt(v, label, cur) { return '<option value="' + esc(v) + '"' + (String(v) === String(cur) ? ' selected' : '') + '>' + esc(label) + '</option>'; }

  function mapForm(f, i) {
    var cols = function (cur) {
      return opt(-1, '(使わない・ない)', cur) + f.headers.map(function (h, ci) { return opt(ci, h || ('列' + (ci + 1)), cur); }).join('');
    };
    var g = '<div class="grid">' + C.FIELDS.map(function (fd) {
      var miss = fd.need && f.map[fd.key] < 0;
      if ((fd.key === 'price' || fd.key === 'amount') && f.map.price < 0 && f.map.amount < 0) miss = true;
      var note = fd.need ? '<i>必須</i>' : (fd.key === 'price' || fd.key === 'amount') ? '<i>どちらか必須</i>' : '';
      return '<label>' + esc(fd.label) + note + '<select data-f="' + fd.key + '" data-i="' + i + '"' + (miss ? ' class="miss"' : '') + '>' + cols(f.map[fd.key]) + '</select></label>';
    }).join('');
    if (f.map.fee >= 0) {
      g += '<label>手数料の単位<i>必須</i><select data-f="feeUnit" data-i="' + i + '"' + (f.map.feeUnit ? '' : ' class="miss"') + '>' +
        opt('', '選んでください', f.map.feeUnit) + opt('jpy', '円', f.map.feeUnit) + opt('coin', '暗号資産の数量(BTCなど)', f.map.feeUnit) + '</select></label>';
    }
    g += '</div>';
    if (f.sideVals.length) {
      g += '<p class="sub-h">売買の区分の値</p><table class="sides">' + f.sideVals.slice(0, 40).map(function (sv) {
        var cur = f.sideMap[sv.value] || '';
        return '<tr><td>' + esc(sv.value || '(空欄)') + '</td><td><select data-side="' + esc(sv.value) + '" data-i="' + i + '">' +
          opt('buy', '買い', cur) + opt('sell', '売り', cur) + opt('', '計算に入れない', cur) + '</select></td></tr>';
      }).join('') + '</table>';
    }
    g += '<p class="sub-h">ファイルの先頭</p><div class="peek"><table><thead><tr>' +
      f.headers.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      f.body.slice(0, 3).map(function (r) { return '<tr>' + f.headers.map(function (_, ci) { return '<td>' + esc(r[ci]) + '</td>'; }).join('') + '</tr>'; }).join('') +
      '</tbody></table></div>';
    return g;
  }

  function renderResult() {
    var r = last.result;
    var box = $('result');
    box.hidden = !r.years.length && !last.skipped.length;
    if (box.hidden) return;
    // 年の一覧が変わったとき(ファイルの追加・対応の変更)は、いちばん新しい年を表示する
    var ykey = r.years.join(',');
    if (view.year == null || r.years.indexOf(view.year) < 0 || view.ykey !== ykey) view.year = r.years[r.years.length - 1];
    view.ykey = ykey;

    $('years').innerHTML = r.years.map(function (y) {
      return '<button type="button" data-y="' + y + '" aria-pressed="' + (y === view.year) + '">' + y + '年</button>';
    }).join('');

    var Y = r.byYear[view.year];
    if (Y) {
      $('sum').innerHTML = [['average', '総平均法の所得'], ['moving', '移動平均法の所得']].map(function (m) {
        var v = Y.total[m[0]].income;
        return '<div class="' + (view.method === m[0] ? 'on' : '') + '"><span>' + m[1] + '</span><b class="' + (v < 0 ? 'neg' : '') + '">' + yen(v) + '<small>円</small></b></div>';
      }).join('');
      var M = view.method;
      var names = Object.keys(Y.assets);
      var row = function (n, s) {
        return '<tr><td>' + esc(n) + '</td><td>' + yen(s.proceeds) + '</td><td>' + yen(s.cost) + '</td><td>' + yen(s.fee) + '</td><td class="' + (s.income < 0 ? 'neg' : '') + '">' + yen(s.income) + '</td></tr>';
      };
      $('tblAssets').innerHTML = '<thead><tr><th>銘柄</th><th>売却額</th><th>取得原価</th><th>手数料</th><th>所得</th></tr></thead><tbody>' +
        names.map(function (n) { return row(n, Y.assets[n][M]); }).join('') + '</tbody><tfoot>' +
        row('合計', Y.total[M]) + '</tfoot>';
      $('tblHold').innerHTML = '<thead><tr><th>銘柄</th><th>年末の数量</th><th>1単位の取得価額</th><th>年末の評価額</th></tr></thead><tbody>' +
        names.map(function (n) {
          var s = Y.assets[n][M];
          return '<tr><td>' + esc(n) + '</td><td>' + qtyFmt(s.endQty) + '</td><td>' + (s.endQty ? yen(s.endUnit) : '—') + '</td><td>' + yen(s.endValue) + '</td></tr>';
        }).join('') + '</tbody>';
    } else {
      $('sum').innerHTML = ''; $('tblAssets').innerHTML = ''; $('tblHold').innerHTML = '';
    }
    Array.prototype.forEach.call($('seg').querySelectorAll('button'), function (b) { b.setAttribute('aria-pressed', String(b.dataset.m === view.method)); });

    $('warn').innerHTML = r.warnings.filter(function (w) { return w.year === view.year; })
      .map(function (w) { return '<li>' + esc(w.text) + '</li>'; }).join('');

    var sk = last.skipped;
    $('skippedBox').hidden = !sk.length;
    $('skippedSum').textContent = '計算に入れなかった行(' + sk.length + '件)';
    $('skippedList').innerHTML = sk.slice(0, 500).map(function (s) {
      return '<li>' + esc(s.src) + ' ' + s.line + '行目: ' + esc(s.reason) + '</li>';
    }).join('') + (sk.length > 500 ? '<li>ほか ' + (sk.length - 500) + '件</li>' : '');

    renderOpening();
  }

  function renderOpening() {
    var assets = {};
    last.txs.forEach(function (t) { assets[t.asset] = true; });
    Object.keys(opening).forEach(function (a) { assets[a] = true; });
    var names = Object.keys(assets).sort();
    if (!names.length) { $('openIn').innerHTML = ''; return; }
    if ($('openIn').dataset.k === names.join(',')) return; // 入力中に作り直さない
    $('openIn').dataset.k = names.join(',');
    $('openIn').innerHTML = names.map(function (a) {
      var o = opening[a] || {};
      return '<b>' + esc(a) + '</b><label>数量<input type="number" inputmode="decimal" step="any" min="0" data-oa="' + esc(a) + '" data-ok="qty" value="' + esc(o.qty || '') + '"></label>' +
        '<label>取得価額の合計(円)<input type="number" inputmode="numeric" step="any" min="0" data-oa="' + esc(a) + '" data-ok="value" value="' + esc(o.value || '') + '"></label>';
    }).join('');
  }

  /* ---- 結果をCSVで保存(Excelで開けるようBOM付きUTF-8) ---- */
  function saveCsv() {
    var r = last.result;
    var lines = [['年', '計算方法', '銘柄', '売却額', '取得原価', '手数料', '所得', '年末の数量', '1単位の取得価額', '年末の評価額']];
    r.years.forEach(function (y) {
      var Y = r.byYear[y];
      [['average', '総平均法'], ['moving', '移動平均法']].forEach(function (m) {
        Object.keys(Y.assets).forEach(function (n) {
          var s = Y.assets[n][m[0]];
          lines.push([y, m[1], n, Math.round(s.proceeds), Math.round(s.cost), Math.round(s.fee), Math.round(s.income), +s.endQty.toFixed(8), Math.round(s.endUnit), Math.round(s.endValue)]);
        });
        var t = Y.total[m[0]];
        lines.push([y, m[1], '合計', Math.round(t.proceeds), Math.round(t.cost), Math.round(t.fee), Math.round(t.income), '', '', '']);
      });
    });
    lines.push([]);
    lines.push(['本ツールは取り込んだデータから機械的に計算するもので、税理士法に定める税務相談・税務書類の作成を行うものではありません。申告の判断は税務署または税理士にご相談ください。']);
    var text = '﻿' + lines.map(function (l) {
      return l.map(function (c) { c = String(c); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(',');
    }).join('\r\n');
    var url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    var a = document.createElement('a');
    a.href = url; a.download = '仮想通貨_年間損益.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ---- 操作 ---- */
  var drop = $('drop');
  $('pick').addEventListener('change', function (e) { if (e.target.files.length) addFiles(e.target.files); e.target.value = ''; });
  ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
  drop.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });

  $('fileList').addEventListener('change', function (e) {
    var el = e.target, f = files[+el.dataset.i];
    if (!f) return;
    if (el.dataset.f) {
      f.map[el.dataset.f] = el.dataset.f === 'feeUnit' ? el.value : +el.value;
      if (el.dataset.f === 'side') refreshSides(f);
      if (el.dataset.f === 'fee' && f.map.fee < 0) f.map.feeUnit = '';
    } else if (el.dataset.side != null) {
      f.sideMap[el.dataset.side] = el.value;
    }
    f.remembered = false;
    if (C.mappingComplete(f.map)) saveMap(f);
    var openIdx = files.indexOf(f);
    run();
    var d = document.querySelector('.file[data-i="' + openIdx + '"] details');
    if (d) d.open = true;
  });
  $('fileList').addEventListener('click', function (e) {
    var b = e.target.closest('[data-rm]');
    if (!b) return;
    files.splice(+b.dataset.rm, 1);
    run();
  });
  $('years').addEventListener('click', function (e) {
    var b = e.target.closest('[data-y]'); if (!b) return;
    view.year = +b.dataset.y; renderResult();
  });
  $('seg').addEventListener('click', function (e) {
    var b = e.target.closest('[data-m]'); if (!b) return;
    view.method = b.dataset.m; renderResult();
  });
  $('openIn').addEventListener('input', function (e) {
    var el = e.target; if (!el.dataset.oa) return;
    var a = el.dataset.oa;
    opening[a] = opening[a] || { qty: 0, value: 0 };
    opening[a][el.dataset.ok] = parseFloat(el.value) || 0;
    if (!opening[a].qty && !opening[a].value) delete opening[a];
    run();
  });
  $('saveCsv').addEventListener('click', saveCsv);
  $('print').addEventListener('click', function () { window.print(); });
})();
