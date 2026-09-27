"use server";

import { revalidatePath } from "next/cache";
import { VENDOR_CATEGORIES, type VendorCategory } from "@fleetos/domain";
import { ApiProblem } from "@/lib/api/problem";
import { getAppContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { createVendor, updateVendor, type VendorInput } from "@/lib/services/vendors";

export type VendorFormState =
  | { status: "idle" }
  | { status: "error"; message: string; values: Record<string, string | string[]> }
  | { status: "ok"; slug: string };

const MI = 1609.344;
const num = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").replace(/[$,\s]/g, "");
  return s ? Number(s) : undefined;
};

/** Parse the vendor form (dollars and miles in, cents and metres out). */
function parse(form: FormData): { input: VendorInput; errors: string[] } {
  const errors: string[] = [];
  const categories = form
    .getAll("categories")
    .map(String)
    .filter((c): c is VendorCategory => (VENDOR_CATEGORIES as readonly string[]).includes(c));
  if (!categories.length) errors.push("Pick at least one category.");
  const name = String(form.get("name") ?? "").trim();
  if (!name) errors.push("Enter the vendor's name.");
  const lat = num(form.get("lat"));
  const lng = num(form.get("lng"));
  const radiusMi = num(form.get("radius_mi"));
  if ((lat === undefined) !== (lng === undefined))
    errors.push("Enter both latitude and longitude for the base, or neither.");
  if (lat !== undefined && (Number.isNaN(lat) || lat < -90 || lat > 90))
    errors.push("Latitude must be between −90 and 90.");
  if (lng !== undefined && (Number.isNaN(lng) || lng < -180 || lng > 180))
    errors.push("Longitude must be between −180 and 180.");
  if (radiusMi !== undefined && (Number.isNaN(radiusMi) || radiusMi < 0.1 || radiusMi > 186))
    errors.push("Service radius must be between 0.1 and 186 miles.");
  const pricing: Record<string, number> = {};
  for (const c of categories) {
    const p = num(form.get(`price_${c}`));
    if (p === undefined) continue;
    if (Number.isNaN(p) || p < 0) errors.push(`Enter a price in dollars for ${c}.`);
    else pricing[c] = Math.round(p * 100);
  }
  const intOrUndef = (k: string) => {
    const v = num(form.get(k));
    if (v !== undefined && (!Number.isInteger(v) || v < 1))
      errors.push(`${k === "sla_response_min" ? "Response" : "Resolution"} target must be a whole number of minutes.`);
    return v;
  };
  const input: VendorInput = {
    name,
    categories,
    status: (["active", "limited", "inactive"] as const).find((s) => s === form.get("status")) ?? "active",
    contact: {
      ...(form.get("contact_name") ? { name: String(form.get("contact_name")).trim() } : {}),
      ...(form.get("contact_phone") ? { phone: String(form.get("contact_phone")).trim() } : {}),
      ...(form.get("contact_email") ? { email: String(form.get("contact_email")).trim() } : {}),
    },
    ...(lat !== undefined && lng !== undefined ? { base_location: { lat, lng } } : {}),
    ...(radiusMi !== undefined ? { service_radius_m: Math.round(radiusMi * MI) } : {}),
    pricing,
    ...(form.get("sla_response_min") ? { sla_response_min: intOrUndef("sla_response_min") } : {}),
    ...(form.get("sla_resolution_min") ? { sla_resolution_min: intOrUndef("sla_resolution_min") } : {}),
    capacity_note: String(form.get("capacity_note") ?? "").trim(),
  };
  return { input, errors };
}

const echo = (form: FormData) => {
  const out: Record<string, string | string[]> = {};
  for (const k of new Set(form.keys()))
    out[k] = k === "categories" ? form.getAll(k).map(String) : String(form.get(k) ?? "");
  return out;
};

/** Add (no id) or update (id) a vendor, through the same service as the API. */
export async function saveVendor(id: string | null, _prev: VendorFormState, form: FormData): Promise<VendorFormState> {
  const { activeOrg } = await getAppContext();
  if (!activeOrg) return { status: "error", message: "Pick an organization first.", values: echo(form) };
  if (!["owner", "admin", "ops"].includes(activeOrg.role))
    return { status: "error", message: "Only owners, admins and ops can manage vendors.", values: echo(form) };
  const { input, errors } = parse(form);
  if (errors.length) return { status: "error", message: errors.join(" "), values: echo(form) };
  try {
    const db = await createClient();
    const v = id
      ? await updateVendor(db, activeOrg.id, id, input)
      : await createVendor(db, activeOrg.id, input as VendorInput & { name: string; categories: VendorCategory[] });
    revalidatePath("/vendors");
    return { status: "ok", slug: v.slug };
  } catch (e) {
    if (e instanceof ApiProblem) return { status: "error", message: e.message, values: echo(form) };
    throw e;
  }
}
