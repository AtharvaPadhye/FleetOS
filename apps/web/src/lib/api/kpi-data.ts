import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiProblem } from "./problem";
import type { CurrentRow, HoursRow, MoneyRow } from "./kpis";
import type { ResolvedPeriod } from "./period";

/** Loaders for the KPI routes. Everything runs as the user (RLS), and pages past the API's 1,000-row cap. */

const PAGE = 1000;

async function all<T>(
  fetch: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await fetch(from, from + PAGE - 1);
    if (error) throw new ApiProblem("internal", error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

export async function orgSettings(db: SupabaseClient, orgId: string) {
  const { data, error } = await db
    .from("orgs")
    .select("availability_target, low_soc_threshold, baseline_days")
    .eq("id", orgId)
    .single();
  if (error) throw new ApiProblem("internal", error.message);
  return {
    availabilityTarget: Number(data.availability_target),
    lowSocThreshold: Number(data.low_soc_threshold),
    baselineDays: Number(data.baseline_days),
  };
}

export const currentStates = (db: SupabaseClient, orgId: string) =>
  all<CurrentRow>((a, b) =>
    db
      .from("vehicle_list")
      .select("status, soc, connectivity, last_telemetry_at, lifecycle")
      .eq("org_id", orgId)
      .order("id")
      .range(a, b),
  );

export const hoursTotals = (db: SupabaseClient, orgId: string, fromDay: string, toDay: string) =>
  all<HoursRow>((a, b) =>
    db.rpc("vehicle_hours_totals", { p_org: orgId, p_from: fromDay, p_to: toDay }).order("vehicle_id").range(a, b),
  );

/** Org-wide totals by category (includes lines not tied to a vehicle). */
export const fleetMoney = (db: SupabaseClient, orgId: string, fromDay: string, toDay: string) =>
  all<{ category: string; amount_cents: number }>((a, b) =>
    db.rpc("ledger_totals", { p_org: orgId, p_from: fromDay, p_to: toDay }).order("category").range(a, b),
  ).then((rows): MoneyRow[] => rows.map((r) => ({ vehicle_id: null, ...r })));

export const vehicleMoney = (db: SupabaseClient, orgId: string, fromDay: string, toDay: string) =>
  all<MoneyRow>((a, b) =>
    db
      .rpc("ledger_vehicle_totals", { p_org: orgId, p_from: fromDay, p_to: toDay })
      .order("vehicle_id")
      .order("category")
      .range(a, b),
  );

const minusDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

/** The trailing baseline window ending with the period (org setting `baseline_days`, default 28). */
export const baselineWindow = (p: ResolvedPeriod, baselineDays: number) => ({
  fromDay: minusDays(p.toDay, baselineDays - 1),
  toDay: p.toDay,
});

export async function vehicleExists(db: SupabaseClient, orgId: string, id: string) {
  const { count } = await db
    .from("vehicles")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("id", id);
  return (count ?? 0) > 0;
}

export async function commissionedCount(db: SupabaseClient, orgId: string) {
  const { count } = await db
    .from("vehicles")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("lifecycle", "commissioned");
  return count ?? 0;
}
