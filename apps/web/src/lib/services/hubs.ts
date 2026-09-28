import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  currentTariff,
  CYBERCAB_SPEC,
  forecastHub,
  hubDrainPerHour,
  overloadWindows,
  pnl,
  projectSessions,
  recommendations,
  type ForecastInput,
  type HourForecast,
  type HubDecision,
  type LedgerCategory,
  type Recommendation,
  type Session,
  type TariffPeriod,
  type VehicleStatus,
} from "@fleetos/domain";
import { ApiProblem } from "@/lib/api/problem";
import { baselineWindow, hoursTotals, orgSettings, vehicleMoney, fleetMoney } from "@/lib/api/kpi-data";
import { baselineRateCentsPerHour } from "@/lib/api/kpis";
import { localDay, localMidnight, resolvePeriod } from "@/lib/api/period";
import { MONEY_ROLES } from "@/lib/api/vehicles";
import type { OrgContext } from "@/lib/api/handler";

/**
 * Hubs (task 5.7, PRD HB-1..HB-5, kpis.md §3.6): occupancy, today's charger forecast, overload windows and
 * ranked mitigations, all from one snapshot of the org so every hub's forecast sees the others' routing.
 */
type Org = Pick<OrgContext, "id" | "role" | "timezone" | "isDemo">;
const H = 3_600_000;
const PAGE = 1000;

interface HubRow {
  id: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  radius_m: number;
  tariff_id: string | null;
  operating_hours: Record<string, unknown>;
}
interface CarRow {
  id: string;
  number: string;
  home_hub_id: string | null;
  current_hub_id: string | null;
  soc: number | string | null;
  charge_state: string | null;
  status: VehicleStatus;
  lifecycle: string;
}

async function paged<T>(
  fetch: (a: number, b: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
) {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await fetch(from, from + PAGE - 1);
    if (error) throw new ApiProblem("internal", error.message);
    out.push(...((data ?? []) as T[]));
    if (((data ?? []) as T[]).length < PAGE) return out;
  }
}

export interface HubView {
  id: string;
  name: string;
  address: string | null;
  location: { lat: number; lng: number };
  radius_m: number;
  operating_hours: Record<string, unknown>;
  chargers_total: number;
  charger_kw: number | null;
  bays: { cleaning: number; maintenance: number; parking: number };
  vehicles_assigned: number;
  vehicles_present: number;
  present: { vehicle_id: string; number: string; status: VehicleStatus; soc: number | null; charging: boolean }[];
  chargers_occupied: number;
  chargers_occupied_source: "inferred";
  electricity_price_cents_per_kwh: number | null;
  tariff_label: string | null;
  tariff_source: "manual" | "urdb" | "arcadia";
  avg_turnaround_min: number | null;
  revenue_today_cents: number | null;
  forecast: HourForecast[];
  peak_forecast_utilization: number | null;
  overloads: { from: number; to: number; peak: number }[];
  recommendations: (Recommendation & { status: "proposed" | "applied" })[];
  decisions: {
    id: string;
    title: string;
    detail: string | null;
    applied_at: string;
    applied_by: string | null;
    window_to: string;
  }[];
}

