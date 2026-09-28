import { apiRoute } from "@/lib/api/handler";
import { uuidParam } from "@/lib/api/cursor";
import { getHubForecast } from "@/lib/api/operations";
import { ApiProblem } from "@/lib/api/problem";
import { localDay } from "@/lib/api/period";
import { hubView } from "@/lib/services/hubs";

export const dynamic = "force-dynamic";

/** Today's hourly charger forecast (HB-2). Other dates answer 422 until forecasts are stored. */
export const GET = apiRoute(getHubForecast, async ({ db, org, params, query }) => {
  const now = new Date();
  const today = localDay(now, org.timezone);
  if (query.date && query.date !== today)
    throw new ApiProblem("validation_failed", `Forecasts are for today (${today}) only.`);
  const { hub } = await hubView(db, org, uuidParam(params), now);
  return {
    body: {
      hub_id: hub.id,
      date: today,
      capacity: hub.chargers_total,
      hours: hub.forecast.map((h) => ({
        hour: new Date(h.hour).toISOString(),
        demand: h.demand,
        utilization: h.utilization ?? 0,
      })),
    },
  };
});
