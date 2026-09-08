import { test, expect, type Page } from "@playwright/test";

async function openEnglishLogin(page: Page, path = "/login") {
  const host = new URL(test.info().project.use.baseURL ?? "https://aicctv.dev").hostname;
  await page.context().addCookies([
    { name: "mongolz-lang", value: "en", domain: host, path: "/" },
  ]);
  await page.goto(path);
}

/** Hold and abort POSTs so these tests never attempt authentication or alter cookies. */
async function blockLoginPosts(page: Page) {
  let unblock!: () => void;
  let markStarted!: () => void;
  const blocked = new Promise<void>((resolve) => { unblock = resolve; });
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  await page.route("**/login*", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    markStarted();
    await blocked;
    await route.abort("blockedbyclient");
  });
  return { started, unblock };
}

test.describe("Login usability", () => {
  test("password visibility is accessible and preserves the entered value", async ({ page }) => {
    await openEnglishLogin(page);
    const password = page.getByLabel("Password", { exact: true });
    await password.fill("example-only-password");
    await expect(password).toHaveAttribute("type", "password");
    const show = page.getByRole("button", { name: "Show password", exact: true });
    await expect(show).toHaveAttribute("aria-pressed", "false");
    await show.click();
    await expect(password).toHaveAttribute("type", "text");
    await expect(password).toHaveValue("example-only-password");
    const hide = page.getByRole("button", { name: "Hide password", exact: true });
    await expect(hide).toHaveAttribute("aria-pressed", "true");
    await hide.click();
    await expect(password).toHaveAttribute("type", "password");
    await expect(password).toHaveValue("example-only-password");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("sign-in gives pending feedback and prevents duplicate submits", async ({ page }) => {
    await openEnglishLogin(page);
    const post = await blockLoginPosts(page);
    try {
      // An interactive control also confirms hydration before form submission.
      await page.getByRole("button", { name: "Show password", exact: true }).click();
      await page.getByLabel("Email or username", { exact: true }).fill("ui-test-only");
      await page.getByLabel("Password", { exact: true }).fill("example-only-password");
      await page.getByRole("button", { name: "Sign In", exact: true }).click();
      await post.started;
      const submit = page.getByRole("button", { name: "Signing in…", exact: true });
      await expect(submit).toBeVisible();
      await expect(submit).toBeDisabled();
      await expect(submit).toHaveAttribute("aria-busy", "true");
    } finally {
      post.unblock();
    }
  });

  test("TOTP cancellation works without entering a required verification code", async ({ page }) => {
    await openEnglishLogin(page, "/login?step=totp");
    const post = await blockLoginPosts(page);
    try {
      const code = page.getByLabel("Authentication or recovery code", { exact: true });
      await expect(code).toHaveValue("");
      await expect(code).toHaveAttribute("required", "");
      const cancel = page.getByRole("button", { name: "Back to sign in", exact: true });
      await expect(cancel).toBeVisible();
      await cancel.click();
      await post.started;
      await expect(page.getByRole("button", { name: "Going back…", exact: true })).toBeDisabled();
    } finally {
      post.unblock();
    }
  });
});
