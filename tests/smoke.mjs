// Browser smoke test against the production build with a mocked Supabase API.
// Usage: npm run build && node tests/smoke.mjs
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const { chromium } = createRequire(execSync('npm root -g').toString().trim() + '/')('playwright');
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const SB = 'nohdgmylncjtdymfshfy.supabase.co';
const now = new Date().toISOString();
const uid = '00000000-0000-0000-0000-0000000000aa';
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: uid, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, email: 'owner@shop.test' }) + '.sig';

const products = [
  { id: 'p1', name: 'Sugar 1kg', sku: 'SUG1', barcode: '6001', selling_price: 5000, buying_price: 4200, quantity_on_hand: 10, reorder_level: 3, unit: 'piece', sold_by_weight: false, track_stock: true, available_for_sale: true, active: true, category_id: 'c1', categories: { name: 'Food' } },
  { id: 'p2', name: 'Rice', sku: 'RICE', barcode: null, selling_price: 4000, buying_price: 3000, quantity_on_hand: 25, reorder_level: 5, unit: 'kg', sold_by_weight: true, track_stock: true, available_for_sale: true, active: true, category_id: 'c1', categories: { name: 'Food' } }
];
const settings = { id: true, business_name: 'Test Grocery', tagline: 'Fresh daily', logo_url: 'brand/dream-city-logo.jpeg', primary_color: '#16376A', currency_code: 'UGX', currency_decimals: 0, locale: 'en-UG', timezone: 'Africa/Kampala', receipt_prefix: 'TG', receipt_footer: 'Thanks', receipt_width: process.env.RECEIPT_WIDTH || '80mm', stock_cover_days: 5, allow_cashier_discounts: false, setup_completed: true, phone: '', email: '', address: '', tax_id: '', receipt_header: '', director_name: 'Hon. Dr. Betty Udongo Pacutho', director_title: 'Executive Director' };
const calls = [];
const summary = { scope: 'shop', transactions: 3, gross_sales: 15000, discounts: 0, net_sales: 15000, cost_of_goods: 12000, gross_profit: 3000, refunds: 0, refund_count: 0, average_sale: 5000, by_payment: [{ method: 'cash', count: 3, total: 15000 }], by_day: [{ day: now.slice(0, 10), count: 3, total: 15000, profit: 3000 }], by_hour: [{ hour: 9, count: 1, total: 4000 }, { hour: 13, count: 2, total: 11000 }], top_products: [{ product_id: 'p1', name: 'Oran Coconut Falvoured UHT Milk -1 litre long name for overflow test', sku: 'SUG1', quantity: 3, revenue: 15000, profit: 2400 }], by_cashier: [{ cashier_id: uid, name: 'Owner', count: 3, total: 15000 }] };
const fin = { trial_balance: [{ code: '1000', name: 'Cash', type: 'asset', debit: 15000, credit: 0 }, { code: '4000', name: 'Sales Revenue', type: 'revenue', debit: 0, credit: 15000 }], profit_and_loss: { revenue: 15000, discounts_returns: 0, net_revenue: 15000, cost_of_goods: 0, gross_profit: 15000, operating_expenses: 0, net_profit: 15000, lines: [] }, balance_sheet: { assets: [{ code: '1000', name: 'Cash', amount: 15000 }], liabilities: [], equity: [], retained_earnings: 15000, total_assets: 15000, total_liabilities_equity: 15000 } };

