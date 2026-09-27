import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrgContext } from "@/lib/api/handler";
import { groupAttention } from "@/lib/attention";
import { listExceptions } from "./exceptions";

/** The Overview attention queue for an org (PRD OV-2); grouping and ranking live in `lib/attention.ts`. */
export async function attention(db: SupabaseClient, org: Pick<OrgContext, "id" | "timezone">, now = new Date()) {
  const { items } = await listExceptions(
    db,
    org,
    { status: ["open", "assigned", "in_progress"], sort: "-revenue_at_risk", limit: 1000, offset: 0 },
    now,
  );
  const { data, error } = items.length
    ? await db
        .from("exceptions")
        .select("id, baseline_rate_cents_per_h")
        .eq("org_id", org.id)
        .in(
          "id",
          items.map((e) => e.id),
        )
    : { data: [], error: null };
  if (error) throw new Error(error.message);
  const rates = new Map(
    ((data ?? []) as { id: string; baseline_rate_cents_per_h: number | null }[]).map((r) => [
      r.id,
      r.baseline_rate_cents_per_h,
    ]),
  );
  return { groups: groupAttention(items, rates, now.getTime()), asOf: now.getTime() };
}
