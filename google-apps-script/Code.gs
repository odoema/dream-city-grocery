/**
 * Dream City Grocery Google Workspace automation.
 *
 * Script Properties required for management alerts:
 *   SUPABASE_URL = https://nohdgmylncjtdymfshfy.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY = the Supabase service-role key (KEEP SECRET; never commit it)
 *   MANAGEMENT_ALERT_EMAILS = odoema@gmail.com,bettyudongo@gmail.com
 *   ALERT_TIMEZONE = Africa/Kampala
 *
 * Existing receipt Web App properties:
 *   RECEIPT_WEBHOOK_TOKEN = long random secret shared with trusted server-side worker
 *   RECEIPT_EMAIL_TO = odoema@gmail.com
 *   DRIVE_RECEIPTS_FOLDER_ID = optional Drive folder ID
 *
 * After saving this script, run setupManagementAlertTriggers() once from the Apps Script editor.
 * That creates a 5-minute notification queue worker and a daily 21:30 Uganda-time sales summary.
 * Never put the service-role key or webhook token in browser JavaScript or Git.
 */

const DEFAULT_ALERT_EMAILS = 'odoema@gmail.com,bettyudongo@gmail.com';
const DEFAULT_TIMEZONE = 'Africa/Kampala';

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const props = PropertiesService.getScriptProperties();
    const expected = props.getProperty('RECEIPT_WEBHOOK_TOKEN');
    const supplied = (e && e.parameter && e.parameter.token) || body.token || '';
    if (!expected || !safeEqual_(expected, supplied)) return json_({ ok:false, error:'Unauthorized' });
    const sale = body.sale;
    if (!sale || !sale.receipt_number || !Array.isArray(sale.items)) return json_({ ok:false, error:'Invalid sale payload' });
    const emailTo = props.getProperty('RECEIPT_EMAIL_TO') || 'odoema@gmail.com';
    const pdf = buildReceiptPdf_(sale);
    const subject = 'Dream City Grocery receipt ' + sale.receipt_number + ' — ' + money_(sale.total_amount);
    const textBody = ['A transaction was recorded at Dream City Grocery.','Receipt: '+sale.receipt_number,'Date: '+(sale.created_at || new Date().toISOString()),'Cashier: '+(sale.cashier_name || 'Not specified'),'Payment: '+(sale.payment_method || 'Not specified'),'Total: '+money_(sale.total_amount),'','The PDF receipt is attached.'].join('\n');
    GmailApp.sendEmail(emailTo, subject, textBody, {attachments:[pdf], name:'Dream City Grocery'});
    const folderId = props.getProperty('DRIVE_RECEIPTS_FOLDER_ID');
    if (folderId) DriveApp.getFolderById(folderId).createFile(pdf.copyBlob()).setName(sale.receipt_number+'.pdf');
    return json_({ok:true,receipt_number:sale.receipt_number,emailed_to:emailTo});
  } catch (err) { console.error(err && err.stack ? err.stack : err); return json_({ok:false,error:'Receipt processing failed'}); }
}

/** Run once manually after setting the Supabase properties. */
function setupManagementAlertTriggers() {
  const handlerNames = ['processManagementNotificationQueue','sendDailySalesSummary'];
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (handlerNames.indexOf(trigger.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(trigger);
  });
  const timezone = getTimeZone_();
  ScriptApp.newTrigger('processManagementNotificationQueue')
    .timeBased().everyMinutes(5).inTimezone(timezone).create();
  ScriptApp.newTrigger('sendDailySalesSummary')
    .timeBased().atHour(21).nearMinute(30).everyDays(1).inTimezone(timezone).create();
  Logger.log('Management alert triggers installed for ' + timezone + '.');
}

/** Sends queued major-activity alerts to both management recipients. */
function processManagementNotificationQueue() {
  const props = PropertiesService.getScriptProperties();
  const rows = supabaseRequest_('/rest/v1/management_notifications?select=id,event_type,title,body,payload,created_at,attempts&sent_at=is.null&order=created_at.asc&limit=25', 'GET');
  if (!rows || !rows.length) return;

  const recipients = getAlertEmails_();
  rows.forEach(function(row) {
    try {
      GmailApp.sendEmail(
        recipients.join(','),
        'Dream City Grocery — ' + row.title,
        row.body + '\n\nEvent: ' + row.event_type + '\nRecorded: ' + row.created_at,
        {name:'Dream City Grocery Management Alerts'}
      );
      supabaseRequest_('/rest/v1/management_notifications?id=eq.' + encodeURIComponent(row.id), 'PATCH', {
        sent_at: new Date().toISOString(),
        attempts: Number(row.attempts || 0) + 1,
        last_error: null
      });
    } catch (err) {
      try {
        supabaseRequest_('/rest/v1/management_notifications?id=eq.' + encodeURIComponent(row.id), 'PATCH', {
          attempts: Number(row.attempts || 0) + 1,
          last_error: String(err && err.message ? err.message : err).slice(0,1000)
        });
      } catch (ignored) {}
    }
  });
}

