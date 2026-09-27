import { CommandsDisabledError, UnknownVehicleError } from "../errors";
import type {
  ChargingSessionRecord,
  CommandName,
  CommandResult,
  GeoPoint,
  ProviderCapabilities,
  ProviderEvent,
  TelemetryEvent,
  TelemetryField,
  TelemetryValue,
  VehicleProvider,
  VehicleSnapshot,
  VehicleSummary,
} from "../types";
import { distanceM } from "./geo";
import { PHOENIX } from "./phoenix";
import { SimulatorWorld, type SimVehicle, type WorldOptions } from "./world";

const KM_PER_MILE = 1.609344;
const MPS_TO_MPH = 2.236936;

/**
 * Per-field streaming rules, mirroring the Fleet Telemetry config FleetOS will send to real cars
 * (docs/requirements/data-sources.md §3): send a field when `intervalS` has passed AND it changed by at least
 * `delta` (numbers), `deltaM` (locations) or at all (strings/booleans).
 */
const STREAM: Partial<Record<TelemetryField, { intervalS: number; delta?: number; deltaM?: number }>> = {
  Soc: { intervalS: 60, delta: 1 },
  BatteryLevel: { intervalS: 60, delta: 1 },
  EstBatteryRange: { intervalS: 60, delta: 2 },
  ChargeState: { intervalS: 0 },
  DetailedChargeState: { intervalS: 0 },
  DCChargingPower: { intervalS: 30, delta: 2 },
  ChargeLimitSoc: { intervalS: 0 },
  Location: { intervalS: 10, deltaM: 50 },
  GpsHeading: { intervalS: 10, delta: 10 },
  VehicleSpeed: { intervalS: 10, delta: 2 },
  Gear: { intervalS: 0 },
  Odometer: { intervalS: 300, delta: 0.1 },
  DestinationLocation: { intervalS: 60, deltaM: 50 },
  TpmsPressureFl: { intervalS: 300, delta: 0.05 },
  TpmsPressureFr: { intervalS: 300, delta: 0.05 },
  TpmsPressureRl: { intervalS: 300, delta: 0.05 },
  TpmsPressureRr: { intervalS: 300, delta: 0.05 },
  TpmsSoftWarnings: { intervalS: 0 },
  Locked: { intervalS: 0 },
  InsideTemp: { intervalS: 600, delta: 0.5 },
  OutsideTemp: { intervalS: 600, delta: 0.5 },
  ServiceMode: { intervalS: 0 },
  SelfDrivingMilesSinceReset: { intervalS: 3600, delta: 0.1 },
  Version: { intervalS: 0 },
};

export interface SimulatorProviderOptions extends WorldOptions {
  commandsEnabled?: boolean;
}

// SUBSTITUTE(tesla, simulated): a simulated Phoenix fleet stands in for the Tesla Fleet API and Fleet Telemetry.
//   Real source: Tesla Fleet API (roster, snapshots) + self-hosted Fleet Telemetry stream (ADR-0007).
//   Replace by: TeslaProvider implementing VehicleProvider (Phase 4) and passing src/contract.ts.
//   Docs: docs/requirements/data-sources.md §2, ADR-0005
export class SimulatorProvider implements VehicleProvider {
  readonly kind = "simulator" as const;
  readonly world: SimulatorWorld;
  private listeners = new Set<(e: ProviderEvent) => void>();
  private lastSent = new Map<string, { value: TelemetryValue; at: number }>();
  private lastConnectivity = new Map<string, "connected" | "disconnected">();
  private charging: ChargingSessionRecord[] = [];

  constructor(private readonly opts: SimulatorProviderOptions) {
    this.world = new SimulatorWorld(opts);
    this.world.observe({
      onAlert: (a) =>
        this.publish({
          kind: "alert",
          vehicleRef: a.vehicleRef,
          name: a.name,
          audiences: ["Service"],
          startedAt: a.startedAt,
          endedAt: a.endedAt,
        }),
      onCharge: (c) =>
        this.charging.push({
          vehicleRef: c.vehicleRef,
          startedAt: c.startedAt,
          endedAt: c.endedAt,
          energyKwh: c.energyKwh,
          costCents: c.costCents,
          location: this.world.hub(c.hub).location,
          source: "simulator",
        }),
    });
  }

  capabilities(): ProviderCapabilities {
    return {
      streaming: true,
      commands: this.opts.commandsEnabled ?? false,
      batteryHealth: true,
      chargingHistory: true,
    };
  }

  now(): Date {
    return new Date(this.world.now);
  }

  async listVehicles(): Promise<VehicleSummary[]> {
    return this.world.vehicles.map((v) => ({
      vehicleRef: v.ref,
      vin: v.vin,
      displayName: `Cybercab ${v.number}`,
      model: "Cybercab",
      connectivity: v.connectivity,
      firmware: v.firmware,
      virtualKeyPaired: true,
      telemetrySynced: true,
    }));
  }

  private vehicle(ref: string): SimVehicle {
    const v = this.world.vehicles.find((x) => x.ref === ref);
    if (!v) throw new UnknownVehicleError(ref);
    return v;
  }

  async getSnapshot(vehicleRef: string): Promise<VehicleSnapshot | null> {
    const v = this.vehicle(vehicleRef);
    if (v.connectivity !== "online") return null; // never wake an asleep car, can't reach an offline one
    return { vehicleRef, takenAt: this.now(), fields: this.fieldsOf(v) };
  }

