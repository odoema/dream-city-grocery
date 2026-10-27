-- =============================================================================
-- Daily controls
-- -----------------------------------------------------------------------------
-- Additive and idempotent. Run once in the Supabase SQL editor.
--   * Return items: partial (or full) returns per line, any payment method
--   * Close day: cash-up per staff member, shortage/surplus posted to the books
--   * Owner money: capital in, drawings out, transfers (e.g. cash to bank)
--   * Average cost: receiving stock now keeps a weighted-average buying price
--   * Reports and customer balances take partial returns into account
--   * Instant Dashboard updates (realtime on sales)
--   * Data fixes found in the audit (two prices, brand colour)
-- Never run against SmartAttend.
-- =============================================================================
begin;

insert into public.accounts(code,name,type) values
  ('3300','Owner Drawings','equity'),
  ('6200','Cash Short / Over','expense')
on conflict(code) do nothing;

-- ---------------------------------------------------------------------------
-- 1. Returns
-- ---------------------------------------------------------------------------
alter table public.sales
  add column if not exists returned_amount numeric(14,2) not null default 0 check (returned_amount >= 0),
  add column if not exists returned_cost numeric(14,2) not null default 0 check (returned_cost >= 0);
alter table public.sale_items
  add column if not exists returned_quantity numeric(14,3) not null default 0 check (returned_quantity >= 0);

