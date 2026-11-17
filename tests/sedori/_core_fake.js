// にせの Worker の /core(ブラウザの試験だけ)。答えは本物の backend/sedori/worker/src/core.js の handleCore が作る(決まりは同じ)。
// state.tier を渡すと「その段の有効な証明を持つ端末」として答える(試験の中で段を決めるため。署名は試験用)。
// 渡さなければ、送られた証明をそのまま本物の決まりで確かめる。state.env に KEY_SIGNING_JWK を入れると、本番と同じく試験用の証明を断る。
// state.offline = true で通信の失敗。state.calls・state.bodies に呼ばれた回数と中身が残る。
const path = require('path');
const CORE = path.join(__dirname, '../../backend/sedori/worker/src/core.js'), KEY = path.join(__dirname, '../../backend/sedori/worker/src/key.js');
module.exports = async function fakeCore(page, state) {
  const { handleCore } = await import(CORE), { signPass } = await import(KEY);
  const H = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
  await page.route('**/core', async route => {
    const req = route.request();
    if (req.method() !== 'POST') return route.fulfill({ status: 204, headers: Object.assign({ 'access-control-allow-headers': 'Content-Type', 'access-control-allow-methods': 'POST' }, H) });
    let body = {}; try { body = req.postDataJSON() || {}; } catch (e) { body = {}; }
    state.calls = (state.calls || 0) + 1; (state.bodies = state.bodies || []).push(body);
    if (state.offline) return route.abort('internetdisconnected');
    let b = body;
    if (state.tier && state.tier !== 'free') b = Object.assign({}, body, { pass: await signPass({}, { v: 1, t: state.tier, d: body.device, iat: Date.now(), exp: Date.now() + 864e5 }) });
    try { const out = await handleCore(b, state.env || {}); return route.fulfill({ status: 200, contentType: 'application/json', headers: H, body: JSON.stringify(out) }); }
    catch (e) { return route.fulfill({ status: e.status || 500, contentType: 'application/json', headers: H, body: JSON.stringify({ error: String(e.message), code: e.code }) }); }
  });
};
