import { expect, test } from "@playwright/test";
import { signIn, uniqueEmail } from "./helpers/auth";

test.describe("demo fleet", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a new user can explore with 84 simulated Cybercabs that go live immediately", async ({ page, isMobile }) => {
    test.skip(isMobile, "One run is enough; the flow is identical on phones.");
    await signIn(page, uniqueEmail("demo"));
    await expect(page).toHaveURL(/\/onboarding$/);
    await page.getByRole("button", { name: "Explore with a demo fleet" }).click();
    await expect(page).toHaveURL("/", { timeout: 60_000 });
    await expect(page.getByRole("banner")).toContainText("Live");
    await expect(page.getByRole("banner")).toContainText("Phoenix, AZ");
    const switcher = page.getByRole("button", { name: /Switch organization/ });
    await expect(switcher).toContainText("Atlas Mobility (demo)");
    await expect(switcher).toContainText("Simulated");
  });
});

test("the tick endpoint rejects callers without the secret and runs with it", async ({ request }) => {
  expect((await request.post("/api/internal/tick")).status()).toBe(401);
  expect((await request.post("/api/internal/tick", { headers: { Authorization: "Bearer wrong" } })).status()).toBe(401);
  const ok = await request.post("/api/internal/tick", {
    headers: { Authorization: `Bearer ${process.env.TICK_SECRET}` },
  });
  expect(ok.status()).toBe(200);
  expect(await ok.json()).toMatchObject({ ok: true });
});
