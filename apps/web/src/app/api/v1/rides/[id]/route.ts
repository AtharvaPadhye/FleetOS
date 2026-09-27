import { apiRoute, ApiProblem } from "@/lib/api/handler";
import { uuidParam } from "@/lib/api/cursor";
import { getRide } from "@/lib/api/operations";
import { RIDE_COLUMNS, toRide, type RideRow } from "@/lib/api/rides";

export const dynamic = "force-dynamic";

/** Preview `rides`: one trip. */
export const GET = apiRoute(getRide, async ({ db, org, params }) => {
  const { data, error } = await db
    .from("ride_list")
    .select(RIDE_COLUMNS)
    .eq("org_id", org.id)
    .eq("id", uuidParam(params))
    .maybeSingle<RideRow>();
  if (error) throw new ApiProblem("internal", error.message);
  if (!data) throw new ApiProblem("not_found", "No such ride.");
  return { body: toRide(data) };
});
