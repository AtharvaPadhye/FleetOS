import { z } from "zod";
import type { Capability } from "@fleetos/domain";
import {
  ExceptionCreate,
  ExceptionDetail,
  ExceptionListQuery,
  ExceptionPage,
  ExceptionRule,
  ExceptionRuleWrite,
  ExceptionUpdate,
  Exception,
  AutonomyEvent,
  CabinEvent,
  Capabilities,
  ChargerLive,
  DispatchAvailability,
  DispatchChange,
  Earnings,
  Ride,
  RideListQuery,
  TariffLive,
  TariffLiveQuery,
  VendorTracking,
  Vendor,
  VendorCreate,
  VendorListQuery,
  VendorPatch,
  VendorRankQuery,
  VendorRanking,
  VendorTrackingUpdate,
  ChargingSession,
  FleetKpis,
  HistoryQuery,
  KpiPeriodQuery,
  Me,
  OrgList,
  Pnl,
  PnlQuery,
  StatusEvent,
  TelemetryQuery,
  TelemetrySeries,
  VehicleAlert,
  AlertQuery,
  Vehicle,
  VehicleListItem,
  VehicleCreate,
  VehicleKpis,
  VehicleListQuery,
  page,
  type ROLES,
} from "./schemas";

/**
 * Every implemented /api/v1 operation. Route handlers are built from these (apiRoute), and the contract test
 * compares each one with docs/architecture/openapi.yaml, so an endpoint can't ship without a matching spec.
 */
export interface Operation<
  Q extends z.ZodType = z.ZodType,
  R extends z.ZodType = z.ZodType,
  B extends z.ZodType = z.ZodType,
> {
  operationId: string;
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** Spec path, e.g. "/vehicles/{id}". */
  path: string;
  stability: "stable" | "preview";
  /** "required" (default for org data), "optional" (user-level, org used when sent) or "none". */
  org: "required" | "optional" | "none";
  roles?: readonly (typeof ROLES)[number][];
  query: Q;
  response: R;
  /** JSON request body, validated before the handler runs (422 on failure). */
  body?: B;
  /** Preview operations name their capability; without it the org gets 501 capability_unavailable. */
  capability?: Capability;
}

const NoQuery = z.object({});

const op = <Q extends z.ZodType, R extends z.ZodType, B extends z.ZodType = z.ZodUnknown>(o: Operation<Q, R, B>) => o;

export const getMe = op({
  operationId: "getMe",
  method: "GET",
  path: "/me",
  stability: "stable",
  org: "optional",
  query: NoQuery,
  response: Me,
});

export const getOrgs = op({
  operationId: "getOrgs",
  method: "GET",
  path: "/orgs",
  stability: "stable",
  org: "none",
  query: NoQuery,
  response: OrgList,
});

export const getCapabilities = op({
  operationId: "getCapabilities",
  method: "GET",
  path: "/capabilities",
  stability: "stable",
  org: "required",
  query: NoQuery,
  response: Capabilities,
});

export const getVehicles = op({
  operationId: "getVehicles",
  method: "GET",
  path: "/vehicles",
  stability: "stable",
  org: "required",
  query: VehicleListQuery,
  response: page(VehicleListItem),
});

export const postVehicle = op({
  operationId: "postVehicles",
  method: "POST",
  path: "/vehicles",
  stability: "stable",
  org: "required",
  roles: ["owner", "admin"],
  query: NoQuery,
  body: VehicleCreate,
  response: Vehicle,
});

export const getVehicle = op({
  operationId: "getVehiclesBy_id",
  method: "GET",
  path: "/vehicles/{id}",
  stability: "stable",
  org: "required",
  query: NoQuery,
  response: Vehicle,
});

export const getVehicleTelemetry = op({
  operationId: "getVehiclesBy_idTelemetry",
  method: "GET",
  path: "/vehicles/{id}/telemetry",
  stability: "stable",
  org: "required",
  query: TelemetryQuery,
  response: TelemetrySeries,
});

export const getVehicleAlerts = op({
  operationId: "getVehiclesBy_idAlerts",
  method: "GET",
  path: "/vehicles/{id}/alerts",
  stability: "stable",
  org: "required",
  query: AlertQuery,
  response: page(VehicleAlert),
});

export const getVehicleStatusEvents = op({
  operationId: "getVehiclesBy_idStatusEvents",
  method: "GET",
  path: "/vehicles/{id}/status-events",
  stability: "stable",
  org: "required",
  query: HistoryQuery,
  response: page(StatusEvent),
});

