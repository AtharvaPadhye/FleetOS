/**
 * The worked examples in docs/requirements/kpis.md §6, as executable tests (roadmap task 3.1, NFR MNT-2).
 * If one of these fails, either the code or kpis.md is wrong; kpis.md wins until it's amended.
 */
import { hourTotals, availability, uptime, statusCounts, emptyHours } from "./time";
import {
  pnl,
  perVehicle,
  revenueAtRiskCents,
  expectedRemainingDowntimeHours,
  incidentImpact,
  revenueRecoveredCents,
  economicNetCents,
} from "./money";
import type { VehicleStatus } from "./status";

const dollars = (d: number) => Math.round(d * 100);

describe("E1 fleet month to date (MVP Financials)", () => {
  // Variable costs are one lump here; the split doesn't change contribution.
  const p = pnl([
    { category: "gross_ride_revenue", amountCents: dollars(548_320) },
    { category: "platform_fee", amountCents: dollars(258_916) },
  ]);
  it("contribution $289,404 at 52.8% margin, costs 47.2% of revenue", () => {
    expect(p.contributionCents).toBe(dollars(289_404));
    expect(p.contributionMargin!).toBeCloseTo(0.528, 3);
    expect(p.variableCostsCents / p.grossRevenueCents).toBeCloseTo(0.472, 3);
  });
  it("revenue per vehicle $6,528 across 84 vehicles", () => {
    expect(Math.round(perVehicle(p.grossRevenueCents, 84)! / 100)).toBe(6_528);
  });
  it("maintenance reserve $612 × 84 = $51,408", () => {
    expect(612 * 84).toBe(51_408);
  });
});

describe("E2 overview today", () => {
  it("revenue $18,420, contribution $9,860 → 53.5% margin", () => {
    const p = pnl([
      { category: "gross_ride_revenue", amountCents: dollars(18_420) },
      { category: "electricity", amountCents: dollars(18_420 - 9_860) },
    ]);
    expect(p.contributionCents).toBe(dollars(9_860));
    expect(p.contributionMargin!).toBeCloseTo(0.535, 3);
  });
  it("76 of 84 available now = 68 in service + 8 ready", () => {
    const fleet: VehicleStatus[] = [
      ...Array<VehicleStatus>(68).fill("in_service"),
      ...Array<VehicleStatus>(8).fill("ready"),
      ...Array<VehicleStatus>(4).fill("charging"),
      ...Array<VehicleStatus>(2).fill("cleaning"),
      "maintenance",
      "offline",
    ];
    const c = statusCounts(fleet);
    expect(c).toMatchObject({ total: 84, available: 76, earning: 68 });
    expect(c.available / c.total).toBeCloseTo(0.905, 3);
  });
});

describe("E3/E4 time-weighted availability and uptime (84 vehicles × 10 h so far)", () => {
  const h = emptyHours();
  h.charging = 3.8;
  h.maintenance = 3.1;
  h.incident = 2.6;
  h.cleaning = 1.9;
  h.in_service = 840 - 11.4; // rest of the scheduled hours available
  const t = hourTotals(h);
  it("availability today = (840 − 11.4) / 840 = 98.6%", () => {
    expect(t.scheduled).toBeCloseTo(840, 6);
    expect(availability(t)!).toBeCloseTo(0.9864, 4);
  });
  it("uptime counts only unplanned downtime: 1 − 5.7 / 840 = 99.3%", () => {
    expect(uptime(t)!).toBeCloseTo(0.9932, 4);
  });
});

describe("E5 revenue at risk, car 052 roadside", () => {
  it("(0.3 h tow ETA + 5.2 h median recovery) × $23.12/h = $127.16", () => {
    const remaining = expectedRemainingDowntimeHours({
      vendorEtaHours: 0.3,
      medianServiceHours: 5.2,
      medianResolutionHours: 9,
    });
    expect(remaining).toBeCloseTo(5.5, 6);
    expect(revenueAtRiskCents(remaining, 2_312)).toBe(12_716);
  });
  it("falls back to median total resolution time when no vendor is assigned", () => {
    expect(expectedRemainingDowntimeHours({ medianResolutionHours: 3 })).toBe(3);
  });
});

describe("E6 incident impact, car 047 cleaning", () => {
  it("47 min × $40.98/h = $32.10 lost + $18 service = $50.10", () => {
    const i = incidentImpact({ downtimeMinutes: 47, rateCentsPerHour: 4_098, serviceCostCents: 1_800 });
    expect(i.lostRevenueCents).toBe(3_210);
    expect(i.totalCents).toBe(5_010);
  });
  it("finishing 13 min inside a 60 min SLA recovers $8.88", () => {
    expect(revenueRecoveredCents({ slaTargetMinutes: 60, actualMinutes: 47, rateCentsPerHour: 4_098 })).toBe(888);
  });
  it("recovers nothing when the SLA was missed", () => {
    expect(revenueRecoveredCents({ slaTargetMinutes: 60, actualMinutes: 75, rateCentsPerHour: 4_098 })).toBe(0);
  });
});

describe("E7 vehicle P&L, car 047 (kpis.md §5)", () => {
  const p = pnl([
    { category: "gross_ride_revenue", amountCents: dollars(7_940) },
    { category: "platform_fee", amountCents: dollars(1_588) },
    { category: "electricity", amountCents: dollars(672) },
    { category: "cleaning", amountCents: dollars(486) },
    { category: "maintenance", amountCents: dollars(694) },
    { category: "insurance", amountCents: dollars(486) },
    { category: "financing", amountCents: dollars(1_143) },
  ]);
  it("contribution $4,500 (56.7%) excludes fixed costs", () => {
    expect(p.contributionCents).toBe(dollars(4_500));
    expect(p.contributionMargin!).toBeCloseTo(0.5668, 4);
  });
  it("net vehicle contribution $2,871 (36.2%) after insurance + financing", () => {
    expect(p.fixedAllocationsCents).toBe(dollars(1_629));
    expect(p.netContributionCents).toBe(dollars(2_871));
    expect(p.netMargin!).toBeCloseTo(0.3616, 4);
  });
  it("economic view subtracts $741 downtime and reproduces the MVP's $2,130", () => {
    expect(economicNetCents(p, dollars(741))).toBe(dollars(2_130));
  });
});
