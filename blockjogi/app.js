import * as S from "./shapes.js";
const $ = (id) => document.getElementById(id);

// 支払いリンク(オーナーが作ったら貼るだけで切りかわる)
const PAY = { name: "ブロック定規 フルパック", price: 300, url: "" };
const MAIL = "zeroichi.works.jp@gmail.com";
const FREE_SAVES = 3;

const SHAPES = {
  circle: { title: "円の設計図", lead: "直径を入れると、ブロックの配置図と、まっすぐ並ぶ個数が出ます。", a: "直径", b: null, d3: false },
  ellipse: { title: "楕円の設計図", lead: "横と縦の長さを決めると、楕円の置き方が出ます。", a: "横", b: "縦", d3: false },
  sphere: { title: "球の設計図", lead: "直径を決めると、下から1段ずつの置き方が出ます。中は空洞です。", a: "直径", b: null, d3: true },
  dome: { title: "ドームの設計図", lead: "球の上半分です。いちばん下の段(いちばん広い段)から上へ1段ずつ。", a: "直径", b: null, d3: true },
  torus: { title: "ドーナツ形の設計図", lead: "外側の直径と、輪の太さを決めます。噴水のふちや、空中のリングに。", a: "外の直径", b: "太さ", d3: true, pro: true },
  cone: { title: "とんがり屋根の設計図", lead: "底の直径と高さを決めると、円すいの屋根を下から1段ずつ。", a: "底の直径", b: "高さ", d3: true, pro: true },
};

const st = { shape: "circle", a: 21, b: 13, mode: "line", layer: 0, zoom: 0 };
let data = null; // {layers:[grid...]} or {grid}

// ---------- 保存まわり ----------
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
const isPro = () => !!ls.get("bj.key", null);
const keyOf = () => `${st.shape}|${st.a}|${SHAPES[st.shape].b ? st.b : ""}|${SHAPES[st.shape].d3 ? "" : st.mode}`;
const doneSet = () => new Set(ls.get("bj.done", {})[keyOf()] || []);
function setDone(i, v) {
  const all = ls.get("bj.done", {}); const s = new Set(all[keyOf()] || []);
  v ? s.add(i) : s.delete(i); all[keyOf()] = [...s]; ls.set("bj.done", all);
}

// ---------- URL ----------
const q = new URLSearchParams(location.search);
if (SHAPES[q.get("s")]) st.shape = q.get("s");
if (+q.get("a")) st.a = +q.get("a");
if (+q.get("b")) st.b = +q.get("b");
if (["line", "thick", "fill"].includes(q.get("m"))) st.mode = q.get("m");
const last = ls.get("bj.last", null);
if (!q.toString() && last) Object.assign(st, last, { zoom: 0 });

// ---------- 計算 ----------
function compute() {
  const sh = SHAPES[st.shape];
  const a = Math.max(3, Math.min(128, st.a | 0)), b = Math.max(1, Math.min(128, st.b | 0));
  st.a = a; st.b = b;
  if (st.shape === "circle") data = { grid: S.ellipse(a, a, st.mode) };
  else if (st.shape === "ellipse") data = { grid: S.ellipse(a, b, st.mode) };
  else if (st.shape === "sphere") data = { layers: S.sphere(a) };
  else if (st.shape === "dome") data = { layers: S.dome(a) };
  else if (st.shape === "torus") { const r = Math.max(1, Math.min(b, Math.floor(a / 2) - 1)) / 2; data = { layers: S.torus(a / 2 - r, r) }; }
  else if (st.shape === "cone") data = { layers: S.cone(a, b) };
  if (data.layers) {
    data.layers = data.layers.filter((g) => !S.isEmpty(g));
    st.layer = Math.max(0, Math.min(st.layer, data.layers.length - 1));
  }
  sh.d3 ? null : (st.layer = 0);
}
const curGrid = () => data.grid || data.layers[st.layer];

