-- Exceptions engine (task 5.4, PRD EX-1..5, erd.md §3.5). Rules are data evaluated by the engine tick
-- (packages/engine evaluateRules); an exception stays unique per rule and vehicle while its condition holds.
-- Blocking exceptions drive the Incident / Maintenance / Cleaning statuses (vehicle-states.md §3).

create table public.exception_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9_]{1,60}$'),
  name text not null check (length(trim(name)) between 1 and 80),
  condition jsonb not null check (jsonb_typeof(condition) = 'object'),
  class text not null check (class in ('incident', 'maintenance', 'cleaning', 'charging', 'other')),
  severity text not null check (severity in ('critical', 'high', 'medium', 'low')),
  blocks_service boolean not null default false,
  recommended_action jsonb not null default '{}'::jsonb check (jsonb_typeof(recommended_action) = 'object'),
  auto_actions jsonb not null default '{}'::jsonb check (jsonb_typeof(auto_actions) = 'object'),
  auto_resolve boolean not null default true,
  -- Preview capability the triggering data needs (PRD EX-2); the tick skips the rule when it's unavailable.
  capability text check (capability in ('cabin_events', 'autonomy_events')),
  enabled boolean not null default true,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, key),
  unique (org_id, id)
);
create trigger exception_rules_updated_at before update on public.exception_rules
  for each row execute function app.set_updated_at();

alter table public.exception_rules enable row level security;
create policy exception_rules_select on public.exception_rules for select to authenticated
  using (org_id in (select app.user_org_ids()));
create policy exception_rules_insert on public.exception_rules for insert to authenticated
  with check (app.has_role(org_id, array['owner', 'admin']::public.app_role[]) and not is_system);
create policy exception_rules_update on public.exception_rules for update to authenticated
  using (app.has_role(org_id, array['owner', 'admin']::public.app_role[]))
  with check (app.has_role(org_id, array['owner', 'admin']::public.app_role[]));
-- System rules can be disabled, never deleted (flows.md EX-5).
create policy exception_rules_delete on public.exception_rules for delete to authenticated
  using (app.has_role(org_id, array['owner', 'admin']::public.app_role[]) and not is_system);
revoke all on public.exception_rules from anon;

-- Keys and system flags are fixed once created: edits change behaviour, not identity.
create function app.protect_exception_rule() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.key <> old.key or new.is_system <> old.is_system then
    raise exception 'A rule''s key and system flag can''t change' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger exception_rules_protect before update on public.exception_rules
  for each row execute function app.protect_exception_rule();

-- Every rule change is audited (flows.md EX-5).
create function app.audit_exception_rule() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_log (org_id, actor_id, action, target_type, target_id, detail)
  values (
    coalesce(new.org_id, old.org_id), (select auth.uid()), 'exception_rule.' || lower(tg_op), 'exception_rule',
    coalesce(new.id, old.id)::text,
    jsonb_build_object('key', coalesce(new.key, old.key), 'before', to_jsonb(old), 'after', to_jsonb(new))
  );
  return null;
end $$;
create trigger exception_rules_audit after insert or update or delete on public.exception_rules
  for each row execute function app.audit_exception_rule();

