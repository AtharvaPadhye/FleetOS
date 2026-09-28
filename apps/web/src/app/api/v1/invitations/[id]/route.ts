import { apiRoute } from "@/lib/api/handler";
import { uuidParam } from "@/lib/api/cursor";
import { deleteInvitation } from "@/lib/api/operations";
import { revokeInvitation } from "@/lib/services/settings";

export const dynamic = "force-dynamic";

/** Revoke a pending invitation (204). */
export const DELETE = apiRoute(deleteInvitation, async ({ db, org, params }) => {
  await revokeInvitation(db, org, uuidParam(params));
  return { raw: new Response(null, { status: 204 }), body: null };
});
