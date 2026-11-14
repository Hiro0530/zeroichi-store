// 在庫番の画面の試験と撮影で使う: 試験コピーをそのまま配る小さなサーバーと、にせの楽天(公式APIの返事の形)
const path = require('path'), fs = require('fs'), http = require('http');
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
const root = path.resolve(process.argv[2] || path.join(__dirname, '../../../kt-zs-sedori-ghp')), SD = require('./_dir')(root), S = path.resolve(root, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
function serve() {
  const server = http.createServer((req, res) => {
    let f = path.join(root, decodeURIComponent(req.url.split('?')[0]));
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); fs.createReadStream(f).pipe(res);
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, base: `http://127.0.0.1:${server.address().port}/${SD}/` })));
}
// にせの楽天。market = { JAN: [{ code, shop, price, stock(既定 true), free(送料無料。既定 true), name }] }。fail = 返す番号(403など)。calls に呼ばれた回数
function fakeRakuten(page, state) {
  return page.route('**/openapi.rakuten.co.jp/**', route => {
    const u = new URL(route.request().url()), q = u.searchParams; state.calls = (state.calls || 0) + 1;
    const H = { 'access-control-allow-origin': '*' };
    if (state.fail) return route.fulfill({ status: state.fail, contentType: 'application/json', headers: H, body: '{}' });
    const all = []; Object.keys(state.market).forEach(j => state.market[j].forEach(x => all.push(Object.assign({ jan: j }, x))));
    const item = x => ({ itemCode: x.code, itemName: x.name || '商品', itemPrice: x.price, availability: x.stock === false ? 0 : 1, shopCode: x.code.split(':')[0], shopName: x.shop, itemUrl: 'https://item.rakuten.co.jp/' + x.code.replace(':', '/') + '/', postageFlag: x.free === false ? 1 : 0, pointRate: 1 });
    let hit;
    if (q.get('itemCode')) hit = all.filter(x => x.code === q.get('itemCode'));
    else hit = all.filter(x => x.jan === q.get('keyword') && x.stock !== false).sort((a, b) => a.price - b.price);
    route.fulfill({ status: 200, contentType: 'application/json', headers: H, body: JSON.stringify({ Items: hit.map(item) }) });
  });
}
async function open(browser, url, w, seed, opt) {
  opt = opt || {};
  const ctx = await browser.newContext({ viewport: { width: w, height: opt.h || 800 }, deviceScaleFactor: 1, serviceWorkers: 'block', permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
  await p.addInitScript(([d]) => { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); Object.keys(d).forEach(k => localStorage.setItem('zw-sedori:' + k, JSON.stringify(d[k]))); sessionStorage.setItem('seeded', '1'); } }, [seed || {}]);
  if (opt.market) await fakeRakuten(p, opt.market);
  await p.goto(url); await p.waitForTimeout(500);
  if (opt.tier) { await p.evaluate(t => { SedoriAccount.paid = () => t !== 'free'; SedoriAccount.tier = () => t; document.dispatchEvent(new CustomEvent('sedori:acct')); }, opt.tier); await p.waitForTimeout(150); }
  return p;
}
module.exports = { chromium, serve, fakeRakuten, open, S, root, SD };
