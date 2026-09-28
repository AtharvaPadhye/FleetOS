import { apiRoute } from "@/lib/api/handler";
import { postNotificationsRead } from "@/lib/api/operations";
import { markRead } from "@/lib/services/notifications";

export const dynamic = "force-dynamic";

/** Mark some (`ids`) or `all` of your notifications read (204). */
export const POST = apiRoute(postNotificationsRead, async ({ db, org, user, body }) => {
  await markRead(db, org, user.id, body);
  return { raw: new Response(null, { status: 204 }), body: null };
});
