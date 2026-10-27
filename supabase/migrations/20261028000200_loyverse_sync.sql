-- =============================================================================
-- Loyverse live sync (Loyverse stays the till; this app mirrors it)
-- -----------------------------------------------------------------------------
-- The Edge Function `loyverse-sync` reads the Loyverse API with the
-- LOYVERSE_TOKEN secret and hands normalised data to loyverse_sync_apply():
--   1. items      -> products (name, SKU, barcode, category, price, cost)
--   2. receipts   -> sales / returns (books, stock, Close day, Dashboard)
--   3. stock      -> products.quantity_on_hand aligned to Loyverse's count
-- Everything is idempotent: running it twice changes nothing.
-- Only the service role (the Edge Function) can call the apply functions.
-- Never run against SmartAttend.
-- =============================================================================
begin;

alter table public.sales add column if not exists source_system text;

create table if not exists public.loyverse_sync_state (
  id boolean primary key default true check (id),
  enabled boolean not null default true,
  receipts_since timestamptz not null default (date_trunc('day', now() at time zone 'Africa/Kampala') at time zone 'Africa/Kampala'),
  last_started_at timestamptz,
  last_finished_at timestamptz,
  last_result jsonb not null default '{}'::jsonb,
  last_error text not null default ''
);
insert into public.loyverse_sync_state(id) values (true) on conflict (id) do nothing;
alter table public.loyverse_sync_state enable row level security;
drop policy if exists "managers read sync state" on public.loyverse_sync_state;
create policy "managers read sync state" on public.loyverse_sync_state for select to authenticated
  using (public.current_staff_role() in ('owner','manager','accountant'));
grant select on public.loyverse_sync_state to authenticated;

create table if not exists public.loyverse_receipts_seen (
  receipt_number text primary key,
  kind text not null,
  sale_id uuid references public.sales(id),
  note text not null default '',
  processed_at timestamptz not null default now()
);
alter table public.loyverse_receipts_seen enable row level security;
drop policy if exists "managers read seen receipts" on public.loyverse_receipts_seen;
create policy "managers read seen receipts" on public.loyverse_receipts_seen for select to authenticated
  using (public.current_staff_role() in ('owner','manager','accountant'));
grant select on public.loyverse_receipts_seen to authenticated;

-- Act as the shop owner so the normal rules (require_staff, audit) work.
create or replace function public.loyverse_act_as_owner()
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_owner uuid;
begin
  select id into v_owner from public.profiles where role = 'owner' and active order by created_at limit 1;
  if v_owner is null then raise exception 'No active owner to record Loyverse data under'; end if;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  return v_owner;
end;
$$;
revoke all on function public.loyverse_act_as_owner() from public, anon, authenticated;

-- Start of a run: throttle (one run per 50 s) and tell the function where to read from.
create or replace function public.loyverse_sync_begin()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v public.loyverse_sync_state%rowtype;
begin
  select * into v from public.loyverse_sync_state where id for update;
  if not v.enabled then return jsonb_build_object('run', false, 'reason', 'disabled'); end if;
  if v.last_started_at is not null and v.last_started_at > now() - interval '50 seconds' then
    return jsonb_build_object('run', false, 'reason', 'ran less than a minute ago');
  end if;
  update public.loyverse_sync_state set last_started_at = now() where id;
  -- Re-read three hours back: tills that were offline upload late. Seen receipts are skipped.
  return jsonb_build_object('run', true, 'receipts_since', v.receipts_since - interval '3 hours');
end;
$$;
revoke all on function public.loyverse_sync_begin() from public, anon, authenticated;
grant execute on function public.loyverse_sync_begin() to service_role;

create or replace function public.loyverse_sync_fail(p_error text)
returns void language sql security definer set search_path = ''
as $$
  update public.loyverse_sync_state set last_finished_at = now(), last_error = left(coalesce(p_error,''), 2000) where id;
$$;
revoke all on function public.loyverse_sync_fail(text) from public, anon, authenticated;
grant execute on function public.loyverse_sync_fail(text) to service_role;

