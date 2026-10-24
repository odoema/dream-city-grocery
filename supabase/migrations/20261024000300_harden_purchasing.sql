-- Dream City Grocery: targeted hardening of purchasing RPCs.
-- Safe to apply after 20261024000200_purchasing_ap.sql has already been applied.
-- Does not recreate, drop, or truncate tables. Apply ONLY to project nohdgmylncjtdymfshfy.
begin;

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
  v_product_id uuid;
  v_qty numeric(14,3);
  v_cost numeric(14,2);
begin
  select role into v_role from public.profiles where id=v_actor and active;
  if v_actor is null or v_role is null or v_role not in ('owner','manager','accountant') then
    raise exception 'Only owner, manager or accountant can create purchase orders';
  end if;
  if not exists(select 1 from public.suppliers where id=p_supplier_id and active) then
    raise exception 'Select an active supplier';
  end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then
    raise exception 'Add at least one product to the order';
  end if;

  -- Validate line structure, numeric ranges and duplicate products before writing anything.
  for v_item in select e from jsonb_array_elements(p_items) e loop
    if jsonb_typeof(v_item)<>'object'
       or nullif(v_item->>'product_id','') is null
       or nullif(v_item->>'quantity','') is null
       or nullif(v_item->>'unit_cost','') is null then
      raise exception 'Each order line must include product_id, quantity and unit_cost';
    end if;
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::numeric;
    v_cost := (v_item->>'unit_cost')::numeric;
    if v_qty is null or v_qty<=0 or v_qty='NaN'::numeric or v_qty='Infinity'::numeric or v_qty='-Infinity'::numeric
       or v_cost is null or v_cost<0 or v_cost='NaN'::numeric or v_cost='Infinity'::numeric or v_cost='-Infinity'::numeric then
      raise exception 'Order quantities must be positive and costs must be non-negative finite numbers';
    end if;
    if exists(select 1 from jsonb_array_elements(p_items) e where (e->>'product_id')::uuid=v_product_id group by (e->>'product_id') having count(*)>1) then
      raise exception 'Combine duplicate product lines before creating the order';
    end if;
    select * into v_product from public.products where id=v_product_id and active;
    if not found then raise exception 'An ordered product is inactive or missing'; end if;
  end loop;

  v_order_number := 'PO-'||to_char(current_date,'YYYYMMDD')||'-'||lpad(nextval('public.purchase_order_number_seq')::text,4,'0');
  insert into public.purchase_orders(order_number,supplier_id,expected_date,notes,created_by)
  values(v_order_number,p_supplier_id,p_expected_date,coalesce(p_notes,''),v_actor) returning id into v_order_id;

  for v_item in select e from jsonb_array_elements(p_items) e loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::numeric;
    v_cost := (v_item->>'unit_cost')::numeric;
    insert into public.purchase_order_items(purchase_order_id,product_id,quantity_ordered,unit_cost)
    values(v_order_id,v_product_id,v_qty,v_cost);
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
  v_po public.purchase_orders%rowtype;
begin
  select role into v_role from public.profiles where id=v_actor and active;
  if v_actor is null or v_role is null or v_role not in ('owner','manager','accountant') then
    raise exception 'Only owner, manager or accountant can receive supplier invoices';
  end if;
  if not exists(select 1 from public.suppliers where id=p_supplier_id and active) then
    raise exception 'Select an active supplier';
  end if;
  if nullif(trim(p_invoice_number),'') is null then raise exception 'Supplier invoice number is required'; end if;
  if p_due_date is not null and p_invoice_date is not null and p_due_date<p_invoice_date then
    raise exception 'Due date cannot be before invoice date';
  end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then
    raise exception 'Add at least one received product';
  end if;

  -- Serialize all receipts against the same PO by locking the parent before checking received quantities.
  -- This prevents concurrent transactions from both consuming the same outstanding PO quantity.
  if p_purchase_order_id is not null then
    select * into v_po from public.purchase_orders where id=p_purchase_order_id for update;
    if not found or v_po.supplier_id<>p_supplier_id or v_po.status not in ('ordered','part_received') then
      raise exception 'Purchase order does not match this supplier or is not open';
    end if;
    perform 1 from public.purchase_order_items
      where purchase_order_id=p_purchase_order_id order by product_id for update;
  end if;

  if exists(select 1 from public.supplier_invoices where supplier_id=p_supplier_id and invoice_number=trim(p_invoice_number)) then
    raise exception 'This supplier invoice number has already been recorded';
  end if;

  -- Validate all lines before any stock or accounting writes.
  for v_item in select e from jsonb_array_elements(p_items) e loop
    if jsonb_typeof(v_item)<>'object'
       or nullif(v_item->>'product_id','') is null
       or nullif(v_item->>'quantity','') is null
       or nullif(v_item->>'unit_cost','') is null then
      raise exception 'Each received line must include product_id, quantity and unit_cost';
    end if;
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::numeric;
    v_cost := (v_item->>'unit_cost')::numeric;
    if v_qty is null or v_qty<=0 or v_qty='NaN'::numeric or v_qty='Infinity'::numeric or v_qty='-Infinity'::numeric
       or v_cost is null or v_cost<0 or v_cost='NaN'::numeric or v_cost='Infinity'::numeric or v_cost='-Infinity'::numeric then
      raise exception 'Received quantities must be positive and costs must be non-negative finite numbers';
    end if;
    if exists(select 1 from jsonb_array_elements(p_items) e where (e->>'product_id')::uuid=v_product_id group by (e->>'product_id') having count(*)>1) then
      raise exception 'Combine duplicate product lines before receiving';
    end if;
    select * into v_product from public.products where id=v_product_id and active for update;
    if not found then raise exception 'A received product is inactive or missing'; end if;
    if p_purchase_order_id is not null and not exists(
      select 1 from public.purchase_order_items poi
      where poi.purchase_order_id=p_purchase_order_id
        and poi.product_id=v_product_id
        and poi.quantity_received+v_qty<=poi.quantity_ordered
    ) then
      raise exception 'Received quantity exceeds or does not match the selected purchase order';
    end if;
    v_total := v_total + round(v_qty*v_cost,2);
  end loop;
  if v_total<=0 then raise exception 'Invoice total must be greater than zero'; end if;

  insert into public.supplier_invoices(supplier_id,purchase_order_id,invoice_number,invoice_date,due_date,total,created_by)
  values(p_supplier_id,p_purchase_order_id,trim(p_invoice_number),coalesce(p_invoice_date,current_date),p_due_date,v_total,v_actor)
  returning id into v_invoice_id;

  for v_item in select e from jsonb_array_elements(p_items) e loop
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
    for v_item in select e from jsonb_array_elements(p_items) e loop
      update public.purchase_order_items set quantity_received=quantity_received+(v_item->>'quantity')::numeric
      where purchase_order_id=p_purchase_order_id and product_id=(v_item->>'product_id')::uuid;
    end loop;
    update public.purchase_orders set status=case
      when not exists(select 1 from public.purchase_order_items poi where poi.purchase_order_id=p_purchase_order_id and poi.quantity_received<poi.quantity_ordered)
      then 'received' else 'part_received' end
    where id=p_purchase_order_id;
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
  v_amount numeric(14,2);
