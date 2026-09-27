import { apiRoute } from "@/lib/api/handler";
import { uuidParam } from "@/lib/api/cursor";
import { historyPage } from "@/lib/api/history";
import { getVehicleAlerts } from "@/lib/api/operations";

export const dynamic = "force-dynamic";

interface Row {
  id: string;
  name: string;
  audiences: string[];
  started_at: string;
  ended_at: string | null;
  source: string;
}

/** A vehicle's alerts, newest first; `active=true` for those still raised. */
export const GET = apiRoute(getVehicleAlerts, async ({ db, org, params, query }) => {
  const { rows, nextCursor, total } = await historyPage<Row>(db, {
    table: "vehicle_alerts",
    columns: "id, name, audiences, started_at, ended_at, source",
    timeColumn: "started_at",
    orgId: org.id,
    vehicleId: uuidParam(params),
    query,
    where:
      query.active === undefined
        ? undefined
        : (q) => (query.active ? q.is("ended_at", null) : q.not("ended_at", "is", null)),
  });
  return {
    body: {
      data: rows.map((r) => ({
        ...r,
        started_at: new Date(r.started_at).toISOString(),
        ended_at: r.ended_at ? new Date(r.ended_at).toISOString() : null,
      })),
      page: { next_cursor: nextCursor, total, total_is_estimate: false },
    },
    dataSource: org.isDemo ? "simulated" : undefined,
  };
});
