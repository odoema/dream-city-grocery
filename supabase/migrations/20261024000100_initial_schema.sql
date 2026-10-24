-- Dream City Grocery initial schema
-- Target: dedicated Supabase project nohdgmylncjtdymfshfy ONLY.
-- Review this file before applying. Never run it against SmartAttend.
begin;

create extension if not exists pgcrypto;

create type public.staff_role as enum ('owner','manager','cashier','accountant');
create type public.payment_method as enum ('cash','mobile_money','card','bank','credit');
create type public.account_type as enum ('asset','liability','equity','revenue','contra_revenue','expense');
create type public.inventory_movement_type as enum ('opening','purchase','sale','sale_return','purchase_return','adjustment');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role public.staff_role not null default 'cashier',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.dream_city_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $
begin
  insert into public.profiles(id, full_name, role, active)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''), 'cashier', true)
  on conflict (id) do nothing;
  return new;
end;
$;

create trigger dream_city_on_auth_user_created
  after insert on auth.users
  for each row execute function public.dream_city_handle_new_user();

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  address text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  credit_limit numeric(14,2) not null default 0 check (credit_limit >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  barcode text unique,
  name text not null,
  category_id uuid references public.categories(id),
  supplier_id uuid references public.suppliers(id),
  unit text not null default 'piece',
  buying_price numeric(14,2) not null default 0 check (buying_price >= 0),
  selling_price numeric(14,2) not null check (selling_price >= 0),
  quantity_on_hand numeric(14,3) not null default 0 check (quantity_on_hand >= 0),
  reorder_level numeric(14,3) not null default 0 check (reorder_level >= 0),
  image_path text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  type public.account_type not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('product-images','product-images',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  receipt_number text not null unique,
  idempotency_key uuid not null unique,
  cashier_id uuid not null references public.profiles(id),
  customer_id uuid references public.customers(id),
  payment_method public.payment_method not null,
  subtotal numeric(14,2) not null check (subtotal >= 0),
  discount numeric(14,2) not null default 0 check (discount >= 0),
  tax numeric(14,2) not null default 0 check (tax = 0),
  total numeric(14,2) not null check (total >= 0),
  cost_of_goods numeric(14,2) not null check (cost_of_goods >= 0),
  status text not null default 'completed' check (status in ('completed','voided','refunded')),
  created_at timestamptz not null default now()
);

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  product_name text not null,
  sku text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  unit_cost numeric(14,2) not null check (unit_cost >= 0),
  line_total numeric(14,2) not null check (line_total >= 0),
  line_cost numeric(14,2) not null check (line_cost >= 0)
);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  movement_type public.inventory_movement_type not null,
  quantity_delta numeric(14,3) not null check (quantity_delta <> 0),
  unit_cost numeric(14,2) not null default 0 check (unit_cost >= 0),
  reference_type text,
  reference_id uuid,
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.journals (
  id uuid primary key default gen_random_uuid(),
  journal_date timestamptz not null default now(),
  source_type text not null,
  source_id uuid not null,
  memo text not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(source_type, source_id)
);

create table public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  journal_id uuid not null references public.journals(id) on delete restrict,
  account_id uuid not null references public.accounts(id),
  description text not null default '',
  debit numeric(14,2) not null default 0 check (debit >= 0),
  credit numeric(14,2) not null default 0 check (credit >= 0),
  check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0))
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.record_product_opening_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $
begin
  if new.quantity_on_hand > 0 then
    insert into public.inventory_movements(product_id,movement_type,quantity_delta,unit_cost,reference_type,reference_id,note,created_by)
    values(new.id,'opening',new.quantity_on_hand,new.buying_price,'product',new.id,'Opening stock on product creation',auth.uid());
  end if;
  return new;
end;
$;

create trigger products_opening_stock_movement
  after insert on public.products
  for each row execute function public.record_product_opening_stock();

create index products_name_idx on public.products using gin (to_tsvector('simple', name));
create index products_active_idx on public.products(active);
create index sales_created_at_idx on public.sales(created_at desc);
create index sales_cashier_created_idx on public.sales(cashier_id, created_at desc);
create index sale_items_sale_idx on public.sale_items(sale_id);
create index inventory_movements_product_created_idx on public.inventory_movements(product_id, created_at desc);
create index journal_lines_journal_idx on public.journal_lines(journal_id);
create index audit_log_created_idx on public.audit_log(created_at desc);

