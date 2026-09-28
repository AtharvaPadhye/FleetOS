import { apiRoute } from "@/lib/api/handler";
import { uuidParam } from "@/lib/api/cursor";
import { getReport as getReportOp } from "@/lib/api/operations";
import { getReport, summarize } from "@/lib/services/reports";

export const dynamic = "force-dynamic";

/** One report version with its frozen snapshot. */
export const GET = apiRoute(getReportOp, async ({ db, org, params }) => {
  const r = await getReport(db, org, uuidParam(params));
  return { body: { ...summarize(r), data: { ...r.data } }, dataSource: r.data.data_source };
});
