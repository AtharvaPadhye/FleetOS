/**
 * Telemetry fields exposed by FleetOS (GET /vehicles/{id}/telemetry, the Telemetry tab): FleetOS names in SI
 * units, mapped from the Tesla Fleet Telemetry fields the engine samples (data-sources.md §3).
 */
export const TELEMETRY_FIELDS = {
  soc: { source: "Soc", scale: 0.01, label: "Battery", unit: "%" },
  speed_mps: { source: "VehicleSpeed", scale: 0.44704, label: "Speed", unit: "mph" },
  odometer_m: { source: "Odometer", scale: 1609.344, label: "Odometer", unit: "mi" },
  charge_power_kw: { source: "DCChargingPower", scale: 1, label: "Charge power", unit: "kW" },
  tpms_fl_bar: { source: "TpmsPressureFl", scale: 1, label: "Tyre pressure, front left", unit: "bar" },
  tpms_fr_bar: { source: "TpmsPressureFr", scale: 1, label: "Tyre pressure, front right", unit: "bar" },
  tpms_rl_bar: { source: "TpmsPressureRl", scale: 1, label: "Tyre pressure, rear left", unit: "bar" },
  tpms_rr_bar: { source: "TpmsPressureRr", scale: 1, label: "Tyre pressure, rear right", unit: "bar" },
} as const;
export type TelemetryField = keyof typeof TELEMETRY_FIELDS;
export const TELEMETRY_FIELD_NAMES = Object.keys(TELEMETRY_FIELDS) as TelemetryField[];

/** SI value → what the screen shows in the field's display unit (%, mph, mi, kW, bar). */
export function displayValue(field: TelemetryField, si: number): number {
  switch (field) {
    case "soc":
      return si * 100;
    case "speed_mps":
      return si / 0.44704;
    case "odometer_m":
      return si / 1609.344;
    default:
      return si;
  }
}

export const INTERVALS = { raw: "1 minute", "1m": "1 minute", "1h": "1 hour", "1d": "1 day" } as const;
export type TelemetryInterval = keyof typeof INTERVALS;

/** PRD VD-7: raw up to 6 h, 1-minute buckets up to 7 days, hourly beyond. */
export function autoInterval(spanMs: number): TelemetryInterval {
  if (spanMs <= 6 * 3_600_000) return "raw";
  if (spanMs <= 7 * 86_400_000) return "1m";
  return "1h";
}
