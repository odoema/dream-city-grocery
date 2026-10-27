-- =============================================================================
-- Executive Director on reports and the Dashboard
-- -----------------------------------------------------------------------------
-- Adds the Executive Director's name and title to the shop settings, greets
-- them by name in the evening report, and shows "Prepared for …" on the
-- Dashboard and donor print-out. Never run against SmartAttend.
-- =============================================================================
begin;

alter table public.store_settings
  add column if not exists director_name text not null default '',
  add column if not exists director_title text not null default 'Executive Director';

-- Dream City Grocery's Executive Director.
update public.store_settings set director_name = 'Hon. Dr. Betty Udongo Pacutho'
 where id and business_name = 'Dream City Grocery' and director_name = '';

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
    director_name = coalesce(p_settings->>'director_name', s.director_name),
    director_title = coalesce(nullif(trim(p_settings->>'director_title'),''), s.director_title),
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

-- The evening report opens with a greeting to the Executive Director.
create or replace function public.send_shop_report(p_kind text default 'evening')
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_url text;
  v_token text;
  v_report jsonb;
  v_name text := nullif(trim((select director_name from public.store_settings where id)), '');
  v_request bigint;
begin
  if auth.uid() is not null then perform public.require_staff(array['owner','manager']::public.staff_role[]); end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'report_mailer_url';
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'report_mailer_token';
  if v_url is null or v_token is null then raise exception 'The report mailer is not set up yet (Vault secrets report_mailer_url and report_mailer_token)'; end if;
  v_report := public.build_shop_report(p_kind);
  if p_kind = 'evening' and v_name is not null then
    v_report := v_report || jsonb_build_object(
      'text', 'Dear ' || v_name || ',' || chr(10) || chr(10) || 'Here is today''s summary.' || chr(10) || chr(10) || (v_report->>'text'),
      'html', '<p style="font-family:Arial,sans-serif;font-size:15px">Dear ' || public.report_escape(v_name) || ',<br>Here is today''s summary.</p>' || (v_report->>'html'));
  end if;
  select net.http_post(url := v_url, body := v_report || jsonb_build_object('token', v_token),
                       headers := '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds := 20000) into v_request;
  return jsonb_build_object('queued', true, 'subject', v_report->>'subject');
end;
$$;
revoke all on function public.send_shop_report(text) from public, anon;
grant execute on function public.send_shop_report(text) to authenticated;

commit;
