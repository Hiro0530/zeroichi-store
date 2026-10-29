// 帳簿のクラウド同期(books-sync.js)の検算。Firestore は偽物(メモリの中のクラウド)で置き換える。
// 実行: node --test sedori/books/test/*.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const BS = require('../../assets/books-sync.js');

/* ---------- 偽物 ---------- */
function memStore(init) {
  const m = {};
  Object.keys(init || {}).forEach(k => { m[k] = JSON.stringify(init[k]); });
  return {
    m,
    get(k, d) { return k in m ? JSON.parse(m[k]) : d; },
    set(k, v) { m[k] = JSON.stringify(v); return true; },
    del(k) { delete m[k]; }
  };
}
/** メモリの中のクラウド。serverAt はコミットのたびに進む。書いた端末以外の見張りへ差分を届ける */
function fakeCloud() {
  const docs = {}; // uid -> docId -> {kind,row,updatedAt,deleted,serverAt}
  const subs = [];
  let clock = 1000, fail = null, commits = 0;
  function list(uid, since) {
    const col = docs[uid] || {};
    return Object.keys(col).filter(id => col[id].serverAt > since).map(id => Object.assign({ docId: id }, JSON.parse(JSON.stringify(col[id]))));
  }
  function fs(name) {
    return {
      listen(uid, since, onDocs) {
        const sub = { uid, name, onDocs, on: true };
        subs.push(sub);
        const first = list(uid, since);
        onDocs(first, first.reduce((a, d) => Math.max(a, d.serverAt), since));
        return () => { sub.on = false; };
      },
      commit(uid, ds) {
        if (fail) { const e = fail; fail = null; return Promise.reject(e); }
        commits++;
        const col = docs[uid] = docs[uid] || {};
        const at = ++clock, out = [];
        ds.forEach(d => {
          // ルールと同じ確かめ: 文書の名前の先頭が kind
          assert.strictEqual(d.docId.split('~')[0], d.kind, '文書の名前と種類');
          assert.ok(Number.isInteger(d.updatedAt), 'updatedAt は整数');
          col[d.docId] = { kind: d.kind, row: d.row, updatedAt: d.updatedAt, deleted: d.deleted, serverAt: at };
          out.push(Object.assign({ docId: d.docId }, JSON.parse(JSON.stringify(col[d.docId]))));
        });
        subs.filter(s => s.on && s.uid === uid && s.name !== name).forEach(s => s.onDocs(out, at));
        return Promise.resolve();
      }
    };
  }
  return { docs, fs, failNext(e) { fail = e; }, get commits() { return commits; } };
}
function device(store, extra) {
  let t = 1;
  const ev = [];
  const eng = BS.create(Object.assign({
    store, now: () => (t += 10), emit: (n, d) => ev.push([n, d]),
    setTimeout: () => 0, clearTimeout: () => {}
  }, extra || {}));
  return { eng, ev, store, tick(n) { t += n; } };
}
/** 帳簿の画面の put と同じ: 保存して noteLocal */
function put(d, key, v) { const prev = d.store.get(key, null); d.store.set(key, v); return d.eng.noteLocal(key, prev, v); }
const ids = a => a.map(r => r.id).sort();

