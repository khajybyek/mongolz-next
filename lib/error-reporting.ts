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
 * Header-name fragments that carry the client's IP or location: x-forwarded-for,
 * x-real-ip, x-vercel-ip-city/-country/-latitude, remote-addr, via, x-*-user.
 * The same list `sendDefaultPii: false` used to drop before SDK v11.
 */
const IP_HEADER_FRAGMENTS = ["forwarded", "-ip", "remote-", "via", "-user"];

/**
 * `dataCollection` for every `Sentry.init` (browser, Node, edge).
 *
 * SDK v11 removed `sendDefaultPii`; with `dataCollection` unset it collects
 * client IPs, cookies, every header, request bodies and query strings, and
 * only masks names that look like "token"/"secret" — so `mongolz-pre-totp`,
 * Vercel geo headers and `?ticket=` stream tickets would get through. This
 * restores the old baseline and is stricter in three places: no cookies at
 * all, no bodies, no query strings. On sampled spans (which `beforeSend` never
 * sees) `urlQueryParams` only reaches the attributes the SDK builds itself —
 * `url.full`, `url.query` — so Next's `http.target` needs `scrubSentrySpan`.
 */
export const SENTRY_DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: {
    request: { deny: IP_HEADER_FRAGMENTS },
    response: { deny: IP_HEADER_FRAGMENTS },
  },
  httpBodies: [],
  urlQueryParams: false,
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  graphQL: { document: false, variables: false },
  stackFrameVariables: false,
};

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
  data?: unknown;
}

export interface ScrubbableEvent {
  request?: ScrubbableRequest;
  user?: { ip_address?: unknown };
}

const FORBIDDEN_HEADERS = ["authorization", "cookie", "set-cookie", "x-ml-token", "proxy-authorization"];

/**
 * `beforeSend` scrubbing shared by the browser, Node and edge SDKs.
 *
 * Removes, unconditionally (not just on `/api/auth` as the old browser config
 * did):
 *   • the cookie jar — session + step-up + pin cookies live there;
 *   • Authorization / Cookie style headers, and the IP / geo headers;
 *   • query strings — HLS stream tickets and reveal tokens ride in them;
 *   • the request body — reauth and login bodies carry passwords and codes;
 *   • `user.ip_address`.
 * `SENTRY_DATA_COLLECTION` already stops the SDK collecting these; this is the
 * second line in case a default or an integration changes.
 */
export function scrubSentryEvent<E extends ScrubbableEvent>(event: E): E {
  if (event.user) delete event.user.ip_address;

  const request = event.request;
  if (!request) return event;

  delete request.cookies;
  delete request.query_string;
  delete request.data;

  const headers = request.headers;
  if (headers) {
    for (const name of Object.keys(headers)) {
      const lower = name.toLowerCase();
      if (FORBIDDEN_HEADERS.includes(lower) || IP_HEADER_FRAGMENTS.some((f) => lower.includes(f))) {
        delete headers[name];
      }
    }
  }

  if (typeof request.url === "string") request.url = stripQuery(request.url);

  return event;
}

/**
 * Span attributes holding a URL that `dataCollection.urlQueryParams` does not
 * filter: Next sets `http.target` to the raw `req.url` on every root span, and
 * header attributes carry the referring page and redirect target verbatim.
 */
const URL_SPAN_ATTRIBUTES = ["http.target", "http.request.header.referer", "http.response.header.location"];

export interface ScrubbableSpan {
  attributes?: Record<string, unknown>;
}

/** Strip queries from a raw attribute: a string, a header's string[], or an `{ value }` object. */
function stripQueryFromAttribute(value: unknown): unknown {
  if (typeof value === "string") return stripQuery(value);
  if (Array.isArray(value)) return value.map(stripQueryFromAttribute);
  if (value !== null && typeof value === "object" && "value" in value) {
    return { ...value, value: stripQueryFromAttribute(value.value) };
  }
  return value;
}

/**
 * `beforeSendSpan` scrubbing for the Node and edge SDKs: without it a sampled
 * `/api/ml/stream/<id>/index.m3u8?ticket=…` request ships the signed ticket
 * (and `/audit?q=…` its search) to Sentry in `http.target`. Must return the
 * span — SDK v11 ignores `null` here.
 */
export function scrubSentrySpan<S extends ScrubbableSpan>(span: S): S {
  const attributes = span.attributes;
  if (!attributes) return span;
  for (const key of URL_SPAN_ATTRIBUTES) {
    if (key in attributes) attributes[key] = stripQueryFromAttribute(attributes[key]);
  }
  return span;
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
