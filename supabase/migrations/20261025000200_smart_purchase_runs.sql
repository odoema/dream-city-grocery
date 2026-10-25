-- Dream City Grocery Smart Purchasing decision trail.
-- Depends on 20261025000100_smart_purchasing_read_model.sql and 20261024000500_management_alerts.sql.
-- Stores what the system recommended and what the worker actually chose.

begin;

create table if not exists public.purchase_recommendation_runs (
  id uuid primary key default gen_random_uuid(),
  run_number text not null unique,
  status text not null default 'draft' check (status in ('draft','confirmed','cancelled')),
  generated_by uuid not null references public.profiles(id),
  confirmed_by uuid references public.profiles(id),
  generated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  total_recommended_cost numeric(14,2) not null default 0 check (total_recommended_cost >= 0),
  total_selected_cost numeric(14,2) not null default 0 check (total_selected_cost >= 0),
  notes text not null default ''
);

create table if not exists public.purchase_recommendation_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.purchase_recommendation_runs(id) on delete restrict,
  product_id uuid not null references public.products(id),
  recommended_qty numeric(14,3) not null check (recommended_qty >= 0),
  selected_qty numeric(14,3) not null check (selected_qty >= 0),
  unit_cost numeric(14,2) not null default 0 check (unit_cost >= 0),
  estimated_recommended_cost numeric(14,2) not null default 0 check (estimated_recommended_cost >= 0),
  estimated_selected_cost numeric(14,2) not null default 0 check (estimated_selected_cost >= 0),
  reason text not null default '',
  manual_override boolean not null default false,
  override_reason text,
  created_at timestamptz not null default now(),
  unique(run_id, product_id)
);

create index if not exists purchase_recommendation_runs_created_idx
  on public.purchase_recommendation_runs(generated_at desc);
create index if not exists purchase_recommendation_items_run_idx
  on public.purchase_recommendation_items(run_id);

alter table public.purchase_recommendation_runs enable row level security;
alter table public.purchase_recommendation_items enable row level security;

create policy "authorized staff read purchase recommendation runs"
  on public.purchase_recommendation_runs for select to authenticated
  using (public.current_staff_role() in ('owner','manager','accountant'));
create policy "authorized staff read purchase recommendation items"
  on public.purchase_recommendation_items for select to authenticated
  using (exists (
    select 1 from public.purchase_recommendation_runs r
    where r.id = run_id
      and public.current_staff_role() in ('owner','manager','accountant')
  ));

create sequence if not exists public.purchase_recommendation_number_seq start 1;

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
  if v_role is null or v_role not in ('owner','manager','accountant') then
    raise exception 'Only authorized staff can create a shopping recommendation';
  end if;

  v_run_number := 'SHOP-'||to_char(current_date,'YYYYMMDD')||'-'||lpad(nextval('public.purchase_recommendation_number_seq')::text,4,'0');

  insert into public.purchase_recommendation_runs(run_number,generated_by)
  values(v_run_number,v_actor)
  returning id into v_run_id;

  for v_row in
    select * from public.smart_purchase_recommendations
    where recommended_qty > 0
    order by case recommendation_priority when 'urgent' then 1 when 'recommended' then 2 else 3 end,
             estimated_purchase_cost desc,
             product_name
  loop
    insert into public.purchase_recommendation_items(
      run_id,product_id,recommended_qty,selected_qty,unit_cost,
      estimated_recommended_cost,estimated_selected_cost,reason
    ) values (
      v_run_id,
      v_row.product_id,
      v_row.recommended_qty,
      v_row.recommended_qty,
      v_row.latest_known_buying_price,
      v_row.estimated_purchase_cost,
      v_row.estimated_purchase_cost,
      concat(
        initcap(v_row.recommendation_priority),
        ': selling about ',
        to_char(v_row.adjusted_daily_demand,'FM999999990D0'),
        '/day; ',
        to_char(v_row.quantity_on_hand,'FM999999990D0'),
        ' in stock; about ',
        coalesce(to_char(v_row.estimated_days_of_stock,'FM999999990D0'),'0'),
        ' days of stock remaining.'
      )
    );
    v_rec_total := v_rec_total + v_row.estimated_purchase_cost;
  end loop;

  update public.purchase_recommendation_runs
  set total_recommended_cost=v_rec_total,
      total_selected_cost=v_rec_total
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
  if v_role is null or v_role not in ('owner','manager','accountant') then
    raise exception 'Only authorized staff can confirm a shopping recommendation';
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
        override_reason=nullif(v_reason,'' )
    where run_id=p_run_id and product_id=v_product_id;

    v_selected_total := v_selected_total + round(v_selected*v_cost,2);
    if v_selected is distinct from v_recommended then v_changed := v_changed + 1; end if;
  end loop;

  update public.purchase_recommendation_runs
  set status='confirmed',
      confirmed_by=v_actor,
      confirmed_at=now(),
      total_selected_cost=v_selected_total,
      notes=coalesce(p_notes,'')
  where id=p_run_id;

  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
  values(v_actor,'purchase_recommendation.confirmed','purchase_recommendation_run',p_run_id,
         jsonb_build_object('manual_changes',v_changed,'selected_cost',v_selected_total));

  return jsonb_build_object('run_id',p_run_id,'selected_cost',v_selected_total,'manual_changes',v_changed);
