import { apiRoute } from "@/lib/api/handler";
import { uuidParam } from "@/lib/api/cursor";
import { getHub, patchHub } from "@/lib/api/operations";
import { hubInputFromApi, hubView, saveHub, setHubTariff, toHubApi } from "@/lib/services/hubs";

export const dynamic = "force-dynamic";

export const GET = apiRoute(getHub, async ({ db, org, params }) => ({
  body: toHubApi((await hubView(db, org, uuidParam(params))).hub),
}));

/** Replace a hub's configuration (owner/admin/ops; tariffs owner/admin). */
export const PATCH = apiRoute(patchHub, async ({ db, org, params, body }) => {
  const id = uuidParam(params);
  const { hub } = await hubView(db, org, id);
  await saveHub(db, org, id, hubInputFromApi(body, hub));
  if (body.tariff_id) await setHubTariff(db, org, id, body.tariff_id);
  return { body: toHubApi((await hubView(db, org, id)).hub) };
});
