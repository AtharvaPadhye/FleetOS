begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000f401', 'ops@h.test'),
  ('00000000-0000-0000-0000-00000000f402', 'fin@h.test');
-- UTC org with a 06:00–22:00 service window keeps the arithmetic readable.
insert into public.orgs (id, name, slug, timezone, service_start, service_end) values
  ('00000000-0000-0000-0000-00000000a400', 'Hours Co', 'hours-co-t', 'UTC', '06:00', '22:00');
insert into public.memberships (org_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000a400', '00000000-0000-0000-0000-00000000f401', 'ops'),
  ('00000000-0000-0000-0000-00000000a400', '00000000-0000-0000-0000-00000000f402', 'finance');
insert into public.vehicles (id, org_id, vin, number) values
  ('00000000-0000-0000-0000-00000000c401', '00000000-0000-0000-0000-00000000a400', '7G2CEHED9RA004047', '047'),
  ('00000000-0000-0000-0000-00000000c402', '00000000-0000-0000-0000-00000000a400', '7G2CEHED5RA004031', '031');
-- 047: ready from the previous evening; in service 08:00–12:00; charging 12:00–13:30; ready after.
-- 031: first seen at 20:00 (nothing counted before that), offline.
insert into public.vehicle_status_events (org_id, vehicle_id, from_status, to_status, at, cause_type) values
  ('00000000-0000-0000-0000-00000000a400', '00000000-0000-0000-0000-00000000c401', null, 'ready', '2026-09-01 21:00Z', 'telemetry'),
  ('00000000-0000-0000-0000-00000000a400', '00000000-0000-0000-0000-00000000c401', 'ready', 'in_service', '2026-09-02 08:00Z', 'telemetry'),
  ('00000000-0000-0000-0000-00000000a400', '00000000-0000-0000-0000-00000000c401', 'in_service', 'charging', '2026-09-02 12:00Z', 'telemetry'),
  ('00000000-0000-0000-0000-00000000a400', '00000000-0000-0000-0000-00000000c401', 'charging', 'ready', '2026-09-02 13:30Z', 'telemetry'),
  ('00000000-0000-0000-0000-00000000a400', '00000000-0000-0000-0000-00000000c402', null, 'offline', '2026-09-02 20:00Z', 'telemetry');
insert into public.ledger_entries (org_id, vehicle_id, occurred_on, category, amount_cents, source, source_ref) values
  ('00000000-0000-0000-0000-00000000a400', '00000000-0000-0000-0000-00000000c401', '2026-09-02', 'gross_ride_revenue', 30000, 'simulator', 'r1'),
  ('00000000-0000-0000-0000-00000000a400', '00000000-0000-0000-0000-00000000c401', '2026-09-02', 'gross_ride_revenue', 5000, 'simulator', 'r2'),
  ('00000000-0000-0000-0000-00000000a400', '00000000-0000-0000-0000-00000000c401', '2026-09-02', 'electricity', 600, 'simulator', 'e1');

select app.refresh_vehicle_day_hours('00000000-0000-0000-0000-00000000a400', '2026-09-02');

select results_eq(
  $$ select in_service_h, ready_h, charging_h from public.vehicle_day_hours
     where vehicle_id = '00000000-0000-0000-0000-00000000c401' $$,
  $$ values (4.000::numeric, 10.500::numeric, 1.500::numeric) $$,
  'hours per status are clipped to the 06:00–22:00 service window (ready 06–08 + 13:30–22)'
);
select results_eq(
  $$ select offline_h, ready_h from public.vehicle_day_hours where vehicle_id = '00000000-0000-0000-0000-00000000c402' $$,
  $$ values (2.000::numeric, 0.000::numeric) $$,
  'time before a vehicle''s first known status isn''t counted'
);
select app.refresh_vehicle_day_hours('00000000-0000-0000-0000-00000000a400', '2026-09-02');
select is((select count(*)::int from public.vehicle_day_hours where org_id = '00000000-0000-0000-0000-00000000a400'), 2, 'refreshing a day again replaces its rows');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f401","role":"authenticated"}';
select is((select count(*)::int from public.vehicle_day_hours), 2, 'ops members read hours');
select is(
  (select count(*)::int from public.ledger_vehicle_totals('00000000-0000-0000-0000-00000000a400', '2026-09-01', '2026-09-30')),
  0, 'ops members don''t get money from ledger_vehicle_totals'
);
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f402","role":"authenticated"}';
select results_eq(
  $$ select category, amount_cents from public.ledger_vehicle_totals('00000000-0000-0000-0000-00000000a400', '2026-09-01', '2026-09-30') order by category $$,
  $$ values ('electricity'::text, 600::bigint), ('gross_ride_revenue', 35000) $$,
  'finance gets per-vehicle totals by category'
);

select * from finish();
rollback;
