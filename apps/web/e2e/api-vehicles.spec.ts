import { expect, test, type APIRequestContext } from "@playwright/test";
import { admin, userToken } from "./helpers/api";

/**
 * Vehicle endpoints (task 3.8b) against a fixture org built with the service role, so every number is known:
 * three cars with live state, status history and one charging session.
 */

test.describe.configure({ mode: "serial" });
test.use({ storageState: { cookies: [], origins: [] } });
test.skip(({ isMobile }) => isMobile, "API behaviour doesn't depend on the viewport.");

const ORG = crypto.randomUUID();
const HUB = crypto.randomUUID();
const CAR = { a: crypto.randomUUID(), b: crypto.randomUUID(), c: crypto.randomUUID() };
let owner: { token: string };
let viewer: { token: string };

const get = (request: APIRequestContext, who: { token: string }, path: string, org = ORG) =>
  request.get(`/api/v1${path}`, { headers: { Authorization: `Bearer ${who.token}`, "X-FleetOS-Org": org } });

test.beforeAll(async () => {
  const db = admin();
  const [o, v] = await Promise.all([userToken("veh-owner"), userToken("veh-viewer")]);
  owner = o;
  viewer = v;
  const ok = (r: { error: { message: string } | null }) => {
    if (r.error) throw new Error(r.error.message);
  };
  ok(await db.from("orgs").insert({ id: ORG, name: "API Fixture Co", slug: `api-fixture-${ORG.slice(0, 8)}` }));
  ok(
    await db.from("memberships").insert([
      { org_id: ORG, user_id: o.id, role: "owner" },
      { org_id: ORG, user_id: v.id, role: "viewer" },
    ]),
  );
  ok(await db.from("hubs").insert({ id: HUB, org_id: ORG, name: "Depot", location: "SRID=4326;POINT(-112.07 33.45)" }));
  ok(
    await db.from("vehicles").insert([
      {
        id: CAR.a,
        org_id: ORG,
        vin: "7G2CEHED7RA004001",
        number: "001",
        display_name: "Cybercab 001",
        home_hub_id: HUB,
        insurance_monthly_cents: 48_600,
      },
      {
        id: CAR.b,
        org_id: ORG,
        vin: "7G2CEHED9RA004002",
        number: "002",
        display_name: "Cybercab 002",
        home_hub_id: HUB,
      },
      { id: CAR.c, org_id: ORG, vin: "7G2CEHED0RA004003", number: "003", display_name: "Cybercab 003" },
    ]),
  );
  const now = new Date().toISOString();
  ok(
    await db.from("vehicle_state_current").insert([
      {
        vehicle_id: CAR.a,
        org_id: ORG,
        status: "charging",
        status_since: now,
        soc: 0.25,
        connectivity: "online",
        last_telemetry_at: now,
      },
      {
        vehicle_id: CAR.b,
        org_id: ORG,
        status: "ready",
        status_since: now,
        soc: 0.9,
        connectivity: "asleep",
        last_telemetry_at: "2026-01-01T00:00:00Z",
      },
    ]),
  );
  // Hours and money today, so revenue per available hour is computed (a fraction of a cent before rounding).
  const today = new Date().toISOString().slice(0, 10);
  ok(
    await db.from("vehicle_day_hours").insert({
      org_id: ORG,
      vehicle_id: CAR.a,
      day: today,
      in_service_h: 2.7,
      ready_h: 0.3,
      charging_h: 0,
      cleaning_h: 0,
      maintenance_h: 0,
      incident_h: 0,
      offline_h: 0,
    }),
  );
  ok(
    await db.from("ledger_entries").insert({
      org_id: ORG,
      vehicle_id: CAR.a,
      occurred_on: today,
      category: "gross_ride_revenue",
      amount_cents: 10_000,
      source: "manual",
      source_ref: "rph-1",
    }),
  );
  ok(
    await db.from("vehicle_status_events").insert(
      ["2026-09-01T10:00:00Z", "2026-09-01T11:00:00Z", "2026-09-01T12:00:00Z"].map((at, i) => ({
        org_id: ORG,
        vehicle_id: CAR.a,
        from_status: i ? "ready" : null,
        to_status: i % 2 ? "charging" : "ready",
        at,
        cause_type: "telemetry",
      })),
    ),
  );
  ok(
    await db.from("charging_sessions").insert({
      org_id: ORG,
      vehicle_id: CAR.a,
      hub_id: HUB,
      started_at: "2026-09-01T11:00:00Z",
      ended_at: "2026-09-01T12:00:00Z",
      energy_kwh: 40,
      cost_cents: 520,
      source: "simulator",
      external_id: "fixture-1",
    }),
  );
});

test.afterAll(async () => {
  await admin().from("orgs").delete().eq("id", ORG);
});

