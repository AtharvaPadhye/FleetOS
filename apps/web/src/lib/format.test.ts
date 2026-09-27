import { formatCents, formatHours, formatPct, formatRatePerHour } from "./format";

describe("format", () => {
  it("formats cents with a real minus sign", () => {
    expect(formatCents(450_000)).toBe("$4,500");
    expect(formatCents(-74_100)).toBe("−$741");
    expect(formatCents(12_716, { decimals: true })).toBe("$127.16");
    expect(formatCents(888, { decimals: true, signed: true })).toBe("+$8.88");
  });
  it("shows a dash, never zero, for missing values", () => {
    expect(formatCents(null)).toBe("—");
    expect(formatPct(null)).toBe("—");
  });
  it("formats ratios, hours and rates", () => {
    expect(formatPct(0.5668)).toBe("56.7%");
    expect(formatPct(-0.125)).toBe("−12.5%");
    expect(formatPct(-0.0001)).toBe("0.0%");
    expect(formatPct(-120.702)).toBe("<−999%");
    expect(formatPct(36.249)).toBe(">999%");
    expect(formatHours(3.4667)).toBe("3 h 28 m");
    expect(formatHours(0.7833)).toBe("47 m");
    expect(formatRatePerHour(2_312)).toBe("$23.12/h");
  });
});
