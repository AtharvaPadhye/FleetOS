import { apiRoute } from "@/lib/api/handler";
import { getReports, postReport } from "@/lib/api/operations";
import { generateReport, getReport, listReports, summarize } from "@/lib/services/reports";

export const dynamic = "force-dynamic";

/** Monthly report snapshots, newest month and version first (RP-1). */
export const GET = apiRoute(getReports, async ({ db, org }) => ({ body: await listReports(db, org) }));

/** Generate a snapshot (201); the current month is marked preliminary, a repeat month gets the next version. */
export const POST = apiRoute(postReport, async ({ db, org, body }) => {
  const { id } = await generateReport(db, org, body.month);
  return { body: summarize(await getReport(db, org, id)), status: 201 };
});
