import { apiRoute } from "@/lib/api/handler";
import { getMembers } from "@/lib/api/operations";
import { listMembers } from "@/lib/services/settings";

export const dynamic = "force-dynamic";

/** Members of the active org with their roles (ST-3). */
export const GET = apiRoute(getMembers, async ({ db, org }) => ({ body: await listMembers(db, org) }));
