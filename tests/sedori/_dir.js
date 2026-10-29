// テストが読むせどりのフォルダの名前(公開フォルダの中)。tools/sedori/build_pages.py の out_dir() と同じ決め方。
// 1) 環境変数 SEDORI_OUT があればそれ 2) sedori/MAINTENANCE.txt がある間(準備中)は、そこに書いてあるテスト用の写し 3) それ以外は sedori
const path = require('path'), fs = require('fs');
module.exports = function sedoriDir(root) {
  if (process.env.SEDORI_OUT) return process.env.SEDORI_OUT.replace(/^\/+|\/+$/g, '');
  const m = path.join(root, 'sedori', 'MAINTENANCE.txt');
  if (fs.existsSync(m)) {
    const hit = fs.readFileSync(m, 'utf8').match(/テスト用の写し\s*[:：]\s*\/?([A-Za-z0-9_.-]+)\/?/);
    if (hit) return hit[1];
  }
  return 'sedori';
};
