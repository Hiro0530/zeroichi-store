// 静的ページの生成: 星座12・数12・誕生日366(+一覧)・今日の運勢・sitemap
// 使い方: node hoshiyomi/tools/build.mjs [all|today]   (today は毎日0時すぎに自動実行)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as Rd from "../reading.js";
const { E, D, P, T } = Rd;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://hiro0530.github.io/zeroichi-store/hoshiyomi/";
const mode = process.argv[2] || "all";
const pad = (n) => String(n).padStart(2, "0");
const write = (rel, html) => { const f = path.join(ROOT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, html); };

function page({ rel, title, desc, body, depth, crumbs, script = "" }) {
  const up = "../".repeat(depth);
  const url = SITE + rel.replace(/index\.html$/, "");
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}|ほしよみ日和</title>
<meta name="description" content="${desc}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="article">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}og.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#232B5C">
<link rel="icon" href="${up}icon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Shippori+Mincho+B1:wght@400;600;800&family=Zen+Kaku+Gothic+New:wght@400;500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${up}style.css">
<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "ほしよみ日和", item: SITE }, ...crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 2, name: c[0], item: SITE + c[1] }))] })}</script>
</head>
<body>
<header class="top"><div class="wrap">
  <a class="mark" href="${up}">ほしよみ日和</a>
  <nav class="nav" aria-label="メニュー"><a href="${up}">今日の運勢</a><a href="${up}report/?p=compat">相性</a><a href="${up}report/?p=annual">2027年</a></nav>
</div></header>
<main class="wrap">
<p class="crumb"><a href="${up}">ほしよみ日和</a>${crumbs.map((c, i) => i === crumbs.length - 1 ? ` › ${c[0]}` : ` › <a href="${up}${c[1]}">${c[0]}</a>`).join("")}</p>
<article>
${body}
</article>
<section>
  <div class="ask" style="margin:0">
    <h2>誕生日で、あなたの今日を見る</h2>
    <p>星座だけでなく、生まれた年と日から「数」も出して読みます。登録はいりません。</p>
    <a class="btn main wide" href="${up}">今日の運勢を見る</a>
  </div>
</section>
</main>
<footer><div class="wrap">
  <nav aria-label="サイト情報"><a href="${up}../tokushoho.html">特定商取引法に基づく表記</a><a href="${up}../privacy.html">プライバシーポリシー</a><a href="mailto:zeroichi.works.jp@gmail.com">お問い合わせ</a></nav>
  <p>ほしよみ日和は、占いを楽しむための読みものです。内容は娯楽として提供しており、将来の出来事を保証するものではありません。</p>
  <p>運営: ZEROICHI WORKS</p>
</div></footer>
${script}
</body>
</html>
`;
}

const now = Rd.today();
const dayLabel = (d) => `${d.m}月${d.d}日(${E.WEEK[d.w]})`;

// 星座ごとの「今日」(誕生年なしで読める版)
function signToday(i, day) {
  const s = Rd.sky(day);
  const house = E.houseOf(s.moonSign, i);
  const rnd = E.seeded("sign", day.y, day.m, day.d, i);
  const rank = Rd.ranking(day).find((r) => r.idx === i).rank;
  return { house, rank, text: E.pick(D.HOUSE_TEXT[house], rnd), action: E.pick(D.ACTION[house], rnd), phase: D.PHASE_LINE[s.phase], moon: E.SIGNS[s.moonSign].name };
}
const todayBlock = (i, day) => {
  const t = signToday(i, day);
  return `<div class="letter" id="signToday" data-sign="${i}"><p class="who">${dayLabel(day)} ・ 12星座中${t.rank}位</p>
