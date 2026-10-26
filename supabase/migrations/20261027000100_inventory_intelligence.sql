-- =============================================================================
-- Inventory management & intelligence (Loyverse "Advanced Inventory" parity)
-- -----------------------------------------------------------------------------
-- Additive and idempotent. Requires 20261026000100_white_label_platform.sql.
--   * Stock adjustments with reasons (damaged, expired, lost/stolen, own use,
--     found, correction...) posted to stock AND the books
--   * Returns to supplier (stock out; refund or credit against payables)
--   * Automatic low-stock / out-of-stock management alerts
--   * get_inventory_intelligence(): valuation, demand, days of cover, ABC
--     class, dead stock, overstock, margin problems — per product
--   * get_sales_by_item(): sales/profit by product and by category
-- =============================================================================
begin;

-- ---------------------------------------------------------------------------
-- 1. Stock adjustments
-- ---------------------------------------------------------------------------
create sequence if not exists public.stock_adjustment_number_seq start 1;

create table if not exists public.stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  adjustment_number text not null unique,
  reason text not null check (reason in ('damaged','expired','lost_stolen','own_use','sample','found','correction','other')),
  notes text not null default '',
  total_value numeric(14,2) not null default 0,
  journal_id uuid references public.journals(id),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create table if not exists public.stock_adjustment_items (
  id uuid primary key default gen_random_uuid(),
  adjustment_id uuid not null references public.stock_adjustments(id) on delete restrict,
  product_id uuid not null references public.products(id),
  quantity_before numeric(14,3) not null,
  quantity_delta numeric(14,3) not null check (quantity_delta <> 0),
  quantity_after numeric(14,3) not null check (quantity_after >= 0),
  unit_cost numeric(14,2) not null default 0,
  line_value numeric(14,2) not null default 0
);
create index if not exists stock_adjustments_created_idx on public.stock_adjustments(created_at desc);
create index if not exists stock_adjustment_items_adj_idx on public.stock_adjustment_items(adjustment_id);

alter table public.stock_adjustments enable row level security;
alter table public.stock_adjustment_items enable row level security;
drop policy if exists "managers read stock adjustments" on public.stock_adjustments;
create policy "managers read stock adjustments" on public.stock_adjustments for select to authenticated
  using (public.current_staff_role() in ('owner','manager','accountant'));
drop policy if exists "managers read stock adjustment items" on public.stock_adjustment_items;
create policy "managers read stock adjustment items" on public.stock_adjustment_items for select to authenticated
  using (public.current_staff_role() in ('owner','manager','accountant'));
grant select on public.stock_adjustments, public.stock_adjustment_items to authenticated;

-- p_items: [{product_id, quantity_delta}] or [{product_id, new_quantity}]
create or replace function public.adjust_stock(p_reason text, p_items jsonb, p_notes text default '')
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := public.require_staff(array['owner','manager']::public.staff_role[]);
  v_id uuid := gen_random_uuid();
  v_number text;
  v_item jsonb;
  v_product public.products%rowtype;
  v_delta numeric(14,3);
  v_after numeric(14,3);
  v_value numeric(14,2);
  v_gain numeric(14,2) := 0;
  v_loss numeric(14,2) := 0;
  v_lines integer := 0;
  v_journal uuid;
