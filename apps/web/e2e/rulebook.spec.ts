import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("rulebook shows the kpis.md worked examples computed by the domain package", async ({ page }) => {
  await page.goto("/design/kpis");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("How FleetOS calculates");
  const main = page.locator("main");
  for (const figure of ["$4,500", "$2,871", "$2,130", "−$127.16", "−$32.10", "−$50.10", "+$8.88"]) {
    await expect(main).toContainText(figure);
  }
  // Car 052: broken down with lost signal → Incident, not Offline (vehicle-states.md §8).
  await expect(page.getByRole("row", { name: /052/ })).toContainText("Incident");
  await expect(page.getByRole("row", { name: /071/ })).toContainText("Ready");
  await expect(page.getByText("Sample data")).toBeVisible();
});

test("rulebook has no WCAG 2.2 AA violations", async ({ page }) => {
  await page.goto("/design/kpis");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});
