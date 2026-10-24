import * as Rd from "./reading.js";
import * as U from "./ui.js";
const { E } = Rd;
const $ = (id) => document.getElementById(id);
const day = Rd.today();
const sky = Rd.sky(day);

// 夜空
U.stars($("dots"), day.y * 400 + day.m * 31 + day.d);
$("moon").innerHTML = U.moonSVG(sky.elong, { size: 240, label: `今日の月: ${sky.phase}` });
$("tate").innerHTML = `<b>${U.kanji(day.m)}月${U.kanji(day.d)}日</b> ${E.WEEK[day.w]}曜日`;
let line = `今日の月は${E.SIGNS[sky.moonSign].name}にいます。`;
const ing = sky.ingress;
if (ing) line = `今日の月は${E.SIGNS[ing.from].name}から${E.SIGNS[ing.to].name}へ。${ing.h}時${ing.mi}分ごろに移ります。`;
const noon = E.jstNoon(day.y, day.m, day.d);
const nx = [E.findPhase(noon - 43200000, 0), E.findPhase(noon - 43200000, 180)].filter(Boolean).sort((a, b) => a - b)[0];
const np = E.jstParts(nx), nk = Math.abs(E.elongAt(nx) - 180) < 5 ? "満月" : "新月";
const when = np.m === day.m && np.d === day.d ? `今日の${np.h}時ごろ` : `${np.m}月${np.d}日の${np.h}時ごろ`;
$("skyline").innerHTML = `${line}${sky.phase === "満月" || sky.phase === "新月" ? "" : `いまは${sky.phase}です。`}<span class="dim">次の${nk}は${when}。</span>`;

// 入力
const b0 = U.loadBirth();
U.fillSelects($("by"), $("bm"), $("bd"), b0);
$("ask").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const b = U.readSelects($("by"), $("bm"), $("bd"));
  if (b.err) { $("askErr").textContent = b.err; return; }
  $("askErr").textContent = "";
  U.saveBirth(b);
  show(b, true);
});
$("chg").addEventListener("click", () => {
  $("ask").classList.remove("hide");
  $("ask").scrollIntoView({ behavior: "smooth", block: "center" });
  $("by").focus();
});

let current = null;
function show(b, scroll) {
  const r = Rd.daily(b, day);
  const pr = Rd.profile(b);
  current = r;
  $("letter").innerHTML = `
    <p class="who">${day.m}月${day.d}日(${E.WEEK[day.w]}) ・ ${r.sign.name} ・ 数${pr.lp}</p>
    <h3>今日は「${r.pdTitle}」</h3>
    <div class="overall">${U.meter(r.overall, "総合")}<span>月は「${r.houseName}」に</span></div>
    <div class="body"><p>${r.main}</p><p>${r.numText}</p></div>
    <p class="phase">${r.phaseLine}</p>
    <ul class="cats">${r.cats.map((c) => `<li><span class="k">${c.label}</span>${U.meter(c.score, c.label)}<span class="t">${c.text}</span></li>`).join("")}</ul>
    <div class="todo"><b>今日やってみること</b><span>${r.action}</span></div>
    <div class="lucky"><span><i class="sw" style="background:${r.color.hex}"></i>ラッキーカラー ${r.color.name}</span><span>ラッキーアイテム ${r.item}</span></div>
    <p class="closing">${r.closing}</p>`;
  $("prof").innerHTML = `<summary>あなたの星と数(${r.sign.name} ・ ライフパスナンバー${pr.lp})</summary>
    <h4>${r.sign.name} ― ${pr.sp.word}</h4><p>${pr.sp.text}</p><p>${pr.sp.love}</p>
    <h4>数${pr.lp} ― ${pr.lpt.word}</h4><p>${pr.lpt.text}</p>
    <p><a href="seiza/${r.sign.key}/">${r.sign.name}のページ</a> ・ <a href="tanjobi/${String(b.m).padStart(2, "0")}${String(b.d).padStart(2, "0")}/">${b.m}月${b.d}日生まれのページ</a> ・ <a href="kazu/${pr.lp}/">数${pr.lp}のページ</a></p>`;
  $("you").classList.remove("hide");
  $("ask").classList.add("hide");
  const txt = `${day.m}月${day.d}日の${r.sign.name}のわたしは「${r.pdTitle}」。${r.closing}`;
  $("shareX").href = `https://twitter.com/intent/tweet?text=${encodeURIComponent(txt + "\n#ほしよみ日和 #今日の運勢")}&url=${encodeURIComponent(U.SITE)}`;
  $("shareLine").href = `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(U.SITE)}&text=${encodeURIComponent(txt)}`;
  if (scroll) $("you").scrollIntoView({ behavior: "smooth", block: "start" });
}
if (b0) show(b0, false);

$("shareImg").addEventListener("click", async () => {
  if (!current) return;
  const btn = $("shareImg"); btn.disabled = true; btn.textContent = "画像を作っています…";
  try {
    const blob = await U.shareCard(current);
    const file = new File([blob], `hoshiyomi-${day.m}${day.d}.png`, { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: "ほしよみ日和", text: `#ほしよみ日和 ${U.SITE}` });
    } else {
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }
  } catch (e) { /* 共有を閉じた場合など */ }
  btn.disabled = false; btn.textContent = "画像で保存・シェア";
});

// ランキング
$("rankTitle").textContent = `${day.m}月${day.d}日の12星座ランキング`;
$("rankList").innerHTML = Rd.ranking(day).map((x) => `<li><span class="n">${x.rank}</span><a href="seiza/${x.sign.key}/">${x.sign.name}<span class="why">${x.line}</span></a><span class="h">月は${Rd.D.HOUSE[x.house].short}の場所</span></li>`).join("");

// 星座・誕生日
$("grid12").innerHTML = E.SIGNS.map((s, i) => `<a href="seiza/${s.key}/">${s.name}<small>${E.SIGN_RANGES[i]}</small></a>`).join("");
$("months").innerHTML = Array.from({ length: 12 }, (_, i) => `<a href="tanjobi/#m${i + 1}">${i + 1}月</a>`).join("");

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