begin
  if p_reason not in ('damaged','expired','lost_stolen','own_use','sample','found','correction','other') then
    raise exception 'Choose a reason for the adjustment';
  end if;
  if p_reason in ('other','correction') and nullif(trim(p_notes),'') is null then
    raise exception 'Add a note explaining this adjustment';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one product';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) e group by (e->>'product_id') having count(*) > 1) then
    raise exception 'Each product may appear only once';
  end if;

  v_number := 'ADJ-' || to_char(current_date,'YYYYMMDD') || '-' || lpad(nextval('public.stock_adjustment_number_seq')::text,4,'0');
  insert into public.stock_adjustments(id, adjustment_number, reason, notes, created_by)
  values (v_id, v_number, p_reason, coalesce(p_notes,''), v_actor);

  for v_item in select e from jsonb_array_elements(p_items) e order by (e->>'product_id')::uuid loop
    select * into v_product from public.products where id = (v_item->>'product_id')::uuid for update;
    if not found then raise exception 'Product not found'; end if;
    if not v_product.track_stock then raise exception '% does not track stock', v_product.name; end if;
    if v_item ? 'new_quantity' then
      v_after := (v_item->>'new_quantity')::numeric;
      v_delta := v_after - v_product.quantity_on_hand;
    else
      v_delta := (v_item->>'quantity_delta')::numeric;
      v_after := v_product.quantity_on_hand + v_delta;
    end if;
    if v_delta is null then raise exception 'Enter a quantity for %', v_product.name; end if;
    if v_delta = 0 then continue; end if;
    if v_after < 0 then raise exception 'Cannot remove more % than is in stock (%)', v_product.name, v_product.quantity_on_hand; end if;
    if not v_product.sold_by_weight and (v_delta <> trunc(v_delta)) then raise exception '% is counted in whole units', v_product.name; end if;
    if p_reason in ('damaged','expired','lost_stolen','own_use','sample') and v_delta > 0 then
      raise exception 'A "%" adjustment can only remove stock (%)', replace(p_reason,'_',' '), v_product.name;
    end if;
    if p_reason = 'found' and v_delta < 0 then raise exception 'A "found" adjustment can only add stock (%)', v_product.name; end if;

    v_value := round(abs(v_delta) * v_product.buying_price, 2);
    if v_delta > 0 then v_gain := v_gain + v_value; else v_loss := v_loss + v_value; end if;
    update public.products set quantity_on_hand = v_after, updated_at = now() where id = v_product.id;
    insert into public.inventory_movements(product_id,movement_type,quantity_delta,unit_cost,reference_type,reference_id,note,created_by)
    values (v_product.id,'adjustment',v_delta,v_product.buying_price,'stock_adjustment',v_id,v_number || ' ' || replace(p_reason,'_',' '),v_actor);
    insert into public.stock_adjustment_items(adjustment_id,product_id,quantity_before,quantity_delta,quantity_after,unit_cost,line_value)
    values (v_id, v_product.id, v_product.quantity_on_hand, v_delta, v_after, v_product.buying_price, case when v_delta > 0 then v_value else -v_value end);
    v_lines := v_lines + 1;
  end loop;
  if v_lines = 0 then raise exception 'Nothing changed — every quantity already matches'; end if;

  if v_gain > 0 or v_loss > 0 then
    insert into public.journals(source_type,source_id,memo,created_by)
    values ('stock_adjustment', v_id, v_number || ' ' || replace(p_reason,'_',' '), v_actor) returning id into v_journal;
    if v_gain > 0 then
      insert into public.journal_lines(journal_id,account_id,description,debit,credit)
      values (v_journal, public.account_id('1200'), 'Stock added', v_gain, 0),
             (v_journal, public.account_id('4100'), 'Inventory adjustment gain', 0, v_gain);
    end if;
    if v_loss > 0 then
      insert into public.journal_lines(journal_id,account_id,description,debit,credit)
      values (v_journal, public.account_id('6100'), 'Stock written off: ' || replace(p_reason,'_',' '), v_loss, 0),
             (v_journal, public.account_id('1200'), 'Stock removed', 0, v_loss);
    end if;
    perform public.assert_journal_balanced(v_journal);
  end if;

  update public.stock_adjustments set total_value = v_gain - v_loss, journal_id = v_journal where id = v_id;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
  values (v_actor,'stock.adjusted','stock_adjustment',v_id,jsonb_build_object('number',v_number,'reason',p_reason,'gain',v_gain,'loss',v_loss,'lines',v_lines));
  if v_loss >= 50000 then
    perform public.queue_management_notification('stock_loss', 'Stock written off — ' || v_number,
      replace(p_reason,'_',' ') || ': ' || to_char(v_loss,'FM999G999G999G990') || ' at cost. ' || coalesce(nullif(p_notes,''),''),
      jsonb_build_object('adjustment_id',v_id,'loss',v_loss,'reason',p_reason));
  end if;
  return jsonb_build_object('id',v_id,'adjustment_number',v_number,'lines',v_lines,'gain',v_gain,'loss',v_loss,'journal_id',v_journal);
