// 帳簿の計算を端末から Worker の /core へ移した(2026-11-18)ことの検算。実行: node tests/sedori/test_books_calc.js [公開フォルダ]
// 1) 乱数の記録(台帳・売上・経費・設定)で、移す前の端末の計算(tests/sedori/_books_oracle.js)と、
//    端末の送る欄(books-srv.js)→ Worker の答え(books_calc.js)→ 端末の名前合わせ が、同じ答えになる
//    対象: 月ごと・ルート/仕入れ先/売り先別・売れた記録・売れ残り・棚卸・古物商特例・経過措置・申告の数字・仕訳帳・会計ソフト向けの行(4形式)
// 2) 送る欄に、品名・取引相手の名前・住所・メモ・支払先の名前の文字が入っていない(乱数の名前の目印で確かめる)
// 3) 端末の books-core.js に、移した計算の関数が残っていない
// 4) 見本(demo)の受け付けは大きさの上限まで・鍵なしでは見本でない限り答えない
const path = require('path'), fs = require('fs'), assert = require('assert');
const root = path.resolve(process.argv[2] || path.join(__dirname, '../../../kt-zs-sedori-ghp'));
const SD = require('./_dir')(root);
const ASSETS = path.join(root, SD, 'assets'), BOOKS = path.join(root, SD, 'books/assets');
process.env.SEDORI_SC = path.join(ASSETS, 'seller-check.js');
const O = require('./_books_oracle.js');           // 移す前の計算
const B = require(path.join(BOOKS, 'books-core.js')); // いまの端末の部品
const SRV = require(path.join(BOOKS, 'books-srv.js'));
let n = 0;
const strip = a => JSON.parse(JSON.stringify(a));
function eq(a, b, msg) { assert.deepStrictEqual(strip(a), strip(b), msg); n++; }

