import { z } from "zod";
import { ApiProblem } from "./problem";

/**
 * KPI periods (api.md §1 "Time"): `period=today|mtd|last_30d|month:YYYY-MM`, or `from`/`to` (half-open).
 * KPIs are kept per local service day, so a period resolves to whole days in the org's time zone.
 */
export const PeriodQuery = {
  period: z
    .string()
    .regex(/^(today|mtd|last_30d|month:\d{4}-(0[1-9]|1[0-2]))$/, "Use today, mtd, last_30d or month:YYYY-MM.")
    .optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
};
export type PeriodName = "today" | "mtd" | "last_30d";

export interface ResolvedPeriod {
  /** Inclusive local days. */
  fromDay: string;
  toDay: string;
  /** UTC instants of the local-day bounds (half-open). */
  from: string;
  to: string;
}

const MAX_DAYS = 366;
const dayFmt = new Map<string, Intl.DateTimeFormat>();
export function localDay(at: Date, timeZone: string): string {
  let f = dayFmt.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone });
    dayFmt.set(timeZone, f);
  }
  return f.format(at);
}

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The UTC instant of local midnight starting `day` in `timeZone` (DST-safe). */
export function localMidnight(day: string, timeZone: string): Date {
  const guess = new Date(`${day}T00:00:00Z`).getTime();
  const offsetAt = (t: number) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
        .formatToParts(new Date(t))
        .map((x) => [x.type, x.value]),
    );
    return Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!) - t;
  };
  const first = guess - offsetAt(guess);
  return new Date(guess - offsetAt(first));
}

export function resolvePeriod(
  q: { period?: string; from?: string; to?: string },
  timeZone: string,
  now: Date,
  fallback: PeriodName,
): ResolvedPeriod {
  if (q.period && (q.from || q.to)) throw new ApiProblem("invalid_request", "Send either period or from/to, not both.");
  const today = localDay(now, timeZone);
  let fromDay: string;
  let toDay: string;
  if (q.from || q.to) {
    if (!q.from || !q.to) throw new ApiProblem("invalid_request", "Send both from and to.");
    const from = new Date(q.from);
    const to = new Date(q.to);
    if (to <= from) throw new ApiProblem("invalid_request", "to must be after from.");
    fromDay = localDay(from, timeZone);
    toDay = localDay(new Date(to.getTime() - 1), timeZone);
  } else {
    const p = q.period ?? fallback;
    if (p === "today") [fromDay, toDay] = [today, today];
    else if (p === "mtd") [fromDay, toDay] = [`${today.slice(0, 8)}01`, today];
    else if (p === "last_30d") [fromDay, toDay] = [addDays(today, -29), today];
    else {
      const month = p.slice(6);
      fromDay = `${month}-01`;
      toDay = addDays(`${addDays(`${month}-28`, 4).slice(0, 7)}-01`, -1); // last day of the month
    }
  }
  const days = (Date.parse(toDay) - Date.parse(fromDay)) / 86_400_000 + 1;
  if (days > MAX_DAYS) throw new ApiProblem("invalid_request", `Periods are limited to ${MAX_DAYS} days.`);
  return {
    fromDay,
    toDay,
    from: localMidnight(fromDay, timeZone).toISOString(),
    to: localMidnight(addDays(toDay, 1), timeZone).toISOString(),
  };
}
