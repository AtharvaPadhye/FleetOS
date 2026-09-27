import { deriveStatus, shouldCommit, isAvailable, isEarning, isUnplanned, isStale, type StatusInputs } from "./status";

const now = new Date("2026-09-26T17:00:00Z");
const base: StatusInputs = {
  now,
  lastTelemetryAt: new Date(now.getTime() - 30_000),
  telemetryMode: "streaming",
  connectivity: "online",
  insideHub: false,
  soc: 0.7,
  socMin: 0.4,
  chargeTarget: 0.8,
  chargeState: "disconnected",
  pluggedIn: false,
  chargeTaskToHub: false,
  blockingIncident: false,
  blockingMaintenance: false,
  manualHold: false,
  teslaServiceMode: false,
  blockingCleaning: false,
  platformOnTrip: null,
};
const d = (over: Partial<StatusInputs>) => deriveStatus({ ...base, ...over });
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

describe("deriveStatus precedence (vehicle-states.md §3)", () => {
  it("available outside a hub → in service", () => expect(d({}).status).toBe("in_service"));
  it("available inside a hub with enough charge → ready", () => expect(d({ insideHub: true }).status).toBe("ready"));
  it("inside a hub with unknown SOC → ready", () => expect(d({ insideHub: true, soc: null }).status).toBe("ready"));
  it("platform says on trip → in service even at a hub", () =>
    expect(d({ insideHub: true, platformOnTrip: true }).status).toBe("in_service"));

  it("actively charging → charging", () => expect(d({ chargeState: "charging" }).status).toBe("charging"));
  it("starting a charge → charging", () => expect(d({ chargeState: "starting" }).status).toBe("charging"));
  it("plugged in at hub below target → charging", () =>
    expect(d({ insideHub: true, pluggedIn: true, soc: 0.6, chargeState: "stopped" }).status).toBe("charging"));
  it("plugged in at hub at target → ready", () =>
    expect(d({ insideHub: true, pluggedIn: true, soc: 0.85, chargeState: "complete" }).status).toBe("ready"));
  it("driving to hub for a charge task → charging", () => expect(d({ chargeTaskToHub: true }).status).toBe("charging"));
  it("at hub below minimum SOC → charging fallback with a charge task", () => {
    const r = d({ insideHub: true, soc: 0.3 });
    expect(r).toMatchObject({ status: "charging", rule: 8, needsChargeTask: true });
  });
  it("outside hub below minimum SOC stays in service until a charge task exists", () =>
    expect(d({ soc: 0.3 }).status).toBe("in_service"));

  it("blocking cleaning ticket → cleaning, immediately", () =>
    expect(d({ blockingCleaning: true, chargeState: "charging" })).toMatchObject({
      status: "cleaning",
      immediate: true,
    }));
  it("maintenance ticket, manual hold and Tesla service mode → maintenance", () => {
    expect(d({ blockingMaintenance: true, blockingCleaning: true }).status).toBe("maintenance");
    expect(d({ manualHold: true }).reason).toMatch(/manually/);
    expect(d({ teslaServiceMode: true }).status).toBe("maintenance");
  });

  it("no telemetry for 16 min (streaming) → offline", () =>
    expect(d({ lastTelemetryAt: minutesAgo(16) }).status).toBe("offline"));
  it("14 min is not yet offline", () => expect(d({ lastTelemetryAt: minutesAgo(14) }).status).toBe("in_service"));
  it("polling mode waits 30 min", () => {
    expect(d({ telemetryMode: "polling", lastTelemetryAt: minutesAgo(25) }).status).toBe("in_service");
    expect(d({ telemetryMode: "polling", lastTelemetryAt: minutesAgo(31) }).status).toBe("offline");
  });
  it("never seen → offline", () => expect(d({ lastTelemetryAt: null }).status).toBe("offline"));
  it("asleep at a hub is ready, not offline", () =>
    expect(d({ lastTelemetryAt: minutesAgo(120), connectivity: "asleep", insideHub: true }).status).toBe("ready"));
  it("asleep away from a hub with stale data is offline", () =>
    expect(d({ lastTelemetryAt: minutesAgo(120), connectivity: "asleep" }).status).toBe("offline"));
  it("offline outranks maintenance and cleaning", () =>
    expect(d({ lastTelemetryAt: null, blockingMaintenance: true, blockingCleaning: true }).status).toBe("offline"));

  it("MVP car 052: open recovery exception + lost telemetry → incident, not offline", () =>
    expect(d({ blockingIncident: true, lastTelemetryAt: minutesAgo(180) })).toMatchObject({
      status: "incident",
      rule: 1,
      immediate: true,
    }));
});

describe("shouldCommit (debounce, §6)", () => {
  const derived = (over: Partial<StatusInputs>) => d(over);
  it("commits the first status right away", () => expect(shouldCommit(null, derived({}), now, now)).toBe(true));
  it("doesn't re-commit the same status", () =>
    expect(shouldCommit("in_service", derived({}), minutesAgo(5), now)).toBe(false));
  it("holds telemetry-driven changes for 60 s", () => {
    const c = derived({ insideHub: true });
    expect(shouldCommit("in_service", c, new Date(now.getTime() - 59_000), now)).toBe(false);
    expect(shouldCommit("in_service", c, new Date(now.getTime() - 60_000), now)).toBe(true);
  });
  it("commits ticket-driven changes immediately", () =>
    expect(shouldCommit("in_service", derived({ blockingCleaning: true }), now, now)).toBe(true));
});

describe("status classes", () => {
  it("classifies statuses", () => {
    expect(isAvailable("ready")).toBe(true);
    expect(isAvailable("charging")).toBe(false);
    expect(isEarning("in_service")).toBe(true);
    expect(isEarning("ready")).toBe(false);
    expect(isUnplanned("offline")).toBe(true);
    expect(isUnplanned("cleaning")).toBe(false);
  });
  it("isStale respects the mode", () => {
    expect(isStale({ now, lastTelemetryAt: minutesAgo(20), telemetryMode: "polling" })).toBe(false);
  });
});