const intel = { days: 30, cover_days: 5, summary: { products: 2, stock_cost: 117000, stock_retail: 150000, potential_profit: 33000, units_on_hand: 35, revenue: 15000, profit: 2400, out: 0, low: 1, running_out: 1, dead: 1, dead_value: 75000, overstock: 0, loss_making: 0, no_price: 0, no_cost: 0, abc: { A: 1, B: 0, C: 0, D: 1 } },
  by_category: [{ category: 'Food', products: 2, stock_cost: 117000, stock_retail: 150000, revenue: 15000, profit: 2400, units_sold: 3 }],
  products: [
    { id: 'p1', name: 'Sugar 1kg', sku: 'SUG1', unit: 'piece', category: 'Food', image_path: null, qty: 2, cost: 4200, price: 5000, reorder_level: 3, track_stock: true, units_sold: 3, revenue: 15000, profit: 2400, per_day: 0.1, days_cover: 20, stock_cost: 8400, stock_retail: 10000, margin_pct: 16, last_sold: now, abc: 'A', flags: ['low'] },
    { id: 'p2', name: 'Rice', sku: 'RICE', unit: 'kg', category: 'Food', image_path: null, qty: 25, cost: 3000, price: 4000, reorder_level: 5, track_stock: true, units_sold: 0, revenue: 0, profit: 0, per_day: 0, days_cover: null, stock_cost: 75000, stock_retail: 100000, margin_pct: 25, last_sold: null, abc: 'D', flags: ['dead'] }
  ] };

function rest(table, url) {
  switch (table) {
    case 'profiles': return { id: uid, full_name: 'Brian Owner', role: 'owner', active: true };
    case 'store_settings': return settings;
    case 'products': return url.searchParams.get('select')?.startsWith('id') && url.searchParams.has('limit') && url.searchParams.get('limit') === '1' ? [] : products;
    case 'categories': return [{ id: 'c1', name: 'Food', active: true }];
    case 'customers': return [{ id: 'k1', name: 'Okello', phone: '0772', credit_limit: 10000, active: true }];
    case 'suppliers': return [{ id: 's1', name: 'Nebbi Market', active: true }];
    case 'sales': return [{ id: 'sa1', receipt_number: 'TG-000001', created_at: now, payment_method: 'cash', total: 5000, cost_of_goods: 4200, status: 'completed', cashier: { full_name: 'Brian Owner' }, customers: null }];
    case 'supplier_invoices': return [{ id: 'i1', invoice_number: 'INV-1', invoice_date: now.slice(0, 10), due_date: null, total: 20000, amount_paid: 0, status: 'posted', suppliers: { name: 'Nebbi Market' } }];
    case 'stocktake_sessions': return [];
    case 'purchase_orders': return [];
    case 'expenses': return [];
    case 'journals': return [];
    case 'import_batches': return [];
    case 'inventory_movements': return [{ created_at: now, movement_type: 'sale', quantity_delta: -2, unit_cost: 4200, note: 'Sale TG-000001', products: { name: 'Sugar 1kg', sku: 'SUG1', unit: 'piece' }, who: { full_name: 'Brian Owner' } }];
    case 'stock_adjustments': return [];
    case 'sale_items': return [{ id: 'si1', product_name: 'Sugar 1kg', quantity: 1, returned_quantity: 0, unit_price: 5000, line_total: 5000 }];
    case 'cash_ups': return [{ cash_up_number: 'CU-00001', created_at: now, receipts: 3, expected_cash: 35000, counted_cash: 34000, difference: -1000, notes: '', staff: { full_name: 'Brian Owner' } }];
    case 'sale_returns': return [];
    case 'loyverse_sync_state': return { id: true, enabled: true, last_finished_at: now, last_error: '', last_result: { items: 120, sales: 4, refunds: 0, stock_aligned: 3, warnings: [] } };
    case 'money_movements': return [{ id: 'm1', movement_number: 'MOV-00001', kind: 'transfer', amount: 30000, from_method: 'cash', to_method: 'bank', note: 'Banking', created_at: now }];
    case 'supplier_returns': return [];
    default: return [];
  }
}

