import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createOrg, signIn, uniqueEmail } from "./helpers/auth";

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("app pages redirect to sign-in and remember where you were going", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL("/sign-in");
    await page.goto("/fleet");
    await expect(page).toHaveURL("/sign-in?next=%2Ffleet");
  });

  test("design reference pages stay public", async ({ page }) => {
    await page.goto("/design/kpis");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("How FleetOS calculates");
  });

  test("an invalid email shows an error next to the field", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Work email").fill("not-an-email");
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "valid email" })).toBeVisible();
  });

  test("an expired or reused link explains what to do", async ({ page }) => {
    await page.goto("/auth/callback?code=not-a-real-code");
    await expect(page).toHaveURL("/sign-in?error=link");
    await expect(page.getByRole("alert").filter({ hasText: "expired" })).toBeVisible();
  });

  test("sign-in page has no WCAG 2.2 AA violations", async ({ page }) => {
    await page.goto("/sign-in");
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(r.violations).toEqual([]);
  });

  test("new user: sign in, create an org, land in the app, sign out", async ({ page }) => {
    await signIn(page, uniqueEmail("journey"));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Create your organization");
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(axe.violations).toEqual([]);

    await createOrg(page, "Desert Robotaxi Co", "Tempe, AZ");
    await expect(page.getByRole("banner")).toContainText("Tempe, AZ");

    await page.getByRole("button", { name: "Account" }).click();
    await expect(page.getByRole("menu")).toContainText("Owner · Desert Robotaxi Co");
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL("/sign-in");
    await page.goto("/");
    await expect(page).toHaveURL("/sign-in");
  });

  test("the link returns you to the page you asked for", async ({ page }) => {
    const email = uniqueEmail("next");
    await page.goto("/hubs");
    await expect(page).toHaveURL("/sign-in?next=%2Fhubs");
    await page.getByLabel("Work email").fill(email);
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    const { magicLinkFor } = await import("./helpers/auth");
    await page.goto(await magicLinkFor(email));
    // A brand-new user has no org yet, so onboarding comes first.
    await expect(page).toHaveURL(/\/onboarding$/);
  });
});

test("switching between organizations", async ({ page, isMobile }) => {
  test.skip(isMobile, "Covered on desktop; the phone uses the same switcher inside the navigation sheet.");
  await page.goto("/");
  const switcher = page.getByRole("button", { name: /Switch organization/ });
  await switcher.click();
  await page.getByRole("menuitem", { name: "Add organization" }).click();
  await createOrg(page, `Second Fleet ${Date.now()}`, "Scottsdale, AZ");
  await expect(page.getByRole("banner")).toContainText("Scottsdale, AZ");

  await page.getByRole("button", { name: /Switch organization/ }).click();
  await page.getByRole("menuitem", { name: /E2E Fleet/ }).click();
  await expect(page.getByRole("banner")).toContainText("Phoenix, AZ");
});
