import {
  addHours,
  availability,
  averageSoc,
  downtimeByCause,
  emptyHours,
  hourTotals,
  isFresh,
  lineFlag,
  lowSocCount,
  performanceLabel,
  perHour,
  pnl,
  statusCounts,
  uptime,
  utilization,
  VEHICLE_STATUSES,
  type LedgerCategory,
  type StatusHours,
  type VehicleStatus,
} from "@fleetos/domain";

/**
 * KPI calculations for /kpis/* and /financials/pnl (kpis.md §3). Pure: routes fetch rows, these compute.
 * Hours come from the vehicle_day_hours rollup, money from the ledger.
 */

export interface HoursRow {
  vehicle_id: string;
  in_service_h: number | string;
  ready_h: number | string;
  charging_h: number | string;
  cleaning_h: number | string;
  maintenance_h: number | string;
  incident_h: number | string;
  offline_h: number | string;
}
export interface MoneyRow {
  vehicle_id: string | null;
  category: string;
  amount_cents: number | string;
}
export interface CurrentRow {
  status: VehicleStatus;
  soc: number | string | null;
  connectivity: string;
  last_telemetry_at: string | null;
  lifecycle: string;
}

export const toHours = (r: HoursRow): StatusHours => {
  const h = emptyHours();
  for (const s of VEHICLE_STATUSES) h[s] = Number(r[`${s}_h` as keyof HoursRow] ?? 0);
  return h;
};

const round = (n: number | null, digits = 4) => (n === null ? null : Math.round(n * 10 ** digits) / 10 ** digits);
const cents = (n: number | null) => (n === null ? null : Math.round(n));
const lines = (rows: readonly MoneyRow[]) =>
  rows.map((r) => ({ category: r.category as LedgerCategory, amountCents: Number(r.amount_cents) }));

/** Fleet-average revenue per available hour over the trailing baseline (kpis.md §3.2, fleet fallback). */
export function baselineRateCentsPerHour(baselineHours: readonly HoursRow[], baselineMoney: readonly MoneyRow[]) {
  const available = baselineHours.map(toHours).reduce((sum, h) => sum + hourTotals(h).available, 0);
  const revenue = pnl(lines(baselineMoney)).grossRevenueCents;
  return perHour(revenue, available);
}

export function fleetKpis(input: {
  now: Date;
  current: readonly CurrentRow[];
  hours: readonly HoursRow[];
  money: readonly MoneyRow[] | null; // null: caller can't see money
  baselineRate: number | null;
  availabilityTarget: number;
  lowSocThreshold: number;
  isDemo: boolean;
}) {
  const active = input.current.filter((v) => v.lifecycle === "commissioned");
  const counts = statusCounts(active.map((v) => v.status));
  const fresh = active.map((v) => ({
    soc: v.soc === null ? null : Number(v.soc),
    fresh: isFresh(
      { connectivity: v.connectivity, lastTelemetryAt: v.last_telemetry_at ? new Date(v.last_telemetry_at) : null },
      input.now,
    ),
  }));
  const h = input.hours.map(toHours).reduce(addHours, emptyHours());
  const t = hourTotals(h);
  const p = input.money ? pnl(lines(input.money)) : null;
  const downtimeHours = t.plannedDowntime + t.unplannedDowntime;
  const util = utilization(t);
  const src = input.isDemo ? "simulated" : null;
  const dataSources: Record<string, string> = {};
  if (src) Object.assign(dataSources, { status: src, hours: src });
  if (p) Object.assign(dataSources, { gross_revenue_cents: src ?? "csv", contribution_cents: src ?? "csv" });
  return {
    total_vehicles: counts.total,
    available_now: counts.available,
    earning_now: counts.earning,
    status_counts: counts.counts,
    availability: round(availability(t)),
    availability_target: input.availabilityTarget,
    uptime: round(uptime(t)),
    // In Service is inferred from telemetry until a platform trip feed exists (capability `rides`).
    utilization: util === null ? null : { value: round(util)!, estimated: true },
    downtime_hours_by_cause: Object.fromEntries(
      Object.entries(downtimeByCause(h)).map(([k, v]) => [k, round(v as number, 2)!]),
    ),
    avg_soc: round(averageSoc(fresh)),
    low_soc_count: lowSocCount(fresh, input.lowSocThreshold),
    gross_revenue_cents: p ? p.grossRevenueCents : null,
    contribution_cents: p ? p.contributionCents : null,
    contribution_margin: p ? round(p.contributionMargin) : null,
    downtime_cost_cents: p && input.baselineRate !== null ? cents(downtimeHours * input.baselineRate) : null,
    revenue_per_available_hour_cents: p ? cents(perHour(p.grossRevenueCents, t.available)) : null,
    data_sources: dataSources,
  };
}

type Flag = "good" | "warn" | "bad" | null;

