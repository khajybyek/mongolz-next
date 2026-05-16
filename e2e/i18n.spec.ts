import { test, expect, type Page } from "@playwright/test";

const ORIGIN = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "https://mongolz.vercel.app").hostname;

async function setLang(page: Page, lang: "mn" | "en" | "kr") {
  await page.context().addCookies([
    { name: "mongolz-lang", value: lang, domain: ORIGIN, path: "/" },
  ]);
}

test.describe("3-language i18n", () => {
  test("Mongolian login renders Cyrillic", async ({ page }) => {
    await setLang(page, "mn");
    await page.goto("/login");
    const html = await page.content();
    expect(html).toMatch(/Нэвтрэх|Имэйл|Нууц|хэрэглэгч/);
  });

  test("English login renders Latin", async ({ page }) => {
    await setLang(page, "en");
    await page.goto("/login");
    const html = await page.content();
    expect(html).toMatch(/Email|Password|Sign In/i);
  });

  test("Korean login renders Hangul", async ({ page }) => {
    await setLang(page, "kr");
    await page.goto("/login");
    const html = await page.content();
    expect(html).toMatch(/이메일|비밀번호|로그인/);
  });

  test("Language switcher buttons exist", async ({ page }) => {
    await page.goto("/login");
    // 3 language buttons (MN / EN / KR)
    const buttons = page.locator("a, button").filter({ hasText: /^(MN|EN|KR)$/ });
    await expect(buttons.first()).toBeVisible({ timeout: 5_000 });
  });
});