-- System rules, kept identical to packages/domain SYSTEM_RULES (apps/web system-rules.test.ts checks it).
-- BEGIN SYSTEM RULES
create function app.system_exception_rules() returns jsonb language sql immutable set search_path = '' as $rules$
select $json$
[
  {
    "key": "vehicle_immobilized",
    "name": "Vehicle immobilized",
    "condition": {
      "any": [
        {
          "field": "alert",
          "op": "matches",
          "value": "immobiliz|towing"
        }
      ]
    },
    "class": "incident",
    "severity": "critical",
    "blocks_service": true,
    "recommended_action": {
      "label": "Dispatch a tow",
      "vendor_category": "towing",
      "expected_downtime_min": 330
    },
    "auto_actions": {},
    "auto_resolve": true,
    "capability": null
  },
  {
    "key": "tyre_pressure_low",
    "name": "Tyre pressure low",
    "condition": {
      "any": [
        {
          "field": "alert",
          "op": "matches",
          "value": "tirePressure|tyre"
        },
        {
          "field": "tpms_min_bar",
          "op": "lt",
          "value": 2.2
        }
      ]
    },
    "class": "incident",
    "severity": "high",
    "blocks_service": true,
    "recommended_action": {
      "label": "Dispatch roadside tyre service",
      "vendor_category": "tyres",
      "expected_downtime_min": 90
    },
    "auto_actions": {},
    "auto_resolve": true,
    "capability": null
  },
  {
    "key": "drive_fault",
    "name": "Drive or battery fault",
    "condition": {
      "any": [
        {
          "field": "alert",
          "op": "matches",
          "value": "fault|inverter|isolation|bms_"
        }
      ]
    },
    "class": "maintenance",
    "severity": "high",
    "blocks_service": true,
    "recommended_action": {
      "label": "Book diagnostics",
      "vendor_category": "maintenance",
      "expected_downtime_min": 240
    },
    "auto_actions": {},
    "auto_resolve": true,
    "capability": null
  },
  {
    "key": "cabin_cleanliness",
    "name": "Cabin needs cleaning",
    "condition": {
      "any": [
        {
          "field": "alert",
          "op": "matches",
          "value": "cabin|clean"
        }
      ]
    },
    "class": "cleaning",
    "severity": "medium",
    "blocks_service": true,
    "recommended_action": {
      "label": "Dispatch cleaning",
      "vendor_category": "cleaning",
      "expected_downtime_min": 45
    },
    "auto_actions": {},
    "auto_resolve": true,
    "capability": "cabin_events"
  },
  {
    "key": "low_battery",
    "name": "Battery critically low",
    "condition": {
      "all": [
        {
          "field": "soc_pct",
          "op": "lt",
          "value": 15
        },
        {
          "field": "charging",
          "op": "eq",
          "value": false
        }
      ],
      "for_min": 2
    },
    "class": "charging",
    "severity": "medium",
    "blocks_service": false,
    "recommended_action": {
      "label": "Send to the nearest hub to charge",
      "expected_downtime_min": 60
    },
    "auto_actions": {},
    "auto_resolve": true,
    "capability": null
  },
  {
    "key": "no_telemetry",
    "name": "No data from vehicle",
    "condition": {
      "all": [
        {
          "field": "telemetry_age_min",
          "op": "gt",
          "value": 30
        }
      ]
    },
    "class": "other",
    "severity": "high",
    "blocks_service": false,
    "recommended_action": {
      "label": "Check connectivity; send someone if it stays dark",
      "expected_downtime_min": 60
    },
    "auto_actions": {},
    "auto_resolve": true,
    "capability": null
  },
  {
    "key": "stationary_outside_hub",
    "name": "Stopped outside a hub",
    "condition": {
      "all": [
        {
          "field": "speed_mph",
          "op": "lt",
          "value": 1
        },
        {
          "field": "inside_hub",
          "op": "eq",
          "value": false
        },
        {
          "field": "charging",
          "op": "eq",
          "value": false
        }
      ],
      "for_min": 240
    },
    "class": "other",
    "severity": "low",
    "blocks_service": false,
    "recommended_action": {
      "label": "Check why the vehicle hasn't moved",
      "expected_downtime_min": 30
    },
    "auto_actions": {},
    "auto_resolve": true,
    "capability": null
  }
]$json$::jsonb
$rules$;
-- END SYSTEM RULES

