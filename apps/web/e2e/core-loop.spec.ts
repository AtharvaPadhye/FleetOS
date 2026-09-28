import { expect, test } from "@playwright/test";
import { admin, sessionCookies, userId } from "./helpers/api";
import { uniqueEmail } from "./helpers/auth";

/**
 * Phase 5 exit check: the PRD core loop in one pass, as an owner would live it.
 *   detect → prioritise by revenue at risk → dispatch vendor → track SLA → return to service
 *   → post cost to the vehicle's P&L → roll up to the owner & lender report
 * Detection enters through `engine_apply_exceptions`, the call the engine tick makes once a rule fires (rule
 * evaluation itself is covered by packages/engine's tests; the simulator can't be told to raise one alert on cue).
 */
test.describe.configure({ mode: "serial" });
test.use({ storageState: { cookies: [], origins: [] } });

const ORG = crypto.randomUUID();
const CAR = crypto.randomUUID();
const VENDOR = crypto.randomUUID();
const email = uniqueEmail("core-loop");
let cookies: Awaited<ReturnType<typeof sessionCookies>> = [];
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const MONTH = new Date().toISOString().slice(0, 7);

test.beforeAll(async ({ browser }) => {
  const db = admin();
  const ok = (r: { error: { message: string } | null }) => {
    if (r.error) throw new Error(r.error.message);
  };
  await db.auth.admin.createUser({ email, email_confirm: true });
  ok(await db.from("orgs").insert({ id: ORG, name: "Loop Co", slug: `loop-${ORG.slice(0, 8)}`, timezone: "UTC" }));
  ok(await db.from("memberships").insert({ org_id: ORG, user_id: await userId(email), role: "owner" }));
  ok(await db.from("vehicles").insert({ id: CAR, org_id: ORG, vin: "7G2CEHED1RA009091", number: "091" }));
  ok(
    await db.from("vehicle_state_current").insert({
      vehicle_id: CAR,
      org_id: ORG,
      status: "in_service",
      status_since: new Date().toISOString(),
      connectivity: "online",
      location: "SRID=4326;POINT(-112.074 33.448)",
    }),
  );
  // Earning history, so the exception carries a baseline rate: 40 available hours, $800 → $20/h.
  ok(
    await db
      .from("vehicle_day_hours")
      .insert(
        [daysAgo(2), daysAgo(1)].map((day) => ({ org_id: ORG, vehicle_id: CAR, day, in_service_h: 12, ready_h: 8 })),
      ),
  );
  ok(
    await db.from("ledger_entries").insert({
      org_id: ORG,
      vehicle_id: CAR,
      occurred_on: daysAgo(1),
      category: "gross_ride_revenue",
      amount_cents: 80_000,
      source: "manual",
      source_ref: "loop-rev",
    }),
  );
  ok(
    await db.from("vendors").insert({
      id: VENDOR,
      org_id: ORG,
      name: "Loop Detailing",
      slug: "loop-detailing",
      categories: ["cleaning"],
      base_location: "SRID=4326;POINT(-112.07 33.448)",
      service_radius_m: 30_000,
      pricing: { cleaning: 4500 },
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

test("detect → prioritise → dispatch → return to service → P&L → report", async ({ page, isMobile }) => {
  test.skip(isMobile, "One pass of the loop; each screen's phone layout has its own spec.");
  test.setTimeout(120_000);

  // 1. Detect: the engine opens a cabin-cleanliness exception on car 091, recommending the best vendor.
  const { error } = await admin().rpc("engine_apply_exceptions", {
    p_org: ORG,
    p_opened: [
      {
        vehicle_id: CAR,
        rule_key: "cabin_cleanliness",
        dedupe_key: `cabin_cleanliness:${CAR}`,
        at: new Date(Date.now() - 2 * 60_000).toISOString(),
        trigger: { alert: "SIM_cabin_cleanliness_event" },
        recommended_action: {
          label: "Dispatch Loop Detailing",
          vendor_id: VENDOR,
          vendor_name: "Loop Detailing",
          eta_min: 9,
          cost_cents: 4500,
        },
      },
    ],
    p_cleared: [],
  });
  expect(error).toBeNull();

  // 2. Prioritise: Overview puts it in the attention queue with money at risk and the one-click action.
  await page.goto("/");
  const queue = page.getByRole("region", { name: "Needs attention" });
  await expect(queue).toContainText("Cabin needs cleaning");
  await expect(queue).toContainText(/\$\d+ at risk/);
  await expect(queue).not.toContainText("$0 at risk");

  // 3. Dispatch from Overview: a ticket opens with the vendor and a running SLA clock.
  await queue.getByRole("button", { name: "Dispatch Loop Detailing" }).click();
  await expect(page).toHaveURL(/\/service\/SVC-\d{4}-0001$/);
  await expect(page.getByText("Loop Detailing").first()).toBeVisible();
  await expect(page.locator("[data-sla]").first()).toHaveText(/min left/);

  // 4. Track and close: arrive, complete with the actual cost, return the car to service.
  await page.getByRole("button", { name: "Mark arrived" }).click();
  await expect(page.getByText("Marked arrived.")).toBeVisible();
  await page.getByLabel("Actual cost ($)").fill("52");
  await page.getByRole("button", { name: "Complete service" }).click();
  await expect(page.getByText("Service completed and cost posted.")).toBeVisible();
  await page.getByRole("button", { name: "Return to service" }).click();
  await expect(page.getByText(/Re-enable car 091 in the Tesla app/)).toBeVisible();

  // The queue is clear and the exception is resolved.
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Needs attention" })).toContainText("Nothing needs attention");
  const { data: ex } = await admin().from("exceptions").select("status").eq("org_id", ORG).single();
  expect(ex?.status).toBe("resolved");

  // 5. P&L: the $52 cleaning is on the car's statement and the fleet's.
  await page.goto("/fleet/091/financials");
  await expect(page.getByRole("main")).toContainText("Cleaning");
  await expect(page.getByRole("main")).toContainText("$52.00");
  await page.goto("/financials");
  const pnl = page.getByRole("region", { name: "Profit and loss" });
  await expect(pnl.getByRole("row", { name: /Cleaning/ })).toContainText("$52.00");

  // 6. Roll up: this month's report counts the ticket and its cost.
  await page.goto("/reports");
  await page.getByLabel("Month", { exact: true }).selectOption(MONTH);
  await page.getByRole("button", { name: "Generate report" }).click();
  await page.waitForURL(/\/reports\/[0-9a-f-]{36}$/);
  const maintenance = page.getByRole("region", { name: "Maintenance" });
  await expect(maintenance).toContainText(/Service tickets\s*1/);
  await expect(maintenance).toContainText("$52");
  await expect(page.getByRole("region", { name: "Vendor performance" })).toContainText("Loop Detailing");
});
