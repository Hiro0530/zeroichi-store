/* ひかえ — 現場カルテ・箱の在庫・古物台帳。データはこの端末(IndexedDB)の中だけに保存します。 ZEROICHI WORKS */
(function(){
"use strict";

const FREE = { customers: 3, jobs: 10, boxes: 10, ledger: 20 };
const KEY_SALT = "hikae:";
const APP_URL = new URL("app.html", location.href).href.split("#")[0];
const MAIL = "zeroichi.works.jp@gmail.com";

/* ---------- utilities ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const sama = n => String(n || "").replace(/\s*(様|さま|御中)\s*$/, "");
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const yen = n => "¥" + Math.round(Number(n) || 0).toLocaleString("ja-JP");
const num = v => { const n = parseFloat(String(v ?? "").normalize("NFKC").replace(/[,，円¥\s]/g, "")); return isFinite(n) ? n : 0; };
const jdate = s => { if (!s) return ""; const [y, m, d] = s.split("-").map(Number); return `${y}年${m}月${d}日`; };
const norm = s => String(s ?? "").normalize("NFKC").toLowerCase().replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
let toastT;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 2600); }

/* ---------- IndexedDB ---------- */
const STORES = ["customers", "jobs", "boxes", "ledger", "photos", "meta"];
let db;
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("hikae", 1);
    r.onupgradeneeded = () => { const d = r.result; STORES.forEach(s => { if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: "id" }); }); };
    r.onsuccess = () => { db = r.result; res(); };
    r.onerror = () => rej(r.error);
  });
}
const tx = (s, mode, fn) => new Promise((res, rej) => { const t = db.transaction(s, mode); const out = fn(t.objectStore(s)); t.oncomplete = () => res(out && out.result); t.onerror = () => rej(t.error); });
const dbAll = s => tx(s, "readonly", st => st.getAll());
const dbGet = (s, id) => tx(s, "readonly", st => st.get(id));
const dbPut = (s, o) => tx(s, "readwrite", st => st.put(o));
const dbDel = (s, id) => tx(s, "readwrite", st => st.delete(id));
const dbClear = s => tx(s, "readwrite", st => st.clear());

/* ---------- state ---------- */
const S = { customers: [], jobs: [], boxes: [], ledger: [], settings: null, pro: { key: "", ok: false } };
const defaults = () => ({ id: "settings", shop: "", addr: "", tel: "", mail: "", regno: "", taxRate: 10, round: "floor", kobutsuNo: "", kobutsuIssuer: "", noteFoot: "お見積りの有効期限は発行日から30日です。" });
async function load() {
  for (const s of ["customers", "jobs", "boxes", "ledger"]) S[s] = await dbAll(s);
  S.settings = Object.assign(defaults(), await dbGet("meta", "settings") || {});
  const bk = await dbGet("meta", "backup"); S.lastBackup = bk?.at || 0;
  const pro = await dbGet("meta", "pro");
  S.pro = { key: pro?.key || "", ok: false };
  if (S.pro.key) S.pro.ok = await verifyKey(S.pro.key);
}
function list(s) { return S[s]; }
function find(s, id) { return S[s].find(o => o.id === id); }
async function save(s, o) { o.updated = Date.now(); const a = S[s]; const i = a.findIndex(x => x.id === o.id); if (i < 0) a.push(o); else a[i] = o; await dbPut(s, o); flashSaved(); }
async function remove(s, o) { for (const pid of o.photos || []) await dbDel("photos", pid); S[s] = S[s].filter(x => x.id !== o.id); await dbDel(s, o.id); }
function flashSaved() { const el = $(".saved"); if (!el) return; el.classList.add("on"); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("on"), 1400); }

/* ---------- key ---------- */
async function verifyKey(k) {
  k = (k || "").trim().toUpperCase();
  const m = /^HK-([A-Z0-9]{8})-([A-F0-9]{4})$/.exec(k); if (!m) return false;
  if (!(window.crypto && crypto.subtle)) return false;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(KEY_SALT + m[1]));
  const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  return hex.slice(0, 4) === m[2];
}
function canAdd(kind) {
  if (S.pro.ok) return true;
  const n = S[kind].length;
  if (n < FREE[kind]) return true;
  limitSheet(kind); return false;
}
const KIND_LABEL = { customers: "お客さま", jobs: "作業", boxes: "箱", ledger: "台帳の行" };
function limitSheet(kind) {
  openSheet(`<h2>無料版はここまでです</h2>
  <p>無料版で登録できる${KIND_LABEL[kind]}は${FREE[kind]}件までです。今までのデータはそのまま見られます。印刷・CSV・バックアップも使えます。</p>
  <p>利用キー(買い切り ¥2,980)を入れると、件数の制限がなくなります。</p>
  <div class="row-btns"><a class="btn" href="./#price">先行予約について見る</a><button class="btn ghost" data-go="#settings">利用キーを入れる</button></div>`);
}
function planBadge() {
  const b = $("#planBadge");
  b.innerHTML = S.pro.ok ? `<span class="dot ok"></span>利用キー登録済み` : `<span class="dot"></span>無料版`;
}

/* ---------- photos ---------- */
const urlCache = new Map();
async function photoURL(id) {
  if (urlCache.has(id)) return urlCache.get(id);
  const p = await dbGet("photos", id); if (!p) return "";
  const u = URL.createObjectURL(p.blob); urlCache.set(id, u); return u;
}
function shrink(file, max = 1600, board = null) {
  return new Promise((res, rej) => {
    const img = new Image(); const u = URL.createObjectURL(file);
    img.onload = () => {
      const r = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * r); c.height = Math.round(img.naturalHeight * r);
      const g = c.getContext("2d"); g.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u);
      if (board) drawBoard(g, c.width, c.height, board);
      c.toBlob(b => b ? res(b) : rej(new Error("画像")), "image/jpeg", 0.82);
    };
    img.onerror = () => { URL.revokeObjectURL(u); rej(new Error("画像を読み込めませんでした")); };
    img.src = u;
  });
}
/* 小黒板: 写真の左下に工事名・日付・場所・メモを焼き込む */
function drawBoard(g, W, H, rows) {
  rows = rows.filter(r => r[1]);
  if (!rows.length) return;
  const u = Math.max(W, H) / 1600, fs = Math.round(32 * u), pad = Math.round(16 * u), lh = Math.round(fs * 1.55), kw = Math.round(fs * 3.6);
  g.font = `${fs}px "BIZ UDPGothic", "Hiragino Sans", "Noto Sans JP", sans-serif`;
  const maxV = Math.min(W * 0.62, Math.max(...rows.map(r => g.measureText(r[1]).width)) + 4);
  const bw = Math.round(kw + maxV + pad * 3), bh = Math.round(rows.length * lh + pad * 2 - (lh - fs) + 4);
  const x = Math.round(14 * u), y = H - bh - Math.round(14 * u);
  g.fillStyle = "rgba(28,64,48,.92)"; g.fillRect(x, y, bw, bh);
  g.strokeStyle = "rgba(255,255,255,.85)"; g.lineWidth = Math.max(1, 2 * u); g.strokeRect(x + 3 * u, y + 3 * u, bw - 6 * u, bh - 6 * u);
  g.textBaseline = "top";
  rows.forEach((r, i) => {
    const ty = y + pad + i * lh;
    if (i) { g.beginPath(); g.moveTo(x + pad / 2, ty - (lh - fs) / 2); g.lineTo(x + bw - pad / 2, ty - (lh - fs) / 2); g.strokeStyle = "rgba(255,255,255,.35)"; g.stroke(); }
    g.fillStyle = "rgba(255,255,255,.75)"; g.fillText(r[0], x + pad, ty);
    g.fillStyle = "#fff"; let v = r[1]; while (g.measureText(v).width > maxV && v.length > 1) v = v.slice(0, -2) + "…";
    g.fillText(v, x + pad * 2 + kw, ty);
  });
}
function boardRows(store, obj) {
  if (store !== "jobs" || !obj.board) return null;
  const c = find("customers", obj.customerId);
  return [["工事名", obj.title || ""], ["日付", jdate(obj.date)], ["場所", obj.place || c?.addr || ""], ["メモ", obj.boardNote || ""]];
}
let photoTarget = null;
function pickPhotos(store, obj) { photoTarget = { store, obj }; $("#photoInput").value = ""; $("#photoInput").click(); }
$("#photoInput").addEventListener("change", async e => {
  const files = Array.from(e.target.files || []); if (!files.length || !photoTarget) return;
  const { store, obj } = photoTarget; obj.photos = obj.photos || [];
  for (const f of files) {
    try { const blob = await shrink(f, 1600, boardRows(store, obj)); const id = uid(); await dbPut("photos", { id, blob, at: Date.now() }); obj.photos.push(id); }
    catch (err) { toast("写真を読み込めませんでした"); }
  }
  await save(store, obj); toast(`写真を${files.length}枚追加しました`); render();
});
async function fillPhotos(root = document) {
  for (const im of $$("img[data-pid]", root)) { if (!im.src || im.src === location.href) im.src = await photoURL(im.dataset.pid); }
}
function photoStrip(store, obj, label = "写真を追加") {
  const ps = obj.photos || [];
  return `<div class="photos">${ps.map(p => `<button class="ph" data-photo="${p}" data-store="${store}" data-id="${obj.id}" aria-label="写真を大きく見る"><img data-pid="${p}" alt=""></button>`).join("")}
  <button class="ph add" data-addphoto="${store}" data-id="${obj.id}"><svg viewBox="0 0 24 24"><path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg><span>${label}</span></button></div>`;
}

