begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000f101', 'owner@m.test'),
  ('00000000-0000-0000-0000-00000000f102', 'fin@m.test'),
  ('00000000-0000-0000-0000-00000000f103', 'ops@m.test'),
  ('00000000-0000-0000-0000-00000000f104', 'other@m.test');
insert into public.orgs (id, name, slug) values
  ('00000000-0000-0000-0000-00000000a100', 'Money Co', 'money-co-t'),
  ('00000000-0000-0000-0000-00000000b100', 'Other Co', 'other-co-t');
insert into public.memberships (org_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000a100', '00000000-0000-0000-0000-00000000f101', 'owner'),
  ('00000000-0000-0000-0000-00000000a100', '00000000-0000-0000-0000-00000000f102', 'finance'),
  ('00000000-0000-0000-0000-00000000a100', '00000000-0000-0000-0000-00000000f103', 'ops'),
  ('00000000-0000-0000-0000-00000000b100', '00000000-0000-0000-0000-00000000f104', 'owner');
insert into public.vehicles (id, org_id, vin, number) values
  ('00000000-0000-0000-0000-00000000c100', '00000000-0000-0000-0000-00000000a100', '7G2CEHED9RA004047', '047'),
  ('00000000-0000-0000-0000-00000000c200', '00000000-0000-0000-0000-00000000b100', '7G2CEHED5RA004031', '031');
insert into public.ledger_entries (org_id, vehicle_id, occurred_on, category, amount_cents, source, source_ref) values
  ('00000000-0000-0000-0000-00000000a100', '00000000-0000-0000-0000-00000000c100', '2026-09-01', 'gross_ride_revenue', 794000, 'simulator', 'SIM-1');
insert into public.rides (org_id, vehicle_id, external_id, started_at, ended_at, distance_m, fare_cents, source) values
  ('00000000-0000-0000-0000-00000000a100', '00000000-0000-0000-0000-00000000c100', 'SIM-1', now() - interval '20 min', now(), 8000, 1850, 'simulator');

-- structure
select throws_ok(
  $$ insert into public.ledger_entries (org_id, vehicle_id, occurred_on, category, amount_cents, source, source_ref)
     values ('00000000-0000-0000-0000-00000000a100', '00000000-0000-0000-0000-00000000c100', '2026-09-01', 'gross_ride_revenue', 1, 'simulator', 'SIM-1') $$,
  '23505', null, 'the same source line cannot be booked twice'
);
select throws_ok(
  $$ insert into public.ledger_entries (org_id, vehicle_id, occurred_on, category, amount_cents, source)
     values ('00000000-0000-0000-0000-00000000a100', '00000000-0000-0000-0000-00000000c200', '2026-09-01', 'cleaning', 100, 'manual') $$,
  '23503', null, 'a ledger line cannot point at another org''s vehicle'
);
select throws_ok(
  $$ insert into public.ledger_entries (org_id, occurred_on, category, amount_cents, source)
     values ('00000000-0000-0000-0000-00000000a100', '2026-09-01', 'cleaning', -5, 'manual') $$,
  '23514', null, 'amounts are never negative (sign comes from the category)'
);

-- finance
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f102","role":"authenticated"}';
select is((select count(*)::int from public.ledger_entries), 1, 'finance reads the ledger');
select lives_ok(
  $$ insert into public.ledger_entries (org_id, occurred_on, category, amount_cents, source, source_ref, created_by)
     values ('00000000-0000-0000-0000-00000000a100', '2026-09-01', 'gross_ride_revenue', 10000, 'csv', '2026-09-01|x|gross', '00000000-0000-0000-0000-00000000f102') $$,
  'finance can book an imported line'
);
select throws_ok(
  $$ insert into public.ledger_entries (org_id, occurred_on, category, amount_cents, source)
     values ('00000000-0000-0000-0000-00000000a100', '2026-09-01', 'electricity', 100, 'simulator') $$,
  '42501', null, 'users cannot write engine-sourced lines'
);
select throws_ok(
  $$ update public.ledger_entries set amount_cents = 0 $$,
  '42501', null, 'ledger lines are never edited in place'
);

-- ops
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f103","role":"authenticated"}';
select is((select count(*)::int from public.ledger_entries), 0, 'ops cannot read money');
select is((select count(*)::int from public.rides), 1, 'ops can see rides');

-- other org
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f104","role":"authenticated"}';
select is((select count(*)::int from public.ledger_entries), 0, 'another org''s owner sees none of this ledger');
select is((select count(*)::int from public.rides), 0, 'another org''s owner sees none of these rides');

select * from finish();
rollback;