create sequence if not exists public.return_number_seq start 1;
create table if not exists public.sale_returns (
  id uuid primary key default gen_random_uuid(),
  return_number text not null unique,
  sale_id uuid not null references public.sales(id),
  refund_method public.payment_method not null,
  amount numeric(14,2) not null check (amount >= 0),
  cost numeric(14,2) not null default 0 check (cost >= 0),
  reason text not null,
  lines jsonb not null default '[]'::jsonb,
  journal_id uuid references public.journals(id),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists sale_returns_sale_idx on public.sale_returns(sale_id);
create index if not exists sale_returns_created_idx on public.sale_returns(created_at desc);
alter table public.sale_returns enable row level security;
drop policy if exists "staff read returns" on public.sale_returns;
create policy "staff read returns" on public.sale_returns for select to authenticated
  using (public.current_staff_role() in ('owner','manager','accountant') or created_by = auth.uid());
grant select on public.sale_returns to authenticated;

-- p_lines: [{ "sale_item_id": uuid, "quantity": n }]. Money goes back the way it was paid
-- (a credit sale reduces what the customer owes).
create or replace function public.return_sale_items(p_sale_id uuid, p_lines jsonb, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := public.require_staff(array['owner','manager']::public.staff_role[]);
  v_sale public.sales%rowtype;
  v_line jsonb;
  v_item public.sale_items%rowtype;
  v_qty numeric(14,3);
  v_factor numeric := 0;
  v_amount numeric(14,2) := 0;
  v_cost numeric(14,2) := 0;
  v_line_cost numeric(14,2);
  v_id uuid := gen_random_uuid();
  v_number text;
  v_journal uuid;
  v_all_back boolean;
  v_detail jsonb := '[]'::jsonb;
begin
  if nullif(trim(p_reason),'') is null then raise exception 'Give a reason for the return'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Choose at least one item to return'; end if;
  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then raise exception 'Sale not found'; end if;
  if v_sale.status <> 'completed' then raise exception 'This sale is already %', v_sale.status; end if;
  if v_sale.subtotal > 0 then v_factor := v_sale.total / v_sale.subtotal; end if;
  v_number := 'RTN-' || lpad(nextval('public.return_number_seq')::text,6,'0');

  for v_line in select e from jsonb_array_elements(p_lines) e order by (e->>'sale_item_id') loop
    v_qty := round(coalesce((v_line->>'quantity')::numeric,0),3);
    if v_qty = 0 then continue; end if;
    if v_qty < 0 then raise exception 'Return quantities must be positive'; end if;
    select * into v_item from public.sale_items where id = (v_line->>'sale_item_id')::uuid and sale_id = p_sale_id for update;
    if not found then raise exception 'An item does not belong to this sale'; end if;
    if v_item.returned_quantity + v_qty > v_item.quantity then
      raise exception 'Only % of % can still be returned', v_item.quantity - v_item.returned_quantity, v_item.product_name;
    end if;
    v_amount := v_amount + round(v_item.line_total * v_qty / v_item.quantity * v_factor, 2);
    v_line_cost := round(v_item.line_cost * v_qty / v_item.quantity, 2);
    v_cost := v_cost + v_line_cost;
    update public.sale_items set returned_quantity = returned_quantity + v_qty where id = v_item.id;
    if exists (select 1 from public.inventory_movements m where m.reference_type = 'sale' and m.reference_id = p_sale_id
               and m.product_id = v_item.product_id and m.movement_type = 'sale') then
      perform 1 from public.products where id = v_item.product_id for update;
      update public.products set quantity_on_hand = quantity_on_hand + v_qty, updated_at = now() where id = v_item.product_id;
      insert into public.inventory_movements(product_id,movement_type,quantity_delta,unit_cost,reference_type,reference_id,note,created_by)
      values(v_item.product_id,'sale_return',v_qty,v_item.unit_cost,'sale_return',v_id,v_number||' from '||v_sale.receipt_number,v_actor);
    end if;
    v_detail := v_detail || jsonb_build_object('sale_item_id',v_item.id,'name',v_item.product_name,'quantity',v_qty);
  end loop;
  if jsonb_array_length(v_detail) = 0 then raise exception 'Choose at least one item to return'; end if;

  -- When everything is back, settle exactly (no rounding left over).
  select not exists (select 1 from public.sale_items where sale_id = p_sale_id and returned_quantity < quantity) into v_all_back;
  if v_all_back then
    v_amount := v_sale.total - v_sale.returned_amount;
    v_cost := v_sale.cost_of_goods - v_sale.returned_cost;
  end if;

  if v_sale.payment_method = 'credit' and v_sale.customer_id is not null
     and public.customer_balance(v_sale.customer_id) - v_amount < 0 then
    raise exception 'The customer has already paid for this credit sale. Give the money back and record it as an expense instead.';
  end if;

  insert into public.journals(source_type,source_id,memo,created_by)
  values('sale_return',v_id,v_number||' · '||v_sale.receipt_number||': '||trim(p_reason),v_actor) returning id into v_journal;
  if v_amount > 0 then
    insert into public.journal_lines(journal_id,account_id,description,debit,credit)
    values(v_journal, public.account_id('4900'), 'Goods returned', v_amount, 0),
          (v_journal, public.account_id(public.payment_account_code(v_sale.payment_method)), 'Refund to customer', 0, v_amount);
  end if;
  if v_cost > 0 then
    insert into public.journal_lines(journal_id,account_id,description,debit,credit)
    values(v_journal, public.account_id('1200'), 'Returned goods back in stock', v_cost, 0),
          (v_journal, public.account_id('5000'), 'Cost of goods returned', 0, v_cost);
  end if;
  perform public.assert_journal_balanced(v_journal);

  insert into public.sale_returns(id,return_number,sale_id,refund_method,amount,cost,reason,lines,journal_id,created_by)
  values(v_id,v_number,p_sale_id,v_sale.payment_method,v_amount,v_cost,trim(p_reason),v_detail,v_journal,v_actor);

  update public.sales set returned_amount = returned_amount + v_amount, returned_cost = returned_cost + v_cost,
    status = case when v_all_back then 'refunded' else status end,
    refunded_at = case when v_all_back then now() else refunded_at end,
    refunded_by = case when v_all_back then v_actor else refunded_by end,
    refund_reason = case when v_all_back then trim(p_reason) else refund_reason end
  where id = p_sale_id;

  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
  values(v_actor,'sale.returned','sale',p_sale_id,jsonb_build_object('return_number',v_number,'amount',v_amount,'reason',trim(p_reason),'lines',v_detail));
  return jsonb_build_object('return_id',v_id,'return_number',v_number,'amount',v_amount,'refund_method',v_sale.payment_method,'fully_returned',v_all_back);
end;
$$;
revoke all on function public.return_sale_items(uuid,jsonb,text) from public, anon;
grant execute on function public.return_sale_items(uuid,jsonb,text) to authenticated;

-- Full refund = return everything that is left.
create or replace function public.refund_sale(p_sale_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_lines jsonb;
begin
  perform public.require_staff(array['owner','manager']::public.staff_role[]);
  select coalesce(jsonb_agg(jsonb_build_object('sale_item_id',id,'quantity',quantity - returned_quantity)),'[]'::jsonb)
    into v_lines from public.sale_items where sale_id = p_sale_id and returned_quantity < quantity;
  if not exists (select 1 from public.sales where id = p_sale_id and status = 'completed') then
    raise exception 'Only completed sales can be refunded';
  end if;
  return public.return_sale_items(p_sale_id, v_lines, p_reason);
end;
$$;
revoke all on function public.refund_sale(uuid,text) from public, anon;
grant execute on function public.refund_sale(uuid,text) to authenticated;

-- Customer balances: a returned credit item no longer counts as owed.
create or replace function public.customer_balance(p_customer_id uuid)
returns numeric language sql stable security definer set search_path = ''
as $$
  select coalesce((select sum(s.total - s.returned_amount) from public.sales s
                    where s.customer_id = p_customer_id and s.payment_method = 'credit' and s.status = 'completed'),0)
       - coalesce((select sum(cp.amount) from public.customer_payments cp where cp.customer_id = p_customer_id),0)
$$;

create or replace view public.customer_balances with (security_invoker = true) as
select c.id as customer_id, c.name, c.phone, c.credit_limit, c.active,
       coalesce(cs.credit_sales,0) as credit_sales,
       coalesce(cp.payments,0) as payments,
       coalesce(cs.credit_sales,0) - coalesce(cp.payments,0) as balance
from public.customers c
left join (select customer_id, sum(total - returned_amount) credit_sales from public.sales
           where payment_method = 'credit' and status = 'completed' group by customer_id) cs on cs.customer_id = c.id
left join (select customer_id, sum(amount) payments from public.customer_payments group by customer_id) cp on cp.customer_id = c.id;

create or replace function public.get_customer_statement(p_customer_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_staff();
  return jsonb_build_object(
    'balance', public.customer_balance(p_customer_id),
    'entries', coalesce((select jsonb_agg(e order by e->>'at' desc) from (
      select jsonb_build_object('at', s.created_at, 'kind', 'sale', 'reference', s.receipt_number,
             'amount', case when s.status = 'completed' then s.total - s.returned_amount else s.total end, 'status', s.status, 'sale_id', s.id) e
      from public.sales s where s.customer_id = p_customer_id and s.payment_method = 'credit'
      union all
      select jsonb_build_object('at', cp.received_at, 'kind', 'payment', 'reference', coalesce(nullif(cp.reference,''), cp.payment_method::text), 'amount', cp.amount, 'status', 'received')
      from public.customer_payments cp where cp.customer_id = p_customer_id
    ) q), '[]'::jsonb));
end;
$$;

-- Sales summary: net of partial returns.
create or replace function public.get_sales_summary(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_actor uuid := public.require_staff();
  v_role public.staff_role := public.current_staff_role();
  v_tz text := coalesce((select timezone from public.store_settings where id),'UTC');
  v_all boolean := v_role in ('owner','manager','accountant');
  v_result jsonb;
begin
  with s as (
    select * from public.sales
    where created_at >= p_from and created_at < p_to and (v_all or cashier_id = v_actor)
  ), done as (
    select id, cashier_id, payment_method, created_at, subtotal, discount,
           total - returned_amount as total, cost_of_goods - returned_cost as cost_of_goods
    from s where status = 'completed'
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to, 'scope', case when v_all then 'shop' else 'mine' end,
    'transactions', (select count(*) from done),
    'gross_sales', (select coalesce(sum(subtotal),0) from done),
    'discounts', (select coalesce(sum(discount),0) from done),
    'net_sales', (select coalesce(sum(total),0) from done),
    'cost_of_goods', (select coalesce(sum(cost_of_goods),0) from done),
    'gross_profit', (select coalesce(sum(total - cost_of_goods),0) from done),
    'refunds', (select coalesce(sum(case when status = 'refunded' then total else returned_amount end),0) from s where status = 'refunded' or returned_amount > 0),
    'refund_count', (select count(*) from s where status = 'refunded' or returned_amount > 0),
    'average_sale', (select coalesce(round(avg(total),2),0) from done),
    'by_payment', coalesce((select jsonb_agg(x order by x->>'method') from (
        select jsonb_build_object('method',payment_method,'count',count(*),'total',sum(total)) x from done group by payment_method) q),'[]'::jsonb),
    'by_day', coalesce((select jsonb_agg(x order by x->>'day') from (
        select jsonb_build_object('day',(created_at at time zone v_tz)::date,'count',count(*),'total',sum(total),'profit',sum(total-cost_of_goods)) x
        from done group by (created_at at time zone v_tz)::date) q),'[]'::jsonb),
    'by_hour', coalesce((select jsonb_agg(x order by (x->>'hour')::int) from (
        select jsonb_build_object('hour',extract(hour from created_at at time zone v_tz)::int,'count',count(*),'total',sum(total)) x
        from done group by extract(hour from created_at at time zone v_tz)::int) q),'[]'::jsonb),
    'top_products', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('product_id',si.product_id,'name',max(si.product_name),'sku',max(si.sku),
               'quantity',sum(si.quantity - si.returned_quantity),
               'revenue',sum(round(si.line_total * (si.quantity - si.returned_quantity) / si.quantity, 2)),
               'profit',sum(round((si.line_total - si.line_cost) * (si.quantity - si.returned_quantity) / si.quantity, 2))) x
        from public.sale_items si join done d on d.id = si.sale_id
        where si.returned_quantity < si.quantity
        group by si.product_id order by sum(round(si.line_total * (si.quantity - si.returned_quantity) / si.quantity, 2)) desc limit 15) q),'[]'::jsonb),
    'by_cashier', case when v_all then coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('cashier_id',d.cashier_id,'name',coalesce(max(p.full_name),'Staff'),'count',count(*),'total',sum(d.total)) x
        from done d left join public.profiles p on p.id = d.cashier_id group by d.cashier_id order by sum(d.total) desc) q),'[]'::jsonb) else '[]'::jsonb end
  ) into v_result;
  return v_result;
