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

export interface CapabilityStatus {
  name: Capability;
  state: CapabilityState;
  /** What produces the data when it isn't unavailable. */
  source: string | null;
  /** The stable approximation shown instead when unavailable (api.md §3). */
  fallback: string | null;
}

/**
 * Capability states for an org (GET /api/v1/capabilities); preview endpoints answer 501 when unavailable.
 * Until Phase 4 connects Tesla, nothing is live. Demo orgs serve every preview capability from the simulator
 * except `vendor_tracking`, which needs vendor jobs (task 5.5) before there's anything to track. Other orgs
 * see fallbacks (CSV revenue, inferred charger use, static tariffs, manual vendor updates).
 */
export function capabilityStatuses(org: { isDemo: boolean }): CapabilityStatus[] {
  const sim = (name: Capability): CapabilityStatus => ({
    name,
    state: "simulated",
    source: "simulator",
    fallback: null,
  });
  const none = (name: Capability, fallback: string | null = null): CapabilityStatus => ({
    name,
    state: "unavailable",
    source: null,
    fallback,
  });
  const fallbacks: Partial<Record<Capability, string>> = {
    earnings: "csv",
    charger_telemetry: "inferred",
    live_tariffs: "static",
    vendor_tracking: "manual",
  };
  return CAPABILITIES.map((c) => (org.isDemo && c !== "vendor_tracking" ? sim(c) : none(c, fallbacks[c] ?? null)));
}
