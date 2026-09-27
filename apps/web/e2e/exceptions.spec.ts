import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { admin, sessionCookies, userId, userToken } from "./helpers/api";
import { uniqueEmail } from "./helpers/auth";

/** Exceptions (task 5.4): queue with summary and badge, drawer actions, manual reports, fleet filter, API. */

test.describe.configure({ mode: "serial" });
test.use({ storageState: { cookies: [], origins: [] } });

const ORG = crypto.randomUUID();
const CAR = crypto.randomUUID();
const email = uniqueEmail("exceptions");
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
      .insert({ id: ORG, name: "Exception UI Co", slug: `exc-ui-${ORG.slice(0, 8)}`, timezone: "UTC" }),
  );
  ok(await db.from("memberships").insert({ org_id: ORG, user_id: await userId(email), role: "ops" }));
  ok(await db.from("vehicles").insert({ id: CAR, org_id: ORG, vin: "7G2CEHED7RA009061", number: "061" }));
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
  // What the engine does when the cabin rule fires (rules come from the org's seeded system rules).
  ok(
    await db.rpc("engine_apply_exceptions", {
      p_org: ORG,
      p_opened: [
        {
          vehicle_id: CAR,
          rule_key: "cabin_cleanliness",
          dedupe_key: `cabin_cleanliness:${CAR}`,
          at: new Date(Date.now() - 5 * 60_000).toISOString(),
          trigger: { alert: "SIM_cabin_cleanliness_event", facts: { soc_pct: 64 } },
          recommended_action: { label: "Dispatch RapidClean", vendor_id: null, eta_min: 18, cost_cents: 4500 },
        },
      ],
      p_cleared: [],
    }),
  );
  cookies = await sessionCookies(browser, email);
});

test.afterAll(async () => {
  await admin().from("orgs").delete().eq("id", ORG);
});

test.beforeEach(async ({ context }) => {
  await context.addCookies(cookies);
});

test("the queue, its summary and the sidebar badge agree", async ({ page, isMobile }) => {
  await page.goto("/exceptions");
  const summary = page.getByRole("region", { name: "Summary" });
  await expect(summary.getByText("Active").locator("..")).toContainText("1");
  const list = page.getByRole("list", { name: "Exceptions" });
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(list).toContainText("Cabin needs cleaning");
  await expect(list).toContainText("Car 061");
  await expect(list).toContainText("Dispatch RapidClean");
  if (!isMobile) await expect(page.getByRole("link", { name: /Exceptions\s*1 active/ })).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
});

test("assign, then resolve with a note; it moves to Resolved with its history", async ({ page }) => {
  await page.goto("/exceptions");
  await page.getByRole("list", { name: "Exceptions" }).getByRole("link").first().click();
  const panel = page.getByRole("region", { name: "Cabin needs cleaning" });
  await expect(panel).toContainText("SIM_cabin_cleanliness_event");
  await panel.getByRole("button", { name: "Assign to me" }).click();
  await expect(panel.getByText("Assigned to you.")).toBeVisible();
  await expect(panel.getByText("Owner").locator("..")).toContainText("You");
  await panel.getByRole("button", { name: "Dismiss" }).click();
  await expect(panel.getByRole("alert")).toHaveText("Say why you're dismissing it.");
  await panel.getByLabel(/Note/).fill("Cleaned by the hub crew");
  await panel.getByRole("button", { name: "Resolve" }).click();
  await expect(panel.getByText("Resolved.")).toBeVisible();
  await expect(panel).toContainText("“Cleaned by the hub crew”");
  await page.goto("/exceptions?status=resolved");
  await expect(page.getByRole("list", { name: "Exceptions" })).toContainText("Cabin needs cleaning");
  await page.goto("/exceptions");
  await expect(page.getByRole("heading", { name: "Nothing needs attention" })).toBeVisible();
});

