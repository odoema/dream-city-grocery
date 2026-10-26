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
const settings = { id: true, business_name: 'Test Grocery', tagline: 'Fresh daily', logo_url: null, primary_color: '#176B45', currency_code: 'UGX', currency_decimals: 0, locale: 'en-UG', timezone: 'Africa/Kampala', receipt_prefix: 'TG', receipt_footer: 'Thanks', receipt_width: '80mm', stock_cover_days: 5, allow_cashier_discounts: false, setup_completed: true, phone: '', email: '', address: '', tax_id: '', receipt_header: '' };
const calls = [];
const summary = { scope: 'shop', transactions: 3, gross_sales: 15000, discounts: 0, net_sales: 15000, cost_of_goods: 12000, gross_profit: 3000, refunds: 0, refund_count: 0, average_sale: 5000, by_payment: [{ method: 'cash', count: 3, total: 15000 }], by_day: [{ day: now.slice(0, 10), count: 3, total: 15000, profit: 3000 }], by_hour: [], top_products: [{ product_id: 'p1', name: 'Sugar 1kg', sku: 'SUG1', quantity: 3, revenue: 15000, profit: 2400 }], by_cashier: [{ cashier_id: uid, name: 'Owner', count: 3, total: 15000 }] };
const fin = { trial_balance: [{ code: '1000', name: 'Cash', type: 'asset', debit: 15000, credit: 0 }, { code: '4000', name: 'Sales Revenue', type: 'revenue', debit: 0, credit: 15000 }], profit_and_loss: { revenue: 15000, discounts_returns: 0, net_revenue: 15000, cost_of_goods: 0, gross_profit: 15000, operating_expenses: 0, net_profit: 15000, lines: [] }, balance_sheet: { assets: [{ code: '1000', name: 'Cash', amount: 15000 }], liabilities: [], equity: [], retained_earnings: 15000, total_assets: 15000, total_liabilities_equity: 15000 } };

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
    case 'inventory_movements': return [];
    default: return [];
  }
}

function rpc(name) {
  switch (name) {
    case 'get_public_store_profile': return { business_name: 'Test Grocery', tagline: 'Fresh daily', setup_completed: true, has_owner: true, primary_color: '#176B45' };
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
await step('login page shows shop name', async () => { await page.getByText('Test Grocery').first().waitFor({ timeout: 8000 }); });
await page.screenshot({ path: 'tests/screens/login.png' });
await step('sign in reaches home', async () => {
  await page.fill('#login-email', 'owner@shop.test');
  await page.fill('#login-password', 'secret123');
  await page.click('button[type=submit]');
  await page.getByText("Today's sales").waitFor({ timeout: 8000 });
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
await step('mobile layout has no horizontal scroll', async () => {
  await page.setViewportSize({ width: 375, height: 800 });
  for (const r of ['home', 'sell', 'products', 'buy']) {
    await page.goto('http://app.test/#/' + r); await page.waitForTimeout(500);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (over > 1) throw new Error(r + ' overflows by ' + over + 'px');
  }
  await page.goto('http://app.test/#/sell'); await page.waitForTimeout(500);
  await page.screenshot({ path: 'tests/screens/mobile-sell.png', fullPage: true });
});

await browser.close();
const real = errors.filter(e => !/Failed to load resource/.test(e));
console.log(real.length ? '\nERRORS:\n' + real.join('\n') : '\nSMOKE TEST PASSED');
process.exit(real.length ? 1 : 0);
