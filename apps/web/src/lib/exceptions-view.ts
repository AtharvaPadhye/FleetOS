import {
  ACTIVE_EXCEPTION_STATUSES,
  type ExceptionClass,
  EXCEPTION_STATUSES,
  SEVERITIES,
  type ExceptionStatus,
  type Severity,
} from "@fleetos/domain";

/**
 * View model for /exceptions (task 5.4): the URL is the state (flows.md: `?severity=critical,high&status=open`).
 * No status means the active queue; `status=all` includes resolved and dismissed (PRD EX-3).
 */
export const EXCEPTION_VIEW_SORTS = {
  severity: { label: "Most severe", sort: "severity" },
  risk: { label: "Most revenue at risk", sort: "-revenue_at_risk" },
  newest: { label: "Newest", sort: "-detected_at" },
} as const;
export type ExceptionViewSort = keyof typeof EXCEPTION_VIEW_SORTS;

export const STATUS_TABS = {
  active: { label: "Active", statuses: ACTIVE_EXCEPTION_STATUSES },
  resolved: { label: "Resolved", statuses: ["resolved"] },
  dismissed: { label: "Dismissed", statuses: ["dismissed"] },
  all: { label: "All", statuses: EXCEPTION_STATUSES },
} as const satisfies Record<string, { label: string; statuses: readonly ExceptionStatus[] }>;
export type StatusTab = keyof typeof STATUS_TABS;

export interface ExceptionsView {
  tab: StatusTab;
  statuses: ExceptionStatus[];
  severity: Severity[];
  sort: ExceptionViewSort;
  page: number;
}
export type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
export const PER_PAGE = 50;

/** Lenient: unknown values fall back to defaults instead of erroring. */
export function parseExceptionsView(sp: SearchParams): ExceptionsView {
  const raw = one(sp.status);
  const tab: StatusTab = raw in STATUS_TABS ? (raw as StatusTab) : "active";
  // `status=open,assigned` (the API's form) also works: pick those statuses, shown under Active or All.
  const listed = raw
    .split(",")
    .filter((s): s is ExceptionStatus => (EXCEPTION_STATUSES as readonly string[]).includes(s));
  const statuses = raw in STATUS_TABS || !listed.length ? [...STATUS_TABS[tab].statuses] : [...new Set(listed)];
  const severity = [
    ...new Set(
      one(sp.severity)
        .split(",")
        .filter((s): s is Severity => (SEVERITIES as readonly string[]).includes(s)),
    ),
  ];
  const sort = one(sp.sort);
  return {
    tab:
      listed.length && !(raw in STATUS_TABS)
        ? listed.every((s) => ACTIVE_EXCEPTION_STATUSES.includes(s))
          ? "active"
          : "all"
        : tab,
    statuses,
    severity,
    sort: sort in EXCEPTION_VIEW_SORTS ? (sort as ExceptionViewSort) : "severity",
    page: Math.max(1, Math.floor(Number(one(sp.page)) || 1)),
  };
}

/** A link to the queue (or one exception in it) with some view fields changed; defaults are left out. */
export function exceptionsHref(view: ExceptionsView, change: Partial<ExceptionsView> = {}, id?: string): string {
  const v = { ...view, ...change };
  const p = new URLSearchParams();
  if (v.tab !== "active") p.set("status", v.tab);
  if (v.severity.length) p.set("severity", v.severity.join(","));
  if (v.sort !== "severity") p.set("sort", v.sort);
  if (v.page > 1) p.set("page", String(v.page));
  const qs = p.toString();
  return `/exceptions${id ? `/${id}` : ""}${qs ? `?${qs}` : ""}`;
}

export const CLASS_LABEL: Record<ExceptionClass, string> = {
  incident: "Incident",
  maintenance: "Maintenance",
  cleaning: "Cleaning",
  charging: "Charging",
  other: "Other",
};
