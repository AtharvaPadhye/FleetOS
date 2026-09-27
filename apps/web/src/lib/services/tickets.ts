import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isActiveTicket,
  median,
  revenueRecoveredCents,
  slaState,
  TICKET_TYPE_FOR_CLASS,
  VENDOR_CATEGORIES_FOR,
  type ExceptionClass,
  type SlaState,
  type TicketAction,
  type TicketStatus,
  type TicketType,
} from "@fleetos/domain";
import { ApiProblem } from "@/lib/api/problem";
import { localDay, localMidnight } from "@/lib/api/period";
import type { OrgContext } from "@/lib/api/handler";
import { personName } from "./exceptions";
import { rankForVehicle } from "./vendors";

/**
 * Service tickets (task 5.5, PRD SV-1..6, EX-4, VD-8): one service behind /service, the exception drawer, the
 * vehicle page and /api/v1/tickets. State changes go through database functions (ticket_create /
 * ticket_action) that enforce the lifecycle, log every step and post the ledger line on completion.
 */
interface Row {
  id: string;
  number: string;
  vehicle_id: string;
  vehicle_number: string;
  exception_id: string | null;
  type: TicketType;
  status: TicketStatus;
  blocks_service: boolean;
  detection_source: string | null;
  created_at: string;
  sla_due_at: string | null;
  breached_at: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  dispatched_at: string | null;
  eta_at: string | null;
  arrived_at: string | null;
  completed_at: string | null;
  returned_at: string | null;
  cancelled_at: string | null;
  escalated_at: string | null;
  estimated_cost_cents: number | null;
  actual_cost_cents: number | null;
  baseline_rate_cents_per_h: number | null;
  description: string | null;
  policy_ref: string | null;
}
const COLUMNS =
  "id, number, vehicle_id, vehicle_number, exception_id, type, status, blocks_service, detection_source, created_at, sla_due_at, breached_at, vendor_id, vendor_name, dispatched_at, eta_at, arrived_at, completed_at, returned_at, cancelled_at, escalated_at, estimated_cost_cents, actual_cost_cents, baseline_rate_cents_per_h, description, policy_ref";

const iso = (t: string | null) => (t ? new Date(t).toISOString() : null);

export function toTicket(r: Row, now: number) {
  const end = r.completed_at ?? r.cancelled_at;
  const downtimeMin = r.blocks_service
    ? Math.max(0, Math.round(((end ? Date.parse(end) : now) - Date.parse(r.created_at)) / 60_000))
    : null;
  return {
    id: r.id,
    number: r.number,
    vehicle: { id: r.vehicle_id, number: r.vehicle_number },
    exception_id: r.exception_id,
    type: r.type,
    status: r.status,
    blocks_service: r.blocks_service,
    detection_source: r.detection_source,
    created_at: iso(r.created_at)!,
    sla_due_at: iso(r.sla_due_at),
    sla_state: slaState(r, now) as SlaState,
    vendor: r.vendor_id && r.vendor_name ? { id: r.vendor_id, name: r.vendor_name } : null,
    eta_at: iso(r.eta_at),
    arrived_at: iso(r.arrived_at),
    completed_at: iso(r.completed_at),
    returned_at: iso(r.returned_at),
    estimated_cost_cents: r.estimated_cost_cents,
    actual_cost_cents: r.actual_cost_cents,
    downtime_min: downtimeMin,
    // Lost revenue while the ticket kept the car out (kpis.md §3.2 downtime cost at the baseline rate).
    lost_revenue_cents:
      downtimeMin !== null && r.baseline_rate_cents_per_h !== null
        ? Math.round((downtimeMin * r.baseline_rate_cents_per_h) / 60)
        : null,
    description: r.description,
    policy_ref: r.policy_ref,
  };
}
export type TicketOut = ReturnType<typeof toTicket>;

