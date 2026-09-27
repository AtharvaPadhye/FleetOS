import {
  statusHours,
  hourTotals,
  addHours,
  availability,
  uptime,
  utilization,
  downtimeByCause,
  averageSoc,
  lowSocCount,
  emptyHours,
} from "./time";

const t = (hhmm: string) => new Date(`2026-09-26T${hhmm}:00Z`);

describe("statusHours", () => {
  const changes = [
    { at: t("05:00"), to: "ready" as const },
    { at: t("06:14"), to: "in_service" as const },
    { at: t("09:42"), to: "cleaning" as const },
    { at: t("10:29"), to: "in_service" as const },
  ];
  const window = { start: t("06:00"), end: t("12:00") };

  it("splits the window by status, starting from the status in force at the window start", () => {
    const h = statusHours(changes, window);
    expect(h.ready).toBeCloseTo(14 / 60, 6);
    expect(h.cleaning).toBeCloseTo(47 / 60, 6);
    expect(h.in_service).toBeCloseTo((208 + 91) / 60, 6);
    expect(hourTotals(h).scheduled).toBeCloseTo(6, 6);
  });

  it("counts only time inside service windows", () => {
    const h = statusHours(changes, window, [{ start: t("09:00"), end: t("11:00") }]);
    expect(hourTotals(h).scheduled).toBeCloseTo(2, 6);
    expect(h.cleaning).toBeCloseTo(47 / 60, 6);
  });

  it("ignores unsorted input order", () => {
    expect(statusHours([...changes].reverse(), window)).toEqual(statusHours(changes, window));
  });

  it("returns zeros when nothing overlaps", () => {
    expect(hourTotals(statusHours(changes, { start: t("00:00"), end: t("04:00") })).scheduled).toBe(0);
  });
});

describe("fleet ratios", () => {
  it("adds per-vehicle hours and derives availability, uptime and utilization", () => {
    const a = { ...emptyHours(), in_service: 8, ready: 1, charging: 1 };
    const b = { ...emptyHours(), in_service: 6, maintenance: 2, offline: 2 };
    const tot = hourTotals(addHours(a, b));
    expect(tot).toMatchObject({ scheduled: 20, available: 15, earning: 14, plannedDowntime: 1, unplannedDowntime: 4 });
    expect(availability(tot)).toBeCloseTo(0.75);
    expect(uptime(tot)).toBeCloseTo(0.8);
    expect(utilization(tot)).toBeCloseTo(14 / 15);
  });
  it("returns null, not 0 or NaN, with no scheduled hours", () => {
    const tot = hourTotals(emptyHours());
    expect(availability(tot)).toBeNull();
    expect(uptime(tot)).toBeNull();
    expect(utilization(tot)).toBeNull();
  });
  it("lists downtime by cause, excluding zero and available statuses", () => {
    expect(downtimeByCause({ ...emptyHours(), in_service: 5, charging: 3.8, incident: 2.6 })).toEqual({
      charging: 3.8,
      incident: 2.6,
    });
  });
});

describe("SOC", () => {
  const cars = [
    { soc: 0.72, fresh: true },
    { soc: 0.23, fresh: true },
    { soc: 0.1, fresh: false },
    { soc: null, fresh: true },
  ];
  it("averages fresh vehicles only", () => expect(averageSoc(cars)).toBeCloseTo(0.475));
  it("counts fresh vehicles below the threshold", () => expect(lowSocCount(cars, 0.4)).toBe(1));
  it("returns null with no fresh SOC", () => expect(averageSoc([{ soc: 0.5, fresh: false }])).toBeNull());
});
