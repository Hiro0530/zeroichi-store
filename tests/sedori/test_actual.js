// 運用テストの修正点(2026-10-29 ミューズの報告)の検算。実行: node tests/sedori/test_actual.js [公開フォルダ]
// ① 実際の売値の欄と、目標の売値との差 ② 価格差が先、ポイントは後(ポイント抜きの利益を先に) ③ ポイント率の目安とヒント
// ④ 見本表「今日のポイント高還元」をお客さん向けに出さない ⑤ 初期表示分を HTML に入れる、と、テスト用の写しの noindex
const path = require('path'), fs = require('fs'), assert = require('assert');
const root = process.argv[2] || path.join(__dirname, '../../../kt-zs-sedori-ghp');
const SD = require('./_dir')(root);  // 準備中の間はテスト用の写しを読む
const read = p => fs.readFileSync(path.join(root, SD, p), 'utf8');
const text = h => h.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
let n = 0;
function eq(a, b, msg) { assert.deepStrictEqual(a, b, `${msg}: 実際 ${JSON.stringify(a)} / 期待 ${JSON.stringify(b)}`); n++; }

// ブラウザの最小の代わり(ui.js の部品だけ使う)
global.window = { matchMedia: () => ({ matches: false }) };
global.location = { hash: '', search: '', protocol: 'http:' };
global.navigator = {};
global.document = { readyState: 'complete', body: { getAttribute: () => null }, addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } };
global.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
global.fetch = () => new Promise(() => {});
const C = window.SedoriCalc = require(path.join(root, SD, 'assets/calc.js'));
window.SedoriSellerCheck = require(path.join(root, SD, 'assets/seller-check.js'));
require(path.join(root, SD, 'assets/ui.js'));
const U = window.SedoriUI;
const fees = JSON.parse(read('data/fees.json'));

// ---- ① 実際の売値の欄(全ルート) ----
const ROUTES = ['rakuten-amazon', 'muzaiko-amazon', 'mercari-calc', 'yahuoku-mercari', 'auction-mercari'];
const pages = Object.fromEntries(ROUTES.map(r => [r, read(r + '/index.html')]));
eq(/Amazonの実際の売値\(税込\)[\s\S]{0,200}id="c-sell"/.test(pages['rakuten-amazon']), true, '楽天→Amazon: Amazonの実際の売値の欄');
eq(/中古の実際の売値[\s\S]{0,200}id="mz-actual"/.test(pages['muzaiko-amazon']), true, '無在庫: 中古の実際の売値の欄');
for (const r of ['mercari-calc', 'yahuoku-mercari', 'auction-mercari']) eq(/実際の売値 <input id="s-price"/.test(pages[r]), true, r + ': 実際の売値の欄');
const cmp = U.compareHTML({ actual: 1650, target: 2931, where: 'Amazon', tgLabel: '利益率15%' });
eq([/実際の売値/.test(cmp), /1,650/.test(cmp), /2,931/.test(cmp), /目標に1,281円足りない/.test(cmp), /diff bad/.test(cmp)], [true, true, true, true, true], '実際の売値と目標の売値の差(足りない)');
eq(/目標より500円高い/.test(U.compareHTML({ actual: 3000, target: 2500, where: 'Amazon', tgLabel: '' })), true, '実際の売値と目標の売値の差(高い)');
const ask = U.askActualHTML({ where: 'Amazon', target: 2931, be: 2451, tgLabel: '利益率15%' });
eq([/Amazonの実際の売値を入れてください/.test(ask), /逆算した目安/.test(ask), /その値段で売れるという意味ではありません/.test(ask)], [true, true, true], '実際の売値が未入力の時は、目標の売値を目安として出す');

