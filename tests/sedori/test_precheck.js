// 仕入れる前の確かめ(assets/precheck.js)の検算。実行: node tests/sedori/test_precheck.js [公開フォルダ]
const path = require('path'), fs = require('fs'), assert = require('assert');
const root = process.argv[2] || path.join(__dirname, '../../../kt-zs-sedori-ghp');
const SD = require('./_dir')(root);
const file = path.join(root, SD, 'assets/precheck.js');
const P = require(file);
let n = 0;
function eq(a, b, msg) { assert.deepStrictEqual(a, b, `${msg}: 実際 ${JSON.stringify(a)} / 期待 ${JSON.stringify(b)}`); n++; }

// 項目は8つ。自動で付くのは「Amazon本体」と「サイズ」の2つだけ
eq(P.ITEMS.map(i => i.id), ['list', 'brand', 'hazmat', 'maker', 'amz', 'size', 'doc', 'limit'], '8項目');
eq(P.ITEMS.filter(i => i.auto).map(i => i.id), ['amz', 'size'], '自動で付く項目');
eq(P.ITEMS.every(i => i.label && i.how && i.how.length <= 60), true, '各項目に、確かめ方の1行');

// 4. Keepaの値がある時だけ⑤が自動で付く
eq(P.autoMarks({ kp: null, tierAuto: false }), {}, 'Keepaの値も寸法も無ければ、自動の印は無い');
eq(P.autoMarks({ kp: { amz: false } }), { amz: true }, 'Keepaの値で、Amazon本体が販売していない → 印');
eq(P.autoMarks({ kp: { amz: true } }), { amz: false }, 'Keepaの値で、Amazon本体が販売中 → 印は付かない');
eq(P.autoMarks({ kp: { bb: 3000 } }), {}, 'Keepaの値に本体の有無が無ければ、自分で付ける');
eq(P.autoMarks({ kp: null, tierAuto: true }), { size: true }, '寸法から区分が出ていれば⑥に印');
eq(P.autoMarks(null), {}, '商品が無くても落ちない');
let m = P.merge({}, P.autoMarks({ kp: { amz: false } }));
eq(m.filter(x => x.on).map(x => x.id), ['amz'], 'Keepaの値がある時だけ⑤が付く');
eq(P.merge({}, {}).filter(x => x.on).length, 0, 'Keepaの値が無い時は⑤は付かない');
eq(P.merge({ amz: 1 }, {}).filter(x => x.on).map(x => x.id), ['amz'], 'Keepaの値が無い時は、自分で⑤に付けられる');
eq(P.merge({ amz: 1 }, { amz: false }).filter(x => x.on).length, 0, 'Amazon本体が販売中と分かっている時は、自分の印より優先');

// 印の数が台帳の行に残る(n/of と、付いていない項目)
let r = P.result({ list: 1, brand: 1, hazmat: 1, maker: 1 }, { amz: true, size: true }, '2026-11-13');
eq(r, { n: 6, of: 8, miss: ['doc', 'limit'], at: '2026-11-13' }, '6/8 と残りの項目');
eq(P.missText(r), '確かめが2つ残っています: 書類(請求書・領収書)がもらえる仕入れ先である/仕入れる数が、仕入れ先の決まりに触れない', '残りを知らせる文');
r = P.result({ list: 1, brand: 1, hazmat: 1, maker: 1, amz: 1, size: 1, doc: 1, limit: 1 }, {});
eq([r.n, r.miss, P.missText(r)], [8, [], ''], '全部付いていれば、知らせる文は空');
// 5. 印が0でも結果は作れる(「仕入れた」を止めない)
r = P.result({}, {});
eq([r.n, r.of, r.miss.length], [0, 8, 8], '印が0でも結果を返す');
eq(P.result(undefined, undefined).n, 0, '保存が無くても落ちない');
eq(P.result({ unknown: 1, list: 1 }, {}).n, 1, '知らない名前の印は数えない');

// 保存は300件まで(古いものから消す)。コードは空白を取り、大文字にそろえる
const big = {}; for (let i = 0; i < 320; i++) big['49' + String(i).padStart(11, '0')] = { m: { list: 1 }, at: i };
const pr = P.prune(big, 300);
eq([Object.keys(pr).length, '4900000000000' in pr, '4900000000319' in pr], [300, false, true], '300件を超えたら古いものから消す');
eq(P.prune({ a: { m: {}, at: 1 } }, 300), { a: { m: {}, at: 1 } }, '少ない時はそのまま');
eq([P.normCode(' b0abc12345 '), P.normCode('4901 2345 67894'), P.normCode(null)], ['B0ABC12345', '4901234567894', ''], 'コードの形をそろえる');

// 画面: 「仕入れた」は ui.js の口(buy-row)で行に結果を足すだけ。押せなくする処理が無い
const src = fs.readFileSync(file, 'utf8');
eq([/U\.hook\('buy-row'/.test(src), /U\.hook\('bought'/.test(src)], [true, true], '台帳に入れる直前に結果を足し、入った直後に知らせる');
eq(/data-act="buy"[^;]*disabled|buy[^;\n]*\.disabled\s*=\s*true|preventDefault/.test(src), false, '印が足りなくても「仕入れた」を止めない');
// このアプリはAmazonの画面を読まない。書類の条件・制限の解き方を書かない
eq(/fetch\(|XMLHttpRequest|sendBeacon/.test(src), false, 'どこにも問い合わせない(印を付けるだけ)');
eq((src.match(/https?:\/\//g) || []).length, 0, '外の住所を持たない');
eq((src.match(/稼げ|儲か|もうか|必ず|絶対|誰でも|裏技|解除の方法/g) || []).length, 0, '断定・あおり・制限の解き方の言葉が0件');
eq(/Amazonの出品者向けの案内で確かめる/.test(src), true, '書類の条件は「Amazonの出品者向けの案内で確かめる」');
// 読み取りの画面: 入れ物と読み込み、台帳の行への受け渡し
const scanHtml = fs.readFileSync(path.join(root, SD, 'scan/index.html'), 'utf8'), scanJs = fs.readFileSync(path.join(root, SD, 'assets/scan.js'), 'utf8');
eq([/<div id="precheck"><\/div>\s*<div class="acts">/.test(scanHtml), scanHtml.indexOf('assets/precheck.js') < scanHtml.indexOf('assets/scan.js?'), /assets\/tools\.css/.test(scanHtml)], [true, true, true], '読み取りの画面: 「仕入れた」の上に入れ物・scan.js の前に読み込む');
eq([/precheck: PC && r\.to !== 'mercari' \? PC\.resultFor\(r\.jan\) : undefined/.test(scanJs), /hide: !r \|\| r\.to === 'mercari'/.test(scanJs)], [true, true], '読み取り: Amazonに売る時だけ出し、結果を台帳の行へ');
const raHtml = fs.readFileSync(path.join(root, SD, 'rakuten-amazon/index.html'), 'utf8');
eq([/id="precheck"/.test(raHtml), /assets\/precheck\.js/.test(raHtml)], [true, true], '楽天・Yahoo!→Amazon: 入れ物と読み込みがある');
// 批評C3: 「仕入れた」の並びを下端に貼り付ける(確かめ欄を開いても画面の外へ行かない)
const css = fs.readFileSync(path.join(root, SD, 'assets/tools.css'), 'utf8');
eq(/#precheck\+\.acts\{position:sticky;bottom:0/.test(css), true, '「仕入れた」の並びが下端に貼り付く');
console.log(`test_precheck: ${n}件 すべて一致`);
