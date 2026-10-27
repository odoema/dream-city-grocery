-- =============================================================================
-- Automatic reports + faster Loyverse sync
-- -----------------------------------------------------------------------------
--   * build_shop_report('evening' | 'morning'): the day's report for the
--     Executive Director, and the morning shopping list for the buyer
--   * send_shop_report(kind): hands the report to the Google mailer
--     (URL and token kept in Supabase Vault, never in code)
--   * Loyverse sync may now run every 20 seconds (instant sync via webhook)
-- The schedule lives in supabase/automations.sql (run once in the SQL editor).
-- Never run against SmartAttend.
-- =============================================================================
begin;

-- Instant sync: Loyverse calls us on every receipt, so allow a run every 20 s.
create or replace function public.loyverse_sync_begin()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v public.loyverse_sync_state%rowtype;
begin
  select * into v from public.loyverse_sync_state where id for update;
  if not v.enabled then return jsonb_build_object('run', false, 'reason', 'disabled'); end if;
  if v.last_started_at is not null and v.last_started_at > now() - interval '20 seconds' then
    return jsonb_build_object('run', false, 'reason', 'ran a few seconds ago');
  end if;
  update public.loyverse_sync_state set last_started_at = now() where id;
  return jsonb_build_object('run', true, 'receipts_since', v.receipts_since - interval '3 hours');
end;
$$;

create or replace function public.report_money(p numeric)
returns text language sql stable set search_path = ''
as $$
  select coalesce((select currency_code from public.store_settings where id), 'UGX') || ' ' || to_char(round(coalesce(p,0)), 'FM999,999,999,990')
$$;

