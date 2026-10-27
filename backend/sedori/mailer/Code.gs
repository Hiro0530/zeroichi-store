/**
 * せどり 利益チェック: お知らせメールの送り口(Google Apps Script)
 * 事業用の Gmail(zeroichi.works.jp@gmail.com)のアカウントで作り、「ウェブアプリ」として公開する。
 * Cloudflare Worker から { secret, to, subject, body } を POST すると、その Gmail から1通送る。
 * 合言葉(SECRET)は「プロジェクトの設定 → スクリプト プロパティ」に MAIL_HOOK_SECRET として入れる(コードには書かない)。
 * 無料の Gmail は1日100通まで。
 */
function doPost(e) {
  var out = { ok: false };
  try {
    var d = JSON.parse(e.postData.contents);
    var secret = PropertiesService.getScriptProperties().getProperty('MAIL_HOOK_SECRET');
    if (!secret || d.secret !== secret) { out.error = 'forbidden'; }
    else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.to || '')) { out.error = 'bad-to'; }
    else {
      GmailApp.sendEmail(d.to, String(d.subject || '').slice(0, 200), String(d.body || ''), { name: 'ZEROICHI WORKS', replyTo: 'zeroichi.works.jp@gmail.com' });
      out.ok = true;
    }
  } catch (err) { out.error = String(err); }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
