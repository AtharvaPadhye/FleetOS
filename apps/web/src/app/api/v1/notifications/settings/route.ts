import { apiRoute } from "@/lib/api/handler";
import { getNotificationSettings, putNotificationSettings } from "@/lib/api/operations";
import { getNotificationSettings as read, saveNotificationSettings } from "@/lib/services/notifications";

export const dynamic = "force-dynamic";

const out = (s: Awaited<ReturnType<typeof read>>) => ({
  by_severity: s.by_severity,
  slack_webhook_configured: s.slack_webhook_configured,
});

/** Your channels per severity; `slack` is the org's (only owners/admins change it). */
export const GET = apiRoute(getNotificationSettings, async ({ db, org, user }) => ({
  body: out(await read(db, org, user.id)),
}));

export const PUT = apiRoute(putNotificationSettings, async ({ db, org, user, body }) => ({
  body: out(await saveNotificationSettings(db, org, user.id, body.by_severity ?? {})),
}));