/** Service KPIs (PRD SV-1, kpis.md §3.3): same rows as the list, so the tiles and the list agree. */
async function serviceSummary(db: SupabaseClient, org: Pick<OrgContext, "id" | "timezone">, now: Date) {
  const today = localMidnight(localDay(now, org.timezone), org.timezone).toISOString();
  const since30 = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const [active, recent, jobs] = await Promise.all([
    db.from("tickets").select("status").eq("org_id", org.id).not("status", "in", "(completed,returned,cancelled)"),
    db
      .from("tickets")
      .select(
        "created_at, completed_at, sla_due_at, actual_cost_cents, estimated_cost_cents, baseline_rate_cents_per_h, status",
      )
      .eq("org_id", org.id)
      .or(`created_at.gte.${today},completed_at.gte.${since30}`)
      .limit(5000),
    db
      .from("vendor_jobs")
      .select("dispatched_at, arrived_at")
      .eq("org_id", org.id)
      .gte("dispatched_at", since30)
      .not("arrived_at", "is", null)
      .is("cancelled_at", null)
      .limit(5000),
  ]);
  const err = active.error ?? recent.error ?? jobs.error;
  if (err) throw new ApiProblem("internal", err.message);
  const rows = (recent.data ?? []) as {
    created_at: string;
    completed_at: string | null;
    sla_due_at: string | null;
    actual_cost_cents: number | null;
    estimated_cost_cents: number | null;
    baseline_rate_cents_per_h: number | null;
    status: TicketStatus;
  }[];
  const completed30 = rows.filter((r) => r.completed_at && r.completed_at >= since30 && r.sla_due_at);
  const t = (s: string) => Date.parse(s);
  return {
    active: (active.data ?? []).length,
    awaiting_dispatch: (active.data ?? []).filter((r) => r.status === "open").length,
    median_response_min: median(
      ((jobs.data ?? []) as { dispatched_at: string; arrived_at: string }[]).map(
        (j) => Math.round(((t(j.arrived_at) - t(j.dispatched_at)) / 60_000) * 10) / 10,
      ),
    ),
    sla_compliance_30d: completed30.length
      ? completed30.filter((r) => t(r.completed_at!) <= t(r.sla_due_at!)).length / completed30.length
      : null,
    // Actual cost, or the estimate while pending, of tickets opened today.
    cost_today_cents: rows
      .filter((r) => r.created_at >= today && r.status !== "cancelled")
      .reduce((s, r) => s + (r.actual_cost_cents ?? r.estimated_cost_cents ?? 0), 0),
    revenue_protected_today_cents: rows
      .filter((r) => r.completed_at && r.completed_at >= today && r.sla_due_at && r.baseline_rate_cents_per_h !== null)
      .reduce(
        (s, r) =>
          s +
          revenueRecoveredCents({
            slaTargetMinutes: (t(r.sla_due_at!) - t(r.created_at)) / 60_000,
            actualMinutes: (t(r.completed_at!) - t(r.created_at)) / 60_000,
            rateCentsPerHour: r.baseline_rate_cents_per_h!,
          }),
        0,
      ),
  };
}

export interface TicketQuery {
  status?: TicketStatus[];
  vehicle_id?: string;
  vendor_id?: string;
  sort: "created_at" | "-created_at" | "sla_due_at" | "-sla_due_at";
  limit: number;
  offset: number;
}

export async function listTickets(
  db: SupabaseClient,
  org: Pick<OrgContext, "id" | "timezone">,
  query: TicketQuery,
  now = new Date(),
) {
  const field = query.sort.replace(/^-/, "");
  let q = db
    .from("ticket_list")
    .select(COLUMNS, { count: "exact" })
    .eq("org_id", org.id)
    .order(field, { ascending: !query.sort.startsWith("-"), nullsFirst: false })
    .order("number", { ascending: false })
    .range(query.offset, query.offset + query.limit - 1);
  if (query.status?.length) q = q.in("status", query.status);
  if (query.vehicle_id) q = q.eq("vehicle_id", query.vehicle_id);
  if (query.vendor_id) q = q.eq("vendor_id", query.vendor_id);
  const [{ data, error, count }, summary] = await Promise.all([q, serviceSummary(db, org, now)]);
  if (error) throw new ApiProblem("internal", error.message);
  return {
    items: ((data ?? []) as Row[]).map((r) => toTicket(r, now.getTime())),
    total: count ?? 0,
    summary,
    asOf: now.getTime(),
  };
}

