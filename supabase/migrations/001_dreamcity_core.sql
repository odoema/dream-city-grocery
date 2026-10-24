-- Dream City Grocery core schema
-- Isolated in its own schema so it can safely coexist with other applications.

create schema if not exists dreamcity;
create extension if not exists pgcrypto;

create type dreamcity.user_role as enum ('owner','manager','cashier','accountant');
create type dreamcity.payment_method as enum ('cash','mobile_money','card','bank','credit');
create type dreamcity.inventory_movement_type as enum ('purchase','sale','sale_return','purchase_return','adjustment','opening');
create type dreamcity.account_type as enum ('asset','liability','equity','revenue','expense','contra_asset');

create table dreamcity.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role dreamcity.user_role not null default 'cashier',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table dreamcity.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table dreamcity.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  address text,
  tax_number text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table dreamcity.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  address text,
  credit_limit numeric(14,2) not null default 0 check (credit_limit >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table dreamcity.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  barcode text unique,
  name text not null,
  category_id uuid references dreamcity.categories(id),
  supplier_id uuid references dreamcity.suppliers(id),
  buying_price numeric(14,2) not null default 0 check (buying_price >= 0),
  selling_price numeric(14,2) not null default 0 check (selling_price >= 0),
  quantity_on_hand numeric(14,3) not null default 0 check (quantity_on_hand >= 0),
  reorder_level numeric(14,3) not null default 0 check (reorder_level >= 0),
  unit text not null default 'pcs',
  expiry_date date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table dreamcity.accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null unique,
  account_type dreamcity.account_type not null,
  parent_id uuid references dreamcity.accounts(id),
  active boolean not null default true
);

create table dreamcity.sales (
  id uuid primary key default gen_random_uuid(),
  receipt_number text not null unique,
  customer_id uuid references dreamcity.customers(id),
  cashier_id uuid not null references auth.users(id),
  payment_method dreamcity.payment_method not null,
  subtotal numeric(14,2) not null check (subtotal >= 0),
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  tax_amount numeric(14,2) not null default 0 check (tax_amount >= 0),
  total_amount numeric(14,2) not null check (total_amount >= 0),
  status text not null default 'completed' check (status in ('completed','voided','refunded')),
  created_at timestamptz not null default now()
);

create table dreamcity.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references dreamcity.sales(id) on delete cascade,
  product_id uuid not null references dreamcity.products(id),
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  unit_cost numeric(14,2) not null check (unit_cost >= 0),
  line_total numeric(14,2) generated always as (round(quantity * unit_price, 2)) stored,
  cost_total numeric(14,2) generated always as (round(quantity * unit_cost, 2)) stored
);

