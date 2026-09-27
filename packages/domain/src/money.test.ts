import {
  pnl,
  perHour,
  perMile,
  perVehicle,
  baselineRate,
  downtimeCostCents,
  CATEGORY_TYPE,
  LEDGER_CATEGORIES,
} from "./money";

describe("pnl", () => {
  it("returns null margins instead of NaN when there is no revenue", () => {
    const p = pnl([{ category: "cleaning", amountCents: 1_800 }]);
    expect(p.contributionCents).toBe(-1_800);
    expect(p.contributionMargin).toBeNull();
    expect(p.netMargin).toBeNull();
  });
  it("rejects negative or fractional cents", () => {
    expect(() => pnl([{ category: "electricity", amountCents: -5 }])).toThrow(RangeError);
    expect(() => pnl([{ category: "electricity", amountCents: 1.5 }])).toThrow(RangeError);
  });
  it("classifies every category", () => {
    expect(LEDGER_CATEGORIES.every((c) => CATEGORY_TYPE[c])).toBe(true);
    expect(CATEGORY_TYPE.platform_fee).toBe("variable");
    expect(CATEGORY_TYPE.financing).toBe("fixed");
  });
});

describe("rates", () => {
  it("guards zero denominators", () => {
    expect(perHour(1000, 0)).toBeNull();
    expect(perMile(1000, 0)).toBeNull();
    expect(perVehicle(1000, 0)).toBeNull();
    expect(perHour(2312, 1)).toBe(2312);
  });
});

describe("baselineRate fallback chain", () => {
  const fleet = { centsPerHour: 2312, availableHours: 50_000 };
  it("uses hub × hour-of-week with enough history", () =>
    expect(
      baselineRate({
        hubHourOfWeek: { centsPerHour: 4098, availableHours: 40 },
        hub: { centsPerHour: 2200, availableHours: 900 },
        fleet,
      }),
    ).toEqual({
      centsPerHour: 4098,
      source: "hub_hour_of_week",
    }));
  it("falls back to the hub when the hour bucket is thin", () =>
    expect(
      baselineRate({
        hubHourOfWeek: { centsPerHour: 9999, availableHours: 3 },
        hub: { centsPerHour: 2200, availableHours: 900 },
        fleet,
      }).source,
    ).toBe("hub"));
  it("falls back to the fleet for a new hub", () =>
    expect(baselineRate({ hub: { centsPerHour: 1, availableHours: 2 }, fleet }).source).toBe("fleet"));
});

describe("downtimeCostCents", () => {
  it("sums spans with their own rates", () =>
    expect(
      downtimeCostCents([
        { minutes: 30, rateCentsPerHour: 2000 },
        { minutes: 60, rateCentsPerHour: 3000 },
      ]),
    ).toBe(4000));
});
