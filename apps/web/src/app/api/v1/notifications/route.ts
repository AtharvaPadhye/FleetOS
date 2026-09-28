import { apiRoute } from "@/lib/api/handler";
import { decodeCursor, encodeCursor, isOffsetCursor } from "@/lib/api/cursor";
import { getNotifications } from "@/lib/api/operations";
import { listNotifications } from "@/lib/services/notifications";

export const dynamic = "force-dynamic";

/** Your notifications, newest first (GL-5); `unread=true` for the badge's items only. */
export const GET = apiRoute(getNotifications, async ({ db, org, user, query }) => {
  const offset = decodeCursor(query.cursor, isOffsetCursor)?.o ?? 0;
  const r = await listNotifications(db, org, user.id, { unread: query.unread, limit: query.limit, offset });
  return {
    body: {
      data: r.items.map((n) => ({
        id: n.id,
        kind: n.kind,
        payload: { severity: n.severity, title: n.title, body: n.body, href: n.href },
        created_at: n.created_at,
        read_at: n.read_at,
      })),
      page: {
        next_cursor: offset + query.limit < r.total ? encodeCursor({ o: offset + query.limit }) : null,
        total: r.total,
        total_is_estimate: false,
      },
    },
  };
});
