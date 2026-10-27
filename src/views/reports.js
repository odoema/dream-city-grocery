import '../receipt-archive.css';
import { h, clear, table, downloadCsv } from '../lib/dom.js';
import { db, rpc, run } from '../lib/supabase.js';
import { can, is } from '../lib/state.js';
import { money, num, dateTime, paymentLabel, date } from '../lib/format.js';
import { pageHeader, card, showError, badge, stat, loading, modal, toast, withBusy } from '../lib/ui.js';
import { periodPicker, barChart } from '../lib/period.js';
import { loadReceipt, printReceipt, downloadReceipt } from '../lib/receipt.js';

export async function render(root) {
  const host = h('div');
  const picker = periodPicker(load, 'week');
  clear(root, pageHeader('Reports', is('cashier') ? 'Your own sales and receipt archive.' : 'Sales, profit and receipt archive.', picker.el), host);

  async function load() {
    loading(host);
    const p = picker.get();
    try {
      const [summary, sales, legacy, byItem] = await Promise.all([
        rpc('get_sales_summary', { p_from: p.from, p_to: p.to }),
        run(db().from('sales').select('id,receipt_number,created_at,payment_method,total,returned_amount,cost_of_goods,status,cashier:profiles!sales_cashier_id_fkey(full_name),customers(name)').gte('created_at', p.from).lt('created_at', p.to).order('created_at', { ascending: false }).limit(1000)),
        can.accounts() ? rpc('get_legacy_sales_overview').catch(() => null) : Promise.resolve(null),
        rpc('get_sales_by_item', { p_from: p.from, p_to: p.to }).catch(() => null)
      ]);
      draw(summary, sales, legacy, p, byItem);
    } catch (e) {
      showError(e);
      clear(host, h('p', { class: 'muted' }, e.message));
    }
  }

  function draw(s, sales, legacy, p, byItem) {
    const margin = Number(s.net_sales) > 0 ? Math.round(Number(s.gross_profit) / Number(s.net_sales) * 100) : 0;
    const days = s.by_day || [];
    clear(host,
      h('div', { class: 'stats' },
        stat('Sales', money(s.net_sales), num(s.transactions) + ' receipts'),
        stat('Gross profit', money(s.gross_profit), margin + '% margin'),
        stat('Average sale', money(s.average_sale)),
        stat('Discounts', money(s.discounts)),
        stat('Refunds', money(s.refunds), num(s.refund_count) + ' refunded', Number(s.refund_count) ? 'warn' : '')
      ),
      h('div', { class: 'grid-2' },
        card('Sales by day', days.length ? barChart(days.map(d => ({ label: date(d.day), short: d.day.slice(5), value: d.total })), { format: money }) : h('p', { class: 'muted' }, 'No sales in this period.')),
        card('How customers paid', table([
          { label: 'Method', value: r => paymentLabel(r.method) },
          { label: 'Receipts', class: 'num', value: r => num(r.count) },
          { label: 'Amount', class: 'num', value: r => money(r.total) }
        ], s.by_payment || [], { empty: 'No sales.' }))
      ),
      h('div', { class: 'grid-2' },
        card('Best sellers', table([
          { label: 'Product', value: r => r.name },
          { label: 'Qty', class: 'num', value: r => num(r.quantity) },
          { label: 'Sales', class: 'num', value: r => money(r.revenue) },
          { label: 'Profit', class: 'num', value: r => money(r.profit) }
        ], s.top_products || [], { empty: 'No sales.' })),
        s.scope === 'shop' ? card('By staff member', table([
          { label: 'Staff', value: r => r.name },
          { label: 'Receipts', class: 'num', value: r => num(r.count) },
          { label: 'Sales', class: 'num', value: r => money(r.total) }
        ], s.by_cashier || [], { empty: 'No sales.' })) : null
      ),
      byItem ? salesByItem(byItem, p) : null,
      receiptArchive(sales, p),
      legacy && Number(legacy.lines) > 0 ? card('Imported history (previous system)',
        h('p', null,
          `${num(legacy.lines)} sale lines from ${date(legacy.first_sale)} to ${date(legacy.last_sale)}, net ${money(legacy.net_sales)}. `,
          Number(legacy.unmatched_lines) ? h('span', { class: 'warn' }, `${num(legacy.unmatched_lines)} lines did not match a product.`) : 'All lines matched products.'
        ),
        h('p', { class: 'muted' }, 'Imported history is used for shopping suggestions. It is not part of these totals or the accounts.')
      ) : null
    );
  }

  function receiptArchive(sales, p) {
    return card(
      h('div', { class: 'row between receipt-archive-head' },
        h('div', null,
          h('h2', null, 'Receipt archive'),
          h('p', { class: 'muted small' }, `${num(sales.length)} saved transaction${sales.length === 1 ? '' : 's'} · newest first · filter by date above`)
        ),
        h('button', { class: 'secondary small', onclick: () => exportSales(sales, p) }, 'Export CSV')
      ),
      table([
        { label: 'Receipt', value: r => h('b', null, r.receipt_number) },
        { label: 'Date & time', value: r => dateTime(r.created_at) },
        { label: 'Cashier', value: r => r.cashier?.full_name || '' },
        { label: 'Customer', value: r => r.customers?.name || 'Walk-in' },
        { label: 'Payment', value: r => paymentLabel(r.payment_method) },
        { label: 'Total', class: 'num', value: r => Number(r.returned_amount) > 0 && r.status === 'completed' ? h('span', null, money(r.total - r.returned_amount), h('small', { class: 'block muted' }, money(r.returned_amount) + ' returned')) : money(r.total) },
        { label: 'Status', value: r => badge(r.status === 'completed' && Number(r.returned_amount) > 0 ? 'part returned' : r.status, r.status === 'completed' ? (Number(r.returned_amount) > 0 ? 'warn' : 'ok') : 'bad') },
        { label: 'Receipt', class: 'actions', value: r => h('div', { class: 'receipt-actions' },
          h('button', { class: 'secondary small', onclick: async () => {
            try { printReceipt(await loadReceipt(db(), r.id)); } catch (e) { showError(e); }
          } }, 'Print'),
          h('button', { class: 'primary small', onclick: async () => {
            try { downloadReceipt(await loadReceipt(db(), r.id)); } catch (e) { showError(e); }
          } }, 'Download'),
          can.refund() && r.status === 'completed' ? h('button', { class: 'secondary small', onclick: () => returnItems(r, load) }, 'Return') : null
        ) }
      ], sales, { empty: 'No receipts in this period.' }),
      sales.length === 1000 ? h('p', { class: 'muted pad' }, 'Showing the latest 1,000 receipts. Narrow the period to see more.') : null,
      h('div', { class: 'receipt-archive-note' },
        h('b', null, 'Where receipts are kept: '),
        'Every completed sale is permanently recorded in the production sales and sale_items records. This archive reads those records, so receipts remain searchable by date, cashier, customer, payment method and receipt number.'
      )
    );
  }

  function salesByItem(d, p) {
    const items = Array.isArray(d.items) ? d.items : [];
    const categories = Array.isArray(d.categories) ? d.categories : [];
    let view = 'items';
    const host = h('div');
    const search = h('input', { class: 'search', type: 'search', placeholder: 'Search…', 'aria-label': 'Search items' });
    const sel = h('select', { 'aria-label': 'Group by' }, h('option', { value: 'items' }, 'By item'), h('option', { value: 'categories' }, 'By category'));
    const total = items.reduce((a, r) => a + Number(r.revenue || 0), 0) || 1;
    const drawTable = () => {
      const q = search.value.trim().toLowerCase();
      if (view === 'items') {
        const rows = items.filter(r => !q || `${r.name} ${r.sku} ${r.category}`.toLowerCase().includes(q));
        clear(host, table([
          { label: 'Product', value: r => h('div', null, h('b', null, r.name), h('small', { class: 'block muted' }, `${r.sku} · ${r.category}`)) },
          { label: 'Qty sold', class: 'num', value: r => num(r.quantity || 0) },
          { label: 'Sales', class: 'num', value: r => money(r.revenue) },
          { label: 'Cost', class: 'num', value: r => money(r.cost) },
          { label: 'Profit', class: 'num', value: r => money(r.profit) },
          { label: 'Margin', class: 'num', value: r => Number(r.revenue) > 0 ? `${num(Number(r.profit) / Number(r.revenue) * 100, 0)}%` : '—' },
          { label: 'Share', class: 'num', value: r => `${num(Number(r.revenue) / total * 100, 1)}%` },
          { label: 'Refunded', class: 'num', value: r => Number(r.refunded_qty) ? num(r.refunded_qty) : '' }
        ], rows.slice(0, 300), { empty: 'No sales in this period.' }), rows.length > 300 ? h('p', { class: 'muted pad' }, `Showing 300 of ${rows.length}. Export CSV for all.`) : null);
      } else {
        const rows = categories.filter(r => !q || String(r.category).toLowerCase().includes(q));
        clear(host, table([
          { label: 'Category', value: r => r.category },
          { label: 'Qty sold', class: 'num', value: r => num(r.quantity) },
          { label: 'Sales', class: 'num', value: r => money(r.revenue) },
          { label: 'Profit', class: 'num', value: r => money(r.profit) },
          { label: 'Margin', class: 'num', value: r => Number(r.revenue) > 0 ? `${num(Number(r.profit) / Number(r.revenue) * 100, 0)}%` : '—' },
          { label: 'Share', class: 'num', value: r => `${num(Number(r.revenue) / total * 100, 1)}%` }
        ], rows, { empty: 'No sales in this period.' }));
      }
    };
    search.addEventListener('input', drawTable);
    sel.addEventListener('change', () => { view = sel.value; drawTable(); });
    const exportBtn = h('button', { class: 'secondary small', onclick: () => {
      if (view === 'items') {
        downloadCsv(`sales-by-item-${p.fromISO}-to-${p.toISO}.csv`, [
          ['Product', 'SKU', 'Category', 'Qty', 'Sales', 'Cost', 'Profit', 'Refunded qty'],
          ...items.map(r => [r.name, r.sku, r.category, r.quantity || 0, r.revenue, r.cost, r.profit, r.refunded_qty])
        ]);
      } else {
        downloadCsv(`sales-by-category-${p.fromISO}-to-${p.toISO}.csv`, [
          ['Category', 'Qty', 'Sales', 'Profit'],
          ...categories.map(r => [r.category, r.quantity, r.revenue, r.profit])
        ]);
      }
    } }, 'Export CSV');
    drawTable();
    return card(h('div', { class: 'row between' }, h('h2', null, 'Sales by item'), h('div', { class: 'row' }, sel, exportBtn)), h('div', { class: 'toolbar' }, search), host);
  }

  function exportSales(sales, p) {
    downloadCsv(`sales-${p.fromISO}-to-${p.toISO}.csv`, [
      ['Receipt', 'Time', 'Staff', 'Customer', 'Payment', 'Total', 'Cost of goods', 'Status'],
      ...sales.map(r => [r.receipt_number, r.created_at, r.cashier?.full_name || '', r.customers?.name || '', r.payment_method, r.total, r.cost_of_goods, r.status])
    ]);
  }

  await load();
}

