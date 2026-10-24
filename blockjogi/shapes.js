// ブロック定規 — 形の計算(ブラウザとNodeの両方で動く)
// 座標: マス(i, j) の中心 (i+0.5, j+0.5) が図形の内側なら置く

// 2D: 楕円(円は rx = ry)。mode: "line"(ふち・細) / "thick"(ふち・太) / "fill"(中まで)
export function ellipse(w, h, mode = "line") {
  const rx = w / 2, ry = h / 2;
  const inside = (i, j) => i >= 0 && j >= 0 && i < w && j < h && ((i + 0.5 - rx) / rx) ** 2 + ((j + 0.5 - ry) / ry) ** 2 <= 1;
  const g = [];
  for (let j = 0; j < h; j++) {
    const row = new Uint8Array(w);
    for (let i = 0; i < w; i++) {
      if (!inside(i, j)) continue;
      if (mode === "fill") { row[i] = 1; continue; }
      const n4 = !inside(i - 1, j) || !inside(i + 1, j) || !inside(i, j - 1) || !inside(i, j + 1);
      const n8 = n4 || !inside(i - 1, j - 1) || !inside(i + 1, j - 1) || !inside(i - 1, j + 1) || !inside(i + 1, j + 1);
      row[i] = (mode === "thick" ? n8 : n4) ? 1 : 0;
    }
    g.push(row);
  }
  return g;
}

// 3D: 中が空洞の立体を、下から1段ずつの2Dで返す
function shell(nx, ny, nz, inside) {
  const layers = [];
  for (let k = 0; k < nz; k++) {
    const L = [];
    for (let j = 0; j < ny; j++) {
      const row = new Uint8Array(nx);
      for (let i = 0; i < nx; i++) {
        if (!inside(i, j, k)) continue;
        row[i] = (!inside(i - 1, j, k) || !inside(i + 1, j, k) || !inside(i, j - 1, k) || !inside(i, j + 1, k) || !inside(i, j, k - 1) || !inside(i, j, k + 1)) ? 1 : 0;
      }
      L.push(row);
    }
    layers.push(L);
  }
  return layers;
}
export function sphere(d, fill = false) {
  const r = d / 2;
  const inside = (i, j, k) => i >= 0 && j >= 0 && k >= 0 && i < d && j < d && k < d && (i + 0.5 - r) ** 2 + (j + 0.5 - r) ** 2 + (k + 0.5 - r) ** 2 <= r * r;
  return fill ? solid(d, d, d, inside) : shell(d, d, d, inside);
}
export function dome(d, fill = false) {
  const all = sphere(d, fill);
  return all.slice(Math.floor(d / 2)); // 上半分(赤道の段から上)
}
export function cylinder(d, height, mode = "line") {
  const c = ellipse(d, d, mode);
  return Array.from({ length: height }, () => c);
}
// 追加の形(フルパック)
export function torus(R, r) { // R=中心の輪の半径, r=太さの半径
  const n = Math.ceil(2 * (R + r)), h = Math.ceil(2 * r), c = n / 2, cz = h / 2;
  const inside = (i, j, k) => {
    if (i < 0 || j < 0 || k < 0 || i >= n || j >= n || k >= h) return false;
    const x = i + 0.5 - c, y = j + 0.5 - c, z = k + 0.5 - cz;
    const q = Math.sqrt(x * x + y * y) - R;
    return q * q + z * z <= r * r;
  };
  return shell(n, n, h, inside);
}
export function cone(d, height) {
  const r = d / 2;
  const inside = (i, j, k) => {
    if (i < 0 || j < 0 || k < 0 || i >= d || j >= d || k >= height) return false;
    const rk = r * (1 - (k + 0.5) / height);
    return (i + 0.5 - r) ** 2 + (j + 0.5 - r) ** 2 <= rk * rk;
  };
  return shell(d, d, height, inside);
}
function solid(nx, ny, nz, inside) {
  const layers = [];
  for (let k = 0; k < nz; k++) {
    const L = [];
    for (let j = 0; j < ny; j++) { const row = new Uint8Array(nx); for (let i = 0; i < nx; i++) row[i] = inside(i, j, k) ? 1 : 0; L.push(row); }
    layers.push(L);
  }
  return layers;
}

// 1段の外まわりだけ(同じ段で上下左右のどれかが空いているマス)
export function outline(g) {
  const h = g.length, w = g[0].length, at = (i, j) => j >= 0 && j < h && i >= 0 && i < w && g[j][i];
  return g.map((row, j) => row.map((v, i) => (v && (!at(i - 1, j) || !at(i + 1, j) || !at(i, j - 1) || !at(i, j + 1))) ? 1 : 0));
}
export const count2d = (g) => g.reduce((a, row) => a + row.reduce((b, v) => b + v, 0), 0);
export const count3d = (ls) => ls.reduce((a, g) => a + count2d(g), 0);
export const isEmpty = (g) => count2d(g) === 0;

// 円(楕円)のふちを、上の辺から右回りに「まっすぐ並ぶ個数」の列で表す(4分の1周ぶん)
// 例: 直径13 → [5, 2, 2, 5] = 上の辺5個、ななめ下に2個、さらに2個(縦)、横の辺5個
export function steps(g) {
  const h = g.length, w = g[0].length, cx = w / 2, cy = h / 2;
  const cells = [];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    if (!g[j][i]) continue;
    const dx = i + 0.5 - cx, dy = j + 0.5 - cy;
    if (dx >= -0.01 && dy <= 0.01) cells.push({ i, j, a: Math.atan2(dx, -dy) });
  }
  cells.sort((p, q) => p.a - q.a || p.j - q.j);
  const segs = [];
  let cur = null;
  for (const c of cells) {
    const last = cur && cur.cells[cur.cells.length - 1];
    if (cur && last.j === c.j && Math.abs(last.i - c.i) === 1 && cur.dir !== "V") { cur.dir = "H"; cur.cells.push(c); continue; }
    if (cur && last.i === c.i && Math.abs(last.j - c.j) === 1 && cur.dir !== "H") { cur.dir = "V"; cur.cells.push(c); continue; }
    cur = { dir: null, cells: [c] }; segs.push(cur);
  }
  if (!segs.length) return [];
  const top = g.findIndex((r) => r.some((v) => v));
  const topLen = g[top].reduce((a, v) => a + v, 0);
  let right = w - 1; while (right > 0 && !g.some((r) => r[right])) right--;
  const sideLen = g.reduce((a, r) => a + r[right], 0);
  const out = segs.map((s) => s.cells.length);
  out[0] = topLen; out[out.length - 1] = sideLen;
  return out;
}

// 個数 → スタック表示
export function stacks(n, per = 64) {
  const st = Math.floor(n / per), rest = n % per;
  return { st, rest, shulker: n / (per * 27), lc: n / (per * 54) };
}
export function stackText(n, per = 64) {
  const s = stacks(n, per);
  if (n < per) return n ? "1スタック未満" : "0個";
  const a = s.st ? `${s.st}スタック` : "";
  const b = s.rest ? `${s.rest}個` : "";
  return (a && b ? `${a}+${b}` : a || b || "0個");
}

// ネザー座標
export const toNether = (x) => Math.floor(x / 8);
export const toOver = (x) => x * 8;
