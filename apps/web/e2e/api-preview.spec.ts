import { expect, test, type APIRequestContext } from "@playwright/test";
import { admin, userToken } from "./helpers/api";

/**
 * Preview endpoints (task 3.9, ADR-0006): an org without the data source gets 501 capability_unavailable on
 * every one of them, never an empty 200; a demo org gets simulated data with the preview/simulated headers.
 */

test.describe.configure({ mode: "serial" });
test.use({ storageState: { cookies: [], origins: [] } });
test.skip(({ isMobile }) => isMobile, "API behaviour doesn't depend on the viewport.");

const REAL = crypto.randomUUID(); // not a demo org: no preview sources
const DEMO = crypto.randomUUID();
const CAR = crypto.randomUUID();
const REAL_CAR = crypto.randomUUID();
const HUB = crypto.randomUUID();
const CHARGERS = [crypto.randomUUID(), crypto.randomUUID()];
const RIDE = crypto.randomUUID();
let owner: { token: string };
let viewer: { token: string };

const call = (
  request: APIRequestContext,
  who: { token: string },
  org: string,
  method: "GET" | "POST",
  path: string,
  data?: object,
) =>
  request.fetch(`/api/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${who.token}`, "X-FleetOS-Org": org },
    ...(data ? { data } : {}),
  });

const PREVIEW_ROUTES = (car: string): [string, string, string][] => [
  ["GET", `/vehicles/${car}/earnings`, "earnings"],
  ["GET", `/vehicles/${car}/cabin-events`, "cabin_events"],
  ["GET", `/vehicles/${car}/autonomy-events`, "autonomy_events"],
  ["GET", "/rides", "rides"],
  ["GET", `/rides/${RIDE}`, "rides"],
  ["GET", "/dispatch/availability", "dispatch"],
  ["POST", "/dispatch/availability", "dispatch"],
  ["GET", `/hubs/${HUB}/chargers/live`, "charger_telemetry"],
  ["GET", "/energy/tariffs/live", "live_tariffs"],
  ["GET", `/vendor-jobs/${RIDE}/tracking`, "vendor_tracking"],
  ["POST", `/vendor-jobs/${RIDE}/tracking`, "vendor_tracking"],
];

test.beforeAll(async () => {
  const db = admin();
  const [o, v] = await Promise.all([userToken("pv-owner"), userToken("pv-viewer")]);
  owner = o;
  viewer = v;
  const ok = (r: { error: { message: string } | null }) => {
    if (r.error) throw new Error(r.error.message);
  };
  ok(
    await db.from("orgs").insert([
      { id: REAL, name: "Preview Real Co", slug: `pv-real-${REAL.slice(0, 8)}`, timezone: "UTC", is_demo: false },
      { id: DEMO, name: "Preview Demo Co", slug: `pv-demo-${DEMO.slice(0, 8)}`, timezone: "UTC", is_demo: true },
    ]),
  );
  ok(
    await db.from("memberships").insert([
      { org_id: REAL, user_id: o.id, role: "owner" },
      { org_id: DEMO, user_id: o.id, role: "owner" },
      { org_id: DEMO, user_id: v.id, role: "viewer" },
    ]),
  );
  const { data: tariff, error: tErr } = await db
    .from("tariffs")
    .insert({
      org_id: DEMO,
      name: "Flat",
      schedule: [{ days: [0, 1, 2, 3, 4, 5, 6], from: "00:00", to: "24:00", cents_per_kwh: 12, label: "Flat rate" }],
    })
    .select("id")
    .single();
  if (tErr) throw new Error(tErr.message);
  ok(
    await db.from("hubs").insert({
      id: HUB,
      org_id: DEMO,
      name: "Depot",
      location: "SRID=4326;POINT(-112.07 33.45)",
      tariff_id: tariff.id,
    }),
  );
  ok(
    await db
      .from("hub_chargers")
      .insert(CHARGERS.map((id, i) => ({ id, org_id: DEMO, hub_id: HUB, label: `C0${i + 1}`, max_kw: 150 }))),
  );
  ok(
    await db.from("vehicles").insert([
      { id: CAR, org_id: DEMO, vin: "7G2CEHED7RA004001", number: "001", home_hub_id: HUB },
      { id: REAL_CAR, org_id: REAL, vin: "7G2CEHED9RA004002", number: "002" },
    ]),
  );
  const now = new Date().toISOString();
  ok(
    await db.from("vehicle_state_current").insert({
      vehicle_id: CAR,
      org_id: DEMO,
      status: "charging",
      status_since: now,
      soc: 0.4,
      charge_power_kw: 120,
      current_hub_id: HUB,
      connectivity: "online",
    }),
  );
  const started = new Date(Date.now() - 30 * 60_000).toISOString();
  ok(
    await db.from("rides").insert({
      id: RIDE,
      org_id: DEMO,
      vehicle_id: CAR,
      external_id: "pv-ride-1",
      started_at: started,
      ended_at: now,
      distance_m: 5000,
      fare_cents: 1850,
      platform_fee_cents: 370,
      pickup: "SRID=4326;POINT(-112.07 33.45)",
      dropoff: "SRID=4326;POINT(-112.01 33.43)",
      source: "simulator",
    }),
  );
  ok(
    await db.from("cabin_events").insert({
      org_id: DEMO,
      vehicle_id: CAR,
      at: now,
      kind: "spill",
      confidence: 0.93,
      ride_id: RIDE,
      source: "simulator",
      external_id: "pv-ride-1|spill",
    }),
  );
  ok(
    await db.from("autonomy_events").insert({
      org_id: DEMO,
      vehicle_id: CAR,
      at: started,
      kind: "stuck",
      lat: 33.44,
      lng: -112.05,
      severity: "high",
      source: "simulator",
      external_id: "pv-stuck-1",
    }),
  );
});