function rpc(name) {
  switch (name) {
    case 'get_public_store_profile': return { business_name: 'Test Grocery', tagline: 'Fresh daily', setup_completed: true, has_owner: true, logo_url: 'brand/dream-city-logo.jpeg', primary_color: '#16376A' };
    case 'get_sales_summary': return summary;
    case 'get_financial_statements': return fin;
    case 'get_legacy_sales_overview': return { lines: 0 };
    case 'list_customers_with_balance': return [{ id: 'k1', name: 'Okello', phone: '0772', credit_limit: 10000, active: true, balance: 3000 }];
    case 'list_staff': return [{ id: uid, email: 'owner@shop.test', full_name: 'Brian Owner', role: 'owner', active: true, created_at: now }];
    case 'get_smart_purchase_recommendations': return [{ product_id: 'p2', product_name: 'Rice', sku: 'RICE', quantity_on_hand: 1, recommended_qty: 9, adjusted_daily_demand: 1.4, estimated_days_of_stock: 0.7, estimated_purchase_cost: 27000, recommendation_priority: 'recommended', target_cover_days: 5 }];
    case 'complete_sale': return { sale_id: 'sa2', receipt_number: 'TG-000002', subtotal: 10000, discount: 0, total: 10000, created_at: now, replayed: false };
    case 'start_import_batch': return 'b1';
    case 'import_loyverse_items': return { created: 2, updated: 0, skipped: 0, warnings: [], opening_stock_items: 1, opening_stock_value: 1000 };
    case 'finish_import_batch': return null;
    case 'get_inventory_intelligence': return intel;
    case 'get_sales_by_item': return { items: [{ product_id: 'p1', name: 'Sugar 1kg', sku: 'SUG1', category: 'Food', quantity: 3, revenue: 15000, cost: 12600, profit: 2400, refunded_qty: 0 }], categories: [{ category: 'Food', quantity: 3, revenue: 15000, profit: 2400 }] };
    case 'adjust_stock': return { id: 'a1', adjustment_number: 'ADJ-000001', lines: 1, gain: 0, loss: 8400, journal_id: 'j1' };
    case 'get_cash_up_preview': return { from: now, to: now, last_float: 20000, receipts: 3, cash_sales: 15000, cash_refunds: 0, cash_in_other: 0, cash_out_other: 0, by_method: { cash: 15000 } };
    case 'close_cash_up': return { id: 'cu1', cash_up_number: 'CU-00001', expected_cash: 35000, counted_cash: 34000, difference: -1000 };
    case 'return_sale_items': return { return_id: 'rt1', return_number: 'RTN-000001', amount: 5000, refund_method: 'cash', fully_returned: false };
    case 'record_money_movement': return { id: 'm1', movement_number: 'MOV-00001' };
    case 'return_to_supplier': return { id: 'r1', return_number: 'RET-000001', total: 4200 };
    default: return null;
  }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.route('**/*', async route => {
  const req = route.request();
  const url = new URL(req.url());
  if (url.hostname === 'app.test') {
    const file = path.join(root, url.pathname === '/' ? 'index.html' : url.pathname);
    return fs.existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: 'nf' });
  }
  if (url.hostname === SB) {
    const json = body => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (url.pathname.startsWith('/auth/v1/token')) return json({ access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user: { id: uid, email: 'owner@shop.test', aud: 'authenticated', role: 'authenticated', user_metadata: {} } });
    if (url.pathname.startsWith('/auth/v1/')) return json({});
    const m = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)/);
    if (m) { calls.push(m[1] + ' ' + (req.postData() || '')); return json(rpc(m[1])); }
    const t = url.pathname.match(/^\/rest\/v1\/(\w+)/);
    if (t) {
      calls.push(req.method() + ' ' + t[1]);
      let body = rest(t[1], url);
      const accept = req.headers()['accept'] || '';
      if (accept.includes('vnd.pgrst.object') && Array.isArray(body)) body = body[0] || null;
      if (accept.includes('vnd.pgrst.object') && !Array.isArray(body)) return json(body);
      return json(body);
    }
    return json({});
  }
  return route.abort();
});

const step = async (name, fn) => { try { await fn(); console.log('PASS', name); } catch (e) { console.log('FAIL', name, e.message); errors.push(name + ': ' + e.message); } };

