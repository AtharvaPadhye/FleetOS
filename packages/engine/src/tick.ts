import { deriveStatus, shouldCommit, type StatusInputs } from "@fleetos/domain";
import type { Connectivity, GeoPoint, ProviderEvent, TelemetryEvent } from "@fleetos/providers";
import {
  blockingFor,
  evaluateRules,
  type ExceptionCleared,
  type ExceptionOpened,
  type ExceptionState,
} from "./exceptions";
import { hubPresence } from "./geo";
import type {
  AlertOut,
  EngineConfig,
  EngineVehicle,
  SampleOut,
  StatusEventOut,
  TickResult,
  VehicleLive,
} from "./types";

const MI_TO_M = 1609.344;
const MPH_TO_MPS = 0.44704;

export const emptyLive = (vehicleId: string): VehicleLive => ({
  vehicleId,
  status: null,
  statusSince: null,
  candidateStatus: null,
  candidateSince: null,
  soc: null,
  rangeM: null,
  chargeState: null,
  chargePowerKw: null,
  chargeLimitSoc: null,
  location: null,
  heading: null,
  speedMps: null,
  gear: null,
  odometerM: null,
  locked: null,
  tpms: null,
  insideTempC: null,
  outsideTempC: null,
  connectivity: "offline",
  currentHubId: null,
  lastTelemetryAt: null,
  activeAlerts: [],
  serviceMode: false,
  rulePending: {},
});

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const isPoint = (v: unknown): v is GeoPoint => typeof v === "object" && v !== null && "lat" in v && "lng" in v;

/** Apply one Tesla-shaped telemetry event to a live row, converting to FleetOS units. */
export function applyTelemetry(live: VehicleLive, e: TelemetryEvent): void {
  const v = e.value;
  switch (e.field) {
    case "Soc": {
      const n = num(v);
      if (n !== null) live.soc = Math.min(1, Math.max(0, n / 100));
      break;
    }
    case "EstBatteryRange":
      live.rangeM = num(v) === null ? null : (v as number) * MI_TO_M;
      break;
    case "ChargeState":
      live.chargeState = typeof v === "string" ? v.toLowerCase() : null;
      break;
    case "DCChargingPower":
    case "ACChargingPower":
      live.chargePowerKw = num(v);
      break;
    case "ChargeLimitSoc":
      live.chargeLimitSoc = num(v) === null ? null : (v as number) / 100;
      break;
    case "Location":
      if (isPoint(v)) live.location = { lat: v.lat, lng: v.lng };
      break;
    case "GpsHeading":
      live.heading = num(v);
      break;
    case "VehicleSpeed":
      live.speedMps = num(v) === null ? null : (v as number) * MPH_TO_MPS;
      break;
    case "Gear":
      live.gear = typeof v === "string" ? v : null;
      break;
    case "Odometer":
      live.odometerM = num(v) === null ? null : (v as number) * MI_TO_M;
      break;
    case "Locked":
      live.locked = typeof v === "boolean" ? v : null;
      break;
    case "InsideTemp":
      live.insideTempC = num(v);
      break;
    case "OutsideTemp":
      live.outsideTempC = num(v);
      break;
    case "ServiceMode":
      live.serviceMode = v === true;
      break;
    case "TpmsPressureFl":
    case "TpmsPressureFr":
    case "TpmsPressureRl":
    case "TpmsPressureRr": {
      const key = e.field.slice(-2).toLowerCase() as "fl" | "fr" | "rl" | "rr";
      live.tpms = { fl: null, fr: null, rl: null, rr: null, ...live.tpms, [key]: num(v) };
      break;
    }
    default:
      break;
  }
  live.lastTelemetryAt = e.eventTime;
  live.connectivity = "online";
}

function statusInputs(
  cfg: EngineConfig,
  live: VehicleLive,
  now: Date,
  blocking: ReadonlySet<"incident" | "maintenance" | "cleaning">,
): StatusInputs {
  const charging = live.chargeState === "charging" || live.chargeState === "starting";
  return {
    now,
    // Streams only send fields that change, so a parked car can be silent yet connected. A live connection
    // proves the car is reachable; Offline means disconnected AND silent past the threshold.
    lastTelemetryAt: live.connectivity === "online" ? now : live.lastTelemetryAt,
    telemetryMode: cfg.telemetryMode,
    connectivity: live.connectivity,
    insideHub: live.currentHubId !== null,
    soc: live.soc,
    socMin: cfg.socMin,
    chargeTarget: live.chargeLimitSoc ?? cfg.chargeTarget,
    chargeState: charging
      ? "charging"
      : live.chargeState === "stopped"
        ? "stopped"
        : live.chargeState === "complete"
          ? "complete"
          : "disconnected",
    pluggedIn: charging || live.chargeState === "stopped" || live.chargeState === "complete",
    // No charge tasks until exceptions/tickets exist (task 5.4); cars driving to charge count as in service.
    chargeTaskToHub: false,
    blockingIncident: blocking.has("incident"),
    blockingMaintenance: blocking.has("maintenance"),
    manualHold: false,
    teslaServiceMode: live.serviceMode,
    blockingCleaning: blocking.has("cleaning"),
    platformOnTrip: null,
  };
}

/**
 * Process one window of provider events (e.g. one minute) for one org.
 * Pure: the caller loads `previous` from vehicle_state_current and writes the result back.
 * Statuses are re-evaluated at every event time and every `evaluateEveryMs`, with the domain debounce;
 * debounced changes are timestamped when their condition started holding.
 */
