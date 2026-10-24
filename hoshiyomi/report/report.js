import * as Rd from "../reading.js";
import * as U from "../ui.js";
const { E } = Rd;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const W = E.WEEK;
const dstr = (M, x) => `${M}月${x.d}日(${W[x.w]})`;

const q = new URLSearchParams(location.search);
let kind = q.get("p") === "compat" ? "compat" : "annual";
const buyKind = q.get("p") === "set" ? "set" : null;

// 入力欄
const b0 = U.loadBirth();
U.fillSelects($("ay"), $("am"), $("ad"), b0);
U.fillSelects($("cy1"), $("cm1"), $("cd1"), b0);
U.fillSelects($("cy2"), $("cm2"), $("cd2"), null);

function setTab(k) {
  kind = k;
  $("tabA").setAttribute("aria-selected", k === "annual"); $("tabC").setAttribute("aria-selected", k === "compat");
  $("formA").classList.toggle("hide", k !== "annual"); $("formC").classList.toggle("hide", k !== "compat");
  $("out").innerHTML = ""; $("buy").classList.add("hide");
  history.replaceState(null, "", `?p=${buyKind || k}`);
  renderIntro();
}
$("tabA").onclick = () => setTab("annual");
$("tabC").onclick = () => setTab("compat");

function renderIntro() {
  const u = U.unlocked();
  const has = kind === "annual" ? u.annual : u.compat;
  $("status").textContent = has ? "この端末では、このレポートの全文が読めます。" : "";
}

// ---------- 年間運勢 ----------
function annualHTML(b, name) {
  const a = Rd.annual(b, 2027);
  const pr = a.pr, t = a.pyt;
  const who = name ? `${esc(name)}さん` : "あなた";
  const ch = [];
  ch.push(`<div class="chap"><p class="k">第1章</p><h2>2027年は「${t.title}」</h2>
    <p>${who}の誕生日(${b.m}月${b.d}日生まれ・${pr.sign.name}・ライフパスナンバー${pr.lp})から数秘術で計算すると、2027年は「${a.py}」の年にあたります。</p>
    <p>${t.all}</p><h3>この一年の合言葉</h3><p>「${t.word}」</p></div>`);
  ch.push(`<div class="chap"><p class="k">第2章</p><h2>恋・仕事・お金</h2>
    <h3>恋愛</h3><p>${t.love}</p><h3>仕事</h3><p>${t.work}</p><h3>お金</h3><p>${t.money}</p>
    <h3>気をつけたいこと</h3><p>${t.care}</p></div>`);
  ch.push(`<div class="chap"><p class="k">第3章</p><h2>星の大きな動き</h2>
    <p>一年単位の流れは、ゆっくり動く星を見ます。広げる星「木星」と、固める星「土星」。${pr.sign.name}のあなたにとって、2027年にそれぞれがどこを通るかです。</p>
    ${a.jupiter.map((j) => `<h3>木星 ${j.when}</h3><p>${j.text}</p>`).join("")}
    <h3>土星 一年を通して</h3><p>${a.saturn.text}</p></div>`);
  const months = a.months.map((m) => `<div class="month"><h3>${m.M}月 ― ${m.pmText.split("。")[0]}</h3>
    <p>${m.pmText.split("。").slice(1).join("。")}</p>
    <ul>
      ${m.moons.map((l) => `<li>${l.kind === "new" ? "新月" : "満月"} ${l.m}月${l.d}日 ${l.h}時ごろ(${E.SIGNS[l.sign].name}):${a.moonHouse[l.kind][l.house]}</li>`).join("")}
      <li>いい日:${m.best.map((x) => dstr(m.M, x)).join("、")}</li>
      <li>恋の日:${m.love.length ? m.love.map((x) => dstr(m.M, x)).join("、") : "今月は日付より、ふだんの会話を大事に"}</li>
      <li>仕事の日:${m.work.map((x) => dstr(m.M, x)).join("、")}</li>
      <li>ひと休みの日:${m.rest.length ? m.rest.map((x) => dstr(m.M, x)).join("、") : "とくになし。自分のペースで"}</li>
    </ul></div>`).join("");
  ch.push(`<div class="chap"><p class="k">第4章</p><h2>月ごとの流れ</h2>
    <p>毎月のテーマは数秘術の「個人月」、日付は毎日の運勢と同じ計算(その日の月の位置と個人日)で、あなたの誕生日から選んでいます。新月は始めること、満月は形になることに向いた日です。</p>${months}</div>`);
  ch.push(`<div class="chap"><p class="k">第5章</p><h2>あなたの星と数</h2>
    <h3>${pr.sign.name} ― ${pr.sp.word}</h3><p>${pr.sp.text}</p><p>${pr.sp.love}</p>
    <h3>ライフパスナンバー${pr.lp} ― ${pr.lpt.word}</h3><p>${pr.lpt.text}</p><p>${pr.lpt.love}</p>
    <h3>おわりに</h3><p>運勢は、天気予報のようなものです。晴れの日は洗濯をして、雨の日は家で本を読む。流れを知っておくと、同じ一年でも過ごし方を選べます。このレポートが、2027年のあなたの手帳の片すみに置いてもらえたらうれしいです。</p></div>`);
  const teaser = `<div class="chap"><p class="k">第4章より 見本</p><h2>月ごとの流れ</h2>${months.split('<div class="month">').slice(0, 2).join('<div class="month">')}</div>`;
  return { teaser, head: `<p class="k">2027年 年間運勢レポート</p><h1>${who}の2027年</h1><p class="note">${b.y}年${b.m}月${b.d}日生まれ ・ ${pr.sign.name} ・ 数${pr.lp} ・ 作成日 ${Rd.today().y}年${Rd.today().m}月${Rd.today().d}日</p>`, ch };
}