/** Daily sales summary for management, scheduled for 21:30 Africa/Kampala. */
function sendDailySalesSummary() {
  const timezone = getTimeZone_();
  const now = new Date();
  const localDate = Utilities.formatDate(now, timezone, 'yyyy-MM-dd');
  const start = new Date(localDate + 'T00:00:00+03:00');
  const nextDate = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const startIso = start.toISOString();
  const endIso = nextDate.toISOString();
  const rows = supabaseRequest_('/rest/v1/sales?select=total,status,payment_method,created_at&status=eq.completed&created_at=gte.' + encodeURIComponent(startIso) + '&created_at=lt.' + encodeURIComponent(endIso) + '&order=created_at.asc&limit=5000', 'GET');

  const completed = rows || [];
  const total = completed.reduce(function(sum,row){ return sum + Number(row.total || 0); }, 0);
  const byPayment = {};
  completed.forEach(function(row){
    const method = String(row.payment_method || 'unknown').replace(/_/g,' ');
    byPayment[method] = (byPayment[method] || 0) + Number(row.total || 0);
  });
  const paymentLines = Object.keys(byPayment).sort().map(function(key){ return '  ' + key + ': ' + money_(byPayment[key]); });
  const subject = 'Dream City Grocery — Daily Sales Summary ' + localDate;
  const body = [
    'Dream City Grocery daily management summary',
    '',
    'Date: ' + localDate,
    'Completed transactions: ' + completed.length,
    'Total sales: ' + money_(total),
    '',
    'Sales by payment method:',
    paymentLines.length ? paymentLines.join('\n') : '  No completed sales recorded.',
    '',
    'This summary is generated from completed sales in the dedicated Supabase database.'
  ].join('\n');
  GmailApp.sendEmail(getAlertEmails_().join(','), subject, body, {name:'Dream City Grocery Management Alerts'});
}

function getAlertEmails_() {
  const raw = PropertiesService.getScriptProperties().getProperty('MANAGEMENT_ALERT_EMAILS') || DEFAULT_ALERT_EMAILS;
  return raw.split(',').map(function(value){ return value.trim(); }).filter(Boolean);
}

function getTimeZone_() {
  return PropertiesService.getScriptProperties().getProperty('ALERT_TIMEZONE') || DEFAULT_TIMEZONE;
}

function supabaseRequest_(path, method, body) {
  const props = PropertiesService.getScriptProperties();
  const base = props.getProperty('SUPABASE_URL');
  const key = props.getProperty('SUPABASE_SERVICE_ROLE_KEY');
  if (!base || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Apps Script properties first.');
  const options = {
    method: method || 'GET',
    muteHttpExceptions: true,
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    }
  };
  if (body !== undefined) options.payload = JSON.stringify(body);
  const response = UrlFetchApp.fetch(base.replace(/\/$/, '') + path, options);
  const code = response.getResponseCode();
  const text = response.getContentText();
  if (code < 200 || code >= 300) throw new Error('Supabase request failed (' + code + '): ' + text.slice(0,500));
  if (!text) return null;
  return JSON.parse(text);
}

function buildReceiptPdf_(sale) {
  const doc=DocumentApp.create('Receipt '+sale.receipt_number), body=doc.getBody();
  body.appendParagraph('DREAM CITY GROCERY').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendParagraph('Dream City — Empowering Communities'); body.appendParagraph('SALES RECEIPT').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  body.appendParagraph('Receipt: '+sale.receipt_number); body.appendParagraph('Date: '+(sale.created_at || new Date().toISOString())); body.appendParagraph('Cashier: '+(sale.cashier_name || '—')); body.appendParagraph('Payment: '+(sale.payment_method || '—')); body.appendHorizontalRule();
  const table=[['Item','Qty','Unit price','Total']]; sale.items.forEach(function(item){table.push([String(item.product_name || item.name || 'Item'),String(item.quantity),money_(item.unit_price),money_(item.line_total)]);}); body.appendTable(table);
  body.appendParagraph('Subtotal: '+money_(sale.subtotal)); if(Number(sale.discount_amount||0)) body.appendParagraph('Discount: '+money_(sale.discount_amount)); if(Number(sale.tax_amount||0)) body.appendParagraph('Tax: '+money_(sale.tax_amount));
  body.appendParagraph('TOTAL: '+money_(sale.total_amount)).setHeading(DocumentApp.ParagraphHeading.HEADING2); body.appendParagraph('Thank you for shopping with Dream City Grocery!'); doc.saveAndClose();
  const pdf=DriveApp.getFileById(doc.getId()).getAs(MimeType.PDF).setName(sale.receipt_number+'.pdf'); DriveApp.getFileById(doc.getId()).setTrashed(true); return pdf;
}
function money_(amount){return 'UGX '+Number(amount||0).toLocaleString('en-UG',{maximumFractionDigits:2});}
function safeEqual_(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let result=0;for(let i=0;i<a.length;i++)result|=a.charCodeAt(i)^b.charCodeAt(i);return result===0;}
function json_(obj){return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);}
