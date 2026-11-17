// 利用の鍵: 鍵の組を作る(本番に切り替える時に1回だけ)。
// 使い方
//   node tools/sedori/make_key_pair.mjs <秘密の部分を書くファイル>          … 証明の署名の鍵(ECDSA P-256)
//   node tools/sedori/make_key_pair.mjs --paid <秘密の部分を書くファイル>   … 有料の画面のプログラムの包みを開く鍵(RSA-OAEP 3072)
//   - 秘密の部分はファイルにだけ書き、画面には出さない。続けて
//       npx wrangler secret put KEY_SIGNING_JWK < <そのファイル>   (署名の鍵)
//       npx wrangler secret put PAID_JS_KEY < <そのファイル>       (包みを開く鍵)
//     で Worker に入れ、ファイルは消す(リポジトリ・チャット・Issue に置かない)。
//   - 画面に出すのは公開の部分だけ。署名の鍵は sedori/assets/config.js の KEY_PUBLIC_JWK に、
//     包みの鍵は backend/sedori/worker/paid_pub.json に置く(どちらも公開してよい値)。
import { writeFileSync, chmodSync } from 'node:fs';
const paid = process.argv[2] === '--paid';
const out = process.argv[paid ? 3 : 2];
if (!out) { console.error('書き出すファイルを指定してください'); process.exit(1); }
let pr, pu;
if (paid) {
  const k = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt']);
  pr = await crypto.subtle.exportKey('jwk', k.privateKey); pu = await crypto.subtle.exportKey('jwk', k.publicKey);
  writeFileSync(out, JSON.stringify(pr), { mode: 0o600 });
  pu = { kty: pu.kty, n: pu.n, e: pu.e, alg: pu.alg };
} else {
  const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  pr = await crypto.subtle.exportKey('jwk', k.privateKey); pu = await crypto.subtle.exportKey('jwk', k.publicKey);
  writeFileSync(out, JSON.stringify({ kty: pr.kty, crv: pr.crv, x: pr.x, y: pr.y, d: pr.d }), { mode: 0o600 });
  pu = { kty: pu.kty, crv: pu.crv, x: pu.x, y: pu.y };
}
chmodSync(out, 0o600);
console.log('秘密の部分を ' + out + ' に書きました(画面には出していません)。');
console.log(paid ? 'backend/sedori/worker/paid_pub.json に置く公開の部分:' : 'config.js の KEY_PUBLIC_JWK に貼る公開の部分:');
console.log(JSON.stringify(pu));
