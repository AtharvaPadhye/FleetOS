import { z } from "zod";
import { CAPABILITIES, CAPABILITY_STATES, LEDGER_CATEGORIES, VEHICLE_STATUSES } from "@fleetos/domain";
import { PeriodQuery } from "./period";
import { FLEET_SORTS } from "../services/fleet-sorts";

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
  /** Hub name when inside one, "On the road" otherwise. */
  location_name: z.string().nullable().optional(),
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
  display_name: z.string().nullable().optional(),
  home_hub: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  state: VehicleState,
  /** Today in the org's time zone; money is null without money access. */
  today: z
    .object({
      revenue_cents: cents.nullable(),
      contribution_cents: cents.nullable(),
      revenue_per_available_hour_cents: cents.nullable(),
      downtime_min: z.number().int(),
    })
    .optional(),
  profitability: z.enum(["strong", "monitor", "review"]).nullable().optional(),
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

export const VEHICLE_SORTS = FLEET_SORTS;

export const VehicleListQuery = z.strictObject({
  status: listOf(VehicleStatus),
  hub_id: z.uuid().optional(),
  soc_lt: z.coerce.number().min(0).max(1).optional(),
  soc_gte: z.coerce.number().min(0).max(1).optional(),
  q: z.string().trim().max(80).optional(),
  profitability: z.enum(["strong", "monitor", "review"]).optional(),
  sort: z.enum([...VEHICLE_SORTS, ...VEHICLE_SORTS.map((s) => `-${s}` as const)]).default("number"),
  limit: Limit,
  cursor: Cursor,
  /** csv: every matching vehicle (all pages) as a download (PRD FL-4). */
  format: z.enum(["json", "csv"]).default("json"),
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

// Preview capabilities (task 3.9). Shapes may change until a real source makes them stable (ADR-0006).
export const CapabilityUnavailable = z.object({
  error: z.literal("capability_unavailable"),
  capability: z.enum(CAPABILITIES),
  message: z.string(),
  docs: z.url(),
  request_id: z.string(),
});

export const Earnings = z.object({
  vehicle_id: z.uuid(),
  gross_cents: cents,
  platform_fee_cents: cents,
  net_cents: cents,
  trips: z.number().int(),
  period: Period,
});

export const CabinEvent = z.object({
  id: z.uuid(),
  vehicle_id: z.uuid(),
  at: isoDateTime,
  kind: z.enum(["spill", "debris", "lost_item", "odor", "damage", "other"]),
  confidence: z.number().optional(),
  ride_id: z.uuid().nullable(),
});

export const AutonomyEvent = z.object({
  id: z.uuid(),
  vehicle_id: z.uuid(),
  at: isoDateTime,
  kind: z.enum(["disengagement", "remote_assist", "incident", "stuck"]),
  location: GeoPoint.nullable(),
  severity: z.enum(["critical", "high", "medium", "low"]).nullable(),
  detail: z.string().nullable(),
});

export const Ride = z.object({
  id: z.uuid(),
  vehicle_id: z.uuid(),
  started_at: isoDateTime,
  ended_at: isoDateTime.nullable(),
  distance_m: z.number(),
  fare_cents: cents,
  platform_fee_cents: cents,
  pickup: GeoPoint.nullable(),
  dropoff: GeoPoint.nullable(),
});

export const DispatchAvailability = z.object({
  vehicle_id: z.uuid(),
  on_network: z.boolean(),
  zone: z.string().nullable(),
  updated_at: isoDateTime,
});
export const DispatchChange = z.strictObject({
  vehicle_ids: z.array(z.uuid()).min(1).max(500),
  on_network: z.boolean(),
  reason: z.string().max(500).optional(),
});

export const ChargerLive = z.object({
  charger_id: z.uuid(),
  status: z.enum(["available", "preparing", "charging", "finishing", "faulted", "unavailable"]),
  power_kw: z.number().nullable(),
  vehicle_id: z.uuid().nullable(),
  at: isoDateTime,
});

export const TariffLive = z.object({
  hub_id: z.uuid(),
  price_cents_per_kwh: z.number(),
  period: z.string(),
  valid_until: isoDateTime.optional(),
});

export const VendorTracking = z.object({
  job_id: z.uuid(),
  status: z.enum(["accepted", "en_route", "on_scene", "completed", "cancelled"]),
  eta_at: isoDateTime.nullable(),
  location: GeoPoint.nullable(),
  at: isoDateTime,
  evidence_urls: z.array(z.string()),
});

export const RideListQuery = HistoryQuery.extend({ vehicle_id: z.uuid().optional() });
export const TariffLiveQuery = z.strictObject({ hub_id: z.uuid().optional() });
/** Webhook body: vendors may not know an ETA, location or evidence yet. */
export const VendorTrackingUpdate = VendorTracking.partial({ eta_at: true, location: true, evidence_urls: true });

/** POST /vehicles: add a vehicle manually (owner/admin). VIN check digit validated in the service. */
export const VehicleCreate = z.strictObject({
  vin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-HJ-NPR-Z0-9]{17}$/, "A VIN is 17 letters and digits (no I, O or Q)."),
  number: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{1,12}$/, "Up to 12 letters, digits or dashes."),
  display_name: z.string().trim().max(60).optional(),
  home_hub_id: z.uuid().optional(),
  insurance_monthly_cents: z.number().int().min(0).max(100_000_00).optional(),
  financing_monthly_cents: z.number().int().min(0).max(100_000_00).optional(),
});
export type VehicleCreate = z.infer<typeof VehicleCreate>;

