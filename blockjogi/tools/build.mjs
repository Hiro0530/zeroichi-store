// 直径別「円の作り方」ページ(5〜64)と一覧、sitemap を作る
// 使い方: node blockjogi/tools/build.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as S from "../shapes.js";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://hiro0530.github.io/zeroichi-store/blockjogi/";
const write = (rel, s) => { const f = path.join(ROOT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };

function svg(g) {
  const h = g.length, w = g[0].length, cs = Math.max(6, Math.min(18, Math.floor(560 / w)));
  let r = "";
  g.forEach((row, j) => row.forEach((v, i) => { if (v) r += `<rect x="${i * cs + 1}" y="${j * cs + 1}" width="${cs - 1}" height="${cs - 1}"/>`; }));
  let grid = "";
  for (let i = 0; i <= w; i++) grid += `<line x1="${i * cs + .5}" y1="0" x2="${i * cs + .5}" y2="${h * cs}"/>`;
  for (let j = 0; j <= h; j++) grid += `<line x1="0" y1="${j * cs + .5}" x2="${w * cs}" y2="${j * cs + .5}"/>`;
  return `<svg viewBox="0 0 ${w * cs + 1} ${h * cs + 1}" width="${w * cs + 1}" style="max-width:100%;height:auto" role="img" aria-label="直径${w}の円のブロック配置"><g stroke="var(--grid)" stroke-width="1">${grid}</g><g fill="var(--block)">${r}</g></svg>`;
}

function page(rel, title, desc, body, depth) {
  const up = "../".repeat(depth);
  const url = SITE + rel.replace(/index\.html$/, "");
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}|ブロック定規</title>
<meta name="description" content="${desc}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="article">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}og.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#F2B705">
<link rel="icon" href="${up}icon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=BIZ+UDPGothic:wght@400;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${up}style.css">
</head>
<body>
<header class="tape"><div class="wrap"><a class="logo" href="${up}">ブロック定規</a><p>マイクラの円・球・ドームを、数で作る</p></div></header>
<main class="wrap">
${body}
<p style="margin-top:24px"><a class="btn y" href="${up}">ブロック定規を開く</a></p>
</main>
<footer><div class="wrap">
  <nav aria-label="サイト情報"><a href="${up}">ブロック定規</a><a href="${up}en/">直径別 円の作り方一覧</a><a href="${up}../privacy.html">プライバシーポリシー</a></nav>
  <p class="disc">NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.<br>ファンが作った非公式の計算ツールです。Minecraft(マインクラフト)はMojang Synergies ABの商標です。</p>
  <p>運営: ZEROICHI WORKS</p>
</div></footer>
</body>
</html>
`;
}

const urls = ["", "en/"];
const rows = [];
for (let d = 5; d <= 64; d++) {
  const g = S.ellipse(d, d, "line"), gt = S.ellipse(d, d, "thick"), gf = S.ellipse(d, d, "fill");
  const seq = S.steps(g);
  const n = S.count2d(g), nt = S.count2d(gt), nf = S.count2d(gf);
  const sp = S.sphere(d), ns = S.count3d(sp), dm = S.dome(d), nd = S.count3d(dm);
  rows.push(`<tr><td><a href="${d}/">直径${d}</a></td><td>${seq.join("-")}</td><td>${n}</td></tr>`);
  const rel = `en/${d}/index.html`;
  const body = `<p class="lead" style="margin-top:14px"><a href="../">直径別一覧</a> › 直径${d}</p>
<h1>マイクラで直径${d}の円を作る(ブロック${n}個)</h1>
<p>直径${d}マスの円は、いちばん上から時計回りに <b>${seq.join(" → ")}</b> の順でまっすぐ並べると、4分の1周ができます。残りの3か所も同じ並びをくり返せば1周です。${d % 2 ? "直径が奇数なので、中心は1×1マスです。" : "直径が偶数なので、中心は2×2マスです。"}</p>
<div class="board" style="padding:10px;text-align:center">${svg(g)}</div>
<div class="facts">
  <div><small>外枠(細)のブロック</small><b>${n}個</b><small>${S.stackText(n)}</small></div>
  <div><small>外枠(太)のブロック</small><b>${nt}個</b><small>${S.stackText(nt)}</small></div>
  <div><small>中まで埋めた円</small><b>${nf.toLocaleString()}個</b><small>${S.stackText(nf)}</small></div>
  <div><small>同じ直径の球(中は空洞)</small><b>${ns.toLocaleString()}個</b><small>${S.stackText(ns)} ・ ${sp.filter((x) => !S.isEmpty(x)).length}段</small></div>
  <div><small>同じ直径のドーム</small><b>${nd.toLocaleString()}個</b><small>${S.stackText(nd)} ・ ${dm.filter((x) => !S.isEmpty(x)).length}段</small></div>
  <div><small>高さ10段の塔にすると</small><b>${(n * 10).toLocaleString()}個</b><small>${S.stackText(n * 10)}</small></div>
</div>
<h2 style="margin-top:24px">作るときのコツ</h2>
<p>最初に中心から東西南北へ${Math.floor(d / 2)}マスずつ数えて、4つの端に目印を置くと、ずれにくくなります。そこから上の並びの数を見ながら、1段ずつ斜めにずらして置いていきます。</p>
<p>球やドームを1段ずつ作るとき、終わった段を記録しながら進めたいときは、<a href="../../?s=sphere&a=${d}">ブロック定規で直径${d}の球を開く</a>と便利です。</p>
<p><a href="../../?s=circle&a=${d}">直径${d}の円をブロック定規で開く(拡大・外枠の太さの切りかえ)</a></p>
<p>${d > 5 ? `<a href="../${d - 1}/">直径${d - 1}</a> ・ ` : ""}<a href="../">一覧</a>${d < 64 ? ` ・ <a href="../${d + 1}/">直径${d + 1}</a>` : ""}</p>`;
  write(rel, page(rel, `直径${d}の円の作り方(マイクラ)`, `マイクラで直径${d}の円を作る並び方は ${seq.join("-")}。外枠${n}個(${S.stackText(n)})、同じ直径の球なら${ns}個。図と数で1段ずつ。`, body, 2));
  urls.push(`en/${d}/`);
}
write("en/index.html", page("en/index.html", "マイクラの円の作り方 直径別一覧(5〜64)", "マイクラできれいな円を作るための並び方を、直径5から64まで一覧に。上の辺から右回りに、まっすぐ並ぶ個数とブロック数。", `<h1>マイクラの円の作り方 直径別一覧</h1><p>並び方は、円のいちばん上から時計回りに「まっすぐ並ぶ個数」です。4分の1周ぶんを、4回くり返すと1周になります。</p><div style="overflow-x:auto"><table class="list"><thead><tr><th>直径</th><th>並び方(4分の1周)</th><th>外枠のブロック数</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>`, 1));
write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${SITE}${u}</loc></url>`).join("\n")}\n</urlset>\n`);
console.log("built", urls.length);