/** Every hub with its occupancy, forecast and recommendations (the Hubs page and /api/v1/hubs*). */
export async function hubsSnapshot(
  db: SupabaseClient,
  org: Org,
  now = new Date(),
): Promise<{ hubs: HubView[]; asOf: number; drain: { perHour: number; measured: boolean } }> {
  const tz = org.timezone;
  const today = localDay(now, tz);
  const dayStart = localMidnight(today, tz).getTime();
  const since7 = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const canSeeMoney = MONEY_ROLES.has(org.role);
  const period = resolvePeriod({ period: "today" }, tz, now, "today");
  const settings = await orgSettings(db, org.id);
  const base = baselineWindow(period, settings.baselineDays);
  const hourFmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" });
  const localHour = (t: number) => Number(hourFmt.format(new Date(t))) % 24;

  const [hubs, chargers, bays, cars, sessions, days7, decisions, visits, tariffs, money, baseHours, baseMoney] =
    await Promise.all([
      db
        .from("hub_list")
        .select("id, name, address, lat, lng, radius_m, tariff_id, operating_hours")
        .eq("org_id", org.id)
        .order("name"),
      db.from("hub_chargers").select("hub_id, max_kw").eq("org_id", org.id),
      db.from("hub_bays").select("hub_id, kind").eq("org_id", org.id),
      paged<CarRow>((a, b) =>
        db
          .from("vehicle_list")
          .select("id, number, home_hub_id, current_hub_id, soc, charge_state, status, lifecycle")
          .eq("org_id", org.id)
          .order("id")
          .range(a, b),
      ),
      paged<{ hub_id: string | null; started_at: string; ended_at: string; energy_kwh: number | string }>((a, b) =>
        db
          .from("charging_sessions")
          .select("hub_id, started_at, ended_at, energy_kwh")
          .eq("org_id", org.id)
          .gte("ended_at", since7)
          .order("id")
          .range(a, b),
      ),
      db
        .from("fleet_day_hours")
        .select("in_service_h")
        .eq("org_id", org.id)
        .gte("day", localDay(new Date(now.getTime() - 7 * 86_400_000), tz)),
      db
        .from("hub_decisions")
        .select(
          "id, hub_id, recommendation_id, kind, title, detail, vehicle_ids, to_hub_id, window_from, window_to, applied_at, applied_by",
        )
        .eq("org_id", org.id)
        .gte("window_to", new Date(dayStart).toISOString())
        .order("applied_at", { ascending: false }),
      db
        .from("hub_visits")
        .select("hub_id, arrived_at, departed_at")
        .eq("org_id", org.id)
        .gte("departed_at", since7)
        .limit(10_000),
      db.from("tariffs").select("id, source, schedule").eq("org_id", org.id),
      canSeeMoney ? vehicleMoney(db, org.id, today, today) : Promise.resolve(null),
      canSeeMoney ? hoursTotals(db, org.id, base.fromDay, base.toDay) : Promise.resolve([]),
      canSeeMoney ? fleetMoney(db, org.id, base.fromDay, base.toDay) : Promise.resolve([]),
    ]);
  const err =
    hubs.error ?? chargers.error ?? bays.error ?? days7.error ?? decisions.error ?? visits.error ?? tariffs.error;
  if (err) throw new ApiProblem("internal", err.message);

  const rate = canSeeMoney ? baselineRateCentsPerHour(baseHours, baseMoney) : null;
  const inService = ((days7.data ?? []) as { in_service_h: number | string }[]).reduce(
    (s, r) => s + Number(r.in_service_h),
    0,
  );
  const energy = sessions.reduce((s, r) => s + Number(r.energy_kwh), 0);
  const measured = hubDrainPerHour(energy, inService, CYBERCAB_SPEC.batteryKwh);
  const drainPerHour = measured ?? CYBERCAB_SPEC.defaultDrainPerHour;
  const hours = Array.from({ length: 24 }, (_, i) => dayStart + i * H);
  const firstSession = sessions.reduce((m, s) => Math.min(m, Date.parse(s.started_at)), Infinity);
  const historyDays = Number.isFinite(firstSession)
    ? Math.min(7, Math.floor((now.getTime() - firstSession) / 86_400_000))
    : 0;
  const active = cars.filter((c) => c.lifecycle !== "retired");
  const allDecisions = (decisions.data ?? []) as {
    id: string;
    hub_id: string;
    recommendation_id: string;
    kind: "route" | "delay";
    title: string;
    detail: string | null;
    vehicle_ids: string[];
    to_hub_id: string | null;
    window_from: string;
    window_to: string;
    applied_at: string;
    applied_by: string | null;
  }[];
  const asDecision = (d: (typeof allDecisions)[number]): HubDecision => ({
    kind: d.kind,
    vehicleIds: d.vehicle_ids,
    from: Date.parse(d.window_from),
    to: Date.parse(d.window_to),
  });

  // Per hub: the forecast input (its own cars) and history profile.
  const inputs = new Map<string, ForecastInput>();
  for (const h of (hubs.data ?? []) as HubRow[]) {
    const kws = ((chargers.data ?? []) as { hub_id: string; max_kw: number | string }[]).filter(
      (c) => c.hub_id === h.id,
    );
    const profile = Array.from({ length: 24 }, () => 0);
    const actual = new Map<number, number>();
    for (const s of sessions.filter((x) => x.hub_id === h.id)) {
      const a = Date.parse(s.started_at);
      const b = Date.parse(s.ended_at);
      for (let t = Math.floor(a / H) * H; t < b; t += H) {
        const used = (Math.min(b, t + H) - Math.max(a, t)) / H;
        profile[localHour(t)]! += used;
        // Hours of today (hour starts align with local hours in whole-hour time zones).
        if (t >= dayStart) actual.set(t, (actual.get(t) ?? 0) + used);
      }
    }
    inputs.set(h.id, {
      now: now.getTime(),
      hours,
      chargers: kws.length,
      chargerKw: kws.length ? kws.reduce((s, c) => s + Number(c.max_kw), 0) / kws.length : 50,
      batteryKwh: CYBERCAB_SPEC.batteryKwh,
      chargeAt: settings.lowSocThreshold,
      chargeTarget: CYBERCAB_SPEC.chargeTarget,
      drainPerHour,
      cars: active
        .filter((c) => c.home_hub_id === h.id)
        .map((c) => ({
          id: c.id,
          number: c.number,
          soc: c.soc === null ? null : Number(c.soc),
          chargingNow: c.charge_state === "charging" || c.charge_state === "starting",
        })),
      history: historyDays ? { byLocalHour: profile.map((v) => v / historyDays), days: historyDays } : null,
      localHour,
      actual,
      decisions: allDecisions.filter((d) => d.hub_id === h.id).map(asDecision),
    });
  }
  // Cars routed to a hub add their sessions there.
  const incoming = new Map<string, Session[]>();
  for (const d of allDecisions.filter((x) => x.kind === "route" && x.to_hub_id)) {
    const src = inputs.get(d.hub_id);
    if (!src) continue;
    const moved = projectSessions({ ...src, decisions: [] }).filter(
      (s) => d.vehicle_ids.includes(s.carId) && s.end > Date.parse(d.window_from) && s.start < Date.parse(d.window_to),
    );
    incoming.set(d.to_hub_id!, [...(incoming.get(d.to_hub_id!) ?? []), ...moved]);
  }
  const forecasts = new Map<string, HourForecast[]>();
  for (const [id, input] of inputs) {
    input.incoming = incoming.get(id) ?? [];
    forecasts.set(id, forecastHub(input));
  }

  const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  const label = (a: number, b: number) =>
    a === b ? timeFmt.format(new Date(a)) : `${timeFmt.format(new Date(a))}–${timeFmt.format(new Date(b))}`;
  const revenueByCar = new Map<string, number>();
  for (const m of money ?? []) {
    if (!m.vehicle_id) continue;
    const p = pnl([{ category: m.category as LedgerCategory, amountCents: Number(m.amount_cents) }]);
    revenueByCar.set(m.vehicle_id, (revenueByCar.get(m.vehicle_id) ?? 0) + p.grossRevenueCents);
  }
  const tariffById = new Map(
    ((tariffs.data ?? []) as { id: string; source: HubView["tariff_source"]; schedule: TariffPeriod[] }[]).map((t) => [
      t.id,
      t,
    ]),
  );

  const views = ((hubs.data ?? []) as HubRow[]).map((h): HubView => {
    const input = inputs.get(h.id)!;
    const forecast = forecasts.get(h.id)!;
    const present = active.filter((c) => c.current_hub_id === h.id);
    const hubBays = ((bays.data ?? []) as { hub_id: string; kind: "cleaning" | "maintenance" | "parking" }[]).filter(
      (b) => b.hub_id === h.id,
    );
    const tariff = h.tariff_id ? tariffById.get(h.tariff_id) : undefined;
    let price: { centsPerKwh: number; label: string | null } | null = null;
    try {
      price = tariff ? currentTariff(tariff.schedule, tz, now) : null;
    } catch {
      price = null; // a schedule that doesn't cover now: show no price rather than a wrong one
    }
    const hubVisits = ((visits.data ?? []) as { hub_id: string; arrived_at: string; departed_at: string }[]).filter(
      (v) => v.hub_id === h.id,
    );
    const recs = recommendations({
      forecast: input,
      hours: forecast,
      otherHubs: ((hubs.data ?? []) as HubRow[])
        .filter((o) => o.id !== h.id)
        .map((o) => ({
          id: o.id,
          name: o.name,
          spareInWindow: (from: number, to: number) => {
            const f = forecasts.get(o.id)!.filter((x) => x.hour >= from && x.hour < to);
            const cap = inputs.get(o.id)!.chargers;
            return cap - Math.max(0, ...f.map((x) => x.demand));
          },
        })),
      rateCentsPerHour: rate,
      hubName: h.name,
      label,
      floorSoc: CYBERCAB_SPEC.floorSoc,
    });
    const hubDecisions = allDecisions.filter((d) => d.hub_id === h.id);
    const applied = new Set(hubDecisions.map((d) => d.recommendation_id));
    const future = forecast.filter((x) => x.hour + H > now.getTime() && x.utilization !== null);
    return {
      id: h.id,
      name: h.name,
      address: h.address,
      location: { lat: h.lat, lng: h.lng },
      radius_m: h.radius_m,
      operating_hours: h.operating_hours,
      chargers_total: input.chargers,
      charger_kw: input.chargers ? Math.round(input.chargerKw) : null,
      bays: {
        cleaning: hubBays.filter((b) => b.kind === "cleaning").length,
        maintenance: hubBays.filter((b) => b.kind === "maintenance").length,
        parking: hubBays.filter((b) => b.kind === "parking").length,
      },
      vehicles_assigned: input.cars.length,
      vehicles_present: present.length,
      present: present.map((c) => ({
        vehicle_id: c.id,
        number: c.number,
        status: c.status,
        soc: c.soc === null ? null : Number(c.soc),
        charging: c.charge_state === "charging" || c.charge_state === "starting",
      })),
      // SUBSTITUTE(charger_telemetry, inferred): occupied chargers = cars at the hub whose charge state is Charging.
      //   Real source: OCPP StatusNotification from depot chargers (task 3.9 preview /hubs/{id}/chargers/live).
      //   Replace by: read connector status from hub_chargers once OCPP is ingested; set the source to 'ocpp'.
      //   Docs: docs/requirements/data-sources.md §5
      chargers_occupied: Math.min(
        input.chargers,
        present.filter((c) => c.charge_state === "charging" || c.charge_state === "starting").length,
      ),
      chargers_occupied_source: "inferred",
      electricity_price_cents_per_kwh: price?.centsPerKwh ?? null,
      tariff_label: price?.label ?? null,
      tariff_source: tariff?.source ?? "manual",
      avg_turnaround_min: hubVisits.length
        ? Math.round(
            hubVisits.reduce((s, v) => s + (Date.parse(v.departed_at) - Date.parse(v.arrived_at)), 0) /
              hubVisits.length /
              60_000,
          )
        : null,
      revenue_today_cents: money ? input.cars.reduce((s, c) => s + (revenueByCar.get(c.id) ?? 0), 0) : null,
      forecast,
      peak_forecast_utilization: future.length ? Math.max(...future.map((x) => x.utilization!)) : null,
      overloads: overloadWindows(forecast, now.getTime()),
      recommendations: recs.map((r) => ({
        ...r,
        status: applied.has(r.id) ? ("applied" as const) : ("proposed" as const),
      })),
      decisions: hubDecisions.map((d) => ({
        id: d.id,
        title: d.title,
        detail: d.detail,
        applied_at: new Date(d.applied_at).toISOString(),
        applied_by: d.applied_by,
        window_to: new Date(d.window_to).toISOString(),
      })),
    };
  });
  return { hubs: views, asOf: now.getTime(), drain: { perHour: drainPerHour, measured: measured !== null } };
}

