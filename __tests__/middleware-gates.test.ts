/**
 * Middleware gates (lib/supabase/middleware.ts):
 *  - an unauthenticated /api/* call answers 401 JSON, not a 307 to the HTML
 *    login page (fetch / hls.js choked on `200 text/html`);
 *  - page redirects keep the original query string inside `next=`;
 *  - auditors reach their own GDPR page (/my-data) — /api/gdpr/* already
 *    accepted them but every page except /audit bounced.
 */
import { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { proxy } from "@/proxy";
import { visibleNavGroups } from "@/lib/nav";

let mockUser: { id: string } | null = null;
let mockRole = "auditor";

jest.mock("@/lib/flags", () => ({ flag: () => false }));
jest.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: mockUser } }) },
    from: () => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data: { role: mockRole, totp_enabled: true }, error: null }) }),
      }),
    }),
  }),
}));

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  mockUser = null;
  mockRole = "auditor";
});

describe("unauthenticated requests", () => {
  it.each([
    "/api/recordings/not-a-uuid/view",
    "/api/search/presets",
    "/api/audit/export",
    "/api/nonexistent",
  ])("%s → 401 JSON", async (path) => {
    const res = await updateSession(new NextRequest(`https://app.test${path}`));
    expect(res.status).toBe(401);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("the proxy passes the 401 through instead of running the handler", async () => {
    const res = await proxy(new NextRequest("https://app.test/api/audit/export"));
    expect(res.status).toBe(401);
    expect(res.headers.get("x-middleware-next")).toBeNull();
    expect(res.headers.get("content-security-policy")).toBeTruthy();
    expect(res.headers.get("reporting-endpoints")).toBe('csp-endpoint="/api/csp-report"');
    expect(JSON.parse(res.headers.get("report-to")!).endpoints[0].url).toBe("https://app.test/api/csp-report");
  });

  it("public API carve-outs still reach their handlers", async () => {
    for (const path of ["/api/uptime", "/api/cron/retention-sweep", "/api/csp-report", "/api/auth/passkey/login/options"]) {
      const res = await updateSession(new NextRequest(`https://app.test${path}`));
      expect(res.status).toBe(200); // NextResponse.next()
    }
  });

  it("pages still redirect to /login and keep the query in next=", async () => {
    const res = await updateSession(new NextRequest("https://app.test/audit?action=REVEAL_APPROVED&x=1"));
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/login");
    expect([...loc.searchParams.keys()]).toEqual(["next"]);
    expect(loc.searchParams.get("next")).toBe("/audit?action=REVEAL_APPROVED&x=1");
  });

  it("a page without a query keeps a bare next path", async () => {
    const res = await updateSession(new NextRequest("https://app.test/grid"));
    expect(new URL(res.headers.get("location")!).searchParams.get("next")).toBe("/grid");
  });
});

describe("auditor allow-list", () => {
  beforeEach(() => {
    mockUser = { id: "auditor-1" };
    mockRole = "auditor";
  });

  it.each(["/audit", "/audit/verify", "/my-data", "/my-data/export"])("lets %s through", async (path) => {
    const res = await updateSession(new NextRequest(`https://app.test${path}`));
    expect(res.headers.get("location")).toBeNull();
  });

  it.each(["/dashboard", "/privacy", "/my-datax", "/settings"])("bounces %s to /audit", async (path) => {
    const res = await updateSession(new NextRequest(`https://app.test${path}`));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/audit");
  });

  it("every auditor-visible nav destination passes the middleware", async () => {
    const hrefs = visibleNavGroups("auditor").flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).toContain("/my-data");
    for (const href of hrefs) {
      const res = await updateSession(new NextRequest(`https://app.test${href}`));
      expect(res.headers.get("location")).toBeNull();
    }
  });
});
