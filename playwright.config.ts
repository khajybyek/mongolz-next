import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E config — points by default at production
 * (https://aicctv.dev). Override with PLAYWRIGHT_BASE_URL.
 *
 * Run:
 *   npx playwright install   # first time
 *   npx playwright test
 *   npx playwright test --ui # interactive
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? "github" : "list",
  timeout: 45_000,

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "https://aicctv.dev",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
  },

  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-safari",
      use: { ...devices["iPhone 14 Pro"] },
    },
  ],
});
