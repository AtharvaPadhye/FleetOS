-- Hours per status per vehicle over a range of local days (task 3.8c KPI endpoints). Security invoker, so
-- vehicle_day_hours' RLS applies; one row per vehicle keeps responses far below the API's row cap.
create function public.vehicle_hours_totals(p_org uuid, p_from date, p_to date)
returns table (
  vehicle_id uuid, days int, in_service_h numeric, ready_h numeric, charging_h numeric, cleaning_h numeric,
  maintenance_h numeric, incident_h numeric, offline_h numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select h.vehicle_id, count(*)::int, sum(h.in_service_h), sum(h.ready_h), sum(h.charging_h), sum(h.cleaning_h),
         sum(h.maintenance_h), sum(h.incident_h), sum(h.offline_h)
  from public.vehicle_day_hours h
  where h.org_id = p_org and h.day between p_from and p_to
  group by h.vehicle_id
$$;
revoke all on function public.vehicle_hours_totals(uuid, date, date) from public, anon;
grant execute on function public.vehicle_hours_totals(uuid, date, date) to authenticated, service_role;
