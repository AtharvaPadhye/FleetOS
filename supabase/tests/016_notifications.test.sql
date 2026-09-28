begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000fc01', 'owner@n.test'),
  ('00000000-0000-0000-0000-00000000fc02', 'finance@n.test');
insert into public.orgs (id, name, slug) values ('00000000-0000-0000-0000-00000000ac00', 'Notify Co', 'notify-co-t');
insert into public.memberships (org_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000ac00', '00000000-0000-0000-0000-00000000fc01', 'owner'),
  ('00000000-0000-0000-0000-00000000ac00', '00000000-0000-0000-0000-00000000fc02', 'finance');
insert into public.vehicles (id, org_id, vin, number) values
  ('00000000-0000-0000-0000-00000000cc01', '00000000-0000-0000-0000-00000000ac00', '7G2CEHED7RA00C001', 'C01');

insert into public.exceptions (org_id, vehicle_id, type, class, severity, title)
values ('00000000-0000-0000-0000-00000000ac00', '00000000-0000-0000-0000-00000000cc01', 'x', 'incident', 'critical', 'Immobilized');
select results_eq(
  $$ select user_id::text, in_app, title from public.notifications where org_id = '00000000-0000-0000-0000-00000000ac00' $$,
  $$ values ('00000000-0000-0000-0000-00000000fc01'::text, true, 'Car C01: Immobilized'::text) $$,
  'a new exception notifies the people who handle exceptions (not finance)'
);
select is((select count(*)::int from public.notification_deliveries where org_id = '00000000-0000-0000-0000-00000000ac00' and channel = 'email'), 1,
  'critical is emailed by default');

insert into public.exceptions (org_id, vehicle_id, type, class, severity, title)
values ('00000000-0000-0000-0000-00000000ac00', '00000000-0000-0000-0000-00000000cc01', 'y', 'other', 'medium', 'Minor');
select is((select in_app from public.notifications where title = 'Car C01: Minor'), false, 'medium stays out of the bell by default');

insert into public.notification_settings (org_id, user_id, by_severity) values
  ('00000000-0000-0000-0000-00000000ac00', '00000000-0000-0000-0000-00000000fc01',
   '{"critical":{"in_app":true,"email":false},"medium":{"in_app":true,"email":false}}');
insert into public.exceptions (org_id, vehicle_id, type, class, severity, title)
values ('00000000-0000-0000-0000-00000000ac00', '00000000-0000-0000-0000-00000000cc01', 'z', 'other', 'medium', 'Minor 2');
select is((select in_app from public.notifications where title = 'Car C01: Minor 2'), true, 'preferences decide the bell');

insert into public.org_integrations (org_id, slack_webhook_url) values ('00000000-0000-0000-0000-00000000ac00', 'https://hooks.slack.com/services/x');
insert into public.exceptions (org_id, vehicle_id, type, class, severity, title)
values ('00000000-0000-0000-0000-00000000ac00', '00000000-0000-0000-0000-00000000cc01', 'w', 'incident', 'critical', 'Another');
select results_eq(
  $$ select channel from public.notification_deliveries where subject = 'Car C01: Another' order by channel $$,
  $$ values ('slack'::text) $$, 'Slack gets critical once for the org; email follows the owner''s new preference (off)'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fc02","role":"authenticated"}';
select is((select count(*)::int from public.notifications where org_id = '00000000-0000-0000-0000-00000000ac00'), 0, 'people only see their own notifications');
select is((select count(*)::int from public.org_integrations where org_id = '00000000-0000-0000-0000-00000000ac00'), 0, 'the Slack webhook is hidden from non-admins');
reset role;

select * from finish();
rollback;