-- Find (or create) the product for a Loyverse variant.
create or replace function public.loyverse_product(p_variant_id text, p_sku text, p_name text, p_price numeric default 0, p_cost numeric default 0)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_id uuid; v_sku text := nullif(trim(p_sku),'');
begin
  if nullif(p_variant_id,'') is not null then
    select id into v_id from public.products where source_system = 'loyverse' and source_item_id = p_variant_id;
  end if;
  if v_id is null and v_sku is not null then
    select id into v_id from public.products where sku = v_sku;
  end if;
  if v_id is null and nullif(trim(p_name),'') is not null then
    select id into v_id from public.products where lower(name) = lower(trim(p_name)) order by active desc, created_at limit 1;
  end if;
  if v_id is null then
    if v_sku is null or exists (select 1 from public.products where sku = v_sku) then
      v_sku := 'LV-' || upper(substr(md5(coalesce(p_variant_id, p_name, '') || random()::text), 1, 8));
    end if;
    insert into public.products(sku, name, buying_price, selling_price, quantity_on_hand, source_system, source_item_id, active)
    values (v_sku, coalesce(nullif(trim(p_name),''), 'Loyverse item'), greatest(coalesce(p_cost,0),0), greatest(coalesce(p_price,0),0), 0,
            'loyverse', nullif(p_variant_id,''), true)
    returning id into v_id;
  elsif nullif(p_variant_id,'') is not null then
    -- Matched by SKU or name (e.g. a product from the earlier CSV import): link it to the API variant.
    update public.products set source_system = 'loyverse', source_item_id = p_variant_id
    where id = v_id and source_item_id is distinct from p_variant_id
      and not exists (select 1 from public.products o where o.source_system = 'loyverse' and o.source_item_id = p_variant_id);
  end if;
  return v_id;
end;
$$;
revoke all on function public.loyverse_product(text,text,text,numeric,numeric) from public, anon, authenticated;

