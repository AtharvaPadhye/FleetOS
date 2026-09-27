import { apiRoute } from "@/lib/api/handler";
import { getVendors, postVendor } from "@/lib/api/operations";
import { createVendor, listVendors } from "@/lib/services/vendors";

export const dynamic = "force-dynamic";

/** The vendor directory, optionally one category (VN-2). */
export const GET = apiRoute(getVendors, async ({ db, org, query }) => ({
  body: (await listVendors(db, org.id, query.category)).vendors,
}));

/** Add a vendor (VN-3; owner / admin / ops). */
export const POST = apiRoute(postVendor, async ({ db, org, body }) => ({
  body: await createVendor(db, org.id, body),
  status: 201,
}));
