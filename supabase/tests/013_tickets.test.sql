begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000f901', 'ops@t.test'),
  ('00000000-0000-0000-0000-00000000f902', 'viewer@t.test'),
  ('00000000-0000-0000-0000-00000000f903', 'owner@t.test');
insert into public.orgs (id, name, slug, timezone) values ('00000000-0000-0000-0000-00000000a900', 'Ticket Co', 'ticket-co-t', 'UTC');
insert into public.memberships (org_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000a900', '00000000-0000-0000-0000-00000000f901', 'ops'),
  ('00000000-0000-0000-0000-00000000a900', '00000000-0000-0000-0000-00000000f902', 'viewer'),
  ('00000000-0000-0000-0000-00000000a900', '00000000-0000-0000-0000-00000000f903', 'owner');
insert into public.vehicles (id, org_id, vin, number) values
  ('00000000-0000-0000-0000-00000000c901', '00000000-0000-0000-0000-00000000a900', '7G2CEHED7RA009001', '901');
insert into public.vendors (id, org_id, name, slug, categories) values
  ('00000000-0000-0000-0000-00000000e901', '00000000-0000-0000-0000-00000000a900', 'Clean Co', 'clean-co', '{cleaning}');
insert into public.exceptions (id, org_id, vehicle_id, type, class, severity, title, blocks_service) values
  ('00000000-0000-0000-0000-00000000d901', '00000000-0000-0000-0000-00000000a900', '00000000-0000-0000-0000-00000000c901',
   'cabin_cleanliness', 'cleaning', 'medium', 'Cabin needs cleaning', true);

select is((select count(*)::int from public.sla_policies where org_id = '00000000-0000-0000-0000-00000000a900'), 5,
  'a new org gets an SLA policy per ticket type');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f902","role":"authenticated"}';
select throws_ok(
  $$ select public.ticket_create('00000000-0000-0000-0000-00000000a900', '00000000-0000-0000-0000-00000000c901', 'cleaning') $$,
  '42501', null, 'viewers can''t open tickets'
);
select throws_ok(
  $$ insert into public.tickets (org_id, number, vehicle_id, type) values ('00000000-0000-0000-0000-00000000a900', 'X', '00000000-0000-0000-0000-00000000c901', 'other') $$,
  '42501', null, 'nobody writes tickets directly'
);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f901","role":"authenticated"}';
select public.ticket_create('00000000-0000-0000-0000-00000000a900', '00000000-0000-0000-0000-00000000c901', 'cleaning',
  true, 'Crumbs on the seats', '00000000-0000-0000-0000-00000000d901', '00000000-0000-0000-0000-00000000e901',
  now() + interval '15 minutes', 4500);
select results_eq(
  $$ select number ~ '^SVC-\d{4}-0001$', status, sla_due_at - created_at, vendor_id::text from public.tickets
     where exception_id = '00000000-0000-0000-0000-00000000d901' $$,
  $$ values (true, 'dispatched'::text, interval '60 minutes', '00000000-0000-0000-0000-00000000e901'::text) $$,
  'EX-4: one call numbers the ticket, starts the 60-minute cleaning SLA and dispatches the vendor'
);
select is((select status from public.exceptions where id = '00000000-0000-0000-0000-00000000d901'), 'in_progress',
  'the exception is being handled');
select is((select count(*)::int from public.vendor_jobs where vendor_id = '00000000-0000-0000-0000-00000000e901'), 1,
  'a vendor job records the dispatch');
select throws_ok(
  $$ select public.ticket_create('00000000-0000-0000-0000-00000000a900', '00000000-0000-0000-0000-00000000c901', 'cleaning',
       true, null, '00000000-0000-0000-0000-00000000d901') $$,
  '23505', null, 'one live ticket per exception'
);
select throws_ok(
  $$ select public.ticket_action('00000000-0000-0000-0000-00000000a900', (select id from public.tickets limit 1), 'return-to-service') $$,
  '22023', null, 'can''t return before the service is done'
);
select public.ticket_action('00000000-0000-0000-0000-00000000a900', (select id from public.tickets where exception_id = '00000000-0000-0000-0000-00000000d901'), 'mark-arrived');
select public.ticket_action('00000000-0000-0000-0000-00000000a900', (select id from public.tickets where exception_id = '00000000-0000-0000-0000-00000000d901'),
  'complete', p_cost => 5200);
reset role;
select results_eq(
  $$ select category, amount_cents::int, source from public.ledger_entries
     where source_ref = (select id::text from public.tickets where exception_id = '00000000-0000-0000-0000-00000000d901') $$,
  $$ values ('cleaning'::text, 5200, 'ticket'::text) $$,
  'SV-6: completing posts exactly one ledger line with the actual cost'
);
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f901","role":"authenticated"}';
select public.ticket_action('00000000-0000-0000-0000-00000000a900', (select id from public.tickets where exception_id = '00000000-0000-0000-0000-00000000d901'),
  'complete', p_cost => 4800, p_note => 'Invoice was lower');
reset role;
select results_eq(
  $$ select count(*)::int, sum(amount_cents)::int from public.ledger_entries
     where source_ref = (select id::text from public.tickets where exception_id = '00000000-0000-0000-0000-00000000d901') $$,
  $$ values (1, 4800) $$,
  'correcting the cost adjusts that line, never duplicates it'
);

-- A manual hold blocks returning the car until an owner overrides with a reason.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f901","role":"authenticated"}';
select public.vehicle_pull_from_service('00000000-0000-0000-0000-00000000a900', '00000000-0000-0000-0000-00000000c901', 'Brake noise reported');
select throws_ok(
  $$ select public.ticket_action('00000000-0000-0000-0000-00000000a900', (select id from public.tickets where exception_id = '00000000-0000-0000-0000-00000000d901'), 'return-to-service') $$,
  '22023', null, 'return is refused while something else blocks the car'
);
select throws_ok(
  $$ select public.ticket_action('00000000-0000-0000-0000-00000000a900', (select id from public.tickets where exception_id = '00000000-0000-0000-0000-00000000d901'),
       'return-to-service', p_override => true, p_reason => 'Brakes checked') $$,
  '42501', null, 'ops can''t override'
);
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f903","role":"authenticated"}';
select public.ticket_action('00000000-0000-0000-0000-00000000a900', (select id from public.tickets where exception_id = '00000000-0000-0000-0000-00000000d901'),
  'return-to-service', p_override => true, p_reason => 'Brakes checked by the hub lead');
select is((select status from public.tickets where exception_id = '00000000-0000-0000-0000-00000000d901'), 'returned', 'owners can override');
select is((select count(*)::int from public.vehicle_holds where vehicle_id = '00000000-0000-0000-0000-00000000c901' and released_at is null), 0,
  'the override released the hold');
select is((select status from public.exceptions where id = '00000000-0000-0000-0000-00000000d901'), 'resolved',
  'returning resolves the exception');
select is(
  (select array_agg(type order by at, seq) from public.ticket_events where ticket_id = (select id from public.tickets where exception_id = '00000000-0000-0000-0000-00000000d901')),
  array['created', 'vendor_assigned', 'arrived', 'completed', 'cost_updated', 'returned']::text[],
  'every step is in the activity log'
);
reset role;

-- The engine marks a missed SLA once.
select app.ticket_create('00000000-0000-0000-0000-00000000a900', '00000000-0000-0000-0000-00000000c901', 'other', false,
  'Old ticket', null, null, 'manual', 'system', null, now() - interval '10 hours');
select is(public.engine_sla_sweep('00000000-0000-0000-0000-00000000a900', now()), 1, 'a ticket past its SLA is marked breached');
select is(public.engine_sla_sweep('00000000-0000-0000-0000-00000000a900', now()), 0, 'only once');
select * from finish();
rollback;
