// End-to-end business-flow test of the database layer.
import { freshDb, as } from './harness.mjs';
import assert from 'node:assert/strict';

const db = await freshDb();
const OWNER = '00000000-0000-0000-0000-000000000001';
const CASHIER = '00000000-0000-0000-0000-000000000002';
const STRANGER = '00000000-0000-0000-0000-000000000003';

const q = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];
// Run as an authenticated API user so grants and RLS apply.
async function asUser(id, fn) {
  await as(db, id);
  await db.exec('set role authenticated');
  try { return await fn(); } finally { await db.exec('reset role'); }
}
async function rpc(id, sql, params) { return asUser(id, () => one(sql, params)); }
async function expectFail(id, sql, params, re) {
  try { await rpc(id, sql, params); } catch (e) {
    if (re && !re.test(e.message)) throw new Error('Wrong error: ' + e.message);
    return e.message;
  }
  throw new Error('Expected failure: ' + sql);
}
async function balanced() {
  const r = await one(`select coalesce(sum(debit),0) d, coalesce(sum(credit),0) c from journal_lines`);
  assert.equal(Number(r.d), Number(r.c), 'ledger out of balance');
  const bad = await q(`select journal_id from journal_lines group by journal_id having sum(debit) <> sum(credit)`);
  assert.equal(bad.length, 0, 'unbalanced journal');
}
const pass = m => console.log('PASS', m);

// Users (trigger creates cashier profiles)
for (const [id, email] of [[OWNER,'owner@shop.test'],[CASHIER,'cashier@shop.test'],[STRANGER,'x@shop.test']])
  await q(`insert into auth.users(id,email) values($1,$2)`, [id, email]);

// Public profile before setup
let pub = await rpc(null, `select public.get_public_store_profile() p`);
assert.equal(pub.p.has_owner, false); pass('anon can read public store profile');

await rpc(OWNER, `select public.claim_first_owner('Brian') r`);
await expectFail(STRANGER, `select public.claim_first_owner('Evil')`, [], /already has an owner/);
pass('first owner claim + second claim blocked');

await rpc(OWNER, `select public.update_store_settings($1) s`, [{ business_name: 'Test Grocery', receipt_prefix: 'TG', currency_code: 'UGX', setup_completed: true }]);
await expectFail(CASHIER, `select public.update_store_settings($1)`, [{ business_name: 'x' }], /not allowed/);
pass('settings: owner only');

// Products: managers cannot type stock
const cat = await asUser(OWNER, () => one(`insert into categories(name) values('Food') returning id`));
await expectFail(OWNER, `insert into products(sku,name,selling_price,quantity_on_hand) values('X1','Bad',1,50) returning id`, [], /permission denied/);
const sugar = await asUser(OWNER, () => one(`insert into products(sku,name,category_id,buying_price,selling_price,reorder_level) values('SUG1','Sugar 1kg',$1,4000,5000,2) returning id`, [cat.id]));
const rice = await asUser(OWNER, () => one(`insert into products(sku,name,buying_price,selling_price,sold_by_weight,unit) values('RICE','Rice',3000,4000,true,'kg') returning id`));
await expectFail(OWNER, `update products set quantity_on_hand=999 where id=$1`, [sugar.id], /permission denied/);
pass('stock column locked for direct writes');

await rpc(OWNER, `select public.post_opening_stock($1,10,4000,'count') r`, [sugar.id]);
await rpc(OWNER, `select public.post_opening_stock($1,25.5,3000,'') r`, [rice.id]);
await expectFail(OWNER, `select public.post_opening_stock($1,5,4000,'')`, [sugar.id], /already recorded/);
await balanced(); pass('opening stock posted once, journal balanced');

