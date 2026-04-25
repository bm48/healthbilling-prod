-- Schedule AR, Provider Pay, and Patients backup Edge Functions twice a day at 8:00 and 20:00 (UTC-7).
-- Cron runs in UTC: 8:00 UTC-7 = 15:00 UTC, 20:00 UTC-7 = 03:00 UTC → '0 3,15 * * *'
-- Uses same Vault secrets: backup_project_url, backup_cron_secret, backup_anon_key.
-- To replace existing 3-min schedules, run: SELECT cron.unschedule('backup-ar-every-3min'); (and same for backup-provider-pay, backup-patients).

SELECT cron.unschedule('backup-ar-every-3min');
SELECT cron.schedule(
  'backup-ar-every-12h',
  '0 3,15 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'backup_project_url') || '/functions/v1/backup-ar',
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

SELECT cron.unschedule('backup-provider-pay-every-3min');
SELECT cron.schedule(
  'backup-provider-pay-every-12h',
  '0 3,15 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'backup_project_url') || '/functions/v1/backup-provider-pay',
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

SELECT cron.unschedule('backup-patients-every-3min');
SELECT cron.schedule(
  'backup-patients-every-12h',
  '0 3,15 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'backup_project_url') || '/functions/v1/backup-patients',
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
