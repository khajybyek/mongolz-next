/**
 * mongolz.dev/test (lib/test-site.ts + proxy.ts):
 *  - the CSP hash matches the page's executable inline script, so the page
 *    actually runs (and this fails loudly when index.html is replaced);
 *  - the proxy answers /test before any Supabase / login / role work, with
 *    the page's own CSP, and never matches look-alike paths such as /testing.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { buildTestSiteCsp, isTestSitePath, TEST_SITE_SCRIPT_HASHES, testSiteRewriteTarget } from "@/lib/test-site";
import { proxy } from "@/proxy";

const getUser = jest.fn(async () => ({ data: { user: null } }));
jest.mock("@/lib/flags", () => ({ flag: () => false }));
jest.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser } }),
}));

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  getUser.mockClear();
});

function executableScriptHashes(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
    const attrs = m[1] ?? "";
    if (/\btype\s*=\s*"application\/json"/.test(attrs)) continue;
    if (/\bsrc\s*=/.test(attrs)) continue;
    out.push(`sha256-${createHash("sha256").update(m[2], "utf8").digest("base64")}`);
  }
  return out;
}

describe("test site CSP", () => {
  const html = readFileSync(join(process.cwd(), "public/test/index.html"), "utf8");

  it("pins exactly the page's executable inline scripts", () => {
    expect([...TEST_SITE_SCRIPT_HASHES].sort()).toEqual(executableScriptHashes(html).sort());
  });

  it("has no inline event handler attributes (script-src would block them)", () => {
    expect(html).not.toMatch(/<[^>]+\son[a-z]+\s*=/i);
  });

  it("allows no inline or remote script and no network calls", () => {
    const csp = buildTestSiteCsp();
    const scriptSrc = csp.split("; ").find((d) => d.startsWith("script-src "))!;
    expect(scriptSrc).not.toMatch(/unsafe-inline|unsafe-eval|https?:|\*/);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });
});

describe("test site paths", () => {
  it.each(["/test", "/test/", "/test/index.html", "/test/img/681.webp"])("%s is the test site", (p) => {
    expect(isTestSitePath(p)).toBe(true);
  });

  it.each(["/testing", "/tests", "/", "/login", "/api/test"])("%s is not", (p) => {
    expect(isTestSitePath(p)).toBe(false);
  });

  it("serves the index for the bare directory only", () => {
    expect(testSiteRewriteTarget("/test")).toBe("/test/index.html");
    expect(testSiteRewriteTarget("/test/")).toBe("/test/index.html");
    expect(testSiteRewriteTarget("/test/index.html")).toBeNull();
  });
});

describe("proxy on /test", () => {
  it("rewrites /test to the index without touching the session", async () => {
    const res = await proxy(new NextRequest("https://mongolz.dev/test"));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-rewrite")).toBe("https://mongolz.dev/test/index.html");
    expect(res.headers.get("Content-Security-Policy")).toBe(buildTestSiteCsp());
    expect(res.headers.get("location")).toBeNull();
    expect(getUser).not.toHaveBeenCalled();
  });

  it("passes /test/index.html straight through with the page CSP", async () => {
    const res = await proxy(new NextRequest("https://mongolz.dev/test/index.html"));
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(res.headers.get("Content-Security-Policy")).toBe(buildTestSiteCsp());
    expect(getUser).not.toHaveBeenCalled();
  });

  it("still sends an anonymous /testing visitor to login", async () => {
    const res = await proxy(new NextRequest("https://mongolz.dev/testing"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
    expect(res.headers.get("Content-Security-Policy")).not.toBe(buildTestSiteCsp());
  });
});
