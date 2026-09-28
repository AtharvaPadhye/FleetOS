import { apiRoute } from "@/lib/api/handler";
import { getSlaPolicies, putSlaPolicies } from "@/lib/api/operations";
import { listSlaPolicies, saveSlaPolicies } from "@/lib/services/settings";

export const dynamic = "force-dynamic";

/** SLA targets per ticket type; new tickets take their clocks from them. */
export const GET = apiRoute(getSlaPolicies, async ({ db, org }) => ({ body: await listSlaPolicies(db, org) }));

export const PUT = apiRoute(putSlaPolicies, async ({ db, org, body }) => ({
  body: await saveSlaPolicies(db, org, body),
}));
