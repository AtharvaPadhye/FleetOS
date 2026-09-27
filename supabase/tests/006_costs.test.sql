begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000f201', 'owner@c.test'),
  ('00000000-0000-0000-0000-00000000f202', 'viewer@c.test'),
  ('00000000-0000-0000-0000-00000000f203', 'other@c.test');
insert into public.orgs (id, name, slug) values
  ('00000000-0000-0000-0000-00000000a200', 'Cost Co', 'cost-co-t'),
  ('00000000-0000-0000-0000-00000000b200', 'Other Cost Co', 'other-cost-co-t');
insert into public.memberships (org_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000a200', '00000000-0000-0000-0000-00000000f201', 'owner'),
  ('00000000-0000-0000-0000-00000000a200', '00000000-0000-0000-0000-00000000f202', 'viewer'),
  ('00000000-0000-0000-0000-00000000b200', '00000000-0000-0000-0000-00000000f203', 'owner');
insert into public.vehicles (id, org_id, vin, number) values
  ('00000000-0000-0000-0000-00000000c201', '00000000-0000-0000-0000-00000000a200', '7G2CEHED9RA004047', '047'),
  ('00000000-0000-0000-0000-00000000c202', '00000000-0000-0000-0000-00000000b200', '7G2CEHED5RA004031', '031');
insert into public.charging_sessions (id, org_id, vehicle_id, started_at, ended_at, energy_kwh, cost_cents, source, external_id) values
  ('00000000-0000-0000-0000-00000000d201', '00000000-0000-0000-0000-00000000a200', '00000000-0000-0000-0000-00000000c201',
   '2026-09-01 10:00Z', '2026-09-01 11:00Z', 40, 520, 'simulator', 'S-1'),
  ('00000000-0000-0000-0000-00000000d202', '00000000-0000-0000-0000-00000000b200', '00000000-0000-0000-0000-00000000c202',
   '2026-09-01 10:00Z', '2026-09-01 11:00Z', 40, 520, 'simulator', 'S-1');
insert into public.ledger_entries (org_id, vehicle_id, occurred_on, category, amount_cents, source, source_ref, charging_session_id) values
  ('00000000-0000-0000-0000-00000000a200', '00000000-0000-0000-0000-00000000c201', '2026-09-01', 'electricity', 520, 'simulator', 'charge|S-1', '00000000-0000-0000-0000-00000000d201'),
  ('00000000-0000-0000-0000-00000000a200', '00000000-0000-0000-0000-00000000c201', '2026-09-01', 'gross_ride_revenue', 10000, 'simulator', 'R-1', null),
  ('00000000-0000-0000-0000-00000000a200', '00000000-0000-0000-0000-00000000c201', '2026-09-02', 'insurance', 1620, 'allocation', 'c201|2026-09-02|insurance', null);

-- structure
select throws_ok(
  $$ insert into public.charging_sessions (org_id, vehicle_id, started_at, ended_at, energy_kwh, cost_cents, source, external_id)
     values ('00000000-0000-0000-0000-00000000a200', '00000000-0000-0000-0000-00000000c201', '2026-09-01 12:00Z', '2026-09-01 13:00Z', 1, 1, 'simulator', 'S-1') $$,
  '23505', null, 'a session is recorded once per source'
);
select throws_ok(
  $$ insert into public.ledger_entries (org_id, occurred_on, category, amount_cents, source, source_ref, charging_session_id)
     values ('00000000-0000-0000-0000-00000000a200', '2026-09-01', 'electricity', 1, 'simulator', 'x', '00000000-0000-0000-0000-00000000d202') $$,
  '23503', null, 'a ledger line cannot point at another org''s charging session'
);
select throws_ok(
  $$ insert into public.charging_sessions (org_id, vehicle_id, started_at, ended_at, energy_kwh, cost_cents, source, external_id)
     values ('00000000-0000-0000-0000-00000000a200', '00000000-0000-0000-0000-00000000c201', '2026-09-01 12:00Z', '2026-09-01 11:00Z', 1, 1, 'simulator', 'S-2') $$,
  '23514', null, 'a session cannot end before it starts'
);

-- owner
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f201","role":"authenticated"}';
select is((select count(*)::int from public.charging_sessions), 1, 'members see only their org''s charging sessions');
select throws_ok(
  $$ insert into public.charging_sessions (org_id, vehicle_id, started_at, ended_at, energy_kwh, cost_cents, source, external_id)
     values ('00000000-0000-0000-0000-00000000a200', '00000000-0000-0000-0000-00000000c201', '2026-09-02 10:00Z', '2026-09-02 11:00Z', 1, 1, 'simulator', 'S-3') $$,
  '42501', null, 'users cannot write charging sessions'
);
select results_eq(
  $$ select category, amount_cents, lines from public.ledger_totals('00000000-0000-0000-0000-00000000a200', '2026-09-01', '2026-09-30') order by category $$,
  $$ values ('electricity'::text, 520::bigint, 1::bigint), ('gross_ride_revenue', 10000, 1), ('insurance', 1620, 1) $$,
  'ledger_totals sums each category over the range'
);
select is(
  (select count(*)::int from public.ledger_totals('00000000-0000-0000-0000-00000000a200', '2026-09-02', '2026-09-02')),
  1, 'ledger_totals respects the date range'
);

-- viewer: sees charging, not money
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f202","role":"authenticated"}';
select is((select count(*)::int from public.charging_sessions), 1, 'viewers see charging history');
select is(
  (select count(*)::int from public.ledger_totals('00000000-0000-0000-0000-00000000a200', '2026-09-01', '2026-09-30')),
  0, 'ledger_totals returns nothing to roles without money access'
);

select * from finish();
rollback;
