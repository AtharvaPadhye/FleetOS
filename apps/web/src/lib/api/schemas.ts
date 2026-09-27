import { z } from "zod";
import { CAPABILITIES, CAPABILITY_STATES, LEDGER_CATEGORIES, VEHICLE_STATUSES } from "@fleetos/domain";
import { PeriodQuery } from "./period";

/**
 * Response and request schemas for /api/v1 (task 3.8). Each mirrors a schema in
 * docs/architecture/openapi.yaml; `src/lib/api/contract.test.ts` fails CI if they drift apart.
 * Handlers validate every response with these before sending it.
 */

export const ROLES = ["owner", "admin", "ops", "finance", "viewer"] as const;
export const Role = z.enum(ROLES);

export const ERROR_CODES = [
  "invalid_request",
  "unauthenticated",
  "forbidden",
  "not_found",
  "conflict",
  "validation_failed",
  "rate_limited",
  "capability_unavailable",
  "upstream_unavailable",
  "internal",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const ApiError = z.object({
  error: z.enum(ERROR_CODES),
  message: z.string(),
  details: z.array(z.object({}).loose()).optional(),
  request_id: z.string(),
});

export const Org = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  timezone: z.string(),
  currency: z.string(),
  region: z.enum(["na", "eu", "cn"]),
  is_demo: z.boolean(),
  availability_target: z.number(),
  low_soc_threshold: z.number(),
  service_start: z.string(),
  service_end: z.string(),
});
export type Org = z.infer<typeof Org>;

export const Me = z.object({
  user_id: z.uuid(),
  email: z.email(),
  full_name: z.string().nullable(),
  active_org_id: z.uuid().optional(),
  memberships: z.array(z.object({ org: Org, role: Role })),
});

export const OrgList = z.array(Org);

export const Capabilities = z.object({
  org_id: z.uuid(),
  capabilities: z.array(
    z.object({
      name: z.enum(CAPABILITIES),
      state: z.enum(CAPABILITY_STATES),
      source: z.string().nullable(),
      fallback: z.string().nullable(),
    }),
  ),
});

export const PageInfo = z.object({
  next_cursor: z.string().nullable(),
  total: z.number().int(),
  total_is_estimate: z.boolean(),
});

export const VehicleStatus = z.enum(VEHICLE_STATUSES);

const isoDateTime = z.iso.datetime({ offset: true });
const cents = z.number().int();

export const GeoPoint = z.object({ lat: z.number(), lng: z.number() });

export const VehicleState = z.object({
  status: VehicleStatus,
  status_since: isoDateTime.optional(),
  soc: z.number().nullable(),
  range_m: z.number().nullable(),
  charge_state: z.string().nullable(),
  charge_power_kw: z.number().nullable(),
  location: GeoPoint.nullable(),
  heading: z.number().nullable(),
  speed_mps: z.number().nullable(),
  odometer_m: z.number().nullable(),
  locked: z.boolean().nullable(),
  tpms: z.object({ fl: z.number(), fr: z.number(), rl: z.number(), rr: z.number() }).partial().nullable(),
  connectivity: z.enum(["online", "asleep", "offline"]),
  current_hub_id: z.uuid().nullable(),
  last_telemetry_at: isoDateTime.nullable(),
  fresh: z.boolean(),
});

export const VehicleListItem = z.object({
  id: z.uuid(),
  number: z.string(),
  vin: z.string(),
  home_hub: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  state: VehicleState,
});

export const Vehicle = VehicleListItem.extend({
  model: z.string().nullable(),
  lifecycle: z.enum(["pending", "commissioned", "retired"]),
  provider: z.enum(["simulator", "tesla"]),
  commissioned_at: isoDateTime.nullable(),
  /** null for roles without money access. */
  insurance_monthly_cents: cents.nullable(),
  financing_monthly_cents: cents.nullable(),
  virtual_key_paired: z.boolean().nullable(),
  telemetry_synced: z.boolean().nullable(),
  holds: z.array(z.object({ id: z.uuid(), reason: z.string(), created_at: isoDateTime })),
});

export const page = <T extends z.ZodType>(item: T) => z.object({ data: z.array(item), page: PageInfo });

