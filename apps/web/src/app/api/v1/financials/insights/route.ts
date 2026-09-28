import { apiRoute } from "@/lib/api/handler";
import { getInsights } from "@/lib/api/operations";
import { financials } from "@/lib/services/financials";

export const dynamic = "force-dynamic";

/** Up to 5 cars or hubs whose margin is well below their cohort, with the cost categories behind it (FN-3). */
export const GET = apiRoute(getInsights, async ({ db, org, query }) => {
  const f = await financials(db, org, { period: query.period ?? "mtd" });
  return {
    body: f.insights.map((i) => ({
      id: i.id,
      scope: i.scope,
      scope_id: i.scope_id,
      title: i.title,
      detail: i.detail,
      impact_cents: i.impact_cents,
      drivers: i.drivers,
    })),
    dataSource: org.isDemo ? ("simulated" as const) : undefined,
  };
});
