// Close day: each person counts their own drawer (cash-up), and managers get a
// one-page day report they can print or send to the Executive Director.
import { h, clear, table } from '../lib/dom.js';
import { db, rpc, run } from '../lib/supabase.js';
import { state, is } from '../lib/state.js';
import { money, num, dateTime, time, paymentLabel, todayISO, rangeFor, date } from '../lib/format.js';
import { pageHeader, card, stat, showError, toast, loading, withBusy, formFields, readForm, badge } from '../lib/ui.js';
import { printDocument } from '../lib/documents.js';

const manager = () => is('owner', 'manager', 'accountant');

export async function render(root) {
  const mine = h('div');
  const report = h('div');
  clear(root, pageHeader('Close day', manager()
    ? 'Count your drawer, then check the whole shop\'s day and send it to the Executive Director.'
    : 'Count the cash in your drawer before you go home.'), mine, manager() ? report : null);
  await drawMine(mine);
  if (manager()) await drawReport(report, todayISO());
}

// ---------------------------------------------------------------- my cash-up
async function drawMine(host) {
  loading(host);
  try {
    const p = await rpc('get_cash_up_preview');
    const by = p.by_method || {};
    const net = Number(p.cash_sales) - Number(p.cash_refunds) + Number(p.cash_in_other) - Number(p.cash_out_other);
    const expectedOut = h('strong');
    const diffOut = h('strong');
    const form = h('form', { class: 'cashup-form' },
      formFields([
        { name: 'float', label: 'Float you started with', type: 'number', min: '0', step: 'any', value: Number(p.last_float) || 0, hint: 'Change money that was already in the drawer.' },
        { name: 'counted', label: 'Cash counted now', type: 'number', min: '0', step: 'any', required: true, placeholder: 'Count notes and coins', hint: 'Everything in the drawer, including the float.' },
        { name: 'notes', label: 'Notes (optional)', full: true, placeholder: 'e.g. 2,000 given as change from my pocket' }
      ]),
      h('div', { class: 'cashup-result' },
        h('div', null, h('span', { class: 'muted' }, 'Drawer should hold'), expectedOut),
        h('div', null, h('span', { class: 'muted' }, 'Difference'), diffOut)),
      h('div', { class: 'row end' }, h('button', { class: 'primary', type: 'submit' }, 'Close my day')));
    const recalc = () => {
      const v = readForm(form);
      const expected = (Number(v.float) || 0) + net;
      expectedOut.textContent = money(expected);
      if (v.counted === null || v.counted === undefined) { diffOut.textContent = '—'; diffOut.className = ''; return; }
      const d = Number(v.counted) - expected;
      diffOut.textContent = d === 0 ? 'Exact ✓' : (d < 0 ? 'Short ' : 'Over ') + money(Math.abs(d));
      diffOut.className = d === 0 ? 'ok' : 'bad';
    };
    form.addEventListener('input', recalc);
    form.addEventListener('submit', e => {
      e.preventDefault();
      withBusy(form.querySelector('button[type=submit]'), async () => {
        try {
          const v = readForm(form);
          const r = await rpc('close_cash_up', { p_opening_float: Number(v.float) || 0, p_counted_cash: Number(v.counted), p_notes: v.notes || '' });
          toast(Number(r.difference) === 0 ? 'Day closed. Cash is exact.' : `Day closed. Cash ${Number(r.difference) < 0 ? 'short' : 'over'} by ${money(Math.abs(r.difference))}.`, Number(r.difference) === 0 ? 'info' : 'error');
          printSlip({ ...r, ...p, opening_float: Number(v.float) || 0, notes: v.notes });
          await render(host.closest('main') || host.parentElement);
        } catch (err) { showError(err); }
      });
    });
    clear(host,
      h('div', { class: 'stats' },
        stat('My receipts', num(p.receipts), 'since ' + dateTime(p.from)),
        stat('Cash sales', money(p.cash_sales)),
        stat('Mobile money', money(by.mobile_money || 0), 'check on the phone'),
        stat('Card / bank', money(Number(by.card || 0) + Number(by.bank || 0))),
        Number(by.credit) ? stat('On credit', money(by.credit), 'to be collected') : null),
      card('Count my drawer',
        h('p', { class: 'muted small' }, `Cash refunds ${money(p.cash_refunds)} · other cash in ${money(p.cash_in_other)} (customer payments, top-ups) · cash paid out ${money(p.cash_out_other)} (expenses, suppliers, bank).`),
        form));
    recalc();
  } catch (e) { showError(e); clear(host, h('p', { class: 'muted' }, e.message)); }
}