export const StatusEvent = z.object({
  id: z.string(),
  vehicle_id: z.uuid(),
  from_status: VehicleStatus.nullable(),
  to_status: VehicleStatus,
  at: isoDateTime,
  cause_type: z.enum(["telemetry", "ticket", "exception", "policy", "manual", "platform"]),
  cause_id: z.uuid().nullable(),
  detail: z.string().nullable(),
});

export const ChargingSession = z.object({
  id: z.uuid(),
  hub_id: z.uuid().nullable(),
  started_at: isoDateTime,
  ended_at: isoDateTime.nullable(),
  energy_kwh: z.number(),
  cost_cents: cents,
  source: z.enum(["tesla_supercharger", "depot_inferred", "ocpp", "simulator"]),
});

// Query parameters (strings on the wire, coerced here).
export const Limit = z.coerce.number().int().min(1).max(200).default(25);
export const Cursor = z.string().max(200).optional();
const listOf = <T extends z.ZodType>(item: T) =>
  z.preprocess((v) => (v === undefined || Array.isArray(v) ? v : [v]), z.array(item)).optional();

export const VEHICLE_SORTS = ["number", "status", "soc", "status_since", "last_telemetry_at"] as const;

export const VehicleListQuery = z.strictObject({
  status: listOf(VehicleStatus),
  hub_id: z.uuid().optional(),
  soc_lt: z.coerce.number().min(0).max(1).optional(),
  soc_gte: z.coerce.number().min(0).max(1).optional(),
  q: z.string().trim().max(80).optional(),
  sort: z.enum([...VEHICLE_SORTS, ...VEHICLE_SORTS.map((s) => `-${s}` as const)]).default("number"),
  limit: Limit,
  cursor: Cursor,
});

export const HistoryQuery = z.strictObject({
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  limit: Limit,
  cursor: Cursor,
});

const ratio = z.number().nullable();
const Period = z.object({ from: isoDateTime, to: isoDateTime });

export const FleetKpis = z.object({
  period: Period,
  total_vehicles: z.number().int(),
  available_now: z.number().int(),
  earning_now: z.number().int(),
  status_counts: z.record(z.string(), z.number().int()),
  availability: ratio,
  availability_target: z.number(),
  uptime: ratio,
  utilization: z.object({ value: z.number(), estimated: z.boolean() }).nullable(),
  downtime_hours_by_cause: z.record(z.string(), z.number()),
  avg_soc: ratio,
  low_soc_count: z.number().int(),
  // Money: null for roles without money access.
  gross_revenue_cents: cents.nullable(),
  contribution_cents: cents.nullable(),
  contribution_margin: ratio,
  downtime_cost_cents: cents.nullable(),
  revenue_per_available_hour_cents: cents.nullable(),
  data_sources: z.record(z.string(), z.string()),
});

export const VehicleKpis = z.object({
  vehicle_id: z.uuid(),
  metrics: z.array(
    z.object({
      key: z.string(),
      value: z.number().nullable(),
      fleet_avg: z.number().nullable(),
      unit: z.string(),
      flag: z.enum(["good", "warn", "bad"]).nullable(),
      data_source: z.string().nullable(),
    }),
  ),
  performance_label: z.enum(["strong", "monitor", "review"]).optional(),
});

export const LedgerCategory = z.enum(LEDGER_CATEGORIES);

export const Pnl = z.object({
  scope: z.enum(["fleet", "vehicle"]),
  scope_id: z.uuid().nullable(),
  period: Period,
  view: z.enum(["accounting", "economic"]),
  lines: z.array(
    z.object({
      category: LedgerCategory,
      amount_cents: cents,
      vs_fleet_avg_pct: z.number().nullable(),
      flagged: z.boolean(),
    }),
  ),
  gross_revenue_cents: cents,
  contribution_cents: cents,
  contribution_margin: ratio,
  fixed_allocations_cents: cents,
  net_contribution_cents: cents,
  downtime_cost_cents: cents,
  economic_net_cents: cents.nullable(),
});

export const KpiPeriodQuery = z.strictObject({ ...PeriodQuery });
export const PnlQuery = z.strictObject({
  scope: z.enum(["fleet", "vehicle"]).default("fleet"),
  scope_id: z.uuid().optional(),
  view: z.enum(["accounting", "economic"]).default("accounting"),
  ...PeriodQuery,
});
