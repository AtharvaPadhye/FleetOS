import { z } from "zod";
import {
  Capabilities,
  ChargingSession,
  HistoryQuery,
  Me,
  OrgList,
  StatusEvent,
  Vehicle,
  VehicleListItem,
  VehicleListQuery,
  page,
  type ROLES,
} from "./schemas";

/**
 * Every implemented /api/v1 operation. Route handlers are built from these (apiRoute), and the contract test
 * compares each one with docs/architecture/openapi.yaml, so an endpoint can't ship without a matching spec.
 */
export interface Operation<Q extends z.ZodType = z.ZodType, R extends z.ZodType = z.ZodType> {
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
}

const NoQuery = z.object({});

const op = <Q extends z.ZodType, R extends z.ZodType>(o: Operation<Q, R>) => o;

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

export const getVehicle = op({
  operationId: "getVehiclesBy_id",
  method: "GET",
  path: "/vehicles/{id}",
  stability: "stable",
  org: "required",
  query: NoQuery,
  response: Vehicle,
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

export const OPERATIONS: Operation[] = [
  getMe,
  getOrgs,
  getCapabilities,
  getVehicles,
  getVehicle,
  getVehicleStatusEvents,
  getVehicleChargingSessions,
];
