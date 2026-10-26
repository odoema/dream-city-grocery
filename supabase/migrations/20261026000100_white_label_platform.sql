-- =============================================================================
-- White-label grocery platform upgrade
-- -----------------------------------------------------------------------------
-- Additive and idempotent. Safe to run on the existing Dream City Grocery
-- project (nohdgmylncjtdymfshfy) and on a brand-new project for another shop
-- (after the earlier migrations in this folder).
--
-- Adds:
--   * store_settings (branding, currency, receipt text) + public login profile
--   * first-owner claim and in-app staff management
--   * locked-down product writes (stock can only change through posted RPCs)
--   * opening stock posting (Dr Inventory / Cr Opening Balance Equity)
--   * corrected complete_sale (settings-driven receipt prefix, balance fixes,
--     customer balances net of payments, sold-by-weight / untracked items)
--   * full sale refunds, customer credit payments, shop expenses
--   * one-step "record shop purchase" for market/cash buying
--   * server-side reports (sales summary, financial statements)
--   * Loyverse migration: items (+ opening stock), customers, sales history
--   * smart purchasing demand now includes imported Loyverse sales history
--
-- Never run against SmartAttend.
-- =============================================================================
begin;

-- ---------------------------------------------------------------------------
-- 0. Chart of accounts additions
-- ---------------------------------------------------------------------------
insert into public.accounts(code,name,type) values
  ('3200','Opening Balance Equity','equity'),
  ('4100','Inventory Adjustment Gain','revenue'),
  ('6100','Inventory Shrinkage / Stock Loss','expense')
on conflict(code) do nothing;

-- ---------------------------------------------------------------------------
-- 1. Shared helpers
-- ---------------------------------------------------------------------------
create or replace function public.require_staff(p_roles public.staff_role[] default null)
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.staff_role;
begin
  if v_actor is null then raise exception 'Sign in first'; end if;
  select p.role into v_role from public.profiles p where p.id = v_actor and p.active;
  if v_role is null then raise exception 'Your staff account is inactive or not configured'; end if;
  if p_roles is not null and not (v_role = any(p_roles)) then
    raise exception 'Your role (%) is not allowed to do this', v_role;
  end if;
  return v_actor;
end;
$$;
revoke all on function public.require_staff(public.staff_role[]) from public, anon;
grant execute on function public.require_staff(public.staff_role[]) to authenticated;

create or replace function public.account_id(p_code text)
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare v_id uuid;
begin
  select id into v_id from public.accounts where code = p_code and active;
  if v_id is null then raise exception 'Chart-of-accounts entry % is missing or inactive', p_code; end if;
  return v_id;
end;
$$;
revoke all on function public.account_id(text) from public, anon, authenticated;

create or replace function public.payment_account_code(p_method public.payment_method)
returns text language sql immutable set search_path = ''
as $$
  select case p_method
    when 'cash' then '1000'
    when 'mobile_money' then '1010'
    when 'card' then '1010'
    when 'bank' then '1020'
    when 'credit' then '1100'
  end
$$;
revoke all on function public.payment_account_code(public.payment_method) from public, anon;
grant execute on function public.payment_account_code(public.payment_method) to authenticated;

