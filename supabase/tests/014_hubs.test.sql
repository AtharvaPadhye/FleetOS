begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000fa01', 'ops@h.test'),
  ('00000000-0000-0000-0000-00000000fa02', 'viewer@h.test');
insert into public.orgs (id, name, slug) values ('00000000-0000-0000-0000-00000000aa00', 'Hub Co', 'hub-co-t');
insert into public.memberships (org_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000aa00', '00000000-0000-0000-0000-00000000fa01', 'ops'),
  ('00000000-0000-0000-0000-00000000aa00', '00000000-0000-0000-0000-00000000fa02', 'viewer');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fa01","role":"authenticated"}';
select lives_ok(
  $$ select public.hub_save('00000000-0000-0000-0000-00000000aa00', null, 'Mesa', null, 33.415, -111.831, 150, 4, 72,
       '{"cleaning":2,"maintenance":0,"parking":1}'::jsonb, null, null) $$,
  'ops can add a hub with chargers and bays'
);
select results_eq(
  $$ select (select count(*) from public.hub_chargers c where c.hub_id = h.id)::int,
            (select count(*) from public.hub_bays b where b.hub_id = h.id and b.kind = 'cleaning')::int
     from public.hubs h where h.name = 'Mesa' $$,
  $$ values (4, 2) $$, 'chargers and bays are created'
);
select public.hub_save('00000000-0000-0000-0000-00000000aa00', (select id from public.hubs where name = 'Mesa'), 'Mesa', 'Main St',
  33.415, -111.831, 150, 2, 150, '{"cleaning":1,"maintenance":0,"parking":1}'::jsonb, null, null);
select results_eq(
  $$ select array_agg(label order by label), min(max_kw)::int from public.hub_chargers
     where hub_id = (select id from public.hubs where name = 'Mesa') $$,
  $$ values (array['C01', 'C02'], 150) $$, 'fewer chargers removes from the end; the power applies to all'
);
select throws_ok(
  $$ select public.hub_save('00000000-0000-0000-0000-00000000aa00', null, 'Mesa East', null, 33.4155, -111.8305, 150, 1, 72,
       '{}'::jsonb, null, null) $$,
  '22023', null, 'overlapping geofences are refused'
);
select throws_ok(
  $$ select public.hub_save('00000000-0000-0000-0000-00000000aa00', (select id from public.hubs where name = 'Mesa'), 'Mesa', null,
       33.415, -111.831, 150, 2, 150, '{}'::jsonb, null, 12.5) $$,
  '42501', null, 'ops can''t change tariffs (owner/admin)'
);
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fa02","role":"authenticated"}';
select throws_ok(
  $$ insert into public.hub_decisions (org_id, hub_id, recommendation_id, kind, title, vehicle_ids, window_from, window_to)
     values ('00000000-0000-0000-0000-00000000aa00', (select id from public.hubs where name = 'Mesa'), 'route:1', 'route', 'x',
             '{}', now(), now() + interval '1 hour') $$,
  '42501', null, 'viewers can''t apply plans'
);
reset role;
select is((select count(*)::int from public.audit_log where target_type = 'hub' and org_id = '00000000-0000-0000-0000-00000000aa00'), 2,
  'hub changes are audited');

-- Visits: arrival opens one, departure closes it.
insert into public.vehicles (id, org_id, vin, number) values
  ('00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-00000000aa00', '7G2CEHED7RA00A001', 'A01');
select public.engine_hub_visits('00000000-0000-0000-0000-00000000aa00',
  jsonb_build_array(jsonb_build_object('vehicle_id', '00000000-0000-0000-0000-00000000ca01',
    'hub_id', (select id from public.hubs where name = 'Mesa'), 'at', '2026-09-27T10:00:00Z')));
select public.engine_hub_visits('00000000-0000-0000-0000-00000000aa00',
  jsonb_build_array(jsonb_build_object('vehicle_id', '00000000-0000-0000-0000-00000000ca01', 'hub_id', null, 'at', '2026-09-27T10:25:00Z')));
select results_eq(
  $$ select departed_at - arrived_at from public.hub_visits where vehicle_id = '00000000-0000-0000-0000-00000000ca01' $$,
  $$ values (interval '25 minutes') $$, 'a visit records arrival and departure'
);
select is((select count(*)::int from public.hub_visits where vehicle_id = '00000000-0000-0000-0000-00000000ca01' and departed_at is null), 0, 'no visit left open');

select * from finish();
rollback;
