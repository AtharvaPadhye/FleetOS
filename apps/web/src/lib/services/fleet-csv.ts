/**
 * Fleet CSV export (PRD FL-4): every matching vehicle (all pages), money in dollars with 2 decimals, a header
 * row, blanks (not zeros) where a value isn't available. Pure so it's unit-tested.
 */
export interface FleetCsvRow {
  number: string;
  display_name?: string | null;
  vin: string;
  home_hub: { name: string } | null;
  profitability?: string | null;
  state: {
    status: string;
    soc: number | null;
    location_name?: string | null;
    last_telemetry_at: string | null;
    fresh: boolean;
  };
  today?: {
    revenue_cents: number | null;
    contribution_cents: number | null;
    revenue_per_available_hour_cents: number | null;
    downtime_min: number;
  };
}

const cell = (v: string | number | null | undefined) => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};
const dollars = (c: number | null | undefined) => (c === null || c === undefined ? null : (c / 100).toFixed(2));

export const FLEET_CSV_HEADER = [
  "Number",
  "Name",
  "VIN",
  "Status",
  "SOC %",
  "Location",
  "Home hub",
  "Revenue today ($)",
  "Contribution today ($)",
  "Revenue per available hour ($)",
  "Downtime today (min)",
  "Profitability (30 d)",
  "Last update (UTC)",
  "Data fresh",
];

export function fleetCsv(rows: readonly FleetCsvRow[]): string {
  const lines = rows.map((r) =>
    [
      r.number,
      r.display_name,
      r.vin,
      r.state.status,
      r.state.soc === null ? null : Math.round(r.state.soc * 100),
      r.state.location_name,
      r.home_hub?.name,
      dollars(r.today?.revenue_cents),
      dollars(r.today?.contribution_cents),
      dollars(r.today?.revenue_per_available_hour_cents),
      r.today?.downtime_min,
      r.profitability,
      r.state.last_telemetry_at,
      r.state.fresh ? "yes" : "no",
    ]
      .map(cell)
      .join(","),
  );
  return [FLEET_CSV_HEADER.map(cell).join(","), ...lines].join("\r\n") + "\r\n";
}
