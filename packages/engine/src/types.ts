import type { VehicleStatus } from "@fleetos/domain";
import type { GeoPoint, TelemetryField } from "@fleetos/providers";
import type { ExceptionCleared, ExceptionOpened, KnownException } from "./exceptions";

export interface EngineHub {
  id: string;
  location: GeoPoint;
  radiusM: number;
  exitBufferM: number;
}

export interface EngineVehicle {
  id: string;
  /** Provider's reference (VIN). */
  ref: string;
}

/** One vehicle's live row (vehicle_state_current), in FleetOS units: ratios, metres, m/s, °C, bar. */
export interface VehicleLive {
  vehicleId: string;
  status: VehicleStatus | null;
  statusSince: Date | null;
  candidateStatus: VehicleStatus | null;
  candidateSince: Date | null;
  soc: number | null;
  rangeM: number | null;
  chargeState: string | null;
  chargePowerKw: number | null;
  chargeLimitSoc: number | null;
  location: GeoPoint | null;
  heading: number | null;
  speedMps: number | null;
  gear: string | null;
  odometerM: number | null;
  locked: boolean | null;
  tpms: { fl: number | null; fr: number | null; rl: number | null; rr: number | null } | null;
  insideTempC: number | null;
  outsideTempC: number | null;
  connectivity: "online" | "asleep" | "offline";
  currentHubId: string | null;
  lastTelemetryAt: Date | null;
  activeAlerts: string[];
  serviceMode: boolean;
  /** Exception rules whose condition holds but hasn't lasted `for_min` yet: rule key → since (ISO). */
  rulePending: Record<string, string>;
}

export interface StatusEventOut {
  vehicleId: string;
  from: VehicleStatus | null;
  to: VehicleStatus;
  at: Date;
  causeType: "telemetry" | "exception";
  detail: string;
}

export interface SampleOut {
  vehicleId: string;
  field: TelemetryField;
  ts: Date;
  valueNum: number | null;
  valueText: string | null;
  valueGeo: GeoPoint | null;
}

export interface AlertOut {
  vehicleId: string;
  name: string;
  audiences: string[];
  startedAt: Date;
  endedAt: Date | null;
}

export interface EngineConfig {
  hubs: EngineHub[];
  socMin: number;
  chargeTarget: number;
  telemetryMode: "streaming" | "polling";
  /** Fields stored as raw samples, and the minimum spacing between stored samples. */
  sampleFields: readonly TelemetryField[];
  sampleIntervalS: number;
  /** How often within a window statuses are re-evaluated (ms). */
  evaluateEveryMs: number;
}

export interface TickResult {
  live: VehicleLive[];
  statusEvents: StatusEventOut[];
  samples: SampleOut[];
  alerts: AlertOut[];
  exceptions: { opened: ExceptionOpened[]; cleared: ExceptionCleared[]; known: KnownException[] };
  counts: { events: number; statusChanges: number; samples: number; alerts: number; exceptionsOpened: number };
}
