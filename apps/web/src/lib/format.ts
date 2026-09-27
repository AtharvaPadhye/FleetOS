/** Display formatting (NFR CMP-3: stored in cents/ratios/SI, formatted for display). Missing values render as "—", never 0. */
const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

/** Signed money with a real minus sign (design system: money is always signed, never red-only). */
export function formatCents(cents: number | null, opts: { decimals?: boolean; signed?: boolean } = {}): string {
  if (cents === null) return "—";
  const f = opts.decimals ? usd2 : usd0;
  const abs = f.format(Math.abs(cents) / 100);
  if (cents < 0) return `−${abs}`;
  return opts.signed && cents > 0 ? `+${abs}` : abs;
}

/** Ratios as percentages, real minus sign; beyond ±999% the exact figure is noise, so it's capped. */
export function formatPct(ratio: number | null, digits = 1): string {
  if (ratio === null) return "—";
  const pct = ratio * 100;
  if (Math.abs(pct) > 999) return pct < 0 ? "<−999%" : ">999%";
  const s = `${Math.abs(pct).toFixed(digits)}%`;
  return pct < 0 && s !== `${(0).toFixed(digits)}%` ? `−${s}` : s;
}

export function formatHours(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return h ? `${h} h ${m.toString().padStart(2, "0")} m` : `${m} m`;
}

export const formatRatePerHour = (centsPerHour: number) => `${usd2.format(centsPerHour / 100)}/h`;
