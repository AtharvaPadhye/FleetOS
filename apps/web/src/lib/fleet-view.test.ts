import { describe, expect, it } from "vitest";
import { fleetHref, parseFleetView, sortHref, toggleStatusHref, visibleColumns } from "./fleet-view";

describe("fleet URL state", () => {
  it("parses filters, sort and paging, ignoring junk", () => {
    const v = parseFleetView({
      status: "charging,cleaning,bogus",
      hub: "not-a-uuid",
      soc: "lt40",
      q: " 047 ",
      sort: "-revenue",
      page: "3",
      per: "50",
      issue: "incident",
    });
    expect(v).toEqual({
      status: ["charging", "cleaning"],
      hub: null,
      soc: "lt40",
      profitability: null,
      issue: "incident",
      q: "047",
      sort: "-revenue",
      page: 3,
      per: 50,
    });
    expect(parseFleetView({ sort: "-vin", per: "7", page: "-2", issue: "x" })).toMatchObject({
      sort: "number",
      per: 25,
      page: 1,
      issue: null,
    });
  });
  it("round-trips and omits defaults", () => {
    const v = parseFleetView({ status: "charging", sort: "-soc" });
    expect(fleetHref(v)).toBe("/fleet?status=charging&sort=-soc");
    expect(fleetHref(parseFleetView({}))).toBe("/fleet");
  });
  it("toggles statuses and resets to page 1", () => {
    const v = parseFleetView({ status: "charging", page: "4" });
    expect(toggleStatusHref(v, "ready")).toBe("/fleet?status=charging%2Cready");
    expect(toggleStatusHref(v, "charging")).toBe("/fleet");
  });
  it("sorts numbers descending first, then flips", () => {
    const v = parseFleetView({});
    expect(sortHref(v, "revenue", true)).toBe("/fleet?sort=-revenue");
    expect(sortHref(parseFleetView({ sort: "-revenue" }), "revenue", true)).toBe("/fleet?sort=revenue");
    expect(sortHref(v, "number", false)).toBe("/fleet?sort=-number");
  });
  it("keeps saved columns in canonical order and hides money without access", () => {
    expect(visibleColumns(["updated", "status", "revenue", "nope"], true)).toEqual(["status", "revenue", "updated"]);
    expect(visibleColumns(["status", "revenue"], false)).toEqual(["status"]);
    expect(visibleColumns(undefined, false)).not.toContain("revenue");
  });
});
