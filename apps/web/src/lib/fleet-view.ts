import { VEHICLE_STATUSES, type VehicleStatus } from "@fleetos/domain";
import { FLEET_SORTS, type FleetSort } from "./services/fleet-sorts";
import { FLEET_ISSUE_FILTERS, type FleetIssueFilter } from "./services/fleet-issues";

/**
 * View model for /fleet (task 5.1): parse the URL into a query, define the columns, build links that change
 * one parameter. Pure, so the URL contract (PRD FL-2) is unit-tested.
 */

export const FLEET_COLUMNS = [
  { key: "status", label: "Status", sort: "status", money: false },
  { key: "issue", label: "Open issue", money: false },
  { key: "soc", label: "Battery", sort: "soc", money: false, numeric: true },
  { key: "location", label: "Location", money: false },
  { key: "hub", label: "Home hub", money: false },
  { key: "revenue", label: "Revenue today", sort: "revenue", money: true, numeric: true },
  { key: "contribution", label: "Contribution today", sort: "contribution", money: true, numeric: true },
  { key: "rph", label: "Revenue / available h", sort: "revenue_per_hour", money: true, numeric: true },
  { key: "downtime", label: "Downtime today", sort: "downtime", money: false, numeric: true },
  { key: "profitability", label: "30-day performance", sort: "profitability", money: true },
  { key: "updated", label: "Last update", sort: "last_telemetry_at", money: false },
] as const satisfies readonly { key: string; label: string; sort?: FleetSort; money: boolean; numeric?: boolean }[];
export type FleetColumnKey = (typeof FLEET_COLUMNS)[number]["key"];

export const DEFAULT_COLUMNS: FleetColumnKey[] = [
  "status",
  "issue",
  "soc",
  "location",
  "hub",
  "revenue",
  "contribution",
  "downtime",
  "profitability",
  "updated",
];

export const PAGE_SIZES = [25, 50, 100] as const;
export const SOC_BANDS = {
  lt20: { label: "Below 20%", soc_lt: 0.2 },
  lt40: { label: "Below 40%", soc_lt: 0.4 },
  gte80: { label: "80% and above", soc_gte: 0.8 },
} as const;
export type SocBand = keyof typeof SOC_BANDS;

export type SearchParams = Record<string, string | string[] | undefined>;

export interface FleetView {
  status: VehicleStatus[];
  hub: string | null;
  soc: SocBand | null;
  profitability: "strong" | "monitor" | "review" | null;
  issue: FleetIssueFilter | null;
  q: string;
  sort: FleetSort | `-${FleetSort}`;
  page: number;
  per: (typeof PAGE_SIZES)[number];
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lenient: anything unrecognised in the URL falls back to the default rather than erroring. */
export function parseFleetView(sp: SearchParams): FleetView {
  const status = one(sp.status)
    .split(",")
    .filter((s): s is VehicleStatus => (VEHICLE_STATUSES as readonly string[]).includes(s));
  const sort = one(sp.sort);
  const sortOk = (FLEET_SORTS as readonly string[]).includes(sort.replace(/^-/, ""));
  const per = Number(one(sp.per));
  const page = Math.max(1, Math.floor(Number(one(sp.page)) || 1));
  const soc = one(sp.soc);
  const prof = one(sp.profitability);
  const hub = one(sp.hub);
  const issue = one(sp.issue);
  return {
    status: [...new Set(status)],
    hub: UUID.test(hub) ? hub : null,
    soc: soc in SOC_BANDS ? (soc as SocBand) : null,
    profitability: prof === "strong" || prof === "monitor" || prof === "review" ? prof : null,
    issue: (FLEET_ISSUE_FILTERS as readonly string[]).includes(issue) ? (issue as FleetIssueFilter) : null,
    q: one(sp.q).trim().slice(0, 80),
    sort: sortOk ? (sort as FleetView["sort"]) : "number",
    page,
    per: (PAGE_SIZES as readonly number[]).includes(per) ? (per as FleetView["per"]) : 25,
  };
}

/** The view as a query string, omitting defaults, so URLs stay short and shareable. */
export function fleetHref(view: FleetView, change: Partial<FleetView> = {}): string {
  const v = { ...view, ...change };
  const p = new URLSearchParams();
  if (v.status.length) p.set("status", v.status.join(","));
  if (v.hub) p.set("hub", v.hub);
  if (v.soc) p.set("soc", v.soc);
  if (v.profitability) p.set("profitability", v.profitability);
  if (v.issue) p.set("issue", v.issue);
  if (v.q) p.set("q", v.q);
  if (v.sort !== "number") p.set("sort", v.sort);
  if (v.per !== 25) p.set("per", String(v.per));
  if (v.page > 1) p.set("page", String(v.page));
  const qs = p.toString();
  return qs ? `/fleet?${qs}` : "/fleet";
}

/** Clicking a column header: sort by it (descending first for money/numbers), again to flip. */
export function sortHref(view: FleetView, field: FleetSort, descFirst: boolean): string {
  const current = view.sort.replace(/^-/, "");
  const desc = view.sort.startsWith("-");
  const next: FleetView["sort"] = current === field ? (desc ? field : `-${field}`) : descFirst ? `-${field}` : field;
  return fleetHref(view, { sort: next, page: 1 });
}

export function toggleStatusHref(view: FleetView, s: VehicleStatus): string {
  const status = view.status.includes(s) ? view.status.filter((x) => x !== s) : [...view.status, s];
  return fleetHref(view, { status, page: 1 });
}

export const isFiltered = (v: FleetView) =>
  Boolean(v.status.length || v.hub || v.soc || v.profitability || v.issue || v.q);

/** Saved column choice, keeping only known keys in the canonical order. */
export function visibleColumns(saved: unknown, canSeeMoney: boolean): FleetColumnKey[] {
  const wanted = Array.isArray(saved) && saved.length ? (saved as string[]) : DEFAULT_COLUMNS;
  return FLEET_COLUMNS.filter((c) => wanted.includes(c.key) && (canSeeMoney || !c.money)).map((c) => c.key);
}
