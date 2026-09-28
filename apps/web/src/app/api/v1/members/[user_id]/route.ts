import { apiRoute } from "@/lib/api/handler";
import { uuidParam } from "@/lib/api/cursor";
import { deleteMember, patchMember } from "@/lib/api/operations";
import { removeMember, setMemberRole } from "@/lib/services/settings";

export const dynamic = "force-dynamic";

/** Change a member's role (owner/admin; only owners grant or remove ownership; the last owner stays). */
export const PATCH = apiRoute(patchMember, async ({ db, org, params, body }) => ({
  body: await setMemberRole(db, org, uuidParam(params, "user_id"), body.role),
}));

/** Remove a member (204). */
export const DELETE = apiRoute(deleteMember, async ({ db, org, params }) => {
  await removeMember(db, org, uuidParam(params, "user_id"));
  return { raw: new Response(null, { status: 204 }), body: null };
});
