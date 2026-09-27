-- Fix (Phase 3 exit check): the rollup refresh started from the last refreshed day, so a tick that replays
-- simulated time across midnight (catch-up after a pause) never recomputed the earlier day, leaving it
-- frozen at whatever the first tick saw. The tick now passes where its replay started, and the refresh
-- starts from the earlier of that day and the last refreshed day.
drop function public.engine_refresh_day_hours(uuid);

create function public.engine_refresh_day_hours(p_org uuid, p_since timestamptz)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tz text;
  v_today date;
  v_from date;
  d date;
  n int := 0;
begin
  select o.timezone into v_tz from public.orgs o where o.id = p_org;
  if v_tz is null then
    return 0;
  end if;
  v_today := (now() at time zone v_tz)::date;
  select coalesce(max(h.day), v_today) into v_from from public.vehicle_day_hours h where h.org_id = p_org;
  v_from := least(v_from, (p_since at time zone v_tz)::date);
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
revoke all on function public.engine_refresh_day_hours(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.engine_refresh_day_hours(uuid, timestamptz) to service_role;
