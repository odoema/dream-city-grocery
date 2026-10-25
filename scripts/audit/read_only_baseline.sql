\set ON_ERROR_STOP on

BEGIN TRANSACTION READ ONLY;

SELECT
  current_database() AS database_name,
  current_user AS database_user,
  current_setting('transaction_read_only') AS transaction_read_only,
  version() AS server_version;

SELECT
  current_setting('transaction_read_only') = 'on' AS read_only_transaction_verified;

SELECT
  to_regclass('public.products') AS products_table,
  to_regclass('public.categories') AS categories_table,
  to_regclass('public.suppliers') AS suppliers_table,
  to_regclass('public.inventory_movements') AS inventory_movements_table,
  to_regclass('public.sales') AS sales_table,
  to_regclass('public.sale_items') AS sale_items_table,
  to_regclass('public.purchase_orders') AS purchase_orders_table,
  to_regclass('public.goods_receipts') AS goods_receipts_table,
  to_regclass('public.journals') AS journals_table,
  to_regclass('public.journal_lines') AS journal_lines_table,
  to_regclass('public.audit_log') AS audit_log_table;

SELECT
  to_regprocedure('public.search_dream_city_products(text,integer)') AS product_intelligence_rpc;

SELECT
  COUNT(*) FILTER (WHERE table_schema = 'public' AND table_type = 'BASE TABLE') AS public_base_tables,
  COUNT(*) FILTER (WHERE table_schema = 'public' AND table_type = 'VIEW') AS public_views
FROM information_schema.tables;

SELECT
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
ORDER BY c.relname;

SELECT
  COUNT(*) FILTER (WHERE to_regclass('public.products') IS NOT NULL) AS products,
  COUNT(*) FILTER (WHERE to_regclass('public.categories') IS NOT NULL) AS categories,
  COUNT(*) FILTER (WHERE to_regclass('public.suppliers') IS NOT NULL) AS suppliers,
  COUNT(*) FILTER (WHERE to_regclass('public.inventory_movements') IS NOT NULL) AS inventory_movements,
  COUNT(*) FILTER (WHERE to_regclass('public.sales') IS NOT NULL) AS sales,
  COUNT(*) FILTER (WHERE to_regclass('public.sale_items') IS NOT NULL) AS sale_items,
  COUNT(*) FILTER (WHERE to_regclass('public.purchase_orders') IS NOT NULL) AS purchase_orders,
  COUNT(*) FILTER (WHERE to_regclass('public.goods_receipts') IS NOT NULL) AS goods_receipts,
  COUNT(*) FILTER (WHERE to_regclass('public.journals') IS NOT NULL) AS journals,
  COUNT(*) FILTER (WHERE to_regclass('public.journal_lines') IS NOT NULL) AS journal_lines,
  COUNT(*) FILTER (WHERE to_regclass('public.audit_log') IS NOT NULL) AS audit_log
FROM generate_series(1, 1) AS baseline;

SELECT
  CASE WHEN to_regclass('public.products') IS NOT NULL THEN (SELECT COUNT(*) FROM public.products) ELSE NULL END AS products,
  CASE WHEN to_regclass('public.categories') IS NOT NULL THEN (SELECT COUNT(*) FROM public.categories) ELSE NULL END AS categories,
  CASE WHEN to_regclass('public.suppliers') IS NOT NULL THEN (SELECT COUNT(*) FROM public.suppliers) ELSE NULL END AS suppliers,
  CASE WHEN to_regclass('public.inventory_movements') IS NOT NULL THEN (SELECT COUNT(*) FROM public.inventory_movements) ELSE NULL END AS inventory_movements,
  CASE WHEN to_regclass('public.sales') IS NOT NULL THEN (SELECT COUNT(*) FROM public.sales) ELSE NULL END AS sales,
  CASE WHEN to_regclass('public.sale_items') IS NOT NULL THEN (SELECT COUNT(*) FROM public.sale_items) ELSE NULL END AS sale_items,
  CASE WHEN to_regclass('public.purchase_orders') IS NOT NULL THEN (SELECT COUNT(*) FROM public.purchase_orders) ELSE NULL END AS purchase_orders,
  CASE WHEN to_regclass('public.goods_receipts') IS NOT NULL THEN (SELECT COUNT(*) FROM public.goods_receipts) ELSE NULL END AS goods_receipts,
  CASE WHEN to_regclass('public.journals') IS NOT NULL THEN (SELECT COUNT(*) FROM public.journals) ELSE NULL END AS journals,
  CASE WHEN to_regclass('public.journal_lines') IS NOT NULL THEN (SELECT COUNT(*) FROM public.journal_lines) ELSE NULL END AS journal_lines,
  CASE WHEN to_regclass('public.audit_log') IS NOT NULL THEN (SELECT COUNT(*) FROM public.audit_log) ELSE NULL END AS audit_log;

COMMIT;
