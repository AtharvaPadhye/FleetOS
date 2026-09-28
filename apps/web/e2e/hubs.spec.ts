import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { admin, sessionCookies, userId, userToken } from "./helpers/api";
import { uniqueEmail } from "./helpers/auth";

/**
 * Hubs (task 5.7): a hub with one slow charger and three cars about to need it is forecast over capacity; the
 * warning shows on the hub and on Overview, and applying "route cars to the other hub" clears it (flows.md F6).
 */
test.describe.configure({ mode: "serial" });
test.use({ storageState: { cookies: [], origins: [] } });

const ORG = crypto.randomUUID();
const BUSY = crypto.randomUUID();
const SPARE = crypto.randomUUID();
const email = uniqueEmail("hubs");
let cookies: Awaited<ReturnType<typeof sessionCookies>> = [];

test.beforeAll(async ({ browser }) => {
  const db = admin();
  const ok = (r: { error: { message: string } | null }) => {
    if (r.error) throw new Error(r.error.message);
  };
  await db.auth.admin.createUser({ email, email_confirm: true });
  ok(await db.from("orgs").insert({ id: ORG, name: "Hub UI Co", slug: `hub-ui-${ORG.slice(0, 8)}`, timezone: "UTC" }));
  ok(await db.from("memberships").insert({ org_id: ORG, user_id: await userId(email), role: "admin" }));
  ok(
    await db.from("hubs").insert([
      { id: BUSY, org_id: ORG, name: "Busy Depot", location: "SRID=4326;POINT(-112.07 33.45)", radius_m: 150 },
      { id: SPARE, org_id: ORG, name: "Spare Depot", location: "SRID=4326;POINT(-111.94 33.42)", radius_m: 150 },
    ]),
  );
  // One 20 kW charger at Busy: a 40→80% session takes an hour. Five idle chargers at Spare.
  ok(
    await db
      .from("hub_chargers")
      .insert([
        { org_id: ORG, hub_id: BUSY, label: "C01", max_kw: 20 },
        ...Array.from({ length: 5 }, (_, i) => ({ org_id: ORG, hub_id: SPARE, label: `C0${i + 1}`, max_kw: 72 })),
      ]),
  );
  const cars = ["101", "102", "103"].map((n, i) => ({
    id: crypto.randomUUID(),
    org_id: ORG,
    vin: `7G2CEHED${i}RA00910${i}`.slice(0, 17),
    number: n,
    home_hub_id: BUSY,
  }));
  ok(await db.from("vehicles").insert(cars));
  ok(
    await db.from("vehicle_state_current").insert(
      cars.map((c, i) => ({
        vehicle_id: c.id,
        org_id: ORG,
        status: "in_service",
        status_since: new Date().toISOString(),
        connectivity: "online",
        soc: 0.41 + i * 0.005, // all reach the 40% charge line within minutes
        location: "SRID=4326;POINT(-112.0 33.47)",
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

test("an overloaded hub shows a warning on Hubs and Overview, and applying the plan clears it", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "One apply per fixture; the phone layout is covered below.");
  await page.goto("/hubs");
  const busy = page.getByRole("listitem").filter({ hasText: "Busy Depot" });
  await expect(busy.getByRole("status")).toContainText(/Forecast \d+%/);
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Needs attention" })).toContainText(/Busy Depot forecast \d+%/);
  await page.getByRole("link", { name: "Review plan" }).first().click();
  await expect(page).toHaveURL(new RegExp(`/hubs/${BUSY}$`));
  const warning = page.getByRole("region", { name: /Forecast \d+%/ });
  await expect(warning).toContainText("to Spare Depot to charge");
  const before = await warning.getByRole("heading").textContent();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);

  await warning.getByRole("listitem").filter({ hasText: "Spare Depot" }).getByRole("button", { name: "Apply" }).click();
  const confirm = page.getByRole("dialog");
  await expect(confirm).toContainText("do this in the Tesla app");
  await confirm.getByRole("button", { name: "Confirm plan" }).click();
  await expect(page.getByRole("region", { name: "Decisions today" })).toContainText("to Spare Depot to charge");
  // That window is handled. These cars need a charge again every few hours, so a later peak may still show.
  await expect(page.getByRole("region", { name: before!.trim() })).toHaveCount(0);
});

test("the hub list works on a phone and names estimated charger use", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Phone layout.");
  await page.goto("/hubs");
  await expect(page.getByRole("heading", { name: "Busy Depot" })).toBeVisible();
  await expect(page.getByText("estimated").first()).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
});

test("add a hub; overlapping areas are refused", async ({ page, isMobile }) => {
  test.skip(isMobile, "Desktop form flow.");
  await page.goto("/hubs");
  await page.getByRole("button", { name: "Add hub" }).first().click();
  const d = page.getByRole("dialog", { name: "Add a hub" });
  await d.getByLabel("Name").fill("Too Close");
  await d.getByLabel("Latitude").fill("33.4501");
  await d.getByLabel("Longitude").fill("-112.0701");
  await d.getByRole("button", { name: "Add hub" }).click();
  await expect(d.getByRole("alert")).toContainText("overlaps Busy Depot");
  await d.getByLabel("Latitude").fill("33.50");
  await d.getByLabel("Chargers").fill("6");
  await d.getByRole("button", { name: "Add hub" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Too Close");
  await expect(page.getByText(/6 chargers × 72 kW/)).toBeVisible();
});

test("API: hubs, forecast, recommendations and roles", async ({ request }) => {
  const viewer = await userToken("hub-viewer");
  await admin().from("memberships").insert({ org_id: ORG, user_id: viewer.id, role: "viewer" });
  const h = { Authorization: `Bearer ${viewer.token}`, "X-FleetOS-Org": ORG };
  const hubs = await (await request.get("/api/v1/hubs", { headers: h })).json();
  expect(hubs.find((x: { name: string }) => x.name === "Busy Depot")).toMatchObject({
    chargers_total: 1,
    vehicles_assigned: 3,
    chargers_occupied_source: "inferred",
  });
  const f = await (await request.get(`/api/v1/hubs/${SPARE}/forecast`, { headers: h })).json();
  expect(f).toMatchObject({ capacity: 5 });
  expect(f.hours).toHaveLength(24);
  expect((await request.get(`/api/v1/hubs/${BUSY}/forecast?date=2020-01-01`, { headers: h })).status()).toBe(422);
  const recs = await (await request.get(`/api/v1/hubs/${BUSY}/recommendations`, { headers: h })).json();
  expect(Array.isArray(recs)).toBe(true);
  const denied = await request.post(`/api/v1/hubs/${BUSY}/recommendations/route%3A1/apply`, { headers: h });
  expect(denied.status()).toBe(403);
});
