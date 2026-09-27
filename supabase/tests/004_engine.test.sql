begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e1', 'eve@demo.test');
insert into public.orgs (id, name, slug, is_demo) values ('00000000-0000-0000-0000-0000000000e0', 'Demo', 'demo-engine-t', true);
insert into public.memberships (org_id, user_id, role) values ('00000000-0000-0000-0000-0000000000e0', '00000000-0000-0000-0000-0000000000e1', 'owner');
insert into public.simulator_state (org_id, seed, started_at, last_tick_at, snapshot)
values ('00000000-0000-0000-0000-0000000000e0', 42, now(), now(), '{"world":{}}');
insert into public.engine_runs (org_id, last_tick_at) values ('00000000-0000-0000-0000-0000000000e0', now());

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select throws_ok($$ select * from public.simulator_state $$, '42501', null, 'even an owner cannot read simulator internals');
select is((select count(*)::int from public.engine_runs), 1, 'members can see when their data was last refreshed');
select throws_ok($$ update public.engine_runs set last_tick_at = now() $$, '42501', null, 'users cannot fake a refresh');
reset role;
select ok(
  exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'vehicle_state_current'),
  'live vehicle state is published for realtime updates'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select throws_ok($$ select * from public.engine_live_state('00000000-0000-0000-0000-0000000000e0') $$, '42501', null, 'users cannot call engine readers');
reset role;
select is((select count(*)::int from public.engine_hubs('00000000-0000-0000-0000-0000000000e0')), 0, 'engine readers work for the server');

select * from finish();
rollback;
