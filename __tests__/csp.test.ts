import { allowsInsecureMedia, buildCsp } from "@/lib/csp";

const directive = (csp: string, name: string) =>
  csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

describe("content security policy", () => {
  it("gives public and console pages no scheme wildcard", () => {
    for (const path of ["/", "/login", "/sch", "/sch/admin", "/dashboard", "/grid", "/wall", "/liveness"]) {
      expect(allowsInsecureMedia(path)).toBe(false);
    }
    const csp = buildCsp("n0nce", { isDev: false, insecureMedia: false });
    expect(csp).not.toMatch(/(^|\s)https?:(\s|;|$)/);
    expect(csp).not.toContain(" * ");
    expect(directive(csp, "img-src")).toBe("img-src 'self' data: blob: https://*.supabase.co https://*.supabase.in");
  });

  it("allows plain-http pixels only on the hand-typed webcam page", () => {
    expect(allowsInsecureMedia("/live")).toBe(true);
    expect(allowsInsecureMedia("/live/anything")).toBe(true);
    const csp = buildCsp("n0nce", { isDev: false, insecureMedia: true });
    expect(directive(csp, "img-src")).toContain(" http: ");
    expect(directive(csp, "media-src")).toContain(" http: ");
    // Tokens travel over connect-src: never plain http, on any page.
    expect(directive(csp, "connect-src")).not.toContain("http:");
  });

  it("keeps scripts nonce-bound and eval-free in production", () => {
    const prod = directive(buildCsp("abc", { isDev: false, insecureMedia: false }), "script-src");
    expect(prod).toContain("'nonce-abc'");
    expect(prod).toContain("'strict-dynamic'");
    expect(prod).not.toContain("'unsafe-eval'");
    expect(prod).not.toContain("'unsafe-inline'");
    expect(directive(buildCsp("abc", { isDev: true, insecureMedia: false }), "script-src")).toContain("'unsafe-eval'");
  });

  it("declares the directives that do not fall back to default-src", () => {
    const csp = buildCsp("abc", { isDev: false, insecureMedia: false });
    for (const d of ["frame-ancestors 'none'", "form-action 'self'", "base-uri 'self'", "object-src 'none'", "frame-src 'none'"]) {
      expect(csp).toContain(d);
    }
  });
});
