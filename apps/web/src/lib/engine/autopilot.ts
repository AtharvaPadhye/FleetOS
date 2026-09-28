import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TICKET_TYPE_FOR_CLASS, type ExceptionClass } from "@fleetos/domain";
import type { OpsRecord } from "@fleetos/providers";

interface Step {
  action: "dispatch" | "arrive" | "complete";
  at: string;
  [k: string]: unknown;
}

// SUBSTITUTE(vendor_tracking, simulated): in demo orgs the ops autopilot plays the ops team and the vendors.
//   Real source: people dispatch from /exceptions; vendors report arrival/completion via integrations or forms.
//   Replace by: vendor feeds writing vendor_jobs (tracking_source 'integration'); drop the autopilot.
//   Docs: docs/requirements/data-sources.md §5, ADR-0015
/**
 * Per engine chunk `window`: dispatch the recommended vendor for blocking exceptions nobody picked up within
 * the org's auto-dispatch delay (off = never); mark vendors arrived at their ETA; complete the ticket when the simulator finishes the job, with
 * the simulator's cost (it becomes the ticket's one ledger line, SV-6). Returns the simulator jobs a ticket
 * accounted for, so their cost isn't also booked from the simulator.
 */
export async function runAutopilot(
  db: SupabaseClient,
  orgId: string,
  window: { from: Date; to: Date },
  jobs: readonly OpsRecord[],
  vehicleIdByVin: ReadonlyMap<string, string>,
  /** The org's auto-dispatch policy (Settings): minutes a person gets first; null = never dispatch. */
  dispatchAfterMin: number | null,
): Promise<Set<OpsRecord>> {
  const afterMs = (dispatchAfterMin ?? 0) * 60_000;
  const cutoff = new Date(window.to.getTime() - afterMs).toISOString();
  const { data: waiting, error } =
    dispatchAfterMin === null
      ? { data: [], error: null }
      : await db
          .from("exception_list")
          .select("id, vehicle_id, class, title, detected_at, blocks_service, recommended_action")
          .eq("org_id", orgId)
          .in("status", ["open", "assigned"])
          .eq("blocks_service", true)
          .is("ticket_id", null)
          .not("vehicle_id", "is", null)
          .lte("detected_at", cutoff);
  if (error) throw new Error(error.message);
  const dispatch: Step[] = (
    (waiting ?? []) as {
      id: string;
      vehicle_id: string;
      class: ExceptionClass;
      title: string;
      detected_at: string;
      recommended_action: { vendor_id?: string | null; eta_min?: number | null; cost_cents?: number | null } | null;
    }[]
  )
    .filter((e) => e.recommended_action?.vendor_id)
    .map((e) => {
      const at = new Date(Math.max(new Date(e.detected_at).getTime() + afterMs, window.from.getTime()));
      const eta = e.recommended_action!.eta_min ?? 30;
      return {
        action: "dispatch",
        at: at.toISOString(),
        exception_id: e.id,
        vehicle_id: e.vehicle_id,
        type: TICKET_TYPE_FOR_CLASS[e.class],
        blocks_service: true,
        description: e.title,
        vendor_id: e.recommended_action!.vendor_id,
        eta_at: new Date(at.getTime() + eta * 60_000).toISOString(),
        estimate_cents: e.recommended_action!.cost_cents ?? null,
      };
    });
  await apply(db, orgId, dispatch);

  // Live tickets with a simulated vendor on the way or on site.
  const { data: live, error: lErr } = await db
    .from("ticket_list")
    .select("id, vehicle_id, status, eta_at, dispatched_at, arrived_at, detection_source")
    .eq("org_id", orgId)
    .in("status", ["dispatched", "en_route", "arrived", "in_progress"]);
  if (lErr) throw new Error(lErr.message);
  const tickets = (live ?? []) as {
    id: string;
    vehicle_id: string;
    status: string;
    eta_at: string | null;
    dispatched_at: string | null;
    arrived_at: string | null;
    detection_source: string | null;
  }[];

  const steps: Step[] = [];
  const consumed = new Set<OpsRecord>();
  const finished = new Set<string>();
  for (const job of jobs) {
    const vehicleId = vehicleIdByVin.get(job.vehicleRef);
    const t = tickets.find((x) => x.vehicle_id === vehicleId && !finished.has(x.id));
    if (!t) continue;
    const done = job.resolvedAt.getTime();
    if (!t.arrived_at && t.status !== "arrived") {
      const eta = t.eta_at ? Date.parse(t.eta_at) : done;
      const at = Math.min(Math.max(eta, Date.parse(t.dispatched_at ?? job.detectedAt.toISOString())), done);
      steps.push({ action: "arrive", at: new Date(at).toISOString(), ticket_id: t.id });
    }
    steps.push({
      action: "complete",
      at: job.resolvedAt.toISOString(),
      ticket_id: t.id,
      vehicle_id: t.vehicle_id,
      cost_cents: job.costCents,
      note: job.costLines.map((l) => `${l.category} $${(l.cents / 100).toFixed(2)}`).join(", "),
      return: t.detection_source === "rule",
    });
    finished.add(t.id);
    consumed.add(job);
  }
  // Vendors still working arrive at their ETA.
  for (const t of tickets) {
    if (finished.has(t.id) || t.status !== "dispatched" || !t.eta_at) continue;
    if (Date.parse(t.eta_at) <= window.to.getTime()) steps.push({ action: "arrive", at: t.eta_at, ticket_id: t.id });
  }
  steps.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  await apply(db, orgId, steps);
  return consumed;
}

async function apply(db: SupabaseClient, orgId: string, steps: Step[]) {
  if (!steps.length) return;
  const { error } = await db.rpc("engine_ticket_steps", { p_org: orgId, p_steps: steps });
  if (error) throw new Error(`autopilot: ${error.message}`);
}
