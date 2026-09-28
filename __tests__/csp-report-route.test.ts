/**
 * /api/csp-report:
 *  - Chromium Reporting API arrays are parsed (every report used to be
 *    "CSP violation: unknown");
 *  - the public endpoint no longer forwards raw, caller-controlled JSON to
 *    Sentry, rejects foreign content types and oversize bodies, and is
 *    throttled per IP (fail closed → silently dropped, still 204).
 */
import { NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { POST } from "@/app/api/csp-report/route";
import { checkRateLimit } from "@/lib/rate-limit";
import { normaliseCspReports } from "@/lib/csp-report";

jest.mock("@sentry/nextjs", () => ({ captureMessage: jest.fn() }));
jest.mock("@/lib/rate-limit", () => ({ checkRateLimit: jest.fn() }));

function post(body: string, type = "application/reports+json", ip = "203.0.113.9") {
  return new NextRequest("https://app.test/api/csp-report", {
    method: "POST",
    headers: { "content-type": type, "x-forwarded-for": ip },
    body,
  });
}

beforeEach(() => {
  jest.mocked(Sentry.captureMessage).mockClear();
  jest.mocked(checkRateLimit).mockResolvedValue({ ok: true, count: 1, resetSec: 60 });
});

describe("normaliseCspReports", () => {
  it("reads Reporting API arrays and skips non-CSP reports", () => {
    const reports = normaliseCspReports([
      { type: "deprecation", body: { id: "x" } },
      {
        type: "csp-violation",
        body: {
          effectiveDirective: "script-src-elem",
          blockedURL: "https://evil.example/x.js?token=abc",
          documentURL: "https://aicctv.dev/playback/123?secret=1",
        },
      },
    ]);
    expect(reports).toEqual([
      { directive: "script-src-elem", blocked: "https://evil.example", document: "/playback/123" },
    ]);
  });

  it("still reads the legacy report-uri shape", () => {
    expect(
      normaliseCspReports({
        "csp-report": { "violated-directive": "img-src", "blocked-uri": "inline", "document-uri": "https://aicctv.dev/live" },
      }),
    ).toEqual([{ directive: "img-src", blocked: "inline", document: "/live" }]);
  });

  it("never lets caller-chosen text through as a directive", () => {
    const [r] = normaliseCspReports({ "csp-report": { "violated-directive": "<script>alert(1)</script>" } });
    expect(r.directive).toBe("unknown");
  });
});

describe("POST /api/csp-report", () => {
  const modern = JSON.stringify([
    { type: "csp-violation", body: { effectiveDirective: "img-src", blockedURL: "http://10.0.0.9/cam.jpg", documentURL: "https://aicctv.dev/live" } },
  ]);

  it("reports the real directive, without the raw body", async () => {
    const res = await POST(post(modern));
    expect(res.status).toBe(204);
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    const [msg, ctx] = jest.mocked(Sentry.captureMessage).mock.calls[0] as [
      string,
      { extra: Record<string, unknown>; fingerprint?: string[] },
    ];
    expect(msg).toBe("CSP violation: img-src");
    // Grouped per directive, not by the (shared) call-site stack.
    expect(ctx.fingerprint).toEqual(["csp-violation", "img-src"]);
    expect(ctx.extra).not.toHaveProperty("raw");
    expect(ctx.extra.blocked_origin).toBe("http://10.0.0.9");
  });

  it("refuses foreign content types and oversize bodies", async () => {
    expect((await POST(post(modern, "text/plain"))).status).toBe(415);
    expect((await POST(post("[" + "1,".repeat(20_000) + "1]"))).status).toBe(413);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it("drops (204, no Sentry) when the per-IP throttle says no", async () => {
    jest.mocked(checkRateLimit).mockResolvedValue({ ok: false, count: 31, resetSec: 30 });
    const res = await POST(post(modern));
    expect(res.status).toBe(204);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(jest.mocked(checkRateLimit).mock.calls[0][0]).toBe("ip:203.0.113.9");
  });
});
