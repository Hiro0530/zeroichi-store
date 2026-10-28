/* マスミチ — daily one-stroke path puzzle. ZEROICHI WORKS
   Data stays in this browser (localStorage). No tracking, no server. */
(() => {
"use strict";
const $ = s => document.querySelector(s);
const EPOCH = Date.UTC(2026, 8, 1); // No.1 = 2026-09-01 (JST)
const FREE_BACK = 2;                // free players can catch up on the last 2 days
const URL_SELF = "https://zeroichiworks.net/game/masumichi/";
const PRICE = "¥480";

/* ---------- i18n ---------- */
const T = {
ja:{shotEndless:"エンドレス 8×8",shotThemes:"色テーマ",shotArchive:"過去の問題",colFree:"無料",colFull:"フルパック",rowDaily:"今日の1問・記録・シェア",rowTut:"遊び方(3問)",rowArchive:"過去の問題",rowEndless:"エンドレス(5×5〜8×8)",rowHint:"ヒント",rowTheme:"色テーマ",last2:"直近2日",all:"すべて",unlimited:"無制限",th1:"1種",th5:"5種",flow1:"お申し込み後、PayPalの請求書をメールでお送りします。",flow2:"お申し込みから原則12時間以内に利用キーをメールでお送りします(お支払いの確認後)。",flow3:"キーをなくしたときは、同じメールアドレスからご連絡いただければ再発行します(無料)。",flow4:"デジタル商品のため、キー送付後の返金はできません。",seller:"販売事業者:ZEROICHI WORKS",upT:"もっと遊ぶなら フルパック",upS:"エンドレス無制限・過去問すべて ¥480 買い切り",ctxEndless:"エンドレスはフルパックで遊べます",ctxArchive:"この日の問題はフルパックで遊べます",ctxHint:"ヒントはフルパックで使えます",ctxTheme:"この色テーマはフルパックで使えます",ctxDaily:"今日の1問、おつかれさまでした。続きはこちらで",tagline:"1から順に、全部のマスを<br>1本の線で。",days:"日連続",playToday:"今日の1問をはじめる",continueToday:"続きから",replayToday:"もう一度あそぶ(記録は変わりません)",howto:"遊び方",howtoSub:"3問・30秒",endless:"エンドレス",archive:"過去の問題",themes:"色テーマ",supporterPack:"フルパック",supporterPitch:`エンドレス・過去問・ヒント・色テーマ<br>${PRICE}(買い切り)`,supporterOwned:"フルパック登録済み。応援ありがとうございます",tokushoho:"特定商取引法に基づく表記",privacy:"プライバシー",contact:"お問い合わせ",undo:"戻す",reset:"最初から",hint:"ヒント",streakLabel:"連続日数",bestLabel:"自己ベスト",playedLabel:"クリア数",share:"結果をシェア",saveImg:"画像で保存",next:"次の問題",toHome:"ホームへ",oneTime:"税込・買い切り(月額ではありません)",f1:"エンドレス:5×5〜8×8の問題を無限に",f2:"過去の日替わり問題をすべて",f3:"ヒント(詰まったら次の3マスを表示)",f4:"色テーマ4種(桜・抹茶・墨・夜光)",freeNote:"今日の1問・連続記録・シェアはずっと無料です。",buy:"メールで申し込む(¥480)",flow:"お申し込み後、PayPalの請求書をお送りします。お支払いを確認したら、利用キーをメールでお送りします(当日〜翌日)。デジタル商品のため、キー送付後の返金はできません。",apply:"登録",
 keyOk:"登録しました。すべてのモードが遊べます。",keyNg:"キーが正しくありません。メールに書かれたキー(MM- で始まる文字)をそのまま貼り付けてください。",
 clearedToday:t=>`今日はクリア済み ${t}。次の問題は0時に出ます`,notYet:"まだ誰も解いていない今日の問題です",inProgress:"途中から再開できます",
 coachStart:"「1」から指でなぞってスタート",coachNext:n=>`次は「${n}」へ`,coachFill:"全部のマスを通ってから、最後の数字へ",coachOrder:n=>`数字は順番に。いまは「${n}」を目指そう`,coachEnd:"最後の数字はゴール。残りのマスを通ってから入ろう",coachBack:"線をなぞり返すと戻れます",
 tut1:"「1」に指を置いて、2→3の順になぞってみよう",tut2:"ルールは1つ:全部のマスを通ること",tut3:"最後の数字がゴール。これで準備完了",tutDone:"遊び方はこれで全部。今日の1問へどうぞ",
 solved:"クリア",dailyKicker:n=>`No.${n} クリア`,nextIn:h=>`次の問題まで あと${h}`,moreArchive:"過去の問題も遊ぶ",moreEndless:"エンドレスで続ける",
 noHint:"ノーヒント",undoN:n=>`戻し${n}回`,copied:"結果をコピーしました",imgSaved:"画像を保存しました",locked:"フルパックで遊べます",hintShown:"光ったマスが正解ルートです",
 archiveTitle:"過去の問題",archiveNote:`無料では直近${FREE_BACK}日分まで。フルパックで全部遊べます。`,archiveNoteOwned:"好きな日の問題を選んでください。",endlessTitle:"エンドレス",endlessNote:"サイズを選んでください。解くたびに新しい問題が出ます。",themeTitle:"色テーマ",themeNote:"「藍」は無料。ほかはフルパックで使えます。",
 solvedCount:n=>`${n}問クリア`,size:n=>`${n}×${n}`,tutorial:"遊び方",daily:"今日の1問",th:{ai:"藍",sakura:"桜",matcha:"抹茶",sumi:"墨",yakou:"夜光"},
 shareHead:n=>`マスミチ No.${n}`,shareStreak:n=>`🔥${n}日連続`,sound:"音",back:"ホームへ",archiveSub:n=>`${n}問`,themeSub:n=>n},
en:{shotEndless:"Endless 8×8",shotThemes:"Themes",shotArchive:"Archive",colFree:"Free",colFull:"Full Pack",rowDaily:"Daily puzzle, streak, sharing",rowTut:"Tutorial (3)",rowArchive:"Past puzzles",rowEndless:"Endless (5×5–8×8)",rowHint:"Hints",rowTheme:"Color themes",last2:"Last 2 days",all:"All",unlimited:"Unlimited",th1:"1",th5:"5",flow1:"We reply with a PayPal invoice by email.",flow2:"Your unlock key arrives by email, normally within 12 hours of your request (after payment).",flow3:"Lost your key? Email us from the same address and we'll reissue it for free.",flow4:"Digital goods: no refunds after the key is sent.",seller:"Seller: ZEROICHI WORKS",upT:"Want more? Full Pack",upS:"Unlimited Endless + every past puzzle, ¥480 one-time",ctxEndless:"Endless is part of the Full Pack",ctxArchive:"This day is part of the Full Pack",ctxHint:"Hints come with the Full Pack",ctxTheme:"This theme comes with the Full Pack",ctxDaily:"Nice solve. Keep playing with:",tagline:"Start at 1. Fill every cell<br>with one line.",days:"day streak",playToday:"Play today's puzzle",continueToday:"Continue",replayToday:"Play again (record unchanged)",howto:"How to play",howtoSub:"3 puzzles · 30 sec",endless:"Endless",archive:"Archive",themes:"Themes",supporterPack:"Full Pack",supporterPitch:`Endless, archive, hints & themes<br>${PRICE} one-time`,supporterOwned:"Full Pack active. Thank you!",tokushoho:"Legal notice (JP)",privacy:"Privacy",contact:"Contact",undo:"Undo",reset:"Restart",hint:"Hint",streakLabel:"Streak",bestLabel:"Best",playedLabel:"Solved",share:"Share result",saveImg:"Save image",next:"Next puzzle",toHome:"Home",oneTime:"one-time purchase, tax incl. (not a subscription)",f1:"Endless: unlimited 5×5 to 8×8 puzzles",f2:"Every past daily puzzle",f3:"Hints (shows the next 3 cells)",f4:"4 color themes",freeNote:"Today's puzzle, streaks and sharing stay free forever.",buy:"Request by email (¥480)",flow:"We reply with a PayPal invoice. Once paid, your unlock key arrives by email (same or next day). Digital goods: no refunds after the key is sent.",apply:"Apply",
 keyOk:"Unlocked. Every mode is open.",keyNg:"That key doesn't match. Paste the key from the email exactly (it starts with MM-).",
 clearedToday:t=>`Solved today in ${t}. Next puzzle at midnight JST`,notYet:"A fresh puzzle, same for everyone today",inProgress:"Pick up where you left off",
 coachStart:"Drag from 1 to begin",coachNext:n=>`Next: ${n}`,coachFill:"Cover every cell, then reach the last number",coachOrder:n=>`Numbers go in order. Head for ${n}`,coachEnd:"The last number is the finish. Fill the rest first",coachBack:"Trace back over the line to undo",
 tut1:"Put your finger on 1 and drag through 2, then 3",tut2:"One rule: pass through every cell",tut3:"The last number is the goal. You're ready",tutDone:"That's it. Try today's puzzle",
 solved:"Solved",dailyKicker:n=>`No.${n} solved`,nextIn:h=>`Next puzzle in ${h}`,moreArchive:"Play past puzzles",moreEndless:"Keep going in Endless",
 noHint:"no hints",undoN:n=>`${n} undos`,copied:"Result copied",imgSaved:"Image saved",locked:"Included in the Full Pack",hintShown:"The glowing cells are the route",
 archiveTitle:"Archive",archiveNote:`Free: last ${FREE_BACK} days. Full Pack: all of them.`,archiveNoteOwned:"Pick any day.",endlessTitle:"Endless",endlessNote:"Pick a size. Every solve deals a new puzzle.",themeTitle:"Themes",themeNote:"Indigo is free. The rest come with the Full Pack.",
 solvedCount:n=>`${n} solved`,size:n=>`${n}×${n}`,tutorial:"How to play",daily:"Today",th:{ai:"Indigo",sakura:"Sakura",matcha:"Matcha",sumi:"Ink",yakou:"Neon"},
 shareHead:n=>`MASUMICHI No.${n}`,shareStreak:n=>`🔥${n}-day streak`,sound:"Sound",back:"Home",archiveSub:n=>`${n} puzzles`,themeSub:n=>n}
};

/* ---------- storage ---------- */
const KEY = "masumichi.v1";
let S = {v:1,lang:null,sound:true,theme:"ai",pro:null,daily:{},streak:{last:-9,cur:0,best:0},best:{},tutDone:false,endless:{},solved:0,cur:null};
try { const raw = localStorage.getItem(KEY); if (raw) S = Object.assign(S, JSON.parse(raw)); } catch(e) {}
function save(){ try { localStorage.setItem(KEY, JSON.stringify(S)); } catch(e) {} }
if (!S.lang) S.lang = (navigator.language||"ja").startsWith("ja") ? "ja" : "en";
const L = () => T[S.lang];
const isPro = () => !!(S.pro && S.pro.ok);

/* ---------- dates (JST) ---------- */
function jstDayIndex(){ const now = Date.now() + 9*3600e3; return Math.floor((now - EPOCH) / 86400e3); }
const todayNo = () => jstDayIndex() + 1;
function msToMidnightJST(){ const now = Date.now() + 9*3600e3; return 86400e3 - (now % 86400e3); }
function dateOfNo(no){ const d = new Date(EPOCH + (no-1)*86400e3); return `${d.getUTCMonth()+1}/${d.getUTCDate()}`; }
function sizeOfNo(no){ const dow = new Date(EPOCH + (no-1)*86400e3).getUTCDay(); return (dow === 0 || dow === 6) ? 7 : 6; }

/* ---------- PRNG ---------- */
function hashStr(s){ let h = 1779033703 ^ s.length; for (let i=0;i<s.length;i++){ h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = h<<13 | h>>>19; } return () => { h = Math.imul(h ^ h>>>16, 2246822507); h = Math.imul(h ^ h>>>13, 3266489909); return (h ^= h>>>16) >>> 0; }; }
function rng(seed){ let a = hashStr(seed)(); return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a>>>15, 1|a); t = t + Math.imul(t ^ t>>>7, 61|t) ^ t; return ((t ^ t>>>14) >>> 0) / 4294967296; }; }

