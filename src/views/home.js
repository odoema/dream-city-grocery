import { h, clear, table } from '../lib/dom.js';
import { db, rpc, run } from '../lib/supabase.js';
import { state, can, is } from '../lib/state.js';
import { money, num, time, todayISO, rangeFor, paymentLabel } from '../lib/format.js';
import { card, stat, showError, badge, loading } from '../lib/ui.js';

export async function render(root) {
  const hour = Number(new Intl.DateTimeFormat('en', { hour: 'numeric', hourCycle: 'h23', timeZone: state.settings?.timezone || undefined }).format(new Date()));
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const host = h('div');
  clear(root,
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, `${greet}, ${(state.profile.full_name || '').split(' ')[0] || 'there'}`),
      h('p', { class: 'muted' }, is('cashier') ? 'Your sales today.' : "Here's how the shop is doing today.")),
    h('a', { class: 'primary big', href: '#/sell' }, '🛒 New sale')),
    host);
  loading(host);

  try {
    const today = todayISO();
    const { from, to } = rangeFor(today, today);
    const [summary, products, bills, sales] = await Promise.all([
      rpc('get_sales_summary', { p_from: from, p_to: to }),
      run(db().from('products').select('id,name,quantity_on_hand,reorder_level,unit,track_stock').eq('active', true).limit(10000)),
      can.purchase() ? run(db().from('supplier_invoices').select('total,amount_paid,due_date,status').neq('status', 'paid')) : Promise.resolve([]),
      run(db().from('sales').select('id,receipt_number,created_at,total,payment_method,status').gte('created_at', from).lt('created_at', to).order('created_at', { ascending: false }).limit(8))
    ]);
    const low = products.filter(p => p.track_stock && Number(p.quantity_on_hand) <= Number(p.reorder_level)).sort((a, b) => Number(a.quantity_on_hand) - Number(b.quantity_on_hand));
    const owed = bills.reduce((s, b) => s + Number(b.total) - Number(b.amount_paid), 0);
    const overdue = bills.filter(b => b.due_date && b.due_date < todayISO()).length;
    const cash = (summary.by_payment || []).find(p => p.method === 'cash');

    const checklist = [];
    if (can.manageCatalogue() && !products.length) checklist.push(['Add your products', 'Import your Loyverse catalogue in one go, or add products one by one.', '#/import', 'Import from Loyverse']);
    if (is('owner') && products.length && !products.some(p => Number(p.quantity_on_hand) > 0)) checklist.push(['Record opening stock', 'Import Loyverse stock, or set opening stock per product (Products → History).', '#/import', 'Import stock']);
    if (is('owner')) checklist.push(['Add your staff', 'Give each cashier their own login so sales are traceable.', '#/staff', 'Staff']);

    clear(host,
      checklist.length && !products.length ? card('Get started', h('div', { class: 'checklist' }, checklist.map(([t, d, href, label]) =>
        h('div', { class: 'check-item' }, h('div', null, h('b', null, t), h('p', { class: 'muted' }, d)), h('a', { class: 'secondary', href }, label))))) : null,
      h('div', { class: 'stats' },
        stat("Today's sales", money(summary.net_sales), num(summary.transactions) + ' receipts'),
        summary.scope === 'shop' ? stat('Gross profit today', money(summary.gross_profit)) : null,
        stat('Cash taken', money(cash?.total || 0), 'Should be in the drawer'),
        stat('Low or out of stock', num(low.length), low.length ? 'Needs buying' : 'All good', low.length ? 'warn' : 'ok'),
        can.purchase() ? stat('Owed to suppliers', money(owed), overdue ? overdue + ' overdue' : null, overdue ? 'bad' : '') : null),
      h('div', { class: 'grid-2' },
        card(h('div', { class: 'row between' }, h('h2', null, 'Running low'), h('a', { class: 'link', href: '#/buy' }, 'Shopping list →')),
          table([
            { label: 'Product', value: p => p.name },
            { label: 'Left', class: 'num', value: p => h('span', { class: Number(p.quantity_on_hand) <= 0 ? 'bad' : 'warn' }, num(p.quantity_on_hand) + ' ' + (p.unit || '')) },
            { label: 'Alert at', class: 'num', value: p => num(p.reorder_level) }
          ], low.slice(0, 8), { empty: 'Nothing is running low.' })),
        card(h('div', { class: 'row between' }, h('h2', null, 'Latest sales'), h('a', { class: 'link', href: '#/reports' }, 'All reports →')),
          table([
            { label: 'Time', value: s => time(s.created_at) },
            { label: 'Receipt', value: s => s.receipt_number },
            { label: 'Paid by', value: s => paymentLabel(s.payment_method) },
            { label: 'Total', class: 'num', value: s => s.status === 'completed' ? money(s.total) : badge(s.status, 'bad') }
          ], sales, { empty: 'No sales yet today.' }))));
  } catch (e) {
    showError(e);
    clear(host, h('p', { class: 'muted' }, e.message));
  }
}
