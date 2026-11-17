// 利用の鍵: 証明の署名の鍵の組を作る(本番に切り替える時に1回だけ)。
// 使い方: node tools/sedori/make_key_pair.mjs <秘密の部分を書くファイル>
//   - 秘密の部分(d を含む JWK)はファイルにだけ書き、画面には出さない。続けて
//       npx wrangler secret put KEY_SIGNING_JWK < <そのファイル>
//     で Worker に入れ、ファイルは消す(リポジトリ・チャット・Issue に置かない)。
//   - 画面に出すのは公開の部分だけ。sedori/assets/config.js の KEY_PUBLIC_JWK に貼る(公開してよい値)。
import { writeFileSync, chmodSync } from 'node:fs';
const out = process.argv[2];
if (!out) { console.error('書き出すファイルを指定してください'); process.exit(1); }
const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const pr = await crypto.subtle.exportKey('jwk', k.privateKey), pu = await crypto.subtle.exportKey('jwk', k.publicKey);
writeFileSync(out, JSON.stringify({ kty: pr.kty, crv: pr.crv, x: pr.x, y: pr.y, d: pr.d }), { mode: 0o600 });
chmodSync(out, 0o600);
console.log('秘密の部分を ' + out + ' に書きました(画面には出していません)。');
console.log('config.js の KEY_PUBLIC_JWK に貼る公開の部分:');
console.log(JSON.stringify({ kty: pu.kty, crv: pu.crv, x: pu.x, y: pu.y }));
