import { describe, expect, it } from "vitest";
import { buildStatement, monthToDate } from "./statement";

describe("buildStatement", () => {
  it("builds revenue → contribution → net with signed costs", () => {
    const { rows, pnl } = buildStatement([
      { category: "gross_ride_revenue", amount_cents: 100_000 },
      { category: "platform_fee", amount_cents: "20000" }, // bigint arrives as a string
      { category: "electricity", amount_cents: 5_000 },
      { category: "cleaning", amount_cents: 1_900 },
      { category: "insurance", amount_cents: 1_620 },
      { category: "financing", amount_cents: 3_810 },
    ]);
    expect(pnl.contributionCents).toBe(73_100);
    expect(rows.map((r) => [r.label, r.cents])).toEqual([
      ["Ride revenue", 100_000],
      ["Platform fees", -20_000],
      ["Electricity", -5_000],
      ["Cleaning", -1_900],
      ["Contribution", 73_100],
      ["Insurance", -1_620],
      ["Financing", -3_810],
      ["Net contribution", 67_670],
    ]);
    expect(rows[4]).toMatchObject({ kind: "total", margin: 0.731 });
    expect(rows[1]).toMatchObject({ share: 0.2 });
  });
  it("shows empty margins (not 0%) when there's no revenue yet", () => {
    const { rows } = buildStatement([{ category: "insurance", amount_cents: 1_620 }]);
    expect(rows.find((r) => r.label === "Contribution")).toMatchObject({ cents: 0, margin: null });
    expect(rows.find((r) => r.label === "Net contribution")).toMatchObject({ cents: -1_620, margin: null });
    expect(rows.find((r) => r.label === "Electricity")).toMatchObject({ cents: -0, share: null });
  });
});

describe("monthToDate", () => {
  it("uses the org's calendar, not UTC", () => {
    // 03:00 UTC on 1 Oct is still 30 Sep in Phoenix.
    expect(monthToDate(new Date("2026-10-01T03:00:00Z"), "America/Phoenix")).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
    });
  });
});
