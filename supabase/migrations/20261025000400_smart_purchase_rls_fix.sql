begin;

drop policy if exists "authorized staff read purchase recommendation runs" on public.purchase_recommendation_runs;
create policy "authorized staff read purchase recommendation runs"
  on public.purchase_recommendation_runs for select to authenticated
  using (public.current_staff_role() in ('owner','manager','cashier','accountant'));

drop policy if exists "authorized staff read purchase recommendation items" on public.purchase_recommendation_items;
create policy "authorized staff read purchase recommendation items"
  on public.purchase_recommendation_items for select to authenticated
  using (exists (
    select 1 from public.purchase_recommendation_runs r
    where r.id = run_id
      and public.current_staff_role() in ('owner','manager','cashier','accountant')
  ));

commit;
