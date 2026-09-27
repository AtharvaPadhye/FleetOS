import { apiRoute } from "@/lib/api/handler";
import { uuidParam } from "@/lib/api/cursor";
import { historyPage } from "@/lib/api/history";
import { getVehicleCabinEvents } from "@/lib/api/operations";

export const dynamic = "force-dynamic";

interface Row {
  id: string;
  vehicle_id: string;
  at: string;
  kind: "spill" | "debris" | "lost_item" | "odor" | "damage" | "other";
  confidence: number | string | null;
  ride_id: string | null;
}

/** Preview `cabin_events`: interior cleanliness events for a vehicle, newest first. */
export const GET = apiRoute(getVehicleCabinEvents, async ({ db, org, params, query }) => {
  const { rows, nextCursor, total } = await historyPage<Row>(db, {
    table: "cabin_events",
    columns: "id, vehicle_id, at, kind, confidence, ride_id",
    timeColumn: "at",
    orgId: org.id,
    vehicleId: uuidParam(params),
    query,
  });
  return {
    body: {
      data: rows.map((r) => ({
        id: r.id,
        vehicle_id: r.vehicle_id,
        at: new Date(r.at).toISOString(),
        kind: r.kind,
        ...(r.confidence === null ? {} : { confidence: Number(r.confidence) }),
        ride_id: r.ride_id,
      })),
      page: { next_cursor: nextCursor, total, total_is_estimate: false },
    },
  };
});
