import { h, clear, table, debounce, downloadCsv } from '../lib/dom.js';
import { db, rpc, run } from '../lib/supabase.js';
import { can } from '../lib/state.js';
import { money, num, date, dateTime, paymentLabel } from '../lib/format.js';
import { pageHeader, card, toast, showError, badge, stat, tabs, loading, withBusy, confirmDialog, formFields, readForm } from '../lib/ui.js';
import { periodPicker } from '../lib/period.js';
import { barcodeSvg } from '../lib/barcode.js';

const REASONS = [
  ['damaged', 'Damaged', 'remove'], ['expired', 'Expired', 'remove'], ['lost_stolen', 'Lost / stolen', 'remove'],
  ['own_use', 'Own use (shop/staff)', 'remove'], ['sample', 'Sample / give-away', 'remove'],
  ['found', 'Found extra stock', 'add'], ['correction', 'Correction (needs a note)', 'any'], ['other', 'Other (needs a note)', 'any']
];
const FLAG_LABEL = {
  out: ['Out of stock', 'bad'], low: ['Low', 'warn'], running_out: ['Runs out soon', 'warn'], dead: ['Not selling', 'muted'],
  overstock: ['Overstocked', 'muted'], loss_making: ['Price below cost', 'bad'], no_price: ['No price', 'bad'], no_cost: ['No cost', 'warn']
};
const MOVE_LABEL = { opening: 'Opening stock', purchase: 'Received', sale: 'Sold', sale_return: 'Refund', purchase_return: 'Returned to supplier', adjustment: 'Adjustment / count' };

export async function render(root, { params }) {
  let tab = params.get('tab') || 'overview';
  const tabHost = h('div');
  const body = h('div');
  const items = [['overview', 'Overview'], ['adjust', 'Adjust stock'], ['history', 'History'], ['valuation', 'Valuation'], ['returns', 'Supplier returns'], ['labels', 'Labels']];
  clear(root, pageHeader('Inventory', 'What you have, what it is worth, what is selling and what needs attention.'), tabHost, body);

  async function show(next) {
    tab = next;
    clear(tabHost, tabs(items, tab, show));
    loading(body);
    try {
      if (tab === 'overview') await overview(body);
      else if (tab === 'adjust') await adjust(body);
      else if (tab === 'history') await historyTab(body);
      else if (tab === 'valuation') await valuation(body);
      else if (tab === 'returns') await returns(body);
      else await labels(body);
    } catch (e) { showError(e); clear(body, h('p', { class: 'muted' }, e.message)); }
  }
  await show(items.some(i => i[0] === tab) ? tab : 'overview');
}

// ------------------------------------------------------------------ shared
async function products() {
  return run(db().from('products').select('id,name,sku,barcode,unit,quantity_on_hand,buying_price,selling_price,sold_by_weight,track_stock,active').eq('active', true).order('name').limit(10000));
}

function productPicker(list, onPick, placeholder = 'Type product name, SKU or scan barcode') {
  const id = 'pp-' + Math.random().toString(36).slice(2, 7);
  const label = p => `${p.name} · ${p.sku}`;
  const input = h('input', { list: id, placeholder, 'aria-label': 'Product', class: 'search' });
  const find = t => {
    const v = t.trim().toLowerCase();
    return list.find(p => label(p).toLowerCase() === v) || list.find(p => p.sku.toLowerCase() === v || (p.barcode || '').toLowerCase() === v);
  };
  const pick = () => { const p = find(input.value); if (p) { onPick(p); input.value = ''; input.focus(); } };
  input.addEventListener('change', pick);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); pick(); } });
  return h('div', null, h('datalist', { id }, list.map(p => h('option', { value: label(p) }))), input);
}