export const TelemetryQuery = z.strictObject({
  fields: listOf(
    z.enum([
      "soc",
      "speed_mps",
      "odometer_m",
      "charge_power_kw",
      "tpms_fl_bar",
      "tpms_fr_bar",
      "tpms_rl_bar",
      "tpms_rr_bar",
    ]),
  ),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  interval: z.enum(["raw", "1m", "1h", "1d"]).optional(),
});
export const TelemetrySeries = z.object({
  vehicle_id: z.uuid(),
  interval: z.string(),
  series: z.array(
    z.object({
      field: z.string(),
      points: z.array(z.object({ t: isoDateTime, v: z.number(), min: z.number(), max: z.number() })),
    }),
  ),
});

export const VehicleAlert = z.object({
  id: z.uuid(),
  name: z.string(),
  audiences: z.array(z.string()),
  started_at: isoDateTime,
  ended_at: isoDateTime.nullable(),
  source: z.string(),
});
export const AlertQuery = z.strictObject({
  active: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  limit: Limit,
  cursor: Cursor,
});

// Vendors (task 5.6)
export const VendorCategory = z.enum(["cleaning", "detailing", "tyres", "towing", "maintenance", "charging"]);
export const Vendor = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  categories: z.array(VendorCategory),
  status: z.enum(["active", "limited", "inactive"]),
  contact: z.object({ name: z.string().nullable(), phone: z.string().nullable(), email: z.string().nullable() }),
  base_location: GeoPoint.nullable(),
  service_radius_m: z.number().nullable(),
  pricing: z.record(z.string(), z.number().int()),
  sla_response_min: z.number().int().nullable(),
  sla_resolution_min: z.number().int().nullable(),
  capacity_note: z.string().nullable(),
  metrics: z.object({
    avg_response_min: z.number().nullable(),
    avg_job_cost_cents: cents.nullable(),
    sla_compliance: z.number().nullable(),
    rating: z.number().nullable(),
    jobs_completed: z.number().int(),
  }),
});
const VendorFields = {
  name: z.string().trim().min(1).max(80),
  categories: z.array(VendorCategory).min(1),
  contact: z.strictObject({
    name: z.string().trim().max(80).optional(),
    phone: z.string().trim().max(40).optional(),
    email: z.email().optional(),
  }),
  service_area: z.strictObject({
    type: z.literal("Polygon"),
    coordinates: z.array(z.array(z.array(z.number()).length(2)).min(4)).length(1),
  }),
  service_radius_m: z.number().min(100).max(300_000),
  pricing: z.record(z.string(), z.number().int().min(0)),
  status: z.enum(["active", "limited", "inactive"]),
  base_location: z.strictObject({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
  sla_response_min: z.number().int().min(1).max(1440),
  sla_resolution_min: z.number().int().min(1).max(10080),
  capacity_note: z.string().trim().max(200),
};
/** POST /vendors: name and at least one category; everything else optional. */
export const VendorCreate = z.strictObject({
  ...Object.fromEntries(Object.entries(VendorFields).map(([k, v]) => [k, v.optional()])),
  name: VendorFields.name,
  categories: VendorFields.categories,
}) as z.ZodType<
  import("@/lib/services/vendors").VendorInput & { name: string; categories: z.infer<typeof VendorCategory>[] }
>;
/** PATCH /vendors/{id}: any subset. */
export const VendorPatch = z
  .strictObject(Object.fromEntries(Object.entries(VendorFields).map(([k, v]) => [k, v.optional()])))
  .refine((o) => Object.keys(o).length > 0, "Send at least one field to change.") as unknown as z.ZodType<
  import("@/lib/services/vendors").VendorInput
>;
export const VendorRanking = z.object({
  vendor: Vendor,
  expected_eta_min: z.number().nullable(),
  expected_cost_cents: cents.nullable(),
  sla_compliance: z.number().nullable(),
  score: z.number(),
  distance_m: z.number().nullable(),
  breakdown: z.object({ eta: z.number(), cost: z.number(), sla: z.number(), limited_penalty: z.boolean() }),
});
export const VendorListQuery = z.strictObject({ category: VendorCategory.optional() });
export const VendorRankQuery = z.strictObject({ category: VendorCategory, vehicle_id: z.uuid() });
