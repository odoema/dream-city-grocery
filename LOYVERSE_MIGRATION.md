# Moving from Loyverse

Everything is done in the app under **Import data** (owner or manager). Each import shows a preview first, and can be repeated safely — existing records are updated, never duplicated.

## Order

1. **Products & stock** → 2. **Customers** → 3. **Sales history**

## 1. Products (and opening stock)

In Loyverse Back Office: **Items → Item list → EXPORT → Export items**. Upload the CSV.

What comes across:

| Loyverse | Here |
|---|---|
| Name, Category, Description | Product name, category (created if missing), notes |
| SKU, Barcode | SKU, barcode (clashes are reported, never merged) |
| Cost, Price [store] | Cost price, selling price |
| Low stock [store] | Low-stock alert level |
| Sold by weight | Sold by weight (unit = kg, decimal quantities allowed) |
| Track stock | Track stock (off = service items, no stock) |
| Available for sale [store] | Shown at the till |
| Variants (Option 1–3) | One product per variant, e.g. `T-Shirt (M / Red)` |
| In stock [store] | **Optional** opening stock (see below) |

If the export has several stores, choose which store's prices and stock to use.

**Opening stock** — tick *"Also bring in today's stock as opening stock"* to set shelf quantities from Loyverse. It is posted properly (inventory movement + journal *Dr Inventory / Cr Opening balance equity*) and only for products with no stock history here, so running the import twice never doubles stock. Negative Loyverse stock is treated as 0 and listed for checking. Best practice: import on a quiet evening, then do a **Count stock** soon after to confirm.

Rows without a price are imported with price 0 and listed — set prices before selling them.

## 2. Customers

Loyverse: **Customers → Customer base → EXPORT**. Name, phone, e-mail, address (+city, region, country) and customer code come across. Customers are matched by customer code, then phone, then e-mail. Credit limits start at 0 — set them per customer.

## 3. Sales history

Loyverse: **Reports → Receipts → pick a date range → EXPORT → "Receipts by item"** (the plain *Receipts* export has no items and is rejected with a hint).

- Kept as **reference history** only: it feeds Reports and the **smart shopping list** (so recommendations work from day one). It never changes stock or the accounts.
- Cancelled receipts are skipped; refunds are kept as refunds.
- Dates: day/month vs month/day is detected automatically (can be overridden) and read in the shop's time zone.
- Lines are matched to products by SKU, then by name + variant. Import products first; lines imported earlier are re-linked automatically after a later product import.

## Dream City only

Dream City's database already holds a 341-item reference catalogue from an earlier Loyverse import. **Import data → "Create products from saved catalogue"** turns it into live products (no stock) without needing a new export.

## Cut-over checklist

1. Export items, customers and 1–3 months of "Receipts by item" from Loyverse.
2. Import products (with opening stock), then customers, then sales history.
3. Spot-check 10 products: price, cost, stock.
4. Run a **Count stock** for fast-moving items.
5. Start selling here; stop using Loyverse for sales the same day.
