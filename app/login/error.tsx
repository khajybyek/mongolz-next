"use client";

import { useEffect, useState } from "react";
import * as Sentry from "@sentry/nextjs";
import { ShieldAlert, RotateCcw } from "lucide-react";
import { MongolzLogo } from "@/components/logo";
import { t, type Lang } from "@/lib/i18n/translations";

const LANG_COOKIE = "mongolz-lang";
const VALID: readonly Lang[] = ["mn", "en", "kr"];

/**
 * /login sits outside the (app) shell, so there is no <LangProvider> above
 * this boundary — read the language cookie directly (guarded for SSR).
 */
function readCookieLang(): Lang {
  if (typeof document === "undefined") return "mn";
  const m = document.cookie.match(new RegExp(`(?:^|; )${LANG_COOKIE}=([^;]+)`));
  const v = m?.[1] as Lang | undefined;
  return v && VALID.includes(v) ? v : "mn";
}

/**
 * Route-level error boundary for /login.
 *
 * Without it, a throw inside the login server actions (e.g. the pre-TOTP
 * cookie could not be signed because REAUTH_COOKIE_SECRET is unset in
 * production) unmounted the whole tree into app/global-error.tsx — an
 * unstyled, English-only page. This keeps the user inside the login visual
 * language with a retry + a hard link back to /login.
 *
 * `error.message` is intentionally never rendered: it can carry internal
 * detail (env var names, stack fragments). Only the opaque digest is shown.
 */
export default function LoginError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [lang] = useState<Lang>(() => readCookieLang());

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="min-h-screen flex flex-col bg-gradient-hero relative overflow-hidden">
      {/* Decorative mesh gradient backdrop (same as the login page) */}
      <div className="absolute inset-0 bg-gradient-mesh opacity-50 pointer-events-none" aria-hidden />
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] rounded-full blur-3xl pointer-events-none"
        style={{ background: "radial-gradient(circle, rgba(0,212,255,0.12) 0%, transparent 70%)" }}
        aria-hidden
      />

      <main className="relative z-10 flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-sm">
          {/* Hero */}
          <div className="flex flex-col items-center mb-8 animate-fade-in-up">
            <div className="relative mb-5">
              <div className="absolute inset-0 bg-danger/20 blur-2xl rounded-full" aria-hidden />
              <MongolzLogo size={96} className="relative drop-shadow-2xl" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-gradient-soft">MONGOLZ Security</h1>
          </div>

          {/* Card */}
          <div
            className="card-glass shadow-overlay ring-1 ring-danger/20 text-center space-y-4 animate-fade-in-up"
            style={{ animationDelay: "60ms" }}
            role="alert"
          >
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-danger-soft text-danger border border-danger/20">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-text">{t("ui_error_title", lang)}</h2>
              <p className="text-sm text-text-soft mt-1.5 text-pretty">{t("login_err_boundary_desc", lang)}</p>
              {error.digest && (
                <p className="text-2xs font-mono text-text-muted mt-2">ref {error.digest}</p>
              )}
            </div>
            <div className="flex flex-col gap-2 pt-1">
              <button type="button" onClick={reset} className="btn-primary w-full">
                <RotateCcw className="w-4 h-4" />
                {t("ui_retry", lang)}
              </button>
              {/* Plain anchor on purpose: a full navigation resets any broken client router state. */}
              <a href="/login" className="btn-ghost btn-sm w-full">
                {t("login_err_back", lang)}
              </a>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
