// 画面まわりの共通部品
import { E } from "./reading.js";

// 支払いリンク(オーナーがPayPalで作ったら、ここに貼るだけで「支払う」ボタンに変わる)
export const PAY = {
  annual: { name: "2027年 年間運勢レポート", price: 980, url: "" },
  compat: { name: "ふたりの相性レポート", price: 980, url: "" },
  set: { name: "年間運勢+相性 セット", price: 1500, url: "" },
};
export const MAIL = "zeroichi.works.jp@gmail.com";
export const SITE = "https://zeroichiworks.net/hoshiyomi/";

const KAN = ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
export function kanji(n) {
  if (n < 10) return KAN[n];
  if (n < 20) return "十" + (n % 10 ? KAN[n % 10] : "");
  return KAN[Math.floor(n / 10)] + "十" + (n % 10 ? KAN[n % 10] : "");
}

// 月の形(elong: 0=新月, 180=満月)。SVGのpath文字列
export function moonPath(e, cx, cy, r) {
  e = ((e % 360) + 360) % 360;
  const k = Math.abs(Math.cos(e * Math.PI / 180)) * r;
  const top = `${cx} ${cy - r}`, bot = `${cx} ${cy + r}`;
  if (e < 180) { // 満ちていく: 右側が明るい
    const sw = e < 90 ? 0 : 1;
    return `M${top} A${r} ${r} 0 0 1 ${bot} A${k} ${r} 0 0 ${sw} ${top}Z`;
  }
  const sw = e > 270 ? 1 : 0;
  return `M${top} A${r} ${r} 0 0 0 ${bot} A${k} ${r} 0 0 ${sw} ${top}Z`;
}
export function moonSVG(e, { size = 200, dark = "#3A4373", light = "#F3DE9C", label = "" } = {}) {
  const r = size / 2 - 2, c = size / 2;
  // 海(暗い模様)をぼかして薄く重ねる。配置は実際の月の表側のおおまかな位置(雨の海・晴れの海・静かの海・危難の海・嵐の大洋・雲の海・豊かの海)
  const mare = [[-.22, -.38, .2, .15, -20], [.08, -.3, .15, .13, 0], [.28, -.06, .17, .14, 20], [.62, -.18, .09, .11, 0], [-.48, -.02, .2, .36, 10], [-.12, .36, .17, .1, 0], [.42, .26, .1, .14, -15], [-.05, .05, .1, .08, 0]]
    .map(([x, y, rx, ry, rot]) => `<ellipse cx="${c + x * r}" cy="${c + y * r}" rx="${rx * r}" ry="${ry * r}" transform="rotate(${rot} ${c + x * r} ${c + y * r})"/>`).join("");
  const id = "m" + Math.floor(e * 10) + size;
  const svg = `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="${label}"><defs><clipPath id="${id}"><path d="${moonPath(e, c, c, r)}"/></clipPath><filter id="${id}b"><feGaussianBlur stdDeviation="${r * 0.05}"/></filter></defs><circle cx="${c}" cy="${c}" r="${r}" fill="${dark}"/><path d="${moonPath(e, c, c, r)}" fill="${light}"/><g clip-path="url(#${id})"><g fill="#B8A46A" opacity=".32" filter="url(#${id}b)">${mare}</g></g></svg>`;
  return svg;
}
// 1〜5点を月の満ち欠けで表す
const METER_E = [0, 40, 90, 135, 180];
export function meter(score, label = "") {
  let s = `<span class="meter" role="img" aria-label="${label}5段階中${score}">`;
  for (let i = 1; i <= 5; i++) {
    const on = i <= score;
    s += `<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.5" fill="${on ? "var(--night)" : "none"}" stroke="var(--line)" stroke-width="1"/>${on ? `<path d="${moonPath(METER_E[i - 1] || 12, 10, 10, 8.5)}" fill="#F3DE9C"/>` : ""}</svg>`;
  }
  return s + "</span>";
}

export function stars(el, seed = 7, n = 70) {
  const rnd = E.seeded("stars", seed);
  let s = "";
  for (let i = 0; i < n; i++) {
    const x = (rnd() * 100).toFixed(2), y = (rnd() * 100).toFixed(2), r = (rnd() * 1.1 + 0.3).toFixed(2), o = (rnd() * 0.6 + 0.25).toFixed(2);
    s += `<circle cx="${x}%" cy="${y}%" r="${r}" fill="#fff" opacity="${o}"/>`;
  }
  el.innerHTML = `<svg width="100%" height="100%" aria-hidden="true">${s}</svg>`;
}

// 誕生日の保存(この端末だけ)
export function loadBirth() {
  try { const v = JSON.parse(localStorage.getItem("hy.birth") || "null"); if (v && v.y && v.m && v.d) return v; } catch (e) {}
  return null;
}
export function saveBirth(b) { try { localStorage.setItem("hy.birth", JSON.stringify(b)); } catch (e) {} }
export function clearBirth() { try { localStorage.removeItem("hy.birth"); } catch (e) {} }

export function fillSelects(ys, ms, ds, b) {
  const now = new Date().getFullYear();
  ys.innerHTML = `<option value="">年</option>` + Array.from({ length: 90 }, (_, i) => now - 10 - i).map((y) => `<option value="${y}">${y}年</option>`).join("");
  ms.innerHTML = `<option value="">月</option>` + Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">${i + 1}月</option>`).join("");
  ds.innerHTML = `<option value="">日</option>` + Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}">${i + 1}日</option>`).join("");
  if (!b) { ys.value = "1995"; return; }
  ys.value = b.y; ms.value = b.m; ds.value = b.d;
}
export function readSelects(ys, ms, ds) {
  const y = +ys.value, m = +ms.value, d = +ds.value;
  if (!y || !m || !d) return { err: "年・月・日をすべて選んでください。" };
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return { err: `${m}月${d}日はありません。日付を選び直してください。` };
  return { y, m, d };
}

