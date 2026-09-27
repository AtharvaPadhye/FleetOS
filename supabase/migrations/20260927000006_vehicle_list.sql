-- Fleet list read model (task 3.8b): each vehicle with its live state and home hub, flattened so the API can
-- filter, sort and page in SQL. Security invoker: the caller's row-level security applies to every table.
create view public.vehicle_list with (security_invoker = true) as
select
  v.id,
  v.org_id,
  v.number,
  v.vin,
  v.display_name,
  v.model,
  v.lifecycle,
  v.provider,
  v.commissioned_at,
  v.insurance_monthly_cents,
  v.financing_monthly_cents,
  v.virtual_key_paired,
  v.telemetry_synced,
  v.home_hub_id,
  h.name as home_hub_name,
  -- A car the engine has never seen is Offline (vehicle-states.md §3).
  coalesce(s.status, 'offline'::public.vehicle_status) as status,
  s.status_since,
  s.soc,
  s.range_m,
  s.charge_state,
  s.charge_power_kw,
  extensions.st_y(s.location::extensions.geometry) as lat,
  extensions.st_x(s.location::extensions.geometry) as lng,
  s.heading,
  s.speed_mps,
  s.odometer_m,
  s.locked,
  s.tpms,
  coalesce(s.connectivity, 'offline') as connectivity,
  s.current_hub_id,
  s.last_telemetry_at
from public.vehicles v
left join public.hubs h on h.org_id = v.org_id and h.id = v.home_hub_id
left join public.vehicle_state_current s on s.vehicle_id = v.id;

revoke all on public.vehicle_list from anon;
grant select on public.vehicle_list to authenticated, service_role;
