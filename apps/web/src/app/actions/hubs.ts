"use server";

import { revalidatePath } from "next/cache";
import { ApiProblem } from "@/lib/api/problem";
import { getAppContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { applyRecommendation, saveHub } from "@/lib/services/hubs";

export type HubFormState =
  | { status: "idle" }
  | { status: "error"; message: string; values: Record<string, string> }
  | { status: "ok"; id: string };
export type ApplyState = { status: "idle" } | { status: "error"; message: string } | { status: "ok" };

const MI = 1609.344;
const num = (v: string | undefined) => {
  const s = (v ?? "").replace(/[$,\s¢]/g, "");
  return s === "" ? undefined : Number(s);
};

/** Add or edit a hub (PRD HB-5): place, radius, chargers, bays, flat electricity price. */
export async function saveHubForm(id: string | null, _prev: HubFormState, form: FormData): Promise<HubFormState> {
  const values = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  const fail = (message: string): HubFormState => ({ status: "error", message, values });
  const name = (values.name ?? "").trim();
  if (!name) return fail("Enter the hub's name.");
  const lat = num(values.lat);
  const lng = num(values.lng);
  if (lat === undefined || lng === undefined || Number.isNaN(lat) || Number.isNaN(lng))
    return fail("Enter the hub's latitude and longitude.");
  const radiusFt = num(values.radius_ft) ?? 500;
  if (Number.isNaN(radiusFt) || radiusFt < 70 || radiusFt > 6500)
    return fail("The radius must be between 70 and 6,500 ft.");
  const ints: Record<string, number> = {};
  for (const k of ["chargers", "bays_cleaning", "bays_maintenance", "bays_parking"]) {
    const v = num(values[k]) ?? 0;
    if (!Number.isInteger(v) || v < 0 || v > 500) return fail("Chargers and bays must be whole numbers from 0 to 500.");
    ints[k] = v;
  }
  const kw = num(values.charger_kw);
  if (kw !== undefined && (Number.isNaN(kw) || kw <= 0 || kw > 1000))
    return fail("Charger power must be between 1 and 1,000 kW.");
  const price = num(values.price_cents);
  if (price !== undefined && (Number.isNaN(price) || price < 0 || price > 500))
    return fail("Enter the price in cents per kWh, e.g. 12.5.");
  try {
    const { activeOrg } = await getAppContext();
    if (!activeOrg || !["owner", "admin", "ops"].includes(activeOrg.role))
      return fail("Only owners, admins and ops can change hubs.");
    const saved = await saveHub(await createClient(), activeOrg, id, {
      name,
      address: values.address,
      lat,
      lng,
      radius_m: Math.round((radiusFt / 5280) * MI),
      chargers: ints.chargers!,
      charger_kw: kw,
      bays: { cleaning: ints.bays_cleaning!, maintenance: ints.bays_maintenance!, parking: ints.bays_parking! },
      flat_cents_per_kwh: price,
    });
    revalidatePath("/hubs", "layout");
    return { status: "ok", id: saved };
  } catch (e) {
    return fail(e instanceof ApiProblem ? e.message : "Couldn't save the hub. Try again.");
  }
}

/** Apply a mitigation (flows.md F6). */
export async function applyHubRecommendation(hubId: string, recId: string): Promise<ApplyState> {
  try {
    const { activeOrg } = await getAppContext();
    if (!activeOrg || !["owner", "admin", "ops"].includes(activeOrg.role))
      return { status: "error", message: "Only owners, admins and ops can apply recommendations." };
    await applyRecommendation(await createClient(), activeOrg, hubId, recId);
  } catch (e) {
    return { status: "error", message: e instanceof ApiProblem ? e.message : "Couldn't apply that. Try again." };
  }
  revalidatePath("/hubs", "layout");
  revalidatePath("/");
  return { status: "ok" };
}
