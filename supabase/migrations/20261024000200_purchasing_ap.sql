-- Dream City Grocery purchasing and accounts payable module.
-- Apply ONLY to dedicated project nohdgmylncjtdymfshfy after migration 20261024000100.
begin;

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  supplier_id uuid not null references public.suppliers(id),
  status text not null default 'ordered' check (status in ('ordered','part_received','received','cancelled')),
  order_date date not null default current_date,
  expected_date date,
  notes text not null default '',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create table public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete restrict,
  product_id uuid not null references public.products(id),
  quantity_ordered numeric(14,3) not null check (quantity_ordered > 0),
  unit_cost numeric(14,2) not null check (unit_cost >= 0),
  quantity_received numeric(14,3) not null default 0 check (quantity_received >= 0 and quantity_received <= quantity_ordered),
  unique(purchase_order_id, product_id)
);
create table public.supplier_invoices (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id),
  purchase_order_id uuid references public.purchase_orders(id),
  invoice_number text not null,
  invoice_date date not null default current_date,
  due_date date,
  total numeric(14,2) not null check (total >= 0),
  amount_paid numeric(14,2) not null default 0 check (amount_paid >= 0 and amount_paid <= total),
  status text not null default 'posted' check (status in ('posted','part_paid','paid')),
  journal_id uuid references public.journals(id),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(supplier_id, invoice_number)
);
create table public.supplier_invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.supplier_invoices(id) on delete restrict,
  product_id uuid not null references public.products(id),
  quantity numeric(14,3) not null check (quantity > 0),
  unit_cost numeric(14,2) not null check (unit_cost >= 0),
  line_total numeric(14,2) not null check (line_total >= 0)
);
create table public.goods_receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_number text not null unique,
  invoice_id uuid not null unique references public.supplier_invoices(id),
  received_by uuid not null references public.profiles(id),
  received_at timestamptz not null default now(),
  notes text not null default ''
);
create table public.supplier_payments (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id),
  invoice_id uuid not null references public.supplier_invoices(id),
  payment_reference text not null,
  payment_method public.payment_method not null check (payment_method in ('cash','mobile_money','card','bank')),
  amount numeric(14,2) not null check (amount > 0),
  journal_id uuid references public.journals(id),
  paid_by uuid not null references public.profiles(id),
  paid_at timestamptz not null default now(),
  unique(supplier_id, payment_reference)
);

alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;
alter table public.supplier_invoices enable row level security;
alter table public.supplier_invoice_items enable row level security;
alter table public.goods_receipts enable row level security;
alter table public.supplier_payments enable row level security;

create policy "authorized staff read purchase orders" on public.purchase_orders for select to authenticated using (public.current_staff_role() in ('owner','manager','accountant'));
create policy "authorized staff read purchase order items" on public.purchase_order_items for select to authenticated using (public.current_staff_role() in ('owner','manager','accountant'));
create policy "authorized staff read supplier invoices" on public.supplier_invoices for select to authenticated using (public.current_staff_role() in ('owner','manager','accountant'));
create policy "authorized staff read supplier invoice items" on public.supplier_invoice_items for select to authenticated using (public.current_staff_role() in ('owner','manager','accountant'));
create policy "authorized staff read goods receipts" on public.goods_receipts for select to authenticated using (public.current_staff_role() in ('owner','manager','accountant'));
create policy "authorized staff read supplier payments" on public.supplier_payments for select to authenticated using (public.current_staff_role() in ('owner','manager','accountant'));

create index purchase_orders_created_idx on public.purchase_orders(created_at desc);
create index supplier_invoices_due_idx on public.supplier_invoices(due_date) where status <> 'paid';
create index supplier_invoice_items_invoice_idx on public.supplier_invoice_items(invoice_id);
create index supplier_payments_invoice_idx on public.supplier_payments(invoice_id);

create sequence public.purchase_order_number_seq start 1;
create sequence public.goods_receipt_number_seq start 1;

