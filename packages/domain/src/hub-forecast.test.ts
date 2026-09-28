import { describe, expect, it } from "vitest";
import {
  forecastHub,
  hubDrainPerHour,
  overloadWindows,
  projectSessions,
  recommendations,
  type ForecastInput,
} from "./hub-forecast";

const H = 3_600_000;
const T0 = Date.parse("2026-09-27T12:00:00Z");
const base = (cars: ForecastInput["cars"], patch: Partial<ForecastInput> = {}): ForecastInput => ({
  now: T0,
  hours: Array.from({ length: 6 }, (_, i) => T0 + i * H),
  chargers: 1,
  chargerKw: 20, // (0.8 − 0.4) × 50 kWh ÷ 20 kW = 1 h sessions
  batteryKwh: 50,
  chargeAt: 0.4,
  chargeTarget: 0.8,
  drainPerHour: 0.1,
  cars,
  history: null,
  localHour: (t) => new Date(t).getUTCHours(),
  ...patch,
});
const car = (id: string, soc: number, chargingNow = false) => ({ id, number: id, soc, chargingNow });

describe("hub forecast (PRD HB-2)", () => {
  it("projects when each car will need a charger and how long it holds it", () => {
    const s = projectSessions(base([car("a", 0.6), car("b", 0.5, true)]));
    // a: 0.6 → 0.4 in 2 h, then 1 h. b: charging now 0.5 → 0.8 = 0.75 h, then drains 4 h to 0.4 → charges at 4.75 h.
    expect(s.map((x) => [x.carId, (x.start - T0) / H, (x.end - T0) / H])).toEqual([
      ["a", 2, 3],
      ["b", 0, 0.75],
      ["b", 4.75, 5.75],
    ]);
  });

  it("turns sessions into demand per hour and flags hours over capacity", () => {
    const f = forecastHub(base([car("a", 0.6), car("b", 0.6), car("c", 0.65)]));
    // a and b charge 2–3 h; c (65%) starts at 2.5 h and runs to 3.5 h.
    expect(f.map((h) => h.demand)).toEqual([0, 0, 2.5, 0.5, 0, 0]);
    expect(f[2]!.utilization).toBe(2.5);
    expect(overloadWindows(f, T0)).toEqual([{ from: T0 + 2 * H, to: T0 + 3 * H, peak: 2.5 }]);
  });

  it("blends with history once there are 3+ days of it, but not for past hours", () => {
    const history = { byLocalHour: Array.from({ length: 24 }, () => 4), days: 7 };
    const f = forecastHub(base([car("a", 0.6)], { history, now: T0 + H }));
    expect(f[0]!.demand).toBe(0); // past hour without actuals: projection only
    const withActual = forecastHub(base([car("a", 0.6)], { history, now: T0 + H, actual: new Map([[T0, 3]]) }));
    expect(withActual[0]!.demand).toBe(3); // past hour: what actually happened
    expect(f[2]!.demand).toBe(2); // no projected session yet: 0.5 × 0 + 0.5 × 4 historical
    expect(f[3]!.demand).toBe(2.5); // a charges 3–4 h: 0.5 × 1 + 0.5 × 4
    expect(forecastHub(base([car("a", 0.6)], { history: { ...history, days: 2 } }))[2]!.demand).toBe(1);
  });

  it("measures drain from charging energy and hours in service", () => {
    expect(hubDrainPerHour(500, 100, 50)).toBe(0.1);
    expect(hubDrainPerHour(500, 10, 50)).toBeNull(); // too little history
  });
});

describe("mitigation (PRD HB-3, HB-4)", () => {
  const cars = [car("a", 0.6), car("b", 0.6), car("c", 0.65)];
  const input = base(cars);
  const hours = forecastHub(input);
  const recs = recommendations({
    forecast: input,
    hours,
    otherHubs: [
      { id: "tempe", name: "Tempe", spareInWindow: () => 3 },
      { id: "full", name: "Full", spareInWindow: () => 0 },
    ],
    rateCentsPerHour: 2400,
    hubName: "Downtown",
    label: (a) => new Date(a).toISOString().slice(11, 16),
    floorSoc: 0.2,
  });

  it("proposes routing the excess to the hub with spare chargers, and delaying cars that can wait", () => {
    expect(recs.map((r) => r.kind).sort()).toEqual(["delay", "route"]);
    const route = recs.find((r) => r.kind === "route")!;
    expect(route).toMatchObject({
      toHubId: "tempe",
      vehicleIds: ["a", "b"], // peak 2.5 on 1 charger: 2 cars over
      title: "Route 2 cars to Tempe to charge",
      impactCents: 4800, // 2 cars × 1 h session × $24/h
    });
  });

  it("applying a decision moves that demand, so the overload clears", () => {
    const route = recs.find((r) => r.kind === "route")!;
    const after = forecastHub({
      ...input,
      decisions: [{ kind: "route", vehicleIds: route.vehicleIds, from: route.from, to: route.to }],
    });
    expect(overloadWindows(after, T0)).toEqual([]);
    const delay = recs.find((r) => r.kind === "delay")!;
    const later = projectSessions({
      ...input,
      decisions: [{ kind: "delay", vehicleIds: delay.vehicleIds, from: delay.from, to: delay.to }],
    });
    expect(later.find((s) => s.carId === delay.vehicleIds[0])!.start).toBe(delay.to);
  });

  it("counts a car that starts charging just before the window as part of it (regression)", () => {
    // Now 5:40; three cars start charging at ~5:47–5:55 and run into the 6:00 hour, which is the overload.
    const now = T0 + 5 * H + 40 * 60_000;
    const input = base([car("a", 0.41), car("b", 0.415), car("c", 0.42)], {
      now,
      hours: Array.from({ length: 12 }, (_, i) => T0 + i * H),
      drainPerHour: 0.08,
    });
    const hours = forecastHub(input);
    const recs = recommendations({
      forecast: input,
      hours,
      otherHubs: [{ id: "s", name: "S", spareInWindow: () => 5 }],
      rateCentsPerHour: null,
      hubName: "B",
      label: () => "",
      floorSoc: 0.2,
    });
    const route = recs.find((r) => r.kind === "route")!;
    expect(route.vehicleIds.length).toBeGreaterThan(0);
    const after = forecastHub({
      ...input,
      decisions: [{ kind: "route", vehicleIds: route.vehicleIds, from: route.from, to: route.to }],
    });
    expect(overloadWindows(after, now).find((w) => w.from === route.from)).toBeUndefined();
  });

  it("counts cars routed in from another hub", () => {
    const calm = base([]);
    const incoming = [{ carId: "x", number: "x", start: T0 + H, end: T0 + 2 * H }];
    expect(forecastHub({ ...calm, incoming })[1]!.demand).toBe(1);
  });

  it("proposes nothing when there's no overload", () => {
    const calm = base([car("a", 0.9)]);
    expect(
      recommendations({
        forecast: calm,
        hours: forecastHub(calm),
        otherHubs: [],
        rateCentsPerHour: 2400,
        hubName: "X",
        label: () => "",
        floorSoc: 0.2,
      }),
    ).toEqual([]);
  });
});
