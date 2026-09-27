import { expect, test, type APIRequestContext } from "@playwright/test";
import { admin, userToken } from "./helpers/api";

/**
 * KPI and P&L endpoints (task 3.8c) on a fixture org with known hours and ledger lines. The rollup's SQL is
 * covered by pgTAP (008); here the rollup rows are written directly so every number below is exact.
 *
 * Fixture (UTC org, one day, 2026-09-20):
 *   car A: in service 6 h, ready 2 h, maintenance 2 h · revenue $100, platform fee $20, maintenance $50
 *   car B: in service 8 h, ready 2 h                  · revenue $200, electricity $10
 *   fleet: insurance $16.20 (not tied to a car)
 */

test.describe.configure({ mode: "serial" });
test.use({ storageState: { cookies: [], origins: [] } });
test.skip(({ isMobile }) => isMobile, "API behaviour doesn't depend on the viewport.");

const ORG = crypto.randomUUID();
const A = crypto.randomUUID();
const B = crypto.randomUUID();
const PERIOD = "period=month:2026-09";
let owner: { token: string };
let viewer: { token: string };

const get = (request: APIRequestContext, who: { token: string }, path: string) =>
  request.get(`/api/v1${path}`, { headers: { Authorization: `Bearer ${who.token}`, "X-FleetOS-Org": ORG } });

test.beforeAll(async () => {
  const db = admin();
  const [o, v] = await Promise.all([userToken("kpi-owner"), userToken("kpi-viewer")]);
  owner = o;
  viewer = v;
  const ok = (r: { error: { message: string } | null }) => {
    if (r.error) throw new Error(r.error.message);
  };
  ok(
    await db
      .from("orgs")
      .insert({ id: ORG, name: "KPI Fixture Co", slug: `kpi-fixture-${ORG.slice(0, 8)}`, timezone: "UTC" }),
  );
  ok(
    await db.from("memberships").insert([
      { org_id: ORG, user_id: o.id, role: "owner" },
      { org_id: ORG, user_id: v.id, role: "viewer" },
    ]),
  );
  ok(
    await db.from("vehicles").insert([
      { id: A, org_id: ORG, vin: "7G2CEHED7RA004001", number: "001" },
      { id: B, org_id: ORG, vin: "7G2CEHED9RA004002", number: "002" },
    ]),
  );
  // Bulk inserts send every column of every row, so each row spells out all seven statuses.
  const day = {
    org_id: ORG,
    day: "2026-09-20",
    in_service_h: 0,
    ready_h: 0,
    charging_h: 0,
    cleaning_h: 0,
    maintenance_h: 0,
    incident_h: 0,
    offline_h: 0,
  };
  ok(
    await db.from("vehicle_day_hours").insert([
      { ...day, vehicle_id: A, in_service_h: 6, ready_h: 2, maintenance_h: 2 },
      { ...day, vehicle_id: B, in_service_h: 8, ready_h: 2 },
    ]),
  );
  const line = (vehicle_id: string | null, category: string, amount_cents: number) => ({
    org_id: ORG,
    vehicle_id,
    occurred_on: "2026-09-20",
    category,
    amount_cents,
    source: "manual",
    source_ref: `${vehicle_id}|${category}`,
  });
  ok(
    await db
      .from("ledger_entries")
      .insert([
        line(A, "gross_ride_revenue", 10_000),
        line(A, "platform_fee", 2_000),
        line(A, "maintenance", 5_000),
        line(B, "gross_ride_revenue", 20_000),
        line(B, "electricity", 1_000),
        line(null, "insurance", 1_620),
      ]),
  );
});

test.afterAll(async () => {
  await admin().from("orgs").delete().eq("id", ORG);
});

test("fleet KPIs: hour ratios and money for a period", async ({ request }) => {
  const res = await get(request, owner, `/kpis/fleet?${PERIOD}`);
  expect(res.status()).toBe(200);
  const k = await res.json();
  expect(k.period).toEqual({ from: "2026-09-01T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z" });
  // 20 scheduled h: available 18 (in service 14 + ready 4), maintenance 2.
  expect(k).toMatchObject({
    total_vehicles: 2,
    availability: 0.9,
    uptime: 0.9,
    utilization: { value: 0.7778, estimated: true },
    downtime_hours_by_cause: { maintenance: 2 },
    gross_revenue_cents: 30_000,
    contribution_cents: 22_000, // − fee 20 − maintenance 50 − electricity 10
    revenue_per_available_hour_cents: 1_667,
    downtime_cost_cents: 3_333, // 2 h × $300 / 18 available h
  });
});

test("fleet KPIs hide money from roles without money access", async ({ request }) => {
  const k = await (await get(request, viewer, `/kpis/fleet?${PERIOD}`)).json();
  expect(k).toMatchObject({
    availability: 0.9,
    gross_revenue_cents: null,
    contribution_cents: null,
    downtime_cost_cents: null,
  });
});

test("vehicle KPIs compare with the fleet and label the car", async ({ request }) => {
  const k = await (await get(request, owner, `/kpis/vehicles/${A}?${PERIOD}`)).json();
  const m = Object.fromEntries(k.metrics.map((x: { key: string }) => [x.key, x]));
  expect(m.availability).toMatchObject({ value: 0.8, fleet_avg: 0.9, flag: "bad" });
  expect(m.contribution_margin).toMatchObject({ value: 0.3, fleet_avg: 0.7333, flag: "bad" });
  expect(m.gross_revenue_cents).toMatchObject({ value: 10_000, fleet_avg: 15_000 });
  expect(k.performance_label).toBe("review");
  expect((await get(request, owner, `/kpis/vehicles/00000000-0000-0000-0000-000000000000`)).status()).toBe(404);
});

test("fleet P&L: accounting and economic views", async ({ request }) => {
  const acc = await (await get(request, owner, `/financials/pnl?${PERIOD}`)).json();
  expect(acc).toMatchObject({
    scope: "fleet",
    view: "accounting",
    gross_revenue_cents: 30_000,
    contribution_cents: 22_000,
    fixed_allocations_cents: 1_620,
    net_contribution_cents: 20_380,
    economic_net_cents: null,
  });
  expect(acc.lines).toHaveLength(9);
  const eco = await (await get(request, owner, `/financials/pnl?${PERIOD}&view=economic`)).json();
  expect(eco).toMatchObject({ downtime_cost_cents: 3_333, economic_net_cents: 20_380 - 3_333 });
});

test("vehicle P&L flags costs well above the fleet average", async ({ request }) => {
  const p = await (await get(request, owner, `/financials/pnl?${PERIOD}&scope=vehicle&scope_id=${A}`)).json();
  expect(p).toMatchObject({ scope: "vehicle", scope_id: A, gross_revenue_cents: 10_000, contribution_cents: 3_000 });
  // Maintenance: $50 vs a fleet average of $25 per car → +100%, flagged.
  expect(p.lines.find((l: { category: string }) => l.category === "maintenance")).toEqual({
    category: "maintenance",
    amount_cents: 5_000,
    vs_fleet_avg_pct: 100,
    flagged: true,
  });
});

test("P&L is for owners, admins and finance only", async ({ request }) => {
  const res = await get(request, viewer, `/financials/pnl?${PERIOD}`);
  expect(res.status()).toBe(403);
  expect(await res.json()).toMatchObject({ error: "forbidden" });
});
