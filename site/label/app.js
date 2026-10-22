/* ラベル帳 — app logic. All data stays in this browser (localStorage). ZEROICHI WORKS */
(function(){
"use strict";
const D = window.LC_DATA;
const ALL_ALLERGENS = D.MANDATORY.concat(D.RECOMMENDED);
const STORE_KEY = "labelcho:v1";
const FREE_LIMIT = 3;
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const uid = () => Math.random().toString(36).slice(2,10);
const num = v => { const n = parseFloat(String(v).replace(/[,，]/g,"")); return isFinite(n) ? n : 0; };

/* ---------- state ---------- */
let storageOK = true;
let S = load();
let cur = { productId: S.products[0]?.id || null, ingredientId: null, tab: "products" };

function blank(){
  return { v:1, maker:{role:"製造者", name:"", addr:""}, ingredients:[], products:[], pro:{key:""},
           print:{sheet:"a4-12", custom:null, border:false} };
}
function load(){
  let raw = null;
  try { raw = localStorage.getItem(STORE_KEY); } catch(e){ storageOK = false; }
  if (raw) { try { const o = JSON.parse(raw); if (o && o.v === 1) return Object.assign(blank(), o); } catch(e){} }
  const s = blank();
  // first run: one sample product so the screen is not empty
  D.SAMPLE.ingredients.forEach(i => s.ingredients.push(Object.assign({id:uid(), nut:{}}, i)));
  const p = Object.assign(newProduct(), D.SAMPLE.product);
  p.lines = D.SAMPLE.product.lines.map(([n,g]) => ({ingId: s.ingredients.find(i => i.name===n).id, g}));
  s.products.push(p);
  return s;
}
let saveTimer = null;
function save(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); storageOK = true; }
    catch(e){ storageOK = false; }
    $("#storageWarn").hidden = storageOK;
  }, 150);
}
function newProduct(){
  return { id:uid(), name:"新しい商品", meishou:"", content:"", limitType:"賞味期限", days:7, storage:"",
           lines:[], nutrition:false, nutUnit:"1個当たり", unitWeight:"", finishedWeight:"",
           nut:{kcal:"",p:"",f:"",c:"",salt:""} };
}
const isPro = () => !!S.pro.verified;
const prod = id => S.products.find(p => p.id === id);
const ing  = id => S.ingredients.find(i => i.id === id);
const ingByName = n => S.ingredients.find(i => i.name === n.trim());

/* ---------- guesses (only suggestions) ---------- */
function guessAllergens(name){
  const out = [];
  for (const [a, words] of Object.entries(D.KEYWORDS)) if (words.some(w => name.includes(w))) out.push(a);
  if (out.includes("乳") && /乳化剤/.test(name) && !/牛乳|乳成分/.test(name)) out.splice(out.indexOf("乳"),1);
  return out;
}
function guessAdditive(name){
  for (const a of D.ADDITIVES) if (a.k.some(k => name.includes(k))) return {kind: a.raw ? "raw":"add", show:a.show};
  return {kind:"raw", show:name};
}
function createIngredient(name){
  const g = guessAdditive(name);
  const i = {id:uid(), name:name.trim(), show:g.show, kind:g.kind, sub:"", origin:"", allergens:guessAllergens(name), nut:{}, guessed:true};
  S.ingredients.push(i);
  return i;
}

