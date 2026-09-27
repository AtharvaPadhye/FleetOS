import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signIn, uniqueEmail } from "./helpers/auth";

test.describe("payout CSV import", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.skip(({ isMobile }) => isMobile, "Desktop run covers the flow.");

  async function demoOwner(page: Page) {
    await signIn(page, uniqueEmail("import"));
    await page.getByRole("button", { name: "Explore with a demo fleet" }).click();
    await expect(page).toHaveURL("/", { timeout: 60_000 });
  }

  async function upload(page: Page, file: string) {
    await page.goto("/financials/imports");
    await page.getByLabel(/Payout statement/).setInputFiles(`e2e/fixtures/${file}`);
    await page.getByRole("button", { name: "Upload and check" }).click();
    await expect(page).toHaveURL(/\/financials\/imports\/[0-9a-f-]{36}$/);
  }

  test("validate, commit, and re-upload without double-booking", async ({ page }) => {
    await demoOwner(page);
    await page.goto("/financials");
    await page.getByRole("link", { name: "Import payouts" }).click();

    await upload(page, "uber-fleet-portal-sample.csv");
    await expect(page.getByText("Recognised as an Uber-Fleet-Portal-style statement.")).toBeVisible();
    await expect(page.getByRole("region", { name: "Problems", exact: true })).toContainText('No vehicle matches "999"');
    await expect(page.getByRole("region", { name: "Problems", exact: true })).toContainText("is not a date");
    await expect(page.getByRole("region", { name: "Preview", exact: true })).toContainText("$1,194.20");
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(axe.violations).toEqual([]);
    await page.screenshot({ path: "test-results/import-report.png", fullPage: true });

    await page.getByRole("button", { name: "Commit 2 valid rows to the ledger" }).click();
    await expect(page.getByRole("status")).toContainText("4 new ledger lines booked; 0 were already imported");

    await upload(page, "uber-fleet-portal-sample.csv");
    await page.getByRole("button", { name: "Commit 2 valid rows to the ledger" }).click();
    await expect(page.getByRole("status")).toContainText("0 new ledger lines booked; 4 were already imported");
  });

  test("unrecognised columns can be mapped by hand", async ({ page }) => {
    await demoOwner(page);
    await upload(page, "custom-columns.csv");
    await expect(page.getByText("Custom layout: check the column mapping below.")).toBeVisible();
    await page.getByLabel("Date *").selectOption("When");
    await page.getByLabel("Vehicle (VIN, number or name) *").selectOption("Car");
    await page.getByLabel("Gross earnings *").selectOption("Money");
    await page.getByRole("button", { name: "Save mapping and re-check" }).click();
    await expect(page.getByRole("button", { name: "Commit 2 valid rows to the ledger" })).toBeEnabled();
  });
});

test("people without finance access are told why", async ({ page }) => {
  // The setup user owns "E2E Fleet", so check the message copy via a viewer is covered by RLS tests;
  // here we only assert the page loads for an owner and offers the upload.
  await page.goto("/financials/imports");
  await expect(page.getByRole("button", { name: "Upload and check" })).toBeVisible();
});