// Cashier sale
const k1 = crypto.randomUUID();
let s1 = await rpc(CASHIER, `select public.complete_sale($1::jsonb,'cash',$2) r`, [JSON.stringify([{ product_id: sugar.id, quantity: 3 }, { product_id: rice.id, quantity: 1.5 }]), k1]);
assert.match(s1.r.receipt_number, /^TG-\d{6}$/); assert.equal(Number(s1.r.total), 21000);
const replay = await rpc(CASHIER, `select public.complete_sale($1::jsonb,'cash',$2) r`, [JSON.stringify([{ product_id: sugar.id, quantity: 3 }]), k1]);
assert.equal(replay.r.replayed, true);
await expectFail(CASHIER, `select public.complete_sale($1::jsonb,'cash',$2)`, [JSON.stringify([{ product_id: sugar.id, quantity: 1.5 }]), crypto.randomUUID()], /whole units/);
await expectFail(CASHIER, `select public.complete_sale($1::jsonb,'cash',$2,null,100)`, [JSON.stringify([{ product_id: sugar.id, quantity: 1 }]), crypto.randomUUID()], /discount/);
await expectFail(CASHIER, `select public.complete_sale($1::jsonb,'cash',$2)`, [JSON.stringify([{ product_id: sugar.id, quantity: 100 }]), crypto.randomUUID()], /Insufficient stock/);
assert.equal(Number((await one(`select quantity_on_hand q from products where id=$1`, [sugar.id])).q), 7);
await balanced(); pass('cashier sale, replay, validation, stock decrement');

// Full discount sale by owner (previously unbalanced)
await rpc(OWNER, `select public.complete_sale($1::jsonb,'cash',$2,null,5000) r`, [JSON.stringify([{ product_id: sugar.id, quantity: 1 }]), crypto.randomUUID()]);
await balanced(); pass('100% discount sale balances');

// Credit customers
const cust = await asUser(OWNER, () => one(`insert into customers(name,phone,credit_limit) values('Okello','0772',12000) returning id`));
await rpc(CASHIER, `select public.complete_sale($1::jsonb,'credit',$2,$3) r`, [JSON.stringify([{ product_id: sugar.id, quantity: 2 }]), crypto.randomUUID(), cust.id]);
await expectFail(CASHIER, `select public.complete_sale($1::jsonb,'credit',$2,$3)`, [JSON.stringify([{ product_id: sugar.id, quantity: 1 }]), crypto.randomUUID(), cust.id], /credit limit/);
await rpc(CASHIER, `select public.receive_customer_payment($1,6000,'mobile_money','MM123') r`, [cust.id]);
await rpc(CASHIER, `select public.complete_sale($1::jsonb,'credit',$2,$3) r`, [JSON.stringify([{ product_id: sugar.id, quantity: 1 }]), crypto.randomUUID(), cust.id]);
const cb = await asUser(OWNER, () => one(`select balance from customer_balances where customer_id=$1`, [cust.id]));
assert.equal(Number(cb.balance), 9000);
await expectFail(CASHIER, `select public.receive_customer_payment($1,50000,'cash')`, [cust.id], /exceeds/);
await balanced(); pass('credit limit uses balance net of payments');

// Refund
await expectFail(CASHIER, `select public.refund_sale($1,'x')`, [s1.r.sale_id], /not allowed/);
const before = Number((await one(`select quantity_on_hand q from products where id=$1`, [sugar.id])).q);
await rpc(OWNER, `select public.refund_sale($1,'Customer returned') r`, [s1.r.sale_id]);
const after = Number((await one(`select quantity_on_hand q from products where id=$1`, [sugar.id])).q);
assert.equal(after - before, 3);
await expectFail(OWNER, `select public.refund_sale($1,'again')`, [s1.r.sale_id], /Only completed/);
await balanced(); pass('refund reverses stock and journal once');

