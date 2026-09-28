import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { admin, sessionCookies, userId, userToken } from "./helpers/api";
import { uniqueEmail } from "./helpers/auth";

/** Notifications (task 5.11): the bell live, preferences, test sends, email through the outbox, API. */
test.describe.configure({ mode: "serial" });
test.use({ storageState: { cookies: [], origins: [] } });

const ORG = crypto.randomUUID();
const CAR = crypto.randomUUID();
const email = uniqueEmail("notify");
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
let cookies: Awaited<ReturnType<typeof sessionCookies>> = [];

const openException = (rule: string, severity: string) =>
  admin().rpc("engine_apply_exceptions", {
    p_org: ORG,
    p_opened: [
      {
        vehicle_id: CAR,
        rule_key: rule,
        dedupe_key: `${rule}:${CAR}:${severity}:${Math.random()}`,
        at: new Date().toISOString(),
        trigger: {},
        recommended_action: { label: "Investigate" },
      },
    ],
    p_cleared: [],
  });

test.beforeAll(async ({ browser }) => {
  const db = admin();
  const ok = (r: { error: { message: string } | null }) => {
    if (r.error) throw new Error(r.error.message);
  };
  await db.auth.admin.createUser({ email, email_confirm: true });
  ok(await db.from("orgs").insert({ id: ORG, name: "Notify Co", slug: `notify-${ORG.slice(0, 8)}`, timezone: "UTC" }));
  ok(await db.from("memberships").insert({ org_id: ORG, user_id: await userId(email), role: "owner" }));
  ok(await db.from("vehicles").insert({ id: CAR, org_id: ORG, vin: "7G2CEHED7RA009301", number: "301" }));
  cookies = await sessionCookies(browser, email);
});

test.afterAll(async () => {
  await admin().from("orgs").delete().eq("id", ORG);
});

test.beforeEach(async ({ context }) => {
  await context.addCookies(cookies);
});

test("a new high-severity exception reaches the bell live; mark all read clears it", async ({ page, isMobile }) => {
  test.skip(isMobile, "One realtime run per fixture.");
  await page.goto("/");
  const bell = page.getByRole("button", { name: /^Notifications/ });
  await expect(bell).toHaveAccessibleName("Notifications");
  await page.waitForTimeout(1500); // let the private channel subscribe
  expect((await openException("drive_fault", "high")).error).toBeNull();
  await expect(bell).toHaveAccessibleName("Notifications, 1 unread", { timeout: 15_000 });
  await bell.click();
  await expect(page.getByRole("link", { name: /Car 301: Drive or battery fault/ })).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  await page.getByRole("button", { name: "Mark all read" }).click();
  await expect(bell).toHaveAccessibleName("Notifications");
});

test("a critical exception is emailed (default preference) through the outbox", async ({ request }) => {
  expect((await openException("vehicle_immobilized", "critical")).error).toBeNull();
  // The tick drains the outbox.
  const tick = await request.post(`/api/internal/tick?org=${crypto.randomUUID()}`, {
    headers: { Authorization: `Bearer ${process.env.TICK_SECRET}` },
  });
  expect((await tick.json()).notifications.sent).toBeGreaterThanOrEqual(1);
  const mail = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json();
  expect(mail.messages.map((m: { Subject: string }) => m.Subject)).toContain("Car 301: Vehicle immobilized");
});

test("preferences matrix, test notification, and Slack webhook validation", async ({ page, isMobile }) => {
  test.skip(isMobile, "Form flow on desktop.");
  await page.goto("/settings/notifications");
  await page.getByRole("checkbox", { name: "medium In the app" }).check();
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await page.getByRole("button", { name: "Send test" }).click();
  await expect(page.getByText(/Test sent/)).toBeVisible();
  await page.getByLabel("Incoming webhook URL").fill("https://example.com/not-slack");
  await page.getByRole("button", { name: "Connect Slack" }).click();
  await expect(page.getByText(/Paste a Slack incoming webhook URL/)).toBeVisible();
  await page.getByLabel("Incoming webhook URL").fill("https://hooks.slack.com/services/T000/B000/XXXX");
  await page.getByRole("button", { name: "Connect Slack" }).click();
  await expect(page.getByText("Slack settings saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("columnheader", { name: "Slack (whole org)" })).toBeVisible();
  await page.goto("/");
  await page.getByRole("button", { name: /^Notifications/ }).click();
  await expect(page.getByRole("link", { name: /Test notification/ })).toBeVisible();
});

test("API: list, mark read, settings; only admins change Slack", async ({ request }) => {
  const viewer = await userToken("notify-viewer");
  await admin().from("memberships").insert({ org_id: ORG, user_id: viewer.id, role: "viewer" });
  const outsider = { Authorization: `Bearer ${(await userToken("notify-outsider")).token}`, "X-FleetOS-Org": ORG };
  const v = { Authorization: `Bearer ${viewer.token}`, "X-FleetOS-Org": ORG };
  expect((await request.get("/api/v1/notifications", { headers: v })).status()).toBe(200);
  const s = await (await request.get("/api/v1/notifications/settings", { headers: v })).json();
  expect(s.by_severity.critical).toMatchObject({ in_app: true, email: true });
  const saved = await (
    await request.put("/api/v1/notifications/settings", {
      headers: v,
      data: { by_severity: { low: { in_app: true } } },
    })
  ).json();
  expect(saved.by_severity.low.in_app).toBe(true);
  const denied = await request.put("/api/v1/notifications/settings", {
    headers: v,
    data: { by_severity: { low: { slack: !s.by_severity.low.slack } } },
  });
  expect(denied.status()).toBe(403);
  expect((await request.post("/api/v1/notifications/read", { headers: v, data: { all: true } })).status()).toBe(204);
  expect((await request.post("/api/v1/notifications/read", { headers: v, data: {} })).status()).toBe(422);
  // An org you aren't a member of doesn't exist for you.
  expect((await request.get("/api/v1/notifications", { headers: outsider })).status()).toBe(404);
});
