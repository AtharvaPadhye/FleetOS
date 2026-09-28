import { apiRoute } from "@/lib/api/handler";
import { getCovenants, putCovenants } from "@/lib/api/operations";
import { listCovenants, saveCovenants } from "@/lib/services/reports";

export const dynamic = "force-dynamic";

/** The covenant thresholds reports check (RP-2). */
export const GET = apiRoute(getCovenants, async ({ db, org }) => ({ body: await listCovenants(db, org) }));

/** Replace them (owner/admin); metrics left out are removed. Existing reports are unchanged. */
export const PUT = apiRoute(putCovenants, async ({ db, org, body }) => ({ body: await saveCovenants(db, org, body) }));