<h3>月は「${D.HOUSE[t.house].name}」に</h3><div class="body"><p>${t.text}</p></div><p class="phase">今日の月は${t.moon}。${t.phase}</p>
<div class="todo"><b>今日やってみること</b><span>${t.action}</span></div></div>`;
};
// 日付が変わっていたら、ブラウザ側で今日の内容に差しかえる
const freshScript = (depth) => `<script type="module">
import * as Rd from "${"../".repeat(depth)}reading.js";
const el = document.getElementById("signToday"); const d = Rd.today();
if (el && el.dataset.day !== \`\${d.y}-\${d.m}-\${d.d}\`) {
  const i = +el.dataset.sign, s = Rd.sky(d), h = Rd.E.houseOf(s.moonSign, i), r = Rd.E.seeded("sign", d.y, d.m, d.d, i);
  const rank = Rd.ranking(d).find((x) => x.idx === i).rank;
  el.innerHTML = \`<p class="who">\${d.m}月\${d.d}日(\${Rd.E.WEEK[d.w]}) ・ 12星座中\${rank}位</p><h3>月は「\${Rd.D.HOUSE[h].name}」に</h3><div class="body"><p>\${Rd.E.pick(Rd.D.HOUSE_TEXT[h], r)}</p></div><p class="phase">今日の月は\${Rd.E.SIGNS[s.moonSign].name}。\${Rd.D.PHASE_LINE[s.phase]}</p><div class="todo"><b>今日やってみること</b><span>\${Rd.E.pick(Rd.D.ACTION[h], r)}</span></div>\`;
}
</script>`;
const stamp = (html, day) => html.replace('id="signToday"', `id="signToday" data-day="${day.y}-${day.m}-${day.d}"`);

const urls = [];

function buildSigns() {
  E.SIGNS.forEach((sg, i) => {
    const sp = P.SIGN_PROFILE[i];
    const st = E.SIGN_RANGES[i];
    const tri = [4, 8].map((k) => E.SIGNS[(i + k) % 12]);
    const sex = [2, 10].map((k) => E.SIGNS[(i + k) % 12]);
    const opp = E.SIGNS[(i + 6) % 12];
    const start = [[3, 21], [4, 20], [5, 21], [6, 22], [7, 23], [8, 23], [9, 23], [10, 24], [11, 23], [12, 22], [1, 20], [2, 19]][i];
    const decs = [0, 10, 20].map((off, k) => { const a = new Date(Date.UTC(2001, start[0] - 1, start[1] + off)); const b = new Date(Date.UTC(2001, start[0] - 1, start[1] + off + (k === 2 ? 0 : 9))); return { a, txt: P.DECAN[i][k], b, k }; });
    const endOf = (k) => k < 2 ? `${decs[k].b.getUTCMonth() + 1}月${decs[k].b.getUTCDate()}日` : st.split("〜")[1];
    const rel = `seiza/${sg.key}/index.html`;
    const body = `<h1>${sg.name}(${sg.kana})の性格と今日の運勢</h1>
<p class="note">${st}生まれ ・ ${sg.el}の星座 ・ ${sg.mode}宮</p>
<h2>${sg.name}の今日</h2>
${todayBlock(i, now)}
<h2>${sg.name}の性格 ― ${sp.word}</h2>
<p class="mincho">${sp.text}</p>
<h2>${sg.name}の恋愛</h2>
<p class="mincho">${sp.love}</p>
<h2>生まれた日で変わる、3つのタイプ</h2>
${decs.map((d) => `<p><b>${d.a.getUTCMonth() + 1}月${d.a.getUTCDate()}日〜${endOf(d.k)}生まれ</b><br>${d.txt}</p>`).join("")}
<h2>${sg.name}と相性のいい星座</h2>
<p>同じ${sg.el}の星座(${tri.map((x) => `<a href="../${x.key}/">${x.name}</a>`).join("・")})とは、無理をしなくても気持ちが通いやすい関係です。${sex.map((x) => `<a href="../${x.key}/">${x.name}</a>`).join("・")}とは、話が自然に続く気安い関係。向かいあわせの<a href="../${opp.key}/">${opp.name}</a>とは、正反対だからこそ強く惹かれあいます。</p>
<p>星座だけでなく、生まれた日の月や数まで重ねて見たいときは、<a href="../../report/?p=compat">ふたりの相性レポート</a>で詳しく読めます(第1章は無料)。</p>
<h2>ほかの星座</h2>
<div class="grid12">${E.SIGNS.map((x, k) => `<a href="../${x.key}/">${x.name}</a>`).join("")}</div>`;
    write(rel, stamp(page({ rel, depth: 2, title: `${sg.name}の性格と今日の運勢`, desc: `${sg.name}(${st}生まれ)の性格・恋愛・相性と、本当の月の位置で読む今日の運勢。毎日0時に更新。`, crumbs: [["星座別", "#signs"], [sg.name, `seiza/${sg.key}/`]], body, script: freshScript(2) }), now));
    urls.push(`seiza/${sg.key}/`);
  });
}

function buildKazu() {
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 22, 33]) {
    const t = P.LP[n];
    const n9 = n > 9 ? E.reduce(n) : n;
    const good = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((m) => T.LP_HARMONY[`${Math.min(n9, m)}-${Math.max(n9, m)}`] === 2);
    const rel = `kazu/${n}/index.html`;
    const body = `<h1>ライフパスナンバー${n}の性格 ― ${t.word}</h1>
<p class="note">数秘術 ・ 生年月日から出す「生まれ持った数」</p>
<p class="mincho">${t.text}</p>
<h2>数${n}の恋愛</h2>
<p class="mincho">${t.love}</p>
<h2>恋のなかの数${n}</h2>
<p><b>求めるもの</b>:${t.need}<br><b>相手にあげられるもの</b>:${t.give}<br><b>すれ違いやすいところ</b>:${t.clash}<br><b>仲直りの合図</b>:${t.make}</p>
<h2>響きあいやすい数</h2>
<p>${good.map((m) => `<a href="../${m}/">${m}「${P.LP[m].word}」</a>`).join("、")}。おたがいの良さを自然に引き出しあえる組み合わせです。</p>
<h2>ライフパスナンバーの出し方</h2>
<p>生年月日の数字を、ひと桁ずつすべて足します。答えが2桁なら、さらに足して1桁にします。途中で11・22・33になったときは、そのまま「マスターナンバー」として読みます。</p>
<p>例: 1993年7月14日 → 1+9+9+3+0+7+1+4=34 → 3+4=<b>7</b></p>
<h2>ほかの数</h2>
<p>${[1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 22, 33].map((m) => m === n ? `<b>${m}</b>` : `<a href="../${m}/">${m}</a>`).join(" ・ ")}</p>`;
    write(rel, page({ rel, depth: 2, title: `ライフパスナンバー${n}の性格と恋愛`, desc: `数秘術のライフパスナンバー${n}「${t.word}」の性格、恋愛の傾向、相性のいい数、計算のしかた。`, crumbs: [["数秘術", "kazu/"], [`数${n}`, `kazu/${n}/`]], body }));
    urls.push(`kazu/${n}/`);
  }
  const rel = "kazu/index.html";
  write(rel, page({ rel, depth: 1, title: "数秘術 ライフパスナンバー一覧", desc: "数秘術のライフパスナンバー1〜9と11・22・33の性格と恋愛の傾向。", crumbs: [["数秘術", "kazu/"]], body: `<h1>数秘術 ライフパスナンバー</h1><p>生年月日の数字をすべて足して出す、生まれ持った数です。</p>${[1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 22, 33].map((m) => `<p><a href="${m}/"><b>${m}</b> ${P.LP[m].word}</a><br>${P.LP[m].text.split("。").slice(1, 2).join("")}。</p>`).join("")}` }));
  urls.push("kazu/");
}

