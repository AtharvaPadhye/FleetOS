import { apiRoute } from "@/lib/api/handler";
import { uuidParam } from "@/lib/api/cursor";
import { postHubRecommendationApply } from "@/lib/api/operations";
import { applyRecommendation, toRecommendationApi } from "@/lib/services/hubs";

export const dynamic = "force-dynamic";

/** Record the plan; the forecast moves that demand (flows.md F6). Idempotent. */
export const POST = apiRoute(postHubRecommendationApply, async ({ db, org, params }) => ({
  body: toRecommendationApi(
    await applyRecommendation(db, org, uuidParam(params), decodeURIComponent(params.rid ?? "")),
  ),
}));
