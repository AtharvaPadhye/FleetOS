import { apiRoute } from "@/lib/api/handler";
import { uuidParam } from "@/lib/api/cursor";
import { historyPage } from "@/lib/api/history";
import { getVehicleChargingSessions } from "@/lib/api/operations";
import type { ChargingSession } from "@/lib/api/schemas";
import type { z } from "zod";

export const dynamic = "force-dynamic";

type Row = Omit<z.infer<typeof ChargingSession>, "energy_kwh" | "cost_cents"> & {
  energy_kwh: number | string;
  cost_cents: number | string;
};

/** A vehicle's charging sessions with energy and cost at the hub's tariff, newest first (task 3.7). */
export const GET = apiRoute(getVehicleChargingSessions, async ({ db, org, params, query }) => {
  const { rows, nextCursor, total } = await historyPage<Row>(db, {
    table: "charging_sessions",
    columns: "id, hub_id, started_at, ended_at, energy_kwh, cost_cents, source",
    timeColumn: "started_at",
    orgId: org.id,
    vehicleId: uuidParam(params),
    query,
  });
  return {
    body: {
      data: rows.map((r) => ({
        ...r,
        started_at: new Date(r.started_at).toISOString(),
        ended_at: r.ended_at ? new Date(r.ended_at).toISOString() : null,
        energy_kwh: Number(r.energy_kwh),
        cost_cents: Number(r.cost_cents),
      })),
      page: { next_cursor: nextCursor, total, total_is_estimate: false },
    },
    dataSource: org.isDemo ? "simulated" : undefined,
  };
});
