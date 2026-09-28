import { apiRoute } from "@/lib/api/handler";
import { getHubs, postHub } from "@/lib/api/operations";
import { hubInputFromApi, hubsSnapshot, hubView, saveHub, setHubTariff, toHubApi } from "@/lib/services/hubs";

export const dynamic = "force-dynamic";

/** Hubs with occupancy, tariff now and today's peak forecast (PRD HB-1). */
export const GET = apiRoute(getHubs, async ({ db, org }) => ({
  body: (await hubsSnapshot(db, org)).hubs.map(toHubApi),
  dataSource: org.isDemo ? ("simulated" as const) : undefined,
}));

/** Add a hub (HB-5): chargers and bays as lists; a radius of 150 m until geofence drawing arrives. */
export const POST = apiRoute(postHub, async ({ db, org, body }) => {
  const id = await saveHub(db, org, null, hubInputFromApi(body));
  if (body.tariff_id) await setHubTariff(db, org, id, body.tariff_id);
  return { body: toHubApi((await hubView(db, org, id)).hub), status: 201 };
});