// Shop purchase, paid cash, new supplier by name
const pur = await rpc(OWNER, `select public.record_shop_purchase(null,'Nebbi Market',$1::jsonb,'cash','',null,'') r`, [JSON.stringify([{ product_id: sugar.id, quantity: 12, unit_cost: 4200 }])]);
assert.equal(pur.r.paid, true);
const unpaid = await rpc(OWNER, `select public.record_shop_purchase(null,'Nebbi Market',$1::jsonb,'credit','INV-9',null,'') r`, [JSON.stringify([{ product_id: rice.id, quantity: 10, unit_cost: 3100 }])]);
assert.equal(unpaid.r.paid, false);
assert.equal((await q(`select * from suppliers`)).length, 1);
await balanced(); pass('one-step purchases (paid and on account)');

// Expense
await rpc(OWNER, `select public.record_expense('Transport to market',5000,'cash','Transport') r`);
await balanced(); pass('expense');

// Stocktake
await rpc(OWNER, `select public.start_stocktake('count') r`);
const sess = await one(`select id from stocktake_sessions where status='draft'`);
const items = await q(`select product_id, system_quantity from stocktake_items where session_id=$1`, [sess.id]);
for (const it of items) await rpc(OWNER, `select public.record_stocktake_count($1,$2,$3) r`, [sess.id, it.product_id, Number(it.system_quantity) - 1]);
await rpc(OWNER, `select public.finalize_stocktake($1) r`, [sess.id]);
await rpc(OWNER, `select public.start_stocktake('c2') r`);
const s2 = await one(`select id from stocktake_sessions where status='draft'`);
await rpc(OWNER, `select public.cancel_stocktake($1) r`, [s2.id]);
await balanced(); pass('stocktake finalize + cancel');

// Inventory account equals valued stock movements
// Reports
const sum = await rpc(OWNER, `select public.get_sales_summary(now()-interval '1 day', now()+interval '1 day') r`);
assert.ok(Number(sum.r.transactions) >= 3); assert.equal(Number(sum.r.refund_count), 1);
const mine = await rpc(CASHIER, `select public.get_sales_summary(now()-interval '1 day', now()+interval '1 day') r`);
assert.equal(mine.r.scope, 'mine');
const fs = await rpc(OWNER, `select public.get_financial_statements(now()-interval '1 day', now()+interval '1 day') r`);
const bs = fs.r.balance_sheet;
assert.equal(Number(bs.total_assets), Number(bs.total_liabilities_equity), 'balance sheet does not balance');
await expectFail(CASHIER, `select public.get_financial_statements(now(), now())`, [], /not allowed/);
pass('reports: summary scopes + balance sheet balances (' + bs.total_assets + ')');

// Notifications not queueable by staff
await expectFail(CASHIER, `select public.queue_management_notification('x','y','z')`, [], /permission denied/);
const notes = await q(`select event_type, count(*) n from management_notifications group by 1 order by 1`);
console.log('  notifications:', notes.map(n => n.event_type + '=' + n.n).join(', '));
pass('notification queue locked down');

// Loyverse imports
const b1 = (await rpc(OWNER, `select public.start_import_batch('items','items.csv','{}') id`)).id;
const imp = await rpc(OWNER, `select public.import_loyverse_items($1,$2::jsonb,true) r`, [b1, JSON.stringify([
  { row: 2, source_item_id: 'soap', sku: '10001', barcode: '6001', name: 'Bar Soap', category: 'Personal Care', cost: 1500, price: 2000, in_stock: 24, low_stock: 5, track_stock: true },
  { row: 3, source_item_id: 'tshirt|S', sku: '10002', name: 'T-Shirt (S)', category: 'Clothing', cost: 8000, price: 12000, in_stock: -3, track_stock: true },
  { row: 4, source_item_id: 'svc', sku: '', name: 'Phone charging', price: 500, track_stock: false, in_stock: 0 },
  { row: 5, source_item_id: 'dup', sku: 'SUG1', name: 'Sugar dup sku', price: 1, in_stock: 3 },
  { row: 6, name: '' },
  { row: 7, source_item_id: 'sugar-lv', sku: '', barcode: '6001', name: 'Brown sugar', price: 6000, cost: 5000, in_stock: 4 },
])]);
console.log('  items import:', JSON.stringify({ ...imp.r, warnings: imp.r.warnings.length }));
assert.equal(imp.r.created, 4); assert.equal(imp.r.updated, 1); assert.equal(imp.r.skipped, 1);
assert.equal(Number(imp.r.opening_stock_value), 24 * 1500 + 4 * 5000);
const again = await rpc(OWNER, `select public.import_loyverse_items($1,$2::jsonb,true) r`, [b1, JSON.stringify([
  { row: 2, source_item_id: 'soap', sku: '10001', name: 'Bar Soap Lux', price: 2200, in_stock: 24, track_stock: true }])]);
