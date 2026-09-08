"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { errorReportingEnabled } from "@/lib/error-reporting";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ background: "#0a0a0a", color: "#e5e5e5", fontFamily: "system-ui, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", margin: 0 }}>
        <div style={{ textAlign: "center", maxWidth: 420 }}>
          <h2 style={{ fontSize: 20, fontWeight: 600 }}>Something went wrong</h2>
          <p style={{ color: "#737373", fontSize: 14, marginTop: 8 }}>
            {/* Only promise a report when a DSN is actually configured —
                without one `captureException` above is a no-op. */}
            {errorReportingEnabled()
              ? "An unexpected error occurred. The error has been reported automatically."
              : "An unexpected error occurred."}
          </p>
          <button
            onClick={reset}
            style={{ marginTop: 16, padding: "8px 20px", background: "#3b82f6", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 14 }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
