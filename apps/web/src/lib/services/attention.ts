import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrgContext } from "@/lib/api/handler";
import { groupAttention, type AttentionGroup } from "@/lib/attention";
import { hubsSnapshot } from "./hubs";
import { listExceptions } from "./exceptions";

/** The Overview attention queue for an org (PRD OV-2); grouping and ranking live in `lib/attention.ts`. */
export async function attention(
  db: SupabaseClient,
  org: Pick<OrgContext, "id" | "timezone" | "role" | "isDemo">,
  now = new Date(),
) {
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
  // Hub overload warnings (PRD HB-3) sit in the same queue, ranked by the revenue their plan would keep.
  const { hubs } = await hubsSnapshot(db, org, now);
  const tf = new Intl.DateTimeFormat("en-US", { timeZone: org.timezone, hour: "numeric", minute: "2-digit" });
  const hubGroups: AttentionGroup[] = hubs.flatMap((h) => {
    const w = h.overloads[0];
    if (!w) return [];
    const best = h.recommendations.find((r) => r.status === "proposed");
    return [
      {
        key: `hub:${h.id}`,
        severity: "high" as const,
        title: `${h.name} forecast ${Math.round(w.peak * 100)}% ${tf.format(new Date(w.from))}–${tf.format(new Date(w.to))}`,
        subtitle: `More cars need chargers than the hub's ${h.chargers_total}`,
        affected_count: best?.vehicleIds.length ?? 0,
        affected_label: best ? `Cars ${best.vehicleNumbers.join(", ")}` : "",
        revenue_at_risk_cents: best?.impactCents ?? 0,
        recommended_action: best?.title ?? "Review the hub's plan",
        action: { kind: "open_hub" as const, target: `/hubs/${h.id}` },
        exception_ids: [],
        bleed: null,
      },
    ];
  });
  const groups = [...groupAttention(items, rates, now.getTime()), ...hubGroups].sort(
    (a, b) => b.revenue_at_risk_cents - a.revenue_at_risk_cents,
  );
  return { groups, asOf: now.getTime() };
}
