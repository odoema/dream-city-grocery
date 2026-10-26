import { state } from './state.js';
import { money, num, dateTime, paymentLabel } from './format.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// receipt: { receipt_number, created_at, cashier, customer, payment_method, items:[{name, sku, qty, price, line_total}],
//            subtotal, discount, total, tendered, change, status }
export function receiptHtml(r) {
  const s = state.settings || {};
  const width = s.receipt_width === '58mm' ? '54mm' : s.receipt_width === 'a4' ? '180mm' : '72mm';
  const logo = s.logo_url ? `<img class="logo" src="${esc(new URL(s.logo_url, location.href).href)}" alt="">` : '';
  const rows = r.items.map(i => `<tr><td>${esc(i.name)}<br><small>${num(i.qty)} × ${esc(money(i.price))}</small></td><td class="r">${esc(money(i.line_total))}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(r.receipt_number)}</title>
<style>
  @page { margin: 4mm; }
  body { font: 12px/1.35 'Courier New', monospace; color: #000; width: ${width}; margin: 0 auto; }
  h1 { font-size: 15px; margin: 4px 0 2px; text-align: center; }
  .c { text-align: center; } .r { text-align: right; white-space: nowrap; } .logo { display:block; max-width: 40%; max-height: 60px; margin: 0 auto; }
  table { width: 100%; border-collapse: collapse; } td { padding: 3px 0; vertical-align: top; }
  hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; } .tot td { font-weight: bold; font-size: 14px; }
  small { color: #222; } .void { text-align:center; font-weight:bold; border: 2px solid #000; padding: 3px; margin: 6px 0; }
</style></head><body>
${logo}<h1>${esc(s.business_name || 'Receipt')}</h1>
${s.tagline ? `<div class="c">${esc(s.tagline)}</div>` : ''}
${s.address ? `<div class="c">${esc(s.address)}</div>` : ''}
${s.phone ? `<div class="c">Tel: ${esc(s.phone)}</div>` : ''}
${s.tax_id ? `<div class="c">TIN: ${esc(s.tax_id)}</div>` : ''}
${s.receipt_header ? `<div class="c">${esc(s.receipt_header)}</div>` : ''}
<hr>
<div>Receipt: <b>${esc(r.receipt_number)}</b></div>
<div>${esc(dateTime(r.created_at))}</div>
<div>Served by: ${esc(r.cashier || '')}</div>
${r.customer ? `<div>Customer: ${esc(r.customer)}</div>` : ''}
${r.status === 'refunded' ? '<div class="void">REFUNDED</div>' : ''}
<hr><table>${rows}</table><hr>
<table>
<tr><td>Subtotal</td><td class="r">${esc(money(r.subtotal))}</td></tr>
${Number(r.discount) > 0 ? `<tr><td>Discount</td><td class="r">-${esc(money(r.discount))}</td></tr>` : ''}
<tr class="tot"><td>TOTAL</td><td class="r">${esc(money(r.total))}</td></tr>
<tr><td>Paid by</td><td class="r">${esc(paymentLabel(r.payment_method))}</td></tr>
${r.tendered ? `<tr><td>Cash given</td><td class="r">${esc(money(r.tendered))}</td></tr><tr><td>Change</td><td class="r">${esc(money(r.change))}</td></tr>` : ''}
</table><hr>
<div class="c">${esc(s.receipt_footer || 'Thank you!')}</div>
</body></html>`;
}

// Print through a hidden iframe (no pop-up blocker problems).
export function printReceipt(r) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
  document.body.append(frame);
  const doc = frame.contentDocument;
  doc.open();
  doc.write(receiptHtml(r));
  doc.close();
  const go = () => {
    try { frame.contentWindow.focus(); frame.contentWindow.print(); } finally { setTimeout(() => frame.remove(), 60000); }
  };
  const img = doc.querySelector('img');
  if (img && !img.complete) { img.onload = go; img.onerror = go; } else setTimeout(go, 50);
}

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
