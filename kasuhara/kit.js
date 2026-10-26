// カスハラ対策キット — 入力から6枚の書類を作る(データは端末の中だけ。送信しない)
(function () {
  "use strict";
  var IND = {
    food: { name: "飲食店", guest: "お客さま", ex: ["大声でどなる、威圧的な言葉を繰り返す", "料理や会計について、事実と違う理由での返金・無料の要求", "閉店時刻を過ぎても長時間居座る、何度も同じ苦情を言いに来る", "従業員の体に触れる、個人的な連絡先をしつこく聞く"], scene: "客席・レジ・電話" },
    beauty: { name: "美容室・サロン", guest: "お客さま", ex: ["仕上がりへの意見を超えて、人格を否定する言葉を繰り返す", "施術のやり直しや返金を、理由なく何度も強く求める", "予約外の時間の対応や、担当者の個人的な連絡先を強く求める", "施術中の体への不必要な接触や、性的な発言"], scene: "施術中・受付・予約の電話やメッセージ" },
    retail: { name: "小売店", guest: "お客さま", ex: ["大声でどなる、威圧的な言葉を繰り返す", "使用後・期限後の商品の返品や、過度な値引き・補償を強く求める", "同じ内容の電話やメールを長時間・何度も続ける", "土下座など、謝罪の方法を強要する"], scene: "売り場・レジ・電話・メール" },
    care: { name: "介護・福祉の事業所", guest: "利用者さま・ご家族さま", ex: ["職員への暴言や、威圧的な態度を繰り返す", "ご契約の内容を超えるサービスを、繰り返し強く求める", "職員の体に触れる、性的な発言をする", "深夜・早朝の長時間の電話や、職員個人への連絡"], scene: "訪問先・施設・電話" },
    clinic: { name: "クリニック・歯科・薬局", guest: "患者さま・ご家族さま", ex: ["受付・待ち時間について、大声でどなる、威圧的な態度をとる", "医師が必要ないと判断した処方や検査を、繰り返し強く求める", "職員の体に触れる、性的な発言をする", "診療時間外の長時間の電話や、同じ苦情の繰り返し"], scene: "受付・診察室・電話" },
    stay: { name: "宿・ゲストハウス", guest: "お客さま", ex: ["大声でどなる、威圧的な言葉を繰り返す", "事実と違う理由での返金や、無料の延泊・アップグレードの要求", "深夜の呼び出しや、同じ苦情の繰り返し", "従業員の体に触れる、性的な発言をする"], scene: "フロント・客室・予約サイトのメッセージ" },
    car: { name: "自動車整備・板金塗装の工場", guest: "お客さま", ex: ["見積や作業内容を説明した後で、事実と違う理由での値引きや、無料のやり直しを強く求める", "作業と関係のない前からの傷や不具合を、作業のせいだとして無償の修理や補償を強く求める", "納車の日や代車のことで、大声でどなる、威圧的な言葉を繰り返す", "ピット(作業場)に断りなく入る、作業中の従業員に詰め寄る"], scene: "受付・ピット・納車・電話" },
    other: { name: "サービス業", guest: "お客さま", ex: ["大声でどなる、威圧的な言葉を繰り返す", "事実と違う理由での返金・無料の要求", "同じ内容の苦情を、長時間・何度も続ける", "従業員の体に触れる、個人的な連絡先をしつこく聞く"], scene: "店内・電話・メール" }
  };
  var SOFT = { care: "ご家族さまやケアマネジャーさまとご相談のうえ、対応のしかたを見直させていただくことがあります。", clinic: "ご相談のうえ、対応のしかたを見直させていただくことがあります。" };
  var DOCS = [["poster", "①店頭の掲示"], ["policy", "②社内方針"], ["desk", "③相談窓口"], ["flow", "④対応の流れ"], ["record", "⑤記録票"], ["notice", "⑥周知の記録"]];
  var $ = function (s) { return document.querySelector(s); };
  var esc = function (s) { return String(s || "").replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var cur = "poster", unlocked = false;
  var store = { get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };

  function val(id, d) { var v = $("#" + id).value.trim(); return v || d; }
  function fmtDate(v) { if (!v) return "　　年　　月　　日"; var p = v.split("-"); return p[0] + "年" + (+p[1]) + "月" + (+p[2]) + "日"; }

  function build() {
    var ind = IND[$("#ind").value], shop = esc(val("shop", "(店名)")), owner = esc(val("owner", "店長")), contact = esc(val("contact", "直接・電話"));
    var day = fmtDate($("#date").value), police = $("#police").checked, sns = $("#sns").checked;
    var ex = ind.ex.slice(); if (sns) ex.push("従業員を無断で撮影する、SNSなどに名前や写真を載せると言う");
    var exList = "<ul>" + ex.map(function (e) { return "<li>" + esc(e) + "</li>"; }).join("") + "</ul>";
    var care = $("#ind").value === "care", clinic = $("#ind").value === "clinic";
    var h = {};
    h.poster = '<div class="frame"><p class="shop">' + shop + '</p><h3>' + ind.guest + 'へのお願い</h3><p>いつもご利用いただき、ありがとうございます。<br>ご意見・ご要望は、サービスをよくするために大切にお聞きします。</p><p>一方で、次のような行為があった場合は、' + (SOFT[$("#ind").value] || "対応をお断りしたり、<br>ご退店・ご利用の中止をお願いしたりすることがあります。") + '</p>' + exList +
      '<p>' + (police ? "暴力や脅迫など、法律に触れるおそれのある行為には、警察に連絡して対応します。<br>" : "") + '従業員が安心して働けることが、よいサービスにつながると考えています。<br>ご理解とご協力をお願いいたします。</p><p class="shop">' + shop + '</p></div>';
    h.policy = '<h3>カスタマーハラスメントへの対応方針</h3><p class="shop">' + shop + '　' + day + '</p>' +
      '<h4>1. 基本の考え方</h4><p>' + ind.guest + 'からのご意見やご要望には、誠実に対応します。ただし、' + ind.guest + 'の言動のうち、業務の性質などから見て社会の常識の範囲を超えたもので、従業員の働く環境を害するもの(カスタマーハラスメント)からは、店として従業員を守ります。</p>' +
      '<h4>2. カスハラにあたる例(' + esc(ind.name) + ')</h4>' + exList +
      '<h4>3. 店がすること</h4><ul><li>従業員を一人で対応させず、責任者が交代・同席します。</li><li>相談窓口(担当: ' + owner + ')で相談を受け、事実を確かめ、相談した人を守ります。</li><li>同じことが起きないよう、対応のしかたや体制を見直します。</li></ul>' +
      '<h4>4. 特に悪質な場合</h4><p>暴力・脅迫・つきまとい・性的な言動・繰り返しの長時間の要求などは、対応を打ち切ります。' + (care ? "契約の解除などを考えるときは、運営基準に沿って、ケアマネジャーや市町村と相談して判断します。病気や障害の症状による言動かどうかにも配慮します。" : clinic ? "診療をお断りするかどうかは、正当な理由があるかを院長が判断し、必要に応じて医師会や弁護士に相談します。" : "ご退店やご利用の中止をお願いします。") + (police ? "身の危険があるとき、法律に触れるおそれがあるときは、迷わず警察(110番)に連絡します。" : "") + '必要に応じて、警察や弁護士などの外部に相談します。</p>' +
      '<h4>5. 相談した人を守ります</h4><p>相談の内容や相談した人のことは、必要な範囲の人以外には知らせません。相談したこと、事実の確認に協力したことを理由に、解雇や配置換えなど不利益な扱いはしません。</p>';
    h.desk = '<h3>カスハラの相談窓口</h3><p class="shop">' + shop + '</p><table><tr><th>担当</th><td>' + owner + '</td></tr><tr><th>相談の方法</th><td>' + contact + '</td></tr><tr><th>相談できること</th><td>' + ind.scene + 'での' + ind.guest + 'の言動で、つらい・こわいと感じたこと、対応に困ったこと。カスハラにあたるか迷う場合も相談してください。</td></tr></table>' +
      '<h4>約束すること</h4><ul><li>相談の内容は、必要な範囲の人以外には知らせません。</li><li>相談したこと・事実の確認に協力したことで、不利益な扱いはしません。</li><li>話を聞いた後、事実を確かめ、相談した人を守るための対応(担当の交代・同席など)を、本人と話し合って決めます。</li></ul>' +
      '<h4>店の外の相談先(無料)</h4><ul><li>都道府県労働局の総合労働相談コーナー</li><li>身の危険があるとき: 110番 / 急ぎでない相談: 警察相談専用電話 #9110</li></ul><p class="src">担当が不在のときは、記録票(⑤)に書いて置いておくだけでも構いません。</p>';
    h.flow = '<h3>その場の対応の流れ</h3><p class="shop">' + shop + '(' + esc(ind.name) + ')</p><ol>' +
      '<li><b>まず話を聞く</b>: 何に困っているかを確かめ、店に落ち度があれば、その点はおわびします。落ち度の無いことまで認めたり、謝ったりはしません。</li>' +
      '<li><b>一人で抱えない</b>: 強い言葉・長時間・要求の繰り返しが始まったら、' + owner + 'か他の従業員を呼び、二人以上で対応します。</li>' +
      '<li><b>記録する</b>: 日時・言葉・要求・場所を、記録票(⑤)にできるだけそのまま書きます。</li>' +
      '<li><b>できないことは、はっきり伝える</b>: 「その対応はいたしかねます」と、同じ言葉で落ち着いて繰り返します。</li>' +
      '<li><b>打ち切りの目安</b>: 同じ要求が3回以上続く、30分を超える、人格を否定する言葉・脅し・体への接触があったら、責任者が対応の終了を伝えます(時間・回数は店で決めて書き直してください)。</li>' +
      '<li><b>危険なとき</b>: ' + (police ? "暴力・脅し・居座りで身の危険を感じたら、その場を離れて110番します。" : "身の危険を感じたら、その場を離れて責任者に知らせます。") + '</li>' +
      '<li><b>終わった後</b>: 担当した従業員の様子を確かめ、必要なら担当を外す・休ませるなどします。同じことを防ぐための見直しを、記録票の最後に書きます。</li></ol>' +
      '<h4>その場で使える言い方</h4><ul><li>「ご不便をおかけし、申し訳ございません。どの点にお困りか、お聞かせいただけますか」</li><li>「その対応はいたしかねます。私どもでできるのは〇〇までです」</li><li>「責任者から改めてご説明します。少しお待ちください」</li><li>「大きな声を出されると、お話を続けることができません」</li><li>「これ以上はお話を続けられませんので、本日はお引き取りください」</li></ul><h4>この店で決めた打ち切りの基準(書き込み)</h4><div class="line"></div><div class="line"></div>';
    var rows = ["日時", "場所・方法(" + ind.scene + ")", "相手(わかる範囲で)", "言動・要求(そのまま)", "対応した人", "店の対応", "従業員の様子・したこと", "再発を防ぐための見直し"];
    h.record = '<h3>カスハラ 記録票</h3><p class="shop">' + shop + '　No.　　　</p><table>' + rows.map(function (r) { return "<tr><th>" + r + "</th><td style='height:3.1em'></td></tr>"; }).join("") + '</table><p class="src">記録票は、相談窓口(' + owner + ')が保管し、必要な人以外には見せません。</p>';
    h.notice = '<h3>方針の周知の記録</h3><p class="shop">' + shop + '</p><p>②社内方針と③相談窓口を、次の日に説明しました。</p><table><tr><th style="width:22%">説明した日</th><th style="width:33%">説明を受けた人(署名)</th><th style="width:22%">説明した日</th><th>説明を受けた人(署名)</th></tr>' + Array(9).join("<tr><td style='height:2.4em'></td><td></td><td></td><td></td></tr>") + '</table>' +
      '<h4>朝礼・ミーティング用 10分チェック</h4><ol><li>うちの店の「カスハラにあたる例」を1つ挙げられる</li><li>困ったら、一人で抱えず' + owner + 'を呼ぶ</li><li>記録票の場所を知っている</li><li>「その対応はいたしかねます」と落ち着いて伝えられる</li><li>相談しても不利益な扱いはされないと知っている</li><li>危ないときは、その場を離れて' + (police ? "110番する" : "責任者に知らせる") + '</li></ol><p class="src">新しく人を雇ったときも、この表に追記してください。</p>';
    var box = $("#sheets"); box.innerHTML = "";
    DOCS.forEach(function (d) {
      var s = document.createElement("div");
      s.className = "sheet" + (d[0] === "poster" ? " poster" : "") + (unlocked ? "" : " wm");
      s.dataset.doc = d[0]; s.innerHTML = h[d[0]] + (d[0] === "poster" ? "" : '<p class="src">ZEROICHI WORKS「カスハラ対策キット」で作成。国・自治体の公開資料をもとにした一般的なひな形です。</p>');
      s.hidden = d[0] !== cur; box.appendChild(s);
    });
    ["shop", "ind", "owner", "contact", "date"].forEach(function (k) { store.set("kh_" + k, $("#" + k).value); });
    store.set("kh_police", $("#police").checked ? "1" : "0"); store.set("kh_sns", $("#sns").checked ? "1" : "0");
  }

  function tabs() {
    var t = document.querySelector(".tabs");
    DOCS.forEach(function (d) {
      var b = document.createElement("button"); b.type = "button"; b.textContent = d[1]; b.dataset.doc = d[0];
      b.setAttribute("aria-pressed", d[0] === cur ? "true" : "false");
      b.onclick = function () { cur = d[0]; document.querySelectorAll(".tabs button").forEach(function (x) { x.setAttribute("aria-pressed", x.dataset.doc === cur ? "true" : "false"); }); document.querySelectorAll(".sheet").forEach(function (s) { s.hidden = s.dataset.doc !== cur; }); };
      t.appendChild(b);
    });
  }

  async function checkKey(k) {
    var m = /^KH-([A-Z0-9]{8})-([A-F0-9]{4})$/.exec(k.trim().toUpperCase()); if (!m || !(window.crypto && crypto.subtle)) return false;
    var buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("kasuhara-kit:" + m[1]));
    var hex = Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
    return hex.slice(0, 4).toUpperCase() === m[2];
  }
  async function onKey() {
    var k = $("#key").value; if (!k.trim()) { unlocked = false; $("#keyMsg").textContent = "キーが無い間は「見本」の透かしが入ります。"; build(); return; }
    unlocked = await checkKey(k);
    $("#keyMsg").textContent = unlocked ? "キーを確認しました。透かしなしで印刷できます。" : "キーが正しくありません。メールのキー(KH- で始まる文字)をそのまま貼り付けてください。";
    if (unlocked) store.set("kh_key", k.trim().toUpperCase());
    build();
  }

  function printDocs(all) {
    document.querySelectorAll(".sheet").forEach(function (s) { s.hidden = !all && s.dataset.doc !== cur; });
    window.print();
    setTimeout(function () { document.querySelectorAll(".sheet").forEach(function (s) { s.hidden = s.dataset.doc !== cur; }); }, 500);
  }

  ["shop", "ind", "owner", "contact", "date"].forEach(function (k) { var v = store.get("kh_" + k); if (v) $("#" + k).value = v; });
  if (store.get("kh_police") === "0") $("#police").checked = false;
  if (store.get("kh_sns") === "0") $("#sns").checked = false;
  var q = new URLSearchParams(location.search); if (q.get("ind") && IND[q.get("ind")]) $("#ind").value = q.get("ind");
  tabs(); build();
  ["shop", "ind", "owner", "contact", "date", "police", "sns"].forEach(function (k) { $("#" + k).addEventListener("input", build); $("#" + k).addEventListener("change", build); });
  $("#key").addEventListener("change", onKey); $("#key").addEventListener("input", function () { if (/^KH-.{8}-.{4}$/i.test($("#key").value.trim())) onKey(); });
  var saved = store.get("kh_key"); if (saved) { $("#key").value = saved; onKey(); }
  $("#print").onclick = function () { printDocs(false); };
  $("#printAll").onclick = function () { printDocs(true); };
})();
