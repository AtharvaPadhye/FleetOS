import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { admin, sessionCookies, userId, userToken } from "./helpers/api";
import { uniqueEmail } from "./helpers/auth";

/** Vendors (task 5.6): directory, add/edit, category filter, ranking in the UI and the API. */

test.describe.configure({ mode: "serial" });
test.use({ storageState: { cookies: [], origins: [] } });

const ORG = crypto.randomUUID();
const CAR = crypto.randomUUID();
const email = uniqueEmail("vendors");
let cookies: Awaited<ReturnType<typeof sessionCookies>> = [];

test.beforeAll(async ({ browser }) => {
  const db = admin();
  const ok = (r: { error: { message: string } | null }) => {
    if (r.error) throw new Error(r.error.message);
  };
  await db.auth.admin.createUser({ email, email_confirm: true });
  ok(
    await db
      .from("orgs")
      .insert({ id: ORG, name: "Vendor UI Co", slug: `ven-ui-${ORG.slice(0, 8)}`, timezone: "UTC", is_demo: false }),
  );
  ok(await db.from("memberships").insert({ org_id: ORG, user_id: await userId(email), role: "ops" }));
  ok(await db.from("vehicles").insert({ id: CAR, org_id: ORG, vin: "7G2CEHED9RA004047", number: "047" }));
  ok(
    await db.from("vehicle_state_current").insert({
      vehicle_id: CAR,
      org_id: ORG,
      status: "cleaning",
      status_since: new Date().toISOString(),
      connectivity: "online",
      location: "SRID=4326;POINT(-112.074 33.448)",
    }),
  );
  const v = (name: string, slug: string, lng: number, price: number, status = "active") => ({
    org_id: ORG,
    name,
    slug,
    categories: ["cleaning"],
    status,
    base_location: `SRID=4326;POINT(${lng} 33.448)`,
    service_radius_m: 40_000,
    pricing: { cleaning: price },
  });
  ok(
    await db.from("vendors").insert([
      v("Near Pricey Clean", "near-pricey", -112.07, 4_000), // ~0.4 km → ETA 11 min
      v("Far Cheap Clean", "far-cheap", -111.8, 1_900), // ~25 km → ETA 48 min
      v("Limited Clean", "limited-clean", -112.07, 4_000, "limited"),
    ]),
  );
  cookies = await sessionCookies(browser, email);
});

test.afterAll(async () => {
  await admin().from("orgs").delete().eq("id", ORG);
});

test.beforeEach(async ({ context }) => {
  await context.addCookies(cookies);
});

test("adds a vendor and edits it", async ({ page, isMobile }) => {
  test.skip(isMobile, "Desktop form flow.");
  await page.goto("/vendors");
  await page.getByRole("button", { name: "Add vendor" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add a vendor" });
  await dialog.getByLabel("Name").fill("Sonoran Tow");
  await dialog.getByRole("button", { name: "Add vendor" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Pick at least one category.");
  await expect(dialog.getByLabel("Name")).toHaveValue("Sonoran Tow"); // kept after the error
  await dialog.getByLabel("Towing & roadside").check();
  await dialog.getByLabel("Towing & roadside", { exact: true }).last().fill("175"); // its price field
  await dialog.getByLabel("Base latitude").fill("33.45");
  await dialog.getByLabel("Base longitude").fill("-112.07");
  await dialog.getByLabel("Service radius (mi)").fill("30");
  await dialog.getByRole("button", { name: "Add vendor" }).click();
  await expect(page).toHaveURL(/\/vendors\/sonoran-tow$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sonoran Tow");
  await expect(page.getByText("$175.00")).toBeVisible();

  await page.getByRole("button", { name: "Edit vendor" }).click();
  const edit = page.getByRole("dialog", { name: "Edit Sonoran Tow" });
  await edit.getByLabel("Availability").selectOption("limited");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Limited").first()).toBeVisible();
});

test("filters by category and ranks vendors for a car", async ({ page }) => {
  await page.goto("/vendors?category=cleaning");
  await expect(page.getByRole("heading", { name: "Mobile cleaning" })).toBeVisible();
  await page.goto("/vendors?rank_vehicle=047&rank_category=cleaning");
  const list = page.getByRole("list", { name: /Vendors for mobile cleaning on car 047/ });
  await expect(list.getByRole("listitem")).toHaveCount(3);
  await expect(list.getByRole("listitem").first()).toContainText("Near Pricey Clean"); // ETA beats price
  // Limited: 0.82 × 0.8 = 0.66 still beats Far Cheap's 0.59 (its 48-min ETA outweighs the price).
  await expect(list.getByRole("listitem").nth(1)).toContainText("Limited Clean");
  await expect(list.getByRole("listitem").last()).toContainText("Far Cheap Clean");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
});

test("API: list, rank with breakdown, and role checks", async ({ request }) => {
  const viewer = await userToken("ven-viewer");
  await admin().from("memberships").insert({ org_id: ORG, user_id: viewer.id, role: "viewer" });
  const h = { Authorization: `Bearer ${viewer.token}`, "X-FleetOS-Org": ORG };
  const list = await (await request.get("/api/v1/vendors?category=cleaning", { headers: h })).json();
  expect(list.map((v: { slug: string }) => v.slug).sort()).toEqual(["far-cheap", "limited-clean", "near-pricey"]);
  const rank = await (
    await request.get(`/api/v1/vendors/rank?category=cleaning&vehicle_id=${CAR}`, { headers: h })
  ).json();
  expect(rank[0]).toMatchObject({
    vendor: { slug: "near-pricey" },
    expected_eta_min: 11,
    breakdown: { eta: 1, limited_penalty: false },
  });
  expect(
    rank.find((r: { vendor: { slug: string } }) => r.vendor.slug === "limited-clean").breakdown.limited_penalty,
  ).toBe(true);
  const denied = await request.post("/api/v1/vendors", { headers: h, data: { name: "Nope", categories: ["towing"] } });
  expect(denied.status()).toBe(403);
  const bad = await request.post("/api/v1/vendors", { headers: h, data: { name: "No category" } });
  expect([403, 422]).toContain(bad.status()); // role check or validation, never created
});