-- Adds any system rule an org is missing; existing rules (and their edits) are left alone.
create function app.seed_exception_rules(p_org uuid) returns void language sql security definer set search_path = '' as $$
  insert into public.exception_rules (org_id, key, name, condition, class, severity, blocks_service,
    recommended_action, auto_actions, auto_resolve, capability, is_system)
  select p_org, r->>'key', r->>'name', r->'condition', r->>'class', r->>'severity', (r->>'blocks_service')::boolean,
    r->'recommended_action', r->'auto_actions', (r->>'auto_resolve')::boolean, r->>'capability', true
  from jsonb_array_elements(app.system_exception_rules()) r
  on conflict (org_id, key) do nothing;
$$;
create function app.seed_org_exception_rules() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform app.seed_exception_rules(new.id);
  return null;
end $$;
create trigger orgs_seed_exception_rules after insert on public.orgs
  for each row execute function app.seed_org_exception_rules();
select app.seed_exception_rules(id) from public.orgs;

create table public.exceptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  vehicle_id uuid,
  hub_id uuid,
  rule_id uuid,
  type text not null check (length(type) between 1 and 60),
  class text not null check (class in ('incident', 'maintenance', 'cleaning', 'charging', 'other')),
  severity text not null check (severity in ('critical', 'high', 'medium', 'low')),
  status text not null default 'open' check (status in ('open', 'assigned', 'in_progress', 'resolved', 'dismissed')),
  title text not null check (length(title) between 1 and 120),
  description text check (length(description) <= 2000),
  detected_at timestamptz not null default now(),
  location extensions.geography(Point, 4326),
  location_name text,
  blocks_service boolean not null default false,
  expected_downtime_min int check (expected_downtime_min between 0 and 100000),
  -- r(v, now) at detection (kpis.md §3.2), so revenue at risk doesn't need ledger access to read.
  baseline_rate_cents_per_h int check (baseline_rate_cents_per_h >= 0),
  recommended_action jsonb check (recommended_action is null or jsonb_typeof(recommended_action) = 'object'),
  owner_user_id uuid references auth.users (id) on delete set null,
  dedupe_key text,
  trigger jsonb,
  cleared_at timestamptz, -- when the rule's condition stopped holding
  resolved_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, vehicle_id) references public.vehicles (org_id, id) on delete cascade,
  foreign key (org_id, hub_id) references public.hubs (org_id, id) on delete set null (hub_id),
  foreign key (org_id, rule_id) references public.exception_rules (org_id, id) on delete set null (rule_id)
);
-- One per rule and vehicle while the condition holds (PRD EX-2), whatever people did with it meanwhile.
create unique index exceptions_dedupe_idx on public.exceptions (org_id, dedupe_key)
  where dedupe_key is not null and cleared_at is null;
create index exceptions_org_status_idx on public.exceptions (org_id, status, detected_at desc);
create index exceptions_vehicle_idx on public.exceptions (vehicle_id, detected_at desc);
create trigger exceptions_updated_at before update on public.exceptions
  for each row execute function app.set_updated_at();

alter table public.exceptions enable row level security;
create policy exceptions_select on public.exceptions for select to authenticated
  using (org_id in (select app.user_org_ids()));
create policy exceptions_insert on public.exceptions for insert to authenticated
  with check (app.has_role(org_id, array['owner', 'admin', 'ops']::public.app_role[])
    and dedupe_key is null and rule_id is null);
create policy exceptions_update on public.exceptions for update to authenticated
  using (app.has_role(org_id, array['owner', 'admin', 'ops']::public.app_role[]))
  with check (app.has_role(org_id, array['owner', 'admin', 'ops']::public.app_role[]));
revoke all on public.exceptions from anon;
-- People change status, owner and notes; what the engine detected stays as detected.
revoke update on public.exceptions from authenticated;
grant update (status, owner_user_id, resolved_at) on public.exceptions to authenticated;

