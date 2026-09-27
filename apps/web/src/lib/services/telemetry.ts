import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiProblem } from "@/lib/api/problem";
import {
  autoInterval,
  INTERVALS,
  TELEMETRY_FIELDS,
  type TelemetryField,
  type TelemetryInterval,
} from "@/lib/telemetry-fields";

/**
 * Telemetry history for one vehicle (GET /vehicles/{id}/telemetry, PRD VD-7): each field bucketed by the
 * interval (auto when not given), in SI units. Samples only exist when a value changed (Fleet Telemetry
 * sends on change), so buckets with no sample are absent — never zero.
 */
export interface TelemetryPoint {
  t: string;
  v: number;
  min: number;
  max: number;
}

const MAX_SPAN_MS = 31 * 86_400_000;
const PAGE = 1000;

export async function getTelemetry(
  db: SupabaseClient,
  orgId: string,
  vehicleId: string,
  q: { fields: TelemetryField[]; from?: string; to?: string; interval?: TelemetryInterval },
  now = new Date(),
) {
  const to = q.to ? new Date(q.to) : now;
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - 86_400_000);
  if (!(to > from)) throw new ApiProblem("invalid_request", "to must be after from.");
  if (to.getTime() - from.getTime() > MAX_SPAN_MS)
    throw new ApiProblem("invalid_request", "Telemetry ranges are limited to 31 days.");
  const { count } = await db
    .from("vehicles")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("id", vehicleId);
  if (!count) throw new ApiProblem("not_found", "No such vehicle.");
  const interval = q.interval ?? autoInterval(to.getTime() - from.getTime());
  const bySource = new Map(q.fields.map((f) => [TELEMETRY_FIELDS[f].source, f]));
  const rows: { field: string; t: string; v: number; vmin: number; vmax: number }[] = [];
  for (let a = 0; ; a += PAGE) {
    const { data, error } = await db
      .rpc("telemetry_series", {
        p_org: orgId,
        p_vehicle: vehicleId,
        p_fields: [...bySource.keys()],
        p_from: from.toISOString(),
        p_to: to.toISOString(),
        p_bucket: INTERVALS[interval],
      })
      .range(a, a + PAGE - 1);
    if (error) throw new ApiProblem("internal", error.message);
    rows.push(...((data ?? []) as typeof rows));
    if ((data ?? []).length < PAGE) break;
  }
  const series = q.fields.map((field) => {
    const { source, scale } = TELEMETRY_FIELDS[field];
    const round = (x: number) => Math.round(x * scale * 1e4) / 1e4;
    return {
      field,
      points: rows
        .filter((r) => r.field === source)
        .map((r) => ({ t: new Date(r.t).toISOString(), v: round(r.v), min: round(r.vmin), max: round(r.vmax) })),
    };
  });
  return { vehicle_id: vehicleId, interval, from: from.toISOString(), to: to.toISOString(), series };
}
