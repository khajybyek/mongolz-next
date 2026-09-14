import Link from "next/link";
import { Camera, KeyRound, Layers3, LockKeyhole, ShieldCheck } from "lucide-react";
import { MongolzLogo } from "@/components/logo";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { Alert } from "@/components/ui/alert";
import { getT } from "@/lib/i18n/server";
import type { TranslationKey } from "@/lib/i18n/translations";
import { sanitizeNextPath } from "@/lib/auth/safe-next";
import { signInAction, verifyTotpAction, cancelTotpAction } from "./actions";
import { PasskeyLoginButton } from "./passkey-login-button";
import { LoginSubmitButton, PasswordInput } from "./login-controls";
import { loginCopy } from "./login-copy";

/** Only known error codes are rendered. Never echo untrusted query text. */
const ERROR_KEYS: Record<string, TranslationKey> = {
  invalid_credentials: "login_error",
  too_many_attempts: "login_err_too_many",
  code_format: "login_err_code_format",
  code_invalid: "login_err_code_invalid",
  code_used: "login_err_code_used",
  code_expired: "login_err_code_expired",
  signin_failed: "login_err_signin_failed",
  no_profile: "login_err_no_profile",
  session_pin: "login_err_session_pin",
  callback_failed: "login_err_callback",
  server_config: "login_err_server_config",
};