/* ---------- sheet (dialog) ---------- */
function openSheet(html) {
  const w = $("#sheet"); w.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><button class="x" data-close aria-label="閉じる">×</button>${html}</div>`;
  w.hidden = false; requestAnimationFrame(() => w.classList.add("on"));
  fillPhotos(w); const f = w.querySelector("button,a,input"); f && f.focus();
}
function closeSheet() { const w = $("#sheet"); w.classList.remove("on"); w.hidden = true; w.innerHTML = ""; }
$("#sheet").addEventListener("click", e => { if (e.target.id === "sheet" || e.target.closest("[data-close]")) closeSheet(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#sheet").hidden) closeSheet(); });

/* ---------- routing ---------- */
let route = { name: "search", id: null };
function parse() {
  const h = decodeURIComponent((location.hash || "#search").slice(1)); const [name, id] = h.split("/");
  return { name: name || "search", id: id || null };
}
const V = $("#view");
async function render() {
  cleanupBlank();
  route = parse();
  const tabOf = { customer: "customers", job: "customers", box: "boxes", b: "boxes", labels: "boxes", entry: "ledger" };
  const tab = tabOf[route.name] || route.name;
  $$(".nav").forEach(a => a.classList.toggle("on", a.dataset.tab === tab));
  const fn = VIEWS[route.name] || VIEWS.search;
  V.innerHTML = fn(route.id) || "";
  bindView();
  await fillPhotos(V);
  planBadge();
}
window.addEventListener("hashchange", () => { closeSheet(); render().then(() => { V.focus({ preventScroll: true }); window.scrollTo(0, 0); }); });
function go(h) { if (location.hash === h) render(); else location.hash = h; }

/* blank records created by "+" are removed if left empty */
let freshly = null;
function cleanupBlank() {
  if (!freshly) return;
  if (parse().id === freshly.id) return; const { store, id, field } = freshly; freshly = null;
  const o = find(store, id); if (o && !String(o[field] || "").trim() && !(o.photos || []).length) remove(store, o);
}

/* ---------- common bits ---------- */
const head = (title, back, extra = "") => `<header class="vh">${back ? `<a class="back" href="${back}" aria-label="戻る"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></a>` : ""}<h1>${esc(title)}</h1><span class="saved" aria-hidden="true">保存しました</span>${extra}</header>`;
const field = (label, name, val, opt = {}) => {
  const id = "f_" + name;
  const tag = opt.area ? `<textarea id="${id}" name="${name}" rows="${opt.rows || 3}" placeholder="${esc(opt.ph || "")}">${esc(val)}</textarea>`
    : opt.options ? `<select id="${id}" name="${name}">${opt.options.map(o => `<option${o === val ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>`
    : `<input id="${id}" name="${name}" type="${opt.type || "text"}" value="${esc(val)}" placeholder="${esc(opt.ph || "")}"${opt.mode ? ` inputmode="${opt.mode}"` : ""}${opt.ac ? ` autocomplete="${opt.ac}"` : ' autocomplete="off"'}>`;
  return `<label class="fld${opt.wide ? " wide" : ""}${opt.cls ? " " + opt.cls : ""}" for="${id}"><span>${label}${opt.req ? '<em>必須</em>' : ""}</span>${tag}${opt.hint ? `<small>${opt.hint}</small>` : ""}</label>`;
};
const empty = (title, body, btn) => `<div class="empty"><p class="t">${title}</p><p>${body}</p>${btn || ""}</div>`;
const relTime = t => { if (!t) return ""; const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()}`; };

/* ---------- VIEWS ---------- */
const VIEWS = {};

VIEWS.search = () => {
  const counts = [["customers", "お客さま"], ["boxes", "箱"], ["ledger", "台帳"]];
  const recent = [
    ...S.jobs.map(o => ({ t: o.updated, html: rowJob(o) })),
    ...S.boxes.map(o => ({ t: o.updated, html: rowBox(o) })),
    ...S.ledger.map(o => ({ t: o.updated, html: rowLedger(o) })),
    ...S.customers.map(o => ({ t: o.updated, html: rowCustomer(o) })),
  ].sort((a, b) => b.t - a.t).slice(0, 8);
  const total = S.customers.length + S.boxes.length + S.ledger.length;
  const days = S.lastBackup ? Math.floor((Date.now() - S.lastBackup) / 864e5) : null;
  const banner = total && (days === null || days >= 7) ? `<div class="bk-banner"><p><b>${days === null ? "まだバックアップがありません" : `最後のバックアップから${days}日たちました`}</b><span>データはこの端末の中だけにあります。1タップで、写真ごと1つのファイルに書き出せます。</span></p><button class="btn sm" data-backup>今すぐ書き出す</button></div>` : "";
  return `<header class="vh home"><h1 class="mincho">さがす</h1></header>
  <div class="searchbox"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>
    <input id="q" type="search" placeholder="名前・品名・置き場所・メモで探す" autocomplete="off" aria-label="検索"></div>
  <div class="quick">
    <button class="qa" data-new="customers"><b>お客さま</b><span>カルテを作る</span></button>
    <button class="qa" data-new="boxes"><b>箱</b><span>写真で登録</span></button>
    <button class="qa" data-new="ledger" data-dir="in"><b>受入れ</b><span>台帳に記録</span></button>
  </div>
  ${banner}<div id="results"></div>
  <section id="recent" class="block">
    <h2 class="sh">最近さわったもの</h2>
    ${recent.length ? `<div class="list">${recent.map(r => r.html).join("")}</div>` : empty("まだ何もありません", "上のボタンから、お客さま・箱・台帳のどれかを1件登録してみてください。ここに新しい順に並びます。")}
    <p class="counts">${counts.map(([k, l]) => `${l} ${S[k].length}${S.pro.ok ? "" : `<small>/${FREE[k]}</small>`}`).join("　")}</p>
  </section>`;
};
function rowCustomer(o) {
  const jobs = S.jobs.filter(j => j.customerId === o.id).length;
  return `<a class="row" href="#customer/${o.id}"><span class="kind k-c">客</span><span class="main"><b>${esc(o.name || "名前未入力")}</b><small>${esc(o.addr || o.tel || "")}</small></span><span class="meta">作業 ${jobs}</span></a>`;
}
function rowJob(o) {
  const c = find("customers", o.customerId);
  return `<a class="row" href="#job/${o.id}"><span class="kind k-j">作</span><span class="main"><b>${esc(o.title || "作業名未入力")}</b><small>${esc(c?.name || "")}${o.date ? "　" + jdate(o.date) : ""}</small></span><span class="meta st-${o.status === "完了" ? "done" : "open"}">${esc(o.status || "")}</span></a>`;
}
function rowBox(o) {
  return `<a class="row" href="#box/${o.id}">${o.photos?.length ? `<img class="rimg" data-pid="${o.photos[0]}" alt="">` : `<span class="kind k-b">箱</span>`}<span class="main"><b>${esc(o.code)}　${esc(o.name || "名前未入力")}</b><small>${esc(o.place || "置き場所未入力")}</small></span><span class="meta">${relTime(o.updated)}</span></a>`;
}
function rowLedger(o) {
  return `<a class="row" href="#entry/${o.id}"><span class="kind ${o.dir === "in" ? "k-in" : "k-out"}">${o.dir === "in" ? "受" : "払"}</span><span class="main"><b>${esc(o.item || "品目未入力")}</b><small>${jdate(o.date)}　${esc(o.kind)}　${esc(o.party?.name || "")}</small></span><span class="meta">${o.price ? yen(o.price) : ""}</span></a>`;
}
function searchAll(q) {
  const terms = norm(q).split(/\s+/).filter(Boolean); if (!terms.length) return null;
  const hit = (...fields) => { const t = norm(fields.join(" ")); return terms.every(w => t.includes(w)); };
  const cust = S.customers.filter(o => hit(o.name, o.kana, o.tel, o.addr, o.note));
  const jobs = S.jobs.filter(o => { const c = find("customers", o.customerId); return hit(o.title, o.place, o.note, c?.name, c?.kana, (o.measures || []).map(m => m.k + " " + m.v).join(" "), (o.materials || []).map(m => m.name + " " + m.note).join(" "), (o.est || []).map(m => m.name).join(" ")); });
  const boxes = S.boxes.filter(o => hit(o.code, o.name, o.place, o.contents, o.tags));
  const led = S.ledger.filter(o => hit(o.item, o.features, o.kind, o.party?.name, o.party?.addr, o.note));
  return { cust, jobs, boxes, led };
}
function renderResults(q) {
  const r = searchAll(q); const box = $("#results"), rec = $("#recent");
  if (!r) { box.innerHTML = ""; rec.hidden = false; return; }
  rec.hidden = true;
  const grp = (t, a, fn) => a.length ? `<section class="block"><h2 class="sh">${t}<small>${a.length}件</small></h2><div class="list">${a.slice(0, 30).map(fn).join("")}</div></section>` : "";
  const html = grp("箱", r.boxes, rowBox) + grp("作業", r.jobs, rowJob) + grp("お客さま", r.cust, rowCustomer) + grp("古物台帳", r.led, rowLedger);
  box.innerHTML = html || empty(`「${esc(q)}」は見つかりませんでした`, "言葉を短くするか、ひらがなで入れてみてください。箱の中身・メモ・特徴の文字も探します。");
  fillPhotos(box);
}

/* customers */
VIEWS.customers = () => {
  const a = [...S.customers].sort((x, y) => (x.kana || x.name || "").localeCompare(y.kana || y.name || "", "ja"));
  return head("カルテ") + `
  <div class="toolbar"><input id="filter" type="search" placeholder="お客さまの名前で絞り込む" aria-label="絞り込み"><button class="btn" data-new="customers">＋ お客さま</button></div>
  ${a.length ? `<div class="list" id="flist">${a.map(rowCustomer).join("")}</div>` : empty("お客さまはまだいません", "お客さまごとに、作業の記録・写真・寸法・見積をまとめて残せます。", `<button class="btn" data-new="customers">最初のお客さまを登録</button>`)}
  ${limitLine("customers")}`;
};
function limitLine(kind) { return S.pro.ok ? "" : `<p class="limit">無料版: ${KIND_LABEL[kind]} ${S[kind].length} / ${FREE[kind]}件</p>`; }
VIEWS.customer = id => {
  const o = find("customers", id); if (!o) return notFound();
  const jobs = S.jobs.filter(j => j.customerId === id).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return head(o.name || "新しいお客さま", "#customers") + `
  <form class="card form" data-store="customers" data-id="${id}">
    ${field("お名前", "name", o.name, { req: true, ph: "例: 山田 様 / 山田工務店" })}
    ${field("ふりがな", "kana", o.kana, { ph: "やまだ" })}
    ${field("電話", "tel", o.tel, { type: "tel", mode: "tel" })}
    ${field("住所・現場", "addr", o.addr, { wide: true })}
    ${field("覚えておくこと", "note", o.note, { area: true, wide: true, ph: "好み・注意点・駐車場の場所など" })}
  </form>
  <section class="block">
    <div class="sh-row"><h2 class="sh">作業の記録<small>${jobs.length}件</small></h2><button class="btn sm" data-newjob="${id}">＋ 作業を追加</button></div>
    ${jobs.length ? `<div class="list">${jobs.map(rowJob).join("")}</div>` : empty("作業はまだありません", "1回の施術・1件の工事ごとに、写真・寸法・材料・見積を残せます。")}
  </section>
  <div class="danger"><button class="link-danger" data-del="customers" data-id="${id}">このお客さまを削除</button></div>`;
};

/* jobs */
const STATUS = ["見積中", "作業中", "完了"];
VIEWS.job = id => {
  const o = find("jobs", id); if (!o) return notFound();
  const c = find("customers", o.customerId);
  o.measures = o.measures || []; o.materials = o.materials || []; o.est = o.est || [];
  return head(o.title || "新しい作業", c ? `#customer/${c.id}` : "#customers", `<button class="btn sm" data-print="job" data-id="${id}">印刷・PDF</button>`) + `
  <p class="crumb">${esc(c?.name || "")}</p>
  <form class="card form" data-store="jobs" data-id="${id}">
    ${field("作業名", "title", o.title, { req: true, ph: "例: 駐車場土間コン打ち / カット＋カラー", wide: true })}
    ${field("日付", "date", o.date, { type: "date" })}
    ${field("状態", "status", o.status, { options: STATUS })}
    ${field("場所", "place", o.place, { wide: true, ph: "現場の住所・席番号など" })}
  </form>
  <section class="block"><h2 class="sh">写真</h2>
    <form class="board-opt" data-store="jobs" data-id="${id}"><label class="sw"><input type="checkbox" name="board"${o.board ? " checked" : ""}><span>黒板を入れる</span></label>
    <input name="boardNote" value="${esc(o.boardNote)}" placeholder="黒板のメモ(例: 床掘り 完了)" aria-label="黒板のメモ"${o.board ? "" : " hidden"}></form>
    <p class="hint">${o.board ? "これから追加する写真の左下に、工事名・日付・場所・メモが入ります。" : "オンにすると、写真の左下に工事名・日付・場所を入れられます(小黒板の代わり)。"}</p>
    ${photoStrip("jobs", o, "撮る・選ぶ")}</section>
  <section class="block"><div class="sh-row"><h2 class="sh">寸法・メモ</h2><button class="btn sm ghost" data-addrow="measures">＋ 行を追加</button></div>
    <div class="grid-rows g2" data-rows="measures">${o.measures.map((m, i) => `<div class="gr"><input data-k="k" data-i="${i}" value="${esc(m.k)}" placeholder="項目(例: 間口)" aria-label="項目"><input data-k="v" data-i="${i}" value="${esc(m.v)}" placeholder="値(例: 5,400mm)" aria-label="値"><button class="rm" data-rm="${i}" aria-label="この行を消す">×</button></div>`).join("") || `<p class="hint">項目と値を1行ずつ。例: 間口 5,400mm / 薬剤 6%＋3%</p>`}</div></section>
  <section class="block"><div class="sh-row"><h2 class="sh">使った材料</h2><button class="btn sm ghost" data-addrow="materials">＋ 行を追加</button></div>
    <div class="grid-rows g3" data-rows="materials">${o.materials.map((m, i) => `<div class="gr"><input data-k="name" data-i="${i}" value="${esc(m.name)}" placeholder="品名・品番" aria-label="品名"><input data-k="qty" data-i="${i}" value="${esc(m.qty)}" placeholder="数量" aria-label="数量" inputmode="decimal"><input data-k="note" data-i="${i}" value="${esc(m.note)}" placeholder="メモ(色・ロット)" aria-label="メモ"><button class="rm" data-rm="${i}" aria-label="この行を消す">×</button></div>`).join("") || `<p class="hint">次回同じ色・同じ材料を使うときの控えになります。</p>`}</div></section>
  <section class="block"><div class="sh-row"><h2 class="sh">見積</h2><button class="btn sm ghost" data-addrow="est">＋ 行を追加</button></div>
    <div class="grid-rows est" data-rows="est">${o.est.length ? `<div class="gr gh"><span>品名</span><span>数量</span><span>単位</span><span>単価</span><span class="r">金額</span><span></span></div>` : ""}${o.est.map((m, i) => `<div class="gr"><input data-k="name" data-i="${i}" value="${esc(m.name)}" placeholder="品名・作業" aria-label="品名"><input data-k="qty" data-i="${i}" value="${esc(m.qty)}" inputmode="decimal" aria-label="数量" placeholder="1"><input data-k="unit" data-i="${i}" value="${esc(m.unit)}" aria-label="単位" placeholder="式"><input data-k="price" data-i="${i}" value="${esc(m.price)}" inputmode="numeric" aria-label="単価" placeholder="0"><output class="amt" data-amt="${i}">${yen(lineAmt(m))}</output><button class="rm" data-rm="${i}" aria-label="この行を消す">×</button></div>`).join("") || `<p class="hint">行を追加して、品名・数量・単価を入れると合計が出ます。</p>`}</div>
    <div class="totals" id="totals">${totalsHTML(o)}</div>
  </section>
  <form class="card form" data-store="jobs" data-id="${id}">
    ${field("値引き(円)", "discount", o.discount || "", { mode: "numeric", ph: "0" })}
    ${field("お客さまへのメモ", "note", o.note, { area: true, wide: true, ph: "書類の下に印刷されます。例: 次回のメンテナンスは半年後が目安です。" })}
  </form>
  <div class="danger"><button class="link-danger" data-del="jobs" data-id="${id}">この作業を削除</button></div>`;
};
function lineAmt(m) { return Math.round(num(m.qty || (m.price ? 1 : 0)) * num(m.price)); }
function calc(o) {
  const sub = (o.est || []).reduce((a, m) => a + lineAmt(m), 0);
  const disc = Math.min(num(o.discount), sub);
  const base = sub - disc; const rate = num(S.settings.taxRate);
  const r = { floor: Math.floor, round: Math.round, ceil: Math.ceil }[S.settings.round] || Math.floor;
  const tax = r(base * rate / 100);
  return { sub, disc, base, rate, tax, total: base + tax };
}
function totalsHTML(o) {
  const t = calc(o);
  return `<dl><dt>小計</dt><dd>${yen(t.sub)}</dd>${t.disc ? `<dt>値引き</dt><dd>−${yen(t.disc)}</dd>` : ""}<dt>消費税(${t.rate}%)</dt><dd>${yen(t.tax)}</dd><dt class="tt">合計(税込)</dt><dd class="tt" id="grand">${yen(t.total)}</dd></dl>`;
}

/* boxes */
VIEWS.boxes = () => {
  const a = [...S.boxes].sort((x, y) => x.code.localeCompare(y.code));
  return head("箱", "", `<a class="btn sm ghost" href="#labels">QRラベル印刷</a>`) + `
  <div class="toolbar"><input id="filter" type="search" placeholder="箱の名前・中身・置き場所で絞り込む" aria-label="絞り込み"><button class="btn" data-new="boxes">＋ 箱</button></div>
  ${a.length ? `<div class="tiles" id="flist">${a.map(o => `<a class="tile" href="#box/${o.id}" data-text="${esc(norm([o.code, o.name, o.place, o.contents, o.tags].join(" ")))}">
    <span class="tp">${o.photos?.length ? `<img data-pid="${o.photos[0]}" alt="">` : `<svg viewBox="0 0 24 24"><path d="M3.5 8l8.5-4 8.5 4v9l-8.5 4-8.5-4z"/><path d="M3.5 8l8.5 4 8.5-4M12 12v9"/></svg>`}</span>
    <span class="tc">${esc(o.code)}</span><b>${esc(o.name || "名前未入力")}</b><small>${esc(o.place || "")}</small></a>`).join("")}</div>`
    : empty("箱はまだありません", "1つずつ品物を登録しなくて大丈夫です。箱や棚の写真を撮って、中身をざっと書くだけ。QRラベルを貼れば、スマホで読み取るとその箱のページが開きます。", `<button class="btn" data-new="boxes">最初の箱を登録</button>`)}
  ${limitLine("boxes")}`;
};
VIEWS.b = code => { const o = S.boxes.find(x => x.code === code); if (o) { setTimeout(() => location.replace("#box/" + o.id), 0); return ""; } return notFound(); };
VIEWS.box = id => {
  const o = find("boxes", id); if (!o) return notFound();
  const inLedger = S.ledger.filter(l => l.boxId === id);
  return head(`${o.code}　${o.name || "新しい箱"}`, "#boxes", `<button class="btn sm" data-labelone="${id}">QRラベル</button>`) + `
  <section class="block">${photoStrip("boxes", o, "箱・棚を撮る")}</section>
  <form class="card form" data-store="boxes" data-id="${id}">
    ${field("箱の名前", "name", o.name, { req: true, ph: "例: 外構金物 小物 / カラー剤 在庫" })}
    ${field("置き場所", "place", o.place, { ph: "例: 倉庫 右棚 上段" })}
    ${field("中身", "contents", o.contents, { area: true, rows: 5, wide: true, ph: "1行に1つ。ざっくりで大丈夫です。\n例: 束石 20個\nステンビス 50mm 2箱" })}
    ${field("タグ", "tags", o.tags, { wide: true, ph: "例: 予備 / 返品待ち / 古物" })}
  </form>
  ${inLedger.length ? `<section class="block"><h2 class="sh">この箱に入っている古物</h2><div class="list">${inLedger.map(rowLedger).join("")}</div></section>` : ""}
  <div class="danger"><button class="link-danger" data-del="boxes" data-id="${id}">この箱を削除</button></div>`;
};
VIEWS.labels = () => {
  const a = [...S.boxes].sort((x, y) => x.code.localeCompare(y.code));
  return head("QRラベル印刷", "#boxes") + (a.length ? `
  <p class="lead">印刷する箱を選んでください。A4の普通紙やラベル用紙に印刷して、切って貼ります。スマホのカメラで読むと、その箱のページが開きます(この端末で登録した箱のみ)。</p>
  <div class="card form"><label class="fld"><span>大きさ</span><select id="lsize"><option value="l">大(1枚に8枚・2列)</option><option value="s">小(1枚に24枚・3列)</option></select></label></div>
  <div class="checks">${a.map(o => `<label class="ck"><input type="checkbox" value="${o.id}" checked><span><b>${esc(o.code)}</b> ${esc(o.name)}</span></label>`).join("")}</div>
  <div class="row-btns"><button class="btn" data-printlabels>選んだラベルを印刷</button></div>` : empty("箱がまだありません", "先に箱を登録すると、ここでQRラベルを印刷できます。"));
};

/* ledger */
const IN_KINDS = ["買受け", "交換", "委託"];
const OUT_KINDS = ["売却", "交換", "委託に基づく引渡し", "返還"];
const CATS = ["一般の品物", "美術品", "時計・宝飾品", "自動車(部分品を含む)", "オートバイ・原付(部分品を含む)", "ゲームソフト", "CD・DVD・BD", "書籍", "その他の部分品(ねじ等を除く)"];
/* 記帳の要否の目安(古物営業法第16条・施行規則。最終判断は管轄の警察署へ) */
function needRecord(o) {
  const p = num(o.price), cat = o.cat || CATS[0], small = o.price !== "" && o.price != null && p < 10000;
  const car = /自動車|オートバイ/.test(cat), media = /ゲーム|CD|書籍/.test(cat), parts = /部分品/.test(cat) && !car;
  if (o.dir === "in") {
    if (!small) return ["need", "記録が必要です(対価の総額が1万円以上)。"];
    if (car || media || parts) return ["need", `「${cat}」は1万円未満でも記録と本人確認が必要です。`];
    return ["opt", "対価の総額が1万円未満のため、記録と本人確認は省略できる取引です。残しておいても問題ありません。"];
  }
  if (car) return ["need", "自動車・オートバイは、売ったとき(払出し)も記録が必要です。"];
  if (/美術品|時計/.test(cat) && !small) return ["need", `「${cat}」で1万円以上のため、払出しの記録が必要です。`];
  return ["opt", "この品物の払出しは、法律上は記録を省略できる場合があります。在庫の控えとして残しておくと便利です。"];
}
const VERIFY = ["運転免許証", "マイナンバーカード", "健康保険証等", "パスポート", "在留カード", "非対面(本人限定受取郵便)", "非対面(電子署名など)", "古物商・業者間取引", "1万円未満のため確認免除", "その他"];
let ledgerFilter = "all";
VIEWS.ledger = () => {
  const a = S.ledger.filter(o => ledgerFilter === "all" || o.dir === ledgerFilter).sort((x, y) => (y.date || "").localeCompare(x.date || "") || y.created - x.created);
  return head("古物台帳", "", `<button class="btn sm ghost" data-ledgerout>CSV・印刷</button>`) + `
  <div class="seg" role="tablist">${[["all", "すべて"], ["in", "受入れ"], ["out", "払出し"]].map(([k, l]) => `<button role="tab" aria-selected="${ledgerFilter === k}" data-lf="${k}">${l}</button>`).join("")}</div>
  <div class="toolbar"><input id="filter" type="search" placeholder="品目・特徴・相手方で絞り込む" aria-label="絞り込み"><button class="btn" data-new="ledger" data-dir="in">＋ 受入れ</button><button class="btn ghost" data-new="ledger" data-dir="out">＋ 払出し</button></div>
  ${a.length ? `<div class="list" id="flist">${a.map(rowLedger).join("")}</div>` : empty("台帳はまだ空です", "買い取ったとき(受入れ)と、売ったとき(払出し)に1行ずつ記録します。項目は古物営業法の帳簿の記載事項に合わせています。")}
  ${limitLine("ledger")}
  <details class="note"><summary>台帳の記載事項について</summary>
  <p>古物営業法 第16条と施行規則 第17条により、古物を受け取ったり引き渡したりしたときは、その都度「取引の年月日」「品目と数量」「特徴」「相手方の住所・氏名・職業・年齢」「相手方の確認の方法」を記録します。電磁的な記録でもよく、最後に記録した日から3年間は営業所に備え付けておく必要があります。</p>
  <p>1万円未満の取引など、記録が要らない場合もあります(自動車・オートバイ・部分品・ゲームソフト・CD/DVD・書籍などは例外あり)。扱う品目ごとの細かな取扱いは、管轄の警察署に確認してください。このアプリは記録の道具で、法律の判断はしません。</p>
  <p class="src">参考: 警視庁「帳簿の様式」/ 和歌山県警察「古物営業の手引き」/ 古物営業法(e-Gov 法令検索)</p></details>`;
};
VIEWS.entry = id => {
  const o = find("ledger", id); if (!o) return notFound();
  o.party = o.party || {};
  const isIn = o.dir === "in";
  const boxOpts = `<label class="fld" for="f_boxId"><span>保管している箱</span><select id="f_boxId" name="boxId"><option value="">(指定しない)</option>${S.boxes.map(b => `<option value="${b.id}"${b.id === o.boxId ? " selected" : ""}>${esc(b.code)} ${esc(b.name)}</option>`).join("")}</select></label>`;
  return head(isIn ? "受入れ(仕入れ)" : "払出し(売り)", "#ledger", isIn ? `<button class="btn sm ghost" data-outfrom="${id}">この品を払い出す</button>` : "") + `
  <form class="card form" data-store="ledger" data-id="${id}">
    ${field("取引の年月日", "date", o.date, { type: "date", req: true })}
    ${field("区分", "kind", o.kind, { options: isIn ? IN_KINDS : OUT_KINDS, req: true })}
    ${field("品目", "item", o.item, { req: true, ph: "例: 腕時計 / ホイール 18インチ 4本", wide: true })}
    ${field("数量", "qty", o.qty, { mode: "numeric", ph: "1", req: true })}
    ${field("金額(円)", "price", o.price, { mode: "numeric", ph: "例: 12000", hint: "取引の対価の総額" })}
    ${field("品物の種類", "cat", o.cat || CATS[0], { options: CATS, hint: "記録が必要かどうかの目安を出すために使います" })}
    <p class="need wide" id="needBox"></p>
    ${field("特徴", "features", o.features, { area: true, wide: true, req: true, ph: "メーカー・型番・色・材質・シリアル番号・傷など。見分けがつくように。" })}
  </form>
  <section class="block"><h2 class="sh">写真</h2>${photoStrip("ledger", o, "品物を撮る")}</section>
  <form class="card form" data-store="ledger" data-id="${id}" data-sub="party">
    <h2 class="sh fh">相手方</h2>
    ${field("氏名", "name", o.party.name, { req: true })}
    ${field("住所", "addr", o.party.addr, { wide: true, req: true })}
    ${field("職業", "job", o.party.job, { req: isIn })}
    ${field("年齢", "age", o.party.age, { mode: "numeric", req: isIn })}
  </form>
  <form class="card form" data-store="ledger" data-id="${id}">
    ${isIn ? field("確認の方法", "verify", o.verify || VERIFY[0], { options: VERIFY, req: true, hint: "身分証の番号そのものは、ここには書かないことをおすすめします。" }) : ""}
    ${boxOpts}
    ${field("備考", "note", o.note, { area: true, wide: true })}
  </form>
  <div class="danger"><button class="link-danger" data-del="ledger" data-id="${id}">この行を削除</button></div>`;
};

/* settings */
VIEWS.settings = () => {
  const s = S.settings;
  return head("設定") + `
  <section class="block"><h2 class="sh">利用キー</h2>
  <div class="card keycard ${S.pro.ok ? "ok" : ""}">
    ${S.pro.ok ? `<p class="kstate">登録済みです。件数の制限はありません。</p><p class="mono">${esc(S.pro.key)}</p>`
      : `<p>先行予約の方にメールでお送りするキー(HK- で始まる文字)を入れると、件数の制限がなくなります。</p>
      <div class="keyrow"><input id="keyIn" placeholder="HK-XXXXXXXX-XXXX" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="利用キー"><button class="btn" data-applykey>登録する</button></div>
      <p id="keyMsg" class="kmsg" role="alert"></p>
      <p class="small">まだお持ちでない方: <a href="./#price">先行予約について</a>(買い切り ¥2,980)</p>`}
  </div></section>
  <section class="block"><h2 class="sh">書類に印刷する屋号・連絡先</h2>
  <form class="card form" data-store="meta" data-id="settings">
    ${field("屋号・お店の名前", "shop", s.shop, { ph: "例: 〇〇外構 / Hair 〇〇" })}
    ${field("電話", "tel", s.tel, { type: "tel" })}
    ${field("住所", "addr", s.addr, { wide: true })}
    ${field("メール", "mail", s.mail, { type: "email" })}
    ${field("登録番号(インボイス)", "regno", s.regno, { ph: "T から始まる13桁(ある方のみ)" })}
    ${field("消費税率(%)", "taxRate", s.taxRate, { mode: "numeric" })}
    ${field("税の端数", "round", { floor: "切り捨て", round: "四捨五入", ceil: "切り上げ" }[s.round], { options: ["切り捨て", "四捨五入", "切り上げ"] })}
    ${field("見積書の下に入れる文", "noteFoot", s.noteFoot, { area: true, wide: true, rows: 2 })}
  </form></section>
  <section class="block"><h2 class="sh">古物台帳の見出し</h2>
  <form class="card form" data-store="meta" data-id="settings">
    ${field("古物商許可番号", "kobutsuNo", s.kobutsuNo, { ph: "例: 第123456789012号" })}
    ${field("許可した公安委員会", "kobutsuIssuer", s.kobutsuIssuer, { ph: "例: 東京都公安委員会" })}
  </form></section>
  <section class="block"><h2 class="sh">バックアップ</h2>
  <div class="card"><p>データはこの端末の中だけにあります。機種変更や、ブラウザのデータ消去に備えて、ときどき書き出しておいてください(写真も入ります)。</p>
  <div class="row-btns"><button class="btn" data-backup>バックアップを書き出す</button><button class="btn ghost" data-restore>バックアップから戻す</button></div>
  <p class="small">${S.lastBackup ? `最後のバックアップ: ${new Date(S.lastBackup).toLocaleDateString("ja-JP")}` : "まだ書き出していません。"}</p><p class="small" id="usage"></p></div></section>
  <div class="danger"><button class="link-danger" data-wipe>すべてのデータを消す</button></div>
  <p class="foot"><a href="./">ひかえについて</a>　<a href="../tokushoho.html">特定商取引法に基づく表記</a>　<a href="../privacy.html">プライバシーポリシー</a>　<a href="mailto:${MAIL}">お問い合わせ</a><br>ZEROICHI WORKS</p>`;
};
function notFound() { return head("見つかりません", "#search") + empty("このページのデータはありません", "削除されたか、別の端末で登録されたデータです。データはそれぞれの端末の中だけに保存されます。", `<a class="btn" href="#search">さがすに戻る</a>`); }

/* ---------- creating ---------- */
async function createNew(kind, extra = {}) {
  if (!canAdd(kind)) return;
  const now = Date.now(); let o;
  if (kind === "customers") { o = { id: uid(), name: "", created: now }; freshlySet(kind, o, "name"); await save(kind, o); go("#customer/" + o.id); }
  if (kind === "jobs") { o = { id: uid(), customerId: extra.customerId, title: "", date: today(), status: "見積中", board: true, boardNote: "", created: now, measures: [], materials: [], est: [] }; freshlySet(kind, o, "title"); await save(kind, o); go("#job/" + o.id); }
  if (kind === "boxes") {
    const max = S.boxes.reduce((m, b) => Math.max(m, parseInt(b.code.slice(2)) || 0), 0);
    o = { id: uid(), code: "B-" + String(max + 1).padStart(3, "0"), name: "", place: "", contents: "", tags: "", created: now };
    freshlySet(kind, o, "name"); await save(kind, o); go("#box/" + o.id);
  }
  if (kind === "ledger") {
    const dir = extra.dir || "in";
    o = Object.assign({ id: uid(), dir, date: today(), kind: dir === "in" ? "買受け" : "売却", item: "", qty: "1", features: "", price: "", party: {}, verify: VERIFY[0], created: now }, extra.prefill || {});
    freshlySet(kind, o, "item"); await save(kind, o); go("#entry/" + o.id);
  }
}
function freshlySet(store, o, field) { cleanupBlank(); freshly = { store, id: o.id, field }; }

/* ---------- binding ---------- */
let saveT;
function bindView() {
  const q = $("#q", V);
  if (q) { q.addEventListener("input", () => renderResults(q.value)); }
  const fl = $("#filter", V);
  if (fl) fl.addEventListener("input", () => {
    const w = norm(fl.value).split(/\s+/).filter(Boolean);
    $$("#flist > *", V).forEach(el => { const t = el.dataset.text || norm(el.textContent); el.hidden = !w.every(x => t.includes(x)); });
  });
  $$("form[data-store]", V).forEach(f => {
    f.addEventListener("submit", e => e.preventDefault());
    f.addEventListener("input", e => onField(f, e.target));
    f.addEventListener("change", e => onField(f, e.target));
  });
  $$("[data-rows]", V).forEach(box => {
    box.addEventListener("input", e => {
      const el = e.target; if (!el.dataset.k) return; const o = find("jobs", route.id); const arr = o[box.dataset.rows];
      arr[+el.dataset.i][el.dataset.k] = el.value;
      if (box.dataset.rows === "est") { const a = $(`[data-amt="${el.dataset.i}"]`, box); if (a) a.textContent = yen(lineAmt(arr[+el.dataset.i])); $("#totals").innerHTML = totalsHTML(o); }
      clearTimeout(saveT); saveT = setTimeout(() => save("jobs", o), 300);
    });
  });
  updateNeed();
  const lsize = $("#lsize", V); if (lsize) try { lsize.value = localStorage.getItem("hikae:lsize") || "l"; } catch (e) {}
}
function updateNeed() { const b = $("#needBox"); if (!b) return; const o = find("ledger", route.id); if (!o) return; const [k, t] = needRecord(o); b.className = "need wide n-" + k; b.textContent = t; }
async function onField(f, el) {
  if (!el.name) return;
  const store = f.dataset.store, id = f.dataset.id;
  let v = el.type === "checkbox" ? el.checked : el.value;
  if (store === "meta") {
    if (el.name === "round") v = { "切り捨て": "floor", "四捨五入": "round", "切り上げ": "ceil" }[v];
    if (el.name === "taxRate") v = num(v);
    S.settings[el.name] = v; clearTimeout(saveT); saveT = setTimeout(async () => { await dbPut("meta", S.settings); flashSaved(); }, 250); return;
  }
  const o = find(store, id); if (!o) return;
  if (f.dataset.sub) o[f.dataset.sub][el.name] = v; else o[el.name] = v;
  if (el.name === "board") { await save(store, o); return render(); }
  if (store === "ledger") updateNeed();
  if (store === "jobs" && el.name === "discount") $("#totals").innerHTML = totalsHTML(o);
  if (["name", "title", "item"].includes(el.name) && !f.dataset.sub) {
    const h = $(".vh h1", V); if (h) h.textContent = store === "boxes" ? `${o.code}　${v || "新しい箱"}` : (v || h.textContent);
  }
  clearTimeout(saveT); saveT = setTimeout(() => save(store, o), 300);
}

document.addEventListener("click", async e => {
  const t = e.target.closest("button,a"); if (!t) return;
  const d = t.dataset;
  if (d.go) { closeSheet(); go(d.go); return; }
  if (d.new) { e.preventDefault(); return createNew(d.new, { dir: d.dir }); }
  if (d.newjob) return createNew("jobs", { customerId: d.newjob });
  if (d.addphoto) { const o = find(d.addphoto, d.id); return pickPhotos(d.addphoto, o); }
  if (d.photo) return showPhoto(d.store, d.id, d.photo);
  if (d.delphoto) {
    const o = find(d.store, d.id); o.photos = o.photos.filter(p => p !== d.delphoto); await dbDel("photos", d.delphoto); await save(d.store, o); closeSheet(); toast("写真を削除しました"); return render();
  }
  if (d.addrow) {
    const o = find("jobs", route.id); const blank = { measures: { k: "", v: "" }, materials: { name: "", qty: "", note: "" }, est: { name: "", qty: "1", unit: "式", price: "" } }[d.addrow];
    o[d.addrow].push(blank); await save("jobs", o); await render();
    const rows = $$(`[data-rows="${d.addrow}"] .gr:not(.gh)`, V); const last = rows[rows.length - 1]; last && last.querySelector("input").focus(); return;
  }
  if (d.rm !== undefined) {
    const box = t.closest("[data-rows]"); const o = find("jobs", route.id); o[box.dataset.rows].splice(+d.rm, 1); await save("jobs", o); return render();
  }
  if (d.lf) { ledgerFilter = d.lf; return render(); }
  if (d.del) {
    const o = find(d.del, d.id); const label = { customers: "このお客さまと、その作業の記録をすべて", jobs: "この作業", boxes: "この箱", ledger: "この台帳の行" }[d.del];
    if (d.del === "ledger" && !confirm("古物台帳は3年間の保存が必要です。間違えて作った行だけ削除してください。削除しますか?")) return;
    if (d.del !== "ledger" && !confirm(`${label}を削除します。元に戻せません。よろしいですか?`)) return;
    if (d.del === "customers") for (const j of S.jobs.filter(j => j.customerId === o.id)) await remove("jobs", j);
    const back = d.del === "jobs" ? `#customer/${o.customerId}` : { customers: "#customers", boxes: "#boxes", ledger: "#ledger" }[d.del];
    await remove(d.del, o); toast("削除しました"); return go(back);
  }
  if (d.outfrom) { const src = find("ledger", d.outfrom); return createNew("ledger", { dir: "out", prefill: { item: src.item, qty: src.qty, features: src.features, boxId: src.boxId, note: `受入れ ${jdate(src.date)} の品` } }); }
  if (d.print === "job") return printJob(d.id);
  if (d.labelone) return printLabels([d.labelone], "l");
  if (d.printlabels !== undefined) {
    const ids = $$(".checks input:checked", V).map(i => i.value); if (!ids.length) return toast("印刷する箱を選んでください");
    const sz = $("#lsize").value; try { localStorage.setItem("hikae:lsize", sz); } catch (e) {}
    return printLabels(ids, sz);
  }
  if (d.ledgerout !== undefined) return ledgerOutSheet();
  if (d.csv !== undefined) return exportCSV();
  if (d.printledger !== undefined) return printLedger();
  if (d.applykey !== undefined) {
    const k = $("#keyIn").value;
    if (await verifyKey(k)) { S.pro = { key: k.trim().toUpperCase(), ok: true }; await dbPut("meta", { id: "pro", key: S.pro.key }); toast("利用キーを登録しました"); return render(); }
    $("#keyMsg").textContent = "キーが正しくありません。メールに書かれたキー(HK- で始まる文字)を、そのまま貼り付けてください。"; return;
  }
  if (d.backup !== undefined) return backup();
  if (d.restore !== undefined) { $("#restoreInput").value = ""; return $("#restoreInput").click(); }
  if (d.wipe !== undefined) {
    if (!confirm("お客さま・作業・箱・台帳・写真をすべて消します。先にバックアップを書き出してください。消しますか?")) return;
    if (prompt("確認のため「けす」と入力してください") !== "けす") return toast("消すのをやめました");
    for (const s of ["customers", "jobs", "boxes", "ledger", "photos"]) { await dbClear(s); if (S[s]) S[s] = []; }
    toast("すべてのデータを消しました"); return go("#search");
  }
  if (d.doprint !== undefined) { closeSheet(); return doPrint(); }
});

