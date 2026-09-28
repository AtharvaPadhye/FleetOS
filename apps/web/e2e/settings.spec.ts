import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { admin, sessionCookies, userId, userToken } from "./helpers/api";
import { uniqueEmail } from "./helpers/auth";

/** Settings (task 5.10): org targets, policies, SLA targets, rules editor with a 24-hour test, invites, API. */
test.describe.configure({ mode: "serial" });
test.use({ storageState: { cookies: [], origins: [] } });

const ORG = crypto.randomUUID();
const email = uniqueEmail("settings");
const invitee = uniqueEmail("invitee");
let cookies: Awaited<ReturnType<typeof sessionCookies>> = [];
let inviteeCookies: Awaited<ReturnType<typeof sessionCookies>> = [];

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
      .insert({ id: ORG, name: "Settings UI Co", slug: `set-ui-${ORG.slice(0, 8)}`, timezone: "UTC" }),
  );
  ok(await db.from("memberships").insert({ org_id: ORG, user_id: await userId(email), role: "owner" }));
  cookies = await sessionCookies(browser, email);
  inviteeCookies = await sessionCookies(browser, invitee);
});

test.afterAll(async () => {
  await admin().from("orgs").delete().eq("id", ORG);
});

test("organization targets save and are audited", async ({ page, context, isMobile }) => {
  test.skip(isMobile, "Form flows on desktop; tabs are checked for accessibility on both.");
  await context.addCookies(cookies);
  await page.goto("/settings");
  await page.getByLabel("Availability target (%)").fill("95");
  await page.getByLabel("Maintenance reserve per car ($/month)").fill("120");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  const { data } = await admin()
    .from("orgs")
    .select("availability_target, maintenance_reserve_monthly_cents")
    .eq("id", ORG)
    .single();
  expect(data).toMatchObject({ availability_target: 0.95, maintenance_reserve_monthly_cents: 12_000 });
  const { data: audit } = await admin().from("audit_log").select("action").eq("org_id", ORG).eq("action", "org.update");
  expect(audit?.length).toBeGreaterThan(0);
  await axe(page);
});

