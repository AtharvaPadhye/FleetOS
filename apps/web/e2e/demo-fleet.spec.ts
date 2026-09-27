import { expect, test } from "@playwright/test";
import { dailyAllocationCents } from "@fleetos/domain";
import { formatCents } from "../src/lib/format";
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

    // Live updates (task 3.8d): the header chip subscribes to the org's private channel, and the next tick's
    // changes arrive without a reload.
    const chip = page.locator("[data-realtime]");
    await expect(chip).toHaveAttribute("data-realtime", "connected", { timeout: 15_000 });
    const before = await chip.getAttribute("data-last-update");
    // Tick until a broadcast lands. Other tests also call the tick, and it skips an org ticked in the last
    // 5 s, so one call isn't guaranteed to produce a new broadcast for this org.
    await expect
      .poll(
        async () => {
          await page.request.post("/api/internal/tick", {
            headers: { Authorization: `Bearer ${process.env.TICK_SECRET}` },
          });
          return chip.getAttribute("data-last-update");
        },
        { timeout: 45_000, intervals: [6_000] },
      )
      .not.toBe(before);
    await expect(chip).toContainText("Live");

    // Costs are booked from day one: today's insurance and financing for all 84 cars (task 3.7).
    await page.goto("/financials");
    const pnl = page.getByRole("region", { name: "Profit and loss" });
    for (const line of ["Ride revenue", "Platform fees", "Electricity", "Contribution", "Insurance", "Financing"])
      await expect(pnl.getByRole("rowheader", { name: line, exact: true })).toBeVisible();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Phoenix" }).format(new Date());
    const day = (monthly: number) => formatCents(-84 * dailyAllocationCents(monthly, today), { decimals: true });
    await expect(pnl.getByRole("row", { name: /Insurance/ })).toContainText(day(48_600)); // $486/month per car
    await expect(pnl.getByRole("row", { name: /Financing/ })).toContainText(day(114_300)); // $1,143/month per car
  });
});

test("the tick endpoint rejects callers without the secret and runs with it", async ({ request }) => {
  expect((await request.post("/api/internal/tick")).status()).toBe(401);
  expect((await request.post("/api/internal/tick", { headers: { Authorization: "Bearer wrong" } })).status()).toBe(401);
  const ok = await request.post("/api/internal/tick", {
    headers: { Authorization: `Bearer ${process.env.TICK_SECRET}` },
  });
  expect(ok.status()).toBe(200);
  expect(await ok.json()).toMatchObject({ ok: true, allocationLines: expect.any(Number) });
});
