import { apiRoute } from "@/lib/api/handler";
import { uuidParam } from "@/lib/api/cursor";
import { getVehicleKpis } from "@/lib/api/operations";
import { getVehicleKpis as vehicleKpisService } from "@/lib/services/kpis";

export const dynamic = "force-dynamic";

/** One vehicle's KPIs against the fleet average (default: last 30 days) and its performance label. */
export const GET = apiRoute(getVehicleKpis, async ({ db, org, params, query }) => ({
  body: await vehicleKpisService(db, org, uuidParam(params), query),
  dataSource: org.isDemo ? "simulated" : undefined,
}));
