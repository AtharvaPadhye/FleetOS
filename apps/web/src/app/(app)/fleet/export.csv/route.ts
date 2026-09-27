import { ApiProblem } from "@/lib/api/problem";
import { localDay } from "@/lib/api/period";
import { SOC_BANDS, parseFleetView } from "@/lib/fleet-view";
import { getAppContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { fleetCsv } from "@/lib/services/fleet-csv";
import { listFleet } from "@/lib/services/fleet";

export const dynamic = "force-dynamic";

/**
 * "Export CSV" on /fleet (PRD FL-4): every vehicle matching the page's filters, all pages, as the signed-in
 * user. Same service and CSV as GET /api/v1/vehicles?format=csv, which needs the org header a link can't send.
 */
export async function GET(request: Request) {
  const { activeOrg } = await getAppContext();
  if (!activeOrg) return new Response("Sign in first.", { status: 401 });
  const view = parseFleetView(Object.fromEntries(new URL(request.url).searchParams));
  const band = view.soc ? SOC_BANDS[view.soc] : null;
  const now = new Date();
  try {
    const { items } = await listFleet(
      await createClient(),
      activeOrg,
      {
        status: view.status,
        hub_id: view.hub ?? undefined,
        soc_lt: band && "soc_lt" in band ? band.soc_lt : undefined,
        soc_gte: band && "soc_gte" in band ? band.soc_gte : undefined,
        q: view.q || undefined,
        profitability: view.profitability ?? undefined,
        sort: view.sort,
        limit: Number.MAX_SAFE_INTEGER,
        offset: 0,
      },
      now,
    );
    const rows = items.map(({ location_name, ...v }) => ({ ...v, state: { ...v.state, location_name } }));
    return new Response(fleetCsv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="fleet-${localDay(now, activeOrg.timezone)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return new Response(e instanceof ApiProblem ? e.message : "Export failed.", {
      status: e instanceof ApiProblem && e.code === "forbidden" ? 403 : 500,
    });
  }
}
