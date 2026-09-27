import { addHours, availability, emptyHours, hourTotals, statusHours, type StatusChange } from "@fleetos/domain";
import {
  PHOENIX,
  SimulatorProvider,
  phoenixMidnight,
  summarizeDay,
  type ProviderEvent,
  type TelemetryEvent,
} from "@fleetos/providers";
import { classifyAlert } from "./alert-rules";
import { defaultConfig } from "./config";
import { hubPresence } from "./geo";
import { applyTelemetry, emptyLive, runTick } from "./tick";
import type { EngineHub, EngineVehicle, VehicleLive } from "./types";

const HUBS: EngineHub[] = PHOENIX.hubs.map((h) => ({
  id: h.key,
  location: h.location,
  radiusM: h.radiusM,
  exitBufferM: 50,
}));
const cfg = defaultConfig(HUBS);
const t = (iso: string) => new Date(iso);
const tel = (field: TelemetryEvent["field"], value: TelemetryEvent["value"], at: string): TelemetryEvent => ({
  vehicleRef: "VIN1",
  field,
  value,
  eventTime: t(at),
  source: "simulator",
});
const V: EngineVehicle[] = [{ id: "v1", ref: "VIN1" }];

describe("applyTelemetry converts Tesla units to FleetOS units", () => {
  it("percent → ratio, miles → metres, mph → m/s, charge state lower-cased", () => {
    const l = emptyLive("v1");
    applyTelemetry(l, tel("Soc", 72, "2026-09-26T16:00:00Z"));
    applyTelemetry(l, tel("Odometer", 10, "2026-09-26T16:00:01Z"));
    applyTelemetry(l, tel("VehicleSpeed", 25, "2026-09-26T16:00:02Z"));
    applyTelemetry(l, tel("ChargeState", "Charging", "2026-09-26T16:00:03Z"));
    applyTelemetry(l, tel("ChargeLimitSoc", 80, "2026-09-26T16:00:03Z"));
    applyTelemetry(l, tel("TpmsPressureFl", 2.1, "2026-09-26T16:00:04Z"));
    applyTelemetry(l, tel("ServiceMode", true, "2026-09-26T16:00:05Z"));
    expect(l.soc).toBeCloseTo(0.72);
    expect(l.odometerM).toBeCloseTo(16_093.44);
    expect(l.speedMps).toBeCloseTo(11.176);
    expect(l.chargeState).toBe("charging");
    expect(l.chargeLimitSoc).toBeCloseTo(0.8);
    expect(l.tpms).toEqual({ fl: 2.1, fr: null, rl: null, rr: null });
    expect(l.serviceMode).toBe(true);
    expect(l.connectivity).toBe("online");
    expect(l.lastTelemetryAt).toEqual(t("2026-09-26T16:00:05Z"));
  });
});

describe("hub presence with hysteresis", () => {
  const hub = HUBS[0]!;
  const at = (m: number) => ({ lat: hub.location.lat + m / 111_320, lng: hub.location.lng });
  it("enters within the radius and leaves only beyond radius + buffer", () => {
    expect(hubPresence(at(100), null, HUBS)).toBe(hub.id);
    expect(hubPresence(at(180), null, HUBS)).toBeNull(); // outside radius, not yet inside
    expect(hubPresence(at(180), hub.id, HUBS)).toBe(hub.id); // inside the exit buffer: stays
    expect(hubPresence(at(260), hub.id, HUBS)).toBeNull();
    expect(hubPresence(null, hub.id, HUBS)).toBe(hub.id);
  });
});

describe("provisional alert rules", () => {
  it("maps alert names to blocking classes", () => {
    expect(classifyAlert("SIM_cabin_cleanliness_event")).toBe("cleaning");
    expect(classifyAlert("SIM_DI_a175_driveInverterFault")).toBe("maintenance");
    expect(classifyAlert("SIM_VCSEC_a217_vehicleImmobilized")).toBe("incident");
    expect(classifyAlert("SIM_TPMS_w201_tirePressureLow")).toBe("incident");
    expect(classifyAlert("VCFRONT_a361_washerFluidLowMomentary")).toBeNull();
  });
});