// シェア画像(1080×1350)。Instagramの縦長投稿・ストーリーズにそのまま使える
export async function shareCard(r) {
  try { await Promise.all([document.fonts.load('800 60px "Shippori Mincho B1"'), document.fonts.load('500 30px "Zen Kaku Gothic New"')]); } catch (e) {}
  const W = 1080, H = 1350, cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const g = cv.getContext("2d");
  const grd = g.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, "#232B5C"); grd.addColorStop(1, "#151A3D");
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  const rnd = E.seeded("card", r.day.y, r.day.m, r.day.d);
  for (let i = 0; i < 140; i++) { g.globalAlpha = rnd() * 0.6 + 0.2; g.fillStyle = "#fff"; g.beginPath(); g.arc(rnd() * W, rnd() * H, rnd() * 2 + 0.5, 0, 7); g.fill(); }
  g.globalAlpha = 1;
  g.fillStyle = "#3A4373"; g.beginPath(); g.arc(W / 2, 330, 190, 0, 7); g.fill();
  g.fillStyle = "#F3DE9C"; g.fill(new Path2D(moonPath(r.sky.elong, W / 2, 330, 190)));
  g.textAlign = "center"; g.fillStyle = "#D9D5EE";
  g.font = '500 34px "Zen Kaku Gothic New", sans-serif';
  g.fillText(`${r.day.m}月${r.day.d}日 ・ ${r.sign.name}のわたし`, W / 2, 610);
  g.fillStyle = "#F7EFD0"; g.font = '800 104px "Shippori Mincho B1", serif';
  g.fillText(r.pdTitle, W / 2, 740);
  g.fillStyle = "#EDEAF8"; g.font = '600 40px "Shippori Mincho B1", serif';
  wrap(g, r.closing, W / 2, 830, 860, 60);
  const cats = r.cats; const y0 = 990;
  g.font = '500 32px "Zen Kaku Gothic New", sans-serif';
  cats.forEach((c, i) => {
    const x = 150 + i * 195;
    g.fillStyle = "#B9B5D6"; g.fillText(c.label, x + 45, y0);
    for (let k = 0; k < 5; k++) {
      const cx = x + 5 + k * 20, cy = y0 + 40;
      g.fillStyle = k < c.score ? "#F3DE9C" : "#3A4373"; g.beginPath(); g.arc(cx, cy, 8, 0, 7); g.fill();
    }
  });
  g.fillStyle = r.color.hex; g.beginPath(); g.arc(W / 2 - 150, 1145, 18, 0, 7); g.fill();
  g.fillStyle = "#EDEAF8"; g.textAlign = "left"; g.font = '500 32px "Zen Kaku Gothic New", sans-serif';
  g.fillText(`ラッキーカラー ${r.color.name}`, W / 2 - 118, 1156);
  g.textAlign = "center"; g.fillStyle = "#B9B5D6"; g.font = '500 28px "Zen Kaku Gothic New", sans-serif';
  g.fillText("ほしよみ日和 ― 誕生日でみる今日の運勢", W / 2, 1270);
  return new Promise((res) => cv.toBlob(res, "image/png"));
}
function wrap(g, text, x, y, maxW, lh) {
  let line = "", yy = y;
  for (const ch of text) {
    if (g.measureText(line + ch).width > maxW) { g.fillText(line, x, yy); line = ch; yy += lh; } else line += ch;
  }
  g.fillText(line, x, yy);
}

export function payButton(kind, extra = "") {
  const p = PAY[kind];
  if (p.url && p.url.includes("booth.pm")) return `<a class="btn main" href="${p.url}" target="_blank" rel="noopener">BOOTHで購入する(${p.price.toLocaleString()}円)</a><p class="note" style="flex-basis:100%">購入後すぐに、利用キーの書かれたファイルがダウンロードできます。</p>`;
  if (p.url) return `<a class="btn main" href="${p.url}" target="_blank" rel="noopener">PayPalで${p.price.toLocaleString()}円を支払う</a>`;
  const sub = encodeURIComponent(`【ほしよみ日和】${p.name} 申し込み`);
  const body = encodeURIComponent(`${p.name}(${p.price.toLocaleString()}円)を申し込みます。\n\nお名前(ニックネーム可):\n${extra}\n\n※お支払い用のPayPalのご案内をこのメールアドレスにお送りします。`);
  return `<a class="btn main" href="mailto:${MAIL}?subject=${sub}&body=${body}">メールで申し込む(${p.price.toLocaleString()}円)</a>`;
}

// 利用キー: HN=年間 / HA=相性 / HS=セット。形式 HX-XXXXXXXX-YYYY(YYYY=SHA-256の先頭4桁)
export async function checkKey(raw) {
  const k = (raw || "").trim().toUpperCase().replace(/\s/g, "");
  const m = k.match(/^(HN|HA|HS)-([A-Z0-9]{8})-([0-9A-F]{4})$/);
  if (!m) return null;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`hoshiyomi:${m[1]}:${m[2]}`));
  const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 4).toUpperCase();
  if (hex !== m[3]) return null;
  return { code: m[1], key: k, annual: m[1] !== "HA", compat: m[1] !== "HN" };
}
export function unlocked() {
  try { return JSON.parse(localStorage.getItem("hy.keys") || "{}"); } catch (e) { return {}; }
}
export function saveUnlock(r) {
  const u = unlocked();
  if (r.annual) u.annual = r.key; if (r.compat) u.compat = r.key;
  try { localStorage.setItem("hy.keys", JSON.stringify(u)); } catch (e) {}
  return u;
}
