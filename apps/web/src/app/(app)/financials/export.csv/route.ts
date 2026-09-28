import { getAppContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { localMidnight } from "@/lib/api/period";
import { ApiProblem } from "@/lib/api/problem";
import { financials, financialsCsv } from "@/lib/services/financials";

export const dynamic = "force-dynamic";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** FN-5: the period's vehicle P&L lines as CSV; the filename carries the period. */
export async function GET(request: Request) {
  const { activeOrg } = await getAppContext();
  if (!activeOrg) return new Response("Sign in again.", { status: 401 });
  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const period = url.searchParams.get("period") ?? "mtd";
  const tz = activeOrg.timezone;
  const q =
    from && to && DAY.test(from) && DAY.test(to)
      ? { from: localMidnight(from, tz).toISOString(), to: localMidnight(addDays(to, 1), tz).toISOString() }
      : { period };
  try {
    const f = await financials(await createClient(), activeOrg, q);
    return new Response(financialsCsv(f.rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="financials-${f.period.fromDay}-to-${f.period.toDay}.csv"`,
      },
    });
  } catch (e) {
    const status = e instanceof ApiProblem ? (e.code === "forbidden" ? 403 : 400) : 500;
    return new Response(e instanceof Error ? e.message : "Export failed.", { status });
  }
}