function printSlip(r) {
  printDocument({
    title: 'Cash-up', number: r.cash_up_number, date: dateTime(new Date().toISOString()),
    stamp: Number(r.difference) === 0 ? 'Exact' : Number(r.difference) < 0 ? 'Short' : 'Over',
    boxes: [{ heading: 'Staff', rows: [['Name', state.profile?.full_name || ''], ['From', dateTime(r.from)], ['To', dateTime(r.to)], ['Receipts', num(r.receipts)]] }],
    columns: [{ label: 'Item' }, { label: 'Amount', right: true }],
    rows: [['Float at start', money(r.opening_float)], ['Cash sales', money(r.cash_sales)], ['Cash refunds', '−' + money(r.cash_refunds)],
      ['Other cash in', money(r.cash_in_other)], ['Cash paid out', '−' + money(r.cash_out_other)]],
    totals: [['Drawer should hold', money(r.expected_cash), 'sub'], ['Counted', money(r.counted_cash), ''], ['Difference', money(r.difference), 'grand']],
    notes: r.notes || '', signatures: ['Counted by', 'Checked by']
  });
}

// ---------------------------------------------------------------- day report (managers)
async function drawReport(host, day) {
  loading(host);
  try {
    const { from, to } = rangeFor(day, day);
    const [s, cashUps, expenses, returns, moves] = await Promise.all([
      rpc('get_sales_summary', { p_from: from, p_to: to }),
      run(db().from('cash_ups').select('cash_up_number,created_at,receipts,expected_cash,counted_cash,difference,notes,staff:profiles!cash_ups_staff_id_fkey(full_name)').gte('created_at', from).lt('created_at', to).order('created_at')),
      run(db().from('expenses').select('expense_number,description,category,amount,payment_method').gte('created_at', from).lt('created_at', to)),
      run(db().from('sale_returns').select('return_number,amount,reason,refund_method,sales(receipt_number)').gte('created_at', from).lt('created_at', to)),
      run(db().from('money_movements').select('movement_number,kind,amount,from_method,to_method,note').gte('created_at', from).lt('created_at', to))
    ]);
    const short = cashUps.reduce((a, c) => a + Number(c.difference), 0);
    const spent = expenses.reduce((a, e) => a + Number(e.amount), 0);
    const low = await run(db().from('products').select('name,quantity_on_hand,reorder_level,track_stock').eq('active', true).limit(10000))
      .then(ps => ps.filter(p => p.track_stock && Number(p.quantity_on_hand) <= Number(p.reorder_level))).catch(() => []);
    const dayInput = h('input', { type: 'date', value: day, max: todayISO(), 'aria-label': 'Day', onchange: e => e.target.value && drawReport(host, e.target.value) });
    const text = summaryText(day, s, short, spent, returns, low);
    clear(host,
      card(h('div', { class: 'row between' }, h('h2', null, 'Day report · ' + date(day)),
        h('div', { class: 'row' }, dayInput,
          h('button', { class: 'secondary small', type: 'button', onclick: () => printDay(day, s, cashUps, expenses, returns, moves, low) }, 'Print'),
          h('button', { class: 'secondary small', type: 'button', onclick: () => navigator.clipboard?.writeText(text).then(() => toast('Copied. Paste it into an SMS or email.')) }, 'Copy'),
          h('a', { class: 'primary small', href: 'https://wa.me/?text=' + encodeURIComponent(text), target: '_blank', rel: 'noopener' }, 'Send on WhatsApp'))),
        h('div', { class: 'stats' },
          stat('Sales', money(s.net_sales), num(s.transactions) + ' receipts'),
          stat('Gross profit', money(s.gross_profit)),
          stat('Expenses', money(spent)),
          stat('Refunds', money(s.refunds), num(s.refund_count) + ' sales', Number(s.refund_count) ? 'warn' : ''),
          stat('Cash short / over', short === 0 ? 'Exact' : money(short), num(cashUps.length) + ' drawers counted', short < 0 ? 'bad' : cashUps.length ? 'ok' : 'warn')),
        h('div', { class: 'grid-2' },
          h('div', null, h('h3', null, 'How customers paid'), table([
            { label: 'Method', value: r => paymentLabel(r.method) },
            { label: 'Receipts', class: 'num', value: r => num(r.count) },
            { label: 'Amount', class: 'num', value: r => money(r.total) }], s.by_payment || [], { empty: 'No sales.' })),
          h('div', null, h('h3', null, 'Drawers counted'), table([
            { label: 'Staff', value: c => c.staff?.full_name || '' },
            { label: 'Time', value: c => time(c.created_at) },
            { label: 'Expected', class: 'num', value: c => money(c.expected_cash) },
            { label: 'Counted', class: 'num', value: c => money(c.counted_cash) },
            { label: 'Difference', class: 'num', value: c => Number(c.difference) === 0 ? badge('Exact', 'ok') : h('span', { class: 'bad' }, money(c.difference)) }],
            cashUps, { empty: 'Nobody has closed their day yet.' }))),
        (s.by_cashier || []).length && !cashUps.length ? h('p', { class: 'warn small' }, 'Sales were made but no drawer was counted for this day.') : null));
  } catch (e) { showError(e); clear(host, h('p', { class: 'muted' }, e.message)); }
}

