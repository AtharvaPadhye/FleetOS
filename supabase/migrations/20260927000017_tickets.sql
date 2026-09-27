-- Service tickets (task 5.5, PRD SV-1..6, EX-4, VD-8, VN-5; erd.md §3.5; flows.md F1).
-- A ticket is the response to a problem: it has a vendor job, an SLA clock, a lifecycle
-- open → dispatched → (en_route) → arrived → completed → returned (or cancelled), and on completion exactly
-- one ledger line with its actual cost. Blocking tickets and manual holds join exceptions as status blockers.
-- Every state change goes through the functions below, which log ticket_events; users can't write the
-- tables directly, so the lifecycle can't be skipped.

-- SLA targets per ticket type, seeded per org (editable in Settings, task 5.10).
create table public.sla_policies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  ticket_type text not null check (ticket_type in ('cleaning', 'maintenance', 'roadside', 'charging', 'other')),
  response_min int not null check (response_min between 1 and 10080),
  resolution_min int not null check (resolution_min between 1 and 43200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, ticket_type),
  unique (org_id, id)
);
create trigger sla_policies_updated_at before update on public.sla_policies
  for each row execute function app.set_updated_at();
alter table public.sla_policies enable row level security;
create policy sla_policies_select on public.sla_policies for select to authenticated
  using (org_id in (select app.user_org_ids()));
create policy sla_policies_write on public.sla_policies for all to authenticated
  using (app.has_role(org_id, array['owner', 'admin']::public.app_role[]))
  with check (app.has_role(org_id, array['owner', 'admin']::public.app_role[]));
revoke all on public.sla_policies from anon;

-- Defaults: the MVP's promises (cleaning within the hour, roadside within 3 h, repairs within the shift).
create function app.seed_sla_policies(p_org uuid) returns void language sql security definer set search_path = '' as $$
  insert into public.sla_policies (org_id, ticket_type, response_min, resolution_min) values
    (p_org, 'cleaning', 20, 60),
    (p_org, 'roadside', 30, 180),
    (p_org, 'maintenance', 60, 480),
    (p_org, 'charging', 30, 90),
    (p_org, 'other', 60, 480)
  on conflict (org_id, ticket_type) do nothing;
$$;
create function app.seed_org_sla_policies() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform app.seed_sla_policies(new.id);
  return null;
end $$;
create trigger orgs_seed_sla_policies after insert on public.orgs
  for each row execute function app.seed_org_sla_policies();
select app.seed_sla_policies(id) from public.orgs;

-- "SVC-2026-0001": numbered per org and year.
create table public.ticket_counters (
  org_id uuid not null references public.orgs (id) on delete cascade,
  year int not null,
  last int not null default 0,
  primary key (org_id, year)
);
alter table public.ticket_counters enable row level security;
revoke all on public.ticket_counters from anon, authenticated;

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  number text not null,
  vehicle_id uuid not null,
  exception_id uuid,
  type text not null check (type in ('cleaning', 'maintenance', 'roadside', 'charging', 'other')),
  status text not null default 'open' check (status in (
    'open', 'dispatched', 'en_route', 'arrived', 'in_progress', 'completed', 'returned', 'cancelled')),
  blocks_service boolean not null default false,
  sla_policy_id uuid,
  response_due_at timestamptz,
  sla_due_at timestamptz,
  breached_at timestamptz,
  vendor_id uuid,
  estimated_cost_cents int check (estimated_cost_cents >= 0),
  actual_cost_cents int check (actual_cost_cents >= 0),
  baseline_rate_cents_per_h int check (baseline_rate_cents_per_h >= 0),
  description text check (length(description) <= 2000),
  policy_ref text check (length(policy_ref) <= 80),
  detection_source text check (detection_source in ('exception', 'manual', 'rule', 'vehicle')),
  dispatched_at timestamptz,
  eta_at timestamptz,
  arrived_at timestamptz,
  completed_at timestamptz,
  returned_at timestamptz,
  cancelled_at timestamptz,
  escalated_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, number),
  unique (org_id, id),
  foreign key (org_id, vehicle_id) references public.vehicles (org_id, id) on delete cascade,
  foreign key (org_id, exception_id) references public.exceptions (org_id, id) on delete set null (exception_id),
  foreign key (org_id, vendor_id) references public.vendors (org_id, id) on delete set null (vendor_id),
  foreign key (org_id, sla_policy_id) references public.sla_policies (org_id, id) on delete set null (sla_policy_id)
);
-- One live ticket per exception (EX-4: dispatch once).
create unique index tickets_exception_live_idx on public.tickets (exception_id)
  where exception_id is not null and status not in ('returned', 'cancelled');
