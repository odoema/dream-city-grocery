/**
 * Grocery POS — report mailer (Google Apps Script web app).
 *
 * Supabase builds the evening report and the morning shopping list and posts
 * them here; this script only sends them from your Gmail. It holds no
 * database keys and cannot read the shop's data.
 *
 * Setup (once):
 *  1. script.google.com → New project → paste this file → Save.
 *  2. Project Settings → Script Properties:
 *       MAILER_TOKEN   = a long password you make up (the same one goes into Supabase)
 *       REPORT_EMAILS  = who gets the evening report, comma-separated
 *       LIST_EMAILS    = who gets the morning shopping list (optional; defaults to REPORT_EMAILS)
 *  3. Run testMailer once and allow Gmail access (you receive a test email).
 *  4. Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone → Deploy.
 *     Copy the web app URL (ends in /exec) into Supabase (supabase/automations.sql).
 */
function doPost(e) {
  var props = PropertiesService.getScriptProperties();
  var body = {};
  try { body = JSON.parse(e.postData.contents || '{}'); } catch (err) { return out_({ ok: false, error: 'bad json' }); }
  var token = props.getProperty('MAILER_TOKEN') || '';
  if (!token || body.token !== token) return out_({ ok: false, error: 'not allowed' });

  var to = body.kind === 'morning'
    ? (props.getProperty('LIST_EMAILS') || props.getProperty('REPORT_EMAILS'))
    : props.getProperty('REPORT_EMAILS');
  if (!to) return out_({ ok: false, error: 'REPORT_EMAILS is not set' });

  GmailApp.sendEmail(to, String(body.subject || 'Shop report').slice(0, 200), String(body.text || ''), {
    htmlBody: String(body.html || ''),
    name: 'Grocery POS'
  });
  return out_({ ok: true });
}

function testMailer() {
  var to = PropertiesService.getScriptProperties().getProperty('REPORT_EMAILS');
  GmailApp.sendEmail(to, 'Grocery POS mailer is working', 'Reports will arrive here every evening and every morning.', { name: 'Grocery POS' });
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
