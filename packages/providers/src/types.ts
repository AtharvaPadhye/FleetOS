/**
 * The contract every vehicle data source implements (ADR-0005, docs/architecture/api.md §5).
 * Field names follow Tesla Fleet Telemetry so the simulator and the Tesla provider are interchangeable.
 */

/** Telemetry fields FleetOS subscribes to (docs/requirements/data-sources.md §3). */
export const TELEMETRY_FIELDS = [
  "Soc",
  "BatteryLevel",
  "EstBatteryRange",
  "ChargeState",
  "DetailedChargeState",
  "ACChargingPower",
  "DCChargingPower",
  "ChargeLimitSoc",
  "TimeToFullCharge",
  "FastChargerPresent",
  "Location",
  "GpsHeading",
  "VehicleSpeed",
  "Gear",
  "Odometer",
  "DestinationLocation",
  "MinutesToArrival",
  "TpmsPressureFl",
  "TpmsPressureFr",
  "TpmsPressureRl",
  "TpmsPressureRr",
  "TpmsSoftWarnings",
  "TpmsHardWarnings",
  "Locked",
  "DoorState",
  "InsideTemp",
  "OutsideTemp",
  "CabinOverheatProtectionMode",
  "ServiceMode",
  "BMSState",
  "IsolationResistance",
  "SelfDrivingMilesSinceReset",
  "MilesSinceReset",
  "Version",
  "SoftwareUpdateAvailable",
  "SoftwareUpdateInProgress",
] as const;
export type TelemetryField = (typeof TELEMETRY_FIELDS)[number];

export interface GeoPoint {
  lat: number;
  lng: number;
}

export type TelemetryValue = number | string | boolean | GeoPoint | null;

/** Normalised, Tesla-shaped telemetry event: one per field change. */
export interface TelemetryEvent {
  /** Provider's id for the vehicle (the VIN for Tesla). */
  vehicleRef: string;
  field: TelemetryField;
  value: TelemetryValue;
  /** Vehicle time, not ingest time (vehicle-states.md §6). */
  eventTime: Date;
  source: "tesla_stream" | "tesla_rest" | "simulator";
}

export type ProviderEvent =
  | { kind: "telemetry"; events: TelemetryEvent[] }
  | { kind: "alert"; vehicleRef: string; name: string; audiences: string[]; startedAt: Date; endedAt: Date | null }
  | { kind: "connectivity"; vehicleRef: string; status: "connected" | "disconnected"; at: Date }
  | { kind: "error"; vehicleRef: string; name: string; tags: Record<string, string>; at: Date };

export type Connectivity = "online" | "asleep" | "offline";

export interface VehicleSummary {
  vehicleRef: string;
  vin: string;
  displayName: string | null;
  model: string | null;
  connectivity: Connectivity;
  firmware: string | null;
  virtualKeyPaired: boolean | null;
  telemetrySynced: boolean | null;
}

/** Full current state, used only for backfill. */
export interface VehicleSnapshot {
  vehicleRef: string;
  takenAt: Date;
  fields: Partial<Record<TelemetryField, TelemetryValue>>;
}

export type CommandName =
  | "charge_start"
  | "charge_stop"
  | "set_charge_limit"
  | "navigate_to"
  | "door_lock"
  | "door_unlock"
  | "flash_lights"
  | "honk_horn";

export interface CommandResult {
  ok: boolean;
  error?: string;
  /** Tesla bills commands even when the car rejects them. */
  billed: boolean;
  raw?: unknown;
}

export interface ProviderCapabilities {
  streaming: boolean;
  commands: boolean;
  batteryHealth: boolean;
  chargingHistory: boolean;
}

export interface ChargingSessionRecord {
  vehicleRef: string;
  startedAt: Date;
  endedAt: Date | null;
  energyKwh: number;
  costCents: number | null;
  location: GeoPoint | null;
  source: "tesla_supercharger" | "depot_inferred" | "simulator";
}

export interface VehicleProvider {
  readonly kind: "simulator" | "tesla";
  capabilities(): ProviderCapabilities;
  listVehicles(): Promise<VehicleSummary[]>;
  /** Backfill only. MUST NOT wake the vehicle; returns null if asleep or unreachable (ADR-0007). */
  getSnapshot(vehicleRef: string): Promise<VehicleSnapshot | null>;
  /** Push-based stream of normalised events; stops when `signal` aborts. */
  subscribe(onEvent: (e: ProviderEvent) => void, signal: AbortSignal): Promise<void>;
  /** Phase 7. Throws CommandsDisabledError unless enabled. Never auto-retries non-idempotent commands. */
  sendCommand(vehicleRef: string, command: CommandName, params?: Record<string, unknown>): Promise<CommandResult>;
  getBatteryHealth?(vehicleRef: string): Promise<{ sohPct: number; capacityKwh: number } | null>;
  getChargingHistory?(from: Date, to: Date): Promise<ChargingSessionRecord[]>;
}
