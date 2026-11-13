// 手引きの追加(始める道順の点検表・古物商許可の申請の手引き)と、書き出しの道具の検算。
// 実行: node tests/sedori/test_guide.js [公開フォルダ] [本部の guide_build.py]。2つ目が無い時は、書き出し先の試験だけ飛ばす
const path = require('path'), fs = require('fs'), os = require('os'), assert = require('assert'), cp = require('child_process');
const root = process.argv[2] || path.join(__dirname, '../../../kt-zs-sedori-ghp');
const SD = require('./_dir')(root);
const BUILD = process.argv[3] || process.env.GUIDE_BUILD || '';
const read = (p) => fs.readFileSync(path.join(root, SD, p), 'utf8');
const text = (h) => h.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, '');
let n = 0;
function eq(a, b, msg) { assert.deepStrictEqual(a, b, `${msg}: 実際 ${JSON.stringify(a)} / 期待 ${JSON.stringify(b)}`); n++; }
const NEW = ['hajimeru', 'kobutsu-shinsei'];
const idx = read('guide/index.html'), hj = read('guide/hajimeru/index.html'), ks = read('guide/kobutsu-shinsei/index.html');

// 1. 書き出しが、準備中の間は本番の sedori/guide に書かない(にせの作業フォルダで確かめる)
if (BUILD && fs.existsSync(BUILD)) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zw-guide-'));
  for (const d of ['sedori', 'sedori-test-copy']) {
    fs.mkdirSync(path.join(tmp, d, 'assets'), { recursive: true }); fs.mkdirSync(path.join(tmp, d, 'data'), { recursive: true });
    fs.copyFileSync(path.join(root, SD, 'assets/config.js'), path.join(tmp, d, 'assets/config.js'));
    fs.copyFileSync(path.join(root, SD, 'data/fees.json'), path.join(tmp, d, 'data/fees.json'));
  }
  fs.writeFileSync(path.join(tmp, 'sedori/MAINTENANCE.txt'), '準備中。テスト用の写し: /sedori-test-copy/\n');
  const run = (args, env) => cp.spawnSync('python3', [BUILD, tmp].concat(args), { encoding: 'utf8', env: Object.assign({}, process.env, { SEDORI_OUT: '' }, env || {}) });
  let r = run([]);
  eq([r.status, fs.existsSync(path.join(tmp, 'sedori-test-copy/guide/hajimeru/index.html')), fs.existsSync(path.join(tmp, 'sedori/guide'))], [0, true, false], '準備中は、テスト用の写しにだけ書く');
  eq(/<head><meta name="robots" content="noindex,nofollow">/.test(fs.readFileSync(path.join(tmp, 'sedori-test-copy/guide/kobutsu-shinsei/index.html'), 'utf8')), true, 'テスト用の写しには検索よけが入る');
  r = run(['sedori']);
  eq([r.status !== 0, /公開側の sedori\/guide には書き出しません/.test(r.stderr), fs.existsSync(path.join(tmp, 'sedori/guide'))], [true, true, false], '準備中に公開側を引数で指しても書かない');
  r = run([], { SEDORI_OUT: 'sedori' });
  eq([r.status !== 0, fs.existsSync(path.join(tmp, 'sedori/guide'))], [true, false], '準備中に公開側を環境変数で指しても書かない');
  r = run(['../outside']);
  eq([r.status !== 0, fs.existsSync(path.join(tmp, '../outside/guide'))], [true, false], '書き出し先はフォルダ名だけ(外へ出られない)');
  fs.unlinkSync(path.join(tmp, 'sedori/MAINTENANCE.txt'));
  r = run([]);
  eq([r.status, fs.existsSync(path.join(tmp, 'sedori/guide/hajimeru/index.html')), /noindex/.test(fs.readFileSync(path.join(tmp, 'sedori/guide/hajimeru/index.html'), 'utf8'))], [0, true, false], '準備中でなければ公開側に書き、検索よけは入れない');
  fs.rmSync(tmp, { recursive: true, force: true });
} else console.log('(guide_build.py の場所が無いので、書き出し先の試験は飛ばした)');

