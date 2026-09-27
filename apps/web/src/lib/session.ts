import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export type Role = "owner" | "admin" | "ops" | "finance" | "viewer";

export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  timezone: string;
  isDemo: boolean;
  role: Role;
}

export interface AppContext {
  user: { id: string; email: string } | null;
  orgs: OrgSummary[];
  activeOrg: OrgSummary | null;
}

export const ACTIVE_ORG_COOKIE = "fo_org";

interface MembershipRow {
  role: Role;
  orgs: { id: string; name: string; slug: string; city: string | null; timezone: string; is_demo: boolean } | null;
}

/**
 * The signed-in user, their orgs (via RLS) and the active org. Cached per request.
 * The active org cookie is only a preference: it's honoured only if the user is a member (NFR TEN-2).
 */
export const getAppContext = cache(async (): Promise<AppContext> => {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const sub = claims?.claims?.sub;
  if (!sub) return { user: null, orgs: [], activeOrg: null };

  const { data, error } = await supabase
    .from("memberships")
    .select("role, orgs(id, name, slug, city, timezone, is_demo)")
    .eq("user_id", sub)
    .order("created_at", { ascending: true })
    .returns<MembershipRow[]>();
  if (error) throw new Error(`Could not load organizations: ${error.message}`);

  const orgs: OrgSummary[] = (data ?? [])
    .filter((m): m is MembershipRow & { orgs: NonNullable<MembershipRow["orgs"]> } => m.orgs !== null)
    .map((m) => ({
      id: m.orgs.id,
      name: m.orgs.name,
      slug: m.orgs.slug,
      city: m.orgs.city,
      timezone: m.orgs.timezone,
      isDemo: m.orgs.is_demo,
      role: m.role,
    }));

  const preferred = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value;
  const activeOrg = orgs.find((o) => o.id === preferred) ?? orgs[0] ?? null;
  const email = typeof claims.claims.email === "string" ? claims.claims.email : "";
  return { user: { id: sub, email }, orgs, activeOrg };
});
