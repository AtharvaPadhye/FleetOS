import { describe, expect, it } from "vitest";
import { groupAttention } from "./attention";
import type { ExceptionOut } from "./services/exceptions";

const NOW = Date.parse("2026-09-27T12:00:00Z");
const ex = (id: string, patch: Partial<ExceptionOut> = {}): ExceptionOut => ({
  id,
  title: "Tyre pressure low",
  description: null,
  vehicle: { id: `v-${id}`, number: id },
  hub_id: null,
  type: "tyre_pressure_low",
  class: "incident",
  severity: "high",
  status: "open",
  detected_at: new Date(NOW - 30 * 60_000).toISOString(),
  location_name: "On the road",
  blocks_service: true,
  expected_downtime_min: 90,
  revenue_at_risk_cents: 3000,
  recommended_action: { label: "Dispatch Desert Tire", vendor_id: "vendor-1", eta_min: 12, cost_cents: 14000 },
  owner: null,
  ticket_id: null,
  rule_id: null,
  resolved_at: null,
  ...patch,
});

describe("Needs attention (PRD OV-2)", () => {
  it("groups by type, ranks by revenue at risk, and sums the Bleed of blocking cars", () => {
    const groups = groupAttention(
      [
        ex("052", {
          type: "vehicle_immobilized",
          title: "Vehicle immobilized",
          severity: "critical",
          revenue_at_risk_cents: 12716,
        }),
        ex("061"),
        ex("074"),
        ex("030", {
          type: "low_battery",
          title: "Battery critically low",
          class: "charging",
          blocks_service: false,
          severity: "medium",
          revenue_at_risk_cents: 500,
          recommended_action: {
            label: "Send to the nearest hub to charge",
            vendor_id: null,
            eta_min: null,
            cost_cents: null,
          },
        }),
      ],
      new Map([
        ["052", 2312],
        ["061", 2400],
        ["074", 1800],
        ["030", 2000],
      ]),
      NOW,
    );
    expect(groups.map((g) => g.title)).toEqual([
      "Cybercab 052 · Vehicle immobilized",
      "2 vehicles · Tyre pressure low",
      "Cybercab 030 · Battery critically low",
    ]);
    expect(groups[0]).toMatchObject({
      action: { kind: "dispatch", target: "052" },
      recommended_action: "Dispatch Desert Tire",
    });
    // 30 min × $23.12/h = $11.56 lost so far, at 38.5 ¢/min.
    expect(groups[0]!.bleed).toMatchObject({ lost_cents: 1156, rate_cents_per_min: 38.53 });
    expect(groups[1]).toMatchObject({
      affected_count: 2,
      affected_label: "Cars 061, 074",
      revenue_at_risk_cents: 6000,
      action: { kind: "open_fleet", target: "/fleet?issue=incident" },
      recommended_action: "Dispatch vendors",
    });
    expect(groups[2]!.bleed).toBeNull(); // not out of service: nothing is being lost yet
  });

  it("breaks revenue ties by severity, then by who was waiting longest", () => {
    const groups = groupAttention(
      [
        ex("1", { type: "a", severity: "medium", revenue_at_risk_cents: 100 }),
        ex("2", { type: "b", severity: "critical", revenue_at_risk_cents: 100 }),
        ex("3", {
          type: "c",
          severity: "critical",
          revenue_at_risk_cents: 100,
          detected_at: new Date(NOW - 99 * 60_000).toISOString(),
        }),
      ],
      new Map(),
      NOW,
    );
    expect(groups.map((g) => g.key)).toEqual(["c", "b", "a"]);
  });

  it("points at the exception once a ticket handles it", () => {
    const [g] = groupAttention([ex("5", { ticket_id: "t1" })], new Map(), NOW);
    expect(g).toMatchObject({
      action: { kind: "open_exception", target: "/exceptions/5" },
      recommended_action: "Service ticket open",
    });
  });
});
