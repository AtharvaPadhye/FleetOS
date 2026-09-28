import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assetHealthGrade,
  availability,
  covenantStatus,
  hourTotals,
  median,
  type CovenantOperator,
} from "@fleetos/domain";
import { ApiProblem } from "@/lib/api/problem";
import { toHours } from "@/lib/api/kpis";
import { localDay, localMidnight } from "@/lib/api/period";
import type { OrgContext } from "@/lib/api/handler";
import { buildStatement } from "@/lib/statement";
import type { ReportData } from "@/lib/report-data";
import { financials } from "./financials";
import { getFleetKpis } from "./kpis";

/**
 * Monthly asset performance reports (task 5.9, PRD RP-1..RP-5): a frozen snapshot built from the same services
 * as Financials and Overview, so the report and the screens agree for that month.
 */
type Org = Pick<OrgContext, "id" | "role" | "timezone" | "isDemo">;
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const lastDay = (month: string) => addDays(`${addDays(`${month}-28`, 4).slice(0, 7)}-01`, -1);

export async function buildReport(db: SupabaseClient, org: Org, month: string, now = new Date()): Promise<ReportData> {
  const today = localDay(now, org.timezone);
  if (`${month}-01` > today) throw new ApiProblem("validation_failed", "That month hasn't started yet.");
  const preliminary = lastDay(month) >= today;
  const toDay = preliminary ? today : lastDay(month);
  const range = {
    from: localMidnight(`${month}-01`, org.timezone).toISOString(),
    to: localMidnight(addDays(toDay, 1), org.timezone).toISOString(),
  };
  const [fin, kpis, orgRow, days, covenants, tickets, jobs, incidents, autonomy, rides] = await Promise.all([
    financials(db, org, range, now),
    getFleetKpis(db, org, range),
    db.from("orgs").select("name").eq("id", org.id).single(),
    db
      .from("fleet_day_hours")
      .select("*")
      .eq("org_id", org.id)
      .gte("day", `${month}-01`)
      .lte("day", toDay)
      .order("day"),
    db.from("covenants").select("metric, operator, threshold, label").eq("org_id", org.id),
    db
      .from("tickets")
      .select("type, created_at, completed_at, sla_due_at, actual_cost_cents")
      .eq("org_id", org.id)
      .gte("created_at", range.from)
      .lt("created_at", range.to)
      .limit(20_000),
    db
      .from("vendor_jobs")
      .select("vendor_id, cost_cents, completed_at, vendors(name), tickets(sla_due_at, completed_at)")
      .eq("org_id", org.id)
      .gte("dispatched_at", range.from)
      .lt("dispatched_at", range.to)
      .is("cancelled_at", null)
      .limit(20_000),
    db
      .from("exceptions")
      .select("id", { count: "exact", head: true })
      .eq("org_id", org.id)
      .eq("class", "incident")
      .gte("detected_at", range.from)
      .lt("detected_at", range.to),
    db
      .from("autonomy_events")
      .select("id", { count: "exact", head: true })
      .eq("org_id", org.id)
      .eq("kind", "incident")
      .gte("at", range.from)
      .lt("at", range.to),
    db.rpc("ride_totals", { p_org: org.id, p_from: range.from, p_to: range.to }),
  ]);
  const err = orgRow.error ?? days.error ?? covenants.error ?? tickets.error ?? jobs.error;
  if (err) throw new ApiProblem("internal", err.message);

  const k = fin.kpis;
  const statement = buildStatement(fin.money.map((m) => ({ category: m.category, amount_cents: m.amount_cents })));

  // Maintenance: service tickets opened in the month.
  const tk = (tickets.data ?? []) as {
    type: string;
    created_at: string;
    completed_at: string | null;
    sla_due_at: string | null;
    actual_cost_cents: number | null;
  }[];
  const done = tk.filter((t) => t.completed_at && t.sla_due_at);
  const slaCompliance = done.length ? done.filter((t) => t.completed_at! <= t.sla_due_at!).length / done.length : null;

  // Incidents need autonomy data (RP-5); without it they're "not yet tracked", never zero.
  const tracked = org.isDemo; // autonomy_events is simulated in demo orgs, unavailable elsewhere until Phase 4+
  const rideCount = Number(((rides.data ?? []) as { rides: number }[])[0]?.rides ?? 0);
  const perTenK = tracked && rideCount ? ((autonomy.count ?? 0) / rideCount) * 10_000 : null;

  // Vendors.
  const byVendor = new Map<string, { name: string; costs: number[]; met: number; completed: number; jobs: number }>();
  for (const j of (jobs.data ?? []) as unknown as {
    vendor_id: string;
    cost_cents: number | null;
    completed_at: string | null;
    vendors: { name: string } | null;
    tickets: { sla_due_at: string | null; completed_at: string | null } | null;
  }[]) {
    const v = byVendor.get(j.vendor_id) ?? {
      name: j.vendors?.name ?? "Vendor",
      costs: [],
      met: 0,
      completed: 0,
      jobs: 0,
    };
    v.jobs++;
    if (j.cost_cents !== null) v.costs.push(j.cost_cents);
    if (j.completed_at && j.tickets?.sla_due_at) {
      v.completed++;
      if (j.tickets.completed_at && j.tickets.completed_at <= j.tickets.sla_due_at) v.met++;
    }
    byVendor.set(j.vendor_id, v);
  }

  // Hubs from the vehicle P&L rows.
  const hubs = new Map<string, { revenue: number; contribution: number; cars: number }>();
  for (const r of fin.rows) {
    if (!r.hub) continue;
    const h = hubs.get(r.hub) ?? { revenue: 0, contribution: 0, cars: 0 };
    h.revenue += r.revenue_cents;
    h.contribution += r.contribution_cents;
    h.cars++;
    hubs.set(r.hub, h);
  }

  // Covenants (RP-2) and grade (kpis.md §3.7).
  const values: Record<string, number | null> = {
    uptime: kpis.uptime,
    availability: kpis.availability,
    contribution_margin: k.contribution_margin,
    vendor_sla: slaCompliance,
    incidents_per_10k_rides: perTenK,
  };
  const cov = (
    (covenants.data ?? []) as {
      metric: string;
      operator: CovenantOperator;
      threshold: number | string;
      label: string;
    }[]
  ).map((c) => ({
    label: c.label,
    metric: c.metric,
    value: values[c.metric] ?? null,
    threshold: Number(c.threshold),
    operator: c.operator,
    status: covenantStatus(
      values[c.metric] ?? null,
      c.operator,
      Number(c.threshold),
      c.metric === "incidents_per_10k_rides" ? "value" : "ratio",
    ),
  }));
  const threshold = (m: string, fallback: number) => cov.find((c) => c.metric === m)?.threshold ?? fallback;
  const reserve = k.maintenance_reserve_cents;
  const grade =
    kpis.uptime !== null && k.contribution_margin !== null
      ? assetHealthGrade({
          uptime: kpis.uptime,
          uptimeCovenant: threshold("uptime", 0.94),
          contributionMargin: k.contribution_margin,
          marginTarget: threshold("contribution_margin", 0.5),
          // Funded = the reserve accrued this period covers the maintenance actually spent.
          reserveFunded: reserve > 0 ? Math.min(1, reserve / Math.max(1, k.maintenance_spent_cents)) : null,
          incidentsPer10k: perTenK,
          incidentTargetPer10k: threshold("incidents_per_10k_rides", 2.5),
          vendorSla: slaCompliance ?? 0.9,
        })
      : null;

  const risks = [
    ...cov.filter((c) => c.status === "breach").map((c) => `Breached: ${c.label}.`),
    ...cov.filter((c) => c.status === "at_risk").map((c) => `Close to the limit: ${c.label}.`),
    ...fin.insights.slice(0, 3).map((i) => i.title),
    ...(preliminary ? ["Preliminary: the month hasn't closed, so figures will change."] : []),
  ];
  const labels = { strong: 0, monitor: 0, review: 0 };
  for (const r of fin.rows) if (r.label) labels[r.label]++;
  const earning = fin.rows.filter((r) => r.revenue_cents > 0).sort((a, b) => b.revenue_cents - a.revenue_cents);
  const pick = (r: (typeof fin.rows)[number]) => ({
    number: r.number,
    revenue_cents: r.revenue_cents,
    margin: r.margin,
  });
  const maintenanceHours = ((days.data ?? []) as { maintenance_h: number | string }[]).reduce(
    (s, d) => s + Number(d.maintenance_h),
    0,
  );
  return {
    org_name: (orgRow.data as { name: string }).name,
    month,
    period: { from: `${month}-01`, to: toDay },
    preliminary,
    data_source: org.isDemo ? "simulated" : "live",
    summary: {
      revenue_cents: k.gross_revenue_cents,
      contribution_cents: k.contribution_cents,
      contribution_margin: k.contribution_margin,
      net_contribution_cents: k.net_contribution_cents,
      availability: kpis.availability,
      uptime: kpis.uptime,
      fleet_size: kpis.total_vehicles,
      revenue_per_vehicle_cents: k.revenue_per_vehicle_cents,
      downtime_cost_cents: k.downtime_cost_cents,
    },
    grade: grade
      ? { letter: grade.letter, score: Math.round(grade.score * 10) / 10, components: grade.components }
      : null,
    covenants: cov,
    availability_by_day: ((days.data ?? []) as (Parameters<typeof toHours>[0] & { day: string })[]).map((d) => ({
      day: d.day,
      availability: availability(hourTotals(toHours(d))),
    })),
    pnl: statement.rows.map((r) => ({
      label: r.label,
      cents: r.cents,
      kind: r.kind,
      share: r.kind === "line" ? r.share : r.margin,
    })),
    vehicles: { labels, top: earning.slice(0, 5).map(pick), bottom: earning.slice(-5).reverse().map(pick) },
    maintenance: {
      tickets: tk.length,
      cost_cents: tk.reduce((s, t) => s + (t.actual_cost_cents ?? 0), 0),
      sla_compliance: slaCompliance,
      median_resolution_min: median(done.map((t) => (Date.parse(t.completed_at!) - Date.parse(t.created_at)) / 60_000)),
      downtime_hours: Math.round(maintenanceHours * 10) / 10,
    },
    incidents: {
      tracked,
      exceptions: incidents.count ?? 0,
      autonomy_incidents: tracked ? (autonomy.count ?? 0) : null,
      rides: tracked ? rideCount : null,
      per_10k_rides: perTenK === null ? null : Math.round(perTenK * 100) / 100,
    },
    vendors: [...byVendor.values()]
      .map((v) => ({
        name: v.name,
        jobs: v.jobs,
        avg_cost_cents: v.costs.length ? Math.round(v.costs.reduce((a, b) => a + b, 0) / v.costs.length) : null,
        sla_compliance: v.completed ? v.met / v.completed : null,
      }))
      .sort((a, b) => b.jobs - a.jobs),
    hubs: [...hubs]
      .map(([name, h]) => ({
        name,
        revenue_cents: h.revenue,
        margin: h.revenue ? h.contribution / h.revenue : null,
        cars: h.cars,
      }))
      .sort((a, b) => b.revenue_cents - a.revenue_cents),
    risks,
  };
}

