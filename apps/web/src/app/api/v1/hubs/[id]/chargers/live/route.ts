import { apiRoute, ApiProblem } from "@/lib/api/handler";
import { uuidParam } from "@/lib/api/cursor";
import { getHubChargersLive } from "@/lib/api/operations";

export const dynamic = "force-dynamic";

// SUBSTITUTE(charger_telemetry, inferred): charger status = cars charging at the hub, assigned to chargers in order.
//   Real source: OCPP StatusNotification / MeterValues from depot chargers (not available for Superchargers).
//   Replace by: ingest OCPP connector status into hub_chargers and read status and power from it.
//   Docs: docs/requirements/data-sources.md §5
export const GET = apiRoute(getHubChargersLive, async ({ db, org, params }) => {
  const hubId = uuidParam(params);
  const [{ data: chargers, error }, { data: charging, error: cErr }] = await Promise.all([
    db.from("hub_chargers").select("id, label").eq("org_id", org.id).eq("hub_id", hubId).order("label"),
    db
      .from("vehicle_list")
      .select("id, charge_power_kw")
      .eq("org_id", org.id)
      .eq("current_hub_id", hubId)
      .eq("status", "charging")
      .order("id"),
  ]);
  if (error || cErr) throw new ApiProblem("internal", (error ?? cErr)!.message);
  if (!chargers?.length) {
    const { count } = await db
      .from("hubs")
      .select("id", { count: "exact", head: true })
      .eq("org_id", org.id)
      .eq("id", hubId);
    if (!count) throw new ApiProblem("not_found", "No such hub.");
  }
  const at = new Date().toISOString();
  return {
    body: (chargers ?? []).map((c, i) => {
      const car = charging?.[i];
      return {
        charger_id: c.id as string,
        status: car ? ("charging" as const) : ("available" as const),
        power_kw: car?.charge_power_kw === null || car === undefined ? null : Number(car.charge_power_kw),
        vehicle_id: (car?.id as string | undefined) ?? null,
        at,
      };
    }),
  };
});
