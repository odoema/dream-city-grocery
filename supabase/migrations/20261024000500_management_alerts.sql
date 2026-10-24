-- Dream City Grocery management alerts.
-- Creates a server-side notification queue for major operational events.
-- Email delivery is handled by Google Apps Script; no email credentials are stored in SQL.

begin;

create table if not exists public.management_notifications (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  title text not null,
  body text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text
);

create index if not exists management_notifications_pending_idx
  on public.management_notifications(created_at)
  where sent_at is null;

alter table public.management_notifications enable row level security;

create or replace function public.queue_management_notification(
  p_event_type text,
  p_title text,
  p_body text,
  p_payload jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.management_notifications(event_type,title,body,payload)
  values(
    coalesce(nullif(trim(p_event_type),''),'general'),
    coalesce(nullif(trim(p_title),''),'Dream City Grocery activity'),
    coalesce(p_body,''),
    coalesce(p_payload,'{}'::jsonb)
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.queue_management_notification(text,text,text,jsonb) from public, anon;
grant execute on function public.queue_management_notification(text,text,text,jsonb) to authenticated;

after insert or update of status on public.sales
create or replace function public.notify_management_sale()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform public.queue_management_notification(
      'sale',
      'Sale recorded — ' || coalesce(new.receipt_number,'transaction'),
      'A completed sale was recorded at Dream City Grocery. Receipt: ' || coalesce(new.receipt_number,'—') || '. Total: UGX ' || to_char(coalesce(new.total,0),'FM999G999G999G990D00') || '.',
      jsonb_build_object('sale_id',new.id,'receipt_number',new.receipt_number,'total',new.total,'payment_method',new.payment_method,'cashier_id',new.cashier_id,'created_at',new.created_at)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists management_sale_alert on public.sales;
create trigger management_sale_alert
after insert or update of status on public.sales
for each row execute function public.notify_management_sale();

create or replace function public.notify_management_stocktake_start()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'draft' then
    perform public.queue_management_notification(
      'stocktake_started',
      'Stock-taking started — ' || coalesce(new.session_number,'session'),
      'A new physical stock-taking session has started. Session: ' || coalesce(new.session_number,'—') || '. Staff should pause stock movement during the count where possible.',
      jsonb_build_object('session_id',new.id,'session_number',new.session_number,'started_at',new.started_at,'started_by',new.started_by)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists management_stocktake_start_alert on public.stocktake_sessions;
create trigger management_stocktake_start_alert
after insert on public.stocktake_sessions
for each row execute function public.notify_management_stocktake_start();

create or replace function public.notify_management_stocktake_complete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('completed','cancelled') and old.status is distinct from new.status then
    perform public.queue_management_notification(
      case when new.status='completed' then 'stocktake_completed' else 'stocktake_cancelled' end,
      case when new.status='completed' then 'Stock-taking posted — ' else 'Stock-taking cancelled — ' end || coalesce(new.session_number,'session'),
      case when new.status='completed' then 'The stock-taking session was approved and posted. Stock balances, inventory movements and accounting adjustments have been updated.' else 'The stock-taking draft was cancelled. No stock or accounting balances were changed.' end,
      jsonb_build_object('session_id',new.id,'session_number',new.session_number,'status',new.status,'completed_at',new.completed_at)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists management_stocktake_complete_alert on public.stocktake_sessions;
create trigger management_stocktake_complete_alert
after update of status on public.stocktake_sessions
for each row execute function public.notify_management_stocktake_complete();

create or replace function public.notify_management_supplier_invoice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.queue_management_notification(
    'supplier_invoice',
    'Supplier invoice received — ' || coalesce(new.invoice_number,'invoice'),
    'A supplier invoice was received and posted to inventory/accounts payable. Invoice: ' || coalesce(new.invoice_number,'—') || '. Total: UGX ' || to_char(coalesce(new.total,0),'FM999G999G999G990D00') || '.',
    jsonb_build_object('invoice_id',new.id,'supplier_id',new.supplier_id,'invoice_number',new.invoice_number,'total',new.total,'purchase_order_id',new.purchase_order_id,'created_at',new.created_at)
  );
  return new;
end;
$$;

drop trigger if exists management_supplier_invoice_alert on public.supplier_invoices;
create trigger management_supplier_invoice_alert
after insert on public.supplier_invoices
for each row execute function public.notify_management_supplier_invoice();

create or replace function public.notify_management_supplier_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.queue_management_notification(
    'supplier_payment',
    'Supplier payment recorded',
    'A supplier payment was recorded. Reference: ' || coalesce(new.payment_reference,'—') || '. Amount: UGX ' || to_char(coalesce(new.amount,0),'FM999G999G999G990D00') || '.',
    jsonb_build_object('payment_id',new.id,'supplier_id',new.supplier_id,'invoice_id',new.invoice_id,'payment_reference',new.payment_reference,'amount',new.amount,'payment_method',new.payment_method,'paid_at',new.paid_at)
  );
  return new;
end;
$$;

drop trigger if exists management_supplier_payment_alert on public.supplier_payments;
create trigger management_supplier_payment_alert
after insert on public.supplier_payments
for each row execute function public.notify_management_supplier_payment();

commit;