// ---- ② 価格差が先、ポイントは後 ----
// 例: 仕入れ1,650円・実際の売値1,650円・ポイント1%(ミューズの検証の KATE ライナーと同じ形)。ポイント抜きで赤字
const x = { sell: 1650, category: 'beauty', fbaTier: 'small', cost: 1650, inShip: 0, inbound: 100, other: 0, pointRate: 0.01 };
const r = C.amazonProfit(fees, x);
eq(r.profitNoPoints, r.profit - r.points, 'ポイント抜きの利益 = 利益 − ポイント');
eq(r.points, 15, 'ポイントは 仕入れ値÷1.1×率(切り捨て): 1650÷1.1=1500×1%=15');
const g = U.gateHTML({ noPt: r.profitNoPoints, pt: r.points, ptLabel: '1%' });
eq([r.profitNoPoints < 0, /gate ng/.test(g), /<b>赤字<\/b>/.test(g), /ポイント\(上乗せ・1%\)/.test(g)], [true, true, true, true], 'ポイント抜きで赤字なら目立たせ、ポイントは上乗せとして下に');
eq(g.indexOf('ポイント抜きの利益') < g.indexOf('ポイント(上乗せ'), true, 'ポイント抜きの利益が先、ポイントは後');
eq(/ポイント込みの利益<\/td><td>-?[\d,]+円/.test(g), true, 'ポイント込みの利益も出す');
eq(/gate ok[\s\S]*<b>黒字<\/b>/.test(U.gateHTML({ noPt: 500, pt: 30 })), true, 'ポイント抜きで黒字');
eq(/<b>±0円<\/b>/.test(U.gateHTML({ noPt: 0 })), true, 'ポイント抜きで0円は黒字と言わない');
eq(/ポイント\(上乗せ/.test(U.gateHTML({ noPt: 100, title: '利益(1個)', plain: true })), false, 'ポイントの無いルートは上乗せの行を出さない');
// 内訳の順番(ra.js / market.js): ポイント抜きの利益 → ポイント(上乗せ) → ポイント込みの利益
const ra = read('assets/ra.js'), mk = read('assets/market.js');
eq(ra.indexOf("['ポイント抜きの利益(1個)'") > 0 && ra.indexOf("['ポイント抜きの利益(1個)'") < ra.indexOf("['ポイント(上乗せ・'"), true, 'ra.js の内訳はポイント抜きが先');
eq(/unit0: Math\.ceil\(total0 \/ qty\)/.test(mk) && /'仕入れ原価\(1個・ポイント抜き\)'/.test(mk), true, 'ヤフオク→メルカリ: 原価はポイント抜きで出す');

// ---- ③ ポイント率の目安とヒント ----
const raText = text(pages['rakuten-amazon']);
eq([/楽天の通常分は1%/.test(raText), /SPU/.test(raText), /人によって違う/.test(raText), /ご自身の実際の率/.test(raText), /仕入れ値÷1\.1×率/.test(raText)], [true, true, true, true, true], '楽天→Amazon: ポイント率の目安とヒント');
eq(/id="c-pt-shop" type="number" inputmode="decimal" min="0" step="0.1" value="1"/.test(pages['rakuten-amazon']), true, 'ショップのポイントの初期表示は1%');
eq(/ご自身の実際の率/.test(text(pages['yahuoku-mercari'])), true, 'ヤフオク→メルカリ: ポイント率のヒント');

// ---- ④ 見本表を出さない ----
const top = read('index.html');
eq([/高還元/.test(text(top)), /today-grid/.test(top), /高還元/.test(text(pages['rakuten-amazon'])), /data-tab="t"/.test(pages['rakuten-amazon'])], [false, false, false, false], 'トップと楽天→Amazonに見本表が無い');
eq([/today\.json/.test(read('assets/top.js')), /today\.json/.test(ra)], [false, false], '見本のデータを読みに行かない');

// ---- ⑤ 初期表示分を HTML に ----
for (const r2 of ROUTES) eq(/<noscript><p class="nojs">/.test(pages[r2]), true, r2 + ': JavaScript が動かない時の一言');
const opts = (h, id) => ((h.match(new RegExp('<select id="' + id + '">([\\s\\S]*?)</select>')) || [, ''])[1].match(/<option /g) || []).length;
eq(opts(pages['rakuten-amazon'], 'c-cat'), fees.amazon.categories.length, '楽天→Amazon: カテゴリーの選択肢');
eq(opts(pages['rakuten-amazon'], 'c-tier'), fees.amazon.fba_tiers.length, '楽天→Amazon: FBAのサイズの選択肢');
eq(opts(pages['muzaiko-amazon'], 'mz-carrier'), fees.self_ship.carriers.length, '無在庫: 運送会社の選択肢');
eq(opts(pages['auction-mercari'], 'b-venue'), fees.auctions.presets.length, '業者オークション: 市場の選択肢');
eq(/<option value="toys" selected>/.test(pages['rakuten-amazon']), true, 'カテゴリーの初期はおもちゃ(ra.js と同じ)');
// メルカリの表の初期表示は calc.js と同じ数字(仕入れ0円・目標 利益率15%)
const mc = pages['mercari-calc'], tg = { mode: 'pct', value: 15 };
let rows = 0;
for (const sh of fees.mercari.shipping) {
  const fixed = (sh.id === 'custom' ? 0 : sh.fee) + sh.material;
  const inp = { rate: fees.mercari.rate, shipFee: sh.id === 'custom' ? 0 : sh.fee, material: sh.material, cost: 0, other: 0 };
  const tp = C.marketPriceFor(inp, tg), be = C.marketPriceFor(inp, 0);
  const m = mc.match(new RegExp('<tr data-i="' + sh.id + '"[^>]*>[\\s\\S]*?</tr>'));
  assert(m, sh.id);
  const cells = m[0].match(/<td[^>]*>[\s\S]*?<\/td>/g).map(c => c.replace(/<[^>]+>/g, '').replace(/円$/, ''));
  eq([cells[1], cells[2], cells[3], cells[4]], [fixed.toLocaleString('ja-JP'), be.toLocaleString('ja-JP'), tp.toLocaleString('ja-JP'), C.marketFee(tp, fees.mercari.rate).toLocaleString('ja-JP')], 'メルカリの表の初期表示 ' + sh.id);
  rows++;
}
eq(rows, fees.mercari.shipping.length, 'メルカリの表は全配送方法');

// ---- テスト用の写しは全ページ noindex ----
if (SD !== 'sedori') {
  const all = [];
  (function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.html$/.test(f)) all.push(p); } })(path.join(root, SD));
  const miss = all.filter(p => !/<meta name="robots" content="noindex/.test(fs.readFileSync(p, 'utf8').slice(0, 3000))).map(p => path.relative(root, p));
  eq(miss, [], 'テスト用の写しの全ページに noindex');
}

// ---- 書き出し先: 準備中の間は公開側の sedori/ に書かない(build_pages.py と _dir.js) ----
const os = require('os'), cp = require('child_process');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sedori-out-'));
fs.mkdirSync(path.join(tmp, 'sedori'));
fs.writeFileSync(path.join(tmp, 'sedori/MAINTENANCE.txt'), '準備中。テスト用の写し: /check-copy-x/\n');
const dirOf = require('./_dir');
eq(dirOf(tmp), 'check-copy-x', '準備中はテスト用の写しを読む');
const build = path.join(__dirname, '../../tools/sedori/build_pages.py');
const run = env => cp.spawnSync('python3', [build, tmp], { env: Object.assign({}, process.env, env), encoding: 'utf8' });
const blocked = run({ SEDORI_OUT: 'sedori' });
eq([blocked.status !== 0, /公開側の sedori\/ には書き出しません/.test(blocked.stderr + blocked.stdout)], [true, true], '準備中に sedori/ へ書こうとしたら止まる');
fs.rmSync(path.join(tmp, 'sedori/MAINTENANCE.txt'));
eq(dirOf(tmp), 'sedori', '準備中でなければ sedori');
fs.rmSync(tmp, { recursive: true, force: true });

console.log('OK ' + n + '件');
