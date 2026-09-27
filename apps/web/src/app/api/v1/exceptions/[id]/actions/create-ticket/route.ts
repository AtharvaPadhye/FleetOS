import { apiRoute } from "@/lib/api/handler";
import { uuidParam } from "@/lib/api/cursor";
import { postExceptionCreateTicket } from "@/lib/api/operations";
import { createTicketFromException, getTicket } from "@/lib/services/tickets";

export const dynamic = "force-dynamic";

/** EX-4: create the ticket for an exception and, with `dispatch`, send the recommended (or given) vendor. */
export const POST = apiRoute(postExceptionCreateTicket, async ({ db, org, params, body }) => {
  const id = await createTicketFromException(db, org, uuidParam(params), body);
  return { body: await getTicket(db, org, { id }), status: 201 };
});
