import type { GeoPoint } from "../types";

/**
 * The simulated Phoenix operation, matching the MVP's story: Atlas Mobility, 84 Cybercabs, 3 hubs.
 * Hub assignments, charger counts and $/kWh follow the MVP's Hubs screen.
 */
export interface HubSpec {
  key: "downtown" | "tempe" | "scottsdale";
  name: string;
  location: GeoPoint;
  radiusM: number;
  chargers: number;
  chargerKw: number;
  cleaningBays: number;
  assigned: number;
  centsPerKwh: number;
}

export const PHOENIX = {
  timezone: "America/Phoenix",
  /** Arizona has no daylight saving: always UTC−7. */
  utcOffsetHours: -7,
  hubs: [
    {
      key: "downtown",
      name: "Downtown Phoenix",
      location: { lat: 33.4484, lng: -112.074 },
      radiusM: 150,
      chargers: 16,
      chargerKw: 72,
      cleaningBays: 2,
      assigned: 34,
      centsPerKwh: 14,
    },
    {
      key: "tempe",
      name: "Tempe",
      location: { lat: 33.4255, lng: -111.94 },
      radiusM: 150,
      chargers: 14,
      chargerKw: 72,
      cleaningBays: 3,
      assigned: 28,
      centsPerKwh: 11,
    },
    {
      key: "scottsdale",
      name: "Scottsdale",
      location: { lat: 33.4942, lng: -111.9261 },
      radiusM: 150,
      chargers: 10,
      chargerKw: 72,
      cleaningBays: 2,
      assigned: 22,
      centsPerKwh: 13,
    },
  ] satisfies HubSpec[],
  serviceArea: { center: { lat: 33.46, lng: -112.0 }, radiusM: 16_000 },
  /** Places riders go (weights ≈ relative demand). */
  hotspots: [
    { name: "Sky Harbor T4", point: { lat: 33.4342, lng: -112.0116 }, weight: 4 },
    { name: "Roosevelt Row", point: { lat: 33.4585, lng: -112.0738 }, weight: 3 },
    { name: "ASU Tempe", point: { lat: 33.4242, lng: -111.9281 }, weight: 3 },
    { name: "Mill Ave", point: { lat: 33.4236, lng: -111.9398 }, weight: 2 },
    { name: "Old Town Scottsdale", point: { lat: 33.4942, lng: -111.9261 }, weight: 3 },
    { name: "Arcadia", point: { lat: 33.5093, lng: -111.986 }, weight: 2 },
    { name: "Biltmore", point: { lat: 33.5092, lng: -112.0299 }, weight: 1 },
  ],
  vehicle: {
    batteryKwh: 50,
    whPerKm: 160,
    speedMps: 11, // ~25 mph average in city traffic
    chargeTarget: 0.8,
    socMin: 0.4, // kpis.md §7 low-SOC threshold
    goChargeBelow: 0.3,
    tyreBar: 2.9,
  },
  fares: { baseCents: 250, perKmCents: 140, perMinCents: 30, platformFeeRate: 0.2 },
  /** Ride requests per idle vehicle per hour, by local hour (Phoenix weekday). */
  demandByHour: [
    0.3, 0.2, 0.15, 0.15, 0.3, 0.8, 1.8, 2.8, 2.6, 1.9, 1.6, 1.8, 2.1, 1.9, 1.8, 2.2, 2.8, 3.0, 2.7, 2.3, 1.9, 1.5, 1.0,
    0.6,
  ],
  /** Per-hour probability rates for random events (per vehicle-hour in service). */
  eventRates: { breakdown: 0.0008, fault: 0.002, tyreLeak: 0.0012, signalLoss: 0.005 },
  cabinEventPerRide: 0.006,
  /** Vendor costs (MVP Vendors screen). */
  costs: { cleaningCents: 1_900, towCents: 18_600, tyreCents: 14_200, diagnosticsCents: 9_800, repairCents: 24_000 },
} as const;

export type HubKey = HubSpec["key"];
