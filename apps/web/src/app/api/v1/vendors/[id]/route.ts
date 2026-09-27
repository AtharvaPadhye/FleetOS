import { apiRoute } from "@/lib/api/handler";
import { uuidParam } from "@/lib/api/cursor";
import { getVendor, patchVendor } from "@/lib/api/operations";
import { getVendor as getVendorService, updateVendor } from "@/lib/services/vendors";

export const dynamic = "force-dynamic";

export const GET = apiRoute(getVendor, async ({ db, org, params }) => ({
  body: await getVendorService(db, org.id, { id: uuidParam(params) }),
}));

/** Change any vendor field (owner / admin / ops). */
export const PATCH = apiRoute(patchVendor, async ({ db, org, params, body }) => ({
  body: await updateVendor(db, org.id, uuidParam(params), body),
}));
