import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import {
  isActiveException,
  openExceptionRiskCents,
  SEVERITY_RANK,
  type ExceptionClass,
  type ExceptionStatus,
  type Severity,
} from "@fleetos/domain";
import { ApiProblem } from "@/lib/api/problem";
import { localDay, localMidnight } from "@/lib/api/period";
import type { OrgContext } from "@/lib/api/handler";
import type {
  Exception,
  ExceptionCreate,
  ExceptionDetail,
  ExceptionRule,
  ExceptionRuleWrite,
  ExceptionSummary,
  EXCEPTION_SORTS,
} from "@/lib/api/schemas";

/**
 * Exceptions (task 5.4, PRD EX-1..5): one service behind /exceptions, the fleet list's open issues and
 * /api/v1/exceptions. Counts, badge and list come from the same rows, so they can't disagree (kpis.md §6 #1),
 * and revenue at risk has one formula everywhere (kpis.md §3.2, #3).
 */
export type ExceptionOut = z.infer<typeof Exception>;
export type ExceptionSort = (typeof EXCEPTION_SORTS)[number];

interface Row {
  id: string;
  vehicle_id: string | null;
  vehicle_number: string | null;
  hub_id: string | null;
  rule_id: string | null;
  type: string;
  class: ExceptionClass;
  severity: Severity;
  status: ExceptionStatus;
  title: string;
  description: string | null;
  detected_at: string;
  location_name: string | null;
  blocks_service: boolean;
  expected_downtime_min: number | null;
  baseline_rate_cents_per_h: number | null;
  recommended_action: {
    label?: string;
    vendor_id?: string | null;
    eta_min?: number | null;
    cost_cents?: number | null;
  } | null;
  owner_user_id: string | null;
  owner_name: string | null;
  trigger: Record<string, unknown> | null;
  resolved_at: string | null;
}
const COLUMNS =
  "id, vehicle_id, vehicle_number, hub_id, rule_id, type, class, severity, status, title, description, detected_at, location_name, blocks_service, expected_downtime_min, baseline_rate_cents_per_h, recommended_action, owner_user_id, owner_name, trigger, resolved_at";

/** Newest history kept in a listing; older exceptions stay reachable by id and in exports. */
const HISTORY_CAP = 2000;
const PAGE = 1000;
const iso = (t: string) => new Date(t).toISOString();
const int = (x: number | null | undefined) => (x === null || x === undefined ? null : Math.round(x));
export const personName = (name: string | null | undefined) => name?.trim() || "Team member";

export function toException(r: Row, now: Date): ExceptionOut {
  const active = isActiveException(r.status);
  const a = r.recommended_action;
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    vehicle: r.vehicle_id && r.vehicle_number ? { id: r.vehicle_id, number: r.vehicle_number } : null,
    hub_id: r.hub_id,
    type: r.type,
    class: r.class,
    severity: r.severity,
    status: r.status,
    detected_at: iso(r.detected_at),
    location_name: r.location_name,
    blocks_service: r.blocks_service,
    expected_downtime_min: r.expected_downtime_min,
    // Only open work has revenue at risk; a resolved exception's cost shows up as downtime instead.
    revenue_at_risk_cents: active
      ? openExceptionRiskCents({
          baselineRateCentsPerH: r.baseline_rate_cents_per_h,
          expectedDowntimeMin: r.expected_downtime_min,
          elapsedMin: (now.getTime() - new Date(r.detected_at).getTime()) / 60_000,
        })
      : null,
    recommended_action: a?.label
      ? { label: a.label, vendor_id: a.vendor_id ?? null, eta_min: int(a.eta_min), cost_cents: int(a.cost_cents) }
      : null,
    owner: r.owner_user_id ? { user_id: r.owner_user_id, name: personName(r.owner_name) } : null,
    ticket_id: null, // tickets arrive in task 5.5
    rule_id: r.rule_id,
    resolved_at: r.resolved_at ? iso(r.resolved_at) : null,
  };
}

async function rows(
  db: SupabaseClient,
  orgId: string,
  filter: { status?: ExceptionStatus[]; severity?: Severity[]; vehicleId?: string },
): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; from < HISTORY_CAP; from += PAGE) {
    let q = db
      .from("exception_list")
      .select(COLUMNS)
      .eq("org_id", orgId)
      .order("detected_at", { ascending: false })
      .order("id")
      .range(from, Math.min(from + PAGE, HISTORY_CAP) - 1);
    if (filter.status?.length) q = q.in("status", filter.status);
    if (filter.severity?.length) q = q.in("severity", filter.severity);
    if (filter.vehicleId) q = q.eq("vehicle_id", filter.vehicleId);
    const { data, error } = await q;
    if (error) throw new ApiProblem("internal", error.message);
    out.push(...((data ?? []) as Row[]));
    if ((data ?? []).length < PAGE) break;
  }
  return out;
}

