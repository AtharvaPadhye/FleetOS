import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { availability, hourTotals, isFresh, pnl, type LedgerCategory } from "@fleetos/domain";
import { ApiProblem } from "@/lib/api/problem";
import { orgSettings, vehicleMoney } from "@/lib/api/kpi-data";
import { toHours } from "@/lib/api/kpis";
import { localDay, localMidnight } from "@/lib/api/period";
import { MONEY_ROLES } from "@/lib/api/vehicles";
import type { OrgContext } from "@/lib/api/handler";
import { getFleetKpis } from "./kpis";

/**
 * The Overview screen's data (task 5.3, PRD OV-1, OV-3, OV-4): today's KPIs against yesterday, the trends and
 * breakdowns behind the charts, and the fleet health scores. The attention queue is `attention.ts`.
 */
type Org = Pick<OrgContext, "id" | "role" | "timezone" | "isDemo">;
export const OVERVIEW_PERIODS = { today: "Today", yesterday: "Yesterday", last_7d: "Last 7 days" } as const;
export type OverviewPeriod = keyof typeof OVERVIEW_PERIODS;

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const OPERATING: LedgerCategory[] = [
  "platform_fee",
  "electricity",
  "cleaning",
  "maintenance",
  "roadside",
  "other_variable",
];

/** Local-day range of an Overview period and the equally long range before it (the comparison). */
export function overviewDays(period: OverviewPeriod, today: string) {
  const len = period === "last_7d" ? 7 : 1;
  const toDay = period === "yesterday" ? addDays(today, -1) : today;
  const fromDay = addDays(toDay, -(len - 1));
  return { fromDay, toDay, prevFrom: addDays(fromDay, -len), prevTo: addDays(fromDay, -1) };
}

