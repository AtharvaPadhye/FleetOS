import { expect, test, type Page } from "@playwright/test";
import { admin, sessionCookies, userId } from "./helpers/api";
import { uniqueEmail } from "./helpers/auth";

/**
 * Content-Security-Policy and request ids (task 2.6, NFR SEC-5 / OBS-2). The suite runs the production build,
 * so every page here is loaded under the real policy; any blocked script, style, image, worker or connection
 * shows up as a `securitypolicyviolation` event and fails the test.
 */

test.skip(({ isMobile }) => isMobile, "Headers and policy don't depend on the viewport.");

/** Records CSP violations on the page (Playwright init scripts aren't subject to the page's CSP). */
async function watchViolations(page: Page) {
  const violations: string[] = [];
  await page.exposeFunction("__cspViolation", (v: string) => violations.push(v));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) =>
      (window as unknown as { __cspViolation: (v: string) => void }).__cspViolation(
        `${e.effectiveDirective} blocked ${e.blockedURI || "inline"} on ${location.pathname}`,
      ),
    );
  });
  page.on("console", (m) => {
    if (m.type() === "error" && /Content Security Policy/i.test(m.text())) violations.push(m.text());
  });
  return violations;
}

const directive = (csp: string, name: string) =>
  csp
    .split("; ")
    .find((d) => d.startsWith(`${name} `))
    ?.split(" ")
    .slice(1) ?? [];

test("pages carry a per-request nonce policy and a request id", async ({ page }) => {
  const first = await page.goto("/fleet");
  const second = await page.request.get("/fleet");
  const csp = first!.headers()["content-security-policy"]!;
  const script = directive(csp, "script-src");
  expect(script).toContain("'strict-dynamic'");
  expect(script).not.toContain("'unsafe-inline'");
  expect(script).not.toContain("'unsafe-eval'");
  expect(directive(csp, "frame-ancestors")).toEqual(["'none'"]);
  // A fresh nonce every response.
  const nonce = (c: string) => c.match(/'nonce-([^']+)'/)?.[1];
  expect(nonce(csp)).toBeTruthy();
  expect(nonce(second.headers()["content-security-policy"]!)).not.toBe(nonce(csp));
  // Next puts that nonce on its scripts.
  expect(await page.locator(`script[nonce]`).count()).toBeGreaterThan(0);
  expect(first!.headers()["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
});

test("an incoming request id is kept end to end through the API", async ({ request }) => {
  const res = await request.get("/api/v1/me", { headers: { "x-request-id": "trace-e2e-123" } });
  expect(res.headers()["x-request-id"]).toBe("trace-e2e-123");
  expect(res.headers()["content-security-policy"]).toBeUndefined();
});

test.describe("an org with a located car", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  const ORG = crypto.randomUUID();
  const HUB = crypto.randomUUID();
  const CAR = crypto.randomUUID();
  const email = uniqueEmail("csp");
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
        .insert({ id: ORG, name: "CSP Co", slug: `csp-${ORG.slice(0, 8)}`, timezone: "UTC", is_demo: false }),
    );
    ok(await db.from("memberships").insert({ org_id: ORG, user_id: await userId(email), role: "owner" }));
    ok(
      await db
        .from("hubs")
        .insert({ id: HUB, org_id: ORG, name: "Depot CSP", location: "SRID=4326;POINT(-112.07 33.45)", radius_m: 200 }),
    );
    ok(
      await db
        .from("vehicles")
        .insert({ id: CAR, org_id: ORG, vin: "7G2CEHED9RA004047", number: "047", home_hub_id: HUB }),
    );
    ok(
      await db.from("vehicle_state_current").insert({
        vehicle_id: CAR,
        org_id: ORG,
        status: "in_service",
        status_since: new Date().toISOString(),
        soc: 0.6,
        connectivity: "online",
        last_telemetry_at: new Date().toISOString(),
        location: "SRID=4326;POINT(-112.05 33.44)",
      }),
    );
    cookies = await sessionCookies(browser, email);
  });
  test.afterAll(async () => {
    await admin().from("orgs").delete().eq("id", ORG);
  });

  test("the app runs under the policy with no violations, map included", async ({ page, context }) => {
    await context.addCookies(cookies);
    const violations = await watchViolations(page);
    for (const path of ["/", "/fleet", "/hubs", "/service", "/financials", "/reports", "/settings", "/design"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
    // The vehicle page draws the MapLibre map: its worker, style, tiles and glyphs must all be allowed.
    await page.goto("/fleet/047");
    await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("The map couldn't load")).toHaveCount(0);
    expect(violations).toEqual([]);
  });
});

test("the API reference loads Scalar under its own nonce policy", async ({ page }) => {
  const violations = await watchViolations(page);
  const res = await page.goto("/docs/api");
  const csp = res!.headers()["content-security-policy"]!;
  expect(directive(csp, "script-src")).toContain("https://cdn.jsdelivr.net");
  expect(directive(csp, "script-src")).not.toContain("'unsafe-inline'");
  // Scalar rendered the spec (its bundle loaded from the CDN under the nonce) with no third-party fonts.
  await expect(page.getByRole("heading", { name: "FleetOS API", exact: true })).toBeVisible({ timeout: 20_000 });
  // Scalar's bundle probes for eval once; it stays blocked and the page works (app/docs/api/route.ts).
  expect(violations.filter((v) => v !== "script-src blocked eval on /docs/api")).toEqual([]);
  expect(directive(csp, "script-src")).not.toContain("'unsafe-eval'");
  expect(directive(csp, "report-uri")).toEqual([]);
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test("sign-in runs under the policy, and redirects carry it too", async ({ page, request }) => {
    const violations = await watchViolations(page);
    const redirect = await request.get("/fleet", { maxRedirects: 0 });
    expect(redirect.status()).toBe(307);
    expect(redirect.headers()["content-security-policy"]).toContain("'strict-dynamic'");
    expect(redirect.headers()["x-request-id"]).toBeTruthy();
    await page.goto("/sign-in");
    await expect(page.getByLabel("Email")).toBeVisible();
    expect(violations).toEqual([]);
  });
});
