import { apiRoute } from "@/lib/api/handler";
import { uuidParam } from "@/lib/api/cursor";
import { postReportShare } from "@/lib/api/operations";
import { shareReport } from "@/lib/services/reports";

export const dynamic = "force-dynamic";

/** An expiring read-only link for a recipient (RP-4); the token is only ever in the returned URL. */
export const POST = apiRoute(postReportShare, async ({ db, org, params, body, request }) => {
  const s = await shareReport(db, org, uuidParam(params), {
    recipient: body.recipient,
    days: body.expires_in_days,
    origin: new URL(request.url).origin,
  });
  return { body: { id: s.id, url: s.url, recipient: s.recipient, expires_at: s.expires_at }, status: 201 };
});