// ---------- 相性 ----------
function compatHTML(a, b, n1, n2) {
  const c = Rd.compat(a, b, 2027);
  const A = n1 ? esc(n1) : "あなた", B = n2 ? esc(n2) : "お相手";
  const ch = [];
  ch.push(`<div class="chap"><p class="k">第1章</p><h2>${c.aspect.short}</h2>
    <p><span class="big">${c.score}</span><span class="k"> / 100 ・ 相性の形の目安です。数字の高い低いで、うまくいくかどうかは決まりません。</span></p>
    <p>${A}は${c.pa.sign.name}、${B}は${c.pb.sign.name}。ふたりは「${c.aspect.name}」です。</p><p>${c.aspect.text}</p>
    <h3>うまくいくコツ</h3><p>${c.aspect.tip}</p>
    <h3>長く続けるための3つのこと</h3><ul>${c.keep.map((x) => `<li>${x}</li>`).join("")}</ul></div>`);
  ch.push(`<div class="chap"><p class="k">第2章</p><h2>火・地・風・水のバランス</h2>
    <p>星座は、火・地・風・水の4つの性質に分かれます。${A}は${c.element.a}、${B}は${c.element.b}の星座です。</p><p>${c.element.text}</p></div>`);
  ch.push(`<div class="chap"><p class="k">第3章</p><h2>気持ちのテンポ</h2>
    <p>生まれた日の月の位置は、気持ちの動き方や、安心する形をあらわします。${A}の月は${c.moon.a.name}、${B}の月は${c.moon.b.name}(生まれた時刻が分からないため、正午の位置で計算しています)。</p>
    <p>${c.moon.text}</p></div>`);
  ch.push(`<div class="chap"><p class="k">第4章</p><h2>ふたりの数</h2>
    <p>${A}はライフパスナンバー${c.lp.a}「${c.lp.A.word}」、${B}は${c.lp.b}「${c.lp.B.word}」。${c.lp.text}</p>
    <h3>${A}が恋で求めるもの</h3><p>${c.lp.A.need}。${B}が自然にできるのは、${c.lp.B.give}です。</p>
    <h3>${B}が恋で求めるもの</h3><p>${c.lp.B.need}。${A}が自然にできるのは、${c.lp.A.give}です。</p>
    <h3>すれ違いやすいところ</h3><p>${A}は「${c.lp.A.clash}」、${B}は「${c.lp.B.clash}」になりやすいタイプ。ケンカの種は、たいていこのどちらかです。</p>
    <h3>仲直りの合図</h3><p>${A}からは、${c.lp.A.make}。${B}からは、${c.lp.B.make}。どちらか一方でも、関係はちゃんと戻ってきます。</p></div>`);
  const same = c.year.a === c.year.b;
  ch.push(`<div class="chap"><p class="k">第5章</p><h2>ふたりの2027年</h2>
    <p>${A}にとって2027年は「${c.year.at.title}」、${B}にとっては「${c.year.bt.title}」です。</p>
    <p>${same ? "ふたりは同じ季節を過ごす一年。同じ方向を向きやすいぶん、相手の変化にも気づきやすいはずです。" + c.year.at.love : `${A}は${c.year.at.love.split("。")[0]}。${B}は${c.year.bt.love.split("。")[0]}。季節の違うふたりなので、相手のペースを「今はそういう年なんだ」と受けとめられると、すれ違いが減ります。`}</p>
    <h3>ふたりの合言葉</h3><p>「${c.year.at.word}」と「${c.year.bt.word}」。それぞれの合言葉を、たまに思い出してあげてください。</p></div>`);
  ch.push(`<div class="chap"><p class="k">第6章</p><h2>これから60日の、ふたりの日</h2>
    <p>毎日の運勢と同じ計算(その日の月の位置と、ふたりそれぞれの個人日)で、ふたりとも恋愛の流れが明るい日を選びました。会う約束、大事な話、ちょっとしたサプライズに。</p>
    <ul>${c.dateDays.map((x) => `<li>${x.m}月${x.d}日(${W[x.w]})</li>`).join("")}</ul>
    <p class="k">この日付は、レポートを作った日から60日分です。あとで作り直すと、その日から先の日付に変わります。</p></div>`);
  ch.push(`<div class="chap"><p class="k">第7章</p><h2>相手から見た、あなたの魅力</h2>
    <h3>${B}から見た${A}</h3><p>${c.charmA.charm}</p><p>${A}がしてもらうとうれしいこと:${c.charmA.want}</p>
    <h3>${A}から見た${B}</h3><p>${c.charmB.charm}</p><p>${B}がしてもらうとうれしいこと:${c.charmB.want}</p></div>`);
  ch.push(`<div class="chap"><p class="k">第8章</p><h2>ふたりそれぞれの恋のくせ</h2>
    <h3>${A}(${c.pa.sign.name})</h3><p>${c.pa.sp.love}</p><p>${c.lp.A.love}</p>
    <h3>${B}(${c.pb.sign.name})</h3><p>${c.pb.sp.love}</p><p>${c.lp.B.love}</p>
    <h3>おわりに</h3><p>相性は、ふたりの「形」を知るための地図です。形が分かれば、どこを大事にすればいいかが分かります。点数より、ここに書いたことのどれか一つが、ふたりの会話のきっかけになればうれしいです。</p></div>`);
  return { teaser: ch[2].replace("第3章", "第3章 見本"), head: `<p class="k">ふたりの相性レポート</p><h1>${A}と${B}</h1><p class="note">${a.y}年${a.m}月${a.d}日生まれ × ${b.y}年${b.m}月${b.d}日生まれ</p>`, ch };
}