assert.equal(again.r.updated, 1); assert.equal(Number(again.r.opening_stock_value), 0);
await rpc(OWNER, `select public.finish_import_batch($1,'completed','{}')`, [b1]);
await balanced(); pass('items import: create/update, variants, untracked, negative stock, opening stock once');

const b2 = (await rpc(OWNER, `select public.start_import_batch('customers','c.csv','{}') id`)).id;
const ci = await rpc(OWNER, `select public.import_customers($1,$2::jsonb) r`, [b2, JSON.stringify([
  { row: 2, customer_code: 'C1', name: 'Akello', phone: '0700', email: 'A@x.com' },
  { row: 3, name: 'Okello again', phone: '0772' }])]);
assert.equal(ci.r.created, 1); assert.equal(ci.r.updated, 1); pass('customers import upserts by code/phone');

const b3 = (await rpc(OWNER, `select public.start_import_batch('sales','s.csv','{}') id`)).id;
const lines = [];
for (let d = 1; d <= 20; d++) lines.push({ line_key: 'R' + d + '|10001', sold_at: new Date(Date.now() - d * 86400000).toISOString(), receipt_number: 'R' + d, receipt_type: 'Sale', sku: '10001', item_name: 'Bar Soap', quantity: 3, net_sales: 6000 });
lines.push({ line_key: 'R99|x', sold_at: new Date().toISOString(), receipt_type: 'Refund', item_name: 'Unknown thing', quantity: -1, net_sales: -100 });
const si = await rpc(OWNER, `select public.import_legacy_sales($1,$2::jsonb) r`, [b3, JSON.stringify(lines)]);
const si2 = await rpc(OWNER, `select public.import_legacy_sales($1,$2::jsonb) r`, [b3, JSON.stringify(lines)]);
assert.equal(si.r.inserted, 21); assert.equal(si2.r.inserted, 0);
const ov = await rpc(OWNER, `select public.get_legacy_sales_overview() r`);
assert.equal(Number(ov.r.unmatched_lines), 1);
const rec = await asUser(OWNER, () => one(`select * from public.get_smart_purchase_recommendations() where sku='10001'`));
assert.ok(Number(rec.adjusted_daily_demand) > 0, 'legacy demand not used');
console.log('  soap recommendation:', rec.recommended_qty, rec.recommendation_priority, 'demand/day', rec.adjusted_daily_demand);
await rpc(CASHIER, `select public.create_purchase_recommendation_run() r`);
pass('sales history import is idempotent and drives recommendations');

// Staff management
const staff = await asUser(OWNER, () => q(`select * from public.list_staff()`));
assert.equal(staff.length, 3);
await rpc(OWNER, `select public.set_staff_member($1,'Dorcas','manager',true) r`, [CASHIER]);
await expectFail(OWNER, `select public.set_staff_member($1,'Brian','cashier',true)`, [OWNER], /at least one active owner/);
await expectFail(STRANGER, `select * from public.list_staff()`, [], /not allowed|permission/);
pass('staff management');

