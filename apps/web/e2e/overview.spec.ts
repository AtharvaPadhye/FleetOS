import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { admin, sessionCookies, userId, userToken } from "./helpers/api";
import { uniqueEmail } from "./helpers/auth";

/** Overview (task 5.3): the attention queue with its Bleed line, one-click dispatch, charts with tables, API. */

test.describe.configure({ mode: "serial" });
test.use({ storageState: { cookies: [], origins: [] } });

const ORG = crypto.randomUUID();
const CAR = crypto.randomUUID();
const VENDOR = crypto.randomUUID();
const email = uniqueEmail("overview");
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
      .insert({ id: ORG, name: "Overview UI Co", slug: `ov-ui-${ORG.slice(0, 8)}`, timezone: "UTC" }),
  );
  ok(await db.from("memberships").insert({ org_id: ORG, user_id: await userId(email), role: "owner" }));
  ok(await db.from("vehicles").insert({ id: CAR, org_id: ORG, vin: "7G2CEHED7RA009081", number: "081" }));
  ok(
    await db.from("vehicle_state_current").insert({
      vehicle_id: CAR,
      org_id: ORG,
      status: "incident",
      status_since: new Date().toISOString(),
      connectivity: "online",
      location: "SRID=4326;POINT(-112.074 33.448)",
    }),
  );
  ok(
    await db.from("vendors").insert({
      id: VENDOR,
      org_id: ORG,
      name: "Desert Tire Response",
      slug: "desert-tire",
      categories: ["tyres"],
      base_location: "SRID=4326;POINT(-112.07 33.448)",
      service_radius_m: 30_000,
      pricing: { tyres: 14_000 },
    }),
  );
  ok(
    await db.rpc("engine_apply_exceptions", {
      p_org: ORG,
      p_opened: [
        {
          vehicle_id: CAR,
          rule_key: "tyre_pressure_low",
          dedupe_key: `tyre_pressure_low:${CAR}`,
          at: new Date(Date.now() - 30 * 60_000).toISOString(),
          trigger: { alert: "SIM_TPMS_w201_tirePressureLow" },
          recommended_action: {
            label: "Dispatch Desert Tire Response",
            vendor_id: VENDOR,
            vendor_name: "Desert Tire Response",
            eta_min: 12,
            cost_cents: 14_000,
          },
        },
      ],
      p_cleared: [],
    }),
  );
  // A $24/h baseline (no ride history in this fixture): 30 minutes out of service ≈ $12 lost so far.
  ok(await db.from("exceptions").update({ baseline_rate_cents_per_h: 2400 }).eq("org_id", ORG));
  cookies = await sessionCookies(browser, email);
});

test.afterAll(async () => {
  await admin().from("orgs").delete().eq("id", ORG);
});

test.beforeEach(async ({ context }) => {
  await context.addCookies(cookies);
});

test("the attention queue shows what's costing money, with its Bleed line", async ({ page }) => {
  await page.goto("/");
  const queue = page.getByRole("region", { name: "Needs attention" });
  const row = queue.getByRole("listitem").first();
  await expect(row).toContainText("Cybercab 081 · Tyre pressure low");
  await expect(row).toContainText(/−\$1[12]\.\d\d so far · −\$0\.40\/min/);
  await expect(row.getByText(/Losing about \$0\.40 per minute/)).toBeAttached(); // screen-reader sentence
  await expect(page.getByRole("region", { name: "Fleet health" })).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
});

test("charts carry a summary and a table, and periods are in the URL", async ({ page }) => {
  await page.goto("/?period=last_7d");
  await expect(page.getByRole("link", { name: "Last 7 days" })).toHaveAttribute("aria-current", "true");
  const figure = page.getByRole("region", { name: "Revenue vs operating cost, last 7 days" });
  await figure.getByText("View as table").click();
  await expect(figure.getByRole("table").getByRole("row")).toHaveCount(8); // header + 7 days
});

test("one click dispatches the recommended vendor", async ({ page, isMobile }) => {
  test.skip(isMobile, "One dispatch per fixture.");
  await page.goto("/");
  await page.getByRole("button", { name: "Dispatch Desert Tire Response" }).click();
  await expect(page).toHaveURL(/\/service\/SVC-\d{4}-0001$/);
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Needs attention" })).toContainText("Service ticket open");
});

test("API: /attention matches the queue", async ({ request }) => {
  const viewer = await userToken("ov-viewer");
  await admin().from("memberships").insert({ org_id: ORG, user_id: viewer.id, role: "viewer" });
  const groups = await (
    await request.get("/api/v1/attention", {
      headers: { Authorization: `Bearer ${viewer.token}`, "X-FleetOS-Org": ORG },
    })
  ).json();
  expect(groups).toHaveLength(1);
  expect(groups[0]).toMatchObject({ key: "tyre_pressure_low", affected_count: 1, bleed: { rate_cents_per_min: 40 } });
  expect(groups[0].bleed.lost_cents).toBeGreaterThanOrEqual(1200);
});
