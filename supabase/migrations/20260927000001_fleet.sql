-- Fleet, hubs and telemetry tables (roadmap task 3.2, docs/architecture/erd.md §3.2, ADR-0009).
-- Rules: org_id + RLS everywhere; child rows reference parents by (org_id, id) so a row can never point at
-- another org's hub or vehicle; live/derived tables are written only by the engine (service role).

create extension if not exists postgis with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- ---------------------------------------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------------------------------------
create type public.vehicle_status as enum
  ('in_service', 'ready', 'charging', 'cleaning', 'maintenance', 'incident', 'offline'); -- vehicle-states.md
create type public.vehicle_lifecycle as enum ('pending', 'commissioned', 'retired');

-- ---------------------------------------------------------------------------------------------------------
-- Tariffs & hubs
-- ---------------------------------------------------------------------------------------------------------
create table public.tariffs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  name text not null,
  -- 'urdb' = published utility rate (SUBSTITUTE(live_tariffs, static)); 'arcadia' = live feed later (ADR-0015).
  source text not null default 'manual' check (source in ('manual', 'urdb', 'arcadia')),
  external_id text,
  -- Time-of-use periods, e.g. [{"days":[1,2,3,4,5],"from":"15:00","to":"19:00","cents_per_kwh":22.4}, …]
  schedule jsonb not null default '[]'::jsonb check (jsonb_typeof(schedule) = 'array'),
  valid_from date not null default current_date,
  created_at timestamptz not null default now(),
  unique (org_id, id)
);

create table public.hubs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  address text,
  location extensions.geography(Point, 4326) not null,
  geofence extensions.geography(Polygon, 4326),
  exit_buffer_m int not null default 50 check (exit_buffer_m between 0 and 500), -- hysteresis, vehicle-states.md §6
  operating_hours jsonb not null default '{}'::jsonb,
  tariff_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, name),
  foreign key (org_id, tariff_id) references public.tariffs (org_id, id)
);
create index hubs_geofence_gix on public.hubs using gist (geofence);

create table public.hub_chargers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  hub_id uuid not null,
  label text not null,
  max_kw numeric(6, 1) not null check (max_kw > 0),
  connector text not null default 'NACS',
  ocpp_charge_point_id text, -- set when depot telemetry exists (capability charger_telemetry)
  created_at timestamptz not null default now(),
  foreign key (org_id, hub_id) references public.hubs (org_id, id) on delete cascade,
  unique (hub_id, label)
);

create table public.hub_bays (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  hub_id uuid not null,
  kind text not null check (kind in ('cleaning', 'maintenance', 'parking')),
  label text not null,
  created_at timestamptz not null default now(),
  foreign key (org_id, hub_id) references public.hubs (org_id, id) on delete cascade,
  unique (hub_id, label)
);

-- ---------------------------------------------------------------------------------------------------------
-- Vehicles
-- ---------------------------------------------------------------------------------------------------------
create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  vin text not null check (vin ~ '^[A-HJ-NPR-Z0-9]{17}$'), -- check digit validated in packages/domain (PRD FL-5)
  number text not null check (number ~ '^[A-Za-z0-9-]{1,12}$'),
  display_name text,
  model text,
  home_hub_id uuid,
  provider text not null default 'simulator' check (provider in ('simulator', 'tesla')),
  provider_ref text,
  lifecycle public.vehicle_lifecycle not null default 'commissioned',
  commissioned_at timestamptz,
  retired_at timestamptz,
  purchase_price_cents bigint check (purchase_price_cents >= 0),
  insurance_monthly_cents bigint check (insurance_monthly_cents >= 0),
  financing_monthly_cents bigint check (financing_monthly_cents >= 0),
  virtual_key_paired boolean,
  telemetry_synced boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, vin),
  unique (org_id, number),
  foreign key (org_id, home_hub_id) references public.hubs (org_id, id) on delete set null (home_hub_id),
  check (retired_at is null or commissioned_at is null or retired_at >= commissioned_at)
);

-- Live state: one row per vehicle (engine-written; drives live screens and Realtime).
create table public.vehicle_state_current (
  vehicle_id uuid primary key,
  org_id uuid not null,
  status public.vehicle_status not null,
  status_since timestamptz not null,
  soc numeric(5, 4) check (soc between 0 and 1),
  range_m numeric(10, 1),
  charge_state text,
  charge_power_kw numeric(6, 1),
  charge_limit_soc numeric(5, 4) check (charge_limit_soc between 0 and 1),
  location extensions.geography(Point, 4326),
  heading numeric(5, 1),
  speed_mps numeric(6, 2),
  gear text,
  odometer_m numeric(12, 1),
  locked boolean,
  tpms jsonb,
  inside_temp_c numeric(4, 1),
  outside_temp_c numeric(4, 1),
  connectivity text not null default 'offline' check (connectivity in ('online', 'asleep', 'offline')),
  current_hub_id uuid,
  last_telemetry_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (org_id, vehicle_id) references public.vehicles (org_id, id) on delete cascade,
  foreign key (org_id, current_hub_id) references public.hubs (org_id, id) on delete set null (current_hub_id)
);
create index vehicle_state_org_status_idx on public.vehicle_state_current (org_id, status);

