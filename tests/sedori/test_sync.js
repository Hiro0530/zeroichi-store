// クラウド同期(まとめ方・墓標・契約の状態)と、無在庫の見張り(終了日時の読み取り・残り時間)の検算。
// 実行: node tests/sedori/test_sync.js [公開フォルダ]
const path = require('path'), assert = require('assert');
const root = process.argv[2] || path.join(__dirname, '../../../kt-zs-sedori-ghp');
const S = require(path.join(root, 'sedori/assets/sync.js'));
const C = require(path.join(root, 'sedori/assets/calc.js'));
let n = 0;
function eq(a, b, msg) { assert.deepStrictEqual(a, b, `${msg}: 実際 ${JSON.stringify(a)} / 期待 ${JSON.stringify(b)}`); n++; }
const ids = rows => rows.map(r => r.id);

// ---------- 1. stamp: 変わった行だけに時刻、消えた行は墓標 ----------
{
  const prev = [{ id: 'b', name: 'B', updatedAt: 10 }, { id: 'a', name: 'A', updatedAt: 10 }];
  const next = [{ id: 'c', name: 'C' }, { id: 'b', name: 'B2', updatedAt: 10 }];
  const r = S.stamp(prev, next, {}, 100);
  eq(r.rows.map(x => x.updatedAt), [100, 100], '新しい行・変えた行に時刻');
  eq(r.del, { a: 100 }, '消えた行は墓標');
  eq(r.changed.sort(), ['a', 'b', 'c'], '変わったid');
  const r2 = S.stamp(r.rows, r.rows.map(x => Object.assign({}, x)), r.del, 200);
  eq([r2.changed, r2.rows.map(x => x.updatedAt)], [[], [100, 100]], '変わらなければ時刻はそのまま');
  const r3 = S.stamp([{ id: 'c', name: 'C' }], [{ id: 'c', name: 'C' }, { id: 'a', name: 'A' }], { a: 100 }, 300);
  eq([r3.del, r3.changed], [{}, ['a']], '元に戻した行は墓標を外す');
}