export function vehicleKpis(input: {
  vehicleId: string;
  hours: readonly HoursRow[]; // every vehicle in the org, for fleet averages
  money: readonly MoneyRow[] | null;
  availabilityTarget: number;
  isDemo: boolean;
}) {
  const byVehicle = new Map(input.hours.map((r) => [r.vehicle_id, toHours(r)]));
  const mine = hourTotals(byVehicle.get(input.vehicleId) ?? emptyHours());
  const fleet = hourTotals([...byVehicle.values()].reduce(addHours, emptyHours()));
  const n = Math.max(byVehicle.size, 1);
  const myMoney = input.money ? pnl(lines(input.money.filter((m) => m.vehicle_id === input.vehicleId))) : null;
  const fleetMoney = input.money ? pnl(lines(input.money)) : null;

  const av = availability(mine);
  const fleetAv = availability(fleet);
  const margin = myMoney?.contributionMargin ?? null;
  const fleetMargin = fleetMoney?.contributionMargin ?? null;
  const src = input.isDemo ? "simulated" : null;
  const moneySrc = input.isDemo ? "simulated" : "csv";
  const metric = (
    key: string,
    value: number | null,
    fleetAvg: number | null,
    unit: string,
    flag: Flag,
    source: string | null,
  ) => ({
    key,
    value,
    fleet_avg: fleetAvg,
    unit,
    flag,
    data_source: source,
  });
  const availFlag: Flag =
    av === null
      ? null
      : av >= input.availabilityTarget
        ? "good"
        : av >= input.availabilityTarget - 0.05
          ? "warn"
          : "bad";
  const marginFlag: Flag =
    margin === null || fleetMargin === null
      ? null
      : margin >= fleetMargin
        ? "good"
        : margin >= fleetMargin - 0.1
          ? "warn"
          : "bad";

  const metrics = [
    metric("availability", round(av), round(fleetAv), "ratio", availFlag, src),
    metric("uptime", round(uptime(mine)), round(uptime(fleet)), "ratio", null, src),
    metric("utilization", round(utilization(mine)), round(utilization(fleet)), "ratio", null, src),
    metric(
      "downtime_hours",
      round(mine.plannedDowntime + mine.unplannedDowntime, 2),
      round((fleet.plannedDowntime + fleet.unplannedDowntime) / n, 2),
      "hours",
      null,
      src,
    ),
    ...(myMoney && fleetMoney
      ? [
          metric(
            "gross_revenue_cents",
            myMoney.grossRevenueCents,
            cents(fleetMoney.grossRevenueCents / n),
            "cents",
            null,
            moneySrc,
          ),
          metric(
            "contribution_cents",
            myMoney.contributionCents,
            cents(fleetMoney.contributionCents / n),
            "cents",
            null,
            moneySrc,
          ),
          metric("contribution_margin", round(margin), round(fleetMargin), "ratio", marginFlag, moneySrc),
          metric(
            "revenue_per_available_hour_cents",
            cents(perHour(myMoney.grossRevenueCents, mine.available)),
            cents(perHour(fleetMoney.grossRevenueCents, fleet.available)),
            "cents_per_hour",
            null,
            moneySrc,
          ),
        ]
      : []),
  ];
  const label =
    av !== null && margin !== null && fleetMargin !== null
      ? performanceLabel({
          margin,
          fleetAvgMargin: fleetMargin,
          availability: av,
          availabilityTarget: input.availabilityTarget,
        })
      : undefined;
  return { vehicle_id: input.vehicleId, metrics, ...(label ? { performance_label: label } : {}) };
}

const VARIABLE_OR_FIXED: LedgerCategory[] = [
  "platform_fee",
  "electricity",
  "cleaning",
  "maintenance",
  "roadside",
  "other_variable",
  "insurance",
  "financing",
];

export function pnlStatement(input: {
  money: readonly MoneyRow[]; // fleet scope: org totals; vehicle scope: every vehicle's lines (for averages)
  vehicleId: string | null;
  vehicleCount: number;
  downtimeCostCents: number;
}) {
  const scoped = input.vehicleId ? input.money.filter((m) => m.vehicle_id === input.vehicleId) : input.money;
  const p = pnl(lines(scoped));
  const fleet = input.vehicleId ? pnl(lines(input.money)) : null;
  const n = Math.max(input.vehicleCount, 1);
  const statementLines = (["gross_ride_revenue", ...VARIABLE_OR_FIXED] as LedgerCategory[]).map((category) => {
    const amount = p.byCategory[category];
    const avg = fleet ? fleet.byCategory[category] / n : null;
    const above = avg !== null && category !== "gross_ride_revenue" ? lineFlag(amount, avg) : null;
    return {
      category,
      amount_cents: amount,
      vs_fleet_avg_pct: avg !== null && avg > 0 ? round((amount / avg - 1) * 100, 1) : null,
      flagged: above !== null,
    };
  });
  return {
    pnl: p,
    lines: statementLines,
  };
}
