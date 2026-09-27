import { apiRoute } from "@/lib/api/handler";
import { getAttention } from "@/lib/api/operations";
import { attention } from "@/lib/services/attention";

export const dynamic = "force-dynamic";

/** "Needs attention" groups ranked by revenue at risk, with each group's Bleed (PRD OV-2). */
export const GET = apiRoute(getAttention, async ({ db, org }) => ({
  body: (await attention(db, org)).groups,
  dataSource: org.isDemo ? ("simulated" as const) : undefined,
}));