const featureIcons = [Camera, Layers3, ShieldCheck];

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string; step?: string }>;
}) {
  const { error, next: rawNext, step } = await searchParams;
  const { lang, t } = await getT();
  const copy = loginCopy[lang];
  const isTotpStep = step === "totp";
  const next = sanitizeNextPath(rawNext);
  const errorText = error ? t(ERROR_KEYS[error] ?? "login_err_generic") : null;

  return (
    <div className="relative flex min-h-svh flex-col bg-bg">
      <header className="auth-safe-gutter relative z-10 mx-auto flex w-full max-w-[1440px] items-center justify-between gap-3 py-5 pt-[calc(1.25rem+env(safe-area-inset-top,0px))] lg:py-7">
        <Link href="/" className="flex min-h-11 items-center gap-3 rounded-lg" aria-label="MONGOLZ Security">
          <MongolzLogo size={36} />
          <span className="hidden flex-col gap-0.5 min-[400px]:flex">
            <span className="text-sm font-bold tracking-[0.16em]">MONGOLZ</span>
            <span className="text-[10px] font-medium uppercase tracking-[0.24em] text-text-muted">Security</span>
          </span>
        </Link>
        <div className="flex items-center gap-2">
          <LanguageSwitcher current={lang} />
          <ThemeToggle />
        </div>
      </header>

      <main id="main-content" className="auth-safe-gutter relative mx-auto flex w-full max-w-[1280px] flex-1 items-center py-5 lg:py-8">
        <div className="grid w-full overflow-hidden rounded-3xl border border-border bg-surface shadow-soft lg:min-h-[640px] lg:grid-cols-[1.05fr_1fr]">
          <section className="relative isolate hidden flex-col overflow-hidden bg-[#0b1729] p-12 text-white lg:flex xl:p-14" aria-labelledby="product-heading">
            <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden style={{ backgroundImage: "radial-gradient(ellipse at 0% 0%, rgba(34, 211, 238, 0.11), transparent 65%)" }} />
            <div className="flex items-center gap-2.5 text-[10px] font-semibold tracking-[0.2em] text-cyan-300">
              <span className="h-px w-6 bg-cyan-300/70" aria-hidden />
              {copy.console}
            </div>

            <div className="my-auto py-12">
              <h2 id="product-heading" className="whitespace-pre-line text-[46px] font-semibold leading-[1.12] tracking-[-0.045em] text-white xl:text-[54px]">{copy.heading}</h2>
              <p className="mt-6 max-w-sm text-[15px] leading-7 text-slate-400">{copy.description}</p>
              <ul className="mt-10 space-y-5">
                {copy.features.map((feature, index) => {
                  const Icon = featureIcons[index];
                  return (
                    <li key={feature} className="flex items-center gap-3.5 text-sm text-slate-300">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.035] text-cyan-200">
                        <Icon className="h-4 w-4" aria-hidden />
                      </span>
                      {feature}
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="flex items-start gap-2.5 border-t border-white/10 pt-6 text-xs leading-5 text-slate-400">
              <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <p>{copy.authorized}</p>
            </div>
          </section>

          <section className="flex flex-col justify-center px-6 py-9 sm:px-12 sm:py-12 xl:px-16" aria-labelledby="login-heading">
            <div className="mx-auto w-full max-w-sm">
              <div className="mb-8">
                <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-bg-secondary text-accent">
                  {isTotpStep ? <ShieldCheck className="h-5 w-5" aria-hidden /> : <LockKeyhole className="h-5 w-5" aria-hidden />}
                </div>
                <p className="mb-2 text-xs font-medium text-text-muted">{copy.workspace}</p>
                <h1 id="login-heading" className="text-3xl font-semibold leading-tight tracking-tight">{isTotpStep ? copy.totpTitle : copy.welcome}</h1>
                <p id="login-hint" className="mt-3 text-sm leading-6 text-text-soft">{isTotpStep ? t("login_totp_hint") : copy.signInHint}</p>
              </div>

              {isTotpStep ? (
                <>
                  <form action={verifyTotpAction} className="space-y-5" aria-describedby="login-hint">
                    <div>
                      <label htmlFor="totp_code" className="label">{copy.totpLabel}</label>
                      <input
                        id="totp_code"
                        name="totp_code"
                        inputMode="text"
                        autoCapitalize="characters"
                        spellCheck={false}
                        maxLength={11}
                        required
                        autoComplete="one-time-code"
                        autoFocus
                        className="input min-h-14 text-center font-mono text-2xl tracking-[0.18em]"
                        placeholder="000000"
                        aria-describedby="login-hint totp-note"
                      />
                    </div>
                    <input type="hidden" name="next" value={next} />
                    {errorText && <Alert variant="danger">{errorText}</Alert>}
                    <LoginSubmitButton label={copy.verify} pendingLabel={copy.verifying} />
                  </form>
                  <form action={cancelTotpAction} className="mt-2">
                    <LoginSubmitButton label={copy.cancel} pendingLabel={copy.cancelling} secondary />
                  </form>
                  <p id="totp-note" className="mt-7 flex items-start gap-2 border-t border-border pt-5 text-xs leading-5 text-text-muted">
                    <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    {t("login_totp_note")}
                  </p>
                </>
              ) : (
                <form action={signInAction} className="space-y-5" aria-describedby="login-hint">
                  <div>
                    <label htmlFor="email" className="label">{t("login_email")}</label>
                    <input
                      id="email"
                      name="email"
                      type="text"
                      inputMode="email"
                      autoComplete="username"
                      autoCapitalize="none"
                      spellCheck={false}
                      required
                      className="input min-h-12 text-base"
                    />
                  </div>
                  <div>
                    <label htmlFor="password" className="label">{t("login_pass")}</label>
                    <PasswordInput showLabel={copy.showPassword} hideLabel={copy.hidePassword} />
                  </div>
                  <input type="hidden" name="next" value={next} />
                  {errorText && <Alert variant="danger">{errorText}</Alert>}
                  <LoginSubmitButton label={t("login_btn")} pendingLabel={copy.signingIn} />
                  <PasskeyLoginButton
                    next={next}
                    labels={{
                      button: copy.passkey,
                      busy: copy.passkeyBusy,
                      hint: copy.passkeyHint,
                      divider: copy.or,
                      needEmail: copy.passkeyNeedEmail,
                      notEnrolled: copy.passkeyUnavailable,
                      unsupported: copy.passkeyUnsupported,
                      cancelled: copy.passkeyCancelled,
                      generic: copy.passkeyError,
                      tooMany: t("login_err_too_many"),
                    }}
                  />
                </form>
              )}

              <p className="mt-8 border-t border-border pt-5 text-xs leading-5 text-text-muted">{copy.accountHelp}</p>
            </div>
          </section>
        </div>
      </main>

      <footer className="auth-safe-gutter mx-auto flex w-full max-w-[1280px] flex-col items-center justify-between gap-2 py-[max(1.5rem,env(safe-area-inset-bottom,0px))] text-[11px] leading-5 text-text-muted sm:flex-row">
        <span className="font-medium tracking-wide">MONGOLZ Security</span>
        <p>{copy.authorized}</p>
      </footer>
    </div>
  );
}