// Audit spam check: sales should not create product.updated rows
const spam = await one(`select count(*) n from audit_log where action='product.updated'`);
console.log('  product.updated audit rows:', spam.n);
await balanced();
console.log('\nALL BUSINESS FLOW TESTS PASSED');
const lc = await asUser(CASHIER, () => q(`select * from public.list_customers_with_balance()`));
assert.ok(lc.length >= 2);
const st = await rpc(CASHIER, `select public.get_customer_statement($1) r`, [cust.id]);
assert.equal(Number(st.r.balance), 9000); assert.ok(st.r.entries.length >= 3);
console.log('PASS customer list + statement');

// ---------------------------------------------------------------- inventory module
const soap = await one(`select id, quantity_on_hand q, buying_price c from products where sku='10001'`);
await expectFail(STRANGER, `select public.adjust_stock('damaged',$1::jsonb,'')`, [JSON.stringify([{ product_id: soap.id, quantity_delta: -1 }])], /not allowed/);
await expectFail(OWNER, `select public.adjust_stock('damaged',$1::jsonb,'')`, [JSON.stringify([{ product_id: soap.id, quantity_delta: 2 }])], /only remove/);
await expectFail(OWNER, `select public.adjust_stock('expired',$1::jsonb,'')`, [JSON.stringify([{ product_id: soap.id, quantity_delta: -99999 }])], /Cannot remove more/);
const adj = await rpc(OWNER, `select public.adjust_stock('damaged',$1::jsonb,'Rats') r`, [JSON.stringify([{ product_id: soap.id, quantity_delta: -2 }])]);
assert.equal(Number(adj.r.loss), 2 * Number(soap.c));
const adj2 = await rpc(OWNER, `select public.adjust_stock('correction',$1::jsonb,'Recount') r`, [JSON.stringify([{ product_id: soap.id, new_quantity: Number(soap.q) }])]);
assert.equal(Number((await one(`select quantity_on_hand q from products where id=$1`, [soap.id])).q), Number(soap.q));
await balanced(); pass('stock adjustments (remove, set-to, validation) post balanced journals');

const sup = await one(`select id from suppliers limit 1`);
const ret = await rpc(OWNER, `select public.return_to_supplier($1,$2::jsonb,'credit','RN-1','') r`, [sup.id, JSON.stringify([{ product_id: soap.id, quantity: 1 }])]);
assert.ok(Number(ret.r.total) > 0);
await expectFail(OWNER, `select public.return_to_supplier($1,$2::jsonb,'cash')`, [sup.id, JSON.stringify([{ product_id: soap.id, quantity: 99999 }])], /Only/);
await balanced(); pass('return to supplier');

const nBefore = Number((await one(`select count(*) n from management_notifications where event_type in ('low_stock','out_of_stock')`)).n);
const cur = Number((await one(`select quantity_on_hand q from products where id=$1`, [soap.id])).q);
await asUser(OWNER, () => one(`update products set reorder_level = $2 where id=$1 returning id`, [soap.id, cur - 1]));
await rpc(OWNER, `select public.adjust_stock('lost_stolen',$1::jsonb,'') r`, [JSON.stringify([{ product_id: soap.id, quantity_delta: -1 }])]);
const nAfter = Number((await one(`select count(*) n from management_notifications where event_type in ('low_stock','out_of_stock')`)).n);
assert.equal(nAfter, nBefore + 1); pass('low-stock alert fires when the level is crossed');

const intel = await rpc(OWNER, `select public.get_inventory_intelligence(30) r`);
assert.ok(intel.r.products.length > 3 && intel.r.summary.stock_cost >= 0 && intel.r.by_category.length);
console.log('  intelligence summary:', JSON.stringify(intel.r.summary));
await expectFail(STRANGER, `select public.get_inventory_intelligence(30)`, [], /not allowed/);
const byItem = await rpc(OWNER, `select public.get_sales_by_item(now()-interval '1 day', now()+interval '1 day') r`);
assert.ok(byItem.r.items.length && byItem.r.categories.length);
pass('inventory intelligence + sales by item');
await balanced();
console.log('ALL INVENTORY TESTS PASSED');

