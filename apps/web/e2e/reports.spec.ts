import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { admin, sessionCookies, userId, userToken } from "./helpers/api";
import { uniqueEmail } from "./helpers/auth";

/**
 * Reports (task 5.9, flows.md F5): generate a monthly snapshot, read it in the Paper theme, share a read-only
 * link a lender opens without signing in, revoke it, export the PDF, and the same through the API.
 */
test.describe.configure({ mode: "serial" });
test.use({ storageState: { cookies: [], origins: [] } });

const ORG = crypto.randomUUID();
const email = uniqueEmail("reports");
let cookies: Awaited<ReturnType<typeof sessionCookies>> = [];

// Last month, closed: three days of hours and a ledger, in UTC so the month is the same wherever tests run.
const now = new Date();
const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
const MONTH = first.toISOString().slice(0, 7);
const MONTH_LABEL = first.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const day = (n: number) => `${MONTH}-${String(n).padStart(2, "0")}`;

test.beforeAll(async ({ browser }) => {
  const db = admin();
  const ok = (r: { error: { message: string } | null }) => {
    if (r.error) throw new Error(r.error.message);
  };
  await db.auth.admin.createUser({ email, email_confirm: true });
  ok(
    await db.from("orgs").insert({ id: ORG, name: "Ledger Line", slug: `ledger-${ORG.slice(0, 8)}`, timezone: "UTC" }),
  );
  ok(await db.from("memberships").insert({ org_id: ORG, user_id: await userId(email), role: "finance" }));
  const cars = Array.from({ length: 3 }, (_, i) => ({
    id: crypto.randomUUID(),
    org_id: ORG,
    vin: `7G2CEHED${i}RA0093${String(i).padStart(2, "0")}`.slice(0, 17),
    number: `20${i + 1}`,
  }));
  ok(await db.from("vehicles").insert(cars));
  ok(
    await db.from("vehicle_day_hours").insert(
      cars.flatMap((c) =>
        [3, 4, 5].map((d) => ({
          org_id: ORG,
          vehicle_id: c.id,
          day: day(d),
          in_service_h: 14,
          ready_h: 6,
          offline_h: 1,
        })),
      ),
    ),
  );
  ok(
    await db.from("ledger_entries").insert(
      cars.flatMap((c, i) => [
        {
          org_id: ORG,
          vehicle_id: c.id,
          occurred_on: day(4),
          category: "gross_ride_revenue",
          amount_cents: 40_000,
          source: "manual",
          source_ref: `r-${i}`,
        },
        {
          org_id: ORG,
          vehicle_id: c.id,
          occurred_on: day(4),
          category: "platform_fee",
          amount_cents: 8_000,
          source: "manual",
          source_ref: `f-${i}`,
        },
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

let reportUrl = "";

test("generate a closed month and read the snapshot", async ({ page }) => {
  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: "No reports yet" })).toBeVisible();
  await page.getByLabel("Month", { exact: true }).selectOption(MONTH);
  await page.getByRole("button", { name: "Generate report" }).click();
  await page.waitForURL(/\/reports\/[0-9a-f-]{36}$/);
  reportUrl = new URL(page.url()).pathname;
  await expect(page.getByRole("heading", { name: MONTH_LABEL })).toBeVisible();
  await expect(page.getByText("version 1")).toBeVisible();
  await expect(page.getByText(/preliminary/i)).toHaveCount(0);
  const covenants = page.getByRole("region", { name: "Covenants" });
  await expect(covenants).toContainText("Uptime above 94%");
  await expect(covenants).toContainText("Contribution margin at least 50%");
  await expect(page.getByRole("region", { name: "Executive summary" })).toContainText("$1,200"); // 3 × $400
  await expect(page.getByRole("img", { name: /Daily availability/ })).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);

  // Regenerating the same month keeps the first snapshot and adds version 2.
  await page.goto("/reports");
  await page.getByLabel("Month", { exact: true }).selectOption(MONTH);
  await page.getByRole("button", { name: "Generate report" }).click();
  await page.waitForURL((u) => /\/reports\/[0-9a-f-]{36}$/.test(u.pathname) && u.pathname !== reportUrl);
  await expect(page.getByText("version 2")).toBeVisible();
  await page.goto("/reports");
  await expect(page.getByRole("link", { name: new RegExp(`${MONTH_LABEL} · version`) })).toHaveCount(2);
});

test("a share link opens without signing in, marked for its recipient, until revoked", async ({ page, browser }) => {
  await page.goto(reportUrl);
  await page.getByLabel("For (shown on the copy)").fill("Harbor Bank credit team");
  await page.getByRole("button", { name: "Create link" }).click();
  const url = await page.getByLabel("Share link").inputValue();
  expect(url).toMatch(/\/r\/[0-9a-f]{48}$/);

  const lender = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const view = await lender.newPage();
  await view.goto(url);
  await expect(view.getByRole("heading", { name: MONTH_LABEL })).toBeVisible();
  await expect(view.getByText("Prepared for Harbor Bank credit team. Read-only copy.")).toBeVisible();

  await page.getByRole("button", { name: "Revoke link for Harbor Bank credit team" }).click();
  await expect(page.getByText("revoked")).toBeVisible();
  await view.reload();
  await expect(view.getByRole("heading", { name: "This report link has expired" })).toBeVisible();
  await lender.close();
});

test("Export PDF redirects to a signed PDF", async ({ page }) => {
  test.setTimeout(90_000);
  const res = await page.request.get(`${reportUrl}/pdf`, { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  const pdf = await page.request.get(res.headers().location!);
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
});

test("API: reports, shares and covenants for the right roles", async ({ request }) => {
  const owner = await userToken("rep-owner");
  const ops = await userToken("rep-ops");
  await admin()
    .from("memberships")
    .insert([
      { org_id: ORG, user_id: owner.id, role: "owner" },
      { org_id: ORG, user_id: ops.id, role: "ops" },
    ]);
  const as = (t: { token: string }) => ({ headers: { Authorization: `Bearer ${t.token}`, "X-FleetOS-Org": ORG } });

  expect((await request.get("/api/v1/reports", as(ops))).status()).toBe(403);
  const list = await (await request.get("/api/v1/reports", as(owner))).json();
  expect(list).toHaveLength(2);
  expect(list[0]).toMatchObject({ month: MONTH, version: 2, status: "ready", preliminary: false });

  const created = await request.post("/api/v1/reports", { ...as(owner), data: { month: MONTH } });
  expect(created.status()).toBe(201);
  const summary = await created.json();
  expect(summary).toMatchObject({ month: MONTH, version: 3 });
  const bad = await request.post("/api/v1/reports", { ...as(owner), data: { month: "2999-01" } });
  expect(bad.status()).toBe(422);

  const report = await (await request.get(`/api/v1/reports/${summary.id}`, as(owner))).json();
  expect(report.data.summary.revenue_cents).toBe(120_000);
  expect(report.data.covenants).toHaveLength(4);

  const share = await request.post(`/api/v1/reports/${summary.id}/shares`, {
    ...as(owner),
    data: { recipient: "Credit desk", expires_in_days: 7 },
  });
  expect(share.status()).toBe(201);
  const s = await share.json();
  expect(s.url).toMatch(/\/r\/[0-9a-f]{48}$/);
  expect((await request.delete(`/api/v1/reports/${summary.id}/shares/${s.id}`, as(owner))).status()).toBe(204);
  expect((await request.delete(`/api/v1/reports/${summary.id}/shares/${s.id}`, as(owner))).status()).toBe(404);

  const covenants = await (await request.get("/api/v1/covenants", as(ops))).json();
  expect(covenants.map((c: { metric: string }) => c.metric).sort()).toEqual([
    "contribution_margin",
    "incidents_per_10k_rides",
    "uptime",
    "vendor_sla",
  ]);
  const put = await request.put("/api/v1/covenants", {
    ...as(owner),
    data: [
      { metric: "uptime", operator: ">=", threshold: 0.9 },
      { metric: "availability", operator: ">=", threshold: 0.85, label: "Availability at least 85%" },
    ],
  });
  expect(put.status()).toBe(200);
  expect(await put.json()).toEqual([
    expect.objectContaining({ metric: "availability", label: "Availability at least 85%" }),
    expect.objectContaining({ metric: "uptime", threshold: 0.9, label: "Uptime at least 90%" }),
  ]);
  expect((await request.put("/api/v1/covenants", { ...as(ops), data: [] })).status()).toBe(403);
});
