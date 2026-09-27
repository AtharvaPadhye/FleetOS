import { apiRoute } from "@/lib/api/handler";
import { decodeCursor, encodeCursor, isOffsetCursor } from "@/lib/api/cursor";
import { getVehicles, postVehicle } from "@/lib/api/operations";
import { getVehicleDetail } from "@/lib/services/vehicle-detail";
import { createVehicle } from "@/lib/services/vehicles";
import { localDay } from "@/lib/api/period";
import { fleetCsv } from "@/lib/services/fleet-csv";
import { listFleet } from "@/lib/services/fleet";

export const dynamic = "force-dynamic";

/** Fleet list with live state and today's money: filter, sort, page, or export as CSV (FL-2/3/4). */
export const GET = apiRoute(getVehicles, async ({ db, org, query }) => {
  const csv = query.format === "csv";
  const offset = csv ? 0 : (decodeCursor(query.cursor, isOffsetCursor)?.o ?? 0);
  const now = new Date();
  const result = await listFleet(
    db,
    org,
    { ...query, offset, limit: csv ? Number.MAX_SAFE_INTEGER : query.limit },
    now,
  );
  const data = result.items.map(({ location_name, ...v }) => ({ ...v, state: { ...v.state, location_name } }));
  const dataSource = org.isDemo ? ("simulated" as const) : undefined;
  if (csv)
    return {
      raw: new Response(fleetCsv(data), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="fleet-${localDay(now, org.timezone)}.csv"`,
        },
      }),
      body: { data: [], page: { next_cursor: null, total: result.total, total_is_estimate: false } },
      dataSource,
    };
  return {
    body: {
      data,
      page: {
        next_cursor: offset + query.limit < result.total ? encodeCursor({ o: offset + query.limit }) : null,
        total: result.total,
        total_is_estimate: false,
      },
    },
    dataSource,
  };
});

/** Add a vehicle by hand (owner/admin); 201 with the new vehicle. */
export const POST = apiRoute(postVehicle, async ({ db, org, body }) => {
  const id = await createVehicle(db, org.id, body);
  return { body: await getVehicleDetail(db, org, { id }), status: 201 };
});