-- Baseline revenue rate r(v, now) (kpis.md §3.2): trailing-28-day gross revenue per available hour for the
-- vehicle, falling back to its home hub, then the fleet, when history is thin (< 8 available hours).
-- Hour-of-week weighting comes with more history; this is the flat trailing rate.
create function app.baseline_rate_cents(p_org uuid, p_vehicle uuid) returns int
language sql stable security definer set search_path = '' as $$
  with since as (select current_date - 28 as d),
  hrs as (
    select h.vehicle_id, sum(h.in_service_h + h.ready_h) as avail
    from public.vehicle_day_hours h, since where h.org_id = p_org and h.day >= since.d group by 1
  ),
  rev as (
    select l.vehicle_id, sum(l.amount_cents) as cents
    from public.ledger_entries l, since
    where l.org_id = p_org and l.category = 'gross_ride_revenue' and l.occurred_on >= since.d group by 1
  ),
  per as (
    select h.vehicle_id, v.home_hub_id, h.avail, coalesce(r.cents, 0) as cents
    from hrs h join public.vehicles v on v.id = h.vehicle_id left join rev r on r.vehicle_id = h.vehicle_id
  )
  select round(coalesce(
    (select sum(cents) / nullif(sum(avail), 0) from per where vehicle_id = p_vehicle having sum(avail) >= 8),
    (select sum(cents) / nullif(sum(avail), 0) from per
      where home_hub_id = (select home_hub_id from public.vehicles where id = p_vehicle) having sum(avail) >= 8),
    (select sum(cents) / nullif(sum(avail), 0) from per)
  ))::int
$$;

-- Fill what the database knows at detection: place, hub, baseline rate, and expected downtime from history
-- (median resolution time for this type over 90 days once there are 3+; otherwise the rule's default).
create function app.enrich_exception() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  s record;
  v_median numeric;
begin
  if new.vehicle_id is not null then
    select st.location, st.current_hub_id, v.home_hub_id, h.name as hub_name
      into s
      from public.vehicles v
      left join public.vehicle_state_current st on st.vehicle_id = v.id
      left join public.hubs h on h.id = st.current_hub_id
     where v.id = new.vehicle_id and v.org_id = new.org_id;
    new.location := coalesce(new.location, s.location);
    new.hub_id := coalesce(new.hub_id, s.current_hub_id, s.home_hub_id);
    new.location_name := coalesce(new.location_name, s.hub_name, case when s.location is not null then 'On the road' end);
    new.baseline_rate_cents_per_h := coalesce(new.baseline_rate_cents_per_h, app.baseline_rate_cents(new.org_id, new.vehicle_id));
  end if;
  select percentile_cont(0.5) within group (order by extract(epoch from (e.resolved_at - e.detected_at)) / 60)
    into v_median
    from public.exceptions e
   where e.org_id = new.org_id and e.type = new.type and e.status = 'resolved'
     and e.resolved_at > now() - interval '90 days'
  having count(*) >= 3;
  new.expected_downtime_min := coalesce(round(v_median)::int, new.expected_downtime_min);
  new.created_by := coalesce(new.created_by, (select auth.uid()));
  return new;
end $$;
create trigger exceptions_enrich before insert on public.exceptions
  for each row execute function app.enrich_exception();

-- Resolved/dismissed carry a time; reopening clears it; an owner assigns an open one, and removing the owner
-- from an assigned one puts it back to open.
create function app.exception_lifecycle() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status in ('resolved', 'dismissed') and old.status not in ('resolved', 'dismissed') then
    new.resolved_at := coalesce(new.resolved_at, now());
  elsif new.status not in ('resolved', 'dismissed') then
    new.resolved_at := null;
  end if;
  if new.status = 'open' and new.owner_user_id is not null and old.owner_user_id is distinct from new.owner_user_id then
    new.status := 'assigned';
  elsif new.status = 'assigned' and new.owner_user_id is null then
    new.status := 'open'; -- unassigned: back in the queue
  end if;
  return new;
end $$;
create trigger exceptions_lifecycle before update on public.exceptions
  for each row execute function app.exception_lifecycle();

-- The exception's history: who did what, when (flows.md EX-5 audit; shown in the exception drawer).
create table public.exception_events (
  id bigint generated always as identity primary key,
  org_id uuid not null,
  exception_id uuid not null,
  at timestamptz not null default now(),
  actor_user_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('opened', 'status', 'owner', 'cleared')),
  from_status text,
  to_status text,
  note text check (length(note) <= 2000),
  foreign key (org_id, exception_id) references public.exceptions (org_id, id) on delete cascade
);
create index exception_events_exception_idx on public.exception_events (exception_id, at);
alter table public.exception_events enable row level security;
create policy exception_events_select on public.exception_events for select to authenticated
  using (org_id in (select app.user_org_ids()));
