import { apiRoute } from "@/lib/api/handler";
import { uuidParam } from "@/lib/api/cursor";
import { getHubOccupancy } from "@/lib/api/operations";
import { hubView } from "@/lib/services/hubs";

export const dynamic = "force-dynamic";

/** Cars at the hub now and chargers in use (inferred from charging state until charger telemetry exists). */
export const GET = apiRoute(getHubOccupancy, async ({ db, org, params }) => {
  const { hub } = await hubView(db, org, uuidParam(params));
  return {
    body: {
      hub_id: hub.id,
      vehicles_present: hub.present.map((p) => ({
        vehicle_id: p.vehicle_id,
        number: p.number,
        status: p.status,
        soc: p.soc,
      })),
      chargers_total: hub.chargers_total,
      chargers_occupied: hub.chargers_occupied,
      source: hub.chargers_occupied_source,
    },
  };
});
