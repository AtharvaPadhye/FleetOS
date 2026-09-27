import { currentTariff, type TariffPeriod } from "@fleetos/domain";
import { apiRoute, ApiProblem } from "@/lib/api/handler";
import { getTariffsLive } from "@/lib/api/operations";

export const dynamic = "force-dynamic";

/** Preview `live_tariffs`: the price now at each hub (or one hub) and when it next changes. */
export const GET = apiRoute(getTariffsLive, async ({ db, org, query }) => {
  let q = db.from("hubs").select("id, tariffs(schedule)").eq("org_id", org.id).not("tariff_id", "is", null);
  if (query.hub_id) q = q.eq("id", query.hub_id);
  const { data, error } = await q.returns<{ id: string; tariffs: { schedule: TariffPeriod[] } | null }[]>();
  if (error) throw new ApiProblem("internal", error.message);
  if (query.hub_id && !data.length) throw new ApiProblem("not_found", "No such hub, or it has no tariff.");
  const now = new Date();
  return {
    body: data
      .filter((h) => h.tariffs)
      .map((h) => {
        const t = currentTariff(h.tariffs!.schedule, org.timezone, now);
        return {
          hub_id: h.id,
          price_cents_per_kwh: t.centsPerKwh,
          period: t.label ?? "Standard",
          ...(t.validUntil ? { valid_until: t.validUntil.toISOString() } : {}),
        };
      }),
  };
});
