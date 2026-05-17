import { test, expect } from "@playwright/test";

/**
 * Observability + defence-in-depth header coverage.
 *
 * Sanity-checks the production headers we rely on for security (CSP / HSTS /
 * Referrer-Policy / Permissions-Policy / X-Content-Type-Options) and the
 * Sentry-related public endpoints (csp-report ingest, OG image route).
 *
 * These are smoke tests, not auditing tools — they catch regressions where a
 * middleware change drops a header or a route gets unexpectedly auth-gated.
 */

test.describe("Security headers — landing", () => {
  test("strict CSP with nonce + report-uri", async ({ request }) => {
    const res = await request.get("/");
    expect(res.ok()).toBeTruthy();
    const csp = res.headers()["content-security-policy"];
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    expect(csp).toContain("report-uri /api/csp-report");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });

  test("HSTS preload-eligible", async ({ request }) => {
    const res = await request.get("/");
    const hsts = res.headers()["strict-transport-security"];
    expect(hsts).toBeDefined();
    expect(hsts).toContain("max-age=63072000");
    expect(hsts).toContain("includeSubDomains");
    expect(hsts).toContain("preload");
  });

  test("MIME-sniffing + referrer + permissions headers", async ({ request }) => {
    const res = await request.get("/");
    const h = res.headers();
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["permissions-policy"]).toContain("camera=(self)");
    expect(h["permissions-policy"]).toContain("geolocation=()");
  });
});

test.describe("Sentry ingest path", () => {
  test("/api/csp-report accepts modern Reporting-API body", async ({ request }) => {
    const res = await request.post("/api/csp-report", {
      headers: { "content-type": "application/csp-report" },
      data: {
        "csp-report": {
          "document-uri": "https://mongolz.vercel.app/",
          "violated-directive": "script-src",
          "blocked-uri": "https://evil.example.com/x.js",
        },
      },
    });
    // 204 No Content is the expected ack
    expect([200, 204]).toContain(res.status());
  });

  test("/api/csp-report rejects non-POST", async ({ request }) => {
    const res = await request.get("/api/csp-report");
    expect(res.status()).toBe(405);
  });

  test("/api/csp-report ignores malformed body cleanly", async ({ request }) => {
    const res = await request.post("/api/csp-report", {
      headers: { "content-type": "application/json" },
      data: "not-valid-json",
    });
    // Should not 500 — middleware caught error, returns 400
    expect(res.status()).toBeLessThan(500);
  });
});

test.describe("Public OG / metadata routes", () => {
  test("opengraph-image renders a real PNG (not 0 bytes)", async ({ request }) => {
    const res = await request.get("/opengraph-image", { maxRedirects: 0 });
    expect(res.status()).toBe(200);
    const ct = res.headers()["content-type"];
    expect(ct).toBe("image/png");
    const body = await res.body();
    // After the satori-CSS fix the image is ~40 KB. A regression to the
    // 0-byte placeholder is the exact failure we're guarding against.
    expect(body.byteLength).toBeGreaterThan(5_000);
    // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
    expect(body[0]).toBe(0x89);
    expect(body[1]).toBe(0x50);
    expect(body[2]).toBe(0x4e);
    expect(body[3]).toBe(0x47);
  });

  test("robots.txt is publicly reachable + disallows", async ({ request }) => {
    const res = await request.get("/robots.txt", { maxRedirects: 0 });
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/User-Agent:\s*\*/i);
    expect(body).toMatch(/Disallow:\s*\//);
  });

  test(".well-known/security.txt is RFC 9116-shaped", async ({ request }) => {
    const res = await request.get("/.well-known/security.txt", { maxRedirects: 0 });
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/Contact:/);
    expect(body).toMatch(/Expires:/);
  });
});

test.describe("Public health probe", () => {
  test("ml + db checks shipped + status is ok or degraded", async ({ request }) => {
    const res = await request.get("/api/uptime");
    expect(res.ok() || res.status() === 503).toBeTruthy();
    const body = await res.json();
    expect(body.status).toMatch(/^(ok|degraded)$/);
    expect(body.checks.ml).toBeDefined();
    expect(body.checks.db).toBeDefined();
    expect(body.checks.ml.latency).toBeDefined();
    expect(body.checks.db.latency).toBeDefined();
    // ts is RFC 3339
    expect(body.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
