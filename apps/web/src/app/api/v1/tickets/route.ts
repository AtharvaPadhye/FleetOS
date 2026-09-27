import { apiRoute } from "@/lib/api/handler";
import { decodeCursor, encodeCursor, isOffsetCursor } from "@/lib/api/cursor";
import { getTickets, postTicket } from "@/lib/api/operations";
import { createTicket, getTicket, listTickets } from "@/lib/services/tickets";

export const dynamic = "force-dynamic";

/** Tickets with the service summary (PRD SV-1, SV-2): filter by status, vehicle, vendor. */
export const GET = apiRoute(getTickets, async ({ db, org, query }) => {
  const offset = decodeCursor(query.cursor, isOffsetCursor)?.o ?? 0;
  const r = await listTickets(db, org, { ...query, offset });
  return {
    body: {
      data: r.items,
      page: {
        next_cursor: offset + query.limit < r.total ? encodeCursor({ o: offset + query.limit }) : null,
        total: r.total,
        total_is_estimate: false,
      },
      summary: r.summary,
    },
    dataSource: org.isDemo ? ("simulated" as const) : undefined,
  };
});

/** Open a ticket for a vehicle (VD-8), optionally dispatching a vendor straight away. */
export const POST = apiRoute(postTicket, async ({ db, org, body }) => {
  const id = await createTicket(db, org, body);
  return { body: await getTicket(db, org, { id }), status: 201 };
});
