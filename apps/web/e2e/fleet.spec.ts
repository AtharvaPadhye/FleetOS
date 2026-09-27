import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { withCheckDigit } from "@fleetos/domain";
import { admin, sessionCookies, userId } from "./helpers/api";
import { uniqueEmail } from "./helpers/auth";

/**
 * Fleet list (task 5.1): empty state and add-vehicle on the setup org; filters, sort, click-through, export
 * and saved columns on a fixture org with known vehicles.
 */

test.describe("empty fleet", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.skip(({ isMobile }) => isMobile, "Covered on desktop; the phone layout is checked below.");
  const ORG = crypto.randomUUID();
  const email = uniqueEmail("fleet-empty");
  let cookies: Awaited<ReturnType<typeof sessionCookies>> = [];

  test.beforeAll(async ({ browser }) => {
    const db = admin();
    await db.auth.admin.createUser({ email, email_confirm: true });
    await db
      .from("orgs")
      .insert({ id: ORG, name: "Empty Fleet Co", slug: `empty-fleet-${ORG.slice(0, 8)}`, is_demo: false });
    await db.from("memberships").insert({ org_id: ORG, user_id: await userId(email), role: "owner" });
    cookies = await sessionCookies(browser, email);
  });
  test.afterAll(async () => {
    await admin().from("orgs").delete().eq("id", ORG);
  });

  test("shows what's missing and adds a vehicle by VIN", async ({ page, context }) => {
    await context.addCookies(cookies);
    // Unique per run so the test can be repeated.
    const serial = String(Date.now()).slice(-6);
    const number = `T${serial.slice(-4)}`;
    const vin = withCheckDigit(`7G2CEHED0RA${serial}`);
    const badVin = vin.slice(0, 8) + (vin[8] === "0" ? "1" : "0") + vin.slice(9);
    await page.goto("/fleet");
    if (!(await page.getByRole("heading", { name: /vehicles$/ }).count()))
      await expect(page.getByRole("heading", { name: "No vehicles yet" })).toBeVisible();
    await page.getByRole("button", { name: "Add vehicle" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Add a vehicle" });
    await dialog.getByLabel("VIN").fill(badVin); // wrong check digit
    await dialog.getByLabel("Fleet number").fill(number);
    await dialog.getByRole("button", { name: "Add vehicle" }).click();
    await expect(dialog.getByText("That VIN's check digit doesn't match")).toBeVisible();
    await expect(dialog.getByLabel("Fleet number")).toHaveValue(number); // kept after the failed submit
    await dialog.getByLabel("VIN").fill(vin);
    await dialog.getByLabel("Insurance ($/month)").fill("486");
    await dialog.getByRole("button", { name: "Add vehicle" }).click();
    await expect(page).toHaveURL(new RegExp(`/fleet/${number}$`));
    await page.goto("/fleet");
    await expect(page.getByRole("row", { name: new RegExp(number) })).toContainText("Offline"); // no live data yet
  });
});

test.describe("fleet with vehicles", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.describe.configure({ mode: "serial" });

  const ORG = crypto.randomUUID();
  const HUB = crypto.randomUUID();
  const email = uniqueEmail("fleet");
  const today = new Date().toISOString().slice(0, 10);

  test.beforeAll(async () => {
    const db = admin();
    const ok = (r: { error: { message: string } | null }) => {
      if (r.error) throw new Error(r.error.message);
    };
    const { data: u, error } = await db.auth.admin.createUser({ email, email_confirm: true });
    if (error) throw error;
    ok(
      await db
        .from("orgs")
        .insert({ id: ORG, name: "Fleet UI Co", slug: `fleet-ui-${ORG.slice(0, 8)}`, timezone: "UTC", is_demo: false }),
    );
    ok(await db.from("memberships").insert({ org_id: ORG, user_id: u.user.id, role: "owner" }));
    ok(
      await db
        .from("hubs")
        .insert({ id: HUB, org_id: ORG, name: "Depot North", location: "SRID=4326;POINT(-112.07 33.45)" }),
    );
    const cars = ["001", "002", "003"].map((n) => ({
      id: crypto.randomUUID(),
      org_id: ORG,
      vin: `7G2CEHED${{ "001": "7", "002": "9", "003": "0" }[n]}RA004${n}`,
      number: n,
      home_hub_id: HUB,
    }));
    ok(await db.from("vehicles").insert(cars));
    const now = new Date().toISOString();
    const state = (i: number, status: string, soc: number, connectivity: string, last: string) => ({
      vehicle_id: cars[i]!.id,
      org_id: ORG,
      status,
      status_since: now,
      soc,
      connectivity,
      last_telemetry_at: last,
      current_hub_id: i === 1 ? HUB : null,
      location: "SRID=4326;POINT(-112.05 33.44)",
    });
    ok(
      await db
        .from("vehicle_state_current")
        .insert([
          state(0, "in_service", 0.8, "online", now),
          state(1, "charging", 0.3, "online", now),
          state(2, "offline", 0.55, "offline", "2026-01-01T00:00:00Z"),
        ]),
    );
    const line = (i: number, category: string, amount_cents: number) => ({
      org_id: ORG,
      vehicle_id: cars[i]!.id,
      occurred_on: today,
      category,
      amount_cents,
      source: "manual",
      source_ref: `${i}|${category}`,
    });
    ok(
      await db
        .from("ledger_entries")
        .insert([line(0, "gross_ride_revenue", 31_840), line(1, "gross_ride_revenue", 12_000)]),
    );
  });

  let cookies: Awaited<ReturnType<typeof sessionCookies>> = [];
  test.beforeAll(async ({ browser }) => {
    cookies = await sessionCookies(browser, email);
  });

  test.afterAll(async () => {
    await admin().from("orgs").delete().eq("id", ORG);
  });

  test.beforeEach(async ({ context }) => {
    await context.addCookies(cookies);
  });

  async function open(page: Page, path = "/fleet") {
    await page.goto(path);
  }

  test("filters by status chip, sorts by header, and opens a vehicle", async ({ page, isMobile }) => {
    test.skip(isMobile, "Desktop interaction; phone layout below.");
    await open(page);
    await expect(page.getByRole("heading", { name: "3 vehicles" })).toBeVisible();
    const table = page.getByRole("region", { name: /Vehicles, 3 matching/ });
    await expect(table.getByRole("row", { name: /001/ })).toContainText("$318");
    await expect(table.getByRole("row", { name: /002/ })).toContainText("Depot North"); // at the hub
    await expect(table.getByRole("row", { name: /003/ })).toContainText("Stale");

    await page.getByRole("link", { name: /Charging\s*1/ }).click();
    await expect(page).toHaveURL(/status=charging/);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();
    await page.getByRole("link", { name: "Clear filters" }).first().click();
    await expect(page).toHaveURL(/\/fleet$/);

    await page.getByRole("link", { name: /Revenue today/ }).click();
    await expect(page).toHaveURL(/sort=-revenue/);
    await expect(page.getByRole("columnheader", { name: /Revenue today/ })).toHaveAttribute("aria-sort", "descending");
    const numbers = page.getByRole("rowheader");
    await expect(numbers.first()).toContainText("001");

    await page.getByRole("row", { name: /002/ }).getByRole("cell").nth(2).click(); // anywhere in the row
    await expect(page).toHaveURL(/\/fleet\/002$/);
  });

  test("exports every matching vehicle as CSV", async ({ page, isMobile }) => {
    test.skip(isMobile, "Desktop only.");
    await open(page, "/fleet?soc=lt40");
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Export CSV" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(`fleet-${today}.csv`);
    const csv = await (await file.createReadStream()).toArray().then((c) => Buffer.concat(c).toString());
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(2); // header + car 002 (30%)
    expect(csv).toContain("002,,7G2CEHED9RA004002,charging,30,Depot North,Depot North,120.00");
  });

  test("remembers the chosen columns", async ({ page, isMobile }) => {
    test.skip(isMobile, "Desktop only.");
    await open(page);
    await page.getByRole("button", { name: "Columns" }).click();
    await page.getByRole("checkbox", { name: "Home hub" }).uncheck();
    await page.getByRole("radio", { name: "Compact" }).check();
    await page.getByRole("button", { name: "Save view" }).click();
    await expect(page.getByRole("columnheader", { name: "Home hub" })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("columnheader", { name: "Home hub" })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: /Battery/ })).toBeVisible();
  });

  test("has no WCAG 2.2 AA violations with data, and folds filters on phones", async ({ page, isMobile }) => {
    await open(page);
    await expect(page.getByRole("region", { name: /Vehicles, 3 matching/ })).toBeVisible();
    if (isMobile) {
      await expect(page.getByLabel("Home hub")).toBeHidden();
      await page.getByRole("button", { name: "Filters" }).click();
      await expect(page.getByLabel("Home hub")).toBeVisible();
    }
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
});
