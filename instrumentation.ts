import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");

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
