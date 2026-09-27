import { defineConfig, devices } from "@playwright/test";

const PORT = 3000;

export default defineConfig({
  testDir: "./e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: process.env.CI ? "pnpm start" : "pnpm build && pnpm start",
    url: `http://localhost:${PORT}/api/health`,
    // Only reuse a running server when asked; a stale server from an older build serves missing CSS.
    reuseExistingServer: !!process.env.PW_REUSE_SERVER,
    timeout: 180_000,
  },
});
