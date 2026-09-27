import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { economicNetCents, hourTotals } from "@fleetos/domain";
import { ApiProblem } from "@/lib/api/problem";
import {
  baselineWindow,
  commissionedCount,
  currentStates,
  fleetMoney,
  hoursTotals,
  orgSettings,
  vehicleExists,
  vehicleMoney,
} from "@/lib/api/kpi-data";
import { baselineRateCentsPerHour, fleetKpis, pnlStatement, toHours, vehicleKpis } from "@/lib/api/kpis";
import { resolvePeriod, type PeriodName } from "@/lib/api/period";
import { MONEY_ROLES } from "@/lib/api/vehicles";
import type { OrgContext } from "@/lib/api/handler";

/**
 * KPI and P&L services (tasks 3.8c / 5.x): the same numbers for /api/v1/kpis/*, /financials/pnl and the
 * screens. Everything runs as the user, so RLS decides what money they see.
 */
type Org = Pick<OrgContext, "id" | "role" | "timezone" | "isDemo">;
export interface PeriodInput {
  period?: string;
  from?: string;
  to?: string;
}

export async function getFleetKpis(db: SupabaseClient, org: Org, q: PeriodInput, fallback: PeriodName = "today") {
  const now = new Date();
  const period = resolvePeriod(q, org.timezone, now, fallback);
  const canSeeMoney = MONEY_ROLES.has(org.role);
  const settings = await orgSettings(db, org.id);
  const base = baselineWindow(period, settings.baselineDays);
  const [current, hours, money, baseHours, baseMoney] = await Promise.all([
    currentStates(db, org.id),
    hoursTotals(db, org.id, period.fromDay, period.toDay),
    canSeeMoney ? fleetMoney(db, org.id, period.fromDay, period.toDay) : null,
    canSeeMoney ? hoursTotals(db, org.id, base.fromDay, base.toDay) : [],
    canSeeMoney ? fleetMoney(db, org.id, base.fromDay, base.toDay) : [],
  ]);
  return {
    period: { from: period.from, to: period.to },
    ...fleetKpis({
      now,
      current,
      hours,
      money,
      baselineRate: canSeeMoney ? baselineRateCentsPerHour(baseHours, baseMoney) : null,
      availabilityTarget: settings.availabilityTarget,
      lowSocThreshold: settings.lowSocThreshold,
      isDemo: org.isDemo,
    }),
  };
}

export async function getVehicleKpis(
  db: SupabaseClient,
  org: Org,
  vehicleId: string,
  q: PeriodInput,
  fallback: PeriodName = "last_30d",
) {
  if (!(await vehicleExists(db, org.id, vehicleId))) throw new ApiProblem("not_found", "No such vehicle.");
  const period = resolvePeriod(q, org.timezone, new Date(), fallback);
  const canSeeMoney = MONEY_ROLES.has(org.role);
  const [settings, hours, money] = await Promise.all([
    orgSettings(db, org.id),
    hoursTotals(db, org.id, period.fromDay, period.toDay),
    canSeeMoney ? vehicleMoney(db, org.id, period.fromDay, period.toDay) : null,
  ]);
  return vehicleKpis({ vehicleId, hours, money, availabilityTarget: settings.availabilityTarget, isDemo: org.isDemo });
}

export async function getPnl(
  db: SupabaseClient,
  org: Org,
  q: PeriodInput & { vehicleId?: string | null; view?: "accounting" | "economic" },
  fallback: PeriodName = "mtd",
) {
  if (!MONEY_ROLES.has(org.role)) throw new ApiProblem("forbidden", "Money is for owners, admins and finance.");
  const vehicleId = q.vehicleId ?? null;
  if (vehicleId && !(await vehicleExists(db, org.id, vehicleId))) throw new ApiProblem("not_found", "No such vehicle.");
  const view = q.view ?? "accounting";
  const period = resolvePeriod(q, org.timezone, new Date(), fallback);
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
  const scoped = hours
    .filter((h) => !vehicleId || h.vehicle_id === vehicleId)
    .map(toHours)
    .map(hourTotals);
  const downtimeHours = scoped.reduce((s, t) => s + t.plannedDowntime + t.unplannedDowntime, 0);
  const downtimeCostCents = Math.round(downtimeHours * rate);
  const { pnl, lines } = pnlStatement({ money, vehicleId, vehicleCount: vehicles, downtimeCostCents });
  return {
    scope: vehicleId ? ("vehicle" as const) : ("fleet" as const),
    scope_id: vehicleId,
    period: { from: period.from, to: period.to },
    view,
    lines,
    gross_revenue_cents: pnl.grossRevenueCents,
    contribution_cents: pnl.contributionCents,
    contribution_margin: pnl.contributionMargin,
    fixed_allocations_cents: pnl.fixedAllocationsCents,
    net_contribution_cents: pnl.netContributionCents,
    downtime_cost_cents: downtimeCostCents,
    economic_net_cents: view === "economic" ? economicNetCents(pnl, downtimeCostCents) : null,
    /** For screens: the local days the period covers. */
    days: { from: period.fromDay, to: period.toDay },
  };
}
