-- Dream City Grocery stock-taking and reconciliation.
-- Additive migration: preserves sales, purchases, inventory movements and existing balances.
-- Apply only to Supabase project nohdgmylncjtdymfshfy.
begin;

insert into public.accounts(code,name,type)
values ('4100','Inventory Adjustment Gain','revenue'),
       ('6100','Inventory Shrinkage / Stock Loss','expense')
on conflict(code) do nothing;

create table public.stocktake_sessions (
  id uuid primary key default gen_random_uuid(),
  session_number text not null unique,
  status text not null default 'draft' check(status in ('draft','completed','cancelled')),
  notes text not null default '',
  started_by uuid not null references public.profiles(id),
  completed_by uuid references public.profiles(id),
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.stocktake_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.stocktake_sessions(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  system_quantity numeric(14,3) not null check(system_quantity >= 0),
  counted_quantity numeric(14,3) check(counted_quantity >= 0),
  unit_cost numeric(14,2) not null default 0 check(unit_cost >= 0),
  counted_by uuid references public.profiles(id),
  counted_at timestamptz,
  unique(session_id,product_id)
);

create index stocktake_sessions_started_idx on public.stocktake_sessions(started_at desc);
create index stocktake_items_session_idx on public.stocktake_items(session_id,product_id);

alter table public.stocktake_sessions enable row level security;
alter table public.stocktake_items enable row level security;

create policy "authorized staff read stocktake sessions"
on public.stocktake_sessions for select to authenticated
using (public.current_staff_role() in ('owner','manager','accountant'));

create policy "authorized staff read stocktake items"
on public.stocktake_items for select to authenticated
using (public.current_staff_role() in ('owner','manager','accountant'));

create or replace function public.start_stocktake(p_notes text default '')
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.staff_role;
  v_id uuid;
  v_number text;
  v_count integer;
begin
  select role into v_role from public.profiles where id=v_actor and active;
  if v_actor is null or v_role is null or v_role not in ('owner','manager','accountant') then
    raise exception 'Only owner, manager or accountant can start stock-taking';
  end if;
  if exists(select 1 from public.stocktake_sessions where status='draft') then
    raise exception 'A stock-taking session is already open. Complete or cancel it before starting another.';
  end if;
  v_number := 'ST-'||to_char(current_date,'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
  insert into public.stocktake_sessions(session_number,notes,started_by)
  values(v_number,coalesce(p_notes,''),v_actor) returning id into v_id;

  insert into public.stocktake_items(session_id,product_id,system_quantity,unit_cost)
  select v_id,p.id,p.quantity_on_hand,p.buying_price
  from public.products p where p.active order by p.name;
  get diagnostics v_count = row_count;
  if v_count=0 then raise exception 'No active products found. Add products before starting stock-taking.'; end if;

  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
  values(v_actor,'stocktake.started','stocktake_session',v_id,jsonb_build_object('session_number',v_number,'product_count',v_count));
  return jsonb_build_object('id',v_id,'session_number',v_number,'product_count',v_count);
end;
$$;

create or replace function public.record_stocktake_count(
  p_session_id uuid,
  p_product_id uuid,
  p_counted_quantity numeric
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.staff_role;
  v_item public.stocktake_items%rowtype;
begin
  select role into v_role from public.profiles where id=v_actor and active;
  if v_actor is null or v_role is null or v_role not in ('owner','manager','accountant') then
    raise exception 'Only owner, manager or accountant can enter stock counts';
  end if;
  if p_counted_quantity is null or p_counted_quantity<0
     or p_counted_quantity='NaN'::numeric or p_counted_quantity='Infinity'::numeric
     or p_counted_quantity='-Infinity'::numeric then
    raise exception 'Counted quantity must be a finite number equal to or greater than zero';
  end if;
  perform 1 from public.stocktake_sessions where id=p_session_id and status='draft' for update;
  if not found then raise exception 'Open stock-taking session not found'; end if;
  update public.stocktake_items set counted_quantity=p_counted_quantity,counted_by=v_actor,counted_at=now()
  where session_id=p_session_id and product_id=p_product_id;
  if not found then raise exception 'Product is not part of this stock-taking session'; end if;
  select * into v_item from public.stocktake_items where session_id=p_session_id and product_id=p_product_id;
  return jsonb_build_object('product_id',p_product_id,'system_quantity',v_item.system_quantity,'counted_quantity',v_item.counted_quantity,'variance',v_item.counted_quantity-v_item.system_quantity);
end;
$$;

create or replace function public.finalize_stocktake(p_session_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.staff_role;
  v_session public.stocktake_sessions%rowtype;
  v_item public.stocktake_items%rowtype;
  v_inventory_account uuid;
  v_gain_account uuid;
  v_loss_account uuid;
  v_journal_id uuid;
  v_surplus numeric(14,2):=0;
  v_shortage numeric(14,2):=0;
  v_delta numeric(14,3);
  v_value numeric(14,2);
  v_count integer;
begin
  select role into v_role from public.profiles where id=v_actor and active;
  if v_actor is null or v_role is null or v_role not in ('owner','manager','accountant') then
    raise exception 'Only owner, manager or accountant can approve stock reconciliation';
  end if;
  select * into v_session from public.stocktake_sessions where id=p_session_id for update;
  if not found or v_session.status<>'draft' then raise exception 'Open stock-taking session not found'; end if;
  if exists(select 1 from public.stocktake_items where session_id=p_session_id and counted_quantity is null) then
    raise exception 'Every product must be counted before finalizing. Count zero when a product is out of stock.';
  end if;

  -- Lock all products before posting to avoid overwriting a concurrent stock update.
  perform p.id from public.products p
  join public.stocktake_items i on i.product_id=p.id
  where i.session_id=p_session_id order by p.id for update of p;

  -- This is a physical count cutoff: finalize when sales/receiving are paused.
  -- If transactions occurred after the session started, the owner should cancel and recount.
  select count(*) into v_count
  from public.stocktake_items i
  join public.products p on p.id=i.product_id
  where i.session_id=p_session_id and p.quantity_on_hand<>i.system_quantity;
  if v_count>0 then
    raise exception 'Stock changed after counting began. Pause sales/receiving and start a fresh stocktake before finalizing.';
  end if;

  select id into v_inventory_account from public.accounts where code='1200' and active;
  select id into v_gain_account from public.accounts where code='4100' and active;
  select id into v_loss_account from public.accounts where code='6100' and active;
  if v_inventory_account is null or v_gain_account is null or v_loss_account is null then
    raise exception 'Inventory adjustment accounts are missing';
  end if;

  for v_item in select * from public.stocktake_items where session_id=p_session_id order by product_id loop
    v_delta:=v_item.counted_quantity-v_item.system_quantity;
    if v_delta<>0 then
      v_value:=round(abs(v_delta)*v_item.unit_cost,2);
      if v_delta>0 then v_surplus:=v_surplus+v_value; else v_shortage:=v_shortage+v_value; end if;
      update public.products set quantity_on_hand=v_item.counted_quantity,updated_at=now() where id=v_item.product_id;
      insert into public.inventory_movements(product_id,movement_type,quantity_delta,unit_cost,reference_type,reference_id,note,created_by)
      values(v_item.product_id,'adjustment',v_delta,v_item.unit_cost,'stocktake',p_session_id,
        'Physical stocktake '||v_session.session_number,v_actor);
    end if;
  end loop;

  if v_surplus>0 or v_shortage>0 then
    insert into public.journals(source_type,source_id,memo,created_by)
    values('stocktake',p_session_id,'Stock reconciliation '||v_session.session_number,v_actor)
    returning id into v_journal_id;
    if v_surplus>0 then
      insert into public.journal_lines(journal_id,account_id,description,debit,credit)
      values(v_journal_id,v_inventory_account,'Inventory surplus',v_surplus,0),
            (v_journal_id,v_gain_account,'Inventory adjustment gain',0,v_surplus);
    end if;
    if v_shortage>0 then
      insert into public.journal_lines(journal_id,account_id,description,debit,credit)
      values(v_journal_id,v_loss_account,'Inventory shortage / shrinkage',v_shortage,0),
            (v_journal_id,v_inventory_account,'Inventory reduction',0,v_shortage);
    end if;
  end if;

  update public.stocktake_sessions set status='completed',completed_by=v_actor,completed_at=now() where id=p_session_id;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
  values(v_actor,'stocktake.completed','stocktake_session',p_session_id,
    jsonb_build_object('session_number',v_session.session_number,'surplus_value',v_surplus,'shortage_value',v_shortage,'journal_id',v_journal_id));
  return jsonb_build_object('id',p_session_id,'session_number',v_session.session_number,
    'status','completed','surplus_value',v_surplus,'shortage_value',v_shortage,'journal_id',v_journal_id);
end;
$$;

revoke all on function public.start_stocktake(text) from public, anon;
revoke all on function public.record_stocktake_count(uuid,uuid,numeric) from public, anon;
revoke all on function public.finalize_stocktake(uuid) from public, anon;
grant execute on function public.start_stocktake(text) to authenticated;
grant execute on function public.record_stocktake_count(uuid,uuid,numeric) to authenticated;
grant execute on function public.finalize_stocktake(uuid) to authenticated;

commit;
