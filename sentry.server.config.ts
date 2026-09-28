/**
 * Node-runtime Sentry init. Loaded from `instrumentation.ts#register()` —
 * the browser side is `instrumentation-client.ts`, not a `sentry.*.config`
 * file (Turbopack does not inject those).
 */
import * as Sentry from "@sentry/nextjs";
import {
  SENTRY_DATA_COLLECTION,
  SERVER_TRACES_SAMPLE_RATE,
  scrubSentryEvent,
  scrubSentrySpan,
  serverErrorReportingDsn,
} from "./lib/error-reporting";

const dsn = serverErrorReportingDsn();

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: SERVER_TRACES_SAMPLE_RATE,
    // No client IP, cookies, request bodies or query strings on events OR on
    // sampled spans — `beforeSend` never sees spans, so this is the control
    // for the attributes the SDK builds (`url.full`, `url.query`, headers).
    dataCollection: SENTRY_DATA_COLLECTION,
    // …but not for Next's own `http.target` (the raw `req.url`, stream
    // `?ticket=` included) or the referer / location headers.
    beforeSendSpan: (span) => scrubSentrySpan(span),
    // SDK v11 turned this on: captureMessage (CSP beacons, the boot-time
    // config check) would become synthetic exceptions and mark the request
    // errored in release health. Keep the v10 behaviour.
    attachStacktrace: false,
    // Shared with the browser + edge SDKs: no cookies, no Authorization
    // header, no query strings (stream tickets ride in those).
    beforeSend: (event) => scrubSentryEvent(event),
  });
}