-- Every committed status change; the source of all hour-based KPIs (kpis.md §2).
create table public.vehicle_status_events (
  id bigint generated always as identity primary key,
  org_id uuid not null,
  vehicle_id uuid not null,
  from_status public.vehicle_status,
  to_status public.vehicle_status not null,
  at timestamptz not null,
  cause_type text not null check (cause_type in ('telemetry', 'ticket', 'exception', 'policy', 'manual', 'platform')),
  cause_id uuid,
  detail text,
  foreign key (org_id, vehicle_id) references public.vehicles (org_id, id) on delete cascade
);
create index vehicle_status_events_vehicle_at_idx on public.vehicle_status_events (org_id, vehicle_id, at desc);

create table public.vehicle_alerts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  vehicle_id uuid not null,
  name text not null,
  audiences text[] not null default '{}',
  started_at timestamptz not null,
  ended_at timestamptz,
  source text not null check (source in ('telemetry', 'recent_alerts', 'simulator')),
  foreign key (org_id, vehicle_id) references public.vehicles (org_id, id) on delete cascade,
  unique (vehicle_id, name, started_at)
);
create index vehicle_alerts_active_idx on public.vehicle_alerts (org_id, vehicle_id) where ended_at is null;

-- Manual "pull from service" (vehicle-states.md §5).
create table public.vehicle_holds (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  vehicle_id uuid not null,
  kind text not null default 'pull_from_service' check (kind in ('pull_from_service')),
  reason text not null check (length(trim(reason)) >= 3),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  released_at timestamptz,
  released_by uuid references auth.users (id) on delete set null,
  foreign key (org_id, vehicle_id) references public.vehicles (org_id, id) on delete cascade
);
create index vehicle_holds_active_idx on public.vehicle_holds (org_id, vehicle_id) where released_at is null;

create table public.battery_health_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  vehicle_id uuid not null,
  taken_at timestamptz not null,
  soh_pct numeric(5, 2) not null check (soh_pct between 0 and 100),
  capacity_kwh numeric(6, 2),
  source text not null check (source in ('tesla_specs', 'simulator')),
  foreign key (org_id, vehicle_id) references public.vehicles (org_id, id) on delete cascade,
  unique (vehicle_id, taken_at)
);

-- ---------------------------------------------------------------------------------------------------------
-- Telemetry (ADR-0009): raw samples partitioned by day, kept 30 days; rollups kept longer.
-- ---------------------------------------------------------------------------------------------------------
create table public.telemetry_samples (
  org_id uuid not null,
  vehicle_id uuid not null,
  field text not null,
  ts timestamptz not null,
  value_num double precision,
  value_text text,
  value_geo extensions.geography(Point, 4326),
  primary key (vehicle_id, field, ts) -- doubles as the dedupe key (NFR REL-3)
) partition by range (ts);
create index telemetry_samples_org_ts_idx on public.telemetry_samples (org_id, ts);

create table public.telemetry_rollup_1m (
  org_id uuid not null,
  vehicle_id uuid not null,
  field text not null,
  bucket timestamptz not null,
  min double precision, max double precision, avg double precision, last double precision,
  count int not null,
  primary key (vehicle_id, field, bucket)
);
create table public.telemetry_rollup_1h (like public.telemetry_rollup_1m including all);

-- Create daily partitions for [p_from, p_from + p_days). Idempotent. Each partition gets RLS too.
create or replace function app.ensure_telemetry_partitions(p_from date default current_date, p_days int default 7)
returns int language plpgsql security definer set search_path = ''
as $$
declare d date; name text; created int := 0;
begin
  for i in 0 .. p_days - 1 loop
    d := p_from + i;
    name := 'telemetry_samples_' || to_char(d, 'YYYYMMDD');
    if to_regclass('public.' || name) is null then
      execute format(
        'create table public.%I partition of public.telemetry_samples for values from (%L) to (%L)',
        name, d::timestamptz, (d + 1)::timestamptz);
      execute format('alter table public.%I enable row level security', name);
      execute format('revoke all on public.%I from anon, authenticated', name);
      created := created + 1;
    end if;
  end loop;
  return created;
end $$;

