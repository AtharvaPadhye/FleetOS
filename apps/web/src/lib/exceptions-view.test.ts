import { describe, expect, it } from "vitest";
import { exceptionsHref, parseExceptionsView } from "./exceptions-view";

describe("exceptions URL", () => {
  it("defaults to the active queue, most severe first", () => {
    expect(parseExceptionsView({})).toEqual({
      tab: "active",
      statuses: ["open", "assigned", "in_progress"],
      severity: [],
      sort: "severity",
      page: 1,
    });
  });
  it("reads tabs, the API's status list, severities and sort, ignoring junk", () => {
    expect(parseExceptionsView({ status: "resolved" }).statuses).toEqual(["resolved"]);
    const v = parseExceptionsView({ status: "open", severity: "critical,high,bogus", sort: "risk" });
    expect(v).toMatchObject({ tab: "active", statuses: ["open"], severity: ["critical", "high"], sort: "risk" });
    expect(parseExceptionsView({ status: "open,resolved" }).tab).toBe("all");
    expect(parseExceptionsView({ sort: "x", page: "-3" })).toMatchObject({ sort: "severity", page: 1 });
  });
  it("builds links that keep the view and drop defaults", () => {
    const v = parseExceptionsView({ status: "all", severity: "critical", sort: "newest" });
    expect(exceptionsHref(v)).toBe("/exceptions?status=all&severity=critical&sort=newest");
    expect(exceptionsHref(v, { tab: "active", severity: [], sort: "severity" }, "abc")).toBe("/exceptions/abc");
  });
});
