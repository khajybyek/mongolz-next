import { Sidebar } from "@/components/sidebar";
import { RealtimeAlerts } from "@/components/realtime-alerts";
import { CommandPalette } from "@/components/command-palette";
import { requireUser } from "@/lib/supabase/auth";
import { getServerLang } from "@/lib/i18n/server";
import { LangProvider } from "@/lib/i18n/client";
import { isStaging, envLabel } from "@/lib/env";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, profile } = await requireUser();
  const lang = await getServerLang();

  const staging = isStaging();

  const SKIP_LABEL: Record<string, string> = {
    mn: "Гол хэсэг рүү шилжих",
    en: "Skip to main content",
    kr: "본문으로 건너뛰기",
  };
  const STAGING_SUFFIX: Record<string, string> = {
    mn: "ENVIRONMENT — production биш",
    en: "ENVIRONMENT — not production",
    kr: "ENVIRONMENT — 프로덕션 아님",
  };
  const MATCH_LABEL: Record<string, string> = { mn: "Тааралцал", en: "Match", kr: "일치" };
  const SEE_ALL: Record<string, string> = {
    mn: "Бүх alert харах →",
    en: "See all alerts →",
    kr: "전체 알림 보기 →",
  };
  const DISMISS: Record<string, string> = { mn: "Хаах", en: "Close", kr: "닫기" };

  return (
    <LangProvider initial={lang}>
    <div className="md:flex min-h-screen relative">
      {/* Ambient backdrop gradient — Linear/Vercel feel */}
      <div
        className="fixed inset-0 pointer-events-none -z-10"
        style={{
          backgroundImage:
            "radial-gradient(ellipse 60% 40% at 0% 0%, rgba(0,212,255,0.04) 0%, transparent 60%), radial-gradient(ellipse 50% 40% at 100% 100%, rgba(124,58,237,0.04) 0%, transparent 60%)",
        }}
        aria-hidden
      />
      {staging && (
        <div className="fixed top-0 left-0 right-0 z-40 bg-warning-soft border-b border-warning/30 text-warning text-2xs font-medium text-center py-1 pointer-events-none backdrop-blur">
          ⚠ {envLabel().toUpperCase()} {STAGING_SUFFIX[lang] ?? STAGING_SUFFIX.en}
        </div>
      )}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-2 focus:rounded focus:bg-accent focus:text-bg focus:text-sm focus:font-medium"
      >
        {SKIP_LABEL[lang] ?? SKIP_LABEL.en}
      </a>
      <Sidebar
        lang={lang}
        role={profile.role}
        email={user.email}
        isSuperAdmin={profile.is_super_admin}
      />
      <main id="main" tabIndex={-1} className="flex-1 min-w-0 overflow-x-hidden">
        <div className="px-4 md:px-6 lg:px-8 py-6 lg:py-8 max-w-7xl mx-auto animate-fade-in">
          {children}
        </div>
      </main>
      {/* Real-time alerts (admin only — RLS-restricted on alerts table) */}
      {profile.role === "admin" && (
        <RealtimeAlerts
          labels={{
            matchLabel: MATCH_LABEL[lang] ?? MATCH_LABEL.en!,
            seeAll: SEE_ALL[lang] ?? SEE_ALL.en!,
            dismiss: DISMISS[lang] ?? DISMISS.en!,
          }}
        />
      )}
      <CommandPalette role={profile.role} />
    </div>
    </LangProvider>
  );
}
