import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  dailyAllocationCents,
  isVehicleDay,
  scheduleGap,
  sessionCostCents,
  type LedgerCategory,
  type TariffPeriod,
} from "@fleetos/domain";
import {
  PHOENIX,
  PHOENIX_VENDORS,
  phoenixTouSchedule,
  type ChargeRecord,
  type HubKey,
  type OpsRecord,
} from "@fleetos/providers";

/**
 * Cost ledger writers (task 3.7, kpis.md §3.2): charging sessions priced by hub tariff → electricity;
 * vendor jobs → cleaning / maintenance / roadside; monthly insurance & financing → one line per vehicle-day.
 * Every line has a deterministic source_ref, so retried ticks book nothing twice.
 */
const BATCH = 1000;

async function inBatches<T>(rows: T[], write: (batch: T[]) => PromiseLike<{ error: { message: string } | null }>) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await write(rows.slice(i, i + BATCH));
    if (error) throw new Error(error.message);
  }
}

const ledgerUpsert = (db: SupabaseClient) => (b: object[]) =>
  db.from("ledger_entries").upsert(b, { onConflict: "org_id,source,source_ref", ignoreDuplicates: true });

export interface HubPricing {
  id: string;
  schedule: TariffPeriod[];
}

/**
 * Hub id + tariff per simulator hub key. Demo orgs created before task 3.7 have hubs without tariffs; they
 * get the Phoenix time-of-use tariff here, once.
 */
export async function demoHubPricing(db: SupabaseClient, orgId: string): Promise<Map<HubKey, HubPricing>> {
  const { data, error } = await db
    .from("hubs")
    .select("id, name, tariff_id, tariffs(schedule)")
    .eq("org_id", orgId)
    .returns<{ id: string; name: string; tariff_id: string | null; tariffs: { schedule: TariffPeriod[] } | null }[]>();
  if (error) throw new Error(error.message);
  const out = new Map<HubKey, HubPricing>();
  for (const spec of PHOENIX.hubs) {
    const hub = data.find((h) => h.name === spec.name);
    if (!hub) continue;
    let schedule = hub.tariffs?.schedule ?? null;
    if (!hub.tariff_id || !schedule) {
      schedule = phoenixTouSchedule(spec);
      const { data: t, error: tErr } = await db
        .from("tariffs")
        .insert({ org_id: orgId, name: `${spec.name} business TOU (demo)`, source: "manual", schedule })
        .select("id")
        .single();
      if (tErr) throw new Error(tErr.message);
      const { error: uErr } = await db.from("hubs").update({ tariff_id: t.id }).eq("id", hub.id);
      if (uErr) throw new Error(uErr.message);
    }
    const gap = scheduleGap(schedule);
    if (gap) throw new Error(`Tariff for ${spec.name} doesn't cover month ${gap.month}, day ${gap.day}`);
    out.set(spec.key, { id: hub.id, schedule });
  }
  return out;
}

// SUBSTITUTE(tesla, simulated): simulator charging sessions stand in for real charging history.
//   Real source: Tesla charging history/invoices (Superchargers) and depot sessions inferred from telemetry or OCPP.
//   Replace by: TeslaProvider.getChargingHistory + depot session inference writing the same rows (task 4.3).
//   Docs: docs/requirements/data-sources.md §2
export async function writeCharging(
  db: SupabaseClient,
  orgId: string,
  sessions: ChargeRecord[],
  vehicleIdByVin: Map<string, string>,
  hubs: Map<HubKey, HubPricing>,
  timeZone: string,
  day: (d: Date) => string,
) {
  const rows = sessions
    .filter((s) => vehicleIdByVin.has(s.vehicleRef) && hubs.has(s.hub))
    .map((s) => {
      const hub = hubs.get(s.hub)!;
      return {
        org_id: orgId,
        vehicle_id: vehicleIdByVin.get(s.vehicleRef)!,
        hub_id: hub.id,
        started_at: s.startedAt.toISOString(),
        ended_at: s.endedAt.toISOString(),
        energy_kwh: s.energyKwh,
        cost_cents: sessionCostCents(s, hub.schedule, timeZone),
        source: "simulator",
        external_id: `${s.vehicleRef}|${s.startedAt.toISOString()}`,
      };
    });
  if (rows.length === 0) return;
  // Not ignoreDuplicates: a retry must get the ids back to book any ledger line the first attempt missed.
  const { data, error } = await db
    .from("charging_sessions")
    .upsert(rows, { onConflict: "org_id,source,external_id" })
    .select("id, vehicle_id, hub_id, ended_at, cost_cents, external_id");
  if (error) throw new Error(error.message);
  await inBatches(
    (
      data as {
        id: string;
        vehicle_id: string;
        hub_id: string;
        ended_at: string;
        cost_cents: number;
        external_id: string;
      }[]
    ).map((s) => ({
      org_id: orgId,
      vehicle_id: s.vehicle_id,
      hub_id: s.hub_id,
      charging_session_id: s.id,
      occurred_on: day(new Date(s.ended_at)),
      occurred_at: s.ended_at,
      category: "electricity",
      amount_cents: s.cost_cents,
      source: "simulator",
      source_ref: `charge|${s.external_id}`,
    })),
    ledgerUpsert(db),
  );
}

