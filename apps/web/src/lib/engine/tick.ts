import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { defaultConfig, runTick, type EngineHub, type VehicleLive } from "@fleetos/engine";
import {
  SimulatorProvider,
  type GeoPoint,
  type ProviderEvent,
  type ChargeRecord,
  type OpsRecord,
  type ProviderSnapshot,
  type RideRecord,
} from "@fleetos/providers";
import { demoHubPricing, writeCharging, writeOps } from "./costs";
import { statePatches, statusMessages } from "./broadcast";
import { writeAutonomyEvents, writeCabinEvents, type CabinEventRecord } from "./preview";
import type { StatusEventOut } from "@fleetos/engine";

/**
 * Database adapter for the engine tick (task 3.5, ADR-0014). For each demo org: restore its simulator,
 * advance it to now in chunks, run the engine on the events, write live state / history / samples / alerts,
 * then save the simulator. Idempotent: an org already ticked within the last few seconds is skipped, and
 * retried writes are deduplicated by the tables' unique keys.
 */
const CHUNK_MS = 15 * 60_000;
const MAX_CATCH_UP_MS = 24 * 3_600_000;
const MIN_INTERVAL_MS = 5_000;
const BATCH = 1000;

const wkt = (p: GeoPoint | null) => (p ? `SRID=4326;POINT(${p.lng} ${p.lat})` : null);

async function inBatches<T>(rows: T[], write: (batch: T[]) => PromiseLike<{ error: { message: string } | null }>) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await write(rows.slice(i, i + BATCH));
    if (error) throw new Error(error.message);
  }
}

export interface OrgTickResult {
  orgId: string;
  skipped?: string;
  simulatedMinutes?: number;
  events?: number;
  statusChanges?: number;
  samples?: number;
  durationMs?: number;
}

export async function tickOrg(db: SupabaseClient, orgId: string, now = new Date()): Promise<OrgTickResult> {
  const t0 = Date.now();
  const { data: sim, error: simErr } = await db
    .from("simulator_state")
    .select("snapshot, last_tick_at")
    .eq("org_id", orgId)
    .single();
  if (simErr || !sim) return { orgId, skipped: "no simulator" };
  if (now.getTime() - new Date(sim.last_tick_at as string).getTime() < MIN_INTERVAL_MS)
    return { orgId, skipped: "ticked recently" };

  let provider = SimulatorProvider.restore(sim.snapshot as ProviderSnapshot);
  if (now.getTime() - provider.now().getTime() > MAX_CATCH_UP_MS) {
    // Asleep for over a day (e.g. laptop closed): jump the simulated clock instead of replaying days.
    const snap = provider.snapshot();
    snap.world.now = now.getTime() - 60_000;
    provider = SimulatorProvider.restore(snap);
  }

  const [
    { data: org },
    { data: vehicles, error: vErr },
    { data: hubRows, error: hErr },
    { data: liveRows, error: lErr },
  ] = await Promise.all([
    db.from("orgs").select("timezone").eq("id", orgId).single(),
    db.from("vehicles").select("id, vin").eq("org_id", orgId),
    db.rpc("engine_hubs", { p_org: orgId }),
    db.rpc("engine_live_state", { p_org: orgId }),
  ]);
  if (vErr || hErr || lErr) throw new Error((vErr ?? hErr ?? lErr)!.message);

  const hubs: EngineHub[] = (
    hubRows as { id: string; lat: number; lng: number; radius_m: number; exit_buffer_m: number }[]
  ).map((h) => ({
    id: h.id,
    location: { lat: h.lat, lng: h.lng },
    radiusM: h.radius_m,
    exitBufferM: h.exit_buffer_m,
  }));
  const engineVehicles = (vehicles as { id: string; vin: string }[]).map((v) => ({ id: v.id, ref: v.vin }));
  let previous = new Map<string, VehicleLive>((liveRows as LiveRow[]).map((r) => [r.vehicle_id, fromRow(r)]));
  const cfg = defaultConfig(hubs);
  await db.rpc("engine_ensure_partitions");

  const vehicleIdByVin = new Map(engineVehicles.map((v) => [v.ref, v.id]));
  const timeZone = (org?.timezone as string | undefined) ?? "UTC";
  const localDay = new Intl.DateTimeFormat("en-CA", { timeZone });
  const day = (d: Date) => localDay.format(d);
  const pricing = await demoHubPricing(db, orgId);
  let minutes = 0;
  const totals = { events: 0, statusChanges: 0, samples: 0, alerts: 0 };
  const startLive = previous;
  const replayFrom = provider.now(); // simulated time this tick starts replaying from
  const statusEvents: StatusEventOut[] = [];
  while (provider.now().getTime() + 10_000 <= now.getTime()) {
    const from = provider.now();
    const step = Math.min(CHUNK_MS, now.getTime() - from.getTime());
    const events: ProviderEvent[] = [];
    const rides: RideRecord[] = [];
    const charges: ChargeRecord[] = [];
    const jobs: OpsRecord[] = [];
    const cabin: CabinEventRecord[] = [];
    const ac = new AbortController();
    await provider.subscribe((e) => events.push(e), ac.signal);
    const stopObserving = provider.world.observe({
      onRide: (r) => rides.push(r),
      onCharge: (c) => charges.push(c),
      onOps: (o) => jobs.push(o),
      onCabinEvent: (e) => cabin.push(e),
    });
    await provider.advance(step);
    stopObserving();
    ac.abort();
    const roster = new Map((await provider.listVehicles()).map((v) => [v.vehicleRef, v.connectivity]));
    const r = runTick(cfg, engineVehicles, previous, events, { from, to: provider.now() }, roster);
    await writeResult(db, orgId, r);
    await writeRides(db, orgId, rides, vehicleIdByVin, day);
    await writeCharging(db, orgId, charges, vehicleIdByVin, pricing, timeZone, day);
    await writeOps(db, orgId, jobs, vehicleIdByVin, day);
    await writeCabinEvents(db, orgId, cabin, vehicleIdByVin);
    await writeAutonomyEvents(db, orgId, jobs, vehicleIdByVin);
    previous = new Map(r.live.map((l) => [l.vehicleId, l]));
    statusEvents.push(...r.statusEvents);
    minutes += (provider.now().getTime() - from.getTime()) / 60_000;
    for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += r.counts[k];
  }

  // KPI rollup: hours per status per vehicle-day (task 3.8c), from the earliest day this tick replayed
  // (a catch-up across midnight changes yesterday too) or the last refreshed day, through today.
  const { error: hErr2 } = await db.rpc("engine_refresh_day_hours", {
    p_org: orgId,
    p_since: replayFrom.toISOString(),
  });
  if (hErr2) throw new Error(hErr2.message);

  // Realtime (task 3.8d): changed fields per vehicle and each status change, on private org channels.
  // Best effort: the database is the source of truth, and clients re-fetch on reconnect.
  const { error: bErr } = await db.rpc("engine_broadcast", {
    p_org: orgId,
    p_state: statePatches(startLive, [...previous.values()]),
    p_status: statusMessages(statusEvents),
  });
  if (bErr) console.error(`[tick] broadcast failed for ${orgId}: ${bErr.message}`);

  const durationMs = Date.now() - t0;
  const nowIso = now.toISOString();
  const { error: sErr } = await db
    .from("simulator_state")
    .update({ snapshot: provider.snapshot(), last_tick_at: nowIso, updated_at: nowIso })
    .eq("org_id", orgId);
  if (sErr) throw new Error(sErr.message);
  await db.from("engine_runs").upsert({
    org_id: orgId,
    last_tick_at: nowIso,
    last_duration_ms: durationMs,
    last_counts: totals,
    updated_at: nowIso,
  });
  return { orgId, simulatedMinutes: Math.round(minutes), ...totals, durationMs };
}

