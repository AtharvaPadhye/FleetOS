-- Ledger totals by category for a date range (task 3.7 Financials summary). Security invoker: the ledger's RLS
-- still decides who sees money (owner / admin / finance); others get no rows.
create function public.ledger_totals(p_org uuid, p_from date, p_to date)
returns table (category text, amount_cents bigint, lines bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select l.category, sum(l.amount_cents)::bigint, count(*)
  from public.ledger_entries l
  where l.org_id = p_org and l.occurred_on between p_from and p_to
  group by l.category
$$;
revoke all on function public.ledger_totals(uuid, date, date) from public, anon;
grant execute on function public.ledger_totals(uuid, date, date) to authenticated, service_role;
