import { apiRoute } from "@/lib/api/handler";
import { uuidParam } from "@/lib/api/cursor";
import { historyPage } from "@/lib/api/history";
import { getVehicleAutonomyEvents } from "@/lib/api/operations";

export const dynamic = "force-dynamic";

interface Row {
  id: string;
  vehicle_id: string;
  at: string;
  kind: "disengagement" | "remote_assist" | "incident" | "stuck";
  lat: number | null;
  lng: number | null;
  severity: "critical" | "high" | "medium" | "low" | null;
  detail: string | null;
}

/** Preview `autonomy_events`: disengagements, remote assist, incidents, stuck events; newest first. */
export const GET = apiRoute(getVehicleAutonomyEvents, async ({ db, org, params, query }) => {
  const { rows, nextCursor, total } = await historyPage<Row>(db, {
    table: "autonomy_events",
    columns: "id, vehicle_id, at, kind, lat, lng, severity, detail",
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
        location: r.lat !== null && r.lng !== null ? { lat: r.lat, lng: r.lng } : null,
        severity: r.severity,
        detail: r.detail,
      })),
      page: { next_cursor: nextCursor, total, total_is_estimate: false },
    },
  };
});
