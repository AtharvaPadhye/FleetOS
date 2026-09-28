-- Settings (task 5.10, PRD ST-1..ST-3, ST-5, ST-7; EX-5 rule preview).

-- Fleet policies that live on the org (ST-2): the charge target cars aim for, the auto-dispatch delay (null =
-- off; the demo autopilot and, after Phase 4, real fleets use it) and the monthly maintenance reserve per car.
-- (The cabin clean-out policy CLN-02 is the cabin_cleanliness rule's blocks_service, not a column.)
alter table public.orgs
  add column charge_target numeric(4, 3) not null default 0.800 check (charge_target between 0.5 and 1),
  add column auto_dispatch_after_min int check (auto_dispatch_after_min between 0 and 1440),
  add column maintenance_reserve_monthly_cents int not null default 0 check (maintenance_reserve_monthly_cents >= 0);
update public.orgs set auto_dispatch_after_min = 5 where is_demo;

-- Org changes are audited (flows.md ST-1).
create function app.audit_org() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_changes jsonb := '{}'::jsonb; k text;
begin
  for k in select jsonb_object_keys(to_jsonb(new)) loop
    if k not in ('updated_at') and to_jsonb(new)->k is distinct from to_jsonb(old)->k then
      v_changes := v_changes || jsonb_build_object(k, jsonb_build_object('from', to_jsonb(old)->k, 'to', to_jsonb(new)->k));
    end if;
  end loop;
  if v_changes <> '{}'::jsonb and (select auth.uid()) is not null then
    insert into public.audit_log (org_id, actor_id, action, target_type, target_id, detail)
    values (new.id, (select auth.uid()), 'org.update', 'org', new.id::text, v_changes);
  end if;
  return null;
end $$;
create trigger orgs_audit after update on public.orgs for each row execute function app.audit_org();

-- Members with their email (auth.users isn't readable by users): members of the org only.
create function public.org_members(p_org uuid)
returns table (user_id uuid, email text, full_name text, role public.app_role, joined_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.user_id, u.email::text, p.full_name, m.role, m.created_at
  from public.memberships m
  join auth.users u on u.id = m.user_id
  left join public.profiles p on p.user_id = m.user_id
  where m.org_id = p_org and p_org in (select app.user_org_ids())
  order by m.created_at
$$;
revoke all on function public.org_members(uuid) from public, anon;
grant execute on function public.org_members(uuid) to authenticated;

-- Invite by email (ST-3): the raw token goes into the link once; only its hash is stored. Owner/admin only
-- (checked explicitly: security definer, to see existing members' emails), and an invite replaces any pending
-- one for the same address.
create function public.create_invitation(p_org uuid, p_email text, p_role public.app_role)
returns table (id uuid, token text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_token text := encode(extensions.gen_random_bytes(24), 'hex'); v_id uuid; v_exp timestamptz;
begin
  if not app.has_role(p_org, array['owner', 'admin']::public.app_role[]) then
    raise exception 'Only owners and admins can invite' using errcode = '42501';
  end if;
  if exists (select 1 from public.memberships m join auth.users u on u.id = m.user_id
             where m.org_id = p_org and lower(u.email) = lower(trim(p_email))) then
    raise exception '% is already a member', trim(p_email) using errcode = '23505';
  end if;
  delete from public.invitations i where i.org_id = p_org and lower(i.email) = lower(trim(p_email)) and i.accepted_at is null;
  insert into public.invitations (org_id, email, role, token_hash, created_by)
  values (p_org, lower(trim(p_email)), p_role, encode(extensions.digest(v_token, 'sha256'), 'hex'), (select auth.uid()))
  returning invitations.id, invitations.expires_at into v_id, v_exp;
  insert into public.audit_log (org_id, actor_id, action, target_type, target_id, detail)
  values (p_org, (select auth.uid()), 'invitation.create', 'invitation', v_id::text,
          jsonb_build_object('email', lower(trim(p_email)), 'role', p_role));
  return query select v_id, v_token, v_exp;
end $$;
revoke all on function public.create_invitation(uuid, text, public.app_role) from public, anon;
grant execute on function public.create_invitation(uuid, text, public.app_role) to authenticated;

-- Telemetry and alerts for the rule preview (EX-5 "test against the last 24 h"): per vehicle, field and
-- 10-minute bucket, the last value. Owner/admin only (rules are theirs), security definer for the raw samples.
create function public.rule_preview_samples(p_org uuid, p_since timestamptz)
returns table (vehicle_id uuid, bucket timestamptz, field text, value double precision)
language sql stable security definer set search_path = '' as $$
  select distinct on (s.vehicle_id, b.bucket, s.field) s.vehicle_id, b.bucket, s.field, s.value_num::double precision
  from public.telemetry_samples s,
       lateral (select to_timestamp(floor(extract(epoch from s.ts) / 600) * 600) as bucket) b
  where s.org_id = p_org and s.ts >= p_since and s.value_num is not null
    and s.field in ('Soc', 'VehicleSpeed', 'TpmsPressureFl', 'TpmsPressureFr', 'TpmsPressureRl', 'TpmsPressureRr')
    and app.has_role(p_org, array['owner', 'admin']::public.app_role[])
  order by s.vehicle_id, b.bucket, s.field, s.ts desc
$$;
revoke all on function public.rule_preview_samples(uuid, timestamptz) from public, anon;
grant execute on function public.rule_preview_samples(uuid, timestamptz) to authenticated;