-- One sale receipt from Loyverse.
create or replace function public.loyverse_post_sale(p_r jsonb, p_actor uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_number text := 'LV-' || (p_r->>'number');
  v_sale uuid;
  v_line jsonb;
  v_pid uuid;
  v_prod public.products%rowtype;
  v_qty numeric(14,3);
  v_gross numeric(14,2);
  v_cost numeric(14,2);
  v_dec numeric(14,3);
  v_subtotal numeric(14,2) := 0;
  v_cogs numeric(14,2) := 0;
  v_total numeric(14,2) := round(coalesce((p_r->>'total')::numeric,0),2);
  v_discount numeric(14,2);
  v_method public.payment_method := coalesce(nullif(p_r->>'payment',''),'cash')::public.payment_method;
  v_cashier uuid;
  v_customer uuid;
  v_journal uuid;
begin
  select id into v_cashier from public.profiles where active and lower(trim(full_name)) = lower(trim(coalesce(p_r->>'employee',''))) limit 1;
  v_cashier := coalesce(v_cashier, p_actor);

  if p_r->'customer' is not null and jsonb_typeof(p_r->'customer') = 'object' then
    select id into v_customer from public.customers
     where (nullif(p_r->'customer'->>'code','') is not null and customer_code = p_r->'customer'->>'code')
        or (nullif(p_r->'customer'->>'phone','') is not null and phone = p_r->'customer'->>'phone')
        or lower(name) = lower(coalesce(p_r->'customer'->>'name','')) limit 1;
    if v_customer is null and nullif(trim(p_r->'customer'->>'name'),'') is not null then
      insert into public.customers(name, phone, credit_limit) values (trim(p_r->'customer'->>'name'), nullif(p_r->'customer'->>'phone',''), 0) returning id into v_customer;
    end if;
  end if;
  if v_method = 'credit' and v_customer is null then
    select id into v_customer from public.customers where name = 'Loyverse credit (no name)' limit 1;
    if v_customer is null then insert into public.customers(name, credit_limit) values ('Loyverse credit (no name)', 0) returning id into v_customer; end if;
  end if;

  for v_line in select e from jsonb_array_elements(coalesce(p_r->'lines','[]'::jsonb)) e loop
    v_subtotal := v_subtotal + round(coalesce((v_line->>'gross')::numeric, (v_line->>'quantity')::numeric * (v_line->>'price')::numeric, 0), 2);
  end loop;
  if v_total > v_subtotal then v_subtotal := v_total; end if;
  v_discount := v_subtotal - v_total;

  insert into public.sales(receipt_number,idempotency_key,cashier_id,customer_id,payment_method,subtotal,discount,tax,total,cost_of_goods,created_at,source_system)
  values(v_number, md5('loyverse:' || (p_r->>'number'))::uuid, v_cashier, v_customer, v_method, v_subtotal, v_discount, 0, v_total, 0,
         coalesce((p_r->>'created_at')::timestamptz, now()), 'loyverse')
  returning id into v_sale;

  for v_line in select e from jsonb_array_elements(coalesce(p_r->'lines','[]'::jsonb)) e loop
    v_qty := round(coalesce((v_line->>'quantity')::numeric,0),3);
    if v_qty <= 0 then continue; end if;
    v_pid := public.loyverse_product(v_line->>'variant_id', v_line->>'sku', v_line->>'name', (v_line->>'price')::numeric, 0);
    select * into v_prod from public.products where id = v_pid for update;
    v_gross := round(coalesce((v_line->>'gross')::numeric, v_qty * (v_line->>'price')::numeric, 0), 2);
    v_cost := round(coalesce(nullif((v_line->>'cost_total')::numeric, 0), v_qty * v_prod.buying_price), 2);
    v_cogs := v_cogs + v_cost;
    insert into public.sale_items(sale_id,product_id,product_name,sku,quantity,unit_price,unit_cost,line_total,line_cost)
    values(v_sale, v_pid, coalesce(nullif(v_line->>'name',''), v_prod.name), v_prod.sku, v_qty, round(v_gross / v_qty, 2), round(v_cost / v_qty, 2), v_gross, v_cost);
    if v_prod.track_stock then
      v_dec := least(v_qty, v_prod.quantity_on_hand);
      if v_dec > 0 then
        update public.products set quantity_on_hand = quantity_on_hand - v_dec, updated_at = now() where id = v_pid;
      end if;
      -- The movement is recorded even when Loyverse sold below zero; the stock alignment that follows corrects the count.
      insert into public.inventory_movements(product_id,movement_type,quantity_delta,unit_cost,reference_type,reference_id,note,created_by)
      select v_pid, 'sale', -v_dec, round(v_cost / v_qty, 2), 'sale', v_sale, 'Loyverse sale ' || v_number, p_actor where v_dec > 0;
    end if;
  end loop;
  update public.sales set cost_of_goods = v_cogs where id = v_sale;

  insert into public.journals(source_type,source_id,memo,journal_date,created_by)
  values('sale', v_sale, 'Loyverse sale ' || v_number, coalesce((p_r->>'created_at')::timestamptz, now()), p_actor) returning id into v_journal;
  if v_total > 0 then
    insert into public.journal_lines(journal_id,account_id,description,debit,credit)
    values(v_journal, public.account_id(public.payment_account_code(v_method)), 'Sale proceeds', v_total, 0);
  end if;
  if v_subtotal > 0 then
    insert into public.journal_lines(journal_id,account_id,description,debit,credit)
    values(v_journal, public.account_id('4000'), 'Gross sales before discount', 0, v_subtotal);
  end if;
  if v_discount > 0 then
    insert into public.journal_lines(journal_id,account_id,description,debit,credit)
    values(v_journal, public.account_id('4900'), 'Discount given in Loyverse', v_discount, 0);
  end if;
  if v_cogs > 0 then
    insert into public.journal_lines(journal_id,account_id,description,debit,credit)
    values(v_journal, public.account_id('5000'), 'Cost of goods sold', v_cogs, 0),
          (v_journal, public.account_id('1200'), 'Inventory relieved', 0, v_cogs);
  end if;
  if not exists (select 1 from public.journal_lines where journal_id = v_journal) then
    delete from public.journals where id = v_journal;
  else
    perform public.assert_journal_balanced(v_journal);
  end if;
  return v_sale;
end;
$$;
revoke all on function public.loyverse_post_sale(jsonb,uuid) from public, anon, authenticated;

-- Main entry point, called by the Edge Function with everything it read.
create or replace function public.loyverse_sync_apply(p_items jsonb, p_receipts jsonb, p_levels jsonb, p_receipts_until timestamptz)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := public.loyverse_act_as_owner();
  v_it jsonb;
  v_pid uuid;
  v_cat uuid;
  v_r jsonb;
  v_orig uuid;
  v_lines jsonb;
  v_res jsonb;
  v_sales int := 0; v_refunds int := 0; v_skipped int := 0; v_items int := 0; v_aligned int := 0;
  v_warnings jsonb := '[]'::jsonb;
  v_prod public.products%rowtype;
  v_target numeric(14,3);
  v_delta numeric(14,3);
  v_value numeric(14,2);
  v_ref uuid := gen_random_uuid();
  v_journal uuid;
  v_gain numeric(14,2) := 0;
  v_loss numeric(14,2) := 0;
  v_result jsonb;
begin
  -- 1. Items: keep names, codes, categories, prices and costs in step with Loyverse.
  for v_it in select e from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) e loop
    begin
      if coalesce((v_it->>'deleted')::boolean, false) then continue; end if;
      v_pid := public.loyverse_product(v_it->>'variant_id', v_it->>'sku', v_it->>'name', (v_it->>'price')::numeric, (v_it->>'cost')::numeric);
      v_cat := null;
      if nullif(trim(v_it->>'category'),'') is not null then
        select id into v_cat from public.categories where lower(name) = lower(trim(v_it->>'category')) limit 1;
        if v_cat is null then insert into public.categories(name) values (trim(v_it->>'category')) returning id into v_cat; end if;
      end if;
      update public.products set
        name = coalesce(nullif(trim(v_it->>'name'),''), name),
        category_id = coalesce(v_cat, category_id),
        selling_price = case when coalesce((v_it->>'price')::numeric,0) > 0 then (v_it->>'price')::numeric else selling_price end,
        buying_price = case when coalesce((v_it->>'cost')::numeric,0) > 0 then (v_it->>'cost')::numeric else buying_price end,
        barcode = case when nullif(trim(v_it->>'barcode'),'') is not null
                        and not exists (select 1 from public.products o where o.barcode = trim(v_it->>'barcode') and o.id <> v_pid)
                       then trim(v_it->>'barcode') else barcode end,
        track_stock = coalesce((v_it->>'track_stock')::boolean, track_stock),
        sold_by_weight = coalesce((v_it->>'sold_by_weight')::boolean, sold_by_weight),
        active = true,
        updated_at = now()
      where id = v_pid;
      v_items := v_items + 1;
    exception when others then
      v_warnings := v_warnings || jsonb_build_object('item', v_it->>'name', 'message', sqlerrm);
    end;
  end loop;

  -- 2. Receipts: sales first, then refunds (a refund needs its sale).
  for v_r in select e from jsonb_array_elements(coalesce(p_receipts,'[]'::jsonb)) e
             order by (e->>'type') = 'refund', (e->>'created_at') loop
    begin
      if exists (select 1 from public.loyverse_receipts_seen where receipt_number = v_r->>'number') then continue; end if;
      if coalesce((v_r->>'cancelled')::boolean, false) then
        insert into public.loyverse_receipts_seen(receipt_number, kind, note) values (v_r->>'number', 'cancelled', 'Cancelled in Loyverse');
        v_skipped := v_skipped + 1; continue;
      end if;
      if v_r->>'type' = 'refund' then
        select id into v_orig from public.sales where receipt_number = 'LV-' || (v_r->>'refund_for') and status = 'completed';
        if v_orig is null then
          insert into public.loyverse_receipts_seen(receipt_number, kind, note) values (v_r->>'number', 'refund', 'Original sale ' || coalesce(v_r->>'refund_for','?') || ' not in this app (before the sync started)');
          v_skipped := v_skipped + 1; continue;
        end if;
        select coalesce(jsonb_agg(jsonb_build_object('sale_item_id', si.id, 'quantity', least(si.quantity - si.returned_quantity, l.qty))), '[]'::jsonb)
          into v_lines
          from (select public.loyverse_product(x->>'variant_id', x->>'sku', x->>'name') pid, sum((x->>'quantity')::numeric) qty
                  from jsonb_array_elements(coalesce(v_r->'lines','[]'::jsonb)) x group by 1) l
          join lateral (select * from public.sale_items s where s.sale_id = v_orig and s.product_id = l.pid and s.returned_quantity < s.quantity limit 1) si on true;
        if jsonb_array_length(v_lines) = 0 then
          insert into public.loyverse_receipts_seen(receipt_number, kind, sale_id, note) values (v_r->>'number', 'refund', v_orig, 'No matching items left to return');
          v_skipped := v_skipped + 1; continue;
        end if;
        v_res := public.return_sale_items(v_orig, v_lines, 'Loyverse refund ' || (v_r->>'number'));
        insert into public.loyverse_receipts_seen(receipt_number, kind, sale_id, note) values (v_r->>'number', 'refund', v_orig, coalesce(v_res->>'return_number',''));
        v_refunds := v_refunds + 1;
      else
        v_orig := public.loyverse_post_sale(v_r, v_actor);
        insert into public.loyverse_receipts_seen(receipt_number, kind, sale_id) values (v_r->>'number', 'sale', v_orig);
        v_sales := v_sales + 1;
      end if;
    exception when others then
      v_warnings := v_warnings || jsonb_build_object('receipt', v_r->>'number', 'message', sqlerrm);
    end;
  end loop;

  -- 3. Stock: Loyverse's count wins. Differences (stock received or counted in Loyverse)
  --    go to Opening Balance Equity, so they never show up as profit or loss here.
  for v_it in select e from jsonb_array_elements(coalesce(p_levels,'[]'::jsonb)) e loop
    select p.* into v_prod from public.products p where p.source_system = 'loyverse' and p.source_item_id = v_it->>'variant_id' for update;
    if not found or not v_prod.track_stock then continue; end if;
    v_target := greatest(round(coalesce((v_it->>'in_stock')::numeric,0),3), 0);
    v_delta := v_target - v_prod.quantity_on_hand;
    if v_delta = 0 then continue; end if;
    update public.products set quantity_on_hand = v_target, updated_at = now() where id = v_prod.id;
    insert into public.inventory_movements(product_id,movement_type,quantity_delta,unit_cost,reference_type,reference_id,note,created_by)
    values(v_prod.id,'adjustment',v_delta,v_prod.buying_price,'loyverse_sync',v_ref,'Stock aligned with Loyverse',v_actor);
    v_value := round(abs(v_delta) * v_prod.buying_price, 2);
    if v_delta > 0 then v_gain := v_gain + v_value; else v_loss := v_loss + v_value; end if;
    v_aligned := v_aligned + 1;
  end loop;
  if v_gain > 0 or v_loss > 0 then
    insert into public.journals(source_type,source_id,memo,created_by)
    values('loyverse_stock', v_ref, 'Stock aligned with Loyverse (' || v_aligned || ' products)', v_actor) returning id into v_journal;
    if v_gain > 0 then
      insert into public.journal_lines(journal_id,account_id,description,debit,credit)
      values(v_journal, public.account_id('1200'), 'Stock added in Loyverse', v_gain, 0),
            (v_journal, public.account_id('3200'), 'Stock added in Loyverse', 0, v_gain);
    end if;
    if v_loss > 0 then
      insert into public.journal_lines(journal_id,account_id,description,debit,credit)
      values(v_journal, public.account_id('3200'), 'Stock removed in Loyverse', v_loss, 0),
            (v_journal, public.account_id('1200'), 'Stock removed in Loyverse', 0, v_loss);
    end if;
    perform public.assert_journal_balanced(v_journal);
  end if;

  v_result := jsonb_build_object('items', v_items, 'sales', v_sales, 'refunds', v_refunds, 'skipped', v_skipped,
    'stock_aligned', v_aligned, 'stock_added_value', v_gain, 'stock_removed_value', v_loss, 'warnings', v_warnings);
  update public.loyverse_sync_state set
    receipts_since = greatest(receipts_since, coalesce(p_receipts_until, receipts_since)),
    last_finished_at = now(), last_result = v_result, last_error = ''
  where id;
  return v_result;
end;
$$;
revoke all on function public.loyverse_sync_apply(jsonb,jsonb,jsonb,timestamptz) from public, anon, authenticated;
grant execute on function public.loyverse_sync_apply(jsonb,jsonb,jsonb,timestamptz) to service_role;

commit;
