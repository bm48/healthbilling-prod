-- Schedule backup-provider-sheets Edge Function twice a day at 8:00 and 20:00 (UTC-7).
-- Cron runs in UTC: 8:00 UTC-7 = 15:00 UTC, 20:00 UTC-7 = 03:00 UTC → '0 3,15 * * *'
--
-- Prerequisites:
-- 1. Enable "pg_cron" and "pg_net" in Supabase Dashboard → Database → Extensions.
-- 2. Store secrets in Vault (Dashboard → SQL Editor or Project Settings → Vault):
--      SELECT vault.create_secret('https://YOUR_PROJECT_REF.supabase.co', 'backup_project_url');
--      SELECT vault.create_secret('YOUR_RANDOM_CRON_SECRET', 'backup_cron_secret');
--      SELECT vault.create_secret('YOUR_SUPABASE_ANON_KEY', 'backup_anon_key');  -- Project Settings → API → anon public
--    Use the same value for backup_cron_secret as BACKUP_CRON_SECRET in Edge Function secrets.
-- 3. Deploy the backup-provider-sheets Edge Function and set BACKUP_CRON_SECRET there.

-- Ensure extensions exist (may already be enabled in Dashboard)
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Unschedule old jobs if they exist (ignore error if job name not found)
DO $$
BEGIN
  PERFORM cron.unschedule('backup-provider-sheets-every-3min');
EXCEPTION
  WHEN OTHERS THEN NULL;
END
$$;
DO $$
BEGIN
  PERFORM cron.unschedule('backup-provider-sheets-every-12h');
EXCEPTION
  WHEN OTHERS THEN NULL;
END
$$;

SELECT cron.schedule(
  'backup-provider-sheets-every-12h',
  '0 3,15 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'backup_project_url') || '/functions/v1/backup-provider-sheets',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'backup_anon_key')
    ),
    body := jsonb_build_object(
      'cron_secret',
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'backup_cron_secret')
    )
  ) AS request_id;
  $$
);
