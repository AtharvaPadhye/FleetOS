import { apiRoute } from "@/lib/api/handler";
import { getFleetKpis } from "@/lib/api/operations";
import { getFleetKpis as fleetKpisService } from "@/lib/services/kpis";

export const dynamic = "force-dynamic";

/** Fleet KPIs for a period (default today): counts now, hour ratios, SOC, and money for money roles. */
export const GET = apiRoute(getFleetKpis, async ({ db, org, query }) => ({
  body: await fleetKpisService(db, org, query),
  dataSource: org.isDemo ? "simulated" : undefined,
}));