insert into public.accounts(code,name,type) values
 ('1000','Cash','asset'),
 ('1010','Mobile Money / Card','asset'),
 ('1020','Bank','asset'),
 ('1100','Accounts Receivable','asset'),
 ('1200','Inventory','asset'),
 ('2000','Accounts Payable','liability'),
 ('3000','Owner Capital','equity'),
 ('3100','Retained Earnings','equity'),
 ('4000','Sales Revenue','revenue'),
 ('4900','Sales Returns & Discounts','contra_revenue'),
 ('5000','Cost of Goods Sold','expense'),
 ('6000','Operating Expenses','expense')
on conflict(code) do nothing;

create or replace function public.current_staff_role()
returns public.staff_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p
  where p.id = (select auth.uid()) and p.active = true
$$;

create or replace function public.is_active_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(select 1 from public.profiles p where p.id = (select auth.uid()) and p.active = true)
$$;

create or replace function public.can_manage_products()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(select 1 from public.profiles p where p.id = (select auth.uid()) and p.active = true and p.role in ('owner','manager'))
$$;

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.suppliers enable row level security;
alter table public.customers enable row level security;
alter table public.products enable row level security;
alter table public.accounts enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.journals enable row level security;
alter table public.journal_lines enable row level security;
alter table public.audit_log enable row level security;

create policy "staff can read own profile or managers can read all" on public.profiles for select to authenticated
using (id = (select auth.uid()) or public.current_staff_role() in ('owner','manager','accountant'));
create policy "active staff read categories" on public.categories for select to authenticated using (public.is_active_staff());
create policy "managers manage categories" on public.categories for all to authenticated using (public.can_manage_products()) with check (public.can_manage_products());
create policy "active staff read products" on public.products for select to authenticated using (public.is_active_staff());
create policy "managers manage products" on public.products for all to authenticated using (public.can_manage_products()) with check (public.can_manage_products());
create policy "managers read suppliers" on public.suppliers for select to authenticated using (public.current_staff_role() in ('owner','manager','accountant'));
create policy "managers manage suppliers" on public.suppliers for all to authenticated using (public.can_manage_products()) with check (public.can_manage_products());
create policy "staff read customers" on public.customers for select to authenticated using (public.is_active_staff());
create policy "managers manage customers" on public.customers for all to authenticated using (public.can_manage_products()) with check (public.can_manage_products());
create policy "staff read accounts" on public.accounts for select to authenticated using (public.current_staff_role() in ('owner','manager','accountant'));
create policy "authorized staff read sales" on public.sales for select to authenticated using (cashier_id = (select auth.uid()) or public.current_staff_role() in ('owner','manager','accountant'));
create policy "authorized staff read sale items" on public.sale_items for select to authenticated using (exists(select 1 from public.sales s where s.id = sale_id and (s.cashier_id = (select auth.uid()) or public.current_staff_role() in ('owner','manager','accountant'))));
create policy "authorized staff read inventory movements" on public.inventory_movements for select to authenticated using (public.current_staff_role() in ('owner','manager','accountant'));
create policy "authorized staff read journals" on public.journals for select to authenticated using (public.current_staff_role() in ('owner','manager','accountant'));
create policy "authorized staff read journal lines" on public.journal_lines for select to authenticated using (public.current_staff_role() in ('owner','manager','accountant'));
create policy "managers read audit log" on public.audit_log for select to authenticated using (public.current_staff_role() in ('owner','manager','accountant'));

create policy "active staff read product images" on storage.objects for select to authenticated using (bucket_id = 'product-images' and public.is_active_staff());
create policy "managers upload product images" on storage.objects for insert to authenticated with check (bucket_id = 'product-images' and public.can_manage_products());
create policy "managers update product images" on storage.objects for update to authenticated using (bucket_id = 'product-images' and public.can_manage_products()) with check (bucket_id = 'product-images' and public.can_manage_products());
create policy "managers delete product images" on storage.objects for delete to authenticated using (bucket_id = 'product-images' and public.can_manage_products());

-- No direct authenticated writes to sales, stock movements, journals, journal lines or audit log.
-- Those records are written only by the atomic SECURITY DEFINER checkout function.

create sequence public.receipt_number_seq start 482;

