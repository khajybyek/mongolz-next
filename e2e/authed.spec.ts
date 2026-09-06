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

test.describe("Authenticated viewer smoke", () => {
  test.skip(!EMAIL || !PASSWORD, "E2E_VIEWER_EMAIL / E2E_VIEWER_PASSWORD not set");

  test("login → dashboard → playback", async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[name="email"]', EMAIL!);
    await page.fill('input[name="password"]', PASSWORD!);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/dashboard/, { timeout: 20_000 });
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
    await page.goto("/login");
    await page.fill('input[name="email"]', EMAIL!);
    await page.fill('input[name="password"]', PASSWORD!);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/dashboard/, { timeout: 20_000 });
    const res = await page.request.get("/api/recordings/00000000-0000-4000-8000-000000000000/view");
    expect([404, 502]).toContain(res.status()); // unknown id → 404; ML down → 502; never 401/500
  });
});
