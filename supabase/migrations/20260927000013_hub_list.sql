-- Hubs with coordinates for maps (tasks 5.2 vehicle map, 5.7 hubs). Security invoker: hubs' RLS applies.
create view public.hub_list with (security_invoker = true) as
select
  h.id, h.org_id, h.name, h.address, h.radius_m, h.exit_buffer_m, h.tariff_id, h.operating_hours,
  extensions.st_y(h.location::extensions.geometry) as lat,
  extensions.st_x(h.location::extensions.geometry) as lng,
  (select count(*) from public.hub_chargers c where c.hub_id = h.id)::int as chargers,
  (select count(*) from public.hub_bays b where b.hub_id = h.id)::int as bays
from public.hubs h;
revoke all on public.hub_list from anon;
grant select on public.hub_list to authenticated, service_role;