export async function getTicket(
  db: SupabaseClient,
  org: Pick<OrgContext, "id">,
  by: { id: string } | { number: string },
  now = new Date(),
) {
  let q = db.from("ticket_list").select(COLUMNS).eq("org_id", org.id);
  q = "id" in by ? q.eq("id", by.id) : q.eq("number", by.number);
  const { data, error } = await q.maybeSingle();
  if (error) throw new ApiProblem("internal", error.message);
  if (!data) throw new ApiProblem("not_found", "No such ticket.");
  return toTicket(data as Row, now.getTime());
}

/** The ticket's activity log (PRD SV-3: every step with actor and time). */
export async function ticketEvents(db: SupabaseClient, org: Pick<OrgContext, "id">, ticketId: string) {
  const { data, error } = await db
    .from("ticket_events")
    .select("id, type, actor_type, actor_id, at, detail")
    .eq("org_id", org.id)
    .eq("ticket_id", ticketId)
    .order("at")
    .order("seq")
    .limit(500);
  if (error) throw new ApiProblem("internal", error.message);
  const rows = (data ?? []) as {
    id: string;
    type: string;
    actor_type: "user" | "system" | "vendor";
    actor_id: string | null;
    at: string;
    detail: Record<string, unknown>;
  }[];
  const people = [...new Set(rows.map((r) => r.actor_id).filter((x): x is string => !!x))];
  const { data: profiles } = people.length
    ? await db.from("profiles").select("user_id, full_name").in("user_id", people)
    : { data: [] };
  const name = new Map(
    ((profiles ?? []) as { user_id: string; full_name: string | null }[]).map((p) => [p.user_id, p.full_name]),
  );
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    actor_type: r.actor_type,
    actor_id: r.actor_id,
    actor_name:
      r.actor_type === "user"
        ? r.actor_id
          ? personName(name.get(r.actor_id))
          : null
        : r.actor_type === "vendor"
          ? "Vendor"
          : "FleetOS",
    at: new Date(r.at).toISOString(),
    detail: r.detail,
  }));
}

function rpcError(error: { code?: string; message: string }): never {
  if (error.code === "P0002") throw new ApiProblem("not_found", error.message);
  if (error.code === "42501") throw new ApiProblem("forbidden", error.message);
  if (error.code === "23505") throw new ApiProblem("conflict", error.message);
  if (error.code === "22023") throw new ApiProblem("validation_failed", error.message);
  throw new ApiProblem("internal", error.message);
}

export async function createTicket(
  db: SupabaseClient,
  org: Pick<OrgContext, "id">,
  input: {
    vehicle_id: string;
    type: TicketType;
    blocks_service?: boolean;
    description?: string;
    vendor_id?: string | null;
    exception_id?: string | null;
    eta_min?: number | null;
    estimate_cents?: number | null;
  },
): Promise<string> {
  const { data, error } = await db.rpc("ticket_create", {
    p_org: org.id,
    p_vehicle: input.vehicle_id,
    p_type: input.type,
    p_blocks: input.blocks_service ?? false,
    p_description: input.description ?? null,
    p_exception: input.exception_id ?? null,
    p_vendor: input.vendor_id ?? null,
    p_eta: input.vendor_id && input.eta_min ? new Date(Date.now() + input.eta_min * 60_000).toISOString() : null,
    p_estimate: input.estimate_cents ?? null,
  });
  if (error) rpcError(error);
  return data as string;
}

/**
 * EX-4 one-step dispatch: a ticket for the exception's vehicle, typed from its class, with the recommended
 * vendor (or the one given) dispatched when `dispatch` is set.
 */