// ---------- 2. merge: 初回(この端末の行をクラウドへ)----------
{
  const local = [{ id: 'l1', name: 'ローカル', updatedAt: 5 }];
  const remote = [{ id: 'r1', updatedAt: 7, deleted: false, row: { name: 'クラウド' } }];
  const m = S.merge(local, {}, remote, true);
  eq(ids(m.rows).sort(), ['l1', 'r1'], '初回: 両方の行がそろう');
  eq(m.push, ['l1'], '初回: クラウドに無い行を送る');
  eq(m.changed, true, '初回: この端末が変わった');
  eq(m.rows.find(r => r.id === 'r1'), { name: 'クラウド', id: 'r1', updatedAt: 7 }, 'クラウドの行の形');
}
// ---------- 3. merge: 新しい方が勝つ ----------
{
  const local = [{ id: 'x', name: '端末で直した', updatedAt: 20 }, { id: 'y', name: '古い', updatedAt: 5 }];
  const remote = [
    { id: 'x', updatedAt: 10, deleted: false, row: { name: 'クラウドの古い方' } },
    { id: 'y', updatedAt: 9, deleted: false, row: { name: '他の端末で直した' } }
  ];
  const m = S.merge(local, {}, remote, false);
  eq(m.push, ['x'], '端末の方が新しい行だけ送る');
  eq(m.rows.find(r => r.id === 'x').name, '端末で直した', '端末の方が新しい: 端末のまま');
  eq(m.rows.find(r => r.id === 'y').name, '他の端末で直した', 'クラウドの方が新しい: 取り込む');
}
// ---------- 4. merge: 削除の伝わり方 ----------
{
  // 他の端末で消した(クラウドの墓標が新しい)
  let m = S.merge([{ id: 'z', name: 'Z', updatedAt: 3 }], {}, [{ id: 'z', updatedAt: 8, deleted: true, row: null }], false);
  eq([ids(m.rows), m.del, m.push], [[], { z: 8 }, []], '他の端末の削除を反映');
  // この端末で消した後に、クラウドから古い行が来ても生き返らない
  m = S.merge([], { z: 9 }, [{ id: 'z', updatedAt: 8, deleted: false, row: { name: 'Z' } }], false);
  eq([ids(m.rows), m.push], [[], ['z']], '消した行は生き返らない・墓標を送る');
  // 消した後に他の端末で直した(直した方が新しい)→ 生き返る
  m = S.merge([], { z: 9 }, [{ id: 'z', updatedAt: 12, deleted: false, row: { name: 'Z2' } }], false);
  eq([ids(m.rows), m.del], [['z'], {}], '消した後に他で直した行は戻る');
  // 同じ時刻なら何もしない
  m = S.merge([{ id: 'q', name: 'Q', updatedAt: 4 }], {}, [{ id: 'q', updatedAt: 4, deleted: false, row: { name: 'Q' } }], false);
  eq([m.push, m.changed], [[], false], '同じなら何もしない');
  // 差分の受け取り(初回でない)では、クラウドから来なかった行は送らない
  m = S.merge([{ id: 'k', name: 'K', updatedAt: 1 }], {}, [], false);
  eq(m.push, [], '差分の時は送らない(保存のたびに送るため)');
}
// ---------- 5. 並び(作った順・新しい順)と toDoc ----------
{
  const m = S.merge([{ id: 'mh1a0000aa', updatedAt: 1 }], {}, [{ id: 'mh1b0000bb', updatedAt: 1, row: {} }, { id: 'mh19000000', updatedAt: 1, row: {} }], false);
  eq(ids(m.rows), ['mh1b0000bb', 'mh1a0000aa', 'mh19000000'], '作った順(新しい順)に並べる');
  eq(S.toDoc('a', [{ id: 'a', name: 'A', x: undefined, updatedAt: 3 }], {}), { id: 'a', updatedAt: 3, deleted: false, row: { name: 'A' } }, '送る形(undefinedを除く)');
  eq(S.toDoc('b', [], { b: 4 }), { id: 'b', updatedAt: 4, deleted: true, row: null }, '墓標の送る形');
  eq(S.toDoc('c', [], {}), null, '無い行');
}
// ---------- 6. 2台の端末のやり取り(モックのクラウド) ----------
{
  const cloud = {};
  const push = (dev, idsToSend) => idsToSend.forEach(id => { const d = S.toDoc(id, dev.rows, dev.del); cloud[id] = d; });
  const pull = (dev, all) => { const m = S.merge(dev.rows, dev.del, Object.values(cloud), all); dev.rows = m.rows; dev.del = m.del; push(dev, m.push); };
  const A = { rows: [], del: {} }, B = { rows: [], del: {} };
  let st = S.stamp(A.rows, [{ id: 'n1', name: 'カメラ', unit: 12000 }], A.del, 100); A.rows = st.rows; A.del = st.del; push(A, st.changed);
  pull(B, true);
  eq(B.rows.map(r => r.name), ['カメラ'], 'Aの行がBに届く');
  st = S.stamp(B.rows, B.rows.map(r => Object.assign({}, r, { status: '売約' })), B.del, 200); B.rows = st.rows; B.del = st.del; push(B, st.changed);
  st = S.stamp(A.rows, [], A.del, 150); A.rows = st.rows; A.del = st.del; // Aは先に消していた(オフライン)
  pull(A, false);
  eq([A.rows.map(r => r.status), A.del], [['売約'], {}], '後から直した方(B)が勝ち、Aでも戻る');
  st = S.stamp(A.rows, [], A.del, 300); A.rows = st.rows; A.del = st.del; push(A, st.changed);
  pull(B, false);
  eq([B.rows.length, B.del], [0, { n1: 300 }], 'Aで消すとBからも消える');
}
// ---------- 7. ログインした時の扱い ----------
eq(S.firstSync(null, 'u1', 5), 'merge', '初めての端末はまとめる');
eq(S.firstSync('u1', 'u1', 5), 'merge', '同じアカウント');
eq(S.firstSync('u2', 'u1', 5), 'switch', '別のアカウントの台帳がある時は確認');
eq(S.firstSync('u2', 'u1', 0), 'merge', '別のアカウントでも空なら');