export async function generateReport(db: SupabaseClient, org: Org, month: string, now = new Date()) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new ApiProblem("validation_failed", "Use a month like 2026-08.");
  const data = await buildReport(db, org, month, now);
  const { data: row, error } = await db
    .from("reports")
    .insert({
      org_id: org.id,
      month,
      version: 0,
      preliminary: data.preliminary,
      grade: data.grade?.letter ?? null,
      data,
    })
    .select("id, version")
    .single();
  if (error) throw new ApiProblem(error.code === "42501" ? "forbidden" : "internal", error.message);
  return row as { id: string; version: number };
}

export interface ReportSummary {
  id: string;
  month: string;
  version: number;
  status: "generating" | "ready" | "failed";
  grade: string | null;
  generated_at: string | null;
  preliminary: boolean;
}

/** The list/API shape of a report row: no snapshot, timestamps in ISO form. */
export const summarize = (r: ReportSummary): ReportSummary => ({
  id: r.id,
  month: r.month,
  version: r.version,
  status: r.status,
  grade: r.grade,
  generated_at: r.generated_at ? new Date(r.generated_at).toISOString() : null,
  preliminary: r.preliminary,
});

export async function listReports(db: SupabaseClient, org: Pick<Org, "id">): Promise<ReportSummary[]> {
  const { data, error } = await db
    .from("reports")
    .select("id, month, version, status, grade, generated_at, preliminary")
    .eq("org_id", org.id)
    .order("month", { ascending: false })
    .order("version", { ascending: false })
    .limit(500);
  if (error) throw new ApiProblem("internal", error.message);
  return ((data ?? []) as ReportSummary[]).map(summarize);
}

