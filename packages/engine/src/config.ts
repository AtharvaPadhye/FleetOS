import type { TelemetryField } from "@fleetos/providers";
import type { EngineConfig, EngineHub } from "./types";

/**
 * Raw samples kept for charts and audits. Downsampled to one per field per minute so a prototype fleet fits
 * the Supabase free tier (~20 MB/day for 84 cars); rollups keep long history (ADR-0009, ADR-0014).
 */
export const DEFAULT_SAMPLE_FIELDS: readonly TelemetryField[] = [
  "Soc",
  "Location",
  "VehicleSpeed",
  "ChargeState",
  "DCChargingPower",
  "Odometer",
  "TpmsPressureFl",
  "TpmsPressureFr",
  "TpmsPressureRl",
  "TpmsPressureRr",
];

export function defaultConfig(hubs: EngineHub[], overrides: Partial<EngineConfig> = {}): EngineConfig {
  return {
    hubs,
    socMin: 0.4,
    chargeTarget: 0.8,
    telemetryMode: "streaming",
    sampleFields: DEFAULT_SAMPLE_FIELDS,
    sampleIntervalS: 60,
    evaluateEveryMs: 10_000,
    ...overrides,
  };
}
