-- Reports (task 5.9, PRD RP-1..RP-5, flows.md F5): monthly asset performance snapshots for lenders, covenant
-- checks, PDF export and expiring read-only share links.

-- Covenants (RP-2): thresholds the lender cares about; seeded per org, editable by owner/admin.
create table public.covenants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  metric text not null check (metric in ('uptime', 'contribution_margin', 'vendor_sla', 'incidents_per_10k_rides', 'availability')),
  operator text not null check (operator in ('>', '>=', '<', '<=')),
  threshold numeric not null,
  label text not null check (length(label) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (org_id, metric)
);
alter table public.covenants enable row level security;
create policy covenants_select on public.covenants for select to authenticated using (org_id in (select app.user_org_ids()));
create policy covenants_write on public.covenants for all to authenticated
  using (app.has_role(org_id, array['owner', 'admin']::public.app_role[]))
  with check (app.has_role(org_id, array['owner', 'admin']::public.app_role[]));
revoke all on public.covenants from anon;

create function app.seed_covenants(p_org uuid) returns void language sql security definer set search_path = '' as $$
  insert into public.covenants (org_id, metric, operator, threshold, label) values
    (p_org, 'uptime', '>', 0.94, 'Uptime above 94%'),
    (p_org, 'contribution_margin', '>=', 0.5, 'Contribution margin at least 50%'),
    (p_org, 'vendor_sla', '>=', 0.9, 'Vendor SLA compliance at least 90%'),
    (p_org, 'incidents_per_10k_rides', '<=', 2.5, 'Incidents at most 2.5 per 10,000 rides')
  on conflict (org_id, metric) do nothing;
$$;
create function app.seed_org_covenants() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform app.seed_covenants(new.id);
  return null;
end $$;
create trigger orgs_seed_covenants after insert on public.orgs for each row execute function app.seed_org_covenants();
select app.seed_covenants(id) from public.orgs;

-- Snapshots (RP-1): numbers never change after generation; regenerating adds a version.
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  version int not null,
  status text not null default 'ready' check (status in ('generating', 'ready', 'failed')),
  preliminary boolean not null default false, -- generated before the month closed
  grade text,
  data jsonb not null,
  pdf_path text,
  generated_by uuid references auth.users (id) on delete set null default auth.uid(),
  generated_at timestamptz not null default now(),
  unique (org_id, month, version),
  unique (org_id, id)
);
create index reports_org_idx on public.reports (org_id, month desc, version desc);
alter table public.reports enable row level security;
-- Money: owner, admin, finance (like the ledger).
create policy reports_select on public.reports for select to authenticated
  using (app.has_role(org_id, array['owner', 'admin', 'finance']::public.app_role[]));
create policy reports_insert on public.reports for insert to authenticated
  with check (app.has_role(org_id, array['owner', 'admin', 'finance']::public.app_role[]));
revoke all on public.reports from anon;
revoke update, delete on public.reports from authenticated;

-- Next version number for a month (so two generations can't collide on version 1).
create function app.report_version() returns trigger language plpgsql set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtext(new.org_id::text || new.month));
  select coalesce(max(version), 0) + 1 into new.version from public.reports where org_id = new.org_id and month = new.month;
  return new;
end $$;
create trigger reports_version before insert on public.reports for each row execute function app.report_version();

-- The PDF is rendered once, on first export, by the server (service role).
create function public.engine_set_report_pdf(p_id uuid, p_path text) returns void
language sql security definer set search_path = '' as $$
  update public.reports set pdf_path = p_path where id = p_id and pdf_path is null
$$;
revoke all on function public.engine_set_report_pdf(uuid, text) from public, anon, authenticated;
grant execute on function public.engine_set_report_pdf(uuid, text) to service_role;

-- Shares (RP-4): expiring read-only links to one version; only the token's hash is stored.
create table public.report_shares (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  report_id uuid not null,
  recipient text not null check (length(trim(recipient)) between 1 and 120),
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  internal boolean not null default false, -- short-lived, for rendering the PDF
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (org_id, report_id) references public.reports (org_id, id) on delete cascade
);
create index report_shares_report_idx on public.report_shares (report_id);
alter table public.report_shares enable row level security;
create policy report_shares_select on public.report_shares for select to authenticated
  using (app.has_role(org_id, array['owner', 'admin', 'finance']::public.app_role[]));
create policy report_shares_revoke on public.report_shares for update to authenticated
  using (app.has_role(org_id, array['owner', 'admin', 'finance']::public.app_role[]))
  with check (app.has_role(org_id, array['owner', 'admin', 'finance']::public.app_role[]));
revoke all on public.report_shares from anon;
revoke insert, delete on public.report_shares from authenticated;
revoke update on public.report_shares from authenticated;
grant update (revoked_at) on public.report_shares to authenticated;

create function public.create_report_share(p_org uuid, p_report uuid, p_recipient text, p_days int, p_internal boolean default false)
returns table (id uuid, token text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_token text := encode(extensions.gen_random_bytes(24), 'hex'); v_id uuid; v_exp timestamptz;
begin
  if not app.has_role(p_org, array['owner', 'admin', 'finance']::public.app_role[]) then
    raise exception 'Only owners, admins and finance can share reports' using errcode = '42501';
  end if;
  if not exists (select 1 from public.reports r where r.org_id = p_org and r.id = p_report) then
    raise exception 'No such report' using errcode = 'P0002';
  end if;
  if p_days not between 1 and 365 then raise exception 'Expiry is 1 to 365 days' using errcode = '22023'; end if;
  insert into public.report_shares (org_id, report_id, recipient, token_hash, expires_at, internal, created_by)
  values (p_org, p_report, trim(p_recipient), encode(extensions.digest(v_token, 'sha256'), 'hex'),
          case when p_internal then now() + interval '5 minutes' else now() + make_interval(days => p_days) end,
          p_internal, (select auth.uid()))
  returning report_shares.id, report_shares.expires_at into v_id, v_exp;
  if not p_internal then
    insert into public.audit_log (org_id, actor_id, action, target_type, target_id, detail)
    values (p_org, (select auth.uid()), 'report.share', 'report', p_report::text,
            jsonb_build_object('recipient', trim(p_recipient), 'expires_at', v_exp));
  end if;
  return query select v_id, v_token, v_exp;
end $$;
revoke all on function public.create_report_share(uuid, uuid, text, int, boolean) from public, anon;
grant execute on function public.create_report_share(uuid, uuid, text, int, boolean) to authenticated;

-- The public side: a valid token returns the snapshot and who it's for; anything else returns nothing.
create function public.shared_report(p_token text)
returns table (report_id uuid, org_name text, month text, version int, preliminary boolean, grade text, data jsonb,
               generated_at timestamptz, recipient text, expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select r.id, o.name, r.month, r.version, r.preliminary, r.grade, r.data, r.generated_at, s.recipient, s.expires_at
  from public.report_shares s
  join public.reports r on r.id = s.report_id
  join public.orgs o on o.id = r.org_id
  where s.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and s.revoked_at is null and s.expires_at > now()
$$;
revoke all on function public.shared_report(text) from public;
grant execute on function public.shared_report(text) to anon, authenticated, service_role;

-- Private storage for rendered PDFs ({org_id}/reports/{report_id}.pdf); read by money roles via signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('report-pdfs', 'report-pdfs', false, 20971520, array['application/pdf'])
on conflict (id) do nothing;
create policy report_pdfs_read on storage.objects for select to authenticated
  using (bucket_id = 'report-pdfs'
         and app.has_role((storage.foldername(name))[1]::uuid, array['owner', 'admin', 'finance']::public.app_role[]));
