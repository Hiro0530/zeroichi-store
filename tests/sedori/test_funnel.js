// 「訪問→納得→申込」の流れの検算(2026-10-29 本部承認 D1〜D6)。実行: node tests/sedori/test_funnel.js [公開フォルダ]
// - D1: トップと料金ページに年払いの金額と「10か月分の料金で1年(2か月分お得)」
// - D2: 事前登録の欄(メール1通)が入口のページにあり、プライバシーポリシーに利用目的と保存期間
// - D3: 利益の仕組みのページの計算の例が、計算機(calc.js)と同じ数字。約束しない旨の注意がすぐ下にある
// - D4: 違いのページは9項目。相手を名指しせず、利益を約束する言い方をしない
// - D5: AIに相談: 相談の型6つ・前提の文の料金が config と同じ・注意書き・APIキーを読まない
// - 年払いの返金: 31日目からは返金なし・次の更新の停止として扱う(規約・特商法・料金ページ)
const path = require('path'), fs = require('fs'), assert = require('assert'), vm = require('vm');
const root = process.argv[2] || path.join(__dirname, '../../../kt-zs-sedori-ghp');
const SD = require('./_dir')(root);  // 準備中の間はテスト用の写しを読む
const read = p => fs.readFileSync(path.join(root, p.replace(/^sedori\//, SD + '/')), 'utf8');
const text = h => h.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
let n = 0;
function eq(a, b, msg) { assert.deepStrictEqual(a, b, `${msg}: 実際 ${JSON.stringify(a)} / 期待 ${JSON.stringify(b)}`); n++; }

const cfgSrc = read('sedori/assets/config.js');
const win = {}; vm.runInNewContext(cfgSrc, { window: win });
const CAT = win.ZW_CONFIG.PLAN_CATALOG;
const y = k => CAT[k].price.toLocaleString('en-US') + '円';
const top = text(read('sedori/index.html')), plans = text(read('sedori/plans/index.html'));

// D1
eq(['light', 'total', 'business'].map(b => CAT[b + '_year'].price === CAT[b + '_month'].price * 10), [true, true, true], '年払いは10か月分');
eq(['light_year', 'total_year', 'business_year', 'founder_year'].map(k => top.includes(y(k))), [true, true, true, true], 'トップに年払いの金額');
eq([/10か月分の料金で1年\(2か月分お得\)/.test(top), /10か月分の料金で1年\(2か月分お得\)/.test(plans)], [true, true], 'トップと料金ページに「10か月分(2か月分お得)」');

// D2
const PAGES = ['sedori/index.html', 'sedori/plans/index.html', 'sedori/shikumi/index.html', 'sedori/chigai/index.html'];
eq(PAGES.map(p => /data-prereg/.test(read(p))), [true, true, true, true], '事前登録の欄');
const ui = read('sedori/assets/ui.js');
eq([/せどりアプリ事前登録/.test(ui), /mail\.google\.com\/mail\/\?view=cm/.test(ui), /mailto:/.test(ui)], [true, true, true], '事前登録は Gmail・メールアプリのどちらでも送れる');
eq(!!win.ZW_CONFIG.PREREG && /11月4日/.test(win.ZW_CONFIG.PREREG.open), true, '受付開始の日は config から');
const priv = text(read('sedori/privacy/index.html'));
eq([/事前登録の方へ、有料版の受付開始のご案内を1通/.test(priv), /事前登録のメール/.test(priv)], [true, true], 'プライバシーポリシー: 事前登録の利用目的と保存期間');

// D3
const C = require(path.join(root, SD, 'assets/calc.js'));
const fees = JSON.parse(read('sedori/data/fees.json'));
const shk = text(read('sedori/shikumi/index.html')), shkRaw = read('sedori/shikumi/index.html');
const ship = fees.mercari.shipping.find(s => s.id === 'tq60');
const unit = 3000 + 750 - Math.floor(3000 * 1 / 100);
const r = C.marketProfit({ sell: 6500, rate: fees.mercari.rate, shipFee: ship.fee, material: ship.material, cost: unit, other: 0 });
const be = C.marketPriceFor({ rate: fees.mercari.rate, shipFee: ship.fee, material: ship.material, cost: unit, other: 0 }, 0);
eq([shk.includes('=' + r.profit.toLocaleString('en-US') + '円'), shk.includes(be.toLocaleString('en-US') + '円')], [true, true], '計算の例の利益と損益分岐が calc.js と同じ');
eq(/計算の例です。この値段で売れることや、この利益が出ることを約束するものではありません/.test(shk), true, '計算の例のすぐ下に約束しない旨');
eq(/yahuoku-mercari\/\?b-bid=3000&(amp;)?b-ship=750&(amp;)?b-pt=1/.test(shkRaw) && /qp\.has\(id\)/.test(read('sedori/assets/market.js')), true, '「この例を計算機で開く」で同じ数字が入る');
eq(['shiki', 'rei', 'route', 'tejun', 'risk', 'okane', 'soft'].map(id => shkRaw.includes('id="' + id + '"')), Array(7).fill(true), '仕組みのページの7つの段');

// D4
const chg = text(read('sedori/chigai/index.html'));
eq((read('sedori/chigai/index.html').match(/<span class="no">\d<\/span>/g) || []).length, 9, '確かめたいこと9項目');
const BAD = /誰でも|元手ゼロ|必ず儲|確実に稼|月\d+万円|再現性|ノーリスク|盛るだけ|詐欺|後出し/;
eq([BAD.test(chg), BAD.test(shk), BAD.test(top)], [false, false, false], '利益を約束する言い方・相手をおとしめる言い方をしない');
eq(/31日目からは返金はなく、期間の終わりまで使えて、次の更新はされません/.test(chg), true, '違いのページの返金の行が決定どおり');

// D5
const aiSrc = read('sedori/assets/ai.js');
const stubEl = { appendChild() {}, addEventListener() {} };
const sandbox = { window: { ZW_CONFIG: win.ZW_CONFIG, SedoriUI: { $: () => null, $$: () => [], esc: s => s, store: { get: (k, d) => d, set() {} } }, addEventListener() {} },
  document: { readyState: 'complete', body: { getAttribute: () => null }, createElement: () => stubEl, addEventListener() {} }, location: { hash: '' }, setTimeout };
sandbox.window.window = sandbox.window;
vm.runInNewContext(aiSrc, Object.assign(sandbox, { window: sandbox.window }));
const AI = sandbox.window.SedoriAI;
eq(JSON.parse(JSON.stringify(AI.KINDS.map(k => k.label))), ['仕入れの判断', '売値の相談', '売れ残り対策', 'トラブルの返信', '月の振り返り', '確定申告の一般論'], '相談の型6つ');
const m = AI.master('go');
eq(['light_month', 'total_month', 'business_month', 'light_year', 'total_year', 'business_year'].map(k => m.includes(CAT[k].price.toLocaleString('ja-JP') + '円')), Array(6).fill(true), '前提の文の料金が config と同じ');
eq([/税理士か税務署/.test(m), /弁護士などの専門家/.test(m), /断定したり保証したりしない/.test(m), /30日以内の解約は全額返金/.test(m)], [true, true, true, true], '前提の文の答え方の決まり');
eq([/AIの回答は参考です/.test(aiSrc), /税理士・税務署や弁護士などの専門家/.test(aiSrc)], [true, true], 'パネルの注意書き');
eq([/\^\(k-\|mz-key/.test(aiSrc), /#party/.test(aiSrc)], [true, true], 'APIキーと取引相手の情報は相談文に入れない');
eq(/fetch\(|XMLHttpRequest|sendBeacon/.test(aiSrc), false, 'AIに相談はどこにも送信しない(コピーだけ)');
const pagesWithAi = ['sedori/index.html', 'sedori/yahuoku-mercari/index.html', 'sedori/rakuten-amazon/index.html', 'sedori/daicho/index.html', 'sedori/shikumi/index.html'];
eq(pagesWithAi.map(p => /assets\/ai\.js/.test(read(p)) && /data-ai-open/.test(read(p))), Array(5).fill(true), '各ページから「AIに相談」を開ける');

// 年払いの返金(31日目から)
const terms = text(read('sedori/terms/index.html')), toku = text(read('tokushoho.html'));
eq([/月割り・日割りの返金はなく、解約は次回の自動更新を止める/.test(terms), /月割り・日割りの返金はなく、解約は次回の自動更新の停止として扱い/.test(toku), /次回の自動更新を止める扱い/.test(read('sedori/assets/plans.js'))], [true, true, true], '31日目からの解約は返金なし・次の更新の停止');

console.log('OK ' + n + '件');