function buildBirthdays() {
  const idx = [];
  for (let m = 1; m <= 12; m++) {
    const days = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
    idx.push(`<h2 id="m${m}">${m}月</h2><p class="months">${Array.from({ length: days }, (_, k) => `<a href="${pad(m)}${pad(k + 1)}/">${k + 1}日</a>`).join("")}</p>`);
    for (let d = 1; d <= days; d++) {
      const i = E.sunSignOf(m, d), sg = E.SIGNS[i], sp = P.SIGN_PROFILE[i];
      const starts = [[3, 21], [4, 20], [5, 21], [6, 22], [7, 23], [8, 23], [9, 23], [10, 24], [11, 23], [12, 22], [1, 20], [2, 19]][i];
      let off = Math.round((Date.UTC(2000, m - 1, d) - Date.UTC(2000, starts[0] - 1, starts[1])) / 86400000);
      if (off < 0) off += 366;
      const dec = Math.min(2, Math.floor(off / 10));
      const years = [];
      for (let y = 1960; y <= 2012; y++) years.push([y, E.lifePath(y, m, d)]);
      const cusp = off <= 1 ? `<p class="note">星座の境目に近い誕生日です。生まれた年や時刻によっては、ひとつ前の星座(${E.SIGNS[(i + 11) % 12].name})の性質も持っています。</p>` : (() => { const n = new Date(Date.UTC(2001, m - 1, d + 1)); return E.sunSignOf(n.getUTCMonth() + 1, n.getUTCDate()) !== i ? `<p class="note">星座の境目に近い誕生日です。生まれた年や時刻によっては、次の星座(${E.SIGNS[(i + 1) % 12].name})の性質も持っています。</p>` : ""; })();
      const rel = `tanjobi/${pad(m)}${pad(d)}/index.html`;
      const prev = new Date(Date.UTC(2000, m - 1, d - 1)), next = new Date(Date.UTC(2000, m - 1, d + 1));
      const lk = (x) => `${pad(x.getUTCMonth() + 1)}${pad(x.getUTCDate())}`;
      const body = `<h1>${m}月${d}日生まれの性格と恋愛</h1>
<p class="note">${sg.name}(${E.SIGN_RANGES[i]}) ・ ${sg.el}の星座</p>
<p class="mincho">${P.BIRTHDAY_NUM[d]}${P.DECAN[i][dec]}</p>
${cusp}
<h2>今日の${m}月${d}日生まれ</h2>
<div class="letter" id="bdToday" data-m="${m}" data-d="${d}"><p class="who">読みこんでいます…</p></div>
<h2>${sg.name}としての${m}月${d}日生まれ</h2>
<p class="mincho">${sp.text}</p>
<h2>恋愛のかたち</h2>
<p class="mincho">${sp.love}</p>
<h2>${m}月${d}日生まれの2027年 ―「${T.PY[E.personalYear(m, d, 2027)].title}」</h2>
<p class="mincho">${T.PY[E.personalYear(m, d, 2027)].all}</p>
<p>月ごとのいい日や恋の日まで知りたいときは、<a href="../../report/?p=annual">2027年 年間運勢レポート</a>へ(第1章は無料)。</p>
<h2>生まれ年で変わる「数」</h2>
<p>数秘術では、同じ${m}月${d}日生まれでも、生まれた年によって「ライフパスナンバー」が変わります。あなたの年を探してみてください。</p>
<div class="tablewrap"><table class="lp"><thead><tr><th>生まれ年</th><th>数</th><th>タイプ</th></tr></thead><tbody>
${years.map(([y, n]) => `<tr><td>${y}年</td><td><a href="../../kazu/${n}/">${n}</a></td><td>${P.LP[n].word}</td></tr>`).join("\n")}
</tbody></table></div>
<p><a href="../${lk(prev)}/">${prev.getUTCMonth() + 1}月${prev.getUTCDate()}日生まれ</a> ・ <a href="../">誕生日の一覧</a> ・ <a href="../${lk(next)}/">${next.getUTCMonth() + 1}月${next.getUTCDate()}日生まれ</a></p>
<p>${sg.name}全体の今日の運勢は<a href="../../seiza/${sg.key}/">${sg.name}のページ</a>へ。</p>`;
      const bdScript = `<script type="module">
import * as Rd from "../../reading.js"; import * as U from "../../ui.js";
const el = document.getElementById("bdToday"); const day = Rd.today();
const r = Rd.daily({ y: 2000, m: +el.dataset.m, d: +el.dataset.d }, day);
el.innerHTML = \`<p class="who">\${day.m}月\${day.d}日(\${Rd.E.WEEK[day.w]}) ・ \${r.sign.name}</p><h3>今日は「\${r.pdTitle}」</h3><div class="overall">\${U.meter(r.overall, "総合")}<span>月は「\${r.houseName}」に</span></div><div class="body"><p>\${r.main}</p><p>\${r.numText}</p></div><div class="todo"><b>今日やってみること</b><span>\${r.action}</span></div><p class="note">生まれた年も入れると、もっとあなたに合わせた運勢になります。</p>\`;
</script>`;
      write(rel, page({ rel, depth: 2, script: bdScript, title: `${m}月${d}日生まれの性格と恋愛`, desc: `${m}月${d}日生まれ(${sg.name})の性格、恋愛の傾向、生まれ年ごとのライフパスナンバー。${P.BIRTHDAY_NUM[d]}`, crumbs: [["誕生日別", "tanjobi/"], [`${m}月${d}日`, `tanjobi/${pad(m)}${pad(d)}/`]], body }));
      urls.push(`tanjobi/${pad(m)}${pad(d)}/`);
    }
  }
  const rel = "tanjobi/index.html";
  write(rel, page({ rel, depth: 1, title: "誕生日別の性格 366日", desc: "1月1日から12月31日まで、366日それぞれの誕生日の性格と恋愛、生まれ年ごとのライフパスナンバー。", crumbs: [["誕生日別", "tanjobi/"]], body: `<h1>誕生日別の性格 366日</h1><p>自分や大切な人の誕生日を選んでください。</p>${idx.join("")}` }));
  urls.push("tanjobi/");
}

