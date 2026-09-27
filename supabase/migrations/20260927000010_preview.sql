-- Preview capabilities (task 3.9, ADR-0006, roadmap §3a): storage for the simulated stand-ins that preview
-- endpoints serve in demo orgs. Real feeds (platform trips/earnings, cabin camera, autonomy events, network
-- dispatch) will write the same tables with their own `source`.

-- Cabin cleanliness events. 'simulator' = SUBSTITUTE(cabin_events, simulated).
create table public.cabin_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  vehicle_id uuid not null,
  at timestamptz not null,
  kind text not null check (kind in ('spill', 'debris', 'lost_item', 'odor', 'damage', 'other')),
  confidence numeric(4, 3) check (confidence between 0 and 1),
  ride_id uuid references public.rides (id) on delete set null,
  source text not null check (source in ('simulator', 'platform', 'manual')),
  external_id text not null,
  created_at timestamptz not null default now(),
  foreign key (org_id, vehicle_id) references public.vehicles (org_id, id) on delete cascade,
  unique (org_id, source, external_id)
);
create index cabin_events_vehicle_idx on public.cabin_events (org_id, vehicle_id, at desc);

-- Autonomy events (disengagements, remote assist, incidents, stuck). 'simulator' = SUBSTITUTE(autonomy_events, simulated).
create table public.autonomy_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  vehicle_id uuid not null,
  at timestamptz not null,
  kind text not null check (kind in ('disengagement', 'remote_assist', 'incident', 'stuck')),
  lat double precision,
  lng double precision,
  severity text check (severity in ('critical', 'high', 'medium', 'low')),
  detail text,
  source text not null check (source in ('simulator', 'platform')),
  external_id text not null,
  created_at timestamptz not null default now(),
  foreign key (org_id, vehicle_id) references public.vehicles (org_id, id) on delete cascade,
  unique (org_id, source, external_id)
);
create index autonomy_events_vehicle_idx on public.autonomy_events (org_id, vehicle_id, at desc);

-- Network availability set from FleetOS. In demo orgs this is the simulated network: SUBSTITUTE(dispatch, simulated).
create table public.dispatch_overrides (
  org_id uuid not null,
  vehicle_id uuid primary key,
  on_network boolean not null,
  reason text check (length(reason) <= 500),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  foreign key (org_id, vehicle_id) references public.vehicles (org_id, id) on delete cascade
);

alter table public.cabin_events enable row level security;
alter table public.autonomy_events enable row level security;
alter table public.dispatch_overrides enable row level security;
create policy cabin_events_select on public.cabin_events for select to authenticated
  using (org_id in (select app.user_org_ids()));
create policy autonomy_events_select on public.autonomy_events for select to authenticated
  using (org_id in (select app.user_org_ids()));
create policy dispatch_overrides_select on public.dispatch_overrides for select to authenticated
  using (org_id in (select app.user_org_ids()));
-- Taking cars on/off the network: owner, admin, ops (like pull-from-service).
create policy dispatch_overrides_write on public.dispatch_overrides for all to authenticated
  using (app.has_role(org_id, array['owner', 'admin', 'ops']::public.app_role[]))
  with check (
    app.has_role(org_id, array['owner', 'admin', 'ops']::public.app_role[])
    and (updated_by is null or updated_by = (select auth.uid()))
  );
revoke insert, update, delete on public.cabin_events, public.autonomy_events from authenticated;
revoke all on public.cabin_events, public.autonomy_events, public.dispatch_overrides from anon;

-- Rides with coordinates (the API can't read geography columns directly). Security invoker: rides' RLS applies.
create view public.ride_list with (security_invoker = true) as
select
  r.id, r.org_id, r.vehicle_id, r.started_at, r.ended_at, r.distance_m, r.fare_cents, r.platform_fee_cents, r.source,
  extensions.st_y(r.pickup::extensions.geometry) as pickup_lat,
  extensions.st_x(r.pickup::extensions.geometry) as pickup_lng,
  extensions.st_y(r.dropoff::extensions.geometry) as dropoff_lat,
  extensions.st_x(r.dropoff::extensions.geometry) as dropoff_lng
from public.rides r;
revoke all on public.ride_list from anon;
grant select on public.ride_list to authenticated, service_role;

-- Per-vehicle earnings from rides over a period (the `earnings` preview endpoint).
create function public.ride_totals(p_org uuid, p_vehicle uuid, p_from timestamptz, p_to timestamptz)
returns table (gross_cents bigint, platform_fee_cents bigint, trips bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(r.fare_cents), 0)::bigint, coalesce(sum(r.platform_fee_cents), 0)::bigint, count(*)
  from public.rides r
  where r.org_id = p_org and r.vehicle_id = p_vehicle and r.ended_at >= p_from and r.ended_at < p_to
$$;
revoke all on function public.ride_totals(uuid, uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.ride_totals(uuid, uuid, timestamptz, timestamptz) to authenticated, service_role;
