-- FleetOS tenancy baseline (roadmap task 2.3, ADR-0004, docs/architecture/erd.md §3.1).
-- Every tenant-owned table has org_id + RLS. Browser code uses the user's JWT; only server code uses the
-- service role (NFR TEN-1..3). Security-definer helpers pin search_path to '' to avoid hijacking.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists app;
grant usage on schema app to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------------------------------------
create type public.app_role as enum ('owner', 'admin', 'ops', 'finance', 'viewer');

-- ---------------------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------------------
create table public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'),
  timezone text not null default 'America/Phoenix',
  currency char(3) not null default 'USD',
  region text not null default 'na' check (region in ('na', 'eu', 'cn')),
  service_start time not null default '00:00',
  service_end time not null default '24:00',
  availability_target numeric(4, 3) not null default 0.920 check (availability_target between 0 and 1),
  low_soc_threshold numeric(4, 3) not null default 0.400 check (low_soc_threshold between 0 and 1),
  baseline_days int not null default 28 check (baseline_days between 7 and 365),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
comment on table public.orgs is 'Tenants. Settings defaults from docs/requirements/kpis.md §7.';

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  org_id uuid not null references public.orgs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role public.app_role not null check (role <> 'owner'),
  token_hash text not null unique,
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index invitations_org_idx on public.invitations (org_id);

-- Append-only audit log (NFR SEC-10). No update/delete policies; writes only via triggers/functions.
create table public.audit_log (
  id bigint generated always as identity primary key,
  org_id uuid references public.orgs (id) on delete cascade,
  actor_id uuid,
  action text not null,
  target_type text not null,
  target_id text,
  at timestamptz not null default now(),
  detail jsonb not null default '{}'::jsonb
);
create index audit_log_org_at_idx on public.audit_log (org_id, at desc);

-- ---------------------------------------------------------------------------------------------------------
-- Helper functions (used by RLS policies everywhere)
-- ---------------------------------------------------------------------------------------------------------
create or replace function app.user_org_ids()
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select m.org_id from public.memberships m where m.user_id = (select auth.uid());
$$;

create or replace function app.has_role(p_org uuid, p_roles public.app_role[])
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = (select auth.uid()) and m.role = any (p_roles)
  );
$$;

create or replace function app.set_updated_at()
returns trigger language plpgsql set search_path = ''
as $$ begin new.updated_at = now(); return new; end $$;

revoke all on function app.user_org_ids() from public, anon;
revoke all on function app.has_role(uuid, public.app_role[]) from public, anon;
grant execute on function app.user_org_ids() to authenticated, service_role;
grant execute on function app.has_role(uuid, public.app_role[]) to authenticated, service_role;

create trigger orgs_updated_at before update on public.orgs for each row execute function app.set_updated_at();
create trigger profiles_updated_at before update on public.profiles for each row execute function app.set_updated_at();