export async function overview(db: SupabaseClient, org: Org, period: OverviewPeriod, now = new Date()) {
  const today = localDay(now, org.timezone);
  const d = overviewDays(period, today);
  const iso = (day: string) => localMidnight(day, org.timezone).toISOString();
  const range = (from: string, to: string) => ({ from: iso(from), to: iso(addDays(to, 1)) });
  const canSeeMoney = MONEY_ROLES.has(org.role);
  const from30 = addDays(today, -29);
  const from7 = addDays(today, -6);
  const since7 = iso(from7);

  const [
    kpis,
    prev,
    days,
    ledger,
    byVehicle,
    vehicles,
    hubs,
    settings,
    current,
    rides,
    cabin,
    autonomy,
    openMaint,
    sla,
  ] = await Promise.all([
    getFleetKpis(db, org, range(d.fromDay, d.toDay)),
    getFleetKpis(db, org, range(d.prevFrom, d.prevTo)),
    db.from("fleet_day_hours").select("*").eq("org_id", org.id).gte("day", from30).lte("day", today).order("day"),
    canSeeMoney ? db.rpc("ledger_daily", { p_org: org.id, p_from: from7, p_to: today }) : Promise.resolve(null),
    canSeeMoney ? vehicleMoney(db, org.id, d.fromDay, d.toDay) : Promise.resolve(null),
    db.from("vehicles").select("id, home_hub_id").eq("org_id", org.id).neq("lifecycle", "retired").limit(5000),
    db.from("hubs").select("id, name").eq("org_id", org.id),
    orgSettings(db, org.id),
    db
      .from("vehicle_list")
      .select("id, status, soc, connectivity, last_telemetry_at, lifecycle")
      .eq("org_id", org.id)
      .limit(5000),
    db.from("rides").select("id", { count: "exact", head: true }).eq("org_id", org.id).gte("ended_at", since7),
    db.from("cabin_events").select("id", { count: "exact", head: true }).eq("org_id", org.id).gte("at", since7),
    db
      .from("autonomy_events")
      .select("id", { count: "exact", head: true })
      .eq("org_id", org.id)
      .eq("kind", "incident")
      .gte("at", since7),
    db
      .from("exceptions")
      .select("vehicle_id")
      .eq("org_id", org.id)
      .eq("class", "maintenance")
      .in("status", ["open", "assigned", "in_progress"]),
    db
      .from("tickets")
      .select("completed_at, sla_due_at")
      .eq("org_id", org.id)
      .gte("completed_at", new Date(now.getTime() - 30 * 86_400_000).toISOString())
      .not("sla_due_at", "is", null)
      .limit(5000),
  ]);
  const err =
    days.error ?? ledger?.error ?? vehicles.error ?? hubs.error ?? openMaint.error ?? sla.error ?? current.error;
  if (err) throw new ApiProblem("internal", err.message);

  // OV-3 availability, last 30 days vs target.
  type DayRow = Parameters<typeof toHours>[0] & { day: string };
  const availabilityTrend = ((days.data ?? []) as DayRow[]).map((r) => ({
    day: r.day,
    availability: availability(hourTotals(toHours(r))),
  }));

  // OV-3 revenue vs operating cost, last 7 days (variable costs; fixed allocations are on Financials).
  const perDay = new Map<string, { revenue: number; cost: number }>();
  for (let i = 0; i < 7; i++) perDay.set(addDays(from7, i), { revenue: 0, cost: 0 });
  for (const r of (ledger?.data ?? []) as { day: string; category: LedgerCategory; amount_cents: number }[]) {
    const e = perDay.get(r.day);
    if (!e) continue;
    if (r.category === "gross_ride_revenue") e.revenue += Number(r.amount_cents);
    else if (OPERATING.includes(r.category)) e.cost += Number(r.amount_cents);
  }
  const revenueVsCost = canSeeMoney ? [...perDay].map(([day, v]) => ({ day, ...v })) : null;

  // OV-3 contribution margin by home hub for the period.
  const hubName = new Map(((hubs.data ?? []) as { id: string; name: string }[]).map((h) => [h.id, h.name]));
  const hubOf = new Map(
    ((vehicles.data ?? []) as { id: string; home_hub_id: string | null }[]).map((v) => [v.id, v.home_hub_id]),
  );
  const byHub = new Map<string, { category: LedgerCategory; amountCents: number }[]>();
  for (const m of byVehicle ?? []) {
    const hub = (m.vehicle_id && hubOf.get(m.vehicle_id)) || null;
    if (!hub) continue;
    byHub.set(hub, [
      ...(byHub.get(hub) ?? []),
      { category: m.category as LedgerCategory, amountCents: Number(m.amount_cents) },
    ]);
  }
  const marginByHub = canSeeMoney
    ? [...byHub]
        .map(([id, lines]) => {
          const p = pnl(lines);
          return {
            hub: hubName.get(id) ?? "Unknown hub",
            margin: p.contributionMargin,
            contribution_cents: p.contributionCents,
          };
        })
        .filter((h) => h.margin !== null)
        .sort((a, b) => b.margin! - a.margin!)
    : null;

  // OV-4 fleet health.
  const active = (
    (current.data ?? []) as {
      id: string;
      status: string;
      soc: number | string | null;
      connectivity: "online" | "asleep" | "offline";
      last_telemetry_at: string | null;
      lifecycle: string;
    }[]
  ).filter((v) => v.lifecycle === "commissioned");
  const fresh = active.filter((v) =>
    isFresh(
      { connectivity: v.connectivity, lastTelemetryAt: v.last_telemetry_at ? new Date(v.last_telemetry_at) : null },
      now,
    ),
  );
  const maintOpen = new Set(((openMaint.data ?? []) as { vehicle_id: string | null }[]).map((e) => e.vehicle_id));
  const completed = (sla.data ?? []) as { completed_at: string; sla_due_at: string }[];
  const rideCount = rides.count ?? 0;
  const preview = org.isDemo ? "simulated" : "unavailable";
  const health = [
    {
      key: "cleanliness",
      label: "Cleanliness",
      value: org.isDemo && rideCount ? 1 - Math.min(cabin.count ?? 0, rideCount) / rideCount : null,
      detail: "Rides without a cabin event, last 7 days",
      source: preview,
    },
    {
      key: "charging_readiness",
      label: "Charging readiness",
      value: fresh.length
        ? fresh.filter((v) => v.soc !== null && Number(v.soc) >= settings.lowSocThreshold).length / fresh.length
        : null,
      detail: `Reporting cars at or above ${Math.round(settings.lowSocThreshold * 100)}% battery now`,
      source: org.isDemo ? "simulated" : "live",
    },
    {
      key: "maintenance_readiness",
      label: "Maintenance readiness",
      value: active.length
        ? active.filter((v) => v.status !== "maintenance" && !maintOpen.has(v.id)).length / active.length
        : null,
      detail: "Cars not in maintenance and without an open maintenance issue",
      source: org.isDemo ? "simulated" : "live",
    },
    {
      key: "vendor_sla",
      label: "Vendor SLA compliance",
      value: completed.length
        ? completed.filter((t) => t.completed_at <= t.sla_due_at).length / completed.length
        : null,
      detail: `${completed.length} completed tickets, last 30 days`,
      source: org.isDemo ? "simulated" : "live",
    },
    {
      key: "incident_free",
      label: "Incident-free rides",
      value: org.isDemo && rideCount ? 1 - Math.min(autonomy.count ?? 0, rideCount) / rideCount : null,
      detail: "Rides without an autonomy incident, last 7 days",
      source: preview,
    },
  ];

  return {
    period,
    days: d,
    kpis,
    prev,
    availabilityTrend,
    availabilityTarget: settings.availabilityTarget,
    revenueVsCost,
    marginByHub,
    health,
    canSeeMoney,
    asOf: now.getTime(),
  };
}
