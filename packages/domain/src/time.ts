import { STATUS_CLASS, VEHICLE_STATUSES, type VehicleStatus } from "./status";

/** Half-open time interval [start, end). */
export interface Interval {
  start: Date;
  end: Date;
}

export interface StatusChange {
  at: Date;
  to: VehicleStatus;
}

export type StatusHours = Record<VehicleStatus, number>;

const HOUR_MS = 3_600_000;
export const emptyHours = (): StatusHours => Object.fromEntries(VEHICLE_STATUSES.map((s) => [s, 0])) as StatusHours;

function overlapMs(a: Interval, b: Interval): number {
  return Math.max(0, Math.min(a.end.getTime(), b.end.getTime()) - Math.max(a.start.getTime(), b.start.getTime()));
}

/**
 * Hours a vehicle spent in each status within `window`, counting only time inside `serviceWindows`
 * (kpis.md §2; default: the whole window, i.e. a 24 h service day).
 * `changes` must include the last change at or before `window.start` so the opening status is known;
 * time before the first change is not counted.
 */
export function statusHours(
  changes: readonly StatusChange[],
  window: Interval,
  serviceWindows: readonly Interval[] = [window],
): StatusHours {
  const hours = emptyHours();
  const sorted = [...changes].sort((a, b) => a.at.getTime() - b.at.getTime());
  sorted.forEach((c, idx) => {
    const next = sorted[idx + 1];
    const seg: Interval = { start: c.at, end: next ? next.at : window.end };
    const inWindow: Interval = {
      start: new Date(Math.max(seg.start.getTime(), window.start.getTime())),
      end: new Date(Math.min(seg.end.getTime(), window.end.getTime())),
    };
    if (inWindow.end <= inWindow.start) return;
    const ms = serviceWindows.reduce((sum, w) => sum + overlapMs(inWindow, w), 0);
    hours[c.to] += ms / HOUR_MS;
  });
  return hours;
}

export function addHours(a: StatusHours, b: StatusHours): StatusHours {
  const out = emptyHours();
  for (const s of VEHICLE_STATUSES) out[s] = a[s] + b[s];
  return out;
}

export interface HourTotals {
  scheduled: number;
  available: number;
  earning: number;
  plannedDowntime: number;
  unplannedDowntime: number;
}

export function hourTotals(h: StatusHours): HourTotals {
  let available = 0;
  let planned = 0;
  let unplanned = 0;
  for (const s of VEHICLE_STATUSES) {
    const cls = STATUS_CLASS[s];
    if (cls === "available") available += h[s];
    else if (cls === "planned_downtime") planned += h[s];
    else unplanned += h[s];
  }
  return {
    scheduled: available + planned + unplanned,
    available,
    earning: h.in_service,
    plannedDowntime: planned,
    unplannedDowntime: unplanned,
  };
}

const ratio = (num: number, den: number): number | null => (den > 0 ? num / den : null);

/** kpis.md §3.1 */
export const availability = (t: HourTotals) => ratio(t.available, t.scheduled);
export const uptime = (t: HourTotals) => (t.scheduled > 0 ? 1 - t.unplannedDowntime / t.scheduled : null);
export const utilization = (t: HourTotals) => ratio(t.earning, t.available);

/** Downtime hours by unavailable status (Overview donut). */
export function downtimeByCause(h: StatusHours): Partial<StatusHours> {
  const out: Partial<StatusHours> = {};
  for (const s of VEHICLE_STATUSES) if (STATUS_CLASS[s] !== "available" && h[s] > 0) out[s] = h[s];
  return out;
}

/** Point-in-time counts ("Available now", "Earning now", status counts). */
export function statusCounts(current: readonly VehicleStatus[]) {
  const counts = Object.fromEntries(VEHICLE_STATUSES.map((s) => [s, 0])) as Record<VehicleStatus, number>;
  for (const s of current) counts[s] += 1;
  const available = counts.in_service + counts.ready;
  return { total: current.length, available, earning: counts.in_service, counts };
}

/** Average SOC over fresh vehicles only (kpis.md §1 freshness rule). */
export function averageSoc(vehicles: readonly { soc: number | null; fresh: boolean }[]): number | null {
  const socs = vehicles.filter((v) => v.fresh && v.soc !== null).map((v) => v.soc as number);
  return socs.length ? socs.reduce((a, b) => a + b, 0) / socs.length : null;
}

export function lowSocCount(vehicles: readonly { soc: number | null; fresh: boolean }[], threshold: number): number {
  return vehicles.filter((v) => v.fresh && v.soc !== null && v.soc < threshold).length;
}