/** Summary over the whole org (not the filters): the badge, the counts and the list always agree. */
export async function exceptionSummary(
  db: SupabaseClient,
  org: Pick<OrgContext, "id" | "timezone">,
  now = new Date(),
): Promise<z.infer<typeof ExceptionSummary>> {
  const midnight = localMidnight(localDay(now, org.timezone), org.timezone).toISOString();
  const [active, resolved] = await Promise.all([
    rows(db, org.id, { status: ["open", "assigned", "in_progress"] }),
    db
      .from("exceptions")
      .select("id", { count: "exact", head: true })
      .eq("org_id", org.id)
      .eq("status", "resolved")
      .gte("resolved_at", midnight),
  ]);
  const items = active.map((r) => toException(r, now));
  const by_severity = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const i of items) by_severity[i.severity] += 1;
  return {
    active: items.length,
    by_severity,
    resolved_today: resolved.count ?? 0,
    revenue_at_risk_cents: items.reduce((s, i) => s + (i.revenue_at_risk_cents ?? 0), 0),
  };
}

export interface ExceptionQuery {
  status?: ExceptionStatus[];
  severity?: Severity[];
  vehicle_id?: string;
  sort: ExceptionSort | `-${ExceptionSort}`;
  limit: number;
  offset: number;
}

export async function listExceptions(
  db: SupabaseClient,
  org: Pick<OrgContext, "id" | "timezone">,
  query: ExceptionQuery,
  now = new Date(),
) {
  const [list, summary] = await Promise.all([
    rows(db, org.id, { status: query.status, severity: query.severity, vehicleId: query.vehicle_id }),
    exceptionSummary(db, org, now),
  ]);
  const items = list.map((r) => toException(r, now));
  const field = query.sort.replace(/^-/, "") as ExceptionSort;
  const desc = query.sort.startsWith("-");
  const at = (i: ExceptionOut) => new Date(i.detected_at).getTime();
  const cmp = (a: ExceptionOut, b: ExceptionOut): number => {
    switch (field) {
      case "detected_at":
        return at(a) - at(b);
      case "severity":
        // Most severe first, then open before closed, newest first.
        return (
          SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
          Number(isActiveException(b.status)) - Number(isActiveException(a.status)) ||
          at(b) - at(a)
        );
      case "revenue_at_risk":
        return (a.revenue_at_risk_cents ?? -1) - (b.revenue_at_risk_cents ?? -1) || at(b) - at(a);
    }
  };
  items.sort((a, b) => (desc ? -cmp(a, b) : cmp(a, b)));
  return {
    items: items.slice(query.offset, query.offset + query.limit),
    total: items.length,
    summary,
    asOf: now.getTime(),
  };
}

/** One exception without its history (what POST and PATCH return). */
export async function getExceptionOut(
  db: SupabaseClient,
  org: Pick<OrgContext, "id">,
  id: string,
  now = new Date(),
): Promise<ExceptionOut> {
  const { data, error } = await db
    .from("exception_list")
    .select(COLUMNS)
    .eq("org_id", org.id)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new ApiProblem("internal", error.message);
  if (!data) throw new ApiProblem("not_found", "No such exception.");
  return toException(data as Row, now);
}

export async function getException(
  db: SupabaseClient,
  org: Pick<OrgContext, "id">,
  id: string,
  now = new Date(),
): Promise<z.infer<typeof ExceptionDetail>> {
  const [{ data, error }, events] = await Promise.all([
    db.from("exception_list").select(COLUMNS).eq("org_id", org.id).eq("id", id).maybeSingle(),
    db
      .from("exception_events")
      .select("at, kind, actor_user_id, from_status, to_status, note")
      .eq("org_id", org.id)
      .eq("exception_id", id)
      .order("at")
      .order("id")
      .limit(500),
  ]);
  if (error || events.error) throw new ApiProblem("internal", (error ?? events.error)!.message);
  if (!data) throw new ApiProblem("not_found", "No such exception.");
  const ev = (events.data ?? []) as {
    at: string;
    kind: "opened" | "status" | "owner" | "cleared";
    actor_user_id: string | null;
    from_status: ExceptionStatus | null;
    to_status: ExceptionStatus | null;
    note: string | null;
  }[];
  // Owner changes store the new owner's id as the note; show names instead.
  const people = [...new Set(ev.flatMap((e) => [e.actor_user_id, e.kind === "owner" ? e.note : null]))].filter(
    (x): x is string => !!x,
  );
  const { data: profiles } = people.length
    ? await db.from("profiles").select("user_id, full_name").in("user_id", people)
    : { data: [] };
  const name = new Map(
    ((profiles ?? []) as { user_id: string; full_name: string | null }[]).map((p) => [p.user_id, p.full_name]),
  );
  const row = data as Row;
  return {
    ...toException(row, now),
    trigger: row.trigger,
    events: ev.map((e) => ({
      at: iso(e.at),
      kind: e.kind,
      actor: e.actor_user_id ? { user_id: e.actor_user_id, name: personName(name.get(e.actor_user_id)) } : null,
      from_status: e.from_status,
      to_status: e.to_status,
      note: e.kind === "owner" ? (e.note ? `Assigned to ${personName(name.get(e.note))}` : "Unassigned") : e.note,
    })),
  };
}

