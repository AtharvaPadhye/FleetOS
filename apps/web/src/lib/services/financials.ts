import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  anomalies,
  hourTotals,
  mainDrivers,
  performanceLabel,
  pnl,
  type LedgerCategory,
  type PerformanceLabel,
} from "@fleetos/domain";
import { ApiProblem } from "@/lib/api/problem";
import { fleetMoney, hoursTotals, orgSettings, vehicleMoney } from "@/lib/api/kpi-data";
import { toHours, type MoneyRow } from "@/lib/api/kpis";
import { localDay, resolvePeriod } from "@/lib/api/period";
import { MONEY_ROLES } from "@/lib/api/vehicles";
import type { OrgContext } from "@/lib/api/handler";
import { getFleetKpis } from "./kpis";

/**
 * Financials (task 5.8, PRD FN-1..FN-5): period KPIs, weekly revenue and contribution, cost breakdown,
 * anomaly insights (cohort z-scores, kpis.md §3.7) and the vehicle performance table. Money roles only.
 */
type Org = Pick<OrgContext, "id" | "role" | "timezone" | "isDemo">;
export const OPERATING_COSTS: LedgerCategory[] = [
  "platform_fee",
  "electricity",
  "cleaning",
  "maintenance",
  "roadside",
  "other_variable",
];
export const CATEGORY_LABEL: Record<string, string> = {
  gross_ride_revenue: "Ride revenue",
  platform_fee: "Platform fees",
  electricity: "Electricity",
  cleaning: "Cleaning",
  maintenance: "Maintenance",
  roadside: "Roadside & towing",
  other_variable: "Other variable",
  insurance: "Insurance",
  financing: "Financing",
};
const MI = 1609.344;
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** Monday of the day's week (ISO weeks). */
const weekOf = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`);
  return addDays(day, -((d.getUTCDay() + 6) % 7));
};

export interface PeriodInput {
  period?: string;
  from?: string;
  to?: string;
}

/** The period presets offered on the page (api.md §1 "Time"). */
export function periodPresets(now: Date, timeZone: string) {
  const today = localDay(now, timeZone);
  const lastMonth = addDays(`${today.slice(0, 8)}01`, -1).slice(0, 7);
  return [
    { key: "mtd", label: "Month to date" },
    { key: "last_30d", label: "Last 30 days" },
    {
      key: `month:${lastMonth}`,
      label: new Date(`${lastMonth}-15T00:00:00Z`).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }),
    },
  ];
}

export interface VehicleRow {
  id: string;
  number: string;
  hub: string | null;
  revenue_cents: number;
  costs: Record<string, number>;
  contribution_cents: number;
  margin: number | null;
  availability: number | null;
  label: PerformanceLabel | null;
  margin_gap: number | null;
}

export interface Insight {
  id: string;
  scope: "vehicle" | "hub";
  scope_id: string;
  title: string;
  detail: string;
  impact_cents: number | null;
  drivers: { category: string; share: number }[];
  href: string;
}

const lines = (rows: readonly MoneyRow[]) =>
  rows.map((r) => ({ category: r.category as LedgerCategory, amountCents: Number(r.amount_cents) }));

export async function financials(db: SupabaseClient, org: Org, q: PeriodInput, now = new Date()) {
  if (!MONEY_ROLES.has(org.role))
    throw new ApiProblem("forbidden", "Financials need money access (owner, admin or finance).");
  const period = resolvePeriod(q, org.timezone, now, "mtd");
  const [kpis, money, perVehicle, hours, vehicles, hubs, settings, daily, rides] = await Promise.all([
    getFleetKpis(db, org, q, "mtd"),
    fleetMoney(db, org.id, period.fromDay, period.toDay),
    vehicleMoney(db, org.id, period.fromDay, period.toDay),
    hoursTotals(db, org.id, period.fromDay, period.toDay),
    db.from("vehicles").select("id, number, home_hub_id, lifecycle").eq("org_id", org.id).limit(5000),
    db.from("hubs").select("id, name").eq("org_id", org.id),
    orgSettings(db, org.id),
    db.rpc("ledger_daily", { p_org: org.id, p_from: period.fromDay, p_to: period.toDay }),
    db.rpc("ride_totals", { p_org: org.id, p_from: period.from, p_to: period.to }),
  ]);
  const err = vehicles.error ?? hubs.error ?? daily.error;
  if (err) throw new ApiProblem("internal", err.message);

  const fleet = pnl(lines(money));
  const opCosts = Object.fromEntries(
    OPERATING_COSTS.map((c) => [
      c,
      money.filter((m) => m.category === c).reduce((s, m) => s + Number(m.amount_cents), 0),
    ]),
  ) as Record<string, number>;
  const operatingCents = Object.values(opCosts).reduce((a, b) => a + b, 0);
  const revenueMiles = (() => {
    const row = ((rides.data ?? []) as { rides: number; distance_m: number }[])[0];
    return row && Number(row.distance_m) > 0 ? Number(row.distance_m) / MI : null;
  })();
  const days = (Date.parse(period.to) - Date.parse(period.from)) / 86_400_000;
  const fleetSize = ((vehicles.data ?? []) as { lifecycle: string }[]).filter(
    (v) => v.lifecycle === "commissioned",
  ).length;

  // FN-2: weekly revenue and contribution (variable costs), and the cost breakdown.
  const weeks = new Map<string, { revenue: number; variable: number }>();
  for (let d = period.fromDay; d <= period.toDay; d = addDays(d, 7)) weeks.set(weekOf(d), { revenue: 0, variable: 0 });
  weeks.set(weekOf(period.toDay), weeks.get(weekOf(period.toDay)) ?? { revenue: 0, variable: 0 });
  for (const r of (daily.data ?? []) as { day: string; category: LedgerCategory; amount_cents: number }[]) {
    const w = weeks.get(weekOf(r.day));
    if (!w) continue;
    if (r.category === "gross_ride_revenue") w.revenue += Number(r.amount_cents);
    else if (OPERATING_COSTS.includes(r.category)) w.variable += Number(r.amount_cents);
  }
  const weekly = [...weeks]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([week, w]) => ({ week, revenue_cents: w.revenue, contribution_cents: w.revenue - w.variable }));
  const costBreakdown = OPERATING_COSTS.map((c) => ({
    category: c,
    label: CATEGORY_LABEL[c]!,
    cents: opCosts[c]!,
    share: operatingCents ? opCosts[c]! / operatingCents : 0,
  }))
    .filter((c) => c.cents > 0)
    .sort((a, b) => b.cents - a.cents);

  // FN-4: vehicle performance table.
  const hubName = new Map(((hubs.data ?? []) as { id: string; name: string }[]).map((h) => [h.id, h.name]));
  const hoursBy = new Map(hours.map((h) => [h.vehicle_id, hourTotals(toHours(h))]));
  const moneyBy = new Map<string, MoneyRow[]>();
  for (const m of perVehicle) if (m.vehicle_id) moneyBy.set(m.vehicle_id, [...(moneyBy.get(m.vehicle_id) ?? []), m]);
  const rows: VehicleRow[] = (
    (vehicles.data ?? []) as { id: string; number: string; home_hub_id: string | null; lifecycle: string }[]
  )
    .filter((v) => v.lifecycle !== "retired")
    .map((v) => {
      const m = moneyBy.get(v.id) ?? [];
      const p = pnl(lines(m));
      const h = hoursBy.get(v.id);
      const availability = h && h.scheduled > 0 ? h.available / h.scheduled : null;
      const costs = Object.fromEntries(
        OPERATING_COSTS.map((c) => [
          c,
          m.filter((x) => x.category === c).reduce((s, x) => s + Number(x.amount_cents), 0),
        ]),
      );
      // Without hours (e.g. revenue imported for a car FleetOS hasn't seen) the margin alone can still call for
      // a Review; Monitor and Strong need availability too.
      const label =
        p.contributionMargin === null || fleet.contributionMargin === null
          ? null
          : availability !== null
            ? performanceLabel({
                margin: p.contributionMargin,
                fleetAvgMargin: fleet.contributionMargin,
                availability,
                availabilityTarget: settings.availabilityTarget,
              })
            : p.contributionMargin <= fleet.contributionMargin - 0.1
              ? ("review" as const)
              : null;
      return {
        id: v.id,
        number: v.number,
        hub: v.home_hub_id ? (hubName.get(v.home_hub_id) ?? null) : null,
        revenue_cents: p.grossRevenueCents,
        costs,
        contribution_cents: p.contributionCents,
        margin: p.contributionMargin,
        availability,
        label,
        margin_gap:
          p.contributionMargin !== null && fleet.contributionMargin !== null
            ? p.contributionMargin - fleet.contributionMargin
            : null,
      };
    });
  const ORDER: Record<PerformanceLabel, number> = { review: 0, monitor: 1, strong: 2 };
  rows.sort(
    (a, b) =>
      (a.label ? ORDER[a.label] : 3) - (b.label ? ORDER[b.label] : 3) ||
      (a.margin_gap ?? Infinity) - (b.margin_gap ?? Infinity) ||
      a.number.localeCompare(b.number),
  );

  // FN-3: insights. A cohort member whose margin is ≥ 1.5 SD below the others, with the cost categories that
  // explain ≥ 70% of its gap (cost per revenue dollar vs the fleet's).
  const fleetRate = (c: string) => (fleet.grossRevenueCents ? opCosts[c]! / fleet.grossRevenueCents : 0);
  const explain = (revenue: number, costs: Record<string, number>) => {
    const gaps = Object.fromEntries(OPERATING_COSTS.map((c) => [c, revenue ? costs[c]! / revenue - fleetRate(c) : 0]));
    const drivers = mainDrivers(gaps);
    const total = drivers.reduce((s, c) => s + Math.max(0, gaps[c]!), 0);
    return drivers.map((c) => ({
      category: c,
      share: total ? Math.round((Math.max(0, gaps[c]!) / total) * 100) / 100 : 0,
    }));
  };
  const insights: Insight[] = [];
  const earning = rows.filter((r) => r.revenue_cents > 0 && r.margin !== null);
  for (const i of anomalies(earning.map((r) => r.margin!))) {
    const r = earning[i]!;
    const drivers = explain(r.revenue_cents, r.costs);
    insights.push({
      id: `vehicle:${r.id}`,
      scope: "vehicle",
      scope_id: r.id,
      title: `Car ${r.number}: ${Math.round((r.margin ?? 0) * 100)}% margin vs ${Math.round((fleet.contributionMargin ?? 0) * 100)}% for the fleet`,
      detail: drivers.length
        ? `Mostly ${drivers.map((d) => CATEGORY_LABEL[d.category]!.toLowerCase()).join(" and ")} above the fleet's rate.`
        : "Lower revenue rather than higher costs.",
      impact_cents:
        fleet.contributionMargin !== null ? Math.round((fleet.contributionMargin - r.margin!) * r.revenue_cents) : null,
      drivers,
      href: `/fleet/${r.number}/financials`,
    });
  }
  const byHub = new Map<string, VehicleRow[]>();
  for (const r of earning) if (r.hub) byHub.set(r.hub, [...(byHub.get(r.hub) ?? []), r]);
  const hubRows = [...byHub].map(([name, list]) => {
    const revenue = list.reduce((s, r) => s + r.revenue_cents, 0);
    const contribution = list.reduce((s, r) => s + r.contribution_cents, 0);
    const costs = Object.fromEntries(OPERATING_COSTS.map((c) => [c, list.reduce((s, r) => s + r.costs[c]!, 0)]));
    return { name, revenue, margin: revenue ? contribution / revenue : 0, costs };
  });
  if (hubRows.length >= 3) {
    for (const i of anomalies(hubRows.map((h) => h.margin))) {
      const h = hubRows[i]!;
      const id = [...hubName].find(([, n]) => n === h.name)?.[0] ?? h.name;
      insights.push({
        id: `hub:${id}`,
        scope: "hub",
        scope_id: id,
        title: `${h.name}: ${Math.round(h.margin * 100)}% margin, below the other hubs`,
        detail: `Driven by ${
          explain(h.revenue, h.costs)
            .map((d) => CATEGORY_LABEL[d.category]!.toLowerCase())
            .join(" and ") || "revenue"
        }.`,
        impact_cents:
          fleet.contributionMargin !== null ? Math.round((fleet.contributionMargin - h.margin) * h.revenue) : null,
        drivers: explain(h.revenue, h.costs),
        href: `/hubs/${id}`,
      });
    }
  }
  insights.sort((a, b) => (b.impact_cents ?? 0) - (a.impact_cents ?? 0));

  return {
    period,
    kpis: {
      gross_revenue_cents: fleet.grossRevenueCents,
      operating_costs_cents: operatingCents,
      contribution_cents: fleet.contributionCents,
      contribution_margin: fleet.contributionMargin,
      net_contribution_cents: fleet.netContributionCents,
      revenue_per_vehicle_cents: fleetSize ? Math.round(fleet.grossRevenueCents / fleetSize) : null,
      revenue_per_available_hour_cents: kpis.revenue_per_available_hour_cents,
      cost_per_revenue_mile_cents: revenueMiles ? Math.round(operatingCents / revenueMiles) : null,
      revenue_miles: revenueMiles,
      downtime_cost_cents: kpis.downtime_cost_cents,
      days,
    },
    money,
    weekly,
    costBreakdown,
    rows,
    insights: insights.slice(0, 5),
    isDemo: org.isDemo,
  };
}

/** FN-5: the period's vehicle P&L lines and KPIs as CSV. */
export function financialsCsv(rows: readonly VehicleRow[]): string {
  const cell = (v: string | number | null) => {
    if (v === null) return "";
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const d = (c: number) => (c / 100).toFixed(2);
  const header = [
    "Vehicle",
    "Home hub",
    "Ride revenue ($)",
    ...OPERATING_COSTS.map((c) => `${CATEGORY_LABEL[c]} ($)`),
    "Contribution ($)",
    "Contribution margin (%)",
    "Availability (%)",
    "Performance",
  ];
  const body = rows.map((r) =>
    [
      r.number,
      r.hub,
      d(r.revenue_cents),
      ...OPERATING_COSTS.map((c) => d(r.costs[c] ?? 0)),
      d(r.contribution_cents),
      r.margin === null ? null : (r.margin * 100).toFixed(1),
      r.availability === null ? null : (r.availability * 100).toFixed(1),
      r.label,
    ]
      .map(cell)
      .join(","),
  );
  return [header.map(cell).join(","), ...body].join("\r\n") + "\r\n";
}