revoke all on public.exception_events from anon;
revoke insert, update, delete on public.exception_events from authenticated;

-- Written by trigger so every path (UI, API, engine) is logged. A note rides along in app.exception_note.
create function app.log_exception_event() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_note text := nullif(current_setting('app.exception_note', true), '');
  v_actor uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    insert into public.exception_events (org_id, exception_id, at, actor_user_id, kind, to_status, note)
    values (new.org_id, new.id, new.detected_at, v_actor, 'opened', new.status, coalesce(v_note, new.description));
    return null;
  end if;
  if new.cleared_at is not null and old.cleared_at is null then
    insert into public.exception_events (org_id, exception_id, at, kind, note)
    values (new.org_id, new.id, new.cleared_at, 'cleared', 'Condition cleared');
  end if;
  if new.status is distinct from old.status then
    insert into public.exception_events (org_id, exception_id, at, actor_user_id, kind, from_status, to_status, note)
    values (new.org_id, new.id, coalesce(case when new.status = 'resolved' then new.resolved_at end, now()),
            v_actor, 'status', old.status, new.status, v_note);
  end if;
  if new.owner_user_id is distinct from old.owner_user_id then
    insert into public.exception_events (org_id, exception_id, actor_user_id, kind, note)
    values (new.org_id, new.id, v_actor, 'owner', new.owner_user_id::text);
  end if;
  return null;
end $$;
create trigger exceptions_log after insert or update on public.exceptions
  for each row execute function app.log_exception_event();

-- People's changes (PATCH /exceptions/{id}): status and/or owner, with an optional note in the history.
-- Security invoker: the exceptions RLS decides who may do it.
create function public.update_exception(
  p_org uuid, p_id uuid, p_status text default null, p_set_owner boolean default false,
  p_owner uuid default null, p_note text default null
) returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_set_owner and p_owner is not null
     and not exists (select 1 from public.memberships m where m.org_id = p_org and m.user_id = p_owner) then
    raise exception 'The owner must be a member of this organization' using errcode = '22023';
  end if;
  perform set_config('app.exception_note', coalesce(p_note, ''), true);
  update public.exceptions
     set status = coalesce(p_status, status),
         owner_user_id = case when p_set_owner then p_owner else owner_user_id end
   where org_id = p_org and id = p_id;
  if not found then raise exception 'No such exception' using errcode = 'P0002'; end if;
  perform set_config('app.exception_note', '', true);
end $$;
revoke all on function public.update_exception(uuid, uuid, text, boolean, uuid, text) from public, anon;
grant execute on function public.update_exception(uuid, uuid, text, boolean, uuid, text) to authenticated;

