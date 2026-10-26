import { test } from 'node:test';
import assert from 'node:assert/strict';
import Papa from 'papaparse';
import { detectKind, detectStores, parseItems, parseCustomers, parseSales, parseDateParts, guessDateOrder, num } from '../src/import/loyverse.js';

const parse = csv => { const r = Papa.parse(csv.trim(), { header: true, skipEmptyLines: true }); return { rows: r.data, headers: r.meta.fields }; };
const utc = p => new Date(Date.UTC(p.y, p.mo - 1, p.d, p.h - 3, p.mi, p.s)); // pretend shop is UTC+3

const ITEMS = `Handle,SKU,Name,Category,Description,Sold by weight,Option 1 name,Option 1 value,Option 2 name,Option 2 value,Option 3 name,Option 3 value,Cost,Barcode,SKU of included item,Quantity of included item,Track stock,Available for sale [Dream City],Price [Dream City],In stock [Dream City],Low stock [Dream City],Available for sale [Branch 2],Price [Branch 2],In stock [Branch 2],Low stock [Branch 2]
sugar-1kg,10001,Sugar 1kg,Food,,N,,,,,,,"4,200",6009612345678,,,Y,Y,"5,000",24,5,Y,5200,3,2
t-shirt,10002,T-Shirt,Clothing,,N,Size,S,Colour,Red,,,8000,,,,Y,Y,12000,3,1,Y,12000,0,0
t-shirt,10003,,,,,,M,,Red,,,8000,,,,Y,Y,12500,-2,1,Y,12500,0,0
rice,10004,Rice,Food,Loose,Y,,,,,,,3000,,,,Y,Y,4000,25.5,10,N,,,
gift-box,10005,Gift box,Gifts,,N,,,,,,,0,,10001,1,N,Y,,0,0,Y,,0,0
gift-box,,,,,,,,,,,,,,10004,2,,,,,,,,,
charging,10006,Phone charging,Services,,N,,,,,,,0,,,,N,Y,500,,,Y,500,,`;

test('detects export kinds and stores', () => {
  const { headers } = parse(ITEMS);
  assert.equal(detectKind(headers), 'items');
  assert.deepEqual(detectStores(headers), ['Dream City', 'Branch 2']);
  assert.equal(detectKind(['Name', 'Email', 'Phone', 'Customer code']), 'customers');
  assert.equal(detectKind(['Date', 'Receipt number', 'Item', 'Quantity']), 'sales');
  assert.equal(detectKind(['Date', 'Receipt number', 'Gross sales']), 'receipts-without-items');
});

test('parses items, variants, composites and store columns', () => {
  const { rows, headers } = parse(ITEMS);
  const { items, problems, stats } = parseItems(rows, headers, { store: 'Dream City' });
  assert.equal(problems.length, 0, problems.join());
  assert.equal(items.length, 6);
  const sugar = items[0];
  assert.equal(sugar.price, 5000); assert.equal(sugar.cost, 4200); assert.equal(sugar.in_stock, 24); assert.equal(sugar.low_stock, 5);
  assert.equal(sugar.barcode, '6009612345678');
  const [s, m] = items.filter(i => i.handle === 't-shirt');
  assert.equal(s.name, 'T-Shirt (S / Red)'); assert.equal(m.name, 'T-Shirt (M / Red)');
  assert.equal(m.category, 'Clothing'); assert.equal(m.in_stock, -2); assert.notEqual(s.source_item_id, m.source_item_id);
  assert.equal(items.find(i => i.handle === 'rice').sold_by_weight, true);
  assert.equal(items.find(i => i.handle === 'rice').in_stock, 25.5);
  assert.equal(items.filter(i => i.handle === 'gift-box').length, 1);
  assert.equal(items.find(i => i.handle === 'charging').track_stock, false);
  assert.equal(stats.negativeStock, 1); assert.equal(stats.noPrice, 1);
  const b2 = parseItems(rows, headers, { store: 'Branch 2' }).items;
  assert.equal(b2[0].price, 5200); assert.equal(b2[0].in_stock, 3);
});

test('parses customers', () => {
  const { rows, headers } = parse(`Name,Email,Phone,Address,City,Region,Postal code,Country,Customer code,Note,Points balance,Total visits
Akello Grace,grace@example.com,+256700000001,Plot 4,Nebbi,,,Uganda,C001,Pays monthly,0,12
,,,,,,,,,,,
Okello,,0772000000,,,,,,,,,`);
  const { customers } = parseCustomers(rows, headers);
  assert.equal(customers.length, 2);
  assert.equal(customers[0].address, 'Plot 4, Nebbi, Uganda');
  assert.equal(customers[0].customer_code, 'C001');
});

test('dates: day-first, month-first, ISO, 12-hour clock', () => {
  assert.equal(guessDateOrder(['25/10/2026 14:00', '03/10/2026']), 'dmy');
  assert.equal(guessDateOrder(['10/25/26 2:00 PM']), 'mdy');
  assert.deepEqual(parseDateParts('25/10/2026 14:05', 'dmy'), { y: 2026, mo: 10, d: 25, h: 14, mi: 5, s: 0 });
  assert.deepEqual(parseDateParts('10/25/26 2:05 PM', 'mdy'), { y: 2026, mo: 10, d: 25, h: 14, mi: 5, s: 0 });
  assert.deepEqual(parseDateParts('2026-10-25 09:30:15'), { y: 2026, mo: 10, d: 25, h: 9, mi: 30, s: 15 });
  assert.equal(parseDateParts('25.10.2026 12:00 AM', 'dmy').h, 0);
  assert.equal(parseDateParts('not a date'), null);
});

test('parses "Receipts by item" sales history', () => {
  const { rows, headers } = parse(`Date,Receipt number,Receipt type,Category,SKU,Item,Variant,Modifiers applied,Quantity,Gross sales,Discounts,Net sales,Cost of goods,Gross profit,Taxes,Dining option,POS,Store,Cashier name,Customer name,Customer contacts,Comment,Status
25/10/2026 14:05,1-1001,Sale,Food,10001,Sugar 1kg,,,2,"10,000",0,"10,000",8400,1600,0,,POS 1,Dream City,Dorcas,,,,Closed
25/10/2026 14:05,1-1001,Sale,Food,10001,Sugar 1kg,,,1,5000,0,5000,4200,800,0,,POS 1,Dream City,Dorcas,,,,Closed
26/10/2026 09:00,1-1002,Refund,Food,10001,Sugar 1kg,,,-1,-5000,0,-5000,-4200,-800,0,,POS 1,Dream City,Dorcas,,,,Closed
26/10/2026 09:10,1-1003,Sale,Food,10004,Rice,,,1.5,6000,0,6000,4500,1500,0,,POS 1,Dream City,Dorcas,,,,Cancelled`);
  const { lines, stats, problems, order } = parseSales(rows, headers, { order: 'auto', toUtc: utc });
  assert.equal(order, 'dmy');
  assert.equal(lines.length, 3);
  assert.notEqual(lines[0].line_key, lines[1].line_key);
  assert.equal(lines[0].sold_at, '2026-10-25T11:05:00.000Z');
  assert.equal(lines[2].receipt_type, 'refund'); assert.equal(lines[2].quantity, 1);
  assert.equal(stats.net, 10000);
  assert.match(problems.join(), /cancelled/);
});

test('number parsing', () => {
  assert.equal(num('1,234.50'), 1234.5);
  assert.equal(num('1.234,50'), 1234.5);
  assert.equal(num('12,5'), 12.5);
  assert.equal(num('UGX 5,000'), 5000);
  assert.equal(num(''), null);
  assert.equal(num('-3'), -3);
});
