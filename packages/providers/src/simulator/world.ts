import { withCheckDigit } from "@fleetos/domain";
import type { GeoPoint } from "../types";
import { bearingDeg, distanceM, moveToward, offset } from "./geo";
import { PHOENIX, type HubKey, type HubSpec } from "./phoenix";
import { Rng } from "./rng";

/**
 * The simulated physical world: 84 Cybercabs around three Phoenix hubs.
 *
 * It models what cars *do* (drive, carry riders, charge, break down, lose signal) and a minimal
 * "ops autopilot" for how problems get fixed (cleaners, tow trucks, mechanics), so a day has realistic
 * timelines before FleetOS's own ticket engine exists. It knows nothing about FleetOS statuses or KPIs;
 * FleetOS derives those from the events it emits, exactly as it will from real Teslas.
 */

export type Mode =
  | "parked" // at hub, not plugged in
  | "idle" // in the service area waiting for a ride
  | "to_pickup"
  | "on_trip"
  | "to_hub"
  | "charging"
  | "cleaning"
  | "maintenance"
  | "stranded" // broken down or flat tyre, waiting for help
  | "towing";

export type Problem = "cleaning" | "fault" | "breakdown" | "tyre";

export interface SimVehicle {
  ref: string;
  vin: string;
  number: string;
  hub: HubKey;
  pos: GeoPoint;
  heading: number;
  speedMps: number;
  soc: number;
  odometerM: number;
  selfDrivingM: number;
  mode: Mode;
  modeSince: number;
  target: GeoPoint | null;
  /** Why the car is heading to the hub. */
  hubReason: "charge" | "rest" | Problem | null;
  trip: Trip | null;
  connectivity: "online" | "asleep" | "offline";
  parkedSince: number | null;
  signalLostUntil: number | null;
  tyres: [number, number, number, number];
  leakingTyre: number | null;
  problem: { kind: Problem; startedAt: number; readyAt: number | null; alert: string } | null;
  chargeSessionStart: { at: number; soc: number } | null;
  firmware: string;
  sohPct: number;
}

export interface Trip {
  id: string;
  requestedAt: number;
  pickup: GeoPoint;
  dropoff: GeoPoint;
  pickedUpAt: number | null;
  startOdometerM: number;
}

export interface RideRecord {
  id: string;
  vehicleRef: string;
  startedAt: Date;
  endedAt: Date;
  distanceM: number;
  fareCents: number;
  platformFeeCents: number;
  pickup: GeoPoint;
  dropoff: GeoPoint;
}

export interface OpsRecord {
  vehicleRef: string;
  kind: Problem;
  alert: string;
  detectedAt: Date;
  resolvedAt: Date;
  costCents: number;
  location: GeoPoint;
}

export interface ChargeRecord {
  vehicleRef: string;
  hub: HubKey;
  startedAt: Date;
  endedAt: Date;
  energyKwh: number;
  costCents: number;
}

export interface WorldObserver {
  onRide?(r: RideRecord): void;
  onCabinEvent?(e: {
    vehicleRef: string;
    at: Date;
    kind: "spill" | "debris";
    confidence: number;
    rideId: string;
  }): void;
  onOps?(o: OpsRecord): void;
  onCharge?(c: ChargeRecord): void;
  onAlert?(a: { vehicleRef: string; name: string; startedAt: Date; endedAt: Date | null }): void;
}

export interface WorldOptions {
  seed: number;
  /** Simulation start (UTC instant). */
  start: Date;
  vehicles?: number;
  stepSeconds?: number;
}

const HUBS = PHOENIX.hubs as readonly HubSpec[];
const hubOf = (key: HubKey) => HUBS.find((h) => h.key === key) as HubSpec;
const V = PHOENIX.vehicle;

// Tesla-style alert names. SIMULATED: real names come from Fleet Telemetry `alerts` / recent_alerts.
const ALERTS: Record<Problem, string> = {
  cleaning: "SIM_cabin_cleanliness_event",
  fault: "SIM_DI_a175_driveInverterFault",
  breakdown: "SIM_VCSEC_a217_vehicleImmobilized",
  tyre: "SIM_TPMS_w201_tirePressureLow",
};

