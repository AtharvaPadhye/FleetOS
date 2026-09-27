import { TICKET_ACTIONS, type TicketAction } from "@fleetos/domain";
import { apiRoute } from "@/lib/api/handler";
import { uuidParam } from "@/lib/api/cursor";
import { postTicketAction } from "@/lib/api/operations";
import { ApiProblem } from "@/lib/api/problem";
import { getTicket, ticketAction } from "@/lib/services/tickets";

export const dynamic = "force-dynamic";

/**
 * The lifecycle (PRD SV-3): assign-vendor (vendor_id, eta_at) → mark-arrived → complete (actual_cost_cents,
 * posts the ledger line) → return-to-service (override + reason for owner/admin when something else still
 * blocks); escalate and cancel at any active step. Invalid transitions answer 422 with the reason.
 */
export const POST = apiRoute(postTicketAction, async ({ db, org, params, body }) => {
  const id = uuidParam(params);
  const action = params.action as TicketAction;
  if (!(TICKET_ACTIONS as readonly string[]).includes(action))
    throw new ApiProblem("not_found", `Unknown action. Use one of: ${TICKET_ACTIONS.join(", ")}.`);
  await ticketAction(db, org, id, action, body);
  return { body: await getTicket(db, org, { id }) };
});
