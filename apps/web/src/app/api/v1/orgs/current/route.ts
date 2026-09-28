import { apiRoute } from "@/lib/api/handler";
import { patchOrgCurrent } from "@/lib/api/operations";
import { updateOrg } from "@/lib/services/settings";

export const dynamic = "force-dynamic";

/** Edit the active org's details and targets (owner/admin; audited). */
export const PATCH = apiRoute(patchOrgCurrent, async ({ db, org, body }) => ({ body: await updateOrg(db, org, body) }));
