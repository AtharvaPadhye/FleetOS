-- Overview read models (task 5.3, PRD OV-3). Security invoker: the caller's RLS applies (hours for every
-- member, money only for money roles through the ledger's policies).

-- Fleet hours per status per local day (availability trend).
create view public.fleet_day_hours with (security_invoker = true) as
select org_id, day,
       sum(in_service_h) as in_service_h, sum(ready_h) as ready_h, sum(charging_h) as charging_h,
       sum(cleaning_h) as cleaning_h, sum(maintenance_h) as maintenance_h, sum(incident_h) as incident_h,
       sum(offline_h) as offline_h
from public.vehicle_day_hours
group by org_id, day;
revoke all on public.fleet_day_hours from anon;
grant select on public.fleet_day_hours to authenticated, service_role;

-- Ledger totals per local day and category (revenue vs operating cost).
create function public.ledger_daily(p_org uuid, p_from date, p_to date)
returns table (day date, category text, amount_cents bigint)
language sql stable security invoker set search_path = '' as $$
  select l.occurred_on, l.category, sum(l.amount_cents)::bigint
  from public.ledger_entries l
  where l.org_id = p_org and l.occurred_on between p_from and p_to
  group by l.occurred_on, l.category
$$;
revoke all on function public.ledger_daily(uuid, date, date) from public, anon;
grant execute on function public.ledger_daily(uuid, date, date) to authenticated, service_role;
