# Supabase MVP Handoff

Project: `nohdgmylncjtdymfshfy` (Dream City Grocery production). Production is UNFROZEN and changes are authorized, but preserve the existing architecture and avoid destructive rewrites.

## Current baseline
- legacy catalogue: 341
- category dictionary: 131
- live products: 1
- sales: 0
- purchase orders: 0
- goods receipts: 0
- journals: 0
- audit log: 0

The single live product is inactive test-like data. Do not activate or alter it merely for testing. Do not import old Loyverse quantities into live stock.

## Already implemented on GitHub
- `ux-refresh.js`: simplicity-first task navigation: Home, Sell, Stock, Customers, Count stock, Buy, Accounts, Reports.
- `product-intelligence.js`: reference-only search over the 341-product legacy catalogue.
- `supabase/migrations/20261025001000_activate_product_intelligence_search.sql`: activates `public.search_dream_city_products(text, integer)` for authenticated users; it does not modify inventory/pricing/accounting.
- GitHub Pages runs #69 and #70 succeeded.

## Supabase verification to perform

### A. Product Intelligence
```sql
select to_regprocedure('public.search_dream_city_products(text,integer)') as rpc;
select count(*) from public.dream_city_legacy_product_dictionary;
select * from public.search_dream_city_products('sugar',5);
```

### B. Baseline
```sql
select
 (select count(*) from public.products) products,
 (select count(*) from public.sales) sales,
 (select count(*) from public.sale_items) sale_items,
 (select count(*) from public.purchase_orders) purchase_orders,
 (select count(*) from public.goods_receipts) goods_receipts,
 (select count(*) from public.journals) journals,
 (select count(*) from public.journal_lines) journal_lines,
 (select count(*) from public.audit_log) audit_log;
```

### C. Validate contracts
Verify the existing live contracts for `create_order()` (both overloads), `quote_delivery()`, `apply_pricing_recommendation()`, `record_app_error()`, `generate_order_number()`, smart purchasing, goods receipt and stocktake. Do not replace working contracts merely to make the UI fit.

### D. Full-cycle MVP
Verify the supported flow:
`Product → Purchase → Goods Receipt → Stock Movement → Journal → Sale → Stock Reduction → Journal → Audit`.

Prefer non-destructive contract tests. If a temporary test product is required, make it clearly identified and use supported reversal/correction; do not hard-delete accounting/audit history.

### E. Cash accountability
Confirm whether production supports:
`cash issued − supported purchases − approved expenditure − cash returned = unexplained difference`.
If missing, implement the smallest coherent migration with evidence and audit trail.

### F. Management shopping notification
Verify the existing notification queue/worker can support shopping recommendations for management. Do not send real test emails; queue/test first.

### G. Security
Do not weaken RLS. New functions should normally be SECURITY INVOKER, fixed search_path where appropriate, and restricted EXECUTE grants. Run Supabase advisors after database changes.

## Handback required
Return PASS/FAIL/PENDING for: RPC, baseline, purchase/receive/stock, sale/stock/accounting, stocktake, cash accountability, management alerts, security/advisors. Include exact migrations/functions changed and any frontend contract mismatch that must be repaired on GitHub.

## Principle
Workers record what happened. The system handles accounting, stock calculations, audit and management exceptions.
