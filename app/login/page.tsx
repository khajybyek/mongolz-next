import { MongolzLogo } from "@/components/logo";
import { LanguageSwitcher } from "@/components/language-switcher";
import { getServerLang, getT } from "@/lib/i18n/server";
import { signInAction } from "./actions";

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
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  const lang = await getServerLang();
  const { t } = await getT();

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-gradient-to-br from-bg via-bg-secondary to-bg relative">
      {/* Language switcher — top-right corner */}
      <div className="absolute top-4 right-4">
        <LanguageSwitcher current={lang} />
      </div>

      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <MongolzLogo size={160} className="mb-4 drop-shadow-2xl" />
          <h1 className="text-2xl font-bold tracking-tight">MONGOLZ Security</h1>
          <p className="text-sm text-neutral-400 mt-1">AI-Powered Surveillance</p>
        </div>

        <form action={signInAction} className="card space-y-4">
          <div>
            <label className="text-xs uppercase tracking-wide text-neutral-400 mb-1.5 block">
              {t("login_email")}
            </label>
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              className="input"
            />
          </div>

          <div>
            <label className="text-xs uppercase tracking-wide text-neutral-400 mb-1.5 block">
              {t("login_pass")}
            </label>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="input"
            />
          </div>

          <div>
            <label className="text-xs uppercase tracking-wide text-neutral-400 mb-1.5 block">
              2FA code
            </label>
            <input
              name="totp_code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              autoComplete="one-time-code"
              className="input"
              placeholder="000000"
            />
          </div>

          {next && <input type="hidden" name="next" value={next} />}

          {error && (
            <div className="text-sm text-danger bg-danger/10 border border-danger/30 rounded-lg px-3 py-2">
              {displayError(error)}
            </div>
          )}

          <button type="submit" className="btn-primary w-full">
            {t("login_btn")}
          </button>
        </form>
      </div>
    </div>
  );
}