/* ---------- 1. 行への変換 ---------- */
test('行への変換と戻し(配列・対応表・まとめて1行・設定の項目・棚卸の数)', () => {
  const sales = [{ id: 'a1', date: '2026-01-02', gross: 1000 }, { id: 'a2', date: '2026-01-03', gross: 2000 }];
  assert.deepStrictEqual(BS.fromRows('sale', BS.toRows('sale', sales).reverse()), sales, '配列は作った順に戻る');
  const rules = { 'やまと': '荷造運賃', 'a/b': '雑費' };
  const rr = BS.toRows('rule', rules);
  assert.ok(rr.every(r => r.id.indexOf('/') < 0), '/ は id に使わない');
  assert.deepStrictEqual(BS.fromRows('rule', rr), rules, '対応表');
  const set = { tax: 'taxable', form: 'ao', bizDef: { 通信費: 50 }, noReg: { 'p:x': true } };
  assert.deepStrictEqual(ids(BS.toRows('pref', set)), ['bizDef'], '総合の設定は家事按分の初期値だけ');
  assert.deepStrictEqual(ids(BS.toRows('tax', set)), ['form', 'noReg', 'tax'], '業務の設定は残りの項目');
  assert.deepStrictEqual(BS.fromRows('pref', [{ id: 'bizDef', v: { 通信費: 80 } }], set), Object.assign({}, set, { bizDef: { 通信費: 80 } }), '設定の他の項目は残す');
  const cnt = { '2026-12-31': { L1: 2, L2: 0 } };
  const cr = BS.toRows('count', cnt);
  assert.deepStrictEqual(ids(cr), ['2026-12-31_L1', '2026-12-31_L2'], '棚卸は 基準日_台帳id');
  assert.deepStrictEqual(BS.fromRows('count', cr), cnt, '棚卸の数');
  assert.deepStrictEqual(BS.fromRows('stale', BS.toRows('stale', { days: 45, cats: {}, items: {} })), { days: 45, cats: {}, items: {} }, '売れ残りの目安');
});

test('どの種類をどのプランで送れるか', () => {
  assert.deepStrictEqual(BS.KIND_NAMES.filter(k => BS.allowed(k, 'total')).sort(), ['batch', 'exp', 'pref', 'recur', 'rule', 'sale', 'stale']);
  assert.deepStrictEqual(BS.KIND_NAMES.filter(k => !BS.allowed(k, 'total')).sort(), ['count', 'tax']);
  assert.ok(BS.KIND_NAMES.every(k => BS.allowed(k, 'business')), '業務はすべて');
  assert.ok(BS.KIND_NAMES.every(k => !BS.allowed(k, 'light') && !BS.allowed(k, 'free')), 'ライト・無料は送らない');
});

/* ---------- 2. 保存の時の時刻と墓標 ---------- */
test('保存のたびに変わった行だけ時刻、消した行は墓標(ログイン前は順番待ちに入れない)', () => {
  const d = device(memStore());
  put(d, 'bk-exp', [{ id: 'e1', amount: 100 }, { id: 'e2', amount: 200 }]);
  const m1 = d.store.get('bk-meta:exp');
  assert.deepStrictEqual(Object.keys(m1.at).sort(), ['e1', 'e2']);
  assert.deepStrictEqual(d.store.get('bk-sync-pending', {}), {}, 'ログイン前は送る順番待ちを作らない');
  const t1 = m1.at.e1;
  put(d, 'bk-exp', [{ id: 'e1', amount: 100 }]);
  const m2 = d.store.get('bk-meta:exp');
  assert.strictEqual(m2.at.e1, t1, '変わらない行の時刻はそのまま');
  assert.ok(m2.del.e2 > t1, '消した行は墓標');
  assert.ok(!('updatedAt' in d.store.get('bk-exp')[0]), '帳簿の行そのものには時刻を書かない');
});

/* ---------- 3. 初めてのログイン ---------- */
test('初めてのログイン: この端末の分とクラウドの分をまとめ、送れる種類だけ送る(総合)', async () => {
  const cloud = fakeCloud();
  // 別の端末(業務)がクラウドに入れた分
  const b = device(memStore());
  b.eng.start('u1', 'business', cloud.fs('B'));
  put(b, 'bk-sales', [{ id: 'sB', gross: 5000 }]);
  put(b, 'bk-count', { '2026-12-31': { L1: 3 } });
  await b.eng.flush();
  // この端末(ログイン前に入れた分あり)
  const a = device(memStore());
  put(a, 'bk-sales', [{ id: 'sA', gross: 1000 }]);
  put(a, 'bk-set', { tax: 'taxable', bizDef: { 通信費: 50 } });
  assert.strictEqual(a.eng.start('u1', 'total', cloud.fs('A')), 'started');
  assert.deepStrictEqual(ids(a.store.get('bk-sales')), ['sA', 'sB'], 'クラウドの売上が届く');
  assert.deepStrictEqual(a.store.get('bk-count'), { '2026-12-31': { L1: 3 } }, '業務の分も読むことはできる');
  await a.eng.flush();
  const col = cloud.docs.u1;
  assert.ok(col['sale~sA'] && col['pref~bizDef'], 'この端末の売上と家事按分の初期値を送る');
  assert.ok(!col['tax~tax'], '総合では申告用の設定は送らない');
  assert.strictEqual(a.eng.state().pending, 0, '送れない分は「同期待ち」に数えない');
  assert.ok(Object.keys(a.store.get('bk-sync-pending')).includes('tax~tax'), 'ただし順番待ちには残す');
  // 業務に変えると、残っていた分を送る
  a.eng.setTier('business');
  await a.eng.flush();
  assert.strictEqual(cloud.docs.u1['tax~tax'].row.v, 'taxable', '業務にすると申告用の設定も送る');
  // 別の端末にも届く
  assert.deepStrictEqual(ids(b.store.get('bk-sales')), ['sA', 'sB']);
  assert.strictEqual(b.store.get('bk-set').tax, 'taxable');
});

