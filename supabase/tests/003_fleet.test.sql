-- Fleet, hubs and telemetry tables (task 3.2): isolation, roles, cross-org references, engine-only writes,
-- location privacy and partition maintenance.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

-- ---------- fixtures (as postgres) ----------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'olga@alpha.test'),   -- owner of Alpha
  ('00000000-0000-0000-0000-0000000000f2', 'fin@alpha.test'),    -- finance in Alpha
  ('00000000-0000-0000-0000-0000000000f3', 'vic@alpha.test'),    -- viewer in Alpha
  ('00000000-0000-0000-0000-0000000000f4', 'otto@beta.test');    -- owner of Beta
insert into public.orgs (id, name, slug) values
  ('00000000-0000-0000-0000-0000000000a1', 'Alpha Fleet', 'alpha-fleet-t'),
  ('00000000-0000-0000-0000-0000000000b1', 'Beta Fleet', 'beta-fleet-t');
insert into public.memberships (org_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f1', 'owner'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f2', 'finance'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f3', 'viewer'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000f4', 'owner');
insert into public.hubs (id, org_id, name, location) values
  ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-0000000000a1', 'Alpha Downtown',
   extensions.st_geogfromtext('SRID=4326;POINT(-112.074 33.4484)')),
  ('00000000-0000-0000-0000-00000000bb01', '00000000-0000-0000-0000-0000000000b1', 'Beta Tempe',
   extensions.st_geogfromtext('SRID=4326;POINT(-111.94 33.4255)'));
insert into public.vehicles (id, org_id, vin, number, home_hub_id) values
  ('00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-0000000000a1', '7G2CEHED8RA004047', '047',
   '00000000-0000-0000-0000-00000000aa01'),
  ('00000000-0000-0000-0000-00000000cb01', '00000000-0000-0000-0000-0000000000b1', '7G2CEHED1RA004031', '031',
   '00000000-0000-0000-0000-00000000bb01');
insert into public.vehicle_state_current (vehicle_id, org_id, status, status_since, soc, location, connectivity) values
  ('00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-0000000000a1', 'cleaning', now(), 0.72,
   extensions.st_geogfromtext('SRID=4326;POINT(-112.07 33.46)'), 'online');
insert into public.telemetry_samples (org_id, vehicle_id, field, ts, value_num) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000ca01', 'Soc', now(), 72);

-- ---------- structural guarantees (as postgres) ----------
select throws_ok(
  $$ insert into public.hub_chargers (org_id, hub_id, label, max_kw)
     values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000bb01', 'C1', 72) $$,
  '23503', null, 'a charger cannot point at another org''s hub'
);
select throws_ok(
  $$ insert into public.vehicles (org_id, vin, number, home_hub_id)
     values ('00000000-0000-0000-0000-0000000000a1', '7G2CEHED1RA004099', '099', '00000000-0000-0000-0000-00000000bb01') $$,
  '23503', null, 'a vehicle cannot use another org''s hub as home'
);
select throws_ok(
  $$ insert into public.vehicles (org_id, vin, number) values ('00000000-0000-0000-0000-0000000000a1', 'NOT-A-VIN', '100') $$,
  '23514', null, 'VIN format is checked'
);
select throws_ok(
  $$ insert into public.vehicles (org_id, vin, number) values ('00000000-0000-0000-0000-0000000000a1', '7G2CEHED1RA004100', '047') $$,
  '23505', null, 'vehicle numbers are unique within an org'
);
select lives_ok(
  $$ insert into public.vehicles (org_id, vin, number) values ('00000000-0000-0000-0000-0000000000b1', '7G2CEHED1RA004101', '047') $$,
  'the same vehicle number is fine in a different org'
);
select is(
  (select count(*)::int from pg_catalog.pg_inherits i join pg_catalog.pg_class p on p.oid = i.inhparent
   where p.relname = 'telemetry_samples'),
  9, 'daily telemetry partitions exist from yesterday to a week ahead'
);
select is(app.ensure_telemetry_partitions(current_date, 3), 0, 'creating partitions is idempotent');
select is(app.ensure_telemetry_partitions(current_date - 40, 2), 2, 'old partitions can be created (backfill)');
select is(app.drop_old_telemetry_partitions(30), 2, 'partitions older than 30 days are dropped');
select ok(
  exists (select 1 from cron.job where jobname = 'telemetry-partitions'),
  'partition maintenance is scheduled daily with pg_cron'
);

-- ---------- owner of Alpha ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select results_eq($$ select number from public.vehicles order by number $$, array['047'], 'the owner sees only Alpha''s vehicles');
select is((select count(*)::int from public.hubs), 1, 'the owner sees only Alpha''s hubs');
select lives_ok(
  $$ insert into public.hub_chargers (org_id, hub_id, label, max_kw)
     values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000aa01', 'C1', 72) $$,
  'the owner adds a charger to Alpha''s hub'
);
select throws_ok(
  $$ insert into public.vehicle_state_current (vehicle_id, org_id, status, status_since)
     values ('00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-0000000000a1', 'ready', now()) $$,
  '42501', null, 'even owners cannot write live state (engine only)'
);
select is((select count(*)::int from public.telemetry_samples), 1, 'owner can read raw telemetry');

-- ---------- finance in Alpha ----------
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}';
select is((select count(*)::int from public.vehicle_state_current), 1, 'finance sees live state');
select is((select count(*)::int from public.telemetry_samples), 0, 'finance cannot read raw location history (PRV-2)');

-- ---------- viewer in Alpha ----------
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f3","role":"authenticated"}';
select throws_ok(
  $$ insert into public.vehicle_holds (org_id, vehicle_id, reason)
     values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000ca01', 'Checking brakes') $$,
  '42501', null, 'a viewer cannot pull a vehicle from service'
);

-- ---------- owner of Beta ----------
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f4","role":"authenticated"}';
select is(
  (select count(*)::int from public.vehicle_state_current), 0,
  'Beta''s owner cannot see Alpha''s live state'
);
select is(
  (select count(*)::int from public.telemetry_samples), 0,
  'Beta''s owner cannot see Alpha''s telemetry'
);

select * from finish();
rollback;