describe("runTick", () => {
  const w = { from: t("2026-09-26T16:00:00Z"), to: t("2026-09-26T16:01:00Z") };
  const outside = { lat: 33.47, lng: -112.03 };
  const drive = (at: string): ProviderEvent => ({
    kind: "telemetry",
    events: [tel("Soc", 70, at), tel("Location", outside, at), tel("ChargeState", "Disconnected", at)],
  });

  it("commits the first status immediately, then debounces telemetry changes", () => {
    const r1 = runTick(cfg, V, new Map(), [drive("2026-09-26T16:00:05Z")], w);
    expect(r1.statusEvents).toHaveLength(1);
    expect(r1.statusEvents[0]).toMatchObject({ from: null, to: "in_service" });
    const prev = new Map(r1.live.map((l) => [l.vehicleId, l]));
    // Arrives at the hub at 16:01:20 → Ready only after holding for 60 s, stamped 16:01:20.
    const atHub = {
      kind: "telemetry",
      events: [tel("Location", HUBS[0]!.location, "2026-09-26T16:01:20Z")],
    } as ProviderEvent;
    const r2 = runTick(cfg, V, prev, [atHub], { from: w.to, to: t("2026-09-26T16:02:00Z") });
    expect(r2.statusEvents).toHaveLength(0);
    const r3 = runTick(cfg, V, new Map(r2.live.map((l) => [l.vehicleId, l])), [], {
      from: t("2026-09-26T16:02:00Z"),
      to: t("2026-09-26T16:03:00Z"),
    });
    expect(r3.statusEvents).toHaveLength(1);
    expect(r3.statusEvents[0]).toMatchObject({
      from: "in_service",
      to: "ready",
      at: t("2026-09-26T16:01:20Z"),
      causeType: "telemetry",
    });
  });

  it("a cleanliness alert blocks service immediately, and clearing it releases the car", () => {
    const r1 = runTick(cfg, V, new Map(), [drive("2026-09-26T16:00:05Z")], w);
    const prev = new Map(r1.live.map((l) => [l.vehicleId, l]));
    const alert: ProviderEvent = {
      kind: "alert",
      vehicleRef: "VIN1",
      name: "SIM_cabin_cleanliness_event",
      audiences: ["Service"],
      startedAt: t("2026-09-26T16:01:30Z"),
      endedAt: null,
    };
    const r2 = runTick(cfg, V, prev, [alert], { from: w.to, to: t("2026-09-26T16:02:00Z") });
    expect(r2.statusEvents).toEqual([
      expect.objectContaining({ to: "cleaning", at: t("2026-09-26T16:01:30Z"), causeType: "exception" }),
    ]);
    expect(r2.alerts).toHaveLength(1);
    const cleared: ProviderEvent = { ...alert, endedAt: t("2026-09-26T16:02:10Z") } as ProviderEvent;
    const r3 = runTick(
      cfg,
      V,
      new Map(r2.live.map((l) => [l.vehicleId, l])),
      [cleared, drive("2026-09-26T16:02:15Z")],
      { from: t("2026-09-26T16:02:00Z"), to: t("2026-09-26T16:04:00Z") },
    );
    expect(r3.live[0]!.activeAlerts).toEqual([]);
    expect(r3.statusEvents.at(-1)).toMatchObject({ from: "cleaning", to: "in_service" });
  });

  it("uses the roster to tell asleep from offline, so a sleeping car at its hub stays Ready", () => {
    const parked: VehicleLive = {
      ...emptyLive("v1"),
      status: "ready",
      candidateStatus: "ready",
      location: HUBS[0]!.location,
      currentHubId: HUBS[0]!.id,
      soc: 0.8,
      lastTelemetryAt: t("2026-09-26T14:00:00Z"),
      connectivity: "offline",
    };
    const r = runTick(cfg, V, new Map([["v1", parked]]), [], w, new Map([["VIN1", "asleep"]]));
    expect(r.live[0]!.connectivity).toBe("asleep");
    expect(r.statusEvents).toHaveLength(0);
    expect(r.live[0]!.status).toBe("ready");
  });

  it("keeps at most one sample per field per minute and ignores unknown vehicles", () => {
    const events: ProviderEvent[] = [
      {
        kind: "telemetry",
        events: [
          tel("Soc", 70, "2026-09-26T16:00:05Z"),
          tel("Soc", 69, "2026-09-26T16:00:45Z"),
          tel("Gear", "D", "2026-09-26T16:00:05Z"),
        ],
      },
      { kind: "telemetry", events: [{ ...tel("Soc", 50, "2026-09-26T16:00:05Z"), vehicleRef: "OTHER" }] },
      { kind: "connectivity", vehicleRef: "OTHER", status: "connected", at: t("2026-09-26T16:00:05Z") },
    ];
    const r = runTick(cfg, V, new Map(), events, w);
    expect(r.samples.filter((s) => s.field === "Soc")).toHaveLength(1);
    expect(r.samples.some((s) => s.field === "Gear")).toBe(false);
    expect(r.counts.events).toBe(3);
  });
});

describe("a simulated day through the engine, one-minute ticks", () => {
  it("tracks every car and measures availability close to the simulator's ground truth", async () => {
    const start = phoenixMidnight("2026-09-26");
    const provider = new SimulatorProvider({ seed: 42, start });
    const roster = await provider.listVehicles();
    const vehicles = roster.map((r) => ({ id: r.vehicleRef, ref: r.vehicleRef }));
    let prev = new Map<string, VehicleLive>();
    const changes = new Map<string, StatusChange[]>();
    for (let m = 0; m < 24 * 60; m++) {
      const events: ProviderEvent[] = [];
      const ac = new AbortController();
      await provider.subscribe((e) => events.push(e), ac.signal);
      const from = provider.now();
      await provider.advance(60_000);
      ac.abort();
      const conn = new Map((await provider.listVehicles()).map((v) => [v.vehicleRef, v.connectivity]));
      const r = runTick(cfg, vehicles, prev, events, { from, to: provider.now() }, conn);
      for (const e of r.statusEvents)
        changes.set(e.vehicleId, [...(changes.get(e.vehicleId) ?? []), { at: e.at, to: e.to }]);
      prev = new Map(r.live.map((l) => [l.vehicleId, l]));
    }
    expect([...prev.values()].every((l) => l.status !== null)).toBe(true);
    let hours = emptyHours();
    for (const list of changes.values())
      hours = addHours(hours, statusHours(list, { start, end: new Date(start.getTime() + 86_400_000) }));
    const measured = availability(hourTotals(hours))!;
    const truth = summarizeDay({ seed: 42, start }).availability!;
    expect(Math.abs(measured - truth)).toBeLessThan(0.03);
    expect(hours.cleaning).toBeGreaterThan(0);
  }, 120_000);
});
