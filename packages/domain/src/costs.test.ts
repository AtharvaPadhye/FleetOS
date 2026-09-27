import {
  dailyAllocationCents,
  isVehicleDay,
  localTime,
  rateAt,
  scheduleGap,
  sessionCostCents,
  type TariffPeriod,
} from "./costs";

const ALL = [0, 1, 2, 3, 4, 5, 6];
const TOU: TariffPeriod[] = [
  { days: [1, 2, 3, 4, 5], from: "16:00", to: "19:00", cents_per_kwh: 30, label: "on-peak" },
  { days: ALL, from: "00:00", to: "24:00", cents_per_kwh: 10, label: "off-peak" },
];
const PHX = "America/Phoenix"; // UTC−7, no DST

describe("localTime", () => {
  it("converts to the org's wall clock", () => {
    // 2026-09-28 is a Monday; 23:30 UTC = 16:30 in Phoenix.
    expect(localTime(new Date("2026-09-28T23:30:00Z"), PHX)).toEqual({ month: 9, day: 1, minute: 16 * 60 + 30 });
  });
});

describe("rateAt / scheduleGap", () => {
  it("uses the first matching period", () => {
    expect(rateAt(TOU, { month: 9, day: 1, minute: 17 * 60 })).toBe(30);
    expect(rateAt(TOU, { month: 9, day: 0, minute: 17 * 60 })).toBe(10); // Sunday: no peak
    expect(rateAt(TOU, { month: 9, day: 1, minute: 19 * 60 })).toBe(10); // `to` is exclusive
  });
  it("finds uncovered times", () => {
    expect(scheduleGap(TOU)).toBeNull();
    expect(scheduleGap([TOU[0]!])).toEqual({ month: 1, day: 0, minute: 0 });
    expect(scheduleGap([{ days: ALL, from: "00:00", to: "24:00", cents_per_kwh: 9, months: [6, 7, 8, 9] }])).toEqual({
      month: 1,
      day: 0,
      minute: 0,
    });
  });
});

describe("sessionCostCents", () => {
  it("prices a session inside one period", () => {
    // Monday 10:00–11:00 Phoenix, 40 kWh at 10¢.
    const s = { startedAt: new Date("2026-09-28T17:00:00Z"), endedAt: new Date("2026-09-28T18:00:00Z"), energyKwh: 40 };
    expect(sessionCostCents(s, TOU, PHX)).toBe(400);
  });
  it("splits energy across a peak boundary in proportion to time", () => {
    // Monday 15:00–17:00 Phoenix: half off-peak (10¢), half on-peak (30¢); 60 kWh → 30×10 + 30×30.
    const s = { startedAt: new Date("2026-09-28T22:00:00Z"), endedAt: new Date("2026-09-29T00:00:00Z"), energyKwh: 60 };
    expect(sessionCostCents(s, TOU, PHX)).toBe(1_200);
  });
  it("rejects a schedule gap instead of pricing it at zero", () => {
    const s = { startedAt: new Date("2026-09-28T17:00:00Z"), endedAt: new Date("2026-09-28T18:00:00Z"), energyKwh: 1 };
    expect(() => sessionCostCents(s, [TOU[0]!], PHX)).toThrow(RangeError);
  });
  it("handles zero-length and zero-energy sessions", () => {
    const at = new Date("2026-09-28T17:00:00Z");
    expect(sessionCostCents({ startedAt: at, endedAt: at, energyKwh: 5 }, TOU, PHX)).toBe(50);
    expect(sessionCostCents({ startedAt: at, endedAt: new Date(at.getTime() + 3.6e6), energyKwh: 0 }, TOU, PHX)).toBe(
      0,
    );
  });
});

describe("dailyAllocationCents", () => {
  it("sums to the monthly amount over the month", () => {
    for (const [month, days] of [
      ["2026-09", 30],
      ["2026-02", 28],
      ["2028-02", 29],
      ["2026-10", 31],
    ] as const) {
      let total = 0;
      for (let d = 1; d <= days; d++) total += dailyAllocationCents(114_300, `${month}-${String(d).padStart(2, "0")}`);
      expect(total).toBe(114_300);
    }
  });
  it("puts leftover cents on the first days", () => {
    // $486.00 over 30 days = 1620 exactly; $486.07 → 7 days get 1621.
    expect(dailyAllocationCents(48_600, "2026-09-15")).toBe(1_620);
    expect(dailyAllocationCents(48_607, "2026-09-07")).toBe(1_621);
    expect(dailyAllocationCents(48_607, "2026-09-08")).toBe(1_620);
  });
  it("rejects bad input", () => {
    expect(() => dailyAllocationCents(-1, "2026-09-01")).toThrow(RangeError);
    expect(() => dailyAllocationCents(100, "09/01/2026")).toThrow(RangeError);
  });
});

describe("isVehicleDay", () => {
  const v = { lifecycle: "commissioned", commissionedOn: "2026-09-10", retiredOn: "2026-09-20" };
  it("counts days between commissioning and retirement, inclusive", () => {
    expect(isVehicleDay(v, "2026-09-09")).toBe(false);
    expect(isVehicleDay(v, "2026-09-10")).toBe(true);
    expect(isVehicleDay(v, "2026-09-20")).toBe(true);
    expect(isVehicleDay(v, "2026-09-21")).toBe(false);
    expect(isVehicleDay({ ...v, lifecycle: "pending" }, "2026-09-15")).toBe(false);
    expect(isVehicleDay({ lifecycle: "commissioned", commissionedOn: null, retiredOn: null }, "2026-09-15")).toBe(true);
  });
});