// 2. 2ページが一覧に載る。「準備中」の題から外れている。検索よけ(テスト用の写しの間)が入る
eq(NEW.map(s => idx.includes(`<a href="${s}/">`)), [true, true], '一覧に2ページが載る');
eq(/古物商許可が要る場合・要らない場合\(準備中\)/.test(idx), false, '「準備中」の題から外した');
if (SD !== 'sedori') eq([hj, ks, idx].map(h => /<head><meta name="robots" content="noindex,nofollow">/.test(h)), [true, true, true], '検索よけが入っている');
const sm = fs.existsSync(path.join(root, SD, 'sitemap.xml')) ? read('sitemap.xml') : '';
if (/guide\/hajimeru\//.test(sm)) eq(NEW.map(s => sm.includes(`guide/${s}/`)), [true, true], 'サイトマップに2ページが載る');
else console.log('(サイトマップは次の書き出しで入る)');

// 3. 点検表の印が保存され、トップの数と合う。保存できない端末で落ちない
const S = require(path.join(root, SD, 'guide/hajimeru/hajimeru.js'));
const ids = [...hj.matchAll(/data-id="([a-z]+)"/g)].map(m => m[1]);
eq(ids, ['route', 'try', 'amazon', 'rakuten', 'keepa', 'fixed', 'kobutsu', 'first', 'ledger', 'prep'], '点検表は10項目');
eq(new RegExp(`/ ${ids.length} 済み`).test(hj), true, '合計の数が項目の数と同じ');
let st = S.clean(null, ids);
eq(st, [], '初めは空');
st = S.toggle(st, 'route', true, ids); st = S.toggle(st, 'rakuten', true, ids); st = S.toggle(st, 'route', true, ids);
eq(st, ['route', 'rakuten'], '印を付ける(同じ項目を2回付けても1つ)');
eq(S.toggle(st, 'route', false, ids), ['rakuten'], '印を外す');
eq(S.toggle(st, 'nazo', true, ids), ['route', 'rakuten'], '知らない名前は入れない');
eq([S.clean('こわれた値', ids), S.clean({ done: ['try', 'x'] }, ids), S.clean(['prep', 'prep', 'zzz'], ids)], [[], ['try'], ['prep']], '壊れた値・前の形・重なりを直す');
eq([S.next([], ids, ['keepa', 'prep']), S.next(['route', 'try', 'amazon', 'rakuten'], ids, ['keepa', 'prep']), S.next(ids.filter(i => i !== 'keepa' && i !== 'prep'), ids, ['keepa', 'prep'])], ['route', 'fixed', null], '次の項目(任意は飛ばす)');
eq(S.KEY, 'zw-sedori:start-check', 'アプリと同じ保存先');
// トップの数え方(ui.js の mountStart と同じ: 配列なら真の数)
eq(st.filter(Boolean).length, 2, 'トップの「始める道順(2/10)」と同じ数');
const uiSrc = read('assets/ui.js');
if (/start-check/.test(uiSrc)) eq(/Array\.isArray\(v\)\) n = v\.filter\(Boolean\)\.length/.test(uiSrc), true, 'ui.js は配列の数を読む');
// 画面の部品を、保存できない端末(プライベートブラウズ)のにせの画面で動かす
(function () {
  const mk = (id) => { const o = { _id: id, checked: false, textContent: '', getAttribute: (k) => k === 'data-id' ? id : null, parentNode: { querySelector: () => (id === 'keepa' || id === 'prep') ? {} : null } }; return o; };
  const inputs = ids.map(mk), els = { 'hj-n': { textContent: '' }, 'hj-next': { textContent: '' }, 'hj-save': { textContent: '' } };
  let onChange = null;
  const box = { querySelectorAll: () => inputs, querySelector: (s) => ({ textContent: '題 ' + s }), addEventListener: (t, fn) => { onChange = fn; } };
  const doc = { readyState: 'complete', getElementById: (id) => id === 'hj' ? box : els[id], addEventListener() {} };
  const ls = { getItem() { throw new Error('private'); }, setItem() { throw new Error('private'); } };
  const src = fs.readFileSync(path.join(root, SD, 'guide/hajimeru/hajimeru.js'), 'utf8');
  const win = {};
  new Function('window', 'document', 'localStorage', 'module', src.replace(/\}\)\(typeof window[^;]*;\s*$/, '})(window);'))(win, doc, ls, undefined);
  eq(els['hj-n'].textContent, 0, '保存できない端末でも開ける');
  inputs[0].checked = true; onChange({ target: inputs[0] });
  eq([els['hj-n'].textContent, /保存できませんでした/.test(els['hj-save'].textContent), inputs[0].checked], [1, true, true], '保存できない端末でも印は付き、理由が出る');
  const mem = {}; const ls2 = { getItem: (k) => k in mem ? mem[k] : null, setItem: (k, v) => { mem[k] = String(v); } };
  const inputs2 = ids.map(mk); box.querySelectorAll = () => inputs2;
  new Function('window', 'document', 'localStorage', 'module', src.replace(/\}\)\(typeof window[^;]*;\s*$/, '})(window);'))({}, doc, ls2, undefined);
  inputs2[1].checked = true; onChange({ target: inputs2[1] }); inputs2[3].checked = true; onChange({ target: inputs2[3] });
  eq([JSON.parse(mem['zw-sedori:start-check']), els['hj-n'].textContent], [['try', 'rakuten'], 2], '印が端末に残り、数が合う');
})();

