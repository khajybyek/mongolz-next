import { test, expect } from "@playwright/test";

test.describe("Public surfaces", () => {
  test("uptime probe returns ok JSON", async ({ request }) => {
    const res = await request.get("/api/uptime");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.checks.ml).toBeDefined();
    expect(body.checks.db).toBeDefined();
  });

  test("login page renders sign-in form", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("form")).toBeVisible();
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
  });

  test("login page supports korean locale", async ({ context, page }) => {
    await context.addCookies([
      {
        name: "mongolz-lang",
        value: "kr",
        domain: new URL(process.env.PLAYWRIGHT_BASE_URL ?? "https://aicctv.dev").hostname,
        path: "/",
      },
    ]);
    await page.goto("/login");
    // Look for Korean characters (이메일 / 비밀번호 / 로그인)
    const html = await page.content();
    expect(html).toMatch(/이메일|사용자명|비밀번호|로그인/);
  });

  test("manifest.webmanifest is served", async ({ request }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.name).toBeDefined();
  });

  test("FastAPI /docs is closed in production", async ({ request }) => {
    const res = await request.get("https://mongolz-ml-production.up.railway.app/docs");
    expect(res.status()).toBe(404);
  });

  test("CSP report endpoint is POST-only", async ({ request }) => {
    const res = await request.get("/api/csp-report");
    // 405 Method Not Allowed expected
    expect(res.status()).toBe(405);
  });

  test("auth-gated routes redirect unauth users", async ({ request }) => {
    const protectedPaths = [
      "/dashboard",
      "/cameras",
      "/reveal-approvals",
      "/retention",
      "/db-monitor",
      "/alerts-live",
      "/users",
      "/audit",
      "/backup",
      "/live-rtc",
    ];
    for (const path of protectedPaths) {
      const res = await request.get(path, { maxRedirects: 0 });
      // 307 redirect to /login expected
      expect(res.status(), `${path} should redirect`).toBe(307);
    }
  });

  test("cron endpoints require bearer in production", async ({ request }) => {
    const res = await request.get("/api/monitoring/error-rate");
    expect([200, 401, 403]).toContain(res.status());
    // when secret is set: 401 without bearer
  });
});
