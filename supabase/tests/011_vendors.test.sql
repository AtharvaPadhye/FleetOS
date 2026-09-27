begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000f701', 'ops@v.test'),
  ('00000000-0000-0000-0000-00000000f702', 'viewer@v.test');
insert into public.orgs (id, name, slug) values ('00000000-0000-0000-0000-00000000a700', 'Vendor Co', 'vendor-co-t');
insert into public.memberships (org_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000a700', '00000000-0000-0000-0000-00000000f701', 'ops'),
  ('00000000-0000-0000-0000-00000000a700', '00000000-0000-0000-0000-00000000f702', 'viewer');
-- Radius vendor: 5 km around downtown Phoenix. Polygon vendor: a box over Tempe only.
insert into public.vendors (id, org_id, name, slug, categories, base_location, service_radius_m, service_area) values
  ('00000000-0000-0000-0000-00000000e701', '00000000-0000-0000-0000-00000000a700', 'Radius Clean', 'radius-clean', '{cleaning}',
   'SRID=4326;POINT(-112.074 33.448)', 5000, null),
  ('00000000-0000-0000-0000-00000000e702', '00000000-0000-0000-0000-00000000a700', 'Tempe Box Clean', 'tempe-box', '{cleaning}',
   null, null, 'SRID=4326;POLYGON((-111.97 33.40,-111.90 33.40,-111.90 33.45,-111.97 33.45,-111.97 33.40))');

select results_eq(
  $$ select vendor_id from public.vendors_covering('00000000-0000-0000-0000-00000000a700', 33.45, -112.07, 'cleaning') $$,
  $$ values ('00000000-0000-0000-0000-00000000e701'::uuid) $$,
  'a point downtown is covered by the radius vendor only'
);
select results_eq(
  $$ select vendor_id from public.vendors_covering('00000000-0000-0000-0000-00000000a700', 33.42, -111.94, 'cleaning') $$,
  $$ values ('00000000-0000-0000-0000-00000000e702'::uuid) $$,
  'a point in Tempe is covered by the polygon vendor only'
);
select is(
  (select count(*)::int from public.vendors_covering('00000000-0000-0000-0000-00000000a700', 33.45, -112.07, 'towing')),
  0, 'other categories are not candidates'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f702","role":"authenticated"}';
select is((select count(*)::int from public.vendor_list where org_id = '00000000-0000-0000-0000-00000000a700'), 2, 'viewers read the directory');
select throws_ok(
  $$ insert into public.vendors (org_id, name, slug, categories) values ('00000000-0000-0000-0000-00000000a700', 'X', 'x', '{towing}') $$,
  '42501', null, 'viewers can''t add vendors'
);
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f701","role":"authenticated"}';
select lives_ok(
  $$ insert into public.vendors (org_id, name, slug, categories) values ('00000000-0000-0000-0000-00000000a700', 'Tow Co', 'tow-co', '{towing}') $$,
  'ops can add vendors'
);

select * from finish();
rollback;
