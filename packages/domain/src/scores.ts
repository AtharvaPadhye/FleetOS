/** Labels, flags, anomaly detection, asset health grade and covenants (kpis.md §3.7). */

export type PerformanceLabel = "strong" | "monitor" | "review";

export function performanceLabel(opts: {
  margin: number;
  fleetAvgMargin: number;
  availability: number;
  availabilityTarget: number;
}): PerformanceLabel {
  const { margin, fleetAvgMargin, availability, availabilityTarget } = opts;
  if (margin <= fleetAvgMargin - 0.1 || availability < availabilityTarget - 0.05) return "review";
  if (margin >= fleetAvgMargin + 0.05 && availability >= availabilityTarget) return "strong";
  return "monitor";
}

/** P&L line flag: a cost per unit ≥ 25% above the fleet average. Returns the % above, or null. */
export function lineFlag(valuePerUnit: number, fleetAvgPerUnit: number, threshold = 0.25): number | null {
  if (fleetAvgPerUnit <= 0) return null;
  const above = valuePerUnit / fleetAvgPerUnit - 1;
  return above >= threshold ? above : null;
}

/** z-scores against the cohort; population standard deviation. */
export function zScores(values: readonly number[]): number[] {
  if (values.length < 2) return values.map(() => 0);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length);
  return values.map((v) => (sd === 0 ? 0 : (v - mean) / sd));
}

/** Indexes of cohort members whose z-score ≤ −1.5 (anomaly insights). */
export function anomalies(values: readonly number[], threshold = -1.5): number[] {
  return zScores(values)
    .map((z, i) => ({ z, i }))
    .filter(({ z }) => z <= threshold)
    .map(({ i }) => i);
}

/** Categories that together explain ≥ `share` of a gap, largest first. */
export function mainDrivers(gaps: Readonly<Record<string, number>>, share = 0.7): string[] {
  const entries = Object.entries(gaps)
    .filter(([, g]) => g > 0)
    .sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((a, [, g]) => a + g, 0);
  const out: string[] = [];
  let acc = 0;
  for (const [k, g] of entries) {
    out.push(k);
    acc += g;
    if (acc / total >= share) break;
  }
  return out;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** Linear score 0–100 between `zeroAt` and `fullAt` (works in either direction). */
const linear = (value: number, zeroAt: number, fullAt: number) => 100 * clamp01((value - zeroAt) / (fullAt - zeroAt));

export interface GradeInputs {
  uptime: number;
  uptimeCovenant: number;
  contributionMargin: number;
  marginTarget: number;
  /** Reserve funded 0–1; null when no reserve is configured (weight is redistributed). */
  reserveFunded: number | null;
  /** Incidents per 10k rides; null when not tracked (weight is redistributed). */
  incidentsPer10k: number | null;
  incidentTargetPer10k: number;
  vendorSla: number;
}

export const GRADE_WEIGHTS = { uptime: 0.3, margin: 0.25, reserve: 0.15, incidents: 0.15, vendorSla: 0.15 } as const;

/**
 * Asset health grade (kpis.md §3.7). Component scores:
 * uptime 0 at covenant − 2 pts → 100 at covenant + 3 pts; margin 0 at target − 20 pts → 100 at target;
 * reserve funded % capped at 100; incidents 100 at ≤ target → 0 at 3× target; vendor SLA 0 at 80% → 100 at 95%.
 */
export function assetHealthGrade(i: GradeInputs) {
  const components: Record<keyof typeof GRADE_WEIGHTS, number | null> = {
    uptime: linear(i.uptime, i.uptimeCovenant - 0.02, i.uptimeCovenant + 0.03),
    margin: linear(i.contributionMargin, i.marginTarget - 0.2, i.marginTarget),
    reserve: i.reserveFunded === null ? null : 100 * clamp01(i.reserveFunded),
    incidents:
      i.incidentsPer10k === null ? null : linear(i.incidentsPer10k, 3 * i.incidentTargetPer10k, i.incidentTargetPer10k),
    vendorSla: linear(i.vendorSla, 0.8, 0.95),
  };
  let weighted = 0;
  let weightSum = 0;
  for (const [k, w] of Object.entries(GRADE_WEIGHTS) as [keyof typeof GRADE_WEIGHTS, number][]) {
    const c = components[k];
    if (c === null) continue;
    weighted += c * w;
    weightSum += w;
  }
  const score = weighted / weightSum;
  return { score, letter: gradeLetter(score), components };
}

export function gradeLetter(score: number): string {
  if (score >= 90) return "A";
  if (score >= 85) return "A−";
  if (score >= 80) return "B+";
  if (score >= 75) return "B";
  if (score >= 70) return "B−";
  if (score >= 60) return "C";
  return "D";
}

export type CovenantOperator = ">" | ">=" | "<" | "<=";
export type CovenantStatus = "pass" | "at_risk" | "breach" | "not_tracked";

/**
 * Covenant status: breach if the condition fails; at risk if it passes but within 1 pt (ratios) or 5%
 * (other values) of the threshold.
 */
export function covenantStatus(
  value: number | null,
  operator: CovenantOperator,
  threshold: number,
  kind: "ratio" | "value" = "ratio",
): CovenantStatus {
  if (value === null) return "not_tracked";
  const ok =
    operator === ">"
      ? value > threshold
      : operator === ">="
        ? value >= threshold
        : operator === "<"
          ? value < threshold
          : value <= threshold;
  if (!ok) return "breach";
  const margin = kind === "ratio" ? 0.01 : Math.abs(threshold) * 0.05;
  return Math.abs(value - threshold) <= margin ? "at_risk" : "pass";
}
