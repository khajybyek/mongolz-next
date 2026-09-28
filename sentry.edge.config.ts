/**
 * Edge-runtime Sentry init (middleware + edge routes). Loaded from
 * `instrumentation.ts#register()`.
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
    dataCollection: SENTRY_DATA_COLLECTION,
    beforeSendSpan: (span) => scrubSentrySpan(span),
    attachStacktrace: false,
    beforeSend: (event) => scrubSentryEvent(event),
  });
}
