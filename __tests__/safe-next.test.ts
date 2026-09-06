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
});
