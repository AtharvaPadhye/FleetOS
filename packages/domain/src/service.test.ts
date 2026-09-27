import { slaMet, slaCompliance, median, medianResponseMinutes, perThousand, perTenThousand } from "./service";

const at = (m: number) => new Date(Date.UTC(2026, 8, 26, 9, m));

describe("SLA", () => {
  const onTime = {
    createdAt: at(0),
    completedAt: at(47),
    slaTargetMinutes: 60,
    dispatchedAt: at(3),
    vendorArrivedAt: at(26),
  };
  const late = {
    createdAt: at(0),
    completedAt: at(75),
    slaTargetMinutes: 60,
    dispatchedAt: at(2),
    vendorArrivedAt: at(40),
  };
  it("met when completed within target", () => {
    expect(slaMet(onTime)).toBe(true);
    expect(slaMet(late)).toBe(false);
  });
  it("compliance is the share met; null with no tickets", () => {
    expect(slaCompliance([onTime, late])).toBe(0.5);
    expect(slaCompliance([])).toBeNull();
  });
  it("median response uses only tickets with dispatch and arrival", () => {
    expect(medianResponseMinutes([onTime, late, { createdAt: at(0), completedAt: at(10), slaTargetMinutes: 60 }])).toBe(
      30.5,
    );
  });
});

describe("median", () => {
  it("handles odd, even and empty", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("rates per rides", () => {
  it("returns null without a denominator (never zero)", () => {
    expect(perThousand(3, null)).toBeNull();
    expect(perThousand(18, 10_000)).toBeCloseTo(1.8);
    expect(perTenThousand(2, 10_000)).toBe(2);
  });
});
