"use server";

import { revalidatePath } from "next/cache";
import { TICKET_TYPES, type TicketAction, type TicketType } from "@fleetos/domain";
import { ApiProblem } from "@/lib/api/problem";
import { getAppContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import {
  createTicket,
  createTicketFromException,
  getTicket,
  pullFromService,
  returnToService,
  ticketAction,
} from "@/lib/services/tickets";

export type TicketFormState =
  { status: "idle" } | { status: "error"; message: string } | { status: "ok"; done: string; number?: string };

async function context() {
  const { user, activeOrg } = await getAppContext();
  if (!user || !activeOrg) throw new ApiProblem("unauthenticated", "Sign in again.");
  if (!["owner", "admin", "ops"].includes(activeOrg.role))
    throw new ApiProblem("forbidden", "Only owners, admins and ops can change service tickets.");
  return { org: activeOrg, db: await createClient() };
}
const message = (e: unknown) => (e instanceof ApiProblem ? e.message : "Couldn't save that. Try again.");
const revalidate = () => {
  revalidatePath("/service", "layout");
  revalidatePath("/exceptions", "layout");
  revalidatePath("/fleet", "layout");
};
const dollarsToCents = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").replace(/[$,\s]/g, "");
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN;
};

const DONE: Record<TicketAction, string> = {
  "assign-vendor": "Vendor dispatched",
  "mark-arrived": "Marked arrived",
  complete: "Service completed and cost posted",
  "return-to-service": "Returned to service in FleetOS",
  cancel: "Ticket cancelled",
  escalate: "Escalated",
};

/** One lifecycle step from the ticket page (flows.md F1: one primary action per state). */
export async function ticketStep(id: string, _prev: TicketFormState, form: FormData): Promise<TicketFormState> {
  const action = String(form.get("action")) as TicketAction;
  if (!(action in DONE)) return { status: "error", message: "Unknown action." };
  const cost = dollarsToCents(form.get("actual_cost"));
  if (Number.isNaN(cost)) return { status: "error", message: "Enter the cost in dollars, e.g. 45 or 45.50." };
  const etaMin = Number(form.get("eta_min") || 0);
  const reason = String(form.get("reason") ?? "").trim();
  const note = String(form.get("note") ?? "").trim();
  if (action === "cancel" && reason.length < 3) return { status: "error", message: "Say why you're cancelling." };
  try {
    const { org, db } = await context();
    await ticketAction(db, org, id, action, {
      vendor_id: String(form.get("vendor_id") ?? "") || undefined,
      eta_at: etaMin > 0 ? new Date(Date.now() + etaMin * 60_000).toISOString() : undefined,
      actual_cost_cents: cost,
      note: note || undefined,
      override: form.get("override") === "on",
      reason: reason || undefined,
    });
  } catch (e) {
    return { status: "error", message: message(e) };
  }
  revalidate();
  return { status: "ok", done: DONE[action] };
}

/** EX-4: "Dispatch {vendor}" from an exception, or a ticket without a vendor yet. */
export async function ticketFromException(
  exceptionId: string,
  _prev: TicketFormState,
  form: FormData,
): Promise<TicketFormState> {
  try {
    const { org, db } = await context();
    const id = await createTicketFromException(db, org, exceptionId, {
      dispatch: form.get("dispatch") === "1",
      vendor_id: String(form.get("vendor_id") ?? "") || undefined,
    });
    const t = await getTicket(db, org, { id });
    revalidate();
    return { status: "ok", done: `Created ${t.number}`, number: t.number };
  } catch (e) {
    return { status: "error", message: message(e) };
  }
}

/** VD-8: create a ticket from the vehicle page. */
export async function ticketForVehicle(
  vehicleId: string,
  _prev: TicketFormState,
  form: FormData,
): Promise<TicketFormState> {
  const type = String(form.get("type")) as TicketType;
  if (!TICKET_TYPES.includes(type)) return { status: "error", message: "Pick the kind of service." };
  const description = String(form.get("description") ?? "").trim();
  if (!description) return { status: "error", message: "Describe what needs doing." };
  try {
    const { org, db } = await context();
    const id = await createTicket(db, org, {
      vehicle_id: vehicleId,
      type,
      description,
      blocks_service: form.get("blocks_service") === "on",
      vendor_id: String(form.get("vendor_id") ?? "") || null,
    });
    const t = await getTicket(db, org, { id });
    revalidate();
    return { status: "ok", done: `Created ${t.number}`, number: t.number };
  } catch (e) {
    return { status: "error", message: message(e) };
  }
}

/** Pull from service / return to service from the vehicle header (vehicle-states.md §5). */
export async function vehicleServiceStep(
  vehicleId: string,
  _prev: TicketFormState,
  form: FormData,
): Promise<TicketFormState> {
  const step = String(form.get("step"));
  const reason = String(form.get("reason") ?? "").trim();
  try {
    const { org, db } = await context();
    if (step === "pull") {
      if (reason.length < 3) return { status: "error", message: "Say why you're pulling it (3+ characters)." };
      await pullFromService(db, org, vehicleId, reason);
    } else {
      await returnToService(db, org, vehicleId, {
        override: form.get("override") === "on",
        reason: reason || undefined,
      });
    }
  } catch (e) {
    return { status: "error", message: message(e) };
  }
  revalidate();
  return {
    status: "ok",
    done:
      step === "pull" ? "Pulled from service. The status updates within a minute" : "Returned to service in FleetOS",
  };
}
