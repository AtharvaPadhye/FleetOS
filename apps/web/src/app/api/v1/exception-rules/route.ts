import { apiRoute } from "@/lib/api/handler";
import { getExceptionRules, postExceptionRule } from "@/lib/api/operations";
import { createRule, listRules } from "@/lib/services/exceptions";

export const dynamic = "force-dynamic";

/** The org's exception rules, system rules first (PRD EX-5). */
export const GET = apiRoute(getExceptionRules, async ({ db, org }) => ({ body: await listRules(db, org.id) }));

/** Add a rule (owner / admin); needs key, name, condition, class and severity. */
export const POST = apiRoute(postExceptionRule, async ({ db, org, body }) => ({
  body: await createRule(db, org.id, body),
  status: 201,
}));