// ---------- 描画 ----------
const cv = $("cv"), ctx = cv.getContext("2d");
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function cellSize(w) {
  const avail = $("board").clientWidth - 24;
  const fit = Math.max(5, Math.min(30, Math.floor(avail / (w + 2))));
  return Math.max(4, Math.min(48, fit + st.zoom * 4));
}
function draw(target = cv, grid = curGrid(), ghost = data.layers && st.layer > 0 ? data.layers[st.layer - 1] : null, forPrint = false) {
  const h = grid.length, w = grid[0].length;
  const cs = forPrint ? Math.max(8, Math.min(24, Math.floor(1400 / (w + 2)))) : cellSize(w);
  const pad = cs, W = w * cs + pad * 2, H = h * cs + pad * 2;
  const dpr = forPrint ? 1 : Math.min(2, window.devicePixelRatio || 1);
  target.width = W * dpr; target.height = H * dpr;
  if (!forPrint) { target.style.width = W + "px"; target.style.height = H + "px"; }
  const g = target.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const col = forPrint ? { sheet: "#fff", grid: "#DDD", major: "#999", block: "#2F5D7C", ghost: "#2F5D7C30", axis: "#E08A00" } :
    { sheet: css("--sheet"), grid: css("--grid"), major: css("--major"), block: css("--block"), ghost: css("--ghost"), axis: css("--axis") };
  g.fillStyle = col.sheet; g.fillRect(0, 0, W, H);
  const cx = w / 2, cy = h / 2;
  // 方眼
  for (let i = 0; i <= w; i++) {
    const off = i - cx; const major = Number.isInteger(off) && off % 5 === 0;
    if (cs < 8 && !major) continue;
    g.strokeStyle = Math.abs(off) < 1e-9 ? col.axis : major ? col.major : col.grid; g.lineWidth = Math.abs(off) < 1e-9 ? 2 : 1;
    g.beginPath(); g.moveTo(pad + i * cs + 0.5, pad); g.lineTo(pad + i * cs + 0.5, pad + h * cs); g.stroke();
  }
  for (let j = 0; j <= h; j++) {
    const off = j - cy; const major = Number.isInteger(off) && off % 5 === 0;
    if (cs < 8 && !major) continue;
    g.strokeStyle = Math.abs(off) < 1e-9 ? col.axis : major ? col.major : col.grid; g.lineWidth = Math.abs(off) < 1e-9 ? 2 : 1;
    g.beginPath(); g.moveTo(pad, pad + j * cs + 0.5); g.lineTo(pad + w * cs, pad + j * cs + 0.5); g.stroke();
  }
  // 奇数のときは中心のマスに印
  if (w % 2 && h % 2) { g.strokeStyle = col.axis; g.lineWidth = 2; g.strokeRect(pad + Math.floor(cx) * cs + 1, pad + Math.floor(cy) * cs + 1, cs - 2, cs - 2); }
  // 1つ下の段
  if (ghost) {
    const gw = ghost[0].length, ox = Math.round((w - gw) / 2);
    g.fillStyle = col.ghost;
    ghost.forEach((row, j) => row.forEach((v, i) => { if (v) g.fillRect(pad + (i + ox) * cs + 1, pad + (j + ox) * cs + 1, cs - 1, cs - 1); }));
  }
  g.fillStyle = col.block;
  grid.forEach((row, j) => row.forEach((v, i) => { if (v) g.fillRect(pad + i * cs + 1, pad + j * cs + 1, cs - 1, cs - 1); }));
  // まっすぐ並ぶ個数を、並びのまん中に書く
  if (cs >= 12 && !(st.mode === "fill" && !data.layers)) {
    g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle";
    g.font = `700 ${Math.floor(cs * 0.62)}px "BIZ UDPGothic", sans-serif`;
    const at = (i, j) => j >= 0 && j < h && i >= 0 && i < w && grid[j][i];
    for (let j = 0; j < h; j++) {
      let i = 0;
      while (i < w) {
        if (!grid[j][i]) { i++; continue; }
        let k = i; while (k < w && grid[j][k]) k++;
        const n = k - i;
        if (n >= 2) { const m = i + (n - 1) / 2; g.fillText(String(n), pad + (m + 0.5) * cs, pad + (j + 0.5) * cs + 1); }
        i = k;
      }
    }
    for (let i = 0; i < w; i++) {
      let j = 0;
      while (j < h) {
        if (!grid[j][i] || at(i - 1, j) || at(i + 1, j)) { j++; continue; }
        let k = j; while (k < h && grid[k][i] && !at(i - 1, k) && !at(i + 1, k)) k++;
        const n = k - j;
        if (n >= 2) { const m = j + (n - 1) / 2; g.fillText(String(n), pad + (i + 0.5) * cs, pad + (m + 0.5) * cs + 1); }
        j = k > j ? k : j + 1;
      }
    }
  }
  return target;
}