async function writeResult(db: SupabaseClient, orgId: string, r: ReturnType<typeof runTick>) {
  await inBatches(
    r.live.map((l) => ({
      vehicle_id: l.vehicleId,
      org_id: orgId,
      status: l.status ?? "offline",
      status_since: (l.statusSince ?? new Date()).toISOString(),
      candidate_status: l.candidateStatus,
      candidate_since: l.candidateSince?.toISOString() ?? null,
      soc: l.soc,
      range_m: l.rangeM,
      charge_state: l.chargeState,
      charge_power_kw: l.chargePowerKw,
      charge_limit_soc: l.chargeLimitSoc,
      location: wkt(l.location),
      heading: l.heading,
      speed_mps: l.speedMps,
      gear: l.gear,
      odometer_m: l.odometerM,
      locked: l.locked,
      tpms: l.tpms,
      inside_temp_c: l.insideTempC,
      outside_temp_c: l.outsideTempC,
      connectivity: l.connectivity,
      current_hub_id: l.currentHubId,
      last_telemetry_at: l.lastTelemetryAt?.toISOString() ?? null,
      active_alerts: l.activeAlerts,
      updated_at: new Date().toISOString(),
    })),
    (b) => db.from("vehicle_state_current").upsert(b),
  );
  await inBatches(
    r.statusEvents.map((e) => ({
      org_id: orgId,
      vehicle_id: e.vehicleId,
      from_status: e.from,
      to_status: e.to,
      at: e.at.toISOString(),
      cause_type: e.causeType,
      detail: e.detail,
    })),
    (b) =>
      db.from("vehicle_status_events").upsert(b, { onConflict: "vehicle_id,at,to_status", ignoreDuplicates: true }),
  );
  await inBatches(
    r.samples.map((s) => ({
      org_id: orgId,
      vehicle_id: s.vehicleId,
      field: s.field,
      ts: s.ts.toISOString(),
      value_num: s.valueNum,
      value_text: s.valueText,
      value_geo: wkt(s.valueGeo),
    })),
    (b) => db.from("telemetry_samples").upsert(b, { onConflict: "vehicle_id,field,ts", ignoreDuplicates: true }),
  );
  await inBatches(
    r.alerts.map((a) => ({
      org_id: orgId,
      vehicle_id: a.vehicleId,
      name: a.name,
      audiences: a.audiences,
      started_at: a.startedAt.toISOString(),
      ended_at: a.endedAt?.toISOString() ?? null,
      source: "simulator",
    })),
    (b) => db.from("vehicle_alerts").upsert(b, { onConflict: "vehicle_id,name,started_at" }),
  );
}

