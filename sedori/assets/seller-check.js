/* せどり 利益チェック — 中古品を買う時の「売り手の確認が要る品か」の判定(台帳と帳簿の古物商特例で共通)。
   ブラウザでは window.SedoriSellerCheck、Node では require('./seller-check.js') で検算する。

   古物営業法施行規則 第16条: 対価の総額が1万円未満の取引は売り手の確認が要らない。ただし次の品は金額を問わず要る。
   - 自動二輪車・原動機付自転車(部分品を含む)
   - 家庭用コンピュータゲーム用のプログラム(ゲームソフト)
   - 光学的方法により音又は影像を記録した物(CD・DVD・ブルーレイ)
   - 書籍
   - 2025年10月1日から: エアコンディショナーの室外ユニット(室外機)・電気温水機器のヒートポンプ・電線(LANケーブル・テレビの接続ケーブル・家庭用の延長コード・充電ケーブルは除く)・グレーチング(金属製のものに限る)
   出典: 警視庁「古物営業法施行規則の一部改正」 https://www.keishicho.metro.tokyo.lg.jp/tetsuzuki/kobutsu/kaisetsu/kobutsu_sekoukisoku.html (確認 2026-10-27)
   「1万円」は1回の取引の対価の総額で見る(1個あたりではない)。同じ日に同じ売り手から買った行は1回の取引として合計する。
   判定は台帳の入力からの目安で、法令上の最終判断はしない(所轄の警察署で確認する)。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SedoriSellerCheck = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** これ未満なら確認が要らない(対価の総額・円) */
  var THRESHOLD = 10000;
  /** 確認方法のうち、氏名・住所が無くても済む選び方 */
  var NO_PARTY = ['1万円未満のため不要', '古物商・法人から購入'];
  /** 台帳の品目(古物の13区分)のうち、金額を問わず要るもの */
  var HINMOKU_ANY = { '書籍': '書籍', '自動二輪車及び原動機付自転車': 'バイク・原付(部品を含む)' };
  /** 2025年10月1日から追加された品(品名・特徴の文字から見分ける)。not は対象外の言い方 */
  var ITEMS_2025 = [
    { label: 'エアコンの室外機', re: /室外機|室外ユニット/ },
    { label: '電気温水機器のヒートポンプ', re: /ヒートポンプ|エコキュート/ },
    { label: '電線', re: /電線|VVF|VVR|CVケーブル|IV線|銅線/i, not: /LANケーブル|テレビ.{0,4}ケーブル|アンテナケーブル|延長コード|充電ケーブル|USBケーブル|HDMI/i },
    { label: '金属製のグレーチング', re: /グレーチング/, not: /コンクリート製|樹脂製|プラスチック製|FRP/i }
  ];
  /** 台帳の「ゲーム・CD・DVD・書籍・バイク…」の印の名前 */
  var MEDIA_LABEL = 'ゲーム・CD・DVD・書籍・バイク等';

  function text(r) { return String((r && r.name) || '') + ' ' + String((r && r.feature) || ''); }
  /** 2025年10月の追加の品なら、その名前(違えば '') */
  function anyPriceItem(r) {
    var t = text(r);
    for (var i = 0; i < ITEMS_2025.length; i++) { var it = ITEMS_2025[i]; if (it.re.test(t) && !(it.not && it.not.test(t))) return it.label; }
    return '';
  }
  /** 1行の対価の総額(単価×個数) */
  function rowTotal(r) { return Math.round((Number(r && r.unit) || 0) * Math.max(1, Number(r && r.qty) || 1)); }

  /** 同じ取引とみなす印。同じ日に、同じ取引URLか、同じ売り手(氏名・具体的な仕入れ先)から買った行 */
  var GENERIC_PARTY = /^(?:$|店舗$)|出品者|個人|購入者|^(?:メルカリ|ヤフオク|Yahoo!オークション|Yahoo!フリマ|楽天ラクマ|ジモティー)$/;
  function txKey(r) {
    if (!r || !r.date) return '';
    var ref = String(r.ref || '').trim(), nm = String(r.pName || '').replace(/\s+/g, ''), party = String(r.party || '').trim();
    if (ref) return r.date + '|u|' + ref;
    if (nm) return r.date + '|n|' + nm;
    if (party && !GENERIC_PARTY.test(party)) return r.date + '|p|' + party;
    return '';
  }
  /** 行ごとの「1回の取引の総額」{id: 円}。同じ取引の中古の行を合計する */
  function txTotals(rows) {
    var sum = {}, out = {};
    (rows || []).forEach(function (r) { if (r && r.cond === '中古' && !r.wait) { var k = txKey(r); if (k) sum[k] = (sum[k] || 0) + rowTotal(r); } });
    (rows || []).forEach(function (r) { if (r && r.id) { var k = txKey(r); out[r.id] = k && r.cond === '中古' && !r.wait ? Math.max(sum[k] || 0, rowTotal(r)) : rowTotal(r); } });
    return out;
  }

  /**
   * 売り手の確認が要る理由(要らなければ '')。total は1回の取引の総額(無ければこの行の単価×個数)。
   * 中古でない品・まだ仕入れていない行(無在庫の出品中)は要らない。
   */
  function reason(r, total) {
    if (!r || r.cond !== '中古' || r.wait) return '';
    if (r.media) return MEDIA_LABEL;
    if (HINMOKU_ANY[r.hinmoku]) return HINMOKU_ANY[r.hinmoku];
    var a = anyPriceItem(r); if (a) return a;
    var t = total == null ? rowTotal(r) : Number(total) || 0;
    return t >= THRESHOLD ? (t > rowTotal(r) ? '同じ取引の合計が1万円以上' : '1回の取引の合計が1万円以上') : '';
  }
  function required(r, total) { return !!reason(r, total); }

  /**
   * 台帳の印: 'na'(要らない)/ 'need'(要るのに未入力)/ 'ok'(入力済み)。
   * 「1万円未満のため不要」は、本当に要らない取引の時だけ済にする(1万円以上・金額を問わない品では未入力のまま)。
   */
  function state(r, total) {
    if (!r || r.wait) return 'na';
    if (!required(r, total)) return r.cond === '中古' && r.verify ? 'ok' : 'na';
    if (r.verify === '古物商・法人から購入') return 'ok';
    return r.pName && r.pAddr && r.verify && r.verify !== '1万円未満のため不要' ? 'ok' : 'need';
  }

  return { THRESHOLD: THRESHOLD, NO_PARTY: NO_PARTY, HINMOKU_ANY: HINMOKU_ANY, ITEMS_2025: ITEMS_2025, MEDIA_LABEL: MEDIA_LABEL,
    anyPriceItem: anyPriceItem, rowTotal: rowTotal, txKey: txKey, txTotals: txTotals, reason: reason, required: required, state: state };
});
