-- Tenancy isolation and roles (NFR TEN-1, TEN-4, RBAC-1/2, SEC-10). Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

-- ---------- every table has RLS (TEN-1) ----------
select is_empty(
  $$ select tablename from pg_tables where schemaname = 'public' and not rowsecurity $$,
  'every table in public has row-level security enabled'
);

-- ---------- fixtures (as postgres) ----------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@atlas.test'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@other.test'),
  ('00000000-0000-0000-0000-00000000000c', 'carol@atlas.test');

select is(
  (select count(*)::int from public.profiles where user_id in (
    '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000c')),
  3, 'a profile is created for each new user'
);

-- ---------- alice and bob each create an org ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
select lives_ok($$ select public.create_org('Atlas Mobility', 'atlas') $$, 'alice creates Atlas and becomes owner');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';
select lives_ok($$ select public.create_org('Other Fleet', 'other') $$, 'bob creates Other Fleet');
select is((select count(*)::int from public.orgs), 1, 'bob sees only his own org');
select is((select count(*)::int from public.memberships), 1, 'bob sees only memberships of his org');

-- ---------- alice ----------
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
select results_eq($$ select slug from public.orgs $$, array['atlas'], 'alice sees only Atlas');
select is(
  (select role::text from public.memberships where user_id = '00000000-0000-0000-0000-00000000000a'),
  'owner', 'the creator is the owner'
);
select is(
  (select count(*)::int from public.orgs where slug = 'other'), 0,
  'alice cannot read Other Fleet even by slug (404, not 403)'
);
-- Direct attempt with bob's real org id (looked up as postgres below) is covered by the next block.
select lives_ok(
  $$ insert into public.memberships (org_id, user_id, role)
     select id, '00000000-0000-0000-0000-00000000000c', 'viewer' from public.orgs where slug = 'atlas' $$,
  'owner adds carol to Atlas as viewer'
);
select throws_ok(
  $$ update public.memberships set role = 'viewer' where user_id = '00000000-0000-0000-0000-00000000000a' $$,
  'P0001', 'An organization must keep at least one owner', 'the last owner cannot be demoted'
);
select throws_ok(
  $$ delete from public.memberships where user_id = '00000000-0000-0000-0000-00000000000a' $$,
  'P0001', 'An organization must keep at least one owner', 'the last owner cannot leave'
);
select ok(
  (select count(*) from public.audit_log where action like 'membership.%') >= 2,
  'membership changes are audited and visible to the owner'
);

-- ---------- cross-org write with a known foreign id ----------
reset role;
create temp table ids as select id, slug from public.orgs;
grant select on ids to authenticated;
set local role authenticated;
select throws_ok(
  $$ insert into public.memberships (org_id, user_id, role)
     select id, '00000000-0000-0000-0000-00000000000a', 'owner' from ids where slug = 'other' $$,
  '42501', null, 'alice cannot add herself to Other Fleet'
);
update public.orgs set name = 'Hacked' where id = (select id from ids where slug = 'other'); -- silently affects 0 rows under RLS

-- ---------- carol (viewer) ----------
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}';
select results_eq($$ select slug from public.orgs $$, array['atlas'], 'carol sees Atlas');
update public.orgs set name = 'Renamed'; -- silently affects 0 rows under RLS
select throws_ok(
  $$ insert into public.memberships (org_id, user_id, role)
     select id, '00000000-0000-0000-0000-00000000000b', 'admin' from ids where slug = 'atlas' $$,
  '42501', null, 'a viewer cannot add members'
);
select is((select count(*)::int from public.audit_log), 0, 'a viewer cannot read the audit log');
select is(
  (select count(*)::int from public.profiles where user_id = '00000000-0000-0000-0000-00000000000b'),
  0, 'carol cannot see profiles of people outside her orgs'
);

-- ---------- invitations ----------
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
select lives_ok(
  $$ insert into public.invitations (org_id, email, role, token_hash)
     select id, 'dave@atlas.test', 'ops', encode(extensions.digest('invite-token-1', 'sha256'), 'hex') from ids where slug = 'atlas' $$,
  'owner invites dave as ops'
);
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';
select throws_ok(
  $$ select public.accept_invitation('invite-token-1') $$,
  '42501', 'This invitation was sent to a different email address', 'an invitation only works for its email'
);

-- ---------- verify the silent updates did nothing (as postgres) ----------
reset role;
select is((select name from public.orgs where slug = 'other'), 'Other Fleet', 'alice could not rename Other Fleet');
select is((select name from public.orgs where slug = 'atlas'), 'Atlas Mobility', 'a viewer could not rename Atlas');

-- ---------- anonymous ----------
reset role;
set local role anon;
select throws_ok($$ select * from public.orgs $$, '42501', null, 'anonymous users cannot read orgs');

select * from finish();
rollback;
