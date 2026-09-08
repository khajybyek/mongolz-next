/**
 * Error-reporting truth table + the scrubbing every Sentry client shares.
 *
 * Why this module exists: until 2026-09-09 the browser SDK was configured in
 * `sentry.client.config.ts`, a file that only the *webpack* build injects.
 * Next 16 builds with Turbopack, so the config was never loaded and no browser
 * event ever reached Sentry — while the crash screens told users the error
 * "has been reported automatically". The browser SDK now initialises from
 * `instrumentation-client.ts` (the Next file convention), and the UI reads
 * `errorReportingEnabled()` so it can only make that claim when it is true.
 *
 * Pure module — no `@sentry/*` runtime import, no `next/*` import — so it is
 * safe to pull into a client component, a server component, an instrumentation
 * file and Jest alike.
 *
 * Values are never logged from here; only presence is ever exposed.
 */

/** Browser traces are the noisiest signal and the least useful one here. */
export const BROWSER_TRACES_SAMPLE_RATE = 0.1;
/** Server transactions are low volume and carry the DB/ML spans we debug with. */
export const SERVER_TRACES_SAMPLE_RATE = 0.2;

/**
 * DSN the browser bundle may use, or `undefined` when reporting is off.
 *
 * The `process.env.NEXT_PUBLIC_SENTRY_DSN` member expression is written out
 * literally on purpose: that is the exact form Next inlines into the client
 * bundle at build time. Destructuring or dynamic lookup would leave the client
 * with `undefined` and silently disable reporting again.
 */
export function browserErrorReportingDsn(): string | undefined {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  const trimmed = typeof dsn === "string" ? dsn.trim() : "";
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * True when a browser error would actually be delivered somewhere.
 *
 * UI copy that promises "we received this" must be gated on this — an
 * unconfigured environment (preview, local, a rotated-away DSN) must not
 * promise a report that never happens.
 */
export function errorReportingEnabled(): boolean {
  return browserErrorReportingDsn() !== undefined;
}

/**
 * DSN for the Node/edge runtimes. `SENTRY_DSN` (server-only, not shipped to
 * the browser) wins when set, so the server DSN can later be moved out of the
 * public bundle without touching code.
 */
export function serverErrorReportingDsn(): string | undefined {
  const raw = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Drop the query string (and fragment) from a URL-ish string. */
export function stripQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

export interface ScrubbableRequest {
  url?: string;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
  query_string?: unknown;
}

export interface ScrubbableEvent {
  request?: ScrubbableRequest;
}

const FORBIDDEN_HEADERS = ["authorization", "cookie", "set-cookie", "x-ml-token", "proxy-authorization"];

/**
 * `beforeSend` scrubbing shared by the browser, Node and edge SDKs.
 *
 * Removes, unconditionally (not just on `/api/auth` as the old browser config
 * did):
 *   • the cookie jar — session + step-up + pin cookies live there;
 *   • Authorization / Cookie style headers;
 *   • query strings — HLS stream tickets and reveal tokens ride in them.
 */
export function scrubSentryEvent<E extends ScrubbableEvent>(event: E): E {
  const request = event.request;
  if (!request) return event;

  delete request.cookies;
  delete request.query_string;

  const headers = request.headers;
  if (headers) {
    for (const name of Object.keys(headers)) {
      if (FORBIDDEN_HEADERS.includes(name.toLowerCase())) delete headers[name];
    }
  }

  if (typeof request.url === "string") request.url = stripQuery(request.url);

  return event;
}

export interface ScrubbableBreadcrumb {
  category?: string;
  data?: { url?: string } | undefined;
}

/**
 * `beforeBreadcrumb` scrubbing: fetch/xhr/navigation breadcrumbs record the
 * URL they touched, and this app puts signed stream tickets in query strings.
 */
export function scrubSentryBreadcrumb<B extends ScrubbableBreadcrumb>(breadcrumb: B): B {
  const url = breadcrumb.data?.url;
  if (breadcrumb.data && typeof url === "string") {
    breadcrumb.data.url = stripQuery(url);
  }
  return breadcrumb;
}
