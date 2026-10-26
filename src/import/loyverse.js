// Loyverse CSV export → our import format. Pure functions (no DOM, no network)
// so they can be unit-tested with `npm test`.
//
// Supported exports (Loyverse Back Office):
//   * Items            Items → Export          (Handle, SKU, Name, Category, … Price [Store], In stock [Store] …)
//   * Customers        Customers → Export      (Name, Email, Phone, Address, … Customer code, Note …)
//   * Sales history    Receipts → Export → "Receipts by item"
//                      (Date, Receipt number, Receipt type, SKU, Item, Variant, Quantity, Net sales, … Status)

export function norm(header) {
  return String(header || '').replace(/^﻿/, '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Find the first header matching any alias. Returns the original header or null.
export function pick(headers, ...aliases) {
  const map = new Map(headers.map(h => [norm(h), h]));
  for (const a of aliases) if (map.has(a)) return map.get(a);
  return null;
}

export function num(value) {
  if (value === null || value === undefined) return null;
  let s = String(value).trim();
  if (!s) return null;
  s = s.replace(/[^\d.,\-]/g, '');
  // "1.234,50" (comma decimal) vs "1,234.50"
  if (/,\d{1,2}$/.test(s) && s.includes('.') && s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\-?\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function yes(value, fallback = null) {
  const s = String(value ?? '').trim().toLowerCase();
  if (!s) return fallback;
  return ['y', 'yes', 'true', '1'].includes(s);
}

export function detectKind(headers) {
  const n = headers.map(norm);
  if (n.includes('handle') && n.includes('name')) return 'items';
  if ((n.includes('receipt number') || n.includes('receipt no.')) && (n.includes('item') || n.includes('item name'))) return 'sales';
  if (n.includes('receipt number')) return 'receipts-without-items';
  if (n.includes('customer code') || (n.includes('name') && (n.includes('phone') || n.includes('email')) && !n.includes('sku'))) return 'customers';
  return null;
}

// Store names that appear as "Price [Store name]".
export function detectStores(headers) {
  const stores = new Set();
  for (const h of headers) {
    const m = String(h).match(/^\s*(?:price|in stock|available for sale|low stock)\s*\[(.+)\]\s*$/i);
    if (m) stores.add(m[1].trim());
  }
  return [...stores];
}

function storeCol(headers, base, store) {
  if (store) {
    const wanted = norm(`${base} [${store}]`);
    const hit = headers.find(h => norm(h) === wanted);
    if (hit) return hit;
  }
  return pick(headers, norm(base)) || headers.find(h => norm(h).startsWith(norm(base) + ' [')) || null;
}

// ---------------------------------------------------------------- items
export function parseItems(rows, headers, { store } = {}) {
  const col = {
    handle: pick(headers, 'handle'),
    sku: pick(headers, 'sku'),
    name: pick(headers, 'name', 'item name'),
    category: pick(headers, 'category'),
    description: pick(headers, 'description'),
    weight: pick(headers, 'sold by weight'),
    cost: pick(headers, 'cost', 'default purchase cost', 'purchase cost'),
    barcode: pick(headers, 'barcode'),
    track: pick(headers, 'track stock'),
    included: pick(headers, 'sku of included item'),
    available: storeCol(headers, 'Available for sale', store),
    price: storeCol(headers, 'Price', store),
    stock: storeCol(headers, 'In stock', store),
    low: storeCol(headers, 'Low stock', store)
  };
  const options = [1, 2, 3].map(i => ({ name: pick(headers, `option ${i} name`), value: pick(headers, `option ${i} value`) }));
  const problems = [];
  if (!col.name) problems.push('No "Name" column found.');
  if (!col.price) problems.push('No "Price" column found — prices will be empty.');

  const items = [];
  const parents = new Map();   // handle -> parent row (first row with a name)
  const seen = new Map();      // handle -> count of rows (variants)
  rows.forEach((r, i) => {
    const handle = String(r[col.handle] ?? '').trim();
    let parent = handle ? parents.get(handle) : null;
    const ownName = String(r[col.name] ?? '').trim();
    if (ownName && (!parent || !handle)) { parent = r; if (handle) parents.set(handle, r); }
    const base = parent || r;
    const name = ownName || String(base[col.name] ?? '').trim();
    const optionValues = options.map(o => String(r[o.value] ?? '').trim()).filter(Boolean);
    const optionNames = options.map(o => String(r[o.name] ?? '').trim() || String(base[o.name] ?? '').trim()).filter(Boolean);
    if (handle) seen.set(handle, (seen.get(handle) || 0) + 1);
    const variantLabel = optionValues.join(' / ');
    const own = c => String(r[c] ?? '').trim();
    const inherit = c => own(c) || String(base[c] ?? '').trim();
    const isComposite = Boolean(String(r[col.included] ?? '').trim());
    if (!name && !handle && !String(r[col.sku] ?? '').trim()) return; // blank line (or composite component line)
    if (isComposite && !ownName && handle && parents.has(handle) && !optionValues.length) return; // extra component rows
    items.push({
      row: i + 2,
      source_item_id: (handle || ('row-' + (i + 2))) + (variantLabel ? '|' + variantLabel : ''),
      handle,
      sku: String(r[col.sku] ?? '').trim(),
      barcode: String(r[col.barcode] ?? '').trim(),
      name: variantLabel ? `${name} (${variantLabel})` : name,
      category: inherit(col.category),
      description: inherit(col.description),
      sold_by_weight: yes(inherit(col.weight), false),
      cost: num(own(col.cost)) ?? num(base[col.cost]) ?? 0,
      price: num(r[col.price]) ?? 0,
      track_stock: yes(inherit(col.track), true),
      available_for_sale: yes(r[col.available], true),
      in_stock: num(r[col.stock]) ?? 0,
      low_stock: num(r[col.low]) ?? 0,
      variant_options: optionNames.length ? optionNames.map((n, k) => ({ name: n, value: optionValues[k] || '' })) : []
    });
  });
  // Duplicate SKUs inside the file
  const skuCount = new Map();
  items.forEach(it => { if (it.sku) skuCount.set(it.sku, (skuCount.get(it.sku) || 0) + 1); });
  const dupSkus = [...skuCount].filter(([, n]) => n > 1).map(([s]) => s);
  if (dupSkus.length) problems.push(`${dupSkus.length} SKU(s) appear more than once (e.g. ${dupSkus.slice(0, 3).join(', ')}). Only the first keeps the SKU; others get a new one.`);
  return { items, problems, stats: summarizeItems(items) };
}

function summarizeItems(items) {
  return {
    total: items.length,
    variants: items.filter(i => i.variant_options.length).length,
    noPrice: items.filter(i => !(i.price > 0)).length,
    withStock: items.filter(i => i.track_stock && i.in_stock > 0).length,
    negativeStock: items.filter(i => i.in_stock < 0).length,
    stockValue: items.reduce((s, i) => s + (i.track_stock && i.in_stock > 0 ? i.in_stock * (i.cost || 0) : 0), 0),
    categories: new Set(items.map(i => i.category).filter(Boolean)).size
  };
}

// ---------------------------------------------------------------- customers
export function parseCustomers(rows, headers) {
  const col = {
    name: pick(headers, 'name', 'customer name', 'customer'),
    email: pick(headers, 'email', 'e-mail'),
    phone: pick(headers, 'phone', 'phone number', 'mobile'),
    address: pick(headers, 'address'),
    city: pick(headers, 'city'),
    region: pick(headers, 'region', 'state'),
    postal: pick(headers, 'postal code', 'zip'),
    country: pick(headers, 'country'),
    code: pick(headers, 'customer code', 'customer id', 'code'),
    note: pick(headers, 'note', 'notes', 'comment')
  };
  const problems = col.name ? [] : ['No "Name" column found.'];
  const customers = rows.map((r, i) => ({
    row: i + 2,
    name: String(r[col.name] ?? '').trim(),
    email: String(r[col.email] ?? '').trim(),
    phone: String(r[col.phone] ?? '').trim(),
    address: [col.address, col.city, col.region, col.postal, col.country].map(c => String(r[c] ?? '').trim()).filter(Boolean).join(', '),
    customer_code: String(r[col.code] ?? '').trim(),
    notes: String(r[col.note] ?? '').trim()
  })).filter(c => c.name || c.phone || c.email);
  return { customers, problems, stats: { total: customers.length, withPhone: customers.filter(c => c.phone).length, noName: customers.filter(c => !c.name).length } };
}

// ---------------------------------------------------------------- sales history
// order: 'auto' | 'dmy' | 'mdy' | 'ymd'
export function guessDateOrder(values) {
  let dmy = 0, mdy = 0;
  for (const v of values) {
    const m = String(v || '').trim().match(/^(\d{1,4})[./-](\d{1,2})[./-](\d{1,4})/);
    if (!m) continue;
    if (m[1].length === 4) return 'ymd';
    const a = Number(m[1]), b = Number(m[2]);
    if (a > 12 && b <= 12) dmy++;
    if (b > 12 && a <= 12) mdy++;
  }
  return mdy > dmy ? 'mdy' : 'dmy';
}

// -> { y, mo, d, h, mi, s } or null
export function parseDateParts(value, order = 'dmy') {
  const s = String(value || '').trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  let y, mo, d, rest;
  if (iso) { y = +iso[1]; mo = +iso[2]; d = +iso[3]; rest = s.slice(10); }
  else {
    const m = s.match(/^(\d{1,4})[./-](\d{1,2})[./-](\d{1,4})(.*)$/);
    if (!m) return null;
    let [a, b, c] = [m[1], m[2], m[3]];
    rest = m[4];
    if (a.length === 4 || order === 'ymd') { y = +a; mo = +b; d = +c; }
    else if (order === 'mdy') { mo = +a; d = +b; y = +c; }
    else { d = +a; mo = +b; y = +c; }
    if (y < 100) y += 2000;
  }
  const t = String(rest || '').match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?/i);
  let h = 0, mi = 0, sec = 0;
  if (t) {
    h = +t[1]; mi = +t[2]; sec = +(t[3] || 0);
    const ap = (t[4] || '').toLowerCase().replace(/\./g, '');
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
  }
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y >= 2000 && y <= 2100 && h < 24 && mi < 60)) return null;
  return { y, mo, d, h, mi, s: sec };
}

// toUtc(parts) -> Date (caller supplies the shop time-zone conversion)
export function parseSales(rows, headers, { order = 'auto', toUtc }) {
  const col = {
    date: pick(headers, 'date', 'date/time', 'receipt date'),
    receipt: pick(headers, 'receipt number', 'receipt no.', 'receipt #'),
    type: pick(headers, 'receipt type', 'type'),
    category: pick(headers, 'category'),
    sku: pick(headers, 'sku'),
    item: pick(headers, 'item', 'item name'),
    variant: pick(headers, 'variant'),
    qty: pick(headers, 'quantity', 'qty', 'items sold'),
    gross: pick(headers, 'gross sales'),
    discounts: pick(headers, 'discounts', 'discount'),
    net: pick(headers, 'net sales'),
    cost: pick(headers, 'cost of goods', 'cost of goods sold'),
    payment: pick(headers, 'payment type', 'payment'),
    cashier: pick(headers, 'cashier name', 'employee', 'cashier'),
    customer: pick(headers, 'customer name', 'customer'),
    store: pick(headers, 'store'),
    status: pick(headers, 'status')
  };
  const problems = [];
  for (const k of ['date', 'item', 'qty']) if (!col[k]) problems.push(`No "${k === 'qty' ? 'Quantity' : k === 'item' ? 'Item' : 'Date'}" column found.`);
  if (problems.length) return { lines: [], problems, stats: { total: 0 } };
  const ord = order === 'auto' ? guessDateOrder(rows.slice(0, 500).map(r => r[col.date])) : order;
  const lines = [];
  let badDates = 0, cancelled = 0;
  const perReceipt = new Map();
  rows.forEach((r, i) => {
    const status = String(r[col.status] ?? '').trim().toLowerCase();
    if (status && /cancel|void/.test(status)) { cancelled++; return; }
    const parts = parseDateParts(r[col.date], ord);
    if (!parts) { badDates++; return; }
    const receipt = String(r[col.receipt] ?? '').trim();
    const item = String(r[col.item] ?? '').trim();
    const variant = String(r[col.variant] ?? '').trim();
    const sku = String(r[col.sku] ?? '').trim();
    if (!item && !sku) return;
    const key = `${receipt || 'row' + i}|${sku || item}|${variant}`;
    const n = (perReceipt.get(key) || 0) + 1;
    perReceipt.set(key, n);
    const type = String(r[col.type] ?? '').trim();
    lines.push({
      line_key: `${key}|${n}`,
      sold_at: toUtc(parts).toISOString(),
      receipt_number: receipt,
      receipt_type: /refund/i.test(type) ? 'refund' : 'sale',
      sku, item_name: item, variant,
      category: String(r[col.category] ?? '').trim(),
      quantity: Math.abs(num(r[col.qty]) ?? 0),
      gross_sales: Math.abs(num(r[col.gross]) ?? 0),
      discounts: Math.abs(num(r[col.discounts]) ?? 0),
      net_sales: Math.abs(num(r[col.net]) ?? num(r[col.gross]) ?? 0),
      cost_of_goods: Math.abs(num(r[col.cost]) ?? 0),
      payment_type: String(r[col.payment] ?? '').trim(),
      cashier_name: String(r[col.cashier] ?? '').trim(),
      customer_name: String(r[col.customer] ?? '').trim(),
      store_name: String(r[col.store] ?? '').trim()
    });
  });
  if (badDates) problems.push(`${badDates} row(s) had a date that could not be read and were skipped.`);
  if (cancelled) problems.push(`${cancelled} cancelled row(s) skipped.`);
  const times = lines.map(l => l.sold_at).sort();
  return {
    lines, problems, order: ord,
    stats: {
      total: lines.length,
      receipts: new Set(lines.map(l => l.receipt_number)).size,
      refunds: lines.filter(l => l.receipt_type === 'refund').length,
      first: times[0] || null, last: times[times.length - 1] || null,
      net: lines.reduce((s, l) => s + (l.receipt_type === 'refund' ? -l.net_sales : l.net_sales), 0)
    }
  };
}

// The catalogue already stored in the database by the earlier Dream City import.
export function itemsFromLegacyDictionary(rows) {
  return rows.map((r, i) => ({
    row: i + 1,
    source_item_id: r.source_handle || ('legacy-' + (r.source_sku || i)),
    sku: r.source_sku || '',
    barcode: r.source_barcode || '',
    name: r.display_name || r.source_name,
    category: r.source_category || '',
    description: '',
    sold_by_weight: Boolean(r.sold_by_weight),
    cost: Number(r.source_cost || 0),
    price: Number(r.source_price || 0),
    track_stock: r.source_track_stock !== false,
    available_for_sale: r.source_available_for_sale !== false,
    in_stock: 0,
    low_stock: Number(r.source_low_stock || 0),
    variant_options: []
  }));
}

export function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
