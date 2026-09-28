import { apiRoute } from "@/lib/api/handler";
import { uuidParam } from "@/lib/api/cursor";
import { getHubRecommendations } from "@/lib/api/operations";
import { hubView, toRecommendationApi } from "@/lib/services/hubs";

export const dynamic = "force-dynamic";

/** Ranked mitigations for today's first overload window (HB-4); empty when there's no overload. */
export const GET = apiRoute(getHubRecommendations, async ({ db, org, params }) => ({
  body: (await hubView(db, org, uuidParam(params))).hub.recommendations.map(toRecommendationApi),
}));
