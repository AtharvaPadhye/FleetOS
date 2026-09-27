-- Engine + per-minute tick (roadmap task 3.5, ADR-0014).

-- Debounce memory and alert state kept with each vehicle's live row (vehicle-states.md §6).
alter table public.vehicle_state_current
  add column candidate_status public.vehicle_status,
  add column candidate_since timestamptz,
  add column active_alerts text[] not null default '{}';

-- One simulator per demo org, saved after every tick and restored on the next (ADR-0014: the tick runs
-- on serverless hosts that keep no memory). Server-only: no user policies.
create table public.simulator_state (
  org_id uuid primary key references public.orgs (id) on delete cascade,
  seed int not null,
  started_at timestamptz not null,
  last_tick_at timestamptz not null,
  snapshot jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.simulator_state enable row level security;
revoke all on public.simulator_state from anon, authenticated;

-- Last tick per org, for idempotency and the freshness indicator. Members can read their org's row.
create table public.engine_runs (
  org_id uuid primary key references public.orgs (id) on delete cascade,
  last_tick_at timestamptz not null,
  last_duration_ms int,
  last_counts jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.engine_runs enable row level security;
create policy engine_runs_select on public.engine_runs for select to authenticated
  using (org_id in (select app.user_org_ids()));
revoke insert, update, delete on public.engine_runs from anon, authenticated;

-- Live updates via Postgres Changes (ADR-0014 prototype; Broadcast batching comes with the worker in Phase 4).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.vehicle_state_current, public.vehicle_status_events;
  end if;
end $$;

-- Hub radius (used when no geofence polygon is drawn; simulator hubs are circles).
alter table public.hubs add column radius_m int not null default 150 check (radius_m between 20 and 2000);

-- A retried tick must not duplicate history (NFR REL-3).
create unique index vehicle_status_events_dedupe_idx on public.vehicle_status_events (vehicle_id, at, to_status);

-- Server-only readers for the engine: geography comes back as lat/lng (PostgREST returns it as WKB).
create or replace function public.engine_hubs(p_org uuid)
returns table (id uuid, lat double precision, lng double precision, radius_m int, exit_buffer_m int)
language sql stable security definer set search_path = ''
as $$
  select h.id, extensions.st_y(h.location::extensions.geometry), extensions.st_x(h.location::extensions.geometry),
         h.radius_m, h.exit_buffer_m
  from public.hubs h where h.org_id = p_org;
$$;

create or replace function public.engine_live_state(p_org uuid)
returns table (
  vehicle_id uuid, status public.vehicle_status, status_since timestamptz,
  candidate_status public.vehicle_status, candidate_since timestamptz,
  soc numeric, range_m numeric, charge_state text, charge_power_kw numeric, charge_limit_soc numeric,
  lat double precision, lng double precision, heading numeric, speed_mps numeric, gear text, odometer_m numeric,
  locked boolean, tpms jsonb, inside_temp_c numeric, outside_temp_c numeric, connectivity text,
  current_hub_id uuid, last_telemetry_at timestamptz, active_alerts text[]
)
language sql stable security definer set search_path = ''
as $$
  select s.vehicle_id, s.status, s.status_since, s.candidate_status, s.candidate_since,
         s.soc, s.range_m, s.charge_state, s.charge_power_kw, s.charge_limit_soc,
         extensions.st_y(s.location::extensions.geometry), extensions.st_x(s.location::extensions.geometry),
         s.heading, s.speed_mps, s.gear, s.odometer_m, s.locked, s.tpms, s.inside_temp_c, s.outside_temp_c,
         s.connectivity, s.current_hub_id, s.last_telemetry_at, s.active_alerts
  from public.vehicle_state_current s where s.org_id = p_org;
$$;

revoke all on function public.engine_hubs(uuid) from public, anon, authenticated;
revoke all on function public.engine_live_state(uuid) from public, anon, authenticated;
grant execute on function public.engine_hubs(uuid) to service_role;
grant execute on function public.engine_live_state(uuid) to service_role;

-- The tick calls this before writing samples, so a day's partition always exists (service role only).
create or replace function public.engine_ensure_partitions()
returns int language sql security definer set search_path = ''
as $$ select app.ensure_telemetry_partitions(current_date - 1, 3); $$;
revoke all on function public.engine_ensure_partitions() from public, anon, authenticated;
grant execute on function public.engine_ensure_partitions() to service_role;

-- pg_net lets pg_cron call the tick endpoint over HTTP (ADR-0014). The schedule itself is environment-specific:
-- local dev registers it in supabase/seed.sql; hosted projects register it at deploy time.
create extension if not exists pg_net with schema extensions;