await page.goto('http://app.test/');
await step('login page shows shop name', async () => { await page.locator('img[alt="Test Grocery"]').first().waitFor({ timeout: 8000 }); });
await page.screenshot({ path: 'tests/screens/login.png' });
await step('login logo is centred in its panel', async () => {
  const off = await page.evaluate(() => { const i = document.querySelector('.auth-brand img').getBoundingClientRect(), p = document.querySelector('.auth-story').getBoundingClientRect(); return Math.abs((i.left + i.right) / 2 - (p.left + p.right) / 2); });
  if (off > 8) throw new Error('login logo is ' + Math.round(off) + 'px off centre');
});
await step('sign in lands on the Dashboard; menu is short', async () => {
  await page.fill('#login-email', 'owner@shop.test');
  await page.fill('#login-password', 'secret123');
  await page.click('button[type=submit]');
  await page.getByText('Executive dashboard').first().waitFor({ timeout: 8000 });
  const labels = await page.$$eval('.sidebar nav .nav-link', a => a.map(x => x.textContent.trim()));
  for (const gone of ['Home', 'Import data', 'Count stock']) if (labels.includes(gone)) throw new Error(gone + ' should not be in the menu');
  for (const want of ['Dashboard', 'Close day', 'Settings']) if (!labels.includes(want)) throw new Error(want + ' missing from menu: ' + labels.join(','));
});
await page.screenshot({ path: 'tests/screens/home.png' });
for (const [route, text] of [['products', 'Stock value'], ['customers', 'Total owed to you'], ['buy', 'items to buy'], ['count', 'Start a stock count'], ['reports', 'Best sellers'], ['accounts', 'Trial balance'], ['staff', 'What each role can do'], ['settings', 'Receipt preview'], ['import', 'Recommended order']]) {
  await step('view ' + route, async () => { await page.goto('http://app.test/#/' + route); await page.getByText(text).first().waitFor({ timeout: 8000 }); await page.screenshot({ path: `tests/screens/${route}.png`, fullPage: true }); });
}
await step('buy tabs render', async () => {
  for (const tab of ['Record a purchase', 'Supplier bills', 'Orders', 'Suppliers']) { await page.goto('http://app.test/#/buy'); await page.getByRole('tab', { name: tab }).click(); await page.waitForTimeout(300); }
});
await step('sell: scan barcode, add weight item, checkout', async () => {
  await page.goto('http://app.test/#/sell');
  await page.getByText('Sugar 1kg').first().waitFor();
  await page.fill('.pos-search input', '6001');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: /Rice/ }).click();
  await page.fill('.modal input', '1.5');
  await page.keyboard.press('Enter');
  await page.getByText('Complete sale ·').waitFor();
  await page.fill('.tender-row input', '20000');
  await page.screenshot({ path: 'tests/screens/sell.png' });
  await page.click('.pos-cart .primary.big');
  await page.getByText('Sale complete').waitFor({ timeout: 8000 });
  const call = calls.find(c => c.startsWith('complete_sale'));
  const body = JSON.parse(call.slice('complete_sale '.length));
  if (body.p_items.length !== 2 || body.p_items.find(i => i.product_id === 'p2').quantity !== 1.5) throw new Error('bad items ' + call);
  await page.screenshot({ path: 'tests/screens/sale-done.png' });
});
await step('import: Loyverse items CSV preview and run', async () => {
  await page.keyboard.press('Escape');
  await page.goto('http://app.test/#/import');
  await page.getByText('Recommended order').waitFor();
  const csv = 'Handle,SKU,Name,Category,Sold by weight,Cost,Barcode,Track stock,Available for sale [Shop],Price [Shop],In stock [Shop],Low stock [Shop]\nsoap,1,Bar Soap,Care,N,1500,,Y,Y,2000,10,2\nmilk,2,Milk 500ml,Dairy,N,1200,,Y,Y,1500,0,5\n';
  await page.locator('input[type=file]').first().setInputFiles({ name: 'export_items.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByText('Products from export_items.csv').waitFor();
  await page.check('#opening-stock');
  await page.getByRole('button', { name: 'Import products' }).click();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByText('Import finished').waitFor({ timeout: 8000 });
  await page.screenshot({ path: 'tests/screens/import-done.png' });
});
await step('inventory: all tabs render', async () => {
  await page.goto('http://app.test/#/inventory');
  await page.getByText('Needs attention').first().waitFor({ timeout: 8000 });
  await page.getByText('Sugar 1kg').first().waitFor();
  await page.screenshot({ path: 'tests/screens/inventory.png', fullPage: true });
  for (const [tab, text] of [['History', 'Stock out (cost)'], ['Valuation', 'Most valuable stock'], ['Supplier returns', 'Return goods to a supplier'], ['Labels', 'Print price & barcode labels'], ['Adjust stock', 'Recent adjustments']]) {
    await page.getByRole('tab', { name: tab }).click();
    await page.getByText(text).first().waitFor({ timeout: 8000 });
    await page.screenshot({ path: `tests/screens/inventory-${tab.split(' ')[0].toLowerCase()}.png`, fullPage: true });
  }
});
await step('inventory: adjust stock sends the right lines', async () => {
  await page.selectOption('select[aria-label=Reason]', 'damaged');
  await page.fill('input[aria-label=Product]', 'SUG1');
  await page.keyboard.press('Enter');
  await page.fill('input[aria-label="Quantity for Sugar 1kg"]', '2');
  await page.getByRole('button', { name: 'Save adjustment' }).click();
  await page.locator('.modal').getByRole('button', { name: 'Save adjustment' }).click();
  await page.getByText('ADJ-000001 saved').waitFor({ timeout: 8000 });
  const call = calls.find(c => c.startsWith('adjust_stock'));
  const body = JSON.parse(call.slice('adjust_stock '.length));
  if (body.p_reason !== 'damaged' || body.p_items[0].quantity_delta !== -2 || body.p_items[0].product_id !== 'p1') throw new Error('bad adjust ' + call);
});
await step('inventory: label preview has a barcode', async () => {
  await page.getByRole('tab', { name: 'Labels' }).click();
  await page.fill('input[aria-label=Product]', '6001');
  await page.keyboard.press('Enter');
  await page.locator('.label-preview svg.barcode').waitFor({ timeout: 5000 });
  await page.screenshot({ path: 'tests/screens/inventory-labels.png' });
});
await step('reports: sales by item', async () => {
  await page.goto('http://app.test/#/reports');
  await page.getByText('Sales by item').waitFor({ timeout: 8000 });
});
await step('executive dashboard renders with live data', async () => {
  await page.goto('http://app.test/#/executive');
  await page.getByText('Who this shop serves').waitFor({ timeout: 8000 });
  await page.getByText('Financial position').waitFor();
  await page.getByText('Hon. Dr. Betty Udongo Pacutho').first().waitFor();
  await page.locator('.kpi').first().waitFor();
  const spill = await page.evaluate(() => [...document.querySelectorAll('.rank-row')].filter(r => { const c = r.closest('section, .panel, .card, .exec-panel') || r.parentElement; return r.getBoundingClientRect().right > c.getBoundingClientRect().right + 1; }).length);
  if (spill) throw new Error(spill + ' ranked rows spill out of their card');
  await page.screenshot({ path: 'tests/screens/executive.png', fullPage: true });
  await page.getByRole('tab', { name: 'Today' }).click();
  await page.getByText('Sales by hour today').waitFor({ timeout: 8000 });
});
await step('layout lock: borders movable by default, owner can lock', async () => {
  await page.goto('http://app.test/#/sell');
  await page.locator('.pos-resizer').waitFor();
  if (await page.evaluate(() => document.body.classList.contains('layout-locked'))) throw new Error('should be movable by default');
  const side = await page.evaluate(() => { const p = document.querySelector('.pos-products').getBoundingClientRect(), c = document.querySelector('.pos-cart').getBoundingClientRect(); return c.left >= p.right; });
  if (!side) throw new Error('sale column is not beside the products');
  await page.goto('http://app.test/#/settings');
  await page.getByText("This till's layout").waitFor();
  await page.getByLabel('Lock layout').check();
  if (!(await page.evaluate(() => document.body.classList.contains('layout-locked')))) throw new Error('did not lock');
  await page.getByLabel('Lock layout').uncheck();
  if (await page.locator('.sidebar-resizer').count()) throw new Error('menu border should be gone');
});
await step('close day: count drawer, see difference, day report', async () => {
  await page.goto('http://app.test/#/close');
  await page.getByText('Count my drawer').waitFor({ timeout: 8000 });
  await page.getByLabel('Cash counted now').fill('34000');
  const diff = await page.locator('.cashup-result strong').nth(1).textContent();
  if (!/Short/.test(diff)) throw new Error('difference not shown: ' + diff);
  await page.getByText('Send on WhatsApp').waitFor();
  await page.screenshot({ path: 'tests/screens/close-day.png', fullPage: true });
});
await step('reports: return items dialog', async () => {
  await page.goto('http://app.test/#/reports');
  await page.getByRole('button', { name: 'Return', exact: true }).first().click();
  await page.getByText('Refund selected').waitFor({ timeout: 5000 });
  await page.keyboard.press('Escape');
});
await step('accounts: owner money tab', async () => {
  await page.goto('http://app.test/#/accounts');
  await page.getByRole('tab', { name: 'Owner money' }).click();
  await page.getByText('MOV-00001').waitFor({ timeout: 5000 });
});
await step('settings: backup button; offline banner', async () => {
  await page.goto('http://app.test/#/settings');
  await page.getByRole('button', { name: 'Download backup' }).waitFor();
  await page.waitForTimeout(600);
  const cut = await page.evaluate(() => { const f = document.querySelector('.receipt-preview'); const d = f.contentDocument; const b = d.body.getBoundingClientRect(); const wide = Math.max(...[...d.body.querySelectorAll('*')].map(e => e.getBoundingClientRect().right)); return { right: Math.round(Math.max(b.right, wide)), width: f.clientWidth, docH: Math.round(b.height), frameH: f.clientHeight }; });
  if (cut.right > cut.width + 1) throw new Error('receipt preview is cut off on the right: ' + JSON.stringify(cut));
  if (cut.frameH + 2 < cut.docH) throw new Error('receipt preview is cut off at the bottom: ' + JSON.stringify(cut));
  await page.getByText('Loyverse live sync').waitFor();
  await page.getByText('new sales 4').waitFor();
  await page.getByRole('button', { name: 'Turn on instant sync' }).waitFor();
  await page.getByRole('button', { name: 'Send shopping list now' }).waitFor();
  await page.context().setOffline(true);
  await page.locator('.offline-bar').waitFor({ timeout: 3000 });
  await page.context().setOffline(false);
  await page.waitForTimeout(300);
  if (await page.locator('.offline-bar').count()) throw new Error('offline banner did not clear');
});
await step('mobile layout has no horizontal scroll', async () => {
  await page.setViewportSize({ width: 375, height: 800 });
  for (const r of ['executive', 'sell', 'close', 'products', 'buy', 'inventory']) {
    await page.goto('http://app.test/#/' + r); await page.waitForTimeout(500);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (over > 1) { const who = await page.evaluate(() => [...document.querySelectorAll('main *')].filter(e => e.getBoundingClientRect().right > window.innerWidth + 1).slice(0, 6).map(e => e.tagName + '.' + e.className).join(' | ')); throw new Error(r + ' overflows by ' + over + 'px: ' + who); }
  }
  await page.goto('http://app.test/#/sell'); await page.waitForTimeout(500);
  await page.screenshot({ path: 'tests/screens/mobile-sell.png', fullPage: true });
  const off = await page.evaluate(() => { const l = document.querySelector('.brand-logo-top').getBoundingClientRect(); return Math.abs((l.left + l.right) / 2 - window.innerWidth / 2); });
  if (off > 6) throw new Error('top-bar logo is ' + off + 'px off centre');
});

await browser.close();
const real = errors.filter(e => !/Failed to load resource|WebSocket connection/.test(e));
console.log(real.length ? '\nERRORS:\n' + real.join('\n') : '\nSMOKE TEST PASSED');
process.exit(real.length ? 1 : 0);
