import { apiRoute, ApiProblem } from "@/lib/api/handler";
import { getOrgs } from "@/lib/api/operations";
import { ORG_COLUMNS, toOrg, type OrgRow } from "@/lib/api/orgs";

export const dynamic = "force-dynamic";

/** Orgs the user belongs to (row-level security limits the rows). */
export const GET = apiRoute(getOrgs, async ({ db }) => {
  const { data, error } = await db.from("orgs").select(ORG_COLUMNS).order("name").returns<OrgRow[]>();
  if (error) throw new ApiProblem("internal", error.message);
  return { body: (data ?? []).map(toOrg) };
});
