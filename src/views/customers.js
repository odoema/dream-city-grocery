import { h, clear, table, debounce, downloadCsv } from '../lib/dom.js';
import { db, rpc, run } from '../lib/supabase.js';
import { can } from '../lib/state.js';
import { money, dateTime, paymentLabel } from '../lib/format.js';
import { pageHeader, card, formModal, modal, toast, showError, badge, stat, loading } from '../lib/ui.js';

export async function render(root) {
  let customers = [];
  const search = h('input', { class: 'search', type: 'search', placeholder: 'Search name or phone…', 'aria-label': 'Search customers' });
  const stats = h('div', { class: 'stats' });
  const listHost = h('div');

  clear(root,
    pageHeader('Customers', 'Contacts, credit limits and what customers owe.',
      can.manageCustomers() ? h('button', { class: 'primary', onclick: () => edit() }, '+ Add customer') : null,
      h('button', { class: 'secondary', onclick: exportCsv }, 'Export CSV')),
    stats, card(h('div', { class: 'toolbar' }, search), listHost));

  async function load() {
    loading(listHost);
    customers = await rpc('list_customers_with_balance');
    draw();
  }

  function draw() {
    const q = search.value.trim().toLowerCase();
    const owing = customers.filter(c => Number(c.balance) > 0);
    clear(stats,
      stat('Customers', String(customers.filter(c => c.active).length)),
      stat('Owe the shop', String(owing.length)),
      stat('Total owed to you', money(owing.reduce((s, c) => s + Number(c.balance), 0)), null, owing.length ? 'warn' : ''));
    const rows = customers.filter(c => !q || (c.name + ' ' + (c.phone || '') + ' ' + (c.email || '')).toLowerCase().includes(q));
    clear(listHost, table([
      { label: 'Customer', value: c => h('div', null, h('b', null, c.name), c.active ? null : badge('inactive', 'muted')) },
      { label: 'Phone', value: c => c.phone || '—' },
      { label: 'Credit limit', class: 'num', value: c => money(c.credit_limit) },
      { label: 'Owes', class: 'num', value: c => Number(c.balance) > 0 ? h('b', { class: 'warn' }, money(c.balance)) : '—' },
      { label: '', class: 'actions', value: c => h('div', { class: 'row' },
        Number(c.balance) > 0 ? h('button', { class: 'link', onclick: e => { e.stopPropagation(); pay(c); } }, 'Receive payment') : null,
        can.manageCustomers() ? h('button', { class: 'link', onclick: e => { e.stopPropagation(); edit(c); } }, 'Edit') : null) }
    ], rows, { empty: 'No customers yet.', onRow: statement }));
  }
  search.addEventListener('input', debounce(draw, 150));

  function edit(c) {
    const isNew = !c;
    c = c || { credit_limit: 0, active: true };
    formModal({
      title: isNew ? 'Add customer' : 'Edit customer',
      fields: [
        { name: 'name', label: 'Name', value: c.name, required: true, full: true },
        { name: 'phone', label: 'Phone', type: 'tel', value: c.phone },
        { name: 'email', label: 'Email', type: 'email', value: c.email },
        { name: 'address', label: 'Address', value: c.address, full: true },
        { name: 'credit_limit', label: 'Credit limit', type: 'number', min: '0', step: 'any', value: c.credit_limit, hint: 'The most this customer may owe. 0 = cash only.' },
        { name: 'active', label: 'Active', type: 'checkbox', value: c.active !== false },
        { name: 'notes', label: 'Notes', type: 'textarea', value: c.notes, full: true, rows: 2 }
      ],
      onSubmit: async v => {
        const row = { name: v.name, phone: v.phone || null, email: v.email || null, address: v.address || '', notes: v.notes || '', credit_limit: v.credit_limit || 0, active: v.active };
        if (isNew) await run(db().from('customers').insert(row));
        else await run(db().from('customers').update(row).eq('id', c.id));
        toast(isNew ? 'Customer added.' : 'Customer saved.');
        await load();
      }
    });
  }

  function pay(c) {
    formModal({
      title: 'Receive payment', subtitle: c.name + ' owes ' + money(c.balance),
      fields: [
        { name: 'amount', label: 'Amount received', type: 'number', min: '0', step: 'any', value: c.balance, required: true },
        { name: 'method', label: 'Paid by', type: 'select', value: 'cash', options: ['cash', 'mobile_money', 'card', 'bank'].map(m => ({ value: m, label: paymentLabel(m) })) },
        { name: 'reference', label: 'Reference', hint: 'Mobile-money or bank transaction ID', full: true }
      ],
      submitLabel: 'Record payment',
      onSubmit: async v => {
        const r = await rpc('receive_customer_payment', { p_customer_id: c.id, p_amount: v.amount, p_payment_method: v.method, p_reference: v.reference || '', p_note: '' });
        toast('Payment recorded. Still owing: ' + money(r.remaining_balance));
        await load();
      }
    });
  }

  async function statement(c) {
    const body = h('div', null, h('div', { class: 'loading' }, h('span', { class: 'spinner' }), 'Loading…'));
    modal({ title: c.name, subtitle: [c.phone, c.email].filter(Boolean).join(' · ') || 'Customer statement', wide: true, content: body });
    try {
      const st = await rpc('get_customer_statement', { p_customer_id: c.id });
      clear(body,
        h('div', { class: 'stats' }, stat('Owes now', money(st.balance)), stat('Credit limit', money(c.credit_limit))),
        table([
          { label: 'Date', value: e => dateTime(e.at) },
          { label: 'Entry', value: e => e.kind === 'sale' ? 'Credit sale' + (e.status !== 'completed' ? ' (' + e.status + ')' : '') : 'Payment' },
          { label: 'Reference', value: e => e.reference },
          { label: 'Amount', class: 'num', value: e => h('span', { class: e.kind === 'payment' ? 'ok' : '' }, (e.kind === 'payment' ? '−' : '') + money(e.amount)) }
        ], st.entries, { empty: 'No credit sales or payments yet.' }));
    } catch (e) { clear(body, h('p', { class: 'muted' }, e.message)); }
  }

  function exportCsv() {
    downloadCsv('customers.csv', [['Name', 'Phone', 'Email', 'Address', 'Credit limit', 'Owes', 'Active'],
      ...customers.map(c => [c.name, c.phone || '', c.email || '', c.address || '', c.credit_limit, c.balance, c.active ? 'yes' : 'no'])]);
  }

  await load().catch(showError);
}
