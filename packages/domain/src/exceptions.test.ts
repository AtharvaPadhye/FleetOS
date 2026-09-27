import { describe, expect, it } from "vitest";
import {
  conditionHolds,
  evalLeaf,
  openExceptionRiskCents,
  SYSTEM_RULES,
  validPattern,
  type RuleFacts,
} from "./exceptions";

const facts = (f: Partial<RuleFacts> = {}): RuleFacts => ({
  soc_pct: 60,
  tpms_min_bar: 2.9,
  speed_mph: 20,
  telemetry_age_min: 0,
  inside_hub: false,
  charging: false,
  alerts: [],
  ...f,
});
const rule = (key: string) => SYSTEM_RULES.find((r) => r.key === key)!;

describe("rule conditions", () => {
  it("compares numbers and treats unknown values as not matching", () => {
    expect(evalLeaf({ field: "soc_pct", op: "lt", value: 15 }, facts({ soc_pct: 12 }))).toBe(true);
    expect(evalLeaf({ field: "soc_pct", op: "lt", value: 15 }, facts({ soc_pct: null }))).toBe(false);
    expect(evalLeaf({ field: "soc_pct", op: "gte", value: 15 }, facts({ soc_pct: 15 }))).toBe(true);
    expect(evalLeaf({ field: "inside_hub", op: "eq", value: false }, facts())).toBe(true);
  });

  it("matches alerts case-insensitively and reports which alert fired", () => {
    const c = rule("drive_fault").condition;
    expect(conditionHolds(c, facts({ alerts: ["SIM_DI_a175_driveInverterFault"] }))).toEqual({
      holds: true,
      alert: "SIM_DI_a175_driveInverterFault",
    });
    expect(conditionHolds(c, facts({ alerts: ["SIM_cabin_cleanliness_event"] })).holds).toBe(false);
  });

  it("needs every `all` leaf and one `any` leaf", () => {
    const tyre = rule("tyre_pressure_low").condition;
    expect(conditionHolds(tyre, facts({ tpms_min_bar: 2.0 })).holds).toBe(true); // pressure alone
    expect(conditionHolds(tyre, facts({ alerts: ["SIM_TPMS_w201_tirePressureLow"] })).holds).toBe(true);
    const low = rule("low_battery").condition;
    expect(conditionHolds(low, facts({ soc_pct: 10, charging: true })).holds).toBe(false);
    expect(conditionHolds(low, facts({ soc_pct: 10 })).holds).toBe(true);
    expect(conditionHolds({}, facts()).holds).toBe(false); // an empty condition never fires
  });

  it("rejects unsafe or invalid patterns", () => {
    expect(validPattern("fault|inverter")).toBe(true);
    expect(validPattern("(")).toBe(false);
    expect(validPattern("x".repeat(201))).toBe(false);
    expect(evalLeaf({ field: "alert", op: "matches", value: "(" }, facts({ alerts: ["("] }))).toBe(false);
  });

  it("keeps system rule keys unique", () => {
    expect(new Set(SYSTEM_RULES.map((r) => r.key)).size).toBe(SYSTEM_RULES.length);
  });
});

describe("revenue at risk (kpis.md §3.2)", () => {
  it("is baseline rate × expected remaining downtime", () => {
    // Worked example E5: $23.12/h × 5.5 h = $127.16.
    expect(openExceptionRiskCents({ baselineRateCentsPerH: 2312, expectedDowntimeMin: 330, elapsedMin: 0 })).toBe(
      12716,
    );
    expect(openExceptionRiskCents({ baselineRateCentsPerH: 2312, expectedDowntimeMin: 330, elapsedMin: 300 })).toBe(
      1156,
    );
  });
  it("never drops below 15 minutes while open, and is unknown without a rate", () => {
    expect(openExceptionRiskCents({ baselineRateCentsPerH: 2400, expectedDowntimeMin: 60, elapsedMin: 500 })).toBe(600);
    expect(openExceptionRiskCents({ baselineRateCentsPerH: null, expectedDowntimeMin: 60, elapsedMin: 0 })).toBeNull();
  });
});
