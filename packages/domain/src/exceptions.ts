/**
 * Exception rules (PRD EX-2, EX-5; erd.md exception_rules). A rule is data: a condition over a vehicle's live
 * facts → class, severity, whether it takes the car out of service, and a recommended action. The engine
 * evaluates enabled rules at every status evaluation; one exception stays open per rule and vehicle until the
 * condition clears (dedupe), and blocking exceptions drive the Incident / Maintenance / Cleaning statuses.
 */
import { revenueAtRiskCents } from "./money";
import type { VendorCategory } from "./vendors";

export const SEVERITIES = ["critical", "high", "medium", "low"] as const;
export type Severity = (typeof SEVERITIES)[number];
export const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export const EXCEPTION_CLASSES = ["incident", "maintenance", "cleaning", "charging", "other"] as const;
export type ExceptionClass = (typeof EXCEPTION_CLASSES)[number];

export const EXCEPTION_STATUSES = ["open", "assigned", "in_progress", "resolved", "dismissed"] as const;
export type ExceptionStatus = (typeof EXCEPTION_STATUSES)[number];
/** Statuses that still need someone (and can block service). */
export const ACTIVE_EXCEPTION_STATUSES: readonly ExceptionStatus[] = ["open", "assigned", "in_progress"];
export const isActiveException = (s: ExceptionStatus) => ACTIVE_EXCEPTION_STATUSES.includes(s);

/** Facts a condition can test, in the units people write rules in. */
export const RULE_FIELDS = {
  soc_pct: { label: "Battery", unit: "%", type: "number" },
  tpms_min_bar: { label: "Lowest tyre pressure", unit: "bar", type: "number" },
  speed_mph: { label: "Speed", unit: "mph", type: "number" },
  telemetry_age_min: { label: "Minutes without data", unit: "min", type: "number" },
  inside_hub: { label: "Inside a hub", unit: null, type: "boolean" },
  charging: { label: "Charging", unit: null, type: "boolean" },
  alert: { label: "Active vehicle alert", unit: null, type: "pattern" },
} as const;
export type RuleField = keyof typeof RULE_FIELDS;
export type RuleOp = "lt" | "lte" | "gt" | "gte" | "eq" | "neq" | "matches";

export interface RuleLeaf {
  field: RuleField;
  op: RuleOp;
  value: number | boolean | string;
}
/** Every `all` leaf must hold, and at least one `any` leaf when present, for at least `for_min` minutes. */
export interface RuleCondition {
  all?: RuleLeaf[];
  any?: RuleLeaf[];
  for_min?: number;
}

export interface RecommendedActionTemplate {
  label: string;
  vendor_category?: VendorCategory | null;
  /** Downtime to expect before history exists for this type (kpis.md §3.2 falls back to it). */
  expected_downtime_min?: number | null;
}

export interface ExceptionRuleDef {
  key: string;
  name: string;
  condition: RuleCondition;
  class: ExceptionClass;
  severity: Severity;
  blocks_service: boolean;
  recommended_action: RecommendedActionTemplate;
  /** Reserved for automatic follow-ups (e.g. create and dispatch a ticket, task 5.5). */
  auto_actions: Record<string, unknown>;
  /** Resolve the exception by itself when the condition clears. */
  auto_resolve: boolean;
  /** Preview capability the triggering data needs (PRD EX-2): the rule only runs when it's live or simulated. */
  capability?: "cabin_events" | "autonomy_events" | null;
}

/** A vehicle's facts at one instant (the engine builds these from vehicle_state_current). */
export interface RuleFacts {
  soc_pct: number | null;
  tpms_min_bar: number | null;
  speed_mph: number | null;
  telemetry_age_min: number | null;
  inside_hub: boolean;
  charging: boolean;
  alerts: readonly string[];
}

const PATTERN_MAX = 200;

/** Whether a user-supplied alert pattern is safe to compile (length-capped, valid regex). */
export function validPattern(p: string): boolean {
  if (!p || p.length > PATTERN_MAX) return false;
  try {
    new RegExp(p, "i");
    return true;
  } catch {
    return false;
  }
}

const patterns = new Map<string, RegExp | null>();
const compile = (p: string): RegExp | null => {
  if (!patterns.has(p)) patterns.set(p, validPattern(p) ? new RegExp(p, "i") : null);
  return patterns.get(p) ?? null;
};

/** The alert that satisfied a `matches` leaf, true for other leaves that hold, false otherwise. */
export function evalLeaf(leaf: RuleLeaf, f: RuleFacts): string | boolean {
  if (leaf.field === "alert") {
    if (leaf.op !== "matches" || typeof leaf.value !== "string") return false;
    const re = compile(leaf.value);
    return (re && f.alerts.find((a) => re.test(a))) ?? false;
  }
  const actual = f[leaf.field];
  if (actual === null || actual === undefined) return false;
  const v = leaf.value;
  switch (leaf.op) {
    case "eq":
      return actual === v;
    case "neq":
      return actual !== v;
    case "lt":
      return typeof v === "number" && typeof actual === "number" && actual < v;
    case "lte":
      return typeof v === "number" && typeof actual === "number" && actual <= v;
    case "gt":
      return typeof v === "number" && typeof actual === "number" && actual > v;
    case "gte":
      return typeof v === "number" && typeof actual === "number" && actual >= v;
    default:
      return false;
  }
}

