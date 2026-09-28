begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000fd01', 'finance@r.test'),
  ('00000000-0000-0000-0000-00000000fd02', 'ops@r.test');
insert into public.orgs (id, name, slug) values ('00000000-0000-0000-0000-00000000ad00', 'Report Co', 'report-co-t');
insert into public.memberships (org_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000ad00', '00000000-0000-0000-0000-00000000fd01', 'finance'),
  ('00000000-0000-0000-0000-00000000ad00', '00000000-0000-0000-0000-00000000fd02', 'ops');

select is((select count(*)::int from public.covenants where org_id = '00000000-0000-0000-0000-00000000ad00'), 4,
  'a new org gets the four default covenants');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fd01","role":"authenticated"}';
insert into public.reports (id, org_id, month, version, data) values
  ('00000000-0000-0000-0000-00000000ae01', '00000000-0000-0000-0000-00000000ad00', '2026-08', 0, '{}'),
  ('00000000-0000-0000-0000-00000000ae02', '00000000-0000-0000-0000-00000000ad00', '2026-08', 0, '{}');
select results_eq(
  $$ select version from public.reports where org_id = '00000000-0000-0000-0000-00000000ad00' order by version $$,
  $$ values (1), (2) $$, 'regenerating a month adds the next version'
);
select throws_ok(
  $$ update public.reports set grade = 'A' where id = '00000000-0000-0000-0000-00000000ae01' $$,
  '42501', null, 'snapshots cannot be edited'
);
create temp table share on commit drop as
  select * from public.create_report_share('00000000-0000-0000-0000-00000000ad00', '00000000-0000-0000-0000-00000000ae01', 'Harbor Bank', 30);
select is((select length(token) from share), 48, 'a share returns its raw token once');
select is((select count(*)::int from public.report_shares where token_hash = (select token from share)), 0,
  'only the token hash is stored');
select throws_ok(
  $$ select * from public.create_report_share('00000000-0000-0000-0000-00000000ad00', '00000000-0000-0000-0000-00000000ae01', 'X', 400) $$,
  '22023', null, 'expiry is capped at 365 days'
);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fd02","role":"authenticated"}';
select is((select count(*)::int from public.reports where org_id = '00000000-0000-0000-0000-00000000ad00'), 0,
  'ops cannot see reports (money data)');
select throws_ok(
  $$ select * from public.create_report_share('00000000-0000-0000-0000-00000000ad00', '00000000-0000-0000-0000-00000000ae01', 'X', 3) $$,
  '42501', null, 'ops cannot share reports'
);

reset role;
grant select on share to anon;
select is((select count(*)::int from public.audit_log where action = 'report.share' and org_id = '00000000-0000-0000-0000-00000000ad00'), 1,
  'sharing is audited');
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select is((select recipient from public.shared_report((select token from share))), 'Harbor Bank',
  'a valid link opens the snapshot without signing in');
reset role;

update public.report_shares set revoked_at = now() where token_hash = encode(extensions.digest((select token from share), 'sha256'), 'hex');
set local role anon;
select is((select count(*)::int from public.shared_report((select token from share))), 0, 'a revoked link shows nothing');
reset role;
update public.report_shares set revoked_at = null, expires_at = now() - interval '1 minute'
  where token_hash = encode(extensions.digest((select token from share), 'sha256'), 'hex');
set local role anon;
select is((select count(*)::int from public.shared_report((select token from share))), 0, 'an expired link shows nothing');
reset role;

select * from finish();
rollback;