end;
$$;

revoke all on function public.confirm_purchase_recommendation(uuid,jsonb,text) from public, anon;
grant execute on function public.confirm_purchase_recommendation(uuid,jsonb,text) to authenticated;

-- Queue the executive shopping summary separately from normal transaction alerts.
create or replace function public.queue_purchase_recommendation_email(p_run_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.staff_role;
  v_run public.purchase_recommendation_runs%rowtype;
  v_notification uuid;
  v_body text;
  v_lines text;
begin
  select role into v_role from public.profiles where id=v_actor and active;
  if v_role is null or v_role not in ('owner','manager','accountant') then
    raise exception 'Only authorized staff can send a shopping summary';
  end if;
  select * into v_run from public.purchase_recommendation_runs where id=p_run_id;
  if not found or v_run.status <> 'confirmed' then raise exception 'Confirm the shopping recommendation first'; end if;

  select string_agg(
    format('%s — recommended %s, selected %s, est. UGX %s%s',
      p.name,
      to_char(i.recommended_qty,'FM999999990D0'),
      to_char(i.selected_qty,'FM999999990D0'),
      to_char(i.estimated_selected_cost,'FM999G999G999G990D00'),
      case when i.manual_override then ' (manual change: '||coalesce(i.override_reason,'reason recorded')||')' else '' end
    ),
    E'\n'
    order by i.estimated_selected_cost desc
  ) into v_lines
  from public.purchase_recommendation_items i
  join public.products p on p.id=i.product_id
  where i.run_id=p_run_id and i.selected_qty>0;

  v_body := 'Dream City Grocery shopping recommendation'||E'\n\n'
    ||'Run: '||v_run.run_number||E'\n'
    ||'Date: '||to_char(v_run.generated_at,'YYYY-MM-DD')||E'\n'
    ||'Estimated selected shopping cost: UGX '||to_char(v_run.total_selected_cost,'FM999G999G999G990D00')||E'\n\n'
    ||coalesce(v_lines,'No items selected.')||E'\n\n'
    ||'This is a management information email. It does not itself create a purchase or change stock.';

  v_notification := public.queue_management_notification(
    'shopping_recommendation',
    'Shopping recommendation — '||v_run.run_number,
    v_body,
    jsonb_build_object('run_id',p_run_id,'run_number',v_run.run_number,'selected_cost',v_run.total_selected_cost)
  );

  return v_notification;
end;
$$;

revoke all on function public.queue_purchase_recommendation_email(uuid) from public, anon;
grant execute on function public.queue_purchase_recommendation_email(uuid) to authenticated;

commit;