/** Whether the condition holds right now (ignoring `for_min`), and the alert that triggered it if any. */
export function conditionHolds(c: RuleCondition, f: RuleFacts): { holds: boolean; alert: string | null } {
  let alert: string | null = null;
  const check = (l: RuleLeaf) => {
    const r = evalLeaf(l, f);
    if (typeof r === "string") alert ??= r;
    return r !== false;
  };
  const all = c.all ?? [];
  const any = c.any ?? [];
  if (!all.length && !any.length) return { holds: false, alert: null };
  const holds = all.every(check) && (!any.length || any.some(check));
  return { holds, alert: holds ? alert : null };
}

export const dedupeKey = (ruleKey: string, vehicleId: string) => `${ruleKey}:${vehicleId}`;

/** Status a blocking exception class puts the car in (vehicle-states.md §3; tickets join in task 5.5). */
export const BLOCKING_STATUS: Partial<Record<ExceptionClass, "incident" | "maintenance" | "cleaning">> = {
  incident: "incident",
  maintenance: "maintenance",
  cleaning: "cleaning",
};

/** Expected remaining downtime (kpis.md §3.2), floored so a still-open issue never shows $0 at risk. */
export const MIN_REMAINING_DOWNTIME_MIN = 15;
export function openExceptionRiskCents(input: {
  baselineRateCentsPerH: number | null;
  expectedDowntimeMin: number | null;
  elapsedMin: number;
}): number | null {
  if (input.baselineRateCentsPerH === null || input.expectedDowntimeMin === null) return null;
  const remaining = Math.max(input.expectedDowntimeMin - input.elapsedMin, MIN_REMAINING_DOWNTIME_MIN);
  return revenueAtRiskCents(remaining / 60, input.baselineRateCentsPerH);
}

/**
 * System rules seeded into every org (editable, can be disabled, not deleted). Alert patterns cover the
 * simulator's names and the Tesla names they imitate; Phase 4 extends them with real alert names.
 */
export const SYSTEM_RULES: readonly ExceptionRuleDef[] = [
  {
    key: "vehicle_immobilized",
    name: "Vehicle immobilized",
    condition: { any: [{ field: "alert", op: "matches", value: "immobiliz|towing" }] },
    class: "incident",
    severity: "critical",
    blocks_service: true,
    recommended_action: { label: "Dispatch a tow", vendor_category: "towing", expected_downtime_min: 330 },
    auto_actions: {},
    auto_resolve: true,
  },
  {
    key: "tyre_pressure_low",
    name: "Tyre pressure low",
    condition: {
      any: [
        { field: "alert", op: "matches", value: "tirePressure|tyre" },
        { field: "tpms_min_bar", op: "lt", value: 2.2 },
      ],
    },
    class: "incident",
    severity: "high",
    blocks_service: true,
    recommended_action: {
      label: "Dispatch roadside tyre service",
      vendor_category: "tyres",
      expected_downtime_min: 90,
    },
    auto_actions: {},
    auto_resolve: true,
  },
  {
    key: "drive_fault",
    name: "Drive or battery fault",
    condition: { any: [{ field: "alert", op: "matches", value: "fault|inverter|isolation|bms_" }] },
    class: "maintenance",
    severity: "high",
    blocks_service: true,
    recommended_action: { label: "Book diagnostics", vendor_category: "maintenance", expected_downtime_min: 240 },
    auto_actions: {},
    auto_resolve: true,
  },
  {
    key: "cabin_cleanliness",
    name: "Cabin needs cleaning",
    condition: { any: [{ field: "alert", op: "matches", value: "cabin|clean" }] },
    class: "cleaning",
    severity: "medium",
    blocks_service: true,
    recommended_action: { label: "Dispatch cleaning", vendor_category: "cleaning", expected_downtime_min: 45 },
    auto_actions: {},
    auto_resolve: true,
    capability: "cabin_events",
  },
  {
    key: "low_battery",
    name: "Battery critically low",
    condition: {
      all: [
        { field: "soc_pct", op: "lt", value: 15 },
        { field: "charging", op: "eq", value: false },
      ],
      for_min: 2,
    },
    class: "charging",
    severity: "medium",
    blocks_service: false,
    recommended_action: { label: "Send to the nearest hub to charge", expected_downtime_min: 60 },
    auto_actions: {},
    auto_resolve: true,
  },
  {
    key: "no_telemetry",
    name: "No data from vehicle",
    condition: { all: [{ field: "telemetry_age_min", op: "gt", value: 30 }] },
    class: "other",
    severity: "high",
    blocks_service: false,
    recommended_action: { label: "Check connectivity; send someone if it stays dark", expected_downtime_min: 60 },
    auto_actions: {},
    auto_resolve: true,
  },
  {
    key: "stationary_outside_hub",
    name: "Stopped outside a hub",
    condition: {
      all: [
        { field: "speed_mph", op: "lt", value: 1 },
        { field: "inside_hub", op: "eq", value: false },
        { field: "charging", op: "eq", value: false },
      ],
      // Without [P:dispatch] a car waiting for a ride looks the same; 4 h keeps it to real anomalies.
      for_min: 240,
    },
    class: "other",
    severity: "low",
    blocks_service: false,
    recommended_action: { label: "Check why the vehicle hasn't moved", expected_downtime_min: 30 },
    auto_actions: {},
    auto_resolve: true,
  },
];
