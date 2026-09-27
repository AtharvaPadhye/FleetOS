import { render, screen } from "@testing-library/react";
import { Button } from "./button";

describe("Button", () => {
  it("defaults to type=button so it never submits forms by accident", () => {
    render(<Button>Dispatch cleaner</Button>);
    expect(screen.getByRole("button", { name: "Dispatch cleaner" }).getAttribute("type")).toBe("button");
  });

  it.each(["sm", "md", "lg"] as const)("keeps chalk background AND chalk text colour at size %s", (size) => {
    render(
      <Button variant="primary" size={size}>
        Return to service
      </Button>,
    );
    const cls = screen.getByRole("button").className;
    expect(cls).toContain("bg-chalk");
    expect(cls).toContain("text-chalk-fg");
  });
});
