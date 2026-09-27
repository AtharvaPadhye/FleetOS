import { apiRoute, ApiProblem } from "@/lib/api/handler";
import { uuidParam } from "@/lib/api/cursor";
import { hoursTotals, orgSettings, vehicleExists, vehicleMoney } from "@/lib/api/kpi-data";
import { vehicleKpis } from "@/lib/api/kpis";
import { getVehicleKpis } from "@/lib/api/operations";
import { resolvePeriod } from "@/lib/api/period";
import { MONEY_ROLES } from "@/lib/api/vehicles";

export const dynamic = "force-dynamic";

/** One vehicle's KPIs against the fleet average (default: last 30 days) and its performance label. */
export const GET = apiRoute(getVehicleKpis, async ({ db, org, params, query }) => {
  const id = uuidParam(params);
  if (!(await vehicleExists(db, org.id, id))) throw new ApiProblem("not_found", "No such vehicle.");
  const period = resolvePeriod(query, org.timezone, new Date(), "last_30d");
  const canSeeMoney = MONEY_ROLES.has(org.role);
  const [settings, hours, money] = await Promise.all([
    orgSettings(db, org.id),
    hoursTotals(db, org.id, period.fromDay, period.toDay),
    canSeeMoney ? vehicleMoney(db, org.id, period.fromDay, period.toDay) : null,
  ]);
  return {
    body: vehicleKpis({
      vehicleId: id,
      hours,
      money,
      availabilityTarget: settings.availabilityTarget,
      isDemo: org.isDemo,
    }),
    dataSource: org.isDemo ? "simulated" : undefined,
  };
});
