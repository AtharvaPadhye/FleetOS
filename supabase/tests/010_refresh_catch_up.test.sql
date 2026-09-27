begin;
create extension if not exists pgtap with schema extensions;
select plan(2);

-- Regression (Phase 3 exit check): a tick that replays simulated time across midnight must recompute the
-- earlier day, not only "the last refreshed day onwards".
insert into public.orgs (id, name, slug, timezone) values
  ('00000000-0000-0000-0000-00000000a600', 'Catch-up Co', 'catch-up-co-t', 'UTC');
insert into public.vehicles (id, org_id, vin, number) values
  ('00000000-0000-0000-0000-00000000c601', '00000000-0000-0000-0000-00000000a600', '7G2CEHED9RA004047', '047');

-- First tick, two days ago at 08:00: the car is ready.
insert into public.vehicle_status_events (org_id, vehicle_id, to_status, at, cause_type) values
  ('00000000-0000-0000-0000-00000000a600', '00000000-0000-0000-0000-00000000c601', 'ready',
   (current_date - 2) + time '08:00', 'telemetry');
select public.engine_refresh_day_hours('00000000-0000-0000-0000-00000000a600', (current_date - 2) + time '08:00');

-- Catch-up tick replays from 08:01 two days ago: the car went into service at 10:00 that day.
insert into public.vehicle_status_events (org_id, vehicle_id, from_status, to_status, at, cause_type) values
  ('00000000-0000-0000-0000-00000000a600', '00000000-0000-0000-0000-00000000c601', 'ready', 'in_service',
   (current_date - 2) + time '10:00', 'telemetry');
select public.engine_refresh_day_hours('00000000-0000-0000-0000-00000000a600', (current_date - 2) + time '08:01');

select results_eq(
  $$ select ready_h, in_service_h from public.vehicle_day_hours
     where vehicle_id = '00000000-0000-0000-0000-00000000c601' and day = current_date - 2 $$,
  $$ values (2.000::numeric, 14.000::numeric) $$,
  'the replayed day is recomputed with the events that arrived later'
);
select is(
  (select in_service_h from public.vehicle_day_hours
   where vehicle_id = '00000000-0000-0000-0000-00000000c601' and day = current_date - 1),
  24.000::numeric, 'the following day carries the status forward'
);

select * from finish();
rollback;