/* ---------- generator ---------- */
function nbrs(N, c){ const r = (c/N)|0, k = c%N, o = []; if (r>0) o.push(c-N); if (r<N-1) o.push(c+N); if (k>0) o.push(c-1); if (k<N-1) o.push(c+1); return o; }
function hamPath(N, R){
  let p = []; for (let r=0;r<N;r++) for (let k=0;k<N;k++) p.push(r*N + (r%2 ? N-1-k : k));
  const pos = new Int16Array(N*N);
  const reidx = () => { for (let i=0;i<p.length;i++) pos[p[i]] = i; };
  reidx();
  const iters = N*N*60;
  for (let t=0;t<iters;t++){
    if (R() < .5) { p.reverse(); reidx(); }
    const head = p[p.length-1], prev = p[p.length-2];
    const ns = nbrs(N, head).filter(x => x !== prev);
    const n = ns[(R()*ns.length)|0];
    const i = pos[n];
    const tail = p.slice(i+1).reverse();
    p = p.slice(0, i+1).concat(tail);
    for (let j=i+1;j<p.length;j++) pos[p[j]] = j;
  }
  return p;
}
function solve(N, nums, K, limit, cap){
  // count solutions up to `limit`; returns {sols:[paths], capped}
  const total = N*N, vis = new Uint8Array(total), path = [], sols = []; let nodes = 0, capped = false;
  const start = nums.indexOf(1), endCell = nums.indexOf(K);
  const NB = []; for (let c=0;c<total;c++) NB.push(nbrs(N,c));
  const q = new Int16Array(total), seen = new Uint8Array(total);
  function ok(head){
    // connectivity of unvisited cells from head + dead-end check
    let unv = 0; for (let c=0;c<total;c++) if (!vis[c]) unv++;
    if (!unv) return true;
    seen.fill(0); let qh=0, qt=0, reach=0;
    for (const n of NB[head]) if (!vis[n] && !seen[n]) { seen[n]=1; q[qt++]=n; }
    while (qh<qt){ const c=q[qh++]; reach++; for (const n of NB[c]) if (!vis[n] && !seen[n]) { seen[n]=1; q[qt++]=n; } }
    if (reach !== unv) return false;
    let dead = 0;
    for (let c=0;c<total;c++) if (!vis[c] && c !== endCell){
      let d = 0; for (const n of NB[c]) if (!vis[n] || n===head) d++;
      if (d <= 1) { dead++; if (d === 0 || dead > 0) return false; }
    }
    return true;
  }
  function dfs(head, next){
    if (sols.length >= limit || capped) return;
    if (++nodes > cap) { capped = true; return; }
    if (path.length === total) { sols.push(path.slice()); return; }
    for (const n of NB[head]){
      if (vis[n]) continue;
      const v = nums[n];
      if (v) { if (v !== next) continue; if (v === K && path.length+1 !== total) continue; }
      vis[n]=1; path.push(n);
      if (ok(n)) dfs(n, v ? next+1 : next);
      vis[n]=0; path.pop();
      if (sols.length >= limit || capped) return;
    }
  }
  vis[start]=1; path.push(start); dfs(start, 2);
  return {sols, capped};
}
const cache = {};
function makePuzzle(seed, N){
  const id = seed+"|"+N; if (cache[id]) return cache[id];
  const R = rng(seed), sol = hamPath(N, R), total = N*N;
  let k = Math.max(3, Math.round(N*(N>=7?1.05:0.9)));
  const marks = new Set([0, total-1]);
  for (let i=1;i<k-1;i++){ const base = Math.round(i*(total-1)/(k-1)); const j = Math.min(total-2, Math.max(1, base + Math.round((R()-.5)*N*0.8))); marks.add(j); }
  const build = () => { const nums = new Array(total).fill(0); const idx = [...marks].sort((a,b)=>a-b); idx.forEach((pi,n)=>nums[sol[pi]] = n+1); return {nums, K: idx.length}; };
  let res = build();
  for (let guard=0; guard<30; guard++){
    const {sols, capped} = solve(N, res.nums, res.K, 2, N<=6 ? 300000 : 60000);
    const alt = sols.find(s => s.some((c,i)=>c!==sol[i]));
    if (!alt && !capped) break;
    if (alt){ let d = 0; while (alt[d] === sol[d]) d++; marks.add(Math.min(total-2, d)); }
    else { // capped: add a mark in the largest gap
      const idx=[...marks].sort((a,b)=>a-b); let g=0,gi=0; for (let i=1;i<idx.length;i++) if (idx[i]-idx[i-1]>g){g=idx[i]-idx[i-1];gi=i;} marks.add(Math.round((idx[gi]+idx[gi-1])/2)); }
    res = build();
  }
  return cache[id] = {N, nums: res.nums, K: res.K, sol};
}
const TUT = [
  {N:3, sol:[0,1,2,5,4,3,6,7,8], marks:[0,2,8]},
  {N:4, sol:[0,4,8,12,13,9,5,1,2,3,7,6,10,14,15,11], marks:[0,7,11,15]},
  {N:5, sol:[12,7,8,13,18,17,16,11,6,1,2,3,4,9,14,19,24,23,22,21,20,15,10,5,0], marks:[0,6,9,16,24]}
].map(t => { const nums = new Array(t.N*t.N).fill(0); t.marks.forEach((pi,n)=>nums[t.sol[pi]]=n+1); return {N:t.N, nums, K:t.marks.length, sol:t.sol}; });

