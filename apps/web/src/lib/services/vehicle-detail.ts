import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiProblem } from "@/lib/api/problem";
import { MONEY_ROLES, toVehicle, VEHICLE_DETAIL_COLUMNS, type VehicleDetailRow } from "@/lib/api/vehicles";
import type { OrgContext } from "@/lib/api/handler";

/** One vehicle with live state, configuration and active holds (GET /vehicles/{id} and the vehicle page). */
export async function getVehicleDetail(
  db: SupabaseClient,
  org: Pick<OrgContext, "id" | "role">,
  by: { id: string } | { number: string },
  now = new Date(),
) {
  let q = db.from("vehicle_list").select(VEHICLE_DETAIL_COLUMNS).eq("org_id", org.id);
  q = "id" in by ? q.eq("id", by.id) : q.eq("number", by.number);
  const { data: row, error } = await q.maybeSingle<VehicleDetailRow & { display_name: string | null }>();
  if (error) throw new ApiProblem("internal", error.message);
  if (!row) throw new ApiProblem("not_found", "No such vehicle.");
  const { data: holds } = await db
    .from("vehicle_holds")
    .select("id, reason, created_at")
    .eq("org_id", org.id)
    .eq("vehicle_id", row.id)
    .is("released_at", null)
    .order("created_at", { ascending: false });
  return { ...toVehicle(row, holds ?? [], MONEY_ROLES.has(org.role), now), display_name: row.display_name };
}
