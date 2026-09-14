import { test, expect } from "@playwright/test";

/**
 * Authenticated smoke — runs only when viewer credentials are provided:
 *
 *   E2E_VIEWER_EMAIL=viewer@… E2E_VIEWER_PASSWORD=… npx playwright test e2e/authed.spec.ts
 *
 * Uses the viewer role on purpose: admins require TOTP, which a CI runner
 * cannot produce. Covers login → dashboard → playback list → an on-demand
 * view request being auth-gated but reachable (no 5xx).
 */
const EMAIL = process.env.E2E_VIEWER_EMAIL;
const PASSWORD = process.env.E2E_VIEWER_PASSWORD;

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.fill('input[name="email"]', EMAIL!);
  await page.fill('input[name="password"]', PASSWORD!);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/dashboard/, { timeout: 20_000 });
}

test.describe("Authenticated viewer smoke", () => {
  test.skip(!EMAIL || !PASSWORD, "E2E_VIEWER_EMAIL / E2E_VIEWER_PASSWORD not set");

  test("login → dashboard → playback", async ({ page }) => {
    await login(page);
    await expect(page.locator("main")).toBeVisible();

    await page.goto("/playback");
    await expect(page).toHaveURL(/\/playback/);
    // Either recordings are listed or the empty state renders — never a crash.
    const body = await page.textContent("body");
    expect(body?.length ?? 0).toBeGreaterThan(50);

    // Admin-only surfaces bounce a viewer to the dashboard with a reason.
    await page.goto("/users");
    await page.waitForURL(/\/dashboard\?error=admin-only/, { timeout: 20_000 });
  });

  test("on-demand view route is reachable for a viewer (no 5xx)", async ({ page }) => {
    await login(page);
    const res = await page.request.get("/api/recordings/00000000-0000-4000-8000-000000000000/view");
    // Unknown IDs must be rejected before ML dispatch. An upstream outage is
    // a regression here, never a permitted outcome of this smoke check.
    expect(res.status()).toBe(404);
  });

  test("iPhone landscape keeps the mobile shell and clears the tab bar while typing", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-safari", "Mobile Safari layout only");

    await page.setViewportSize({ width: 844, height: 390 });
    await login(page);

    const tabbar = page.locator("[data-mobile-tabbar]");
    await expect(page.locator("[data-sidebar]")).toBeHidden();
    await expect(tabbar).toBeVisible();
    const width = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(width.scroll).toBeLessThanOrEqual(width.client);

    await page.keyboard.press("Meta+K");
    const commandInput = page.locator('[role="combobox"]');
    await expect(commandInput).toBeFocused();
    await expect(tabbar).toHaveAttribute("data-editing", "true");
    await expect(tabbar).toHaveCSS("pointer-events", "none");

    // Tapping the palette close control matches the iPhone interaction and
    // transfers focus away from the software-keyboard input before unmount.
    await page.locator('[role="dialog"] button').first().click();
    await expect(page.locator('[role="dialog"]')).toBeHidden();
    await expect(tabbar).toHaveAttribute("data-editing", "false");
  });
});