test.afterAll(async () => {
  await admin().from("orgs").delete().in("id", [REAL, DEMO]);
});

test("without the data source, every preview route answers 501 capability_unavailable", async ({ request }) => {
  for (const [method, path, capability] of PREVIEW_ROUTES(REAL_CAR)) {
    const res = await call(request, owner, REAL, method as "GET" | "POST", path, method === "POST" ? {} : undefined);
    expect(res.status(), `${method} ${path}`).toBe(501);
    expect(res.headers()["x-fleetos-stability"]).toBe("preview");
    expect(await res.json(), `${method} ${path}`).toMatchObject({ error: "capability_unavailable", capability });
  }
});

test("the capability registry agrees with the routes", async ({ request }) => {
  const caps = async (org: string) =>
    Object.fromEntries(
      (
        (await (await call(request, owner, org, "GET", "/capabilities")).json()).capabilities as {
          name: string;
          state: string;
        }[]
      ).map((c) => [c.name, c.state]),
    );
  expect(Object.values(await caps(REAL)).every((s) => s === "unavailable")).toBe(true);
  expect(await caps(DEMO)).toMatchObject({ rides: "simulated", dispatch: "simulated", vendor_tracking: "unavailable" });
});

test("demo org: rides, earnings, cabin and autonomy events are simulated data", async ({ request }) => {
  const rides = await call(request, owner, DEMO, "GET", `/rides?vehicle_id=${CAR}`);
  expect(rides.headers()).toMatchObject({ "x-fleetos-stability": "preview", "x-fleetos-data-source": "simulated" });
  expect((await rides.json()).data).toEqual([
    expect.objectContaining({ id: RIDE, fare_cents: 1850, pickup: { lat: 33.45, lng: -112.07 } }),
  ]);
  expect(await (await call(request, owner, DEMO, "GET", `/rides/${RIDE}`)).json()).toMatchObject({ distance_m: 5000 });
  expect(await (await call(request, owner, DEMO, "GET", `/vehicles/${CAR}/earnings`)).json()).toMatchObject({
    gross_cents: 1850,
    platform_fee_cents: 370,
    net_cents: 1480,
    trips: 1,
  });
  expect((await (await call(request, owner, DEMO, "GET", `/vehicles/${CAR}/cabin-events`)).json()).data).toEqual([
    expect.objectContaining({ kind: "spill", confidence: 0.93, ride_id: RIDE }),
  ]);
  expect((await (await call(request, owner, DEMO, "GET", `/vehicles/${CAR}/autonomy-events`)).json()).data).toEqual([
    expect.objectContaining({ kind: "stuck", severity: "high", location: { lat: 33.44, lng: -112.05 } }),
  ]);
});

test("demo org: live chargers and tariffs", async ({ request }) => {
  const chargers = await (await call(request, owner, DEMO, "GET", `/hubs/${HUB}/chargers/live`)).json();
  expect(chargers).toEqual([
    expect.objectContaining({ charger_id: CHARGERS[0], status: "charging", power_kw: 120, vehicle_id: CAR }),
    expect.objectContaining({ charger_id: CHARGERS[1], status: "available", vehicle_id: null }),
  ]);
  expect(await (await call(request, owner, DEMO, "GET", "/energy/tariffs/live")).json()).toEqual([
    { hub_id: HUB, price_cents_per_kwh: 12, period: "Flat rate" },
  ]);
  expect((await call(request, owner, DEMO, "GET", `/hubs/${crypto.randomUUID()}/chargers/live`)).status()).toBe(404);
});

test("demo org: take a car off the network and back", async ({ request }) => {
  const before = await (await call(request, owner, DEMO, "GET", "/dispatch/availability")).json();
  expect(before).toEqual([expect.objectContaining({ vehicle_id: CAR, on_network: false, zone: "Depot" })]); // charging
  const on = await call(request, owner, DEMO, "POST", "/dispatch/availability", {
    vehicle_ids: [CAR],
    on_network: true,
    reason: "Charged enough for the evening peak",
  });
  expect(on.status()).toBe(200);
  expect(await on.json()).toEqual([expect.objectContaining({ vehicle_id: CAR, on_network: true })]);
  expect(
    (
      await call(request, viewer, DEMO, "POST", "/dispatch/availability", { vehicle_ids: [CAR], on_network: false })
    ).status(),
  ).toBe(403);
  const foreign = await call(request, owner, DEMO, "POST", "/dispatch/availability", {
    vehicle_ids: [REAL_CAR],
    on_network: false,
  });
  expect(foreign.status()).toBe(422);
  const bad = await call(request, owner, DEMO, "POST", "/dispatch/availability", { on_network: "yes" });
  expect(bad.status()).toBe(422);
  expect(await bad.json()).toMatchObject({ error: "validation_failed" });
});
