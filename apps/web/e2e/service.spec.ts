import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { admin, sessionCookies, userId, userToken } from "./helpers/api";
import { uniqueEmail } from "./helpers/auth";

/** Service tickets (task 5.5): the core loop detect → dispatch → return to service, attachments, API. */

test.describe.configure({ mode: "serial" });
test.use({ storageState: { cookies: [], origins: [] } });

const ORG = crypto.randomUUID();
const CAR = crypto.randomUUID();
const CAR2 = crypto.randomUUID();
const VENDOR = crypto.randomUUID();
const email = uniqueEmail("service");
let cookies: Awaited<ReturnType<typeof sessionCookies>> = [];
// 1×1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
}

test.beforeAll(async ({ browser }) => {
  const db = admin();
  const ok = (r: { error: { message: string } | null }) => {
    if (r.error) throw new Error(r.error.message);
  };
  await db.auth.admin.createUser({ email, email_confirm: true });
  ok(
    await db
      .from("orgs")
      .insert({ id: ORG, name: "Service UI Co", slug: `svc-ui-${ORG.slice(0, 8)}`, timezone: "UTC" }),
  );
  ok(await db.from("memberships").insert({ org_id: ORG, user_id: await userId(email), role: "owner" }));
  ok(
    await db.from("vehicles").insert([
      { id: CAR, org_id: ORG, vin: "7G2CEHED7RA009071", number: "071" },
      { id: CAR2, org_id: ORG, vin: "7G2CEHED9RA009072", number: "072" },
    ]),
  );
  const state = (id: string) => ({
    vehicle_id: id,
    org_id: ORG,
    status: "in_service",
    status_since: new Date().toISOString(),
    connectivity: "online",
    location: "SRID=4326;POINT(-112.074 33.448)",
  });
  ok(await db.from("vehicle_state_current").insert([state(CAR), state(CAR2)]));
  ok(
    await db.from("vendors").insert({
      id: VENDOR,
      org_id: ORG,
      name: "Sparkle Mobile",
      slug: "sparkle-mobile",
      categories: ["cleaning"],
      base_location: "SRID=4326;POINT(-112.07 33.448)",
      service_radius_m: 30_000,
      pricing: { cleaning: 4500 },
    }),
  );
  ok(
    await db.rpc("engine_apply_exceptions", {
      p_org: ORG,
      p_opened: [
        {
          vehicle_id: CAR,
          rule_key: "cabin_cleanliness",
          dedupe_key: `cabin_cleanliness:${CAR}`,
          at: new Date(Date.now() - 2 * 60_000).toISOString(),
          trigger: { alert: "SIM_cabin_cleanliness_event" },
          recommended_action: {
            label: "Dispatch Sparkle Mobile",
            vendor_id: VENDOR,
            vendor_name: "Sparkle Mobile",
            eta_min: 11,
            cost_cents: 4500,
          },
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

test("the core loop: dispatch from the exception, arrive, complete with cost, return to service", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "One run of the loop is enough; the phone layout is checked below.");
  await page.goto("/exceptions");
  await page.getByRole("list", { name: "Exceptions" }).getByRole("link").first().click();
  await page.getByRole("button", { name: "Dispatch Sparkle Mobile" }).click();
  await expect(page).toHaveURL(/\/service\/SVC-\d{4}-0001$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/SVC-\d{4}-0001/);
  await expect(page.locator("[data-sla]").first()).toHaveText(/min left/);
  await expect(page.getByText("Sparkle Mobile").first()).toBeVisible();
  await axe(page);

  await page.getByRole("button", { name: "Mark arrived" }).click();
  await expect(page.getByText("Marked arrived.")).toBeVisible();
  await page.getByLabel("Actual cost ($)").fill("52");
  await page.getByRole("button", { name: "Complete service" }).click();
  await expect(page.getByText("Service completed and cost posted.")).toBeVisible();

  await page.getByLabel("Choose a file").setInputFiles({ name: "after-clean.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByRole("img", { name: "after-clean.png" })).toBeVisible();
  await page
    .getByLabel("Choose a file")
    .setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hi") });
  await expect(page.getByText("Attach a JPEG, PNG, HEIC photo or a PDF.")).toBeVisible();

  await page.getByRole("button", { name: "Return to service" }).click();
  await expect(page.getByText(/Re-enable car 071 in the Tesla app/)).toBeVisible();
  const activity = page.getByRole("region", { name: "Activity" });
  for (const step of [
    "Ticket created",
    "Vendor dispatched",
    "Vendor arrived",
    "Service completed",
    "Attachment added",
    "Returned to service",
  ])
    await expect(activity).toContainText(step);

  // The exception is resolved and the cost is in the ledger exactly once.
  const db = admin();
  const { data: ex } = await db.from("exceptions").select("status").eq("org_id", ORG).eq("vehicle_id", CAR).single();
  expect(ex?.status).toBe("resolved");
  const { data: ledger } = await db.from("ledger_entries").select("category, amount_cents, source").eq("org_id", ORG);
  expect(ledger).toEqual([{ category: "cleaning", amount_cents: 5200, source: "ticket" }]);

  await page.goto("/service?status=closed");
  await expect(page.getByRole("table")).toContainText("Returned to service");
  await axe(page);
});

test("vehicle page: create a ticket, pull from service, return is blocked by the open ticket", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "Desktop dialog flow.");
  await page.goto("/fleet/072");
  await page.getByRole("button", { name: "Create service ticket" }).click();
  const d = page.getByRole("dialog", { name: "Service ticket for car 072" });
  await d.getByLabel("Kind of service").selectOption("maintenance");
  await d.getByLabel("What needs doing").fill("Rattle from the rear door");
  await d.getByLabel(/Keep the car out of service/).check();
  await d.getByRole("button", { name: "Create ticket" }).click();
  await expect(page).toHaveURL(/\/service\/SVC-\d{4}-0002$/);
  await expect(page.getByText("Awaiting dispatch")).toBeVisible();

  await page.goto("/fleet/072");
  await page.getByRole("button", { name: "Return to service" }).click();
  const r = page.getByRole("dialog", { name: "Return car 072 to service" });
  await expect(r).toContainText(/Still blocked by SVC-\d{4}-0002 \(maintenance\)/);
  await r.getByRole("button", { name: "Return to service" }).click();
  await expect(r.getByRole("alert")).toContainText("Still blocked by");
});

test("the service list and ticket page work on a phone", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Phone layout.");
  const { error } = await admin().rpc("engine_ticket_steps", {
    p_org: ORG,
    p_steps: [
      {
        action: "dispatch",
        at: new Date().toISOString(),
        vehicle_id: CAR,
        type: "cleaning",
        blocks_service: true,
        description: "Spill on the rear seat",
        vendor_id: VENDOR,
        eta_at: new Date(Date.now() + 11 * 60_000).toISOString(),
      },
    ],
  });
  expect(error).toBeNull();
  await page.goto("/service?status=all");
  await expect(page.getByRole("region", { name: "Service KPIs" })).toBeVisible();
  await expect(page.getByRole("table")).toContainText("071");
  await axe(page);
});

test("API: tickets, actions, events, vendor jobs, roles and conflicts", async ({ request }) => {
  const viewer = await userToken("svc-viewer");
  const ops = await userToken("svc-ops");
  await admin()
    .from("memberships")
    .insert([
      { org_id: ORG, user_id: viewer.id, role: "viewer" },
      { org_id: ORG, user_id: ops.id, role: "ops" },
    ]);
  const as = (t: string) => ({ Authorization: `Bearer ${t}`, "X-FleetOS-Org": ORG });
  const denied = await request.post("/api/v1/tickets", {
    headers: as(viewer.token),
    data: { vehicle_id: CAR2, type: "cleaning" },
  });
  expect(denied.status()).toBe(403);
  const made = await request.post("/api/v1/tickets", {
    headers: as(ops.token),
    data: { vehicle_id: CAR2, type: "cleaning", vendor_id: VENDOR, description: "Spill" },
  });
  expect(made.status()).toBe(201);
  const t = await made.json();
  expect(t).toMatchObject({ status: "dispatched", vendor: { name: "Sparkle Mobile" }, sla_state: "on_track" });
  const early = await request.post(`/api/v1/tickets/${t.id}/actions/return-to-service`, {
    headers: as(ops.token),
    data: {},
  });
  expect(early.status()).toBe(422);
  const done = await request.post(`/api/v1/tickets/${t.id}/actions/complete`, {
    headers: as(ops.token),
    data: { actual_cost_cents: 3900 },
  });
  expect(await done.json()).toMatchObject({ status: "completed", actual_cost_cents: 3900, sla_state: "met" });
  const events = await (await request.get(`/api/v1/tickets/${t.id}/events`, { headers: as(viewer.token) })).json();
  expect(events.map((e: { type: string }) => e.type)).toEqual(["created", "vendor_assigned", "completed"]);
  const jobs = await (await request.get(`/api/v1/vendors/${VENDOR}/jobs`, { headers: as(viewer.token) })).json();
  expect(jobs.data.length).toBeGreaterThanOrEqual(1);
  expect(jobs.data[0]).toMatchObject({ cost_cents: 3900, sla_met: true, tracking_source: "manual" });
  const vendor = await (await request.get(`/api/v1/vendors/${VENDOR}`, { headers: as(viewer.token) })).json();
  expect(vendor.metrics.jobs_completed).toBeGreaterThanOrEqual(1);
  // The tiles count the same rows the list shows.
  const active = await (
    await request.get("/api/v1/tickets?status=open,dispatched,en_route,arrived,in_progress", {
      headers: as(viewer.token),
    })
  ).json();
  expect(active.summary.active).toBe(active.page.total);
  const list = await (
    await request.get("/api/v1/tickets?status=completed,returned", { headers: as(viewer.token) })
  ).json();
  expect(list.data.length).toBeGreaterThanOrEqual(1);
  const bad = await request.post(`/api/v1/tickets/${t.id}/actions/fly`, { headers: as(ops.token), data: {} });
  expect(bad.status()).toBe(404);
});