begin
  select role into v_role from public.profiles where id=v_actor and active;
  if v_actor is null or v_role is null or v_role not in ('owner','manager','accountant') then
    raise exception 'Only owner, manager or accountant can pay suppliers';
  end if;
  if p_payment_method is null or p_payment_method not in ('cash','mobile_money','card','bank') then
    raise exception 'Choose cash, mobile money, card or bank for supplier payment';
  end if;
  if nullif(trim(p_payment_reference),'') is null then raise exception 'Payment reference is required'; end if;
  if p_amount is null or p_amount<=0 or p_amount='NaN'::numeric or p_amount='Infinity'::numeric or p_amount='-Infinity'::numeric then
    raise exception 'Payment must be a positive finite amount';
  end if;
  v_amount := round(p_amount,2);
  if v_amount<=0 then raise exception 'Payment must be at least 0.01'; end if;

  select * into v_invoice from public.supplier_invoices where id=p_invoice_id for update;
  if not found then raise exception 'Supplier invoice not found'; end if;
  if v_amount>v_invoice.total-v_invoice.amount_paid then raise exception 'Payment exceeds the invoice balance'; end if;
  if exists(select 1 from public.supplier_payments where supplier_id=v_invoice.supplier_id and payment_reference=trim(p_payment_reference)) then
    raise exception 'This payment reference already exists for this supplier';
  end if;

  v_code:=case p_payment_method when 'cash' then '1000' when 'mobile_money' then '1010' when 'card' then '1010' when 'bank' then '1020' end;
  select id into v_ap_account from public.accounts where code='2000' and active;
  select id into v_cash_account from public.accounts where code=v_code and active;
  if v_ap_account is null or v_cash_account is null then raise exception 'Required chart-of-accounts entry is missing'; end if;

  insert into public.journals(source_type,source_id,memo,created_by)
  values('supplier_payment',gen_random_uuid(),'Payment for supplier invoice '||v_invoice.invoice_number,v_actor) returning id into v_journal_id;
  insert into public.journal_lines(journal_id,account_id,description,debit,credit)
  values(v_journal_id,v_ap_account,'Accounts payable settled',v_amount,0),(v_journal_id,v_cash_account,'Supplier payment',0,v_amount);
  insert into public.supplier_payments(supplier_id,invoice_id,payment_reference,payment_method,amount,journal_id,paid_by)
  values(v_invoice.supplier_id,v_invoice.id,trim(p_payment_reference),p_payment_method,v_amount,v_journal_id,v_actor)
  returning id into v_payment_id;
  update public.supplier_invoices set amount_paid=amount_paid+v_amount,
    status=case when amount_paid+v_amount=total then 'paid' else 'part_paid' end
  where id=v_invoice.id;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
  values(v_actor,'supplier_invoice.paid','supplier_invoice',v_invoice.id,jsonb_build_object('payment_reference',trim(p_payment_reference),'amount',v_amount));
  return jsonb_build_object('payment_id',v_payment_id,'journal_id',v_journal_id,'remaining_balance',v_invoice.total-v_invoice.amount_paid-v_amount);
end;
$$;

revoke all on function public.create_purchase_order(uuid,jsonb,date,text) from public, anon;
revoke all on function public.receive_supplier_invoice(uuid,text,date,date,jsonb,uuid,text) from public, anon;
revoke all on function public.pay_supplier_invoice(uuid,text,public.payment_method,numeric) from public, anon;
grant execute on function public.create_purchase_order(uuid,jsonb,date,text) to authenticated;
grant execute on function public.receive_supplier_invoice(uuid,text,date,date,jsonb,uuid,text) to authenticated;
grant execute on function public.pay_supplier_invoice(uuid,text,public.payment_method,numeric) to authenticated;

commit;
