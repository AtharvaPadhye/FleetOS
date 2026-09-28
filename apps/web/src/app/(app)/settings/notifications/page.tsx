import type { Metadata } from "next";
import { SEVERITIES } from "@fleetos/domain";
import { SeverityBadge } from "@fleetos/ui/components/severity-badge";
import { ActionForm } from "@/components/settings/action-form";
import { SendTestButton } from "@/components/settings/test-button";
import { saveNotificationPrefs, saveSlackWebhook } from "@/app/actions/notifications";
import { getAppContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { getNotificationSettings } from "@/lib/services/notifications";

export const metadata: Metadata = { title: "Settings · Notifications" };
const input = "h-11 w-full rounded-sm border border-border-control bg-canvas px-3 text-body text-fg lg:h-9";

/** ST-6: which severities reach you in the app and by email, and (for the org) which go to Slack. */
export default async function NotificationSettingsPage() {
  const { user, activeOrg } = await getAppContext();
  if (!activeOrg || !user) return null;
  const s = await getNotificationSettings(await createClient(), activeOrg, user.id);
  const channels: { key: "in_app" | "email" | "slack"; label: string }[] = [
    { key: "in_app", label: "In the app" },
    { key: "email", label: `Email (${user.email})` },
    ...(s.can_manage_slack && s.slack_webhook_configured
      ? [{ key: "slack" as const, label: "Slack (whole org)" }]
      : []),
  ];
  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <section aria-labelledby="matrix" className="flex flex-col gap-3">
        <div>
          <h2 id="matrix" className="text-title font-semibold">
            What reaches you
          </h2>
          <p className="text-label text-fg-muted">
            New exceptions by severity and missed SLAs. Updates on tickets you opened always appear in the app.
          </p>
        </div>
        <ActionForm action={saveNotificationPrefs} submit="Save preferences">
          {s.can_manage_slack && s.slack_webhook_configured ? (
            <input type="hidden" name="manage_slack" value="1" />
          ) : null}
          <div
            className="overflow-x-auto rounded-md border border-divider"
            role="region"
            aria-labelledby="matrix"
            tabIndex={0}
          >
            <table className="w-full min-w-[28rem] text-body">
              <thead className="bg-raised text-left text-label text-fg-muted">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Severity
                  </th>
                  {channels.map((c) => (
                    <th key={c.key} scope="col" className="px-3 py-2 font-medium">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-divider">
                {SEVERITIES.map((sev) => (
                  <tr key={sev}>
                    <th scope="row" className="px-3 py-2 text-left font-normal">
                      <SeverityBadge severity={sev} />
                    </th>
                    {channels.map((c) => (
                      <td key={c.key} className="px-3 py-2">
                        <input
                          type="checkbox"
                          name={`${sev}_${c.key}`}
                          defaultChecked={s.by_severity[sev][c.key]}
                          aria-label={`${sev} ${c.label}`}
                          className="size-4 accent-[var(--fo-chalk)]"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ActionForm>
        <SendTestButton />
      </section>

      {s.can_manage_slack ? (
        <section aria-labelledby="slack" className="flex flex-col gap-3">
          <div>
            <h2 id="slack" className="text-title font-semibold">
              Slack
            </h2>
            <p className="text-label text-fg-muted">
              {s.slack_webhook_configured
                ? "Connected. Paste a new webhook to change the channel."
                : "Create an incoming webhook for a channel in Slack and paste it here. FleetOS posts critical and high issues there."}
            </p>
          </div>
          <ActionForm action={saveSlackWebhook} submit={s.slack_webhook_configured ? "Update Slack" : "Connect Slack"}>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="webhook" className="text-label font-medium">
                Incoming webhook URL
              </label>
              <input
                id="webhook"
                name="webhook"
                type="url"
                placeholder={
                  s.slack_webhook_configured ? "•••••• (connected; stays hidden)" : "https://hooks.slack.com/services/…"
                }
                autoComplete="off"
                className={input}
              />
            </div>
            {s.slack_webhook_configured ? (
              <label className="flex min-h-11 items-center gap-2 lg:min-h-9">
                <input type="checkbox" name="disconnect" className="size-4 accent-[var(--fo-chalk)]" />
                Disconnect Slack
              </label>
            ) : null}
          </ActionForm>
        </section>
      ) : null}
    </div>
  );
}