export async function hubView(db: SupabaseClient, org: Org, id: string, now = new Date()) {
  const snap = await hubsSnapshot(db, org, now);
  const hub = snap.hubs.find((h) => h.id === id);
  if (!hub) throw new ApiProblem("not_found", "No such hub.");
  return { hub, snap };
}

/** Apply a recommendation (HB-4, flows.md F6): records the decision; the forecast moves that demand. */
export async function applyRecommendation(
  db: SupabaseClient,
  org: Org,
  hubId: string,
  recId: string,
  now = new Date(),
) {
  const { hub } = await hubView(db, org, hubId, now);
  const rec = hub.recommendations.find((r) => r.id === recId);
  if (!rec) throw new ApiProblem("not_found", "That recommendation no longer applies. The forecast has changed.");
  if (rec.status === "applied") return rec;
  const { error } = await db.from("hub_decisions").insert({
    org_id: org.id,
    hub_id: hubId,
    recommendation_id: rec.id,
    kind: rec.kind,
    title: rec.title,
    detail: rec.detail,
    vehicle_ids: rec.vehicleIds,
    to_hub_id: rec.toHubId,
    window_from: new Date(rec.from).toISOString(),
    window_to: new Date(rec.to).toISOString(),
    impact_cents: rec.impactCents,
  });
  if (error) {
    if (error.code === "23505") return { ...rec, status: "applied" as const };
    if (error.code === "42501")
      throw new ApiProblem("forbidden", "Only owners, admins and ops can apply recommendations.");
    throw new ApiProblem("internal", error.message);
  }
  return { ...rec, status: "applied" as const };
}

