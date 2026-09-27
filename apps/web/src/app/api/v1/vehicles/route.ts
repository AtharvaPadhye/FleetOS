import { apiRoute, ApiProblem } from "@/lib/api/handler";
import { decodeCursor, encodeCursor, isOffsetCursor } from "@/lib/api/cursor";
import { getVehicles } from "@/lib/api/operations";
import { toVehicleListItem, VEHICLE_LIST_COLUMNS, type VehicleListRow } from "@/lib/api/vehicles";

export const dynamic = "force-dynamic";

/** Fleet list with live state: filter by status / home hub / SOC / search, sort, page (api.md §1). */
export const GET = apiRoute(getVehicles, async ({ db, org, query }) => {
  const offset = decodeCursor(query.cursor, isOffsetCursor)?.o ?? 0;
  let q = db.from("vehicle_list").select(VEHICLE_LIST_COLUMNS, { count: "exact" }).eq("org_id", org.id);
  if (query.status?.length) q = q.in("status", query.status);
  if (query.hub_id) q = q.eq("home_hub_id", query.hub_id);
  if (query.soc_lt !== undefined) q = q.lt("soc", query.soc_lt);
  if (query.soc_gte !== undefined) q = q.gte("soc", query.soc_gte);
  if (query.q) {
    // Letters, digits, spaces and dashes only: keeps the value out of PostgREST's filter syntax.
    const term = query.q.replace(/[^\p{L}\p{N} -]/gu, "").trim();
    if (term) q = q.or(`number.ilike.*${term}*,vin.ilike.*${term}*,display_name.ilike.*${term}*`);
  }
  const desc = query.sort.startsWith("-");
  const field = query.sort.replace(/^-/, "");
  q = q.order(field, { ascending: !desc, nullsFirst: false });
  if (field !== "number") q = q.order("number", { ascending: true });
  const { data, count, error } = await q
    .order("id", { ascending: true })
    .range(offset, offset + query.limit - 1)
    .returns<VehicleListRow[]>();
  if (error) throw new ApiProblem("internal", error.message);
  const total = count ?? 0;
  const now = new Date();
  return {
    body: {
      data: (data ?? []).map((r) => toVehicleListItem(r, now)),
      page: {
        next_cursor: offset + query.limit < total ? encodeCursor({ o: offset + query.limit }) : null,
        total,
        total_is_estimate: false,
      },
    },
    dataSource: org.isDemo ? "simulated" : undefined,
  };
});