-- Engine side (service role): open what the tick detected, clear what stopped holding. Returns new ids.
create function public.engine_apply_exceptions(p_org uuid, p_opened jsonb, p_cleared jsonb)
returns table (exception_id uuid, opened_key text)
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('app.exception_note', 'Condition cleared', true);
  update public.exceptions e
     set cleared_at = c.at,
         status = case when r.auto_resolve and e.status in ('open', 'assigned', 'in_progress') then 'resolved' else e.status end,
         resolved_at = case when r.auto_resolve and e.status in ('open', 'assigned', 'in_progress') then c.at else e.resolved_at end
    from jsonb_to_recordset(p_cleared) as c(dedupe_key text, at timestamptz),
         public.exception_rules r
   where e.org_id = p_org and e.dedupe_key = c.dedupe_key and e.cleared_at is null
     and r.org_id = p_org and r.id = e.rule_id;
  perform set_config('app.exception_note', '', true);

  return query
  insert into public.exceptions as x (org_id, vehicle_id, rule_id, type, class, severity, title, detected_at,
    blocks_service, expected_downtime_min, recommended_action, dedupe_key, trigger)
  select p_org, o.vehicle_id, r.id, r.key, r.class, r.severity, r.name, o.at, r.blocks_service,
         coalesce((o.recommended_action->>'expected_downtime_min')::int, (r.recommended_action->>'expected_downtime_min')::int),
         o.recommended_action, o.dedupe_key, o.trigger
    from jsonb_to_recordset(p_opened) as o(vehicle_id uuid, rule_key text, dedupe_key text, at timestamptz,
                                           trigger jsonb, recommended_action jsonb)
    join public.exception_rules r on r.org_id = p_org and r.key = o.rule_key
  on conflict (org_id, dedupe_key) where dedupe_key is not null and cleared_at is null do nothing
  returning x.id, x.dedupe_key;
end $$;
revoke all on function public.engine_apply_exceptions(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.engine_apply_exceptions(uuid, jsonb, jsonb) to service_role;

-- The engine persists rule timers ("condition holding for N min") between ticks.
alter table public.vehicle_state_current add column rule_pending jsonb not null default '{}'::jsonb;

drop function public.engine_live_state(uuid);
create function public.engine_live_state(p_org uuid)
returns table (
  vehicle_id uuid, status public.vehicle_status, status_since timestamptz,
  candidate_status public.vehicle_status, candidate_since timestamptz,
  soc numeric, range_m numeric, charge_state text, charge_power_kw numeric, charge_limit_soc numeric,
  lat double precision, lng double precision, heading numeric, speed_mps numeric, gear text, odometer_m numeric,
  locked boolean, tpms jsonb, inside_temp_c numeric, outside_temp_c numeric, connectivity text,
  current_hub_id uuid, last_telemetry_at timestamptz, active_alerts text[], rule_pending jsonb
)
language sql stable security definer set search_path = ''
as $$
  select s.vehicle_id, s.status, s.status_since, s.candidate_status, s.candidate_since,
         s.soc, s.range_m, s.charge_state, s.charge_power_kw, s.charge_limit_soc,
         extensions.st_y(s.location::extensions.geometry), extensions.st_x(s.location::extensions.geometry),
         s.heading, s.speed_mps, s.gear, s.odometer_m, s.locked, s.tpms, s.inside_temp_c, s.outside_temp_c,
         s.connectivity, s.current_hub_id, s.last_telemetry_at, s.active_alerts, s.rule_pending
  from public.vehicle_state_current s where s.org_id = p_org;
$$;
revoke all on function public.engine_live_state(uuid) from public, anon, authenticated;
grant execute on function public.engine_live_state(uuid) to service_role;

-- Exceptions with coordinates and people's names for the API (security invoker: RLS applies).
create view public.exception_list with (security_invoker = true) as
select e.id, e.org_id, e.vehicle_id, v.number as vehicle_number, e.hub_id, e.rule_id, e.type, e.class, e.severity,
       e.status, e.title, e.description, e.detected_at, e.location_name,
       extensions.st_y(e.location::extensions.geometry) as lat, extensions.st_x(e.location::extensions.geometry) as lng,
       e.blocks_service, e.expected_downtime_min, e.baseline_rate_cents_per_h, e.recommended_action,
       e.owner_user_id, p.full_name as owner_name, e.trigger, e.cleared_at, e.resolved_at, e.created_at
from public.exceptions e
left join public.vehicles v on v.id = e.vehicle_id
left join public.profiles p on p.user_id = e.owner_user_id;
revoke all on public.exception_list from anon;
grant select on public.exception_list to authenticated, service_role;
