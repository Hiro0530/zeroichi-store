// 有料の画面のプログラムを「包み」にする(2026-11-17 21:50 の決定「有料機能の部品の元を公開の置き場に残さない」)。
// 使い方: node tools/sedori/pack_paid.mjs <部品の元のフォルダ> [公開の鍵のファイル] [書き出す先]
//   部品の元のフォルダ … 非公開の arbitrage-scout の sedori_paid/(<名前>.js と、段を決める tiers.json {"<名前>.js":"total"})
//   公開の鍵のファイル … 既定 backend/sedori/worker/paid_pub.json(make_key_pair.mjs --paid で作った公開の部分。公開してよい)
//   書き出す先       … 既定 backend/sedori/worker/src/paid_bundle.js(公開のリポジトリ。中身は暗号の文字だけ)
// 開く鍵(秘密の部分)はここでは使わない。Worker の秘密の値 PAID_JS_KEY にだけある。
// 部品ごとに新しい AES-256-GCM の鍵で暗号にし、その鍵を RSA-OAEP の公開の鍵で包む。
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const b64u = b => Buffer.from(b).toString('base64url');
export async function packItem(pubJwk, text, tier) {
  const pub = await crypto.subtle.importKey('jwk', pubJwk, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  const raw = crypto.getRandomValues(new Uint8Array(32)), iv = crypto.getRandomValues(new Uint8Array(12));
  const aes = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt']);
  const d = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, new TextEncoder().encode(text));
  const k = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pub, raw);
  return { t: tier || 'light', k: b64u(k), iv: b64u(iv), d: b64u(d) };
}
export async function packDir(dir, pubJwk) {
  const tiers = existsSync(join(dir, 'tiers.json')) ? JSON.parse(readFileSync(join(dir, 'tiers.json'), 'utf8')) : {};
  const items = {};
  for (const f of readdirSync(dir).filter(f => /^[a-z0-9-]{1,40}\.js$/.test(f)).sort()) items[f] = await packItem(pubJwk, readFileSync(join(dir, f), 'utf8'), tiers[f]);
  return { v: 1, items };
}
export function bundleSource(b) {
  return '// 有料の画面のプログラムの包み(暗号の文字だけ)。tools/sedori/pack_paid.mjs が書く。手で直さない。\n' +
    '// 元は非公開の arbitrage-scout の sedori_paid/。開く鍵(PAID_JS_KEY)は Cloudflare の秘密の値だけにある。\n' +
    'export default ' + JSON.stringify(b) + ';\n';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const here = dirname(fileURLToPath(import.meta.url)), repo = join(here, '../..');
  const dir = process.argv[2];
  if (!dir) { console.error('部品の元のフォルダを指定してください'); process.exit(1); }
  const pubFile = process.argv[3] || join(repo, 'backend/sedori/worker/paid_pub.json');
  const out = process.argv[4] || join(repo, 'backend/sedori/worker/src/paid_bundle.js');
  if (!existsSync(pubFile)) { console.error('公開の鍵のファイルがありません: ' + pubFile + '(make_key_pair.mjs --paid で作る)'); process.exit(1); }
  const b = await packDir(dir, JSON.parse(readFileSync(pubFile, 'utf8')));
  writeFileSync(out, bundleSource(b));
  console.log('包みを書きました: ' + Object.keys(b.items).join(', ') + ' → ' + out);
}