create index tickets_org_status_idx on public.tickets (org_id, status, created_at desc);
create index tickets_vehicle_idx on public.tickets (vehicle_id, created_at desc);
create trigger tickets_updated_at before update on public.tickets for each row execute function app.set_updated_at();
alter table public.tickets enable row level security;
create policy tickets_select on public.tickets for select to authenticated using (org_id in (select app.user_org_ids()));
revoke all on public.tickets from anon;
revoke insert, update, delete on public.tickets from authenticated;

create table public.ticket_events (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity, -- orders steps taken in the same instant (create + dispatch)
  org_id uuid not null,
  ticket_id uuid not null,
  type text not null check (type in ('created', 'vendor_assigned', 'eta_set', 'arrived', 'completed', 'returned',
    'cancelled', 'escalated', 'sla_breached', 'cost_updated', 'note', 'attachment_added', 'override')),
  actor_type text not null check (actor_type in ('user', 'system', 'vendor')),
  actor_id uuid,
  at timestamptz not null default now(),
  detail jsonb not null default '{}'::jsonb,
  foreign key (org_id, ticket_id) references public.tickets (org_id, id) on delete cascade
);
create index ticket_events_ticket_idx on public.ticket_events (ticket_id, at, seq);
alter table public.ticket_events enable row level security;
create policy ticket_events_select on public.ticket_events for select to authenticated
  using (org_id in (select app.user_org_ids()));
revoke all on public.ticket_events from anon;
revoke insert, update, delete on public.ticket_events from authenticated;

create table public.vendor_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  vendor_id uuid not null,
  ticket_id uuid not null,
  dispatched_at timestamptz not null,
  eta_at timestamptz,
  arrived_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cost_cents int check (cost_cents >= 0),
  rating smallint check (rating between 1 and 5),
  tracking_source text not null default 'manual' check (tracking_source in ('manual', 'geofence', 'integration')),
  -- SUBSTITUTE(vendor_tracking, simulated): demo orgs' jobs are played by the simulator's ops autopilot.
  --   Real source: vendor integrations (Agero-style) or Airtable job forms (ADR-0015).
  --   Replace by: a vendor feed writing arrivals/completions with tracking_source 'integration', source 'vendor'.
  --   Docs: docs/requirements/data-sources.md §5
  source text not null default 'manual' check (source in ('manual', 'simulator', 'vendor')),
  created_at timestamptz not null default now(),
  foreign key (org_id, vendor_id) references public.vendors (org_id, id) on delete cascade,
  foreign key (org_id, ticket_id) references public.tickets (org_id, id) on delete cascade
);
create index vendor_jobs_vendor_idx on public.vendor_jobs (vendor_id, dispatched_at desc);
create index vendor_jobs_ticket_idx on public.vendor_jobs (ticket_id);
alter table public.vendor_jobs enable row level security;
create policy vendor_jobs_select on public.vendor_jobs for select to authenticated
  using (org_id in (select app.user_org_ids()));
revoke all on public.vendor_jobs from anon;
revoke insert, update, delete on public.vendor_jobs from authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- Lifecycle (internal). Callers: public.ticket_* for people (role-checked), public.engine_* for the tick.
-- ---------------------------------------------------------------------------------------------------------

create function app.ticket_event(p_ticket public.tickets, p_type text, p_actor_type text, p_actor uuid,
  p_at timestamptz, p_detail jsonb default '{}'::jsonb) returns void language sql security definer set search_path = '' as $$
  insert into public.ticket_events (org_id, ticket_id, type, actor_type, actor_id, at, detail)
  values (p_ticket.org_id, p_ticket.id, p_type, p_actor_type, p_actor, p_at, coalesce(p_detail, '{}'::jsonb));
$$;

create function app.ticket_for_update(p_org uuid, p_id uuid) returns public.tickets
language plpgsql security definer set search_path = '' as $$
declare t public.tickets;
begin
  select * into t from public.tickets where org_id = p_org and id = p_id for update;
  if not found then raise exception 'No such ticket' using errcode = 'P0002'; end if;
  return t;
end $$;

create function app.ticket_assign(p_org uuid, p_id uuid, p_vendor uuid, p_eta timestamptz, p_actor_type text,
  p_actor uuid, p_at timestamptz, p_source text default 'manual') returns void
language plpgsql security definer set search_path = '' as $$
declare
  t public.tickets := app.ticket_for_update(p_org, p_id);
  v_name text;
