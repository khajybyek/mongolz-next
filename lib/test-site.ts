/**
 * mongolz.dev/test — a self-contained static study page (the Korean driving
 * theory exam bank with Mongolian glosses) served from `public/test/`.
 *
 * It shares the deployment with the console and nothing else: `proxy.ts`
 * answers these paths before any Supabase / session / role logic runs, and
 * the page gets its own Content-Security-Policy. The console's nonce policy
 * cannot apply to a static file, so the page's one executable inline script
 * is pinned by hash instead — no 'unsafe-inline' for scripts. The two
 * `type="application/json"` blocks (question bank, glossary) are data, not
 * script, and are not subject to `script-src`.
 *
 * Only mongolz.dev serves it. aicctv.dev runs on the same deployment and
 * answers 404 for every /test path, images included (the proxy matcher lists
 * /test explicitly so static files under it pass through the gate too).
 *
 * Replacing `public/test/index.html` changes that hash: recompute it (the
 * test in `__tests__/test-site.test.ts` prints the expected value) or the
 * browser refuses to run the page.
 */

export const TEST_SITE_PREFIX = "/test";
export const TEST_SITE_INDEX = "/test/index.html";
export const TEST_SITE_SCRIPT_HASHES = ["sha256-F5AvqM5wIKvbkMX0uD3X2Tj3mWbLAgJrtOjmC8uTUmE="] as const;

export const TEST_SITE_HOSTS: readonly string[] = ["mongolz.dev", "www.mongolz.dev"];
const DEV_HOSTS: readonly string[] = ["localhost", "127.0.0.1"];

/**
 * `hosts` are the request's host candidates (x-forwarded-host, host, parsed
 * URL host). Vercel can keep the deployment URL in `host` and put the
 * user-facing alias only in `x-forwarded-host`, so any candidate may match.
 */
export function isTestSiteHost(hosts: readonly (string | null | undefined)[], isDev: boolean): boolean {
  const allowed = isDev ? [...TEST_SITE_HOSTS, ...DEV_HOSTS] : TEST_SITE_HOSTS;
  return hosts
    .flatMap((h) => (h ? h.split(",") : []))
    .some((h) => allowed.includes(h.trim().toLowerCase().replace(/:\d+$/, "")));
}

export function isTestSitePath(pathname: string): boolean {
  return pathname === TEST_SITE_PREFIX || pathname.startsWith(`${TEST_SITE_PREFIX}/`);
}

/** `/test` and `/test/` have no file of their own — serve the index. */
export function testSiteRewriteTarget(pathname: string): string | null {
  return pathname === TEST_SITE_PREFIX || pathname === `${TEST_SITE_PREFIX}/` ? TEST_SITE_INDEX : null;
}

export function buildTestSiteCsp(): string {
  const hashes = TEST_SITE_SCRIPT_HASHES.map((h) => `'${h}'`).join(" ");
  return [
    `default-src 'none'`,
    `script-src ${hashes}`,
    // The page sets `style` attributes and ships one inline <style> block.
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    `font-src https://fonts.gstatic.com`,
    `img-src 'self' data:`,
    `connect-src 'none'`,
    `frame-ancestors 'none'`,
    `base-uri 'none'`,
    `form-action 'none'`,
    `object-src 'none'`,
    `report-uri /api/csp-report`,
    `report-to csp-endpoint`,
  ].join("; ");
}
