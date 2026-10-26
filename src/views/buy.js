import { h, clear, table } from '../lib/dom.js';
import { db, rpc, run } from '../lib/supabase.js';
import { can } from '../lib/state.js';
import { money, num, date, todayISO, paymentLabel } from '../lib/format.js';
import { pageHeader, card, formModal, modal, toast, showError, badge, tabs, withBusy, loading, confirmDialog, formFields, readForm } from '../lib/ui.js';

let products = [];
let suppliers = [];

export async function render(root, { params }) {
  let tab = params.get('tab') || 'list';
  const tabHost = h('div');
  const body = h('div');
  clear(root, pageHeader('Buy', 'What to buy, what was bought, and what you owe suppliers.'), tabHost, body);

  const items = [['list', 'Shopping list']];
  if (can.purchase()) items.push(['record', 'Record a purchase'], ['bills', 'Supplier bills'], ['orders', 'Orders'], ['suppliers', 'Suppliers']);

  async function show(next) {
    tab = next;
    clear(tabHost, tabs(items, tab, show));
    loading(body);
    try {
      await loadBasics();
      if (tab === 'list') await shoppingList(body, show);
      else if (tab === 'record') recordPurchase(body, { onDone: () => show('bills') });
      else if (tab === 'bills') await bills(body);
      else if (tab === 'orders') await orders(body);
      else if (tab === 'suppliers') await supplierList(body);
    } catch (e) { showError(e); clear(body, h('p', { class: 'muted' }, e.message)); }
  }
  await show(items.some(i => i[0] === tab) ? tab : 'list');
}

async function loadBasics() {
  const [p, s] = await Promise.all([
    run(db().from('products').select('id,name,sku,barcode,unit,buying_price,track_stock,sold_by_weight').eq('active', true).order('name').limit(10000)),
    can.purchase() ? run(db().from('suppliers').select('id,name,phone,email,address,active').order('name')) : Promise.resolve([])
  ]);
  products = p; suppliers = s;
}

