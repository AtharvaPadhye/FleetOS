import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { VehicleStatus } from "@fleetos/domain";
import { ApiProblem } from "@/lib/api/problem";
import { localMidnight } from "@/lib/api/period";

/**
 * A vehicle's day as one timeline (PRD VD-5): status changes, alerts starting and clearing, charging sessions,
 * cabin and autonomy events, and service costs, newest first. Money items only for money roles (ledger RLS).
 */
export type TimelineItem =
  | { kind: "status"; at: string; from: VehicleStatus | null; to: VehicleStatus; cause: string; detail: string | null }
  | { kind: "alert"; at: string; name: string; phase: "started" | "cleared" }
  | {
      kind: "charge";
      at: string;
      phase: "started" | "finished";
      energyKwh: number | null;
      costCents: number | null;
      hub: string | null;
    }
  | { kind: "cabin"; at: string; eventKind: string; confidence: number | null }
  | { kind: "autonomy"; at: string; eventKind: string; severity: string | null; detail: string | null }
  | { kind: "cost"; at: string; category: string; amountCents: number; note: string | null };

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

async function q<T>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await p;
  if (error) throw new ApiProblem("internal", error.message);
  return (data ?? []) as T[];
}

export async function vehicleTimeline(
  db: SupabaseClient,
  org: { id: string; timezone: string },
  vehicleId: string,
  day: string,
): Promise<TimelineItem[]> {
  const from = localMidnight(day, org.timezone).toISOString();
  const to = localMidnight(addDays(day, 1), org.timezone).toISOString();
  const base = (table: string, cols: string) =>
    db.from(table).select(cols).eq("org_id", org.id).eq("vehicle_id", vehicleId);
  const [status, alerts, charges, cabin, autonomy, costs, hubs] = await Promise.all([
    q<{
      at: string;
      from_status: VehicleStatus | null;
      to_status: VehicleStatus;
      cause_type: string;
      detail: string | null;
    }>(
      base("vehicle_status_events", "at, from_status, to_status, cause_type, detail")
        .gte("at", from)
        .lt("at", to)
        .limit(500),
    ),
    q<{ name: string; started_at: string; ended_at: string | null }>(
      base("vehicle_alerts", "name, started_at, ended_at")
        .or(`and(started_at.gte."${from}",started_at.lt."${to}"),and(ended_at.gte."${from}",ended_at.lt."${to}")`)
        .limit(500),
    ),
    q<{
      started_at: string;
      ended_at: string | null;
      energy_kwh: number | string;
      cost_cents: number | string;
      hub_id: string | null;
    }>(
      base("charging_sessions", "started_at, ended_at, energy_kwh, cost_cents, hub_id")
        .or(`and(started_at.gte."${from}",started_at.lt."${to}"),and(ended_at.gte."${from}",ended_at.lt."${to}")`)
        .limit(200),
    ),
    q<{ at: string; kind: string; confidence: number | string | null }>(
      base("cabin_events", "at, kind, confidence").gte("at", from).lt("at", to).limit(200),
    ),
    q<{ at: string; kind: string; severity: string | null; detail: string | null }>(
      base("autonomy_events", "at, kind, severity, detail").gte("at", from).lt("at", to).limit(200),
    ),
    q<{ occurred_at: string | null; category: string; amount_cents: number | string; note: string | null }>(
      base("ledger_entries", "occurred_at, category, amount_cents, note")
        .eq("occurred_on", day)
        .in("category", ["cleaning", "maintenance", "roadside"])
        .limit(200),
    ),
    q<{ id: string; name: string }>(db.from("hubs").select("id, name").eq("org_id", org.id)),
  ]);
  const hubName = new Map(hubs.map((h) => [h.id, h.name]));
  const inDay = (t: string | null) => t !== null && t >= from && t < to;
  const items: TimelineItem[] = [
    ...status.map((s) => ({
      kind: "status" as const,
      at: s.at,
      from: s.from_status,
      to: s.to_status,
      cause: s.cause_type,
      detail: s.detail,
    })),
    ...alerts.flatMap((a) => [
      ...(inDay(a.started_at)
        ? [{ kind: "alert" as const, at: a.started_at, name: a.name, phase: "started" as const }]
        : []),
      ...(inDay(a.ended_at)
        ? [{ kind: "alert" as const, at: a.ended_at!, name: a.name, phase: "cleared" as const }]
        : []),
    ]),
    ...charges.flatMap((c) => [
      ...(inDay(c.started_at)
        ? [
            {
              kind: "charge" as const,
              at: c.started_at,
              phase: "started" as const,
              energyKwh: null,
              costCents: null,
              hub: c.hub_id ? (hubName.get(c.hub_id) ?? null) : null,
            },
          ]
        : []),
      ...(inDay(c.ended_at)
        ? [
            {
              kind: "charge" as const,
              at: c.ended_at!,
              phase: "finished" as const,
              energyKwh: Number(c.energy_kwh),
              costCents: Number(c.cost_cents),
              hub: c.hub_id ? (hubName.get(c.hub_id) ?? null) : null,
            },
          ]
        : []),
    ]),
    ...cabin.map((c) => ({
      kind: "cabin" as const,
      at: c.at,
      eventKind: c.kind,
      confidence: c.confidence === null ? null : Number(c.confidence),
    })),
    ...autonomy.map((a) => ({
      kind: "autonomy" as const,
      at: a.at,
      eventKind: a.kind,
      severity: a.severity,
      detail: a.detail,
    })),
    ...costs
      .filter((c) => c.occurred_at)
      .map((c) => ({
        kind: "cost" as const,
        at: c.occurred_at!,
        category: c.category,
        amountCents: Number(c.amount_cents),
        note: c.note,
      })),
  ];
  return items
    .map((i) => ({ ...i, at: new Date(i.at).toISOString() }))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/** Alert history and service costs for the Service tab (tickets join in task 5.5). */
export async function vehicleServiceHistory(db: SupabaseClient, orgId: string, vehicleId: string, sinceDay: string) {
  const [alerts, costs] = await Promise.all([
    q<{ id: string; name: string; started_at: string; ended_at: string | null; source: string }>(
      db
        .from("vehicle_alerts")
        .select("id, name, started_at, ended_at, source")
        .eq("org_id", orgId)
        .eq("vehicle_id", vehicleId)
        .order("started_at", { ascending: false })
        .limit(50),
    ),
    q<{
      occurred_on: string;
      occurred_at: string | null;
      category: string;
      amount_cents: number | string;
      note: string | null;
      source: string;
    }>(
      db
        .from("ledger_entries")
        .select("occurred_on, occurred_at, category, amount_cents, note, source")
        .eq("org_id", orgId)
        .eq("vehicle_id", vehicleId)
        .in("category", ["cleaning", "maintenance", "roadside"])
        .gte("occurred_on", sinceDay)
        .order("occurred_on", { ascending: false })
        .limit(100),
    ),
  ]);
  return { alerts, costs: costs.map((c) => ({ ...c, amount_cents: Number(c.amount_cents) })) };
}
