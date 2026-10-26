import { state } from './state.js';
import { money, num, dateTime, paymentLabel } from './format.js';
import { barcodeSvg } from './barcode.js';
import { documentHtml, printHtml } from './documents.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// receipt: { receipt_number, created_at, cashier, customer, payment_method, items:[{name, sku, qty, price, line_total}],
//            subtotal, discount, total, tendered, change, status }
export function receiptHtml(r) {
  const s = state.settings || {};
  if (s.receipt_width === 'a4') return a4Receipt(r);
  const narrow = s.receipt_width === '58mm';
  const width = narrow ? '54mm' : '72mm';
  const logo = s.logo_url ? `<img class="logo" src="${esc(new URL(s.logo_url, location.href).href)}" alt="${esc(s.business_name || 'Shop')}">` : '';
  const count = r.items.reduce((n, i) => n + Number(i.qty), 0);
  const rows = r.items.map(i => `<tr><td class="name">${esc(i.name)}${i.sku ? `<span class="sku">${esc(i.sku)}</span>` : ''}</td><td class="r amount">${esc(money(i.line_total))}</td></tr><tr class="detail"><td>${num(i.qty)} × ${esc(money(i.price))}</td><td></td></tr>`).join('');
  let code = '';
  try { code = barcodeSvg(r.receipt_number, { height: 34, module: narrow ? 1 : 1.2, quiet: 6 }); } catch { /* unusual characters */ }
  const title = r.status === 'refunded' ? 'REFUND RECEIPT' : 'SALES RECEIPT';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(r.receipt_number)}</title>
