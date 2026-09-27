-- Vendors (task 5.6, erd.md §3.4): the directory service tickets dispatch to. A service area is a radius around
-- the vendor's base and/or a drawn polygon; ranking (VN-4) only considers vendors whose area covers the car.
create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  slug text not null check (slug ~ '^[a-z0-9-]{1,80}$'),
  categories text[] not null check (
    cardinality(categories) >= 1
    and categories <@ array['cleaning', 'detailing', 'tyres', 'towing', 'maintenance', 'charging']),
  status text not null default 'active' check (status in ('active', 'limited', 'inactive')),
  contact jsonb not null default '{}'::jsonb check (jsonb_typeof(contact) = 'object'),
  base_location extensions.geography(Point, 4326),
  service_radius_m int check (service_radius_m between 100 and 300000),
  service_area extensions.geography(Polygon, 4326),
  pricing jsonb not null default '{}'::jsonb check (jsonb_typeof(pricing) = 'object'),
  sla_response_min int check (sla_response_min between 1 and 1440),
  sla_resolution_min int check (sla_resolution_min between 1 and 10080),
  capacity_note text check (length(capacity_note) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, slug),
  unique (org_id, id)
);
create trigger vendors_updated_at before update on public.vendors for each row execute function app.set_updated_at();

alter table public.vendors enable row level security;
create policy vendors_select on public.vendors for select to authenticated using (org_id in (select app.user_org_ids()));
create policy vendors_write on public.vendors for all to authenticated
  using (app.has_role(org_id, array['owner', 'admin', 'ops']::public.app_role[]))
  with check (app.has_role(org_id, array['owner', 'admin', 'ops']::public.app_role[]));
revoke all on public.vendors from anon;

-- Vendors with coordinates (the API can't read geography). Security invoker: vendors' RLS applies.
create view public.vendor_list with (security_invoker = true) as
select
  v.id, v.org_id, v.name, v.slug, v.categories, v.status, v.contact, v.service_radius_m, v.pricing,
  v.sla_response_min, v.sla_resolution_min, v.capacity_note, v.created_at,
  extensions.st_y(v.base_location::extensions.geometry) as lat,
  extensions.st_x(v.base_location::extensions.geometry) as lng,
  v.service_area is not null as has_polygon
from public.vendors v;
revoke all on public.vendor_list from anon;
grant select on public.vendor_list to authenticated, service_role;

-- Vendors of a category whose service area covers a point, with the distance from their base (VN-4).
create function public.vendors_covering(p_org uuid, p_lat double precision, p_lng double precision, p_category text)
returns table (vendor_id uuid, distance_m double precision)
language sql
stable
security invoker
set search_path = ''
as $$
  with pt as (select extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography as g)
  select v.id, case when v.base_location is null then null else extensions.st_distance(v.base_location, pt.g) end
  from public.vendors v, pt
  where v.org_id = p_org and p_category = any(v.categories) and v.status <> 'inactive'
    and (
      (v.service_area is not null and extensions.st_covers(v.service_area, pt.g))
      or (v.base_location is not null and v.service_radius_m is not null
          and extensions.st_dwithin(v.base_location, pt.g, v.service_radius_m))
    )
$$;
revoke all on function public.vendors_covering(uuid, double precision, double precision, text) from public, anon;
grant execute on function public.vendors_covering(uuid, double precision, double precision, text) to authenticated, service_role;
