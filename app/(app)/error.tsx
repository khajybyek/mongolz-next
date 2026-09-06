"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { useT } from "@/lib/i18n/client";

/**
 * Route-level error boundary for the authenticated app shell. Without it a
 * thrown server action or render error unmounted the whole tree into
 * app/global-error.tsx (unstyled, English-only, message redacted).
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useT();
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="max-w-lg mx-auto mt-16 card border border-danger/30 space-y-4 text-center">
      <div className="w-12 h-12 rounded-2xl bg-danger-soft text-danger border border-danger/20 inline-flex items-center justify-center mx-auto">
        <AlertTriangle className="w-6 h-6" />
      </div>
      <div>
        <h2 className="text-lg font-semibold text-text">{t("ui_error_title")}</h2>
        <p className="text-sm text-text-soft mt-1">{t("ui_error_desc")}</p>
        {error.digest && (
          <p className="text-2xs font-mono text-text-muted mt-2">ref {error.digest}</p>
        )}
      </div>
      <button type="button" onClick={reset} className="btn-primary mx-auto">
        <RotateCcw className="w-4 h-4" />
        {t("ui_retry")}
      </button>
    </div>
  );
}