export class SimulatorWorld {
  readonly rng: Rng;
  readonly vehicles: SimVehicle[] = [];
  readonly stepSeconds: number;
  now: number;
  private observers: WorldObserver[] = [];
  private tripSeq = 0;

  constructor(opts: WorldOptions) {
    this.rng = new Rng(opts.seed);
    this.now = opts.start.getTime();
    this.stepSeconds = opts.stepSeconds ?? 10;
    const total = opts.vehicles ?? HUBS.reduce((s, h) => s + h.assigned, 0);
    let n = 0;
    for (const hub of HUBS) {
      const count = Math.round((hub.assigned / 84) * total);
      for (let i = 0; i < count && n < total; i++) this.vehicles.push(this.newVehicle(++n, hub));
    }
    while (n < total) this.vehicles.push(this.newVehicle(++n, HUBS[0] as HubSpec));
  }

  observe(o: WorldObserver): () => void {
    this.observers.push(o);
    return () => {
      this.observers = this.observers.filter((x) => x !== o);
    };
  }

  private emit<K extends keyof WorldObserver>(k: K, ...args: Parameters<NonNullable<WorldObserver[K]>>) {
    for (const o of this.observers) (o[k] as ((...a: unknown[]) => void) | undefined)?.(...args);
  }

  private newVehicle(n: number, hub: HubSpec): SimVehicle {
    const number = String(n).padStart(3, "0");
    // Cybercab-style VIN with a correct ISO 3779 check digit (the MVP's illustrative VINs lacked one).
    const vin = withCheckDigit(`7G2CEHED0RA004${number}`);
    const pos = offset(hub.location, this.rng.range(0, hub.radiusM * 0.6), this.rng.range(0, 360));
    return {
      ref: vin,
      vin,
      number,
      hub: hub.key,
      pos,
      heading: this.rng.range(0, 360),
      speedMps: 0,
      soc: this.rng.range(0.55, 0.95),
      odometerM: this.rng.range(12_000, 30_000) * 1000,
      selfDrivingM: 0,
      mode: "parked",
      modeSince: this.now,
      target: null,
      hubReason: null,
      trip: null,
      connectivity: "online",
      parkedSince: this.now,
      signalLostUntil: null,
      tyres: [V.tyreBar, V.tyreBar, V.tyreBar, V.tyreBar],
      leakingTyre: null,
      problem: null,
      chargeSessionStart: null,
      firmware: "2026.32.4",
      sohPct: Math.round(this.rng.range(96.5, 99.5) * 10) / 10,
    };
  }

  hub(key: HubKey): HubSpec {
    return hubOf(key);
  }

  /** Local hour in Phoenix (UTC−7, no DST). */
  localHour(t = this.now): number {
    return new Date(t + PHOENIX.utcOffsetHours * 3_600_000).getUTCHours();
  }

  insideHub(v: SimVehicle): HubSpec | null {
    return HUBS.find((h) => distanceM(v.pos, h.location) <= h.radiusM) ?? null;
  }

  chargersInUse(key: HubKey): number {
    return this.vehicles.filter((v) => v.hub === key && v.mode === "charging").length;
  }

  outsideTempC(t = this.now): number {
    // Phoenix late September: ~27 °C before dawn, ~39 °C mid-afternoon.
    const h = this.localHour(t) + new Date(t).getUTCMinutes() / 60;
    return 33 + 6 * Math.sin(((h - 9) / 24) * 2 * Math.PI);
  }

  /** Advance the world by one step. */
  step(): void {
    const dt = this.stepSeconds;
    this.now += dt * 1000;
    for (const v of this.vehicles) this.stepVehicle(v, dt);
  }

  /** Advance until `until` (ms since epoch). */
  advanceTo(until: number, onStep?: () => void): void {
    while (this.now + this.stepSeconds * 1000 <= until) {
      this.step();
      onStep?.();
    }
  }