create or replace function public.complete_sale(
  p_items jsonb,
  p_payment_method public.payment_method,
  p_idempotency_key uuid,
  p_customer_id uuid default null,
  p_discount numeric default 0,
  p_tax numeric default 0
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.staff_role;
  v_item jsonb;
  v_product public.products%rowtype;
  v_product_id uuid;
  v_qty numeric(14,3);
  v_unit_price numeric(14,2);
  v_line_total numeric(14,2);
  v_subtotal numeric(14,2) := 0;
  v_discount numeric(14,2) := coalesce(p_discount,0);
  v_total numeric(14,2);
  v_cogs numeric(14,2) := 0;
  v_line_cost numeric(14,2);
  v_sale_id uuid;
  v_receipt text;
  v_journal_id uuid;
  v_payment_account uuid;
  v_revenue_account uuid;
  v_discount_account uuid;
  v_inventory_account uuid;
  v_cogs_account uuid;
  v_ar_account uuid;
  v_account_code text;
  v_existing public.sales%rowtype;
begin
  if v_actor is null then raise exception 'Sign in before completing a sale'; end if;
  select p.role into v_role from public.profiles p where p.id = v_actor and p.active = true;
  if v_role is null then raise exception 'Your staff account is inactive or not configured'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Add at least one product'; end if;
  if p_tax is distinct from 0 then raise exception 'Tax is disabled until the tax accounting policy is configured'; end if;
  if v_discount < 0 then raise exception 'Discount cannot be negative'; end if;
  if v_discount > 0 and v_role not in ('owner','manager') then raise exception 'Only an owner or manager may authorize a discount'; end if;
  if p_payment_method = 'credit' and p_customer_id is null then raise exception 'Select a customer for a credit sale'; end if;
  if p_payment_method <> 'credit' and p_customer_id is not null then
    if not exists(select 1 from public.customers c where c.id=p_customer_id and c.active) then raise exception 'Customer is inactive or not found'; end if;
  end if;

  select * into v_existing from public.sales where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.cashier_id <> v_actor then raise exception 'Idempotency key already belongs to another cashier'; end if;
    return jsonb_build_object('sale_id',v_existing.id,'receipt_number',v_existing.receipt_number,'subtotal',v_existing.subtotal,'discount',v_existing.discount,'tax',v_existing.tax,'total',v_existing.total,'cost_of_goods',v_existing.cost_of_goods,'replayed',true);
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_items) e
    group by (e->>'product_id') having count(*) > 1
  ) then raise exception 'Cart contains duplicate product lines; combine quantities before checkout'; end if;

  -- Validate and lock products in stable UUID order to reduce deadlock risk.
  for v_item in
    select e from jsonb_array_elements(p_items) e order by (e->>'product_id')::uuid
  loop
    if coalesce((v_item->>'quantity')::numeric,0) <= 0 then raise exception 'Quantity must be greater than zero'; end if;
    v_product_id := (v_item->>'product_id')::uuid;
    select * into v_product from public.products p where p.id=v_product_id and p.active=true for update;
    if not found then raise exception 'A product is inactive or no longer available'; end if;
    v_qty := (v_item->>'quantity')::numeric;
    if v_product.quantity_on_hand < v_qty then raise exception 'Insufficient stock for % (available %, requested %)',v_product.name,v_product.quantity_on_hand,v_qty; end if;
    if v_item ? 'unit_price' and (v_item->>'unit_price')::numeric is distinct from v_product.selling_price then
      if v_role not in ('owner','manager') then raise exception 'Cashiers must use the listed selling price'; end if;
      if (v_item->>'unit_price')::numeric < 0 then raise exception 'Unit price cannot be negative'; end if;
      v_unit_price := (v_item->>'unit_price')::numeric;
    else
      v_unit_price := v_product.selling_price;
    end if;
    v_line_total := round(v_qty * v_unit_price,2);
    v_line_cost := round(v_qty * v_product.buying_price,2);
    v_subtotal := v_subtotal + v_line_total;
    v_cogs := v_cogs + v_line_cost;
  end loop;

  if v_discount > v_subtotal then raise exception 'Discount cannot exceed the sale subtotal'; end if;
  v_total := round(v_subtotal - v_discount,2);
  if v_total < 0 then raise exception 'Sale total cannot be negative'; end if;

  if p_payment_method = 'credit' then
    perform 1 from public.customers c where c.id=p_customer_id and c.active for update;
    if not found then raise exception 'Customer is inactive or not found'; end if;
    if (
      select coalesce(sum(s.total),0) from public.sales s
      where s.customer_id=p_customer_id and s.payment_method='credit' and s.status='completed'
    ) + v_total > (select c.credit_limit from public.customers c where c.id=p_customer_id) then
      raise exception 'Credit sale exceeds the customer credit limit';
    end if;
  end if;

  v_account_code := case p_payment_method
    when 'cash' then '1000'
    when 'mobile_money' then '1010'
    when 'card' then '1010'
    when 'bank' then '1020'
    when 'credit' then '1100'
  end;
  select id into v_payment_account from public.accounts where code=v_account_code and active;
  select id into v_revenue_account from public.accounts where code='4000' and active;
  select id into v_discount_account from public.accounts where code='4900' and active;
  select id into v_inventory_account from public.accounts where code='1200' and active;
  select id into v_cogs_account from public.accounts where code='5000' and active;
  select id into v_ar_account from public.accounts where code='1100' and active;
  if v_payment_account is null or v_revenue_account is null or v_discount_account is null or v_inventory_account is null or v_cogs_account is null or v_ar_account is null then
    raise exception 'Required active chart-of-accounts entries are missing';
  end if;

  v_receipt := 'DCG-' || lpad(nextval('public.receipt_number_seq')::text,6,'0');
  insert into public.sales(receipt_number,idempotency_key,cashier_id,customer_id,payment_method,subtotal,discount,tax,total,cost_of_goods)
  values(v_receipt,p_idempotency_key,v_actor,p_customer_id,p_payment_method,v_subtotal,v_discount,0,v_total,v_cogs)
  returning id into v_sale_id;

  for v_item in select e from jsonb_array_elements(p_items) e order by (e->>'product_id')::uuid loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::numeric;
    select * into v_product from public.products where id=v_product_id;
    if v_item ? 'unit_price' and (v_item->>'unit_price')::numeric is distinct from v_product.selling_price then
      v_unit_price := (v_item->>'unit_price')::numeric;
    else
      v_unit_price := v_product.selling_price;
    end if;
    v_line_total := round(v_qty*v_unit_price,2);
    v_line_cost := round(v_qty*v_product.buying_price,2);
    insert into public.sale_items(sale_id,product_id,product_name,sku,quantity,unit_price,unit_cost,line_total,line_cost)
    values(v_sale_id,v_product.id,v_product.name,v_product.sku,v_qty,v_unit_price,v_product.buying_price,v_line_total,v_line_cost);
    update public.products set quantity_on_hand=quantity_on_hand-v_qty,updated_at=now() where id=v_product.id;
    insert into public.inventory_movements(product_id,movement_type,quantity_delta,unit_cost,reference_type,reference_id,note,created_by)
    values(v_product.id,'sale',-v_qty,v_product.buying_price,'sale',v_sale_id,'POS sale '||v_receipt,v_actor);
  end loop;

  insert into public.journals(source_type,source_id,memo,created_by)
  values('sale',v_sale_id,'POS sale '||v_receipt,v_actor) returning id into v_journal_id;

  insert into public.journal_lines(journal_id,account_id,description,debit,credit)
  values(v_journal_id,v_payment_account,'Sale proceeds',v_total,0);
  if v_subtotal-v_discount > 0 then
    insert into public.journal_lines(journal_id,account_id,description,debit,credit)
    values(v_journal_id,v_revenue_account,'Gross sales before authorized discount',0,v_subtotal);
  end if;
  if v_discount > 0 then
    insert into public.journal_lines(journal_id,account_id,description,debit,credit)
    values(v_journal_id,v_discount_account,'Authorized sales discount',v_discount,0);
  end if;
  if v_cogs > 0 then
    insert into public.journal_lines(journal_id,account_id,description,debit,credit)
    values(v_journal_id,v_cogs_account,'Cost of goods sold',v_cogs,0);
    insert into public.journal_lines(journal_id,account_id,description,debit,credit)
    values(v_journal_id,v_inventory_account,'Inventory relieved',0,v_cogs);
  end if;
  if (select coalesce(sum(debit),0)-coalesce(sum(credit),0) from public.journal_lines where journal_id=v_journal_id) <> 0 then
    raise exception 'Accounting journal failed the balance check';
  end if;

  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
  values(v_actor,'sale.completed','sale',v_sale_id,jsonb_build_object('receipt_number',v_receipt,'total',v_total,'payment_method',p_payment_method));

  return jsonb_build_object('sale_id',v_sale_id,'receipt_number',v_receipt,'subtotal',v_subtotal,'discount',v_discount,'tax',0,'total',v_total,'cost_of_goods',v_cogs,'replayed',false);
end;
$$;

revoke all on function public.current_staff_role() from public, anon;
revoke all on function public.is_active_staff() from public, anon;
revoke all on function public.can_manage_products() from public, anon;
revoke all on function public.complete_sale(jsonb, public.payment_method, uuid, uuid, numeric, numeric) from public, anon;
grant execute on function public.current_staff_role() to authenticated;
grant execute on function public.is_active_staff() to authenticated;
grant execute on function public.can_manage_products() to authenticated;
grant execute on function public.complete_sale(jsonb, public.payment_method, uuid, uuid, numeric, numeric) to authenticated;

grant usage on schema public to authenticated;
grant select on public.profiles, public.categories, public.products, public.customers, public.suppliers, public.accounts, public.sales, public.sale_items, public.inventory_movements, public.journals, public.journal_lines, public.audit_log to authenticated;
grant insert, update, delete on public.categories, public.products, public.customers, public.suppliers to authenticated;
grant usage, select on sequence public.receipt_number_seq to authenticated;

commit;