-- Raises if a journal does not balance. Called at the end of every posting RPC.
create or replace function public.assert_journal_balanced(p_journal_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if (select coalesce(sum(debit),0) - coalesce(sum(credit),0) from public.journal_lines where journal_id = p_journal_id) <> 0 then
    raise exception 'Accounting journal failed the balance check';
  end if;
end;
$$;
revoke all on function public.assert_journal_balanced(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Store settings (white-label)
-- ---------------------------------------------------------------------------
create table if not exists public.store_settings (
  id boolean primary key default true check (id),
  business_name text not null default 'My Grocery',
  tagline text not null default '',
  logo_url text,
  primary_color text not null default '#176B45' check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  currency_code text not null default 'UGX' check (currency_code ~ '^[A-Z]{3}$'),
  currency_decimals integer not null default 0 check (currency_decimals between 0 and 3),
  locale text not null default 'en-UG',
  timezone text not null default 'Africa/Kampala',
  phone text not null default '',
  email text not null default '',
  address text not null default '',
  tax_id text not null default '',
  receipt_prefix text not null default 'RCP' check (receipt_prefix ~ '^[A-Z0-9]{1,8}$'),
  receipt_header text not null default '',
  receipt_footer text not null default 'Thank you for shopping with us!',
  receipt_width text not null default '80mm' check (receipt_width in ('58mm','80mm','a4')),
  stock_cover_days numeric(6,2) not null default 5 check (stock_cover_days > 0 and stock_cover_days <= 90),
  allow_cashier_discounts boolean not null default false,
  setup_completed boolean not null default false,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

insert into public.store_settings(id) values (true) on conflict (id) do nothing;

-- The original deployment is Dream City Grocery: keep its identity and the
-- receipt numbering it already used (DCG-000482...).
do $$
begin
  if to_regclass('public.dream_city_legacy_product_dictionary') is not null then
    update public.store_settings
       set business_name = 'Dream City Grocery',
           tagline = 'Empowering Communities',
           logo_url = coalesce(logo_url, 'brand/dream-city-logo.jpeg'),
           primary_color = '#176B45',
           receipt_prefix = 'DCG',
           phone = phone, email = case when email = '' then 'odoema@gmail.com' else email end,
           address = case when address = '' then 'Nebbi, Uganda' else address end,
           setup_completed = true
     where id and business_name = 'My Grocery';
  end if;
end $$;

alter table public.store_settings enable row level security;
drop policy if exists "staff read store settings" on public.store_settings;
create policy "staff read store settings" on public.store_settings
  for select to authenticated using (public.is_active_staff());
grant select on public.store_settings to authenticated;

-- What the login screen may know before anyone signs in.
create or replace function public.get_public_store_profile()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'business_name', s.business_name,
    'tagline', s.tagline,
    'logo_url', s.logo_url,
    'primary_color', s.primary_color,
    'setup_completed', s.setup_completed,
    'has_owner', exists(select 1 from public.profiles p where p.role = 'owner' and p.active)
  )
  from public.store_settings s where s.id
$$;
revoke all on function public.get_public_store_profile() from public;
grant execute on function public.get_public_store_profile() to anon, authenticated;

create or replace function public.update_store_settings(p_settings jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := public.require_staff(array['owner']::public.staff_role[]);
  v_before jsonb;
  v_after jsonb;
begin
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then raise exception 'Settings must be an object'; end if;
  select to_jsonb(s) into v_before from public.store_settings s where s.id for update;
  update public.store_settings s set
    business_name = coalesce(nullif(trim(p_settings->>'business_name'),''), s.business_name),
    tagline = coalesce(p_settings->>'tagline', s.tagline),
    logo_url = case when p_settings ? 'logo_url' then nullif(trim(p_settings->>'logo_url'),'') else s.logo_url end,
    primary_color = coalesce(nullif(p_settings->>'primary_color',''), s.primary_color),
    currency_code = coalesce(upper(nullif(trim(p_settings->>'currency_code'),'')), s.currency_code),
    currency_decimals = coalesce((p_settings->>'currency_decimals')::integer, s.currency_decimals),
    locale = coalesce(nullif(trim(p_settings->>'locale'),''), s.locale),
    timezone = coalesce(nullif(trim(p_settings->>'timezone'),''), s.timezone),
    phone = coalesce(p_settings->>'phone', s.phone),
    email = coalesce(p_settings->>'email', s.email),
    address = coalesce(p_settings->>'address', s.address),
    tax_id = coalesce(p_settings->>'tax_id', s.tax_id),
    receipt_prefix = coalesce(upper(nullif(trim(p_settings->>'receipt_prefix'),'')), s.receipt_prefix),
    receipt_header = coalesce(p_settings->>'receipt_header', s.receipt_header),
    receipt_footer = coalesce(p_settings->>'receipt_footer', s.receipt_footer),
    receipt_width = coalesce(nullif(p_settings->>'receipt_width',''), s.receipt_width),
    stock_cover_days = coalesce((p_settings->>'stock_cover_days')::numeric, s.stock_cover_days),
    allow_cashier_discounts = coalesce((p_settings->>'allow_cashier_discounts')::boolean, s.allow_cashier_discounts),
    setup_completed = coalesce((p_settings->>'setup_completed')::boolean, s.setup_completed),
    updated_by = v_actor,
    updated_at = now()
  where s.id;
  if not exists (select 1 from pg_timezone_names where name = (select timezone from public.store_settings where id)) then
    raise exception 'Unknown time zone';
  end if;
  select to_jsonb(s) into v_after from public.store_settings s where s.id;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
  values(v_actor,'settings.updated','store_settings',null,jsonb_build_object('before',v_before,'after',v_after));
  return v_after;
end;
$$;
revoke all on function public.update_store_settings(jsonb) from public, anon;
grant execute on function public.update_store_settings(jsonb) to authenticated;

-- Public bucket for the shop logo (shown on the login page and receipts).
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('branding','branding',true,2097152,array['image/jpeg','image/png','image/webp','image/svg+xml'])
on conflict(id) do nothing;
drop policy if exists "owner manages branding" on storage.objects;
create policy "owner manages branding" on storage.objects for all to authenticated
  using (bucket_id = 'branding' and public.current_staff_role() = 'owner')
  with check (bucket_id = 'branding' and public.current_staff_role() = 'owner');

-- ---------------------------------------------------------------------------
-- 3. Staff management
-- ---------------------------------------------------------------------------
-- Users created before the profile trigger existed get a profile now.
insert into public.profiles(id, full_name, role, active)
select u.id, coalesce(u.raw_user_meta_data->>'full_name',''), 'cashier', true
from auth.users u
on conflict (id) do nothing;

-- The very first signed-in user of a fresh shop becomes its owner.
-- Works only while the shop has no active owner. Keep public sign-ups disabled.
create or replace function public.claim_first_owner(p_full_name text default '')
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'Sign in first'; end if;
  perform pg_advisory_xact_lock(hashtext('claim_first_owner'));
  if exists (select 1 from public.profiles where role = 'owner' and active) then
    raise exception 'This shop already has an owner. Ask the owner to give you access.';
  end if;
  insert into public.profiles(id, full_name, role, active)
  values (v_actor, coalesce(nullif(trim(p_full_name),''), 'Owner'), 'owner', true)
  on conflict (id) do update set role = 'owner', active = true,
    full_name = coalesce(nullif(trim(p_full_name),''), public.profiles.full_name), updated_at = now();
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
  values(v_actor,'staff.first_owner_claimed','profile',v_actor,'{}'::jsonb);
  return jsonb_build_object('id', v_actor, 'role', 'owner');
end;
$$;
revoke all on function public.claim_first_owner(text) from public, anon;
grant execute on function public.claim_first_owner(text) to authenticated;

create or replace function public.list_staff()
returns table(id uuid, email text, full_name text, role public.staff_role, active boolean, created_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_staff(array['owner','manager']::public.staff_role[]);
  return query
    select p.id, u.email::text, p.full_name, p.role, p.active, p.created_at, null::timestamptz
    from public.profiles p left join auth.users u on u.id = p.id
    order by p.active desc, p.role, p.full_name;
end;
$$;
revoke all on function public.list_staff() from public, anon;
grant execute on function public.list_staff() to authenticated;

create or replace function public.set_staff_member(p_user_id uuid, p_full_name text, p_role public.staff_role, p_active boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := public.require_staff(array['owner']::public.staff_role[]);
  v_before public.profiles%rowtype;
begin
  select * into v_before from public.profiles where id = p_user_id for update;
  if not found then raise exception 'Staff member not found'; end if;
  if (v_before.role = 'owner' and v_before.active) and (p_role <> 'owner' or not p_active)
     and (select count(*) from public.profiles where role = 'owner' and active) <= 1 then
    raise exception 'The shop must keep at least one active owner';
  end if;
  update public.profiles set
    full_name = coalesce(nullif(trim(p_full_name),''), full_name),
    role = p_role, active = p_active, updated_at = now()
  where id = p_user_id;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
  values(v_actor,'staff.updated','profile',p_user_id,jsonb_build_object(
    'before', jsonb_build_object('role',v_before.role,'active',v_before.active,'full_name',v_before.full_name),
    'after', jsonb_build_object('role',p_role,'active',p_active,'full_name',p_full_name)));
  return jsonb_build_object('id',p_user_id,'role',p_role,'active',p_active);
end;
$$;
revoke all on function public.set_staff_member(uuid,text,public.staff_role,boolean) from public, anon;
grant execute on function public.set_staff_member(uuid,text,public.staff_role,boolean) to authenticated;

-- Staff may set their own display name.
create or replace function public.update_my_name(p_full_name text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := public.require_staff();
begin
  if nullif(trim(p_full_name),'') is null then raise exception 'Name is required'; end if;
  update public.profiles set full_name = trim(p_full_name), updated_at = now() where id = v_actor;
end;
$$;
revoke all on function public.update_my_name(text) from public, anon;
grant execute on function public.update_my_name(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Products: lock stock to posted transactions
-- ---------------------------------------------------------------------------
alter table public.products
  add column if not exists description text not null default '',
  add column if not exists available_for_sale boolean not null default true,
  add column if not exists sold_by_weight boolean not null default false,
  add column if not exists track_stock boolean not null default true,
  add column if not exists composite_item boolean not null default false,
  add column if not exists variant_options jsonb not null default '[]'::jsonb,
  add column if not exists pos_representation jsonb not null default '{}'::jsonb,
  add column if not exists source_system text,
  add column if not exists source_item_id text,
  add column if not exists source_image_url text;

create unique index if not exists products_source_unique_idx
  on public.products(source_system, source_item_id) where source_system is not null and source_item_id is not null;
create index if not exists products_barcode_idx on public.products(barcode) where barcode is not null;

-- Managers can maintain catalogue data but can no longer type a stock number.
-- Stock changes only through sales, receiving, opening stock, refunds and stocktakes.
revoke insert, update on public.products from authenticated;
grant insert (sku, barcode, name, category_id, supplier_id, unit, buying_price, selling_price, reorder_level,
              image_path, active, description, available_for_sale, sold_by_weight, track_stock, composite_item,
              variant_options, pos_representation, source_system, source_item_id, source_image_url)
  on public.products to authenticated;
grant update (sku, barcode, name, category_id, supplier_id, unit, buying_price, selling_price, reorder_level,
              image_path, active, description, available_for_sale, sold_by_weight, track_stock, composite_item,
              variant_options, pos_representation, updated_at)
  on public.products to authenticated;

-- Audit catalogue edits only (not the stock decrement every sale performs).
create or replace function public.log_product_manager_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_old jsonb; v_new jsonb;
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old) - 'quantity_on_hand' - 'updated_at';
    v_new := to_jsonb(new) - 'quantity_on_hand' - 'updated_at';
    if v_old = v_new then return new; end if;
  end if;
  insert into public.audit_log(actor_id, action, entity_type, entity_id, details)
  values (auth.uid(),
    case when tg_op = 'INSERT' then 'product.created' else 'product.updated' end,
    'product', coalesce(new.id, old.id),
    jsonb_build_object('name', new.name, 'sku', new.sku,
      'selling_price', jsonb_build_object('before', old.selling_price, 'after', new.selling_price),
      'buying_price', jsonb_build_object('before', old.buying_price, 'after', new.buying_price),
      'active', new.active));
  return new;
end;
$$;
drop trigger if exists product_manager_audit on public.products;
create trigger product_manager_audit after insert or update on public.products
  for each row execute function public.log_product_manager_change();
revoke all on function public.log_product_manager_change() from public, anon, authenticated;

-- Internal: post opening stock for one product. Caller must have checked rights.
create or replace function public.post_opening_stock_internal(
  p_product_id uuid, p_quantity numeric, p_unit_cost numeric,
  p_reference_type text, p_reference_id uuid, p_note text, p_journal_id uuid
) returns numeric
language plpgsql security definer set search_path = ''
as $$
declare
  v_product public.products%rowtype;
  v_value numeric(14,2);
begin
  if p_quantity is null or p_quantity <= 0 then return 0; end if;
  if p_unit_cost is null or p_unit_cost < 0 then raise exception 'Opening stock cost cannot be negative'; end if;
  select * into v_product from public.products where id = p_product_id for update;
  if not found then raise exception 'Product not found'; end if;
  if exists (select 1 from public.inventory_movements where product_id = p_product_id) then
    raise exception 'Opening stock for % was already recorded. Use a stocktake to correct quantities.', v_product.name;
  end if;
  v_value := round(p_quantity * p_unit_cost, 2);
  update public.products set quantity_on_hand = quantity_on_hand + p_quantity,
    buying_price = p_unit_cost, updated_at = now() where id = p_product_id;
  insert into public.inventory_movements(product_id,movement_type,quantity_delta,unit_cost,reference_type,reference_id,note,created_by)
  values(p_product_id,'opening',p_quantity,p_unit_cost,p_reference_type,p_reference_id,coalesce(p_note,'Opening stock'),auth.uid());
  if v_value > 0 and p_journal_id is not null then
    insert into public.journal_lines(journal_id,account_id,description,debit,credit)
    values(p_journal_id, public.account_id('1200'), 'Opening stock: '||v_product.name, v_value, 0),
          (p_journal_id, public.account_id('3200'), 'Opening stock: '||v_product.name, 0, v_value);
  end if;
  return v_value;
end;
$$;
revoke all on function public.post_opening_stock_internal(uuid,numeric,numeric,text,uuid,text,uuid) from public, anon, authenticated;

create or replace function public.post_opening_stock(p_product_id uuid, p_quantity numeric, p_unit_cost numeric, p_note text default '')
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := public.require_staff(array['owner','manager']::public.staff_role[]);
  v_journal uuid;
  v_value numeric(14,2);
  v_ref uuid := gen_random_uuid();
begin
  if p_quantity is null or p_quantity <= 0 then raise exception 'Opening quantity must be greater than zero'; end if;
  insert into public.journals(source_type,source_id,memo,created_by)
  values('opening_stock',v_ref,'Opening stock',v_actor) returning id into v_journal;
  v_value := public.post_opening_stock_internal(p_product_id,p_quantity,p_unit_cost,'opening_stock',v_ref,nullif(p_note,''),v_journal);
  if v_value = 0 then delete from public.journals where id = v_journal; v_journal := null;
  else perform public.assert_journal_balanced(v_journal); end if;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
  values(v_actor,'stock.opening_posted','product',p_product_id,jsonb_build_object('quantity',p_quantity,'unit_cost',p_unit_cost,'value',v_value));
  return jsonb_build_object('product_id',p_product_id,'value',v_value,'journal_id',v_journal);
end;
$$;
revoke all on function public.post_opening_stock(uuid,numeric,numeric,text) from public, anon;
grant execute on function public.post_opening_stock(uuid,numeric,numeric,text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Customers: balances and credit payments
-- ---------------------------------------------------------------------------
alter table public.customers
  add column if not exists address text not null default '',
  add column if not exists notes text not null default '',
  add column if not exists customer_code text,
  add column if not exists source_system text,
  add column if not exists source_id text;
create unique index if not exists customers_code_unique_idx on public.customers(customer_code) where customer_code is not null;

create table if not exists public.customer_payments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  amount numeric(14,2) not null check (amount > 0),
  payment_method public.payment_method not null check (payment_method <> 'credit'),
  reference text not null default '',
  note text not null default '',
  journal_id uuid references public.journals(id),
  received_by uuid not null references public.profiles(id),
  received_at timestamptz not null default now()
);
create index if not exists customer_payments_customer_idx on public.customer_payments(customer_id, received_at desc);
alter table public.customer_payments enable row level security;
drop policy if exists "staff read customer payments" on public.customer_payments;
create policy "staff read customer payments" on public.customer_payments for select to authenticated using (public.is_active_staff());
grant select on public.customer_payments to authenticated;

create or replace function public.customer_balance(p_customer_id uuid)
returns numeric language sql stable security definer set search_path = ''
as $$
  select coalesce((select sum(s.total) from public.sales s
                    where s.customer_id = p_customer_id and s.payment_method = 'credit' and s.status = 'completed'),0)
       - coalesce((select sum(cp.amount) from public.customer_payments cp where cp.customer_id = p_customer_id),0)
$$;
revoke all on function public.customer_balance(uuid) from public, anon;
grant execute on function public.customer_balance(uuid) to authenticated;

create or replace view public.customer_balances with (security_invoker = true) as
select c.id as customer_id, c.name, c.phone, c.credit_limit, c.active,
       coalesce(cs.credit_sales,0) as credit_sales,
       coalesce(cp.payments,0) as payments,
       coalesce(cs.credit_sales,0) - coalesce(cp.payments,0) as balance
from public.customers c
left join (select customer_id, sum(total) credit_sales from public.sales
           where payment_method = 'credit' and status = 'completed' group by customer_id) cs on cs.customer_id = c.id
left join (select customer_id, sum(amount) payments from public.customer_payments group by customer_id) cp on cp.customer_id = c.id;
grant select on public.customer_balances to authenticated;

create or replace function public.list_customers_with_balance()
returns table(id uuid, name text, phone text, email text, address text, notes text, customer_code text,
              credit_limit numeric, active boolean, balance numeric)
language sql stable security definer set search_path = ''
as $$
  select c.id, c.name, c.phone, c.email, c.address, c.notes, c.customer_code, c.credit_limit, c.active,
         public.customer_balance(c.id)
  from public.customers c
  where public.is_active_staff()
  order by c.active desc, c.name
$$;
revoke all on function public.list_customers_with_balance() from public, anon;
grant execute on function public.list_customers_with_balance() to authenticated;

-- Credit sales and payments for one customer (all staff may view, e.g. at the till).
create or replace function public.get_customer_statement(p_customer_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_staff();
  return jsonb_build_object(
    'balance', public.customer_balance(p_customer_id),
    'entries', coalesce((select jsonb_agg(e order by e->>'at' desc) from (
      select jsonb_build_object('at', s.created_at, 'kind', 'sale', 'reference', s.receipt_number, 'amount', s.total, 'status', s.status, 'sale_id', s.id) e
      from public.sales s where s.customer_id = p_customer_id and s.payment_method = 'credit'
      union all
      select jsonb_build_object('at', cp.received_at, 'kind', 'payment', 'reference', coalesce(nullif(cp.reference,''), cp.payment_method::text), 'amount', cp.amount, 'status', 'received')
      from public.customer_payments cp where cp.customer_id = p_customer_id
    ) q), '[]'::jsonb));
end;
$$;
revoke all on function public.get_customer_statement(uuid) from public, anon;
grant execute on function public.get_customer_statement(uuid) to authenticated;

create or replace function public.receive_customer_payment(
  p_customer_id uuid, p_amount numeric, p_payment_method public.payment_method,
  p_reference text default '', p_note text default ''
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := public.require_staff();
  v_balance numeric(14,2);
  v_id uuid := gen_random_uuid();
  v_journal uuid;
  v_name text;
begin
  if p_payment_method = 'credit' then raise exception 'Choose how the customer paid (cash, mobile money, card or bank)'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Payment must be greater than zero'; end if;
  select name into v_name from public.customers where id = p_customer_id for update;
  if not found then raise exception 'Customer not found'; end if;
  v_balance := public.customer_balance(p_customer_id);
  if p_amount > v_balance then raise exception 'Payment exceeds the customer balance (%)', v_balance; end if;
  insert into public.journals(source_type,source_id,memo,created_by)
  values('customer_payment',v_id,'Customer payment: '||v_name,v_actor) returning id into v_journal;
  insert into public.journal_lines(journal_id,account_id,description,debit,credit)
  values(v_journal, public.account_id(public.payment_account_code(p_payment_method)), 'Customer payment received', p_amount, 0),
        (v_journal, public.account_id('1100'), 'Accounts receivable settled', 0, p_amount);
  perform public.assert_journal_balanced(v_journal);
  insert into public.customer_payments(id,customer_id,amount,payment_method,reference,note,journal_id,received_by)
  values(v_id,p_customer_id,p_amount,p_payment_method,coalesce(trim(p_reference),''),coalesce(p_note,''),v_journal,v_actor);
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
  values(v_actor,'customer.payment_received','customer',p_customer_id,jsonb_build_object('amount',p_amount,'method',p_payment_method,'reference',p_reference));
  return jsonb_build_object('payment_id',v_id,'remaining_balance',v_balance - p_amount);
end;
$$;
revoke all on function public.receive_customer_payment(uuid,numeric,public.payment_method,text,text) from public, anon;
grant execute on function public.receive_customer_payment(uuid,numeric,public.payment_method,text,text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Checkout (same signature as before; fixes and white-label receipt prefix)
-- ---------------------------------------------------------------------------
create or replace function public.complete_sale(
  p_items jsonb,
  p_payment_method public.payment_method,
  p_idempotency_key uuid,
  p_customer_id uuid default null,
  p_discount numeric default 0,
  p_tax numeric default 0
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.staff_role;
  v_settings public.store_settings%rowtype;
  v_item jsonb;
  v_product public.products%rowtype;
  v_qty numeric(14,3);
  v_unit_price numeric(14,2);
  v_line_total numeric(14,2);
  v_line_cost numeric(14,2);
  v_subtotal numeric(14,2) := 0;
  v_discount numeric(14,2) := round(coalesce(p_discount,0),2);
  v_total numeric(14,2);
  v_cogs numeric(14,2) := 0;
  v_sale_id uuid;
  v_receipt text;
  v_journal_id uuid;
  v_existing public.sales%rowtype;
  v_limit numeric(14,2);
begin
  if v_actor is null then raise exception 'Sign in before completing a sale'; end if;
  select p.role into v_role from public.profiles p where p.id = v_actor and p.active;
  if v_role is null then raise exception 'Your staff account is inactive or not configured'; end if;
  select * into v_settings from public.store_settings where id;

  -- Idempotent replay: a retried checkout returns the original sale.
  select * into v_existing from public.sales where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.cashier_id <> v_actor then raise exception 'Idempotency key already belongs to another cashier'; end if;
    return jsonb_build_object('sale_id',v_existing.id,'receipt_number',v_existing.receipt_number,'subtotal',v_existing.subtotal,
      'discount',v_existing.discount,'tax',v_existing.tax,'total',v_existing.total,'cost_of_goods',v_existing.cost_of_goods,
      'created_at',v_existing.created_at,'replayed',true);
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Add at least one product'; end if;
  if coalesce(p_tax,0) <> 0 then raise exception 'Tax is disabled until a tax accounting policy is configured'; end if;
  if v_discount < 0 then raise exception 'Discount cannot be negative'; end if;
  if v_discount > 0 and v_role not in ('owner','manager') and not coalesce(v_settings.allow_cashier_discounts,false) then
    raise exception 'Only an owner or manager may authorize a discount';
  end if;
  if p_payment_method = 'credit' and p_customer_id is null then raise exception 'Select a customer for a credit sale'; end if;
  if p_customer_id is not null and not exists(select 1 from public.customers c where c.id = p_customer_id and c.active) then
    raise exception 'Customer is inactive or not found';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) e group by (e->>'product_id') having count(*) > 1) then
    raise exception 'Cart contains duplicate product lines; combine quantities before checkout';
  end if;

  -- Validate and lock in stable order (prevents overselling and deadlocks).
  for v_item in select e from jsonb_array_elements(p_items) e order by (e->>'product_id')::uuid loop
    v_qty := (v_item->>'quantity')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'Quantity must be greater than zero'; end if;
    select * into v_product from public.products p where p.id = (v_item->>'product_id')::uuid and p.active for update;
    if not found then raise exception 'A product is inactive or no longer available'; end if;
    if not v_product.available_for_sale then raise exception '% is not available for sale', v_product.name; end if;
    if not v_product.sold_by_weight and v_qty <> trunc(v_qty) then raise exception '% is sold in whole units', v_product.name; end if;
    if v_product.track_stock and v_product.quantity_on_hand < v_qty then
      raise exception 'Insufficient stock for % (available %, requested %)', v_product.name, v_product.quantity_on_hand, v_qty;
    end if;
    if v_item ? 'unit_price' and (v_item->>'unit_price')::numeric is distinct from v_product.selling_price then
      if v_role not in ('owner','manager') then raise exception 'Cashiers must use the listed selling price'; end if;
      if (v_item->>'unit_price')::numeric < 0 then raise exception 'Unit price cannot be negative'; end if;
      v_unit_price := (v_item->>'unit_price')::numeric;
    else
      v_unit_price := v_product.selling_price;
    end if;
    v_subtotal := v_subtotal + round(v_qty * v_unit_price, 2);
    v_cogs := v_cogs + case when v_product.track_stock then round(v_qty * v_product.buying_price, 2) else 0 end;
  end loop;

  if v_discount > v_subtotal then raise exception 'Discount cannot exceed the sale subtotal'; end if;
  v_total := v_subtotal - v_discount;

  if p_payment_method = 'credit' then
    perform 1 from public.customers where id = p_customer_id for update;
    select credit_limit into v_limit from public.customers where id = p_customer_id;
    if public.customer_balance(p_customer_id) + v_total > v_limit then
      raise exception 'Credit sale exceeds the customer credit limit (limit %, current balance %)', v_limit, public.customer_balance(p_customer_id);
    end if;
  end if;

  v_receipt := v_settings.receipt_prefix || '-' || lpad(nextval('public.receipt_number_seq')::text,6,'0');
  insert into public.sales(receipt_number,idempotency_key,cashier_id,customer_id,payment_method,subtotal,discount,tax,total,cost_of_goods)
  values(v_receipt,p_idempotency_key,v_actor,p_customer_id,p_payment_method,v_subtotal,v_discount,0,v_total,v_cogs)
  returning id into v_sale_id;

  for v_item in select e from jsonb_array_elements(p_items) e order by (e->>'product_id')::uuid loop
    v_qty := (v_item->>'quantity')::numeric;
    select * into v_product from public.products where id = (v_item->>'product_id')::uuid;
    v_unit_price := case when v_item ? 'unit_price' then (v_item->>'unit_price')::numeric else v_product.selling_price end;
    v_line_total := round(v_qty * v_unit_price, 2);
    v_line_cost := case when v_product.track_stock then round(v_qty * v_product.buying_price, 2) else 0 end;
    insert into public.sale_items(sale_id,product_id,product_name,sku,quantity,unit_price,unit_cost,line_total,line_cost)
    values(v_sale_id,v_product.id,v_product.name,v_product.sku,v_qty,v_unit_price,
           case when v_product.track_stock then v_product.buying_price else 0 end,v_line_total,v_line_cost);
    if v_product.track_stock then
      update public.products set quantity_on_hand = quantity_on_hand - v_qty, updated_at = now() where id = v_product.id;
      insert into public.inventory_movements(product_id,movement_type,quantity_delta,unit_cost,reference_type,reference_id,note,created_by)
      values(v_product.id,'sale',-v_qty,v_product.buying_price,'sale',v_sale_id,'POS sale '||v_receipt,v_actor);
    end if;
  end loop;

  insert into public.journals(source_type,source_id,memo,created_by)
  values('sale',v_sale_id,'POS sale '||v_receipt,v_actor) returning id into v_journal_id;
  if v_total > 0 then
    insert into public.journal_lines(journal_id,account_id,description,debit,credit)
    values(v_journal_id, public.account_id(public.payment_account_code(p_payment_method)), 'Sale proceeds', v_total, 0);
  end if;
  if v_subtotal > 0 then
    insert into public.journal_lines(journal_id,account_id,description,debit,credit)
    values(v_journal_id, public.account_id('4000'), 'Gross sales before discount', 0, v_subtotal);
  end if;
  if v_discount > 0 then
    insert into public.journal_lines(journal_id,account_id,description,debit,credit)
    values(v_journal_id, public.account_id('4900'), 'Authorized sales discount', v_discount, 0);
  end if;
  if v_cogs > 0 then
    insert into public.journal_lines(journal_id,account_id,description,debit,credit)
    values(v_journal_id, public.account_id('5000'), 'Cost of goods sold', v_cogs, 0),
          (v_journal_id, public.account_id('1200'), 'Inventory relieved', 0, v_cogs);
  end if;
  perform public.assert_journal_balanced(v_journal_id);

  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
  values(v_actor,'sale.completed','sale',v_sale_id,jsonb_build_object('receipt_number',v_receipt,'total',v_total,'discount',v_discount,'payment_method',p_payment_method));

  return jsonb_build_object('sale_id',v_sale_id,'receipt_number',v_receipt,'subtotal',v_subtotal,'discount',v_discount,
    'tax',0,'total',v_total,'cost_of_goods',v_cogs,'created_at',now(),'replayed',false);
end;
$$;
revoke all on function public.complete_sale(jsonb, public.payment_method, uuid, uuid, numeric, numeric) from public, anon;
grant execute on function public.complete_sale(jsonb, public.payment_method, uuid, uuid, numeric, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Refunds (full sale reversal)
-- ---------------------------------------------------------------------------
alter table public.sales
  add column if not exists refunded_at timestamptz,
  add column if not exists refunded_by uuid references public.profiles(id),
  add column if not exists refund_reason text;

create or replace function public.refund_sale(p_sale_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := public.require_staff(array['owner','manager']::public.staff_role[]);
  v_sale public.sales%rowtype;
  v_line record;
  v_orig_journal uuid;
  v_journal uuid;
begin
  if nullif(trim(p_reason),'') is null then raise exception 'Give a reason for the refund'; end if;
  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then raise exception 'Sale not found'; end if;
  if v_sale.status <> 'completed' then raise exception 'Only completed sales can be refunded (this sale is %)', v_sale.status; end if;

  -- Return stock for every line that originally left stock.
  for v_line in
    select m.product_id, -m.quantity_delta as qty, m.unit_cost
    from public.inventory_movements m
    where m.reference_type = 'sale' and m.reference_id = p_sale_id and m.movement_type = 'sale'
    order by m.product_id
  loop
    perform 1 from public.products where id = v_line.product_id for update;
    update public.products set quantity_on_hand = quantity_on_hand + v_line.qty, updated_at = now() where id = v_line.product_id;
    insert into public.inventory_movements(product_id,movement_type,quantity_delta,unit_cost,reference_type,reference_id,note,created_by)
    values(v_line.product_id,'sale_return',v_line.qty,v_line.unit_cost,'sale_refund',p_sale_id,'Refund of '||v_sale.receipt_number,v_actor);
  end loop;

  -- Exact reversal of the original journal.
  select id into v_orig_journal from public.journals where source_type = 'sale' and source_id = p_sale_id;
  if v_orig_journal is not null then
    insert into public.journals(source_type,source_id,memo,created_by)
    values('sale_refund',p_sale_id,'Refund of '||v_sale.receipt_number||': '||trim(p_reason),v_actor) returning id into v_journal;
    insert into public.journal_lines(journal_id,account_id,description,debit,credit)
    select v_journal, account_id, 'Reversal: '||description, credit, debit from public.journal_lines where journal_id = v_orig_journal;
    perform public.assert_journal_balanced(v_journal);
  end if;

  if v_sale.payment_method = 'credit' and v_sale.customer_id is not null
     and public.customer_balance(v_sale.customer_id) - v_sale.total < 0 then
    raise exception 'This credit sale has already been paid by the customer. Record a cash refund as an expense instead.';
  end if;

  update public.sales set status = 'refunded', refunded_at = now(), refunded_by = v_actor, refund_reason = trim(p_reason) where id = p_sale_id;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
  values(v_actor,'sale.refunded','sale',p_sale_id,jsonb_build_object('receipt_number',v_sale.receipt_number,'total',v_sale.total,'reason',trim(p_reason)));
  return jsonb_build_object('sale_id',p_sale_id,'receipt_number',v_sale.receipt_number,'refunded',v_sale.total,'journal_id',v_journal);
end;
$$;
revoke all on function public.refund_sale(uuid,text) from public, anon;
grant execute on function public.refund_sale(uuid,text) to authenticated;

-- Management alerts also for refunds (status change away from completed).
create or replace function public.notify_management_sale()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_name text;
begin
  select business_name into v_name from public.store_settings where id;
  if tg_op = 'INSERT' and new.status = 'completed' then
    perform public.queue_management_notification('sale',
      'Sale recorded — ' || new.receipt_number,
      'A sale was recorded at ' || coalesce(v_name,'the shop') || '. Receipt: ' || new.receipt_number || '. Total: ' || to_char(new.total,'FM999G999G999G990D00') || '.',
      jsonb_build_object('sale_id',new.id,'receipt_number',new.receipt_number,'total',new.total,'payment_method',new.payment_method,'cashier_id',new.cashier_id,'created_at',new.created_at));
  elsif tg_op = 'UPDATE' and new.status = 'refunded' and old.status = 'completed' then
    perform public.queue_management_notification('refund',
      'Sale refunded — ' || new.receipt_number,
      'Receipt ' || new.receipt_number || ' (' || to_char(new.total,'FM999G999G999G990D00') || ') was refunded. Reason: ' || coalesce(new.refund_reason,'—') || '.',
      jsonb_build_object('sale_id',new.id,'receipt_number',new.receipt_number,'total',new.total,'refunded_by',new.refunded_by,'reason',new.refund_reason));
  end if;
  return new;
end;
$$;
drop trigger if exists management_sale_alert on public.sales;
create trigger management_sale_alert after insert or update on public.sales
  for each row execute function public.notify_management_sale();

-- Only database functions may queue notifications (was callable by any cashier).
revoke execute on function public.queue_management_notification(text,text,text,jsonb) from authenticated;

-- ---------------------------------------------------------------------------
-- 8. Expenses
-- ---------------------------------------------------------------------------
create sequence if not exists public.expense_number_seq start 1;
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  expense_number text not null unique,
  expense_date date not null default current_date,
  category text not null default 'General',
  description text not null,
  amount numeric(14,2) not null check (amount > 0),
  payment_method public.payment_method not null check (payment_method <> 'credit'),
  reference text not null default '',
  journal_id uuid references public.journals(id),
  recorded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists expenses_date_idx on public.expenses(expense_date desc);
alter table public.expenses enable row level security;
drop policy if exists "managers read expenses" on public.expenses;
create policy "managers read expenses" on public.expenses for select to authenticated
  using (public.current_staff_role() in ('owner','manager','accountant'));
grant select on public.expenses to authenticated;

create or replace function public.record_expense(
  p_description text, p_amount numeric, p_payment_method public.payment_method,
  p_category text default 'General', p_expense_date date default null, p_reference text default ''
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := public.require_staff(array['owner','manager','accountant']::public.staff_role[]);
  v_id uuid := gen_random_uuid();
  v_number text;
  v_journal uuid;
begin
  if nullif(trim(p_description),'') is null then raise exception 'Describe the expense'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be greater than zero'; end if;
  if p_payment_method = 'credit' then raise exception 'Choose how the expense was paid'; end if;
  v_number := 'EXP-' || to_char(current_date,'YYYYMMDD') || '-' || lpad(nextval('public.expense_number_seq')::text,4,'0');
  insert into public.journals(source_type,source_id,memo,journal_date,created_by)
  values('expense',v_id,v_number||' '||trim(p_description),coalesce(p_expense_date::timestamptz,now()),v_actor) returning id into v_journal;
  insert into public.journal_lines(journal_id,account_id,description,debit,credit)
  values(v_journal, public.account_id('6000'), coalesce(nullif(trim(p_category),''),'General')||': '||trim(p_description), p_amount, 0),
        (v_journal, public.account_id(public.payment_account_code(p_payment_method)), 'Expense paid', 0, p_amount);
  perform public.assert_journal_balanced(v_journal);
  insert into public.expenses(id,expense_number,expense_date,category,description,amount,payment_method,reference,journal_id,recorded_by)
  values(v_id,v_number,coalesce(p_expense_date,current_date),coalesce(nullif(trim(p_category),''),'General'),trim(p_description),p_amount,p_payment_method,coalesce(trim(p_reference),''),v_journal,v_actor);
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
  values(v_actor,'expense.recorded','expense',v_id,jsonb_build_object('expense_number',v_number,'amount',p_amount,'category',p_category));
  perform public.queue_management_notification('expense','Expense recorded — '||v_number,
    trim(p_description)||': '||to_char(p_amount,'FM999G999G999G990D00'), jsonb_build_object('expense_id',v_id,'amount',p_amount));
  return jsonb_build_object('id',v_id,'expense_number',v_number,'journal_id',v_journal);
end;
$$;
revoke all on function public.record_expense(text,numeric,public.payment_method,text,date,text) from public, anon;
grant execute on function public.record_expense(text,numeric,public.payment_method,text,date,text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. One-step shop purchase (market / cash buying without a purchase order)
-- ---------------------------------------------------------------------------
create or replace function public.record_shop_purchase(
  p_supplier_id uuid,
  p_supplier_name text,
  p_items jsonb,
  p_paid_with public.payment_method,   -- 'credit' = not yet paid (accounts payable)
  p_reference text default '',
  p_purchase_date date default null,
  p_notes text default ''
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := public.require_staff(array['owner','manager','accountant']::public.staff_role[]);
  v_supplier uuid := p_supplier_id;
  v_invoice_no text := nullif(trim(p_reference),'');
  v_received jsonb;
  v_paid jsonb;
begin
  if v_supplier is null then
    if nullif(trim(p_supplier_name),'') is null then raise exception 'Choose or type a supplier / shop name'; end if;
    select id into v_supplier from public.suppliers where lower(name) = lower(trim(p_supplier_name)) limit 1;
    if v_supplier is null then
      insert into public.suppliers(name, active) values (trim(p_supplier_name), true) returning id into v_supplier;
    else
      update public.suppliers set active = true where id = v_supplier;
    end if;
  end if;
  if v_invoice_no is null then
    v_invoice_no := 'BUY-' || to_char(now(),'YYYYMMDD-HH24MISS') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));
  end if;
  v_received := public.receive_supplier_invoice(v_supplier, v_invoice_no, coalesce(p_purchase_date,current_date), null, p_items, null, coalesce(p_notes,''));
  if p_paid_with <> 'credit' then
    v_paid := public.pay_supplier_invoice((v_received->>'invoice_id')::uuid, 'PAY-' || v_invoice_no, p_paid_with, (v_received->>'total')::numeric);
  end if;
  return v_received || jsonb_build_object('supplier_id',v_supplier,'invoice_number',v_invoice_no,'paid',p_paid_with <> 'credit');
end;
$$;
revoke all on function public.record_shop_purchase(uuid,text,jsonb,public.payment_method,text,date,text) from public, anon;
grant execute on function public.record_shop_purchase(uuid,text,jsonb,public.payment_method,text,date,text) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Reports (server-side, authoritative)
-- ---------------------------------------------------------------------------
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
  ), done as (select * from s where status = 'completed')
  select jsonb_build_object(
    'from', p_from, 'to', p_to, 'scope', case when v_all then 'shop' else 'mine' end,
    'transactions', (select count(*) from done),
    'gross_sales', (select coalesce(sum(subtotal),0) from done),
    'discounts', (select coalesce(sum(discount),0) from done),
    'net_sales', (select coalesce(sum(total),0) from done),
    'cost_of_goods', (select coalesce(sum(cost_of_goods),0) from done),
    'gross_profit', (select coalesce(sum(total - cost_of_goods),0) from done),
    'refunds', (select coalesce(sum(total),0) from s where status = 'refunded'),
    'refund_count', (select count(*) from s where status = 'refunded'),
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
        select jsonb_build_object('product_id',si.product_id,'name',max(si.product_name),'sku',max(si.sku),'quantity',sum(si.quantity),
               'revenue',sum(si.line_total),'profit',sum(si.line_total-si.line_cost)) x
        from public.sale_items si join done d on d.id = si.sale_id
        group by si.product_id order by sum(si.line_total) desc limit 15) q),'[]'::jsonb),
    'by_cashier', case when v_all then coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('cashier_id',d.cashier_id,'name',coalesce(max(p.full_name),'Staff'),'count',count(*),'total',sum(d.total)) x
        from done d left join public.profiles p on p.id = d.cashier_id group by d.cashier_id order by sum(d.total) desc) q),'[]'::jsonb) else '[]'::jsonb end
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.get_sales_summary(timestamptz,timestamptz) from public, anon;
grant execute on function public.get_sales_summary(timestamptz,timestamptz) to authenticated;

create or replace function public.get_financial_statements(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_result jsonb;
begin
  perform public.require_staff(array['owner','manager','accountant']::public.staff_role[]);
  with bal as (
    select a.code, a.name, a.type,
      coalesce(sum(case when j.journal_date < p_to then jl.debit - jl.credit end),0) as closing,
      coalesce(sum(case when j.journal_date >= p_from and j.journal_date < p_to then jl.debit - jl.credit end),0) as period
    from public.accounts a
    left join public.journal_lines jl on jl.account_id = a.id
    left join public.journals j on j.id = jl.journal_id
    group by a.code, a.name, a.type
  ), pl as (
    select
      -sum(period) filter (where type = 'revenue') as revenue,
       sum(period) filter (where type = 'contra_revenue') as contra,
       sum(period) filter (where code = '5000') as cogs,
       sum(period) filter (where type = 'expense' and code <> '5000') as expenses,
      -sum(closing) filter (where type in ('revenue','contra_revenue','expense')) as retained_to_date
    from bal
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'trial_balance', (select jsonb_agg(jsonb_build_object('code',code,'name',name,'type',type,
        'debit', greatest(closing,0), 'credit', greatest(-closing,0)) order by code) from bal where closing <> 0),
    'profit_and_loss', (select jsonb_build_object(
        'revenue', coalesce(revenue,0), 'discounts_returns', coalesce(contra,0),
        'net_revenue', coalesce(revenue,0) - coalesce(contra,0),
        'cost_of_goods', coalesce(cogs,0),
        'gross_profit', coalesce(revenue,0) - coalesce(contra,0) - coalesce(cogs,0),
        'operating_expenses', coalesce(expenses,0),
        'net_profit', coalesce(revenue,0) - coalesce(contra,0) - coalesce(cogs,0) - coalesce(expenses,0),
        'lines', (select jsonb_agg(jsonb_build_object('code',code,'name',name,'type',type,'amount',
                    case when type = 'revenue' then -period else period end) order by code)
                  from bal where type in ('revenue','contra_revenue','expense') and period <> 0)
      ) from pl),
    'balance_sheet', jsonb_build_object(
        'assets', (select coalesce(jsonb_agg(jsonb_build_object('code',code,'name',name,'amount',closing) order by code),'[]'::jsonb) from bal where type = 'asset' and closing <> 0),
        'liabilities', (select coalesce(jsonb_agg(jsonb_build_object('code',code,'name',name,'amount',-closing) order by code),'[]'::jsonb) from bal where type = 'liability' and closing <> 0),
        'equity', (select coalesce(jsonb_agg(jsonb_build_object('code',code,'name',name,'amount',-closing) order by code),'[]'::jsonb) from bal where type = 'equity' and closing <> 0),
        'retained_earnings', (select coalesce(retained_to_date,0) from pl),
        'total_assets', (select coalesce(sum(closing),0) from bal where type = 'asset'),
        'total_liabilities_equity', (select coalesce(-sum(closing),0) from bal where type in ('liability','equity'))
                                    + (select coalesce(retained_to_date,0) from pl)
    )
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.get_financial_statements(timestamptz,timestamptz) from public, anon;
grant execute on function public.get_financial_statements(timestamptz,timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Loyverse migration
-- ---------------------------------------------------------------------------
create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  source_system text not null default 'loyverse',
  kind text not null check (kind in ('items','customers','sales')),
  file_name text not null default '',
  options jsonb not null default '{}'::jsonb,
  status text not null default 'running' check (status in ('running','completed','failed')),
  summary jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
alter table public.import_batches enable row level security;
drop policy if exists "managers read import batches" on public.import_batches;
create policy "managers read import batches" on public.import_batches for select to authenticated
  using (public.current_staff_role() in ('owner','manager','accountant'));
grant select on public.import_batches to authenticated;

create table if not exists public.legacy_sales_lines (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references public.import_batches(id),
  source_system text not null default 'loyverse',
  line_key text not null,
  sold_at timestamptz not null,
  receipt_number text not null default '',
  receipt_type text not null default 'sale' check (receipt_type in ('sale','refund')),
  product_id uuid references public.products(id),
  sku text not null default '',
  item_name text not null default '',
  variant text not null default '',
  category text not null default '',
  quantity numeric(14,3) not null default 0,
  gross_sales numeric(14,2) not null default 0,
  discounts numeric(14,2) not null default 0,
  net_sales numeric(14,2) not null default 0,
  cost_of_goods numeric(14,2) not null default 0,
  payment_type text not null default '',
  cashier_name text not null default '',
  customer_name text not null default '',
  store_name text not null default '',
  unique (source_system, line_key)
);
create index if not exists legacy_sales_lines_product_idx on public.legacy_sales_lines(product_id, sold_at desc);
create index if not exists legacy_sales_lines_sold_idx on public.legacy_sales_lines(sold_at desc);
alter table public.legacy_sales_lines enable row level security;
drop policy if exists "managers read legacy sales" on public.legacy_sales_lines;
create policy "managers read legacy sales" on public.legacy_sales_lines for select to authenticated
  using (public.current_staff_role() in ('owner','manager','accountant'));
grant select on public.legacy_sales_lines to authenticated;
comment on table public.legacy_sales_lines is
  'Sales history imported from a previous POS (e.g. Loyverse). Reference only: never posted to accounting or stock. Used for demand forecasting and history reports.';

create or replace function public.start_import_batch(p_kind text, p_file_name text, p_options jsonb default '{}'::jsonb)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := public.require_staff(array['owner','manager']::public.staff_role[]);
  v_id uuid;
begin
  insert into public.import_batches(kind,file_name,options,created_by)
  values(p_kind,coalesce(p_file_name,''),coalesce(p_options,'{}'::jsonb),v_actor) returning id into v_id;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
  values(v_actor,'import.started','import_batch',v_id,jsonb_build_object('kind',p_kind,'file',p_file_name,'options',p_options));
  return v_id;
end;
$$;
revoke all on function public.start_import_batch(text,text,jsonb) from public, anon;
grant execute on function public.start_import_batch(text,text,jsonb) to authenticated;

create or replace function public.finish_import_batch(p_batch_id uuid, p_status text, p_summary jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := public.require_staff(array['owner','manager']::public.staff_role[]);
begin
  update public.import_batches set status = case when p_status in ('completed','failed') then p_status else 'completed' end,
    summary = coalesce(p_summary,'{}'::jsonb), completed_at = now()
  where id = p_batch_id and status = 'running';
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
  values(v_actor,'import.finished','import_batch',p_batch_id,coalesce(p_summary,'{}'::jsonb));
end;
$$;
revoke all on function public.finish_import_batch(uuid,text,jsonb) from public, anon;
grant execute on function public.finish_import_batch(uuid,text,jsonb) to authenticated;

-- Items. Each element:
-- {source_item_id, sku, barcode, name, category, description, sold_by_weight,
--  cost, price, track_stock, available_for_sale, low_stock, in_stock, variant_options}
create or replace function public.import_loyverse_items(
  p_batch_id uuid, p_items jsonb, p_post_opening_stock boolean default false
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := public.require_staff(array['owner','manager']::public.staff_role[]);
  v_item jsonb;
  v_idx integer := 0;
  v_product_id uuid;
  v_category_id uuid;
  v_sku text;
  v_barcode text;
  v_name text;
  v_price numeric(14,2);
  v_cost numeric(14,2);
  v_low numeric(14,3);
  v_stock numeric(14,3);
  v_track boolean;
  v_created integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_stock_rows integer := 0;
  v_stock_value numeric(14,2) := 0;
  v_warnings jsonb := '[]'::jsonb;
  v_journal uuid;
  v_ref uuid := gen_random_uuid();
begin
  perform 1 from public.import_batches where id = p_batch_id and kind = 'items' and status = 'running';
  if not found then raise exception 'Import batch not found or already finished'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'Items must be an array'; end if;

  for v_item in select e from jsonb_array_elements(p_items) e loop
    v_idx := v_idx + 1;
    begin
      v_name := nullif(trim(v_item->>'name'),'');
      if v_name is null then
        v_skipped := v_skipped + 1;
        v_warnings := v_warnings || jsonb_build_object('row', v_item->>'row', 'message', 'Skipped: no item name');
        continue;
      end if;
      v_sku := nullif(trim(v_item->>'sku'),'');
      v_barcode := nullif(trim(v_item->>'barcode'),'');
      v_price := greatest(coalesce((v_item->>'price')::numeric,0),0);
      v_cost := greatest(coalesce((v_item->>'cost')::numeric,0),0);
      v_low := greatest(coalesce((v_item->>'low_stock')::numeric,0),0);
      v_stock := coalesce((v_item->>'in_stock')::numeric,0);
      v_track := coalesce((v_item->>'track_stock')::boolean,true);

      v_category_id := null;
      if nullif(trim(v_item->>'category'),'') is not null then
        select id into v_category_id from public.categories where lower(name) = lower(trim(v_item->>'category')) limit 1;
        if v_category_id is null then
          insert into public.categories(name) values (trim(v_item->>'category')) returning id into v_category_id;
        end if;
      end if;

      v_product_id := null;
      if nullif(v_item->>'source_item_id','') is not null then
        select id into v_product_id from public.products where source_system = 'loyverse' and source_item_id = v_item->>'source_item_id';
      end if;
      if v_product_id is null and v_sku is not null then
        select id into v_product_id from public.products where sku = v_sku;
      end if;
      if v_product_id is null and v_barcode is not null then
        select id into v_product_id from public.products where barcode = v_barcode;
      end if;
      -- A SKU/barcode hit that belongs to a different imported Loyverse item is a
      -- clash, not the same product: never merge two Loyverse items into one.
      if v_product_id is not null and nullif(v_item->>'source_item_id','') is not null
         and exists (select 1 from public.products where id = v_product_id and source_system = 'loyverse'
                     and source_item_id is not null and source_item_id <> v_item->>'source_item_id') then
        v_product_id := null;
      end if;

      if v_barcode is not null and exists (select 1 from public.products where barcode = v_barcode and id is distinct from v_product_id) then
        v_warnings := v_warnings || jsonb_build_object('row', v_item->>'row', 'message', v_name || ': barcode ' || v_barcode || ' already used by another product; barcode left empty');
        v_barcode := null;
      end if;
      if v_sku is not null and exists (select 1 from public.products where sku = v_sku and id is distinct from v_product_id) then
        v_warnings := v_warnings || jsonb_build_object('row', v_item->>'row', 'message', v_name || ': SKU ' || v_sku || ' already used; a new SKU was generated');
        v_sku := null;
      end if;
      if v_price = 0 then
        v_warnings := v_warnings || jsonb_build_object('row', v_item->>'row', 'message', v_name || ': no selling price in the file (set it before selling)');
      end if;

      if v_product_id is null then
        if v_sku is null then
          loop
            v_sku := 'LV-' || upper(substr(md5(coalesce(v_item->>'source_item_id', v_name) || random()::text), 1, 8));
            exit when not exists (select 1 from public.products where sku = v_sku);
          end loop;
        end if;
        insert into public.products(sku, barcode, name, category_id, unit, buying_price, selling_price, quantity_on_hand, reorder_level,
          description, available_for_sale, sold_by_weight, track_stock, variant_options, source_system, source_item_id, active)
        values (v_sku, v_barcode, v_name, v_category_id, case when coalesce((v_item->>'sold_by_weight')::boolean,false) then 'kg' else 'piece' end,
          v_cost, v_price, 0, v_low, coalesce(v_item->>'description',''),
          coalesce((v_item->>'available_for_sale')::boolean,true), coalesce((v_item->>'sold_by_weight')::boolean,false), v_track,
          coalesce(v_item->'variant_options','[]'::jsonb), 'loyverse', nullif(v_item->>'source_item_id',''), true)
        returning id into v_product_id;
        v_created := v_created + 1;
      else
        update public.products set
          name = v_name,
          sku = coalesce(v_sku, sku),
          barcode = coalesce(v_barcode, barcode),
          category_id = coalesce(v_category_id, category_id),
          selling_price = case when v_price > 0 then v_price else selling_price end,
          buying_price = case when v_cost > 0 then v_cost else buying_price end,
          reorder_level = v_low,
          description = coalesce(nullif(v_item->>'description',''), description),
          available_for_sale = coalesce((v_item->>'available_for_sale')::boolean, available_for_sale),
          sold_by_weight = coalesce((v_item->>'sold_by_weight')::boolean, sold_by_weight),
          track_stock = v_track,
          variant_options = coalesce(v_item->'variant_options', variant_options),
          source_system = coalesce(source_system, 'loyverse'),
          source_item_id = coalesce(source_item_id, nullif(v_item->>'source_item_id','')),
          updated_at = now()
        where id = v_product_id;
        v_updated := v_updated + 1;
      end if;

      if p_post_opening_stock and v_track then
        if v_stock < 0 then
          v_warnings := v_warnings || jsonb_build_object('row', v_item->>'row', 'message', v_name || ': negative stock (' || v_stock || ') in Loyverse; opening stock set to 0 — count it in a stocktake');
        elsif v_stock > 0 then
          if exists (select 1 from public.inventory_movements where product_id = v_product_id) then
            v_warnings := v_warnings || jsonb_build_object('row', v_item->>'row', 'message', v_name || ': already has stock history; opening stock not applied (use a stocktake)');
          else
            if v_journal is null then
              insert into public.journals(source_type,source_id,memo,created_by)
              values('opening_stock',v_ref,'Opening stock imported from Loyverse (batch '||p_batch_id||')',v_actor)
              returning id into v_journal;
            end if;
            v_stock_value := v_stock_value + public.post_opening_stock_internal(v_product_id, v_stock,
              (select buying_price from public.products where id = v_product_id), 'import_batch', p_batch_id,
              'Opening stock imported from Loyverse', v_journal);
            v_stock_rows := v_stock_rows + 1;
          end if;
        end if;
      end if;
    exception when others then
      v_skipped := v_skipped + 1;
      v_warnings := v_warnings || jsonb_build_object('row', v_item->>'row', 'message', coalesce(v_name,'Row') || ': ' || sqlerrm);
    end;
  end loop;

  if v_journal is not null then
    if not exists (select 1 from public.journal_lines where journal_id = v_journal) then
      delete from public.journals where id = v_journal; v_journal := null;
    else
      perform public.assert_journal_balanced(v_journal);
    end if;
  end if;

  -- Re-link previously imported sales history to the products just created.
  update public.legacy_sales_lines l set product_id = p.id
  from public.products p
  where l.product_id is null and ((l.sku <> '' and p.sku = l.sku)
     or lower(p.name) = lower(l.item_name || case when l.variant <> '' then ' (' || l.variant || ')' else '' end));

  return jsonb_build_object('processed', v_idx, 'created', v_created, 'updated', v_updated, 'skipped', v_skipped,
    'opening_stock_items', v_stock_rows, 'opening_stock_value', v_stock_value, 'journal_id', v_journal, 'warnings', v_warnings);
end;
$$;
revoke all on function public.import_loyverse_items(uuid,jsonb,boolean) from public, anon;
grant execute on function public.import_loyverse_items(uuid,jsonb,boolean) to authenticated;

-- Customers. Each element: {customer_code, name, email, phone, address, notes}
create or replace function public.import_customers(p_batch_id uuid, p_customers jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := public.require_staff(array['owner','manager']::public.staff_role[]);
  v_row jsonb;
  v_id uuid;
  v_name text; v_code text; v_phone text; v_email text;
  v_created integer := 0; v_updated integer := 0; v_skipped integer := 0;
  v_warnings jsonb := '[]'::jsonb;
begin
  perform 1 from public.import_batches where id = p_batch_id and kind = 'customers' and status = 'running';
  if not found then raise exception 'Import batch not found or already finished'; end if;
  for v_row in select e from jsonb_array_elements(p_customers) e loop
    begin
      v_name := nullif(trim(v_row->>'name'),'');
      v_code := nullif(trim(v_row->>'customer_code'),'');
      v_phone := nullif(trim(v_row->>'phone'),'');
      v_email := nullif(lower(trim(v_row->>'email')),'');
      if v_name is null then
        v_skipped := v_skipped + 1;
        v_warnings := v_warnings || jsonb_build_object('row', v_row->>'row', 'message', 'Skipped: no customer name');
        continue;
      end if;
      v_id := null;
      if v_code is not null then select id into v_id from public.customers where customer_code = v_code; end if;
      if v_id is null and v_phone is not null then select id into v_id from public.customers where phone = v_phone limit 1; end if;
      if v_id is null and v_email is not null then select id into v_id from public.customers where lower(email) = v_email limit 1; end if;
      if v_id is null then
        insert into public.customers(name, phone, email, address, notes, customer_code, source_system, credit_limit, active)
        values (v_name, v_phone, v_email, coalesce(v_row->>'address',''), coalesce(v_row->>'notes',''), v_code, 'loyverse', 0, true);
        v_created := v_created + 1;
      else
        update public.customers set name = v_name, phone = coalesce(v_phone, phone), email = coalesce(v_email, email),
          address = coalesce(nullif(v_row->>'address',''), address), notes = coalesce(nullif(v_row->>'notes',''), notes),
          customer_code = coalesce(customer_code, v_code)
        where id = v_id;
        v_updated := v_updated + 1;
      end if;
    exception when others then
      v_skipped := v_skipped + 1;
      v_warnings := v_warnings || jsonb_build_object('row', v_row->>'row', 'message', coalesce(v_name,'Row') || ': ' || sqlerrm);
    end;
  end loop;
  return jsonb_build_object('created', v_created, 'updated', v_updated, 'skipped', v_skipped, 'warnings', v_warnings);
end;
$$;
revoke all on function public.import_customers(uuid,jsonb) from public, anon;
grant execute on function public.import_customers(uuid,jsonb) to authenticated;

-- Sales history lines (reference only; never posted to stock or accounting).
create or replace function public.import_legacy_sales(p_batch_id uuid, p_lines jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := public.require_staff(array['owner','manager']::public.staff_role[]);
  v_inserted integer;
  v_total integer;
begin
  perform 1 from public.import_batches where id = p_batch_id and kind = 'sales' and status = 'running';
  if not found then raise exception 'Import batch not found or already finished'; end if;
  v_total := jsonb_array_length(p_lines);
  with src as (
    select * from jsonb_to_recordset(p_lines) as x(
      line_key text, sold_at timestamptz, receipt_number text, receipt_type text, sku text, item_name text, variant text,
      category text, quantity numeric, gross_sales numeric, discounts numeric, net_sales numeric, cost_of_goods numeric,
      payment_type text, cashier_name text, customer_name text, store_name text)
    where line_key is not null and sold_at is not null
  ), ins as (
    insert into public.legacy_sales_lines(batch_id, source_system, line_key, sold_at, receipt_number, receipt_type, product_id, sku,
      item_name, variant, category, quantity, gross_sales, discounts, net_sales, cost_of_goods, payment_type, cashier_name, customer_name, store_name)
    select p_batch_id, 'loyverse', s.line_key, s.sold_at, coalesce(s.receipt_number,''),
      case when lower(coalesce(s.receipt_type,'')) like 'refund%' then 'refund' else 'sale' end,
      coalesce(
        (select p.id from public.products p where coalesce(s.sku,'') <> '' and p.sku = s.sku limit 1),
        (select p.id from public.products p where lower(p.name) = lower(coalesce(s.item_name,'') ||
             case when coalesce(s.variant,'') <> '' then ' (' || s.variant || ')' else '' end) limit 1),
        (select p.id from public.products p where lower(p.name) = lower(coalesce(s.item_name,'')) limit 1)),
      coalesce(s.sku,''), coalesce(s.item_name,''), coalesce(s.variant,''), coalesce(s.category,''),
      abs(coalesce(s.quantity,0)), abs(coalesce(s.gross_sales,0)), abs(coalesce(s.discounts,0)), abs(coalesce(s.net_sales,0)),
      abs(coalesce(s.cost_of_goods,0)), coalesce(s.payment_type,''), coalesce(s.cashier_name,''), coalesce(s.customer_name,''), coalesce(s.store_name,'')
    from src s
    on conflict (source_system, line_key) do nothing
    returning 1
  )
  select count(*) into v_inserted from ins;
  return jsonb_build_object('received', v_total, 'inserted', v_inserted, 'duplicates_skipped', v_total - v_inserted);
end;
$$;
revoke all on function public.import_legacy_sales(uuid,jsonb) from public, anon;
grant execute on function public.import_legacy_sales(uuid,jsonb) to authenticated;

create or replace function public.get_legacy_sales_overview()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v jsonb;
begin
  perform public.require_staff(array['owner','manager','accountant']::public.staff_role[]);
  select jsonb_build_object(
    'lines', count(*),
    'first_sale', min(sold_at), 'last_sale', max(sold_at),
    'net_sales', coalesce(sum(case when receipt_type = 'sale' then net_sales else -net_sales end),0),
    'unmatched_lines', count(*) filter (where product_id is null)
  ) into v from public.legacy_sales_lines;
  return v;
end;
$$;
revoke all on function public.get_legacy_sales_overview() from public, anon;
grant execute on function public.get_legacy_sales_overview() to authenticated;

-- ---------------------------------------------------------------------------
-- 12. Smart purchasing: include imported history and configurable cover days
--     (same columns as before so dependent functions keep working)
-- ---------------------------------------------------------------------------
create or replace view public.smart_purchase_recommendations
with (security_invoker = true)
as
with cfg as (
  select coalesce((select stock_cover_days from public.store_settings where id), 5)::numeric as cover_days
),
demand as (
  select si.product_id, si.quantity, s.created_at as sold_at
  from public.sale_items si join public.sales s on s.id = si.sale_id
  where s.status = 'completed' and s.created_at >= now() - interval '30 days'
  union all
  select l.product_id, case when l.receipt_type = 'refund' then -l.quantity else l.quantity end, l.sold_at
  from public.legacy_sales_lines l
  where l.product_id is not null and l.sold_at >= now() - interval '30 days'
),
agg as (
  select product_id,
    greatest(sum(quantity) filter (where sold_at >= now() - interval '14 days'),0) as units_14d,
    greatest(sum(quantity),0) as units_30d
  from demand group by product_id
),
incoming as (
  select poi.product_id, sum(poi.quantity_ordered - poi.quantity_received) as incoming_qty
  from public.purchase_order_items poi
  join public.purchase_orders po on po.id = poi.purchase_order_id
  where po.status in ('ordered','part_received') and poi.quantity_ordered > poi.quantity_received
  group by poi.product_id
),
base as (
  select p.*, c.name as category_name, sup.name as supplier_name,
    coalesce(a.units_14d,0) as u14, coalesce(a.units_30d,0) as u30,
    coalesce(i.incoming_qty,0) as incoming,
    (coalesce(a.units_14d,0) / 14.0) * 0.60 + (coalesce(a.units_30d,0) / 30.0) * 0.40 as demand,
    cfg.cover_days
  from public.products p
  cross join cfg
  left join public.categories c on c.id = p.category_id
  left join public.suppliers sup on sup.id = p.supplier_id
  left join agg a on a.product_id = p.id
  left join incoming i on i.product_id = p.id
  where p.active and p.track_stock
)
select
  b.id as product_id,
  b.sku,
  b.name as product_name,
  b.unit,
  b.category_id,
  b.category_name,
  b.supplier_id,
  b.supplier_name,
  b.quantity_on_hand,
  b.reorder_level,
  b.u14::numeric(14,3) as units_sold_14d,
  b.u30::numeric(14,3) as units_sold_30d,
  round(b.u14 / 14.0, 3) as recent_daily_demand,
  round(b.u30 / 30.0, 3) as baseline_daily_demand,
  round(b.demand, 3) as adjusted_daily_demand,
  b.cover_days as target_cover_days,
  b.incoming::numeric(14,3) as confirmed_incoming_qty,
  round(b.demand * b.cover_days + b.reorder_level - b.quantity_on_hand - b.incoming, 3) as raw_recommended_qty,
  greatest(case when b.sold_by_weight
                then round(b.demand * b.cover_days + b.reorder_level - b.quantity_on_hand - b.incoming, 3)
                else ceil(b.demand * b.cover_days + b.reorder_level - b.quantity_on_hand - b.incoming) end, 0) as recommended_qty,
  round(greatest(case when b.sold_by_weight
                then round(b.demand * b.cover_days + b.reorder_level - b.quantity_on_hand - b.incoming, 3)
                else ceil(b.demand * b.cover_days + b.reorder_level - b.quantity_on_hand - b.incoming) end, 0) * b.buying_price, 2) as estimated_purchase_cost,
  case
    when b.quantity_on_hand <= 0 and (b.demand > 0 or b.reorder_level > 0) then 'urgent'
    when b.quantity_on_hand <= b.reorder_level then 'recommended'
    when b.demand * b.cover_days + b.reorder_level - b.quantity_on_hand - b.incoming > 0 then 'recommended'
    else 'watch'
  end as recommendation_priority,
  case when b.demand > 0 then round(b.quantity_on_hand / b.demand, 1) end as estimated_days_of_stock,
  b.buying_price as latest_known_buying_price,
  now() as calculated_at
from base b;

comment on view public.smart_purchase_recommendations is
  'Explainable read-only shopping recommendations from live + imported sales history. Never changes stock or creates a purchase.';

commit;
