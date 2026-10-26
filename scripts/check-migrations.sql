-- Read-only: shows which migrations in supabase/migrations are already applied.
-- Paste into the Supabase SQL editor of YOUR shop's project. Changes nothing.
select m.file, m.applied
from (values
  ('20261024000100_initial_schema.sql',                 to_regclass('public.sales') is not null),
  ('20261024000200_purchasing_ap.sql',                  to_regclass('public.supplier_invoices') is not null),
  ('20261024000400_stocktaking_reconciliation.sql',     to_regprocedure('public.cancel_stocktake(uuid)') is not null),
  ('20261024000500_management_alerts.sql',              to_regclass('public.management_notifications') is not null),
  ('20261025000100_smart_purchasing_read_model.sql',    to_regclass('public.smart_purchase_recommendations') is not null),
  ('20261025000200_smart_purchase_runs.sql',            to_regclass('public.purchase_recommendation_runs') is not null),
  ('20261025000300_smart_purchase_staff_access.sql',    to_regprocedure('public.get_smart_purchase_recommendations()') is not null),
  ('20261025000400_smart_purchase_rls_fix.sql',         exists(select 1 from pg_policies where tablename = 'purchase_recommendation_runs' and qual like '%cashier%')),
  ('20261025000500_loyverse_category_dictionary.sql',   to_regclass('public.dream_city_category_dictionary') is not null),
  ('20261025000600_loyverse_legacy_product_dictionary.sql', to_regclass('public.dream_city_legacy_product_dictionary') is not null),
  ('20261025000650_loyverse_product_manager.sql',       exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'products' and column_name = 'track_stock')),
  ('20261025001000_activate_product_intelligence_search.sql', to_regprocedure('public.search_dream_city_products(text,integer)') is not null),
  ('20261026000100_white_label_platform.sql',           to_regclass('public.store_settings') is not null and to_regprocedure('public.get_customer_statement(uuid)') is not null)
) as m(file, applied)
order by m.file;
