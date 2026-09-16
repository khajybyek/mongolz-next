import { test, expect } from "@playwright/test";
import * as OTPAuth from "otpauth";

const PHONE_VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 393, height: 852 },
  { width: 844, height: 390 },
];

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;
const ADMIN_TOTP_SECRET = process.env.E2E_ADMIN_TOTP_SECRET;

async function expectNoHorizontalOverflow(
  page: import("@playwright/test").Page,
  label: string,
) {
  const size = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(size.scroll, `${label} overflows horizontally`).toBeLessThanOrEqual(size.client);
}

async function loginAdmin(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.fill('input[name="email"]', ADMIN_EMAIL!);
  await page.fill('input[name="password"]', ADMIN_PASSWORD!);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/login\?step=totp/, { timeout: 20_000 });

  const totp = new OTPAuth.TOTP({
    issuer: "MONGOLZ Security",
    secret: OTPAuth.Secret.fromBase32(ADMIN_TOTP_SECRET!),
    algorithm: "SHA1",
    digits: 6,
    period: 30,
  });
  await page.fill('input[name="totp_code"]', totp.generate());
  await page.locator("form").first().locator('button[type="submit"]').click();
  await page.waitForURL(/\/dashboard/, { timeout: 20_000 });
}

test.describe("Mobile Safari public layout", () => {
  test("landing and login fit portrait and landscape viewports", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-safari", "Mobile Safari layout only");

    for (const viewport of PHONE_VIEWPORTS) {
      await page.setViewportSize(viewport);
      for (const path of ["/", "/login"]) {
        await page.goto(path);
        await expectNoHorizontalOverflow(page, `${path} at ${viewport.width}x${viewport.height}`);
        await expect(page.locator("body")).toBeVisible();
      }
    }
  });

  test("authenticated live, playback, navigation and reveal modal fit iPhone Safari", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    test.skip(testInfo.project.name !== "mobile-safari", "Mobile Safari layout only");
    test.skip(
      !ADMIN_EMAIL || !ADMIN_PASSWORD || !ADMIN_TOTP_SECRET,
      "E2E admin credentials and TOTP secret are required",
    );

    await page.setViewportSize({ width: 393, height: 852 });
    await loginAdmin(page);

    for (const viewport of PHONE_VIEWPORTS) {
      await page.setViewportSize(viewport);
      for (const path of ["/dashboard", "/live", "/playback"]) {
        await page.goto(path);
        await expect(page.locator("main")).toBeVisible();
        await expect(page.locator("[data-sidebar]")).toBeHidden();
        await expect(page.locator("[data-mobile-tabbar]")).toBeVisible();
        await expectNoHorizontalOverflow(page, `${path} at ${viewport.width}x${viewport.height}`);
      }

      await page.goto("/live");
      await expect(page.locator("[data-mobile-tabbar]")).toHaveAttribute("data-hydrated", "true");
      const modeButtons = page.locator('button[aria-pressed]');
      await expect(modeButtons).toHaveCount(4);
      for (const button of await modeButtons.all()) {
        // Next streams the loading shell before the client view is laid out.
        // Wait for the actual control instead of measuring its temporary 0px box.
        await expect(button).toBeVisible();
        const box = await button.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return { left: rect.left, right: rect.right, width: rect.width };
        });
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(viewport.width);
        expect(box.width).toBeGreaterThan(0);
      }

      await page.locator("[data-mobile-tabbar] button").last().click();
      const drawer = page.locator('#mobile-navigation[role="dialog"]');
      await expect(drawer).toBeVisible();
      await drawer.evaluate(async (element) => {
        await Promise.all(element.getAnimations().map((animation) => animation.finished));
      });
      const drawerBox = await drawer.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right };
      });
      expect(drawerBox.left).toBeGreaterThanOrEqual(0);
      expect(drawerBox.right).toBeLessThanOrEqual(viewport.width);
      await drawer.locator("button").first().click();
      await expect(drawer).toBeHidden();
    }

    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto("/playback");
    const firstRecording = page.locator('a[href^="/playback/"]').first();
    await expect(firstRecording).toBeVisible();
    await firstRecording.click();
    // The video element may keep the page's load event open while Safari
    // negotiates media; assert the committed route without waiting on media.
    await expect(page).toHaveURL(/\/playback\/[0-9a-f-]+/);
    await expect(page.locator("[data-playback-actions]")).toBeVisible();
    await expectNoHorizontalOverflow(page, "playback detail at 320x568");

    await page.locator("[data-playback-actions] button").last().click();
    const modal = page.locator("[data-reveal-modal]");
    await expect(modal).toBeVisible();
    await expect(modal).toHaveAttribute("aria-modal", "true");
    const modalBox = await modal.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        viewportHeight: window.innerHeight,
      };
    });
    expect(modalBox.left).toBeGreaterThanOrEqual(0);
    expect(modalBox.right).toBeLessThanOrEqual(320);
    expect(modalBox.top).toBeGreaterThanOrEqual(0);
    expect(modalBox.bottom).toBeLessThanOrEqual(modalBox.viewportHeight);
    await expectNoHorizontalOverflow(page, "reveal modal at 320x568");
  });
});
