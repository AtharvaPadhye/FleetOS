import { apiRoute } from "@/lib/api/handler";
import { uuidParam } from "@/lib/api/cursor";
import { getVehicle } from "@/lib/api/operations";
import { getVehicleDetail } from "@/lib/services/vehicle-detail";

export const dynamic = "force-dynamic";

/** One vehicle with live state, configuration and active holds. Monthly costs only for money roles. */
export const GET = apiRoute(getVehicle, async ({ db, org, params }) => ({
  body: await getVehicleDetail(db, org, { id: uuidParam(params) }),
  dataSource: org.isDemo ? "simulated" : undefined,
}));
