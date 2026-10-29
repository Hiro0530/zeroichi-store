// お支払いまわりの画面と法務ページの検算(書き出したHTMLの中を読む)。実行: node tests/sedori/test_billing_pages.js [公開フォルダ]
// - 料金ページ: 主は「カードで申し込む(Apple Pay・Google Pay も可)」、その下に小さく「PayPalで払う」。押すまでの手数を増やさない
// - 特商法・利用規約・プライバシーポリシー: 支払い方法にカード(Stripe)と PayPal、決済代行への提供
// - Stripe で扱うページに、賭け事(競艇など)の内容を載せない(Stripe の禁止業種)。本名・住所を出さない
const path = require('path'), fs = require('fs'), assert = require('assert');
const root = process.argv[2] || path.join(__dirname, '../../../kt-zs-sedori-ghp');
const SD = require('./_dir')(root);  // 準備中の間はテスト用の写しを読む
const read = p => fs.readFileSync(path.join(root, p.replace(/^sedori\//, SD + '/')), 'utf8');
let n = 0;
function eq(a, b, msg) { assert.deepStrictEqual(a, b, `${msg}: 実際 ${JSON.stringify(a)} / 期待 ${JSON.stringify(b)}`); n++; }
const text = h => h.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ');

const plans = read('sedori/plans/index.html');
const buy = plans.slice(plans.indexOf('id="pl-buy"'), plans.indexOf('id="pl-has"'));
eq(/<button[^>]*id="pl-card"[^>]*>[\s\S]*カードで申し込む[\s\S]*Apple Pay・Google Pay も可/.test(buy), true, '主のボタンは「カードで申し込む(Apple Pay・Google Pay も可)」');
eq(buy.indexOf('id="pl-card"') < buy.indexOf('PayPalで払う'), true, 'PayPal はカードの下');
eq(/class="lnk"[^>]*id="pl-pp-open"/.test(buy), true, 'PayPal は小さな文字のボタン');
eq(/id="pl-card"[^>]*disabled/.test(buy), true, 'カードのボタンは価格IDを確かめるまで押せない(準備中で壊れない)');
eq(/id="pl-card-prep"[^>]*hidden[^>]*>[\s\S]*準備中/.test(buy), true, '準備中の表示がある');
const conf = text(plans.slice(plans.indexOf('class="cf"'), plans.indexOf('id="pl-pay"')));
eq([/クレジットカード/.test(conf), /Stripe/.test(conf), /PayPal/.test(conf), /Apple Pay/.test(conf)], [true, true, true, true], '確認の欄の支払いの方法');

const toku = read('tokushoho.html');
const tokuPay = text(toku.slice(toku.indexOf('<th>お支払い方法</th>'), toku.indexOf('<th>お支払い時期</th>')));
eq([/せどり 利益チェック[^。]*クレジットカード\(Stripe/.test(tokuPay), /PayPal/.test(tokuPay)], [true, true], '特商法: 支払方法にカード(Stripe)と PayPal');
eq(/ご請求があれば遅滞なく開示します/.test(toku), true, '特商法: 氏名・住所は請求で開示の方針のまま');
const privacy = text(read('sedori/privacy/index.html')), terms = text(read('sedori/terms/index.html'));
eq([/決済代行会社への提供/.test(privacy), /Stripe, Inc\./.test(privacy), /Stripe Payments Japan/.test(privacy), /PayPal Pte\. Ltd\./.test(privacy), /外国にある第三者/.test(privacy)], [true, true, true, true, true], 'プライバシーポリシー: 決済代行への提供と外国の事業者');
eq([/Stripe/.test(terms), /PayPal/.test(terms), /1回目のお支払いが済んだ方が200名/.test(terms)], [true, true, true], '利用規約: 支払いの方法と先着の数え方');

// Stripe で扱うページ(せどりの全ページと特商法・規約)に、賭け事の言葉を出さない
const BET = /競艇|ボートレース|舟券|競馬|競輪|オートレース|パチンコ|パチスロ|賭け|ギャンブル|kyotei/i;
const pages = [];
(function walk(d) { for (const f of fs.readdirSync(path.join(root, d))) { const p = path.join(d, f), st = fs.statSync(path.join(root, p)); if (st.isDirectory()) walk(p); else if (/\.html$/.test(f)) pages.push(p); } })(SD);
const bad = pages.filter(p => BET.test(text(read(p))));
eq(bad, [], 'せどりのページに賭け事の内容が無い');
const tokuSedori = toku.split('<br>').filter(x => /せどり/.test(x)).join('');
eq(BET.test(text(tokuSedori)), false, '特商法のせどりの行に賭け事の内容が無い');
// 住所を公開ページに出さない(氏名・所在地・電話は「ご請求があれば遅滞なく開示します」)
const row = th => text((toku.match(new RegExp('<th>' + th.replace(/[()]/g, '\\$&') + '</th><td>([\\s\\S]*?)</td>')) || [, ''])[1]).trim();
eq([row('事業者の氏名(運営責任者)'), row('所在地')], ['ご請求があれば遅滞なく開示します。', 'ご請求があれば遅滞なく開示します。'], '氏名・所在地は請求で開示');
eq(/〒\s?\d{3}-?\d{4}/.test(toku + privacy + terms), false, '郵便番号つきの住所を出さない');

// 年払い(2026-10-30 決定): 無料期間なし・その場で決済、1回目のお支払いから30日以内の解約は全額返金。
// Worker・設定・料金ページ(最終確認)・利用規約・特商法・紹介ページが同じ文。「一生」とは書かず「解約しない限りずっと(サービス提供中)」
{
  const cfgSrc = read('sedori/assets/config.js');
  const cfgYear = (cfgSrc.match(/YEAR_TEXT:\s*"([^"]+)"/) || [])[1];
  const keep = (cfgSrc.match(/FOUNDER_KEEP:\s*"([^"]+)"/) || [])[1];
  const worker = fs.readFileSync(path.join(__dirname, '../../backend/sedori/worker/src/index.js'), 'utf8');
  const wYear = (worker.match(/export const YEAR_TEXT = '([^']+)'/) || [])[1];
  eq([!!cfgYear, cfgYear === wYear, keep], [true, true, '解約しない限りずっと(サービス提供中)'], '設定と Worker の年払いの文が同じ');
  const lp = read('sedori/lp/index.html'), top = read('sedori/index.html');
  eq([text(terms).includes(cfgYear), text(toku).includes(cfgYear), text(lp).includes(cfgYear)], [true, true, true], '利用規約・特商法・紹介ページに同じ文');
  eq([/id="cf-refund"/.test(plans), /id="cf-limit"/.test(plans), /cfg\.YEAR_TEXT/.test(read('sedori/assets/plans.js')), /1回目のお支払いから30日以内の解約は全額返金/.test(text(plans))], [true, true, true, true], '料金ページの最終確認: 返金と解約の期限を年払いで書き換える');
  eq(/cfg\.PAYPAL_YEAR === true/.test(read('sedori/assets/plans.js')) && /PAYPAL_YEAR:\s*false/.test(cfgSrc), true, '年払いは PayPal(無料期間つきのプラン)を出さない');
  eq(/年払いは当面クレジットカードのみ/.test(text(toku)), true, '特商法: 年払いの支払い方法');
  eq([/月払いは14日無料/.test(text(top)), /どれも14日無料/.test(text(top) + text(plans) + text(lp))], [true, false], '「どれも14日無料」と書かない(年払いは無料期間なし)');
  const all = pages.map(p => text(read(p))).join('') + text(toku);
  eq([/一生/.test(all), /続けている間ずっと/.test(all)], [false, false], '「一生」「続けている間ずっと」を使わない');
  eq([text(plans).includes(keep), text(terms).includes(keep), text(lp).includes(keep), text(toku).includes(keep)], [true, true, true, true], '先着200名の続く期間は同じ言い方');
  eq([/対象外/.test(text(terms)), /やめる日より後の分は、日割りで返金/.test(text(terms))], [true, true], '規約: 返金の対象外と、サービスをやめる時の返金');
  const my = read('sedori/assets/mypage.js');
  eq([/refundUntil/.test(my), /全額を返金しました/.test(my), /30日以内の全額返金の対象外/.test(my)], [true, true, true], 'マイページ: 返金の期限・解約の確認・年払いへの変更の注意');
}

console.log('OK ' + n + '件');
