import Link from "next/link";
import { ShieldCheck, KeyRound } from "lucide-react";
import { MongolzLogo } from "@/components/logo";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { Alert } from "@/components/ui/alert";
import { getServerLang, getT } from "@/lib/i18n/server";
import type { TranslationKey } from "@/lib/i18n/translations";
import { sanitizeNextPath } from "@/lib/auth/safe-next";
import { signInAction, verifyTotpAction, cancelTotpAction } from "./actions";
import { PasskeyLoginButton } from "./passkey-login-button";

/**
 * Only known error *codes* are rendered (mapped to translated copy). Raw
 * query text is never echoed — it used to be, which allowed phishing-style
 * text injection through ?error=.
 */
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
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string; step?: string }>;
}) {
  const { error, next: rawNext, step } = await searchParams;
  const lang = await getServerLang();
  const { t } = await getT();
  const isTotpStep = step === "totp";
  const next = sanitizeNextPath(rawNext);
  const errorText = error ? t(ERROR_KEYS[error] ?? "login_err_generic") : null;

  return (
    <div className="min-h-screen flex flex-col bg-gradient-hero relative overflow-hidden">
      {/* Decorative mesh gradient backdrop */}
      <div className="absolute inset-0 bg-gradient-mesh opacity-50 pointer-events-none" aria-hidden />
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] rounded-full blur-3xl pointer-events-none"
        style={{ background: "radial-gradient(circle, rgba(0,212,255,0.12) 0%, transparent 70%)" }}
        aria-hidden
      />

      {/* Fine grid texture behind the card */}
      <div
        className="absolute inset-x-0 top-0 h-[640px] pointer-events-none opacity-[0.35] [mask-image:linear-gradient(180deg,rgba(0,0,0,0.9),transparent)]"
        style={{
          backgroundImage:
            "linear-gradient(rgb(var(--text-muted) / 0.08) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--text-muted) / 0.08) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
        }}
        aria-hidden
      />

      {/* Top bar */}
      <header className="relative z-10 flex items-center justify-between px-4 md:px-6 py-4 md:py-5">
        <Link href="/" className="flex items-center gap-2.5 group" aria-label="MONGOLZ Security">
          <MongolzLogo size={32} className="transition-transform group-hover:scale-105" />
          <span className="text-sm font-bold tracking-tight">MONGOLZ</span>
          <span className="badge-muted hidden sm:inline-flex">Security</span>
        </Link>
        <div className="flex items-center gap-2">
          <LanguageSwitcher current={lang} />
          <ThemeToggle />
        </div>
      </header>

      {/* Center content */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-4 pb-8">
        <div className="w-full max-w-sm">
          {/* Hero */}
          <div className="flex flex-col items-center mb-8 animate-fade-in-up">
            <div className="relative mb-5">
              <div className="absolute inset-0 bg-accent/30 blur-2xl rounded-full" aria-hidden />
              <MongolzLogo size={120} className="relative drop-shadow-2xl" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-gradient-soft">
              MONGOLZ Security
            </h1>
            <p className="text-sm text-text-soft mt-1.5">AI-Powered Surveillance</p>
          </div>

          {/* Card */}
          <div className="card-glass shadow-overlay animate-fade-in-up ring-1 ring-accent/10" style={{ animationDelay: "60ms" }}>
            {isTotpStep ? (
              // ───── Step 2 — TOTP code ─────
              <form action={verifyTotpAction} className="space-y-5">
                <div className="text-center">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-accent/15 text-accent border border-accent/20 mb-3">
                    <ShieldCheck className="w-6 h-6" />
                  </div>
                  <h2 className="text-lg font-semibold tracking-tight">
                    {lang === "mn"
                      ? "Хоёр түвшний баталгаажуулалт"
                      : lang === "kr"
                      ? "이중 인증"
                      : "Two-factor authentication"}
                  </h2>
                  <p className="text-xs text-text-soft mt-1.5 max-w-[260px] mx-auto">
                    {t("login_totp_hint")}
                  </p>
                </div>

                <div>
                  <label htmlFor="totp_code" className="label">
                    {lang === "mn" ? "2FA код" : "2FA code"}
                  </label>
                  <input
                    id="totp_code"
                    name="totp_code"
                    inputMode="text"
                    autoCapitalize="characters"
                    maxLength={11}
                    required
                    autoComplete="one-time-code"
                    autoFocus
                    className="input text-center text-2xl tracking-[0.3em] font-mono"
                    placeholder="000000"
                  />
                </div>

                <input type="hidden" name="next" value={next} />

                {errorText && <Alert variant="danger">{errorText}</Alert>}

                <button type="submit" className="btn-primary w-full">
                  {lang === "mn" ? "Баталгаажуулах" : lang === "kr" ? "확인" : "Verify"}
                </button>

                <button
                  type="submit"
                  formAction={cancelTotpAction}
                  className="btn-ghost w-full btn-sm"
                >
                  {lang === "mn"
                    ? "Болих — нэвтрэх хуудас руу буцах"
                    : lang === "kr"
                    ? "취소 — 로그인으로 돌아가기"
                    : "Cancel — back to login"}
                </button>

                <p className="text-2xs text-text-muted text-center leading-relaxed border-t border-border pt-3.5">
                  <KeyRound className="w-3 h-3 inline -mt-0.5 mr-1 opacity-60" />
                  {t("login_totp_note")}
                </p>
              </form>
            ) : (
              // ───── Step 1 — email + password ─────
              <form action={signInAction} className="space-y-4">
                <div>
                  <label htmlFor="email" className="label">
                    {t("login_email")}
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="text"
                    inputMode="email"
                    autoComplete="username"
                    autoCapitalize="none"
                    required
                    className="input"
                  />
                </div>

                <div>
                  <label htmlFor="password" className="label">
                    {t("login_pass")}
                  </label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    className="input"
                  />
                </div>

                <input type="hidden" name="next" value={next} />

                {errorText && <Alert variant="danger">{errorText}</Alert>}

                <button type="submit" className="btn-primary w-full mt-2">
                  {t("login_btn")}
                </button>

                <div className="relative my-3">
                  <div className="absolute inset-0 flex items-center" aria-hidden>
                    <div className="w-full border-t border-border" />
                  </div>
                  <div className="relative flex justify-center text-2xs uppercase tracking-wider">
                    <span className="bg-surface px-2 text-text-muted">
                      {lang === "mn" ? "эсвэл" : lang === "kr" ? "또는" : "or"}
                    </span>
                  </div>
                </div>

                <PasskeyLoginButton
                  next={next}
                  labels={{
                    button:
                      lang === "mn"
                        ? "Passkey-ээр нэвтрэх"
                        : lang === "kr"
                        ? "Passkey로 로그인"
                        : "Sign in with passkey",
                    needEmail:
                      lang === "mn"
                        ? "Email эсвэл username оруулна уу"
                        : lang === "kr"
                        ? "이메일 또는 사용자명을 입력하세요"
                        : "Enter your email or username first",
                    notEnrolled:
                      lang === "mn"
                        ? "Энэ хэрэглэгчид passkey бүртгэгдээгүй"
                        : lang === "kr"
                        ? "이 사용자에게 등록된 패스키가 없습니다"
                        : "No passkeys enrolled for this user",
                    unsupported:
                      lang === "mn"
                        ? "Энэ браузер passkey дэмжихгүй"
                        : lang === "kr"
                        ? "이 브라우저는 패스키를 지원하지 않습니다"
                        : "This browser doesn't support passkeys",
                    cancelled:
                      lang === "mn"
                        ? "Цуцлагдсан"
                        : lang === "kr"
                        ? "취소됨"
                        : "Cancelled",
                    generic:
                      lang === "mn"
                        ? "Passkey нэвтрэлт амжилтгүй"
                        : lang === "kr"
                        ? "패스키 로그인 실패"
                        : "Passkey login failed",
                  }}
                />
              </form>
            )}
          </div>

          {/* Footer hint */}
          <p className="text-2xs text-text-muted text-center mt-6 animate-fade-in-up" style={{ animationDelay: "120ms" }}>
            {lang === "mn"
              ? "Зөвшөөрөлтэй хэрэглэгчид л хандах эрхтэй."
              : lang === "kr"
              ? "승인된 사용자만 액세스할 수 있습니다."
              : "Authorized personnel only."}
          </p>
        </div>
      </main>
    </div>
  );
}