create table dreamcity.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references dreamcity.products(id),
  movement_type dreamcity.inventory_movement_type not null,
  quantity numeric(14,3) not null,
  unit_cost numeric(14,2) not null default 0,
  reference_id uuid,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table dreamcity.journals (
  id uuid primary key default gen_random_uuid(),
  reference_type text not null,
  reference_id uuid,
  description text not null,
  posted_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table dreamcity.journal_lines (
  id uuid primary key default gen_random_uuid(),
  journal_id uuid not null references dreamcity.journals(id) on delete cascade,
  account_id uuid not null references dreamcity.accounts(id),
  debit numeric(14,2) not null default 0 check (debit >= 0),
  credit numeric(14,2) not null default 0 check (credit >= 0),
  check ((debit = 0 and credit > 0) or (credit = 0 and debit > 0))
);

create table dreamcity.expenses (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references dreamcity.accounts(id),
  payment_method dreamcity.payment_method not null,
  amount numeric(14,2) not null check (amount > 0),
  description text not null,
  incurred_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create table dreamcity.audit_log (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index products_category_idx on dreamcity.products(category_id);
create index products_supplier_idx on dreamcity.products(supplier_id);
create index products_low_stock_idx on dreamcity.products(quantity_on_hand, reorder_level) where active;
create index sales_created_at_idx on dreamcity.sales(created_at desc);
create index sales_cashier_idx on dreamcity.sales(cashier_id, created_at desc);
create index sale_items_product_idx on dreamcity.sale_items(product_id);
create index inventory_movements_product_idx on dreamcity.inventory_movements(product_id, created_at desc);
create index journal_lines_account_idx on dreamcity.journal_lines(account_id);
create index audit_log_created_idx on dreamcity.audit_log(created_at desc);

insert into dreamcity.accounts(code,name,account_type) values
('1000','Cash','asset'),
('1010','Mobile Money','asset'),
('1020','Bank','asset'),
('1100','Accounts Receivable','asset'),
('1200','Inventory','asset'),
('2000','Accounts Payable','liability'),
('3000','Owner Capital','equity'),
('3100','Retained Earnings','equity'),
('4000','Sales Revenue','revenue'),
('4900','Sales Returns & Discounts','contra_asset'),
('5000','Cost of Goods Sold','expense'),
('6000','Operating Expenses','expense')
on conflict (code) do nothing;

create or replace function dreamcity.current_role()
returns dreamcity.user_role
language sql stable security definer set search_path = dreamcity, public
as $$ select role from dreamcity.profiles where user_id = auth.uid() and active = true limit 1 $$;

create or replace function dreamcity.can_manage()
returns boolean
language sql stable security definer set search_path = dreamcity, public
as $$ select coalesce(dreamcity.current_role() in ('owner','manager','accountant'), false) $$;

create or replace function dreamcity.complete_sale(
  p_items jsonb,
  p_payment_method dreamcity.payment_method,
  p_customer_id uuid default null,
  p_discount numeric default 0,
  p_tax numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = dreamcity, public
as $$
declare
  v_sale_id uuid := gen_random_uuid();
  v_receipt text := 'DCG-' || to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS') || '-' || substr(replace(v_sale_id::text,'-',''),1,6);
  v_subtotal numeric(14,2) := 0;
  v_total numeric(14,2) := 0;
  v_cogs numeric(14,2) := 0;
  v_item jsonb;
  v_product dreamcity.products%rowtype;
  v_qty numeric(14,3);
  v_unit_price numeric(14,2);
  v_line numeric(14,2);
  v_cost numeric(14,2);
  v_journal uuid;
  v_sales_account uuid;
  v_cogs_account uuid;
  v_inventory_account uuid;
  v_cash_account uuid;
  v_payment_account uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if dreamcity.current_role() is null then raise exception 'Active Dream City Grocery user profile required'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Sale must contain at least one item'; end if;
  if p_discount < 0 or p_tax < 0 then raise exception 'Discount and tax cannot be negative'; end if;

  select id into v_sales_account from dreamcity.accounts where code='4000';
  select id into v_cogs_account from dreamcity.accounts where code='5000';
  select id into v_inventory_account from dreamcity.accounts where code='1200';
  select id into v_cash_account from dreamcity.accounts where code='1000';
  select id into v_payment_account from dreamcity.accounts where code = case p_payment_method when 'cash' then '1000' when 'mobile_money' then '1010' when 'bank' then '1020' when 'card' then '1010' else '1100' end;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_product from dreamcity.products where id=(v_item->>'product_id')::uuid and active for update;
    if not found then raise exception 'Product not found or inactive: %', v_item->>'product_id'; end if;
    v_qty := (v_item->>'quantity')::numeric;
    if v_qty <= 0 then raise exception 'Quantity must be positive'; end if;
    if v_product.quantity_on_hand < v_qty then raise exception 'Insufficient stock for % (available %, requested %)', v_product.name, v_product.quantity_on_hand, v_qty; end if;
    v_unit_price := coalesce((v_item->>'unit_price')::numeric, v_product.selling_price);
    if v_unit_price < 0 then raise exception 'Unit price cannot be negative'; end if;
    v_line := round(v_qty * v_unit_price, 2);
    v_subtotal := v_subtotal + v_line;
    v_cost := round(v_qty * v_product.buying_price, 2);
    v_cogs := v_cogs + v_cost;
  end loop;

  v_total := round(v_subtotal - p_discount + p_tax, 2);
  if v_total < 0 then raise exception 'Sale total cannot be negative'; end if;

  insert into dreamcity.sales(id,receipt_number,customer_id,cashier_id,payment_method,subtotal,discount_amount,tax_amount,total_amount)
  values(v_sale_id,v_receipt,p_customer_id,auth.uid(),p_payment_method,v_subtotal,p_discount,p_tax,v_total);

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_product from dreamcity.products where id=(v_item->>'product_id')::uuid for update;
    v_qty := (v_item->>'quantity')::numeric;
    v_unit_price := coalesce((v_item->>'unit_price')::numeric, v_product.selling_price);
    insert into dreamcity.sale_items(sale_id,product_id,quantity,unit_price,unit_cost)
    values(v_sale_id,v_product.id,v_qty,v_unit_price,v_product.buying_price);
    update dreamcity.products set quantity_on_hand=quantity_on_hand-v_qty, updated_at=now() where id=v_product.id;
    insert into dreamcity.inventory_movements(product_id,movement_type,quantity,unit_cost,reference_id,created_by)
    values(v_product.id,'sale',-v_qty,v_product.buying_price,v_sale_id,auth.uid());
  end loop;

  insert into dreamcity.journals(reference_type,reference_id,description,posted_by)
  values('sale',v_sale_id,'Sale '||v_receipt,auth.uid()) returning id into v_journal;
  insert into dreamcity.journal_lines(journal_id,account_id,debit,credit) values(v_journal,v_payment_account,v_total,0);
  insert into dreamcity.journal_lines(journal_id,account_id,debit,credit) values(v_journal,v_sales_account,0,round(v_subtotal-p_discount,2));
  if p_tax > 0 then
    -- Tax is held as a liability in the next accounting migration; for now keep the journal balanced by including it in revenue.
    update dreamcity.journal_lines set credit=round(v_total,2) where id=(select id from dreamcity.journal_lines where journal_id=v_journal and account_id=v_sales_account limit 1);
  end if;
  insert into dreamcity.journal_lines(journal_id,account_id,debit,credit) values(v_journal,v_cogs_account,v_cogs,0);
  insert into dreamcity.journal_lines(journal_id,account_id,debit,credit) values(v_journal,v_inventory_account,0,v_cogs);

  insert into dreamcity.audit_log(user_id,action,entity_type,entity_id,details)
  values(auth.uid(),'sale_completed','sale',v_sale_id,jsonb_build_object('receipt_number',v_receipt,'total',v_total,'payment_method',p_payment_method));

  return jsonb_build_object('sale_id',v_sale_id,'receipt_number',v_receipt,'subtotal',v_subtotal,'discount',p_discount,'tax',p_tax,'total',v_total,'cogs',v_cogs);
end;
$$;

grant usage on schema dreamcity to authenticated;
grant select, insert, update, delete on all tables in schema dreamcity to authenticated;
grant execute on function dreamcity.complete_sale(jsonb,dreamcity.payment_method,uuid,numeric,numeric) to authenticated;

alter table dreamcity.profiles enable row level security;
alter table dreamcity.categories enable row level security;
alter table dreamcity.suppliers enable row level security;
alter table dreamcity.customers enable row level security;
alter table dreamcity.products enable row level security;
alter table dreamcity.accounts enable row level security;
alter table dreamcity.sales enable row level security;
alter table dreamcity.sale_items enable row level security;
alter table dreamcity.inventory_movements enable row level security;
alter table dreamcity.journals enable row level security;
alter table dreamcity.journal_lines enable row level security;
alter table dreamcity.expenses enable row level security;
alter table dreamcity.audit_log enable row level security;

create policy profile_self_or_manager on dreamcity.profiles for select to authenticated using (user_id=auth.uid() or dreamcity.can_manage());
create policy products_read on dreamcity.products for select to authenticated using (active or dreamcity.can_manage());
create policy products_manage on dreamcity.products for all to authenticated using (dreamcity.can_manage()) with check (dreamcity.can_manage());
create policy categories_read on dreamcity.categories for select to authenticated using (active or dreamcity.can_manage());
create policy categories_manage on dreamcity.categories for all to authenticated using (dreamcity.can_manage()) with check (dreamcity.can_manage());
create policy suppliers_read on dreamcity.suppliers for select to authenticated using (true);
create policy suppliers_manage on dreamcity.suppliers for all to authenticated using (dreamcity.can_manage()) with check (dreamcity.can_manage());
create policy customers_read on dreamcity.customers for select to authenticated using (true);
create policy customers_manage on dreamcity.customers for all to authenticated using (dreamcity.can_manage()) with check (dreamcity.can_manage());
create policy sales_read on dreamcity.sales for select to authenticated using (cashier_id=auth.uid() or dreamcity.can_manage());
create policy sale_items_read on dreamcity.sale_items for select to authenticated using (exists(select 1 from dreamcity.sales s where s.id=sale_id and (s.cashier_id=auth.uid() or dreamcity.can_manage())));
create policy inventory_read on dreamcity.inventory_movements for select to authenticated using (true);
create policy journal_read on dreamcity.journals for select to authenticated using (dreamcity.can_manage());
create policy journal_lines_read on dreamcity.journal_lines for select to authenticated using (dreamcity.can_manage());
create policy accounts_read on dreamcity.accounts for select to authenticated using (true);
create policy expenses_manage on dreamcity.expenses for all to authenticated using (dreamcity.can_manage()) with check (dreamcity.can_manage());
create policy audit_read on dreamcity.audit_log for select to authenticated using (dreamcity.can_manage());