/* ---------- sound ---------- */
let AC = null;
function ac(){ if (!AC) { try { AC = new (window.AudioContext||window.webkitAudioContext)(); } catch(e) {} } if (AC && AC.state === "suspended") AC.resume(); return AC; }
const SCALE = [0,2,4,7,9];
function tone(freq, dur=.12, type="triangle", vol=.16, when=0){
  if (!S.sound) return; const a = ac(); if (!a) return;
  const t = a.currentTime + when, o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t+.008); g.gain.exponentialRampToValueAtTime(.0008, t+dur);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t+dur+.02);
}
const midi = m => 440*Math.pow(2,(m-69)/12);
function sStep(i){ const deg = SCALE[i%5] + 12*Math.floor(i/5)%24; tone(midi(64+deg), .1, "triangle", .11); }
function sCheck(){ tone(midi(84), .18, "sine", .14); tone(midi(91), .22, "sine", .1, .06); }
function sBack(){ tone(midi(55), .06, "sine", .07); }
function sErr(){ tone(140, .16, "square", .05); tone(110, .18, "square", .04, .05); }
function sWin(){ [72,76,79,84,88,91,96].forEach((m,i)=>tone(midi(m), .35, i%2?"sine":"triangle", .12, i*.07)); tone(midi(60), .9, "sine", .1, .05); }
function buzz(ms){ try { navigator.vibrate && navigator.vibrate(ms); } catch(e) {} }

/* ---------- colors ---------- */
let C = {};
function readColors(){ const cs = getComputedStyle(document.body); ["board","cell","cell-line","ink","muted","p0","p1","p2"].forEach(k => C[k] = cs.getPropertyValue("--"+k).trim()); }
function hex(h){ h = h.replace("#",""); if (h.length===3) h = h.split("").map(x=>x+x).join(""); return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)]; }
function grad(t){ const a = t<.5 ? hex(C.p0) : hex(C.p1), b = t<.5 ? hex(C.p1) : hex(C.p2), u = t<.5 ? t*2 : (t-.5)*2; return `rgb(${a.map((v,i)=>Math.round(v+(b[i]-v)*u)).join(",")})`; }

/* ---------- game state ---------- */
const board = $("#board"), bx = board.getContext("2d");
let G = null; // {kind, id, no, P, path:[], t0, elapsed, undos, hints, done, pops:{}, ghost:null, winT:0}
let W = 300, cellPx = 50, PAD = 10, dpr = 1;