// ------------------------------------------------------------------ item lines
function lineEditor(initial = []) {
  const listId = 'prod-list-' + Math.random().toString(36).slice(2, 7);
  const datalist = h('datalist', { id: listId }, products.map(p => h('option', { value: label(p) })));
  const rows = h('div', { class: 'lines' });
  const totalEl = h('strong');
  function label(p) { return p.name + ' · ' + p.sku; }
  function find(text) { const t = text.trim().toLowerCase(); return products.find(p => label(p).toLowerCase() === t) || products.find(p => p.sku.toLowerCase() === t || (p.barcode || '').toLowerCase() === t) || products.find(p => p.name.toLowerCase() === t); }
  function addRow(init = {}) {
    const prod = init.product_id ? products.find(p => p.id === init.product_id) : null;
    const pIn = h('input', { list: listId, placeholder: 'Product (type or scan)', value: prod ? label(prod) : '', 'aria-label': 'Product' });
    const qIn = h('input', { type: 'number', min: '0', step: 'any', value: init.quantity ?? '', placeholder: 'Qty', 'aria-label': 'Quantity' });
    const cIn = h('input', { type: 'number', min: '0', step: 'any', value: init.unit_cost ?? (prod ? prod.buying_price : ''), placeholder: 'Unit cost', 'aria-label': 'Unit cost' });
    const lt = h('span', { class: 'num' });
    const row = h('div', { class: 'line' }, pIn, qIn, cIn, lt, h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Remove line', onclick: () => { row.remove(); recalc(); } }, '×'));
    pIn.addEventListener('change', () => { const p = find(pIn.value); if (p) { pIn.value = label(p); if (!cIn.value) cIn.value = p.buying_price; } recalc(); });
    [qIn, cIn].forEach(i => i.addEventListener('input', recalc));
    rows.append(row);
    recalc();
    return row;
  }
  function recalc() {
    let total = 0;
    for (const row of rows.children) {
      const [, q, c, lt] = row.children;
      const v = (Number(q.value) || 0) * (Number(c.value) || 0);
      lt.textContent = v ? money(v) : '';
      total += v;
    }
    totalEl.textContent = money(total);
  }
  function getItems() {
    const out = [];
    for (const row of rows.children) {
      const [pIn, q, c] = row.children;
      if (!pIn.value.trim() && !q.value) continue;
      const p = find(pIn.value);
      if (!p) throw new Error('Unknown product: “' + pIn.value + '”. Pick from the list or add it in Products first.');
      const quantity = Number(q.value), unit_cost = Number(c.value);
      if (!(quantity > 0)) throw new Error('Enter a quantity for ' + p.name + '.');
      if (!(unit_cost >= 0) || c.value === '') throw new Error('Enter the unit cost for ' + p.name + '.');
      if (!p.sold_by_weight && quantity !== Math.trunc(quantity)) throw new Error(p.name + ' is counted in whole units.');
      const dup = out.find(i => i.product_id === p.id);
      if (dup) throw new Error(p.name + ' appears twice. Combine the lines.');
      out.push({ product_id: p.id, quantity, unit_cost });
    }
    if (!out.length) throw new Error('Add at least one item.');
    return out;
  }
  (initial.length ? initial : [{}, {}, {}]).forEach(addRow);
  const el = h('div', { class: 'line-editor' }, datalist,
    h('div', { class: 'line head' }, h('span', null, 'Product'), h('span', null, 'Qty'), h('span', null, 'Unit cost'), h('span', { class: 'num' }, 'Line total'), h('span')),
    rows,
    h('div', { class: 'row between' }, h('button', { type: 'button', class: 'secondary small', onclick: () => addRow().querySelector('input').focus() }, '+ Add line'), h('div', null, 'Total: ', totalEl)));
  return { el, getItems };
}

// ------------------------------------------------------------------ shopping list
async function shoppingList(body, go) {
  const rows = await rpc('get_smart_purchase_recommendations');
  const need = rows.filter(r => Number(r.recommended_qty) > 0);
  const est = need.reduce((s, r) => s + Number(r.estimated_purchase_cost), 0);
  clear(body,
    h('div', { class: 'notice' }, h('div', null, h('b', null, 'How this list works. '),
      'It looks at what sold in the last 14 and 30 days (including imported history), what is on the shelf and what is already ordered, then suggests enough for about ',
      h('b', null, num(rows[0]?.target_cover_days ?? 5) + ' days'), '. It never changes stock — only receiving goods does.')),
    card(h('div', { class: 'row between' }, h('h2', null, need.length + ' items to buy · about ' + money(est)),
      need.length ? h('button', { class: 'primary', onclick: e => withBusy(e.currentTarget, () => prepareRun(body, go)) }, 'Prepare shopping list') : null),
    table([
      { label: 'Product', value: r => h('div', null, h('b', null, r.product_name), h('small', { class: 'block muted' }, r.sku + (r.supplier_name ? ' · ' + r.supplier_name : ''))) },
      { label: 'Priority', value: r => badge(r.recommendation_priority, r.recommendation_priority === 'urgent' ? 'bad' : r.recommendation_priority === 'recommended' ? 'warn' : 'muted') },
      { label: 'On shelf', class: 'num', value: r => num(r.quantity_on_hand) },
      { label: 'Sells / day', class: 'num', value: r => num(r.adjusted_daily_demand, 1) },
      { label: 'Days left', class: 'num', value: r => r.estimated_days_of_stock === null ? '—' : num(r.estimated_days_of_stock, 1) },
      { label: 'Buy', class: 'num', value: r => h('b', null, num(r.recommended_qty)) },
      { label: 'Est. cost', class: 'num', value: r => money(r.estimated_purchase_cost) }
    ], need, { empty: 'Nothing urgent to buy. Stock covers expected sales, or there is not enough sales history yet.' })));
}

async function prepareRun(body, go) {
  const run_ = await rpc('create_purchase_recommendation_run');
  const items = await run(db().from('purchase_recommendation_items').select('id,product_id,recommended_qty,selected_qty,unit_cost,reason,products(name,sku)').eq('run_id', run_.run_id).order('estimated_selected_cost', { ascending: false }));
  const totalEl = h('strong');
  const inputs = [];
  const recalc = () => { totalEl.textContent = money(inputs.reduce((s, x) => s + (Number(x.qty.value) || 0) * Number(x.item.unit_cost), 0)); };
  const list = table([
    { label: 'Product', value: i => h('div', null, h('b', null, i.products?.name), h('small', { class: 'block muted' }, i.reason)) },
    { label: 'Suggested', class: 'num', value: i => num(i.recommended_qty) },
    { label: 'Buy', value: i => { const qty = h('input', { type: 'number', min: '0', step: 'any', value: i.selected_qty, class: 'narrow', 'aria-label': 'Quantity to buy' }); const reason = h('input', { placeholder: 'Why changed?', class: 'reason', hidden: true, 'aria-label': 'Reason for change' }); qty.addEventListener('input', () => { reason.hidden = Number(qty.value) === Number(i.recommended_qty); recalc(); }); inputs.push({ item: i, qty, reason }); return h('div', { class: 'stack' }, qty, reason); } },
    { label: 'Unit cost', class: 'num', value: i => money(i.unit_cost) }
  ], items, { empty: 'Nothing to buy.' });
  recalc();
  clear(body, card(h('div', { class: 'row between' }, h('div', null, h('h2', null, 'Shopping list ' + run_.run_number), h('p', { class: 'muted' }, 'Change quantities if needed. A short reason is required for each change.')), h('div', null, 'Estimated total: ', totalEl)),
    list,
    h('div', { class: 'row end' },
      h('button', { class: 'secondary', onclick: () => go('list') }, 'Back'),
      h('button', { class: 'primary', onclick: e => withBusy(e.currentTarget, async () => {
        const payload = inputs.map(x => ({ product_id: x.item.product_id, selected_qty: Number(x.qty.value) || 0, override_reason: x.reason.value.trim() }));
        const missing = inputs.find(x => Number(x.qty.value) !== Number(x.item.recommended_qty) && !x.reason.value.trim());
        if (missing) { missing.reason.focus(); throw toastErr('Give a reason for every changed quantity.'); }
        const res = await rpc('confirm_purchase_recommendation', { p_run_id: run_.run_id, p_items: payload, p_notes: '' });
        toast('Shopping list confirmed · ' + money(res.selected_cost));
        const chosen = payload.filter(p => p.selected_qty > 0).map(p => ({ product_id: p.product_id, quantity: p.selected_qty, unit_cost: Number(items.find(i => i.product_id === p.product_id)?.unit_cost || 0) }));
        clear(body, card('Shopping list confirmed',
          h('p', null, 'Take the list shopping. When the goods are back, record what was actually bought — that is when stock goes up.'),
          h('div', { class: 'row' },
            h('button', { class: 'secondary', onclick: ev => withBusy(ev.currentTarget, async () => { try { await rpc('queue_purchase_recommendation_email', { p_run_id: run_.run_id }); toast('Sent to management email queue.'); } catch (err) { showError(err); } }) }, 'Email list to management'),
            can.purchase() ? h('button', { class: 'primary', onclick: () => { const host = h('div'); clear(body, host); recordPurchase(host, { initial: chosen, onDone: () => go('bills') }); } }, 'Record what was bought') : null)));
      }).catch(err => err && err.message && showError(err)) }, 'Confirm list'))));
}

function toastErr(msg) { toast(msg, 'error'); return null; }

// ------------------------------------------------------------------ record purchase
function recordPurchase(body, { initial = [], onDone } = {}) {
  const editor = lineEditor(initial);
  const supplierList = 'sup-' + Math.random().toString(36).slice(2, 6);
  const form = h('form', { class: 'stack' },
    h('datalist', { id: supplierList }, suppliers.filter(s => s.active).map(s => h('option', { value: s.name }))),
    formFields([
      { name: 'supplier', label: 'Bought from (shop / supplier)', required: true, list: supplierList, placeholder: 'e.g. Nebbi Market, Mukwano Distributors', hint: 'Pick or type a new name.' },
      { name: 'reference', label: 'Receipt / invoice number', hint: 'Optional — leave empty if there was none.' },
      { name: 'date', label: 'Date bought', type: 'date', value: todayISO(), required: true },
      { name: 'paid', label: 'Paid with', type: 'select', value: 'cash', options: [...['cash', 'mobile_money', 'bank', 'card'].map(m => ({ value: m, label: paymentLabel(m) + ' (paid now)' })), { value: 'credit', label: 'Not paid yet (owe the supplier)' }] },
      { name: 'notes', label: 'Notes', full: true }
    ]),
    h('h3', null, 'Items received'),
    editor.el,
    h('div', { class: 'row end' }, h('button', { class: 'primary', type: 'submit' }, 'Save purchase & add to stock')));
  form.addEventListener('submit', e => {
    e.preventDefault();
    withBusy(form.querySelector('button[type=submit]'), async () => {
      try {
        const v = readForm(form);
        const items = editor.getItems();
        const total = items.reduce((s, i) => s + i.quantity * i.unit_cost, 0);
        const ok = await confirmDialog({ title: 'Save this purchase?', message: `${items.length} item(s), total ${money(total)} from ${v.supplier}. Stock goes up now${v.paid === 'credit' ? ' and the amount is added to what you owe this supplier.' : ' and the money is recorded as paid by ' + paymentLabel(v.paid) + '.'}`, confirmLabel: 'Save purchase' });
        if (!ok) return;
        const existing = suppliers.find(s => s.name.toLowerCase() === v.supplier.toLowerCase());
        const res = await rpc('record_shop_purchase', {
          p_supplier_id: existing?.id || null, p_supplier_name: v.supplier, p_items: items, p_paid_with: v.paid,
          p_reference: v.reference || '', p_purchase_date: v.date || null, p_notes: v.notes || ''
        });
        toast(`Saved ${res.receipt_number} · ${money(res.total)}. Stock updated.`);
        onDone && onDone();
      } catch (err) { showError(err); }
    });
  });
  clear(body, card('Record a purchase', h('p', { class: 'muted' }, 'Enter what physically arrived and what it cost. Products must exist in Products first.'), form));
}

// ------------------------------------------------------------------ bills
async function bills(body) {
  const rows = await run(db().from('supplier_invoices').select('id,invoice_number,invoice_date,due_date,total,amount_paid,status,suppliers(name)').order('created_at', { ascending: false }).limit(300));
  const open = rows.filter(r => r.status !== 'paid');
  const owed = open.reduce((s, r) => s + Number(r.total) - Number(r.amount_paid), 0);
  clear(body, card(h('div', { class: 'row between' }, h('h2', null, 'Supplier bills'), h('div', null, 'You owe: ', h('strong', { class: owed ? 'warn' : '' }, money(owed)))),
    table([
      { label: 'Supplier', value: r => r.suppliers?.name || '' },
      { label: 'Invoice', value: r => r.invoice_number },
      { label: 'Date', value: r => date(r.invoice_date) },
      { label: 'Due', value: r => r.due_date ? h('span', { class: r.status !== 'paid' && r.due_date < todayISO() ? 'bad' : '' }, date(r.due_date)) : '—' },
      { label: 'Total', class: 'num', value: r => money(r.total) },
      { label: 'Balance', class: 'num', value: r => h('b', null, money(Number(r.total) - Number(r.amount_paid))) },
      { label: 'Status', value: r => badge(r.status.replace('_', ' '), r.status === 'paid' ? 'ok' : 'warn') },
      { label: '', class: 'actions', value: r => r.status !== 'paid' ? h('button', { class: 'link', onclick: () => payBill(r, () => bills(body)) }, 'Pay') : '' }
    ], rows, { empty: 'No supplier bills yet.' })));
}

function payBill(r, after) {
  const balance = Number(r.total) - Number(r.amount_paid);
  formModal({
    title: 'Pay supplier', subtitle: (r.suppliers?.name || '') + ' · invoice ' + r.invoice_number + ' · balance ' + money(balance),
    fields: [
      { name: 'amount', label: 'Amount', type: 'number', min: '0', step: 'any', value: balance, required: true },
      { name: 'method', label: 'Paid with', type: 'select', value: 'cash', options: ['cash', 'mobile_money', 'bank', 'card'].map(m => ({ value: m, label: paymentLabel(m) })) },
      { name: 'reference', label: 'Payment reference', required: true, hint: 'Transaction ID or voucher number', full: true }
    ],
    submitLabel: 'Record payment',
    onSubmit: async v => {
      const res = await rpc('pay_supplier_invoice', { p_invoice_id: r.id, p_payment_reference: v.reference, p_payment_method: v.method, p_amount: v.amount });
      toast('Payment saved. Remaining: ' + money(res.remaining_balance));
      after();
    }
  });
}

// ------------------------------------------------------------------ orders
async function orders(body) {
  const rows = await run(db().from('purchase_orders').select('id,order_number,status,order_date,expected_date,notes,supplier_id,suppliers(name),purchase_order_items(product_id,quantity_ordered,quantity_received,unit_cost)').order('created_at', { ascending: false }).limit(200));
  clear(body, card(h('div', { class: 'row between' }, h('div', null, h('h2', null, 'Purchase orders'), h('p', { class: 'muted' }, 'Optional: plan an order with a supplier before goods arrive. An order does not change stock.')),
    h('button', { class: 'primary', onclick: () => newOrder(() => orders(body)) }, '+ New order')),
  table([
    { label: 'Order', value: o => o.order_number },
    { label: 'Supplier', value: o => o.suppliers?.name || '' },
    { label: 'Date', value: o => date(o.order_date) },
    { label: 'Expected', value: o => date(o.expected_date) },
    { label: 'Value', class: 'num', value: o => money(o.purchase_order_items.reduce((s, i) => s + i.quantity_ordered * i.unit_cost, 0)) },
    { label: 'Status', value: o => badge(o.status.replace('_', ' '), o.status === 'received' ? 'ok' : o.status === 'cancelled' ? 'muted' : 'warn') },
    { label: '', class: 'actions', value: o => ['ordered', 'part_received'].includes(o.status) ? h('button', { class: 'link', onclick: () => receiveOrder(o, () => orders(body)) }, 'Receive') : '' }
  ], rows, { empty: 'No purchase orders.' })));
}

function newOrder(after) {
  const editor = lineEditor();
  const form = h('form', { id: 'po-form' }, formFields([
    { name: 'supplier_id', label: 'Supplier', type: 'select', required: true, options: [{ value: '', label: 'Choose…' }, ...suppliers.filter(s => s.active).map(s => ({ value: s.id, label: s.name }))] },
    { name: 'expected', label: 'Expected delivery', type: 'date' },
    { name: 'notes', label: 'Notes', full: true }
  ]), editor.el);
  const m = modal({ title: 'New purchase order', wide: true, content: form, actions: [
    { label: 'Cancel', onClick: ({ close }) => close() },
    { label: 'Create order', kind: 'primary', onClick: async ({ close }) => {
      try {
        const v = readForm(form);
        if (!v.supplier_id) throw new Error('Choose a supplier (add one under Suppliers).');
        const res = await rpc('create_purchase_order', { p_supplier_id: v.supplier_id, p_items: editor.getItems(), p_expected_date: v.expected || null, p_notes: v.notes || '' });
        toast('Order ' + res.order_number + ' created.'); close(); after();
      } catch (e) { showError(e); }
    } }
  ] });
  return m;
}

function receiveOrder(o, after) {
  const outstanding = o.purchase_order_items.filter(i => Number(i.quantity_received) < Number(i.quantity_ordered))
    .map(i => ({ product_id: i.product_id, quantity: Number(i.quantity_ordered) - Number(i.quantity_received), unit_cost: Number(i.unit_cost) }));
  const editor = lineEditor(outstanding);
  const form = h('form', null, formFields([
    { name: 'invoice', label: 'Supplier invoice number', required: true },
    { name: 'date', label: 'Invoice date', type: 'date', value: todayISO() },
    { name: 'due', label: 'Payment due', type: 'date' }
  ]), editor.el);
  modal({ title: 'Receive ' + o.order_number, subtitle: o.suppliers?.name, wide: true, content: form, actions: [
    { label: 'Cancel', onClick: ({ close }) => close() },
    { label: 'Receive into stock', kind: 'primary', onClick: async ({ close }) => {
      try {
        const v = readForm(form);
        if (!v.invoice) throw new Error('Enter the supplier invoice number.');
        const res = await rpc('receive_supplier_invoice', { p_supplier_id: o.supplier_id, p_invoice_number: v.invoice, p_invoice_date: v.date || null, p_due_date: v.due || null, p_items: editor.getItems(), p_purchase_order_id: o.id, p_notes: '' });
        toast('Received ' + res.receipt_number + ' · ' + money(res.total)); close(); after();
      } catch (e) { showError(e); }
    } }
  ] });
}

// ------------------------------------------------------------------ suppliers
async function supplierList(body) {
  const canEdit = can.manageCatalogue();
  clear(body, card(h('div', { class: 'row between' }, h('h2', null, 'Suppliers'), canEdit ? h('button', { class: 'primary', onclick: () => editSupplier(null, () => reload()) }, '+ Add supplier') : null),
    table([
      { label: 'Name', value: s => h('b', null, s.name) },
      { label: 'Phone', value: s => s.phone || '—' },
      { label: 'Email', value: s => s.email || '—' },
      { label: 'Status', value: s => badge(s.active ? 'active' : 'inactive', s.active ? 'ok' : 'muted') },
      { label: '', class: 'actions', value: s => canEdit ? h('button', { class: 'link', onclick: () => editSupplier(s, () => reload()) }, 'Edit') : '' }
    ], suppliers, { empty: 'No suppliers yet. They are also created automatically when you record a purchase.' })));
  async function reload() { await loadBasics(); await supplierList(body); }
}

function editSupplier(s, after) {
  const isNew = !s;
  s = s || { active: true };
  formModal({
    title: isNew ? 'Add supplier' : 'Edit supplier',
    fields: [
      { name: 'name', label: 'Name', value: s.name, required: true, full: true },
      { name: 'phone', label: 'Phone', value: s.phone },
      { name: 'email', label: 'Email', type: 'email', value: s.email },
      { name: 'address', label: 'Address', value: s.address, full: true },
      { name: 'active', label: 'Active', type: 'checkbox', value: s.active }
    ],
    onSubmit: async v => {
      const row = { name: v.name, phone: v.phone || null, email: v.email || null, address: v.address || null, active: v.active };
      if (isNew) await run(db().from('suppliers').insert(row)); else await run(db().from('suppliers').update(row).eq('id', s.id));
      toast('Supplier saved.'); after();
    }
  });
}
