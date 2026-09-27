import { phoenixMidnight, summarizeDay } from "./day-summary";

describe("summarizeDay (the rulebook on a simulated day)", () => {
  const s = summarizeDay({ seed: 42, start: phoenixMidnight("2026-09-26") });

  it("is reproducible for a seed", () => {
    const again = summarizeDay({ seed: 42, start: phoenixMidnight("2026-09-26") });
    expect(again.grossRevenueCents).toBe(s.grossRevenueCents);
    expect(again.statusChanges).toBe(s.statusChanges);
  });

  it("lands in realistic operating bands", () => {
    expect(s.availability!).toBeGreaterThan(0.85);
    expect(s.availability!).toBeLessThan(0.99);
    expect(s.uptime!).toBeGreaterThanOrEqual(s.availability!);
    // Revenue per available hour near the kpis.md baseline ($23.12/h).
    expect(s.revenuePerAvailableHourCents!).toBeGreaterThan(1_200);
    expect(s.revenuePerAvailableHourCents!).toBeLessThan(3_500);
    expect(s.contributionMargin!).toBeGreaterThan(0.4);
    expect(s.netContributionCents).toBeLessThan(s.contributionCents);
  });

  it("has most of the fleet in service at the 6 PM peak, like the MVP", () => {
    expect(s.eveningStatusCounts.in_service).toBeGreaterThan(55);
    const total = Object.values(s.eveningStatusCounts).reduce((a, b) => a + b, 0);
    expect(total).toBe(84);
  });

  it("prices incidents with the rulebook", () => {
    expect(s.costliestIncidents.length).toBeGreaterThan(0);
    expect(s.costliestIncidents.every((i) => i.totalCents > 0 && i.downtimeMin > 0)).toBe(true);
    expect(s.downtimeHoursByCause.charging).toBeGreaterThan(0);
  });
});
