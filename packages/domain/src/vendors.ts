/**
 * Vendor dispatch ranking (PRD VN-4, flows.md EX-4). Documented score, higher is better, each part 0–1:
 *
 *   score = 0.5 × ETA + 0.3 × cost + 0.2 × SLA      (× 0.8 when the vendor is marked "limited")
 *
 * - ETA part = fastest candidate ETA ÷ this vendor's ETA. ETA is the vendor's median response when it has
 *   ≥ 5 completed jobs, otherwise 10 min to accept + drive time from its base at 40 km/h.
 * - Cost part = cheapest candidate price ÷ this vendor's price for the category (0.5 when it has no price).
 * - SLA part = share of jobs that met their SLA; vendors with < 5 jobs get a neutral 0.9 prior.
 * Only vendors whose service area covers the vehicle and that aren't inactive are candidates.
 */
export const VENDOR_CATEGORIES = ["cleaning", "detailing", "tyres", "towing", "maintenance", "charging"] as const;
export type VendorCategory = (typeof VENDOR_CATEGORIES)[number];
export const VENDOR_CATEGORY_LABEL: Record<VendorCategory, string> = {
  cleaning: "Mobile cleaning",
  detailing: "Detailing",
  tyres: "Tyres",
  towing: "Towing & roadside",
  maintenance: "Maintenance",
  charging: "Charging support",
};

export const RANK_WEIGHTS = { eta: 0.5, cost: 0.3, sla: 0.2 } as const;
export const LIMITED_PENALTY = 0.8;
export const MIN_JOBS_FOR_HISTORY = 5;
const SLA_PRIOR = 0.9;
const ACCEPT_MIN = 10;
const DRIVE_KMH = 40;

export interface RankCandidate {
  id: string;
  status: "active" | "limited" | "inactive";
  distanceM: number | null;
  priceCents: number | null;
  jobsCompleted: number;
  medianResponseMin: number | null;
  slaCompliance: number | null;
}

export interface Ranked {
  id: string;
  score: number;
  expectedEtaMin: number | null;
  expectedCostCents: number | null;
  slaCompliance: number;
  breakdown: { eta: number; cost: number; sla: number; limited_penalty: boolean };
}

export function expectedEtaMin(
  c: Pick<RankCandidate, "distanceM" | "jobsCompleted" | "medianResponseMin">,
): number | null {
  if (c.jobsCompleted >= MIN_JOBS_FOR_HISTORY && c.medianResponseMin !== null) return c.medianResponseMin;
  if (c.distanceM === null) return null;
  return Math.round(ACCEPT_MIN + (c.distanceM / 1000 / DRIVE_KMH) * 60);
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

export function rankVendors(candidates: readonly RankCandidate[]): Ranked[] {
  const live = candidates.filter((c) => c.status !== "inactive");
  const etas = live.map((c) => ({ c, eta: expectedEtaMin(c) }));
  const minEta = Math.min(...etas.map((e) => e.eta ?? Infinity));
  const prices = live.map((c) => c.priceCents).filter((p): p is number => p !== null && p > 0);
  const minPrice = prices.length ? Math.min(...prices) : null;
  return etas
    .map(({ c, eta }) => {
      const etaPart = eta === null || !Number.isFinite(minEta) ? 0.5 : minEta / Math.max(eta, 1);
      const costPart = c.priceCents && minPrice ? minPrice / c.priceCents : 0.5;
      const sla = c.jobsCompleted >= MIN_JOBS_FOR_HISTORY && c.slaCompliance !== null ? c.slaCompliance : SLA_PRIOR;
      const raw = RANK_WEIGHTS.eta * etaPart + RANK_WEIGHTS.cost * costPart + RANK_WEIGHTS.sla * sla;
      const limited = c.status === "limited";
      return {
        id: c.id,
        score: r3(limited ? raw * LIMITED_PENALTY : raw),
        expectedEtaMin: eta,
        expectedCostCents: c.priceCents,
        slaCompliance: r3(sla),
        breakdown: { eta: r3(etaPart), cost: r3(costPart), sla: r3(sla), limited_penalty: limited },
      };
    })
    .sort((a, b) => b.score - a.score || (a.expectedEtaMin ?? Infinity) - (b.expectedEtaMin ?? Infinity));
}