// Return some or all items of a sale. Money goes back the way it was paid.
async function returnItems(sale, done) {
  let items;
  try {
    items = await run(db().from('sale_items').select('id,product_name,quantity,returned_quantity,unit_price,line_total').eq('sale_id', sale.id));
  } catch (e) { return showError(e); }
  const open = items.filter(i => Number(i.returned_quantity) < Number(i.quantity));
  const inputs = new Map();
  const reason = h('input', { type: 'text', required: true, placeholder: 'e.g. expired, wrong item, damaged', 'aria-label': 'Reason' });
  const rows = open.map(i => {
    const left = Number(i.quantity) - Number(i.returned_quantity);
    const inp = h('input', { type: 'number', min: '0', max: String(left), step: 'any', value: '0', class: 'qty-input', 'aria-label': 'Quantity to return of ' + i.product_name });
    inputs.set(i.id, inp);
    return h('tr', null, h('td', null, i.product_name), h('td', { class: 'num' }, num(left) + ' × ' + money(i.unit_price)), h('td', { class: 'num' }, inp),
      h('td', null, h('button', { class: 'link', type: 'button', onclick: () => { inp.value = String(left); } }, 'All')));
  });
  const m = modal({
    title: 'Return items · ' + sale.receipt_number,
    subtitle: 'Stock goes back on the shelf. The money goes back by ' + paymentLabel(sale.payment_method).toLowerCase() + '.',
    content: h('div', null,
      h('table', { class: 'table' }, h('thead', null, h('tr', null, h('th', null, 'Item'), h('th', { class: 'num' }, 'Can return'), h('th', { class: 'num' }, 'Return'), h('th'))), h('tbody', null, rows)),
      h('div', { class: 'field' }, h('label', null, 'Reason'), reason)),
    actions: [
      { label: 'Cancel', onClick: ({ close }) => close() },
      { label: 'Return all', onClick: () => inputs.forEach((inp, id) => { const i = open.find(x => x.id === id); inp.value = String(Number(i.quantity) - Number(i.returned_quantity)); }) },
      { label: 'Refund selected', kind: 'primary', onClick: async ({ close }) => {
        const lines = [...inputs].map(([id, inp]) => ({ sale_item_id: id, quantity: Number(inp.value) || 0 })).filter(l => l.quantity > 0);
        if (!lines.length) return toast('Enter how many to return.', 'error');
        if (!reason.value.trim()) { reason.focus(); return toast('Give a reason.', 'error'); }
        await withBusy(m.el.querySelector('.modal-foot .primary'), async () => {
          try {
            const r = await rpc('return_sale_items', { p_sale_id: sale.id, p_lines: lines, p_reason: reason.value.trim() });
            toast(`${r.return_number}: give back ${money(r.amount)} (${paymentLabel(r.refund_method).toLowerCase()}).`);
            close(); done();
          } catch (e) { showError(e); }
        });
      } }
    ]
  });
}
