import { isActive, NAV, navItem } from "./nav";

describe("NAV", () => {
  it("has the MVP's nine sections in order", () => {
    expect(NAV.map((n) => n.key)).toEqual([
      "overview",
      "fleet",
      "exceptions",
      "service",
      "hubs",
      "vendors",
      "financials",
      "reports",
      "settings",
    ]);
  });

  it("uses unique routes", () => {
    expect(new Set(NAV.map((n) => n.href)).size).toBe(NAV.length);
  });
});

describe("isActive", () => {
  it("matches Overview only on /", () => {
    expect(isActive(navItem("overview"), "/")).toBe(true);
    expect(isActive(navItem("overview"), "/fleet")).toBe(false);
  });

  it("matches a section and its sub-pages but not look-alike paths", () => {
    const fleet = navItem("fleet");
    expect(isActive(fleet, "/fleet")).toBe(true);
    expect(isActive(fleet, "/fleet/047")).toBe(true);
    expect(isActive(fleet, "/fleetwide")).toBe(false);
  });
});