export async function createTicketFromException(
  db: SupabaseClient,
  org: Pick<OrgContext, "id">,
  exceptionId: string,
  input: { vendor_id?: string | null; dispatch?: boolean; description?: string },
): Promise<string> {
  const { data: e, error } = await db
    .from("exceptions")
    .select("vehicle_id, class, title, blocks_service, recommended_action")
    .eq("org_id", org.id)
    .eq("id", exceptionId)
    .maybeSingle();
  if (error) throw new ApiProblem("internal", error.message);
  if (!e) throw new ApiProblem("not_found", "No such exception.");
  if (!e.vehicle_id)
    throw new ApiProblem("validation_failed", "This exception isn't about a vehicle, so there's nothing to service.");
  const rec = (e.recommended_action ?? {}) as {
    vendor_id?: string | null;
    eta_min?: number | null;
    cost_cents?: number | null;
  };
  const vendorId = input.dispatch ? (input.vendor_id ?? rec.vendor_id ?? null) : null;
  if (input.dispatch && !vendorId)
    throw new ApiProblem("validation_failed", "No vendor is recommended for this exception. Pick one to dispatch.");
  const sameAsRecommended = vendorId && vendorId === rec.vendor_id;
  return createTicket(db, org, {
    vehicle_id: e.vehicle_id as string,
    type: TICKET_TYPE_FOR_CLASS[e.class as ExceptionClass],
    blocks_service: e.blocks_service as boolean,
    description: input.description ?? (e.title as string),
    exception_id: exceptionId,
    vendor_id: vendorId,
    eta_min: sameAsRecommended ? rec.eta_min : null,
    estimate_cents: sameAsRecommended ? rec.cost_cents : null,
  });
}

export async function ticketAction(
  db: SupabaseClient,
  org: Pick<OrgContext, "id">,
  id: string,
  action: TicketAction,
  input: {
    vendor_id?: string;
    eta_at?: string;
    actual_cost_cents?: number;
    note?: string;
    override?: boolean;
    reason?: string;
  },
) {
  const { error } = await db.rpc("ticket_action", {
    p_org: org.id,
    p_id: id,
    p_action: action,
    p_vendor: input.vendor_id ?? null,
    p_eta: input.eta_at ?? null,
    p_cost: input.actual_cost_cents ?? null,
    p_note: input.note ?? null,
    p_override: input.override ?? false,
    p_reason: input.reason ?? null,
  });
  if (error) rpcError(error);
}

export async function updateTicket(
  db: SupabaseClient,
  org: Pick<OrgContext, "id">,
  id: string,
  input: { description?: string; estimated_cost_cents?: number },
) {
  const { error } = await db.rpc("ticket_update", {
    p_org: org.id,
    p_id: id,
    p_description: input.description ?? null,
    p_estimate: input.estimated_cost_cents ?? null,
  });
  if (error) rpcError(error);
}

/** Pull from service (manual Maintenance hold) and return to service (vehicle-states.md §5). */
export async function pullFromService(
  db: SupabaseClient,
  org: Pick<OrgContext, "id">,
  vehicleId: string,
  reason: string,
) {
  const { error } = await db.rpc("vehicle_pull_from_service", {
    p_org: org.id,
    p_vehicle: vehicleId,
    p_reason: reason,
  });
  if (error) rpcError(error);
}

export async function returnToService(
  db: SupabaseClient,
  org: Pick<OrgContext, "id">,
  vehicleId: string,
  input: { override?: boolean; reason?: string },
) {
  const { error } = await db.rpc("vehicle_return_to_service", {
    p_org: org.id,
    p_vehicle: vehicleId,
    p_override: input.override ?? false,
    p_reason: input.reason ?? null,
  });
  if (error) rpcError(error);
}

