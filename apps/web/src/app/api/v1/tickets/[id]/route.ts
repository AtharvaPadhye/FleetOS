import { apiRoute } from "@/lib/api/handler";
import { uuidParam } from "@/lib/api/cursor";
import { getTicketById, patchTicket } from "@/lib/api/operations";
import { getTicket, updateTicket } from "@/lib/services/tickets";

export const dynamic = "force-dynamic";

export const GET = apiRoute(getTicketById, async ({ db, org, params }) => ({
  body: await getTicket(db, org, { id: uuidParam(params) }),
}));

/** Change the description or estimate; status changes are actions (`/actions/{action}`). */
export const PATCH = apiRoute(patchTicket, async ({ db, org, params, body }) => {
  const id = uuidParam(params);
  await updateTicket(db, org, id, body);
  return { body: await getTicket(db, org, { id }) };
});
