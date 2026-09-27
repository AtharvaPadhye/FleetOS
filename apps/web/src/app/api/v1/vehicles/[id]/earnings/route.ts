import { apiRoute, ApiProblem } from "@/lib/api/handler";
import { uuidParam } from "@/lib/api/cursor";
import { vehicleExists } from "@/lib/api/kpi-data";
import { getVehicleEarnings } from "@/lib/api/operations";
import { resolvePeriod } from "@/lib/api/period";

export const dynamic = "force-dynamic";

/** Preview `earnings`: platform payout for one vehicle over a period (default today), from simulated rides. */
export const GET = apiRoute(getVehicleEarnings, async ({ db, org, params, query }) => {
  const id = uuidParam(params);
  if (!(await vehicleExists(db, org.id, id))) throw new ApiProblem("not_found", "No such vehicle.");
  const period = resolvePeriod(query, org.timezone, new Date(), "today");
  const { data, error } = await db
    .rpc("ride_totals", { p_org: org.id, p_vehicle: id, p_from: period.from, p_to: period.to })
    .single<{ gross_cents: number | string; platform_fee_cents: number | string; trips: number | string }>();
  if (error) throw new ApiProblem("internal", error.message);
  const gross = Number(data.gross_cents);
  const fee = Number(data.platform_fee_cents);
  return {
    body: {
      vehicle_id: id,
      gross_cents: gross,
      platform_fee_cents: fee,
      net_cents: gross - fee,
      trips: Number(data.trips),
      period: { from: period.from, to: period.to },
    },
  };
});
