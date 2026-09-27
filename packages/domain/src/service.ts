/** Service & vendor KPIs (kpis.md §3.3). */
export interface CompletedTicket {
  createdAt: Date;
  completedAt: Date;
  slaTargetMinutes: number;
  dispatchedAt?: Date | null;
  vendorArrivedAt?: Date | null;
}

export const slaMet = (t: CompletedTicket) =>
  t.completedAt.getTime() - t.createdAt.getTime() <= t.slaTargetMinutes * 60_000;

export function slaCompliance(tickets: readonly CompletedTicket[]): number | null {
  if (!tickets.length) return null;
  return tickets.filter(slaMet).length / tickets.length;
}

export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/** Median vendor response in minutes (arrival − dispatch), ignoring tickets without both times. */
export function medianResponseMinutes(tickets: readonly CompletedTicket[]): number | null {
  return median(
    tickets
      .filter((t) => t.dispatchedAt && t.vendorArrivedAt)
      .map((t) => ((t.vendorArrivedAt as Date).getTime() - (t.dispatchedAt as Date).getTime()) / 60_000),
  );
}

/** Rate per N units, e.g. cleaning tickets per 1,000 rides. null when the denominator is missing. */
export const perThousand = (count: number, denominator: number | null) =>
  denominator && denominator > 0 ? (count / denominator) * 1_000 : null;
export const perTenThousand = (count: number, denominator: number | null) =>
  denominator && denominator > 0 ? (count / denominator) * 10_000 : null;
