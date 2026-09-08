/**
 * Edge-runtime Sentry init (middleware + edge routes). Loaded from
 * `instrumentation.ts#register()`.
 */
import * as Sentry from "@sentry/nextjs";
import { SERVER_TRACES_SAMPLE_RATE, scrubSentryEvent, serverErrorReportingDsn } from "./lib/error-reporting";

const dsn = serverErrorReportingDsn();

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: SERVER_TRACES_SAMPLE_RATE,
    sendDefaultPii: false,
    beforeSend: (event) => scrubSentryEvent(event),
  });
}
