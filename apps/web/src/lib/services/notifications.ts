import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SEVERITIES, type Severity } from "@fleetos/domain";
import { ApiProblem } from "@/lib/api/problem";
import type { OrgContext } from "@/lib/api/handler";

/** The bell and notification preferences (task 5.11, PRD GL-5, ST-6). */
type Org = Pick<OrgContext, "id" | "role">;
export type Channel = "in_app" | "email" | "slack";
export type BySeverity = Record<Severity, { in_app: boolean; email: boolean; slack: boolean }>;

const DEFAULTS: Record<Severity, { in_app: boolean; email: boolean }> = {
  critical: { in_app: true, email: true },
  high: { in_app: true, email: false },
  medium: { in_app: false, email: false },
  low: { in_app: false, email: false },
};

export interface NotificationOut {
  id: string;
  kind: string;
  severity: Severity;
  title: string;
  body: string | null;
  href: string | null;
  created_at: string;
  read_at: string | null;
}

/** Unread count for the badge: critical/high items plus updates on your tickets (flows.md GL-5). */
export async function unreadCount(db: SupabaseClient, org: Pick<Org, "id">, userId: string) {
  const { count, error } = await db
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("org_id", org.id)
    .eq("user_id", userId)
    .eq("in_app", true)
    .is("read_at", null)
    .or("severity.in.(critical,high),kind.eq.ticket_update,kind.eq.test");
  if (error) throw new ApiProblem("internal", error.message);
  return count ?? 0;
}

export async function listNotifications(
  db: SupabaseClient,
  org: Pick<Org, "id">,
  userId: string,
  q: { unread?: boolean; limit: number; offset: number },
) {
  let query = db
    .from("notifications")
    .select("id, kind, severity, title, body, href, created_at, read_at", { count: "exact" })
    .eq("org_id", org.id)
    .eq("user_id", userId)
    .eq("in_app", true)
    .order("created_at", { ascending: false })
    .range(q.offset, q.offset + q.limit - 1);
  if (q.unread) query = query.is("read_at", null);
  const { data, error, count } = await query;
  if (error) throw new ApiProblem("internal", error.message);
  return {
    items: ((data ?? []) as NotificationOut[]).map((n) => ({
      ...n,
      created_at: new Date(n.created_at).toISOString(),
      read_at: n.read_at ? new Date(n.read_at).toISOString() : null,
    })),
    total: count ?? 0,
  };
}

export async function markRead(
  db: SupabaseClient,
  org: Pick<Org, "id">,
  userId: string,
  input: { ids?: string[]; all?: boolean },
) {
  if (!input.all && !input.ids?.length) throw new ApiProblem("validation_failed", "Send ids or all: true.");
  let q = db
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("org_id", org.id)
    .eq("user_id", userId)
    .is("read_at", null);
  if (!input.all) q = q.in("id", input.ids!);
  const { error } = await q;
  if (error) throw new ApiProblem("internal", error.message);
}

export async function getNotificationSettings(db: SupabaseClient, org: Org, userId: string) {
  const [mine, integ] = await Promise.all([
    db.from("notification_settings").select("by_severity").eq("org_id", org.id).eq("user_id", userId).maybeSingle(),
    // Only owners/admins can read the org's Slack settings (the webhook is a secret).
    db.from("org_integrations").select("slack_webhook_url, slack_severities").eq("org_id", org.id).maybeSingle(),
  ]);
  const prefs = (mine.data?.by_severity ?? DEFAULTS) as Record<Severity, { in_app: boolean; email: boolean }>;
  const slack = integ.data as { slack_webhook_url: string | null; slack_severities: Severity[] } | null;
  const by_severity = Object.fromEntries(
    SEVERITIES.map((s) => [
      s,
      {
        in_app: Boolean(prefs[s]?.in_app),
        email: Boolean(prefs[s]?.email),
        slack: Boolean(slack?.slack_webhook_url && slack.slack_severities.includes(s)),
      },
    ]),
  ) as BySeverity;
  return {
    by_severity,
    slack_webhook_configured: Boolean(slack?.slack_webhook_url),
    can_manage_slack: ["owner", "admin"].includes(org.role),
  };
}

/**
 * Save the caller's in-app and email choices; owners/admins also set which severities go to Slack (org-wide).
 * Others sending a different Slack choice get 403 rather than a silent ignore.
 */
export async function saveNotificationSettings(
  db: SupabaseClient,
  org: Org,
  userId: string,
  input: Partial<Record<Severity, Partial<Record<Channel, boolean>>>>,
) {
  const current = await getNotificationSettings(db, org, userId);
  const next = Object.fromEntries(
    SEVERITIES.map((s) => [
      s,
      {
        in_app: input[s]?.in_app ?? current.by_severity[s].in_app,
        email: input[s]?.email ?? current.by_severity[s].email,
      },
    ]),
  );
  const { error } = await db
    .from("notification_settings")
    .upsert({ org_id: org.id, user_id: userId, by_severity: next, updated_at: new Date().toISOString() });
  if (error) throw new ApiProblem("internal", error.message);
  const slackChange = SEVERITIES.some(
    (s) => input[s]?.slack !== undefined && input[s]!.slack !== current.by_severity[s].slack,
  );
  if (slackChange) {
    if (!current.can_manage_slack)
      throw new ApiProblem("forbidden", "Only owners and admins choose what goes to Slack.");
    const severities = SEVERITIES.filter((s) => input[s]?.slack ?? current.by_severity[s].slack);
    const { error: sErr } = await db
      .from("org_integrations")
      .upsert({ org_id: org.id, slack_severities: severities, updated_at: new Date().toISOString() });
    if (sErr) throw new ApiProblem("internal", sErr.message);
  }
  return getNotificationSettings(db, org, userId);
}

/** Set or clear the org's Slack incoming webhook (owner/admin). */
export async function setSlackWebhook(db: SupabaseClient, org: Org, url: string | null) {
  if (url && !/^https:\/\/hooks\.slack\.com\//.test(url))
    throw new ApiProblem("validation_failed", "Paste a Slack incoming webhook URL (https://hooks.slack.com/…).");
  const { error } = await db
    .from("org_integrations")
    .upsert({ org_id: org.id, slack_webhook_url: url, updated_at: new Date().toISOString() });
  if (error) {
    if (error.code === "42501") throw new ApiProblem("forbidden", "Only owners and admins can connect Slack.");
    throw new ApiProblem("internal", error.message);
  }
}

export async function sendTestNotification(db: SupabaseClient, org: Pick<Org, "id">) {
  const { error } = await db.rpc("send_test_notification", { p_org: org.id });
  if (error) throw new ApiProblem(error.code === "42501" ? "forbidden" : "internal", error.message);
}
