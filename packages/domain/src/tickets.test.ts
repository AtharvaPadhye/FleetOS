import { describe, expect, it } from "vitest";
import { isActiveTicket, slaState, TICKET_BLOCKS_AS, TICKET_TYPE_FOR_CLASS } from "./tickets";

const t0 = Date.parse("2026-09-27T10:00:00Z");
const ticket = (patch: Partial<Parameters<typeof slaState>[0]> = {}) => ({
  status: "dispatched" as const,
  created_at: "2026-09-27T10:00:00Z",
  sla_due_at: "2026-09-27T11:00:00Z", // 60-minute SLA
  completed_at: null,
  ...patch,
});

describe("SLA state (PRD SV-2)", () => {
  it("is on track, then at risk in the last quarter, then breached", () => {
    expect(slaState(ticket(), t0 + 30 * 60_000)).toBe("on_track");
    expect(slaState(ticket(), t0 + 46 * 60_000)).toBe("at_risk");
    expect(slaState(ticket(), t0 + 61 * 60_000)).toBe("breached");
  });
  it("is met or breached once completed, whatever the time now", () => {
    expect(slaState(ticket({ status: "completed", completed_at: "2026-09-27T10:47:00Z" }), t0 + 5 * 3_600_000)).toBe(
      "met",
    );
    expect(slaState(ticket({ status: "completed", completed_at: "2026-09-27T11:05:00Z" }), t0)).toBe("breached");
  });
  it("doesn't apply to cancelled tickets or tickets without a policy", () => {
    expect(slaState(ticket({ status: "cancelled" }), t0)).toBe("n/a");
    expect(slaState(ticket({ sla_due_at: null }), t0)).toBe("n/a");
  });
});

describe("ticket types", () => {
  it("map exceptions to tickets and blocking tickets to statuses (vehicle-states.md §3)", () => {
    expect(TICKET_TYPE_FOR_CLASS.incident).toBe("roadside");
    expect(TICKET_BLOCKS_AS.roadside).toBe("incident");
    expect(TICKET_BLOCKS_AS.cleaning).toBe("cleaning");
    expect(isActiveTicket("arrived")).toBe(true);
    expect(isActiveTicket("completed")).toBe(false);
  });
});
