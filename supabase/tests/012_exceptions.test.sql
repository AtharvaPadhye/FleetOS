begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000f801', 'ops@x.test'),
  ('00000000-0000-0000-0000-00000000f802', 'viewer@x.test'),
  ('00000000-0000-0000-0000-00000000f803', 'admin@x.test');
insert into public.orgs (id, name, slug) values ('00000000-0000-0000-0000-00000000a800', 'Exc Co', 'exc-co-t');
insert into public.memberships (org_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000a800', '00000000-0000-0000-0000-00000000f801', 'ops'),
  ('00000000-0000-0000-0000-00000000a800', '00000000-0000-0000-0000-00000000f802', 'viewer'),
  ('00000000-0000-0000-0000-00000000a800', '00000000-0000-0000-0000-00000000f803', 'admin');
insert into public.hubs (id, org_id, name, location, radius_m) values
  ('00000000-0000-0000-0000-00000000b800', '00000000-0000-0000-0000-00000000a800', 'Tempe', 'SRID=4326;POINT(-111.94 33.42)', 150);
insert into public.vehicles (id, org_id, vin, number, home_hub_id) values
  ('00000000-0000-0000-0000-00000000c801', '00000000-0000-0000-0000-00000000a800', '7G2CEHED7RA008001', '801', '00000000-0000-0000-0000-00000000b800');
insert into public.vehicle_state_current (vehicle_id, org_id, status, status_since, location) values
  ('00000000-0000-0000-0000-00000000c801', '00000000-0000-0000-0000-00000000a800', 'in_service', now(), 'SRID=4326;POINT(-112.0 33.45)');
-- 20 available hours and $480 of rides over the trailing 28 days → $24/h.
insert into public.vehicle_day_hours (org_id, vehicle_id, day, in_service_h, ready_h) values
  ('00000000-0000-0000-0000-00000000a800', '00000000-0000-0000-0000-00000000c801', current_date - 1, 15, 5);
insert into public.ledger_entries (org_id, vehicle_id, occurred_on, category, amount_cents, source, source_ref) values
  ('00000000-0000-0000-0000-00000000a800', '00000000-0000-0000-0000-00000000c801', current_date - 1, 'gross_ride_revenue', 48000, 'simulator', 't1');

select is((select count(*)::int from public.exception_rules where org_id = '00000000-0000-0000-0000-00000000a800' and is_system),
  jsonb_array_length(app.system_exception_rules()), 'a new org gets every system rule');

-- The engine opens a drive fault, then a retry of the same detection is ignored (PRD EX-2 dedupe).
select is((select count(*)::int from public.engine_apply_exceptions('00000000-0000-0000-0000-00000000a800',
  '[{"vehicle_id":"00000000-0000-0000-0000-00000000c801","rule_key":"drive_fault","dedupe_key":"drive_fault:c801","at":"2026-09-27T10:00:00Z","trigger":{"alert":"X_fault"},"recommended_action":{"label":"Dispatch Shop"}}]', '[]')),
  1, 'the engine opens an exception');
select is((select count(*)::int from public.engine_apply_exceptions('00000000-0000-0000-0000-00000000a800',
  '[{"vehicle_id":"00000000-0000-0000-0000-00000000c801","rule_key":"drive_fault","dedupe_key":"drive_fault:c801","at":"2026-09-27T10:01:00Z","trigger":{},"recommended_action":{"label":"x"}}]', '[]')),
  0, 'the same condition on the same vehicle doesn''t open a duplicate');
select results_eq(
  $$ select class, severity, blocks_service, expected_downtime_min, baseline_rate_cents_per_h, location_name, hub_id::text
     from public.exceptions where dedupe_key = 'drive_fault:c801' $$,
  $$ values ('maintenance'::text, 'high'::text, true, 240, 2400, 'On the road'::text, '00000000-0000-0000-0000-00000000b800'::text) $$,
  'the rule and the database fill class, downtime, baseline rate ($24/h) and place'
);

-- People: viewers read but can't change; ops assign and resolve with a note in the history.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f802","role":"authenticated"}';
select is((select count(*)::int from public.exception_list where org_id = '00000000-0000-0000-0000-00000000a800'), 1, 'viewers see exceptions');
select throws_ok(
  $$ select public.update_exception('00000000-0000-0000-0000-00000000a800', (select id from public.exceptions where dedupe_key = 'drive_fault:c801'), 'resolved') $$,
  'P0002', null, 'viewers can''t change them'
);
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f801","role":"authenticated"}';
select public.update_exception('00000000-0000-0000-0000-00000000a800', (select id from public.exceptions where dedupe_key = 'drive_fault:c801'),
  null, true, '00000000-0000-0000-0000-00000000f801', null);
select is((select status from public.exceptions where dedupe_key = 'drive_fault:c801'), 'assigned', 'setting an owner assigns it');
select public.update_exception('00000000-0000-0000-0000-00000000a800', (select id from public.exceptions where dedupe_key = 'drive_fault:c801'),
  null, true, null, null);
select is((select status from public.exceptions where dedupe_key = 'drive_fault:c801'), 'open', 'unassigning puts it back to open');
select public.update_exception('00000000-0000-0000-0000-00000000a800', (select id from public.exceptions where dedupe_key = 'drive_fault:c801'),
  'dismissed', false, null, 'False alarm, cleared on reboot');
select results_eq(
  $$ select kind, to_status, note, actor_user_id::text from public.exception_events
     where exception_id = (select id from public.exceptions where dedupe_key = 'drive_fault:c801') and kind = 'status' order by id desc limit 1 $$,
  $$ values ('status'::text, 'dismissed'::text, 'False alarm, cleared on reboot'::text, '00000000-0000-0000-0000-00000000f801'::text) $$,
  'every change is in the history with who and why'
);
select throws_ok(
  $$ update public.exceptions set severity = 'low' where org_id = '00000000-0000-0000-0000-00000000a800' $$,
  '42501', null, 'what the engine detected can''t be edited'
);
update public.exception_rules set enabled = false
 where org_id = '00000000-0000-0000-0000-00000000a800' and key = 'drive_fault';
select is((select enabled from public.exception_rules where org_id = '00000000-0000-0000-0000-00000000a800' and key = 'drive_fault'),
  true, 'ops can''t change rules');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f803","role":"authenticated"}';
update public.exception_rules set enabled = false
 where org_id = '00000000-0000-0000-0000-00000000a800' and key = 'stationary_outside_hub';
select is((select enabled from public.exception_rules where org_id = '00000000-0000-0000-0000-00000000a800' and key = 'stationary_outside_hub'),
  false, 'admins can disable a system rule');
delete from public.exception_rules where org_id = '00000000-0000-0000-0000-00000000a800' and key = 'stationary_outside_hub';
select is((select count(*)::int from public.exception_rules where org_id = '00000000-0000-0000-0000-00000000a800' and key = 'stationary_outside_hub'),
  1, 'but not delete it');
reset role;

-- The condition clears: the dismissed exception stays dismissed, and a new occurrence may open again.
select public.engine_apply_exceptions('00000000-0000-0000-0000-00000000a800', '[]',
  '[{"dedupe_key":"drive_fault:c801","at":"2026-09-27T11:00:00Z"}]');
select results_eq(
  $$ select status, cleared_at is not null from public.exceptions where dedupe_key = 'drive_fault:c801' $$,
  $$ values ('dismissed'::text, true) $$, 'clearing keeps a person''s decision'
);
select is((select count(*)::int from public.engine_apply_exceptions('00000000-0000-0000-0000-00000000a800',
  '[{"vehicle_id":"00000000-0000-0000-0000-00000000c801","rule_key":"drive_fault","dedupe_key":"drive_fault:c801","at":"2026-09-27T12:00:00Z","trigger":{},"recommended_action":null}]', '[]')),
  1, 'a new occurrence after the condition cleared opens a new exception');
select public.engine_apply_exceptions('00000000-0000-0000-0000-00000000a800', '[]',
  '[{"dedupe_key":"drive_fault:c801","at":"2026-09-27T12:30:00Z"}]');
select results_eq(
  $$ select status, resolved_at from public.exceptions where dedupe_key = 'drive_fault:c801' and detected_at = '2026-09-27T12:00:00Z' $$,
  $$ values ('resolved'::text, '2026-09-27T12:30:00Z'::timestamptz) $$, 'an open one resolves itself when its rule auto-resolves'
);

select * from finish();
rollback;
