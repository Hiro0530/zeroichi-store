/* 始める道順の点検表: 印をこの端末に残す。
   保存先は アプリと同じ接頭辞の localStorage 'zw-sedori:start-check'。形は、済んだ項目の名前の配列 ['route', 'try', …]。
   トップの「始める道順(3/10)」は ui.js がこの配列の数を読む。保存できない端末(プライベートブラウズ等)でも、画面の印は付けられる。
   計算だけの部品(clean・toggle・next)は node の試験から読める */
(function (root) {
  'use strict';
  var KEY = 'zw-sedori:start-check';

  /** 保存されていた値を、知っている名前だけの形に直す(壊れた値・古い形でも落ちない) */
  function clean(v, ids) {
    var done = [], src = Array.isArray(v) ? v : (v && Array.isArray(v.done) ? v.done : []);
    ids.forEach(function (id) { if (src.indexOf(id) >= 0) done.push(id); });
    return done;
  }
  /** 印を付ける・外す(元の値は変えずに、新しい値を返す) */
  function toggle(state, id, on, ids) {
    var s = clean(state, ids), i = s.indexOf(id);
    if (ids.indexOf(id) < 0) return s;
    if (on && i < 0) s.push(id);
    if (!on && i >= 0) s.splice(i, 1);
    return clean(s, ids);
  }
  /** まだ済んでいない最初の項目(任意の項目は飛ばす)。全部済みなら null */
  function next(state, ids, optional) {
    var s = clean(state, ids);
    for (var i = 0; i < ids.length; i++) if (s.indexOf(ids[i]) < 0 && (optional || []).indexOf(ids[i]) < 0) return ids[i];
    return null;
  }
  var api = { KEY: KEY, clean: clean, toggle: toggle, next: next };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SedoriStartCheck = api;
  if (typeof document === 'undefined') return;

  function load() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch (e) { return false; } }

  function mount() {
    var box = document.getElementById('hj'); if (!box) return;
    var inputs = Array.prototype.slice.call(box.querySelectorAll('input[data-id]'));
    var ids = inputs.map(function (i) { return i.getAttribute('data-id'); });
    var optional = inputs.filter(function (i) { return i.parentNode.querySelector('.opt'); }).map(function (i) { return i.getAttribute('data-id'); });
    var state = clean(load(), ids);
    function paint() {
      inputs.forEach(function (i) { i.checked = state.indexOf(i.getAttribute('data-id')) >= 0; });
      document.getElementById('hj-n').textContent = state.length;
      var n = next(state, ids, optional), el = document.getElementById('hj-next');
      if (n) { var t = box.querySelector('label[for="hj-' + n + '"] .t'); el.textContent = '次: ' + (t ? t.textContent : ''); }
      else el.textContent = '任意の項目を除いて、すべて済みました。';
    }
    box.addEventListener('change', function (e) {
      var id = e.target && e.target.getAttribute && e.target.getAttribute('data-id'); if (!id) return;
      state = toggle(state, id, e.target.checked, ids);
      if (!save(state)) document.getElementById('hj-save').textContent = 'この端末では印を保存できませんでした(プライベートブラウズなど)。ページを閉じると印は消えます。';
      paint();
    });
    paint();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})(typeof window !== 'undefined' ? window : this);
