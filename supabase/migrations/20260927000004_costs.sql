-- Costs (roadmap task 3.7, erd.md §3.3, kpis.md §3.2): charging sessions priced by the hub's tariff post
-- `electricity` ledger lines; vendor jobs post cleaning / maintenance / roadside; monthly insurance and
-- financing are allocated per vehicle-day. All of it lands in the one ledger (ledger_entries).

create table public.charging_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  vehicle_id uuid not null,
  hub_id uuid,
  started_at timestamptz not null,
  ended_at timestamptz not null check (ended_at >= started_at),
  energy_kwh numeric(8, 2) not null check (energy_kwh >= 0),
  cost_cents bigint not null check (cost_cents >= 0),
  -- 'simulator' = SUBSTITUTE(tesla, simulated); the others arrive with Tesla charging history / depot chargers.
  source text not null check (source in ('simulator', 'tesla_supercharger', 'depot_inferred', 'ocpp')),
  external_id text not null,
  created_at timestamptz not null default now(),
  foreign key (org_id, vehicle_id) references public.vehicles (org_id, id) on delete cascade,
  foreign key (org_id, hub_id) references public.hubs (org_id, id) on delete set null (hub_id),
  unique (org_id, source, external_id),
  unique (org_id, id)
);
create index charging_sessions_vehicle_idx on public.charging_sessions (vehicle_id, started_at desc);
create index charging_sessions_org_idx on public.charging_sessions (org_id, started_at desc);

alter table public.ledger_entries add column charging_session_id uuid;
alter table public.ledger_entries
  add foreign key (org_id, charging_session_id) references public.charging_sessions (org_id, id)
  on delete set null (charging_session_id);

-- Members read charging history (energy, timing, cost from the hub's tariff, which members can already see).
-- Only the engine writes (service role bypasses RLS).
alter table public.charging_sessions enable row level security;
create policy charging_sessions_select on public.charging_sessions for select to authenticated
  using (org_id in (select app.user_org_ids()));
revoke insert, update, delete on public.charging_sessions from authenticated;
revoke all on public.charging_sessions from anon;