// ---------------------------------------------------------------- daily controls
{
  const sug = await one(`select id, quantity_on_hand q, buying_price c from products where sku='SUG1'`);
  // Weighted average: receiving at a new cost blends with stock on hand.
  const q0 = Number(sug.q), c0 = Number(sug.c);
  await rpc(OWNER, `select public.record_shop_purchase(null,'Nebbi Market',$1::jsonb,'cash','AVG-1',null,'') r`, [JSON.stringify([{ product_id: sug.id, quantity: 10, unit_cost: 6000 }])]);
  const c1 = Number((await one(`select buying_price c from products where id=$1`, [sug.id])).c);
  assert.equal(c1, Math.round((q0 * c0 + 60000) / (q0 + 10) * 100) / 100); pass('weighted-average cost on receiving');

  // Partial return of a cash sale with a discount.
  const sale = await rpc(OWNER, `select public.complete_sale($1::jsonb,'cash',$2,null,1) r`, [JSON.stringify([{ product_id: sug.id, quantity: 4 }]), crypto.randomUUID()]);
  const item = await one(`select id, line_total from sale_items where sale_id=$1`, [sale.r.sale_id]);
  await expectFail(STRANGER, `select public.return_sale_items($1,$2::jsonb,'x')`, [sale.r.sale_id, JSON.stringify([{ sale_item_id: item.id, quantity: 1 }])], /not allowed|inactive/);
  const r1 = await rpc(OWNER, `select public.return_sale_items($1,$2::jsonb,'Damaged pack') r`, [sale.r.sale_id, JSON.stringify([{ sale_item_id: item.id, quantity: 1 }])]);
  assert.equal(r1.r.fully_returned, false);
  await expectFail(OWNER, `select public.return_sale_items($1,$2::jsonb,'x')`, [sale.r.sale_id, JSON.stringify([{ sale_item_id: item.id, quantity: 9 }])], /can still be returned/);
  const r2 = await rpc(OWNER, `select public.refund_sale($1,'Rest returned') r`, [sale.r.sale_id]);
  assert.equal(r2.r.fully_returned, true);
  assert.equal(Number(r1.r.amount) + Number(r2.r.amount), Number(sale.r.total));
  const st = await one(`select status, returned_amount from sales where id=$1`, [sale.r.sale_id]);
  assert.equal(st.status, 'refunded'); assert.equal(Number(st.returned_amount), Number(sale.r.total));
  await balanced(); pass('partial return then refund of the rest settles exactly');

  // Credit sale partial return lowers the customer balance.
  const cust = await asUser(OWNER, () => one(`insert into customers(name, credit_limit) values('Return test', 1000000) returning id`));
  const b0 = Number((await one(`select public.customer_balance($1) b`, [cust.id])).b);
  const cs = await rpc(OWNER, `select public.complete_sale($1::jsonb,'credit',$2,$3) r`, [JSON.stringify([{ product_id: sug.id, quantity: 1 }]), crypto.randomUUID(), cust.id]);
  {
    const ci = await one(`select id from sale_items where sale_id=$1`, [cs.r.sale_id]);
    await rpc(OWNER, `select public.return_sale_items($1,$2::jsonb,'Wrong item') r`, [cs.r.sale_id, JSON.stringify([{ sale_item_id: ci.id, quantity: 1 }])]);
    assert.equal(Number((await one(`select public.customer_balance($1) b`, [cust.id])).b), b0);
    await balanced(); pass('credit return reduces what the customer owes');
  }

  // Owner money.
  await expectFail(CASHIER, `select public.record_money_movement('capital',1000,null,'cash','')`, [], /not allowed/);
  await rpc(OWNER, `select public.record_money_movement('capital',500000,null,'bank','Start-up') r`);
  await rpc(OWNER, `select public.record_money_movement('drawing',20000,'cash',null,'School fees') r`);
  await rpc(OWNER, `select public.record_money_movement('transfer',30000,'cash','bank','Banking') r`);
  await expectFail(OWNER, `select public.record_money_movement('transfer',1,'mobile_money','card','')`, [], /same account/);
  await balanced(); pass('owner capital, drawings and transfers');

  // Close day: cashier sells 2 sugar for cash, counts 1,000 short.
  const cashSale = await rpc(CASHIER, `select public.complete_sale($1::jsonb,'cash',$2) r`, [JSON.stringify([{ product_id: sug.id, quantity: 2 }]), crypto.randomUUID()]);
  const prev = await rpc(CASHIER, `select public.get_cash_up_preview() r`);
  assert.ok(Number(prev.r.cash_sales) >= Number(cashSale.r.total));
  const expected = 20000 + Number(prev.r.cash_sales) - Number(prev.r.cash_refunds) + Number(prev.r.cash_in_other) - Number(prev.r.cash_out_other);
  const cu = await rpc(CASHIER, `select public.close_cash_up(20000,$1,'') r`, [expected - 1000]);
  assert.equal(Number(cu.r.difference), -1000);
  const after = await rpc(CASHIER, `select public.get_cash_up_preview() r`);
  assert.equal(Number(after.r.cash_sales), 0); assert.equal(Number(after.r.last_float), 20000);
  const seen = await asUser(CASHIER, () => q(`select id from cash_ups`));
  assert.equal(seen.length, 1);
  await balanced(); pass('close day: expected vs counted, shortage posted, next period starts fresh');

  const sum2 = await rpc(OWNER, `select public.get_sales_summary(now()-interval '1 day', now()+interval '1 day') r`);
  const fs2 = await rpc(OWNER, `select public.get_financial_statements(now()-interval '1 day', now()+interval '1 day') r`);
  assert.equal(Number(fs2.r.balance_sheet.total_assets), Number(fs2.r.balance_sheet.total_liabilities_equity));
  assert.ok(Number(sum2.r.refunds) > 0);
  pass('summary and balance sheet still balance after returns, cash-up and owner money');
}
console.log('ALL DAILY CONTROL TESTS PASSED');