// ---------- 画面の更新 ----------
function render() {
  const sh = SHAPES[st.shape];
  if (sh.pro && !isPro()) { lockedView(); return; }
  compute();
  $("title").textContent = sh.title; $("lead").textContent = sh.lead;
  $("lA").textContent = sh.a; $("vA").value = st.a;
  $("nB").classList.toggle("hide", !sh.b); if (sh.b) { $("lB").textContent = sh.b; $("vB").value = st.b; }
  $("mode").classList.toggle("hide", sh.d3);
  document.querySelectorAll("#mode button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.mode === st.mode));
  document.querySelectorAll("#tabs button").forEach((b) => b.setAttribute("aria-selected", b.dataset.shape === st.shape));
  $("layerBox").classList.toggle("hide", !sh.d3); $("barBox").classList.toggle("hide", !sh.d3);
  const grid = curGrid();
  draw();
  const n = S.count2d(grid);
  if (sh.d3) {
    const total = S.count3d(data.layers), L = data.layers.length, done = doneSet();
    $("lnow").textContent = `${st.layer + 1}段目 / 全${L}段`;
    $("ldone").checked = done.has(st.layer);
    $("bar").style.width = `${Math.round(done.size / L * 100)}%`;
    const doneBlocks = data.layers.reduce((a, g, i) => a + (done.has(i) ? S.count2d(g) : 0), 0);
    $("facts").innerHTML = `<div><small>この段のブロック</small><b>${n}個</b><small>${S.stackText(n)}</small></div><div><small>全体のブロック</small><b>${total.toLocaleString()}個</b><small>${S.stackText(total)}${total >= 1728 ? ` ・ シュルカーボックス約${(total / 1728).toFixed(1)}箱` : ""}</small></div><div><small>高さ</small><b>${L}段</b></div><div><small>できた段</small><b>${done.size}/${L}段</b><small>残り${(total - doneBlocks).toLocaleString()}個</small></div>`;
  } else {
    const w = grid[0].length, h = grid.length;
    $("facts").innerHTML = `<div><small>必要なブロック</small><b>${n.toLocaleString()}個</b><small>${S.stackText(n)}</small></div><div><small>大きさ</small><b>${w}×${h}マス</b><small>${w % 2 ? "中心は1×1マス" : "中心は2×2マス"}</small></div>`;
  }
  const lineGrid = sh.d3 ? S.outline(grid) : S.ellipse(st.a, st.shape === "ellipse" ? st.b : st.a, "line");
  const seq = S.steps(lineGrid);
  $("stepsBox").classList.toggle("hide", !seq.length || st.shape === "torus");
  $("seq").textContent = seq.join(" → ");
  $("seqNote").textContent = sh.d3 ? "この段の外まわりの並びです。図の数字も同じ意味です。" : st.shape === "ellipse" ? "楕円は上下と左右で並びが変わります。図の数字を見ながら置いてください。" : "これで4分の1周。残りの3か所も同じ並びで、1周つながります。";
  ls.set("bj.last", { shape: st.shape, a: st.a, b: st.b, mode: st.mode });
  history.replaceState(null, "", `?s=${st.shape}&a=${st.a}${sh.b ? `&b=${st.b}` : ""}${sh.d3 ? "" : `&m=${st.mode}`}`);
}
function lockedView() {
  const sh = SHAPES[st.shape];
  document.querySelectorAll("#tabs button").forEach((b) => b.setAttribute("aria-selected", b.dataset.shape === st.shape));
  $("title").textContent = sh.title; $("lead").textContent = `${sh.lead} この形はフルパック(300円)で使えます。`;
  ["layerBox", "barBox", "stepsBox", "mode", "nB"].forEach((id) => $(id).classList.add("hide"));
  // 見本として小さいサイズを1段だけ見せる
  data = { layers: st.shape === "torus" ? S.torus(5, 2) : S.cone(11, 8) };
  st.layer = 1; draw(cv, data.layers[1], data.layers[0]);
  $("facts").innerHTML = `<div style="grid-column:1/-1"><small>見本(小さいサイズの1段)を表示しています。</small><b><a href="#full">フルパックについて</a></b></div>`;
}

// ---------- 操作 ----------
document.querySelectorAll("#tabs button").forEach((b) => b.onclick = () => { st.shape = b.dataset.shape; st.layer = 0; st.zoom = 0; render(); });
document.querySelectorAll("#mode button").forEach((b) => b.onclick = () => { st.mode = b.dataset.mode; render(); });
for (const [box, key] of [["nA", "a"], ["nB", "b"]]) {
  const inp = $(box).querySelector("input");
  $(box).querySelectorAll("button").forEach((b) => b.onclick = () => { st[key] = Math.max(1, (+inp.value || 0) + +b.dataset.d); render(); });
  inp.onchange = () => { st[key] = +inp.value || st[key]; render(); };
}
$("zi").onclick = () => { st.zoom = Math.min(6, st.zoom + 1); render(); };
$("zo").onclick = () => { st.zoom = Math.max(-3, st.zoom - 1); render(); };
$("lp").onclick = () => { st.layer = Math.max(0, st.layer - 1); render(); };
$("ln").onclick = () => { st.layer = Math.min(data.layers.length - 1, st.layer + 1); render(); };
$("ldone").onchange = (e) => { setDone(st.layer, e.target.checked); if (e.target.checked && st.layer < data.layers.length - 1) { st.layer++; } render(); };
window.addEventListener("resize", () => { if (data) render(); });

// 保存した設計図
function plist() {
  const ps = ls.get("bj.projects", []);
  $("plist").innerHTML = ps.map((p, i) => {
    const all = ls.get("bj.done", {}); const k = `${p.shape}|${p.a}|${SHAPES[p.shape].b ? p.b : ""}|${SHAPES[p.shape].d3 ? "" : p.mode}`;
    const prog = SHAPES[p.shape].d3 ? ` ${(all[k] || []).length}段できた` : "";
    return `<li><button type="button" data-open="${i}">${p.name.replace(/[<>&"]/g, "")}</button><span class="p">${SHAPES[p.shape].title.replace("の設計図", "")} ${p.a}${SHAPES[p.shape].b ? "×" + p.b : ""}${prog}</span><button type="button" data-del="${i}" aria-label="削除">削除</button></li>`;
  }).join("");
  $("plist").querySelectorAll("[data-open]").forEach((b) => b.onclick = () => { const p = ls.get("bj.projects", [])[+b.dataset.open]; Object.assign(st, p, { layer: 0, zoom: 0 }); render(); window.scrollTo({ top: 0, behavior: "smooth" }); });
  $("plist").querySelectorAll("[data-del]").forEach((b) => b.onclick = () => { const ps2 = ls.get("bj.projects", []); ps2.splice(+b.dataset.del, 1); ls.set("bj.projects", ps2); plist(); });
}
$("psave").onclick = () => {
  const ps = ls.get("bj.projects", []);
  if (!isPro() && ps.length >= FREE_SAVES) { $("pmsg").innerHTML = `無料で保存できるのは${FREE_SAVES}つまでです。いらないものを削除するか、<a href="#full">フルパック</a>で無制限にできます。`; return; }
  const name = $("pname").value.trim() || `${SHAPES[st.shape].title.replace("の設計図", "")} ${st.a}`;
  ps.unshift({ name, shape: st.shape, a: st.a, b: st.b, mode: st.mode, t: Date.now() });
  ls.set("bj.projects", ps); $("pname").value = ""; $("pmsg").textContent = `「${name}」を保存しました。`; plist();
};

// 印刷(フルパック)
$("print").onclick = () => {
  if (!isPro()) { $("pmsg").innerHTML = `全部の段の印刷は<a href="#full">フルパック</a>の機能です。`; document.getElementById("full").scrollIntoView({ behavior: "smooth" }); return; }
  const sh = SHAPES[st.shape];
  const grids = data.layers || [data.grid];
  $("printArea").innerHTML = grids.map((g, i) => {
    const c = draw(document.createElement("canvas"), g, data.layers && i > 0 ? data.layers[i - 1] : null, true);
    return `<div class="pg"><p><b>${sh.title.replace("の設計図", "")} ${st.a}${sh.b ? "×" + st.b : ""}</b> ${data.layers ? `${i + 1}段目 / 全${grids.length}段` : ""} ・ ${S.count2d(g)}個(${S.stackText(S.count2d(g))}) ・ 並び ${S.steps(g).join("→")}</p><img src="${c.toDataURL("image/png")}" alt=""></div>`;
  }).join("");
  setTimeout(() => window.print(), 300);
};

// スタック計算・ネザー
function stack() {
  const n = Math.max(0, +$("sc").value || 0), per = +$("sp").value;
  const s = S.stacks(n, per);
  $("sout").innerHTML = `${S.stackText(n, per)}<small>ラージチェスト ${Math.ceil(n / (per * 54))}個ぶん ・ シュルカーボックス ${Math.ceil(n / (per * 27))}箱ぶん(${(s.shulker).toFixed(2)})</small>`;
}
$("sc").oninput = stack; $("sp").onchange = stack; stack();
function nether() {
  const x = +$("nx").value || 0, z = +$("nz").value || 0, o2n = $("nd").value === "o2n";
  $("nout").innerHTML = o2n ? `ネザーでは X ${S.toNether(x)} ・ Z ${S.toNether(z)}<small>オーバーワールドの X ${x} ・ Z ${z} から</small>` : `オーバーワールドでは X ${S.toOver(x)} ・ Z ${S.toOver(z)}<small>ネザーの X ${x} ・ Z ${z} から(ここから8マス以内のどこか)</small>`;
}
["nx", "nz"].forEach((id) => $(id).oninput = nether); $("nd").onchange = nether; nether();

// フルパック
function buyBtn() {
  if (isPro()) { $("buyBtn").innerHTML = `<p><b>フルパックが有効です。</b>ありがとうございます。</p>`; return; }
  if (PAY.url) { $("buyBtn").innerHTML = `<a class="btn y" href="${PAY.url}" target="_blank" rel="noopener">${PAY.price}円で購入する</a>`; return; }
  const sub = encodeURIComponent(`【ブロック定規】フルパック 申し込み`);
  const body = encodeURIComponent(`ブロック定規 フルパック(${PAY.price}円)を申し込みます。\n\nお名前(ニックネーム可):\n\n※お支払い用のPayPalのご案内をこのメールアドレスにお送りします。`);
  $("buyBtn").innerHTML = `<a class="btn y" href="mailto:${MAIL}?subject=${sub}&body=${body}">メールで申し込む(${PAY.price}円)</a>`;
}
$("keyGo").onclick = async () => {
  const k = $("key").value.trim().toUpperCase().replace(/\s/g, "");
  const m = k.match(/^BJ-([A-Z0-9]{8})-([0-9A-F]{4})$/);
  let ok = false;
  if (m) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`blockjogi:${m[1]}`));
    ok = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 4).toUpperCase() === m[2];
  }
  if (!ok) { $("keyMsg").textContent = "キーが正しくありません。メールのキーを、ハイフンも含めてそのまま入れてください。"; return; }
  ls.set("bj.key", k); st.layer = 0; $("keyMsg").textContent = "登録しました。フルパックの機能が使えます。"; buyBtn(); render();
};

buyBtn(); plist(); render();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