export interface HubInput {
  name: string;
  address?: string;
  lat: number;
  lng: number;
  radius_m: number;
  chargers: number;
  charger_kw?: number;
  bays: { cleaning: number; maintenance: number; parking: number };
  operating_hours?: Record<string, unknown>;
  flat_cents_per_kwh?: number;
}

/** Create or update a hub with its chargers, bays and (optional) flat tariff in one audited step (HB-5). */
export async function saveHub(db: SupabaseClient, org: Pick<OrgContext, "id">, id: string | null, input: HubInput) {
  const { data, error } = await db.rpc("hub_save", {
    p_org: org.id,
    p_id: id,
    p_name: input.name,
    p_address: input.address ?? null,
    p_lat: input.lat,
    p_lng: input.lng,
    p_radius_m: input.radius_m,
    p_chargers: input.chargers,
    p_charger_kw: input.charger_kw ?? 50,
    p_bays: input.bays,
    p_operating_hours: input.operating_hours ?? null,
    p_flat_cents_per_kwh: input.flat_cents_per_kwh ?? null,
  });
  if (error) {
    if (error.code === "22023" || error.code === "23514") throw new ApiProblem("validation_failed", error.message);
    if (error.code === "23505") throw new ApiProblem("conflict", "A hub with that name already exists.");
    if (error.code === "42501")
      throw new ApiProblem(
        "forbidden",
        "Only owners and admins can change tariffs; owners, admins and ops can change hubs.",
      );
    if (error.code === "P0002") throw new ApiProblem("not_found", "No such hub.");
    throw new ApiProblem("internal", error.message);
  }
  return data as string;
}

