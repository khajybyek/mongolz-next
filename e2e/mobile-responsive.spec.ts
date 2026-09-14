import { test, expect } from "@playwright/test";

const PHONE_VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 393, height: 852 },
  { width: 844, height: 390 },
];

test.describe("Mobile Safari public layout", () => {
  test("landing and login fit portrait and landscape viewports", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-safari", "Mobile Safari layout only");

    for (const viewport of PHONE_VIEWPORTS) {
      await page.setViewportSize(viewport);
      for (const path of ["/", "/login"]) {
        await page.goto(path);
        const size = await page.evaluate(() => ({
          client: document.documentElement.clientWidth,
          scroll: document.documentElement.scrollWidth,
        }));
        expect(size.scroll, `${path} overflows at ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(size.client);
        await expect(page.locator("body")).toBeVisible();
      }
    }
  });
});
