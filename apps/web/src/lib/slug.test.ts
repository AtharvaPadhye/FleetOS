import { slugify } from "./slug";

describe("slugify", () => {
  it("makes URL-safe slugs", () => {
    expect(slugify("Atlas Mobility")).toBe("atlas-mobility");
    expect(slugify("  Café  Fleet!! ")).toBe("cafe-fleet");
    expect(slugify("***")).toBe("org");
  });
  it("matches the database constraint", () => {
    const re = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;
    for (const n of ["A", "Phoenix Fleet 2", "x".repeat(80) + "-"]) expect(slugify(n)).toMatch(re);
  });
});