export function runTick(
  cfg: EngineConfig,
  vehicles: readonly EngineVehicle[],
  previous: ReadonlyMap<string, VehicleLive>,
  events: readonly ProviderEvent[],
  window: { from: Date; to: Date },
  roster?: ReadonlyMap<string, Connectivity>,
  exceptions: ExceptionState = { rules: [], known: [] },
): TickResult {
  const ex: ExceptionState = { rules: exceptions.rules, known: exceptions.known.map((k) => ({ ...k })) };
  const opened: ExceptionOpened[] = [];
  const cleared: ExceptionCleared[] = [];
  const byRef = new Map(vehicles.map((v) => [v.ref, v]));
  const live = new Map<string, VehicleLive>();
  for (const v of vehicles) live.set(v.id, structuredClone(previous.get(v.id) ?? emptyLive(v.id)));

  // Flatten to timed actions.
  type Action = { at: number; apply: () => void };
  const actions: Action[] = [];
  const samples: SampleOut[] = [];
  const alerts: AlertOut[] = [];
  const sampled = new Set<string>();
  const sampleFields = new Set(cfg.sampleFields);
  const bucketMs = cfg.sampleIntervalS * 1000;
  let eventCount = 0;

  for (const e of events) {
    if (e.kind === "telemetry") {
      for (const t of e.events) {
        const veh = byRef.get(t.vehicleRef);
        if (!veh) continue;
        eventCount++;
        actions.push({ at: t.eventTime.getTime(), apply: () => applyTelemetry(live.get(veh.id)!, t) });
        if (sampleFields.has(t.field)) {
          const key = `${veh.id}|${t.field}|${Math.floor(t.eventTime.getTime() / bucketMs)}`;
          if (!sampled.has(key)) {
            sampled.add(key);
            samples.push({
              vehicleId: veh.id,
              field: t.field,
              ts: t.eventTime,
              valueNum: typeof t.value === "number" ? t.value : typeof t.value === "boolean" ? Number(t.value) : null,
              valueText: typeof t.value === "string" ? t.value : null,
              valueGeo: isPoint(t.value) ? t.value : null,
            });
          }
        }
      }
    } else if (e.kind === "connectivity") {
      const veh = byRef.get(e.vehicleRef);
      if (!veh) continue;
      eventCount++;
      actions.push({
        at: e.at.getTime(),
        apply: () => {
          const l = live.get(veh.id)!;
          l.connectivity = e.status === "connected" ? "online" : "offline";
        },
      });
    } else if (e.kind === "alert") {
      const veh = byRef.get(e.vehicleRef);
      if (!veh) continue;
      eventCount++;
      alerts.push({
        vehicleId: veh.id,
        name: e.name,
        audiences: e.audiences,
        startedAt: e.startedAt,
        endedAt: e.endedAt,
      });
      const at = (e.endedAt ?? e.startedAt).getTime();
      actions.push({
        at,
        apply: () => {
          const l = live.get(veh.id)!;
          const set = new Set(l.activeAlerts);
          if (e.endedAt) set.delete(e.name);
          else set.add(e.name);
          l.activeAlerts = [...set].sort();
        },
      });
    }
  }

  const grid: number[] = [];
  for (let t = window.from.getTime() + cfg.evaluateEveryMs; t <= window.to.getTime(); t += cfg.evaluateEveryMs)
    grid.push(t);
  const times = [...new Set([...actions.map((a) => a.at), ...grid, window.to.getTime()])].sort((a, b) => a - b);
  actions.sort((a, b) => a.at - b.at);

  const statusEvents: StatusEventOut[] = [];
  let ai = 0;
  for (const t of times) {
    while (ai < actions.length && (actions[ai] as Action).at <= t) (actions[ai++] as Action).apply();
    if (t === window.to.getTime() && roster) {
      // The roster knows asleep vs offline; the stream only says "disconnected".
      for (const v of vehicles) {
        const c = roster.get(v.ref);
        const l = live.get(v.id)!;
        if (c && c !== "online") l.connectivity = c;
      }
    }
    const now = new Date(t);
    for (const v of vehicles) {
      const l = live.get(v.id)!;
      l.currentHubId = hubPresence(l.location, l.currentHubId, cfg.hubs);
      const r = evaluateRules(ex, l, now);
      opened.push(...r.opened);
      cleared.push(...r.cleared);
      const d = deriveStatus(statusInputs(cfg, l, now, blockingFor(ex, v.id)));
      if (l.candidateStatus !== d.status) {
        l.candidateStatus = d.status;
        l.candidateSince = now;
      }
      if (shouldCommit(l.status, d, l.candidateSince ?? now, now)) {
        const at = l.status === null || d.immediate ? now : (l.candidateSince ?? now);
        statusEvents.push({
          vehicleId: v.id,
          from: l.status,
          to: d.status,
          at,
          causeType: d.immediate ? "exception" : "telemetry",
          detail: d.reason,
        });
        l.status = d.status;
        l.statusSince = at;
      }
    }
  }

  return {
    live: [...live.values()],
    statusEvents,
    samples,
    alerts,
    exceptions: { opened, cleared, known: ex.known },
    counts: {
      events: eventCount,
      statusChanges: statusEvents.length,
      samples: samples.length,
      alerts: alerts.length,
      exceptionsOpened: opened.length,
    },
  };
}