create or replace function public.create_purchase_order(
  p_supplier_id uuid,
  p_items jsonb,
  p_expected_date date default null,
  p_notes text default ''
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.staff_role;
  v_order_id uuid;
  v_order_number text;
  v_item jsonb;
  v_product public.products%rowtype;
  v_qty numeric(14,3);
  v_cost numeric(14,2);
begin
  select role into v_role from public.profiles where id=v_actor and active;
  if v_role not in ('owner','manager','accountant') then raise exception 'Only owner, manager or accountant can create purchase orders'; end if;
  if not exists(select 1 from public.suppliers where id=p_supplier_id and active) then raise exception 'Select an active supplier'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Add at least one product to the order'; end if;
  v_order_number := 'PO-'||to_char(current_date,'YYYYMMDD')||'-'||lpad(nextval('public.purchase_order_number_seq')::text,4,'0');
  insert into public.purchase_orders(order_number,supplier_id,expected_date,notes,created_by)
  values(v_order_number,p_supplier_id,p_expected_date,coalesce(p_notes,''),v_actor) returning id into v_order_id;
  for v_item in select e from jsonb_array_elements(p_items) e loop
    v_qty := (v_item->>'quantity')::numeric;
    v_cost := (v_item->>'unit_cost')::numeric;
    if v_qty<=0 or v_cost<0 then raise exception 'Order quantities must be positive and costs non-negative'; end if;
    select * into v_product from public.products where id=(v_item->>'product_id')::uuid and active;
    if not found then raise exception 'An ordered product is inactive or missing'; end if;
    insert into public.purchase_order_items(purchase_order_id,product_id,quantity_ordered,unit_cost)
    values(v_order_id,v_product.id,v_qty,v_cost);
  end loop;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
  values(v_actor,'purchase_order.created','purchase_order',v_order_id,jsonb_build_object('order_number',v_order_number,'supplier_id',p_supplier_id));
  return jsonb_build_object('id',v_order_id,'order_number',v_order_number);
end;
$$;

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
  if v_role not in ('owner','manager','accountant') then raise exception 'Only owner, manager or accountant can receive supplier invoices'; end if;
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
    update public.products set quantity_on_hand=quantity_on_hand+v_qty,buying_price=v_cost,updated_at=now() where id=v_product_id;
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
    update public.purchase_orders set status='received' where id=p_purchase_order_id;
    update public.purchase_order_items poi set quantity_received=quantity_ordered
    where poi.purchase_order_id=p_purchase_order_id;
  end if;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
  values(v_actor,'supplier_invoice.received','supplier_invoice',v_invoice_id,jsonb_build_object('invoice_number',trim(p_invoice_number),'total',v_total,'receipt_number',v_receipt_number));
  return jsonb_build_object('invoice_id',v_invoice_id,'receipt_number',v_receipt_number,'total',v_total,'journal_id',v_journal_id);
end;
$$;

create or replace function public.pay_supplier_invoice(
  p_invoice_id uuid,
  p_payment_reference text,
  p_payment_method public.payment_method,
  p_amount numeric
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.staff_role;
  v_invoice public.supplier_invoices%rowtype;
  v_payment_id uuid;
  v_journal_id uuid;
  v_ap_account uuid;
  v_cash_account uuid;
  v_code text;
begin
  select role into v_role from public.profiles where id=v_actor and active;
  if v_role not in ('owner','manager','accountant') then raise exception 'Only owner, manager or accountant can pay suppliers'; end if;
  if p_payment_method not in ('cash','mobile_money','card','bank') then raise exception 'Choose cash, mobile money, card or bank for supplier payment'; end if;
  if nullif(trim(p_payment_reference),'') is null then raise exception 'Payment reference is required'; end if;
  if p_amount<=0 then raise exception 'Payment must be greater than zero'; end if;
  select * into v_invoice from public.supplier_invoices where id=p_invoice_id for update;
  if not found then raise exception 'Supplier invoice not found'; end if;
  if p_amount>v_invoice.total-v_invoice.amount_paid then raise exception 'Payment exceeds the invoice balance'; end if;
  if exists(select 1 from public.supplier_payments where supplier_id=v_invoice.supplier_id and payment_reference=trim(p_payment_reference)) then raise exception 'This payment reference already exists for this supplier'; end if;
  v_code:=case p_payment_method when 'cash' then '1000' when 'mobile_money' then '1010' when 'card' then '1010' when 'bank' then '1020' end;
  select id into v_ap_account from public.accounts where code='2000' and active;
  select id into v_cash_account from public.accounts where code=v_code and active;
  if v_ap_account is null or v_cash_account is null then raise exception 'Required chart-of-accounts entry is missing'; end if;
  insert into public.journals(source_type,source_id,memo,created_by)
  values('supplier_payment',gen_random_uuid(),'Payment for supplier invoice '||v_invoice.invoice_number,v_actor) returning id into v_journal_id;
  insert into public.journal_lines(journal_id,account_id,description,debit,credit)
  values(v_journal_id,v_ap_account,'Accounts payable settled',p_amount,0),(v_journal_id,v_cash_account,'Supplier payment',0,p_amount);
  insert into public.supplier_payments(supplier_id,invoice_id,payment_reference,payment_method,amount,journal_id,paid_by)
  values(v_invoice.supplier_id,v_invoice.id,trim(p_payment_reference),p_payment_method,p_amount,v_journal_id,v_actor)
  returning id into v_payment_id;
  update public.supplier_invoices set amount_paid=amount_paid+p_amount,status=case when amount_paid+p_amount=total then 'paid' else 'part_paid' end where id=v_invoice.id;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
  values(v_actor,'supplier_invoice.paid','supplier_invoice',v_invoice.id,jsonb_build_object('payment_reference',trim(p_payment_reference),'amount',p_amount));
  return jsonb_build_object('payment_id',v_payment_id,'journal_id',v_journal_id,'remaining_balance',v_invoice.total-v_invoice.amount_paid-p_amount);
end;
$$;

revoke all on function public.create_purchase_order(uuid,jsonb,date,text) from public, anon;
revoke all on function public.receive_supplier_invoice(uuid,text,date,date,jsonb,uuid,text) from public, anon;
revoke all on function public.pay_supplier_invoice(uuid,text,public.payment_method,numeric) from public, anon;
grant execute on function public.create_purchase_order(uuid,jsonb,date,text) to authenticated;
grant execute on function public.receive_supplier_invoice(uuid,text,date,date,jsonb,uuid,text) to authenticated;
grant execute on function public.pay_supplier_invoice(uuid,text,public.payment_method,numeric) to authenticated;
grant select on public.purchase_orders,public.purchase_order_items,public.supplier_invoices,public.supplier_invoice_items,public.goods_receipts,public.supplier_payments to authenticated;

commit;
