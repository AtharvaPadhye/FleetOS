import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("design system page renders tokens and components", async ({ page }) => {
  await page.goto("/design");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Operations control tower");
  await expect(page.getByRole("button", { name: "Dispatch cleaner" })).toBeVisible();
  await expect(page.getByText("Simulated").first()).toBeVisible();
});

test("design system page has no WCAG 2.2 AA violations", async ({ page }) => {
  await page.goto("/design");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("health endpoint and security headers", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBe(true);
  expect(await res.json()).toMatchObject({ status: "ok" });
  expect(res.headers()["x-frame-options"]).toBe("DENY");
  expect(res.headers()["x-powered-by"]).toBeUndefined();
});

test("primary button text is readable (computed contrast ≥ 4.5:1)", async ({ page }) => {
  await page.goto("/design");
  const ratio = await page.getByRole("button", { name: "Dispatch cleaner" }).evaluate((el) => {
    const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
    };
    const cs = getComputedStyle(el);
    const [a, b] = [lum(parse(cs.color)), lum(parse(cs.backgroundColor))].sort((x, y) => y - x);
    return (a! + 0.05) / (b! + 0.05);
  });
  expect(ratio).toBeGreaterThanOrEqual(4.5);
});
