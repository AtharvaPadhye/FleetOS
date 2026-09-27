begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d1', 'dana@fleet.test');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}';

select is(
  (select city from public.create_org('Desert Fleet', 'desert', 'America/Phoenix', 'Phoenix, AZ')),
  'Phoenix, AZ', 'create_org stores the city'
);
select throws_ok(
  $$ select public.create_org('Bad TZ', 'bad-tz', 'Mars/Olympus') $$,
  '22023', 'Unknown time zone: Mars/Olympus', 'create_org rejects unknown time zones'
);
select throws_ok(
  $$ select public.create_org('Dupe', 'desert') $$,
  '23505', null, 'org slugs are unique'
);
reset role;
set local role anon;
select throws_ok($$ select public.create_org('Anon', 'anon-org') $$, '42501', null, 'anonymous users cannot create orgs');

select * from finish();
rollback;
