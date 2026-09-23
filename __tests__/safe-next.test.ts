import { sanitizeNextPath } from "@/lib/auth/safe-next";

describe("sanitizeNextPath", () => {
  it("keeps same-origin paths with query", () => {
    expect(sanitizeNextPath("/playback/abc?face=1")).toBe("/playback/abc?face=1");
    expect(sanitizeNextPath("%2Fcameras")).toBe("/cameras");
  });

  it("falls back for empty / missing values", () => {
    expect(sanitizeNextPath("")).toBe("/dashboard");
    expect(sanitizeNextPath(null)).toBe("/dashboard");
    expect(sanitizeNextPath(undefined)).toBe("/dashboard");
  });

  it("rejects absolute and protocol-relative targets", () => {
    expect(sanitizeNextPath("https://evil.example/")).toBe("/dashboard");
    expect(sanitizeNextPath("//evil.example/x")).toBe("/dashboard");
    expect(sanitizeNextPath("/\\evil.example")).toBe("/dashboard");
    expect(sanitizeNextPath("javascript:alert(1)")).toBe("/dashboard");
  });

  it("rejects control-character tricks the URL parser would strip", () => {
    // "/\t/evil.com" → WHATWG strips the tab → "//evil.com"
    expect(sanitizeNextPath("/%09/evil.com")).toBe("/dashboard");
    expect(sanitizeNextPath("/%0A/evil.com")).toBe("/dashboard");
    expect(sanitizeNextPath("/\t/evil.com")).toBe("/dashboard");
  });

  it("never sends the user back into the auth flow", () => {
    expect(sanitizeNextPath("/login")).toBe("/dashboard");
    expect(sanitizeNextPath("/auth/logout")).toBe("/dashboard");
  });

  it("drops fragments and credentials, re-serialising canonically", () => {
    expect(sanitizeNextPath("/alerts#frag")).toBe("/alerts");
    expect(sanitizeNextPath("/a/../b")).toBe("/b");
  });

  it("rejects dot segments that collapse into a protocol-relative target", () => {
    for (const v of ["/.//evil.example", "/%2e//x", "/a/..//x", "/.%2F%2Fx", "/./..//x"]) {
      expect(sanitizeNextPath(v)).toBe("/dashboard");
    }
  });

  it("refuses values that a second sanitising pass would turn off-origin", () => {
    // Login page sanitises the (already URL-decoded) query value, then the
    // server action sanitises the hidden input again — each pass decodes once.
    for (const v of ["/.%252F%252Fx", "/.%25252F%25252Fevil.example", "/%255Cevil.example"]) {
      expect(sanitizeNextPath(v)).toBe("/dashboard");
    }
  });

  it("is idempotent and never yields //host after repeated passes", () => {
    const inputs = [
      "/playback/abc?face=1",
      "%2Fcameras",
      "/a%20b",
      "/.//evil.example",
      "/%2e//x",
      "/a/..//x",
      "/.%252F%252Fx",
      "/.%25252F%25252Fevil.example",
      "/a//b",
    ];
    for (const v of inputs) {
      let out = sanitizeNextPath(v);
      for (let i = 0; i < 4; i++) {
        expect(out.startsWith("//")).toBe(false);
        expect(out.startsWith("/")).toBe(true);
        const again = sanitizeNextPath(out);
        expect(again).toBe(out);
        out = again;
      }
    }
  });

  it("keeps encoded query values intact (no second decode)", () => {
    // The middleware puts `path + search` in next=; the login page reads it
    // with URLSearchParams (one decode), then login + server action sanitise.
    const cases: Array<[string, string]> = [
      ["/audit?q=100%25", "/audit?q=100%25"],
      ["/search?q=a%2Bb", "/search?q=a%2Bb"],
      ["/search?tag=%23vip", "/search?tag=%23vip"],
      ["/audit?q=a%26b%23c%2Bd", "/audit?q=a%26b%23c%2Bd"],
      ["/audit?q=100%25&user=a%26b", "/audit?q=100%25&user=a%26b"],
      ["/audit?q=TOTP%20fail&from=2026-09-01", "/audit?q=TOTP%20fail&from=2026-09-01"],
      ["/alerts?state=new#x", "/alerts?state=new"],
    ];
    for (const [input, expected] of cases) {
      const once = sanitizeNextPath(input);
      expect(once).toBe(expected);
      expect(sanitizeNextPath(once)).toBe(expected);
      const q = new URL(once, "https://x.invalid").searchParams;
      const want = new URL(input, "https://x.invalid").searchParams;
      expect([...q.entries()]).toEqual([...want.entries()]);
    }
  });

  it("round-trips a query through the middleware's next= encoding", () => {
    const login = new URL("https://x.invalid/login");
    login.searchParams.set("next", "/search?q=a%2Bb&tag=%23vip");
    const fromPage = sanitizeNextPath(login.searchParams.get("next"));
    expect(sanitizeNextPath(fromPage)).toBe("/search?q=a%2Bb&tag=%23vip");
  });

  it("still rejects off-origin tricks hidden before the query", () => {
    for (const v of ["//evil.example?x=1", "/.%2F%2Fx?y=1", "/%09/evil?y", "https://evil?x"]) {
      expect(sanitizeNextPath(v)).toBe("/dashboard");
    }
  });
});