// ------------------------------------------------------------------ overview / intelligence
async function overview(body) {
  let days = 30;
  let filter = 'attention';
  let sort = 'revenue';
  const daysSel = h('select', { 'aria-label': 'Look back', style: { width: 'auto' } }, [[30, 'Last 30 days'], [60, 'Last 60 days'], [90, 'Last 90 days'], [180, 'Last 6 months']].map(([v, l]) => h('option', { value: v }, l)));
  const host = h('div');
  clear(body, h('div', { class: 'row between' }, h('p', { class: 'muted' }, 'Sales used for these numbers include imported Loyverse history.'), daysSel), host);
  daysSel.addEventListener('change', () => { days = Number(daysSel.value); load(); });

  async function load() {
    loading(host);
    const d = await rpc('get_inventory_intelligence', { p_days: days });
    draw(d);
  }

  function draw(d) {
    const s = d.summary;
    const search = h('input', { class: 'search', type: 'search', placeholder: 'Search products…', 'aria-label': 'Search products' });
    const filterSel = h('select', { 'aria-label': 'Show' }, [
      ['attention', 'Needs attention'], ['all', 'All products'], ['out', 'Out of stock'], ['low', 'Low stock'], ['running_out', 'Runs out soon'],
      ['dead', 'Not selling'], ['overstock', 'Overstocked'], ['loss_making', 'Price below cost'], ['no_price', 'No price'], ['no_cost', 'No cost'],
      ['A', 'Class A (top sellers)'], ['B', 'Class B'], ['C', 'Class C'], ['D', 'Class D (no sales)']
    ].map(([v, l]) => h('option', { value: v, selected: v === filter }, l)));
    const sortSel = h('select', { 'aria-label': 'Sort' }, [['revenue', 'Sort: sales'], ['profit', 'Sort: profit'], ['cover', 'Sort: days of stock left'], ['value', 'Sort: stock value'], ['name', 'Sort: name']].map(([v, l]) => h('option', { value: v, selected: v === sort }, l)));
    const listHost = h('div');
    const drawList = () => {
      const q = search.value.trim().toLowerCase();
      let rows = d.products.filter(p => {
        if (q && !(p.name + ' ' + p.sku + ' ' + p.category).toLowerCase().includes(q)) return false;
        if (filter === 'all') return true;
        if (filter === 'attention') return p.flags.some(f => ['out', 'low', 'running_out', 'loss_making', 'no_price'].includes(f));
        if (['A', 'B', 'C', 'D'].includes(filter)) return p.abc === filter;
        return p.flags.includes(filter);
      });
      const key = { revenue: p => -Number(p.revenue), profit: p => -Number(p.profit), cover: p => p.days_cover === null ? 1e9 : Number(p.days_cover), value: p => -Number(p.stock_cost), name: p => p.name }[sort];
      rows = rows.slice().sort((a, b) => { const x = key(a), y = key(b); return x < y ? -1 : x > y ? 1 : 0; });
      clear(listHost, table([
        { label: 'Product', value: p => h('div', null, h('b', null, p.name), h('small', { class: 'block muted' }, p.sku + ' · ' + p.category)) },
        { label: 'Class', value: p => badge(p.abc, p.abc === 'A' ? 'ok' : p.abc === 'D' ? 'muted' : '') },
        { label: 'In stock', class: 'num', value: p => p.track_stock ? num(p.qty) + ' ' + (p.unit || '') : '—' },
        { label: 'Sells / day', class: 'num', value: p => num(p.per_day, 1) },
        { label: 'Days left', class: 'num', value: p => p.days_cover === null ? '—' : num(p.days_cover, 0) },
        { label: 'Sales', class: 'num', value: p => money(p.revenue) },
        { label: 'Margin', class: 'num', value: p => p.margin_pct === null ? '—' : h('span', { class: Number(p.margin_pct) < 0 ? 'bad' : '' }, num(p.margin_pct, 0) + '%') },
        { label: 'Stock value', class: 'num', value: p => money(p.stock_cost) },
        { label: 'Last sold', value: p => p.last_sold ? date(p.last_sold) : 'never' },
        { label: 'Status', value: p => h('div', { class: 'badges' }, p.flags.map(f => badge(FLAG_LABEL[f]?.[0] || f, FLAG_LABEL[f]?.[1] || ''))) }
      ], rows.slice(0, 400), { empty: filter === 'attention' ? 'Nothing needs attention right now.' : 'No products match.' }),
      rows.length > 400 ? h('p', { class: 'muted pad' }, `Showing 400 of ${rows.length}.`) : null);
    };
    search.addEventListener('input', debounce(drawList, 150));
    filterSel.addEventListener('change', () => { filter = filterSel.value; drawList(); });
    sortSel.addEventListener('change', () => { sort = sortSel.value; drawList(); });

    const pick = f => () => { filter = f; filterSel.value = f; drawList(); listHost.scrollIntoView({ behavior: 'smooth' }); };
    const tile = (label, value, note, tone, f) => h('button', { type: 'button', class: 'stat clickable-stat' + (tone ? ' ' + tone : ''), onclick: f ? pick(f) : null }, h('span', { class: 'stat-label' }, label), h('strong', null, value), note ? h('small', null, note) : null);
    clear(host,
      h('div', { class: 'stats' },
        stat('Stock value (cost)', money(s.stock_cost), num(s.units_on_hand) + ' units on hand'),
        stat('Stock value (selling price)', money(s.stock_retail)),
        stat('Profit in stock', money(s.potential_profit), 'if all sold at current prices', Number(s.potential_profit) < 0 ? 'bad' : 'ok'),
        stat(`Sales · ${d.days} days`, money(s.revenue), 'profit ' + money(s.profit))),
      h('h2', { class: 'section-title' }, 'Needs attention'),
      h('div', { class: 'stats' },
        tile('Out of stock', num(s.out), 'Lost sales now', s.out ? 'bad' : 'ok', 'out'),
        tile('Low stock', num(s.low), 'At or below alert level', s.low ? 'warn' : '', 'low'),
        tile('Runs out soon', num(s.running_out), `< ${num(d.cover_days)} days at current sales`, s.running_out ? 'warn' : '', 'running_out'),
        tile('Not selling', num(s.dead), money(s.dead_value) + ' tied up', s.dead ? 'warn' : '', 'dead'),
        tile('Overstocked', num(s.overstock), 'Months of stock', '', 'overstock'),
        tile('Price below cost', num(s.loss_making), 'Losing money each sale', s.loss_making ? 'bad' : '', 'loss_making'),
        tile('Missing price / cost', num(Number(s.no_price) + Number(s.no_cost)), 'Fix in Products', (s.no_price || s.no_cost) ? 'warn' : '', s.no_price ? 'no_price' : 'no_cost')),
      h('div', { class: 'grid-2' },
        card('ABC analysis', h('p', { class: 'muted' }, 'A = the few products that bring 80% of sales — never let them run out. B = next 15%. C = the long tail. D = no sales in this period.'),
          h('div', { class: 'abc' }, ['A', 'B', 'C', 'D'].map(k => h('button', { type: 'button', class: 'abc-cell', onclick: pick(k) }, h('strong', null, k), h('span', null, num(s.abc[k]) + ' products'))))),
        card('Top categories by stock value', table([
          { label: 'Category', value: c => c.category },
          { label: 'Stock value', class: 'num', value: c => money(c.stock_cost) },
          { label: 'Sales', class: 'num', value: c => money(c.revenue) }
        ], d.by_category.slice(0, 8)))),
      card(h('div', { class: 'row between' }, h('h2', null, 'Products'),
        h('button', { class: 'secondary small', onclick: () => downloadCsv(`inventory-intelligence-${d.days}d.csv`, [
          ['Product', 'SKU', 'Category', 'Class', 'In stock', 'Unit', 'Cost', 'Price', 'Margin %', 'Units sold', 'Per day', 'Days left', 'Sales', 'Profit', 'Stock value (cost)', 'Last sold', 'Flags'],
          ...d.products.map(p => [p.name, p.sku, p.category, p.abc, p.qty, p.unit, p.cost, p.price, p.margin_pct ?? '', p.units_sold, p.per_day, p.days_cover ?? '', p.revenue, p.profit, p.stock_cost, p.last_sold || '', p.flags.join(' ')])]) }, 'Export CSV')),
        h('div', { class: 'toolbar' }, search, filterSel, sortSel), listHost));
    drawList();
  }
  await load();
}