end;
$$;

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
             case when s.status = 'completed' then si.quantity - si.returned_quantity else 0 end as quantity,
             case when s.status = 'completed' then round(si.line_total * (si.quantity - si.returned_quantity) / si.quantity, 2) else 0 end as line_total,
             case when s.status = 'completed' then round(si.line_cost * (si.quantity - si.returned_quantity) / si.quantity, 2) else 0 end as line_cost,
             case when s.status = 'refunded' then si.quantity else si.returned_quantity end as back_qty
      from public.sale_items si
      join public.sales s on s.id = si.sale_id
      left join public.products p on p.id = si.product_id
      left join public.categories c on c.id = p.category_id
      where s.created_at >= p_from and s.created_at < p_to and s.status in ('completed','refunded') and (v_all or s.cashier_id = v_actor)
    )
    select jsonb_build_object(
      'items', coalesce((select jsonb_agg(x order by (x->>'revenue')::numeric desc) from (
        select jsonb_build_object('product_id', product_id, 'name', max(product_name), 'sku', max(sku), 'category', max(category),
          'quantity', sum(quantity), 'revenue', sum(line_total), 'cost', sum(line_cost),
          'profit', sum(line_total - line_cost), 'refunded_qty', sum(back_qty)) x
        from lines group by product_id) q), '[]'::jsonb),
      'categories', coalesce((select jsonb_agg(x order by (x->>'revenue')::numeric desc) from (
        select jsonb_build_object('category', category, 'quantity', sum(quantity), 'revenue', sum(line_total),
          'profit', sum(line_total - line_cost)) x
        from lines group by category) q), '[]'::jsonb)
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Owner money: capital in, drawings out, transfers between cash/mobile/bank
-- ---------------------------------------------------------------------------
create sequence if not exists public.money_movement_seq start 1;
create table if not exists public.money_movements (
  id uuid primary key default gen_random_uuid(),
  movement_number text not null unique,
  kind text not null check (kind in ('capital','drawing','transfer')),
  amount numeric(14,2) not null check (amount > 0),
  from_method public.payment_method check (from_method is null or from_method <> 'credit'),
  to_method public.payment_method check (to_method is null or to_method <> 'credit'),
  note text not null default '',
  journal_id uuid references public.journals(id),
  recorded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.money_movements enable row level security;
drop policy if exists "managers read money movements" on public.money_movements;
create policy "managers read money movements" on public.money_movements for select to authenticated
  using (public.current_staff_role() in ('owner','manager','accountant'));
grant select on public.money_movements to authenticated;

create or replace function public.record_money_movement(p_kind text, p_amount numeric, p_from public.payment_method, p_to public.payment_method, p_note text default '')
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid;
  v_id uuid := gen_random_uuid();
  v_number text;
  v_journal uuid;
  v_label text;
begin
  if p_kind = 'transfer' then v_actor := public.require_staff(array['owner','manager','accountant']::public.staff_role[]);
  elsif p_kind in ('capital','drawing') then v_actor := public.require_staff(array['owner','accountant']::public.staff_role[]);
  else raise exception 'Unknown kind of money movement'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be greater than zero'; end if;
  if p_kind in ('drawing','transfer') and p_from is null then raise exception 'Choose where the money comes from'; end if;
  if p_kind in ('capital','transfer') and p_to is null then raise exception 'Choose where the money goes'; end if;
  if 'credit' in (p_from, p_to) then raise exception 'Choose cash, mobile money, card or bank'; end if;
  if p_kind = 'transfer' and public.payment_account_code(p_from) = public.payment_account_code(p_to) then
    raise exception 'From and to are the same account';
  end if;
  v_label := case p_kind when 'capital' then 'Owner capital' when 'drawing' then 'Owner drawings' else 'Transfer' end;
  v_number := 'MOV-' || lpad(nextval('public.money_movement_seq')::text,5,'0');
  insert into public.journals(source_type,source_id,memo,created_by)
  values('money_movement',v_id,v_number||' '||v_label||coalesce(': '||nullif(trim(p_note),''),''),v_actor) returning id into v_journal;
  insert into public.journal_lines(journal_id,account_id,description,debit,credit)
  values(v_journal,
         case p_kind when 'drawing' then public.account_id('3300') else public.account_id(public.payment_account_code(p_to)) end,
         v_label, p_amount, 0),
        (v_journal,
         case p_kind when 'capital' then public.account_id('3000') else public.account_id(public.payment_account_code(p_from)) end,
         v_label, 0, p_amount);
  perform public.assert_journal_balanced(v_journal);
  insert into public.money_movements(id,movement_number,kind,amount,from_method,to_method,note,journal_id,recorded_by)
  values(v_id,v_number,p_kind,p_amount,case when p_kind = 'capital' then null else p_from end,case when p_kind = 'drawing' then null else p_to end,coalesce(trim(p_note),''),v_journal,v_actor);
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
  values(v_actor,'money.'||p_kind,'money_movement',v_id,jsonb_build_object('number',v_number,'amount',p_amount,'from',p_from,'to',p_to));
  return jsonb_build_object('id',v_id,'movement_number',v_number,'journal_id',v_journal);
end;
$$;
revoke all on function public.record_money_movement(text,numeric,public.payment_method,public.payment_method,text) from public, anon;
grant execute on function public.record_money_movement(text,numeric,public.payment_method,public.payment_method,text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Close day (cash-up). Each person counts their own drawer.
-- ---------------------------------------------------------------------------
create sequence if not exists public.cash_up_seq start 1;
create table if not exists public.cash_ups (
  id uuid primary key default gen_random_uuid(),
  cash_up_number text not null unique,
  staff_id uuid not null references public.profiles(id),
  period_from timestamptz not null,
  period_to timestamptz not null,
  receipts integer not null default 0,
  opening_float numeric(14,2) not null default 0 check (opening_float >= 0),
  cash_sales numeric(14,2) not null default 0,
  cash_refunds numeric(14,2) not null default 0,
  cash_in_other numeric(14,2) not null default 0,
  cash_out_other numeric(14,2) not null default 0,
  expected_cash numeric(14,2) not null,
  counted_cash numeric(14,2) not null check (counted_cash >= 0),
  difference numeric(14,2) not null,
  by_method jsonb not null default '{}'::jsonb,
  notes text not null default '',
  journal_id uuid references public.journals(id),
  created_at timestamptz not null default now()
);
create index if not exists cash_ups_staff_idx on public.cash_ups(staff_id, period_to desc);
alter table public.cash_ups enable row level security;
drop policy if exists "read own or all cash-ups" on public.cash_ups;
create policy "read own or all cash-ups" on public.cash_ups for select to authenticated
  using (staff_id = auth.uid() or public.current_staff_role() in ('owner','manager','accountant'));
grant select on public.cash_ups to authenticated;

-- What the drawer should hold now for the signed-in person (no float included).
create or replace function public.get_cash_up_preview()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_actor uuid := public.require_staff();
  v_tz text := coalesce((select timezone from public.store_settings where id),'UTC');
  v_from timestamptz;
  v_to timestamptz := now();
  v_last public.cash_ups%rowtype;
begin
  select * into v_last from public.cash_ups where staff_id = v_actor order by period_to desc limit 1;
  v_from := coalesce(v_last.period_to, (date_trunc('day', now() at time zone v_tz)) at time zone v_tz);
  return jsonb_build_object(
    'from', v_from, 'to', v_to,
    'last_float', coalesce(v_last.opening_float, 0),
    'receipts', (select count(*) from public.sales where cashier_id = v_actor and created_at > v_from and created_at <= v_to),
    'cash_sales', (select coalesce(sum(total),0) from public.sales where cashier_id = v_actor and payment_method = 'cash' and created_at > v_from and created_at <= v_to),
    'cash_refunds', (select coalesce(sum(amount),0) from public.sale_returns where created_by = v_actor and refund_method = 'cash' and created_at > v_from and created_at <= v_to),
    'cash_in_other',
        (select coalesce(sum(amount),0) from public.customer_payments where received_by = v_actor and payment_method = 'cash' and received_at > v_from and received_at <= v_to)
      + (select coalesce(sum(amount),0) from public.money_movements where recorded_by = v_actor and to_method = 'cash' and created_at > v_from and created_at <= v_to),
    'cash_out_other',
        (select coalesce(sum(amount),0) from public.expenses where recorded_by = v_actor and payment_method = 'cash' and created_at > v_from and created_at <= v_to)
      + (select coalesce(sum(amount),0) from public.supplier_payments where paid_by = v_actor and payment_method = 'cash' and paid_at > v_from and paid_at <= v_to)
      + (select coalesce(sum(amount),0) from public.money_movements where recorded_by = v_actor and from_method = 'cash' and created_at > v_from and created_at <= v_to),
    'by_method', coalesce((select jsonb_object_agg(payment_method, t) from (
        select payment_method, sum(total) t from public.sales
        where cashier_id = v_actor and created_at > v_from and created_at <= v_to group by payment_method) q), '{}'::jsonb)
  );
end;
$$;
revoke all on function public.get_cash_up_preview() from public, anon;
grant execute on function public.get_cash_up_preview() to authenticated;

create or replace function public.close_cash_up(p_opening_float numeric, p_counted_cash numeric, p_notes text default '')
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := public.require_staff();
  v_p jsonb;
  v_expected numeric(14,2);
  v_diff numeric(14,2);
  v_id uuid := gen_random_uuid();
  v_number text;
  v_journal uuid;
begin
  if coalesce(p_opening_float,0) < 0 or p_counted_cash is null or p_counted_cash < 0 then raise exception 'Enter the float and the cash you counted'; end if;
  perform pg_advisory_xact_lock(hashtext('cash_up:' || v_actor::text));
  v_p := public.get_cash_up_preview();
  v_expected := coalesce(p_opening_float,0) + (v_p->>'cash_sales')::numeric - (v_p->>'cash_refunds')::numeric
                + (v_p->>'cash_in_other')::numeric - (v_p->>'cash_out_other')::numeric;
  v_diff := round(p_counted_cash - v_expected, 2);
  v_number := 'CU-' || lpad(nextval('public.cash_up_seq')::text,5,'0');
  if v_diff <> 0 then
    insert into public.journals(source_type,source_id,memo,created_by)
    values('cash_up',v_id,v_number||' cash '||case when v_diff < 0 then 'short' else 'over' end,v_actor) returning id into v_journal;
    insert into public.journal_lines(journal_id,account_id,description,debit,credit)
    values(v_journal, public.account_id(case when v_diff < 0 then '6200' else '1000' end), 'Cash count difference', abs(v_diff), 0),
          (v_journal, public.account_id(case when v_diff < 0 then '1000' else '6200' end), 'Cash count difference', 0, abs(v_diff));
    perform public.assert_journal_balanced(v_journal);
  end if;
  insert into public.cash_ups(id,cash_up_number,staff_id,period_from,period_to,receipts,opening_float,cash_sales,cash_refunds,cash_in_other,cash_out_other,
                              expected_cash,counted_cash,difference,by_method,notes,journal_id)
  values(v_id,v_number,v_actor,(v_p->>'from')::timestamptz,(v_p->>'to')::timestamptz,(v_p->>'receipts')::int,coalesce(p_opening_float,0),
         (v_p->>'cash_sales')::numeric,(v_p->>'cash_refunds')::numeric,(v_p->>'cash_in_other')::numeric,(v_p->>'cash_out_other')::numeric,
         v_expected,p_counted_cash,v_diff,v_p->'by_method',coalesce(trim(p_notes),''),v_journal);
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
  values(v_actor,'cash_up.closed','cash_up',v_id,jsonb_build_object('number',v_number,'expected',v_expected,'counted',p_counted_cash,'difference',v_diff));
  return jsonb_build_object('id',v_id,'cash_up_number',v_number,'expected_cash',v_expected,'counted_cash',p_counted_cash,'difference',v_diff);
end;
$$;
revoke all on function public.close_cash_up(numeric,numeric,text) from public, anon;
grant execute on function public.close_cash_up(numeric,numeric,text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Weighted-average buying price when stock is received
-- ---------------------------------------------------------------------------
create or replace function public.receive_supplier_invoice(
  p_supplier_id uuid,
  p_invoice_number text,
  p_invoice_date date,
  p_due_date date,
  p_items jsonb,
  p_purchase_order_id uuid default null,
  p_notes text default ''
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.staff_role;
  v_item jsonb;
  v_product public.products%rowtype;
  v_product_id uuid;
  v_qty numeric(14,3);
  v_cost numeric(14,2);
  v_line_total numeric(14,2);
  v_total numeric(14,2):=0;
  v_invoice_id uuid;
  v_receipt_id uuid;
  v_receipt_number text;
  v_journal_id uuid;
  v_inventory_account uuid;
  v_ap_account uuid;
begin
  select role into v_role from public.profiles where id=v_actor and active;
  if v_role is null or v_role not in ('owner','manager','accountant') then raise exception 'Only owner, manager or accountant can receive supplier invoices'; end if;
  if not exists(select 1 from public.suppliers where id=p_supplier_id and active) then raise exception 'Select an active supplier'; end if;
  if nullif(trim(p_invoice_number),'') is null then raise exception 'Supplier invoice number is required'; end if;
  if p_due_date is not null and p_invoice_date is not null and p_due_date<p_invoice_date then raise exception 'Due date cannot be before invoice date'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Add at least one received product'; end if;
  if exists(select 1 from public.supplier_invoices where supplier_id=p_supplier_id and invoice_number=trim(p_invoice_number)) then raise exception 'This supplier invoice number has already been recorded'; end if;
  if p_purchase_order_id is not null and not exists(select 1 from public.purchase_orders where id=p_purchase_order_id and supplier_id=p_supplier_id and status in ('ordered','part_received')) then raise exception 'Purchase order does not match this supplier or is not open'; end if;

  for v_item in select e from jsonb_array_elements(p_items) e order by (e->>'product_id')::uuid loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::numeric;
    v_cost := (v_item->>'unit_cost')::numeric;
    if v_qty<=0 or v_cost<0 then raise exception 'Received quantities must be positive and costs non-negative'; end if;
    if exists(select 1 from jsonb_array_elements(p_items) e where (e->>'product_id')::uuid=v_product_id group by (e->>'product_id') having count(*)>1) then raise exception 'Combine duplicate product lines before receiving'; end if;
    select * into v_product from public.products where id=v_product_id and active for update;
    if not found then raise exception 'A received product is inactive or missing'; end if;
    if p_purchase_order_id is not null and not exists(select 1 from public.purchase_order_items poi where poi.purchase_order_id=p_purchase_order_id and poi.product_id=v_product_id and poi.quantity_received+v_qty<=poi.quantity_ordered) then
      raise exception 'Received quantity exceeds or does not match the selected purchase order';
    end if;
    v_total := v_total + round(v_qty*v_cost,2);
  end loop;
  if v_total<=0 then raise exception 'Invoice total must be greater than zero'; end if;

  insert into public.supplier_invoices(supplier_id,purchase_order_id,invoice_number,invoice_date,due_date,total,created_by)
  values(p_supplier_id,p_purchase_order_id,trim(p_invoice_number),coalesce(p_invoice_date,current_date),p_due_date,v_total,v_actor)
  returning id into v_invoice_id;

  for v_item in select e from jsonb_array_elements(p_items) e order by (e->>'product_id')::uuid loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::numeric;
    v_cost := (v_item->>'unit_cost')::numeric;
    select * into v_product from public.products where id=v_product_id for update;
    v_line_total := round(v_qty*v_cost,2);
    insert into public.supplier_invoice_items(invoice_id,product_id,quantity,unit_cost,line_total)
    values(v_invoice_id,v_product_id,v_qty,v_cost,v_line_total);
    update public.products set
      buying_price = case when quantity_on_hand > 0
                          then round((quantity_on_hand*buying_price + v_qty*v_cost)/(quantity_on_hand+v_qty),2)
                          else v_cost end,
      quantity_on_hand=quantity_on_hand+v_qty,updated_at=now() where id=v_product_id;
    insert into public.inventory_movements(product_id,movement_type,quantity_delta,unit_cost,reference_type,reference_id,note,created_by)
    values(v_product_id,'purchase',v_qty,v_cost,'supplier_invoice',v_invoice_id,'Goods received against invoice '||trim(p_invoice_number),v_actor);
  end loop;

  select id into v_inventory_account from public.accounts where code='1200' and active;
  select id into v_ap_account from public.accounts where code='2000' and active;
  if v_inventory_account is null or v_ap_account is null then raise exception 'Inventory or Accounts Payable account is missing'; end if;
  insert into public.journals(source_type,source_id,memo,created_by)
  values('supplier_invoice',v_invoice_id,'Supplier invoice '||trim(p_invoice_number),v_actor) returning id into v_journal_id;
  insert into public.journal_lines(journal_id,account_id,description,debit,credit)
  values(v_journal_id,v_inventory_account,'Goods received',v_total,0),(v_journal_id,v_ap_account,'Supplier payable',0,v_total);
  update public.supplier_invoices set journal_id=v_journal_id where id=v_invoice_id;

  v_receipt_number := 'GR-'||to_char(current_date,'YYYYMMDD')||'-'||lpad(nextval('public.goods_receipt_number_seq')::text,4,'0');
  insert into public.goods_receipts(receipt_number,invoice_id,received_by,notes)
  values(v_receipt_number,v_invoice_id,v_actor,coalesce(p_notes,'Goods received')) returning id into v_receipt_id;
  if p_purchase_order_id is not null then
    for v_item in select e from jsonb_array_elements(p_items) e loop
      update public.purchase_order_items set quantity_received=quantity_received+(v_item->>'quantity')::numeric
      where purchase_order_id=p_purchase_order_id and product_id=(v_item->>'product_id')::uuid;
    end loop;
    update public.purchase_orders set status=case when not exists(select 1 from public.purchase_order_items poi where poi.purchase_order_id=p_purchase_order_id and poi.quantity_received<poi.quantity_ordered) then 'received' else 'part_received' end
    where id=p_purchase_order_id;
  end if;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
  values(v_actor,'supplier_invoice.received','supplier_invoice',v_invoice_id,jsonb_build_object('invoice_number',trim(p_invoice_number),'total',v_total,'receipt_number',v_receipt_number));
  return jsonb_build_object('invoice_id',v_invoice_id,'receipt_number',v_receipt_number,'total',v_total,'journal_id',v_journal_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Instant Dashboard updates
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sales') then
    execute 'alter publication supabase_realtime add table public.sales';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Data fixes from the audit (safe: each only matches the known mistake)
-- ---------------------------------------------------------------------------
do $$
begin
  update public.products set selling_price = 4000, updated_at = now()
   where name ilike 'skala carrot%' and selling_price = 40002;
  update public.products set selling_price = ceil(buying_price * 1.3 / 100) * 100, updated_at = now()
   where name ilike '%scissors%' and selling_price < buying_price and buying_price > 0;
  update public.store_settings set primary_color = '#16376A' where id and primary_color = '#176B45';
end $$;

commit;