  private setMode(v: SimVehicle, mode: Mode) {
    v.mode = mode;
    v.modeSince = this.now;
  }

  private stepVehicle(v: SimVehicle, dt: number) {
    const rates = PHOENIX.eventRates;
    const inService = v.mode === "idle" || v.mode === "to_pickup" || v.mode === "on_trip";

    // Connectivity: random signal loss; parked cars fall asleep after 30 min.
    if (v.signalLostUntil !== null && this.now >= v.signalLostUntil) v.signalLostUntil = null;
    if (v.signalLostUntil === null && inService && this.rng.arrival(rates.signalLoss, dt)) {
      v.signalLostUntil = this.now + this.rng.range(20, 90) * 60_000;
    }
    const asleep = v.mode === "parked" && v.parkedSince !== null && this.now - v.parkedSince > 30 * 60_000;
    v.connectivity = v.signalLostUntil !== null ? "offline" : asleep ? "asleep" : "online";

    // Slow tyre leaks.
    if (v.leakingTyre !== null) {
      const i = v.leakingTyre;
      v.tyres[i] = Math.max(1.2, (v.tyres[i] as number) - (0.25 * dt) / 3600);
      if ((v.tyres[i] as number) < 2.0 && inService) this.startProblem(v, "tyre");
    } else if (inService && this.rng.arrival(rates.tyreLeak, dt)) {
      v.leakingTyre = this.rng.int(0, 3);
    }

    if (inService && !v.problem) {
      if (this.rng.arrival(rates.breakdown, dt)) this.startProblem(v, "breakdown");
      else if (this.rng.arrival(rates.fault, dt)) this.startProblem(v, "fault");
    }

    switch (v.mode) {
      case "parked":
        return this.stepParked(v);
      case "idle":
        return this.stepIdle(v, dt);
      case "to_pickup":
      case "on_trip":
      case "to_hub":
      case "towing":
        return this.stepDriving(v, dt);
      case "charging":
        return this.stepCharging(v, dt);
      case "cleaning":
      case "maintenance":
      case "stranded":
        return this.stepWaiting(v);
    }
  }

  private stepParked(v: SimVehicle) {
    const hub = hubOf(v.hub);
    if (v.soc < V.chargeTarget - 0.05 && this.chargersInUse(v.hub) < hub.chargers) {
      this.setMode(v, "charging");
      v.parkedSince = null;
      v.chargeSessionStart = { at: this.now, soc: v.soc };
      return;
    }
    const demand = PHOENIX.demandByHour[this.localHour()] ?? 1;
    // Cars leave the hub to serve demand; more leave at busy hours.
    if (v.soc >= V.socMin && this.rng.chance(0.004 * demand)) {
      this.setMode(v, "idle");
      v.parkedSince = null;
      v.pos = offset(hub.location, this.rng.range(hub.radiusM + 300, 2500), this.rng.range(0, 360));
    }
  }

  private stepIdle(v: SimVehicle, dt: number) {
    if (v.soc < V.goChargeBelow) return this.sendToHub(v, "charge");
    const hour = this.localHour();
    const demand = PHOENIX.demandByHour[hour] ?? 1;
    // Late at night, idle cars drift home to rest and charge.
    if (demand < 0.5 && this.rng.chance(0.002)) return this.sendToHub(v, "rest");
    if (this.rng.arrival(demand, dt)) {
      const pickup = offset(v.pos, this.rng.range(200, 2000), this.rng.range(0, 360));
      const hot = this.rng.weighted(PHOENIX.hotspots.map((h) => ({ value: h.point, weight: h.weight })));
      const dropoff = this.rng.chance(0.6)
        ? offset(hot, this.rng.range(0, 800), this.rng.range(0, 360))
        : this.randomInArea();
      v.trip = {
        id: `SIM-${++this.tripSeq}`,
        requestedAt: this.now,
        pickup,
        dropoff,
        pickedUpAt: null,
        startOdometerM: 0,
      };
      v.target = pickup;
      this.setMode(v, "to_pickup");
    }
  }

