-- Hubs (task 5.7, PRD HB-1..HB-5, kpis.md §3.6).

-- Visits: when a car entered and left a hub's geofence, written by the engine tick (average turnaround, HB-1).
create table public.hub_visits (
  id bigint generated always as identity primary key,
  org_id uuid not null,
  hub_id uuid not null,
  vehicle_id uuid not null,
  arrived_at timestamptz not null,
  departed_at timestamptz check (departed_at is null or departed_at >= arrived_at),
  foreign key (org_id, hub_id) references public.hubs (org_id, id) on delete cascade,
  foreign key (org_id, vehicle_id) references public.vehicles (org_id, id) on delete cascade
);
create index hub_visits_hub_idx on public.hub_visits (hub_id, arrived_at desc);
create unique index hub_visits_open_idx on public.hub_visits (vehicle_id) where departed_at is null;
alter table public.hub_visits enable row level security;
create policy hub_visits_select on public.hub_visits for select to authenticated using (org_id in (select app.user_org_ids()));
revoke all on public.hub_visits from anon;
revoke insert, update, delete on public.hub_visits from authenticated;

-- Engine: close visits for cars that left, open visits for cars that arrived (one open visit per car).
create function public.engine_hub_visits(p_org uuid, p_moves jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare m jsonb;
begin
  for m in select * from jsonb_array_elements(p_moves) loop
    update public.hub_visits set departed_at = greatest((m->>'at')::timestamptz, arrived_at)
     where org_id = p_org and vehicle_id = (m->>'vehicle_id')::uuid and departed_at is null;
    if m->>'hub_id' is not null then
      insert into public.hub_visits (org_id, hub_id, vehicle_id, arrived_at)
      values (p_org, (m->>'hub_id')::uuid, (m->>'vehicle_id')::uuid, (m->>'at')::timestamptz);
    end if;
  end loop;
end $$;
revoke all on function public.engine_hub_visits(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.engine_hub_visits(uuid, jsonb) to service_role;

-- Applied mitigations (HB-4, flows.md F6): the decision, who made it, and what it changes in the forecast.
create table public.hub_decisions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  hub_id uuid not null,
  recommendation_id text not null check (length(recommendation_id) <= 80),
  kind text not null check (kind in ('route', 'delay')),
  title text not null check (length(title) <= 200),
  detail text check (length(detail) <= 1000),
  vehicle_ids uuid[] not null,
  to_hub_id uuid,
  window_from timestamptz not null,
  window_to timestamptz not null check (window_to > window_from),
  impact_cents int,
  applied_by uuid references auth.users (id) on delete set null default auth.uid(),
  applied_at timestamptz not null default now(),
  foreign key (org_id, hub_id) references public.hubs (org_id, id) on delete cascade,
  foreign key (org_id, to_hub_id) references public.hubs (org_id, id) on delete cascade,
  unique (hub_id, recommendation_id)
);
create index hub_decisions_hub_idx on public.hub_decisions (hub_id, window_to desc);
alter table public.hub_decisions enable row level security;
create policy hub_decisions_select on public.hub_decisions for select to authenticated using (org_id in (select app.user_org_ids()));
create policy hub_decisions_insert on public.hub_decisions for insert to authenticated
  with check (app.has_role(org_id, array['owner', 'admin', 'ops']::public.app_role[]) and applied_by = (select auth.uid()));
revoke all on public.hub_decisions from anon;
revoke update, delete on public.hub_decisions from authenticated;

-- Hub configuration in one audited step (HB-5): place and radius, chargers (count × kW), bays per kind,
-- operating hours and a flat electricity price (time-of-use tariffs keep their schedule unless replaced).
-- Security invoker: hub/charger/bay/tariff RLS decides who may change what.
create function public.hub_save(
  p_org uuid, p_id uuid, p_name text, p_address text, p_lat double precision, p_lng double precision,
  p_radius_m int, p_chargers int, p_charger_kw numeric, p_bays jsonb, p_operating_hours jsonb,
  p_flat_cents_per_kwh numeric
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid := p_id;
  v_pt extensions.geography := extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography;
  v_clash text;
  v_have int;
  v_kind text;
  v_tariff uuid;
begin
  if p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'Enter a valid latitude and longitude' using errcode = '22023';
  end if;
  if p_chargers not between 0 and 500 then raise exception 'Chargers must be between 0 and 500' using errcode = '22023'; end if;
  -- Geofences may not overlap: a car can only be at one hub.
  select h.name into v_clash from public.hubs h
   where h.org_id = p_org and h.id is distinct from p_id
     and extensions.st_dwithin(h.location, v_pt, h.radius_m + p_radius_m)
   limit 1;
  if v_clash is not null then
    raise exception 'This area overlaps % — move it or make the radius smaller', v_clash using errcode = '22023';
  end if;
  if v_id is null then
    insert into public.hubs (org_id, name, address, location, radius_m, operating_hours)
    values (p_org, trim(p_name), nullif(trim(p_address), ''), v_pt, p_radius_m, coalesce(p_operating_hours, '{}'::jsonb))
    returning id into v_id;
  else
    update public.hubs set name = trim(p_name), address = nullif(trim(p_address), ''), location = v_pt,
           radius_m = p_radius_m, operating_hours = coalesce(p_operating_hours, operating_hours)
     where org_id = p_org and id = v_id;
    if not found then raise exception 'No such hub' using errcode = 'P0002'; end if;
  end if;

  -- Chargers: add or remove from the end (C01, C02, …); the power applies to all.
  select count(*) into v_have from public.hub_chargers where hub_id = v_id;
  if p_chargers > v_have then
    insert into public.hub_chargers (org_id, hub_id, label, max_kw)
    select p_org, v_id, 'C' || lpad(n::text, 2, '0'), p_charger_kw from generate_series(v_have + 1, p_chargers) n
    on conflict (hub_id, label) do nothing;
  elsif p_chargers < v_have then
    delete from public.hub_chargers where id in (
      select id from public.hub_chargers where hub_id = v_id order by label desc limit v_have - p_chargers);
  end if;
  if p_charger_kw is not null then update public.hub_chargers set max_kw = p_charger_kw where hub_id = v_id; end if;

  -- Bays per kind.
  for v_kind in select * from unnest(array['cleaning', 'maintenance', 'parking']) loop
    select count(*) into v_have from public.hub_bays where hub_id = v_id and kind = v_kind;
    if coalesce((p_bays->>v_kind)::int, v_have) > v_have then
      insert into public.hub_bays (org_id, hub_id, kind, label)
      select p_org, v_id, v_kind, initcap(v_kind) || ' ' || n from generate_series(v_have + 1, (p_bays->>v_kind)::int) n
      on conflict (hub_id, label) do nothing;
    elsif (p_bays->>v_kind)::int < v_have then
      delete from public.hub_bays where id in (
        select id from public.hub_bays where hub_id = v_id and kind = v_kind order by created_at desc, label desc
        limit v_have - (p_bays->>v_kind)::int);
    end if;
  end loop;

  -- A flat price replaces the tariff with an all-day rate (TOU editing comes with Settings, task 5.10).
  if p_flat_cents_per_kwh is not null then
    insert into public.tariffs (org_id, name, source, schedule)
    values (p_org, trim(p_name) || ' flat rate', 'manual',
            jsonb_build_array(jsonb_build_object('days', jsonb_build_array(0, 1, 2, 3, 4, 5, 6), 'from', '00:00',
              'to', '24:00', 'cents_per_kwh', p_flat_cents_per_kwh, 'label', 'Flat rate')))
    returning id into v_tariff;
    update public.hubs set tariff_id = v_tariff where id = v_id;
  end if;
  return v_id;
end $$;
revoke all on function public.hub_save(uuid, uuid, text, text, double precision, double precision, int, int, numeric, jsonb, jsonb, numeric) from public, anon;
grant execute on function public.hub_save(uuid, uuid, text, text, double precision, double precision, int, int, numeric, jsonb, jsonb, numeric) to authenticated;

-- Hub changes are audited (flows.md HB-5).
create function app.audit_hub() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_log (org_id, actor_id, action, target_type, target_id, detail)
  values (coalesce(new.org_id, old.org_id), (select auth.uid()), 'hub.' || lower(tg_op), 'hub',
          coalesce(new.id, old.id)::text,
          jsonb_build_object('name', coalesce(new.name, old.name), 'radius_m', coalesce(new.radius_m, old.radius_m)));
  return null;
end $$;
create trigger hubs_audit after insert or update or delete on public.hubs for each row execute function app.audit_hub();
