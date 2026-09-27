-- Realtime (task 3.8d, api.md §4, ADR-0011): the engine broadcasts vehicle state and status changes on private
-- per-org channels; only members of that org may receive them.

-- Receive: authenticated members only, and only their own org's `org:<id>:vehicles` / `org:<id>:status` topics.
create policy org_broadcast_receive on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() ~ '^org:[0-9a-f-]{36}:(vehicles|status)$'
    and split_part(realtime.topic(), ':', 2)::uuid in (select app.user_org_ids())
  );
-- Nobody but the engine sends on these topics (no insert policy for users).

-- Send one tick's changes for an org: a batched `state` message (changed fields per vehicle) and one
-- `status_changed` message per status change. Called by the engine tick with the service role.
create function public.engine_broadcast(p_org uuid, p_state jsonb, p_status jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e jsonb;
begin
  if jsonb_array_length(coalesce(p_state, '[]'::jsonb)) > 0 then
    perform realtime.send(jsonb_build_object('vehicles', p_state), 'state', 'org:' || p_org || ':vehicles', true);
  end if;
  for e in select * from jsonb_array_elements(coalesce(p_status, '[]'::jsonb)) loop
    perform realtime.send(e, 'status_changed', 'org:' || p_org || ':status', true);
  end loop;
end;
$$;
revoke all on function public.engine_broadcast(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.engine_broadcast(uuid, jsonb, jsonb) to service_role;
