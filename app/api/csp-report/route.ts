import { NextResponse, type NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";

export async function POST(req: NextRequest) {
  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  // Normalize across legacy report-uri and modern Reporting API formats.
  const legacyReport = (payload["csp-report"] as Record<string, unknown>) ?? undefined;
  const modernBody = (payload.body as Record<string, unknown>) ?? undefined;
  const report: Record<string, unknown> = legacyReport ?? modernBody ?? {};

  const directive = String(report["violated-directive"] ?? report.effectiveDirective ?? "unknown");
  const blocked = String(report["blocked-uri"] ?? report.blockedURL ?? "unknown");
  const doc = String(report["document-uri"] ?? report.documentURL ?? "unknown");

  Sentry.captureMessage(`CSP violation: ${directive}`, {
    level: "warning",
    tags: { csp_directive: directive },
    extra: {
      blocked_uri: blocked,
      document_uri: doc,
      raw: report,
      ua: req.headers.get("user-agent") ?? "unknown",
    },
  });

  // Browsers ignore the response body for CSP reports — return 204.
  return new NextResponse(null, { status: 204 });
}
