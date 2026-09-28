import { NextResponse, type NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { checkRateLimit, type RateLimitOptions } from "@/lib/rate-limit";
import { normaliseCspReports } from "@/lib/csp-report";

/*
 * CSP violation beacons (public — browsers send them without cookies).
 *
 *  - Chromium's Reporting API posts `application/reports+json` ARRAYS of
 *    `{ type: "csp-violation", body: {...} }`; the handler used to read
 *    `payload.body` off the array and logged every report as "unknown".
 *  - The endpoint is unauthenticated, so a caller could forward arbitrary
 *    JSON of any size to Sentry and exhaust the quota that real production
 *    errors need. Now: content-type allow-list, 16 KB cap, per-IP throttle,
 *    at most one Sentry event per request, and only a sanitised directive +
 *    blocked origin + document path are forwarded (never the raw report).
 */

const MAX_BODY_BYTES = 16 * 1024;
const ACCEPTED_TYPES = ["application/csp-report", "application/reports+json", "application/json"];
const CSP_REPORT_LIMIT: RateLimitOptions = {
  action: "CSP_REPORT",
  name: "csp_report",
  windowSec: 60,
  max: 30,
};

const noContent = () => new NextResponse(null, { status: 204 });

export async function POST(req: NextRequest) {
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!ACCEPTED_TYPES.includes(type)) return new NextResponse(null, { status: 415 });

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return new NextResponse(null, { status: 413 });
  const text = await req.text().catch(() => "");
  if (text.length > MAX_BODY_BYTES) return new NextResponse(null, { status: 413 });

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const reports = normaliseCspReports(payload);
  if (reports.length === 0) return noContent();

  // Per-IP throttle. Over the limit — or the counter unavailable (fail
  // closed) — still answers 204 so browsers do not retry, but sends nothing.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = await checkRateLimit(`ip:${ip}`, CSP_REPORT_LIMIT);
  if (!rl.ok) return noContent();

  const first = reports[0];
  Sentry.captureMessage(`CSP violation: ${first.directive}`, {
    level: "warning",
    // One Sentry issue per directive. Without it the SDK groups by this call
    // site's stack, folding every directive into a single issue.
    fingerprint: ["csp-violation", first.directive],
    tags: { csp_directive: first.directive },
    extra: {
      blocked_origin: first.blocked,
      document_path: first.document,
      reports_in_batch: reports.length,
    },
  });

  // Browsers ignore the response body for CSP reports — return 204.
  return noContent();
}