/* ---------- 4. 最後に書いた方が勝つ・墓標 ---------- */
test('同じ行を2台で直すと、あとで直した方が勝つ。消した行は他の端末からも消える', async () => {
  const cloud = fakeCloud();
  const a = device(memStore()), b = device(memStore());
  a.eng.start('u1', 'total', cloud.fs('A'));
  put(a, 'bk-exp', [{ id: 'e1', amount: 100, acct: '雑費' }, { id: 'e2', amount: 300 }]);
  await a.eng.flush();
  b.eng.start('u1', 'total', cloud.fs('B'));
  assert.deepStrictEqual(ids(b.store.get('bk-exp')), ['e1', 'e2']);
  // B があとで直す(時刻を進める)
  b.tick(1000);
  put(b, 'bk-exp', b.store.get('bk-exp').map(e => e.id === 'e1' ? Object.assign({}, e, { acct: '消耗品費' }) : e));
  put(a, 'bk-exp', a.store.get('bk-exp').map(e => e.id === 'e1' ? Object.assign({}, e, { acct: '通信費' }) : e));
  await a.eng.flush();
  await b.eng.flush();
  assert.strictEqual(a.store.get('bk-exp').find(e => e.id === 'e1').acct, '消耗品費', 'A にも新しい方');
  assert.strictEqual(b.store.get('bk-exp').find(e => e.id === 'e1').acct, '消耗品費', 'B は自分の方のまま');
  // 古い時刻の文書が後から届いても戻らない
  a.eng.onDocs([{ docId: 'exp~e1', kind: 'exp', updatedAt: 5, deleted: false, row: { amount: 1, acct: '雑費' } }], 0);
  assert.strictEqual(a.store.get('bk-exp').find(e => e.id === 'e1').acct, '消耗品費', '古い文書では上書きしない');
  // 消す
  put(a, 'bk-exp', a.store.get('bk-exp').filter(e => e.id !== 'e2'));
  await a.eng.flush();
  assert.strictEqual(cloud.docs.u1['exp~e2'].deleted, true, 'クラウドは墓標');
  assert.deepStrictEqual(ids(b.store.get('bk-exp')), ['e1'], 'B からも消える');
  assert.ok(b.store.get('bk-meta:exp').del.e2, 'B にも墓標が残る(もう一度届いても戻らない)');
});

test('設定の項目ごとにまとめる: 2台で別の項目を直しても両方残る', async () => {
  const cloud = fakeCloud();
  const a = device(memStore()), b = device(memStore());
  a.eng.start('u1', 'business', cloud.fs('A')); b.eng.start('u1', 'business', cloud.fs('B'));
  put(a, 'bk-set', { tax: 'exempt', form: 'ao' }); await a.eng.flush();
  put(b, 'bk-set', Object.assign({}, b.store.get('bk-set'), { form: 'shiro' }));
  put(a, 'bk-set', Object.assign({}, a.store.get('bk-set'), { tax: 'taxable' }));
  await b.eng.flush(); await a.eng.flush();
  assert.deepStrictEqual([a.store.get('bk-set').tax, a.store.get('bk-set').form], ['taxable', 'shiro']);
  assert.deepStrictEqual([b.store.get('bk-set').tax, b.store.get('bk-set').form], ['taxable', 'shiro']);
});