function startGame(kind, opts={}){
  let P, id, title, sub;
  if (kind === "daily"){ const no = opts.no; const N = sizeOfNo(no); P = makePuzzle("daily-"+no, N); id = "d"+no; title = `No.${no}`; sub = no === todayNo() ? `${L().daily} · ${L().size(N)}` : `${dateOfNo(no)} · ${L().size(N)}`; }
  else if (kind === "tut"){ P = TUT[opts.i]; id = "t"+opts.i; title = `${L().tutorial} ${opts.i+1}/3`; sub = L().size(P.N); }
  else { const N = opts.N, n = (S.endless[N]||0); P = makePuzzle(`endless-${N}-${n}`, N); id = "e"+N+"-"+n; title = `${L().endless} #${n+1}`; sub = L().size(N); }
  G = {kind, opts, id, P, path:[], t0:0, elapsed:0, undos:0, hints:0, done:false, pops:{}, ghost:null, winT:0, no: opts.no};
  if (S.cur && S.cur.id === id && !(kind==="daily" && S.daily[opts.no])) { G.path = S.cur.path.slice(); G.elapsed = S.cur.elapsed||0; G.undos = S.cur.undos||0; G.hints = S.cur.hints||0; }
  $("#gTitle").textContent = title; $("#gSub").textContent = sub;
  $("#hintBtn").classList.toggle("locked", !isPro() && kind !== "tut");
  show("game"); layout(); coach(); updTimer(); draw();
}
function persistCur(){ if (!G || G.done) return; S.cur = {id:G.id, path:G.path, elapsed:curElapsed(), undos:G.undos, hints:G.hints}; save(); }
function curElapsed(){ return G.elapsed + (G.t0 ? (performance.now()-G.t0) : 0); }
const fmt = ms => { const s = Math.floor(ms/1000); return `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`; };
function updTimer(){ if (G) $("#timer").textContent = fmt(curElapsed()); }
setInterval(() => { if (G && G.t0 && !G.done) updTimer(); }, 250);
document.addEventListener("visibilitychange", () => { if (!G || G.done) return; if (document.hidden && G.t0){ G.elapsed = curElapsed(); G.t0 = 0; persistCur(); } });

function nextNum(){ let n = 1; for (const c of G.path) if (G.P.nums[c]) n = G.P.nums[c]+1; return n; }
function coach(msg, warn){
  const el = $("#coach"); el.classList.toggle("warn", !!warn);
  if (msg) { el.textContent = msg; return; }
  if (G.kind === "tut") { el.textContent = [L().tut1, L().tut2, L().tut3][G.opts.i]; return; }
  const n = nextNum();
  el.textContent = !G.path.length ? L().coachStart : (n === G.P.K ? L().coachFill : L().coachNext(n));
}

function layout(){
  const wrap = $("#boardWrap"), avail = Math.min(wrap.clientWidth || 358, 480);
  const vh = window.innerHeight - 300; W = Math.max(240, Math.min(avail, vh));
  dpr = Math.min(window.devicePixelRatio||1, 3);
  board.style.width = board.style.height = W+"px"; board.width = board.height = Math.round(W*dpr);
  PAD = Math.round(W*0.03); cellPx = (W - PAD*2) / G.P.N;
  readColors();
}
window.addEventListener("resize", () => { if (G && $("#game").classList.contains("on")) { layout(); draw(); } });

function cellAt(x, y){ const N = G.P.N; const c = Math.floor((x-PAD)/cellPx), r = Math.floor((y-PAD)/cellPx); if (c<0||r<0||c>=N||r>=N) return -1; return r*N+c; }
function center(c){ const N = G.P.N; return [PAD + (c%N + .5)*cellPx, PAD + (((c/N)|0) + .5)*cellPx]; }
function adj(a, b){ const N = G.P.N; const ra=(a/N)|0, rb=(b/N)|0; return (ra===rb && Math.abs(a-b)===1) || (a%N===b%N && Math.abs(ra-rb)===1); }

