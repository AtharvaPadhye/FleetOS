import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { admin, sessionCookies, userId, userToken } from "./helpers/api";
import { uniqueEmail } from "./helpers/auth";

/** Financials (task 5.8): period KPIs, insights naming the cost driver, performance table, CSV export, API. */
test.describe.configure({ mode: "serial" });
test.use({ storageState: { cookies: [], origins: [] } });

const ORG = crypto.randomUUID();
const email = uniqueEmail("financials");
let cookies: Awaited<ReturnType<typeof sessionCookies>> = [];
const today = new Date().toISOString().slice(0, 10);

test.beforeAll(async ({ browser }) => {
  const db = admin();
  const ok = (r: { error: { message: string } | null }) => {
    if (r.error) throw new Error(r.error.message);
  };
  await db.auth.admin.createUser({ email, email_confirm: true });
  ok(await db.from("orgs").insert({ id: ORG, name: "Money Co", slug: `money-${ORG.slice(0, 8)}`, timezone: "UTC" }));
  ok(await db.from("memberships").insert({ org_id: ORG, user_id: await userId(email), role: "finance" }));
  // Six cars earn $300 each; car 106 also paid $250 for maintenance, so its margin is far below the rest.
  const cars = Array.from({ length: 6 }, (_, i) => ({
    id: crypto.randomUUID(),
    org_id: ORG,
    vin: `7G2CEHED${i}RA0092${String(i).padStart(2, "0")}`.slice(0, 17),
    number: `10${i + 1}`,
  }));
  ok(await db.from("vehicles").insert(cars));
  ok(
    await db.from("ledger_entries").insert(
      cars.flatMap((c, i) => [
        {
          org_id: ORG,
          vehicle_id: c.id,
          occurred_on: today,
          category: "gross_ride_revenue",
          amount_cents: 30_000,
          source: "manual",
          source_ref: `rev-${i}`,
        },
        {
          org_id: ORG,
          vehicle_id: c.id,
          occurred_on: today,
          category: "platform_fee",
          amount_cents: 6_000,
          source: "manual",
          source_ref: `fee-${i}`,
        },
        ...(c.number === "106"
          ? [
              {
                org_id: ORG,
                vehicle_id: c.id,
                occurred_on: today,
                category: "maintenance",
                amount_cents: 25_000,
                source: "manual",
                source_ref: "maint",
              },
            ]
          : []),
      ]),
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

test("period KPIs, an insight naming the cost driver, and Review cars first", async ({ page }) => {
  await page.goto("/financials?period=last_30d");
  await expect(page.getByRole("link", { name: "Last 30 days" })).toHaveAttribute("aria-current", "true");
  const kpis = page.getByRole("region", { name: /–/ });
  await expect(kpis).toContainText("$1,800"); // 6 × $300 revenue
  const insights = page.getByRole("region", { name: "Insights" });
  await expect(insights).toContainText("Car 106");
  await expect(insights).toContainText("Maintenance 100% of the gap");
  const table = page.getByRole("region", { name: "Vehicle performance" });
  await expect(table.getByRole("row").nth(1)).toContainText("106");
  await expect(table.getByRole("row").nth(1)).toContainText("Review");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
});

test("custom period in the URL, and an empty period says so", async ({ page }) => {
  await page.goto("/financials?from=2020-01-01&to=2020-01-31");
  await expect(page.getByRole("heading", { name: "Nothing booked in this period" })).toBeVisible();
});

test("CSV export of the period's vehicle P&L", async ({ page }) => {
  const res = await page.request.get("/financials/export.csv?period=last_30d");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-disposition"]).toMatch(/financials-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv/);
  const lines = (await res.text()).trim().split("\r\n");
  expect(lines).toHaveLength(7); // header + 6 cars
  expect(lines[1]).toMatch(/^106,,300\.00,60\.00,0\.00,0\.00,250\.00/);
});

test("API: insights for money roles only", async ({ request }) => {
  const ops = await userToken("fin-ops");
  const owner = await userToken("fin-owner");
  await admin()
    .from("memberships")
    .insert([
      { org_id: ORG, user_id: ops.id, role: "ops" },
      { org_id: ORG, user_id: owner.id, role: "owner" },
    ]);
  const denied = await request.get("/api/v1/financials/insights", {
    headers: { Authorization: `Bearer ${ops.token}`, "X-FleetOS-Org": ORG },
  });
  expect(denied.status()).toBe(403);
  const list = await (
    await request.get("/api/v1/financials/insights?period=last_30d", {
      headers: { Authorization: `Bearer ${owner.token}`, "X-FleetOS-Org": ORG },
    })
  ).json();
  expect(list[0]).toMatchObject({ scope: "vehicle", drivers: [{ category: "maintenance", share: 1 }] });
});
