import { describe, expect, it } from "vitest";
import { localMidnight, resolvePeriod } from "./period";

const PHX = "America/Phoenix";
const now = new Date("2026-09-27T19:00:00Z"); // 12:00 in Phoenix

describe("resolvePeriod", () => {
  it("resolves named periods to whole local days", () => {
    expect(resolvePeriod({}, PHX, now, "today")).toEqual({
      fromDay: "2026-09-27",
      toDay: "2026-09-27",
      from: "2026-09-27T07:00:00.000Z",
      to: "2026-09-28T07:00:00.000Z",
    });
    expect(resolvePeriod({ period: "mtd" }, PHX, now, "today")).toMatchObject({
      fromDay: "2026-09-01",
      toDay: "2026-09-27",
    });
    expect(resolvePeriod({ period: "last_30d" }, PHX, now, "today")).toMatchObject({ fromDay: "2026-08-29" });
    expect(resolvePeriod({ period: "month:2028-02" }, PHX, now, "today")).toMatchObject({
      fromDay: "2028-02-01",
      toDay: "2028-02-29",
    });
  });
  it("treats from/to as half-open", () => {
    expect(
      resolvePeriod({ from: "2026-09-01T07:00:00Z", to: "2026-09-03T07:00:00Z" }, PHX, now, "today"),
    ).toMatchObject({ fromDay: "2026-09-01", toDay: "2026-09-02" });
  });
  it("rejects mixed, partial, reversed and oversized periods", () => {
    expect(() => resolvePeriod({ period: "mtd", from: "2026-09-01T00:00:00Z" }, PHX, now, "today")).toThrow();
    expect(() => resolvePeriod({ from: "2026-09-01T00:00:00Z" }, PHX, now, "today")).toThrow();
    expect(() =>
      resolvePeriod({ from: "2026-09-02T00:00:00Z", to: "2026-09-01T00:00:00Z" }, PHX, now, "today"),
    ).toThrow();
    expect(() =>
      resolvePeriod({ from: "2024-01-01T00:00:00Z", to: "2026-01-01T00:00:00Z" }, PHX, now, "today"),
    ).toThrow();
  });
});

describe("localMidnight", () => {
  it("handles daylight saving (New York, spring forward on 2026-03-08)", () => {
    expect(localMidnight("2026-03-08", "America/New_York").toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(localMidnight("2026-03-09", "America/New_York").toISOString()).toBe("2026-03-09T04:00:00.000Z");
  });
});