/** What still keeps a car out of service (for the disabled "Return to service" and its explanation). */
export async function vehicleBlockers(db: SupabaseClient, org: Pick<OrgContext, "id">, vehicleId: string) {
  const [tickets, exceptions, holds] = await Promise.all([
    db
      .from("tickets")
      .select("id, number, type, status")
      .eq("org_id", org.id)
      .eq("vehicle_id", vehicleId)
      .eq("blocks_service", true)
      .not("status", "in", "(returned,cancelled)"),
    db
      .from("exceptions")
      .select("id, title")
      .eq("org_id", org.id)
      .eq("vehicle_id", vehicleId)
      .eq("blocks_service", true)
      .in("status", ["open", "assigned", "in_progress"]),
    db
      .from("vehicle_holds")
      .select("id, reason")
      .eq("org_id", org.id)
      .eq("vehicle_id", vehicleId)
      .is("released_at", null),
  ]);
  return {
    tickets: (tickets.data ?? []) as { id: string; number: string; type: TicketType; status: TicketStatus }[],
    exceptions: (exceptions.data ?? []) as { id: string; title: string }[],
    holds: (holds.data ?? []) as { id: string; reason: string }[],
  };
}

/** A vendor's jobs, newest first (GET /vendors/{id}/jobs). */
export async function vendorJobs(
  db: SupabaseClient,
  org: Pick<OrgContext, "id">,
  vendorId: string,
  page: { limit: number; offset: number },
) {
  const { data, error, count } = await db
    .from("vendor_jobs")
    .select(
      "id, ticket_id, dispatched_at, eta_at, arrived_at, completed_at, cost_cents, rating, tracking_source, tickets(number, sla_due_at, completed_at)",
      {
        count: "exact",
      },
    )
    .eq("org_id", org.id)
    .eq("vendor_id", vendorId)
    .is("cancelled_at", null)
    .order("dispatched_at", { ascending: false })
    .range(page.offset, page.offset + page.limit - 1);
  if (error) throw new ApiProblem("internal", error.message);
  return {
    total: count ?? 0,
    items: (
      (data ?? []) as unknown as {
        id: string;
        ticket_id: string;
        dispatched_at: string;
        eta_at: string | null;
        arrived_at: string | null;
        completed_at: string | null;
        cost_cents: number | null;
        rating: number | null;
        tracking_source: "manual" | "geofence" | "integration";
        tickets: { number: string; sla_due_at: string | null; completed_at: string | null } | null;
      }[]
    ).map((j) => ({
      id: j.id,
      ticket_id: j.ticket_id,
      ticket_number: j.tickets?.number ?? null,
      dispatched_at: new Date(j.dispatched_at).toISOString(),
      eta_at: iso(j.eta_at),
      arrived_at: iso(j.arrived_at),
      completed_at: iso(j.completed_at),
      cost_cents: j.cost_cents,
      rating: j.rating,
      sla_met:
        j.completed_at && j.tickets?.sla_due_at ? Date.parse(j.completed_at) <= Date.parse(j.tickets.sla_due_at) : null,
      tracking_source: j.tracking_source,
    })),
  };
}

export { isActiveTicket };

/** Vendors that can do this ticket at the car's location, best first (VN-4 ranking across fitting categories). */
export async function vendorChoices(
  db: SupabaseClient,
  org: Pick<OrgContext, "id">,
  vehicleId: string,
  type: TicketType,
) {
  const seen = new Map<
    string,
    { id: string; name: string; eta_min: number | null; cost_cents: number | null; score: number }
  >();
  for (const category of VENDOR_CATEGORIES_FOR[type]) {
    let ranked: Awaited<ReturnType<typeof rankForVehicle>> = [];
    try {
      ranked = await rankForVehicle(db, org.id, vehicleId, category);
    } catch {
      continue; // no position or hub: nothing to rank from
    }
    for (const r of ranked) {
      const prev = seen.get(r.vendor.id);
      if (prev && prev.score >= r.score) continue;
      seen.set(r.vendor.id, {
        id: r.vendor.id,
        name: r.vendor.name,
        eta_min: r.expected_eta_min === null ? null : Math.round(r.expected_eta_min),
        cost_cents: r.expected_cost_cents,
        score: r.score,
      });
    }
  }
  return [...seen.values()]
    .sort((a, b) => b.score - a.score)
    .map((v) => ({ id: v.id, name: v.name, eta_min: v.eta_min, cost_cents: v.cost_cents }));
}

