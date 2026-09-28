import { apiRoute } from "@/lib/api/handler";
import { uuidParam } from "@/lib/api/cursor";
import { deleteReportShare } from "@/lib/api/operations";
import { revokeShare } from "@/lib/services/reports";

export const dynamic = "force-dynamic";

/** Revoke a share link (204); the link shows "expired" from then on. */
export const DELETE = apiRoute(deleteReportShare, async ({ db, org, params }) => {
  await revokeShare(db, org, uuidParam(params), uuidParam(params, "sid"));
  return { raw: new Response(null, { status: 204 }), body: null };
});
