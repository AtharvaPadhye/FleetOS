import { apiRoute, ApiProblem } from "@/lib/api/handler";
import { getPnl } from "@/lib/api/operations";
import { getPnl as pnlService } from "@/lib/services/kpis";

export const dynamic = "force-dynamic";

/**
 * P&L for the fleet or one vehicle (default: month to date). The accounting view never subtracts downtime;
 * the economic view adds it as an opportunity cost, labelled as such (kpis.md §3.2).
 */
export const GET = apiRoute(getPnl, async ({ db, org, query }) => {
  if (query.scope === "vehicle" && !query.scope_id)
    throw new ApiProblem("invalid_request", "scope=vehicle needs scope_id (the vehicle id).");
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { days, ...body } = await pnlService(db, org, {
    ...query,
    vehicleId: query.scope === "vehicle" ? (query.scope_id ?? null) : null,
  });
  return { body, dataSource: org.isDemo ? "simulated" : undefined };
});
