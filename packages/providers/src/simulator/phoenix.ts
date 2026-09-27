import type { TariffPeriod } from "@fleetos/domain";
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

const WEEKDAYS = [1, 2, 3, 4, 5];
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const SUMMER = [5, 6, 7, 8, 9, 10];
const WINTER = [1, 2, 3, 4, 11, 12];

// SUBSTITUTE(live_tariffs, static): illustrative Phoenix-style time-of-use rates scaled from each hub's MVP $/kWh.
//   Real source: the hub's actual APS/SRP tariff from OpenEI URDB (seeded) or a live Arcadia feed (ADR-0015).
//   Replace by: a hub tariff picker that loads URDB schedules into `tariffs.schedule` (task 5.x settings).
//   Docs: docs/requirements/data-sources.md §5
/** Summer weekday afternoon peak, winter morning/evening peaks, off-peak = the hub's MVP rate. Not a published tariff. */
export function phoenixTouSchedule(hub: Pick<HubSpec, "centsPerKwh">): TariffPeriod[] {
  const off = hub.centsPerKwh;
  const r = (x: number) => Math.round(off * x * 10) / 10;
  return [
    { label: "Summer on-peak", months: SUMMER, days: WEEKDAYS, from: "14:00", to: "20:00", cents_per_kwh: r(2.2) },
    { label: "Winter on-peak", months: WINTER, days: WEEKDAYS, from: "05:00", to: "09:00", cents_per_kwh: r(1.5) },
    { label: "Winter on-peak", months: WINTER, days: WEEKDAYS, from: "17:00", to: "21:00", cents_per_kwh: r(1.5) },
    { label: "Off-peak", days: EVERY_DAY, from: "00:00", to: "24:00", cents_per_kwh: off },
  ];
}

// SUBSTITUTE(vendor_tracking, simulated): the demo's vendor network (names, prices and radii from the MVP's Vendors screen).
//   Real source: the org's own vendor directory, entered in FleetOS or imported from Airtable (task 5.6a).
//   Replace by: nothing to replace in real orgs (they add their own vendors); this only seeds demo orgs.
//   Docs: docs/requirements/data-sources.md §5
export const PHOENIX_VENDORS = [
  {
    name: "RapidClean Mobile",
    slug: "rapidclean-mobile",
    categories: ["cleaning"],
    status: "active",
    base: { lat: 33.4655, lng: -112.068 },
    radiusMi: 25,
    pricing: { cleaning: 1_900 },
    slaResponseMin: 30,
    slaResolutionMin: 60,
    capacity: "3 crews",
  },
  {
    name: "Phoenix Fleet Detail",
    slug: "phoenix-fleet-detail",
    categories: ["detailing", "cleaning"],
    status: "active",
    base: { lat: 33.4942, lng: -112.0101 },
    radiusMi: 18,
    pricing: { detailing: 6_400, cleaning: 3_200 },
    slaResponseMin: 60,
    slaResolutionMin: 120,
    capacity: "Available",
  },
  {
    name: "Desert Tire Response",
    slug: "desert-tire-response",
    categories: ["tyres"],
    status: "active",
    base: { lat: 33.4152, lng: -111.9403 },
    radiusMi: 40,
    pricing: { tyres: 14_200 },
    slaResponseMin: 45,
    slaResolutionMin: 90,
    capacity: "2 trucks",
  },
  {
    name: "Metro Tow & Recovery",
    slug: "metro-tow-recovery",
    categories: ["towing"],
    status: "limited",
    base: { lat: 33.4373, lng: -112.1215 },
    radiusMi: 50,
    pricing: { towing: 18_600 },
    slaResponseMin: 40,
    slaResolutionMin: 120,
    capacity: "1 truck",
  },
  {
    name: "Valley EV Service",
    slug: "valley-ev-service",
    categories: ["maintenance"],
    status: "active",
    base: { lat: 33.4484, lng: -112.074 },
    radiusMi: 30,
    pricing: { maintenance: 33_800 },
    slaResponseMin: 120,
    slaResolutionMin: 480,
    capacity: "4 bays",
  },
  {
    name: "ChargeOps Services",
    slug: "chargeops-services",
    categories: ["charging"],
    status: "active",
    base: { lat: 33.5092, lng: -111.8985 },
    radiusMi: 30,
    pricing: { charging: 9_800 },
    slaResponseMin: 60,
    slaResolutionMin: 180,
    capacity: "Available",
  },
] as const;
