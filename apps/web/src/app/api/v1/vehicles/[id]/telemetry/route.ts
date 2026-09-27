import { apiRoute } from "@/lib/api/handler";
import { uuidParam } from "@/lib/api/cursor";
import { getVehicleTelemetry } from "@/lib/api/operations";
import { getTelemetry } from "@/lib/services/telemetry";
import { TELEMETRY_FIELD_NAMES } from "@/lib/telemetry-fields";

export const dynamic = "force-dynamic";

/** Telemetry history in SI units (default: every field, last 24 h, auto interval). Owner / admin / ops only (RLS). */
export const GET = apiRoute(getVehicleTelemetry, async ({ db, org, params, query }) => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { from, to, ...body } = await getTelemetry(db, org.id, uuidParam(params), {
    ...query,
    fields: query.fields?.length ? query.fields : TELEMETRY_FIELD_NAMES,
  });
  return { body, dataSource: org.isDemo ? "simulated" : undefined };
});