function summaryText(day, s, short, spent, returns, low) {
  const name = state.settings?.business_name || 'Shop';
  return [
    `${name} — day report ${date(day)}`,
    `Sales: ${money(s.net_sales)} (${num(s.transactions)} receipts)`,
    `Gross profit: ${money(s.gross_profit)}`,
    `Expenses: ${money(spent)}`,
    `Refunds: ${money(s.refunds)}${returns.length ? ` (${returns.length})` : ''}`,
    `Cash: ${short === 0 ? 'exact' : (short < 0 ? 'short ' : 'over ') + money(Math.abs(short))}`,
    ...(s.by_payment || []).map(p => `· ${paymentLabel(p.method)}: ${money(p.total)}`),
    low.length ? `Running low: ${low.slice(0, 8).map(p => p.name).join(', ')}${low.length > 8 ? ` +${low.length - 8} more` : ''}` : 'Stock: nothing running low'
  ].join('\n');
}

function printDay(day, s, cashUps, expenses, returns, moves, low) {
  const rows = [
    ['Net sales', money(s.net_sales)], ['Receipts', num(s.transactions)], ['Discounts', money(s.discounts)], ['Refunds', money(s.refunds)],
    ['Cost of goods', money(s.cost_of_goods)], ['Gross profit', money(s.gross_profit)],
    ...(s.by_payment || []).map(p => ['Paid by ' + paymentLabel(p.method).toLowerCase(), money(p.total)])
  ];
  const list = (head, items, fmt) => items.length ? { heading: head, html: '<table class="lines"><tbody>' + items.map(i => '<tr>' + fmt(i).map((c, k) => `<td${k ? ' class="r"' : ''}>${String(c).replace(/[&<>]/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[x]))}</td>`).join('') + '</tr>').join('') + '</tbody></table>' } : null;
  printDocument({
    title: 'Day report', number: date(day),
    columns: [{ label: 'Sales' }, { label: 'Amount', right: true }], rows,
    sections: [
      list('Drawers counted', cashUps, c => [`${c.staff?.full_name || ''} · ${c.cash_up_number}`, 'expected ' + money(c.expected_cash), 'counted ' + money(c.counted_cash), money(c.difference)]),
      list('Expenses', expenses, e => [`${e.expense_number} · ${e.description}`, paymentLabel(e.payment_method), money(e.amount)]),
      list('Returns', returns, r => [`${r.return_number} · ${r.sales?.receipt_number || ''} · ${r.reason}`, paymentLabel(r.refund_method), money(r.amount)]),
      list('Owner money', moves, m => [`${m.movement_number} · ${m.kind}${m.note ? ' · ' + m.note : ''}`, money(m.amount)]),
      list('Running low', low.slice(0, 30), p => [p.name, num(p.quantity_on_hand) + ' left'])
    ].filter(Boolean),
    signatures: ['Prepared by', 'Executive Director']
  });
}