begin
  if t.status not in ('open', 'dispatched', 'en_route') then
    raise exception 'A vendor can only be assigned before arrival (ticket is %)', t.status using errcode = '22023';
  end if;
  select name into v_name from public.vendors where org_id = p_org and id = p_vendor and status <> 'inactive';
  if v_name is null then raise exception 'No such active vendor' using errcode = '22023'; end if;
  -- Reassigning ends the previous vendor's job.
  update public.vendor_jobs set cancelled_at = p_at
   where ticket_id = t.id and vendor_id <> p_vendor and completed_at is null and cancelled_at is null;
  if exists (select 1 from public.vendor_jobs where ticket_id = t.id and vendor_id = p_vendor
             and completed_at is null and cancelled_at is null) then
    update public.vendor_jobs set eta_at = coalesce(p_eta, eta_at)
     where ticket_id = t.id and vendor_id = p_vendor and completed_at is null and cancelled_at is null;
    perform app.ticket_event(t, 'eta_set', p_actor_type, p_actor, p_at, jsonb_build_object('eta_at', p_eta));
  else
    insert into public.vendor_jobs (org_id, vendor_id, ticket_id, dispatched_at, eta_at, tracking_source, source)
    values (p_org, p_vendor, t.id, p_at, p_eta,
            case when p_source = 'simulator' then 'integration' else 'manual' end, p_source);
    perform app.ticket_event(t, 'vendor_assigned', p_actor_type, p_actor, p_at,
      jsonb_build_object('vendor_id', p_vendor, 'vendor_name', v_name, 'eta_at', p_eta));
  end if;
  update public.tickets
     set vendor_id = p_vendor, status = 'dispatched', dispatched_at = coalesce(dispatched_at, p_at),
         eta_at = coalesce(p_eta, eta_at)
   where id = t.id;
end $$;

