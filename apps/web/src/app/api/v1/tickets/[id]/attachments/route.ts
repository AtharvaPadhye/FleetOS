import { apiRoute } from "@/lib/api/handler";
import { uuidParam } from "@/lib/api/cursor";
import { getTicketAttachments, postTicketAttachment } from "@/lib/api/operations";
import { ApiProblem } from "@/lib/api/problem";
import { getTicket, listAttachments, uploadAttachment } from "@/lib/services/tickets";

export const dynamic = "force-dynamic";

/** Photos and PDFs on a ticket, each with a signed URL valid for 10 minutes (PRD SV-4). */
export const GET = apiRoute(getTicketAttachments, async ({ db, org, params }) => {
  const t = await getTicket(db, org, { id: uuidParam(params) });
  return { body: await listAttachments(db, org, t.id) };
});

/** Upload one file (multipart `file`): JPEG, PNG, HEIC or PDF up to 20 MB. */
export const POST = apiRoute(postTicketAttachment, async ({ db, org, params, request }) => {
  const id = uuidParam(params);
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File))
    throw new ApiProblem("validation_failed", "Send the file as multipart form field `file`.");
  const attachmentId = await uploadAttachment(db, org, id, file);
  const all = await listAttachments(db, org, id);
  return { body: all.find((a) => a.id === attachmentId)!, status: 201 };
});
