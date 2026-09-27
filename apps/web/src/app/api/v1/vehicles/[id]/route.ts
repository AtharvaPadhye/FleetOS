import { apiRoute, ApiProblem } from "@/lib/api/handler";
import { uuidParam } from "@/lib/api/cursor";
import { getVehicle } from "@/lib/api/operations";
import { MONEY_ROLES, toVehicle, VEHICLE_DETAIL_COLUMNS, type VehicleDetailRow } from "@/lib/api/vehicles";

export const dynamic = "force-dynamic";

/** One vehicle with live state, configuration and active holds. Monthly costs only for money roles. */
export const GET = apiRoute(getVehicle, async ({ db, org, params }) => {
  const id = uuidParam(params);
  const [{ data: row, error }, { data: holds }] = await Promise.all([
    db
      .from("vehicle_list")
      .select(VEHICLE_DETAIL_COLUMNS)
      .eq("org_id", org.id)
      .eq("id", id)
      .maybeSingle<VehicleDetailRow>(),
    db
      .from("vehicle_holds")
      .select("id, reason, created_at")
      .eq("org_id", org.id)
      .eq("vehicle_id", id)
      .is("released_at", null)
      .order("created_at", { ascending: false }),
  ]);
  if (error) throw new ApiProblem("internal", error.message);
  if (!row) throw new ApiProblem("not_found", "No such vehicle.");
  return {
    body: toVehicle(row, holds ?? [], MONEY_ROLES.has(org.role), new Date()),
    dataSource: org.isDemo ? "simulated" : undefined,
  };
});