  private randomInArea(): GeoPoint {
    const a = PHOENIX.serviceArea;
    return offset(a.center, a.radiusM * Math.sqrt(this.rng.next()), this.rng.range(0, 360));
  }

  private sendToHub(v: SimVehicle, reason: SimVehicle["hubReason"]) {
    v.hubReason = reason;
    v.target = offset(hubOf(v.hub).location, this.rng.range(0, 60), this.rng.range(0, 360));
    if (v.mode !== "towing") this.setMode(v, "to_hub");
  }

  private stepDriving(v: SimVehicle, dt: number) {
    if (!v.target) return;
    const speed = v.mode === "towing" ? 9 : V.speedMps * this.rng.range(0.7, 1.2);
    const { point, arrived } = moveToward(v.pos, v.target, speed * dt);
    const moved = distanceM(v.pos, point);
    if (moved > 1) v.heading = bearingDeg(v.pos, point);
    v.pos = point;
    v.speedMps = arrived ? 0 : speed;
    v.odometerM += moved;
    if (v.mode !== "towing") {
      v.selfDrivingM += moved;
      v.soc = Math.max(0, v.soc - (moved / 1000) * (V.whPerKm / 1000 / V.batteryKwh));
    }
    if (!arrived) return;
    v.speedMps = 0;
    if (v.mode === "to_pickup" && v.trip) {
      v.trip.pickedUpAt = this.now;
      v.trip.startOdometerM = v.odometerM;
      v.target = v.trip.dropoff;
      this.setMode(v, "on_trip");
    } else if (v.mode === "on_trip" && v.trip) {
      this.completeTrip(v);
    } else {
      this.arriveAtHub(v);
    }
  }

  private completeTrip(v: SimVehicle) {
    const t = v.trip as Trip;
    const distance = v.odometerM - t.startOdometerM;
    const minutes = (this.now - (t.pickedUpAt ?? this.now)) / 60_000;
    const f = PHOENIX.fares;
    const fare = Math.round(f.baseCents + (distance / 1000) * f.perKmCents + minutes * f.perMinCents);
    // SUBSTITUTE(rides, simulated): simulated trips and fares stand in for a robotaxi platform's trip feed.
    //   Real source: none available as of 2026-09-26 (Tesla exposes no ride API); CSV payout imports meanwhile.
    //   Replace by: a real rides/earnings provider, or CSV imports (task 3.6), feeding the same ledger.
    //   Docs: docs/requirements/data-sources.md §5
    this.emit("onRide", {
      id: t.id,
      vehicleRef: v.ref,
      startedAt: new Date(t.pickedUpAt ?? this.now),
      endedAt: new Date(this.now),
      distanceM: distance,
      fareCents: fare,
      platformFeeCents: Math.round(fare * f.platformFeeRate),
      pickup: t.pickup,
      dropoff: t.dropoff,
    });
    v.trip = null;
    v.target = null;
    if (this.rng.chance(PHOENIX.cabinEventPerRide)) {
      // SUBSTITUTE(cabin_events, simulated): simulated interior-camera cleanliness events.
      //   Real source: none available; Tesla uses the cabin camera internally and doesn't expose it.
      //   Replace by: a real cabin-event feed if one appears; meanwhile manual reports and vendor photos.
      //   Docs: docs/requirements/data-sources.md §5
      this.emit("onCabinEvent", {
        vehicleRef: v.ref,
        at: new Date(this.now),
        kind: this.rng.chance(0.5) ? "spill" : "debris",
        confidence: Math.round(this.rng.range(0.88, 0.99) * 100) / 100,
        rideId: t.id,
      });
      this.startProblem(v, "cleaning");
      return;
    }
    this.setMode(v, "idle");
  }

  private arriveAtHub(v: SimVehicle) {
    v.target = null;
    const reason = v.hubReason;
    v.hubReason = null;
    if (reason === "cleaning" || reason === "fault" || reason === "breakdown") {
      // Ops autopilot: the problem gets fixed at the hub after a realistic delay.
      const minutes =
        reason === "cleaning"
          ? this.rng.range(25, 60)
          : reason === "fault"
            ? this.rng.range(90, 240)
            : this.rng.range(60, 180);
      if (v.problem) v.problem.readyAt = this.now + minutes * 60_000;
      this.setMode(v, reason === "cleaning" ? "cleaning" : "maintenance");
      return;
    }
    this.setMode(v, "parked");
    v.parkedSince = this.now;
  }