-- Drop daily partitions whose whole day is older than p_keep_days (NFR RET: raw telemetry 30 days).
create or replace function app.drop_old_telemetry_partitions(p_keep_days int default 30)
returns int language plpgsql security definer set search_path = ''
as $$
declare r record; dropped int := 0; cutoff date := current_date - p_keep_days;
begin
  for r in
    select c.relname from pg_catalog.pg_inherits i
    join pg_catalog.pg_class c on c.oid = i.inhrelid
    join pg_catalog.pg_class p on p.oid = i.inhparent
    where p.relname = 'telemetry_samples' and c.relname ~ '^telemetry_samples_[0-9]{8}$'
  loop
    if to_date(right(r.relname, 8), 'YYYYMMDD') < cutoff then
      execute format('drop table public.%I', r.relname);
      dropped := dropped + 1;
    end if;
  end loop;
  return dropped;
end $$;

revoke all on function app.ensure_telemetry_partitions(date, int) from public, anon, authenticated;
revoke all on function app.drop_old_telemetry_partitions(int) from public, anon, authenticated;

select app.ensure_telemetry_partitions(current_date - 1, 9); -- yesterday through a week ahead

-- Daily partition maintenance (pg_cron is free and built in; ADR-0014).
select cron.schedule('telemetry-partitions', '5 0 * * *',
  $$ select app.ensure_telemetry_partitions(current_date, 7); select app.drop_old_telemetry_partitions(30); $$);

-- ---------------------------------------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------------------------------------
create trigger hubs_updated_at before update on public.hubs for each row execute function app.set_updated_at();
create trigger vehicles_updated_at before update on public.vehicles for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------------------------------------
-- Row-level security (erd.md §4)
-- ---------------------------------------------------------------------------------------------------------
alter table public.tariffs enable row level security;
alter table public.hubs enable row level security;
alter table public.hub_chargers enable row level security;
alter table public.hub_bays enable row level security;
alter table public.vehicles enable row level security;
alter table public.vehicle_state_current enable row level security;
alter table public.vehicle_status_events enable row level security;
alter table public.vehicle_alerts enable row level security;
alter table public.vehicle_holds enable row level security;
alter table public.battery_health_snapshots enable row level security;
alter table public.telemetry_samples enable row level security;
alter table public.telemetry_rollup_1m enable row level security;
alter table public.telemetry_rollup_1h enable row level security;

-- Members read everything in their orgs.
do $$
declare t text;
begin
  foreach t in array array[
    'tariffs', 'hubs', 'hub_chargers', 'hub_bays', 'vehicles', 'vehicle_state_current', 'vehicle_status_events',
    'vehicle_alerts', 'vehicle_holds', 'battery_health_snapshots', 'telemetry_rollup_1m', 'telemetry_rollup_1h'
  ] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (org_id in (select app.user_org_ids()))',
      t || '_select', t);
  end loop;
end $$;

-- Raw telemetry includes precise location history: owner/admin/ops only (NFR PRV-2).
create policy telemetry_samples_select on public.telemetry_samples for select to authenticated
  using (app.has_role(org_id, array['owner', 'admin', 'ops']::public.app_role[]));

-- Fleet configuration writes.
create policy tariffs_write on public.tariffs for all to authenticated
  using (app.has_role(org_id, array['owner', 'admin']::public.app_role[]))
  with check (app.has_role(org_id, array['owner', 'admin']::public.app_role[]));
create policy vehicles_write on public.vehicles for all to authenticated
  using (app.has_role(org_id, array['owner', 'admin']::public.app_role[]))
  with check (app.has_role(org_id, array['owner', 'admin']::public.app_role[]));
do $$
declare t text;
begin
  foreach t in array array['hubs', 'hub_chargers', 'hub_bays'] loop
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (app.has_role(org_id, array[''owner'', ''admin'', ''ops'']::public.app_role[]))
         with check (app.has_role(org_id, array[''owner'', ''admin'', ''ops'']::public.app_role[]))',
      t || '_write', t);
  end loop;
end $$;

-- Pull from service / release: owner, admin, ops.
create policy vehicle_holds_write on public.vehicle_holds for all to authenticated
  using (app.has_role(org_id, array['owner', 'admin', 'ops']::public.app_role[]))
  with check (app.has_role(org_id, array['owner', 'admin', 'ops']::public.app_role[]));

-- Engine-only tables: no insert/update/delete policies for users (the service role bypasses RLS).
revoke insert, update, delete on public.vehicle_state_current, public.vehicle_status_events, public.vehicle_alerts,
  public.battery_health_snapshots, public.telemetry_samples, public.telemetry_rollup_1m, public.telemetry_rollup_1h
  from anon, authenticated;
revoke all on all tables in schema public from anon;
