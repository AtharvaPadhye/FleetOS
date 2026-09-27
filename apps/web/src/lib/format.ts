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

/** "12 s ago", "7 min ago", "3 h ago", "2 d ago"; null → "—". */
export function formatAge(iso: string | null, now = Date.now()): string {
  if (!iso) return "—";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 90) return `${s} s ago`;
  if (s < 90 * 60) return `${Math.round(s / 60)} min ago`;
  if (s < 36 * 3600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

/** Minutes as "0 m", "47 m", "2 h 05 m". */
export const formatMinutes = (min: number) => formatHours(min / 60).replace(/^0 m$/, "0 m");

const MI = 1609.344;
/** Distances in miles (US orgs; the API stays in metres). */
export const formatMiles = (m: number | null, digits = 0) =>
  m === null ? "—" : `${(m / MI).toLocaleString("en-US", { maximumFractionDigits: digits })} mi`;
export const formatMph = (mps: number | null) => (mps === null ? "—" : `${Math.round(mps * 2.236936)} mph`);

/** A moment in the org's time zone: "Sep 27, 2026, 4:00 PM" (`time` → "4:00 PM"). */
export function formatWhen(iso: string | null, timeZone: string, style: "datetime" | "time" = "datetime"): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(
    "en-US",
    style === "time" ? { timeZone, timeStyle: "short" } : { timeZone, dateStyle: "medium", timeStyle: "short" },
  );
}
