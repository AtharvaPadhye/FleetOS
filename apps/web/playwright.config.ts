import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Local Supabase URL/keys and the Mailpit inbox (written by `pnpm db:env`).
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const PORT = Number(process.env.PORT ?? 3000); // PORT=3100 runs e2e alongside `pnpm dev`
const AUTH_FILE = "e2e/.auth/user.json";

export default defineConfig({
  testDir: "./e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], storageState: AUTH_FILE },
      dependencies: ["setup"],
    },
    {
      name: "phone",
      use: { ...devices["Pixel 7"], storageState: AUTH_FILE },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    command: `${process.env.CI ? "" : "pnpm build && "}pnpm exec next start --port ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    // Only reuse a running server when asked; a stale server from an older build serves missing CSS.
    reuseExistingServer: !!process.env.PW_REUSE_SERVER,
    timeout: 180_000,
  },
});
