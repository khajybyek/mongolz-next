/**
 * CSP report normalisation for /api/csp-report. Chromium's Reporting API
 * posts `application/reports+json` ARRAYS of `{ type: "csp-violation",
 * body }`; legacy `report-uri` posts `{ "csp-report": {...} }`. Only a
 * sanitised directive, blocked origin and document path leave this module —
 * never the raw, caller-controlled report.
 */

export const MAX_CSP_REPORTS = 20;

export type Report = { directive: string; blocked: string; document: string };

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

/** Directive names only (`script-src-elem`), never caller-chosen text. */
function cleanDirective(raw: unknown): string {
  const d = (str(raw) ?? "").trim().toLowerCase().split(/\s+/)[0]?.slice(0, 64) ?? "";
  return /^[a-z-]+$/.test(d) ? d : "unknown";
}

/** Origin only (or the CSP keyword such as `inline` / `eval`). */
function cleanBlocked(raw: unknown): string {
  const s = str(raw);
  if (!s) return "unknown";
  try {
    const u = new URL(s);
    return u.origin === "null" ? `${u.protocol}` : u.origin;
  } catch {
    return /^[a-z-]{1,32}$/i.test(s) ? s.toLowerCase() : "unknown";
  }
}

/** Path only — no query string (it may carry ids or tokens). */
function cleanDocument(raw: unknown): string {
  const s = str(raw);
  if (!s) return "unknown";
  try {
    return new URL(s).pathname.slice(0, 200);
  } catch {
    return "unknown";
  }
}

/** Legacy `{ "csp-report": {...} }` and Reporting API arrays → reports. */
export function normaliseCspReports(payload: unknown): Report[] {
  const entries = Array.isArray(payload) ? payload.slice(0, MAX_CSP_REPORTS) : [payload];
  const out: Report[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    let body: Record<string, unknown> | null = null;
    if (e["csp-report"] && typeof e["csp-report"] === "object") {
      body = e["csp-report"] as Record<string, unknown>;
    } else if ((e.type === "csp-violation" || e.type === undefined) && e.body && typeof e.body === "object") {
      body = e.body as Record<string, unknown>;
    }
    if (!body) continue; // deprecation / intervention reports etc.
    out.push({
      directive: cleanDirective(body.effectiveDirective ?? body["effective-directive"] ?? body["violated-directive"]),
      blocked: cleanBlocked(body.blockedURL ?? body["blocked-uri"]),
      document: cleanDocument(body.documentURL ?? body["document-uri"]),
    });
  }
  return out;
}