let drag = false, lastErr = 0;
function tryAdd(c){
  const p = G.path, P = G.P, head = p[p.length-1];
  if (c === head) return true;
  const at = p.indexOf(c);
  if (at >= 0){ // trace back
    if (at === p.length-2){ p.pop(); G.undos++; sBack(); return true; }
    return false;
  }
  if (!adj(head, c)) return false;
  if (P.nums[head] === P.K) { err(L().coachEnd); return false; }
  const v = P.nums[c], n = nextNum();
  if (v && v !== n) { err(L().coachOrder(n)); return false; }
  if (v === P.K && p.length+1 !== P.N*P.N) { err(L().coachEnd); return false; }
  p.push(c); G.pops[c] = performance.now();
  if (v) { sCheck(); buzz(12); } else { sStep(p.length); buzz(4); }
  return true;
}
function err(msg){ const now = performance.now(); if (now - lastErr < 350) return; lastErr = now; sErr(); buzz([20,40,20]); coach(msg, true); board.animate([{transform:"translateX(0)"},{transform:"translateX(-7px)"},{transform:"translateX(6px)"},{transform:"translateX(-3px)"},{transform:"translateX(0)"}],{duration:260,easing:"ease-out"}); }
function stepTo(c){
  // walk from head toward c in straight-line steps so fast drags don't skip cells
  const N = G.P.N; let guard = 0;
  while (guard++ < N*2){
    const head = G.path[G.path.length-1]; if (head === c) return;
    const prev = G.path[G.path.length-2];
    if (c === prev || G.path.indexOf(c) === G.path.length-2) { tryAdd(c); return; }
    const hr=(head/N)|0, hc=head%N, tr=(c/N)|0, tc=c%N;
    let step;
    if (Math.abs(tr-hr) >= Math.abs(tc-hc)) step = head + (tr>hr?N:-N); else step = head + (tc>hc?1:-1);
    if (step === prev){ tryAdd(step); continue; }
    if (!tryAdd(step)) return;
  }
}
function pt(e){ const r = board.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
board.addEventListener("pointerdown", e => {
  if (!G || G.done) return; ac();
  const c = cellAt(...pt(e)); if (c < 0) return;
  board.setPointerCapture(e.pointerId); drag = true;
  if (!G.t0) G.t0 = performance.now();
  const at = G.path.indexOf(c);
  if (!G.path.length){
    if (G.P.nums[c] === 1){ G.path.push(c); G.pops[c] = performance.now(); sCheck(); }
    else { err(L().coachStart); drag = false; }
  } else if (at >= 0){ if (at < G.path.length-1){ G.undos++; G.path.length = at+1; sBack(); } }
  else if (adj(G.path[G.path.length-1], c)) tryAdd(c);
  else { err(L().coachBack); drag = false; }
  after();
});
board.addEventListener("pointermove", e => {
  if (!drag || !G || G.done) return;
  const [x,y] = pt(e), c = cellAt(x,y); if (c < 0) return;
  // only register when pointer is reasonably inside the cell (prevents diagonal jitter)
  const [cx,cy] = center(c); if (Math.abs(x-cx) > cellPx*.42 || Math.abs(y-cy) > cellPx*.42) return;
  const before = G.path.length; stepTo(c); if (G.path.length !== before) after();
});
const end = () => { drag = false; persistCur(); };
board.addEventListener("pointerup", end); board.addEventListener("pointercancel", end);

function after(){
  $("#progBar").style.width = (G.path.length / (G.P.N*G.P.N) * 100) + "%";
  const P = G.P;
  if (G.path.length === P.N*P.N && P.nums[G.path[G.path.length-1]] === P.K) win();
  else if (!$("#coach").classList.contains("warn") || performance.now() - lastErr > 1200) coach();
  draw();
}

$("#undoBtn").addEventListener("click", () => { if (!G || G.done || G.path.length <= 1) return; if (G.path.length) { G.path.pop(); G.undos++; sBack(); after(); persistCur(); } });
$("#resetBtn").addEventListener("click", () => { if (!G || G.done || !G.path.length) return; G.path = []; G.undos++; sBack(); after(); persistCur(); });
$("#hintBtn").addEventListener("click", () => {
  if (!G || G.done) return;
  if (!isPro() && G.kind !== "tut") { openSup("ctxHint"); return; }
  const sol = G.P.sol; let k = 0; while (k < G.path.length && G.path[k] === sol[k]) k++;
  if (k === 0) { G.path = [sol[0]]; k = 1; } else G.path.length = k;
  if (!G.t0) G.t0 = performance.now();
  G.hints++; G.ghost = {cells: sol.slice(k, k+3), t: performance.now()};
  tone(midi(79), .25, "sine", .1); tone(midi(86), .3, "sine", .08, .08);
  coach(L().hintShown); after(); persistCur();
});

/* ---------- drawing ---------- */
function rr(x,y,w,h,r){ bx.beginPath(); bx.moveTo(x+r,y); bx.arcTo(x+w,y,x+w,y+h,r); bx.arcTo(x+w,y+h,x,y+h,r); bx.arcTo(x,y+h,x,y,r); bx.arcTo(x,y,x+w,y,r); bx.closePath(); }
let raf = 0;
function draw(){ if (!raf) raf = requestAnimationFrame(frame); }
function frame(now){
  raf = 0; if (!G) return;
  const P = G.P, N = P.N, total = N*N, p = G.path;
  bx.setTransform(dpr,0,0,dpr,0,0); bx.clearRect(0,0,W,W);
  let anim = false;
  const gap = Math.max(2, cellPx*.06), rad = cellPx*.2;
  const inPath = new Int16Array(total).fill(-1); p.forEach((c,i)=>inPath[c]=i);
  // win wave
  const wt = G.done ? (now - G.winT) : -1;
  for (let c=0;c<total;c++){
    const x = PAD + (c%N)*cellPx + gap/2, y = PAD + ((c/N)|0)*cellPx + gap/2, s = cellPx-gap;
    rr(x,y,s,s,rad); bx.fillStyle = C.cell; bx.fill();
    const i = inPath[c];
    if (i >= 0){
      let a = .2;
      if (wt >= 0){ const d = wt - i*22; if (d > 0 && d < 420) { a = .2 + .55*Math.sin(d/420*Math.PI); anim = true; } else if (d <= 0) anim = true; }
      bx.globalAlpha = a; bx.fillStyle = grad(i/(total-1)); rr(x,y,s,s,rad); bx.fill(); bx.globalAlpha = 1;
    }
  }
  // ghost hint
  if (G.ghost){ const d = now - G.ghost.t; if (d < 2600){ anim = true; G.ghost.cells.forEach((c,j)=>{ const [cx,cy]=center(c); const a = (.5+.5*Math.sin(d/180 - j*.9)) * (1 - d/2600); bx.globalAlpha = a; bx.fillStyle = C.p1; bx.beginPath(); bx.arc(cx,cy,cellPx*.22,0,7); bx.fill(); }); bx.globalAlpha = 1; } else G.ghost = null; }
  // path
  const lw = cellPx*.36; bx.lineCap = "round"; bx.lineJoin = "round";
  for (let i=1;i<p.length;i++){
    const [x0,y0] = center(p[i-1]); let [x1,y1] = center(p[i]);
    const pop = G.pops[p[i]], age = pop ? now - pop : 999;
    if (age < 90){ const u = age/90; x1 = x0 + (x1-x0)*u; y1 = y0 + (y1-y0)*u; anim = true; }
    bx.strokeStyle = grad(i/(total-1)); bx.lineWidth = lw; bx.beginPath(); bx.moveTo(x0,y0); bx.lineTo(x1,y1); bx.stroke();
  }
  if (p.length){
    const [hx,hy] = center(p[p.length-1]);
    if (p.length === 1){ bx.fillStyle = grad(0); bx.beginPath(); bx.arc(hx,hy,lw/2,0,7); bx.fill(); }
    if (!G.done){ const pulse = .5+.5*Math.sin(now/260); bx.strokeStyle = grad((p.length-1)/(total-1)); bx.globalAlpha = .25+.25*pulse; bx.lineWidth = 3; bx.beginPath(); bx.arc(hx,hy,lw*.75+pulse*4,0,7); bx.stroke(); bx.globalAlpha = 1; anim = true; }
  }
  // numbers
  const nr = cellPx*.29; bx.textAlign = "center"; bx.textBaseline = "middle";
  bx.font = `800 ${Math.round(cellPx*.3)}px "M PLUS Rounded 1c", system-ui, sans-serif`;
  for (let c=0;c<total;c++){
    const v = P.nums[c]; if (!v) continue;
    const [cx,cy] = center(c), i = inPath[c];
    let sc = 1; const pop = G.pops[c]; if (pop && now-pop < 320){ const u=(now-pop)/320; sc = 1 + .35*Math.sin(u*Math.PI)*(1-u); anim = true; }
    bx.save(); bx.translate(cx,cy); bx.scale(sc,sc);
    bx.fillStyle = i >= 0 ? grad(i/(total-1)) : C.ink; bx.beginPath(); bx.arc(0,0,nr,0,7); bx.fill();
    if (i < 0 && !G.path.length && v === 1){ const pulse = .5+.5*Math.sin(now/300); bx.strokeStyle = C.p0; bx.globalAlpha = .5*pulse+.2; bx.lineWidth = 3; bx.beginPath(); bx.arc(0,0,nr+5+pulse*5,0,7); bx.stroke(); bx.globalAlpha=1; anim = true; }
    bx.fillStyle = i >= 0 ? "#fff" : C.board; bx.fillText(String(v), 0, 1);
    bx.restore();
  }
  if (anim) draw();
}

/* ---------- win ---------- */
function win(){
  G.done = true; G.elapsed = curElapsed(); G.t0 = 0; G.winT = performance.now(); S.cur = null;
  updTimer(); sWin(); buzz([30,50,60]); confetti(); coach(L().solved + " ✨");
  const t = G.elapsed; let isNewBest = false;
  S.solved = (S.solved||0) + 1;
  if (G.kind === "daily"){
    const no = G.no;
    if (!S.daily[no]) {
      S.daily[no] = {t: Math.round(t), u: G.undos, h: G.hints};
      if (no === todayNo()){
        S.streak.cur = (S.streak.last === no-1) ? S.streak.cur+1 : 1; S.streak.last = no;
        S.streak.best = Math.max(S.streak.best||0, S.streak.cur);
      }
    }
  } else if (G.kind === "tut"){ if (G.opts.i === 2) S.tutDone = true; }
  else { S.endless[G.P.N] = (S.endless[G.P.N]||0) + 1; }
  const bk = "s"+G.P.N; if (G.kind !== "tut" && (!S.best[bk] || t < S.best[bk])) { S.best[bk] = Math.round(t); isNewBest = true; }
  save();
  setTimeout(() => showResult(isNewBest), 1150);
}
function showResult(isNewBest){
  const k = G.kind, N = G.P.N;
  $("#rTitle").textContent = fmt(G.elapsed);
  $("#rKicker").textContent = k === "daily" ? L().dailyKicker(G.no) : (k === "tut" ? `${L().tutorial} ${G.opts.i+1}/3 ${L().solved}` : `${L().endless} ${L().size(N)} ${L().solved}`) + (isNewBest ? " ★" : "");
  $("#rStreak").textContent = streakNow();
  $("#rBest").textContent = S.best["s"+N] ? fmt(S.best["s"+N]) : "-";
  $("#rPlayed").textContent = S.solved;
  const daily = k === "daily";
  $("#rDailyActions").hidden = !daily; $("#rNextActions").hidden = daily;
  $("#nextBtn").textContent = (k === "tut" && G.opts.i === 2) ? L().playToday : L().next;
  $("#rNext").textContent = daily ? L().nextIn(fmtH(msToMidnightJST())) : (k==="tut" && G.opts.i===2 ? L().tutDone : "");
  $("#rUp").hidden = !(daily && !isPro());
  const more = $("#rMore"); more.textContent = daily ? (isPro() ? L().moreEndless : L().moreArchive) : "";
  openSheet("#resultSheet");
}
function fmtH(ms){ const m = Math.ceil(ms/60000); return S.lang === "ja" ? `${Math.floor(m/60)}時間${m%60}分` : `${Math.floor(m/60)}h ${m%60}m`; }
function streakNow(){ const s = S.streak; return (s.last >= todayNo()-1) ? s.cur : 0; }

/* confetti on overlay canvas */
const fx = $("#fx"), fxx = fx.getContext("2d"); let parts = [], fxRaf = 0;
function confetti(){
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const d = Math.min(devicePixelRatio||1, 2); fx.width = innerWidth*d; fx.height = innerHeight*d; fxx.setTransform(d,0,0,d,0,0);
  const r = board.getBoundingClientRect(), cx = r.left + r.width/2, cy = r.top + r.height/2;
  const cols = [C.p0, C.p1, C.p2, "#ffd166", "#ffffff"];
  for (let i=0;i<110;i++){ const a = Math.random()*Math.PI*2, v = 4 + Math.random()*9; parts.push({x:cx,y:cy,vx:Math.cos(a)*v,vy:Math.sin(a)*v-5,r:3+Math.random()*5,c:cols[i%cols.length],rot:Math.random()*6,vr:(Math.random()-.5)*.4,life:0,sq:Math.random()<.5}); }
  if (!fxRaf) fxRaf = requestAnimationFrame(fxFrame);
}
function fxFrame(){
  fxRaf = 0; fxx.clearRect(0,0,innerWidth,innerHeight);
  parts = parts.filter(p => p.life < 120 && p.y < innerHeight+20);
  for (const p of parts){ p.life++; p.vy += .28; p.vx *= .985; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
    fxx.save(); fxx.globalAlpha = Math.max(0, 1 - p.life/120); fxx.translate(p.x,p.y); fxx.rotate(p.rot); fxx.fillStyle = p.c;
    if (p.sq) fxx.fillRect(-p.r,-p.r/2,p.r*2,p.r); else { fxx.beginPath(); fxx.arc(0,0,p.r*.7,0,7); fxx.fill(); } fxx.restore(); }
  if (parts.length) fxRaf = requestAnimationFrame(fxFrame); else fxx.clearRect(0,0,innerWidth,innerHeight);
}

/* ---------- share ---------- */
function shareText(){
  const no = G.no, d = S.daily[no] || {t:G.elapsed,u:G.undos,h:G.hints}, N = sizeOfNo(no);
  const bar = "🟦🟪🟥"; const clean = !d.h ? "✨" + L().noHint : "💡" + d.h;
  return `${L().shareHead(no)} ${L().size(N)}\n⏱ ${fmt(d.t)}  ${clean}\n${L().shareStreak(streakNow())}  ${bar}\n${URL_SELF}`;
}
$("#shareBtn").addEventListener("click", async () => {
  const text = shareText();
  try { if (navigator.share) { await navigator.share({text}); return; } } catch(e) { if (e && e.name === "AbortError") return; }
  try { await navigator.clipboard.writeText(text); toast(L().copied); } catch(e) { prompt("", text); }
});
function cardCanvas(){
  const no = G.no, d = S.daily[no] || {t:G.elapsed,h:G.hints}, N = sizeOfNo(no);
  const cv = document.createElement("canvas"); cv.width = cv.height = 1080; const x = cv.getContext("2d");
  const g = x.createLinearGradient(0,0,1080,1080); g.addColorStop(0,"#13203d"); g.addColorStop(1,"#2a1748"); x.fillStyle = g; x.fillRect(0,0,1080,1080);
  // abstract path ribbon (not the answer): a random serpentine across a grid
  const R = rng("card-"+no), M = 6, cs = 1080/M; let p = hamPath(M, R);
  x.lineCap = x.lineJoin = "round"; x.lineWidth = 46; x.globalAlpha = .22;
  for (let i=1;i<p.length;i++){ const a=p[i-1], b=p[i]; x.strokeStyle = grad(i/(p.length-1)); x.beginPath(); x.moveTo((a%M+.5)*cs,((a/M|0)+.5)*cs); x.lineTo((b%M+.5)*cs,((b/M|0)+.5)*cs); x.stroke(); }
  x.globalAlpha = 1;
  x.fillStyle = "rgba(10,14,32,.55)"; x.beginPath(); x.roundRect ? x.roundRect(110,250,860,580,60) : x.rect(110,250,860,580); x.fill();
  x.textAlign = "center"; x.fillStyle = "#fff";
  x.font = '800 64px "M PLUS Rounded 1c", sans-serif'; x.fillText(S.lang==="ja" ? "マスミチ" : "MASUMICHI", 540, 350);
  x.font = '500 40px "M PLUS Rounded 1c", sans-serif'; x.fillStyle = "#c6cdea"; x.fillText(`No.${no} · ${N}×${N}`, 540, 420);
  const tg = x.createLinearGradient(300,0,780,0); tg.addColorStop(0,C.p0); tg.addColorStop(.5,C.p1); tg.addColorStop(1,C.p2);
  x.fillStyle = tg; x.font = '800 210px "M PLUS Rounded 1c", sans-serif'; x.fillText(fmt(d.t), 540, 620);
  x.fillStyle = "#fff"; x.font = '800 46px "M PLUS Rounded 1c", sans-serif';
  x.fillText(`${L().shareStreak(streakNow())}   ${!d.h ? "✨"+L().noHint : "💡"+d.h}`, 540, 740);
  x.fillStyle = "#9aa3c7"; x.font = '500 34px "M PLUS Rounded 1c", sans-serif'; x.fillText("zeroichiworks.net/game/masumichi", 540, 990);
  x.fillText("ZEROICHI WORKS", 540, 1040);
  return cv;
}
$("#imgBtn").addEventListener("click", async () => {
  const cv = cardCanvas();
  cv.toBlob(async blob => {
    const file = new File([blob], `masumichi-${G.no}.png`, {type:"image/png"});
    try { if (navigator.canShare && navigator.canShare({files:[file]})) { await navigator.share({files:[file], text: shareText()}); return; } } catch(e) { if (e && e.name === "AbortError") return; }
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = file.name; document.body.appendChild(a); a.click(); a.remove(); toast(L().imgSaved);
  }, "image/png");
});
window.__masumichiCard = () => cardCanvas().toDataURL("image/png");

/* ---------- screens & sheets ---------- */
function show(id){ document.querySelectorAll(".screen").forEach(s => s.classList.toggle("on", s.id === id)); window.scrollTo(0,0); }
function openSheet(sel){ const el = $(sel); el.hidden = false; const f = el.querySelector("button,input,a"); f && f.focus({preventScroll:true}); }
function closeSheets(){ document.querySelectorAll(".sheet").forEach(s => s.hidden = true); }
document.querySelectorAll(".sheet").forEach(s => s.addEventListener("click", e => { if (e.target === s || e.target.closest("[data-close]")) s.hidden = true; }));
document.addEventListener("keydown", e => { if (e.key === "Escape") closeSheets(); });
function toast(m){ const t = $("#toast"); t.textContent = m; t.classList.add("on"); clearTimeout(toast.h); toast.h = setTimeout(()=>t.classList.remove("on"), 2200); }

$("#backBtn").addEventListener("click", () => { if (G && !G.done && G.t0){ G.elapsed = curElapsed(); G.t0 = 0; } persistCur(); G = null; home(); });
$("#rClose").addEventListener("click", () => { closeSheets(); G = null; home(); });
$("#nextBtn").addEventListener("click", () => {
  closeSheets();
  if (G.kind === "tut"){ if (G.opts.i < 2) startGame("tut", {i:G.opts.i+1}); else startGame("daily", {no: todayNo()}); }
  else startGame("endless", {N: G.P.N});
});
$("#rUp").addEventListener("click", () => { closeSheets(); openSup("ctxDaily"); });
$("#rMore").addEventListener("click", () => { closeSheets(); G = null; home(); if (isPro()) openEndless(); else openArchive(); });

$("#playDaily").addEventListener("click", () => { ac(); if (!S.tutDone && !Object.keys(S.daily).length) startGame("tut", {i:0}); else startGame("daily", {no: todayNo()}); });
$("#modeTutorial").addEventListener("click", () => { ac(); startGame("tut", {i:0}); });
$("#modeEndless").addEventListener("click", () => { ac(); if (!isPro()) { openSup("ctxEndless"); return; } openEndless(); });
$("#modeArchive").addEventListener("click", () => { ac(); openArchive(); });
$("#modeTheme").addEventListener("click", () => openThemes());
$("#supporterBtn").addEventListener("click", () => openSup());

function openArchive(){
  const g = $("#listGrid"); g.className = "list-grid"; g.innerHTML = "";
  $("#listTitle").textContent = L().archiveTitle; $("#listNote").textContent = isPro() ? L().archiveNoteOwned : L().archiveNote;
  const t = todayNo();
  for (let no = t-1; no >= 1; no--){
    const free = no >= t - FREE_BACK, open = isPro() || free, d = S.daily[no];
    const b = document.createElement("button"); b.className = "cellbtn" + (d ? " clear" : "") + (open ? "" : " locked");
    b.innerHTML = `<span>${no}</span><small>${d ? fmt(d.t) : dateOfNo(no)}</small>`;
    b.addEventListener("click", () => { if (!open) { closeSheets(); openSup("ctxArchive"); return; } closeSheets(); startGame("daily", {no}); });
    g.appendChild(b);
  }
  openSheet("#listSheet");
}
function openEndless(){
  const g = $("#listGrid"); g.className = "list-grid wide"; g.innerHTML = "";
  $("#listTitle").textContent = L().endlessTitle; $("#listNote").textContent = L().endlessNote;
  [5,6,7,8].forEach(N => { const b = document.createElement("button"); b.className = "cellbtn"; b.innerHTML = `<span>${L().size(N)}</span><small>${L().solvedCount(S.endless[N]||0)}${S.best["s"+N] ? " · ★"+fmt(S.best["s"+N]) : ""}</small>`; b.addEventListener("click", () => { closeSheets(); startGame("endless", {N}); }); g.appendChild(b); });
  openSheet("#listSheet");
}
const THEMES = {ai:["#2f6bd8","#8b4fd6","#f0557c"], sakura:["#f6a6c4","#e45d86","#a92e61"], matcha:["#b5d36e","#5c9a3f","#245b33"], sumi:["#9a9a96","#2a2a2a","#c7302a"], yakou:["#2ee6ff","#7c6bff","#ff4fd8"]};
function openThemes(){
  const g = $("#listGrid"); g.className = "list-grid wide"; g.innerHTML = "";
  $("#listTitle").textContent = L().themeTitle; $("#listNote").textContent = L().themeNote;
  Object.keys(THEMES).forEach(k => { const open = k === "ai" || isPro(); const b = document.createElement("button"); b.className = "cellbtn" + (S.theme === k ? " cur" : "") + (open ? "" : " locked");
    b.innerHTML = `<i class="swatch" style="background:linear-gradient(90deg,${THEMES[k].join(",")})"></i><span>${L().th[k]}</span>`;
    b.addEventListener("click", () => { if (!open) { closeSheets(); openSup("ctxTheme"); return; } S.theme = k; save(); applyTheme(); openThemes(); });
    g.appendChild(b); });
  openSheet("#listSheet");
}
function applyTheme(){ document.body.dataset.theme = isPro() || S.theme === "ai" ? S.theme : "ai"; readColors(); const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = getComputedStyle(document.body).getPropertyValue("--bg").trim() || "#13203d"; $("#themeSub").textContent = L().th[document.body.dataset.theme]; if (G) draw(); }

function openSup(ctx){
  const cx = $("#supCtx"); cx.hidden = !ctx || isPro(); if (ctx) cx.textContent = L()[ctx];
  const ja = S.lang === "ja";
  const subj = encodeURIComponent(ja ? "マスミチ フルパック申し込み" : "MASUMICHI Full Pack");
  const body = encodeURIComponent(ja ? `マスミチのフルパック(${PRICE}・買い切り)を申し込みます。\n\nお名前(ニックネーム可):\nPayPalのメールアドレス(請求書の送り先):\n` : `I'd like the MASUMICHI Full Pack (${PRICE}, one-time).\n\nName (nickname OK):\nPayPal email (for the invoice):\n`);
  $("#buyMail").href = `mailto:zeroichi.works.jp@gmail.com?subject=${subj}&body=${body}`;
  $("#keyMsg").textContent = isPro() ? L().keyOk : ""; $("#keyMsg").className = "key-msg" + (isPro() ? " ok" : "");
  if (isPro()) $("#keyInput").value = S.pro.key;
  openSheet("#supSheet");
}
async function verifyKey(k){
  k = (k||"").trim().toUpperCase();
  const m = /^MM-([A-Z0-9]{8})-([A-F0-9]{4})$/.exec(k); if (!m) return false;
  if (!(window.crypto && crypto.subtle)) return false;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("masumichi:" + m[1]));
  const hx = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("").toUpperCase();
  return hx.slice(0,4) === m[2];
}
$("#keyApply").addEventListener("click", async () => {
  const k = $("#keyInput").value, msg = $("#keyMsg");
  if (await verifyKey(k)) { S.pro = {key:k.trim().toUpperCase(), ok:true}; save(); msg.textContent = L().keyOk; msg.className = "key-msg ok"; sWin(); confetti(); home(); }
  else { msg.textContent = L().keyNg; msg.className = "key-msg ng"; sErr(); }
});

