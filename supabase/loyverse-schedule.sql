-- Run once in the SQL editor AFTER the loyverse-sync Edge Function is deployed.
-- Calls the sync every 5 minutes. Change the project address for another shop.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule(jobid) from cron.job where jobname = 'loyverse-sync';
select cron.schedule('loyverse-sync', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://nohdgmylncjtdymfshfy.supabase.co/functions/v1/loyverse-sync',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb)
$$);
