import { capabilityStatuses } from "@fleetos/domain";
import { apiRoute } from "@/lib/api/handler";
import { getCapabilities } from "@/lib/api/operations";

export const dynamic = "force-dynamic";

/** Which data sources are live, simulated or unavailable for the active org (api.md §3, ADR-0006). */
export const GET = apiRoute(getCapabilities, async ({ org }) => ({
  body: { org_id: org.id, capabilities: capabilityStatuses({ isDemo: org.isDemo }) },
}));
