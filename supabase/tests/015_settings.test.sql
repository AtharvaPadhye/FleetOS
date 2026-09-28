begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000fb01', 'owner@s.test'),
  ('00000000-0000-0000-0000-00000000fb02', 'ops@s.test'),
  ('00000000-0000-0000-0000-00000000fb03', 'newbie@s.test'),
  ('00000000-0000-0000-0000-00000000fb04', 'outsider@s.test');
insert into public.orgs (id, name, slug) values ('00000000-0000-0000-0000-00000000ab00', 'Settings Co', 'settings-co-t');
insert into public.memberships (org_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000ab00', '00000000-0000-0000-0000-00000000fb01', 'owner'),
  ('00000000-0000-0000-0000-00000000ab00', '00000000-0000-0000-0000-00000000fb02', 'ops');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fb01","role":"authenticated"}';
update public.orgs set availability_target = 0.95, auto_dispatch_after_min = 10 where id = '00000000-0000-0000-0000-00000000ab00';
reset role;
select results_eq(
  $$ select action, detail->'availability_target'->>'to' from public.audit_log
     where org_id = '00000000-0000-0000-0000-00000000ab00' and action = 'org.update' $$,
  $$ values ('org.update'::text, '0.950'::text) $$, 'org changes are audited with before and after'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fb02","role":"authenticated"}';
select is((select count(*)::int from public.org_members('00000000-0000-0000-0000-00000000ab00')), 2, 'members see who else is in the org');
select throws_ok(
  $$ select * from public.create_invitation('00000000-0000-0000-0000-00000000ab00', 'newbie@s.test', 'ops') $$,
  '42501', null, 'ops can''t invite'
);
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fb04","role":"authenticated"}';
select is((select count(*)::int from public.org_members('00000000-0000-0000-0000-00000000ab00')), 0, 'outsiders see no members');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fb01","role":"authenticated"}';
select throws_ok(
  $$ select * from public.create_invitation('00000000-0000-0000-0000-00000000ab00', 'ops@s.test', 'viewer') $$,
  '23505', null, 'existing members can''t be invited again'
);
create temp table tok on commit drop as
  select token from public.create_invitation('00000000-0000-0000-0000-00000000ab00', 'Newbie@S.test', 'finance');
select * from public.create_invitation('00000000-0000-0000-0000-00000000ab00', 'newbie@s.test', 'finance');
select is((select count(*)::int from public.invitations where org_id = '00000000-0000-0000-0000-00000000ab00' and accepted_at is null), 1,
  'a new invite replaces the pending one');
select is((select count(*)::int from public.invitations where token_hash = (select token from tok)), 0, 'only the token''s hash is stored');

-- The replaced link no longer works; the newest does (accept as the invitee).
create temp table tok2 on commit drop as
  select token from public.create_invitation('00000000-0000-0000-0000-00000000ab00', 'newbie@s.test', 'finance');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fb03","role":"authenticated"}';
select throws_ok(format('select public.accept_invitation(%L)', (select token from tok)), 'P0002', null, 'a replaced invitation link is dead');
select lives_ok(format('select public.accept_invitation(%L)', (select token from tok2)), 'the current link joins the org');

select * from finish();
rollback;
