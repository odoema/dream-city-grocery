-- =============================================================================
-- View-only staff (role value: executive_director, shown as "View only")
-- -----------------------------------------------------------------------------
-- Sees everything the owner sees — Dashboard, Reports, Accounts, Inventory,
-- Products, Customers, the day report — and can print and download (CSV,
-- receipts, reports). Cannot sell, refund, buy, count, record money or change
-- anything: every change in this app goes through server functions that check
-- the role, and those never include this role. Never run against SmartAttend.
-- =============================================================================

-- Must be its own statement (enum values cannot be added and used in one step).
alter type public.staff_role add value if not exists 'executive_director';

begin;

-- 1. Read every table the owner can read.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and rowsecurity loop
    execute format('drop policy if exists "view only staff read" on public.%I', t.tablename);
    execute format('create policy "view only staff read" on public.%I for select to authenticated using (public.current_staff_role()::text = %L)',
                   t.tablename, 'executive_director');
  end loop;
end $$;

-- 2. Let the read-only report functions include this role.
do $$
declare
  f text;
  d text;
begin
  foreach f in array array['get_sales_summary','get_sales_by_item','get_financial_statements','get_inventory_intelligence',
                           'get_legacy_sales_overview','get_smart_purchase_recommendations'] loop
    for d in select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = f loop
      if position('executive_director' in d) > 0 then continue; end if;
      d := replace(d, $q$array['owner','manager','accountant']$q$, $q$array['owner','manager','accountant','executive_director']$q$);
      d := replace(d, $q$in ('owner','manager','accountant')$q$, $q$in ('owner','manager','accountant','executive_director')$q$);
      d := replace(d, $q$in ('owner','manager','cashier','accountant')$q$, $q$in ('owner','manager','cashier','accountant','executive_director')$q$);
      execute d;
    end loop;
  end loop;
end $$;

-- 3. The two money actions any staff member may take (receive a customer payment,
--    close their own day) must still refuse view-only staff.
create or replace function public.require_writer()
returns uuid language plpgsql stable security definer set search_path = ''
as $$
declare v_actor uuid := public.require_staff();
begin
  if public.current_staff_role()::text = 'executive_director' then
    raise exception 'Your account is view-only';
  end if;
  return v_actor;
end;
$$;
revoke all on function public.require_writer() from public, anon;
grant execute on function public.require_writer() to authenticated;

do $$
declare d text;
begin
  for d in select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('receive_customer_payment', 'close_cash_up') loop
    if position('require_writer' in d) > 0 then continue; end if;
    execute replace(d, 'v_actor uuid := public.require_staff();', 'v_actor uuid := public.require_writer();');
  end loop;
end $$;

commit;