/* ---------- label building ---------- */
function addDays(dateStr, days){
  const d = dateStr ? new Date(dateStr+"T00:00:00") : new Date();
  d.setDate(d.getDate() + Math.round(num(days)));
  return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,"0")}.${String(d.getDate()).padStart(2,"0")}`;
}
function merged(p){
  const map = new Map();
  for (const l of p.lines){ const i = ing(l.ingId); if (!i) continue;
    const m = map.get(i.id) || {i, g:0}; m.g += num(l.g); map.set(i.id, m); }
  return Array.from(map.values());
}
function allergenText(list){
  return list.map(a => D.DISPLAY[a] || a).join("・");
}
function buildLabel(p, opts={}){
  const warn = [];
  const items = merged(p);
  const raws = items.filter(x => x.i.kind !== "add").sort((a,b) => b.g - a.g);
  const adds = items.filter(x => x.i.kind === "add").sort((a,b) => b.g - a.g);
  const allergenSet = new Set();
  items.forEach(x => (x.i.allergens||[]).forEach(a => allergenSet.add(a)));
  const allergens = ALL_ALLERGENS.filter(a => allergenSet.has(a));

  const rawText = raws.map((x, idx) => {
    let t = esc(x.i.show || x.i.name);
    if (idx === 0 && x.i.origin) t += `（${esc(x.i.origin)}）`;
    if (x.i.sub) t += `（${esc(x.i.sub)}）`;
    return t;
  }).join("、");
  const addText = adds.map(x => esc(x.i.show || x.i.name) + (x.i.sub ? `（${esc(x.i.sub)}）` : "")).join("、");
  let genzai = rawText;
  const allerg = allergens.length ? `（一部に${esc(allergenText(allergens))}を含む）` : "";
  if (addText) genzai += "／" + addText + (allerg ? "、" + allerg : "");
  else genzai += allerg;

  // checks
  if (!items.length) warn.push({lv:"err", t:"原材料がまだありません。左の表に原材料と重さを入れてください。"});
  if (raws.length && !raws[0].i.origin) warn.push({lv:"err", t:`重さが一番多い原材料「${raws[0].i.show||raws[0].i.name}」の原産地(例: 国内製造、アメリカ産)が未入力です。「原材料」で入れてください。`});
  if (raws.length > 1 && raws[0].g === raws[1].g) warn.push({lv:"warn", t:`「${raws[0].i.show||raws[0].i.name}」と「${raws[1].i.show||raws[1].i.name}」が同じ重さです。重さ順の1位(原産地を書く原材料)がどちらか、レシピで確かめてください。`});
  if (!p.meishou) warn.push({lv:"err", t:"「名称」(例: 焼菓子、洋菓子、そうざい)が未入力です。"});
  if (!p.content) warn.push({lv:"err", t:"「内容量」が未入力です。"});
  if (!p.storage) warn.push({lv:"err", t:"「保存方法」が未入力です。"});
  if (!S.maker.name || !S.maker.addr) warn.push({lv:"err", t:"表示者の名前と住所が未入力です。「設定」で入れてください。"});
  items.filter(x => x.i.guessed).forEach(x => warn.push({lv:"warn", t:`「${x.i.name}」のアレルゲンは名前から推定しました。原料の袋の表示で確かめ、「原材料」で確認済みにしてください。`}));
  items.filter(x => x.g <= 0).forEach(x => warn.push({lv:"warn", t:`「${x.i.name}」の重さが0です。`}));
  if (D.MANDATORY.some(a => a === "カシューナッツ") && items.some(x => /ナッツ|ミックスナッツ/.test(x.i.name) && !x.i.allergens.includes("カシューナッツ")))
    warn.push({lv:"warn", t:"ナッツ類の原料があります。2026年4月からカシューナッツは表示義務です。カシューナッツが入っていないか確認してください。"});

  // nutrition
  let nut = null;
  if (p.nutrition){
    nut = {unit: p.nutUnit || "", kcal:p.nut.kcal, p:p.nut.p, f:p.nut.f, c:p.nut.c, salt:p.nut.salt};
    if (["kcal","p","f","c","salt"].some(k => p.nut[k] === "" || p.nut[k] == null)) warn.push({lv:"err", t:"栄養成分表示の値に空欄があります。"});
  }
  return {
    meishou: esc(p.meishou), genzai, content: esc(p.content),
    limitType: esc(p.limitType), limit: addDays(opts.date, p.days),
    storage: esc(p.storage), role: esc(S.maker.role), maker: esc(S.maker.name), addr: esc(S.maker.addr),
    nut, allergens, warn
  };
}
function fmtNut(k, v){
  if (v === "" || v == null) return "—";
  const n = num(v);
  if (k === "kcal") return (n < 5 ? 0 : Math.round(n)) + "kcal";
  if (k === "salt") return (n < 0.005 ? 0 : n < 0.1 ? n.toFixed(2) : n.toFixed(1)) + "g";
  return (n < 0.5 ? 0 : n.toFixed(1)) + "g";
}
function labelHTML(L){
  let h = `<div class="fl"><table>
  <tr><th>名称</th><td>${L.meishou}</td></tr>
  <tr><th>原材料名</th><td>${L.genzai}</td></tr>
  <tr><th>内容量</th><td>${L.content}</td></tr>
  <tr><th>${L.limitType}</th><td>${L.limit}</td></tr>
  <tr><th>保存方法</th><td>${L.storage}</td></tr>
  <tr><th>${L.role}</th><td>${L.maker}<br>${L.addr}</td></tr>
  </table>`;
  if (L.nut){
    h += `<div class="nut"><span class="nut-h">栄養成分表示（${esc(L.nut.unit)}）</span><div class="nut-row">
      <span>熱量 ${fmtNut("kcal",L.nut.kcal)}</span><span>たんぱく質 ${fmtNut("p",L.nut.p)}</span><span>脂質 ${fmtNut("f",L.nut.f)}</span>
      <span>炭水化物 ${fmtNut("c",L.nut.c)}</span><span>食塩相当量 ${fmtNut("salt",L.nut.salt)}</span></div>
      <span class="nut-note">この表示値は目安です。</span></div>`;
  }
  return h + `</div>`;
}
/* shrink font until it fits the label box (min 5.5pt) */
function fit(box){
  const fl = box.querySelector(".fl"); if (!fl) return 9;
  let size = 9;
  fl.style.fontSize = size + "pt";
  while (fl.scrollHeight > box.clientHeight + 0.5 && size > 5.5){ size = Math.round((size - 0.25)*100)/100; fl.style.fontSize = size + "pt"; }
  const over = fl.scrollHeight > box.clientHeight + 0.5;
  box.classList.toggle("overflow", over);
  return over ? -size : size;
}

/* ---------- sheet ---------- */
function sheetSpec(){
  const base = D.SHEETS.find(s => s.id === S.print.sheet) || D.SHEETS[0];
  return Object.assign({}, base, S.print.custom && S.print.custom.from === base.id ? S.print.custom : {});
}

/* ---------- tabs ---------- */
function showTab(t){
  cur.tab = t;
  $$(".tabs [role=tab]").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === t));
  $$(".tab").forEach(s => s.hidden = s.id !== "tab-" + t);
  if (t === "products") renderProducts();
  if (t === "ingredients") renderIngredients();
  if (t === "print") renderPrint();
  if (t === "matrix") renderMatrix();
  if (t === "settings") renderSettings();
  try { history.replaceState(null, "", "#" + t); } catch(e){}
}
$$(".tabs [role=tab]").forEach(b => b.addEventListener("click", () => showTab(b.dataset.tab)));

function toast(msg){
  const t = $("#toast"); t.textContent = msg; t.classList.add("on");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("on"), 2200);
}
function renderPlan(){
  $("#planBadge").textContent = isPro() ? "先行予約版(無制限)" : `無料版(${FREE_LIMIT}商品まで)`;
  $("#planBadge").classList.toggle("pro", isPro());
}

/* ---------- products tab ---------- */
function renderProductList(){
  const ul = $("#productList");
  ul.innerHTML = S.products.map(p => `<li><button class="item ${p.id===cur.productId?"on":""}" data-id="${p.id}">
    <span class="nm">${esc(p.name||"(名前なし)")}</span><span class="sub">${esc(p.meishou||"名称 未入力")}</span></button></li>`).join("")
    || `<li class="empty">商品がありません。「商品を追加」から始めましょう。</li>`;
  $$("button.item", ul).forEach(b => b.addEventListener("click", () => { cur.productId = b.dataset.id; renderProducts(); }));
  const atLimit = !isPro() && S.products.length >= FREE_LIMIT;
  $("#addProduct").disabled = atLimit;
  $("#limitNote").hidden = !atLimit;
}
$("#addProduct").addEventListener("click", () => {
  if (!isPro() && S.products.length >= FREE_LIMIT) return;
  const p = newProduct(); S.products.push(p); cur.productId = p.id; save(); renderProducts();
  $("#f-name")?.select();
});

function renderProducts(){
  renderProductList();
  const p = prod(cur.productId) || S.products[0];
  const ed = $("#productEditor");
  if (!p){ ed.innerHTML = `<div class="empty-state"><p>商品を追加すると、ここで原材料と重さを入れられます。</p></div>`; $("#labelPreview").innerHTML=""; $("#warnings").innerHTML=""; return; }
  cur.productId = p.id;
  ed.innerHTML = `
    <div class="row-between"><h2>商品の内容</h2><span>
      <button class="btn ghost small" id="dupProduct">複製</button>
      <button class="btn danger small" id="delProduct">削除</button></span></div>
    <div class="grid2">
      <label>商品名(管理用)<input id="f-name" value="${esc(p.name)}"></label>
      <label>名称(ラベルに出る)<input id="f-meishou" value="${esc(p.meishou)}" placeholder="例: 焼菓子" list="meishouList"></label>
      <label>内容量<input id="f-content" value="${esc(p.content)}" placeholder="例: 1個、6枚、120g"></label>
      <label>期限の種類<select id="f-limitType"><option ${p.limitType==="賞味期限"?"selected":""}>賞味期限</option><option ${p.limitType==="消費期限"?"selected":""}>消費期限</option></select></label>
      <label>製造日から何日後か<input id="f-days" type="number" min="0" value="${esc(p.days)}"><small>期限の日数は、保存試験などをもとにご自身で決めた日数を入れてください</small></label>
      <label>保存方法<input id="f-storage" value="${esc(p.storage)}" list="storageList" placeholder="例: 直射日光・高温多湿を避けて保存してください"></label>
    </div>
    <datalist id="meishouList"><option>焼菓子</option><option>洋菓子</option><option>和菓子</option><option>パン</option><option>菓子パン</option><option>そうざい</option><option>弁当</option><option>ジャム</option><option>ドレッシング</option></datalist>
    <datalist id="storageList"><option>直射日光・高温多湿を避けて保存してください</option><option>要冷蔵(10℃以下)</option><option>要冷凍(-18℃以下)</option></datalist>

    <h3 class="sec">原材料と重さ(1回に作る量)</h3>
    <p class="muted">レシピの重さをそのまま入れてください。ラベルでは重い順に並べ、添加物は「／」の後ろにまとめます。</p>
    <div class="recipe" id="recipe"></div>
    <datalist id="ingList">${S.ingredients.map(i => `<option value="${esc(i.name)}">`).join("")}</datalist>
    <button class="btn ghost small" id="addLine">行を追加</button>

    <h3 class="sec">栄養成分表示</h3>
    <label class="check"><input type="checkbox" id="f-nutrition" ${p.nutrition?"checked":""}> ラベルに栄養成分表示を入れる</label>
    <p class="muted">消費税の免税事業者など小規模な事業者が自分で販売する場合は、省略できることがあります(栄養の強調表示をしない場合)。くわしくは保健所・消費者庁の資料で確認してください。</p>
    <div id="nutBox" ${p.nutrition?"":"hidden"}>
      <div class="grid3">
        <label>表示の単位<input id="f-nutUnit" value="${esc(p.nutUnit)}" placeholder="例: 1個当たり、100g当たり"></label>
        <label>熱量 kcal<input id="n-kcal" inputmode="decimal" value="${esc(p.nut.kcal)}"></label>
        <label>たんぱく質 g<input id="n-p" inputmode="decimal" value="${esc(p.nut.p)}"></label>
        <label>脂質 g<input id="n-f" inputmode="decimal" value="${esc(p.nut.f)}"></label>
        <label>炭水化物 g<input id="n-c" inputmode="decimal" value="${esc(p.nut.c)}"></label>
        <label>食塩相当量 g<input id="n-salt" inputmode="decimal" value="${esc(p.nut.salt)}"></label>
      </div>
      <div class="calc">
        <div class="grid3">
          <label>焼き上がり・出来上がりの総重量 g<input id="f-finished" inputmode="decimal" value="${esc(p.finishedWeight)}"><small>空欄なら材料の合計で計算</small></label>
          <label>表示の単位の重さ g<input id="f-unitW" inputmode="decimal" value="${esc(p.unitWeight)}" placeholder="例: 1個 40g なら 40"></label>
        </div>
        <button class="btn ghost small" id="calcNut">原材料の値から計算する${isPro()?"":"(先行予約版)"}</button>
        <p class="muted" id="calcMsg"></p>
      </div>
    </div>`;

  const bind = (id, key, after) => $(id).addEventListener("input", e => { p[key] = e.target.value; save(); after && after(); updatePreview(); });
  bind("#f-name","name", renderProductList);
  bind("#f-meishou","meishou", renderProductList);
  bind("#f-content","content"); bind("#f-days","days"); bind("#f-storage","storage");
  bind("#f-nutUnit","nutUnit"); bind("#f-finished","finishedWeight"); bind("#f-unitW","unitWeight");
  $("#f-limitType").addEventListener("change", e => { p.limitType = e.target.value; save(); updatePreview(); });
  $("#f-nutrition").addEventListener("change", e => { p.nutrition = e.target.checked; $("#nutBox").hidden = !p.nutrition; save(); updatePreview(); });
  ["kcal","p","f","c","salt"].forEach(k => $("#n-"+k).addEventListener("input", e => { p.nut[k] = e.target.value; save(); updatePreview(); }));
  $("#addLine").addEventListener("click", () => { p.lines.push({ingId:null, g:""}); save(); renderRecipe(p); $$("#recipe .r-name").pop()?.focus(); });
  $("#delProduct").addEventListener("click", () => {
    if (!confirm(`「${p.name}」を削除しますか?元に戻せません。`)) return;
    S.products = S.products.filter(x => x.id !== p.id); cur.productId = S.products[0]?.id || null; save(); renderProducts(); toast("商品を削除しました");
  });
  $("#dupProduct").addEventListener("click", () => {
    if (!isPro() && S.products.length >= FREE_LIMIT){ toast(`無料版は${FREE_LIMIT}商品までです`); return; }
    const c = JSON.parse(JSON.stringify(p)); c.id = uid(); c.name = p.name + "のコピー"; S.products.push(c); cur.productId = c.id; save(); renderProducts(); toast("商品を複製しました");
  });
  $("#calcNut").addEventListener("click", () => calcNutrition(p));
  renderRecipe(p);
  updatePreview();
}

function renderRecipe(p){
  const box = $("#recipe");
  const total = p.lines.reduce((a,l) => a + num(l.g), 0);
  box.innerHTML = `<div class="r-head"><span>原材料</span><span>重さ g</span><span>アレルゲン</span><span></span></div>` +
    p.lines.map((l, idx) => {
      const i = ing(l.ingId);
      const al = i ? (i.allergens.length ? i.allergens.map(a => `<span class="chip ${D.MANDATORY.includes(a)?"m":""}">${esc(a)}</span>`).join("") : `<span class="muted">なし</span>`) : "";
      const kind = i && i.kind === "add" ? `<span class="chip add">添加物</span>` : "";
      return `<div class="r-row" data-idx="${idx}">
        <input class="r-name" list="ingList" value="${esc(i?.name||"")}" placeholder="例: 薄力粉" aria-label="原材料名">
        <input class="r-g" inputmode="decimal" value="${esc(l.g)}" placeholder="0" aria-label="重さ(g)">
        <span class="r-al">${kind}${al}${i?.guessed?`<button class="linkish" data-edit="${i.id}">確認する</button>`:""}</span>
        <button class="r-del" aria-label="この行を削除">×</button></div>`;
    }).join("") +
    `<div class="r-total">合計 ${Math.round(total*10)/10} g</div>`;
  $$(".r-row", box).forEach(row => {
    const l = p.lines[+row.dataset.idx];
    $(".r-name", row).addEventListener("change", e => {
      const v = e.target.value.trim();
      if (!v){ l.ingId = null; }
      else { let i = ingByName(v); const created = !i; if (!i) i = createIngredient(v); l.ingId = i.id;
        if (created) toast(`原材料「${v}」を登録しました。アレルゲンを確認してください`); }
      save(); renderProducts();
    });
    $(".r-g", row).addEventListener("input", e => { l.g = e.target.value; save(); updatePreview();
      $(".r-total", box).textContent = `合計 ${Math.round(p.lines.reduce((a,x)=>a+num(x.g),0)*10)/10} g`; });
    $(".r-del", row).addEventListener("click", () => { p.lines.splice(+row.dataset.idx, 1); save(); renderProducts(); });
  });
  $$("[data-edit]", box).forEach(b => b.addEventListener("click", () => { cur.ingredientId = b.dataset.edit; showTab("ingredients"); }));
}

function updatePreview(){
  const p = prod(cur.productId); if (!p) return;
  const L = buildLabel(p);
  const spec = sheetSpec();
  const box = $("#labelPreview");
  box.style.width = spec.w + "mm"; box.style.height = spec.h + "mm";
  box.className = "label-box";
  box.innerHTML = labelHTML(L);
  const size = fit(box);
  $("#pvSize").textContent = `${spec.w}×${spec.h}mm・実寸`;
  const warn = L.warn.slice();
  if (size < 0) warn.unshift({lv:"err", t:`この大きさ(${spec.w}×${spec.h}mm)のラベルには入りきりません。大きい用紙を選ぶか、原材料の書き方を見直してください。`});
  $("#fitNote").textContent = size > 0 ? `文字の大きさ ${size}pt` + (size < 8 ? "(8pt未満。表示面積150cm²以下の場合のみ5.5pt以上で可)" : "") : "";
  $("#warnings").innerHTML = warn.length ? warn.map(w => `<li class="${w.lv}">${esc(w.t)}</li>`).join("")
    : `<li class="ok">必須の欄はすべて入っています。最後に、原料の袋の表示とレシピを見比べて確認してください。</li>`;
}

function calcNutrition(p){
  const msg = $("#calcMsg");
  if (!isPro()){ msg.innerHTML = `自動計算は先行予約版の機能です。<a href="./#price">先行予約について</a>(値を手で入れる場合は無料で使えます)`; return; }
  const items = merged(p);
  const missing = items.filter(x => ["kcal","p","f","c","salt"].some(k => x.i.nut?.[k] === "" || x.i.nut?.[k] == null));
  if (missing.length){ msg.textContent = "100g当たりの栄養の値が未入力の原材料があります: " + missing.map(x => x.i.name).join("、") + "(「原材料」で入力)"; return; }
  const totalIn = items.reduce((a,x) => a + x.g, 0);
  const finished = num(p.finishedWeight) || totalIn;
  const unitW = num(p.unitWeight);
  if (!unitW){ msg.textContent = "「表示の単位の重さ g」を入れてください。"; return; }
  const r = unitW / finished;
  ["kcal","p","f","c","salt"].forEach(k => {
    const v = items.reduce((a,x) => a + num(x.i.nut[k]) * x.g / 100, 0) * r;
    p.nut[k] = k === "kcal" ? String(Math.round(v)) : String(Math.round(v*100)/100);
  });
  save(); renderProducts();
  $("#calcMsg").textContent = "計算しました(推定値)。焼成で減る水分などは、総重量の入力で反映されます。";
}

/* ---------- ingredients tab ---------- */
function renderIngredients(){
  const q = ($("#ingSearch").value || "").trim();
  const list = S.ingredients.filter(i => !q || i.name.includes(q) || (i.show||"").includes(q)).sort((a,b) => a.name.localeCompare(b.name, "ja"));
  $("#ingredientList").innerHTML = list.map(i => `<li><button class="item ${i.id===cur.ingredientId?"on":""}" data-id="${i.id}">
    <span class="nm">${esc(i.name)}${i.guessed?' <span class="chip warn">未確認</span>':""}</span>
    <span class="sub">${i.kind==="add"?"添加物":"原材料"}・${i.allergens.length?esc(i.allergens.join("・")):"アレルゲンなし"}</span></button></li>`).join("")
    || `<li class="empty">原材料がありません。</li>`;
  $$("#ingredientList button.item").forEach(b => b.addEventListener("click", () => { cur.ingredientId = b.dataset.id; renderIngredients(); }));
  const i = ing(cur.ingredientId);
  const ed = $("#ingredientEditor");
  if (!i){ ed.innerHTML = `<div class="empty-state"><p>左の一覧から原材料を選ぶと、表示名・アレルゲン・原産地を編集できます。商品の画面で新しい名前を入れると、ここに自動で追加されます。</p></div>`; return; }
  const used = S.products.filter(p => p.lines.some(l => l.ingId === i.id));
  ed.innerHTML = `
    <div class="row-between"><h2>${esc(i.name)}</h2><button class="btn danger small" id="delIng" ${used.length?"disabled title='商品で使われています'":""}>削除</button></div>
    ${i.guessed?`<div class="banner warn">アレルゲンは名前から推定しました。原料の袋の表示を見て、正しければ下の「確認済みにする」を押してください。</div>`:""}
    <div class="grid2">
      <label>登録名(レシピで使う名前)<input id="i-name" value="${esc(i.name)}"></label>
      <label>ラベルに出す名前<input id="i-show" value="${esc(i.show)}" placeholder="例: 小麦粉"></label>
      <label>区分<select id="i-kind"><option value="raw" ${i.kind!=="add"?"selected":""}>原材料</option><option value="add" ${i.kind==="add"?"selected":""}>添加物(「／」の後ろに出る)</option></select></label>
      <label>原産地(重さ1位になる時に表示)<input id="i-origin" value="${esc(i.origin)}" placeholder="例: 国内製造、アメリカ産"></label>
      <label class="span2">中身(複合原材料のとき)<input id="i-sub" value="${esc(i.sub)}" placeholder="例: 砂糖、カカオマス、ココアバター"><small>市販のチョコレートなどは、袋の原材料名を写し、( )で表示します</small></label>
    </div>
    <h3 class="sec">アレルゲン</h3>
    <p class="muted">表示義務(特定原材料)</p>
    <div class="al-grid">${D.MANDATORY.map(a => `<label class="al m"><input type="checkbox" value="${a}" ${i.allergens.includes(a)?"checked":""}> ${a}${a==="カシューナッツ"?"<small>2026年4月〜</small>":""}</label>`).join("")}</div>
    <p class="muted">表示推奨(特定原材料に準ずるもの)</p>
    <div class="al-grid">${D.RECOMMENDED.map(a => `<label class="al"><input type="checkbox" value="${a}" ${i.allergens.includes(a)?"checked":""}> ${a}</label>`).join("")}</div>
    ${i.guessed?`<button class="btn small" id="confirmIng">確認済みにする</button>`:""}
    <h3 class="sec">100g当たりの栄養(任意・自動計算用)</h3>
    <div class="grid3">${[["kcal","熱量 kcal"],["p","たんぱく質 g"],["f","脂質 g"],["c","炭水化物 g"],["salt","食塩相当量 g"]].map(([k,t]) =>
      `<label>${t}<input data-nut="${k}" inputmode="decimal" value="${esc(i.nut?.[k]??"")}"></label>`).join("")}</div>
    <p class="muted">日本食品標準成分表(文部科学省)の値や、原料の袋の栄養成分表示を写してください。</p>
    <p class="muted">使っている商品: ${used.length ? used.map(p => esc(p.name)).join("、") : "なし"}</p>`;
  const set = (k, v) => { i[k] = v; save(); };
  $("#i-name").addEventListener("change", e => { const v = e.target.value.trim(); if (v && !S.ingredients.some(x => x !== i && x.name === v)) set("name", v); else e.target.value = i.name; renderIngredients(); });
  $("#i-show").addEventListener("input", e => set("show", e.target.value));
  $("#i-kind").addEventListener("change", e => { set("kind", e.target.value); renderIngredients(); });
  $("#i-origin").addEventListener("input", e => set("origin", e.target.value));
  $("#i-sub").addEventListener("input", e => set("sub", e.target.value));
  $$(".al input", ed).forEach(c => c.addEventListener("change", () => { i.allergens = $$(".al input:checked", ed).map(x => x.value); save(); renderIngredients(); }));
  $$("[data-nut]", ed).forEach(n => n.addEventListener("input", e => { i.nut = i.nut || {}; i.nut[n.dataset.nut] = e.target.value; save(); }));
  $("#confirmIng")?.addEventListener("click", () => { i.guessed = false; save(); renderIngredients(); toast("確認済みにしました"); });
  $("#delIng").addEventListener("click", () => { if (used.length) return; if (!confirm(`「${i.name}」を削除しますか?`)) return;
    S.ingredients = S.ingredients.filter(x => x.id !== i.id); cur.ingredientId = null; save(); renderIngredients(); });
}
$("#ingSearch").addEventListener("input", renderIngredients);
$("#addIngredient").addEventListener("click", () => {
  const name = prompt("原材料の名前(例: 薄力粉、ミルクチョコレート)"); if (!name || !name.trim()) return;
  if (ingByName(name)){ cur.ingredientId = ingByName(name).id; renderIngredients(); return; }
  const i = createIngredient(name); cur.ingredientId = i.id; save(); renderIngredients();
});

/* ---------- print tab ---------- */
function renderPrint(){
  const sel = $("#prProduct");
  sel.innerHTML = S.products.map(p => `<option value="${p.id}" ${p.id===cur.productId?"selected":""}>${esc(p.name)}</option>`).join("");
  $("#prSheet").innerHTML = D.SHEETS.map(s => `<option value="${s.id}" ${s.id===S.print.sheet?"selected":""}>${s.name}</option>`).join("");
  if (!$("#prDate").value){ const d = new Date(); $("#prDate").value = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
  $("#prBorder").checked = !!S.print.border;
  fillSpecInputs(); drawSheetPreview();
}
function fillSpecInputs(){
  const s = sheetSpec();
  [["#prW","w"],["#prH","h"],["#prCols","cols"],["#prRows","rows"],["#prTop","top"],["#prLeft","left"],["#prGapX","gapX"],["#prGapY","gapY"]].forEach(([id,k]) => $(id).value = s[k]);
}
function readSpecInputs(){
  const c = {from:S.print.sheet};
  [["#prW","w"],["#prH","h"],["#prCols","cols"],["#prRows","rows"],["#prTop","top"],["#prLeft","left"],["#prGapX","gapX"],["#prGapY","gapY"]].forEach(([id,k]) => c[k] = num($(id).value));
  c.cols = Math.max(1, Math.round(c.cols)); c.rows = Math.max(1, Math.round(c.rows));
  S.print.custom = c; save();
}
["#prW","#prH","#prCols","#prRows","#prTop","#prLeft","#prGapX","#prGapY"].forEach(id => $(id).addEventListener("input", () => { readSpecInputs(); drawSheetPreview(); }));
$("#prSheet").addEventListener("change", e => { S.print.sheet = e.target.value; S.print.custom = null; save(); fillSpecInputs(); drawSheetPreview(); });
["#prProduct","#prDate","#prCount","#prStart"].forEach(id => $(id).addEventListener("input", drawSheetPreview));
$("#prBorder").addEventListener("change", e => { S.print.border = e.target.checked; save(); drawSheetPreview(); });

function buildSheets(){
  const p = prod($("#prProduct").value); if (!p) return {html:"", pages:0, over:false};
  const s = sheetSpec();
  const per = s.cols * s.rows;
  const start = Math.max(1, Math.round(num($("#prStart").value) || 1)) - 1;
  const count = Math.max(1, Math.min(500, Math.round(num($("#prCount").value) || 1)));
  const L = buildLabel(p, {date: $("#prDate").value});
  $("#prLimit").textContent = `${L.limitType.replace(/&amp;/g,"&")} ${L.limit}`;
  const inner = labelHTML(L);
  const total = start + count;
  const pages = Math.ceil(total / per);
  let html = "";
  for (let pg = 0; pg < pages; pg++){
    html += `<div class="sheet ${S.print.border?"bordered":""}">`;
    for (let k = 0; k < per; k++){
      const n = pg*per + k;
      const col = k % s.cols, row = Math.floor(k / s.cols);
      const x = s.left + col*(s.w + s.gapX), y = s.top + row*(s.h + s.gapY);
      const filled = n >= start && n < total;
      html += `<div class="slot ${filled?"":"blank"}" style="left:${x}mm;top:${y}mm;width:${s.w}mm;height:${s.h}mm">${filled?`<div class="label-box" style="width:100%;height:100%">${inner}</div>`:""}</div>`;
    }
    html += `</div>`;
  }
  return {html, pages, per, L};
}
function drawSheetPreview(){
  const r = buildSheets();
  const pv = $("#sheetPreview");
  pv.innerHTML = r.html;
  let over = false;
  $$(".label-box", pv).forEach(b => { if (fit(b) < 0) over = true; });
  const info = document.createElement("p"); info.className = "muted";
  info.textContent = r.pages ? `A4 ${r.pages}枚(1枚に${r.per}面)` + (over ? "。ラベルに入りきらない文字があります。大きい用紙を選んでください。" : "") : "商品がありません。";
  if (over) info.classList.add("err-text");
  pv.prepend(info);
}
$("#doPrint").addEventListener("click", () => {
  const r = buildSheets(); if (!r.pages) return;
  const area = $("#printArea");
  area.innerHTML = `<style>@page{size:A4;margin:0}</style>` + r.html;
  document.body.classList.add("printing-labels");
  $$(".label-box", area).forEach(fit);
  window.print();
});
window.addEventListener("afterprint", () => { document.body.classList.remove("printing-labels","printing-matrix"); $("#printArea").innerHTML = ""; });

/* ---------- matrix tab ---------- */
function matrixHTML(){
  const rows = S.products.map(p => ({p, L: buildLabel(p)}));
  const head = `<tr><th class="pn">商品</th>${ALL_ALLERGENS.map(a => `<th class="${D.MANDATORY.includes(a)?"m":""}"><span>${esc(a)}</span></th>`).join("")}</tr>`;
  const body = rows.map(({p,L}) => `<tr><th class="pn">${esc(p.name)}</th>${ALL_ALLERGENS.map(a => `<td>${L.allergens.includes(a)?"●":""}</td>`).join("")}</tr>`).join("");
  return `<div class="matrix-scroll"><table class="matrix"><thead>${head}</thead><tbody>${body}</tbody></table></div>
    <p class="muted">● … 原材料に含む。網かけの列は表示義務の9品目。この表は登録した原材料の情報から作っています。製造ラインでの混入(コンタミネーション)は含みません。作成日: ${addDays(null,0)}</p>`;
}
function renderMatrix(){
  const w = $("#matrixWrap");
  if (!isPro()){
    w.innerHTML = `<div class="locked"><p><b>アレルゲン一覧表は先行予約版の機能です。</b>登録した全商品のアレルゲンを1枚の表にして、店頭に掲示したり、お客様の質問にすぐ答えたりできます。</p>
      <a class="btn" href="./#price">先行予約について(¥1,980・買い切り)</a></div>
      <div class="ghosted" aria-hidden="true">${matrixHTML()}</div>`;
    $("#printMatrix").disabled = true; return;
  }
  $("#printMatrix").disabled = false;
  w.innerHTML = S.products.length ? matrixHTML() : `<p class="muted">商品がありません。</p>`;
}
$("#printMatrix").addEventListener("click", () => {
  if (!isPro()) return;
  $("#printArea").innerHTML = `<style>@page{size:A4 landscape;margin:10mm}</style><div class="matrix-print"><h1>アレルゲン一覧表</h1>${matrixHTML()}<p>${esc(S.maker.name)}</p></div>`;
  document.body.classList.add("printing-matrix");
  window.print();
});

/* ---------- settings ---------- */
function renderSettings(){
  $("#stRole").value = S.maker.role; $("#stName").value = S.maker.name; $("#stAddr").value = S.maker.addr;
  $("#stKey").value = S.pro.key || "";
  $("#keyMsg").textContent = isPro() ? "登録済みです。商品数の制限はありません。" : "";
}
$("#stRole").addEventListener("change", e => { S.maker.role = e.target.value; save(); });
$("#stName").addEventListener("input", e => { S.maker.name = e.target.value; save(); });
$("#stAddr").addEventListener("input", e => { S.maker.addr = e.target.value; save(); });
$("#exportData").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(S, null, 1)], {type:"application/json"});
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  const d = new Date(); a.download = `label-cho_backup_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}.json`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast("バックアップを書き出しました");
});
$("#importData").addEventListener("change", async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const o = JSON.parse(await f.text());
    if (!o || o.v !== 1 || !Array.isArray(o.products) || !Array.isArray(o.ingredients)) throw new Error("形式");
    if (!confirm("今のデータを、このバックアップで置き換えます。よろしいですか?")) return;
    S = Object.assign(blank(), o); cur.productId = S.products[0]?.id || null; save(); renderPlan(); toast("バックアップを読み込みました"); showTab("products");
  } catch(err){ toast("読み込めませんでした。ラベル帳で書き出したファイルか確認してください"); }
  e.target.value = "";
});
async function verifyKey(k){
  k = (k||"").trim().toUpperCase();
  const m = /^LC-([A-Z0-9]{8})-([A-F0-9]{4})$/.exec(k); if (!m) return false;
  if (!(window.crypto && crypto.subtle)) return false;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("label-cho:" + m[1]));
  const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("").toUpperCase();
  return hex.slice(0,4) === m[2];
}
$("#applyKey").addEventListener("click", async () => {
  const k = $("#stKey").value;
  if (await verifyKey(k)){ S.pro = {key:k.trim().toUpperCase(), verified:true}; save(); renderPlan(); $("#keyMsg").textContent = "登録しました。商品数の制限がなくなりました。"; toast("利用キーを登録しました"); }
  else { $("#keyMsg").textContent = "キーが正しくありません。メールに書かれたキー(LC- で始まる文字)をそのまま貼り付けてください。"; }
});
$("#resetAll").addEventListener("click", () => {
  if (!confirm("商品・原材料・設定をすべて消します。先にバックアップを書き出すことをおすすめします。消しますか?")) return;
  const pro = S.pro; S = blank(); S.pro = pro; cur.productId = null; cur.ingredientId = null; save(); toast("データを消しました"); showTab("products");
});

/* ---------- boot ---------- */
(async function(){
  if (S.pro.key && !S.pro.verified) S.pro.verified = await verifyKey(S.pro.key);
  if (S.pro.verified && !(await verifyKey(S.pro.key))) S.pro.verified = false;
  $("#storageWarn").hidden = storageOK;
  renderPlan();
  const t = (location.hash || "").slice(1);
  showTab(["products","ingredients","print","matrix","settings"].includes(t) ? t : "products");
  save();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (cur.tab === "products") updatePreview(); if (cur.tab === "print") drawSheetPreview(); });
})();
window.LabelCho = { buildLabel: id => buildLabel(prod(id)), state: () => S };
})();
