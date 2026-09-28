import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const SECTIONS = [
  { label: "Overview", path: "/" },
  { label: "Fleet", path: "/fleet" },
  { label: "Exceptions", path: "/exceptions" },
  { label: "Service", path: "/service" },
  { label: "Hubs", path: "/hubs" },
  { label: "Vendors", path: "/vendors" },
  { label: "Financials", path: "/financials" },
  { label: "Reports", path: "/reports" },
  { label: "Settings", path: "/settings" },
];

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 1024;

async function openNav(page: Page) {
  if (isPhone(page)) {
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.getByRole("dialog", { name: "Navigation" })).toBeVisible();
  }
  return page.getByRole("navigation", { name: "Main" }).last();
}

test("every section is reachable from the navigation and marked current", async ({ page }) => {
  await page.goto("/");
  for (const s of SECTIONS) {
    const nav = await openNav(page);
    await nav.getByRole("link", { name: s.label, exact: true }).click();
    await expect(page).toHaveURL(s.path);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(s.label);
    const current = await openNav(page);
    await expect(current.getByRole("link", { name: s.label, exact: true })).toHaveAttribute("aria-current", "page");
    if (isPhone(page)) await page.keyboard.press("Escape");
  }
});

test("⌘K / Ctrl+K opens the menu and navigates", async ({ page }) => {
  await page.goto("/");
  await page.locator("body").press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog", { name: "Search FleetOS" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("combobox").fill("depot");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/hubs");
  await expect(dialog).toBeHidden();
});

test("the search button opens the same menu; Escape closes it", async ({ page }) => {
  await page.goto("/fleet");
  await page.getByRole("button", { name: /Search or ask/ }).click();
  await expect(page.getByRole("dialog", { name: "Search FleetOS" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Search FleetOS" })).toBeHidden();
});

test("skip link moves focus to the main content", async ({ page }) => {
  await page.goto("/reports");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to main content" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
});

test("placeholders never show fake numbers", async ({ page }) => {
  for (const s of SECTIONS.filter(
    (x) => !["/", "/financials", "/fleet", "/vendors", "/exceptions", "/service", "/hubs"].includes(x.path),
  )) {
    await page.goto(s.path);
    await expect(page.getByText("is being built")).toBeVisible();
    await expect(page.locator("main")).not.toContainText("$");
  }
});

test("Overview names missing revenue and an empty queue instead of showing $0", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Awaiting revenue data")).toBeVisible();
  await expect(page.getByText(/Nothing needs attention/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Finish setting up" })).toBeVisible();
});

test("Financials names an empty ledger instead of showing $0", async ({ page }) => {
  await page.goto("/financials");
  await expect(page.getByText("Nothing booked this month yet")).toBeVisible();
  await expect(page.locator("main")).not.toContainText("$");
});

for (const s of SECTIONS) {
  test(`${s.label} has no WCAG 2.2 AA violations`, async ({ page }) => {
    await page.goto(s.path);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });
}

test("menu dialog has no WCAG 2.2 AA violations", async ({ page }) => {
  await page.goto("/");
  await page.locator("body").press("ControlOrMeta+k");
  await expect(page.getByRole("dialog", { name: "Search FleetOS" })).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
  expect(results.violations).toEqual([]);
});
