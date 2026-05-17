import { ShieldCheck, KeyRound } from "lucide-react";
import { MongolzLogo } from "@/components/logo";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { Alert } from "@/components/ui/alert";
import { getServerLang, getT } from "@/lib/i18n/server";
import { signInAction, verifyTotpAction, cancelTotpAction } from "./actions";

function displayError(error: string): string {
  try {
    return decodeURIComponent(error);
  } catch {
    return error;
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string; step?: string }>;
}) {
  const { error, next, step } = await searchParams;
  const lang = await getServerLang();
  const { t } = await getT();
  const isTotpStep = step === "totp";

  return (
    <div className="min-h-screen flex flex-col bg-gradient-hero relative overflow-hidden">
      {/* Decorative mesh gradient backdrop */}
      <div className="absolute inset-0 bg-gradient-mesh opacity-50 pointer-events-none" aria-hidden />
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] rounded-full blur-3xl pointer-events-none"
        style={{ background: "radial-gradient(circle, rgba(0,212,255,0.12) 0%, transparent 70%)" }}
        aria-hidden
      />

      {/* Top bar */}
      <header className="relative z-10 flex items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2.5">
          <MongolzLogo size={32} />
          <span className="text-sm font-bold tracking-tight">MONGOLZ</span>
          <span className="badge-muted">Security</span>
        </div>
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
          <div className="card-glass shadow-overlay animate-fade-in-up" style={{ animationDelay: "60ms" }}>
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
                    {lang === "mn"
                      ? "Authenticator app-аас 6 оронтой кодоо оруулна уу"
                      : lang === "kr"
                      ? "Authenticator 앱에서 6자리 코드를 입력하세요"
                      : "Enter the 6-digit code from your authenticator app"}
                  </p>
                </div>

                <div>
                  <label htmlFor="totp_code" className="label">
                    {lang === "mn" ? "2FA код" : "2FA code"}
                  </label>
                  <input
                    id="totp_code"
                    name="totp_code"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                    autoComplete="one-time-code"
                    autoFocus
                    className="input text-center text-2xl tracking-[0.5em] font-mono"
                    placeholder="000000"
                  />
                </div>

                {next && <input type="hidden" name="next" value={next} />}

                {error && <Alert variant="danger">{displayError(error)}</Alert>}

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
                  {lang === "mn"
                    ? "Код 2 минут хүчинтэй. Authenticator app алдсан бол recovery code ашиглана уу."
                    : lang === "kr"
                    ? "코드는 2분간 유효합니다. 앱을 잃어버린 경우 복구 코드를 사용하세요."
                    : "Code is valid for 2 minutes. Use a recovery code if you lost your authenticator app."}
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

                {next && <input type="hidden" name="next" value={next} />}

                {error && <Alert variant="danger">{displayError(error)}</Alert>}

                <button type="submit" className="btn-primary w-full mt-2">
                  {t("login_btn")}
                </button>
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
