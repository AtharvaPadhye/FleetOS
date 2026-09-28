import { apiRoute } from "@/lib/api/handler";
import { uuidParam } from "@/lib/api/cursor";
import { getReportPdf } from "@/lib/api/operations";
import { reportPdfUrl } from "@/lib/services/report-pdf";

export const dynamic = "force-dynamic";

/** Redirect (302) to a signed PDF link valid for 5 minutes; the PDF is rendered on first request (RP-3). */
export const GET = apiRoute(getReportPdf, async ({ db, org, params, request }) => {
  const url = await reportPdfUrl(db, org, uuidParam(params), new URL(request.url).origin);
  return { raw: new Response(null, { status: 302, headers: { Location: url } }), body: null };
});
