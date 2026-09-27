import { SYSTEM_RULES } from "@fleetos/domain";
import { describe, expect, it } from "vitest";
import { blockingFor, evaluateRules, ruleFacts, type ExceptionState } from "./exceptions";
import { emptyLive } from "./tick";
import type { VehicleLive } from "./types";

const at = (min: number) => new Date(Date.UTC(2026, 8, 26, 16, min));
const car = (patch: Partial<VehicleLive> = {}): VehicleLive => ({
  ...emptyLive("v1"),
  soc: 0.6,
  speedMps: 10,
  connectivity: "online",
  lastTelemetryAt: at(0),
  ...patch,
});
const rules = (...keys: string[]) => SYSTEM_RULES.filter((r) => keys.includes(r.key));

describe("exception rules in the engine", () => {
  it("opens once per rule and vehicle while the condition holds (PRD EX-2 dedupe)", () => {
    const ex: ExceptionState = { rules: rules("drive_fault"), known: [] };
    const l = car({ activeAlerts: ["SIM_DI_a175_driveInverterFault"] });
    expect(evaluateRules(ex, l, at(0)).opened).toHaveLength(1);
    expect(evaluateRules(ex, l, at(1)).opened).toHaveLength(0);
    expect([...blockingFor(ex, "v1")]).toEqual(["maintenance"]);
  });

  it("waits for `for_min` before opening, and forgets a condition that stops holding", () => {
    const ex: ExceptionState = { rules: rules("low_battery"), known: [] };
    const l = car({ soc: 0.1 });
    expect(evaluateRules(ex, l, at(0)).opened).toHaveLength(0);
    expect(l.rulePending.low_battery).toBe(at(0).toISOString());
    expect(evaluateRules(ex, l, at(1)).opened).toHaveLength(0);
    const r = evaluateRules(ex, l, at(2));
    expect(r.opened).toEqual([expect.objectContaining({ ruleKey: "low_battery", at: at(2) })]);
    expect(blockingFor(ex, "v1").size).toBe(0); // low battery doesn't take the car out of service
    l.soc = 0.5;
    expect(evaluateRules(ex, l, at(3)).cleared).toHaveLength(1);
    expect(l.rulePending).toEqual({});
    expect(ex.known).toEqual([]);
  });

  it("doesn't reopen what someone dismissed until the condition clears", () => {
    const ex: ExceptionState = {
      rules: rules("tyre_pressure_low"),
      known: [
        { dedupeKey: "tyre_pressure_low:v1", vehicleId: "v1", class: "incident", blocksService: true, active: false },
      ],
    };
    const l = car({ tpms: { fl: 1.9, fr: 2.9, rl: 2.9, rr: 2.9 } });
    expect(evaluateRules(ex, l, at(0)).opened).toHaveLength(0);
    expect(blockingFor(ex, "v1").size).toBe(0); // dismissed: no longer blocks
    l.tpms = { fl: 2.9, fr: 2.9, rl: 2.9, rr: 2.9 };
    evaluateRules(ex, l, at(1));
    l.tpms = { fl: 1.9, fr: 2.9, rl: 2.9, rr: 2.9 };
    expect(evaluateRules(ex, l, at(2)).opened).toHaveLength(1); // a new occurrence
  });

  it("keeps a manual blocking exception in force regardless of rules", () => {
    const ex: ExceptionState = {
      rules: [],
      known: [{ dedupeKey: null, vehicleId: "v1", class: "incident", blocksService: true, active: true }],
    };
    expect([...blockingFor(ex, "v1")]).toEqual(["incident"]);
    expect(blockingFor(ex, "v2").size).toBe(0);
  });

  it("counts a car as dark only when it's disconnected and not asleep at a hub", () => {
    const dark = car({ connectivity: "offline", lastTelemetryAt: at(0) });
    expect(ruleFacts(dark, at(20)).telemetry_age_min).toBe(20);
    expect(ruleFacts({ ...dark, connectivity: "asleep", currentHubId: "h1" }, at(20)).telemetry_age_min).toBe(0);
    expect(ruleFacts(car(), at(20)).telemetry_age_min).toBe(0);
  });
});
