import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OpsRecord, WorldObserver } from "@fleetos/providers";

/** Writers for preview-capability stand-ins (task 3.9): cabin and autonomy events from the simulator. */

export type CabinEventRecord = Parameters<NonNullable<WorldObserver["onCabinEvent"]>>[0];

const upsert = (db: SupabaseClient, table: string) => (rows: object[]) =>
  db.from(table).upsert(rows, { onConflict: "org_id,source,external_id", ignoreDuplicates: true });

/** Cabin events, linked to the ride that just ended (written before this, in the same tick chunk). */
export async function writeCabinEvents(
  db: SupabaseClient,
  orgId: string,
  events: CabinEventRecord[],
  vehicleIdByVin: Map<string, string>,
) {
  const known = events.filter((e) => vehicleIdByVin.has(e.vehicleRef));
  if (!known.length) return;
  const { data: rides, error } = await db
    .from("rides")
    .select("id, external_id")
    .eq("org_id", orgId)
    .eq("source", "simulator")
    .in(
      "external_id",
      known.map((e) => e.rideId),
    );
  if (error) throw new Error(error.message);
  const rideId = new Map((rides ?? []).map((r) => [r.external_id as string, r.id as string]));
  const { error: wErr } = await upsert(
    db,
    "cabin_events",
  )(
    known.map((e) => ({
      org_id: orgId,
      vehicle_id: vehicleIdByVin.get(e.vehicleRef),
      at: e.at.toISOString(),
      kind: e.kind,
      confidence: e.confidence,
      ride_id: rideId.get(e.rideId) ?? null,
      source: "simulator",
      external_id: `${e.rideId}|${e.kind}`,
    })),
  );
  if (wErr) throw new Error(wErr.message);
}

// SUBSTITUTE(autonomy_events, simulated): simulator breakdowns stand in for autonomy "stuck" events.
//   Real source: none available as of 2026-09-27 (no disengagement / remote-assist feed from Tesla or platforms).
//   Replace by: a platform autonomy-event feed writing autonomy_events with source 'platform'.
//   Docs: docs/requirements/data-sources.md §5
export async function writeAutonomyEvents(
  db: SupabaseClient,
  orgId: string,
  jobs: OpsRecord[],
  vehicleIdByVin: Map<string, string>,
) {
  const stuck = jobs.filter((j) => j.kind === "breakdown" && vehicleIdByVin.has(j.vehicleRef));
  if (!stuck.length) return;
  const { error } = await upsert(
    db,
    "autonomy_events",
  )(
    stuck.map((j) => ({
      org_id: orgId,
      vehicle_id: vehicleIdByVin.get(j.vehicleRef),
      at: j.detectedAt.toISOString(),
      kind: "stuck",
      lat: j.location.lat,
      lng: j.location.lng,
      severity: "high",
      detail: `Stopped in traffic: ${j.alert}; towed to the hub.`,
      source: "simulator",
      external_id: `${j.vehicleRef}|${j.detectedAt.toISOString()}`,
    })),
  );
  if (error) throw new Error(error.message);
}