end;
$$;
revoke all on function public.adjust_stock(text,jsonb,text) from public, anon;
grant execute on function public.adjust_stock(text,jsonb,text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Returns to supplier
-- ---------------------------------------------------------------------------
create sequence if not exists public.supplier_return_number_seq start 1;
create table if not exists public.supplier_returns (
  id uuid primary key default gen_random_uuid(),
  return_number text not null unique,
  supplier_id uuid not null references public.suppliers(id),
  settlement public.payment_method not null,   -- 'credit' = deducted from what we owe
  reference text not null default '',
  notes text not null default '',
  total numeric(14,2) not null default 0,
  journal_id uuid references public.journals(id),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create table if not exists public.supplier_return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.supplier_returns(id) on delete restrict,
  product_id uuid not null references public.products(id),
  quantity numeric(14,3) not null check (quantity > 0),
  unit_cost numeric(14,2) not null check (unit_cost >= 0),
  line_total numeric(14,2) not null
);
alter table public.supplier_returns enable row level security;
alter table public.supplier_return_items enable row level security;
drop policy if exists "managers read supplier returns" on public.supplier_returns;
create policy "managers read supplier returns" on public.supplier_returns for select to authenticated
  using (public.current_staff_role() in ('owner','manager','accountant'));
drop policy if exists "managers read supplier return items" on public.supplier_return_items;
create policy "managers read supplier return items" on public.supplier_return_items for select to authenticated
  using (public.current_staff_role() in ('owner','manager','accountant'));
grant select on public.supplier_returns, public.supplier_return_items to authenticated;

create or replace function public.return_to_supplier(
  p_supplier_id uuid, p_items jsonb, p_settlement public.payment_method, p_reference text default '', p_notes text default ''
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := public.require_staff(array['owner','manager','accountant']::public.staff_role[]);
  v_id uuid := gen_random_uuid();
  v_number text;
  v_item jsonb;
  v_product public.products%rowtype;
  v_qty numeric(14,3);
  v_cost numeric(14,2);
  v_total numeric(14,2) := 0;
  v_journal uuid;
  v_name text;
begin
  select name into v_name from public.suppliers where id = p_supplier_id;
  if v_name is null then raise exception 'Choose the supplier'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Add at least one product'; end if;
  if exists (select 1 from jsonb_array_elements(p_items) e group by (e->>'product_id') having count(*) > 1) then
    raise exception 'Each product may appear only once';
  end if;
  v_number := 'RTN-' || to_char(current_date,'YYYYMMDD') || '-' || lpad(nextval('public.supplier_return_number_seq')::text,4,'0');
  insert into public.supplier_returns(id,return_number,supplier_id,settlement,reference,notes,created_by)
  values (v_id,v_number,p_supplier_id,p_settlement,coalesce(trim(p_reference),''),coalesce(p_notes,''),v_actor);
  for v_item in select e from jsonb_array_elements(p_items) e order by (e->>'product_id')::uuid loop
    select * into v_product from public.products where id = (v_item->>'product_id')::uuid for update;
    if not found then raise exception 'Product not found'; end if;
    v_qty := (v_item->>'quantity')::numeric;
    v_cost := coalesce((v_item->>'unit_cost')::numeric, v_product.buying_price);
    if v_qty is null or v_qty <= 0 then raise exception 'Enter a quantity for %', v_product.name; end if;
    if v_cost < 0 then raise exception 'Cost cannot be negative'; end if;
    if v_product.track_stock and v_qty > v_product.quantity_on_hand then
      raise exception 'Only % of % in stock', v_product.quantity_on_hand, v_product.name;
    end if;
    if v_product.track_stock then
      update public.products set quantity_on_hand = quantity_on_hand - v_qty, updated_at = now() where id = v_product.id;
      insert into public.inventory_movements(product_id,movement_type,quantity_delta,unit_cost,reference_type,reference_id,note,created_by)
      values (v_product.id,'purchase_return',-v_qty,v_cost,'supplier_return',v_id,v_number || ' to ' || v_name,v_actor);
    end if;
    insert into public.supplier_return_items(return_id,product_id,quantity,unit_cost,line_total)
    values (v_id,v_product.id,v_qty,v_cost,round(v_qty*v_cost,2));
    v_total := v_total + round(v_qty*v_cost,2);
  end loop;
  if v_total > 0 then
    insert into public.journals(source_type,source_id,memo,created_by)
    values ('supplier_return',v_id,v_number || ' returned to ' || v_name,v_actor) returning id into v_journal;
    insert into public.journal_lines(journal_id,account_id,description,debit,credit)
    values (v_journal, public.account_id(case when p_settlement = 'credit' then '2000' else public.payment_account_code(p_settlement) end),
            case when p_settlement = 'credit' then 'Credit from supplier' else 'Refund from supplier' end, v_total, 0),
           (v_journal, public.account_id('1200'), 'Goods returned to supplier', 0, v_total);
    perform public.assert_journal_balanced(v_journal);
  end if;
  update public.supplier_returns set total = v_total, journal_id = v_journal where id = v_id;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
  values (v_actor,'supplier.return','supplier_return',v_id,jsonb_build_object('number',v_number,'supplier',v_name,'total',v_total,'settlement',p_settlement));
  return jsonb_build_object('id',v_id,'return_number',v_number,'total',v_total);
end;
$$;
revoke all on function public.return_to_supplier(uuid,jsonb,public.payment_method,text,text) from public, anon;
grant execute on function public.return_to_supplier(uuid,jsonb,public.payment_method,text,text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Automatic low-stock / out-of-stock alerts (only when the level is crossed)
-- ---------------------------------------------------------------------------
create or replace function public.notify_low_stock()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if not new.active or not new.track_stock then return new; end if;
  if new.quantity_on_hand <= 0 and old.quantity_on_hand > 0 then
    perform public.queue_management_notification('out_of_stock', 'Out of stock — ' || new.name,
      new.name || ' (' || new.sku || ') has run out.',
      jsonb_build_object('product_id', new.id, 'sku', new.sku, 'quantity', new.quantity_on_hand));
  elsif new.reorder_level > 0 and new.quantity_on_hand <= new.reorder_level and old.quantity_on_hand > new.reorder_level then
    perform public.queue_management_notification('low_stock', 'Low stock — ' || new.name,
      new.name || ' is down to ' || to_char(new.quantity_on_hand,'FM999G999G990D###') || ' (alert level ' || to_char(new.reorder_level,'FM999G999G990D###') || ').',
      jsonb_build_object('product_id', new.id, 'sku', new.sku, 'quantity', new.quantity_on_hand, 'reorder_level', new.reorder_level));
  end if;
  return new;
end;
$$;
drop trigger if exists products_low_stock_alert on public.products;
create trigger products_low_stock_alert after update of quantity_on_hand on public.products
  for each row when (new.quantity_on_hand is distinct from old.quantity_on_hand)
  execute function public.notify_low_stock();
revoke all on function public.notify_low_stock() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Inventory intelligence (one call, everything the Inventory screen needs)
-- ---------------------------------------------------------------------------
create or replace function public.get_inventory_intelligence(p_days integer default 30)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_days integer := greatest(7, least(coalesce(p_days,30), 365));
  v_cover numeric := coalesce((select stock_cover_days from public.store_settings where id), 5);
  v_since timestamptz := now() - make_interval(days => v_days);
  v_result jsonb;
begin
  perform public.require_staff(array['owner','manager','accountant']::public.staff_role[]);
  with sold as (
    select si.product_id, sum(si.quantity) qty, sum(si.line_total) revenue, sum(si.line_total - si.line_cost) profit, max(s.created_at) last_sold
    from public.sale_items si join public.sales s on s.id = si.sale_id
    where s.status = 'completed' and s.created_at >= v_since
    group by si.product_id
  ), legacy as (
    select product_id,
      sum(case when receipt_type = 'refund' then -quantity else quantity end) qty,
      sum(case when receipt_type = 'refund' then -net_sales else net_sales end) revenue,
      max(sold_at) last_sold
    from public.legacy_sales_lines
    where product_id is not null and sold_at >= v_since
    group by product_id
  ), ever as (
    select si.product_id, max(s.created_at) last_sold
    from public.sale_items si join public.sales s on s.id = si.sale_id where s.status = 'completed'
    group by si.product_id
  ), base as (
    select p.id, p.name, p.sku, p.unit, p.image_path, coalesce(c.name,'Uncategorised') category,
      p.quantity_on_hand qty, p.buying_price cost, p.selling_price price, p.reorder_level, p.track_stock,
      coalesce(s.qty,0) + coalesce(l.qty,0) units_sold,
      coalesce(s.revenue,0) + coalesce(l.revenue,0) revenue,
      coalesce(s.profit,0) + coalesce(l.revenue,0) - coalesce(l.qty,0) * p.buying_price profit,
      greatest(s.last_sold, l.last_sold, e.last_sold) last_sold
    from public.products p
    left join public.categories c on c.id = p.category_id
    left join sold s on s.product_id = p.id
    left join legacy l on l.product_id = p.id
    left join ever e on e.product_id = p.id
    where p.active
  ), metrics as (
    select b.*,
      round(b.units_sold / v_days, 3) per_day,
      case when b.units_sold > 0 then round(b.qty / (b.units_sold / v_days), 1) end days_cover,
      round(b.qty * b.cost, 2) stock_cost,
      round(b.qty * b.price, 2) stock_retail,
      case when b.price > 0 then round((b.price - b.cost) / b.price * 100, 1) end margin_pct
    from base b
  ), ranked as (
    select m.*,
      sum(m.revenue) over (order by m.revenue desc, m.id rows between unbounded preceding and current row) cum_rev,
      sum(m.revenue) over () total_rev
    from metrics m
  ), classified as (
    select r.*,
      case when r.revenue <= 0 then 'D'
           when r.cum_rev - r.revenue < r.total_rev * 0.8 then 'A'
           when r.cum_rev - r.revenue < r.total_rev * 0.95 then 'B'
           else 'C' end abc,
      array_remove(array[
        case when r.track_stock and r.qty <= 0 then 'out' end,
        case when r.track_stock and r.qty > 0 and r.qty <= r.reorder_level then 'low' end,
        case when r.track_stock and r.qty > 0 and r.units_sold = 0 then 'dead' end,
        case when r.track_stock and r.days_cover is not null and r.days_cover > greatest(v_cover * 6, 30) then 'overstock' end,
        case when r.price > 0 and r.cost > r.price then 'loss_making' end,
        case when r.price <= 0 then 'no_price' end,
        case when r.cost <= 0 and r.track_stock then 'no_cost' end,
        case when r.track_stock and r.days_cover is not null and r.days_cover < v_cover and r.qty > 0 then 'running_out' end
      ], null) flags
    from ranked r
  )
  select jsonb_build_object(
    'days', v_days, 'cover_days', v_cover, 'generated_at', now(),
    'summary', (select jsonb_build_object(
        'products', count(*),
        'stock_cost', coalesce(sum(stock_cost) filter (where track_stock and qty > 0),0),
        'stock_retail', coalesce(sum(stock_retail) filter (where track_stock and qty > 0),0),
        'potential_profit', coalesce(sum(stock_retail - stock_cost) filter (where track_stock and qty > 0),0),
        'units_on_hand', coalesce(sum(qty) filter (where track_stock and qty > 0),0),
        'revenue', coalesce(sum(revenue),0),
        'profit', coalesce(sum(profit),0),
        'out', count(*) filter (where 'out' = any(flags)),
        'low', count(*) filter (where 'low' = any(flags)),
        'running_out', count(*) filter (where 'running_out' = any(flags)),
        'dead', count(*) filter (where 'dead' = any(flags)),
        'dead_value', coalesce(sum(stock_cost) filter (where 'dead' = any(flags)),0),
        'overstock', count(*) filter (where 'overstock' = any(flags)),
        'loss_making', count(*) filter (where 'loss_making' = any(flags)),
        'no_price', count(*) filter (where 'no_price' = any(flags)),
        'no_cost', count(*) filter (where 'no_cost' = any(flags)),
        'abc', jsonb_build_object('A', count(*) filter (where abc='A'), 'B', count(*) filter (where abc='B'), 'C', count(*) filter (where abc='C'), 'D', count(*) filter (where abc='D'))
      ) from classified),
    'by_category', coalesce((select jsonb_agg(x order by (x->>'stock_cost')::numeric desc) from (
        select jsonb_build_object('category', category, 'products', count(*),
          'stock_cost', coalesce(sum(stock_cost) filter (where track_stock and qty > 0),0),
          'stock_retail', coalesce(sum(stock_retail) filter (where track_stock and qty > 0),0),
          'revenue', sum(revenue), 'profit', sum(profit), 'units_sold', sum(units_sold)) x
        from classified group by category) q), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'sku', sku, 'unit', unit, 'category', category, 'image_path', image_path,
        'qty', qty, 'cost', cost, 'price', price, 'reorder_level', reorder_level, 'track_stock', track_stock,
        'units_sold', units_sold, 'revenue', revenue, 'profit', profit, 'per_day', per_day,
        'days_cover', days_cover, 'stock_cost', stock_cost, 'stock_retail', stock_retail,
        'margin_pct', margin_pct, 'last_sold', last_sold, 'abc', abc, 'flags', to_jsonb(flags))
        order by revenue desc, name) from classified), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.get_inventory_intelligence(integer) from public, anon;
grant execute on function public.get_inventory_intelligence(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Sales by item / by category
-- ---------------------------------------------------------------------------
create or replace function public.get_sales_by_item(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_actor uuid := public.require_staff();
  v_all boolean := public.current_staff_role() in ('owner','manager','accountant');
begin
  return (
    with lines as (
      select si.product_id, si.product_name, si.sku, coalesce(c.name,'Uncategorised') category,
             si.quantity, si.line_total, si.line_cost, s.status
      from public.sale_items si
      join public.sales s on s.id = si.sale_id
      left join public.products p on p.id = si.product_id
      left join public.categories c on c.id = p.category_id
      where s.created_at >= p_from and s.created_at < p_to and (v_all or s.cashier_id = v_actor)
    )
    select jsonb_build_object(
      'items', coalesce((select jsonb_agg(x order by (x->>'revenue')::numeric desc) from (
        select jsonb_build_object('product_id', product_id, 'name', max(product_name), 'sku', max(sku), 'category', max(category),
          'quantity', sum(quantity) filter (where status = 'completed'),
          'revenue', coalesce(sum(line_total) filter (where status = 'completed'),0),
          'cost', coalesce(sum(line_cost) filter (where status = 'completed'),0),
          'profit', coalesce(sum(line_total - line_cost) filter (where status = 'completed'),0),
          'refunded_qty', coalesce(sum(quantity) filter (where status = 'refunded'),0)) x
        from lines group by product_id) q), '[]'::jsonb),
      'categories', coalesce((select jsonb_agg(x order by (x->>'revenue')::numeric desc) from (
        select jsonb_build_object('category', category,
          'quantity', coalesce(sum(quantity) filter (where status = 'completed'),0),
          'revenue', coalesce(sum(line_total) filter (where status = 'completed'),0),
          'profit', coalesce(sum(line_total - line_cost) filter (where status = 'completed'),0)) x
        from lines group by category) q), '[]'::jsonb)
    )
  );
end;
$$;
revoke all on function public.get_sales_by_item(timestamptz,timestamptz) from public, anon;
grant execute on function public.get_sales_by_item(timestamptz,timestamptz) to authenticated;

commit;
