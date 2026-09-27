/**
 * Revenue, cost and contribution (kpis.md §3.2). Money is integer cents; rates are cents per hour (floats).
 * Downtime cost is an OPPORTUNITY cost: reported separately, never subtracted from contribution.
 */
export const LEDGER_CATEGORIES = [
  "gross_ride_revenue",
  "platform_fee",
  "electricity",
  "cleaning",
  "maintenance",
  "roadside",
  "other_variable",
  "insurance",
  "financing",
] as const;
export type LedgerCategory = (typeof LEDGER_CATEGORIES)[number];
export type CategoryType = "revenue" | "variable" | "fixed";

export const CATEGORY_TYPE: Record<LedgerCategory, CategoryType> = {
  gross_ride_revenue: "revenue",
  platform_fee: "variable",
  electricity: "variable",
  cleaning: "variable",
  maintenance: "variable",
  roadside: "variable",
  other_variable: "variable",
  insurance: "fixed",
  financing: "fixed",
};

export interface LedgerLine {
  category: LedgerCategory;
  /** Always positive; the sign comes from the category type. */
  amountCents: number;
}

export interface Pnl {
  grossRevenueCents: number;
  variableCostsCents: number;
  contributionCents: number;
  /** null when there's no revenue (never 0% or NaN). */
  contributionMargin: number | null;
  fixedAllocationsCents: number;
  netContributionCents: number;
  netMargin: number | null;
  byCategory: Record<LedgerCategory, number>;
}

export function pnl(lines: readonly LedgerLine[]): Pnl {
  const byCategory = Object.fromEntries(LEDGER_CATEGORIES.map((c) => [c, 0])) as Record<LedgerCategory, number>;
  for (const l of lines) {
    if (!Number.isInteger(l.amountCents) || l.amountCents < 0) {
      throw new RangeError(`Ledger amounts must be non-negative integer cents, got ${l.amountCents}`);
    }
    byCategory[l.category] += l.amountCents;
  }
  let revenue = 0;
  let variable = 0;
  let fixed = 0;
  for (const c of LEDGER_CATEGORIES) {
    const t = CATEGORY_TYPE[c];
    if (t === "revenue") revenue += byCategory[c];
    else if (t === "variable") variable += byCategory[c];
    else fixed += byCategory[c];
  }
  const contribution = revenue - variable;
  const net = contribution - fixed;
  return {
    grossRevenueCents: revenue,
    variableCostsCents: variable,
    contributionCents: contribution,
    contributionMargin: revenue > 0 ? contribution / revenue : null,
    fixedAllocationsCents: fixed,
    netContributionCents: net,
    netMargin: revenue > 0 ? net / revenue : null,
    byCategory,
  };
}

/** Economic view: net contribution after opportunity cost (labelled economic, not accounting). */
export const economicNetCents = (p: Pnl, downtimeCostCents: number) => p.netContributionCents - downtimeCostCents;

export const perVehicle = (cents: number, avgFleetSize: number) => (avgFleetSize > 0 ? cents / avgFleetSize : null);
/** Cents per hour, e.g. revenue per available hour. */
export const perHour = (cents: number, hours: number) => (hours > 0 ? cents / hours : null);
/** Cost per revenue mile (needs rides) or per mile (fallback, labelled). */
export const perMile = (cents: number, miles: number) => (miles > 0 ? cents / miles : null);

/**
 * Baseline revenue rate r(v, t) in cents per available hour: hub × hour-of-week, falling back to the hub
 * average, then the fleet average, when there isn't enough history (kpis.md §3.2).
 */
export interface RateSample {
  centsPerHour: number;
  availableHours: number;
}
export const MIN_BASELINE_HOURS = 20;

export function baselineRate(opts: { hubHourOfWeek?: RateSample; hub?: RateSample; fleet: RateSample }): {
  centsPerHour: number;
  source: "hub_hour_of_week" | "hub" | "fleet";
} {
  if (opts.hubHourOfWeek && opts.hubHourOfWeek.availableHours >= MIN_BASELINE_HOURS) {
    return { centsPerHour: opts.hubHourOfWeek.centsPerHour, source: "hub_hour_of_week" };
  }
  if (opts.hub && opts.hub.availableHours >= MIN_BASELINE_HOURS) {
    return { centsPerHour: opts.hub.centsPerHour, source: "hub" };
  }
  return { centsPerHour: opts.fleet.centsPerHour, source: "fleet" };
}

/** Downtime (opportunity) cost: Σ unavailable minutes × r/60. Each span can carry its own rate. */
export function downtimeCostCents(spans: readonly { minutes: number; rateCentsPerHour: number }[]): number {
  return Math.round(spans.reduce((sum, s) => sum + (s.minutes * s.rateCentsPerHour) / 60, 0));
}

/** Expected remaining downtime in hours (kpis.md §3.2). */
export function expectedRemainingDowntimeHours(opts: {
  vendorEtaHours?: number | null;
  medianServiceHours?: number | null;
  medianResolutionHours: number;
}): number {
  if (opts.vendorEtaHours != null && opts.medianServiceHours != null) {
    return opts.vendorEtaHours + opts.medianServiceHours;
  }
  return opts.medianResolutionHours;
}

export const revenueAtRiskCents = (remainingDowntimeHours: number, rateCentsPerHour: number) =>
  Math.round(remainingDowntimeHours * rateCentsPerHour);

/** Incident financial impact = service cost + downtime (lost revenue). */
export function incidentImpact(opts: { downtimeMinutes: number; rateCentsPerHour: number; serviceCostCents: number }) {
  const lostRevenueCents = Math.round((opts.downtimeMinutes * opts.rateCentsPerHour) / 60);
  return {
    lostRevenueCents,
    serviceCostCents: opts.serviceCostCents,
    totalCents: lostRevenueCents + opts.serviceCostCents,
  };
}

/** Revenue recovered by finishing inside SLA: max(0, target − actual) × r. */
export const revenueRecoveredCents = (opts: {
  slaTargetMinutes: number;
  actualMinutes: number;
  rateCentsPerHour: number;
}) => Math.round((Math.max(0, opts.slaTargetMinutes - opts.actualMinutes) * opts.rateCentsPerHour) / 60);