// SUBSTITUTE(vendor_tracking, simulated): the simulator's ops autopilot bills cleaning, tows, tyres and repairs.
//   Real source: completed tickets / vendor jobs with actual costs (task 5.5), vendor invoices later.
//   Replace by: post these lines from ticket completion with source 'ticket' and ticket_id.
//   Docs: docs/requirements/data-sources.md §5
export async function writeOps(
  db: SupabaseClient,
  orgId: string,
  jobs: OpsRecord[],
  vehicleIdByVin: Map<string, string>,
  day: (d: Date) => string,
) {
  await inBatches(
    jobs
      .filter((j) => vehicleIdByVin.has(j.vehicleRef))
      .flatMap((j) =>
        j.costLines.map((l) => ({
          org_id: orgId,
          vehicle_id: vehicleIdByVin.get(j.vehicleRef)!,
          occurred_on: day(j.resolvedAt),
          occurred_at: j.resolvedAt.toISOString(),
          category: l.category satisfies LedgerCategory,
          amount_cents: l.cents,
          source: "simulator",
          source_ref: `ops|${j.vehicleRef}|${j.detectedAt.toISOString()}|${l.category}`,
          note: `${j.kind}: ${j.alert}`,
        })),
      ),
    ledgerUpsert(db),
  );
}

const ALLOCATION_DAYS = 31;
const FIXED: { category: "insurance" | "financing"; column: "insurance_monthly_cents" | "financing_monthly_cents" }[] =
  [
    { category: "insurance", column: "insurance_monthly_cents" },
    { category: "financing", column: "financing_monthly_cents" },
  ];

interface AllocationVehicle {
  id: string;
  org_id: string;
  lifecycle: string;
  commissioned_at: string | null;
  retired_at: string | null;
  insurance_monthly_cents: number | null;
  financing_monthly_cents: number | null;
  orgs: { timezone: string } | null;
}

/**
 * Book insurance and financing for every vehicle-day (kpis.md §3.2 "fixed allocations"), in each org's
 * local days, for today and any of the last 31 days a paused tick missed. Runs for every org, simulated or not.
 */
export async function allocateFixedCosts(db: SupabaseClient, now = new Date(), orgId?: string): Promise<number> {
  const byOrg = new Map<string, AllocationVehicle[]>();
  // Paged: the API caps a response at 1,000 rows, and fleets across orgs exceed that.
  for (let from = 0; ; from += BATCH) {
    let query = db
      .from("vehicles")
      .select(
        "id, org_id, lifecycle, commissioned_at, retired_at, insurance_monthly_cents, financing_monthly_cents, orgs(timezone)",
      )
      .or("insurance_monthly_cents.gt.0,financing_monthly_cents.gt.0")
      .order("id")
      .range(from, from + BATCH - 1);
    if (orgId) query = query.eq("org_id", orgId);
    const { data, error } = await query.returns<AllocationVehicle[]>();
    if (error) throw new Error(error.message);
    for (const v of data) byOrg.set(v.org_id, [...(byOrg.get(v.org_id) ?? []), v]);
    if (data.length < BATCH) break;
  }

  let booked = 0;
  for (const [org, vehicles] of byOrg) {
    const tz = vehicles[0]?.orgs?.timezone ?? "UTC";
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    const days = Array.from({ length: ALLOCATION_DAYS }, (_, i) =>
      fmt.format(new Date(now.getTime() - i * 86_400_000)),
    );
    const first = days[days.length - 1]!;
    const lines = vehicles.flatMap((v) => {
      const lv = {
        lifecycle: v.lifecycle,
        commissionedOn: v.commissioned_at ? fmt.format(new Date(v.commissioned_at)) : null,
        retiredOn: v.retired_at ? fmt.format(new Date(v.retired_at)) : null,
      };
      return days
        .filter((day) => isVehicleDay(lv, day))
        .flatMap((day) =>
          FIXED.filter((f) => (v[f.column] ?? 0) > 0).map((f) => ({
            org_id: org,
            vehicle_id: v.id,
            occurred_on: day,
            category: f.category,
            amount_cents: dailyAllocationCents(v[f.column]!, day),
            source: "allocation",
            source_ref: `${v.id}|${day}|${f.category}`,
          })),
        );
    });
    const { count, error: cErr } = await db
      .from("ledger_entries")
      .select("id", { count: "exact", head: true })
      .eq("org_id", org)
      .eq("source", "allocation")
      .gte("occurred_on", first);
    if (cErr) throw new Error(cErr.message);
    if ((count ?? 0) >= lines.length) continue; // already booked; the common case, one cheap count per org
    await inBatches(lines, ledgerUpsert(db));
    booked += lines.length - (count ?? 0);
  }
  return booked;
}

/** Demo orgs get the Phoenix vendor network once (task 5.6); orgs created before it get it on their next tick. */
export async function ensureDemoVendors(db: SupabaseClient, orgId: string) {
  const { count, error } = await db.from("vendors").select("id", { count: "exact", head: true }).eq("org_id", orgId);
  if (error) throw new Error(error.message);
  if (count) return;
  const { error: iErr } = await db.from("vendors").insert(
    PHOENIX_VENDORS.map((v) => ({
      org_id: orgId,
      name: v.name,
      slug: v.slug,
      categories: [...v.categories],
      status: v.status,
      contact: {},
      base_location: `SRID=4326;POINT(${v.base.lng} ${v.base.lat})`,
      service_radius_m: Math.round(v.radiusMi * 1609.344),
      pricing: v.pricing,
      sla_response_min: v.slaResponseMin,
      sla_resolution_min: v.slaResolutionMin,
      capacity_note: v.capacity,
    })),
  );
  if (iErr) throw new Error(iErr.message);
}