// SUBSTITUTE(rides, simulated): simulator trips become rides and ledger revenue lines.
//   Real source: none as of 2026-09-26; payout CSV imports (/financials/imports) book real revenue meanwhile.
//   Replace by: a real trip/earnings feed writing the same rows with source 'platform' / 'earnings_api'.
//   Docs: docs/requirements/data-sources.md §5
async function writeRides(
  db: SupabaseClient,
  orgId: string,
  rides: RideRecord[],
  vehicleIdByVin: Map<string, string>,
  day: (d: Date) => string,
) {
  const known = rides.filter((r) => vehicleIdByVin.has(r.vehicleRef));
  await inBatches(
    known.map((r) => ({
      org_id: orgId,
      vehicle_id: vehicleIdByVin.get(r.vehicleRef),
      external_id: r.id,
      started_at: r.startedAt.toISOString(),
      ended_at: r.endedAt.toISOString(),
      distance_m: Math.round(r.distanceM * 10) / 10,
      fare_cents: r.fareCents,
      platform_fee_cents: r.platformFeeCents,
      pickup: wkt(r.pickup),
      dropoff: wkt(r.dropoff),
      source: "simulator",
    })),
    (b) => db.from("rides").upsert(b, { onConflict: "org_id,source,external_id", ignoreDuplicates: true }),
  );
  await inBatches(
    known.flatMap((r) => {
      const base = {
        org_id: orgId,
        vehicle_id: vehicleIdByVin.get(r.vehicleRef),
        occurred_on: day(r.endedAt),
        occurred_at: r.endedAt.toISOString(),
        source: "simulator",
      };
      return [
        { ...base, category: "gross_ride_revenue", amount_cents: r.fareCents, source_ref: `${r.id}|gross` },
        { ...base, category: "platform_fee", amount_cents: r.platformFeeCents, source_ref: `${r.id}|fee` },
      ];
    }),
    (b) => db.from("ledger_entries").upsert(b, { onConflict: "org_id,source,source_ref", ignoreDuplicates: true }),
  );
}

interface LiveRow {
  vehicle_id: string;
  status: VehicleLive["status"];
  status_since: string | null;
  candidate_status: VehicleLive["status"];
  candidate_since: string | null;
  soc: number | null;
  range_m: number | null;
  charge_state: string | null;
  charge_power_kw: number | null;
  charge_limit_soc: number | null;
  lat: number | null;
  lng: number | null;
  heading: number | null;
  speed_mps: number | null;
  gear: string | null;
  odometer_m: number | null;
  locked: boolean | null;
  tpms: VehicleLive["tpms"];
  inside_temp_c: number | null;
  outside_temp_c: number | null;
  connectivity: VehicleLive["connectivity"];
  current_hub_id: string | null;
  last_telemetry_at: string | null;
  active_alerts: string[];
}

const d = (s: string | null) => (s ? new Date(s) : null);
const n = (x: number | string | null) => (x === null ? null : Number(x));

function fromRow(r: LiveRow): VehicleLive {
  return {
    vehicleId: r.vehicle_id,
    status: r.status,
    statusSince: d(r.status_since),
    candidateStatus: r.candidate_status,
    candidateSince: d(r.candidate_since),
    soc: n(r.soc),
    rangeM: n(r.range_m),
    chargeState: r.charge_state,
    chargePowerKw: n(r.charge_power_kw),
    chargeLimitSoc: n(r.charge_limit_soc),
    location: r.lat === null || r.lng === null ? null : { lat: r.lat, lng: r.lng },
    heading: n(r.heading),
    speedMps: n(r.speed_mps),
    gear: r.gear,
    odometerM: n(r.odometer_m),
    locked: r.locked,
    tpms: r.tpms,
    insideTempC: n(r.inside_temp_c),
    outsideTempC: n(r.outside_temp_c),
    connectivity: r.connectivity,
    currentHubId: r.current_hub_id,
    lastTelemetryAt: d(r.last_telemetry_at),
    activeAlerts: r.active_alerts ?? [],
    serviceMode: false,
  };
}

/** Tick every org that has a simulator. */
export async function tickAll(db: SupabaseClient, now = new Date()): Promise<OrgTickResult[]> {
  const { data, error } = await db.from("simulator_state").select("org_id");
  if (error) throw new Error(error.message);
  const out: OrgTickResult[] = [];
  for (const row of data as { org_id: string }[]) out.push(await tickOrg(db, row.org_id, now));
  return out;
}
