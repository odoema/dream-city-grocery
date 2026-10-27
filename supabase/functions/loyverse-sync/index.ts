// Loyverse -> Grocery POS live sync (Supabase Edge Function).
// Reads the Loyverse API with the LOYVERSE_TOKEN secret and hands the data to
// public.loyverse_sync_apply() in the database, which does all the bookkeeping.
// Safe to call any time: the database throttles to one run every 20 seconds and
// skips receipts it has already recorded. Called by the 5-minute schedule, the
// app's "Sync now" button, and (for instant sync) a Loyverse webhook on every
// receipt. The webhook sends no Supabase key, so instant sync needs "Verify JWT"
// switched OFF for this function.

const LV = 'https://api.loyverse.com/v1.0';
const TOKEN = Deno.env.get('LOYVERSE_TOKEN') ?? '';
const SB_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
};

type Json = Record<string, any>;

async function lv(path: string): Promise<Json> {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(LV + path, { headers: { Authorization: 'Bearer ' + TOKEN } });
    if (r.status === 429 && attempt < 3) { await new Promise(res => setTimeout(res, 1500 * (attempt + 1))); continue; }
    if (!r.ok) throw new Error(`Loyverse ${path.split('?')[0]} answered ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return await r.json();
  }
}

async function all(path: string, key: string, max = 40): Promise<Json[]> {
  const out: Json[] = [];
  let cursor = '';
  for (let page = 0; page < max; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const j = await lv(path + sep + 'limit=250' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
    out.push(...(j[key] ?? []));
    cursor = j.cursor ?? '';
    if (!cursor) break;
  }
  return out;
}

async function db(fn: string, args: Json = {}): Promise<any> {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(args)
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${fn}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

function method(payments: Json[] = []): string {
  const p = [...payments].sort((a, b) => Number(b.money_amount || 0) - Number(a.money_amount || 0))[0] || {};
  const n = String(p.name || '').toLowerCase();
  const t = String(p.type || '').toUpperCase();
  if (/mobile|momo|mtn|airtel|m-?pesa/.test(n)) return 'mobile_money';
  if (/credit|debt|later|account/.test(n)) return 'credit';
  if (/bank|transfer|cheque|check/.test(n) || t === 'CHECK') return 'bank';
  if (t === 'CARD' || /card|visa|master/.test(n)) return 'card';
  return 'cash';
}

const variantName = (item: Json, v: Json) => {
  const opts = [v.option1_value, v.option2_value, v.option3_value].filter(Boolean);
  return item.item_name + (opts.length ? ` (${opts.join(' / ')})` : '');
};

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const reply = (body: Json, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
  if (!TOKEN) return reply({ ok: false, error: 'LOYVERSE_TOKEN secret is missing' }, 500);

  // One-time setup from Settings: ask Loyverse to call this function on every new receipt.
  const input: Json = await req.clone().json().catch(() => ({}));
  if (input?.action === 'register-webhook') {
    try {
      const url = SB_URL.replace(/\/$/, '') + '/functions/v1/loyverse-sync';
      const existing = (await lv('/webhooks')).webhooks ?? [];
      const mine = existing.find((w: Json) => w.url === url && w.type === 'receipts.update');
      if (mine && mine.status === 'ENABLED') return reply({ ok: true, webhook: 'already on' });
      const r = await fetch(LV + '/webhooks', {
        method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(mine ? { id: mine.id } : {}), url, type: 'receipts.update', status: 'ENABLED' })
      });
      if (!r.ok) throw new Error('Loyverse refused the webhook: ' + r.status + ' ' + (await r.text()).slice(0, 200));
      return reply({ ok: true, webhook: 'on' });
    } catch (e) {
      return reply({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
    }
  }

  let started = false;
  try {
    const begin = await db('loyverse_sync_begin');
    if (!begin?.run) return reply({ ok: true, skipped: begin?.reason || 'not run' });
    started = true;
    const until = new Date().toISOString();

    const [categories, items, levels, employees, receipts] = await Promise.all([
      all('/categories', 'categories'),
      all('/items', 'items'),
      all('/inventory', 'inventory_levels'),
      all('/employees', 'employees').catch(() => []),
      all('/receipts?created_at_min=' + encodeURIComponent(new Date(begin.receipts_since).toISOString()) + '&created_at_max=' + encodeURIComponent(until), 'receipts')
    ]);

    const catName = new Map(categories.map(c => [c.id, c.name]));
    const empName = new Map(employees.map(e => [e.id, e.name]));

    const outItems: Json[] = [];
    for (const it of items) {
      for (const v of it.variants ?? []) {
        const store = (v.stores ?? []).find((s: Json) => s.price != null) || {};
        outItems.push({
          variant_id: v.variant_id, sku: v.sku, barcode: v.barcode, name: variantName(it, v),
          category: catName.get(it.category_id) ?? '', price: store.price ?? v.default_price ?? 0, cost: v.cost ?? 0,
          track_stock: it.track_stock, sold_by_weight: it.sold_by_weight, deleted: Boolean(it.deleted_at || v.deleted_at)
        });
      }
    }

    const stock = new Map<string, number>();
    for (const l of levels) stock.set(l.variant_id, (stock.get(l.variant_id) ?? 0) + Number(l.in_stock || 0));

    const customerCache = new Map<string, Json | null>();
    const outReceipts: Json[] = [];
    for (const r of receipts) {
      let customer: Json | null = null;
      if (r.customer_id) {
        if (!customerCache.has(r.customer_id)) customerCache.set(r.customer_id, await lv('/customers/' + r.customer_id).catch(() => null));
        const c = customerCache.get(r.customer_id);
        if (c) customer = { code: c.customer_code ?? '', name: c.name ?? '', phone: c.phone_number ?? '' };
      }
      outReceipts.push({
        number: r.receipt_number, type: String(r.receipt_type).toUpperCase() === 'REFUND' ? 'refund' : 'sale', refund_for: r.refund_for ?? null,
        created_at: r.receipt_date || r.created_at, cancelled: Boolean(r.cancelled_at), payment: method(r.payments),
        total: r.total_money ?? 0, employee: empName.get(r.employee_id) ?? '', customer,
        lines: (r.line_items ?? []).map((l: Json) => ({
          variant_id: l.variant_id, sku: l.sku, name: l.variant_name ? `${l.item_name} (${l.variant_name})` : l.item_name,
          quantity: l.quantity, price: l.price, gross: l.gross_total_money, cost_total: l.cost_total
        }))
      });
    }

    const result = await db('loyverse_sync_apply', {
      p_items: outItems, p_receipts: outReceipts,
      p_levels: [...stock].map(([variant_id, in_stock]) => ({ variant_id, in_stock })),
      p_receipts_until: until
    });
    return reply({ ok: true, read: { items: outItems.length, receipts: outReceipts.length }, result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (started) await db('loyverse_sync_fail', { p_error: message }).catch(() => {});
    return reply({ ok: false, error: message }, 500);
  }
});