// ------------------------------------------------------------------ adjust stock
async function adjust(body) {
  if (!can.manageCatalogue()) {
    clear(body, card(null, h('p', null, 'Only an owner or manager can adjust stock. Use Count stock for a full count.')));
    return;
  }
  const list = (await products()).filter(p => p.track_stock);
  const lines = [];
  const reason = h('select', { 'aria-label': 'Reason' }, REASONS.map(([v, l]) => h('option', { value: v }, l)));
  const notes = h('input', { placeholder: 'Note (what happened?)', 'aria-label': 'Note' });
  const linesHost = h('div', { class: 'adjust-lines' });
  const totalHost = h('div', { class: 'row end strong' });
  const submit = h('button', { class: 'primary' }, 'Save adjustment');

  function modeFor() { return REASONS.find(r => r[0] === reason.value)[2]; }
  function draw() {
    const mode = modeFor();
    if (!lines.length) { clear(linesHost, h('p', { class: 'muted pad' }, 'Add the products to adjust.')); clear(totalHost); return; }
    let total = 0;
    clear(linesHost, lines.map((l, i) => {
      if (mode !== 'any') l.mode = mode;
      const qtyIn = h('input', { type: 'number', min: '0', step: l.p.sold_by_weight ? 'any' : '1', value: l.qty ?? '', placeholder: 'Qty', 'aria-label': 'Quantity for ' + l.p.name, class: 'narrow' });
      qtyIn.addEventListener('input', () => { l.qty = qtyIn.value === '' ? null : Number(qtyIn.value); draw(); qtyIn.focus(); });
      const modeSel = h('select', { 'aria-label': 'Change type', disabled: mode !== 'any' }, [['remove', 'Remove'], ['add', 'Add'], ['set', 'Set to']].map(([v, t]) => h('option', { value: v, selected: v === l.mode }, t)));
      modeSel.addEventListener('change', () => { l.mode = modeSel.value; draw(); });
      const cur = Number(l.p.quantity_on_hand);
      const after = l.qty === null ? null : l.mode === 'set' ? l.qty : l.mode === 'add' ? cur + l.qty : cur - l.qty;
      const delta = after === null ? 0 : after - cur;
      total += delta * Number(l.p.buying_price);
      return h('div', { class: 'adjust-line' },
        h('div', null, h('b', null, l.p.name), h('small', { class: 'block muted' }, `${l.p.sku} · in stock ${num(cur)} ${l.p.unit || ''}`)),
        modeSel, qtyIn,
        h('div', { class: 'num' }, after === null ? '' : h('span', { class: after < 0 ? 'bad' : '' }, '→ ' + num(after))),
        h('div', { class: 'num ' + (delta < 0 ? 'bad' : delta > 0 ? 'ok' : '') }, delta ? money(delta * Number(l.p.buying_price)) : ''),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Remove ' + l.p.name, onclick: () => { lines.splice(i, 1); draw(); } }, '×'));
    }));
    clear(totalHost, 'Value change at cost: ', h('span', { class: total < 0 ? 'bad' : 'ok' }, money(total)));
  }
  reason.addEventListener('change', draw);

  submit.addEventListener('click', () => withBusy(submit, async () => {
    try {
      if (!lines.length) throw new Error('Add at least one product.');
      const items = lines.map(l => {
        if (l.qty === null || !(l.qty >= 0)) throw new Error('Enter a quantity for ' + l.p.name + '.');
        return l.mode === 'set' ? { product_id: l.p.id, new_quantity: l.qty } : { product_id: l.p.id, quantity_delta: l.mode === 'add' ? l.qty : -l.qty };
      });
      const label = REASONS.find(r => r[0] === reason.value)[1];
      if (!(await confirmDialog({ title: 'Save this adjustment?', message: `${items.length} product(s), reason: ${label}. Stock and the books are updated immediately.`, confirmLabel: 'Save adjustment' }))) return;
      const r = await rpc('adjust_stock', { p_reason: reason.value, p_items: items, p_notes: notes.value.trim() });
      toast(`${r.adjustment_number} saved.` + (Number(r.loss) ? ' Written off ' + money(r.loss) + '.' : '') + (Number(r.gain) ? ' Added ' + money(r.gain) + '.' : ''));
      await adjust(body);
    } catch (e) { showError(e); }
  }));

  const recent = await run(db().from('stock_adjustments').select('adjustment_number,reason,notes,total_value,created_at,stock_adjustment_items(quantity_delta,products(name))').order('created_at', { ascending: false }).limit(30));
  clear(body,
    card('Adjust stock',
      h('p', { class: 'muted' }, 'For damaged, expired, missing or found goods — without a full stock count. Losses are posted to "Stock loss" in the accounts.'),
      h('div', { class: 'form-grid' }, h('div', { class: 'field' }, h('label', null, 'Reason'), reason), h('div', { class: 'field' }, h('label', null, 'Note'), notes)),
      h('div', { class: 'field' }, h('label', null, 'Add product'), productPicker(list, p => { if (!lines.some(l => l.p.id === p.id)) lines.push({ p, qty: null, mode: modeFor() === 'add' ? 'add' : 'remove' }); draw(); })),
      linesHost, totalHost, h('div', { class: 'row end' }, submit)),
    card('Recent adjustments', table([
      { label: 'When', value: a => dateTime(a.created_at) },
      { label: 'Number', value: a => a.adjustment_number },
      { label: 'Reason', value: a => (REASONS.find(r => r[0] === a.reason) || [0, a.reason])[1] },
      { label: 'Products', value: a => a.stock_adjustment_items.map(i => `${i.products?.name} ${Number(i.quantity_delta) > 0 ? '+' : ''}${num(i.quantity_delta)}`).join(', ') },
      { label: 'Note', value: a => a.notes },
      { label: 'Value', class: 'num', value: a => h('span', { class: Number(a.total_value) < 0 ? 'bad' : 'ok' }, money(a.total_value)) }
    ], recent, { empty: 'No adjustments yet.' })));
  draw();
}

// ------------------------------------------------------------------ history
async function historyTab(body) {
  const picker = periodPicker(() => load(), 'week');
  const typeSel = h('select', { 'aria-label': 'Type' }, [['', 'All movements'], ...Object.entries(MOVE_LABEL)].map(([v, l]) => h('option', { value: v }, l)));
  const search = h('input', { class: 'search', type: 'search', placeholder: 'Filter by product…', 'aria-label': 'Filter by product' });
  const host = h('div');
  let rows = [];
  clear(body, card(h('div', { class: 'toolbar' }, search, typeSel, picker.el), host));
  typeSel.addEventListener('change', () => load());
  search.addEventListener('input', debounce(draw, 150));

  async function load() {
    loading(host);
    const p = picker.get();
    let q = db().from('inventory_movements').select('created_at,movement_type,quantity_delta,unit_cost,note,products(name,sku,unit),who:profiles!inventory_movements_created_by_fkey(full_name)')
      .gte('created_at', p.from).lt('created_at', p.to).order('created_at', { ascending: false }).limit(2000);
    if (typeSel.value) q = q.eq('movement_type', typeSel.value);
    rows = await run(q);
    draw();
  }
  function draw() {
    const t = search.value.trim().toLowerCase();
    const list = rows.filter(r => !t || ((r.products?.name || '') + ' ' + (r.products?.sku || '')).toLowerCase().includes(t));
    const inQty = list.filter(r => Number(r.quantity_delta) > 0).reduce((s, r) => s + Number(r.quantity_delta) * Number(r.unit_cost), 0);
    const outQty = list.filter(r => Number(r.quantity_delta) < 0).reduce((s, r) => s - Number(r.quantity_delta) * Number(r.unit_cost), 0);
    clear(host,
      h('div', { class: 'stats' }, stat('Movements', num(list.length)), stat('Stock in (cost)', money(inQty), null, 'ok'), stat('Stock out (cost)', money(outQty))),
      h('div', { class: 'row end' }, h('button', { class: 'secondary small', onclick: () => downloadCsv('inventory-history.csv', [['When', 'Product', 'SKU', 'Type', 'Change', 'Unit cost', 'Note', 'By'], ...list.map(r => [r.created_at, r.products?.name, r.products?.sku, MOVE_LABEL[r.movement_type] || r.movement_type, r.quantity_delta, r.unit_cost, r.note, r.who?.full_name || ''])]) }, 'Export CSV')),
      table([
        { label: 'When', value: r => dateTime(r.created_at) },
        { label: 'Product', value: r => h('div', null, h('b', null, r.products?.name || ''), h('small', { class: 'block muted' }, r.products?.sku || '')) },
        { label: 'What', value: r => MOVE_LABEL[r.movement_type] || r.movement_type },
        { label: 'Change', class: 'num', value: r => h('span', { class: Number(r.quantity_delta) < 0 ? 'bad' : 'ok' }, (Number(r.quantity_delta) > 0 ? '+' : '') + num(r.quantity_delta) + ' ' + (r.products?.unit || '')) },
        { label: 'Value', class: 'num', value: r => money(Math.abs(Number(r.quantity_delta)) * Number(r.unit_cost)) },
        { label: 'Note', value: r => r.note || '' },
        { label: 'By', value: r => r.who?.full_name || '' }
      ], list.slice(0, 500), { empty: 'No stock movements in this period.' }),
      list.length > 500 ? h('p', { class: 'muted pad' }, 'Showing 500. Export CSV for all ' + list.length + '.') : null);
  }
  await load();
}

// ------------------------------------------------------------------ valuation
async function valuation(body) {
  const d = await rpc('get_inventory_intelligence', { p_days: 30 });
  const s = d.summary;
  const items = d.products.filter(p => p.track_stock && Number(p.qty) > 0);
  clear(body,
    h('div', { class: 'stats' },
      stat('Stock at cost', money(s.stock_cost)), stat('Stock at selling price', money(s.stock_retail)),
      stat('Potential profit', money(s.potential_profit)), stat('Margin in stock', Number(s.stock_retail) > 0 ? num((Number(s.stock_retail) - Number(s.stock_cost)) / Number(s.stock_retail) * 100, 0) + '%' : '—')),
    card(h('div', { class: 'row between' }, h('h2', null, 'By category'),
      h('button', { class: 'secondary small', onclick: () => downloadCsv('inventory-valuation.csv', [['Product', 'SKU', 'Category', 'In stock', 'Unit', 'Unit cost', 'Unit price', 'Value at cost', 'Value at price'], ...items.map(p => [p.name, p.sku, p.category, p.qty, p.unit, p.cost, p.price, p.stock_cost, p.stock_retail])]) }, 'Export valuation CSV')),
    table([
      { label: 'Category', value: c => c.category },
      { label: 'Products', class: 'num', value: c => num(c.products) },
      { label: 'At cost', class: 'num', value: c => money(c.stock_cost) },
      { label: 'At selling price', class: 'num', value: c => money(c.stock_retail) },
      { label: 'Potential profit', class: 'num', value: c => money(Number(c.stock_retail) - Number(c.stock_cost)) },
      { label: 'Share', class: 'num', value: c => Number(s.stock_cost) > 0 ? num(Number(c.stock_cost) / Number(s.stock_cost) * 100, 1) + '%' : '—' }
    ], d.by_category.filter(c => Number(c.stock_cost) > 0 || Number(c.stock_retail) > 0))),
    card('Most valuable stock', table([
      { label: 'Product', value: p => p.name },
      { label: 'In stock', class: 'num', value: p => num(p.qty) + ' ' + (p.unit || '') },
      { label: 'Unit cost', class: 'num', value: p => money(p.cost) },
      { label: 'Value', class: 'num', value: p => money(p.stock_cost) }
    ], items.slice().sort((a, b) => Number(b.stock_cost) - Number(a.stock_cost)).slice(0, 20))),
    h('p', { class: 'muted small' }, 'Values use each product\'s latest cost price. The Inventory account in Accounts is the official book value.'));
}

// ------------------------------------------------------------------ supplier returns
async function returns(body) {
  if (!can.purchase()) { clear(body, card(null, h('p', null, 'Only owners, managers and accountants can return goods to suppliers.'))); return; }
  const [list, suppliers, past] = await Promise.all([
    products(),
    run(db().from('suppliers').select('id,name,active').order('name')),
    run(db().from('supplier_returns').select('return_number,settlement,reference,total,created_at,suppliers(name),supplier_return_items(quantity,products(name))').order('created_at', { ascending: false }).limit(30))
  ]);
  const lines = [];
  const linesHost = h('div', { class: 'adjust-lines' });
  const form = h('div', null, formFields([
    { name: 'supplier', label: 'Supplier', type: 'select', required: true, options: [{ value: '', label: 'Choose…' }, ...suppliers.filter(s => s.active).map(s => ({ value: s.id, label: s.name }))] },
    { name: 'settlement', label: 'How the supplier settles', type: 'select', value: 'credit', options: [{ value: 'credit', label: 'Credit against what we owe' }, ...['cash', 'mobile_money', 'bank'].map(m => ({ value: m, label: 'Refund by ' + paymentLabel(m).toLowerCase() }))] },
    { name: 'reference', label: 'Reference / credit note no.' },
    { name: 'notes', label: 'Reason', placeholder: 'e.g. expired on delivery' }
  ]));
  function draw() {
    clear(linesHost, lines.length ? lines.map((l, i) => {
      const q = h('input', { type: 'number', min: '0', step: 'any', value: l.qty ?? '', placeholder: 'Qty', class: 'narrow', 'aria-label': 'Quantity' });
      const c = h('input', { type: 'number', min: '0', step: 'any', value: l.cost, class: 'narrow', 'aria-label': 'Unit cost' });
      q.addEventListener('input', () => { l.qty = q.value === '' ? null : Number(q.value); });
      c.addEventListener('input', () => { l.cost = Number(c.value); });
      return h('div', { class: 'adjust-line' }, h('div', null, h('b', null, l.p.name), h('small', { class: 'block muted' }, 'in stock ' + num(l.p.quantity_on_hand))), h('span', { class: 'muted small' }, 'Qty'), q, h('span', { class: 'muted small' }, 'Unit cost'), c,
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Remove', onclick: () => { lines.splice(i, 1); draw(); } }, '×'));
    }) : h('p', { class: 'muted pad' }, 'Add the products going back.'));
  }
  const submit = h('button', { class: 'primary' }, 'Record return');
  submit.addEventListener('click', () => withBusy(submit, async () => {
    try {
      const v = readForm(form);
      if (!v.supplier) throw new Error('Choose the supplier.');
      if (!lines.length) throw new Error('Add at least one product.');
      const items = lines.map(l => { if (!(l.qty > 0)) throw new Error('Enter a quantity for ' + l.p.name + '.'); return { product_id: l.p.id, quantity: l.qty, unit_cost: l.cost }; });
      if (!(await confirmDialog({ title: 'Record this return?', message: 'Stock goes down now and the value is ' + (v.settlement === 'credit' ? 'deducted from what you owe the supplier.' : 'recorded as refunded to you.') }))) return;
      const r = await rpc('return_to_supplier', { p_supplier_id: v.supplier, p_items: items, p_settlement: v.settlement, p_reference: v.reference || '', p_notes: v.notes || '' });
      toast(`${r.return_number} recorded · ${money(r.total)}`);
      await returns(body);
    } catch (e) { showError(e); }
  }));
  clear(body,
    card('Return goods to a supplier', form,
      h('div', { class: 'field' }, h('label', null, 'Add product'), productPicker(list, p => { if (!lines.some(l => l.p.id === p.id)) lines.push({ p, qty: null, cost: Number(p.buying_price) }); draw(); })),
      linesHost, h('div', { class: 'row end' }, submit)),
    card('Past returns', table([
      { label: 'When', value: r => dateTime(r.created_at) },
      { label: 'Number', value: r => r.return_number },
      { label: 'Supplier', value: r => r.suppliers?.name || '' },
      { label: 'Products', value: r => r.supplier_return_items.map(i => `${i.products?.name} × ${num(i.quantity)}`).join(', ') },
      { label: 'Settled by', value: r => r.settlement === 'credit' ? 'Credit' : paymentLabel(r.settlement) },
      { label: 'Total', class: 'num', value: r => money(r.total) }
    ], past, { empty: 'No returns yet.' })));
  draw();
}

// ------------------------------------------------------------------ labels
async function labels(body) {
  const list = await products();
  const lines = [];
  const size = h('select', { 'aria-label': 'Label size' }, [['a4', 'A4 sheet (3 × 8)'], ['50x30', 'Label printer 50 × 30 mm'], ['40x25', 'Label printer 40 × 25 mm']].map(([v, l]) => h('option', { value: v }, l)));
  const showPrice = h('input', { type: 'checkbox', checked: true });
  const linesHost = h('div', { class: 'adjust-lines' });
  const preview = h('div', { class: 'label-preview' });
  function draw() {
    clear(linesHost, lines.length ? lines.map((l, i) => {
      const n = h('input', { type: 'number', min: '1', step: '1', value: l.copies, class: 'narrow', 'aria-label': 'Copies' });
      n.addEventListener('input', () => { l.copies = Math.max(1, Math.min(500, Number(n.value) || 1)); drawPreview(); });
      return h('div', { class: 'adjust-line' }, h('div', null, h('b', null, l.p.name), h('small', { class: 'block muted' }, (l.p.barcode || l.p.sku) + ' · ' + money(l.p.selling_price))),
        h('span', { class: 'muted small' }, 'Copies'), n,
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Remove', onclick: () => { lines.splice(i, 1); draw(); } }, '×'));
    }) : h('p', { class: 'muted pad' }, 'Add products to print labels for. Products without a barcode use their SKU — scanning it at the till works.'));
    drawPreview();
  }
  function labelHtml(p) {
    const code = p.barcode || p.sku;
    let svg = '';
    try { svg = barcodeSvg(code); } catch { svg = '<div>Barcode cannot hold this code</div>'; }
    return `<div class="lbl"><div class="n">${esc(p.name)}</div>${showPrice.checked ? `<div class="p">${esc(money(p.selling_price))}</div>` : ''}<div class="b">${svg}</div><div class="c">${esc(code)}</div></div>`;
  }
  function drawPreview() {
    const first = lines[0];
    preview.innerHTML = first ? labelHtml(first.p) : '';
  }
  showPrice.addEventListener('change', drawPreview);
  const printBtn = h('button', { class: 'primary' }, 'Print labels');
  printBtn.addEventListener('click', () => {
    if (!lines.length) return toast('Add at least one product.', 'error');
    const all = lines.flatMap(l => Array.from({ length: l.copies }, () => labelHtml(l.p))).join('');
    const css = {
      a4: '@page{size:A4;margin:8mm}.sheet{display:grid;grid-template-columns:repeat(3,1fr);gap:0}.lbl{height:33.9mm;padding:2mm 3mm;border:1px dashed #ccc}',
      '50x30': '@page{size:50mm 30mm;margin:0}.lbl{width:50mm;height:30mm;padding:1.5mm 2mm;page-break-after:always}',
      '40x25': '@page{size:40mm 25mm;margin:0}.lbl{width:40mm;height:25mm;padding:1mm 1.5mm;page-break-after:always}.n{font-size:8px}.p{font-size:10px}'
    }[size.value];
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Labels</title><style>body{margin:0;font-family:Arial,sans-serif}.lbl{box-sizing:border-box;overflow:hidden;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}.n{font-size:9px;font-weight:bold;max-height:2.4em;overflow:hidden}.p{font-size:12px;font-weight:bold}.b{width:100%;height:40%}.b svg{width:100%;height:100%}.c{font-size:8px;letter-spacing:1px}${css}</style></head><body><div class="sheet">${all}</div></body></html>`;
    const frame = h('iframe', { style: { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' }, 'aria-hidden': 'true' });
    document.body.append(frame);
    frame.contentDocument.open(); frame.contentDocument.write(html); frame.contentDocument.close();
    setTimeout(() => { frame.contentWindow.focus(); frame.contentWindow.print(); setTimeout(() => frame.remove(), 60000); }, 200);
  });
  clear(body,
    card('Print price & barcode labels',
      h('div', { class: 'row' }, h('label', null, 'Size'), size, h('label', { class: 'check' }, showPrice, h('span', null, 'Show price'))),
      h('div', { class: 'field' }, h('label', null, 'Add product'), productPicker(list, p => { if (!lines.some(l => l.p.id === p.id)) lines.push({ p, copies: 1 }); draw(); })),
      h('div', { class: 'label-layout' }, linesHost, h('div', null, h('small', { class: 'muted' }, 'Preview'), preview)),
      h('div', { class: 'row end' }, printBtn)));
  draw();
}

function esc(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