// 4. 各項目のリンクが開く(行き先が無いリンクが0)
for (const slug of NEW) {
  const h = slug === 'hajimeru' ? hj : ks, dir = path.join(root, SD, 'guide', slug);
  const hrefs = [...h.matchAll(/(?:href|src)="([^"]+)"/g)].map(m => m[1]).filter(u => !/^(https?:|mailto:|#)/.test(u));
  const bad = hrefs.filter(u => { const p = path.resolve(dir, u.split(/[?#]/)[0]); return !(fs.existsSync(p) && (fs.statSync(p).isFile() || fs.existsSync(path.join(p, 'index.html')))); });
  eq(bad, [], `${slug}: 行き先の無いリンクが0`);
  const anchors = hrefs.filter(u => /#/.test(u) && !/\?utm/.test(u)).filter(u => { const [p, a] = u.split('#'); const f = path.resolve(dir, p.split('?')[0]); const t = fs.readFileSync(fs.statSync(f).isFile() ? f : path.join(f, 'index.html'), 'utf8'); return !new RegExp(`id="${a}"`).test(t); });
  eq(anchors, [], `${slug}: ページの中の行き先(#)がある`);
}
eq([...hj.matchAll(/<li><input type="checkbox" id="hj-[a-z]+" data-id="[a-z]+"><label for="hj-[a-z]+">[\s\S]*?<\/li>/g)].every(m => /<a href="[^"]+"/.test(m[0])), true, '点検表の全項目に、開く先が1つある');

// 5. 文言の点検(収入の見込み・断定・あおりの言葉が0件)
const BAD = /稼げ|儲か|もうか|必ず|絶対|誰でも|簡単に|確実|月\d+万円|再現性|ノーリスク|裏技/;
eq([hj, ks].map(h => BAD.test(text(h))), [false, false], '断定・あおりの言葉が0件');
eq(/収入の見込みは載せていません/.test(text(hj)), true, '始める道順: 収入の見込みを載せていないと書いてある');

// 6. 月額の数字が手数料データ・料金の設定と同じ
const fees = JSON.parse(read('data/fees.json'));
global.window = {}; new Function('window', read('assets/config.js'))(global.window);
const CAT = global.window.ZW_CONFIG.PLAN_CATALOG, yen = (v) => v.toLocaleString('ja-JP') + '円';
const big = Math.round(fees.amazon.monthly_plan_fee_ex_tax * (1 + fees.amazon.tax_rate));
eq([big, (text(hj).match(new RegExp(yen(big).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length >= 2], [5390, true], '大口出品の月額 = 手数料データの税抜×1.1');
eq(['light_month', 'total_month', 'business_month'].map(k => text(hj).includes(yen(CAT[k].price))), [true, true, true], 'このアプリの月額が料金の設定と同じ');
eq(/2026年10月27日/.test(text(hj)) && fees.checked === '2026-10-27', true, '大口出品の月額に確認日がある');
// 確かめられていない数字(Keepaの料金、古物商許可の手数料・日数)を載せていない
const hjMoney = (text(hj).match(/[\d,]+円/g) || []).map(s => s.replace(/[,円]/g, '')).map(Number);
eq(hjMoney.every(v => [0, big, CAT.light_month.price, CAT.total_month.price, CAT.business_month.price].includes(v)), true, '始める道順: 出典のある金額だけ');
const ksBody = text(ks.slice(ks.indexOf('<h1>'), ks.indexOf('<h2>出典</h2>')));
eq([/\d[\d,]*円/.test(ksBody), /\d+\s*日/.test(ksBody.replace(/2026年11月13日/, '')), /警察署の窓口か、都道府県警察の公式の案内で確かめてください/.test(ksBody)], [false, false, true], '古物商許可: 金額と日数を載せず、窓口・公式で確かめると書いてある');
eq([/このページでは判断しません/.test(ksBody), /laws\.e-gov\.go\.jp/.test(ks)], [true, true], '古物商許可: 法律の判断をしない・条文の出典がある');
// 検品B-7: 出典に無い内容を言い切らない。条文と照らしていないのに「照らして確認」と書かない。うその確認日を書かない
eq([/手続きの流れの案内/.test(ksBody), /出典と照らして確認しています/.test(text(ks)), /条文との照合はしていません/.test(text(ks))], [true, false, true], '古物商許可: 手続きの流れの案内と明記し、照合済みと書かない');
eq([/仕入れのたびに/, /窓口は、主たる営業所/, /許可が要ります/, /次の3つと決めています/, /扱いが変わることがあります/].map(r => r.test(ksBody)), [false, false, false, false, false], '古物商許可: 検品で挙がった言い切りが無い');
eq(/確認日|に確認/.test(text(ks.slice(ks.indexOf('<h2>出典</h2>'), ks.indexOf('class="box"')))), false, '古物商許可: 出典に確認日を書いていない(照合していないため)');
eq(/最終確認日/.test(text(ks)), false, '古物商許可: ページのどこにも「最終確認日」を出さない');
// 文字の決まり(本文16px・行間1.75・1行40字まで)
const css = read('guide/guide.css');
eq([/font:16px\/1\.75 var\(--font\)/.test(css), /article\{min-width:0;max-width:640px\}/.test(css), /body\{font-size:15/.test(css)], [true, true, false], '手引きの文字の決まり');
console.log(`test_guide: ${n}件 すべて一致`);
