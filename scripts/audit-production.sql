\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;

\echo '=== DATABASE IDENTITY ==='
SELECT current_database() AS database_name,
       current_user AS connected_role,
       current_setting('transaction_read_only') AS transaction_read_only,
       now() AS audited_at;

\echo '=== PUBLIC TABLES ==='
SELECT schemaname, tablename
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

\echo '=== RLS STATUS ==='
SELECT n.nspname AS schema_name,
       c.relname AS table_name,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS force_rls
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
ORDER BY c.relname;

\echo '=== RLS POLICIES ==='
SELECT schemaname, tablename, policyname, permissive, roles,
       cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

\echo '=== USER-DEFINED PUBLIC FUNCTIONS ==='
SELECT n.nspname AS schema_name,
       p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS arguments,
       p.prosecdef AS security_definer,
       p.provolatile AS volatility,
       p.proconfig AS function_settings
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind = 'f'
ORDER BY p.proname, arguments;

\echo '=== PUBLIC TRIGGERS ==='
SELECT event_object_table AS table_name,
       trigger_name,
       event_manipulation,
       action_timing,
       action_statement
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY event_object_table, trigger_name, event_manipulation;

\echo '=== MIGRATION HISTORY ==='
SELECT to_jsonb(m) AS migration_record
FROM supabase_migrations.schema_migrations m
ORDER BY 1;

\echo '=== MANAGEMENT ALERT OBJECTS ==='
SELECT to_regclass('public.management_notifications') AS management_notifications_table,
       to_regprocedure('public.queue_management_notification(text,text,text,jsonb)') AS queue_function;

COMMIT;