function buildToday(day) {
  const rk = Rd.ranking(day);
  const s = Rd.sky(day);
  const rel = "today/index.html";
  const body = `<h1>${day.m}月${day.d}日の12星座ランキング</h1>
<p class="note">${day.y}年${dayLabel(day)} ・ 月は${E.SIGNS[s.moonSign].name} ・ ${s.phase}</p>
<p>${D.PHASE_LINE[s.phase]}</p>
${rk.map((r) => { const t = signToday(r.idx, day); return `<h2>${r.rank}位 ${r.sign.name}</h2><p class="mincho">${t.text}</p><p class="note">今日やってみること: ${t.action} ・ <a href="../seiza/${r.sign.key}/">${r.sign.name}の詳しい運勢</a></p>`; }).join("\n")}
<p class="note">ランキングは星座だけで見た目安です。誕生日を入れると、数秘術も重ねたあなただけの運勢が読めます。</p>`;
  const script = `<script type="module">import * as Rd from "../reading.js"; const d = Rd.today(); if ("${day.y}-${day.m}-${day.d}" !== \`\${d.y}-\${d.m}-\${d.d}\`) { const n = document.createElement("p"); n.className = "note"; n.innerHTML = '日付が変わりました。<a href="../#rank">最新のランキングを見る</a>'; document.querySelector("article").prepend(n); }</script>`;
  write(rel, page({ rel, depth: 1, title: `今日の運勢 ${day.m}月${day.d}日の12星座ランキング`, desc: `${day.m}月${day.d}日の12星座ランキング。本当の月の位置(${E.SIGNS[s.moonSign].name})から読む、星座ごとの今日の流れとやってみること。`, crumbs: [["今日のランキング", "today/"]], body, script }));
  // 投稿用の素材(X・ショート台本の材料)
  write("today/today.json", JSON.stringify({ date: `${day.y}-${pad(day.m)}-${pad(day.d)}`, moon: E.SIGNS[s.moonSign].name, phase: s.phase, ranking: rk.map((r) => ({ rank: r.rank, sign: r.sign.name, line: r.line })) }, null, 1));
}

if (mode === "all") { buildSigns(); buildKazu(); buildBirthdays(); }
else buildSigns(); // today モードでも星座ページの「今日」を更新
buildToday(now);
urls.unshift("", "today/", "report/");
const base = SITE;
if (mode === "all") {
  write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...new Set(urls)].map((u) => `<url><loc>${base}${u}</loc></url>`).join("\n")}\n</urlset>\n`);
}
console.log("built", mode, `${now.y}-${now.m}-${now.d}`, urls.length);
