-- Dream City Grocery: Executive Director role
-- Production target: nohdgmylncjtdymfshfy only.
-- This migration is additive: it does not alter the Owner account or existing roles.

alter type public.staff_role add value if not exists 'executive_director';

-- Executive Director is an oversight role. Existing write policies remain unchanged;
-- these additional policies only grant read access to operational/financial records.
create policy "executive director read suppliers"
on public.suppliers
for select to authenticated
using (public.current_staff_role()::text = 'executive_director');

create policy "executive director read accounts"
on public.accounts
for select to authenticated
using (public.current_staff_role()::text = 'executive_director');

create policy "executive director read sales"
on public.sales
for select to authenticated
using (public.current_staff_role()::text = 'executive_director');

create policy "executive director read sale items"
on public.sale_items
for select to authenticated
using (
  exists (
    select 1
    from public.sales s
    where s.id = sale_id
      and public.current_staff_role()::text = 'executive_director'
  )
);

create policy "executive director read inventory movements"
on public.inventory_movements
for select to authenticated
using (public.current_staff_role()::text = 'executive_director');

create policy "executive director read journals"
on public.journals
for select to authenticated
using (public.current_staff_role()::text = 'executive_director');

create policy "executive director read journal lines"
on public.journal_lines
for select to authenticated
using (public.current_staff_role()::text = 'executive_director');

create policy "executive director read audit log"
on public.audit_log
for select to authenticated
using (public.current_staff_role()::text = 'executive_director');

-- Defense in depth: the Executive Director must never be able to create a sale,
-- including through SECURITY DEFINER checkout RPCs. auth.uid() remains the caller
-- identity inside the trigger even when the trigger function is SECURITY DEFINER.
create or replace function public.prevent_executive_director_sale()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.active = true
      and p.role::text = 'executive_director'
  ) then
    raise exception 'Executive Director accounts are read-only';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_executive_director_sale on public.sales;
create trigger prevent_executive_director_sale
before insert on public.sales
for each row
execute function public.prevent_executive_director_sale();

revoke all on function public.prevent_executive_director_sale() from public, anon;
grant execute on function public.prevent_executive_director_sale() to authenticated;

comment on type public.staff_role is 'Dream City Grocery staff roles; executive_director is read-only oversight.';
