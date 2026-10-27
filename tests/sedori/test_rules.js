// Firestore のルールと、帳簿の同期(books-sync.js)の種類・プランがそろっているかの検算(ルールの文の中を読む)。
// 実行: node tests/sedori/test_rules.js [公開フォルダ]
const path = require('path'), fs = require('fs'), assert = require('assert');
const root = process.argv[2] || path.join(__dirname, '../../../kt-zs-sedori-ghp');
const BS = require(path.join(root, 'sedori/assets/books-sync.js'));
const rules = fs.readFileSync(path.join(__dirname, '../../backend/sedori/firestore.rules'), 'utf8');
let n = 0;
function eq(a, b, msg) { assert.deepStrictEqual(a, b, `${msg}: 実際 ${JSON.stringify(a)} / 期待 ${JSON.stringify(b)}`); n++; }
const list = re => (rules.match(re) || [, ''])[1].split(',').map(s => s.trim().replace(/'/g, '')).filter(Boolean).sort();
const total = list(/kind in \[([^\]]*)\] && totalTier/), biz = list(/kind in \[([^\]]*)\] && businessTier/);
eq(total, BS.KIND_NAMES.filter(k => BS.KINDS[k].tier === 'total').sort(), '総合以上で書ける種類');
eq(biz, BS.KIND_NAMES.filter(k => BS.KINDS[k].tier === 'business').sort(), '業務で書ける種類');
eq(/match \/books\/\{docId\}/.test(rules), true, '帳簿の文書の場所');
eq(/docId\.split\('~'\)\[0\] == request\.resource\.data\.kind/.test(rules), true, '文書の名前の先頭が種類');
eq(BS.SEP, '~', '区切りの文字');
eq(/hasOnly\(\['kind', 'row', 'updatedAt', 'deleted', 'serverAt'\]\)/.test(rules), true, '書ける項目');
eq(/planKey\(uid\)\.matches\('light\.\*'\)/.test(rules) && /planKey\(uid\)\.matches\('business\.\*'\)/.test(rules), true, 'プランは planKey の先頭で見る(sync.js の tierOf と同じ)');
console.log('OK ' + n + '件');
