import { cn } from "./cn";

describe("cn", () => {
  it("keeps a colour class next to a custom font-size class (regression: invisible primary button)", () => {
    const out = cn("text-chalk-fg", "text-body");
    expect(out).toContain("text-chalk-fg");
    expect(out).toContain("text-body");
  });

  it("still lets a later font size override an earlier one", () => {
    expect(cn("text-label", "text-body")).toBe("text-body");
  });

  it("still lets a later colour override an earlier one", () => {
    expect(cn("text-fg", "text-fg-muted")).toBe("text-fg-muted");
  });
});
