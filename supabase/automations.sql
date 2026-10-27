-- Automatic reports. Run once in the SQL editor (Dream City Grocery project, never SmartAttend)
-- AFTER the Google report mailer is deployed (google-apps-script/ReportMailer.gs).
-- 1) Put your two values between the quotes below, then run the whole script.
--    They are stored encrypted in Supabase Vault, not in the code.
select vault.create_secret('PASTE-THE-WEB-APP-URL-ENDING-IN-/exec', 'report_mailer_url')
 where not exists (select 1 from vault.secrets where name = 'report_mailer_url');
select vault.create_secret('PASTE-THE-SAME-MAILER_TOKEN', 'report_mailer_token')
 where not exists (select 1 from vault.secrets where name = 'report_mailer_token');

-- 2) Schedule (times are UTC; Uganda is UTC+3):
--    evening report 21:15 Kampala = 18:15 UTC, shopping list 06:45 Kampala = 03:45 UTC.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule(jobid) from cron.job where jobname in ('evening-report', 'morning-shopping-list');
select cron.schedule('evening-report', '15 18 * * *', $$ select public.send_shop_report('evening') $$);
select cron.schedule('morning-shopping-list', '45 3 * * *', $$ select public.send_shop_report('morning') $$);

-- To change a secret later:
--   select vault.update_secret((select id from vault.secrets where name = 'report_mailer_url'), 'NEW-URL');
