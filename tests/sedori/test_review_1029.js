// 2026-10-29 表示確認(ミューズ)の指摘の検算。実行: node tests/sedori/test_review_1029.js [公開フォルダ]
// 1. 先着の定員は200名(2026-10-28 オーナー決定)。「先着100名」の文字がどこにも残らない(ページ・画面の部品・特商法・Worker・書き出し・README)
// 2. AIに相談の前提(マスタープロンプト)に、せどり専用の範囲限定の条項がそのまま入っている
// 3. 有料版の受付開始日は、決まるまで日付を出さない。日付は config.js の PREREG の1行だけで決まり、直せば全ページに出る
// 4. 目標の売値もポイント抜きで逆算する(価格差が先、ポイントは後)
const path = require('path'), fs = require('fs'), os = require('os'), assert = require('assert'), vm = require('vm'), cp = require('child_process');
const root = path.resolve(process.argv[2] || path.join(__dirname, '../../../kt-zs-sedori-ghp'));
const SD = require('./_dir')(root);  // 準備中の間はテスト用の写しを読む
const REPO = path.join(__dirname, '../..');
const read = p => fs.readFileSync(path.join(root, p.replace(/^sedori\//, SD + '/')), 'utf8');
const text = h => h.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
let n = 0;
function eq(a, b, msg) { assert.deepStrictEqual(a, b, `${msg}: 実際 ${JSON.stringify(a)} / 期待 ${JSON.stringify(b)}`); n++; }

function walk(dir, re, out = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f), st = fs.statSync(p);
    if (st.isDirectory()) { if (f !== 'vendor' && f !== 'node_modules' && f !== '.git') walk(p, re, out); } else if (re.test(f)) out.push(p);
  }
  return out;
}

const cfgSrc = read('sedori/assets/config.js');
const win = {}; vm.runInNewContext(cfgSrc, { window: win });
const CFG = win.ZW_CONFIG;

// ---------- 1. 先着200名 ----------
eq(CFG.FOUNDER_LIMIT, 200, 'config の先着の定員は200名');
eq([CFG.PLAN_CATALOG.founder_month.name, CFG.PLAN_CATALOG.founder_year.name], ['総合 先着200名の価格', '総合 先着200名の価格'], '料金表のプラン名も200名');
const siteFiles = walk(path.join(root, SD), /\.(html|js|json|xml|txt)$/).concat([path.join(root, 'tokushoho.html'), path.join(root, 'privacy.html')]);
const repoFiles = ['tools/sedori/build_pages.py', 'backend/sedori/worker/src/index.js', 'backend/sedori/worker/wrangler.toml', 'backend/sedori/README.md', 'backend/sedori/firestore.rules']
  .map(p => path.join(REPO, p)).concat(walk(path.join(REPO, 'tests/sedori'), /\.js$/).filter(p => !/test_review_1029\.js$/.test(p)), walk(path.join(REPO, 'backend/sedori/worker/test'), /\.js$/));
const left = siteFiles.concat(repoFiles).filter(p => /先着\s*100\s*名|100名に達/.test(fs.readFileSync(p, 'utf8'))).map(p => path.relative(path.dirname(REPO), p));
eq(left, [], '「先着100名」「100名に達」の文字がどこにも残っていない');
const plans = text(read('sedori/plans/index.html')), top = text(read('sedori/index.html')), terms = text(read('sedori/terms/index.html'));
const lp = text(read('sedori/lp/index.html')), toku = text(read('tokushoho.html'));
eq([/先着200名は 月3,980円/.test(plans), /総合 先着200名/.test(top), /1回目のお支払いが済んだ方が200名に達するまで/.test(terms), /先着200名は月3,980円/.test(lp)], [true, true, true, true], '料金ページ・トップ・規約・紹介ページは200名');
eq(/総合の先着200名の価格: 月額3,980円\/年額39,800円\(1回目のお支払いが済んだ方が200名に達した時点で受付終了/.test(toku), true, '特商法のせどりの行は200名');
const plansJs = read('sedori/assets/plans.js'), myJs = read('sedori/assets/mypage.js'), uiJs = read('sedori/assets/ui.js');
eq([/cfg\.FOUNDER_LIMIT/.test(plansJs), /cfg\.FOUNDER_LIMIT/.test(myJs), /FOUNDER_LIMIT/.test(uiJs)], [true, true, true], '画面の部品の人数は config の FOUNDER_LIMIT から');
const worker = fs.readFileSync(path.join(REPO, 'backend/sedori/worker/src/index.js'), 'utf8');
eq(/export const FOUNDER_LIMIT_DEFAULT = 200;/.test(worker) && /^FOUNDER_LIMIT = "200"/m.test(fs.readFileSync(path.join(REPO, 'backend/sedori/worker/wrangler.toml'), 'utf8')), true, 'Worker の先着の上限も200名');

// ---------- 2. AIに相談: せどり専用の範囲限定 ----------
const SCOPE = 'この相談窓口は、せどりとこのソフトの使い方専用です。それ以外の相談（個人的な悩み、健康、恋愛、家族、お金そのものなど）には答えず、せどり専用窓口である旨を案内してください。';
const aiSrc = read('sedori/assets/ai.js');
const stubEl = { appendChild() {}, addEventListener() {} };
const sw = { ZW_CONFIG: CFG, SedoriUI: { $: () => null, $$: () => [], esc: s => s, store: { get: (k, d) => d, set() {} } }, addEventListener() {} };
sw.window = sw;
vm.runInNewContext(aiSrc, { window: sw, document: { readyState: 'complete', body: { getAttribute: () => null }, createElement: () => stubEl, addEventListener() {} }, location: { hash: '' }, setTimeout });
const AI = sw.SedoriAI;
eq([AI.master('go').includes(SCOPE), AI.master('ack').includes(SCOPE)], [true, true], 'マスタープロンプトに範囲限定の条項がそのまま入っている');
eq(AI.master('go').indexOf(SCOPE) < AI.master('go').indexOf('数字が足りない時は'), true, '範囲限定は答え方の決まりの1番目');
eq([/先着200名は月3,980円/.test(AI.master('go')), /ポイント抜きで\)目標の利益に届く売値/.test(AI.master('go'))], [true, true], '前提の文も200名・目標の売値はポイント抜き');

// ---------- 3. 受付開始日 ----------
eq([CFG.PREREG.open, CFG.PREREG.notice], [null, null], '受付開始日はオーナーが決め直すまで null');
const NOW = '有料版の受付開始日は、決まりしだいこのページでお知らせします';
const prePages = ['sedori/index.html', 'sedori/plans/index.html', 'sedori/shikumi/index.html', 'sedori/chigai/index.html'];
eq(prePages.map(p => text(read(p)).includes(NOW)), [true, true, true, true], 'トップ・料金・仕組み・違いのページに「決まりしだいお知らせします」');
eq(siteFiles.filter(p => /\.html$/.test(p) && /11月4日|11月3日|受付は\d+月/.test(fs.readFileSync(p, 'utf8'))).map(p => path.relative(root, p)), [], 'ページに日付の入った受付開始の表記が残っていない');
eq(/受付開始の前日/.test(uiJs) && !/11月[34]日/.test(uiJs), true, '事前登録のメールの本文も、日付が無い間は日付を出さない');
// config の PREREG の1行を直して書き出し直すと、全ページに日付が出る(写しのフォルダで試す)
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sedori-prereg-'));
  try {
    fs.cpSync(path.join(root, SD), path.join(tmp, SD), { recursive: true });
    const cf = path.join(tmp, SD, 'assets/config.js');
    const src = fs.readFileSync(cf, 'utf8'), line = /^(\s*)PREREG: \{ open: null, notice: null \},$/m;
    eq(line.test(src), true, 'config の PREREG は1行');
    fs.writeFileSync(cf, src.replace(line, '$1PREREG: { open: "11月9日(月)", notice: "11月8日(日)" },'));
    cp.execFileSync('python3', [path.join(REPO, 'tools/sedori/build_pages.py'), tmp], { env: Object.assign({}, process.env, { SEDORI_OUT: SD }), stdio: 'pipe' });
    const r2 = p => text(fs.readFileSync(path.join(tmp, p.replace(/^sedori\//, SD + '/')), 'utf8'));
    eq(prePages.map(p => r2(p).includes('有料版の受付は11月9日(月)から') || r2(p).includes('お申し込みの受付は 11月9日(月) からです')), [true, true, true, true], '1行直すと全ページに日付が出る');
    eq(/11月9日\(月\)から受け付けます。事前登録\(メール1通・無料\)の方へは、11月8日\(日\)にメールでご案内します/.test(r2('sedori/index.html')), true, 'よくある質問にも日付とご案内の日');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// ---------- 4. 目標の売値はポイント抜き ----------
const C = require(path.join(root, SD, 'assets/calc.js'));
const fees = JSON.parse(read('sedori/data/fees.json'));
const raJs = read('sedori/assets/ra.js'), mkJs = read('sedori/assets/market.js');
eq(/amazonPriceFor\(fees, Object\.assign\(\{\}, x, \{ usePoints: false \}\), tg\)/.test(raJs), true, '楽天→Amazon: 目標の売値はポイント抜きで逆算');
eq(/tp = C\.marketPriceFor\(x0, tg\)/.test(mkJs), true, 'ヤフオク→メルカリ: 目標の売値はポイント抜きの原価で逆算');
// ポイントがあると、ポイント込みで逆算した売値より高くなる(ポイントで目標に届く売値は出さない)
const x = { category: 'toys', fbaTier: 'std1', cost: 1650, inShip: 0, inbound: 100, other: 0, pointRate: 0.1, usePoints: true };
const tg = { mode: 'pct', value: 15 };
const withPt = C.amazonPriceFor(fees, x, tg), noPt = C.amazonPriceFor(fees, Object.assign({}, x, { usePoints: false }), tg);
eq([noPt > withPt, C.amazonProfit(fees, Object.assign({}, x, { sell: noPt })).profitNoPoints >= C.needProfit(noPt, tg),
  C.amazonProfit(fees, Object.assign({}, x, { sell: noPt - 1 })).profitNoPoints < C.needProfit(noPt - 1, tg)], [true, true, true], 'ポイント抜きで目標に届く最安の売値');
eq([/ポイント抜きで逆算した目安/.test(uiJs), /ポイントを足さずに\(価格差だけで\)/.test(uiJs)], [true, true], '表示の文言もポイント抜き');
eq([/目標の利益からポイント抜きで逆算した値です/.test(text(read('sedori/rakuten-amazon/index.html'))), /目標の利益からポイント抜きで逆算した目安/.test(text(read('sedori/yahuoku-mercari/index.html')))], [true, true], 'ページの注記もポイント抜き');

console.log('OK ' + n + '件');
