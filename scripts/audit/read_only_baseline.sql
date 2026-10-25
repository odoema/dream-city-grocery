\set ON_ERROR_STOP on

BEGIN TRANSACTION READ ONLY;

-- Fail closed if the session is not actually read-only.
DO $$
BEGIN
  IF current_setting('transaction_read_only') <> 'on' THEN
    RAISE EXCEPTION 'READ_ONLY_REQUIRED: transaction_read_only is not on';
  END IF;
END
$$;

SELECT
  current_database() AS database_name,
  current_user AS database_user,
  current_setting('transaction_read_only') AS transaction_read_only,
  version() AS server_version;

SELECT
  current_setting('transaction_read_only') = 'on' AS read_only_transaction_verified;

-- Verify required relations. Check schema/table privileges before resolving
-- relation names so restricted audit roles produce a clear diagnostic.
DO $$
DECLARE
  required_name text;
  required_names text[] := ARRAY[
    'public.products',
    'public.categories',
    'public.suppliers',
    'public.inventory_movements',
    'public.sales',
    'public.sale_items',
    'public.purchase_orders',
    'public.goods_receipts',
    'public.journals',
    'public.journal_lines',
    'public.audit_log'
  ];
  schema_name text;
  object_name text;
BEGIN
  FOREACH required_name IN ARRAY required_names LOOP
    schema_name := split_part(required_name, '.', 1);
    object_name := split_part(required_name, '.', 2);

    IF NOT has_schema_privilege(current_user, schema_name, 'USAGE') THEN
      RAISE EXCEPTION 'INSUFFICIENT_PRIVILEGE_OR_VISIBILITY: audit role lacks USAGE on schema %', schema_name;
    END IF;

    IF to_regclass(required_name) IS NULL THEN
      IF EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = schema_name
          AND c.relname = object_name
      ) THEN
        RAISE EXCEPTION 'INSUFFICIENT_PRIVILEGE_OR_VISIBILITY: required relation % exists but is not visible through to_regclass()', required_name;
      ELSE
        RAISE EXCEPTION 'REQUIRED_OBJECT_MISSING: required relation % is absent', required_name;
      END IF;
    END IF;

    IF NOT has_table_privilege(current_user, required_name, 'SELECT') THEN
      RAISE EXCEPTION 'INSUFFICIENT_PRIVILEGE_OR_VISIBILITY: audit role lacks SELECT on required relation %', required_name;
    END IF;
  END LOOP;
END
$$;

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

-- Verify the expected Product Intelligence RPC. If PostgreSQL cannot resolve it,
-- distinguish an absent function from a signature/visibility problem where possible.
DO $$
BEGIN
  IF to_regprocedure('public.search_dream_city_products(text,integer)') IS NULL THEN
    IF EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'search_dream_city_products'
    ) THEN
      RAISE EXCEPTION 'INSUFFICIENT_PRIVILEGE_OR_VISIBILITY: search_dream_city_products exists in public but the expected signature is not visible';
    ELSE
      RAISE EXCEPTION 'REQUIRED_OBJECT_MISSING: public.search_dream_city_products(text,integer) is absent';
    END IF;
  END IF;

  IF NOT has_function_privilege(current_user, 'public.search_dream_city_products(text,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'INSUFFICIENT_PRIVILEGE_OR_VISIBILITY: audit role lacks EXECUTE on public.search_dream_city_products(text,integer)';
  END IF;
END
$$;

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
  (SELECT COUNT(*) FROM public.products) AS products,
  (SELECT COUNT(*) FROM public.categories) AS categories,
  (SELECT COUNT(*) FROM public.suppliers) AS suppliers,
  (SELECT COUNT(*) FROM public.inventory_movements) AS inventory_movements,
  (SELECT COUNT(*) FROM public.sales) AS sales,
  (SELECT COUNT(*) FROM public.sale_items) AS sale_items,
  (SELECT COUNT(*) FROM public.purchase_orders) AS purchase_orders,
  (SELECT COUNT(*) FROM public.goods_receipts) AS goods_receipts,
  (SELECT COUNT(*) FROM public.journals) AS journals,
  (SELECT COUNT(*) FROM public.journal_lines) AS journal_lines,
  (SELECT COUNT(*) FROM public.audit_log) AS audit_log;

COMMIT;
