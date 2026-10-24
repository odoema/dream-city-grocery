/** Dream City Grocery receipt automation starter.
 * Deploy as a Web App only after reviewing the security model.
 * Script Properties required:
 *   RECEIPT_WEBHOOK_TOKEN = long random secret shared with trusted server-side worker
 *   RECEIPT_EMAIL_TO = odoema@gmail.com
 *   DRIVE_RECEIPTS_FOLDER_ID = optional Drive folder ID
 * Never put the webhook token in browser JavaScript or commit it to Git.
 */
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
