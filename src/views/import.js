import Papa from 'papaparse';
import { h, clear, table, downloadCsv } from '../lib/dom.js';
import { db, rpc } from '../lib/supabase.js';
import { money, num, date, zonedToUtc, timezone } from '../lib/format.js';
import { pageHeader, card, toast, showError, stat, withBusy, confirmDialog } from '../lib/ui.js';
import { detectKind, detectStores, parseItems, parseCustomers, parseSales, itemsFromLegacyDictionary, chunk } from '../import/loyverse.js';

const STEPS_HELP = {
  items: ['Loyverse Back Office → Items → Item list', 'Click EXPORT → choose "Export items"', 'Upload the CSV file here'],
  customers: ['Loyverse Back Office → Customers → Customer base', 'Click EXPORT', 'Upload the CSV file here'],
  sales: ['Loyverse Back Office → Reports → Receipts', 'Pick a date range (e.g. the last 3 months)', 'Click EXPORT → choose "Receipts by item"', 'Upload the CSV file here']
};

export async function render(root) {
  const host = h('div');
  clear(root, pageHeader('Import data', 'Move from Loyverse in a few minutes: products (with opening stock), customers and past sales.'), host);
  await home();

  async function home() {
    let legacyCount = 0;
    try {
      const { count } = await db().from('dream_city_legacy_product_dictionary').select('id', { count: 'exact', head: true });
      legacyCount = count || 0;
    } catch { /* table does not exist in other shops */ }
    const batches = await db().from('import_batches').select('kind,file_name,status,summary,created_at').order('created_at', { ascending: false }).limit(10).then(r => r.data || []);
    clear(host,
      h('div', { class: 'notice' }, h('div', null, h('b', null, 'Recommended order: '), '1. Products  →  2. Customers  →  3. Sales history. You can repeat an import safely: existing records are updated, not duplicated.')),
      h('div', { class: 'grid-3' },
        importCard('items', '1 · Products & stock', 'Items, categories, prices, costs, barcodes, variants — and optionally today\'s stock as opening stock.'),
        importCard('customers', '2 · Customers', 'Names, phones, emails, addresses and customer codes.'),
        importCard('sales', '3 · Sales history', 'Past sales by item. Used for reports and to make the shopping list smart from day one. Not added to stock or accounts.')),
      legacyCount ? card('Catalogue already in this database',
        h('p', null, `This shop already holds a ${num(legacyCount)}-item reference catalogue from an earlier Loyverse import. You can turn it into live products (prices, costs and categories — no stock).`),
        h('button', { class: 'secondary', onclick: e => withBusy(e.currentTarget, importLegacy) }, 'Create products from saved catalogue')) : null,
      batches.length ? card('Recent imports', table([
        { label: 'When', value: b => date(b.created_at) },
        { label: 'What', value: b => b.kind },
        { label: 'File', value: b => b.file_name },
        { label: 'Result', value: b => b.status + (b.summary?.created !== undefined ? ` · ${b.summary.created} new, ${b.summary.updated || 0} updated` : b.summary?.inserted !== undefined ? ` · ${b.summary.inserted} lines` : '') }
      ], batches)) : null);
  }

  function importCard(kind, title, text) {
    const input = h('input', { type: 'file', accept: '.csv,text/csv', hidden: true, onchange: () => input.files[0] && readFile(kind, input.files[0]) });
    return card(title, h('p', { class: 'muted' }, text),
      h('ol', { class: 'steps small' }, STEPS_HELP[kind].map(s => h('li', null, s))),
      input, h('button', { class: 'primary', onclick: () => input.click() }, 'Choose CSV file'));
  }

  function readFile(expected, file) {
    Papa.parse(file, {
      header: true, skipEmptyLines: 'greedy',
      complete: res => {
        const headers = res.meta.fields || [];
        const kind = detectKind(headers);
        if (kind === 'receipts-without-items') return showError(new Error('This is the plain "Receipts" export. For sales history choose EXPORT → "Receipts by item" in Loyverse.'));
        if (!kind) return showError(new Error('This file does not look like a Loyverse export (columns: ' + headers.slice(0, 6).join(', ') + '…).'));
        if (kind !== expected) toast(`This file looks like ${kind}, not ${expected}. Continuing as ${kind}.`);
        preview(kind, res.data, headers, file.name);
      },
      error: err => showError(err)
    });
  }

  // ---------------------------------------------------------------- preview
  function preview(kind, rows, headers, fileName) {
    if (kind === 'items') return previewItems(rows, headers, fileName);
    if (kind === 'customers') return previewCustomers(rows, headers, fileName);
    return previewSales(rows, headers, fileName);
  }

  function previewItems(rows, headers, fileName) {
    const stores = detectStores(headers);
    let store = stores[0] || null;
    const storeSel = stores.length > 1 ? h('select', { 'aria-label': 'Store' }, stores.map(s => h('option', { value: s }, s))) : null;
    const stockBox = h('input', { type: 'checkbox', id: 'opening-stock' });
    const body = h('div');
    const draw = () => {
      const parsed = parseItems(rows, headers, { store });
      const s = parsed.stats;
      clear(body,
        h('div', { class: 'stats' },
          stat('Items', num(s.total), s.variants ? `${s.variants} are variants` : null),
          stat('Categories', num(s.categories)),
          stat('With stock', num(s.withStock), 'value ' + money(s.stockValue)),
          stat('Without a price', num(s.noPrice), null, s.noPrice ? 'warn' : ''),
          stat('Negative stock', num(s.negativeStock), 'treated as 0', s.negativeStock ? 'warn' : '')),
        parsed.problems.length ? h('div', { class: 'notice warn' }, h('ul', null, parsed.problems.map(p => h('li', null, p)))) : null,
        table([
          { label: 'Row', value: i => i.row },
          { label: 'Name', value: i => i.name },
          { label: 'SKU', value: i => i.sku },
          { label: 'Category', value: i => i.category },
          { label: 'Cost', class: 'num', value: i => money(i.cost) },
          { label: 'Price', class: 'num', value: i => money(i.price) },
          { label: 'In stock', class: 'num', value: i => i.track_stock ? num(i.in_stock) : 'not tracked' }
        ], parsed.items.slice(0, 25)),
        parsed.items.length > 25 ? h('p', { class: 'muted pad' }, `…and ${parsed.items.length - 25} more.`) : null);
      body.parsed = parsed;
    };
    storeSel && storeSel.addEventListener('change', () => { store = storeSel.value; draw(); });
    draw();
    const go = h('button', { class: 'primary' }, 'Import products');
    go.addEventListener('click', () => withBusy(go, async () => {
      const items = body.parsed.items;
      const withStock = stockBox.checked;
      const ok = await confirmDialog({
        title: `Import ${num(items.length)} products?`,
        message: withStock
          ? `Stock on the shelf will be set from Loyverse for products that have no stock history yet, worth about ${money(body.parsed.stats.stockValue)}, and posted to the books as opening stock. Count the shelves soon after to confirm.`
          : 'Products, prices and categories will be created or updated. Stock is not changed.',
        confirmLabel: 'Import'
      });
      if (ok) await runImport('items', fileName, items, { post_opening_stock: withStock, store }, (batch, part) => rpc('import_loyverse_items', { p_batch_id: batch, p_items: part, p_post_opening_stock: withStock }));
    }));
    clear(host, card(h('div', { class: 'row between' }, h('h2', null, 'Products from ' + fileName), h('button', { class: 'link', onclick: home }, '← Back')),
      storeSel ? h('div', { class: 'field' }, h('label', null, 'Which Loyverse store\'s prices and stock?'), storeSel) : null,
      body,
      h('label', { class: 'check big-check' }, stockBox, h('span', null, h('b', null, 'Also bring in today\'s stock as opening stock'),
        h('small', null, 'Only for products with no stock history here yet. Leave off if you prefer to count the shelves with Count stock instead.'))),
      h('div', { class: 'row end' }, go)));
  }

  function previewCustomers(rows, headers, fileName) {
    const parsed = parseCustomers(rows, headers);
    const go = h('button', { class: 'primary' }, `Import ${num(parsed.customers.length)} customers`);
    go.addEventListener('click', () => withBusy(go, () => runImport('customers', fileName, parsed.customers, {}, (batch, part) => rpc('import_customers', { p_batch_id: batch, p_customers: part }))));
    clear(host, card(h('div', { class: 'row between' }, h('h2', null, 'Customers from ' + fileName), h('button', { class: 'link', onclick: home }, '← Back')),
      h('div', { class: 'stats' }, stat('Customers', num(parsed.stats.total)), stat('With phone', num(parsed.stats.withPhone)), stat('Missing a name', num(parsed.stats.noName), 'will be skipped')),
      parsed.problems.length ? h('div', { class: 'notice warn' }, parsed.problems.join(' ')) : null,
      table([
        { label: 'Name', value: c => c.name }, { label: 'Phone', value: c => c.phone }, { label: 'Email', value: c => c.email }, { label: 'Code', value: c => c.customer_code }
      ], parsed.customers.slice(0, 25)),
      h('p', { class: 'muted' }, 'Credit limits start at 0. Set them per customer afterwards.'),
      h('div', { class: 'row end' }, go)));
  }

  function previewSales(rows, headers, fileName) {
    let order = 'auto';
    const orderSel = h('select', { 'aria-label': 'Date format' }, [['auto', 'Detect automatically'], ['dmy', 'Day/Month/Year'], ['mdy', 'Month/Day/Year'], ['ymd', 'Year-Month-Day']].map(([v, l]) => h('option', { value: v }, l)));
    const body = h('div');
    const tz = timezone();
    const toUtc = p => zonedToUtc(p.y, p.mo, p.d, p.h, p.mi, p.s, tz);
    const draw = () => {
      const parsed = parseSales(rows, headers, { order, toUtc });
      body.parsed = parsed;
      const s = parsed.stats;
      clear(body,
        h('div', { class: 'stats' },
          stat('Sale lines', num(s.total)), stat('Receipts', num(s.receipts || 0)),
          stat('Period', s.first ? date(s.first) + ' – ' + date(s.last) : '—'),
          stat('Net sales', money(s.net || 0))),
        h('p', { class: 'muted' }, `Dates read as ${{ dmy: 'day/month/year', mdy: 'month/day/year', ymd: 'year-month-day' }[parsed.order] || '—'} in ${tz}.`),
        parsed.problems.length ? h('div', { class: 'notice warn' }, h('ul', null, parsed.problems.map(p => h('li', null, p)))) : null,
        table([
          { label: 'When', value: l => date(l.sold_at) }, { label: 'Receipt', value: l => l.receipt_number }, { label: 'Item', value: l => l.item_name + (l.variant ? ' (' + l.variant + ')' : '') },
          { label: 'Qty', class: 'num', value: l => (l.receipt_type === 'refund' ? '−' : '') + num(l.quantity) }, { label: 'Net', class: 'num', value: l => money(l.net_sales) }
        ], parsed.lines.slice(0, 20)));
    };
    orderSel.addEventListener('change', () => { order = orderSel.value; draw(); });
    draw();
    const go = h('button', { class: 'primary' }, 'Import sales history');
    go.addEventListener('click', () => withBusy(go, () => runImport('sales', fileName, body.parsed.lines, { order }, (batch, part) => rpc('import_legacy_sales', { p_batch_id: batch, p_lines: part }), 500)));
    clear(host, card(h('div', { class: 'row between' }, h('h2', null, 'Sales history from ' + fileName), h('button', { class: 'link', onclick: home }, '← Back')),
      h('div', { class: 'notice' }, 'History is kept for reports and shopping suggestions only. It does not change stock or the accounts. Import products first so lines can be matched to them.'),
      h('div', { class: 'field' }, h('label', null, 'Date format in the file'), orderSel), body, h('div', { class: 'row end' }, go)));
  }

  // ---------------------------------------------------------------- run
  async function runImport(kind, fileName, records, options, send, size = 200) {
    if (!records.length) throw new Error('Nothing to import.');
    const bar = h('progress', { max: records.length, value: 0 });
    const status = h('p', { class: 'muted' }, 'Starting…');
    clear(host, card('Importing ' + fileName, status, bar, h('p', { class: 'muted small' }, 'Keep this page open until it finishes.')));
    const batch = await rpc('start_import_batch', { p_kind: kind, p_file_name: fileName, p_options: options });
    const total = { created: 0, updated: 0, skipped: 0, inserted: 0, duplicates_skipped: 0, opening_stock_items: 0, opening_stock_value: 0, warnings: [] };
    let done = 0;
    try {
      for (const part of chunk(records, size)) {
        const r = await send(batch, part);
        for (const k of Object.keys(total)) if (k !== 'warnings' && r[k] !== undefined) total[k] += Number(r[k]) || 0;
        if (r.warnings) total.warnings.push(...r.warnings);
        done += part.length;
        bar.value = done;
        status.textContent = `${num(done)} of ${num(records.length)} processed…`;
      }
      await rpc('finish_import_batch', { p_batch_id: batch, p_status: 'completed', p_summary: { ...total, warnings: total.warnings.length } });
    } catch (e) {
      await rpc('finish_import_batch', { p_batch_id: batch, p_status: 'failed', p_summary: { ...total, error: e.message, processed: done } }).catch(() => {});
      clear(host, card('Import stopped', h('p', { class: 'bad' }, e.message), h('p', null, `${num(done)} records were saved before the error. Fix the problem and import the same file again — saved records are updated, not duplicated.`), h('button', { class: 'primary', onclick: home }, 'Back')));
      return;
    }
    clear(host, card('Import finished',
      h('div', { class: 'stats' },
        kind === 'sales' ? stat('Lines added', num(total.inserted), num(total.duplicates_skipped) + ' already there') : stat('New', num(total.created)),
        kind === 'sales' ? null : stat('Updated', num(total.updated)),
        kind === 'sales' ? null : stat('Skipped', num(total.skipped), null, total.skipped ? 'warn' : ''),
        kind === 'items' && options.post_opening_stock ? stat('Opening stock', num(total.opening_stock_items) + ' products', money(total.opening_stock_value)) : null),
      total.warnings.length ? h('div', { class: 'notice warn' }, h('div', null, h('b', null, `${total.warnings.length} things to check. `), 'Download the list and fix them in Products.'),
        h('button', { class: 'secondary small', onclick: () => downloadCsv('import-warnings.csv', [['Row', 'Message'], ...total.warnings.map(w => [w.row ?? '', w.message])]) }, 'Download list')) : null,
      total.warnings.length ? h('ul', { class: 'warnings' }, total.warnings.slice(0, 15).map(w => h('li', null, (w.row ? 'Row ' + w.row + ': ' : '') + w.message))) : null,
      h('div', { class: 'row' },
        h('a', { class: 'primary', href: kind === 'customers' ? '#/customers' : kind === 'sales' ? '#/buy' : '#/products' }, kind === 'sales' ? 'See shopping list' : 'View ' + (kind === 'customers' ? 'customers' : 'products')),
        h('button', { class: 'secondary', onclick: home }, 'Import something else'))));
  }

  async function importLegacy() {
    const { data, error } = await db().from('dream_city_legacy_product_dictionary').select('*').limit(10000);
    if (error) throw error;
    const items = itemsFromLegacyDictionary(data);
    if (!(await confirmDialog({ title: `Create ${items.length} products?`, message: 'Prices, costs and categories come from the saved Loyverse catalogue. Stock is not changed — record it with Count stock or opening stock.' }))) return;
    await runImport('items', 'Saved Loyverse catalogue', items, { source: 'legacy_dictionary' }, (batch, part) => rpc('import_loyverse_items', { p_batch_id: batch, p_items: part, p_post_opening_stock: false }));
  }
}