<style>
  @page { size: auto; margin: 3mm; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font: ${narrow ? 10.2 : 11.2}px/1.35 Arial, Helvetica, sans-serif; color: #010101; width: ${width}; margin: 0 auto; }
  .c { text-align: center; } .r { text-align: right; white-space: nowrap; }
  .logo { display: block; width: 64%; max-height: 27mm; object-fit: contain; margin: 0 auto 2px; filter: grayscale(1) contrast(1.35); }
  .shop { font-weight: 800; font-size: 1.22em; text-align: center; text-transform: uppercase; letter-spacing: .035em; }
  .tag { text-align: center; font-size: .86em; margin-top: 1px; }
  .info { text-align: center; font-size: .88em; line-height: 1.3; }
  .header-rule { border: 0; border-top: 2px solid #000; margin: 5px 0 4px; }
  .title { text-align: center; font-weight: 800; font-size: 1.05em; letter-spacing: .14em; border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 4px 0; margin: 5px 0; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 1px 0; vertical-align: top; }
  .meta td:first-child { width: 42%; }
  .meta td:last-child { font-weight: 600; }
  .name { font-weight: 700; padding-top: 4px; padding-right: 3px; }
  .sku { display: block; font-size: .75em; font-weight: 400; letter-spacing: .02em; }
  .amount { font-weight: 700; padding-top: 4px; }
  .detail td { font-size: .9em; padding-bottom: 3px; border-bottom: 1px dotted #000; }
  hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
  .summary td { padding: 2px 0; }
  .tot td { font-weight: 800; font-size: 1.35em; padding: 5px 0; border-top: 2px solid #000; border-bottom: 2px solid #000; }
  .void { text-align: center; font-weight: 800; font-size: 1.15em; border: 3px double #000; padding: 4px; margin: 6px 0; letter-spacing: .16em; }
  .barcode { display: block; width: 100%; height: 34px; margin: 7px 0 1px; }
  .thanks { text-align: center; font-weight: 700; margin-top: 7px; }
  .small { font-size: .8em; text-align: center; }
  .legal { margin-top: 4px; font-size: .72em; text-align: center; }
</style></head><body>
${logo}${s.business_name ? `<div class="shop">${esc(s.business_name)}</div>` : (!logo ? `<div class="shop">Receipt</div>` : '')}
${s.tagline ? `<div class="tag">${esc(s.tagline)}</div>` : ''}
<div class="info">${[s.address, s.phone && 'Tel: ' + s.phone, s.email, s.tax_id && 'TIN: ' + s.tax_id].filter(Boolean).map(esc).join('<br>')}</div>
${s.receipt_header ? `<div class="info" style="margin-top:3px">${esc(s.receipt_header)}</div>` : ''}
<div class="title">${title}</div>
<table class="meta">
<tr><td>Receipt</td><td class="r">${esc(r.receipt_number)}</td></tr>
<tr><td>Date</td><td class="r">${esc(dateTime(r.created_at))}</td></tr>
<tr><td>Served by</td><td class="r">${esc(r.cashier || '')}</td></tr>
${r.customer ? `<tr><td>Customer</td><td class="r">${esc(r.customer)}</td></tr>` : ''}
</table>
${r.status === 'refunded' ? '<div class="void">REFUNDED</div>' : ''}
<hr><table>${rows}</table>
<table class="summary" style="margin-top:4px">
<tr><td>Items</td><td class="r">${num(count)}</td></tr>
<tr><td>Subtotal</td><td class="r">${esc(money(r.subtotal))}</td></tr>
${Number(r.discount) > 0 ? `<tr><td>Discount</td><td class="r">-${esc(money(r.discount))}</td></tr>` : ''}
<tr class="tot"><td>TOTAL</td><td class="r">${esc(money(r.total))}</td></tr>
<tr><td>Paid by</td><td class="r">${esc(paymentLabel(r.payment_method))}</td></tr>
${r.tendered !== undefined && r.tendered !== null ? `<tr><td>Cash given</td><td class="r">${esc(money(r.tendered))}</td></tr><tr><td><b>Change</b></td><td class="r"><b>${esc(money(r.change))}</b></td></tr>` : ''}
</table>
${code}
<div class="small">${esc(r.receipt_number)}</div>
<div class="thanks">${esc(s.receipt_footer || 'Thank you for shopping with us!')}</div>
<div class="small">Keep this receipt for returns.</div>
${s.tax_id ? '<div class="legal">Tax information shown above is based on the shop configuration.</div>' : ''}
</body></html>`;
}

function a4Receipt(r) {
  const s = state.settings || {};
  return documentHtml({
    title: r.status === 'refunded' ? 'Refund receipt' : 'Sales receipt', number: r.receipt_number, date: dateTime(r.created_at),
    stamp: r.status === 'refunded' ? 'Refunded' : 'Paid',
    boxes: [
      { heading: 'Customer', rows: [['Name', r.customer || 'Walk-in customer']] },
      { heading: 'Sale', rows: [['Served by', r.cashier || ''], ['Paid by', paymentLabel(r.payment_method)]] }
    ],
    columns: [{ label: '#' }, { label: 'Item' }, { label: 'Qty', right: true }, { label: 'Price', right: true }, { label: 'Amount', right: true }],
    rows: r.items.map((i, n) => [n + 1, i.name, num(i.qty), money(i.price), money(i.line_total)]),
    totals: [
      ['Subtotal', money(r.subtotal), 'sub'],
      ...(Number(r.discount) > 0 ? [['Discount', '-' + money(r.discount)]] : []),
      ['Total', money(r.total), 'grand'],
      ...(r.tendered !== undefined && r.tendered !== null ? [['Cash given', money(r.tendered)], ['Change', money(r.change)]] : [])
    ],
    notes: [s.receipt_header, s.receipt_footer || 'Thank you for shopping with us!'].filter(Boolean).join(' — ')
  });
}

export function printReceipt(r) { printHtml(receiptHtml(r)); }

// Load a stored sale into receipt shape.
export async function loadReceipt(db, saleId) {
  const { data, error } = await db.from('sales')
    .select('id,receipt_number,created_at,payment_method,subtotal,discount,total,status,cashier_id,cashier:profiles!sales_cashier_id_fkey(full_name),customers(name),sale_items(product_name,sku,quantity,unit_price,line_total)')
    .eq('id', saleId).single();
  if (error) throw error;
  return {
    receipt_number: data.receipt_number, created_at: data.created_at, payment_method: data.payment_method,
    cashier: data.cashier?.full_name || '', customer: data.customers?.name || '', status: data.status,
    subtotal: data.subtotal, discount: data.discount, total: data.total,
    items: (data.sale_items || []).map(i => ({ name: i.product_name, sku: i.sku, qty: i.quantity, price: i.unit_price, line_total: i.line_total }))
  };
}
