import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { rankVendors, VENDOR_CATEGORIES, type VendorCategory } from "@fleetos/domain";
import { ApiProblem } from "@/lib/api/problem";
import { slugify } from "@/lib/slug";

/**
 * Vendor directory and dispatch ranking (task 5.6). Job metrics (response, cost, SLA, rating) come from the
 * vendor jobs service tickets dispatch (task 5.5); a vendor without jobs shows null / 0, never invented values.
 */
export interface VendorRow {
  id: string;
  name: string;
  slug: string;
  categories: VendorCategory[];
  status: "active" | "limited" | "inactive";
  contact: { name?: string | null; phone?: string | null; email?: string | null };
  service_radius_m: number | null;
  pricing: Record<string, number>;
  sla_response_min: number | null;
  sla_resolution_min: number | null;
  capacity_note: string | null;
  lat: number | null;
  lng: number | null;
}
export const VENDOR_COLUMNS =
  "id, name, slug, categories, status, contact, service_radius_m, pricing, sla_response_min, sla_resolution_min, capacity_note, lat, lng";

export interface VendorMetrics {
  avg_response_min: number | null;
  median_response_min: number | null;
  avg_job_cost_cents: number | null;
  sla_compliance: number | null;
  rating: number | null;
  jobs_completed: number;
}
const NO_METRICS: VendorMetrics = {
  avg_response_min: null,
  median_response_min: null,
  avg_job_cost_cents: null,
  sla_compliance: null,
  rating: null,
  jobs_completed: 0,
};

/** Job metrics per vendor over 90 days, from the jobs service tickets dispatched (kpis.md §3.3; task 5.5). */
export async function vendorMetrics(db: SupabaseClient, orgId: string): Promise<Map<string, VendorMetrics>> {
  const { data, error } = await db.from("vendor_job_metrics").select("*").eq("org_id", orgId);
  if (error) throw new ApiProblem("internal", error.message);
  const n = (x: number | string | null) => (x === null ? null : Number(x));
  const round1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10);
  return new Map(
    (
      (data ?? []) as {
        vendor_id: string;
        jobs_completed: number;
        avg_response_min: number | string | null;
        median_response_min: number | string | null;
        avg_job_cost_cents: number | string | null;
        sla_compliance: number | string | null;
        rating: number | string | null;
      }[]
    ).map((m) => [
      m.vendor_id,
      {
        avg_response_min: round1(n(m.avg_response_min)),
        median_response_min: round1(n(m.median_response_min)),
        avg_job_cost_cents: n(m.avg_job_cost_cents) === null ? null : Math.round(n(m.avg_job_cost_cents)!),
        sla_compliance: n(m.sla_compliance),
        rating: round1(n(m.rating)),
        jobs_completed: m.jobs_completed,
      },
    ]),
  );
}

export function toVendor(r: VendorRow, m: VendorMetrics = NO_METRICS) {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    categories: r.categories,
    status: r.status,
    contact: { name: r.contact.name ?? null, phone: r.contact.phone ?? null, email: r.contact.email ?? null },
    base_location: r.lat !== null && r.lng !== null ? { lat: r.lat, lng: r.lng } : null,
    service_radius_m: r.service_radius_m,
    pricing: r.pricing,
    sla_response_min: r.sla_response_min,
    sla_resolution_min: r.sla_resolution_min,
    capacity_note: r.capacity_note,
    metrics: {
      avg_response_min: m.avg_response_min,
      avg_job_cost_cents: m.avg_job_cost_cents,
      sla_compliance: m.sla_compliance,
      rating: m.rating,
      jobs_completed: m.jobs_completed,
    },
  };
}
export type Vendor = ReturnType<typeof toVendor>;

export async function listVendors(db: SupabaseClient, orgId: string, category?: VendorCategory) {
  const [{ data, error }, metrics] = await Promise.all([
    db.from("vendor_list").select(VENDOR_COLUMNS).eq("org_id", orgId).order("name").limit(1000),
    vendorMetrics(db, orgId),
  ]);
  if (error) throw new ApiProblem("internal", error.message);
  const rows = (data ?? []) as VendorRow[];
  const counts = Object.fromEntries(
    VENDOR_CATEGORIES.map((c) => [c, rows.filter((r) => r.categories.includes(c)).length]),
  ) as Record<VendorCategory, number>;
  const vendors = rows
    .filter((r) => !category || r.categories.includes(category))
    .map((r) => toVendor(r, metrics.get(r.id)));
  return { vendors, counts, total: rows.length };
}

export async function getVendor(db: SupabaseClient, orgId: string, by: { id: string } | { slug: string }) {
  let q = db.from("vendor_list").select(VENDOR_COLUMNS).eq("org_id", orgId);
  q = "id" in by ? q.eq("id", by.id) : q.eq("slug", by.slug);
  const { data, error } = await q.maybeSingle<VendorRow>();
  if (error) throw new ApiProblem("internal", error.message);
  if (!data) throw new ApiProblem("not_found", "No such vendor.");
  return toVendor(data, (await vendorMetrics(db, orgId)).get(data.id));
}

export interface VendorInput {
  name?: string;
  categories?: VendorCategory[];
  status?: "active" | "limited" | "inactive";
  contact?: { name?: string; phone?: string; email?: string };
  base_location?: { lat: number; lng: number };
  service_radius_m?: number;
  service_area?: { type: "Polygon"; coordinates: number[][][] };
  pricing?: Record<string, number>;
  sla_response_min?: number;
  sla_resolution_min?: number;
  capacity_note?: string;
}

