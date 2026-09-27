import { render, screen } from "@testing-library/react";
import { StatusBadge, STATUS_META, type VehicleStatus } from "./status-badge";
import { SeverityBadge, type Severity } from "./severity-badge";
import { DataSourceBadge } from "./data-source-badge";

describe("StatusBadge", () => {
  const statuses = Object.keys(STATUS_META) as VehicleStatus[];

  it.each(statuses)("shows a text label and a hidden shape for %s (never colour alone)", (status) => {
    const { container } = render(<StatusBadge status={status} />);
    expect(screen.getByText(STATUS_META[status].label)).toBeTruthy();
    const glyph = container.querySelector('[aria-hidden="true"]');
    expect(glyph?.textContent).toBe(STATUS_META[status].glyph);
  });

  it("uses a distinct shape for every status", () => {
    const glyphs = statuses.map((s) => STATUS_META[s].glyph);
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });
});

describe("SeverityBadge", () => {
  it.each(["critical", "high", "medium", "low"] as Severity[])("labels %s severity", (severity) => {
    render(<SeverityBadge severity={severity} />);
    expect(screen.getByText(severity[0]!.toUpperCase() + severity.slice(1))).toBeTruthy();
  });
});

describe("DataSourceBadge", () => {
  it("names simulated data explicitly", () => {
    render(<DataSourceBadge source="simulated" />);
    expect(screen.getByText("Simulated")).toBeTruthy();
  });

  it("names missing sources instead of showing zero", () => {
    render(<DataSourceBadge source="not_connected" />);
    expect(screen.getByText("Not connected")).toBeTruthy();
  });
});
