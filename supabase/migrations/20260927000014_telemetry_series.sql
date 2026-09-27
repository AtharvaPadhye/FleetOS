-- Telemetry history for charts (task 5.2, PRD VD-7): numeric samples bucketed with date_bin (avg / min / max).
-- Security invoker: telemetry_samples' RLS applies (raw history is owner / admin / ops, NFR PRV-2).
create function public.telemetry_series(
  p_org uuid, p_vehicle uuid, p_fields text[], p_from timestamptz, p_to timestamptz, p_bucket interval)
returns table (field text, t timestamptz, v double precision, vmin double precision, vmax double precision, n int)
language sql
stable
security invoker
set search_path = ''
as $$
  select s.field, date_bin(p_bucket, s.ts, timestamptz '2000-01-01'), avg(s.value_num), min(s.value_num), max(s.value_num), count(*)::int
  from public.telemetry_samples s
  where s.org_id = p_org and s.vehicle_id = p_vehicle and s.field = any(p_fields)
    and s.ts >= p_from and s.ts < p_to and s.value_num is not null
  group by 1, 2
  order by 1, 2
$$;
revoke all on function public.telemetry_series(uuid, uuid, text[], timestamptz, timestamptz, interval) from public, anon;
grant execute on function public.telemetry_series(uuid, uuid, text[], timestamptz, timestamptz, interval) to authenticated, service_role;
