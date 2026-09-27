/**
 * PROVISIONAL alert → blocking-status mapping, until the exceptions engine and tickets (tasks 5.4–5.5)
 * create blocking items from configurable rules. It lets the tick put cars into Cleaning / Maintenance /
 * Incident today from the alerts vehicles (or the simulator) raise. Patterns match simulator alert names
 * and the kinds of names Tesla uses; real Tesla names get mapped when Phase 4 connects a car.
 */
export type BlockingClass = "cleaning" | "maintenance" | "incident";

const RULES: { pattern: RegExp; cls: BlockingClass }[] = [
  { pattern: /cabin|clean/i, cls: "cleaning" },
  { pattern: /immobiliz|tirePressureLow|tyre|towing/i, cls: "incident" },
  { pattern: /fault|inverter|isolation|bms_/i, cls: "maintenance" },
];

export function classifyAlert(name: string): BlockingClass | null {
  return RULES.find((r) => r.pattern.test(name))?.cls ?? null;
}

export function blockingFrom(activeAlerts: readonly string[]): Set<BlockingClass> {
  const out = new Set<BlockingClass>();
  for (const a of activeAlerts) {
    const c = classifyAlert(a);
    if (c) out.add(c);
  }
  return out;
}
