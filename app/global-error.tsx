"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect, useState } from "react";
import { errorReportingEnabled } from "@/lib/error-reporting";

type Lang = "mn" | "en" | "kr";

/**
 * This boundary replaces the root layout, so there is no LangProvider above
 * it. A small inline string map (not the full translations module) keeps it
 * working even when the error came from i18n itself.
 */
const COPY: Record<Lang, { title: string; reported: string; plain: string; retry: string; htmlLang: string }> = {
  mn: {
    title: "Алдаа гарлаа",
    reported: "Гэнэтийн алдаа гарлаа. Алдааг автоматаар мэдээлсэн.",
    plain: "Гэнэтийн алдаа гарлаа.",
    retry: "Дахин оролдох",
    htmlLang: "mn",
  },
  en: {
    title: "Something went wrong",
    reported: "An unexpected error occurred. The error has been reported automatically.",
    plain: "An unexpected error occurred.",
    retry: "Try again",
    htmlLang: "en",
  },
  kr: {
    title: "문제가 발생했습니다",
    reported: "예기치 않은 오류가 발생했습니다. 오류가 자동으로 보고되었습니다.",
    plain: "예기치 않은 오류가 발생했습니다.",
    retry: "다시 시도",
    htmlLang: "ko",
  },
};

function readCookieLang(): Lang {
  if (typeof document === "undefined") return "mn";
  const m = document.cookie.match(/(?:^|; )mongolz-lang=([^;]+)/);
  const v = m?.[1];
  return v === "en" || v === "kr" || v === "mn" ? v : "mn";
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [lang] = useState<Lang>(() => readCookieLang());
  const copy = COPY[lang];

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang={copy.htmlLang}>
      <body style={{ background: "#0a0a0a", color: "#e5e5e5", fontFamily: "system-ui, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", margin: 0 }}>
        <div style={{ textAlign: "center", maxWidth: 420 }}>
          <h2 style={{ fontSize: 20, fontWeight: 600 }}>{copy.title}</h2>
          <p style={{ color: "#737373", fontSize: 14, marginTop: 8 }}>
            {/* Only promise a report when a DSN is actually configured —
                without one `captureException` above is a no-op. */}
            {errorReportingEnabled() ? copy.reported : copy.plain}
          </p>
          <button
            onClick={reset}
            style={{ marginTop: 16, padding: "8px 20px", background: "#3b82f6", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 14 }}
          >
            {copy.retry}
          </button>
        </div>
      </body>
    </html>
  );
}
