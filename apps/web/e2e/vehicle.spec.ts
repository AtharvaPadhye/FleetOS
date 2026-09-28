import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { admin, sessionCookies, userId, userToken } from "./helpers/api";
import { uniqueEmail } from "./helpers/auth";

/** Vehicle page (task 5.2) and its APIs on a fixture car with known events, costs, alerts and telemetry. */

test.describe.configure({ mode: "serial" });
test.use({ storageState: { cookies: [], origins: [] } });

const ORG = crypto.randomUUID();
const HUB = crypto.randomUUID();
const CAR = crypto.randomUUID();
const email = uniqueEmail("vehicle");
let cookies: Awaited<ReturnType<typeof sessionCookies>> = [];
let FIXTURE_DAY = "";

test.beforeAll(async ({ browser }) => {
  const db = admin();
  const ok = (r: { error: { message: string } | null }) => {
    if (r.error) throw new Error(r.error.message);
  };
  await db.auth.admin.createUser({ email, email_confirm: true });
  ok(
    await db
      .from("orgs")
      .insert({ id: ORG, name: "Vehicle UI Co", slug: `veh-ui-${ORG.slice(0, 8)}`, timezone: "UTC", is_demo: false }),
  );
  ok(await db.from("memberships").insert({ org_id: ORG, user_id: await userId(email), role: "owner" }));
  ok(
    await db
      .from("hubs")
      .insert({ id: HUB, org_id: ORG, name: "Depot South", location: "SRID=4326;POINT(-112.07 33.45)", radius_m: 200 }),
  );
  ok(
    await db.from("vehicles").insert({
      id: CAR,
      org_id: ORG,
      vin: "7G2CEHED9RA004047",
      number: "047",
      home_hub_id: HUB,
      insurance_monthly_cents: 48_600,
    }),
  );
  // The fixture's events span the last 90 minutes; in the first hours after UTC midnight that would split them
  // across two days, so anchor them earlier and open that day explicitly.
  // Live state and telemetry use the real clock (`at`); the day's timeline rows use `ev`.
  const now = Date.now();
  const anchor = (now % 86_400_000) / 60_000 < 100 ? now - 100 * 60_000 : now;
  const at = (minAgo: number) => new Date(now - minAgo * 60_000).toISOString();
  const ev = (minAgo: number) => new Date(anchor - minAgo * 60_000).toISOString();
  const today = new Date(anchor).toISOString().slice(0, 10);
  FIXTURE_DAY = today;
  ok(
    await db.from("vehicle_state_current").insert({
      vehicle_id: CAR,
      org_id: ORG,
      status: "in_service",
      status_since: at(20),
      soc: 0.62,
      range_m: 250_000,
      speed_mps: 13.4,
      odometer_m: 18_300_000,
      connectivity: "online",
      last_telemetry_at: at(0),
      location: "SRID=4326;POINT(-112.05 33.44)",
    }),
  );
  ok(
    await db.from("vehicle_status_events").insert([
      { org_id: ORG, vehicle_id: CAR, from_status: null, to_status: "charging", at: ev(90), cause_type: "telemetry" },
      {
        org_id: ORG,
        vehicle_id: CAR,
        from_status: "charging",
        to_status: "ready",
        at: ev(40),
        cause_type: "telemetry",
      },
      {
        org_id: ORG,
        vehicle_id: CAR,
        from_status: "ready",
        to_status: "in_service",
        at: ev(20),
        cause_type: "telemetry",
      },
    ]),
  );
  ok(
    await db.from("charging_sessions").insert({
      org_id: ORG,
      vehicle_id: CAR,
      hub_id: HUB,
      started_at: ev(90),
      ended_at: ev(40),
      energy_kwh: 30,
      cost_cents: 390,
      source: "simulator",
      external_id: "veh-charge-1",
    }),
  );
  ok(
    await db.from("vehicle_alerts").insert({
      org_id: ORG,
      vehicle_id: CAR,
      name: "TpmsHardWarning",
      started_at: ev(30),
      ended_at: ev(25),
      source: "simulator",
    }),
  );
  const line = (category: string, amount_cents: number, ref: string) => ({
    org_id: ORG,
    vehicle_id: CAR,
    occurred_on: today,
    occurred_at: ev(10),
    category,
    amount_cents,
    source: "manual",
    source_ref: ref,
  });
  ok(
    await db
      .from("ledger_entries")
      .insert([
        line("gross_ride_revenue", 25_000, "r1"),
        line("platform_fee", 5_000, "f1"),
        line("electricity", 390, "e1"),
        line("cleaning", 1_900, "c1"),
      ]),
  );
  ok(
    await db.from("telemetry_samples").insert(
      [80, 75, 70, 66, 62].map((soc, i) => ({
        org_id: ORG,
        vehicle_id: CAR,
        field: "Soc",
        ts: at(50 - i * 10),
        value_num: soc,
      })),
    ),
  );
  cookies = await sessionCookies(browser, email);
});

