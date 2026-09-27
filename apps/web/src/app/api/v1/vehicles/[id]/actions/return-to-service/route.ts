import { apiRoute } from "@/lib/api/handler";
import { uuidParam } from "@/lib/api/cursor";
import { postReturnToService } from "@/lib/api/operations";
import { returnToService } from "@/lib/services/tickets";
import { getVehicleDetail } from "@/lib/services/vehicle-detail";

export const dynamic = "force-dynamic";

/**
 * Release manual holds; 422 naming what else still blocks the car unless `override` (owner/admin) with a
 * `reason`. Re-enabling the car on the robotaxi network is manual until the dispatch capability is live.
 */
export const POST = apiRoute(postReturnToService, async ({ db, org, params, body }) => {
  const id = uuidParam(params);
  await returnToService(db, org, id, body);
  return { body: await getVehicleDetail(db, org, { id }) };
});
