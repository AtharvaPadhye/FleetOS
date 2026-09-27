import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  hourTotals,
  pnl,
  performanceLabel,
  perHour,
  VEHICLE_STATUSES,
  type ExceptionClass,
  type LedgerCategory,
  type Severity,
  type PerformanceLabel,
  type VehicleStatus,
} from "@fleetos/domain";
import { ApiProblem } from "@/lib/api/problem";
import { hoursTotals, orgSettings, vehicleMoney } from "@/lib/api/kpi-data";
import { toHours, type MoneyRow } from "@/lib/api/kpis";
import { localDay } from "@/lib/api/period";
import { MONEY_ROLES, toVehicleListItem, VEHICLE_LIST_COLUMNS, type VehicleListRow } from "@/lib/api/vehicles";
import type { OrgContext } from "@/lib/api/handler";
import { openIssuesByVehicle } from "./exceptions";

/**
 * The fleet list (task 5.1): one service behind both GET /api/v1/vehicles and the /fleet page, so they can't
 * disagree. SQL applies hub / SOC / search; today's money, the 30-day profitability label, status counts and
 * any sort are computed here (fleets are hundreds of cars, so in-memory is simpler and fast enough).
 */

import { FLEET_SORTS, type FleetSort } from "./fleet-sorts";

export { FLEET_SORTS, type FleetSort };
export { FLEET_ISSUE_FILTERS, type FleetIssueFilter } from "./fleet-issues";
import type { FleetIssueFilter } from "./fleet-issues";

export interface FleetQuery {
  status?: VehicleStatus[];
  hub_id?: string;
  soc_lt?: number;
  soc_gte?: number;
  q?: string;
  profitability?: PerformanceLabel;
  /** any / none: has an open exception or not; a class (e.g. `incident`) narrows to that kind. */
  issue?: FleetIssueFilter;
  sort: FleetSort | `-${FleetSort}`;
  limit: number;
  offset: number;
}

export interface FleetToday {
  revenue_cents: number | null;
  contribution_cents: number | null;
  revenue_per_available_hour_cents: number | null;
  downtime_min: number;
}

export type FleetItem = ReturnType<typeof toVehicleListItem> & {
  display_name: string | null;
  location_name: string | null;
  today: FleetToday;
  profitability: PerformanceLabel | null;
  /** The vehicle's most severe open exception (PRD FL-1). */
  open_issue: { exception_id: string; type: string; title: string; severity: Severity; class: ExceptionClass } | null;
  next_action: string | null;
};

export interface FleetResult {
  items: FleetItem[];
  total: number;
  /** Every non-retired vehicle in the org, ignoring filters. */
  fleetSize: number;
  /** Counts per status across the other filters (for the status chips). */
  statusCounts: Record<VehicleStatus, number>;
  hubs: { id: string; name: string }[];
  canSeeMoney: boolean;
  lowSocThreshold: number;
  /** The instant the result was computed for (epoch ms), for relative ages. */
  asOf: number;
}

const PAGE = 1000;
const roundOrNull = (x: number | null) => (x === null ? null : Math.round(x));
const PROFIT_ORDER: Record<PerformanceLabel, number> = { review: 0, monitor: 1, strong: 2 };

