-- Financials (task 5.8): revenue miles for cost per revenue mile (kpis.md §3.2). Security invoker: rides' RLS.
create function public.ride_totals(p_org uuid, p_from timestamptz, p_to timestamptz)
returns table (rides bigint, distance_m double precision)
language sql stable security invoker set search_path = '' as $$
  select count(*), coalesce(sum(r.distance_m), 0)::double precision
  from public.rides r
  where r.org_id = p_org and r.ended_at >= p_from and r.ended_at < p_to
$$;
revoke all on function public.ride_totals(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.ride_totals(uuid, timestamptz, timestamptz) to authenticated, service_role;
