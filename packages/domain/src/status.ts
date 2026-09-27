/**
 * Vehicle operational status (docs/requirements/vehicle-states.md).
 * deriveStatus() evaluates conditions in precedence order; the first match wins (§3).
 */
export const VEHICLE_STATUSES = [
  "in_service",
  "ready",
  "charging",
  "cleaning",
  "maintenance",
  "incident",
  "offline",
] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export type StatusClass = "available" | "planned_downtime" | "unplanned_downtime";

/** kpis.md §2: every status belongs to exactly one class. */
export const STATUS_CLASS: Record<VehicleStatus, StatusClass> = {
  in_service: "available",
  ready: "available",
  charging: "planned_downtime",
  cleaning: "planned_downtime",
  maintenance: "unplanned_downtime",
  incident: "unplanned_downtime",
  offline: "unplanned_downtime",
};

export const isAvailable = (s: VehicleStatus) => STATUS_CLASS[s] === "available";
export const isEarning = (s: VehicleStatus) => s === "in_service";
export const isUnplanned = (s: VehicleStatus) => STATUS_CLASS[s] === "unplanned_downtime";

export type ChargeState = "charging" | "starting" | "stopped" | "complete" | "disconnected";
export type Connectivity = "online" | "asleep" | "offline";

/** Offline thresholds (vehicle-states.md §6): 15 min with streaming, 30 min when only polling. */
export const OFFLINE_AFTER_MS = { streaming: 15 * 60_000, polling: 30 * 60_000 } as const;
/** Derived (telemetry-driven) changes must hold this long before they're committed (§6). */
export const DEBOUNCE_MS = 60_000;

export interface StatusInputs {
  now: Date;
  lastTelemetryAt: Date | null;
  telemetryMode: "streaming" | "polling";
  connectivity: Connectivity;
  insideHub: boolean;
  /** State of charge 0–1, null if unknown. */
  soc: number | null;
  /** Policy minimum SOC to stay available (default 0.40, kpis.md §7). */
  socMin: number;
  /** Charge target when plugged in at a hub. */
  chargeTarget: number;
  chargeState: ChargeState | null;
  pluggedIn: boolean;
  /** Driving to a hub because of a charge task. */
  chargeTaskToHub: boolean;
  blockingIncident: boolean;
  blockingMaintenance: boolean;
  manualHold: boolean;
  teslaServiceMode: boolean;
  blockingCleaning: boolean;
  /** Robotaxi platform says the car is on a trip / accepting rides. Needs preview capability dispatch or rides; null when unknown. */
  platformOnTrip: boolean | null;
}

export interface DerivedStatus {
  status: VehicleStatus;
  /** Precedence rule that matched (1–7, 8 = fallback), for the status-event `detail`. */
  rule: number;
  reason: string;
  /** Ticket/exception/manual-driven changes skip the debounce (§6). */
  immediate: boolean;
  /** Fallback case: at a hub below minimum SOC, so a charge task should be created. */
  needsChargeTask: boolean;
}

const result = (
  status: VehicleStatus,
  rule: number,
  reason: string,
  immediate = false,
  needsChargeTask = false,
): DerivedStatus => ({ status, rule, reason, immediate, needsChargeTask });

export function isStale(i: Pick<StatusInputs, "now" | "lastTelemetryAt" | "telemetryMode">): boolean {
  if (!i.lastTelemetryAt) return true;
  return i.now.getTime() - i.lastTelemetryAt.getTime() > OFFLINE_AFTER_MS[i.telemetryMode];
}

export function deriveStatus(i: StatusInputs): DerivedStatus {
  if (i.blockingIncident) return result("incident", 1, "Open incident blocks service", true);

  const asleepAtHub = i.connectivity === "asleep" && i.insideHub;
  if (isStale(i) && !asleepAtHub) return result("offline", 2, "No telemetry within the offline threshold");

  if (i.blockingMaintenance) return result("maintenance", 3, "Open maintenance ticket blocks service", true);
  if (i.manualHold) return result("maintenance", 3, "Pulled from service manually", true);
  if (i.teslaServiceMode) return result("maintenance", 3, "Vehicle reports service mode", true);

  if (i.blockingCleaning) return result("cleaning", 4, "Open cleaning ticket blocks service", true);

  const actively = i.chargeState === "charging" || i.chargeState === "starting";
  const pluggedBelowTarget = i.pluggedIn && i.insideHub && i.soc !== null && i.soc < i.chargeTarget;
  if (actively) return result("charging", 5, "Charging");
  if (pluggedBelowTarget) return result("charging", 5, "Plugged in below charge target");
  if (i.chargeTaskToHub) return result("charging", 5, "Driving to a hub to charge");

  if (i.platformOnTrip === true) return result("in_service", 6, "Platform reports the vehicle on a trip");
  if (!i.insideHub) return result("in_service", 6, "Available outside a hub");

  if (i.soc === null || i.soc >= i.socMin) return result("ready", 7, "Available at a hub");
  return result("charging", 8, "At a hub below minimum SOC; charge task needed", false, true);
}

/**
 * Whether a derived status should be committed (vehicle-states.md §6).
 * @param candidateSince when this candidate status was first derived.
 */
export function shouldCommit(
  committed: VehicleStatus | null,
  candidate: DerivedStatus,
  candidateSince: Date,
  now: Date,
): boolean {
  if (candidate.status === committed) return false;
  if (committed === null || candidate.immediate) return true;
  return now.getTime() - candidateSince.getTime() >= DEBOUNCE_MS;
}