-- New auth user → profile row.
create or replace function app.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (user_id, full_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (user_id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function app.handle_new_user();

-- An org always keeps at least one owner (NFR RBAC-2).
create or replace function app.protect_last_owner()
returns trigger language plpgsql set search_path = ''
as $$
declare remaining int;
begin
  if old.role <> 'owner' or (tg_op = 'UPDATE' and new.role = 'owner') then
    return coalesce(new, old);
  end if;
  -- Org deletion cascades memberships; allow that.
  if not exists (select 1 from public.orgs where id = old.org_id) then
    return coalesce(new, old);
  end if;
  select count(*) into remaining from public.memberships
   where org_id = old.org_id and role = 'owner' and user_id <> old.user_id;
  if remaining = 0 then
    raise exception 'An organization must keep at least one owner' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;
create trigger memberships_protect_last_owner before update or delete on public.memberships
  for each row execute function app.protect_last_owner();

-- Audit membership changes.
create or replace function app.audit_membership()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.audit_log (org_id, actor_id, action, target_type, target_id, detail)
  values (
    coalesce(new.org_id, old.org_id),
    (select auth.uid()),
    'membership.' || lower(tg_op),
    'user',
    coalesce(new.user_id, old.user_id)::text,
    jsonb_build_object('old_role', old.role, 'new_role', new.role)
  );
  return coalesce(new, old);
end $$;
create trigger memberships_audit after insert or update or delete on public.memberships
  for each row execute function app.audit_membership();

-- Create an org and make the caller its owner (orgs have no direct INSERT policy).
create or replace function public.create_org(p_name text, p_slug text, p_timezone text default 'America/Phoenix')
returns public.orgs
language plpgsql security definer set search_path = ''
as $$
declare uid uuid := (select auth.uid()); o public.orgs;
begin
  if uid is null then raise exception 'Sign in to create an organization' using errcode = '42501'; end if;
  insert into public.orgs (name, slug, timezone) values (p_name, p_slug, p_timezone) returning * into o;
  insert into public.memberships (org_id, user_id, role) values (o.id, uid, 'owner');
  insert into public.audit_log (org_id, actor_id, action, target_type, target_id)
  values (o.id, uid, 'org.create', 'org', o.id::text);
  return o;
end $$;
revoke all on function public.create_org(text, text, text) from public, anon;
grant execute on function public.create_org(text, text, text) to authenticated;

-- Accept an invitation by its raw token (hashed with sha256 at rest).
create or replace function public.accept_invitation(p_token text)
returns public.memberships
language plpgsql security definer set search_path = ''
as $$
declare uid uuid := (select auth.uid()); inv public.invitations; m public.memberships; user_email text;
begin
  if uid is null then raise exception 'Sign in to accept an invitation' using errcode = '42501'; end if;
  select * into inv from public.invitations
   where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
     and accepted_at is null and expires_at > now();
  if not found then raise exception 'Invitation is invalid or has expired' using errcode = 'P0002'; end if;
  select email into user_email from auth.users where id = uid;
  if lower(user_email) <> lower(inv.email) then
    raise exception 'This invitation was sent to a different email address' using errcode = '42501';
  end if;
  insert into public.memberships (org_id, user_id, role) values (inv.org_id, uid, inv.role)
  on conflict (org_id, user_id) do update set role = excluded.role
  returning * into m;
  update public.invitations set accepted_at = now() where id = inv.id;
  return m;
end $$;
revoke all on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------------------------------------
alter table public.orgs enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.invitations enable row level security;
alter table public.audit_log enable row level security;

-- orgs: members read; owner/admin update; create via create_org(); no deletes from clients.
create policy orgs_select on public.orgs for select to authenticated
  using (id in (select app.user_org_ids()) and deleted_at is null);
create policy orgs_update on public.orgs for update to authenticated
  using (app.has_role(id, array['owner', 'admin']::public.app_role[]))
  with check (app.has_role(id, array['owner', 'admin']::public.app_role[]));

-- profiles: yourself and people who share an org with you.
create policy profiles_select on public.profiles for select to authenticated
  using (
    user_id = (select auth.uid())
    or user_id in (select m.user_id from public.memberships m where m.org_id in (select app.user_org_ids()))
  );
create policy profiles_update on public.profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- memberships: members read their orgs' memberships; owner/admin manage; only owners grant/remove owner.
create policy memberships_select on public.memberships for select to authenticated
  using (org_id in (select app.user_org_ids()));
create policy memberships_insert on public.memberships for insert to authenticated
  with check (
    app.has_role(org_id, array['owner', 'admin']::public.app_role[])
    and (role <> 'owner' or app.has_role(org_id, array['owner']::public.app_role[]))
  );
create policy memberships_update on public.memberships for update to authenticated
  using (
    app.has_role(org_id, array['owner', 'admin']::public.app_role[])
    and (role <> 'owner' or app.has_role(org_id, array['owner']::public.app_role[]))
  )
  with check (role <> 'owner' or app.has_role(org_id, array['owner']::public.app_role[]));
create policy memberships_delete on public.memberships for delete to authenticated
  using (
    (app.has_role(org_id, array['owner', 'admin']::public.app_role[])
      and (role <> 'owner' or app.has_role(org_id, array['owner']::public.app_role[])))
    or user_id = (select auth.uid()) -- leave an org yourself (last-owner trigger still applies)
  );

-- invitations: owner/admin only.
create policy invitations_all on public.invitations for all to authenticated
  using (app.has_role(org_id, array['owner', 'admin']::public.app_role[]))
  with check (app.has_role(org_id, array['owner', 'admin']::public.app_role[]));

-- audit_log: owner/admin read; nobody writes directly (triggers and security-definer functions do).
create policy audit_log_select on public.audit_log for select to authenticated
  using (app.has_role(org_id, array['owner', 'admin']::public.app_role[]));

-- Anonymous users get nothing.
revoke all on all tables in schema public from anon;