test("policies and SLA targets", async ({ page, context, isMobile }) => {
  test.skip(isMobile, "Form flows on desktop.");
  await context.addCookies(cookies);
  await page.goto("/settings/rules");
  await page.getByLabel("Charge target CHG-TARGET").fill("85");
  await page.getByRole("checkbox", { name: /Dispatch the recommended vendor automatically/ }).check();
  await page.getByLabel("After").fill("7");
  await page.getByRole("button", { name: "Save policies" }).click();
  await expect(page.getByText("Policies saved.")).toBeVisible();
  const { data } = await admin().from("orgs").select("charge_target, auto_dispatch_after_min").eq("id", ORG).single();
  expect(data).toMatchObject({ charge_target: 0.85, auto_dispatch_after_min: 7 });

  await page.goto("/settings/service");
  await page.getByLabel("Cleaning resolution minutes").fill("45");
  await page.getByRole("button", { name: "Save SLA targets" }).click();
  await expect(page.getByText(/SLA targets saved/)).toBeVisible();
  await page.getByLabel("Cleaning response minutes").fill("90");
  await page.getByRole("button", { name: "Save SLA targets" }).click();
  await expect(page.getByText(/can't be longer than its resolution target/)).toBeVisible();
});

test("add a rule, test it against the last 24 h, then turn a system rule off", async ({ page, context, isMobile }) => {
  test.skip(isMobile, "Dialog flow on desktop.");
  await context.addCookies(cookies);
  await page.goto("/settings/rules");
  await page.getByRole("button", { name: "Add rule" }).click();
  const d = page.getByRole("dialog", { name: "Add an exception rule" });
  await d.getByLabel("Name").fill("Hot cabin");
  await d.getByLabel(/^Key/).fill("hot_cabin");
  await d.getByLabel("Fact").selectOption("speed_mph");
  await d.getByLabel("Test").selectOption("gt");
  await d.getByLabel("Value").fill("90");
  await d.getByRole("button", { name: "Test against the last 24 h" }).click();
  await expect(d.getByText(/Would not have opened any exceptions|Would have opened/)).toBeVisible();
  await d.getByRole("button", { name: "Add rule" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Hot cabin" })).toContainText("When Speed > 90 mph");
  const stationary = page.getByRole("listitem").filter({ hasText: "Stopped outside a hub" });
  await stationary.getByRole("switch", { name: "Stopped outside a hub enabled" }).uncheck();
  await expect(stationary.getByText("Off")).toBeVisible();
  // The switch flips at once; the save lands a moment later.
  await expect
    .poll(async () => {
      const { data } = await admin()
        .from("exception_rules")
        .select("enabled")
        .eq("org_id", ORG)
        .eq("key", "stationary_outside_hub")
        .single();
      return data?.enabled;
    })
    .toBe(false);
  await axe(page);
});

test("invite someone by email; they accept from the link and join with that role", async ({
  page,
  context,
  browser,
  isMobile,
}) => {
  test.skip(isMobile, "One invite per fixture.");
  await context.addCookies(cookies);
  await page.goto("/settings/members");
  await page.getByLabel("Email").fill(invitee);
  await page.getByLabel("Role").selectOption("finance");
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText(`Invitation sent to ${invitee}.`)).toBeVisible();
  const link = await page.getByLabel("Invitation link").inputValue();
  expect(link).toMatch(/\/invite\/[0-9a-f]{48}$/);
  // The email arrived (Mailpit locally and in CI).
  const mail = await (
    await fetch(
      `${process.env.MAILPIT_URL ?? "http://127.0.0.1:54324"}/api/v1/search?query=${encodeURIComponent(`to:${invitee}`)}`,
    )
  ).json();
  expect(mail.messages[0].Subject).toBe("You're invited to Settings UI Co on FleetOS");
  await page.reload();
  await expect(page.getByRole("region", { name: "Pending invitations" })).toContainText(invitee);

  const other = await browser.newContext();
  await other.addCookies(inviteeCookies);
  const p2 = await other.newPage();
  await p2.goto(new URL(link).pathname);
  await p2.getByRole("button", { name: "Accept invitation" }).click();
  await expect(p2).toHaveURL(/\/$/);
  await expect(p2.getByRole("button", { name: /Switch organization/ })).toContainText("Settings UI Co");
  await other.close();
  const { data } = await admin()
    .from("memberships")
    .select("role")
    .eq("org_id", ORG)
    .eq("user_id", await userId(invitee))
    .single();
  expect(data?.role).toBe("finance");
});

test("tabs work on a phone and data sources name every capability", async ({ page, context, isMobile }) => {
  test.skip(!isMobile, "Phone layout.");
  await context.addCookies(cookies);
  await page.goto("/settings/data");
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(10); // header + 9 capabilities
  await expect(page.getByRole("table")).toContainText("Not connected");
  await axe(page);
});

test("API: org, members, policies and SLA targets with roles", async ({ request }) => {
  const viewer = await userToken("set-viewer");
  const owner = await userToken("set-owner");
  await admin()
    .from("memberships")
    .insert([
      { org_id: ORG, user_id: viewer.id, role: "viewer" },
      { org_id: ORG, user_id: owner.id, role: "owner" },
    ]);
  const as = (t: string) => ({ Authorization: `Bearer ${t}`, "X-FleetOS-Org": ORG });
  expect(
    (await request.patch("/api/v1/orgs/current", { headers: as(viewer.token), data: { name: "Nope" } })).status(),
  ).toBe(403);
  const bad = await request.patch("/api/v1/orgs/current", {
    headers: as(owner.token),
    data: { timezone: "Mars/Olympus" },
  });
  expect(bad.status()).toBe(422);
  const org = await (
    await request.patch("/api/v1/orgs/current", { headers: as(owner.token), data: { low_soc_threshold: 0.35 } })
  ).json();
  expect(org.low_soc_threshold).toBe(0.35);
  const members = await (await request.get("/api/v1/members", { headers: as(viewer.token) })).json();
  expect(members.map((m: { role: string }) => m.role)).toContain("viewer");
  const policies = await (await request.get("/api/v1/policies", { headers: as(viewer.token) })).json();
  expect(policies.find((p: { key: string }) => p.key === "MIN-SOC").config.soc).toBe(0.35);
  const off = await (
    await request.put("/api/v1/policies", {
      headers: as(owner.token),
      data: [{ key: "AUTO-DISPATCH", enabled: false }],
    })
  ).json();
  expect(off.find((p: { key: string }) => p.key === "AUTO-DISPATCH").enabled).toBe(false);
  const sla = await (await request.get("/api/v1/sla-policies", { headers: as(viewer.token) })).json();
  expect(sla).toHaveLength(5);
  const inv = await request.post("/api/v1/invitations", {
    headers: as(owner.token),
    data: { email: uniqueEmail("api-inv"), role: "ops" },
  });
  expect(inv.status()).toBe(201);
  const { id } = await inv.json();
  expect((await request.delete(`/api/v1/invitations/${id}`, { headers: as(owner.token) })).status()).toBe(204);
});
