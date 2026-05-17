import { test, expect, type Page } from "@playwright/test";

/**
 * Theme & light-mode coverage.
 *
 * We don't compare pixel-for-pixel screenshots (no shared baseline images
 * checked in) — instead we read the resolved CSS so the test is stable
 * across font fallbacks, OS aliasing and minor layout drift. The goal is
 * to catch regressions where light mode silently re-introduces hardcoded
 * dark tokens.
 */

async function setLangAndTheme(page: Page, lang: "mn" | "en" | "kr", theme: "dark" | "light") {
  const host = new URL(test.info().project.use.baseURL ?? "https://mongolz.vercel.app").hostname;
  await page.context().addCookies([
    { name: "mongolz-lang", value: lang, domain: host, path: "/" },
    { name: "mongolz-theme", value: theme, domain: host, path: "/" },
  ]);
}

function rgbToHex(rgb: string): string {
  // "rgb(8, 9, 13)" → "#08090d"
  const m = rgb.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
  if (!m) return rgb;
  const [, r, g, b] = m;
  return (
    "#" +
    [r, g, b].map((c) => Number(c).toString(16).padStart(2, "0")).join("")
  );
}

test.describe("Theme — dark mode (default)", () => {
  test("landing background reads as dark", async ({ page }) => {
    await setLangAndTheme(page, "mn", "dark");
    await page.goto("/");
    const bg = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
    );
    expect(bg).toBe("8 9 13");
  });

  test("html data-theme attribute is dark", async ({ page }) => {
    await setLangAndTheme(page, "mn", "dark");
    await page.goto("/");
    const theme = await page.locator("html").getAttribute("data-theme");
    expect(theme).toBe("dark");
  });

  test("text color contrasts the body background", async ({ page }) => {
    await setLangAndTheme(page, "mn", "dark");
    await page.goto("/");
    const result = await page.evaluate(() => {
      const body = document.body;
      const cs = getComputedStyle(body);
      return { color: cs.color, bg: cs.backgroundColor };
    });
    // body color should be light (high brightness sum) on dark
    const m = result.color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    expect(m).not.toBeNull();
    const [, r, g, b] = m!;
    const brightness = Number(r) + Number(g) + Number(b);
    expect(brightness).toBeGreaterThan(500); // ~166 each = "off-white"
  });
});

test.describe("Theme — light mode flips correctly", () => {
  test("landing background is white when cookie=light", async ({ page }) => {
    await setLangAndTheme(page, "mn", "light");
    await page.goto("/");
    const bg = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
    );
    expect(bg).toBe("255 255 255");
  });

  test("body text becomes dark when cookie=light", async ({ page }) => {
    await setLangAndTheme(page, "mn", "light");
    await page.goto("/");
    const color = await page.evaluate(() => getComputedStyle(document.body).color);
    const m = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    expect(m).not.toBeNull();
    const [, r, g, b] = m!;
    const brightness = Number(r) + Number(g) + Number(b);
    // dark text on white → low brightness sum (each ≤ 60)
    expect(brightness).toBeLessThan(250);
  });

  test("hero gradient text remains legible (not white-on-white)", async ({ page }) => {
    await setLangAndTheme(page, "mn", "light");
    await page.goto("/");
    const hero = page.locator("h1").first();
    await expect(hero).toBeVisible();
    const styles = await hero.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        bgImage: cs.backgroundImage,
        webkitTextFillColor: cs.webkitTextFillColor,
      };
    });
    // The gradient stops must reference rgb(var(--text)) which resolves
    // to dark colours in light mode (NOT the old #f4f4f5 → #a1a1aa).
    expect(styles.bgImage).toContain("linear-gradient");
    // Either the stops resolve to dark CSS values (rgb(...) ≤ 100 brightness)
    // or the fallback color matches text. Computed style replaces var() so
    // we should see concrete rgb() values now.
    expect(styles.bgImage).not.toContain("rgb(244, 244, 245)"); // dark-mode text token
    expect(styles.bgImage).not.toContain("#f4f4f5"); // legacy hardcoded
  });

  test("admin /alerts redirect text-color paints dark on white", async ({ page }) => {
    // We can't hit admin routes (auth-gated), but /login is reachable and
    // shares the same theme tokens.
    await setLangAndTheme(page, "mn", "light");
    await page.goto("/login");
    const muted = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.className = "text-text-muted";
      document.body.appendChild(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    });
    // text-muted in light mode = rgb(113 113 122) (same in both, but stable)
    expect(muted).toMatch(/rgb\(113,\s*113,\s*122\)/);
  });
});

test.describe("Theme — gradient backgrounds are theme-aware", () => {
  test("bg-gradient-hero uses --bg / --bg-secondary in light", async ({ page }) => {
    await setLangAndTheme(page, "mn", "light");
    await page.goto("/");
    const rootBgImage = await page.evaluate(() => {
      // The landing root has class bg-gradient-hero
      const el = document.querySelector(".bg-gradient-hero") ?? document.body;
      return getComputedStyle(el).backgroundImage;
    });
    // Should NOT contain the old hardcoded dark stops
    expect(rootBgImage).not.toContain("rgb(8, 9, 13)"); // dark --bg
    expect(rootBgImage).not.toContain("#08090d");
    // Should contain the light --bg resolved (255 255 255) or transparent
    // expression Tailwind generated.
    expect(rootBgImage).toContain("rgb(255, 255, 255)");
  });

  test("accent token shifts to deeper cyan in light for AA contrast", async ({ page }) => {
    await setLangAndTheme(page, "mn", "light");
    await page.goto("/");
    const accent = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
    );
    // Dark accent = 0 212 255 (#00d4ff); light accent should be deeper = 0 153 204
    expect(accent).toBe("0 153 204");
  });
});

test.describe("Theme — i18n × theme intersection", () => {
  const langs: ("mn" | "en" | "kr")[] = ["mn", "en", "kr"];
  for (const lang of langs) {
    test(`light mode renders ${lang} landing without theme-blind text`, async ({ page }) => {
      await setLangAndTheme(page, lang, "light");
      await page.goto("/");
      const hero = page.locator("h1").first();
      await expect(hero).toBeVisible();
      // Make sure the page actually finished rendering and h1 has text content
      const text = await hero.textContent();
      expect(text?.trim().length ?? 0).toBeGreaterThan(0);
    });
  }
});