test("report an exception by hand; the fleet list shows it as the car's open issue", async ({ page, isMobile }) => {
  test.skip(isMobile, "Desktop form flow.");
  await page.goto("/exceptions");
  await page.getByRole("button", { name: "Report exception" }).click();
  const d = page.getByRole("dialog", { name: "Report an exception" });
  await d.getByRole("button", { name: "Report exception" }).click();
  await expect(d.getByRole("alert")).toHaveText("Describe the problem in a few words.");
  await d.getByLabel("What's wrong").fill("Cracked side window");
  await d.getByLabel("Vehicle", { exact: true }).selectOption("061");
  await d.getByLabel("Severity").selectOption("high");
  await d.getByRole("button", { name: "Report exception" }).click();
  await expect(page).toHaveURL(/\/exceptions\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Cracked side window" })).toBeVisible();
  await page.goto("/fleet?issue=any");
  const row = page.getByRole("row", { name: /061/ });
  await expect(row).toContainText("Cracked side window");
  await page.goto("/fleet?issue=none");
  await expect(page.getByRole("row", { name: /061/ })).toHaveCount(0);
});

test("API: list with summary and filters, detail with history, roles and rule validation", async ({ request }) => {
  const viewer = await userToken("exc-viewer");
  const owner = await userToken("exc-admin");
  await admin()
    .from("memberships")
    .insert([
      { org_id: ORG, user_id: viewer.id, role: "viewer" },
      { org_id: ORG, user_id: owner.id, role: "admin" },
    ]);
  const as = (t: string) => ({ Authorization: `Bearer ${t}`, "X-FleetOS-Org": ORG });
  const posted = await request.post("/api/v1/exceptions", {
    headers: as(owner.token),
    data: {
      vehicle_id: CAR,
      type: "flat_tyre",
      title: "Flat tyre",
      class: "incident",
      severity: "critical",
      blocks_service: true,
    },
  });
  expect(posted.status()).toBe(201);
  expect(await posted.json()).toMatchObject({ title: "Flat tyre", status: "open", vehicle: { number: "061" } });
  const all = await (
    await request.get("/api/v1/exceptions?status=open,resolved", { headers: as(viewer.token) })
  ).json();
  const titles = all.data.map((e: { title: string }) => e.title);
  expect(titles).toContain("Cabin needs cleaning");
  expect(titles[0]).toBe("Flat tyre"); // most severe first
  // The summary counts the same rows the list shows (kpis.md §6 #1).
  const active = all.data.filter((e: { status: string }) => e.status !== "resolved");
  expect(all.summary).toMatchObject({ active: active.length, resolved_today: 1, by_severity: { critical: 1 } });
  const openMedium = await (
    await request.get("/api/v1/exceptions?severity=medium&status=open", { headers: as(viewer.token) })
  ).json();
  expect(openMedium.data).toEqual([]); // the medium one is resolved
  const resolved = all.data.find((e: { title: string }) => e.title === "Cabin needs cleaning");
  const detail = await (await request.get(`/api/v1/exceptions/${resolved.id}`, { headers: as(viewer.token) })).json();
  expect(detail.events.map((e: { kind: string }) => e.kind)).toEqual(["opened", "status", "owner", "status"]);
  expect(detail.revenue_at_risk_cents).toBeNull(); // nothing at risk once resolved
  const denied = await request.patch(`/api/v1/exceptions/${resolved.id}`, {
    headers: as(viewer.token),
    data: { status: "open" },
  });
  expect(denied.status()).toBe(403);
  const bad = await request.post("/api/v1/exception-rules", {
    headers: as(owner.token),
    data: {
      key: "washer_fluid",
      name: "Washer fluid low",
      class: "maintenance",
      severity: "low",
      condition: { any: [{ field: "alert", op: "matches", value: "(" }] },
    },
  });
  expect(bad.status()).toBe(422);
  const made = await request.post("/api/v1/exception-rules", {
    headers: as(owner.token),
    data: {
      key: "washer_fluid",
      name: "Washer fluid low",
      class: "maintenance",
      severity: "low",
      condition: { any: [{ field: "alert", op: "matches", value: "washerFluid" }] },
    },
  });
  expect(made.status()).toBe(201);
  const rule = await made.json();
  expect(rule).toMatchObject({ is_system: false, enabled: true, auto_resolve: true });
  const system = (await (await request.get("/api/v1/exception-rules", { headers: as(viewer.token) })).json()).find(
    (r: { key: string }) => r.key === "drive_fault",
  );
  expect((await request.delete(`/api/v1/exception-rules/${system.id}`, { headers: as(owner.token) })).status()).toBe(
    409,
  );
  expect((await request.delete(`/api/v1/exception-rules/${rule.id}`, { headers: as(owner.token) })).status()).toBe(204);
});
