import { apiRoute } from "@/lib/api/handler";
import { uuidParam } from "@/lib/api/cursor";
import { historyPage } from "@/lib/api/history";
import { getVehicleStatusEvents } from "@/lib/api/operations";
import type { StatusEvent } from "@/lib/api/schemas";
import type { z } from "zod";

export const dynamic = "force-dynamic";

type Row = Omit<z.infer<typeof StatusEvent>, "id"> & { id: number };

/** A vehicle's status changes, newest first (the source of all hour accounting, kpis.md §2). */
export const GET = apiRoute(getVehicleStatusEvents, async ({ db, org, params, query }) => {
  const { rows, nextCursor, total } = await historyPage<Row>(db, {
    table: "vehicle_status_events",
    columns: "id, vehicle_id, from_status, to_status, at, cause_type, cause_id, detail",
    timeColumn: "at",
    orgId: org.id,
    vehicleId: uuidParam(params),
    query,
  });
  return {
    body: {
      data: rows.map((r) => ({ ...r, id: String(r.id), at: new Date(r.at).toISOString() })),
      page: { next_cursor: nextCursor, total, total_is_estimate: false },
    },
    dataSource: org.isDemo ? "simulated" : undefined,
  };
});