  async subscribe(onEvent: (e: ProviderEvent) => void, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;
    this.listeners.add(onEvent);
    signal.addEventListener("abort", () => this.listeners.delete(onEvent), { once: true });
  }

  async sendCommand(vehicleRef: string, command: CommandName): Promise<CommandResult> {
    this.vehicle(vehicleRef);
    if (!this.opts.commandsEnabled) throw new CommandsDisabledError();
    return { ok: true, billed: false, raw: { simulated: command } };
  }

  async getBatteryHealth(vehicleRef: string) {
    const v = this.vehicle(vehicleRef);
    return { sohPct: v.sohPct, capacityKwh: Math.round(PHOENIX.vehicle.batteryKwh * v.sohPct) / 100 };
  }

  async getChargingHistory(from: Date, to: Date): Promise<ChargingSessionRecord[]> {
    return this.charging.filter((c) => c.startedAt >= from && c.startedAt < to);
  }

  /** Advance simulated time, streaming events to subscribers after every step. */
  async advance(ms: number): Promise<void> {
    this.world.advanceTo(this.world.now + ms, () => this.emitStep());
  }

  private publish(e: ProviderEvent) {
    for (const l of this.listeners) l(e);
  }

  /** Current value of every streamed field, in Tesla's units (%, miles, mph, bar, °C). */
  private fieldsOf(v: SimVehicle): Partial<Record<TelemetryField, TelemetryValue>> {
    const charging = v.mode === "charging";
    const hub = this.world.hub(v.hub);
    const socPct = Math.round(v.soc * 1000) / 10;
    const rangeMi = (v.soc * PHOENIX.vehicle.batteryKwh * 1000) / PHOENIX.vehicle.whPerKm / KM_PER_MILE;
    const parked = v.speedMps === 0;
    return {
      Soc: socPct,
      BatteryLevel: socPct,
      EstBatteryRange: Math.round(rangeMi * 10) / 10,
      ChargeState: charging ? "Charging" : "Disconnected",
      DetailedChargeState: charging ? "DetailedChargeStateCharging" : "DetailedChargeStateDisconnected",
      DCChargingPower: charging ? Math.round(hub.chargerKw * (v.soc > 0.8 ? 0.4 : 1) * 10) / 10 : 0,
      ChargeLimitSoc: PHOENIX.vehicle.chargeTarget * 100,
      Location: { lat: round6(v.pos.lat), lng: round6(v.pos.lng) },
      GpsHeading: Math.round(v.heading),
      VehicleSpeed: Math.round(v.speedMps * MPS_TO_MPH * 10) / 10,
      Gear: parked ? "P" : "D",
      Odometer: Math.round((v.odometerM / 1000 / KM_PER_MILE) * 10) / 10,
      DestinationLocation: v.target ? { lat: round6(v.target.lat), lng: round6(v.target.lng) } : null,
      TpmsPressureFl: round2(v.tyres[0]),
      TpmsPressureFr: round2(v.tyres[1]),
      TpmsPressureRl: round2(v.tyres[2]),
      TpmsPressureRr: round2(v.tyres[3]),
      TpmsSoftWarnings: v.tyres.some((p) => p < 2.3),
      Locked: v.mode !== "on_trip",
      InsideTemp: Math.round((v.connectivity === "online" ? 22 : this.world.outsideTempC() + 8) * 10) / 10,
      OutsideTemp: Math.round(this.world.outsideTempC() * 10) / 10,
      ServiceMode: v.mode === "maintenance",
      SelfDrivingMilesSinceReset: Math.round((v.selfDrivingM / 1000 / KM_PER_MILE) * 10) / 10,
      Version: v.firmware,
    };
  }

  private emitStep() {
    if (this.listeners.size === 0) return;
    const now = this.world.now;
    const eventTime = new Date(now);
    for (const v of this.world.vehicles) {
      const status = v.connectivity === "online" ? "connected" : "disconnected";
      if (this.lastConnectivity.get(v.ref) !== status) {
        this.lastConnectivity.set(v.ref, status);
        this.publish({ kind: "connectivity", vehicleRef: v.ref, status, at: eventTime });
      }
      if (status !== "connected") continue; // asleep or out of signal: nothing streams
      const events: TelemetryEvent[] = [];
      for (const [field, value] of Object.entries(this.fieldsOf(v)) as [TelemetryField, TelemetryValue][]) {
        const rule = STREAM[field];
        if (!rule) continue;
        const key = `${v.ref}|${field}`;
        const prev = this.lastSent.get(key);
        if (prev && (now - prev.at) / 1000 < rule.intervalS) continue;
        if (prev && !changedEnough(prev.value, value, rule)) continue;
        this.lastSent.set(key, { value, at: now });
        events.push({ vehicleRef: v.ref, field, value, eventTime, source: "simulator" });
      }
      if (events.length) this.publish({ kind: "telemetry", events });
    }
  }
}

function changedEnough(prev: TelemetryValue, next: TelemetryValue, rule: { delta?: number; deltaM?: number }): boolean {
  if (typeof prev === "number" && typeof next === "number")
    return Math.abs(next - prev) >= (rule.delta ?? Number.EPSILON);
  if (isPoint(prev) && isPoint(next)) return distanceM(prev, next) >= (rule.deltaM ?? 1);
  return JSON.stringify(prev) !== JSON.stringify(next);
}

const isPoint = (x: TelemetryValue): x is GeoPoint => typeof x === "object" && x !== null && "lat" in x;
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const round2 = (n: number) => Math.round(n * 100) / 100;