  private stepCharging(v: SimVehicle, dt: number) {
    const hub = hubOf(v.hub);
    const kw = hub.chargerKw * (v.soc > 0.8 ? 0.4 : 1); // taper above 80%
    v.soc = Math.min(1, v.soc + (kw * dt) / 3600 / V.batteryKwh);
    if (v.soc >= V.chargeTarget) {
      const start = v.chargeSessionStart ?? { at: v.modeSince, soc: v.soc };
      const energy = Math.max(0, (v.soc - start.soc) * V.batteryKwh);
      this.emit("onCharge", {
        vehicleRef: v.ref,
        hub: v.hub,
        startedAt: new Date(start.at),
        endedAt: new Date(this.now),
        energyKwh: Math.round(energy * 100) / 100,
        costCents: Math.round(energy * hub.centsPerKwh),
      });
      v.chargeSessionStart = null;
      this.setMode(v, "parked");
      v.parkedSince = this.now;
    }
  }

  private startProblem(v: SimVehicle, kind: Problem) {
    if (v.problem) return;
    const alert = ALERTS[kind];
    v.problem = { kind, startedAt: this.now, readyAt: null, alert };
    this.emit("onAlert", { vehicleRef: v.ref, name: alert, startedAt: new Date(this.now), endedAt: null });
    v.trip = null;
    if (kind === "breakdown" || kind === "tyre") {
      // Waits where it stopped: a tow truck (then a repair at the hub), or roadside tyre service.
      v.target = null;
      v.speedMps = 0;
      v.problem.readyAt = this.now + (kind === "tyre" ? this.rng.range(45, 90) : this.rng.range(20, 45)) * 60_000;
      this.setMode(v, "stranded");
    } else {
      this.sendToHub(v, kind);
    }
  }

  private stepWaiting(v: SimVehicle) {
    const p = v.problem;
    if (!p || p.readyAt === null || this.now < p.readyAt) return;
    if (v.mode === "stranded" && p.kind === "breakdown") {
      // Tow truck arrived: tow to the home hub for repair.
      p.readyAt = null;
      this.setMode(v, "towing");
      this.sendToHub(v, "breakdown");
      return;
    }
    const costs = PHOENIX.costs;
    const cost =
      p.kind === "cleaning"
        ? costs.cleaningCents
        : p.kind === "tyre"
          ? costs.tyreCents
          : p.kind === "fault"
            ? costs.diagnosticsCents + costs.repairCents
            : costs.towCents + costs.repairCents;
    // SUBSTITUTE(vendor_tracking, simulated): the ops autopilot plays the vendors (cleaners, tow, mechanics).
    //   Real source: FleetOS tickets + vendor dispatch (task 5.5), Agero-style integrations or Airtable forms later.
    //   Replace by: engine-created tickets whose completion releases the vehicle (task 3.5/5.5).
    //   Docs: docs/requirements/data-sources.md §5, ADR-0015
    this.emit("onOps", {
      vehicleRef: v.ref,
      kind: p.kind,
      alert: p.alert,
      detectedAt: new Date(p.startedAt),
      resolvedAt: new Date(this.now),
      costCents: cost,
      location: { ...v.pos },
    });
    this.emit("onAlert", {
      vehicleRef: v.ref,
      name: p.alert,
      startedAt: new Date(p.startedAt),
      endedAt: new Date(this.now),
    });
    if (p.kind === "tyre" && v.leakingTyre !== null) {
      v.tyres[v.leakingTyre] = V.tyreBar;
      v.leakingTyre = null;
    }
    v.problem = null;
    if (v.mode === "stranded") this.setMode(v, "idle");
    else {
      this.setMode(v, "parked");
      v.parkedSince = this.now;
    }
  }
}