/** API shapes (the OpenAPI Hub / Recommendation schemas). */
export const toHubApi = (h: HubView) => ({
  id: h.id,
  name: h.name,
  address: h.address,
  location: h.location,
  chargers_total: h.chargers_total,
  bays: h.bays,
  vehicles_assigned: h.vehicles_assigned,
  vehicles_present: h.vehicles_present,
  chargers_occupied: h.chargers_occupied,
  chargers_occupied_source: h.chargers_occupied_source,
  electricity_price_cents_per_kwh: h.electricity_price_cents_per_kwh,
  tariff_source: h.tariff_source,
  peak_forecast_utilization: h.peak_forecast_utilization,
});
export const toRecommendationApi = (r: HubView["recommendations"][number]) => ({
  id: r.id,
  title: r.title,
  detail: r.detail,
  impact_cents: r.impactCents,
  impact_note: r.impactCents ? "Ride time kept by not queueing at the chargers, at the fleet's baseline rate" : null,
  status: r.status,
  actions: [
    {
      kind: r.kind,
      vehicle_ids: r.vehicleIds,
      to_hub_id: r.toHubId,
      from: new Date(r.from).toISOString(),
      to: new Date(r.to).toISOString(),
      // Routing and charge limits are manual until dispatch / vehicle commands exist (Phase 7).
      manual: true,
    },
  ],
});

/** API body → saveHub input (chargers and bays arrive as lists; a polygon geofence isn't supported yet). */
export function hubInputFromApi(
  body: {
    name: string;
    address?: string;
    location: { lat: number; lng: number };
    geofence?: unknown;
    chargers?: { max_kw?: number }[];
    bays?: { kind: "cleaning" | "maintenance" | "parking" }[];
    operating_hours?: Record<string, unknown>;
  },
  current?: HubView,
): HubInput {
  if (body.geofence)
    throw new ApiProblem("validation_failed", "Polygon geofences aren't supported yet; hubs use a radius.");
  const kws = (body.chargers ?? []).map((c) => c.max_kw).filter((k): k is number => k !== undefined);
  const count = (k: "cleaning" | "maintenance" | "parking") =>
    body.bays ? body.bays.filter((b) => b.kind === k).length : (current?.bays[k] ?? 0);
  return {
    name: body.name,
    address: body.address,
    lat: body.location.lat,
    lng: body.location.lng,
    radius_m: current?.radius_m ?? 150,
    chargers: body.chargers ? body.chargers.length : (current?.chargers_total ?? 0),
    charger_kw: kws.length ? kws.reduce((a, b) => a + b, 0) / kws.length : (current?.charger_kw ?? 50),
    bays: { cleaning: count("cleaning"), maintenance: count("maintenance"), parking: count("parking") },
    operating_hours: body.operating_hours,
  };
}

/** Point a hub at an existing tariff (owner/admin via RLS). */
export async function setHubTariff(db: SupabaseClient, org: Pick<OrgContext, "id">, hubId: string, tariffId: string) {
  const { error } = await db.from("hubs").update({ tariff_id: tariffId }).eq("org_id", org.id).eq("id", hubId);
  if (error)
    throw new ApiProblem(
      error.code === "23503" ? "validation_failed" : "internal",
      error.code === "23503" ? "No such tariff." : error.message,
    );
}
