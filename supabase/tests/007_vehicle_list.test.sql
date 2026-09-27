begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000f301', 'a@vl.test'),
  ('00000000-0000-0000-0000-00000000f302', 'b@vl.test');
insert into public.orgs (id, name, slug) values
  ('00000000-0000-0000-0000-00000000a300', 'List Co', 'list-co-t'),
  ('00000000-0000-0000-0000-00000000b300', 'Other List Co', 'other-list-co-t');
insert into public.memberships (org_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000a300', '00000000-0000-0000-0000-00000000f301', 'viewer'),
  ('00000000-0000-0000-0000-00000000b300', '00000000-0000-0000-0000-00000000f302', 'owner');
insert into public.vehicles (id, org_id, vin, number) values
  ('00000000-0000-0000-0000-00000000c301', '00000000-0000-0000-0000-00000000a300', '7G2CEHED9RA004047', '047'),
  ('00000000-0000-0000-0000-00000000c302', '00000000-0000-0000-0000-00000000b300', '7G2CEHED5RA004031', '031');
insert into public.vehicle_state_current (vehicle_id, org_id, status, status_since, soc, connectivity, location) values
  ('00000000-0000-0000-0000-00000000c301', '00000000-0000-0000-0000-00000000a300', 'charging', now(), 0.5, 'online',
   'SRID=4326;POINT(-112.07 33.45)');

select is(
  (select c.relname from pg_class c where c.relname = 'vehicle_list' and 'security_invoker=true' = any(c.reloptions)),
  'vehicle_list', 'vehicle_list runs with the caller''s permissions'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f301","role":"authenticated"}';
select is((select count(*)::int from public.vehicle_list), 1, 'members see only their own org''s vehicles');
select results_eq(
  $$ select status::text, round(lat::numeric, 2), round(lng::numeric, 2) from public.vehicle_list $$,
  $$ values ('charging', 33.45, -112.07) $$,
  'live state and location are flattened onto the row'
);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f302","role":"authenticated"}';
select results_eq(
  $$ select number, status::text, connectivity from public.vehicle_list $$,
  $$ values ('031'::text, 'offline'::text, 'offline'::text) $$,
  'a car the engine has never seen is offline'
);

select * from finish();
rollback;
