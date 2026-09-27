import { apiRoute } from "@/lib/api/handler";
import { historyPage } from "@/lib/api/history";
import { getRides } from "@/lib/api/operations";
import { RIDE_COLUMNS, toRide, type RideRow } from "@/lib/api/rides";

export const dynamic = "force-dynamic";

/** Preview `rides`: trips for the fleet or one vehicle, newest first. */
export const GET = apiRoute(getRides, async ({ db, org, query }) => {
  const { rows, nextCursor, total } = await historyPage<RideRow>(db, {
    table: "ride_list",
    columns: RIDE_COLUMNS,
    timeColumn: "started_at",
    orgId: org.id,
    vehicleId: query.vehicle_id ?? null,
    query,
  });
  return { body: { data: rows.map(toRide), page: { next_cursor: nextCursor, total, total_is_estimate: false } } };
});