create function app.ticket_arrive(p_org uuid, p_id uuid, p_actor_type text, p_actor uuid, p_at timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tickets := app.ticket_for_update(p_org, p_id);
begin
  if t.status not in ('dispatched', 'en_route') then
    raise exception 'Only a dispatched ticket can be marked arrived (ticket is %)', t.status using errcode = '22023';
  end if;
  update public.tickets set status = 'arrived', arrived_at = p_at where id = t.id;
  update public.vendor_jobs set arrived_at = p_at
   where ticket_id = t.id and completed_at is null and cancelled_at is null;
  perform app.ticket_event(t, 'arrived', p_actor_type, p_actor, p_at);
end $$;

-- Ledger category a ticket's cost books to (SV-6).
create function app.ticket_ledger_category(p_type text) returns text language sql immutable set search_path = '' as $$
  select case p_type when 'cleaning' then 'cleaning' when 'maintenance' then 'maintenance'
                     when 'roadside' then 'roadside' else 'other_variable' end
$$;

-- Complete (or correct the cost of) a ticket: exactly one ledger line per ticket, adjusted in place (SV-6).
create function app.ticket_complete(p_org uuid, p_id uuid, p_cost int, p_note text, p_actor_type text, p_actor uuid,
  p_at timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t public.tickets := app.ticket_for_update(p_org, p_id);
  v_cost int := coalesce(p_cost, t.actual_cost_cents, t.estimated_cost_cents);
  v_tz text;
  v_correction boolean := t.status in ('completed', 'returned');
begin
  if t.status in ('cancelled') or (t.status = 'open' and t.vendor_id is null and p_cost is null) then
    raise exception 'This ticket can''t be completed (ticket is %)', t.status using errcode = '22023';
  end if;
  if v_cost is null then raise exception 'Enter the actual cost' using errcode = '22023'; end if;
  select timezone into v_tz from public.orgs where id = p_org;
  if v_correction then
    update public.tickets set actual_cost_cents = v_cost where id = t.id;
    perform app.ticket_event(t, 'cost_updated', p_actor_type, p_actor, p_at,
      jsonb_build_object('from_cents', t.actual_cost_cents, 'to_cents', v_cost, 'note', p_note));
  else
    update public.tickets set status = 'completed', completed_at = p_at, actual_cost_cents = v_cost,
           arrived_at = coalesce(arrived_at, p_at)
     where id = t.id;
    update public.vendor_jobs set completed_at = p_at, cost_cents = v_cost, arrived_at = coalesce(arrived_at, p_at)
     where ticket_id = t.id and completed_at is null and cancelled_at is null;
    perform app.ticket_event(t, 'completed', p_actor_type, p_actor, p_at,
      jsonb_build_object('actual_cost_cents', v_cost, 'note', p_note));
  end if;
  insert into public.ledger_entries (org_id, vehicle_id, occurred_on, occurred_at, category, amount_cents, source,
    source_ref, note)
  values (p_org, t.vehicle_id, (coalesce(t.completed_at, p_at) at time zone v_tz)::date, coalesce(t.completed_at, p_at),
          app.ticket_ledger_category(t.type), v_cost, 'ticket', t.id::text, t.number)
  on conflict (org_id, source, source_ref) do update set amount_cents = excluded.amount_cents;
end $$;

-- What still keeps a vehicle out of service, besides the given ticket and its exception.
create function app.vehicle_blockers(p_org uuid, p_vehicle uuid, p_except_ticket uuid, p_except_exception uuid)
returns table (kind text, id uuid, label text)
language sql stable security definer set search_path = '' as $$
  select 'ticket', t.id, t.number || ' (' || t.type || ')' from public.tickets t
   where t.org_id = p_org and t.vehicle_id = p_vehicle and t.blocks_service
     and t.status not in ('returned', 'cancelled') and t.id is distinct from p_except_ticket
  union all
  select 'exception', e.id, e.title from public.exceptions e
   where e.org_id = p_org and e.vehicle_id = p_vehicle and e.blocks_service
     and e.status in ('open', 'assigned', 'in_progress') and e.id is distinct from p_except_exception
  union all
  select 'hold', h.id, 'Pulled from service: ' || h.reason from public.vehicle_holds h
   where h.org_id = p_org and h.vehicle_id = p_vehicle and h.released_at is null
$$;

-- Clear the other blockers with an audited override (vehicle-states.md §5: owner/admin, reason required).
create function app.override_blockers(p_org uuid, p_vehicle uuid, p_except_ticket uuid, p_except_exception uuid,
  p_reason text, p_actor uuid, p_at timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare b record; t public.tickets;
begin
  for b in select * from app.vehicle_blockers(p_org, p_vehicle, p_except_ticket, p_except_exception) loop
    if b.kind = 'ticket' then
      select * into t from public.tickets where id = b.id;
      update public.tickets set blocks_service = false where id = b.id;
      perform app.ticket_event(t, 'override', 'user', p_actor, p_at, jsonb_build_object('reason', p_reason));
    elsif b.kind = 'exception' then
      perform set_config('app.exception_note', 'Override: ' || p_reason, true);
      update public.exceptions set status = 'resolved', resolved_at = p_at where id = b.id;
      perform set_config('app.exception_note', '', true);
    else
      update public.vehicle_holds set released_at = p_at, released_by = p_actor where id = b.id;
    end if;
  end loop;
  insert into public.audit_log (org_id, actor_id, action, target_type, target_id, detail)
  values (p_org, p_actor, 'vehicle.return_override', 'vehicle', p_vehicle::text, jsonb_build_object('reason', p_reason));
end $$;

create function app.blocked_message(p_org uuid, p_vehicle uuid, p_except_ticket uuid, p_except_exception uuid)
returns text language sql stable security definer set search_path = '' as $$
  select 'Still blocked by ' || string_agg(label, '; ') || '. Resolve it first, or override with a reason (owner or admin).'
  from app.vehicle_blockers(p_org, p_vehicle, p_except_ticket, p_except_exception)
  having count(*) > 0
$$;

create function app.ticket_return(p_org uuid, p_id uuid, p_override boolean, p_reason text, p_actor_type text,
  p_actor uuid, p_at timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t public.tickets := app.ticket_for_update(p_org, p_id);
  v_blocked text;
begin
  if t.status <> 'completed' then
    raise exception 'Complete the service before returning the vehicle (ticket is %)', t.status using errcode = '22023';
  end if;
  v_blocked := app.blocked_message(p_org, t.vehicle_id, t.id, t.exception_id);
  if v_blocked is not null then
    if not coalesce(p_override, false) then raise exception '%', v_blocked using errcode = '22023'; end if;
    if length(trim(coalesce(p_reason, ''))) < 3 then
      raise exception 'An override needs a reason' using errcode = '22023';
    end if;
    if p_actor_type = 'user' and not app.has_role(p_org, array['owner', 'admin']::public.app_role[]) then
      raise exception 'Only owners and admins can override' using errcode = '42501';
    end if;
    perform app.override_blockers(p_org, t.vehicle_id, t.id, t.exception_id, p_reason, p_actor, p_at);
  end if;
  update public.tickets set status = 'returned', returned_at = p_at where id = t.id;
  perform app.ticket_event(t, 'returned', p_actor_type, p_actor, p_at);
  if t.exception_id is not null then
    perform set_config('app.exception_note', 'Returned to service with ' || t.number, true);
    update public.exceptions set status = 'resolved', resolved_at = p_at
     where id = t.exception_id and status in ('open', 'assigned', 'in_progress');
    perform set_config('app.exception_note', '', true);
  end if;
end $$;

create function app.ticket_cancel(p_org uuid, p_id uuid, p_reason text, p_actor_type text, p_actor uuid,
  p_at timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tickets := app.ticket_for_update(p_org, p_id);
begin
  if t.status in ('completed', 'returned', 'cancelled') then
    raise exception 'This ticket is already %', t.status using errcode = '22023';
  end if;
  update public.tickets set status = 'cancelled', cancelled_at = p_at where id = t.id;
  update public.vendor_jobs set cancelled_at = p_at where ticket_id = t.id and completed_at is null and cancelled_at is null;
  perform app.ticket_event(t, 'cancelled', p_actor_type, p_actor, p_at, jsonb_build_object('reason', p_reason));
  -- The problem is back in the queue.
  update public.exceptions set status = 'open' where id = t.exception_id and status = 'in_progress';
end $$;

create function app.ticket_create(p_org uuid, p_vehicle uuid, p_type text, p_blocks boolean, p_description text,
  p_exception uuid, p_estimate int, p_source text, p_actor_type text, p_actor uuid, p_at timestamptz) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_year int := extract(year from p_at at time zone 'UTC');
  v_n int;
  v_policy public.sla_policies;
  t public.tickets;
begin
  if not exists (select 1 from public.vehicles where org_id = p_org and id = p_vehicle) then
    raise exception 'No such vehicle' using errcode = '22023';
  end if;
  if p_exception is not null and not exists (select 1 from public.exceptions where org_id = p_org and id = p_exception) then
    raise exception 'No such exception' using errcode = 'P0002';
  end if;
  insert into public.ticket_counters (org_id, year, last) values (p_org, v_year, 1)
  on conflict (org_id, year) do update set last = public.ticket_counters.last + 1
  returning last into v_n;
  select * into v_policy from public.sla_policies where org_id = p_org and ticket_type = p_type;
  insert into public.tickets (org_id, number, vehicle_id, exception_id, type, blocks_service, sla_policy_id,
    response_due_at, sla_due_at, estimated_cost_cents, baseline_rate_cents_per_h, description, detection_source,
    created_by, created_at)
  values (p_org, 'SVC-' || v_year || '-' || lpad(v_n::text, 4, '0'), p_vehicle, p_exception, p_type,
    coalesce(p_blocks, false), v_policy.id,
    p_at + make_interval(mins => v_policy.response_min), p_at + make_interval(mins => v_policy.resolution_min),
    p_estimate, app.baseline_rate_cents(p_org, p_vehicle), nullif(trim(p_description), ''), p_source,
    case when p_actor_type = 'user' then p_actor end, p_at)
  returning * into t;
  perform app.ticket_event(t, 'created', p_actor_type, p_actor, p_at,
    jsonb_build_object('source', p_source, 'exception_id', p_exception));
  -- Someone is handling the exception now.
  if p_exception is not null then
    perform set_config('app.exception_note', 'Ticket ' || t.number, true);
    update public.exceptions set status = 'in_progress' where id = p_exception and status in ('open', 'assigned');
    perform set_config('app.exception_note', '', true);
  end if;
  return t.id;
exception when unique_violation then
  raise exception 'This exception already has a live ticket' using errcode = '23505';
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- People (PRD SV-3): owner/admin/ops. Errors: 22023 invalid transition, 42501 role, P0002 not found.
-- ---------------------------------------------------------------------------------------------------------
create function app.require_ops(p_org uuid) returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.has_role(p_org, array['owner', 'admin', 'ops']::public.app_role[]) then
    raise exception 'Only owners, admins and ops can change service tickets' using errcode = '42501';
  end if;
end $$;

create function public.ticket_create(p_org uuid, p_vehicle uuid, p_type text, p_blocks boolean default false,
  p_description text default null, p_exception uuid default null, p_vendor uuid default null,
  p_eta timestamptz default null, p_estimate int default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_uid uuid := (select auth.uid());
begin
  perform app.require_ops(p_org);
  v_id := app.ticket_create(p_org, p_vehicle, p_type, p_blocks, p_description, p_exception, p_estimate,
    case when p_exception is null then 'vehicle' else 'exception' end, 'user', v_uid, now());
  if p_vendor is not null then perform app.ticket_assign(p_org, v_id, p_vendor, p_eta, 'user', v_uid, now()); end if;
  return v_id;
end $$;

create function public.ticket_action(p_org uuid, p_id uuid, p_action text, p_vendor uuid default null,
  p_eta timestamptz default null, p_cost int default null, p_note text default null, p_override boolean default false,
  p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); t public.tickets;
begin
  perform app.require_ops(p_org);
  case p_action
    when 'assign-vendor' then
      if p_vendor is null then raise exception 'Pick a vendor' using errcode = '22023'; end if;
      perform app.ticket_assign(p_org, p_id, p_vendor, p_eta, 'user', v_uid, now());
    when 'mark-arrived' then perform app.ticket_arrive(p_org, p_id, 'user', v_uid, now());
    when 'complete' then perform app.ticket_complete(p_org, p_id, p_cost, p_note, 'user', v_uid, now());
    when 'return-to-service' then perform app.ticket_return(p_org, p_id, p_override, p_reason, 'user', v_uid, now());
    when 'cancel' then perform app.ticket_cancel(p_org, p_id, coalesce(p_reason, p_note), 'user', v_uid, now());
    when 'escalate' then
      t := app.ticket_for_update(p_org, p_id);
      if t.status in ('completed', 'returned', 'cancelled') then
        raise exception 'Only an active ticket can be escalated' using errcode = '22023';
      end if;
      update public.tickets set escalated_at = now() where id = p_id;
      perform app.ticket_event(t, 'escalated', 'user', v_uid, now(), jsonb_build_object('note', p_note));
    else raise exception 'Unknown action %', p_action using errcode = '22023';
  end case;
end $$;

-- PATCH /tickets/{id}: description and estimate only; everything else is a lifecycle action.
create function public.ticket_update(p_org uuid, p_id uuid, p_description text default null, p_estimate int default null)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.tickets;
begin
  perform app.require_ops(p_org);
  t := app.ticket_for_update(p_org, p_id);
  update public.tickets set description = coalesce(nullif(trim(p_description), ''), description),
         estimated_cost_cents = coalesce(p_estimate, estimated_cost_cents)
   where id = p_id;
  perform app.ticket_event(t, 'note', 'user', (select auth.uid()), now(),
    jsonb_build_object('description', p_description, 'estimated_cost_cents', p_estimate));
end $$;

-- Vehicle-level (vehicle-states.md §5): pull from service = manual Maintenance hold; return = release holds
-- when nothing else blocks, or override (owner/admin, reason).
create function public.vehicle_pull_from_service(p_org uuid, p_vehicle uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_ops(p_org);
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Say why (3+ characters)' using errcode = '22023'; end if;
  if not exists (select 1 from public.vehicles where org_id = p_org and id = p_vehicle) then
    raise exception 'No such vehicle' using errcode = 'P0002';
  end if;
  insert into public.vehicle_holds (org_id, vehicle_id, reason, created_by) values (p_org, p_vehicle, trim(p_reason), (select auth.uid()));
  insert into public.audit_log (org_id, actor_id, action, target_type, target_id, detail)
  values (p_org, (select auth.uid()), 'vehicle.pull_from_service', 'vehicle', p_vehicle::text, jsonb_build_object('reason', p_reason));
end $$;

create function public.vehicle_return_to_service(p_org uuid, p_vehicle uuid, p_override boolean default false,
  p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_blocked text; v_uid uuid := (select auth.uid());
begin
  perform app.require_ops(p_org);
  if not exists (select 1 from public.vehicles where org_id = p_org and id = p_vehicle) then
    raise exception 'No such vehicle' using errcode = 'P0002';
  end if;
  -- Holds are what this action releases; anything else needs an override.
  update public.vehicle_holds set released_at = now(), released_by = v_uid
   where org_id = p_org and vehicle_id = p_vehicle and released_at is null;
  v_blocked := app.blocked_message(p_org, p_vehicle, null, null);
  if v_blocked is null then return; end if;
  if not coalesce(p_override, false) then raise exception '%', v_blocked using errcode = '22023'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'An override needs a reason' using errcode = '22023'; end if;
  if not app.has_role(p_org, array['owner', 'admin']::public.app_role[]) then
    raise exception 'Only owners and admins can override' using errcode = '42501';
  end if;
  perform app.override_blockers(p_org, p_vehicle, null, null, p_reason, v_uid, now());
end $$;

revoke all on function public.ticket_create(uuid, uuid, text, boolean, text, uuid, uuid, timestamptz, int) from public, anon;
revoke all on function public.ticket_action(uuid, uuid, text, uuid, timestamptz, int, text, boolean, text) from public, anon;
revoke all on function public.ticket_update(uuid, uuid, text, int) from public, anon;
revoke all on function public.vehicle_pull_from_service(uuid, uuid, text) from public, anon;
revoke all on function public.vehicle_return_to_service(uuid, uuid, boolean, text) from public, anon;
grant execute on function public.ticket_create(uuid, uuid, text, boolean, text, uuid, uuid, timestamptz, int) to authenticated;
grant execute on function public.ticket_action(uuid, uuid, text, uuid, timestamptz, int, text, boolean, text) to authenticated;
grant execute on function public.ticket_update(uuid, uuid, text, int) to authenticated;
grant execute on function public.vehicle_pull_from_service(uuid, uuid, text) to authenticated;
grant execute on function public.vehicle_return_to_service(uuid, uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- Engine (service role): SLA sweep every tick; the demo autopilot plays ops and vendors.
-- ---------------------------------------------------------------------------------------------------------
create function public.engine_sla_sweep(p_org uuid, p_now timestamptz) returns int
language plpgsql security definer set search_path = '' as $$
declare t public.tickets; n int := 0;
begin
  for t in select * from public.tickets
            where org_id = p_org and breached_at is null and sla_due_at < p_now
              and status not in ('completed', 'returned', 'cancelled') for update loop
    update public.tickets set breached_at = t.sla_due_at where id = t.id;
    perform app.ticket_event(t, 'sla_breached', 'system', null, t.sla_due_at);
    n := n + 1;
  end loop;
  return n;
end $$;

-- One call per step so the tick can replay simulated time: p_steps is a list of
-- {action: dispatch|arrive|complete, ...} applied in order.
create function public.engine_ticket_steps(p_org uuid, p_steps jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare s jsonb; v_id uuid; v_at timestamptz;
begin
  for s in select * from jsonb_array_elements(p_steps) loop
    v_at := (s->>'at')::timestamptz;
    -- Each step stands alone: one that no longer applies (a person acted meanwhile) is skipped, not fatal.
    begin
    case s->>'action'
      when 'dispatch' then
        -- Skip exceptions that already have a live ticket (a person got there first).
        if exists (select 1 from public.tickets where exception_id = (s->>'exception_id')::uuid
                   and status not in ('returned', 'cancelled')) then continue; end if;
        v_id := app.ticket_create(p_org, (s->>'vehicle_id')::uuid, s->>'type', (s->>'blocks_service')::boolean,
          s->>'description', (s->>'exception_id')::uuid, (s->>'estimate_cents')::int, 'rule', 'system', null, v_at);
        if s->>'vendor_id' is not null then
          perform app.ticket_assign(p_org, v_id, (s->>'vendor_id')::uuid, (s->>'eta_at')::timestamptz, 'system', null,
            v_at, 'simulator');
        end if;
      when 'arrive' then perform app.ticket_arrive(p_org, (s->>'ticket_id')::uuid, 'vendor', null, v_at);
      when 'complete' then
        perform app.ticket_complete(p_org, (s->>'ticket_id')::uuid, (s->>'cost_cents')::int, s->>'note', 'vendor', null, v_at);
        -- Autopilot tickets return the car unless something else still blocks it; a person's ticket waits for
        -- them to return it (flows.md F1).
        if coalesce((s->>'return')::boolean, false) and app.blocked_message(p_org, (s->>'vehicle_id')::uuid, (s->>'ticket_id')::uuid,
             (select exception_id from public.tickets where id = (s->>'ticket_id')::uuid)) is null then
          perform app.ticket_return(p_org, (s->>'ticket_id')::uuid, false, null, 'system', null, v_at);
        end if;
    end case;
    exception when sqlstate '22023' or sqlstate 'P0002' or unique_violation then
      raise warning 'autopilot step skipped: % (%)', sqlerrm, s;
    end;
  end loop;
end $$;
revoke all on function public.engine_sla_sweep(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.engine_ticket_steps(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.engine_sla_sweep(uuid, timestamptz) to service_role;
grant execute on function public.engine_ticket_steps(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------------------------------------
-- Read models (security invoker: RLS applies).
-- ---------------------------------------------------------------------------------------------------------
create view public.ticket_list with (security_invoker = true) as
select t.id, t.org_id, t.number, t.vehicle_id, v.number as vehicle_number, t.exception_id, t.type, t.status,
       t.blocks_service, t.detection_source, t.created_at, t.response_due_at, t.sla_due_at, t.breached_at,
       t.vendor_id, vd.name as vendor_name, t.dispatched_at, t.eta_at, t.arrived_at, t.completed_at, t.returned_at,
       t.cancelled_at, t.escalated_at, t.estimated_cost_cents, t.actual_cost_cents, t.baseline_rate_cents_per_h,
       t.description, t.policy_ref
from public.tickets t
join public.vehicles v on v.id = t.vehicle_id
left join public.vendors vd on vd.id = t.vendor_id;
revoke all on public.ticket_list from anon;
grant select on public.ticket_list to authenticated, service_role;

-- Vendor job metrics over 90 days (kpis.md §3.3), replacing the 5.6 stub.
create view public.vendor_job_metrics with (security_invoker = true) as
select j.org_id, j.vendor_id,
       count(*) filter (where j.completed_at is not null)::int as jobs_completed,
       avg(extract(epoch from (j.arrived_at - j.dispatched_at)) / 60) filter (where j.arrived_at is not null) as avg_response_min,
       percentile_cont(0.5) within group (order by extract(epoch from (j.arrived_at - j.dispatched_at)) / 60)
         filter (where j.arrived_at is not null) as median_response_min,
       avg(j.cost_cents) filter (where j.completed_at is not null) as avg_job_cost_cents,
       avg(case when t.completed_at <= t.sla_due_at then 1.0 else 0.0 end) filter (where j.completed_at is not null)
         as sla_compliance,
       avg(j.rating) as rating
from public.vendor_jobs j
join public.tickets t on t.id = j.ticket_id
where j.dispatched_at > now() - interval '90 days' and j.cancelled_at is null
group by j.org_id, j.vendor_id;
revoke all on public.vendor_job_metrics from anon;
grant select on public.vendor_job_metrics to authenticated, service_role;

-- Exceptions now show their ticket.
drop view public.exception_list;
create view public.exception_list with (security_invoker = true) as
select e.id, e.org_id, e.vehicle_id, v.number as vehicle_number, e.hub_id, e.rule_id, e.type, e.class, e.severity,
       e.status, e.title, e.description, e.detected_at, e.location_name,
       extensions.st_y(e.location::extensions.geometry) as lat, extensions.st_x(e.location::extensions.geometry) as lng,
       e.blocks_service, e.expected_downtime_min, e.baseline_rate_cents_per_h, e.recommended_action,
       e.owner_user_id, p.full_name as owner_name, e.trigger, e.cleared_at, e.resolved_at, e.created_at,
       tk.id as ticket_id, tk.number as ticket_number
from public.exceptions e
left join public.vehicles v on v.id = e.vehicle_id
left join public.profiles p on p.user_id = e.owner_user_id
left join lateral (
  select t.id, t.number from public.tickets t where t.exception_id = e.id
  order by (t.status = 'cancelled'), t.created_at desc limit 1
) tk on true;
revoke all on public.exception_list from anon;
grant select on public.exception_list to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------
-- Attachments (PRD SV-4, NFR SEC-8): photos and PDFs on a ticket, in a private bucket under
-- {org_id}/tickets/{ticket_id}/…; opened through short-lived signed URLs.
-- ---------------------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ticket-attachments', 'ticket-attachments', false, 20971520,
        array['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy ticket_attachments_read on storage.objects for select to authenticated
  using (bucket_id = 'ticket-attachments'
         and (storage.foldername(name))[1]::uuid in (select app.user_org_ids()));
create policy ticket_attachments_write on storage.objects for insert to authenticated
  with check (bucket_id = 'ticket-attachments'
              and app.has_role((storage.foldername(name))[1]::uuid, array['owner', 'admin', 'ops']::public.app_role[]));

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  ticket_id uuid not null,
  storage_path text not null unique,
  filename text not null check (length(filename) between 1 and 200),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/heic', 'image/heif', 'application/pdf')),
  size_bytes int not null check (size_bytes between 1 and 20971520),
  uploaded_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (org_id, ticket_id) references public.tickets (org_id, id) on delete cascade,
  -- The file must sit under the ticket's own folder.
  check (storage_path like org_id::text || '/tickets/' || ticket_id::text || '/%')
);
create index attachments_ticket_idx on public.attachments (ticket_id, created_at);
alter table public.attachments enable row level security;
create policy attachments_select on public.attachments for select to authenticated
  using (org_id in (select app.user_org_ids()));
create policy attachments_insert on public.attachments for insert to authenticated
  with check (app.has_role(org_id, array['owner', 'admin', 'ops']::public.app_role[]) and uploaded_by = (select auth.uid()));
revoke all on public.attachments from anon;
revoke update, delete on public.attachments from authenticated;

-- Uploads show in the ticket's activity (flows.md SV-4).
create function app.log_attachment() returns trigger language plpgsql security definer set search_path = '' as $$
declare t public.tickets;
begin
  select * into t from public.tickets where id = new.ticket_id;
  perform app.ticket_event(t, 'attachment_added', 'user', new.uploaded_by, new.created_at,
    jsonb_build_object('filename', new.filename, 'attachment_id', new.id));
  return null;
end $$;
create trigger attachments_log after insert on public.attachments for each row execute function app.log_attachment();