async function showPhoto(store, id, pid) {
  openSheet(`<div class="bigph"><img data-pid="${pid}" alt="写真"></div><div class="row-btns"><button class="btn ghost" data-delphoto="${pid}" data-store="${store}" data-id="${id}">この写真を削除</button><button class="btn" data-close>閉じる</button></div>`);
}

/* ---------- printing ---------- */
const PA = $("#printArea");
async function doPrint() {
  await fillPhotos(PA);
  await Promise.all($$("img", PA).map(im => im.complete ? 0 : new Promise(r => { im.onload = im.onerror = r; })));
  document.body.classList.add("printing");
  setTimeout(() => { window.print(); }, 60);
}
window.addEventListener("afterprint", () => document.body.classList.remove("printing"));
function shopBlock() {
  const s = S.settings;
  return `<div class="p-shop"><b>${esc(s.shop || "(屋号は設定で入れられます)")}</b>${s.addr ? `<span>${esc(s.addr)}</span>` : ""}${s.tel ? `<span>TEL ${esc(s.tel)}</span>` : ""}${s.mail ? `<span>${esc(s.mail)}</span>` : ""}${s.regno ? `<span>登録番号 ${esc(s.regno)}</span>` : ""}</div>`;
}
function printJob(id) {
  const o = find("jobs", id); const c = find("customers", o.customerId) || {};
  openSheet(`<h2>印刷する書類</h2><p>お客さまに渡す書類を選んでください。PDFにしたいときは、印刷の画面で「PDFに保存」を選びます。</p>
  <div class="choice">
    <label class="ck"><input type="radio" name="doc" value="est" checked><span><b>お見積書</b><br><small>見積の表と合計</small></span></label>
    <label class="ck"><input type="radio" name="doc" value="report"><span><b>作業報告書</b><br><small>写真・寸法・材料・メモ</small></span></label>
    <label class="ck"><input type="radio" name="doc" value="album"><span><b>写真台帳</b><br><small>A4に3枚ずつ・説明つき</small></span></label>
    <label class="ck"><input type="radio" name="doc" value="both"><span><b>報告書＋見積書</b><br><small>続けて印刷</small></span></label>
  </div>
  <div class="row-btns"><button class="btn" data-doprint id="goPrint">印刷・PDFへ</button></div>`);
  const build = () => {
    const v = ($("input[name=doc]:checked") || {}).value || "est";
    PA.innerHTML = v === "album" ? albumDoc(o, c) : (v === "report" || v === "both" ? reportDoc(o, c) : "") + (v === "est" || v === "both" ? estDoc(o, c) : "");
  };
  build(); $$("input[name=doc]").forEach(r => r.addEventListener("change", build));
}
function estDoc(o, c) {
  const t = calc(o); const s = S.settings;
  return `<article class="doc"><header class="dh"><h1>御見積書</h1><p class="dno">No. ${esc(o.id.slice(-6).toUpperCase())}<br>${jdate(today())}</p></header>
  <div class="dtop"><div class="to"><p class="cname">${esc(sama(c.name))} 様</p><p>件名: ${esc(o.title || "")}</p>${o.place ? `<p>場所: ${esc(o.place)}</p>` : ""}<p class="big">御見積金額 <b>${yen(t.total)}</b><small>(税込)</small></p></div>${shopBlock()}</div>
  <table class="dt"><thead><tr><th>品名</th><th class="r">数量</th><th>単位</th><th class="r">単価</th><th class="r">金額</th></tr></thead><tbody>
  ${(o.est || []).filter(m => m.name || m.price).map(m => `<tr><td>${esc(m.name)}</td><td class="r">${esc(m.qty || 1)}</td><td>${esc(m.unit)}</td><td class="r">${yen(num(m.price))}</td><td class="r">${yen(lineAmt(m))}</td></tr>`).join("") || `<tr><td colspan="5">(見積の行がありません)</td></tr>`}
  </tbody></table>
  <table class="dsum"><tr><th>小計</th><td>${yen(t.sub)}</td></tr>${t.disc ? `<tr><th>値引き</th><td>−${yen(t.disc)}</td></tr>` : ""}<tr><th>消費税(${t.rate}%対象 ${yen(t.base)})</th><td>${yen(t.tax)}</td></tr><tr class="tt"><th>合計</th><td>${yen(t.total)}</td></tr></table>
  ${o.note ? `<p class="dnote">${esc(o.note).replace(/\n/g, "<br>")}</p>` : ""}${s.noteFoot ? `<p class="dfoot">${esc(s.noteFoot)}</p>` : ""}</article>`;
}
function reportDoc(o, c) {
  const ms = (o.measures || []).filter(m => m.k || m.v), mt = (o.materials || []).filter(m => m.name);
  return `<article class="doc"><header class="dh"><h1>作業報告書</h1><p class="dno">${jdate(o.date)}<br>${esc(o.status || "")}</p></header>
  <div class="dtop"><div class="to"><p class="cname">${esc(sama(c.name))} 様</p><p>件名: ${esc(o.title || "")}</p>${o.place ? `<p>場所: ${esc(o.place)}</p>` : ""}</div>${shopBlock()}</div>
  ${(o.photos || []).length ? `<div class="dph">${o.photos.slice(0, 6).map(p => `<img data-pid="${p}" alt="">`).join("")}</div>` : ""}
  <div class="dcols">${ms.length ? `<section><h2>寸法・メモ</h2><table class="dt"><tbody>${ms.map(m => `<tr><th>${esc(m.k)}</th><td>${esc(m.v)}</td></tr>`).join("")}</tbody></table></section>` : ""}
  ${mt.length ? `<section><h2>使用した材料</h2><table class="dt"><tbody>${mt.map(m => `<tr><th>${esc(m.name)}</th><td>${esc(m.qty)}</td><td>${esc(m.note)}</td></tr>`).join("")}</tbody></table></section>` : ""}</div>
  ${o.note ? `<p class="dnote">${esc(o.note).replace(/\n/g, "<br>")}</p>` : ""}</article>`;
}
function albumDoc(o, c) {
  const ps = o.photos || []; if (!ps.length) return `<article class="doc"><header class="dh"><h1>写真台帳</h1></header><p>この作業には写真がありません。</p></article>`;
  const pages = []; for (let i = 0; i < ps.length; i += 3) pages.push(ps.slice(i, i + 3));
  return pages.map((pg, pi) => `<article class="doc album"><header class="dh"><h1>写真台帳</h1><p class="dno">${esc(o.title || "")}<br>${pi + 1} / ${pages.length}</p></header>
  ${pg.map((p, j) => `<div class="arow"><div class="aimg"><img data-pid="${p}" alt=""></div><dl class="ainfo"><dt>No.</dt><dd>${pi * 3 + j + 1}</dd><dt>工事名</dt><dd>${esc(o.title || "")}</dd><dt>日付</dt><dd>${jdate(o.date)}</dd><dt>場所</dt><dd>${esc(o.place || c.addr || "")}</dd><dt>施主</dt><dd>${esc(sama(c.name))} 様</dd><dt>備考</dt><dd class="blank"></dd></dl></div>`).join("")}
  <footer class="afoot">${esc(S.settings.shop || "")}</footer></article>`).join("");
}
function qrSVG(text) {
  const q = qrcode(0, "M"); q.addData(text); q.make();
  return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
}
function printLabels(ids, size) {
  const boxes = ids.map(id => find("boxes", id)).filter(Boolean);
  PA.innerHTML = `<div class="labels ${size === "s" ? "ls" : "ll"}">${boxes.map(b => `<div class="lab"><div class="qr">${qrSVG(APP_URL + "#b/" + b.code)}</div><div class="lt"><b>${esc(b.code)}</b><span>${esc(b.name)}</span>${size === "s" ? "" : `<small>${esc(b.place || "")}</small>`}</div></div>`).join("")}</div>`;
  doPrint();
}
const CSV_HEAD = ["受入/払出", "取引の年月日", "区分", "品目", "数量", "特徴", "金額(円)", "品物の種類", "相手方の住所", "相手方の氏名", "職業", "年齢", "確認の方法", "保管している箱", "備考"];
function ledgerRows(from, to) {
  return S.ledger.filter(o => (!from || o.date >= from) && (!to || o.date <= to)).sort((a, b) => (a.date || "").localeCompare(b.date || "") || a.created - b.created);
}
function ledgerOutSheet() {
  const ds = S.ledger.map(o => o.date).filter(Boolean).sort();
  openSheet(`<h2>CSV・印刷</h2><p>期間を選んで、CSV(Excelで開けます)に書き出すか、帳簿として印刷します。</p>
  <div class="form two"><label class="fld"><span>いつから</span><input type="date" id="lfrom" value="${ds[0] || today()}"></label><label class="fld"><span>いつまで</span><input type="date" id="lto" value="${ds[ds.length - 1] || today()}"></label></div>
  <div class="row-btns"><button class="btn" data-csv>CSVを書き出す</button><button class="btn ghost" data-printledger>帳簿を印刷</button></div>`);
}
function download(name, blob) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
function exportCSV() {
  const from = $("#lfrom").value, to = $("#lto").value;
  const q = v => { v = String(v ?? ""); return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  const rows = ledgerRows(from, to).map(o => [o.dir === "in" ? "受入れ" : "払出し", o.date, o.kind, o.item, o.qty, o.features, o.price, o.cat || CATS[0], o.party?.addr, o.party?.name, o.party?.job, o.party?.age, o.dir === "in" ? o.verify : "", find("boxes", o.boxId)?.code || "", o.note]);
  const csv = "﻿" + [CSV_HEAD, ...rows].map(r => r.map(q).join(",")).join("\r\n");
  download(`kobutsu_daicho_${from}_${to}.csv`, new Blob([csv], { type: "text/csv;charset=utf-8" }));
  toast(`${rows.length}行をCSVに書き出しました`);
}
function printLedger() {
  const from = $("#lfrom").value, to = $("#lto").value, s = S.settings;
  const rows = ledgerRows(from, to);
  PA.innerHTML = `<article class="doc ledger"><header class="dh"><h1>古物台帳</h1><p class="dno">${jdate(from)} 〜 ${jdate(to)}<br>${esc(s.shop)}　${esc(s.kobutsuIssuer)} ${esc(s.kobutsuNo)}</p></header>
  <table class="dt lg"><thead><tr><th>受/払</th><th>年月日</th><th>区分</th><th>品目</th><th>数量</th><th>特徴</th><th>金額</th><th>相手方 住所・氏名</th><th>職業</th><th>年齢</th><th>確認の方法</th></tr></thead><tbody>
  ${rows.map(o => `<tr><td>${o.dir === "in" ? "受入れ" : "払出し"}</td><td>${esc(o.date)}</td><td>${esc(o.kind)}</td><td>${esc(o.item)}</td><td class="r">${esc(o.qty)}</td><td>${esc(o.features)}</td><td class="r">${o.price ? yen(o.price) : ""}</td><td>${esc(o.party?.addr)}<br>${esc(o.party?.name)}</td><td>${esc(o.party?.job)}</td><td>${esc(o.party?.age)}</td><td>${o.dir === "in" ? esc(o.verify) : ""}</td></tr>`).join("") || `<tr><td colspan="11">この期間の記録はありません</td></tr>`}
  </tbody></table></article>`;
  PA.classList.add("landscape"); closeSheet(); doPrint();
}
window.addEventListener("afterprint", () => PA.classList.remove("landscape"));

/* ---------- backup ---------- */
const b64 = blob => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(blob); });
async function backup() {
  toast("書き出しています…");
  const photos = await dbAll("photos"); const ph = [];
  for (const p of photos) ph.push({ id: p.id, at: p.at, data: await b64(p.blob) });
  const data = { app: "hikae", v: 1, at: new Date().toISOString(), customers: S.customers, jobs: S.jobs, boxes: S.boxes, ledger: S.ledger, settings: S.settings, photos: ph };
  download(`hikae_backup_${today()}.json`, new Blob([JSON.stringify(data)], { type: "application/json" }));
  S.lastBackup = Date.now(); await dbPut("meta", { id: "backup", at: S.lastBackup });
  toast("バックアップを書き出しました"); if (route.name === "search" || route.name === "settings") render();
}
$("#restoreInput").addEventListener("change", async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const o = JSON.parse(await f.text()); if (o.app !== "hikae" || !Array.isArray(o.customers)) throw new Error("形式");
    if (!confirm("今のデータを、このバックアップの内容で置き換えます。よろしいですか?")) return;
    for (const s of ["customers", "jobs", "boxes", "ledger", "photos"]) await dbClear(s);
    for (const s of ["customers", "jobs", "boxes", "ledger"]) { S[s] = o[s] || []; for (const x of S[s]) await dbPut(s, x); }
    for (const p of o.photos || []) { const blob = await (await fetch(p.data)).blob(); await dbPut("photos", { id: p.id, at: p.at, blob }); }
    S.settings = Object.assign(defaults(), o.settings || {}); await dbPut("meta", S.settings);
    urlCache.clear(); toast("バックアップから戻しました"); go("#search");
  } catch (err) { toast("読み込めませんでした。ひかえで書き出したファイルか確認してください"); }
});

/* ---------- boot ---------- */
(async function () {
  try { await openDB(); await load(); }
  catch (e) { V.innerHTML = empty("この画面ではデータを保存できません", "プライベートブラウズ(シークレットモード)をやめて、普通の画面で開いてください。"); return; }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  await render();
  if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then(u => { const el = $("#usage"); if (el && u.usage) el.textContent = `使っている容量: 約${(u.usage / 1048576).toFixed(1)}MB`; }).catch(() => {});
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
  window.Hikae = { S, calc, verifyKey, ready: true };
})();
})();
