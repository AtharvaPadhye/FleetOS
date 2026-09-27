import { apiRoute } from "@/lib/api/handler";
import { decodeCursor, encodeCursor, isOffsetCursor } from "@/lib/api/cursor";
import { getExceptions, postException } from "@/lib/api/operations";
import { createException, getExceptionOut, listExceptions } from "@/lib/services/exceptions";

export const dynamic = "force-dynamic";

/** Exceptions with the org-wide summary (PRD EX-1, EX-3): filter by status, severity, vehicle. */
export const GET = apiRoute(getExceptions, async ({ db, org, query }) => {
  const offset = decodeCursor(query.cursor, isOffsetCursor)?.o ?? 0;
  const r = await listExceptions(db, org, { ...query, offset });
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

/** Report an exception by hand (PRD EX-2); 201 with the new exception. */
export const POST = apiRoute(postException, async ({ db, org, body }) => {
  const id = await createException(db, org, body);
  return { body: await getExceptionOut(db, org, id), status: 201 };
});