function render(r, isOpen) {
  const free = r.ch[0];
  const rest = r.ch.slice(1).join("");
  $("out").innerHTML = `<div class="rep">${r.head}</div>${free}${isOpen ? rest : `${r.teaser}<div class="chap"><h2>このあとに読めること</h2><ul>${r.ch.slice(1).map((c) => `<li>${c.match(/<p class="k">(.*?)<\/p><h2>(.*?)<\/h2>/).slice(1).join(" ")}</li>`).join("")}</ul></div><div class="locked" aria-hidden="true">${r.ch[kind === "compat" ? 3 : 1]}</div>`}
    ${isOpen ? `<p class="noprint"><button class="btn main" id="print" type="button">PDFで保存・印刷する</button></p><p class="note noprint">印刷の画面で「PDFに保存」を選ぶと、ファイルとして残せます。</p>` : ""}
    <p class="note">このレポートは娯楽のための読みものです。将来の出来事を保証するものではありません。</p>`;
  if (isOpen) $("print").onclick = () => window.print();
  $("buy").classList.toggle("hide", isOpen);
  if (!isOpen) {
    const k = buyKind || kind;
    const n = r.ch.length - 1;
    $("buyTitle").textContent = `続き(全${r.ch.length}章のうち残り${n}章)を読む`;
    $("buyBtn").innerHTML = U.payButton(k) + (k !== "set" ? ` <a class="btn ghost" href="?p=set">セット(1,500円)にする</a>` : "");
  }
  $("out").scrollIntoView({ behavior: "smooth", block: "start" });
}

function make() {
  const u = U.unlocked();
  if (kind === "annual") {
    const b = U.readSelects($("ay"), $("am"), $("ad"));
    if (b.err) { $("err").textContent = b.err; return; }
    $("err").textContent = ""; U.saveBirth(b);
    render(annualHTML(b, $("aname").value.trim()), !!u.annual);
  } else {
    const a = U.readSelects($("cy1"), $("cm1"), $("cd1"));
    const b = U.readSelects($("cy2"), $("cm2"), $("cd2"));
    if (a.err || b.err) { $("err").textContent = (a.err ? "あなたの" : "お相手の") + "生年月日:" + (a.err || b.err); return; }
    $("err").textContent = "";
    render(compatHTML(a, b, $("n1").value.trim(), $("n2").value.trim()), !!u.compat);
  }
}
$("make").onclick = make;

$("keyGo").onclick = async () => {
  const r = await U.checkKey($("key").value);
  if (!r) { $("keyMsg").textContent = "キーが正しくありません。メールに書かれたキーを、ハイフンも含めてそのまま入れてください。"; return; }
  U.saveUnlock(r);
  const ok = kind === "annual" ? r.annual : r.compat;
  $("keyMsg").textContent = ok ? "登録しました。全文を表示します。" : `登録しました。このキーで読めるのは「${r.annual ? "年間運勢" : "相性"}」です。上のタブを切り替えてください。`;
  renderIntro();
  if (ok) make();
};

setTab(kind);
if (q.get("p") === "set") { $("setNote").classList.remove("hide"); }