test("lists the fleet with live state, sorted by number, in pages", async ({ request }) => {
  const res = await get(request, owner, "/vehicles?limit=2");
  expect(res.status()).toBe(200);
  const p1 = await res.json();
  expect(p1.data.map((v: { number: string }) => v.number)).toEqual(["001", "002"]);
  expect(p1.page).toMatchObject({ total: 3, next_cursor: expect.any(String) });
  expect(p1.data[0]).toMatchObject({
    home_hub: { id: HUB, name: "Depot" },
    state: { status: "charging", soc: 0.25, connectivity: "online", fresh: true },
  });
  expect(p1.data[1].state).toMatchObject({ fresh: false }); // asleep and silent since January
  expect(p1.data[0].today).toMatchObject({ revenue_cents: 10_000, revenue_per_available_hour_cents: 3_333 }); // $100 / 3 h
  const p2 = await (await get(request, owner, `/vehicles?limit=2&cursor=${p1.page.next_cursor}`)).json();
  expect(p2.data.map((v: { number: string }) => v.number)).toEqual(["003"]);
  expect(p2.data[0].state).toMatchObject({ status: "offline", connectivity: "offline", fresh: false }); // never seen
  expect(p2.page.next_cursor).toBeNull();
});

test("filters by status, SOC, hub and search, and sorts", async ({ request }) => {
  const numbers = async (qs: string) =>
    ((await (await get(request, owner, `/vehicles?${qs}`)).json()).data as { number: string }[]).map((v) => v.number);
  expect(await numbers("status=charging,ready")).toEqual(["001", "002"]);
  expect(await numbers("status=offline")).toEqual(["003"]);
  expect(await numbers("soc_lt=0.5")).toEqual(["001"]);
  expect(await numbers(`hub_id=${HUB}`)).toEqual(["001", "002"]);
  expect(await numbers("q=004003")).toEqual(["003"]);
  expect(await numbers("sort=-soc")).toEqual(["002", "001", "003"]); // no SOC sorts last
});

test("rejects unknown parameters and bad cursors with 400", async ({ request }) => {
  const unsupported = await (await get(request, owner, "/vehicles?issue=tyre")).json();
  expect(unsupported).toMatchObject({ error: "invalid_request", details: [{ param: "issue" }] });
  expect((await get(request, owner, "/vehicles?cursor=nope")).status()).toBe(400);
});

test("vehicle detail hides monthly costs from roles without money access", async ({ request }) => {
  const asOwner = await (await get(request, owner, `/vehicles/${CAR.a}`)).json();
  expect(asOwner).toMatchObject({ number: "001", insurance_monthly_cents: 48_600, holds: [] });
  const asViewer = await (await get(request, viewer, `/vehicles/${CAR.a}`)).json();
  expect(asViewer).toMatchObject({ number: "001", insurance_monthly_cents: null });
});

test("unknown and other orgs' vehicles are 404", async ({ request }) => {
  expect((await get(request, owner, "/vehicles/00000000-0000-0000-0000-000000000000")).status()).toBe(404);
  expect((await get(request, owner, "/vehicles/not-a-uuid")).status()).toBe(404);
  const outsider = await userToken("veh-outsider");
  expect((await get(request, outsider, `/vehicles/${CAR.a}`)).status()).toBe(404); // not a member of ORG
});

test("status history pages newest first and honours from/to", async ({ request }) => {
  const p1 = await (await get(request, owner, `/vehicles/${CAR.a}/status-events?limit=2`)).json();
  expect(p1.data.map((e: { at: string }) => e.at)).toEqual(["2026-09-01T12:00:00.000Z", "2026-09-01T11:00:00.000Z"]);
  expect(p1.page.total).toBe(3);
  const p2 = await (
    await get(request, owner, `/vehicles/${CAR.a}/status-events?limit=2&cursor=${p1.page.next_cursor}`)
  ).json();
  expect(p2.data.map((e: { at: string }) => e.at)).toEqual(["2026-09-01T10:00:00.000Z"]);
  expect(p2.page).toMatchObject({ next_cursor: null, total: 3 });
  const window = await (
    await get(request, owner, `/vehicles/${CAR.a}/status-events?from=2026-09-01T11:00:00Z&to=2026-09-01T12:00:00Z`)
  ).json();
  expect(window.data).toHaveLength(1); // half-open: 11:00 in, 12:00 out
});

test("charging sessions carry energy and cost", async ({ request }) => {
  const body = await (await get(request, owner, `/vehicles/${CAR.a}/charging-sessions`)).json();
  expect(body.data).toEqual([
    expect.objectContaining({ hub_id: HUB, energy_kwh: 40, cost_cents: 520, source: "simulator" }),
  ]);
  expect((await (await get(request, owner, `/vehicles/${CAR.b}/charging-sessions`)).json()).data).toEqual([]);
});