export async function getReport(db: SupabaseClient, org: Pick<Org, "id">, id: string) {
  const { data, error } = await db
    .from("reports")
    .select("id, month, version, status, grade, generated_at, preliminary, data, pdf_path")
    .eq("org_id", org.id)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new ApiProblem("internal", error.message);
  if (!data) throw new ApiProblem("not_found", "No such report.");
  return data as ReportSummary & { data: ReportData; pdf_path: string | null };
}

export async function listShares(db: SupabaseClient, org: Pick<Org, "id">, reportId: string) {
  const { data, error } = await db
    .from("report_shares")
    .select("id, recipient, expires_at, revoked_at, created_at")
    .eq("org_id", org.id)
    .eq("report_id", reportId)
    .eq("internal", false)
    .order("created_at", { ascending: false });
  if (error) throw new ApiProblem("internal", error.message);
  return (data ?? []) as {
    id: string;
    recipient: string;
    expires_at: string;
    revoked_at: string | null;
    created_at: string;
  }[];
}

/** RP-4: an expiring read-only link for a recipient (the raw token is only in the URL). */
export async function shareReport(
  db: SupabaseClient,
  org: Pick<Org, "id">,
  reportId: string,
  input: { recipient: string; days: number; origin: string; internal?: boolean },
) {
  const { data, error } = await db.rpc("create_report_share", {
    p_org: org.id,
    p_report: reportId,
    p_recipient: input.recipient,
    p_days: input.days,
    p_internal: input.internal ?? false,
  });
  if (error) {
    if (error.code === "42501") throw new ApiProblem("forbidden", error.message);
    if (error.code === "P0002") throw new ApiProblem("not_found", error.message);
    throw new ApiProblem(error.code === "22023" ? "validation_failed" : "internal", error.message);
  }
  const row = ((data ?? []) as { id: string; token: string; expires_at: string }[])[0]!;
  return {
    id: row.id,
    url: `${input.origin}/r/${row.token}`,
    token: row.token,
    recipient: input.recipient,
    expires_at: new Date(row.expires_at).toISOString(),
  };
}