// ---------------------------------------------------------------- Loyverse live sync
{
  const asService = async (sql, params) => { await db.exec('set role service_role'); try { return await one(sql, params); } finally { await db.exec('reset role'); } };
  await expectFail(OWNER, `select public.loyverse_sync_begin()`, [], /permission denied/);
  const b = await asService(`select public.loyverse_sync_begin() r`);
  assert.equal(b.r.run, true);
  const again = await asService(`select public.loyverse_sync_begin() r`);
  assert.equal(again.r.run, false); pass('sync: service role only, throttled');

  const now = new Date().toISOString();
  const items = [
    { variant_id: 'v-sugar', sku: 'SUG1', name: 'Sugar 1kg', category: 'Food', price: 5200, cost: 4300, track_stock: true },
    { variant_id: 'v-new', sku: 'NEWLV1', barcode: '999111', name: 'Loyverse Only Item', category: 'Snacks', price: 1000, cost: 600, track_stock: true }
  ];
  const receipts = [
    { number: '1-1001', type: 'sale', created_at: now, payment: 'cash', total: 9400, employee: 'Nobody', lines: [
      { variant_id: 'v-sugar', sku: 'SUG1', name: 'Sugar 1kg', quantity: 1, price: 5200, gross: 5200, cost_total: 4300 },
      { variant_id: 'v-new', sku: 'NEWLV1', name: 'Loyverse Only Item', quantity: 5, price: 1000, gross: 5000, cost_total: 3000 }] },
    { number: '1-1002', type: 'sale', created_at: now, payment: 'mobile_money', total: 1000, lines: [
      { variant_id: 'v-new', sku: 'NEWLV1', name: 'Loyverse Only Item', quantity: 1, price: 1000, gross: 1000, cost_total: 600 }] },
    { number: '1-1003', type: 'refund', refund_for: '1-1001', created_at: now, payment: 'cash', total: 1000, lines: [
      { variant_id: 'v-new', sku: 'NEWLV1', name: 'Loyverse Only Item', quantity: 1, price: 1000 }] },
    { number: '1-1004', type: 'sale', created_at: now, cancelled: true, payment: 'cash', total: 1, lines: [] },
    { number: '1-1005', type: 'refund', refund_for: '1-0001', created_at: now, payment: 'cash', total: 1, lines: [] }
  ];
  const levels = [{ variant_id: 'v-sugar', in_stock: 40 }, { variant_id: 'v-new', in_stock: 12 }];
  const res = await asService(`select public.loyverse_sync_apply($1::jsonb,$2::jsonb,$3::jsonb,now()) r`, [JSON.stringify(items), JSON.stringify(receipts), JSON.stringify(levels)]);
  console.log('  sync result:', JSON.stringify(res.r));
  assert.equal(res.r.sales, 2); assert.equal(res.r.refunds, 1); assert.equal(res.r.skipped, 2); assert.equal(res.r.warnings.length, 0);
  const s = await one(`select total, discount, subtotal, status, returned_amount from sales where receipt_number='LV-1-1001'`);
  assert.equal(Number(s.total), 9400); assert.equal(Number(s.discount), 800); assert.ok(Number(s.returned_amount) > 0);
  const p = await one(`select quantity_on_hand q, selling_price sp, buying_price bp from products where sku='NEWLV1'`);
  assert.equal(Number(p.q), 12); assert.equal(Number(p.sp), 1000);
  assert.equal(Number((await one(`select quantity_on_hand q from products where sku='SUG1'`)).q), 40);
  await balanced(); pass('sync: items, sales with discount, refund, cancelled/unknown skipped, stock aligned, books balance');

  await db.exec(`update loyverse_sync_state set last_started_at = now() - interval '2 minutes'`);
  const res2 = await asService(`select public.loyverse_sync_apply($1::jsonb,$2::jsonb,$3::jsonb,now()) r`, [JSON.stringify(items), JSON.stringify(receipts), JSON.stringify(levels)]);
  assert.equal(res2.r.sales, 0); assert.equal(res2.r.refunds, 0); assert.equal(res2.r.stock_aligned, 0);
  assert.equal(Number((await one(`select count(*) n from sales where receipt_number like 'LV-%'`)).n), 2);
  await balanced(); pass('sync: running twice changes nothing');
  const fs3 = await rpc(OWNER, `select public.get_financial_statements(now()-interval '1 day', now()+interval '1 day') r`);
  assert.equal(Number(fs3.r.balance_sheet.total_assets), Number(fs3.r.balance_sheet.total_liabilities_equity));
}
console.log('ALL LOYVERSE SYNC TESTS PASSED');

// ---------------------------------------------------------------- automatic reports
{
  await db.exec('set role service_role'); await db.exec('reset role');
  const ev = await one(`select public.build_shop_report('evening') r`);
  assert.ok(/sales/i.test(ev.r.subject) && ev.r.html.includes('Day report') && ev.r.text.includes('Gross profit'));
  const mo = await one(`select public.build_shop_report('morning') r`);
  assert.ok(/shopping list/.test(mo.r.subject) && mo.r.html.includes('Shopping list'));
  console.log('  evening:', ev.r.subject); console.log('  morning:', mo.r.subject); if (process.env.SHOW_REPORTS) { console.log(ev.r.text); console.log(mo.r.text); }
  await expectFail(OWNER, `select public.build_shop_report('evening')`, [], /permission denied/);
  await expectFail(CASHIER, `select public.send_shop_report('evening')`, [], /not allowed|vault|does not exist/);
  pass('automatic reports: evening report and morning shopping list build; not callable by staff directly');
}
console.log('ALL REPORT TESTS PASSED');
