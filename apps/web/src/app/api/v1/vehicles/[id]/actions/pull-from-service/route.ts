import { apiRoute } from "@/lib/api/handler";
import { uuidParam } from "@/lib/api/cursor";
import { postPullFromService } from "@/lib/api/operations";
import { pullFromService } from "@/lib/services/tickets";
import { getVehicleDetail } from "@/lib/services/vehicle-detail";

export const dynamic = "force-dynamic";

/** Manual Maintenance hold with a reason (vehicle-states.md §5); the engine applies it within a minute. */
export const POST = apiRoute(postPullFromService, async ({ db, org, params, body }) => {
  const id = uuidParam(params);
  await pullFromService(db, org, id, body.reason);
  return { body: await getVehicleDetail(db, org, { id }) };
});
