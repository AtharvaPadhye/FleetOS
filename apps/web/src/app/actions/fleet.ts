"use server";

import { revalidatePath } from "next/cache";
import { ApiProblem } from "@/lib/api/problem";
import { VehicleCreate } from "@/lib/api/schemas";
import { FLEET_COLUMNS } from "@/lib/fleet-view";
import { getAppContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { createVehicle } from "@/lib/services/vehicles";

/** Save the fleet table's columns and row density to the user's profile (PRD FL-3: persists per user). */
export async function saveFleetPreferences(input: { columns: string[]; density: "default" | "compact" }) {
  const { user } = await getAppContext();
  if (!user) throw new Error("Sign in first.");
  const known = new Set<string>(FLEET_COLUMNS.map((c) => c.key));
  const columns = input.columns.filter((c) => known.has(c));
  const density = input.density === "compact" ? "compact" : "default";
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("preferences").eq("user_id", user.id).maybeSingle();
  const preferences = {
    ...((data?.preferences as Record<string, unknown> | undefined) ?? {}),
    fleet: { columns, density },
  };
  const { error } = await supabase.from("profiles").update({ preferences }).eq("user_id", user.id);
  if (error) throw new Error(`Couldn't save your view: ${error.message}`);
  revalidatePath("/fleet");
}

export type AddVehicleState =
  | { status: "idle" }
  /** `values` echoes what was typed: React resets a form after its action runs, so the form refills from it. */
  | { status: "error"; message: string; fields?: Record<string, string>; values: Record<string, string> }
  | { status: "ok"; number: string };

const FORM_FIELDS = ["vin", "number", "display_name", "home_hub_id", "insurance", "financing"] as const;
const echo = (form: FormData) => Object.fromEntries(FORM_FIELDS.map((k) => [k, String(form.get(k) ?? "")]));

const dollarsToCents = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").replace(/[$,\s]/g, "");
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : Number.NaN;
};

/** Add a vehicle by hand (owner/admin), through the same service as POST /api/v1/vehicles. */
export async function addVehicle(_prev: AddVehicleState, form: FormData): Promise<AddVehicleState> {
  const { activeOrg } = await getAppContext();
  if (!activeOrg) return { status: "error", message: "Pick an organization first.", values: echo(form) };
  if (activeOrg.role !== "owner" && activeOrg.role !== "admin")
    return { status: "error", message: "Only owners and admins can add vehicles.", values: echo(form) };
  const parsed = VehicleCreate.safeParse({
    vin: form.get("vin"),
    number: form.get("number"),
    display_name: form.get("display_name") || undefined,
    home_hub_id: form.get("home_hub_id") || undefined,
    insurance_monthly_cents: dollarsToCents(form.get("insurance")),
    financing_monthly_cents: dollarsToCents(form.get("financing")),
  });
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const i of parsed.error.issues) {
      const key = String(i.path[0]).replace("_monthly_cents", "");
      fields[key] ??= i.code === "invalid_type" ? "Enter an amount in dollars, like 486.00." : i.message;
    }
    return { status: "error", message: "Check the highlighted fields.", fields, values: echo(form) };
  }
  try {
    await createVehicle(await createClient(), activeOrg.id, parsed.data);
  } catch (e) {
    if (e instanceof ApiProblem)
      return {
        status: "error",
        message: e.message,
        fields: Object.fromEntries((e.details ?? []).map((d) => [String(d.field), String(d.message)])),
        values: echo(form),
      };
    throw e;
  }
  revalidatePath("/fleet");
  return { status: "ok", number: parsed.data.number };
}
