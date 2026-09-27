import { economicNetCents, hourTotals } from "@fleetos/domain";
import { apiRoute, ApiProblem } from "@/lib/api/handler";
import {
  baselineWindow,
  commissionedCount,
  fleetMoney,
  hoursTotals,
  orgSettings,
  vehicleExists,
  vehicleMoney,
} from "@/lib/api/kpi-data";
import { baselineRateCentsPerHour, pnlStatement, toHours } from "@/lib/api/kpis";
import { getPnl } from "@/lib/api/operations";
import { resolvePeriod } from "@/lib/api/period";

export const dynamic = "force-dynamic";

/**
 * P&L for the fleet or one vehicle (default: month to date). The accounting view never subtracts downtime;
 * the economic view adds it as an opportunity cost, labelled as such (kpis.md §3.2).
 */
export const GET = apiRoute(getPnl, async ({ db, org, query }) => {
  const vehicleId = query.scope === "vehicle" ? (query.scope_id ?? null) : null;
  if (query.scope === "vehicle" && !vehicleId)
    throw new ApiProblem("invalid_request", "scope=vehicle needs scope_id (the vehicle id).");
  if (vehicleId && !(await vehicleExists(db, org.id, vehicleId))) throw new ApiProblem("not_found", "No such vehicle.");
  const period = resolvePeriod(query, org.timezone, new Date(), "mtd");
  const settings = await orgSettings(db, org.id);
  const base = baselineWindow(period, settings.baselineDays);
  const [money, hours, baseHours, baseMoney, vehicles] = await Promise.all([
    vehicleId
      ? vehicleMoney(db, org.id, period.fromDay, period.toDay)
      : fleetMoney(db, org.id, period.fromDay, period.toDay),
    hoursTotals(db, org.id, period.fromDay, period.toDay),
    hoursTotals(db, org.id, base.fromDay, base.toDay),
    fleetMoney(db, org.id, base.fromDay, base.toDay),
    commissionedCount(db, org.id),
  ]);
  const rate = baselineRateCentsPerHour(baseHours, baseMoney) ?? 0;
  const scopedHours = hours
    .filter((h) => !vehicleId || h.vehicle_id === vehicleId)
    .map(toHours)
    .map(hourTotals);
  const downtimeHours = scopedHours.reduce((s, t) => s + t.plannedDowntime + t.unplannedDowntime, 0);
  const downtimeCostCents = Math.round(downtimeHours * rate);
  const { pnl, lines } = pnlStatement({ money, vehicleId, vehicleCount: vehicles, downtimeCostCents });
  return {
    body: {
      scope: query.scope,
      scope_id: vehicleId,
      period: { from: period.from, to: period.to },
      view: query.view,
      lines,
      gross_revenue_cents: pnl.grossRevenueCents,
      contribution_cents: pnl.contributionCents,
      contribution_margin: pnl.contributionMargin,
      fixed_allocations_cents: pnl.fixedAllocationsCents,
      net_contribution_cents: pnl.netContributionCents,
      downtime_cost_cents: downtimeCostCents,
      economic_net_cents: query.view === "economic" ? economicNetCents(pnl, downtimeCostCents) : null,
    },
    dataSource: org.isDemo ? "simulated" : undefined,
  };
});