export async function revokeShare(db: SupabaseClient, org: Pick<Org, "id">, reportId: string, shareId: string) {
  const { data, error } = await db
    .from("report_shares")
    .update({ revoked_at: new Date().toISOString() })
    .eq("org_id", org.id)
    .eq("report_id", reportId)
    .eq("id", shareId)
    .is("revoked_at", null)
    .select("id");
  if (error) throw new ApiProblem("internal", error.message);
  if (!data?.length) throw new ApiProblem("not_found", "No such active share.");
}

/** The public side (/r/[token]): the snapshot and its recipient, or null for unknown, expired or revoked links. */
export async function sharedReport(db: SupabaseClient, token: string) {
  if (!/^[0-9a-f]{48}$/.test(token)) return null;
  const { data, error } = await db.rpc("shared_report", { p_token: token });
  if (error) throw new ApiProblem("internal", error.message);
  const row = (
    (data ?? []) as {
      report_id: string;
      org_name: string;
      month: string;
      version: number;
      preliminary: boolean;
      grade: string | null;
      data: ReportData;
      generated_at: string;
      recipient: string;
      expires_at: string;
    }[]
  )[0];
  return row ?? null;
}

export interface CovenantRow {
  id: string;
  metric: "uptime" | "availability" | "contribution_margin" | "vendor_sla" | "incidents_per_10k_rides";
  operator: CovenantOperator;
  threshold: number;
  label: string;
}

