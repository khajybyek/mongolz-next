/**
 * Node-runtime Sentry init. Loaded from `instrumentation.ts#register()` —
 * the browser side is `instrumentation-client.ts`, not a `sentry.*.config`
 * file (Turbopack does not inject those).
 */
import * as Sentry from "@sentry/nextjs";
import { SERVER_TRACES_SAMPLE_RATE, scrubSentryEvent, serverErrorReportingDsn } from "./lib/error-reporting";

const dsn = serverErrorReportingDsn();

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: SERVER_TRACES_SAMPLE_RATE,
    sendDefaultPii: false,
    // Shared with the browser + edge SDKs: no cookies, no Authorization
    // header, no query strings (stream tickets ride in those).
    beforeSend: (event) => scrubSentryEvent(event),
  });
}