// ---------- 8. 契約の状態 ----------
{
  const now = Date.UTC(2026, 9, 27);
  eq(S.planState(null, now).paid, false, '契約なし=無料');
  eq(S.planState({ status: 'trialing', trialEnd: now + 5 * 864e5 }, now).key, 'trial', '無料期間');
  eq(S.planState({ status: 'trialing' }, now).paid, true, '無料期間は有料の機能');
  eq(S.planState({ status: 'active', nextBillingAt: '2026-11-27T00:00:00Z' }, now).next, Date.UTC(2026, 10, 27), '次回の請求日(ISO)');
  eq(S.planState({ status: 'past_due' }, now).paid, true, '支払いの確認待ちも使える');
  eq(S.planState({ status: 'paused', resumeAt: now + 30 * 864e5 }, now).paid, false, '一時停止中は保存しない');
  eq([S.planState({ status: 'suspended' }, now).key, S.planState({ status: 'suspended' }, now).canCancel], ['suspended', true], 'PayPalが止めた時も解約できる');
  const ending = S.planState({ status: 'canceled', paidThrough: now + 10 * 864e5 }, now);
  eq([ending.key, ending.paid, ending.canCancel], ['ending', true, false], '解約後も支払い済みの期間は使える');
  eq(new Date(ending.retainUntil).getUTCFullYear(), 2029, '保管は期間の終わりから3年');
  const ended = S.planState({ status: 'canceled', paidThrough: now - 864e5 }, now);
  eq([ended.key, ended.paid], ['ended', false], '期間が過ぎたら解約済み');
  eq(S.planState({ status: 'expired', canceledAt: 1700000000 }, now).until, 1700000000000, 'Stripe形式の秒も読む');
  // できることの段(ライト/総合/業務)。無料期間中はどのプランでも業務
  eq(S.planState(null, now).tier, 'free', '契約なしは無料');
  eq(S.planState({ status: 'trialing', planKey: 'light_month' }, now).tier, 'business', '無料期間はライトで申し込んでも業務のすべて');
  eq(S.planState({ status: 'active', planKey: 'business_year' }, now).tier, 'business', '業務');
  eq(S.planState({ status: 'active', planKey: 'light_year' }, now).tier, 'light', 'ライト');
  eq(S.planState({ status: 'active', planKey: 'founder_month' }, now).tier, 'total', '先着100名は総合');
  eq(S.planState({ status: 'active', planKey: 'total_month' }, now).tier, 'total', '総合');
  eq(S.planState({ status: 'active' }, now).tier, 'total', 'プランが分からない時は総合(機能を減らさない)');
  eq(S.planState({ status: 'paused', planKey: 'total_month' }, now).tier, 'free', '一時停止中は無料と同じ');
  // カード(Stripe)の契約: Worker が同じ形で書く。期間末の解約が決まったら canceled + paidThrough(秒の値も読む)
  const card = S.planState({ provider: 'stripe', status: 'canceled', planKey: 'business_month', paidThrough: Math.floor((now + 9 * 864e5) / 1000) }, now);
  eq([card.key, card.paid, card.canCancel, card.tier], ['ending', true, false, 'business'], 'カードの期間末の解約: 終わりまで業務のまま');
  eq(S.planState({ provider: 'stripe', status: 'trialing', planKey: 'light_month', trialEnd: new Date(now + 3 * 864e5).toISOString() }, now).until, now + 3 * 864e5, 'カードの無料期間の終わり');
  eq(S.planState({ status: 'canceled', planKey: 'light_month', paidThrough: now + 864e5 }, now).tier, 'light', '解約後も期間の終わりまではそのプラン');
  // ライトの月100件: 仕入日の月で、作った順に数える
  const mk = (i, date) => ({ id: (1e12 + i).toString(36), date });
  const rowsL = [];
  for (let i = 0; i < 103; i++) rowsL.push(mk(i, '2026-10-' + String(1 + (i % 28)).padStart(2, '0')));
  rowsL.push(mk(500, '2026-09-30'));
  const cap = S.lightCap(rowsL, '2026-10', 100);
  eq([cap.count, cap.left, cap.blocked.length], [103, 0, 3], '10月は103件・3件が上限を超える');
  eq(cap.blocked, [mk(100).id, mk(101).id, mk(102).id], '超えるのは後から作った3件');
  eq(S.lightCap(rowsL.slice(0, 40), '2026-10', 100).left, 60, '残り60件');
  eq(S.lightCap(rowsL, '2026-09', 100).blocked.length, 0, '先月の分は別に数える');
}

