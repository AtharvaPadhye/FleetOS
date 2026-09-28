import type { Metadata } from "next";
import { ActionForm } from "@/components/settings/action-form";
import { ReadonlyNote } from "@/components/settings/readonly-note";
import { inviteMember, memberAction } from "@/app/actions/settings";
import { formatWhen } from "@/lib/format";
import { getAppContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { listInvitations, listMembers } from "@/lib/services/settings";

export const metadata: Metadata = { title: "Settings · Members" };

const input = "h-11 rounded-sm border border-border-control bg-canvas px-3 text-body text-fg lg:h-9";
const ROLES = [
  { value: "admin", label: "Admin", help: "Everything except ownership" },
  { value: "ops", label: "Ops", help: "Exceptions, service, vendors, hubs" },
  { value: "finance", label: "Finance", help: "Money and revenue imports" },
  { value: "viewer", label: "Viewer", help: "Read-only, no money" },
];

/** ST-3: members, roles and invitations (the last owner can't be removed or demoted). */
export default async function MembersPage() {
  const { user, activeOrg } = await getAppContext();
  if (!activeOrg || !user) return null;
  const db = await createClient();
  const canEdit = ["owner", "admin"].includes(activeOrg.role);
  const [members, invitations] = await Promise.all([
    listMembers(db, activeOrg),
    canEdit ? listInvitations(db, activeOrg) : Promise.resolve([]),
  ]);
  return (
    <div className="flex flex-col gap-8">
      {canEdit ? (
        <section aria-labelledby="invite" className="flex max-w-2xl flex-col gap-3">
          <h2 id="invite" className="text-title font-semibold">
            Invite someone
          </h2>
          <ActionForm action={inviteMember} submit="Send invitation">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="invite-email" className="text-label font-medium">
                  Email
                </label>
                <input id="invite-email" name="email" type="email" autoComplete="off" className={input} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="invite-role" className="text-label font-medium">
                  Role
                </label>
                <select id="invite-role" name="role" defaultValue="ops" className={input}>
                  {ROLES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <ul className="grid gap-x-6 gap-y-1 text-label text-fg-muted sm:grid-cols-2">
              {ROLES.map((r) => (
                <li key={r.value}>
                  <span className="font-medium text-fg">{r.label}</span>: {r.help}
                </li>
              ))}
            </ul>
          </ActionForm>
        </section>
      ) : (
        <ReadonlyNote />
      )}

      <section aria-labelledby="members" className="flex flex-col gap-3">
        <h2 id="members" className="text-title font-semibold">
          Members ({members.length})
        </h2>
        <ul className="divide-y divide-divider rounded-md border border-divider bg-surface">
          {members.map((m) => (
            <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 flex-col">
                <span className="font-medium">
                  {m.full_name ?? m.email}
                  {m.user_id === user.id ? <span className="text-label text-fg-muted"> (you)</span> : null}
                </span>
                <span className="text-label text-fg-muted">
                  {m.full_name ? `${m.email} · ` : ""}joined {formatWhen(m.joined_at, activeOrg.timezone)}
                </span>
              </div>
              {canEdit && m.role !== "owner" ? (
                <div className="flex flex-wrap items-start gap-2">
                  <ActionForm action={memberAction} submit="Change role" className="flex items-start gap-2">
                    <input type="hidden" name="kind" value="role" />
                    <input type="hidden" name="id" value={m.user_id} />
                    <label htmlFor={`role-${m.user_id}`} className="sr-only">
                      Role for {m.email}
                    </label>
                    <select id={`role-${m.user_id}`} name="role" defaultValue={m.role} className={input}>
                      {ROLES.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </ActionForm>
                  {m.user_id !== user.id ? (
                    <ActionForm action={memberAction} submit={`Remove ${m.email}`} className="flex items-start gap-2">
                      <input type="hidden" name="kind" value="remove" />
                      <input type="hidden" name="id" value={m.user_id} />
                    </ActionForm>
                  ) : null}
                </div>
              ) : (
                <span className="text-label font-medium capitalize">{m.role}</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {canEdit ? (
        <section aria-labelledby="pending" className="flex flex-col gap-3">
          <h2 id="pending" className="text-title font-semibold">
            Pending invitations
          </h2>
          {invitations.length ? (
            <ul className="divide-y divide-divider rounded-md border border-divider bg-surface">
              {invitations.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <span>
                    {i.email}{" "}
                    <span className="text-label text-fg-muted capitalize">
                      · {i.role} · expires {formatWhen(i.expires_at, activeOrg.timezone)}
                    </span>
                  </span>
                  <div className="flex flex-wrap items-start gap-2">
                    <ActionForm action={inviteMember} submit="Resend" className="flex items-start gap-2">
                      <input type="hidden" name="email" value={i.email} />
                      <input type="hidden" name="role" value={i.role} />
                    </ActionForm>
                    <ActionForm action={memberAction} submit={`Revoke ${i.email}`} className="flex items-start gap-2">
                      <input type="hidden" name="kind" value="revoke" />
                      <input type="hidden" name="id" value={i.id} />
                    </ActionForm>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-fg-muted">No pending invitations.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
