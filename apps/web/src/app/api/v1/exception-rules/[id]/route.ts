import { apiRoute } from "@/lib/api/handler";
import { uuidParam } from "@/lib/api/cursor";
import { deleteExceptionRule, patchExceptionRule } from "@/lib/api/operations";
import { deleteRule, updateRule } from "@/lib/services/exceptions";

export const dynamic = "force-dynamic";

/** Change a rule; system rules keep their key but everything else, including `enabled`, can change. */
export const PATCH = apiRoute(patchExceptionRule, async ({ db, org, params, body }) => ({
  body: await updateRule(db, org.id, uuidParam(params), body),
}));

/** Delete a custom rule (204); system rules can only be disabled. */
export const DELETE = apiRoute(deleteExceptionRule, async ({ db, org, params }) => {
  await deleteRule(db, org.id, uuidParam(params));
  return { raw: new Response(null, { status: 204 }), body: null };
});