export async function createException(
  db: SupabaseClient,
  org: Pick<OrgContext, "id">,
  input: z.infer<typeof ExceptionCreate>,
): Promise<string> {
  const cls = input.class ?? "other";
  const { data, error } = await db
    .from("exceptions")
    .insert({
      org_id: org.id,
      vehicle_id: input.vehicle_id ?? null,
      type: input.type,
      title: input.title ?? input.type.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase()),
      class: cls,
      severity: input.severity,
      description: input.description || null,
      blocks_service: input.blocks_service ?? false,
      expected_downtime_min: MANUAL_DOWNTIME_MIN[cls],
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23503") throw new ApiProblem("validation_failed", "No such vehicle in this organization.");
    if (error.code === "42501") throw new ApiProblem("forbidden", "Only owners, admins and ops can report exceptions.");
    throw new ApiProblem("internal", error.message);
  }
  return (data as { id: string }).id;
}

/** Default expected downtime for manual reports until history exists for the type (kpis.md §3.2). */
const MANUAL_DOWNTIME_MIN: Record<ExceptionClass, number> = {
  incident: 180,
  maintenance: 240,
  cleaning: 45,
  charging: 60,
  other: 60,
};

export async function updateException(
  db: SupabaseClient,
  org: Pick<OrgContext, "id">,
  id: string,
  input: { status?: ExceptionStatus; owner_user_id?: string | null; note?: string },
) {
  const { error } = await db.rpc("update_exception", {
    p_org: org.id,
    p_id: id,
    p_status: input.status ?? null,
    p_set_owner: input.owner_user_id !== undefined,
    p_owner: input.owner_user_id ?? null,
    p_note: input.note || null,
  });
  if (error) {
    if (error.code === "P0002") throw new ApiProblem("not_found", "No such exception.");
    if (error.code === "22023") throw new ApiProblem("validation_failed", error.message);
    throw new ApiProblem("internal", error.message);
  }
}

/** Open issues per vehicle, most severe first (fleet list "open issue" and "next action", PRD FL-1). */
export async function openIssuesByVehicle(db: SupabaseClient, orgId: string, now = new Date()) {
  const list = await rows(db, orgId, { status: ["open", "assigned", "in_progress"] });
  const out = new Map<string, ExceptionOut>();
  for (const e of list
    .map((r) => toException(r, now))
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])) {
    if (e.vehicle && !out.has(e.vehicle.id)) out.set(e.vehicle.id, e);
  }
  return out;
}

// Rules (PRD EX-5). The editor UI lands with Settings (task 5.10); the API is here.
export type RuleOut = z.infer<typeof ExceptionRule>;
const RULE_COLUMNS =
  "id, key, name, condition, class, severity, blocks_service, recommended_action, auto_actions, auto_resolve, enabled, is_system";

function ruleError(error: { code?: string; message: string }): never {
  if (error.code === "23505") throw new ApiProblem("conflict", "A rule with that key already exists.");
  if (error.code === "42501") throw new ApiProblem("forbidden", "Only owners and admins can change rules.");
  if (error.code === "22023") throw new ApiProblem("validation_failed", error.message);
  throw new ApiProblem("internal", error.message);
}

export async function listRules(db: SupabaseClient, orgId: string): Promise<RuleOut[]> {
  const { data, error } = await db
    .from("exception_rules")
    .select(RULE_COLUMNS)
    .eq("org_id", orgId)
    .order("is_system", { ascending: false })
    .order("name");
  if (error) ruleError(error);
  return data as RuleOut[];
}

export async function createRule(
  db: SupabaseClient,
  orgId: string,
  input: z.infer<typeof ExceptionRuleWrite>,
): Promise<RuleOut> {
  const missing = (["key", "name", "condition", "class", "severity"] as const).filter((k) => input[k] === undefined);
  if (missing.length) throw new ApiProblem("validation_failed", `A new rule needs: ${missing.join(", ")}.`);
  const { data, error } = await db
    .from("exception_rules")
    .insert({ org_id: orgId, recommended_action: { label: "Investigate" }, ...input })
    .select(RULE_COLUMNS)
    .single();
  if (error) ruleError(error);
  return data as RuleOut;
}

export async function updateRule(
  db: SupabaseClient,
  orgId: string,
  id: string,
  input: z.infer<typeof ExceptionRuleWrite>,
): Promise<RuleOut> {
  const { data, error } = await db
    .from("exception_rules")
    .update(input)
    .eq("org_id", orgId)
    .eq("id", id)
    .select(RULE_COLUMNS);
  if (error) ruleError(error);
  if (!data?.length) throw new ApiProblem("not_found", "No such rule.");
  return data[0] as RuleOut;
}

export async function deleteRule(db: SupabaseClient, orgId: string, id: string) {
  const { data: rule } = await db
    .from("exception_rules")
    .select("is_system")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (!rule) throw new ApiProblem("not_found", "No such rule.");
  if (rule.is_system) throw new ApiProblem("conflict", "System rules can be disabled, not deleted.");
  const { data, error } = await db.from("exception_rules").delete().eq("org_id", orgId).eq("id", id).select("id");
  if (error) ruleError(error);
  if (!data?.length) throw new ApiProblem("forbidden", "Only owners and admins can delete rules.");
}
