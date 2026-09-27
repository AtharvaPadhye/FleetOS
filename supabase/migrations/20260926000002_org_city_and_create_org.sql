-- Task 2.4: orgs carry the city shown in the app header; create_org() accepts it.
alter table public.orgs add column city text check (city is null or length(trim(city)) between 1 and 80);

drop function public.create_org(text, text, text);

create or replace function public.create_org(
  p_name text,
  p_slug text,
  p_timezone text default 'America/Phoenix',
  p_city text default null
)
returns public.orgs
language plpgsql security definer set search_path = ''
as $$
declare uid uuid := (select auth.uid()); o public.orgs;
begin
  if uid is null then raise exception 'Sign in to create an organization' using errcode = '42501'; end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'Unknown time zone: %', p_timezone using errcode = '22023';
  end if;
  insert into public.orgs (name, slug, timezone, city) values (p_name, p_slug, p_timezone, nullif(trim(p_city), ''))
  returning * into o;
  insert into public.memberships (org_id, user_id, role) values (o.id, uid, 'owner');
  insert into public.audit_log (org_id, actor_id, action, target_type, target_id)
  values (o.id, uid, 'org.create', 'org', o.id::text);
  return o;
end $$;
revoke all on function public.create_org(text, text, text, text) from public, anon;
grant execute on function public.create_org(text, text, text, text) to authenticated;