(async () => {
  const K = await import(path.join(__dirname, '../../backend/sedori/worker/src/books_calc.js'));
  const { handleCore } = await import(path.join(__dirname, '../../backend/sedori/worker/src/core.js'));

  let seed = 20261118;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pickOne = a => a[Math.floor(rnd() * a.length)];
  const int = m => Math.floor(rnd() * m);
  const day = y => y + '-' + String(1 + int(12)).padStart(2, '0') + '-' + String(1 + int(28)).padStart(2, '0');
  const PARTIES = ['楽天市場 Aショップ', 'Yahoo!ショッピング B店', 'ブックオフ 新宿店', '山田 太郎', 'メルカリ 出品者', '', 'セカンドストリート 渋谷', '株式会社テスト商会', 'ジモティー 個人', '鈴木 花子', '駿河屋 通販'];
  const SELL = ['Amazon', 'メルカリ', 'ヤフオク', 'ラクマ', '', 'その他の店', 'amazon FBA'];
  const ROUTES = ['rakuten', 'mercari', 'yahuoku', '', 'store'];
  const KINDS = ['order', 'sale', 'refund', 'adjust', 'fee', 'transfer', 'other'];
  const HIN = ['', '', '家電', '道具類', '時計・宝飾品類', '皮革・ゴム製品類', '写真機類'];
  const ACC = ['荷造運賃', '消耗品費', '通信費', '支払手数料', '旅費交通費', '地代家賃', '租税公課', '雑費', '', '不明な科目', '外注工賃', '新聞図書費'];
  const PAYEE = ['ヤマト運輸', 'ダイソー 梱包', 'ENEOS', 'Keepa 月額', '', 'ドコモ スマホ代', '株式会社テスト商会', '山田 太郎'];
  // 名前の目印(送る欄にこの文字が入っていないことを、2 で確かめる)
  const MARK = 'ZQX';
  function gen(y) {
    const ledger = Array.from({ length: int(45) }, (_, i) => {
      const sold = rnd() < 0.6, cond = rnd() < 0.5 ? '中古' : '新品', code = rnd() < 0.5 ? 'JAN 49' + String(100000000000 + int(899999999999)).slice(0, 11) : (rnd() < 0.3 ? 'ASIN B0' + String(10000000 + int(89999999)) : '');
      const r = { id: 'L' + i, date: day(pickOne([y, y, y - 1])), qty: rnd() < 0.2 ? '' : 1 + int(3), unit: int(15000), party: pickOne(PARTIES), route: pickOne(ROUTES), name: rnd() < 0.1 ? '' : MARK + '品' + int(8) + '_' + i,
        feature: code, cond, hinmoku: pickOne(HIN), sku: rnd() < 0.2 ? 'SKU' + int(5) : '', memo: rnd() < 0.2 ? MARK + 'メモ' : '',
        saleDate: sold ? day(pickOne([y, y, y - 1, y + 1])) : '', salePrice: sold ? int(30000) : '', sellPrice: rnd() < 0.6 ? int(30000) : '', profit: rnd() < 0.3 ? '' : int(5000) - 500,
        sellTo: pickOne(SELL), wait: rnd() < 0.1, status: '仕入れ済' };
      if (cond === '中古' && rnd() < 0.6) { r.pName = rnd() < 0.7 ? MARK + '売り手' + int(4) : ''; r.pAddr = rnd() < 0.7 ? MARK + '住所' + int(4) : ''; if (rnd() < 0.5) r.verify = pickOne(['本人限定受取郵便で確認', '古物商・法人から購入', '1万円未満のため不要']); }
      return r;
    });
    const sales = Array.from({ length: int(35) }, (_, i) => {
      const kind = pickOne(KINDS), lid = rnd() < 0.5 && ledger.length ? pickOne(ledger).id : '';
      return { id: 'S' + i, src: pickOne(['amazon', 'mercari']), date: day(pickOne([y, y, y - 1])), kind, ledgerId: lid, ch: pickOne(['Amazon', 'メルカリ', '']), typeLabel: kind === 'order' ? '注文' : MARK + 'ラベル', order: rnd() < 0.5 ? '503-' + int(9999999) : '',
        gross: int(30000) - (rnd() < 0.1 ? 40000 : 0), disc: rnd() < 0.2 ? -100 : 0, fee: int(2000) - (rnd() < 0.1 ? 3000 : 0), ship: int(900), other: rnd() < 0.2 ? -50 : (rnd() < 0.1 ? 700 : 0), withheld: rnd() < 0.1 ? -30 : 0,
        qty: 1, name: rnd() < 0.7 ? MARK + '売上' + i : '', net: int(40000) - 20000 };
    });
    const expenses = Array.from({ length: int(25) }, (_, i) => ({ id: 'E' + i, date: day(pickOne([y, y, y - 1])), acct: pickOne(ACC), amount: int(30000), biz: pickOne([undefined, '', 50, 100, 0, 30]), payee: pickOne(PAYEE) ? pickOne(PAYEE) + (rnd() < 0.3 ? MARK : '') : '', memo: rnd() < 0.3 ? MARK + 'メモ' + i : '' }));
    return { ledger, sales, expenses };
  }
  function genSet(y, D) {
    const noReg = {}; D.ledger.forEach(r => { if (rnd() < 0.3) noReg[B.partyKey(String(r.party || '').trim())] = true; }); D.expenses.forEach(x => { if (rnd() < 0.3) noReg[B.partyKey(String(x.payee || '').trim())] = true; });
    const counts = {}; D.ledger.forEach(r => { if (rnd() < 0.3) counts[r.id] = int(4); });
    const tax = rnd() < 0.6 ? 'taxable' : 'exempt';
    return { tax, incl: tax === 'exempt' ? true : rnd() < 0.5, points: pickOne(['discount', 'misc']), pointYen: rnd() < 0.5 ? int(5000) : 0, opening: rnd() < 0.3 ? int(100000) : (rnd() < 0.2 ? '' : null), closing: rnd() < 0.3 ? int(100000) : null,
      method: pickOne(['last', 'each']), pay: pickOne(['事業主借', '現金']), noReg, counts };
  }

  const ROUNDS = 150;
  let sentChars = 0; const cov = { jn: 0, keika: 0, kobOk: 0, kobMissing: 0, stale: 0, closeCnt: 0, taxable: 0, mfFlag: 0 };
  for (let t = 0; t < ROUNDS; t++) {
    const y = pickOne([2025, 2026]);
    const D = gen(y), set = genSet(y, D), setOracle = Object.assign({}, set);
    const full = SRV.build(D, set), body = o => Object.assign({ year: y, ledger: full.ledger, sales: full.sales, expenses: full.expenses, set: full.set }, o);
    const msg = (s) => s + '(' + t + '回目)';

    /* 売れた記録・月ごと・グループ */
    const bk = SRV.build(D, null, { only: true });
    const books = K.booksYear({ year: y, ledger: bk.ledger, sales: bk.sales, expenses: bk.expenses });
    const M = O.monthly(D, y);
    eq({ months: books.months, total: books.total }, M, msg('月ごとの利益'));

    const un = k => SRV.unPg(k, bk.tok);
    for (const k of ['route', 'party', 'ch']) eq(books.groups[k].map(g => Object.assign({}, g, { key: k === 'party' ? un(g.key) : g.key })), O.groupBy(D, y, k), msg(k + 'ごとの集計'));
    const oev = O.events(D).filter(e => String(e.date).slice(0, 4) === String(y));
    eq(SRV.eventNames(books.events, D).map(e => Object.assign(e, { party: un(e.party) })), oev.map(e => ({ id: e.id, date: e.date, src: e.src, saleId: e.saleId, ledgerId: e.ledgerId, kind: e.kind, ch: e.ch, route: e.route, party: e.party, name: e.name, qty: e.qty, sales: e.sales, cogs: e.cogs, fee: e.fee, ship: e.ship, other: e.other, est: e.est, nocost: e.nocost })), msg('売れた記録(名前合わせ込み)'));

    /* 売れ残り */
    const cfg = { days: pickOne([30, 60, 90]), cats: { 家電: 10, 道具類: 200 }, items: { L1: 5, L3: 400 } }, today = y + '-12-20';
    const st = K.stale({ ledger: SRV.staleRows(D), cfg, today });
    const ost = O.stale(D.ledger, cfg, today);
    eq(SRV.withRows(st.rows, D).map(x => ({ id: x.r.id, days: x.days, limit: x.limit, over: x.over, be: x.be, plan: x.plan, suggest: x.suggest, room: x.room, cost: x.cost })),
      ost.map(x => ({ id: x.r.id, days: x.days, limit: x.limit, over: x.over, be: x.be, plan: x.plan, suggest: x.suggest, room: x.room, cost: x.cost })), msg('売れ残り'));

    /* 棚卸 */
    const cut = pickOne([y + '-12-31', y + '-06-30']);
    const sk = K.stockOp({ ledger: SRV.stockRows(D), cutoff: cut, set: { method: set.method, counts: set.counts } });
    const osk = O.stocktake(D.ledger, cut, set.method, set.counts);
    eq({ book: sk.book, real: sk.real, counted: sk.counted, total: sk.total, rows: SRV.withRows(sk.rows, D).map(x => ({ id: x.r.id, qty: x.qty, count: x.count, price: x.price, book: x.book, real: x.real, diff: x.diff })) },
      { book: osk.book, real: osk.real, counted: osk.counted, total: osk.total, rows: osk.rows.map(x => ({ id: x.r.id, qty: x.qty, count: x.count, price: x.price, book: x.book, real: x.real, diff: x.diff })) }, msg('棚卸'));

    /* 古物商特例 */
    const kobB = SRV.build(D, null, { skip: true }), kb = K.kobutsuOp({ year: y, ledger: kobB.ledger });
    const okb = O.kobutsuCheck(D.ledger, y);
    eq(SRV.withRows(kb.rows, D, (r, x) => (x.idReq ? SC_reason(r, D) : '')).map(x => ({ id: x.r.id, state: x.state, need: x.need, idReq: !!x.idReq, amt: x.amt, why: x.why })),
      okb.rows.map(x => ({ id: x.r.id, state: x.state, need: x.need, idReq: !!x.idReq, amt: x.amt, why: x.why || '' })), msg('古物商特例の行'));
    eq([kb.ok, kb.missing, kb.biz, kb.nw, kb.amountOk, kb.amountMissing, kb.taxOk], [okb.ok, okb.missing, okb.biz, okb.nw, okb.amountOk, okb.amountMissing, okb.taxOk], msg('古物商特例の合計'));

    /* 経過措置(課税事業者の時だけ画面に出る。どちらでも同じ答え) */
    const tr = K.transitionOp(body({}));
    const otr = O.transitionCredit(D, y, setOracle);
    const tokName = i => full.tok.keyOf(i);
    const ixx = SRV.index(D);
    eq({ rows: tr.rows.map(x => ({ type: x.type, id: x.id, date: x.date, amt: x.amt, why: x.why, over: x.over, tax: x.tax, rate: x.rate, credit: x.credit, lost: x.lost })), periods: tr.periods, total: tr.total, cap: tr.cap, overCap: tr.overCap },
      { rows: otr.rows.map(x => ({ type: x.type, id: x.id, date: x.date, amt: x.amt, why: x.why, over: x.over, tax: x.tax, rate: x.rate, credit: x.credit, lost: x.lost })), periods: otr.periods, total: otr.total, cap: otr.cap, overCap: otr.overCap }, msg('経過措置'));
    // 相手の名前・印(端末で番号から戻す)と、仕入れ先の一覧
    eq(tr.rows.map(x => tokName(x.key)), otr.rows.map(x => x.key), msg('経過措置: 相手の印(番号から戻した結果)'));
    eq(tr.parties.map(p => ({ key: tokName(p.key), n: p.n, amt: p.amt, src: p.src, noReg: p.noReg, name: SRV.nameOfParty ? '' : (p.src === 'ledger' ? (ixx.ledger[p.first.id].party || '').trim() : (ixx.expense[p.first.id].payee || '').trim()) })),
      otr.parties.map(p => ({ key: p.key, n: p.n, amt: p.amt, src: p.src, noReg: p.noReg, name: p.name })), msg('経過措置: 仕入れ先の一覧'));

    /* 申告の数字 */
    const tx = K.taxOp(body({ withTransition: true }));
    const otx = O.taxReport(D, y, setOracle);
    eq({ A: tx.A, ao: tx.ao, shiro: tx.shiro, warn: tx.warn, openAuto: tx.openAuto, closeT: tx.closeT }, { A: otx.A, ao: otx.ao, shiro: otx.shiro, warn: otx.warn, openAuto: otx.openAuto, closeT: { book: otx.closeT.book, real: otx.closeT.real, counted: otx.closeT.counted, total: otx.closeT.total } }, msg('申告の数字'));
    eq(!!tx.transition, set.tax === 'taxable', msg('経過措置を一緒に返す(課税事業者だけ)'));
    const lf = {}; O.events(D).forEach(e => { if (e.src === 'ledger' && String(e.date).slice(0, 4) === String(y)) lf[e.ledgerId] = e.fee; });
    eq(tx.ledgerFee, lf, msg('申告の内訳: 台帳の売れた行の推定の手数料'));

    /* 仕訳帳と書き出し */
    const jn = K.journalOp(body({}));
    const oj = O.journal(D, y, setOracle);
    const jrows = SRV.journalRows(jn.entries, D);
    eq(jrows, oj, msg('仕訳帳(摘要を端末で合わせた後)'));
    for (const soft of ['freee', 'mf', 'yayoi', 'plain']) {
      const ex = K.exportOp(body({ soft }));
      const got = SRV.exportFilled(ex, D), want = O.exportRows(oj, soft, setOracle);
      eq(got.header, want.header, msg(soft + ' の見出し'));
      // マネーフォワードの「決算整理仕訳」の印は、サーバーでは摘要の型だけで決める(品名に「棚卸高の振替」を含む品は例外)。乱数の名前にはその語を入れていない
      eq(got.rows, want.rows, msg(soft + ' の行'));
    }

    cov.jn += jn.entries.length ? 1 : 0; cov.keika += jn.entries.some(e => /経過措置/.test(e.tpl)) ? 1 : 0; cov.kobOk += kb.ok ? 1 : 0; cov.kobMissing += kb.missing ? 1 : 0; cov.stale += st.rows.some(x => x.over) ? 1 : 0; cov.closeCnt += sk.counted ? 1 : 0; cov.taxable += set.tax === 'taxable' ? 1 : 0;
    /* 送る欄の確認: 目印の付いた名前・メモ・住所が1文字も入っていない */
    const sent = JSON.stringify(body({}));
    sentChars += sent.length;
    assert.ok(!sent.includes(MARK), msg('送る欄に、名前・メモ・住所の文字が入っている'));
    for (const nm of PARTIES.concat(PAYEE).filter(x => x && x.length > 3)) assert.ok(!sent.includes(nm), msg('送る欄に、取引相手・支払先の名前が入っている: ' + nm));
    n++;
  }
  for (const k of Object.keys(cov)) if (k !== 'mfFlag') assert.ok(cov[k] >= 10, '乱数の記録が足りない(' + k + ' が ' + cov[k] + ' 回しか出ない)');
  console.log('  乱数 ' + ROUNDS + ' 回(1回ごとに 月ごと・グループ・売れた記録・売れ残り・棚卸・古物商・経過措置・申告・仕訳帳・4形式の書き出し)で一致。送る欄の平均 ' + Math.round(sentChars / ROUNDS / 1024) + 'KB');

  /* ---------- 3. 端末の部品に、移した計算が残っていない ---------- */
  eq(['events', 'monthly', 'groupBy', 'stale', 'breakEven', 'stocktake', 'stockAt', 'taxReport', 'journal', 'exportRows', 'kobutsuCheck', 'transitionCredit', 'transitionRate', 'transitionCap', 'TRANSITION'].filter(k => k in B), [], '端末の books-core.js に、移した計算の関数が残っていない');
  const csrc = fs.readFileSync(path.join(BOOKS, 'books-core.js'), 'utf8');
  eq(['function monthly', 'function groupBy', 'function events', 'function taxReport', 'function journal', 'function exportRows', 'function stocktake', 'function stale', 'function kobutsuCheck', 'function transitionCredit', 'function breakEven', 'AO_EXP', 'SHIRO_EXP', 'CH_RATE'].filter(k => csrc.includes(k)), [], '端末の books-core.js の元に、移した計算の文が残っていない');

  /* ---------- 4. 見本の受け付け・鍵なし ---------- */
  const D1 = gen(2026), f1 = SRV.build(D1, null, { only: true });
  const big = Object.assign({}, f1, { ledger: Array.from({ length: 301 }, (_, i) => ({ id: 'x' + i, date: '2026-01-01', saleDate: '2026-02-01', unit: 1, salePrice: 2 })) });
  const ask = async (op, extra) => (await handleCore({ ops: [Object.assign({ op }, extra)] }, {})).results[0];
  eq((await ask('books', { year: 2026, ledger: f1.ledger, sales: f1.sales, expenses: f1.expenses })).error, 'need-pass', '鍵なしで見本の印が無ければ、集計は断る');
  eq((await ask('books', { demo: true, year: 2026, ledger: f1.ledger, sales: f1.sales, expenses: f1.expenses })).months.length, 12, '見本の印と大きさ以内なら、鍵なしでも集計する');
  eq((await ask('tax', { demo: true, year: 2026, ledger: SRV.build(D1, genSet(2026, D1)).ledger, sales: [], expenses: [] })).A != null, true, '見本の申告の数字も、見本の大きさ以内なら出る');
  eq((await ask('books', { demo: true, year: 2026, ledger: big.ledger, sales: [], expenses: [] })).error, 'need-pass', '見本の印があっても、行数の上限(300行)を超えれば断る');
  for (const op of ['stale', 'stock', 'tax', 'journal', 'export', 'kobutsu', 'transition']) eq((await ask(op, { year: 2026, ledger: [], sales: [], expenses: [] })).error, 'need-pass', op + ': 鍵なしは断る');
  console.log(`OK 帳簿の計算の移し替え ${n}件`);
})().catch(e => { console.error(e); process.exitCode = 1; });

function SC_reason(r, D) {
  const SC = require(process.env.SEDORI_SC), tx = SC.txTotals(D.ledger);
  return SC.reason(r, tx[r.id]);
}
