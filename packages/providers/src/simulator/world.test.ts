import { isValidVin } from "@fleetos/domain";
import { distanceM } from "./geo";
import { PHOENIX } from "./phoenix";
import { SimulatorProvider } from "./provider";
import { SimulatorWorld, type OpsRecord, type RideRecord } from "./world";
import { phoenixMidnight } from "./day-summary";
import type { ProviderEvent } from "../types";

const START = phoenixMidnight("2026-09-26");

describe("fleet setup (matches the MVP's Phoenix story)", () => {
  const w = new SimulatorWorld({ seed: 1, start: START });
  it("has 84 Cybercabs split 34 / 28 / 22 across the three hubs", () => {
    expect(w.vehicles).toHaveLength(84);
    const byHub = (k: string) => w.vehicles.filter((v) => v.hub === k).length;
    expect([byHub("downtown"), byHub("tempe"), byHub("scottsdale")]).toEqual([34, 28, 22]);
  });
  it("mints unique, check-digit-valid VINs and numbers 001–084", () => {
    expect(w.vehicles.every((v) => isValidVin(v.vin))).toBe(true);
    expect(new Set(w.vehicles.map((v) => v.vin)).size).toBe(84);
    expect(w.vehicles.map((v) => v.number)).toContain("047");
  });
  it("uses Phoenix local time (UTC−7, no daylight saving)", () => {
    expect(w.localHour()).toBe(0);
    expect(w.localHour(START.getTime() + 18 * 3_600_000)).toBe(18);
  });
});

describe("determinism", () => {
  const fingerprint = async (seed: number) => {
    const p = new SimulatorProvider({ seed, start: START });
    const out: string[] = [];
    await p.subscribe((e) => out.push(JSON.stringify(e)), new AbortController().signal);
    await p.advance(60 * 60_000);
    return out.join("\n");
  };
  it("the same seed reproduces the same hour exactly", async () => {
    expect(await fingerprint(3)).toBe(await fingerprint(3));
  });
  it("a different seed gives a different hour", async () => {
    expect(await fingerprint(3)).not.toBe(await fingerprint(4));
  });
});

describe("a full simulated day stays physically sane", () => {
  const w = new SimulatorWorld({ seed: 11, start: START });
  const rides: RideRecord[] = [];
  const ops: OpsRecord[] = [];
  w.observe({ onRide: (r) => rides.push(r), onOps: (o) => ops.push(o) });
  let socOk = true;
  let inArea = true;
  const limit = PHOENIX.serviceArea.radiusM + 3_000;
  w.advanceTo(START.getTime() + 24 * 3_600_000, () => {
    for (const v of w.vehicles) {
      if (v.soc < 0 || v.soc > 1) socOk = false;
      if (distanceM(v.pos, PHOENIX.serviceArea.center) > limit) inArea = false;
    }
  });

  it("battery stays between 0 and 100%", () => expect(socOk).toBe(true));
  it("cars stay in the Phoenix service area", () => expect(inArea).toBe(true));
  it("carries a realistic number of rides with sane fares", () => {
    expect(rides.length).toBeGreaterThan(800);
    expect(rides.every((r) => r.fareCents >= PHOENIX.fares.baseCents && r.fareCents < 20_000)).toBe(true);
    expect(rides.every((r) => r.endedAt > r.startedAt)).toBe(true);
  });
  it("things go wrong and get fixed: cleaning and maintenance happen and resolve", () => {
    expect(ops.some((o) => o.kind === "cleaning")).toBe(true);
    expect(ops.every((o) => o.resolvedAt > o.detectedAt)).toBe(true);
  });
  it("never lets more cars charge at a hub than it has chargers", () => {
    for (const h of PHOENIX.hubs) expect(w.chargersInUse(h.key)).toBeLessThanOrEqual(h.chargers);
  });
});

describe("streaming behaves like Fleet Telemetry", () => {
  it("per vehicle, Location events arrive in time order and at most every 10 s", async () => {
    const p = new SimulatorProvider({ seed: 5, start: new Date("2026-09-26T15:00:00Z") });
    const last = new Map<string, number>();
    let ordered = true;
    await p.subscribe((e: ProviderEvent) => {
      if (e.kind !== "telemetry") return;
      for (const t of e.events.filter((x) => x.field === "Location")) {
        const prev = last.get(t.vehicleRef);
        if (prev !== undefined && t.eventTime.getTime() - prev < 10_000) ordered = false;
        last.set(t.vehicleRef, t.eventTime.getTime());
      }
    }, new AbortController().signal);
    await p.advance(30 * 60_000);
    expect(last.size).toBeGreaterThan(0);
    expect(ordered).toBe(true);
  });

  it("reports battery health and charging history", async () => {
    const p = new SimulatorProvider({ seed: 2, start: START });
    const [v] = await p.listVehicles();
    const health = await p.getBatteryHealth(v!.vehicleRef);
    expect(health.sohPct).toBeGreaterThan(90);
    await p.advance(6 * 3_600_000);
    const sessions = await p.getChargingHistory(START, p.now());
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions.every((c) => c.energyKwh >= 0)).toBe(true);
  });

  it("accepts commands only when enabled", async () => {
    const p = new SimulatorProvider({ seed: 2, start: START, commandsEnabled: true });
    const [v] = await p.listVehicles();
    await expect(p.sendCommand(v!.vehicleRef, "flash_lights")).resolves.toMatchObject({ ok: true });
  });
});