export const getVehicleChargingSessions = op({
  operationId: "getVehiclesBy_idChargingSessions",
  method: "GET",
  path: "/vehicles/{id}/charging-sessions",
  stability: "stable",
  org: "required",
  query: HistoryQuery,
  response: page(ChargingSession),
});

export const getFleetKpis = op({
  operationId: "getKpisFleet",
  method: "GET",
  path: "/kpis/fleet",
  stability: "stable",
  org: "required",
  query: KpiPeriodQuery,
  response: FleetKpis,
});

export const getVehicleKpis = op({
  operationId: "getKpisVehiclesBy_id",
  method: "GET",
  path: "/kpis/vehicles/{id}",
  stability: "stable",
  org: "required",
  query: KpiPeriodQuery,
  response: VehicleKpis,
});

export const getPnl = op({
  operationId: "getFinancialsPnl",
  method: "GET",
  path: "/financials/pnl",
  stability: "stable",
  org: "required",
  roles: ["owner", "admin", "finance"],
  query: PnlQuery,
  response: Pnl,
});

// Vendors (task 5.6)
export const getVendors = op({
  operationId: "getVendors",
  method: "GET",
  path: "/vendors",
  stability: "stable",
  org: "required",
  query: VendorListQuery,
  response: z.array(Vendor),
});

export const postVendor = op({
  operationId: "postVendors",
  method: "POST",
  path: "/vendors",
  stability: "stable",
  org: "required",
  roles: ["owner", "admin", "ops"],
  query: NoQuery,
  body: VendorCreate,
  response: Vendor,
});

export const getVendor = op({
  operationId: "getVendorsBy_id",
  method: "GET",
  path: "/vendors/{id}",
  stability: "stable",
  org: "required",
  query: NoQuery,
  response: Vendor,
});

export const patchVendor = op({
  operationId: "patchVendorsBy_id",
  method: "PATCH",
  path: "/vendors/{id}",
  stability: "stable",
  org: "required",
  roles: ["owner", "admin", "ops"],
  query: NoQuery,
  body: VendorPatch,
  response: Vendor,
});

export const getVendorRank = op({
  operationId: "getVendorsRank",
  method: "GET",
  path: "/vendors/rank",
  stability: "stable",
  org: "required",
  query: VendorRankQuery,
  response: z.array(VendorRanking),
});

// Exceptions (task 5.4)
export const getExceptions = op({
  operationId: "getExceptions",
  method: "GET",
  path: "/exceptions",
  stability: "stable",
  org: "required",
  query: ExceptionListQuery,
  response: ExceptionPage,
});

export const postException = op({
  operationId: "postExceptions",
  method: "POST",
  path: "/exceptions",
  stability: "stable",
  org: "required",
  roles: ["owner", "admin", "ops"],
  query: NoQuery,
  body: ExceptionCreate,
  response: Exception,
});

export const getExceptionById = op({
  operationId: "getExceptionsBy_id",
  method: "GET",
  path: "/exceptions/{id}",
  stability: "stable",
  org: "required",
  query: NoQuery,
  response: ExceptionDetail,
});

export const patchException = op({
  operationId: "patchExceptionsBy_id",
  method: "PATCH",
  path: "/exceptions/{id}",
  stability: "stable",
  org: "required",
  roles: ["owner", "admin", "ops"],
  query: NoQuery,
  body: ExceptionUpdate,
  response: Exception,
});

export const getExceptionRules = op({
  operationId: "getExceptionRules",
  method: "GET",
  path: "/exception-rules",
  stability: "stable",
  org: "required",
  query: NoQuery,
  response: z.array(ExceptionRule),
});

export const postExceptionRule = op({
  operationId: "postExceptionRules",
  method: "POST",
  path: "/exception-rules",
  stability: "stable",
  org: "required",
  roles: ["owner", "admin"],
  query: NoQuery,
  body: ExceptionRuleWrite,
  response: ExceptionRule,
});

export const patchExceptionRule = op({
  operationId: "patchExceptionRulesBy_id",
  method: "PATCH",
  path: "/exception-rules/{id}",
  stability: "stable",
  org: "required",
  roles: ["owner", "admin"],
  query: NoQuery,
  body: ExceptionRuleWrite,
  response: ExceptionRule,
});