create or replace function public.report_escape(p text)
returns text language sql immutable set search_path = ''
as $$ select replace(replace(replace(coalesce(p,''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;') $$;

-- Builds { subject, text, html } for the evening report or the morning shopping list.
create or replace function public.build_shop_report(p_kind text default 'evening')
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_tz text := coalesce((select timezone from public.store_settings where id), 'Africa/Kampala');
  v_shop text := coalesce((select business_name from public.store_settings where id), 'Shop');
  v_day date := (now() at time zone v_tz)::date;
  v_from timestamptz;
  v_to timestamptz;
  v_s jsonb;
  v_rows text := '';
  v_lines text[] := '{}';
  v_subject text;
  v_head text;
  v_total numeric := 0;
  v_count int := 0;
  r record;
  v_short numeric;
  v_counted int;
  v_spent numeric;
begin
  perform public.loyverse_act_as_owner();
  if p_kind = 'morning' then
    -- Shopping list for today, from the last 30 days of sales and current stock.
    for r in select product_name, unit, quantity_on_hand, recommended_qty, estimated_purchase_cost, recommendation_priority, estimated_days_of_stock
               from public.smart_purchase_recommendations
              where recommendation_priority in ('urgent','recommended') and recommended_qty > 0
              order by (recommendation_priority = 'urgent') desc, estimated_purchase_cost desc nulls last
              limit 40 loop
      v_count := v_count + 1;
      v_total := v_total + coalesce(r.estimated_purchase_cost, 0);
      v_lines := v_lines || format('%s. %s — buy %s %s (have %s)%s', v_count, r.product_name, trim(to_char(r.recommended_qty, 'FM999990.###')), coalesce(r.unit,''),
                                   trim(to_char(r.quantity_on_hand, 'FM999990.###')), case when r.recommendation_priority = 'urgent' then ' — OUT' else '' end);
      v_rows := v_rows || format('<tr><td style="padding:6px 8px;border-bottom:1px solid #e3e8f0">%s%s</td><td style="padding:6px 8px;border-bottom:1px solid #e3e8f0;text-align:right">%s %s</td><td style="padding:6px 8px;border-bottom:1px solid #e3e8f0;text-align:right">%s</td><td style="padding:6px 8px;border-bottom:1px solid #e3e8f0;text-align:right">%s</td></tr>',
        public.report_escape(r.product_name), case when r.recommendation_priority = 'urgent' then ' <b style="color:#A16A1A">OUT</b>' else '' end,
        trim(to_char(r.recommended_qty, 'FM999990.###')), public.report_escape(r.unit), trim(to_char(r.quantity_on_hand, 'FM999990.###')), public.report_money(r.estimated_purchase_cost));
    end loop;
    v_subject := format('%s — shopping list %s (%s items, about %s)', v_shop, to_char(v_day, 'DD Mon'), v_count, public.report_money(v_total));
    v_head := format('Good morning. %s items need buying today. Estimated cost: %s.', v_count, public.report_money(v_total));
    return jsonb_build_object('kind', 'morning', 'subject', v_subject,
      'text', v_head || chr(10) || chr(10) || array_to_string(v_lines, chr(10)),
      'html', format('<div style="font-family:Arial,sans-serif;color:#010101;max-width:640px"><div style="background:#16376A;color:#fff;padding:14px 18px;border-bottom:4px solid #FB8F11"><b style="font-size:18px">%s</b><br>Shopping list · %s</div><p style="padding:0 4px">%s</p><table style="border-collapse:collapse;width:100%%;font-size:14px"><tr style="background:#16376A;color:#fff"><th style="padding:6px 8px;text-align:left">Item</th><th style="padding:6px 8px;text-align:right">Buy</th><th style="padding:6px 8px;text-align:right">In stock</th><th style="padding:6px 8px;text-align:right">About</th></tr>%s<tr><td colspan="3" style="padding:8px;text-align:right"><b>Total</b></td><td style="padding:8px;text-align:right"><b>%s</b></td></tr></table><p style="color:#5a6b85;font-size:12px">Worked out from the last 30 days of sales. Adjust for prices at the market.</p></div>',
        public.report_escape(v_shop), to_char(v_day, 'Day DD Mon YYYY'), v_head, v_rows, public.report_money(v_total)));
  end if;

  -- Evening report for today.
  v_from := v_day::timestamp at time zone v_tz;
  v_to := (v_day + 1)::timestamp at time zone v_tz;
  v_s := public.get_sales_summary(v_from, v_to);
  select coalesce(sum(difference),0), count(*) into v_short, v_counted from public.cash_ups where created_at >= v_from and created_at < v_to;
  select coalesce(sum(amount),0) into v_spent from public.expenses where created_at >= v_from and created_at < v_to;

  v_lines := array[
    format('Sales: %s (%s receipts)', public.report_money((v_s->>'net_sales')::numeric), v_s->>'transactions'),
    format('Gross profit: %s', public.report_money((v_s->>'gross_profit')::numeric)),
    format('Expenses: %s', public.report_money(v_spent)),
    format('Refunds: %s', public.report_money((v_s->>'refunds')::numeric)),
    case when v_counted = 0 then 'Cash: no drawer counted today' when v_short = 0 then 'Cash: exact' else format('Cash: %s %s', case when v_short < 0 then 'SHORT' else 'over' end, public.report_money(abs(v_short))) end];
  for r in select x->>'method' m, (x->>'total')::numeric t from jsonb_array_elements(coalesce(v_s->'by_payment','[]'::jsonb)) x loop
    v_lines := v_lines || format('· %s: %s', initcap(replace(r.m, '_', ' ')), public.report_money(r.t));
    v_rows := v_rows || format('<tr><td style="padding:4px 8px">%s</td><td style="padding:4px 8px;text-align:right">%s</td></tr>', initcap(replace(r.m, '_', ' ')), public.report_money(r.t));
  end loop;
  v_lines := v_lines || 'Best sellers:'::text;
  v_head := '';
  for r in select x->>'name' n, (x->>'revenue')::numeric v from jsonb_array_elements(coalesce(v_s->'top_products','[]'::jsonb)) x limit 5 loop
    v_lines := v_lines || format('· %s: %s', r.n, public.report_money(r.v));
    v_head := v_head || format('<li>%s — %s</li>', public.report_escape(r.n), public.report_money(r.v));
  end loop;
  v_count := 0; v_total := 0;
  for r in select product_name from public.smart_purchase_recommendations where recommendation_priority = 'urgent' order by units_sold_30d desc nulls last limit 8 loop
    v_count := v_count + 1;
    v_lines := v_lines || format('OUT OF STOCK: %s', r.product_name);
  end loop;
  v_subject := format('%s — %s: sales %s, profit %s', v_shop, to_char(v_day, 'DD Mon'), public.report_money((v_s->>'net_sales')::numeric), public.report_money((v_s->>'gross_profit')::numeric));
  return jsonb_build_object('kind', 'evening', 'subject', v_subject,
    'text', array_to_string(v_lines, chr(10)),
    'html', format('<div style="font-family:Arial,sans-serif;color:#010101;max-width:640px"><div style="background:#16376A;color:#fff;padding:14px 18px;border-bottom:4px solid #FB8F11"><b style="font-size:18px">%s</b><br>Day report · %s</div>'
      || '<table style="width:100%%;border-collapse:collapse;margin:12px 0;font-size:15px">'
      || '<tr><td style="padding:6px 8px">Sales</td><td style="padding:6px 8px;text-align:right"><b>%s</b> (%s receipts)</td></tr>'
      || '<tr><td style="padding:6px 8px">Gross profit</td><td style="padding:6px 8px;text-align:right"><b>%s</b></td></tr>'
      || '<tr><td style="padding:6px 8px">Expenses</td><td style="padding:6px 8px;text-align:right">%s</td></tr>'
      || '<tr><td style="padding:6px 8px">Refunds</td><td style="padding:6px 8px;text-align:right">%s</td></tr>'
      || '<tr><td style="padding:6px 8px">Cash in drawers</td><td style="padding:6px 8px;text-align:right;color:%s"><b>%s</b></td></tr></table>'
      || '<h3 style="color:#16376A;border-bottom:2px solid #FB8F11;padding-bottom:3px">How customers paid</h3><table style="width:100%%;border-collapse:collapse;font-size:14px">%s</table>'
      || '<h3 style="color:#16376A;border-bottom:2px solid #FB8F11;padding-bottom:3px">Best sellers</h3><ol style="font-size:14px">%s</ol>%s'
      || '<p style="color:#5a6b85;font-size:12px">Sent automatically by the Grocery POS. Open the Dashboard for the full picture.</p></div>',
      public.report_escape(v_shop), to_char(v_day, 'Day DD Mon YYYY'),
      public.report_money((v_s->>'net_sales')::numeric), v_s->>'transactions',
      public.report_money((v_s->>'gross_profit')::numeric), public.report_money(v_spent), public.report_money((v_s->>'refunds')::numeric),
      case when v_short < 0 then '#A16A1A' else '#16376A' end,
      case when v_counted = 0 then 'not counted' when v_short = 0 then 'exact' else (case when v_short < 0 then 'SHORT ' else 'over ' end) || public.report_money(abs(v_short)) end,
      coalesce(nullif(v_rows,''), '<tr><td style="padding:4px 8px">No sales</td></tr>'),
      coalesce(nullif(v_head,''), '<li>No sales</li>'),
      case when v_count > 0 then format('<p style="color:#A16A1A"><b>%s best seller(s) out of stock.</b> The morning shopping list will include them.</p>', v_count) else '' end));
end;
$$;
revoke all on function public.build_shop_report(text) from public, anon, authenticated;

-- Send through the Google mailer. Secrets live in Supabase Vault:
--   select vault.create_secret('<web app URL>', 'report_mailer_url');
--   select vault.create_secret('<any long password>', 'report_mailer_token');
create or replace function public.send_shop_report(p_kind text default 'evening')
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_url text;
  v_token text;
  v_report jsonb;
  v_request bigint;
begin
  if auth.uid() is not null then perform public.require_staff(array['owner','manager']::public.staff_role[]); end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'report_mailer_url';
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'report_mailer_token';
  if v_url is null or v_token is null then raise exception 'The report mailer is not set up yet (Vault secrets report_mailer_url and report_mailer_token)'; end if;
  v_report := public.build_shop_report(p_kind);
  select net.http_post(url := v_url, body := v_report || jsonb_build_object('token', v_token),
                       headers := '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds := 20000) into v_request;
  return jsonb_build_object('queued', true, 'subject', v_report->>'subject');
end;
$$;
revoke all on function public.send_shop_report(text) from public, anon;
grant execute on function public.send_shop_report(text) to authenticated;

commit;
