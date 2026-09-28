import { apiRoute } from "@/lib/api/handler";
import { getPolicies, putPolicies } from "@/lib/api/operations";
import { listPolicies, savePolicies } from "@/lib/services/settings";

export const dynamic = "force-dynamic";

const out = (p: Awaited<ReturnType<typeof listPolicies>>) =>
  p.map((x) => ({ key: x.key, name: x.name, kind: x.kind, config: x.config, enabled: x.enabled }));

/** Fleet policies (ST-2): MIN-SOC, CHG-TARGET, CLN-02, AUTO-DISPATCH, each backed by the setting that drives it. */
export const GET = apiRoute(getPolicies, async ({ db, org }) => ({ body: out(await listPolicies(db, org)) }));

/** Apply the given policies (owner/admin); unknown keys answer 422. */
export const PUT = apiRoute(putPolicies, async ({ db, org, body }) => ({
  body: out(await savePolicies(db, org, body)),
}));
