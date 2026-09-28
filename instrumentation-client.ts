/**
 * Browser Sentry init.
 *
 * Next 16 builds with Turbopack, and Turbopack never loads
 * `sentry.client.config.ts` — that file is injected by the Sentry *webpack*
 * plugin only (see `@sentry/nextjs` webpack.js, which now prints a deprecation
 * warning saying exactly that). The supported entry point is this file: the
 * client bootstrap requires `private-next-instrumentation-client`, which Next
 * aliases to `<root>/instrumentation-client` and executes before `hydrate()`
 * (next/dist/client/app-next-turbopack.js → lib/require-instrumentation-client).
 *
 * Without a DSN the SDK is never initialised at all: no init, no global
 * handlers, no network. `Sentry.captureException()` in the error boundaries
 * then degrades to a no-op, and the boundaries switch to copy that does not
 * claim the error was reported (see `lib/error-reporting.ts`).
 */
import * as Sentry from "@sentry/nextjs";
import {
  BROWSER_TRACES_SAMPLE_RATE,
  SENTRY_DATA_COLLECTION,
  browserErrorReportingDsn,
  scrubSentryBreadcrumb,
  scrubSentryEvent,
} from "./lib/error-reporting";

const dsn = browserErrorReportingDsn();

if (dsn) {
  Sentry.init({
    dsn,
    // Errors are always captured; this only samples performance transactions.
    tracesSampleRate: BROWSER_TRACES_SAMPLE_RATE,
    // Never attach IP / cookies / bodies / query strings to an event or span
    // (SDK v11 collects all of them by default; see lib/error-reporting.ts).
    dataCollection: SENTRY_DATA_COLLECTION,
    integrations: [Sentry.browserTracingIntegration()],
    // Session Replay is deliberately NOT enabled. It records the DOM of a
    // console that shows face crops, camera names and RTSP hostnames;
    // maskAllText/blockAllMedia reduce that exposure but do not remove it,
    // which is the wrong trade for a privacy-preserving surveillance product.
    // Stack traces + breadcrumbs are what we actually debug with.
    beforeSend: (event) => scrubSentryEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubSentryBreadcrumb(breadcrumb),
  });
}

/**
 * Required by @sentry/nextjs to instrument App Router navigations. Safe to
 * export unconditionally — it is a no-op while the SDK is uninitialised.
 */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
