-- KPI rollups (task 3.8c, kpis.md §2): hours each vehicle spent in each status per local service day, so
-- availability / uptime / utilisation over any period is a sum instead of a replay of status history.
-- Money is not copied here: it stays in the ledger and is aggregated on demand (ledger_vehicle_totals), so the
-- ledger's money-role RLS keeps applying while hours stay visible to every member.

create table public.vehicle_day_hours (
  org_id uuid not null,
  vehicle_id uuid not null,
  day date not null, -- the org's local calendar day
  in_service_h numeric(6, 3) not null default 0,
  ready_h numeric(6, 3) not null default 0,
  charging_h numeric(6, 3) not null default 0,
  cleaning_h numeric(6, 3) not null default 0,
  maintenance_h numeric(6, 3) not null default 0,
  incident_h numeric(6, 3) not null default 0,
  offline_h numeric(6, 3) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (vehicle_id, day),
  foreign key (org_id, vehicle_id) references public.vehicles (org_id, id) on delete cascade
);
create index vehicle_day_hours_org_day_idx on public.vehicle_day_hours (org_id, day);

alter table public.vehicle_day_hours enable row level security;
create policy vehicle_day_hours_select on public.vehicle_day_hours for select to authenticated
  using (org_id in (select app.user_org_ids()));
revoke insert, update, delete on public.vehicle_day_hours from authenticated;
revoke all on public.vehicle_day_hours from anon;

-- Hours per status for one org-day, inside the org's service window, up to now. Same rule as
-- packages/domain statusHours(): the status in force at the window start comes from the last change at or
-- before it; time before a vehicle's first known change isn't counted.
create function app.refresh_vehicle_day_hours(p_org uuid, p_day date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tz text;
  v_start time;
  v_end time;
  w0 timestamptz;
  w1 timestamptz;
begin
  select o.timezone, o.service_start, o.service_end into v_tz, v_start, v_end from public.orgs o where o.id = p_org;
  if v_tz is null then
    return;
  end if;
  w0 := (p_day + v_start) at time zone v_tz;
  w1 := case when v_end > v_start then (p_day + v_end) at time zone v_tz
             else ((p_day + 1) + v_end) at time zone v_tz end; -- overnight service window
  w1 := least(w1, now());
  if w1 <= w0 then
    return;
  end if;

  insert into public.vehicle_day_hours as t (
    org_id, vehicle_id, day, in_service_h, ready_h, charging_h, cleaning_h, maintenance_h, incident_h, offline_h, updated_at)
  with ev as (
    select v.id as vehicle_id, w0 as t0, o.to_status
    from public.vehicles v
    cross join lateral (
      select e.to_status from public.vehicle_status_events e
      where e.org_id = p_org and e.vehicle_id = v.id and e.at <= w0
      order by e.at desc, e.id desc limit 1
    ) o
    where v.org_id = p_org
    union all
    select e.vehicle_id, e.at, e.to_status
    from public.vehicle_status_events e
    where e.org_id = p_org and e.at > w0 and e.at < w1
  ),
  seg as (
    select vehicle_id, to_status, t0, coalesce(lead(t0) over (partition by vehicle_id order by t0), w1) as t1 from ev
  ),
  h as (
    select vehicle_id, to_status, sum(extract(epoch from (t1 - t0))) / 3600.0 as hrs
    from seg where t1 > t0 group by vehicle_id, to_status
  )
  select p_org, vehicle_id, p_day,
    coalesce(sum(hrs) filter (where to_status = 'in_service'), 0),
    coalesce(sum(hrs) filter (where to_status = 'ready'), 0),
    coalesce(sum(hrs) filter (where to_status = 'charging'), 0),
    coalesce(sum(hrs) filter (where to_status = 'cleaning'), 0),
    coalesce(sum(hrs) filter (where to_status = 'maintenance'), 0),
    coalesce(sum(hrs) filter (where to_status = 'incident'), 0),
    coalesce(sum(hrs) filter (where to_status = 'offline'), 0),
    now()
  from h group by vehicle_id
  on conflict (vehicle_id, day) do update set
    in_service_h = excluded.in_service_h, ready_h = excluded.ready_h, charging_h = excluded.charging_h,
    cleaning_h = excluded.cleaning_h, maintenance_h = excluded.maintenance_h, incident_h = excluded.incident_h,
    offline_h = excluded.offline_h, updated_at = excluded.updated_at;
end;
$$;
revoke all on function app.refresh_vehicle_day_hours(uuid, date) from public, anon, authenticated;

-- Called by the engine tick: refreshes from the last refreshed day (so yesterday gets finished after
-- midnight and a paused tick catches up, at most 31 days back) through today.
create function public.engine_refresh_day_hours(p_org uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date;
  v_from date;
  d date;
  n int := 0;
begin
  select (now() at time zone o.timezone)::date into v_today from public.orgs o where o.id = p_org;
  if v_today is null then
    return 0;
  end if;
  select coalesce(max(h.day), (select min(e.at) at time zone o.timezone from public.vehicle_status_events e where e.org_id = p_org)::date, v_today)
    into v_from
    from public.orgs o left join public.vehicle_day_hours h on h.org_id = o.id
    where o.id = p_org
    group by o.timezone;
  v_from := greatest(v_from, v_today - 31);
  d := v_from;
  while d <= v_today loop
    perform app.refresh_vehicle_day_hours(p_org, d);
    n := n + 1;
    d := d + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.engine_refresh_day_hours(uuid) from public, anon, authenticated;
grant execute on function public.engine_refresh_day_hours(uuid) to service_role;

-- Ledger totals per vehicle and category for a date range. Security invoker: owner / admin / finance only.
create function public.ledger_vehicle_totals(p_org uuid, p_from date, p_to date)
returns table (vehicle_id uuid, category text, amount_cents bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select l.vehicle_id, l.category, sum(l.amount_cents)::bigint
  from public.ledger_entries l
  where l.org_id = p_org and l.occurred_on between p_from and p_to and l.vehicle_id is not null
  group by l.vehicle_id, l.category
$$;
revoke all on function public.ledger_vehicle_totals(uuid, date, date) from public, anon;
grant execute on function public.ledger_vehicle_totals(uuid, date, date) to authenticated, service_role;