function toRow(input: VendorInput) {
  const row: Record<string, unknown> = {};
  if (input.name !== undefined) row.name = input.name;
  if (input.categories !== undefined) row.categories = input.categories;
  if (input.status !== undefined) row.status = input.status;
  if (input.contact !== undefined) row.contact = input.contact;
  if (input.base_location !== undefined)
    row.base_location = `SRID=4326;POINT(${input.base_location.lng} ${input.base_location.lat})`;
  if (input.service_radius_m !== undefined) row.service_radius_m = Math.round(input.service_radius_m);
  if (input.service_area !== undefined)
    row.service_area = `SRID=4326;POLYGON((${input.service_area.coordinates[0]!.map(([lng, lat]) => `${lng} ${lat}`).join(",")}))`;
  if (input.pricing !== undefined) row.pricing = input.pricing;
  if (input.sla_response_min !== undefined) row.sla_response_min = input.sla_response_min;
  if (input.sla_resolution_min !== undefined) row.sla_resolution_min = input.sla_resolution_min;
  if (input.capacity_note !== undefined) row.capacity_note = input.capacity_note || null;
  return row;
}

const writeError = (e: { code?: string; message: string }): never => {
  if (e.code === "42501") throw new ApiProblem("forbidden", "Only owners, admins and ops can manage vendors.");
  if (e.code === "23514") throw new ApiProblem("validation_failed", `That vendor isn't valid: ${e.message}`);
  if (e.code === "23505") throw new ApiProblem("conflict", "A vendor with that name already exists.");
  throw new ApiProblem("internal", e.message);
};

/** Add a vendor (VN-3); the slug comes from the name, made unique within the org. */
export async function createVendor(
  db: SupabaseClient,
  orgId: string,
  input: VendorInput & { name: string; categories: VendorCategory[] },
) {
  const base = slugify(input.name).slice(0, 70) || "vendor";
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
    const { data, error } = await db
      .from("vendors")
      .insert({ org_id: orgId, slug, ...toRow(input) })
      .select("id")
      .single();
    if (!error) return getVendor(db, orgId, { id: data.id as string });
    if (error.code !== "23505") writeError(error);
  }
  throw new ApiProblem("conflict", "Couldn't make a unique address for this vendor. Try another name.");
}

export async function updateVendor(db: SupabaseClient, orgId: string, id: string, input: VendorInput) {
  const row = toRow(input);
  if (Object.keys(row).length) {
    const { data, error } = await db.from("vendors").update(row).eq("org_id", orgId).eq("id", id).select("id");
    if (error) writeError(error);
    if (!data?.length) throw new ApiProblem("not_found", "No such vendor.");
  }
  return getVendor(db, orgId, { id });
}

/** Vendors covering a vehicle's location for a category, ranked by the documented score (VN-4). */
export async function rankForVehicle(db: SupabaseClient, orgId: string, vehicleId: string, category: VendorCategory) {
  const { data: v } = await db
    .from("vehicle_list")
    .select("lat, lng, home_hub_id")
    .eq("org_id", orgId)
    .eq("id", vehicleId)
    .maybeSingle();
  if (!v) throw new ApiProblem("not_found", "No such vehicle.");
  let lat = v.lat as number | null;
  let lng = v.lng as number | null;
  if (lat === null || lng === null) {
    // No position yet: rank for its home hub instead.
    const { data: hub } = v.home_hub_id
      ? await db.from("hub_list").select("lat, lng").eq("id", v.home_hub_id).maybeSingle()
      : { data: null };
    if (!hub)
      throw new ApiProblem("validation_failed", "This vehicle has no position or home hub to rank vendors for.");
    ({ lat, lng } = hub as { lat: number; lng: number });
  }
  const [{ data: covering, error }, all] = await Promise.all([
    db.rpc("vendors_covering", { p_org: orgId, p_lat: lat, p_lng: lng, p_category: category }),
    listVendors(db, orgId, category),
  ]);
  if (error) throw new ApiProblem("internal", error.message);
  const distance = new Map(
    ((covering ?? []) as { vendor_id: string; distance_m: number | null }[]).map((c) => [c.vendor_id, c.distance_m]),
  );
  const byId = new Map(all.vendors.map((v) => [v.id, v]));
  const metrics = await vendorMetrics(db, orgId);
  const ranked = rankVendors(
    [...distance.keys()].map((id) => {
      const vendor = byId.get(id)!;
      const m = metrics.get(id);
      return {
        id,
        status: vendor.status,
        distanceM: distance.get(id) ?? null,
        priceCents: vendor.pricing[category] ?? null,
        jobsCompleted: m?.jobs_completed ?? 0,
        medianResponseMin: m?.median_response_min ?? null,
        slaCompliance: m?.sla_compliance ?? null,
      };
    }),
  );
  return ranked.map((r) => ({
    vendor: byId.get(r.id)!,
    expected_eta_min: r.expectedEtaMin,
    expected_cost_cents: r.expectedCostCents,
    sla_compliance: r.slaCompliance,
    score: r.score,
    distance_m:
      distance.get(r.id) === null || distance.get(r.id) === undefined ? null : Math.round(distance.get(r.id)!),
    breakdown: r.breakdown,
  }));
}
