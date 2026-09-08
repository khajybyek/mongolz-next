import * as Sentry from "@sentry/nextjs";

/**
 * Server + edge instrumentation. The BROWSER SDK is not initialised here —
 * it lives in `instrumentation-client.ts` (Next file convention), because
 * Turbopack does not inject `sentry.client.config.ts`.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");

    // Say it out loud when nothing is listening. Cannot be a
    // Sentry.captureMessage — with no DSN there is nowhere to send it.
    if (!process.env.SENTRY_DSN && !process.env.NEXT_PUBLIC_SENTRY_DSN) {
      console.warn("[observability] no Sentry DSN configured — error reporting is disabled");
    }

    // Boot-time configuration check. lib/auth/hmac-secret.ts is fail-closed
    // in production: an unset signing secret means TOTP logins and step-up
    // break at request time. Say so once, loudly, by NAME only — and never
    // let this check itself take the process down.
    try {
      const { isProductionRuntime, missingProductionSecrets } = await import("./lib/env-check");
      const missing = missingProductionSecrets();
      if (isProductionRuntime() && missing.length > 0) {
        const msg = `[config] missing production secrets: ${missing.join(", ")}`;
        console.error(msg);
        Sentry.captureMessage(msg, "fatal");
      }
    } catch {}

    const { initTelemetry } = await import("./lib/telemetry");
    initTelemetry();
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
