-- Allow active purchasing staff to use the recommendation workflow.
-- This does NOT grant permission to pay suppliers or bypass the protected purchasing RPCs.

begin;

create or replace function public.get_smart_purchase_recommendations()
returns setof public.smart_purchase_recommendations
language sql
security definer
stable
set search_path = ''
as $$
  select r.*
  from public.smart_purchase_recommendations r
  where exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.active = true
      and p.role in ('owner','manager','cashier','accountant')
  )
  order by
    case r.recommendation_priority when 'urgent' then 1 when 'recommended' then 2 else 3 end,
    r.estimated_purchase_cost desc,
    r.product_name
$$;

revoke all on function public.get_smart_purchase_recommendations() from public, anon;
grant execute on function public.get_smart_purchase_recommendations() to authenticated;

-- The recommendation decision is an operational purchasing step, so a cashier/purchasing
-- worker may create and confirm it. Supplier payment remains separately protected.
create or replace function public.create_purchase_recommendation_run()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.staff_role;
  v_run_id uuid;
  v_run_number text;
  v_row record;
  v_rec_total numeric(14,2) := 0;
begin
  select role into v_role from public.profiles where id=v_actor and active;
  if v_role is null or v_role not in ('owner','manager','cashier','accountant') then
    raise exception 'Your staff role cannot prepare a shopping list';
  end if;
  v_run_number := 'SHOP-'||to_char(current_date,'YYYYMMDD')||'-'||lpad(nextval('public.purchase_recommendation_number_seq')::text,4,'0');
  insert into public.purchase_recommendation_runs(run_number,generated_by)
  values(v_run_number,v_actor) returning id into v_run_id;
  for v_row in
    select * from public.smart_purchase_recommendations
    where recommended_qty > 0
    order by case recommendation_priority when 'urgent' then 1 when 'recommended' then 2 else 3 end,
             estimated_purchase_cost desc, product_name
  loop
    insert into public.purchase_recommendation_items(
      run_id,product_id,recommended_qty,selected_qty,unit_cost,
      estimated_recommended_cost,estimated_selected_cost,reason
    ) values (
      v_run_id,v_row.product_id,v_row.recommended_qty,v_row.recommended_qty,
      v_row.latest_known_buying_price,v_row.estimated_purchase_cost,v_row.estimated_purchase_cost,
      concat(initcap(v_row.recommendation_priority), ': selling about ',
        to_char(v_row.adjusted_daily_demand,'FM999999990D0'),'/day; ',
        to_char(v_row.quantity_on_hand,'FM999999990D0'),' in stock; about ',
        coalesce(to_char(v_row.estimated_days_of_stock,'FM999999990D0'),'0'),' days of stock remaining.')
    );
    v_rec_total := v_rec_total + v_row.estimated_purchase_cost;
  end loop;
  update public.purchase_recommendation_runs
  set total_recommended_cost=v_rec_total,total_selected_cost=v_rec_total
  where id=v_run_id;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
  values(v_actor,'purchase_recommendation.created','purchase_recommendation_run',v_run_id,
         jsonb_build_object('run_number',v_run_number,'recommended_cost',v_rec_total));
  return jsonb_build_object('run_id',v_run_id,'run_number',v_run_number,'estimated_cost',v_rec_total);
end;
$$;

revoke all on function public.create_purchase_recommendation_run() from public, anon;
grant execute on function public.create_purchase_recommendation_run() to authenticated;

create or replace function public.confirm_purchase_recommendation(
  p_run_id uuid,
  p_items jsonb,
  p_notes text default ''
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.staff_role;
  v_run public.purchase_recommendation_runs%rowtype;
  v_item jsonb;
  v_product_id uuid;
  v_selected numeric(14,3);
  v_reason text;
  v_recommended numeric(14,3);
  v_cost numeric(14,2);
  v_selected_total numeric(14,2) := 0;
  v_changed integer := 0;
begin
  select role into v_role from public.profiles where id=v_actor and active;
  if v_role is null or v_role not in ('owner','manager','cashier','accountant') then
    raise exception 'Your staff role cannot confirm a shopping list';
  end if;
  select * into v_run from public.purchase_recommendation_runs where id=p_run_id for update;
  if not found then raise exception 'Shopping recommendation not found'; end if;
  if v_run.status <> 'draft' then raise exception 'Shopping recommendation is no longer editable'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'Shopping items are required'; end if;
  for v_item in select e from jsonb_array_elements(p_items) e loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_selected := coalesce((v_item->>'selected_qty')::numeric,0);
    v_reason := coalesce(nullif(trim(v_item->>'override_reason'),''),'');
    if v_selected < 0 then raise exception 'Selected quantity cannot be negative'; end if;
    select recommended_qty, unit_cost into v_recommended, v_cost
    from public.purchase_recommendation_items
    where run_id=p_run_id and product_id=v_product_id;
    if not found then raise exception 'Product is not part of this recommendation'; end if;
    if v_selected is distinct from v_recommended and v_reason = '' then
      raise exception 'Provide a reason when changing a recommended quantity';
    end if;
    update public.purchase_recommendation_items
    set selected_qty=v_selected,
        estimated_selected_cost=round(v_selected*v_cost,2),
        manual_override=(v_selected is distinct from v_recommended),
        override_reason=nullif(v_reason,'')
    where run_id=p_run_id and product_id=v_product_id;
    v_selected_total := v_selected_total + round(v_selected*v_cost,2);
    if v_selected is distinct from v_recommended then v_changed := v_changed + 1; end if;
  end loop;
  update public.purchase_recommendation_runs
  set status='confirmed',confirmed_by=v_actor,confirmed_at=now(),
      total_selected_cost=v_selected_total,notes=coalesce(p_notes,'')
  where id=p_run_id;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
  values(v_actor,'purchase_recommendation.confirmed','purchase_recommendation_run',p_run_id,
         jsonb_build_object('manual_changes',v_changed,'selected_cost',v_selected_total));
  return jsonb_build_object('run_id',p_run_id,'selected_cost',v_selected_total,'manual_changes',v_changed);
end;
$$;

revoke all on function public.confirm_purchase_recommendation(uuid,jsonb,text) from public, anon;
grant execute on function public.confirm_purchase_recommendation(uuid,jsonb,text) to authenticated;

commit;