async function allRows<T>(
  fetch: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await fetch(from, from + PAGE - 1);
    if (error) throw new ApiProblem("internal", error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

const moneyByVehicle = (rows: readonly MoneyRow[]) => {
  const m = new Map<string, { category: LedgerCategory; amountCents: number }[]>();
  for (const r of rows) {
    if (!r.vehicle_id) continue;
    m.set(r.vehicle_id, [
      ...(m.get(r.vehicle_id) ?? []),
      { category: r.category as LedgerCategory, amountCents: Number(r.amount_cents) },
    ]);
  }
  return m;
};

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export async function listFleet(
  db: SupabaseClient,
  org: Pick<OrgContext, "id" | "role" | "timezone">,
  query: FleetQuery,
  now = new Date(),
): Promise<FleetResult> {
  const canSeeMoney = MONEY_ROLES.has(org.role);
  if (query.profitability && !canSeeMoney)
    throw new ApiProblem("forbidden", "Filtering by profitability needs money access (owner, admin or finance).");
  const [field] = [query.sort.replace(/^-/, "") as FleetSort];
  if (["revenue", "contribution", "revenue_per_hour", "profitability"].includes(field) && !canSeeMoney)
    throw new ApiProblem("forbidden", "Sorting by money needs money access (owner, admin or finance).");

  const today = localDay(now, org.timezone);
  const from30 = addDays(today, -29);
  const [rows, hubsRes, hoursToday, moneyToday, hours30, money30, settings, sizeRes, issues] = await Promise.all([
    allRows<VehicleListRow & { display_name: string | null }>((a, b) => {
      let q = db
        .from("vehicle_list")
        .select(VEHICLE_LIST_COLUMNS)
        .eq("org_id", org.id)
        .neq("lifecycle", "retired")
        .order("number")
        .range(a, b);
      if (query.hub_id) q = q.eq("home_hub_id", query.hub_id);
      if (query.soc_lt !== undefined) q = q.lt("soc", query.soc_lt);
      if (query.soc_gte !== undefined) q = q.gte("soc", query.soc_gte);
      if (query.q) {
        // Letters, digits, spaces and dashes only: keeps the value out of PostgREST's filter syntax.
        const term = query.q.replace(/[^\p{L}\p{N} -]/gu, "").trim();
        if (term) q = q.or(`number.ilike.*${term}*,vin.ilike.*${term}*,display_name.ilike.*${term}*`);
      }
      return q;
    }),
    db.from("hubs").select("id, name").eq("org_id", org.id).order("name"),
    hoursTotals(db, org.id, today, today),
    canSeeMoney ? vehicleMoney(db, org.id, today, today) : Promise.resolve(null),
    canSeeMoney ? hoursTotals(db, org.id, from30, today) : Promise.resolve([]),
    canSeeMoney ? vehicleMoney(db, org.id, from30, today) : Promise.resolve(null),
    orgSettings(db, org.id),
    db.from("vehicles").select("id", { count: "exact", head: true }).eq("org_id", org.id).neq("lifecycle", "retired"),
    openIssuesByVehicle(db, org.id, now),
  ]);
  const hubs = (hubsRes.data ?? []) as { id: string; name: string }[];
  const hubName = new Map(hubs.map((h) => [h.id, h.name]));

  const todayHours = new Map(hoursToday.map((h) => [h.vehicle_id, hourTotals(toHours(h))]));
  const todayMoney = moneyToday ? moneyByVehicle(moneyToday) : null;
  const h30 = new Map(hours30.map((h) => [h.vehicle_id, hourTotals(toHours(h))]));
  const m30 = money30 ? moneyByVehicle(money30) : null;
  const fleetMargin = money30
    ? pnl(money30.map((m) => ({ category: m.category as LedgerCategory, amountCents: Number(m.amount_cents) })))
        .contributionMargin
    : null;

  const items: FleetItem[] = rows.map((r) => {
    const base = toVehicleListItem(r, now);
    const t = todayHours.get(r.id);
    const p = todayMoney ? pnl(todayMoney.get(r.id) ?? []) : null;
    let profitability: PerformanceLabel | null = null;
    const t30 = h30.get(r.id);
    const p30 = m30 ? pnl(m30.get(r.id) ?? []) : null;
    if (p30?.contributionMargin != null && fleetMargin !== null && t30 && t30.scheduled > 0)
      profitability = performanceLabel({
        margin: p30.contributionMargin,
        fleetAvgMargin: fleetMargin,
        availability: t30.available / t30.scheduled,
        availabilityTarget: settings.availabilityTarget,
      });
    const issue = issues.get(r.id);
    const location = r.current_hub_id
      ? (hubName.get(r.current_hub_id) ?? "At a hub")
      : r.lat !== null
        ? "On the road"
        : null;
    return {
      ...base,
      display_name: r.display_name,
      location_name: location,
      today: {
        revenue_cents: p ? p.grossRevenueCents : null,
        contribution_cents: p ? p.contributionCents : null,
        revenue_per_available_hour_cents: p && t ? roundOrNull(perHour(p.grossRevenueCents, t.available)) : null,
        downtime_min: t ? Math.round((t.plannedDowntime + t.unplannedDowntime) * 60) : 0,
      },
      profitability,
      open_issue: issue
        ? {
            exception_id: issue.id,
            type: issue.type,
            title: issue.title,
            severity: issue.severity,
            class: issue.class,
          }
        : null,
      next_action: issue?.recommended_action?.label ?? null,
    };
  });

  const statusCounts = Object.fromEntries(VEHICLE_STATUSES.map((s) => [s, 0])) as Record<VehicleStatus, number>;
  for (const i of items) statusCounts[i.state.status] += 1;

  let filtered = items;
  if (query.status?.length) filtered = filtered.filter((i) => query.status!.includes(i.state.status));
  if (query.profitability) filtered = filtered.filter((i) => i.profitability === query.profitability);
  if (query.issue === "any") filtered = filtered.filter((i) => i.open_issue);
  else if (query.issue === "none") filtered = filtered.filter((i) => !i.open_issue);
  else if (query.issue) filtered = filtered.filter((i) => i.open_issue?.class === query.issue);

  const desc = query.sort.startsWith("-");
  const key = (i: FleetItem): number | string | null => {
    switch (field) {
      case "number":
        return i.number;
      case "status":
        return VEHICLE_STATUSES.indexOf(i.state.status);
      case "soc":
        return i.state.soc;
      case "status_since":
        return i.state.status_since ?? null;
      case "last_telemetry_at":
        return i.state.last_telemetry_at;
      case "revenue":
        return i.today.revenue_cents;
      case "contribution":
        return i.today.contribution_cents;
      case "revenue_per_hour":
        return i.today.revenue_per_available_hour_cents;
      case "downtime":
        return i.today.downtime_min;
      case "profitability":
        return i.profitability ? PROFIT_ORDER[i.profitability] : null;
    }
  };
  filtered = [...filtered].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka === kb) return a.number.localeCompare(b.number);
    if (ka === null) return 1; // missing values always last
    if (kb === null) return -1;
    const c = ka < kb ? -1 : 1;
    return desc ? -c : c;
  });

  return {
    items: filtered.slice(query.offset, query.offset + query.limit),
    total: filtered.length,
    fleetSize: sizeRes.count ?? rows.length,
    statusCounts,
    hubs,
    canSeeMoney,
    lowSocThreshold: settings.lowSocThreshold,
    asOf: now.getTime(),
  };
}
