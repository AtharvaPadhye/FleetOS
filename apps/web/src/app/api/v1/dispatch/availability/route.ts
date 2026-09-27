import type { SupabaseClient } from "@supabase/supabase-js";
import { apiRoute, ApiProblem } from "@/lib/api/handler";
import { getDispatchAvailability, postDispatchAvailability } from "@/lib/api/operations";

export const dynamic = "force-dynamic";

// SUBSTITUTE(dispatch, simulated): network availability is a FleetOS-side switch; no robotaxi network is told.
//   Real source: none available as of 2026-09-27 (no platform dispatch API); "return to service" is a FleetOS status meanwhile.
//   Replace by: a dispatch provider that calls the network's API and writes back its confirmed availability.
//   Docs: docs/requirements/data-sources.md §5
async function availability(db: SupabaseClient, orgId: string) {
  const [{ data: cars, error }, { data: overrides, error: oErr }] = await Promise.all([
    db
      .from("vehicle_list")
      .select("id, number, status, status_since, home_hub_name, lifecycle")
      .eq("org_id", orgId)
      .eq("lifecycle", "commissioned")
      .order("number")
      .limit(1000),
    db.from("dispatch_overrides").select("vehicle_id, on_network, updated_at").eq("org_id", orgId).limit(1000),
  ]);
  if (error || oErr) throw new ApiProblem("internal", (error ?? oErr)!.message);
  const byId = new Map((overrides ?? []).map((o) => [o.vehicle_id as string, o]));
  return (cars ?? []).map((c) => {
    const o = byId.get(c.id as string);
    return {
      vehicle_id: c.id as string,
      // Without an override, a car is on the network while it can take rides (In Service or Ready).
      on_network: o ? (o.on_network as boolean) : c.status === "in_service" || c.status === "ready",
      zone: (c.home_hub_name as string | null) ?? null,
      updated_at: new Date((o?.updated_at ?? c.status_since ?? new Date().toISOString()) as string).toISOString(),
    };
  });
}

/** Preview `dispatch`: which cars are on the ride-hailing network. */
export const GET = apiRoute(getDispatchAvailability, async ({ db, org }) => ({ body: await availability(db, org.id) }));

/** Preview `dispatch`: take cars on or off the network (owner / admin / ops). */
export const POST = apiRoute(postDispatchAvailability, async ({ db, org, user, body }) => {
  const { count } = await db
    .from("vehicles")
    .select("id", { count: "exact", head: true })
    .eq("org_id", org.id)
    .in("id", body.vehicle_ids);
  if ((count ?? 0) !== new Set(body.vehicle_ids).size)
    throw new ApiProblem("validation_failed", "Some vehicle_ids aren't vehicles in this organization.");
  const now = new Date().toISOString();
  const { error } = await db.from("dispatch_overrides").upsert(
    [...new Set(body.vehicle_ids)].map((vehicle_id) => ({
      org_id: org.id,
      vehicle_id,
      on_network: body.on_network,
      reason: body.reason ?? null,
      updated_by: user.id,
      updated_at: now,
    })),
  );
  if (error) throw new ApiProblem("internal", error.message);
  return { body: await availability(db, org.id) };
});
