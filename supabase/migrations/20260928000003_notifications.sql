-- Notifications (task 5.11, PRD GL-5, ST-6). Events call app.notify(); each member gets a row (shown in the
-- bell when their in-app preference covers the severity) and, per their preferences, an email; the org gets a
-- Slack message when its webhook is set. Email and Slack go through an outbox the engine tick drains.

-- Per-user channel preferences by severity (defaults when a user has none).
create table public.notification_settings (
  org_id uuid not null references public.orgs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  by_severity jsonb not null check (jsonb_typeof(by_severity) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
alter table public.notification_settings enable row level security;
create policy notification_settings_own on public.notification_settings for all to authenticated
  using (user_id = (select auth.uid()) and org_id in (select app.user_org_ids()))
  with check (user_id = (select auth.uid()) and org_id in (select app.user_org_ids()));
revoke all on public.notification_settings from anon;

create function app.default_notification_settings() returns jsonb language sql immutable set search_path = '' as $$
  select '{"critical":{"in_app":true,"email":true},"high":{"in_app":true,"email":false},"medium":{"in_app":false,"email":false},"low":{"in_app":false,"email":false}}'::jsonb
$$;

-- The org's Slack channel (owner/admin): the webhook is a secret, so members can't read it.
create table public.org_integrations (
  org_id uuid primary key references public.orgs (id) on delete cascade,
  slack_webhook_url text check (slack_webhook_url ~ '^https://hooks\.slack\.com/'),
  slack_severities text[] not null default array['critical', 'high'],
  updated_at timestamptz not null default now()
);
alter table public.org_integrations enable row level security;
create policy org_integrations_admin on public.org_integrations for all to authenticated
  using (app.has_role(org_id, array['owner', 'admin']::public.app_role[]))
  with check (app.has_role(org_id, array['owner', 'admin']::public.app_role[]));
revoke all on public.org_integrations from anon;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('exception', 'sla_breached', 'ticket_update', 'test')),
  severity text not null check (severity in ('critical', 'high', 'medium', 'low')),
  title text not null,
  body text,
  href text,
  in_app boolean not null default true,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_user_idx on public.notifications (user_id, org_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id, org_id) where read_at is null and in_app;
alter table public.notifications enable row level security;
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_read on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.notifications from anon;
revoke insert, update, delete on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

create table public.notification_deliveries (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs (id) on delete cascade,
  notification_id uuid references public.notifications (id) on delete cascade,
  channel text not null check (channel in ('email', 'slack')),
  recipient text not null,
  subject text not null,
  body text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index notification_deliveries_pending_idx on public.notification_deliveries (created_at) where status = 'pending';
alter table public.notification_deliveries enable row level security;
revoke all on public.notification_deliveries from anon, authenticated;

-- Push to the user's private topic so the bell updates without a reload (GL-5: ≤ 15 s).
create policy user_notifications_receive on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() = 'user:' || (select auth.uid())::text || ':notifications'
  );

/**
 * Notify an org's members (optionally only some roles, or one user): a row per member with in_app per their
 * preference, an email delivery when they asked for this severity by email, and one Slack delivery for the org.
 */
create function app.notify(p_org uuid, p_kind text, p_severity text, p_title text, p_body text, p_href text,
  p_roles public.app_role[] default null, p_user uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare r record; v_prefs jsonb; v_id uuid; v_in_app boolean; v_email boolean; v_slack record;
begin
  for r in
    select m.user_id, u.email from public.memberships m join auth.users u on u.id = m.user_id
     where m.org_id = p_org and (p_user is null or m.user_id = p_user) and (p_roles is null or m.role = any (p_roles))
  loop
    select by_severity into v_prefs from public.notification_settings where org_id = p_org and user_id = r.user_id;
    v_prefs := coalesce(v_prefs, app.default_notification_settings());
    v_in_app := coalesce((v_prefs->p_severity->>'in_app')::boolean, false) or p_kind in ('ticket_update', 'test');
    v_email := coalesce((v_prefs->p_severity->>'email')::boolean, false);
    insert into public.notifications (org_id, user_id, kind, severity, title, body, href, in_app)
    values (p_org, r.user_id, p_kind, p_severity, p_title, p_body, p_href, v_in_app)
    returning id into v_id;
    if v_in_app then
      perform realtime.send(jsonb_build_object('id', v_id, 'severity', p_severity, 'title', p_title),
        'notification', 'user:' || r.user_id || ':notifications', true);
    end if;
    if v_email and r.email is not null then
      insert into public.notification_deliveries (org_id, notification_id, channel, recipient, subject, body)
      values (p_org, v_id, 'email', r.email, p_title, coalesce(p_body, '') || coalesce(E'\n\n' || p_href, ''));
    end if;
  end loop;
  select slack_webhook_url, slack_severities into v_slack from public.org_integrations where org_id = p_org;
  if v_slack.slack_webhook_url is not null and p_severity = any (v_slack.slack_severities) and p_user is null then
    insert into public.notification_deliveries (org_id, channel, recipient, subject, body)
    values (p_org, 'slack', v_slack.slack_webhook_url, p_title, coalesce(p_body, '') || coalesce(E'\n' || p_href, ''));
  end if;
end $$;

-- Events. A new exception notifies the people who handle them.
create function app.notify_exception() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_car text;
begin
  select number into v_car from public.vehicles where id = new.vehicle_id;
  perform app.notify(new.org_id, 'exception', new.severity,
    coalesce('Car ' || v_car || ': ', '') || new.title,
    coalesce(new.location_name, new.description), '/exceptions/' || new.id,
    array['owner', 'admin', 'ops']::public.app_role[]);
  return null;
end $$;
create trigger exceptions_notify after insert on public.exceptions for each row execute function app.notify_exception();

-- Ticket events: a missed SLA alerts the team; completion and return tell the person who opened the ticket.
create function app.notify_ticket_event() returns trigger language plpgsql security definer set search_path = '' as $$
declare t public.tickets; v_car text;
begin
  if new.type not in ('sla_breached', 'completed', 'returned') then return null; end if;
  select * into t from public.tickets where id = new.ticket_id;
  select number into v_car from public.vehicles where id = t.vehicle_id;
  if new.type = 'sla_breached' then
    perform app.notify(t.org_id, 'sla_breached', 'high', t.number || ' missed its SLA',
      'Car ' || v_car || ' · ' || t.type, '/service/' || t.number, array['owner', 'admin', 'ops']::public.app_role[]);
  elsif t.created_by is not null then
    perform app.notify(t.org_id, 'ticket_update', 'low',
      t.number || case when new.type = 'completed' then ' completed' else ' returned to service' end,
      'Car ' || v_car, '/service/' || t.number, null, t.created_by);
  end if;
  return null;
end $$;
create trigger ticket_events_notify after insert on public.ticket_events for each row execute function app.notify_ticket_event();

-- Outbox for the engine tick (service role): claim a batch, then mark each sent or failed.
create function public.engine_claim_deliveries(p_limit int default 50)
returns setof public.notification_deliveries
language sql security definer set search_path = '' as $$
  update public.notification_deliveries d set attempts = attempts + 1
   where d.id in (select id from public.notification_deliveries
                   where status = 'pending' and attempts < 5 order by created_at limit p_limit for update skip locked)
  returning d.*
$$;
create function public.engine_delivery_result(p_id bigint, p_ok boolean, p_error text default null) returns void
language sql security definer set search_path = '' as $$
  update public.notification_deliveries
     set status = case when p_ok then 'sent' when attempts >= 5 then 'failed' else 'pending' end,
         sent_at = case when p_ok then now() end, last_error = p_error
   where id = p_id
$$;
revoke all on function public.engine_claim_deliveries(int) from public, anon, authenticated;
revoke all on function public.engine_delivery_result(bigint, boolean, text) from public, anon, authenticated;
grant execute on function public.engine_claim_deliveries(int) to service_role;
grant execute on function public.engine_delivery_result(bigint, boolean, text) to service_role;

-- "Send test" (ST-6): notify just the caller, and Slack if configured, from the settings page.
create function public.send_test_notification(p_org uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_slack text;
begin
  if (select auth.uid()) is null or p_org not in (select app.user_org_ids()) then
    raise exception 'Not a member' using errcode = '42501';
  end if;
  perform app.notify(p_org, 'test', 'low', 'Test notification', 'Notifications from FleetOS reach you here.', '/settings/notifications',
    null, (select auth.uid()));
  select slack_webhook_url into v_slack from public.org_integrations where org_id = p_org;
  if v_slack is not null and app.has_role(p_org, array['owner', 'admin']::public.app_role[]) then
    insert into public.notification_deliveries (org_id, channel, recipient, subject, body)
    values (p_org, 'slack', v_slack, 'Test notification', 'FleetOS can post to this channel.');
  end if;
end $$;
revoke all on function public.send_test_notification(uuid) from public, anon;
grant execute on function public.send_test_notification(uuid) to authenticated;
