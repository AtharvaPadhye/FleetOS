import { SEVERITY_RANK, type Severity } from "@fleetos/domain";
import type { ExceptionOut } from "./services/exceptions";

/**
 * "Needs attention" (PRD OV-2): open exceptions grouped by type ("3 vehicles · Tyre pressure low"), ranked by
 * revenue at risk, ties by severity then detection time. Each group carries its Bleed: money lost so far and
 * the rate, from the blocking exceptions' baseline rates (kpis.md §3.2), so the counter can tick client-side.
 */
export interface AttentionGroup {
  key: string;
  severity: Severity;
  title: string;
  subtitle: string;
  affected_count: number;
  affected_label: string;
  revenue_at_risk_cents: number;
  recommended_action: string;
  /** dispatch: one-click EX-4 dispatch of the recommended vendor (target = exception id); otherwise a URL. */
  action: { kind: "dispatch" | "open_exception" | "open_fleet"; target: string };
  exception_ids: string[];
  bleed: { started_at: string; rate_cents_per_min: number; lost_cents: number } | null;
}

const cars = (list: ExceptionOut[]) => {
  const numbers = list.flatMap((e) => (e.vehicle ? [e.vehicle.number] : []));
  if (!numbers.length) return "No specific vehicle";
  const shown = numbers.slice(0, 4).join(", ");
  return `${numbers.length === 1 ? "Car" : "Cars"} ${shown}${numbers.length > 4 ? ` +${numbers.length - 4} more` : ""}`;
};

export function groupAttention(
  items: ExceptionOut[],
  rates: Map<string, number | null>,
  now: number,
): AttentionGroup[] {
  const byType = new Map<string, ExceptionOut[]>();
  for (const e of items) byType.set(e.type, [...(byType.get(e.type) ?? []), e]);
  const groups: (AttentionGroup & { firstAt: number })[] = [];
  for (const [type, list] of byType) {
    list.sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        (b.revenue_at_risk_cents ?? 0) - (a.revenue_at_risk_cents ?? 0),
    );
    const top = list[0]!;
    const single = list.length === 1;
    const blocking = list.filter((e) => e.blocks_service && rates.get(e.id) != null);
    const firstAt = Math.min(...list.map((e) => Date.parse(e.detected_at)));
    const ratePerMin = blocking.reduce((s, e) => s + rates.get(e.id)! / 60, 0);
    const lost = blocking.reduce(
      (s, e) => s + Math.max(0, (now - Date.parse(e.detected_at)) / 60_000) * (rates.get(e.id)! / 60),
      0,
    );
    const action: AttentionGroup["action"] = !single
      ? { kind: "open_fleet", target: `/fleet?issue=${top.class}` }
      : !top.ticket_id && top.recommended_action?.vendor_id && top.vehicle
        ? { kind: "dispatch", target: top.id }
        : { kind: "open_exception", target: `/exceptions/${top.id}` };
    groups.push({
      key: type,
      severity: top.severity,
      title:
        single && top.vehicle
          ? `Cybercab ${top.vehicle.number} · ${top.title}`
          : `${list.length} vehicles · ${top.title}`,
      subtitle: single
        ? [top.location_name, top.owner ? `Owner: ${top.owner.name}` : null].filter(Boolean).join(" · ")
        : cars(list),
      affected_count: list.length,
      affected_label: cars(list),
      revenue_at_risk_cents: list.reduce((s, e) => s + (e.revenue_at_risk_cents ?? 0), 0),
      recommended_action: single
        ? top.ticket_id
          ? "Service ticket open"
          : (top.recommended_action?.label ?? "Investigate")
        : (top.recommended_action?.label.replace(/^Dispatch .*/, "Dispatch vendors") ?? "Review the vehicles"),
      action,
      exception_ids: list.map((e) => e.id),
      bleed: blocking.length
        ? {
            started_at: new Date(Math.min(...blocking.map((e) => Date.parse(e.detected_at)))).toISOString(),
            rate_cents_per_min: Math.round(ratePerMin * 100) / 100,
            lost_cents: Math.round(lost),
          }
        : null,
      firstAt,
    });
  }
  return groups
    .sort(
      (a, b) =>
        b.revenue_at_risk_cents - a.revenue_at_risk_cents ||
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        a.firstAt - b.firstAt,
    )
    .map((g) => {
      const out: AttentionGroup & { firstAt?: number } = { ...g };
      delete out.firstAt;
      return out;
    });
}