/* ---------- home ---------- */
function i18n(){
  document.documentElement.lang = S.lang;
  document.querySelectorAll("[data-i18n]").forEach(el => { const v = L()[el.dataset.i18n]; if (typeof v === "string") el.innerHTML = v; });
  document.querySelectorAll("[data-i18n-aria]").forEach(el => el.setAttribute("aria-label", L()[el.dataset.i18nAria]));
  $("#langBtn").textContent = S.lang === "ja" ? "EN" : "JA";
}
function home(){
  i18n(); applyTheme();
  const no = todayNo(), N = sizeOfNo(no), d = S.daily[no];
  $("#todayNo").textContent = `No.${no}`; $("#todaySize").textContent = `${dateOfNo(no)} · ${L().size(N)}`;
  const st = streakNow(); $("#streakN").textContent = st; $("#streakChip").classList.toggle("zero", !st);
  const btn = $("#playDaily"), lab = $("#playDailyLabel");
  if (d) { lab.textContent = L().replayToday; btn.classList.add("done"); btn.classList.remove("primary"); $("#todaySub").textContent = L().clearedToday(fmt(d.t)); }
  else { btn.classList.remove("done"); btn.classList.add("primary"); const ip = S.cur && S.cur.id === "d"+no; lab.textContent = ip ? L().continueToday : L().playToday; $("#todaySub").textContent = ip ? L().inProgress : L().notYet; }
  const lock = '<svg class="lock" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M7 11V8a5 5 0 0 1 10 0v3 M5 11h14v10H5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
  document.querySelectorAll(".mode .lock").forEach(l => l.remove());
  if (!isPro()) $("#modeEndless").insertAdjacentHTML("beforeend", lock);
  $("#archiveSub").textContent = L().archiveSub(Math.max(0, no-1));
  const sc = $("#supporterBtn"); sc.classList.toggle("owned", isPro());
  $("#supporterSub").innerHTML = isPro() ? L().supporterOwned : L().supporterPitch;
  $("#soundBtn").classList.toggle("muted", !S.sound);
  show("home"); demoStart();
}
$("#langBtn").addEventListener("click", () => { S.lang = S.lang === "ja" ? "en" : "ja"; save(); home(); });
$("#soundBtn").addEventListener("click", () => { S.sound = !S.sound; save(); $("#soundBtn").classList.toggle("muted", !S.sound); if (S.sound) { ac(); sCheck(); } });

