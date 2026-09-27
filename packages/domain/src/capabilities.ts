/**
 * Data-source capabilities (ADR-0006, docs/architecture/api.md §3). The same names are used in
 * SUBSTITUTE(<capability>, <kind>) code markers (ADR-0012); scripts/substitutes.mjs keeps a copy that a
 * test here keeps in sync.
 */
export const CAPABILITIES = [
  "tesla",
  "rides",
  "earnings",
  "cabin_events",
  "autonomy_events",
  "dispatch",
  "charger_telemetry",
  "live_tariffs",
  "vendor_tracking",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const CAPABILITY_STATES = ["live", "simulated", "unavailable"] as const;
export type CapabilityState = (typeof CAPABILITY_STATES)[number];

/** Kinds of stand-in data allowed in SUBSTITUTE markers. */
export const SUBSTITUTE_KINDS = ["simulated", "csv", "manual", "inferred", "static", "fixture"] as const;
export type SubstituteKind = (typeof SUBSTITUTE_KINDS)[number];
