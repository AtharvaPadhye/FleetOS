import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isValidVin } from "@fleetos/domain";
import { ApiProblem } from "@/lib/api/problem";
import type { VehicleCreate } from "@/lib/api/schemas";

/**
 * Add a vehicle by hand (PRD FL-5). It's commissioned now, so fixed costs start today if monthly amounts are
 * given; with no live data yet it shows as Offline until Tesla is connected (Phase 4). Runs as the user, so
 * RLS limits it to owners and admins.
 */
export async function createVehicle(db: SupabaseClient, orgId: string, input: VehicleCreate): Promise<string> {
  if (!isValidVin(input.vin))
    throw new ApiProblem("validation_failed", "That VIN's check digit doesn't match. Check it for typos.", [
      { field: "vin", message: "Check digit doesn't match" },
    ]);
  if (input.home_hub_id) {
    const { count } = await db
      .from("hubs")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("id", input.home_hub_id);
    if (!count)
      throw new ApiProblem("validation_failed", "No such hub.", [{ field: "home_hub_id", message: "No such hub" }]);
  }
  const { data, error } = await db
    .from("vehicles")
    .insert({
      org_id: orgId,
      vin: input.vin,
      number: input.number,
      display_name: input.display_name || null,
      model: "Cybercab",
      home_hub_id: input.home_hub_id ?? null,
      provider: "tesla",
      lifecycle: "commissioned",
      commissioned_at: new Date().toISOString(),
      insurance_monthly_cents: input.insurance_monthly_cents ?? null,
      financing_monthly_cents: input.financing_monthly_cents ?? null,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505")
      throw new ApiProblem(
        "conflict",
        error.message.includes("vin")
          ? "A vehicle with that VIN is already in this fleet."
          : "That number is already used in this fleet.",
      );
    if (error.code === "42501") throw new ApiProblem("forbidden", "Only owners and admins can add vehicles.");
    throw new ApiProblem("internal", error.message);
  }
  return data.id as string;
}
