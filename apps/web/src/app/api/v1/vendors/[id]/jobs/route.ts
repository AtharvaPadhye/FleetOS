import { apiRoute } from "@/lib/api/handler";
import { decodeCursor, encodeCursor, isOffsetCursor, uuidParam } from "@/lib/api/cursor";
import { getVendorJobs } from "@/lib/api/operations";
import { getVendor } from "@/lib/services/vendors";
import { vendorJobs } from "@/lib/services/tickets";

export const dynamic = "force-dynamic";

/** A vendor's job history, newest first (VN-5). */
export const GET = apiRoute(getVendorJobs, async ({ db, org, params, query }) => {
  const vendor = await getVendor(db, org.id, { id: uuidParam(params) });
  const offset = decodeCursor(query.cursor, isOffsetCursor)?.o ?? 0;
  const r = await vendorJobs(db, org, vendor.id, { limit: query.limit, offset });
  return {
    body: {
      data: r.items,
      page: {
        next_cursor: offset + query.limit < r.total ? encodeCursor({ o: offset + query.limit }) : null,
        total: r.total,
        total_is_estimate: false,
      },
    },
  };
});
