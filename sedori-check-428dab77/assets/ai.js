/* せどり 利益チェック — 「AIに相談」(第1段階)
   当方はAIにつながない。相談文(当方の前提=マスタープロンプト+相談の型+この画面の数字)をコピーして、
   利用者が自分で開いた Gemini・ChatGPT(無料版)に貼り付けて相談する。費用は利用者・当方ともにかからない。
   - 前提の文は config.js の料金・年払いの決まりから毎回作る(料金を変えても、ここを直さなくてよい)
   - 画面の数字は、計算の欄(左の条件・右の内訳)と結果の文だけを読む。APIキーと取引相手の情報(#party)は読まない
   - 注意書き(AIの回答は参考・税金と法律は専門家へ)は、パネルの一番上に常に出す
   開き方: ヘッダーの「AIに相談」、計算ページの「この数字でAIに相談」、どのページでも URL の #ai */
(function () {
  'use strict';
  var U = window.SedoriUI; if (!U) return;
  var $ = U.$, $$ = U.$$, esc = U.esc;
  var cfg = window.ZW_CONFIG || {};
  var CAT = cfg.PLAN_CATALOG || {};

  function yen(k, d) { var c = CAT[k]; return (c ? Number(c.price) : d).toLocaleString('ja-JP') + '円'; }
  function founderOpen() { var f = CAT.founder_month; return !!f && f.open !== false; }

  /* 相談の範囲(2026-10-29 オーナー指示: せどりとソフトの使い方以外は受け付けない。家族も使うため)。文面(全角の括弧も)は変えずにそのまま入れる */
  var SCOPE = 'この相談窓口は、せどりとこのソフトの使い方専用です。それ以外の相談（個人的な悩み、健康、恋愛、家族、お金そのものなど）には答えず、せどり専用窓口である旨を案内してください。';

  /** 当方の前提(マスタープロンプト)。tail: 'ack'(前提だけ貼る時)/'go'(相談文と一緒に貼る時) */
  function master(tail) {
    var days = cfg.YEAR_REFUND_DAYS || 30;
    return [
      'あなたは、せどり(仕入れて売る物販)の相談相手です。私は「せどり 利益チェック」(ZEROICHI WORKS)というウェブアプリで、利益の計算と古物台帳の記録をしています。次の前提で答えてください。',
      '',
      '■ アプリでできること',
      '- 5つの仕入れルートの利益計算: 楽天・Yahoo!→Amazon/無在庫 Amazon中古×ヤフオク/メルカリ/ヤフオク→メルカリ/業者オークション→メルカリ',
      '- 古物台帳: 計算ページで「仕入れた」を押すと1行入り、「売れた」で売却日・売値が埋まる。CSV・Excelで書き出せる',
      '- 帳簿(有料の総合・業務): 売上の取り込み・経費・月ごとの利益・売れ残り・棚卸・確定申告用の数字',
      '- メルカリ・ヤフオク・Amazonのページは自動で読み取らない。相場は自分で見て入れる',
      '',
      '■ 利益の決まり(このアプリの計算)',
      '利益 = 売値 − 販売手数料 − 送料・資材 − 仕入れ値 − 仕入れの送料 − その他の経費 + ポイント(実際に使える分だけ)',
      '- 判断の順番は「価格差が先、ポイントは後」。まずポイント抜きの利益(売値−仕入れ−手数料−送料)が黒字かを見て、ポイントはその上乗せとして数える',
      '- 売値は、実際に売れている値段(相場)で考える。アプリの「目標の売値」は、ポイントを足さずに(ポイント抜きで)目標の利益に届く売値を逆算した目安で、その値段で売れるという意味ではない',
      '- メルカリ・Yahoo!オークションの販売手数料は売値の10%(1円未満切り捨て)',
      '- Amazonは販売手数料(カテゴリー別)とFBAの配送代行手数料。在庫の保管料・返品・値下がりは計算に入っていない',
      '- 目標の利益は「円」か「売値の%」で決める。手数料と送料は公開されている料金表にもとづく目安',
      '',
      '■ 料金(税込)',
      '- 無料: 計算と、この端末に保存する台帳。登録なし',
      '- ライト 月' + yen('light_month', 2980) + '/総合 月' + yen('total_month', 4980) + (founderOpen() ? '(先着' + (Number(cfg.FOUNDER_LIMIT) || 200) + '名は月' + yen('founder_month', 3980) + ')' : '') + '/業務 月' + yen('business_month', 7980),
      '- 年払いは10か月分の料金で1年(ライト' + yen('light_year', 29800) + '・総合' + yen('total_year', 49800) + '・業務' + yen('business_year', 79800) + ')',
      '- 月払いは初回14日無料。年払いは無料期間なしで、1回目のお支払いから' + days + '日以内の解約は全額返金(その日で終了)。' + (days + 1) + '日目からの解約は返金なしで、期間の終わりまで使え、次の更新はされない',
      '- 解約はマイページの「解約する」か、メール1通',
      '',
      '■ 答え方の決まり',
      '1. ' + SCOPE,
      '2. 数字が足りない時は、推測で埋めずに先に質問する',
      '3. 将来の売れ行き・相場・利益を断定したり保証したりしない。見込みは「目安」と書く',
      '4. 確定申告・経費・控除など個別の税務の判断は「税理士か税務署に確かめてください」と伝え、一般的な説明だけにする',
      '5. 規約違反になるか、契約のトラブルなど個別の法律の判断は「弁護士などの専門家に相談してください」と伝える',
      '6. 古物商許可や売り手の確認(古物営業法)が関わる時は、所轄の警察署で確かめるよう添える',
      '7. 取引相手の氏名・住所・電話番号は聞かない',
      '8. 日本語で、短く、箇条書きを中心に答える',
      '',
      tail === 'ack' ? 'この前提を覚えたら「わかりました」とだけ答えてください。続けて相談します。' : 'この前提で、次の相談に答えてください。'
    ].join('\n');
  }

  /* ---------- この画面の数字 ---------- */
  var SKIP = /^(k-|mz-key|sb-|t-val|d[123g]$|lg-|mp-)/;
  function fieldText(lb) {
    var inp = lb.querySelector('input, select'); if (!inp || !inp.id || SKIP.test(inp.id) || inp.closest('#party, #keys, .keys, [hidden]')) return null;
    if (inp.type === 'checkbox') return inp.checked ? '・' + clean(lb.textContent) : null;
    var v = inp.tagName === 'SELECT' ? (inp.options[inp.selectedIndex] || {}).text : inp.value;
    if (v == null || String(v).trim() === '') return null;
    var nm = lb.querySelector('.fk, .ck2'), name = '';
    if (nm) { var sm = nm.querySelector('small'); name = clean(nm.firstChild && nm.firstChild.nodeType === 3 ? nm.firstChild.textContent : nm.textContent); if (sm && clean(sm.textContent).length <= 12) name += '(' + clean(sm.textContent) + ')'; }
    var unit = lb.querySelector('.u'); unit = unit ? unit.textContent.trim() : '';
    return '・' + name + ': ' + String(v).trim() + unit;
  }
  function clean(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function pageNumbers() {
    var out = [], page = document.body.getAttribute('data-page') || '';
    var label = document.body.getAttribute('data-route-label');
    if (label) out.push('・仕入れルート: ' + label);
    var nm = $('#d-name'); if (nm && label && clean(nm.textContent) && !/一覧の行を選ぶ|^—$/.test(clean(nm.textContent))) { var dk = $('.det-k'); out.push('・' + (dk ? clean(dk.textContent) : '選んだもの') + ': ' + clean(nm.textContent)); }
    if (label) {
      $$('main .side label.fr, main .side label.ck, main .det label.cell').forEach(function (lb) { var t = fieldText(lb); if (t) out.push(t); });
      try { out.push('・目標の利益: ' + U.targetLabel()); } catch (e) { /* 何もしない */ }
      try { out.push('・発送: ' + U.SHIP_LABEL[U.shipMode()]); } catch (e) { /* 何もしない */ }
      var res = $('#c-out') || $('#m-out') || $('#mz-out');
      var rt = res ? clean(res.innerText || res.textContent) : '';
      if (rt) out.push('・計算の結果: ' + rt.slice(0, 600));
    }
    if (page === 'daicho') {
      var sum = $('#lg-sum'); var st = sum ? clean(sum.innerText || sum.textContent) : '';
      var per = $('#lg-period'); var pt = per ? (per.options[per.selectedIndex] || {}).text : '';
      if (st) out.push('・台帳の集計(' + (pt || '期間') + '): ' + st);
    }
    return out;
  }

  /* ---------- 相談の型(6つ) ---------- */
  var KINDS = [
    { id: 'shiire', label: '仕入れの判断', ask: '次の商品を仕入れるか迷っています。仕入れる前に確かめておくべき点(売れるまでの期間・値下がり・手数料や送料の見落とし・出品の規約・古物営業法)を、大事な順に挙げてください。足りない数字があれば先に質問してください。', blank: '・商品:\n・仕入れ値:\n・売る場所と、見た相場:\n・送料:', more: '・商品:\n・売る場所で見た相場(売れた値段):' },
    { id: 'nedan', label: '売値の相談', ask: 'いくらで出品するか決めたいです。下の数字で、目標の利益を残せる売値の考え方と、相場を自分で確かめる手順を教えてください。相場は私が調べて伝えます。', blank: '・商品:\n・仕入れ値:\n・送料:\n・残したい利益:', more: '・商品:\n・売る場所で見た相場(売れた値段):' },
    { id: 'urenokori', label: '売れ残り対策', ask: '出品しても売れていない商品があります。「値下げする」「売る場所を変える」「写真や説明を見直す」「持っておく」を、それぞれ手残り(手数料・送料を引いた額)と手間で比べてください。', blank: '・商品:\n・出品してからの日数:\n・今の売値:\n・仕入れ値:\n・送料:', more: '・商品:\n・出品してからの日数:\n・今の売値:' },
    { id: 'trouble', label: 'トラブルの返信', ask: '購入者から次のメッセージが届きました。丁寧で、事実だけを書いた返信の文を作ってください。販売サイトの規約で決まっていることがありそうなら、ヘルプのどこを確かめればよいかも教えてください。法律の判断が要る内容なら、そう書いてください。', blank: '・販売サイト:\n・商品と、発送した日:\n・届いたメッセージ(相手の名前・住所・電話番号は消してから貼ってください):\n' },
    { id: 'furikaeri', label: '月の振り返り', ask: '今月のせどりを振り返りたいです。下の数字から、良かった点・見直す点・来月まず1つやることを挙げてください。', blank: '・売上:\n・仕入れ:\n・手数料と送料:\n・売れた数・売れ残りの数:' },
    { id: 'shinkoku', label: '確定申告の一般論', ask: 'せどり(個人の物販)の確定申告について、一般的な流れと、1年を通して記録しておくものを教えてください。私の場合に経費になるか・申告が要るかなどの個別の判断は、税理士か税務署に確かめます。', blank: '・働き方(会社員の副業/個人事業 など):\n・せどりを始めた時期:\n・気になっていること:' }
  ];
  var DEF_BY_PAGE = { daicho: 'furikaeri', books: 'shinkoku' };

  var st = { kind: null, withMaster: true, edited: false };
  function kindOf(id) { for (var i = 0; i < KINDS.length; i++) if (KINDS[i].id === id) return KINDS[i]; return KINDS[0]; }
  function body() {
    var k = kindOf(st.kind), nums = pageNumbers();
    return k.ask + '\n\n【数字・状況】\n' + (nums.length ? nums.join('\n') + '\n' + (k.more != null ? k.more : k.blank) : k.blank);
  }
  function full() { return (st.withMaster ? master('go') + '\n\n----\n\n' : '') + $('#ai-txt').value; }

  /* ---------- パネル ---------- */
  var dlg = null;
  function build() {
    dlg = document.createElement('dialog'); dlg.className = 'dlg ai-dlg'; dlg.id = 'ai-dlg'; dlg.setAttribute('aria-labelledby', 'ai-h');
    dlg.innerHTML = '<div class="ai-in">' +
      '<div class="dlg-h"><h2 id="ai-h">AIに相談</h2><button type="button" class="dlg-x" data-x aria-label="閉じる">×</button></div>' +
      '<p class="ai-warn" role="note"><b>AIの回答は参考です。</b>将来の売れ行きや利益を約束するものではありません。税金・法律の判断は、税理士・税務署や弁護士などの専門家へご相談ください。</p>' +
      '<ol class="ai-steps"><li>相談を選ぶ</li><li>「コピーして開く」</li><li>開いたAIに貼り付けて送る</li></ol>' +
      '<div class="ai-kinds" role="radiogroup" aria-label="相談の種類">' + KINDS.map(function (k) { return '<button type="button" role="radio" aria-checked="false" data-k="' + k.id + '">' + esc(k.label) + '</button>'; }).join('') + '</div>' +
      '<label class="sr" for="ai-txt">相談文</label><textarea id="ai-txt" rows="9" spellcheck="false"></textarea>' +
      '<p class="ai-from" id="ai-from"></p>' +
      '<label class="ck ai-m"><input type="checkbox" id="ai-master" checked>当店の前提(計算の決まり・料金・答え方)を先頭に付ける</label>' +
      '<div class="ai-go"><button type="button" class="btn" data-go="gemini">コピーしてGeminiを開く</button><button type="button" class="btn ghost" data-go="chatgpt">コピーしてChatGPTを開く</button></div>' +
      '<p class="ai-msg" id="ai-msg" aria-live="polite"></p>' +
      '<p class="hint">貼り付けは、パソコンは Ctrl+V(Macは ⌘+V)、スマホは入力欄を長押しして「ペースト」。どちらのAIも無料版で使えます(各社のアカウントと利用規約に従います)。この画面からAIへは何も送りません。取引相手の名前・住所・電話番号は貼らないでください。</p>' +
      '<details class="ai-pre"><summary>当店の前提(マスタープロンプト)を見る</summary><pre id="ai-master-t"></pre><button type="button" class="btn sm ghost" id="ai-master-copy">前提だけコピー</button><p class="hint">AIの「カスタム指示」などに入れておくと、毎回付けなくても同じ前提で答えます。</p></details>' +
      '</div>';
    document.body.appendChild(dlg);
    dlg.addEventListener('click', function (e) { if (e.target === dlg || (e.target.closest && e.target.closest('[data-x]'))) dlg.close(); });
    $$('.ai-kinds [data-k]', dlg).forEach(function (b) { b.addEventListener('click', function () { pick(b.getAttribute('data-k')); }); });
    $('#ai-master', dlg).addEventListener('change', function (e) { st.withMaster = e.target.checked; U.store.set('ai-master', st.withMaster); });
    $('#ai-txt', dlg).addEventListener('input', function () { st.edited = true; });
    $$('[data-go]', dlg).forEach(function (b) { b.addEventListener('click', function () { go(b.getAttribute('data-go')); }); });
    $('#ai-master-copy', dlg).addEventListener('click', function () { copy(master('ack'), function (ok) { msg(ok ? '前提をコピーしました。AIに貼り付けて送ってください' : ''); }); });
  }
  function pick(id) {
    st.kind = id; st.edited = false; U.store.set('ai-kind', id);
    $$('.ai-kinds [data-k]', dlg).forEach(function (b) { b.setAttribute('aria-checked', String(b.getAttribute('data-k') === id)); });
    $('#ai-txt', dlg).value = body();
    var n = pageNumbers().length;
    $('#ai-from', dlg).textContent = n ? 'この画面の数字を' + n + '項目入れました。違う所は直してから送ってください。' : '空いている所に、分かる範囲で数字を書いてください。計算ページから開くと、その画面の数字が入ります。';
    msg('');
  }
  function msg(t) { var m = $('#ai-msg', dlg); if (m) m.textContent = t; }
  /** コピー。ボタンを押したその場で(同期で)写す方法を先に使い、だめなら Clipboard API */
  function copySync(text) {
    var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0';
    (dlg || document.body).appendChild(ta); ta.select(); try { ta.setSelectionRange(0, text.length); } catch (e) { /* 何もしない */ }
    var ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.parentNode.removeChild(ta);
    return ok;
  }
  function copy(text, cb) {
    if (copySync(text)) { cb(true); return; }
    try { navigator.clipboard.writeText(text).then(function () { cb(true); }, function () { cb(false); }); } catch (e) { cb(false); }
  }
  var URLS = { gemini: 'https://gemini.google.com/app', chatgpt: 'https://chatgpt.com/' };
  var NAMES = { gemini: 'Gemini', chatgpt: 'ChatGPT' };
  function go(which) {
    copy(full(), function (ok) {
      msg(ok ? 'コピーしました。開いた' + NAMES[which] + 'の入力欄に貼り付けて送ってください。' : 'コピーできませんでした。上の文を選んでコピーしてから、' + NAMES[which] + 'に貼り付けてください。');
    });
    // コピーはその場で済むので、続けて新しいタブで開く(ボタンを押した操作のうちに開くので、ポップアップとして止められない)
    var w = window.open(URLS[which], '_blank');
    if (w) { try { w.opener = null; } catch (e) { /* 何もしない */ } }
    else msg('新しいタブが開きませんでした。' + URLS[which] + ' を開いて貼り付けてください。');
  }
  function open(kind) {
    if (!dlg) build();
    st.withMaster = U.store.get('ai-master', true) !== false; $('#ai-master', dlg).checked = st.withMaster;
    $('#ai-master-t', dlg).textContent = master('ack');
    pick(kind || U.store.get('ai-kind', null) || DEF_BY_PAGE[document.body.getAttribute('data-page')] || 'shiire');
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  }

  function mount() {
    $$('[data-ai-open]').forEach(function (b) { b.addEventListener('click', function (e) { e.preventDefault(); open(b.getAttribute('data-ai-open') || null); }); });
    // 計算ページ: 内訳の下に「この数字でAIに相談」
    var links = $('.det .det-links') || $('.det .det-in');
    if (links && document.body.getAttribute('data-route-label')) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'lnk ai-lnk'; b.textContent = 'この数字でAIに相談';
      b.addEventListener('click', function () { open('shiire'); });
      if (links.classList.contains('det-links')) links.insertBefore(b, links.firstChild); else { var p = document.createElement('p'); p.className = 'det-links'; p.appendChild(b); links.appendChild(p); }
    }
    if (location.hash === '#ai') setTimeout(function () { open(null); }, 300);
    window.addEventListener('hashchange', function () { if (location.hash === '#ai') open(null); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
  window.SedoriAI = { open: open, master: master, KINDS: KINDS, pageNumbers: pageNumbers };
})();
