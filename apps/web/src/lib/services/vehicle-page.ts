import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { ApiProblem } from "@/lib/api/problem";
import { getAppContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { getVehicleDetail } from "./vehicle-detail";
import { listExceptions } from "./exceptions";
import { vehicleBlockers } from "./tickets";

/** The vehicle behind /fleet/[number] and its tabs, loaded once per request (layout + page share it). */
export const loadVehiclePage = cache(async (number: string) => {
  const { activeOrg } = await getAppContext();
  if (!activeOrg) notFound();
  const db = await createClient();
  try {
    const vehicle = await getVehicleDetail(db, activeOrg, { number: decodeURIComponent(number) });
    // Open issues for the header (PRD VD-1), most severe first.
    const [issues, blockers] = await Promise.all([
      listExceptions(db, activeOrg, {
        status: ["open", "assigned", "in_progress"],
        vehicle_id: vehicle.id,
        sort: "severity",
        limit: 10,
        offset: 0,
      }),
      vehicleBlockers(db, activeOrg, vehicle.id),
    ]);
    return { org: activeOrg, db, vehicle, issues: issues.items, blockers };
  } catch (e) {
    if (e instanceof ApiProblem && e.code === "not_found") notFound();
    throw e;
  }
});