test.afterAll(async () => {
  await admin().from("orgs").delete().eq("id", ORG);
});

test.beforeEach(async ({ context }) => {
  await context.addCookies(cookies);
});

test("header facts, map and indicators; tabs move with the arrow keys", async ({ page, isMobile }) => {
  await page.goto("/fleet/047");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cybercab 047");
  const facts = page.locator("dl").first();
  await expect(facts).toContainText("62% · 155 mi range");
  await expect(facts).toContainText("30 mph");
  await expect(facts).toContainText("Depot South");
  await expect(
    page.getByRole("img", { name: /Map: Cybercab 047 at 33\.4400, -112\.0500, home hub Depot South/ }),
  ).toBeVisible();
  await expect(page.getByText("Availability")).toBeVisible();
  if (!isMobile) {
    const tabs = page.getByRole("navigation", { name: "Vehicle sections" });
    await tabs.getByRole("link", { name: "Overview" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(tabs.getByRole("link", { name: "Operations" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/fleet\/047\/operations$/);
  }
});

test("operations timeline lists the day's events newest first", async ({ page }) => {
  await page.goto(`/fleet/047/operations?day=${FIXTURE_DAY}`);
  const list = page.getByRole("list").filter({ hasText: "Finished charging" });
  await expect(list).toContainText("Finished charging: 30.0 kWh, $3.90");
  await expect(list).toContainText("Alert raised: TpmsHardWarning");
  await expect(list).toContainText("Cleaning cost −$19.00");
  await expect(list.getByRole("listitem").first()).toContainText("Cleaning cost"); // 10 min ago = newest
  await page.getByRole("link", { name: "← Earlier" }).click();
  await expect(page.getByText("Nothing happened on this day")).toBeVisible();
});

test("financials: P&L with fleet comparison and the economic view", async ({ page }) => {
  await page.goto("/fleet/047/financials");
  const table = page.getByRole("region", { name: /Profit and loss for Cybercab 047/ });
  await expect(table.getByRole("row", { name: /Ride revenue/ })).toContainText("$250.00");
  await expect(table.getByRole("row", { name: /^Contribution/ })).toContainText("$177.10");
  await page.getByRole("link", { name: "Economic" }).click();
  await expect(page.getByRole("row", { name: /Economic net/ })).toBeVisible();
});

test("service tab shows alerts and costs; telemetry shows a chart summary and table", async ({ page }) => {
  await page.goto("/fleet/047/service");
  await expect(page.getByText("TpmsHardWarning")).toBeVisible();
  await expect(page.getByText("Total −$19.00")).toBeVisible();
  await page.goto("/fleet/047/telemetry?field=soc&range=1h");
  await expect(
    page.getByText("Battery over the last 1h: latest 62%, lowest 62%, highest 80%, from 5 readings."),
  ).toBeVisible();
  await page.getByText("View as table (5 readings)").click();
  await expect(page.getByRole("region", { name: "Battery readings" }).getByRole("row")).toHaveCount(6);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
});

test("unknown vehicles show a not-found view", async ({ page }) => {
  // The page streams (the fleet's loading skeleton), so the status is committed before the lookup; check the view.
  await page.goto("/fleet/999");
  await expect(page.getByRole("heading", { name: "No such vehicle in this fleet" })).toBeVisible();
});

test("API: telemetry in SI units and alerts filtered by state", async ({ request }) => {
  const owner = await userToken("veh-api");
  await admin()
    .from("memberships")
    .insert({ org_id: ORG, user_id: (owner as { id: string }).id, role: "ops" });
  const h = { Authorization: `Bearer ${owner.token}`, "X-FleetOS-Org": ORG };
  const tel = await (
    await request.get(
      `/api/v1/vehicles/${CAR}/telemetry?fields=soc&interval=raw&from=${new Date(Date.now() - 3.6e6).toISOString()}&to=${new Date().toISOString()}`,
      { headers: h },
    )
  ).json();
  expect(tel.series[0].field).toBe("soc");
  expect(tel.series[0].points.map((p: { v: number }) => p.v)).toEqual([0.8, 0.75, 0.7, 0.66, 0.62]);
  const alerts = await (await request.get(`/api/v1/vehicles/${CAR}/alerts?active=false`, { headers: h })).json();
  expect(alerts.data).toEqual([expect.objectContaining({ name: "TpmsHardWarning" })]);
  expect((await (await request.get(`/api/v1/vehicles/${CAR}/alerts?active=true`, { headers: h })).json()).data).toEqual(
    [],
  );
});