// ---------- 9. ヤフオクの終了日時 ----------
{
  const now = new Date(2026, 9, 27, 12, 0);
  const L = (y, mo, d, h, mi) => `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
  eq(C.parseEndTime('入札件数 3\n終了日時 10月29日（水）22時15分\n開始時の価格 1円', now), L(2026, 10, 29, 22, 15), '商品ページ(年なし・曜日)');
  eq(C.parseEndTime('終了日時：２０２６.１０.３１（土）２１：０５', now), L(2026, 10, 31, 21, 5), '全角の数字と点');
  eq(C.parseEndTime('オークション終了日時: 2026年11月2日 9時00分', now), L(2026, 11, 2, 9, 0), '年月日時分');
  eq(C.parseEndTime('開始日時 10月20日 20:00\n終了日時 10月30日 20:30', now), L(2026, 10, 30, 20, 30), '開始日時より終了日時を優先');
  eq(C.parseEndTime('終了 1月3日（土）9時05分', now), L(2027, 1, 3, 9, 5), '年をまたぐ');
  eq(C.parseEndTime('残り 2日 3時間', now), L(2026, 10, 29, 15, 0), '残り時間');
  eq(C.parseEndTime('残り時間：45分', now), L(2026, 10, 27, 12, 45), '残り(分)');
  eq(C.parseEndTime('即決価格 3,000円', now), null, '日時が無い');
  eq(C.parseEndTime('終了日時 10月29日 25:10', now), null, '時刻がおかしい');

  const base = new Date(2026, 9, 27, 12, 0).getTime();
  const row = (min, status) => ({ status: status || '出品中', yEnd: C.toLocalInput(new Date(base + min * 60000)) });
  eq(C.endState(row(180), base).state, 'far', '3時間前');
  eq(C.endState(row(120), base).state, 'soon', '2時間前から色');
  eq(C.endState(row(60), base).state, 'due', '60分前(通知)');
  eq(C.endState(row(-1), base).state, 'ended', '終了');
  eq(C.endState(row(30, '出品停止'), base).watch, false, '出品停止は見張らない');
  eq(C.endState({ status: '出品中' }, base), null, '終了日時なし');
  eq([C.fmtLeft(5400000), C.fmtLeft(3 * 36e5 + 60000), C.fmtLeft(26 * 36e5), C.fmtLeft(0)], ['あと1:30:00', 'あと3時間1分', 'あと1日2時間', '終了'], '残り時間の表示');
}

// ---------- 10. 台帳の保存(ui.js + sync.js): 時刻・墓標・無在庫の行 ----------
{
  global.window = { matchMedia: () => ({ matches: false }) };
  global.location = { hash: '', search: '', protocol: 'http:' };
  global.navigator = {};
  const events = [];
  global.CustomEvent = function (name, o) { this.type = name; this.detail = o && o.detail; };
  global.document = { readyState: 'complete', body: { getAttribute: () => null }, addEventListener() {}, dispatchEvent(e) { events.push(e); }, querySelector() { return null; }, querySelectorAll() { return []; } };
  const mem = {};
  global.localStorage = { getItem(k) { return k in mem ? mem[k] : null; }, setItem(k, v) { mem[k] = String(v); }, removeItem(k) { delete mem[k]; } };
  global.fetch = () => new Promise(() => {});
  window.SedoriCalc = C; window.SedoriSync = S; window.SedoriSellerCheck = require(path.join(root, 'sedori/assets/seller-check.js'));
  require(path.join(root, 'sedori/assets/ui.js'));
  const U = window.SedoriUI, Lg = U.ledger;
  const r = Lg.add({ name: 'ゲーム機', cond: '中古', unit: 15000 }, true);
  eq(typeof Lg.get(r.id).updatedAt, 'number', '追加した行に時刻');
  eq(events.filter(e => e.type === 'sedori:ledger').pop().detail.ids, [r.id], '送る順番待ちに入る');
  Lg.remove(r.id);
  eq(Object.keys(JSON.parse(mem['zw-sedori:ledger-del'])), [r.id], '消すと墓標');
  const w = Lg.add({ name: '無在庫の品', cond: '中古', unit: 20000, status: '出品中', wait: true, sellTo: 'Amazon(中古)', sellPrice: 30000, ship: 'self', yEnd: '2026-10-29T22:15' }, true);
  eq(U.checkState(w), 'na', '仕入れ前は売り手の確認の対象外');
  eq(U.kobutsuRows(Lg.all()).length, 0, '仕入れ前の行は古物台帳に書き出さない');
  const sold = Lg.advance(w.id);
  eq([sold.status, sold.wait, sold.date, sold.salePrice], ['売約', false, U.today(), 30000], '売れた(仕入れる)で仕入日が今日・書き出し対象');
  eq(U.checkState(sold), 'need', '仕入れたら売り手の確認が必要');
  const w2 = Lg.add({ name: '終了した品', status: '出品中', wait: true, yEnd: '2026-10-27T10:00' }, true);
  eq(U.endingRows(null, new Date(2026, 9, 27, 12, 0).getTime()).map(x => [x.r.id, x.e.state]), [[w2.id, 'ended']], '終了が近い順の一覧');
  U.stopListing(w2.id, true);
  eq([Lg.get(w2.id).status, U.endingRows().length], ['出品停止', 0], '出品停止にすると見張りから外れる');
  eq(U.nextLabel(Lg.get(w2.id)), '', '出品停止の次は無い');
}

console.log('OK ' + n + '件');