/** RP-2: the lender's covenant thresholds the report checks. */
export async function listCovenants(db: SupabaseClient, org: Pick<Org, "id">): Promise<CovenantRow[]> {
  const { data, error } = await db
    .from("covenants")
    .select("id, metric, operator, threshold, label")
    .eq("org_id", org.id)
    .order("metric");
  if (error) throw new ApiProblem("internal", error.message);
  return ((data ?? []) as CovenantRow[]).map((c) => ({ ...c, threshold: Number(c.threshold) }));
}

const COVENANT_LABEL: Record<string, (t: number, op: string) => string> = {
  uptime: (t, op) => `Uptime ${op.startsWith(">") ? "at least" : "at most"} ${Math.round(t * 1000) / 10}%`,
  availability: (t, op) => `Availability ${op.startsWith(">") ? "at least" : "at most"} ${Math.round(t * 1000) / 10}%`,
  contribution_margin: (t, op) =>
    `Contribution margin ${op.startsWith(">") ? "at least" : "at most"} ${Math.round(t * 1000) / 10}%`,
  vendor_sla: (t, op) =>
    `Vendor SLA compliance ${op.startsWith(">") ? "at least" : "at most"} ${Math.round(t * 1000) / 10}%`,
  incidents_per_10k_rides: (t, op) => `Incidents ${op.startsWith("<") ? "at most" : "at least"} ${t} per 10,000 rides`,
};

/** Replace the org's covenants (owner/admin); one per metric. Existing reports keep the covenants they were built with. */
export async function saveCovenants(
  db: SupabaseClient,
  org: Pick<Org, "id">,
  rows: { metric: CovenantRow["metric"]; operator: CovenantOperator; threshold: number; label?: string }[],
): Promise<CovenantRow[]> {
  const metrics = rows.map((r) => r.metric);
  if (new Set(metrics).size !== metrics.length) throw new ApiProblem("validation_failed", "One covenant per metric.");
  for (const r of rows)
    if (r.metric !== "incidents_per_10k_rides" && (r.threshold < 0 || r.threshold > 1))
      throw new ApiProblem("validation_failed", `${r.metric} is a fraction between 0 and 1.`);
  const del = db.from("covenants").delete().eq("org_id", org.id);
  const { error: delError } = metrics.length ? await del.not("metric", "in", `(${metrics.join(",")})`) : await del;
  if (delError) throw new ApiProblem(delError.code === "42501" ? "forbidden" : "internal", delError.message);
  if (rows.length) {
    const { error } = await db.from("covenants").upsert(
      rows.map((r) => ({
        org_id: org.id,
        metric: r.metric,
        operator: r.operator,
        threshold: r.threshold,
        label: r.label?.trim() || COVENANT_LABEL[r.metric]!(r.threshold, r.operator),
      })),
      { onConflict: "org_id,metric" },
    );
    if (error) throw new ApiProblem(error.code === "42501" ? "forbidden" : "internal", error.message);
  }
  return listCovenants(db, org);
}
