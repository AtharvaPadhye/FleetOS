-- LOCAL DEVELOPMENT ONLY (runs on `supabase db reset`). Hosted projects set their own secret and schedule.
-- Every minute, pg_cron calls the app's tick endpoint on the host machine (ADR-0014).
select vault.create_secret('local-dev-tick-secret', 'tick_secret', 'Local dev only: bearer for /api/internal/tick');

select cron.schedule(
  'engine-tick',
  '* * * * *',
  $$
  select net.http_post(
    url := 'http://host.docker.internal:3000/api/internal/tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'tick_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);
