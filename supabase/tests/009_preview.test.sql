begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000f501', 'ops@p.test'),
  ('00000000-0000-0000-0000-00000000f502', 'viewer@p.test'),
  ('00000000-0000-0000-0000-00000000f503', 'other@p.test');
insert into public.orgs (id, name, slug) values
  ('00000000-0000-0000-0000-00000000a500', 'Preview Co', 'preview-co-t'),
  ('00000000-0000-0000-0000-00000000b500', 'Other Preview Co', 'other-preview-co-t');
insert into public.memberships (org_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000a500', '00000000-0000-0000-0000-00000000f501', 'ops'),
  ('00000000-0000-0000-0000-00000000a500', '00000000-0000-0000-0000-00000000f502', 'viewer'),
  ('00000000-0000-0000-0000-00000000b500', '00000000-0000-0000-0000-00000000f503', 'owner');
insert into public.vehicles (id, org_id, vin, number) values
  ('00000000-0000-0000-0000-00000000c501', '00000000-0000-0000-0000-00000000a500', '7G2CEHED9RA004047', '047');
insert into public.cabin_events (org_id, vehicle_id, at, kind, source, external_id) values
  ('00000000-0000-0000-0000-00000000a500', '00000000-0000-0000-0000-00000000c501', now(), 'spill', 'simulator', 'x1');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f502","role":"authenticated"}';
select is((select count(*)::int from public.cabin_events where org_id = '00000000-0000-0000-0000-00000000a500'), 1,
  'members read their org''s cabin events');
select throws_ok(
  $$ insert into public.cabin_events (org_id, vehicle_id, at, kind, source, external_id)
     values ('00000000-0000-0000-0000-00000000a500', '00000000-0000-0000-0000-00000000c501', now(), 'debris', 'manual', 'x2') $$,
  '42501', null, 'users can''t write cabin events (engine only)'
);
select throws_ok(
  $$ insert into public.dispatch_overrides (org_id, vehicle_id, on_network)
     values ('00000000-0000-0000-0000-00000000a500', '00000000-0000-0000-0000-00000000c501', false) $$,
  '42501', null, 'viewers can''t take cars off the network'
);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f501","role":"authenticated"}';
select lives_ok(
  $$ insert into public.dispatch_overrides (org_id, vehicle_id, on_network, updated_by)
     values ('00000000-0000-0000-0000-00000000a500', '00000000-0000-0000-0000-00000000c501', false,
             '00000000-0000-0000-0000-00000000f501') $$,
  'ops can take a car off the network'
);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f503","role":"authenticated"}';
select is((select count(*)::int from public.cabin_events), 0, 'other orgs see no cabin events');
select is((select count(*)::int from public.dispatch_overrides), 0, 'other orgs see no dispatch overrides');

select * from finish();
rollback;
