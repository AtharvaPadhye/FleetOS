import { apiRoute } from "@/lib/api/handler";
import { getVendorRank } from "@/lib/api/operations";
import { rankForVehicle } from "@/lib/services/vendors";

export const dynamic = "force-dynamic";

/** Vendors covering a vehicle for a category, best first, with the score breakdown (VN-4). */
export const GET = apiRoute(getVendorRank, async ({ db, org, query }) => ({
  body: await rankForVehicle(db, org.id, query.vehicle_id, query.category),
}));
