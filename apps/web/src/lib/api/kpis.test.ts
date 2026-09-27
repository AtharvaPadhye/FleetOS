import { describe, expect, it } from "vitest";
import { baselineRateCentsPerHour, fleetKpis, pnlStatement, vehicleKpis, type HoursRow } from "./kpis";

const hours = (vehicle_id: string, h: Partial<Record<string, number>>): HoursRow => ({
  vehicle_id,
  in_service_h: h.in_service ?? 0,
  ready_h: h.ready ?? 0,
  charging_h: h.charging ?? 0,
  cleaning_h: h.cleaning ?? 0,
  maintenance_h: h.maintenance ?? 0,
  incident_h: h.incident ?? 0,
  offline_h: h.offline ?? 0,
});
const now = new Date("2026-09-27T19:00:00Z");
const fresh = { connectivity: "online", last_telemetry_at: now.toISOString(), lifecycle: "commissioned" };

describe("fleetKpis", () => {
  const base = {
    now,
    current: [
      { ...fresh, status: "in_service" as const, soc: "0.8" },
      { ...fresh, status: "charging" as const, soc: 0.3 },
      { ...fresh, status: "ready" as const, soc: null },
      { ...fresh, status: "offline" as const, soc: 0.1, connectivity: "offline", last_telemetry_at: null },
      { ...fresh, status: "ready" as const, soc: 0.9, lifecycle: "retired" },
    ],
    hours: [hours("a", { in_service: 6, ready: 2, charging: 2 }), hours("b", { ready: 8, maintenance: 2 })],
    money: [
      { vehicle_id: "a", category: "gross_ride_revenue", amount_cents: "20000" },
      { vehicle_id: "a", category: "platform_fee", amount_cents: 4000 },
      { vehicle_id: null, category: "insurance", amount_cents: 1620 },
    ],
    baselineRate: 1_000,
    availabilityTarget: 0.92,
    lowSocThreshold: 0.4,
    isDemo: true,
  };

  it("counts commissioned vehicles now and computes period ratios from hours", () => {
    const k = fleetKpis(base);
    expect(k).toMatchObject({ total_vehicles: 4, available_now: 2, earning_now: 1 });
    expect(k.status_counts).toMatchObject({ in_service: 1, charging: 1, ready: 1, offline: 1 });
    // 20 scheduled h: available 16 (in service 6 + ready 10), planned 2, unplanned 2.
    expect(k.availability).toBe(0.8);
    expect(k.uptime).toBe(0.9);
    expect(k.utilization).toEqual({ value: 0.375, estimated: true });
    expect(k.downtime_hours_by_cause).toEqual({ charging: 2, maintenance: 2 });
  });
  it("averages SOC over fresh vehicles only", () => {
    const k = fleetKpis(base);
    expect(k.avg_soc).toBe(0.55); // (0.8 + 0.3) / 2; the offline car is stale, the ready one has no SOC
    expect(k.low_soc_count).toBe(1);
  });
  it("computes money when allowed: contribution, revenue per available hour, downtime cost", () => {
    const k = fleetKpis(base);
    expect(k).toMatchObject({
      gross_revenue_cents: 20_000,
      contribution_cents: 16_000,
      contribution_margin: 0.8,
      revenue_per_available_hour_cents: 1_250,
      downtime_cost_cents: 4_000, // 4 unavailable hours × $10/h baseline
    });
    expect(k.data_sources).toMatchObject({ gross_revenue_cents: "simulated" });
  });
  it("returns null money, not zeros, when the caller can't see money", () => {
    const k = fleetKpis({ ...base, money: null });
    expect(k).toMatchObject({ gross_revenue_cents: null, contribution_margin: null, downtime_cost_cents: null });
  });
  it("returns null ratios when there are no hours yet", () => {
    const k = fleetKpis({ ...base, hours: [] });
    expect(k).toMatchObject({ availability: null, uptime: null, utilization: null });
  });
});

describe("baselineRateCentsPerHour", () => {
  it("is revenue per available hour over the baseline window, or null without hours", () => {
    expect(
      baselineRateCentsPerHour(
        [hours("a", { in_service: 5, ready: 5 })],
        [{ vehicle_id: "a", category: "gross_ride_revenue", amount_cents: 10_000 }],
      ),
    ).toBe(1_000);
    expect(baselineRateCentsPerHour([], [])).toBeNull();
  });
});

describe("vehicleKpis", () => {
  const input = {
    vehicleId: "a",
    hours: [hours("a", { in_service: 6, ready: 2, maintenance: 2 }), hours("b", { in_service: 8, ready: 2 })],
    money: [
      { vehicle_id: "a", category: "gross_ride_revenue", amount_cents: 10_000 },
      { vehicle_id: "a", category: "maintenance", amount_cents: 5_000 },
      { vehicle_id: "b", category: "gross_ride_revenue", amount_cents: 20_000 },
      { vehicle_id: "b", category: "electricity", amount_cents: 1_000 },
    ],
    availabilityTarget: 0.92,
    isDemo: false,
  };
  it("compares the vehicle with the fleet and labels it", () => {
    const k = vehicleKpis(input);
    const m = Object.fromEntries(k.metrics.map((x) => [x.key, x]));
    expect(m.availability).toMatchObject({ value: 0.8, fleet_avg: 0.9, flag: "bad" }); // 0.8 < 0.92 − 0.05
    expect(m.contribution_margin).toMatchObject({ value: 0.5, fleet_avg: 0.8, flag: "bad", data_source: "csv" });
    expect(m.gross_revenue_cents).toMatchObject({ value: 10_000, fleet_avg: 15_000 });
    expect(k.performance_label).toBe("review");
  });
  it("leaves money metrics out for roles without money access", () => {
    const k = vehicleKpis({ ...input, money: null });
    expect(k.metrics.map((x) => x.key)).toEqual(["availability", "uptime", "utilization", "downtime_hours"]);
    expect(k.performance_label).toBeUndefined();
  });
});

describe("pnlStatement", () => {
  const money = [
    { vehicle_id: "a", category: "gross_ride_revenue", amount_cents: 10_000 },
    { vehicle_id: "a", category: "cleaning", amount_cents: 1_500 },
    { vehicle_id: "b", category: "gross_ride_revenue", amount_cents: 10_000 },
    { vehicle_id: "b", category: "cleaning", amount_cents: 500 },
  ];
  it("flags a vehicle's cost line 25%+ above the fleet average per vehicle", () => {
    const s = pnlStatement({ money, vehicleId: "a", vehicleCount: 2, downtimeCostCents: 0 });
    expect(s.pnl.contributionCents).toBe(8_500);
    expect(s.lines.find((l) => l.category === "cleaning")).toEqual({
      category: "cleaning",
      amount_cents: 1_500,
      vs_fleet_avg_pct: 50,
      flagged: true,
    });
    expect(s.lines.find((l) => l.category === "gross_ride_revenue")?.flagged).toBe(false);
  });
  it("lists every category for the fleet, without comparisons", () => {
    const s = pnlStatement({ money, vehicleId: null, vehicleCount: 2, downtimeCostCents: 0 });
    expect(s.lines).toHaveLength(9);
    expect(s.lines.every((l) => l.vs_fleet_avg_pct === null && !l.flagged)).toBe(true);
  });
});
