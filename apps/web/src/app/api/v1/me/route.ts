import { apiRoute, ApiProblem } from "@/lib/api/handler";
import { getMe } from "@/lib/api/operations";
import { ORG_COLUMNS, toOrg, type OrgRow } from "@/lib/api/orgs";
import type { ROLES } from "@/lib/api/schemas";

export const dynamic = "force-dynamic";

/** The signed-in user and their memberships. `active_org_id` echoes X-FleetOS-Org when it's valid. */
export const GET = apiRoute(getMe, async ({ db, user, org }) => {
  const [{ data: memberships, error }, { data: profile }] = await Promise.all([
    db
      .from("memberships")
      .select(`role, orgs(${ORG_COLUMNS})`)
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .returns<{ role: (typeof ROLES)[number]; orgs: OrgRow | null }[]>(),
    db.from("profiles").select("full_name").eq("user_id", user.id).maybeSingle(),
  ]);
  if (error) throw new ApiProblem("internal", error.message);
  return {
    body: {
      user_id: user.id,
      email: user.email,
      full_name: (profile?.full_name as string | null | undefined) ?? null,
      ...(org ? { active_org_id: org.id } : {}),
      memberships: (memberships ?? []).flatMap((m) => (m.orgs ? [{ org: toOrg(m.orgs), role: m.role }] : [])),
    },
  };
});
