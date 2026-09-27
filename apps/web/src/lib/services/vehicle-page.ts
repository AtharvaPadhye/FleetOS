import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { ApiProblem } from "@/lib/api/problem";
import { getAppContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { getVehicleDetail } from "./vehicle-detail";

/** The vehicle behind /fleet/[number] and its tabs, loaded once per request (layout + page share it). */
export const loadVehiclePage = cache(async (number: string) => {
  const { activeOrg } = await getAppContext();
  if (!activeOrg) notFound();
  const db = await createClient();
  try {
    const vehicle = await getVehicleDetail(db, activeOrg, { number: decodeURIComponent(number) });
    return { org: activeOrg, db, vehicle };
  } catch (e) {
    if (e instanceof ApiProblem && e.code === "not_found") notFound();
    throw e;
  }
});