// Attachments (PRD SV-4, NFR SEC-8): private bucket, org/ticket folders, short-lived signed URLs.
const BUCKET = "ticket-attachments";
export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
export const ATTACHMENT_TYPES = ["image/jpeg", "image/png", "image/heic", "image/heif", "application/pdf"] as const;

/** The file's real type from its first bytes (the browser's claim isn't trusted). */
export function sniffType(head: Uint8Array): (typeof ATTACHMENT_TYPES)[number] | null {
  const at = (i: number, ...b: number[]) => b.every((x, k) => head[i + k] === x);
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (at(0, 0x25, 0x50, 0x44, 0x46)) return "application/pdf";
  const brand = String.fromCharCode(...head.slice(8, 12));
  if (at(4, 0x66, 0x74, 0x79, 0x70) && /^(heic|heix|hevc|mif1|msf1)$/.test(brand)) return "image/heic";
  return null;
}

export async function uploadAttachment(db: SupabaseClient, org: Pick<OrgContext, "id">, ticketId: string, file: File) {
  if (file.size === 0) throw new ApiProblem("validation_failed", "That file is empty.");
  if (file.size > ATTACHMENT_MAX_BYTES) throw new ApiProblem("validation_failed", "Files can be up to 20 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffType(bytes.slice(0, 16));
  if (!type) throw new ApiProblem("validation_failed", "Attach a JPEG, PNG, HEIC photo or a PDF.");
  const ticket = await getTicket(db, org, { id: ticketId });
  const safe = file.name.replace(/[^\w.-]+/g, "_").slice(-120) || "file";
  const path = `${org.id}/tickets/${ticket.id}/${crypto.randomUUID()}-${safe}`;
  const up = await db.storage.from(BUCKET).upload(path, bytes, { contentType: type, upsert: false });
  if (up.error) {
    if (/row-level security|unauthorized/i.test(up.error.message))
      throw new ApiProblem("forbidden", "Only owners, admins and ops can add attachments.");
    throw new ApiProblem("internal", up.error.message);
  }
  const { data, error } = await db
    .from("attachments")
    .insert({
      org_id: org.id,
      ticket_id: ticket.id,
      storage_path: path,
      filename: file.name.slice(0, 200) || safe,
      content_type: type,
      size_bytes: file.size,
    })
    .select("id")
    .single();
  if (error) {
    await db.storage.from(BUCKET).remove([path]);
    throw new ApiProblem(error.code === "42501" ? "forbidden" : "internal", error.message);
  }
  return (data as { id: string }).id;
}

/** Attachments with signed URLs valid for 10 minutes. */
export async function listAttachments(db: SupabaseClient, org: Pick<OrgContext, "id">, ticketId: string) {
  const { data, error } = await db
    .from("attachments")
    .select("id, storage_path, filename, content_type, size_bytes, created_at")
    .eq("org_id", org.id)
    .eq("ticket_id", ticketId)
    .order("created_at");
  if (error) throw new ApiProblem("internal", error.message);
  const rows = (data ?? []) as {
    id: string;
    storage_path: string;
    filename: string;
    content_type: string;
    size_bytes: number;
    created_at: string;
  }[];
  if (!rows.length) return [];
  const signed = await db.storage.from(BUCKET).createSignedUrls(
    rows.map((r) => r.storage_path),
    600,
  );
  if (signed.error) throw new ApiProblem("internal", signed.error.message);
  const url = new Map(signed.data.map((s) => [s.path, s.signedUrl]));
  return rows
    .filter((r) => url.get(r.storage_path))
    .map((r) => ({
      id: r.id,
      filename: r.filename,
      content_type: r.content_type,
      size_bytes: r.size_bytes,
      url: url.get(r.storage_path)!,
      uploaded_at: new Date(r.created_at).toISOString(),
    }));
}
