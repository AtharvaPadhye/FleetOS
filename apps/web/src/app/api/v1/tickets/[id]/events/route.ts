import { apiRoute } from "@/lib/api/handler";
import { uuidParam } from "@/lib/api/cursor";
import { getTicketEvents } from "@/lib/api/operations";
import { getTicket, ticketEvents } from "@/lib/services/tickets";

export const dynamic = "force-dynamic";

/** Every step of the ticket with actor and time (PRD SV-3). */
export const GET = apiRoute(getTicketEvents, async ({ db, org, params }) => {
  const { id } = await getTicket(db, org, { id: uuidParam(params) }); // 404 for other orgs' tickets
  return { body: await ticketEvents(db, org, id) };
});