/* demo animation on home */
const demo = $("#demo"), dx = demo.getContext("2d");
const DEMO = TUT[1]; let demoT0 = 0, demoRaf = 0;
function demoStart(){ if (!demoRaf) { demoT0 = performance.now(); demoRaf = requestAnimationFrame(demoFrame); } }
function demoFrame(now){
  demoRaf = 0; if (!$("#home").classList.contains("on")) return;
  const d = Math.min(devicePixelRatio||1, 3), size = demo.clientWidth || 210;
  if (demo.width !== Math.round(size*d)) { demo.width = demo.height = Math.round(size*d); }
  dx.setTransform(d,0,0,d,0,0); dx.clearRect(0,0,size,size);
  const N = DEMO.N, pad = size*.05, cs = (size-pad*2)/N, total = N*N;
  dx.fillStyle = C.board || "#fff"; dx.beginPath(); dx.roundRect ? dx.roundRect(0,0,size,size,size*.09) : dx.rect(0,0,size,size); dx.fill();
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const cyc = 5200, t = reduce ? cyc*.7 : (now - demoT0) % cyc, prog = Math.min(1, t / (cyc*.62)) * (total-1);
  const cen = c => [pad + (c%N+.5)*cs, pad + ((c/N|0)+.5)*cs];
  for (let c=0;c<total;c++){ const x = pad+(c%N)*cs+2, y = pad+(c/N|0)*cs+2; dx.fillStyle = C.cell || "#e3e9f3"; dx.beginPath(); dx.roundRect ? dx.roundRect(x,y,cs-4,cs-4,cs*.2) : dx.rect(x,y,cs-4,cs-4); dx.fill(); }
  dx.lineCap = dx.lineJoin = "round"; dx.lineWidth = cs*.36;
  const s = DEMO.sol;
  for (let i=1;i<=Math.ceil(prog);i++){
    const [x0,y0] = cen(s[i-1]); let [x1,y1] = cen(s[i]); const u = Math.min(1, prog-(i-1));
    x1 = x0 + (x1-x0)*u; y1 = y0 + (y1-y0)*u; dx.strokeStyle = grad(i/(total-1)); dx.beginPath(); dx.moveTo(x0,y0); dx.lineTo(x1,y1); dx.stroke();
  }
  dx.textAlign = "center"; dx.textBaseline = "middle"; dx.font = `800 ${Math.round(cs*.3)}px "M PLUS Rounded 1c", sans-serif`;
  for (let c=0;c<total;c++){ const v = DEMO.nums[c]; if (!v) continue; const [x,y] = cen(c); const idx = s.indexOf(c); dx.fillStyle = idx <= prog ? grad(idx/(total-1)) : (C.ink||"#16213f"); dx.beginPath(); dx.arc(x,y,cs*.28,0,7); dx.fill(); dx.fillStyle = idx <= prog ? "#fff" : (C.board||"#fff"); dx.fillText(v, x, y+1); }
  // finger
  if (prog < total-1 && !reduce){ const i = Math.floor(prog), u = prog - i; const [a,b] = cen(s[i]), [c2,e] = cen(s[Math.min(i+1,total-1)]); const fxp = a+(c2-a)*u, fyp = b+(e-b)*u; dx.fillStyle = "rgba(255,255,255,.9)"; dx.strokeStyle = "rgba(22,33,63,.35)"; dx.lineWidth = 2; dx.beginPath(); dx.arc(fxp+cs*.12,fyp+cs*.16,cs*.16,0,7); dx.fill(); dx.stroke(); }
  if (!reduce) demoRaf = requestAnimationFrame(demoFrame);
}

/* ---------- boot ---------- */
readColors(); home();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (G) draw(); });
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => { applyTheme(); });
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(()=>{});
window.__masumichi = { get S(){ return S; }, get G(){ return G; }, makePuzzle, todayNo, sizeOfNo };
})();