/* ---------- 5. 通信・失敗・送っている間の変更 ---------- */
test('オフラインの間は送らず、つながったら送る。失敗したら順番待ちに残す', async () => {
  const cloud = fakeCloud();
  let on = false;
  const a = device(memStore(), { online: () => on });
  a.eng.start('u1', 'total', cloud.fs('A'));
  put(a, 'bk-recur', [{ id: 'r1', day: 27, amount: 7480 }]);
  await a.eng.flush();
  assert.strictEqual(a.eng.state().phase, 'pending');
  assert.ok(!cloud.docs.u1, 'オフラインでは送らない');
  on = true;
  cloud.failNext({ code: 'permission-denied' });
  await a.eng.flush();
  assert.deepStrictEqual([a.eng.state().phase, a.eng.state().error, a.eng.state().pending], ['error', 'permission-denied', 1], '失敗は表示して残す');
  await a.eng.flush();
  assert.ok(cloud.docs.u1['recur~r1'], 'もう一度で送れる');
  assert.strictEqual(a.eng.state().phase, 'synced');
});

test('送っている間に同じ行を直したら、その行は順番待ちに残る', async () => {
  const cloud = fakeCloud();
  const a = device(memStore());
  const fs = cloud.fs('A'), commit = fs.commit;
  let during = null;
  fs.commit = (uid, ds) => { if (during) { during(); during = null; } return commit(uid, ds); };
  a.eng.start('u1', 'total', fs);
  put(a, 'bk-exp', [{ id: 'e1', amount: 100 }]);
  during = () => put(a, 'bk-exp', [{ id: 'e1', amount: 999 }]);
  await a.eng.flush();
  assert.strictEqual(cloud.docs.u1['exp~e1'].row.amount, 999, '直した後の値を続けて送る');
  assert.strictEqual(a.eng.state().pending, 0);
});

/* ---------- 6. 別のアカウント ---------- */
test('別のアカウントで同期していた端末: 断ったら止まり、認めたら入れ替える', () => {
  const cloud = fakeCloud();
  const s = memStore();
  let answer = false;
  const a = device(s, { confirmSwitch: () => answer });
  a.eng.start('u1', 'total', cloud.fs('A'));
  put(a, 'bk-sales', [{ id: 's1', gross: 1 }]);
  a.eng.stop();
  assert.strictEqual(a.eng.start('u2', 'total', cloud.fs('A')), 'paused', '断ると同期しない');
  assert.deepStrictEqual(ids(s.get('bk-sales')), ['s1'], '帳簿はそのまま');
  answer = true;
  assert.strictEqual(a.eng.start('u2', 'total', cloud.fs('A')), 'started');
  assert.strictEqual(s.get('bk-sales', null), null, 'この端末の分を消して切り替える');
  assert.strictEqual(s.get('bk-sync-owner'), 'u2');
});

test('2回目からは差分だけ読む(since を覚える)', async () => {
  const cloud = fakeCloud();
  const s = memStore();
  const a = device(s);
  a.eng.start('u1', 'total', cloud.fs('A'));
  put(a, 'bk-sales', [{ id: 's1', gross: 1 }]);
  await a.eng.flush();
  const b = device(memStore());
  b.eng.start('u1', 'total', cloud.fs('B'));
  put(b, 'bk-sales', b.store.get('bk-sales').concat([{ id: 's2', gross: 2 }]));
  await b.eng.flush();
  assert.ok(s.get('bk-sync-since:u1') > 0, '読んだ所を覚える');
  a.eng.stop();
  const fs = cloud.fs('A2'); let seen = null;
  const listen = fs.listen;
  fs.listen = (uid, since, cb, err) => { seen = since; return listen(uid, since, cb, err); };
  a.eng.start('u1', 'total', fs);
  assert.strictEqual(seen, s.get('bk-sync-since:u1'), '前に読んだ所から');
  assert.deepStrictEqual(ids(s.get('bk-sales')), ['s1', 's2']);
});
