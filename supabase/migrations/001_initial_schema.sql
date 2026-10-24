create extension if not exists pgcrypto;

create type public.user_role as enum ('owner','manager','cashier','accountant');
create type public.payment_method as enum ('cash','mobile_money','card','credit');
create type public.account_type as enum ('asset','liability','equity','revenue','expense');
create type public.sale_status as enum ('posted','voided','refunded');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text,
  role public.user_role not null default 'cashier',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

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

create table public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  barcode text unique,
  name text not null,
  category_id uuid references public.categories(id),
  supplier_id uuid references public.suppliers(id),
  buying_price numeric(14,2) not null default 0 check (buying_price >= 0),
  selling_price numeric(14,2) not null default 0 check (selling_price >= 0),
  quantity_on_hand numeric(14,3) not null default 0 check (quantity_on_hand >= 0),
  reorder_level numeric(14,3) not null default 0 check (reorder_level >= 0),
  expiry_date date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  created_at timestamptz not null default now()
);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  receipt_number text not null unique,
  cashier_id uuid references public.profiles(id),
  customer_id uuid references public.customers(id),
  payment_method public.payment_method not null,
  status public.sale_status not null default 'posted',
  subtotal numeric(14,2) not null check (subtotal >= 0),
  tax_amount numeric(14,2) not null default 0 check (tax_amount >= 0),
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  total_amount numeric(14,2) not null check (total_amount >= 0),
  currency char(3) not null default 'UGX',
  created_at timestamptz not null default now(),
  check (total_amount = subtotal + tax_amount - discount_amount)
);

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete restrict,
  product_id uuid not null references public.products(id),
  product_name_snapshot text not null,
  sku_snapshot text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  unit_cost numeric(14,2) not null check (unit_cost >= 0),
  line_discount numeric(14,2) not null default 0 check (line_discount >= 0),
  line_total numeric(14,2) not null check (line_total >= 0)
);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  movement_type text not null check (movement_type in ('opening','purchase','sale','sale_return','purchase_return','adjustment','damage','expiry')),
  quantity_delta numeric(14,3) not null check (quantity_delta <> 0),
  unit_cost numeric(14,2) not null default 0 check (unit_cost >= 0),
  reference_type text,
  reference_id uuid,
  reason text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.chart_of_accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  account_type public.account_type not null,
  parent_id uuid references public.chart_of_accounts(id),
  active boolean not null default true
);

create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  entry_number text not null unique,
  entry_date date not null default current_date,
  description text not null,
  source_type text not null,
  source_id uuid,
  posted boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  journal_entry_id uuid not null references public.journal_entries(id) on delete restrict,
  account_id uuid not null references public.chart_of_accounts(id),
  debit numeric(14,2) not null default 0 check (debit >= 0),
  credit numeric(14,2) not null default 0 check (credit >= 0),
  memo text,
  check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0))
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  expense_number text not null unique,
  expense_date date not null default current_date,
  account_id uuid not null references public.chart_of_accounts(id),
  description text not null,
  amount numeric(14,2) not null check (amount > 0),
  payment_method public.payment_method not null,
  created_by uuid references public.profiles(id),
  journal_entry_id uuid references public.journal_entries(id),
  created_at timestamptz not null default now()
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  entity_type text not null,
  entity_id uuid not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','processing','sent','failed')),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index products_name_idx on public.products using gin (to_tsvector('simple', name));
create index sales_created_at_idx on public.sales(created_at desc);
create index sale_items_sale_id_idx on public.sale_items(sale_id);
create index inventory_movements_product_idx on public.inventory_movements(product_id, created_at desc);
create index journal_entries_date_idx on public.journal_entries(entry_date desc);
create index notification_outbox_status_idx on public.notification_outbox(status, created_at);

do $$ declare t text; begin
  foreach t in array array['profiles','categories','suppliers','products','customers','sales','sale_items','inventory_movements','chart_of_accounts','journal_entries','journal_lines','expenses','audit_events','notification_outbox'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

create policy "profile self read" on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "authenticated read categories" on public.categories for select to authenticated using (true);
create policy "authenticated read products" on public.products for select to authenticated using (true);
create policy "authenticated read suppliers" on public.suppliers for select to authenticated using (true);
create policy "authenticated read customers" on public.customers for select to authenticated using (true);
create policy "authenticated read sales" on public.sales for select to authenticated using (true);
create policy "authenticated read sale items" on public.sale_items for select to authenticated using (true);
create policy "authenticated read inventory movements" on public.inventory_movements for select to authenticated using (true);
create policy "authenticated read chart accounts" on public.chart_of_accounts for select to authenticated using (true);
create policy "authenticated read journal entries" on public.journal_entries for select to authenticated using (true);
create policy "authenticated read journal lines" on public.journal_lines for select to authenticated using (true);
create policy "authenticated read expenses" on public.expenses for select to authenticated using (true);

insert into public.categories(name) values ('Groceries'),('Dairy'),('Bakery'),('Fresh food'),('Drinks'),('Household') on conflict (name) do nothing;
insert into public.chart_of_accounts(code,name,account_type) values
 ('1000','Cash on Hand','asset'),('1010','Mobile Money Clearing','asset'),('1020','Bank Account','asset'),('1100','Inventory','asset'),('1200','Accounts Receivable','asset'),
 ('2000','Accounts Payable','liability'),('2100','Tax Payable','liability'),('3000','Owner Capital','equity'),('3100','Retained Earnings','equity'),
 ('4000','Sales Revenue','revenue'),('4100','Sales Returns','revenue'),('5000','Cost of Goods Sold','expense'),('6000','Rent Expense','expense'),('6010','Utilities Expense','expense'),('6020','Salaries Expense','expense'),('6030','Transport Expense','expense'),('6090','Other Operating Expenses','expense')
 on conflict (code) do nothing;

-- Production rule: completed sales must be posted through a trusted server-side transaction/RPC that atomically validates stock, writes sale_items and inventory movements, and creates balanced journal lines. Do not grant direct client INSERT access to financial tables.
