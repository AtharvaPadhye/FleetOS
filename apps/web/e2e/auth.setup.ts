import { expect, test as setup } from "@playwright/test";
import { createOrg, signIn, uniqueEmail } from "./helpers/auth";

export const AUTH_FILE = "e2e/.auth/user.json";

setup("sign in with a magic link and create an organization", async ({ page }) => {
  await signIn(page, uniqueEmail("setup"));
  await createOrg(page, "E2E Fleet", "Phoenix, AZ");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Overview");
  await page.context().storageState({ path: AUTH_FILE });
});