export const deleteExceptionRule = op({
  operationId: "deleteExceptionRulesBy_id",
  method: "DELETE",
  path: "/exception-rules/{id}",
  stability: "stable",
  org: "required",
  roles: ["owner", "admin"],
  query: NoQuery,
  response: z.null(),
});

// Preview operations (task 3.9): simulated in demo orgs, 501 capability_unavailable elsewhere (ADR-0006).
const preview = { stability: "preview", org: "required" } as const;

export const getVehicleEarnings = op({
  ...preview,
  operationId: "getVehiclesBy_idEarnings",
  method: "GET",
  path: "/vehicles/{id}/earnings",
  capability: "earnings",
  query: KpiPeriodQuery,
  response: Earnings,
});

export const getVehicleCabinEvents = op({
  ...preview,
  operationId: "getVehiclesBy_idCabinEvents",
  method: "GET",
  path: "/vehicles/{id}/cabin-events",
  capability: "cabin_events",
  query: HistoryQuery,
  response: page(CabinEvent),
});

export const getVehicleAutonomyEvents = op({
  ...preview,
  operationId: "getVehiclesBy_idAutonomyEvents",
  method: "GET",
  path: "/vehicles/{id}/autonomy-events",
  capability: "autonomy_events",
  query: HistoryQuery,
  response: page(AutonomyEvent),
});

export const getRides = op({
  ...preview,
  operationId: "getRides",
  method: "GET",
  path: "/rides",
  capability: "rides",
  query: RideListQuery,
  response: page(Ride),
});

export const getRide = op({
  ...preview,
  operationId: "getRidesBy_id",
  method: "GET",
  path: "/rides/{id}",
  capability: "rides",
  query: NoQuery,
  response: Ride,
});

export const getDispatchAvailability = op({
  ...preview,
  operationId: "getDispatchAvailability",
  method: "GET",
  path: "/dispatch/availability",
  capability: "dispatch",
  query: NoQuery,
  response: z.array(DispatchAvailability),
});

export const postDispatchAvailability = op({
  ...preview,
  operationId: "postDispatchAvailability",
  method: "POST",
  path: "/dispatch/availability",
  capability: "dispatch",
  roles: ["owner", "admin", "ops"],
  query: NoQuery,
  body: DispatchChange,
  response: z.array(DispatchAvailability),
});

export const getHubChargersLive = op({
  ...preview,
  operationId: "getHubsBy_idChargersLive",
  method: "GET",
  path: "/hubs/{id}/chargers/live",
  capability: "charger_telemetry",
  query: NoQuery,
  response: z.array(ChargerLive),
});

export const getTariffsLive = op({
  ...preview,
  operationId: "getEnergyTariffsLive",
  method: "GET",
  path: "/energy/tariffs/live",
  capability: "live_tariffs",
  query: TariffLiveQuery,
  response: z.array(TariffLive),
});

export const getVendorTracking = op({
  ...preview,
  operationId: "getVendorJobsBy_idTracking",
  method: "GET",
  path: "/vendor-jobs/{id}/tracking",
  capability: "vendor_tracking",
  query: NoQuery,
  response: VendorTracking,
});

export const postVendorTracking = op({
  ...preview,
  operationId: "postVendorJobsBy_idTracking",
  method: "POST",
  path: "/vendor-jobs/{id}/tracking",
  capability: "vendor_tracking",
  query: NoQuery,
  body: VendorTrackingUpdate,
  response: VendorTracking,
});

export const OPERATIONS: Operation[] = [
  getMe,
  getOrgs,
  getCapabilities,
  getVehicles,
  postVehicle,
  getVehicle,
  getVehicleTelemetry,
  getVehicleAlerts,
  getVehicleStatusEvents,
  getVehicleChargingSessions,
  getFleetKpis,
  getVehicleKpis,
  getPnl,
  getVendors,
  postVendor,
  getVendor,
  patchVendor,
  getVendorRank,
  getExceptions,
  postException,
  getExceptionById,
  patchException,
  getExceptionRules,
  postExceptionRule,
  patchExceptionRule,
  deleteExceptionRule,
  getVehicleEarnings,
  getVehicleCabinEvents,
  getVehicleAutonomyEvents,
  getRides,
  getRide,
  getDispatchAvailability,
  postDispatchAvailability,
  getHubChargersLive,
  getTariffsLive,
  getVendorTracking,
  postVendorTracking,
];
