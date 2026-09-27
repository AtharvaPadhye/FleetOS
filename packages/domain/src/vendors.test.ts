import { expectedEtaMin, rankVendors } from "./vendors";

const base = { status: "active" as const, jobsCompleted: 0, medianResponseMin: null, slaCompliance: null };

describe("expectedEtaMin", () => {
  it("uses the median response once there's history, else distance at 40 km/h plus 10 min", () => {
    expect(expectedEtaMin({ distanceM: 20_000, jobsCompleted: 2, medianResponseMin: 12 })).toBe(40);
    expect(expectedEtaMin({ distanceM: 20_000, jobsCompleted: 5, medianResponseMin: 12 })).toBe(12);
    expect(expectedEtaMin({ distanceM: null, jobsCompleted: 0, medianResponseMin: null })).toBeNull();
  });
});

describe("rankVendors", () => {
  it("weighs ETA, cost and SLA and explains the score", () => {
    const ranked = rankVendors([
      { ...base, id: "near-pricey", distanceM: 4_000, priceCents: 4_000 }, // ETA 16
      { ...base, id: "far-cheap", distanceM: 40_000, priceCents: 1_900 }, // ETA 70
    ]);
    expect(ranked.map((r) => r.id)).toEqual(["near-pricey", "far-cheap"]);
    expect(ranked[0]).toMatchObject({
      expectedEtaMin: 16,
      breakdown: { eta: 1, cost: 0.475, sla: 0.9, limited_penalty: false },
      score: 0.823, // 0.5 + 0.1425 + 0.18
    });
    expect(ranked[1]!.breakdown).toMatchObject({ eta: 0.229, cost: 1 });
  });
  it("penalises limited vendors and drops inactive ones", () => {
    const ranked = rankVendors([
      { ...base, id: "a", distanceM: 5_000, priceCents: 1_900, status: "limited" },
      { ...base, id: "b", distanceM: 5_000, priceCents: 1_900 },
      { ...base, id: "c", distanceM: 1_000, priceCents: 1_000, status: "inactive" },
    ]);
    expect(ranked.map((r) => r.id)).toEqual(["b", "a"]);
    expect(ranked[1]!.score).toBeCloseTo(ranked[0]!.score * 0.8, 3);
  });
  it("uses real SLA compliance only with enough jobs", () => {
    const [good] = rankVendors([
      { ...base, id: "x", distanceM: 1_000, priceCents: 100, jobsCompleted: 12, slaCompliance: 0.75 },
    ]);
    expect(good!.slaCompliance).toBe(0.75);
  });
});
