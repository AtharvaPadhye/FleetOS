-- Money: rides, one ledger for every revenue and cost line, payout CSV imports (roadmap task 3.6,
-- erd.md §3.3, kpis.md §3.2). Contribution = revenue − variable costs; fixed allocations sit below it.

create table public.rides (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  vehicle_id uuid not null,
  external_id text not null,
  started_at timestamptz not null,
  ended_at timestamptz not null check (ended_at >= started_at),
  distance_m numeric(10, 1) not null check (distance_m >= 0),
  fare_cents bigint not null check (fare_cents >= 0),
  platform_fee_cents bigint not null default 0 check (platform_fee_cents >= 0),
  pickup extensions.geography(Point, 4326),
  dropoff extensions.geography(Point, 4326),
  -- 'simulator' = SUBSTITUTE(rides, simulated); 'platform' = a real trip feed when one exists.
  source text not null check (source in ('simulator', 'platform', 'csv')),
  created_at timestamptz not null default now(),
  foreign key (org_id, vehicle_id) references public.vehicles (org_id, id) on delete cascade,
  unique (org_id, source, external_id)
);
create index rides_org_ended_idx on public.rides (org_id, ended_at desc);
create index rides_vehicle_ended_idx on public.rides (vehicle_id, ended_at desc);

create table public.revenue_imports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  filename text not null,
  layout text not null check (layout in ('uber_fleet_portal', 'custom')),
  mapping jsonb not null default '{}'::jsonb,
  status text not null check (status in ('validating', 'ready', 'imported', 'failed')),
  rows_total int not null default 0,
  rows_valid int not null default 0,
  rows_imported int,
  rows_already_imported int,
  errors jsonb not null default '[]'::jsonb,
  -- Kept so a validated import can be committed later; payout CSVs are small (≤ 5 MB enforced in the app).
  raw_text text not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  committed_at timestamptz,
  unique (org_id, id)
);

create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  vehicle_id uuid,
  hub_id uuid,
  occurred_on date not null,
  occurred_at timestamptz,
  category text not null check (category in (
    'gross_ride_revenue', 'platform_fee', 'electricity', 'cleaning', 'maintenance', 'roadside',
    'other_variable', 'insurance', 'financing')),
  amount_cents bigint not null check (amount_cents >= 0), -- sign comes from the category type
  source text not null check (source in (
    'csv', 'simulator', 'earnings_api', 'tesla_charging', 'depot_inferred', 'ocpp', 'ticket', 'allocation', 'manual')),
  source_ref text,
  import_id uuid,
  note text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (org_id, vehicle_id) references public.vehicles (org_id, id) on delete cascade,
  foreign key (org_id, hub_id) references public.hubs (org_id, id) on delete set null (hub_id),
  foreign key (org_id, import_id) references public.revenue_imports (org_id, id) on delete set null (import_id),
  unique (org_id, source, source_ref) -- idempotent imports and ticks (flows.md F4, NFR REL-3)
);
create index ledger_org_day_idx on public.ledger_entries (org_id, occurred_on);
create index ledger_vehicle_day_idx on public.ledger_entries (vehicle_id, occurred_on);

alter table public.rides enable row level security;
alter table public.revenue_imports enable row level security;
alter table public.ledger_entries enable row level security;

-- Rides: members read (trip counts, fares); only the engine writes.
create policy rides_select on public.rides for select to authenticated
  using (org_id in (select app.user_org_ids()));
revoke insert, update, delete on public.rides from anon, authenticated;

-- Money is for owner / admin / finance (NFR RBAC). Automatic lines are written by the engine (service role).
create policy ledger_select on public.ledger_entries for select to authenticated
  using (app.has_role(org_id, array['owner', 'admin', 'finance']::public.app_role[]));
create policy ledger_insert on public.ledger_entries for insert to authenticated
  with check (
    app.has_role(org_id, array['owner', 'admin', 'finance']::public.app_role[])
    and source in ('csv', 'manual')
    and (created_by is null or created_by = (select auth.uid()))
  );
create policy revenue_imports_all on public.revenue_imports for all to authenticated
  using (app.has_role(org_id, array['owner', 'admin', 'finance']::public.app_role[]))
  with check (app.has_role(org_id, array['owner', 'admin', 'finance']::public.app_role[]));
revoke update, delete on public.ledger_entries from authenticated; -- corrections are new lines, not edits
revoke all on public.rides, public.revenue_imports, public.ledger_entries from anon;
