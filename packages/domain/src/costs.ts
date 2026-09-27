/**
 * Cost rules (roadmap task 3.7, kpis.md §3.2): time-of-use electricity pricing for charging sessions and
 * daily allocation of monthly fixed costs. Pure; the engine and the tick write the ledger lines.
 */

/** One time-of-use period. Days: 0 = Sunday … 6 = Saturday. Times are local "HH:MM", `to` may be "24:00". */
export interface TariffPeriod {
  days: number[];
  from: string;
  to: string;
  cents_per_kwh: number;
  /** 1–12; omitted = all year. */
  months?: number[];
  label?: string;
}

const minutesOf = (hhmm: string) => {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) throw new RangeError(`Bad time "${hhmm}" (use HH:MM)`);
  const mins = Number(m[1]) * 60 + Number(m[2]);
  if (mins > 24 * 60 || Number(m[2]) > 59) throw new RangeError(`Bad time "${hhmm}"`);
  return mins;
};

export interface LocalTime {
  month: number; // 1–12
  day: number; // 0 = Sunday
  minute: number; // 0–1439
}

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formatters = new Map<string, Intl.DateTimeFormat>();

export function localTime(at: Date, timeZone: string): LocalTime {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      month: "numeric",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, f);
  }
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  return {
    month: Number(p.month),
    day: WEEKDAY[p.weekday as string] as number,
    minute: Number(p.hour) * 60 + Number(p.minute),
  };
}

/** The first matching period's rate, or null when the schedule doesn't cover this time. */
export function rateAt(schedule: readonly TariffPeriod[], t: LocalTime): number | null {
  for (const p of schedule) {
    if (p.months && !p.months.includes(t.month)) continue;
    if (!p.days.includes(t.day)) continue;
    if (t.minute >= minutesOf(p.from) && t.minute < minutesOf(p.to)) return p.cents_per_kwh;
  }
  return null;
}

/** A schedule must price every minute of every day in every month; returns the first gap found. */
export function scheduleGap(schedule: readonly TariffPeriod[]): LocalTime | null {
  for (let month = 1; month <= 12; month++)
    for (let day = 0; day < 7; day++)
      for (let minute = 0; minute < 24 * 60; minute += 15)
        if (rateAt(schedule, { month, day, minute }) === null) return { month, day, minute };
  return null;
}

export interface ChargingSessionInput {
  startedAt: Date;
  endedAt: Date;
  energyKwh: number;
}

// SUBSTITUTE(charger_telemetry, inferred): energy is spread evenly over the session (constant power).
//   Real source: OCPP MeterValues from depot chargers (per-interval kWh); Tesla charging history gives totals only.
//   Replace by: price each metered interval at its own rate when a session carries meter values.
//   Docs: docs/requirements/data-sources.md §5
/** Cost of a session at the hub's time-of-use rates, in whole cents. */
export function sessionCostCents(s: ChargingSessionInput, schedule: readonly TariffPeriod[], timeZone: string): number {
  if (!(s.energyKwh >= 0)) throw new RangeError(`energyKwh must be ≥ 0, got ${s.energyKwh}`);
  const start = s.startedAt.getTime();
  const end = Math.max(s.endedAt.getTime(), start);
  const rate = (at: number) => {
    const r = rateAt(schedule, localTime(new Date(at), timeZone));
    if (r === null) throw new RangeError(`Tariff doesn't cover ${new Date(at).toISOString()} in ${timeZone}`);
    return r;
  };
  if (end === start || s.energyKwh === 0) return Math.round(s.energyKwh * rate(start));
  const STEP = 60_000;
  let cents = 0;
  for (let t = start; t < end; t += STEP) {
    const slice = Math.min(STEP, end - t);
    cents += s.energyKwh * (slice / (end - start)) * rate(t);
  }
  return Math.round(cents);
}

const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * The share of a monthly amount booked on `day` (YYYY-MM-DD): monthly ÷ days in that month, with the
 * leftover cents on the first days so a full month sums exactly to the monthly amount.
 */
export function dailyAllocationCents(monthlyCents: number, day: string): number {
  if (!Number.isInteger(monthlyCents) || monthlyCents < 0)
    throw new RangeError(`monthlyCents must be non-negative integer cents, got ${monthlyCents}`);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) throw new RangeError(`Bad day "${day}" (use YYYY-MM-DD)`);
  const days = daysInMonth(Number(m[1]), Number(m[2]));
  const base = Math.floor(monthlyCents / days);
  return base + (Number(m[3]) <= monthlyCents - base * days ? 1 : 0);
}

/** Whether a vehicle carries fixed costs on `day`: commissioned on or before it, not retired before it. */
export function isVehicleDay(
  v: { lifecycle: string; commissionedOn: string | null; retiredOn: string | null },
  day: string,
): boolean {
  if (v.lifecycle === "pending") return false;
  if (v.commissionedOn && v.commissionedOn > day) return false;
  return !(v.retiredOn && v.retiredOn < day);
}
